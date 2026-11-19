import { readFileSync } from 'node:fs';
import { createServer } from 'node:http';

const files = new Map([
  ['/', ['text/html; charset=utf-8', readFileSync(new URL('../public/index.html', import.meta.url))]],
  ['/style.css', ['text/css; charset=utf-8', readFileSync(new URL('../public/style.css', import.meta.url))]]
]);

const port = Number(process.env.PORT || 4318);
createServer((request, response) => {
  if (request.method !== 'GET' && request.method !== 'HEAD') {
    response.writeHead(405, { Allow: 'GET, HEAD' }).end();
    return;
  }

  const file = files.get(request.url.split('?')[0]);
  if (!file) {
    response.writeHead(404).end();
    return;
  }

  const [type, content] = file;
  response.writeHead(200, { 'Content-Type': type, 'Cache-Control': 'no-store' });
  response.end(request.method === 'HEAD' ? undefined : content);
}).listen(port, '127.0.0.1', () => console.log('http://127.0.0.1:' + port));
