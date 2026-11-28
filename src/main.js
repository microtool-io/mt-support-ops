import { readFileSync } from 'node:fs';
import { createServer } from 'node:http';

import { openAreaStore, serveAreas } from './areas.js';
import { createInfeed, serveInfeed } from './infeed.js';
import { serveHubSpotCheck } from './hubspot.js';

process.umask(0o077);
const store = openAreaStore();
const files = new Map([
  ['/', ['text/html; charset=utf-8', readFileSync(new URL('../public/index.html', import.meta.url))]],
  ['/style.css', ['text/css; charset=utf-8', readFileSync(new URL('../public/style.css', import.meta.url))]],
  ['/sidebar.js', ['text/javascript; charset=utf-8', readFileSync(new URL('../public/sidebar.js', import.meta.url))]]
]);

const port = Number(process.env.PORT || 4318);
const hubSpotServiceKey = process.env.HUBSPOT_SERVICE_KEY;
const infeed = createInfeed(store.db, hubSpotServiceKey);
const server = createServer((request, response) => {
  const path = request.url.split('?')[0];
  if (path === '/api/infeed' || path.startsWith('/api/infeed/')) {
    return serveInfeed(request, response, server.address().port, infeed, path);
  }
  if (path === '/api/areas') {
    return serveAreas(request, response, store, server.address().port);
  }
  if (path === '/api/connections/hubspot/check') {
    return serveHubSpotCheck(request, response, server.address().port, hubSpotServiceKey);
  }
  if (request.method !== 'GET' && request.method !== 'HEAD') {
    response.writeHead(405, { Allow: 'GET, HEAD' }).end();
    return;
  }

  const file = files.get(path);
  if (!file) {
    response.writeHead(404).end();
    return;
  }

  const [type, content] = file;
  response.writeHead(200, { 'Content-Type': type, 'Cache-Control': 'no-store' });
  response.end(request.method === 'HEAD' ? undefined : content);
});
server.listen(port, '127.0.0.1', () => {
  console.log('http://127.0.0.1:' + server.address().port);
  void infeed.poll();
  setInterval(() => void infeed.poll(), 30000).unref();
});
