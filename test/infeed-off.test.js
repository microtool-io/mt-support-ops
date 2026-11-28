import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import test from 'node:test';
import { createInfeed } from '../src/infeed.js';

test('Off blocks every intake request, aborts a pending thread read and discards its late result after re-enable', async t => {
  const db = new DatabaseSync(':memory:');
  t.after(() => db.close());
  let time = Date.UTC(2026, 0, 1);
  let resume, entered;
  const started = new Promise(resolve => { entered = resolve; });
  const urls = [];
  const thread = { id: '7', inboxId: '1', latestMessageReceivedTimestamp: new Date(time).toISOString(),
    threadAssociations: { associatedTicketId: '8' } };
  let requestSignal;
  let discover = true;
  const feed = createInfeed(db, 'synthetic', async (url, options) => {
    urls.push(new URL(url));
    if (url.pathname.endsWith('/inboxes')) return Response.json({ results: [{ id: '1', type: 'HELP_DESK' }] });
    if (url.pathname.endsWith('/threads/7')) {
      if (!discover) return new Response(null, { status: 404 });
      requestSignal = options.signal;
      entered();
      // Model a transport that delivers a response even after cancellation.
      await new Promise(resolve => { resume = resolve; });
      return Response.json(thread);
    }
    if (url.pathname.endsWith('/messages')) return Response.json({ results: [] });
    return Response.json({ results: discover ? [thread] : [] });
  }, () => time);
  await feed.poll();
  assert.equal(urls.length, 0);
  feed.configure('enabled', true);
  const oldPoll = feed.poll();
  await started;
  const count = urls.length;
  feed.configure('enabled', false);
  for (let tick = 0; tick < 3; tick++) {
    time += 30_000;
    await feed.poll();
  }
  assert.equal(urls.length, count);
  assert.equal(requestSignal.aborted, true);
  discover = false;
  feed.configure('enabled', true);
  resume();
  await oldPoll;
  assert.equal(urls.length, count);
  assert.deepEqual(feed.snapshot().tickets, []);
  assert.equal(feed.snapshot().checked, null);
  await feed.poll();
  const scan = urls.findLast(url => url.searchParams.has('latestMessageTimestampAfter'));
  assert.equal(Date.parse(scan.searchParams.get('latestMessageTimestampAfter')), time - 1);
});

test('Off prevents even an explicit message refresh on a previously accepted ticket', async t => {
  const db = new DatabaseSync(':memory:');
  t.after(() => db.close());
  let calls = 0;
  const feed = createInfeed(db, 'synthetic', async () => {
    calls++;
    return Response.json({ results: [] });
  });
  db.prepare('INSERT INTO responder_tickets VALUES (?, ?, ?, ?)').run('8', '7', 1, 'held');
  assert.deepEqual(await feed.detail('8'), { paused: true });
  assert.equal(calls, 0);
});
