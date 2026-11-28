import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { mkdtemp, rm } from 'node:fs/promises';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createInterface } from 'node:readline';
import { DatabaseSync } from 'node:sqlite';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';
import { createInfeed } from '../src/infeed.js';

test('manual release route survives simultaneous clicks and process loss after HubSpot accepts the note', { timeout: 20000 }, async t => {
  const directory = await mkdtemp(join(tmpdir(), 'mt-note-test-'));
  let server, exit;
  async function stop() {
    if (server && server.exitCode === null && server.signalCode === null) server.kill('SIGKILL');
    if (exit) await exit;
  }
  t.after(async () => {
    await stop();
    await rm(directory, { recursive: true, force: true });
  });
  const db = new DatabaseSync(join(directory, 'areas.sqlite'));
  try {
    createInfeed(db, 'synthetic');
    const seed = db.prepare('INSERT INTO responder_tickets VALUES (?, ?, 1, ?)');
    seed.run('12', '2', 'held');
    seed.run('13', '3', 'held');
  } finally {
    db.close();
  }

  const stored = [];
  let accepted;
  const sent = new Promise(resolve => { accepted = resolve; });
  const crm = createServer(async (req, res) => {
    res.setHeader('Content-Type', 'application/json');
    if (req.url === '/account-info/v3/details') return res.end('{"portalId":123}');
    if (req.url.endsWith('/labels')) return res.end(JSON.stringify({
      results: [{ category: 'HUBSPOT_DEFINED', typeId: 1, label: null }],
    }));
    if (req.method === 'POST' && req.url === '/crm/v3/objects/notes') {
      const parts = [];
      for await (const chunk of req) parts.push(chunk);
      stored.push(JSON.parse(Buffer.concat(parts)));
      accepted();
      // Keep the response unread until the test kills the app process.
      return;
    }
    if (req.url.startsWith('/crm/v4/objects/tickets/12/associations/notes?')) {
      return res.end(JSON.stringify({ results: stored.map((_, index) => ({ toObjectId: index + 7 })) }));
    }
    if (req.url.startsWith('/crm/v3/objects/notes/7?')) {
      return res.end(JSON.stringify({ id: '7', properties: stored[0].properties,
        associations: { tickets: { results: [{ id: '12' }] } } }));
    }
    res.writeHead(404).end('{}');
  });
  crm.listen(0, '127.0.0.1');
  await once(crm, 'listening');
  t.after(() => { crm.closeAllConnections(); crm.close(); });

  async function start() {
    const upstream = 'http://127.0.0.1:' + crm.address().port;
    const shim = `const original=fetch; globalThis.fetch=(input,opts)=>{
      const u=new URL(input); if(u.origin!=='https://api.hubapi.com') throw Error('unexpected origin');
      return original(${JSON.stringify(upstream)}+u.pathname+u.search,opts);
    };`;
    server = spawn(process.execPath, ['--import', 'data:text/javascript,' + encodeURIComponent(shim),
      fileURLToPath(new URL('../src/main.js', import.meta.url))], {
      env: { ...process.env, HUBSPOT_SERVICE_KEY: 'synthetic', MT_DATA_DIR: directory, PORT: '0' },
      stdio: ['ignore', 'pipe', 'inherit'],
    });
    exit = once(server, 'close');
    const lines = createInterface({ input: server.stdout });
    for await (const line of lines) if (/^http:\/\/127\.0\.0\.1:\d+$/.test(line)) return line;
    throw Error('Application did not start');
  }
  let origin = await start();
  const post = path => fetch(origin + '/api/infeed/' + path, { method: 'POST', headers: { Origin: origin } });
  const snapshot = async () => (await fetch(origin + '/api/infeed')).json();
  assert.equal((await snapshot()).notesEnabled, false);
  assert.equal((await post('tickets/13/release')).status, 503);
  assert.equal((await snapshot()).tickets.find(t => t.id === '13').state, 'held');
  assert.equal((await post('enabled/on')).status, 200);
  const clicks = await Promise.all([post('tickets/12/release'), post('tickets/12/release')]);
  assert.deepEqual(clicks.map(r => r.status), [200, 200]);
  await sent;
  assert.equal(stored.length, 1);
  assert.match(stored[0].properties.hs_note_body, /^AI Responder released this ticket manually\. Release reference: /);
  assert.equal(stored[0].associations[0].to.id, '12');
  await stop();
  origin = await start();
  await post('tickets/12/release');
  let ticket;
  for (let attempt = 0; attempt < 100; attempt++) {
    ticket = (await snapshot()).tickets.find(row => row.id === '12');
    if (ticket.note === 'added') break;
    await delay(25);
  }
  assert.equal(ticket.state, 'manual');
  assert.equal(ticket.note, 'added');
  assert.equal(stored.length, 1);
});

test('uncertain manual release stays read-only across incomplete, missing and duplicate matches', async t => {
  const db = new DatabaseSync(':memory:');
  t.after(() => db.close());
  let time = 1, posts = 0, scan = 'incomplete', body, account = 1;
  const feed = createInfeed(db, 'synthetic', async (url, options) => {
    if (url.pathname.includes('account-info')) return Response.json({ portalId: account });
    if (url.pathname.endsWith('/labels')) {
      return Response.json({ results: [{ category: 'HUBSPOT_DEFINED', label: null, typeId: 1 }] });
    }
    if (options.method === 'POST') {
      posts++;
      body = JSON.parse(options.body).properties.hs_note_body;
      throw Error('Response lost');
    }
    if (url.pathname.endsWith('/associations/notes')) {
      if (scan === 'incomplete') return new Response(null, { status: 503 });
      const results = scan === 'missing' ? [] : [{ toObjectId: 1 }, { toObjectId: 2 }];
      return Response.json({ results });
    }
    const id = url.pathname.split('/').pop();
    return Response.json({ id, properties: { hs_note_body: body }, associations: { tickets: { results: [{ id: '12' }] } } });
  }, () => time);
  await feed.configure('enabled', true);
  db.prepare('INSERT INTO responder_tickets VALUES (?,?,?,?)').run('12', '2', 1, 'held');
  feed.release('12');
  const status = () => feed.snapshot().tickets[0].note;
  account = 2;
  await feed.notes.work();
  assert.equal(status(), 'account');
  assert.equal(posts, 0);
  account = 1;
  time += 4000000;
  await feed.notes.work();
  assert.equal(posts, 1);
  for (scan of ['incomplete', 'missing', 'duplicate']) {
    time += 4000000;
    await feed.notes.work();
    assert.equal(status(), scan === 'duplicate' ? 'review' : 'verifying');
    assert.equal(posts, 1);
  }
});

test('a definitive permission refusal stays visible and recovers when the same key regains access', async t => {
  const db = new DatabaseSync(':memory:');
  t.after(() => db.close());
  let time = 1, requests = 0, posts = 0, body;
  const feed = createInfeed(db, 'synthetic', async (url, options) => {
    requests++;
    if (url.pathname.includes('account-info')) return Response.json({ portalId: 1 });
    if (url.pathname.endsWith('/labels')) return Response.json({
      results: [{ category: 'HUBSPOT_DEFINED', label: null, typeId: 1 }],
    });
    if (options.method === 'POST') {
      if (++posts === 1) return new Response(null, { status: 403 });
      body = JSON.parse(options.body).properties.hs_note_body;
      return Response.json({ id: '77' }, { status: 201 });
    }
    if (url.pathname.endsWith('/associations/notes')) return Response.json({ results: [{ toObjectId: 77 }] });
    return Response.json({ id: '77', properties: { hs_note_body: body }, associations: { tickets: { results: [{ id: '12' }] } } });
  }, () => time);
  await feed.configure('enabled', true);
  db.prepare('INSERT INTO responder_tickets VALUES (?,?,?,?)').run('12', '2', 1, 'held');
  feed.release('12');
  await feed.notes.work();
  assert.equal(feed.snapshot().tickets[0].note, 'permission');
  time += 60000;
  await feed.notes.work();
  assert.equal(feed.snapshot().tickets[0].note, 'added');
  assert.equal(db.prepare('SELECT note FROM release_notes').get().note, '77');
  assert.equal(posts, 2);
});

test('read-only upgrade requires activation and never adds jobs to earlier releases', async t => {
  const db = new DatabaseSync(':memory:');
  t.after(() => db.close());
  db.exec(`CREATE TABLE responder_settings(at INTEGER, enabled INTEGER, hold INTEGER);
    INSERT INTO responder_settings VALUES (1,1,0);
    CREATE TABLE responder_tickets(id TEXT PRIMARY KEY, thread TEXT, arrived INTEGER, state TEXT);
    INSERT INTO responder_tickets VALUES ('11','1',2,'automatic')`);
  const feed = createInfeed(db, 'synthetic', async () => Response.json({ portalId: 123 }), () => 100);
  assert.equal(feed.snapshot().enabled, false);
  await feed.configure('enabled', true);
  assert.equal(feed.snapshot().automaticNotes, true);
  feed.release('11');
  assert.equal(feed.snapshot().tickets[0].note, undefined);
});

test('an Off request during account verification cancels activation', async t => {
  const db = new DatabaseSync(':memory:');
  t.after(() => db.close());
  let respond;
  const feed = createInfeed(db, 'synthetic', () => new Promise(resolve => { respond = resolve; }));
  const enabling = feed.configure('enabled', true);
  await feed.configure('enabled', false);
  respond(Response.json({ portalId: 123 }));
  await assert.rejects(enabling, /superseded/);
  assert.equal(feed.snapshot().enabled, false);
  assert.equal(feed.snapshot().notesEnabled, false);
});
