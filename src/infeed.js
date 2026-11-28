const base = 'https://api.hubapi.com/conversations/v3/conversations/';
const validId = value => typeof value === 'string' && /^\d{1,24}$/.test(value);
const overlap = 15 * 60_000;
const pagesPerInbox = 5;
const workPerPoll = 40;
const defaults = { enabled: 0, hold: 1 };

export function createInfeed(db, key, request = fetch, now = Date.now) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS responder_settings (
      at INTEGER NOT NULL, enabled INTEGER NOT NULL, hold INTEGER NOT NULL
    ) STRICT;
    CREATE INDEX IF NOT EXISTS responder_settings_time ON responder_settings(at);
    CREATE TABLE IF NOT EXISTS responder_tickets (
      id TEXT PRIMARY KEY, thread TEXT NOT NULL, arrived INTEGER NOT NULL, state TEXT NOT NULL
    ) STRICT;
    CREATE TABLE IF NOT EXISTS responder_sync (id INTEGER PRIMARY KEY, checked INTEGER) STRICT;
    CREATE TABLE IF NOT EXISTS responder_scans (
      inbox TEXT PRIMARY KEY, checked INTEGER, started INTEGER, cursor TEXT
    ) STRICT;
    CREATE TABLE IF NOT EXISTS responder_cursors (
      inbox TEXT NOT NULL, token TEXT NOT NULL, PRIMARY KEY (inbox, token)
    ) STRICT;
    CREATE TABLE IF NOT EXISTS responder_work (
      thread TEXT PRIMARY KEY, inbox TEXT NOT NULL, due INTEGER NOT NULL, attempts INTEGER NOT NULL
    ) STRICT;
    CREATE INDEX IF NOT EXISTS responder_work_due ON responder_work(due, thread);
  `);
  const at = db.prepare('SELECT enabled, hold FROM responder_settings WHERE at <= ? ORDER BY at DESC, rowid DESC LIMIT 1');
  const current = () => at.get(Number.MAX_SAFE_INTEGER) ?? defaults;
  const lookup = db.prepare('SELECT * FROM responder_tickets WHERE id = ?');
  const checkpoint = db.prepare('SELECT checked FROM responder_sync WHERE id = 1');
  let busy = false;
  let problem = '';
  let retryAt = 0;

  async function read(path, query, missingAllowed = false) {
    const url = new URL(path, base);
    url.search = new URLSearchParams(query);
    const result = await request(url, {
      headers: { Authorization: 'Bearer ' + key.trim() }, redirect: 'error', signal: AbortSignal.timeout(10000),
    });
    if (result.ok) return result.json();
    if (result.status === 404 && missingAllowed) return null;
    if (result.status === 429) {
      const seconds = Number(result.headers.get('retry-after'));
      retryAt = now() + Math.max(60, Number.isFinite(seconds) ? seconds : 60) * 1000;
      throw new Error('Rate limited by HubSpot.');
    }
    if ([401, 403].includes(result.status)) throw new Error('Check the HubSpot key and conversations.read permission.');
    const error = new Error('HubSpot is unavailable.');
    error.status = result.status;
    throw error;
  }

  async function page(path, query) {
    const data = await read(path, query);
    if (!Array.isArray(data?.results)) throw new Error('Unexpected HubSpot response.');
    const next = data.paging?.next;
    if (next && (typeof next.after !== 'string' || !next.after)) throw new Error('HubSpot pagination did not complete.');
    return { items: data.results, next: next?.after ?? null };
  }

  async function* pages(path, query) {
    const seen = new Set();
    let after;
    do {
      const batch = await page(path, after ? { ...query, after } : query);
      yield* batch.items;
      after = batch.next;
      if (seen.has(after)) throw new Error('HubSpot pagination did not complete.');
      seen.add(after);
    } while (after);
  }

  function configure(field, value) {
    const settings = { ...current() };
    if (!['enabled', 'hold'].includes(field) || typeof value !== 'boolean') throw new Error('Invalid setting');
    if (field === 'enabled' && value && !key?.trim()) throw new Error('HubSpot key required');
    if (settings[field] === Number(value)) return;
    settings[field] = Number(value);
    db.prepare('INSERT INTO responder_settings VALUES (?, ?, ?)').run(now(), settings.enabled, settings.hold);
  }

  const scanRow = db.prepare('SELECT * FROM responder_scans WHERE inbox = ?');
  const enqueue = db.prepare('INSERT INTO responder_work VALUES (?, ?, ?, 0) ON CONFLICT DO NOTHING');
  const nextWork = db.prepare('SELECT * FROM responder_work WHERE due <= ? ORDER BY due, thread LIMIT ?');
  const forget = db.prepare('DELETE FROM responder_work WHERE thread = ?');

  function ticketIds(thread) {
    const links = thread.threadAssociations;
    return (Array.isArray(links) ? links : [links]).map(link => link?.associatedTicketId).filter(validId);
  }

  function replayWindow(inbox) {
    // Keep the window start, completed checkpoint and queued jobs. Only the
    // provider's continuation is being replaced.
    db.exec('BEGIN IMMEDIATE');
    try {
      db.prepare('DELETE FROM responder_cursors WHERE inbox = ?').run(inbox);
      db.prepare('UPDATE responder_scans SET cursor = NULL WHERE inbox = ?').run(inbox);
      db.exec('COMMIT');
    } catch (error) {
      db.exec('ROLLBACK');
      throw error;
    }
  }

  async function scanInbox(inbox, first, started) {
    db.prepare('INSERT INTO responder_scans (inbox, started) VALUES (?, ?) ON CONFLICT(inbox) DO UPDATE SET started = coalesce(started, excluded.started)')
      .run(inbox, started);
    const scan = scanRow.get(inbox);
    const since = Math.max(first, (scan.checked ?? first) - overlap);
    const query = { inboxId: inbox, association: 'TICKET', sort: 'latestMessageTimestamp', limit: '100',
      latestMessageTimestampAfter: new Date(since - 1).toISOString() };

    for (let i = 0; i < pagesPerInbox && current().enabled; i++) {
      let batch;
      try {
        batch = await page('threads', scan.cursor ? { ...query, after: scan.cursor } : query);
      } catch (error) {
        if (scan.cursor && [400, 410].includes(error.status)) replayWindow(inbox);
        throw error;
      }
      if (!current().enabled) return;
      // A scan has a fixed end so a busy inbox cannot keep it open indefinitely.
      const beyondEnd = batch.items.some(thread => Date.parse(thread.latestMessageTimestamp) > scan.started);
      const cursor = beyondEnd ? null : batch.next;
      db.exec('BEGIN IMMEDIATE');
      try {
        for (const thread of batch.items) {
          const received = Date.parse(thread.latestMessageReceivedTimestamp);
          if (String(thread.inboxId) !== inbox || thread.archived || thread.spam || !validId(thread.id) ||
              !Number.isFinite(received) || received < first || received > scan.started) continue;
          const ids = ticketIds(thread);
          if (!ids.length || ids.some(id => !lookup.get(id))) enqueue.run(thread.id, inbox, started);
        }
        if (cursor) {
          const saved = db.prepare('INSERT INTO responder_cursors VALUES (?, ?) ON CONFLICT DO NOTHING').run(inbox, cursor);
          if (!saved.changes) throw new Error('HubSpot pagination did not complete.');
          db.prepare('UPDATE responder_scans SET cursor = ? WHERE inbox = ?').run(cursor, inbox);
        } else {
          db.prepare('UPDATE responder_scans SET checked = started, started = NULL, cursor = NULL WHERE inbox = ?').run(inbox);
          db.prepare('DELETE FROM responder_cursors WHERE inbox = ?').run(inbox);
        }
        db.exec('COMMIT');
      } catch (error) {
        db.exec('ROLLBACK');
        if (error.message === 'HubSpot pagination did not complete.') replayWindow(inbox);
        throw error;
      }
      if (!cursor) break;
      scan.cursor = cursor;
    }
  }

  async function route(job) {
    const thread = await read('threads/' + job.thread, { association: 'TICKET' }, true);
    if (thread === null || thread.archived || thread.spam || String(thread.inboxId) !== job.inbox) return true;
    if (thread.id !== job.thread) throw new Error('Unexpected HubSpot response.');
    const ids = ticketIds(thread);
    if (!ids.length) return false;
    const unknown = ids.filter(id => !lookup.get(id));
    if (!unknown.length) return true;
    // HubSpot's ascending message order includes comments and outgoing messages.
    // Only the first incoming MESSAGE determines the immutable routing decision.
    for await (const message of pages('threads/' + job.thread + '/messages', { sort: 'createdAt', limit: '100' })) {
      if (message.type !== 'MESSAGE' || message.direction !== 'INCOMING') continue;
      const arrived = Date.parse(message.createdAt);
      if (!Number.isFinite(arrived) || arrived > now()) return false;
      const settings = at.get(arrived);
      if (!settings?.enabled) return true;
      for (const id of unknown) {
        const first = await page('threads', { associatedTicketId: id, sort: 'id', limit: '1' });
        if (!first.items.length || !current().enabled) return false;
        if (first.items[0].id === job.thread) {
          db.prepare('INSERT INTO responder_tickets VALUES (?, ?, ?, ?) ON CONFLICT DO NOTHING')
            .run(id, job.thread, arrived, settings.hold ? 'held' : 'automatic');
        }
      }
      return true;
    }
    return false;
  }

  async function drain() {
    for (const job of nextWork.all(now(), workPerPoll)) {
      if (!current().enabled) break;
      // Rotate outstanding jobs fairly even if a read fails or the process exits.
      const delay = Math.min(3600, 30 * 2 ** Math.min(7, job.attempts));
      db.prepare('UPDATE responder_work SET due = ?, attempts = attempts + 1 WHERE thread = ?')
        .run(now() + delay * 1000, job.thread);
      if (await route(job)) forget.run(job.thread);
    }
  }

  async function poll() {
    if (busy || !current().enabled || now() < retryAt) return;
    busy = true;
    const started = now();
    try {
      const first = db.prepare('SELECT min(at) AS start FROM responder_settings WHERE enabled = 1').get().start;
      let found = false;
      let checked = started;
      for await (const inbox of pages('inboxes', {})) {
        if (!current().enabled) return;
        if (inbox.type !== 'HELP_DESK') continue;
        const id = String(inbox.id);
        if (!validId(id)) throw new Error('Unexpected HubSpot response.');
        found = true;
        await scanInbox(id, first, started);
        checked = Math.min(checked, scanRow.get(id).checked ?? 0);
      }
      if (!found) throw new Error('No Help Desk inbox found.');
      await drain();
      if (!current().enabled) return;
      if (checked) db.prepare('INSERT OR REPLACE INTO responder_sync VALUES (1, ?)').run(checked);
      problem = '';
    } catch (error) {
      const known = ['Rate limited by HubSpot.', 'Check the HubSpot key and conversations.read permission.',
        'HubSpot is unavailable.', 'Unexpected HubSpot response.', 'HubSpot pagination did not complete.', 'No Help Desk inbox found.'];
      problem = known.includes(error.message) ? error.message : 'Could not complete the Help Desk check.';
    } finally {
      busy = false;
    }
  }

  function snapshot() {
    const { enabled, hold } = current();
    const tickets = db.prepare('SELECT id, arrived, state FROM responder_tickets ORDER BY arrived DESC, id DESC').all();
    const pending = db.prepare('SELECT count(*) AS count FROM responder_work').get().count;
    return { enabled: !!enabled, hold: !!hold, tickets, pending, checked: checkpoint.get()?.checked ?? null, problem, busy };
  }

  async function detail(id) {
    const ticket = lookup.get(id);
    if (!ticket) return null;
    if (!key?.trim() || now() < retryAt) throw new Error('Message unavailable');
    for await (const message of pages('threads/' + ticket.thread + '/messages', { limit: '100' })) {
      if (message.type === 'MESSAGE' && message.direction === 'INCOMING' && typeof message.text === 'string' && message.text.trim()) {
        return { text: message.text.slice(0, 8000) };
      }
    }
    return { text: '' };
  }

  function release(id) {
    db.prepare("UPDATE responder_tickets SET state = 'manual' WHERE id = ? AND state = 'held'").run(id);
    return !!lookup.get(id);
  }

  return { configure, snapshot, poll, detail, release };
}

export async function serveInfeed(req, res, port, feed, path) {
  function send(code, value) {
    res.writeHead(code, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' });
    res.end(JSON.stringify(value));
  }
  const { host, origin } = req.headers;
  const local = host === '127.0.0.1:' + port || host === 'localhost:' + port;
  if (!local || (origin !== undefined && origin !== 'http://' + host) ||
      req.headers['sec-fetch-site'] === 'cross-site' || (req.method !== 'GET' && origin !== 'http://' + host)) {
    return send(403, { error: 'Origin denied' });
  }
  try {
    if (path === '/api/infeed' && req.method === 'GET') return send(200, feed.snapshot());
    const ticket = /^\/api\/infeed\/tickets\/(\d{1,24})(\/release)?$/.exec(path);
    if (ticket && !ticket[2] && req.method === 'GET') {
      const detail = await feed.detail(ticket[1]);
      return send(detail ? 200 : 404, detail);
    }
    if (ticket?.[2] && req.method === 'POST') {
      if (!feed.release(ticket[1])) return send(404, { error: 'Unknown ticket' });
      return send(200, feed.snapshot());
    }
    const setting = /^\/api\/infeed\/(enabled|hold)\/(on|off)$/.exec(path);
    if (setting && req.method === 'POST') {
      feed.configure(setting[1], setting[2] === 'on');
      if (setting[1] === 'enabled' && setting[2] === 'on') void feed.poll();
      return send(200, feed.snapshot());
    }
    send(404, { error: 'Unknown infeed route' });
  } catch {
    send(503, { error: 'Infeed request unavailable' });
  }
}
