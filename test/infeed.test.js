import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import test from 'node:test';
import { createInfeed } from '../src/infeed.js';

function fixture() {
  const db = new DatabaseSync(':memory:');
  const threads = [];
  const calls = [];
  let time = Date.UTC(2026, 0, 1);
  let failure;
  async function read(url, options) {
    assert.equal(url.origin, 'https://api.hubapi.com');
    assert.equal(options.method ?? 'GET', 'GET');
    assert.equal(options.redirect, 'error');
    calls.push(url.pathname);
    if (failure) return new Response(null, { status: failure });
    if (url.pathname === '/account-info/v3/details') return Response.json({ portalId: 1 });
    if (url.pathname.endsWith('/inboxes')) return Response.json({ results: [{ id: '1', type: 'HELP_DESK' }] });
    const single = /\/threads\/(\d+)$/.exec(url.pathname);
    if (single) return Response.json(threads.find(t => t.id === single[1]));
    if (url.pathname.endsWith('/messages')) return Response.json({ results: [
      { type: 'COMMENT', text: 'private comment' },
      { type: 'MESSAGE', direction: 'INCOMING', text: 'Synthetic customer question',
        createdAt: threads.find(t => url.pathname.endsWith('/' + t.id + '/messages')).createdAt },
    ] });
    const id = url.searchParams.get('associatedTicketId');
    if (id) return Response.json({ results: threads.filter(t => t.threadAssociations.associatedTicketId === id).slice(0, 1) });
    if (!url.searchParams.has('after')) return Response.json({ results: threads.slice(0, 1), paging: { next: { after: 'page2' } } });
    return Response.json({ results: threads.slice(1) });
  }
  function add(id, overrides) {
    const stamp = new Date(++time).toISOString();
    threads.push({ id: String(threads.length + 1), createdAt: stamp, inboxId: '1',
      latestMessageReceivedTimestamp: stamp, threadAssociations: { associatedTicketId: id }, ...overrides });
  }
  const open = () => createInfeed(db, 'test', read, () => time);
  return { open, add, calls, tick: (ms = 1) => { time += ms; }, fail: status => { failure = status; } };
}

test('arrival-time settings survive restart, filtering and repeated polls; release is local and idempotent', async () => {
  const f = fixture();
  let feed = f.open();
  assert.equal(feed.snapshot().hold, true);
  f.add('10');
  await feed.poll();
  assert.deepEqual(f.calls, []);
  f.tick();
  await feed.configure('enabled', true);
  f.add('20');
  f.tick();
  await feed.configure('hold', false);
  f.add('30');
  await feed.poll();
  f.tick();
  await feed.configure('enabled', false);
  f.add('40');
  f.tick();
  await feed.configure('enabled', true);
  f.add('10'); // New thread for an older ticket
  f.add('50', { spam: true });
  f.add('51', { archived: true });
  f.add('52', { inboxId: '999' });
  f.add('53', { latestMessageReceivedTimestamp: null });
  f.add('54', { threadAssociations: {} });
  feed = f.open();
  await feed.poll();
  await feed.poll();
  assert.equal(feed.snapshot().problem, '');
  assert.deepEqual(feed.snapshot().tickets.map(({id, state}) => [id, state]), [['30', 'automatic'], ['20', 'held']]);
  assert.deepEqual(await feed.detail('20'), { text: 'Synthetic customer question' });
  assert.equal(await feed.detail('999'), null);
  assert.equal(feed.release('999'), false);
  feed.release('20');
  feed.release('20');
  feed.release('30');
  assert.deepEqual(f.open().snapshot().tickets.map(t => t.state), ['automatic', 'manual']);
});

test('rate limiting preserves the checkpoint and retries without duplicating tickets', async () => {
  const f = fixture();
  const feed = f.open();
  await feed.configure('enabled', true);
  f.add('10');
  f.fail(429);
  await feed.poll();
  assert.match(feed.snapshot().problem, /Rate limited/);
  assert.equal(feed.snapshot().checked, null);
  const count = f.calls.length;
  await feed.poll();
  assert.equal(f.calls.length, count);
  f.tick(61000);
  f.fail(null);
  await feed.poll();
  assert.equal(feed.snapshot().problem, '');
  assert.equal(feed.snapshot().tickets.length, 1);
});

test('switching off while a HubSpot read is in flight prevents insertion', async () => {
  const db = new DatabaseSync(':memory:');
  let resume;
  const response = new Promise(resolve => { resume = resolve; });
  const feed = createInfeed(db, 'test', url => url.pathname === '/account-info/v3/details' ? Response.json({ portalId: 1 }) : response);
  await feed.configure('enabled', true);
  const pending = feed.poll();
  await feed.configure('enabled', false);
  resume(Response.json({ results: [{ id: '1', type: 'HELP_DESK' }] }));
  await pending;
  assert.equal(feed.snapshot().checked, null);
  assert.deepEqual(feed.snapshot().tickets, []);
});


test('turning on Infeed arms both release paths; arrival settings survive replay', async () => {
  const f = fixture();
  const feed = f.open();
  f.add('10');
  f.tick();
  await feed.configure('enabled', true);
  await feed.configure('hold', false);
  f.add('20');
  f.tick();
  await feed.configure('hold', true);
  f.add('30');
  await feed.poll();
  await feed.poll();
  const result = () => f.open().snapshot().tickets.map(({ id, state, note }) => [id, state, note]);
  assert.deepEqual(result(), [
    ['30', 'held', undefined], ['20', 'automatic', 'queued'],
  ]);
  feed.release('30');
  feed.release('30');
  feed.release('20');
  assert.deepEqual(result(), [
    ['30', 'manual', 'queued'], ['20', 'automatic', 'queued'],
  ]);
});
