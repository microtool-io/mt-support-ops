import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import test from 'node:test';
import { createInfeed } from '../src/infeed.js';

function installation(t, pageSize = 100) {
  const dir = mkdtempSync(join(tmpdir(), 'mt-sync-'));
  const path = join(dir, 'installation.sqlite');
  const threads = new Map();
  const messages = new Map();
  const scans = [];
  let db = new DatabaseSync(path);
  let time = Date.UTC(2026, 0, 1);
  let failCursor;
  let failureStatus;
  t.after(() => {
    db.close();
    rmSync(dir, { recursive: true, force: true });
  });
  function clock(ms = 1) { time += ms; return time; }
  function batch(rows, url) {
    const start = Number(url.searchParams.get('after')?.split(':')[1] ?? 0);
    const end = start + Math.min(pageSize, Number(url.searchParams.get('limit')));
    return Response.json({ results: rows.slice(start, end),
      paging: end < rows.length ? { next: { after: 'cursor:' + end } } : undefined });
  }
  async function read(url, options) {
    assert.equal(url.origin, 'https://api.hubapi.com');
    assert.equal(options.method ?? 'GET', 'GET');
    if (url.pathname === '/account-info/v3/details') return Response.json({ portalId: 1 });
    const q = url.searchParams;
    if (url.pathname.endsWith('/inboxes')) return Response.json({ results: [{ type: 'HELP_DESK', id: '1' }] });
    const detail = /\/threads\/(\d+)(\/messages)?$/.exec(url.pathname);
    if (detail) {
      if (!detail[2]) return Response.json(threads.get(detail[1]) ?? null, { status: threads.has(detail[1]) ? 200 : 404 });
      assert.equal(q.get('sort'), 'createdAt');
      const history = [...messages.get(detail[1])].sort((a, b) => a.createdAt.localeCompare(b.createdAt));
      return batch(history, url);
    }
    const all = [...threads.values()];
    if (q.has('associatedTicketId')) {
      const id = q.get('associatedTicketId');
      return Response.json({ results: all.filter(th => th.threadAssociations?.associatedTicketId === id).slice(0, 1) });
    }
    scans.push(new URL(url));
    if (failCursor && q.get('after') === failCursor) {
      failCursor = null;
      return new Response(null, { status: failureStatus });
    }
    // The real endpoint only honors its activity cutoff with the time sort.
    const sorted = q.get('sort') === 'latestMessageTimestamp';
    const cutoff = q.get('latestMessageTimestampAfter');
    const rows = sorted ? all.filter(th => th.latestMessageTimestamp > cutoff)
      .sort((a, b) => a.latestMessageTimestamp.localeCompare(b.latestMessageTimestamp)) : all;
    return batch(rows, url);
  }
  function add(id, stamp = time) {
    const date = new Date(stamp).toISOString();
    const thread = { id, inboxId: '1', createdAt: date, latestMessageTimestamp: date,
      latestMessageReceivedTimestamp: date, threadAssociations: { associatedTicketId: id } };
    threads.set(id, thread);
    messages.set(id, [{ type: 'MESSAGE', direction: 'INCOMING', createdAt: date }]);
    return thread;
  }
  const api = { add, clock, messages, scans, failAt(cursor, status = 503) { failCursor = cursor; failureStatus = status; },
    feed: createInfeed(db, 'synthetic', read, () => time),
    restart() {
      db.close();
      db = new DatabaseSync(path);
      api.feed = createInfeed(db, 'synthetic', read, () => time);
    } };
  return api;
}

test('activity cutoff uses timestamp sort and preserves all threads tied at a page boundary', async t => {
  const env = installation(t, 1);
  env.add('11', env.clock() - 60000);
  await env.feed.configure('enabled', true);
  const tied = env.clock();
  for (const id of ['12', '13', '14']) env.add(id, tied);
  await env.feed.poll();
  assert.equal(env.feed.snapshot().problem, '');
  assert.deepEqual(env.feed.snapshot().tickets.map(t => t.id).sort(), ['12', '13', '14']);
  assert.equal(env.scans.length, 3);
  assert.ok(env.scans.every(url => url.searchParams.get('sort') === 'latestMessageTimestamp'));
  env.clock(20 * 60_000);
  await env.feed.poll();
  env.clock();
  await env.feed.poll();
  assert.ok(Date.parse(env.scans.at(-1).searchParams.get('latestMessageTimestampAfter')) > tied);
});

test('501 pages resume after poll budget, failed read and process reopen without losing a tied timestamp', async t => {
  const env = installation(t, 1);
  await env.feed.configure('enabled', true);
  const start = env.clock();
  for (let i = 1; i <= 501; i++) env.add(String(i), start);
  await env.feed.poll();
  const count = env.scans.length;
  assert.ok(count > 0 && count < 501);
  assert.equal(env.feed.snapshot().checked, null);
  env.restart();
  env.failAt('cursor:' + count);
  await env.feed.poll();
  assert.ok(env.feed.snapshot().problem);
  assert.equal(env.feed.snapshot().checked, null);
  for (let i = 0; !env.feed.snapshot().checked && i < 501; i++) await env.feed.poll();
  assert.equal(env.scans.length, 502); // one retried request
  assert.equal(env.scans[count + 1].searchParams.get('after'), 'cursor:' + count);
  assert.equal(env.feed.snapshot().checked, start);
  assert.equal(env.feed.snapshot().tickets.length, 501);
});

test('an unlinked thread is recovered beyond the overlap after restart without new activity', async t => {
  const env = installation(t);
  await env.feed.configure('enabled', true);
  const thread = env.add('21', env.clock());
  delete thread.threadAssociations;
  await env.feed.poll();
  assert.equal(env.feed.snapshot().pending, 1);
  env.clock(20 * 60_000);
  await env.feed.configure('hold', false);
  await env.feed.poll();
  env.restart();
  env.clock(5 * 60_000);
  thread.threadAssociations = { associatedTicketId: '21' };
  await env.feed.poll();
  assert.ok(Date.parse(env.scans.at(-1).searchParams.get('latestMessageTimestampAfter')) > Date.parse(thread.latestMessageTimestamp));
  const saved = env.feed.snapshot();
  assert.equal(saved.pending, 0);
  assert.deepEqual(saved.tickets.map(ticket => ({ ...ticket })), [
    { id: '21', state: 'held', arrived: Date.parse(thread.createdAt) },
  ]);
});

test('outbound-first conversations follow the first incoming message across Hold and Infeed changes', async t => {
  const env = installation(t, 1);
  await env.feed.configure('enabled', true);
  async function conversation(id, field, value) {
    const thread = env.add(id, env.clock());
    env.clock();
    await env.feed.configure(field, value);
    const arrived = env.clock();
    thread.latestMessageTimestamp = thread.latestMessageReceivedTimestamp = new Date(arrived).toISOString();
    env.messages.set(id, [
      { type: 'MESSAGE', direction: 'INCOMING', createdAt: new Date(env.clock()).toISOString() },
      { type: 'MESSAGE', direction: 'OUTGOING', createdAt: thread.createdAt },
      { type: 'COMMENT', direction: 'INCOMING', createdAt: thread.createdAt },
      { type: 'MESSAGE', direction: 'INCOMING', createdAt: new Date(arrived).toISOString() },
    ]);
    if (!value && field === 'enabled') { env.clock(); await env.feed.configure('enabled', true); }
    await env.feed.poll();
    return arrived;
  }
  const a = await conversation('31', 'hold', false);
  const b = await conversation('32', 'hold', true);
  await conversation('33', 'enabled', false);
  assert.deepEqual(env.feed.snapshot().tickets.map(({ id, state, arrived }) => [id, state, arrived]), [
    ['32', 'held', b], ['31', 'automatic', a],
  ]);
});

test('an expired continuation replays the same window without duplicating decisions', async t => {
  const env = installation(t, 1);
  await env.feed.configure('enabled', true);
  const stamp = env.clock();
  for (let i = 1; i <= 8; i++) env.add(String(i), stamp);
  await env.feed.poll();
  env.failAt('cursor:' + env.scans.length, 400);
  await env.feed.poll();
  assert.ok(env.feed.snapshot().problem);
  assert.equal(env.feed.snapshot().checked, null);
  env.restart();
  await env.feed.poll();
  await env.feed.poll();
  assert.equal(env.feed.snapshot().problem, '');
  assert.equal(env.feed.snapshot().checked, stamp);
  assert.equal(env.feed.snapshot().tickets.length, 8);
});

test('resume discovers a ticket from before Off and excludes a ticket that arrived during Off', async t => {
  const env = installation(t);
  await env.feed.configure('enabled', true);
  await env.feed.configure('hold', false);
  env.add('41', env.clock());
  env.clock();
  await env.feed.configure('enabled', false);
  env.add('42', env.clock());
  env.clock(30 * 60_000);
  env.restart();
  await env.feed.poll();
  assert.equal(env.scans.length, 0);
  await env.feed.configure('enabled', true);
  env.add('43', env.clock());
  await env.feed.poll();
  assert.deepEqual(env.feed.snapshot().tickets.map(({ id, note }) => [id, note]), [
    ['43', 'queued'], ['41', 'queued'],
  ]);
});
