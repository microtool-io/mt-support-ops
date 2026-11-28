import { randomUUID } from 'node:crypto';

const validId = id => /^\d{1,24}$/.test(String(id));
function noteBody(job) {
  const wording = job.state === 'automatic' ? 'automatically' : 'manually';
  return 'AI Responder released this ticket ' + wording + '. Release reference: ' + job.reference;
}

export function createReleaseNotes(db, key, request = fetch, now = Date.now) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS note_settings (
      id INTEGER PRIMARY KEY CHECK(id=1), account TEXT NOT NULL, enabled INTEGER NOT NULL
    ) STRICT;
    CREATE TABLE IF NOT EXISTS automatic_note_settings (
      id INTEGER PRIMARY KEY CHECK(id=1), since INTEGER NOT NULL
    ) STRICT;
    CREATE TABLE IF NOT EXISTS release_notes (
      ticket TEXT PRIMARY KEY, account TEXT NOT NULL, reference TEXT NOT NULL UNIQUE,
      phase TEXT NOT NULL, message TEXT NOT NULL, due INTEGER NOT NULL, attempts INTEGER NOT NULL DEFAULT 0,
      note TEXT
    ) STRICT;
  `);
  const settings = db.prepare('SELECT * FROM note_settings WHERE id=1');
  const next = db.prepare(`SELECT release_notes.*, responder_tickets.state FROM release_notes
    JOIN responder_tickets ON responder_tickets.id=release_notes.ticket
    WHERE (state='manual' OR (state='automatic' AND EXISTS(SELECT 1 FROM automatic_note_settings))) AND phase IN ('pending','uncertain')
    AND account=(SELECT account FROM note_settings WHERE enabled=1) AND due<=?
    ORDER BY due, release_notes.rowid LIMIT 1`);
  let running = false;

  async function call(path, payload) {
    if (!key?.trim()) throw new Error('key');
    const response = await request(new URL(path, 'https://api.hubapi.com'), {
      method: payload ? 'POST' : 'GET', redirect: 'error', cache: 'no-store',
      headers: { Authorization: 'Bearer ' + key.trim(), ...(payload && { 'Content-Type': 'application/json' }) },
      body: payload && JSON.stringify(payload), signal: AbortSignal.timeout(10000),
    });
    if (!response.ok) {
      const error = new Error('HubSpot request failed');
      error.status = response.status;
      error.retrySeconds = Number(response.headers.get('retry-after'));
      throw error;
    }
    return response.json();
  }

  async function accountId() {
    const { portalId } = await call('/account-info/v3/details');
    if (!validId(portalId)) throw new Error('Missing account ID');
    return String(portalId);
  }

  // Called in the same transaction that turns intake on.
  function bind(account, since) {
    const saved = db.prepare(`INSERT INTO note_settings VALUES(1,?,1)
      ON CONFLICT(id) DO UPDATE SET enabled=1 WHERE account=excluded.account`).run(account);
    if (!saved.changes) throw new Error('HubSpot account changed');
    db.prepare('INSERT INTO automatic_note_settings VALUES(1,?) ON CONFLICT DO NOTHING').run(since);
  }

  function enqueue(ticket) {
    const saved = db.prepare(`INSERT INTO release_notes(ticket, account, reference, phase, message, due)
      SELECT ?, account, ?, 'pending', 'queued', 0 FROM note_settings WHERE enabled=1`)
      .run(ticket, randomUUID());
    if (!saved.changes) throw new Error('Enable Infeed before releasing this ticket.');
  }

  async function findNote(job) {
    const seen = new Set();
    const notes = new Set();
    let cursor = '';
    let match = null;
    do {
      if (seen.has(cursor) || seen.size >= 20) throw new Error('Incomplete association scan');
      seen.add(cursor);
      const query = new URLSearchParams({ limit: '100' });
      if (cursor) query.set('after', cursor);
      const batch = await call('/crm/v4/objects/tickets/' + job.ticket + '/associations/notes?' + query);
      if (!Array.isArray(batch.results)) throw new Error('Invalid associations');
      for (const link of batch.results) {
        const id = String(link.toObjectId);
        if (!validId(id)) throw new Error('Invalid note ID');
        if (notes.has(id)) continue;
        notes.add(id);
        const n = await call('/crm/v3/objects/notes/' + id + '?properties=hs_note_body&associations=tickets');
        if (n.id !== id || typeof n.properties?.hs_note_body !== 'string') throw new Error('Incomplete note');
        if (n.properties.hs_note_body !== noteBody(job)) continue;
        if (match || !n.associations?.tickets?.results?.some(t => String(t.id) === job.ticket)) {
          return { ambiguous: true };
        }
        match = id;
      }
      cursor = batch.paging?.next?.after;
      if (batch.paging?.next && (typeof cursor !== 'string' || !cursor)) throw new Error('Invalid cursor');
    } while (cursor);
    return { match };
  }

  async function work() {
    if (running) return;
    running = true;
    let job;
    let creating = false;
    try {
      job = next.get(now());
      if (!job) return;
      // Claim a time slot across processes. Only the pending -> uncertain transition permits a POST.
      if (!db.prepare('UPDATE release_notes SET due=? WHERE ticket=? AND phase=? AND due=?')
        .run(now() + 60000, job.ticket, job.phase, job.due).changes) return;
      if (await accountId() !== job.account) throw new Error('account');
      if (!settings.get()?.enabled) return;
      if (job.phase === 'pending') {
        const labels = await call('/crm/v4/associations/notes/tickets/labels');
        const type = labels.results?.find(t => t.category === 'HUBSPOT_DEFINED' && t.label === null);
        if (!Number.isInteger(type?.typeId)) throw new Error('Missing association type');
        if (!db.prepare(`UPDATE release_notes SET phase='uncertain',message='verifying',due=0
          WHERE ticket=? AND phase='pending'
          AND (?='manual' OR EXISTS(SELECT 1 FROM automatic_note_settings))
          AND EXISTS(SELECT 1 FROM note_settings WHERE enabled=1 AND account=?)`)
          .run(job.ticket, job.state, job.account).changes) return;
        job.phase = 'uncertain';
        creating = true;
        const created = await call('/crm/v3/objects/notes', {
          properties: { hs_timestamp: new Date(now()).toISOString(), hs_note_body: noteBody(job) },
          associations: [{ to: { id: job.ticket }, types: [{ associationCategory: type.category, associationTypeId: type.typeId }] }],
        });
        creating = false;
        if (!validId(created.id)) throw new Error('Missing created note ID');
        job.note = String(created.id);
        db.prepare("UPDATE release_notes SET note=? WHERE ticket=? AND phase='uncertain'").run(job.note, job.ticket);
      }
      const result = await findNote(job);
      if (result.match && (!job.note || job.note === result.match)) {
        db.prepare("UPDATE release_notes SET phase='added',message='added',note=? WHERE ticket=? AND phase='uncertain'")
          .run(result.match, job.ticket);
      } else if (result.ambiguous || result.match) {
        db.prepare("UPDATE release_notes SET phase='review',message='review' WHERE ticket=? AND phase='uncertain'").run(job.ticket);
      } else {
        throw new Error('Missing note');
      }
    } catch (error) {
      if (!job) return;
      const attempts = job.attempts + 1;
      const message = error.message === 'account' ? 'account' :
        [401, 403].includes(error.status) ? 'permission' : job.phase === 'uncertain' ? 'verifying' : 'queued';
      const refused = creating && [401, 403, 429].includes(error.status);
      const review = job.phase === 'uncertain' && !refused && attempts >= 6;
      let phase = job.phase;
      if (refused) phase = 'pending';
      if (review) phase = 'review';
      const backoff = Math.min(3600, 30 * 2 ** Math.min(7, attempts - 1));
      const delay = Math.max(backoff, Number.isFinite(error.retrySeconds) ? error.retrySeconds : 0);
      db.prepare('UPDATE release_notes SET phase=?,message=?,due=?,attempts=? WHERE ticket=? AND phase=?')
        .run(phase, review ? 'review' : message, now() + delay * 1000, attempts, job.ticket, job.phase);
    } finally {
      running = false;
    }
  }
  return { accountId, bind, enqueue, work, enabled: () => !!settings.get()?.enabled, automatic: () => !!db.prepare('SELECT id FROM automatic_note_settings').get() };
}
