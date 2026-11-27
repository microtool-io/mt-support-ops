import assert from 'node:assert/strict';
import test from 'node:test';
import { checkHubSpot, serveHubSpotCheck } from '../src/hubspot.js';

test('missing configuration makes no upstream request', async () => {
  let requested = false;
  const result = await checkHubSpot(' ', () => { requested = true; });
  assert.equal(result, 'not_configured');
  assert.equal(requested, false);
});

test('finds Help Desk across pages and sends the key only to HubSpot', async () => {
  const requests = [];
  const result = await checkHubSpot('mock-key', (url, options) => {
    requests.push(url.href);
    assert.equal(url.origin, 'https://api.hubapi.com');
    assert.equal(url.pathname, '/conversations/v3/conversations/inboxes');
    assert.equal(options.headers.Authorization, 'Bearer mock-key');
    assert.equal(options.redirect, 'error');
    if (url.searchParams.has('after')) {
      return Response.json({ results: [{ type: 'HELP_DESK', name: 'Sample Help Desk' }] });
    }
    return Response.json({ results: [], paging: { next: { after: 'next page' } } });
  });
  assert.equal(result, 'connected');
  assert.equal(requests.length, 2);
  assert.equal(new URL(requests[1]).searchParams.get('after'), 'next page');
});

test('distinguishes access failures and absent Help Desk', async () => {
  for (const [httpStatus, expected] of [
    [401, 'invalid_key'], [403, 'access_denied'], [429, 'rate_limited'], [503, 'unavailable'],
  ]) {
    assert.equal(await checkHubSpot('mock-key', () => new Response(null, { status: httpStatus })), expected);
  }
  assert.equal(await checkHubSpot('mock-key', () => Response.json({ results: [] })), 'no_help_desk');
  assert.equal(await checkHubSpot('mock-key', () => Response.json({})), 'unavailable');
  assert.equal(await checkHubSpot('mock-key', () => Promise.reject(new Error('offline'))), 'unavailable');
});

test('the route requires a local same-origin POST and returns only status', async () => {
  const host = '127.0.0.1:4318';
  const origin = 'http://' + host;
  for (const [request, expected] of [
    [{ method: 'POST', headers: { host, origin } }, 200],
    [{ method: 'GET', headers: { host, origin } }, 405],
    [{ method: 'POST', headers: { host, origin: 'https://elsewhere.example' } }, 403],
    [{ method: 'POST', headers: { host: 'elsewhere.example', origin } }, 403],
    [{ method: 'POST', headers: { host } }, 403],
  ]) {
    let body;
    const response = {
      writeHead(status, headers) {
        assert.equal(status, expected);
        assert.equal(headers['Cache-Control'], 'no-store');
        return this;
      },
      end(value) { body = value; },
    };
    await serveHubSpotCheck(request, response, 4318);
    assert.equal(body, expected === 200 ? '{"status":"not_configured"}' : undefined);
  }
});
