import { mkdirSync, realpathSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import { isAbsolute, join, relative, sep } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { fileURLToPath } from 'node:url';

export function openAreaStore() {
  const directory = process.env.MT_DATA_DIR ?? join(homedir(), '.local', 'share', 'mt-support-ops');
  if (!isAbsolute(directory)) throw new Error('MT_DATA_DIR must be an absolute path');
  mkdirSync(directory, { recursive: true, mode: 0o700 });
  const root = realpathSync(fileURLToPath(new URL('../', import.meta.url)));
  const location = relative(root, realpathSync(directory));
  if (!(location === '..' || location.startsWith('..' + sep) || isAbsolute(location))) {
    throw new Error('Choose a private data directory outside the checkout');
  }
  if (process.platform !== 'win32' && (statSync(directory).mode & 0o077)) {
    throw new Error('The data directory must be private to the service account (mode 0700)');
  }
  const db = new DatabaseSync(join(directory, 'areas.sqlite'));
  db.exec('CREATE TABLE IF NOT EXISTS areas (id TEXT PRIMARY KEY NOT NULL, name TEXT NOT NULL) STRICT');
  const list = db.prepare('SELECT id, name FROM areas ORDER BY rowid');
  const insert = db.prepare('INSERT INTO areas (id, name) VALUES (?, ?) ON CONFLICT(id) DO NOTHING');
  const lookup = db.prepare('SELECT id, name FROM areas WHERE id = ?');
  return { db, list, insert, lookup };
}

export async function serveAreas(request, response, store, port) {
  function send(status, data) {
    response.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
    response.end(JSON.stringify(data));
  }
  const { host, origin } = request.headers;
  const localHost = host === `127.0.0.1:${port}` || host === `localhost:${port}`;
  if (!localHost || (origin !== undefined && origin !== 'http://' + host)
      || request.headers['sec-fetch-site'] === 'cross-site') {
    return send(403, { error: 'Origin denied' });
  }
  try {
    if (request.method === 'GET') return send(200, store.list.all());
    if (request.method !== 'POST') {
      response.setHeader('Allow', 'GET, POST');
      return send(405, { error: 'Unsupported method' });
    }
    if (request.headers['content-type']?.split(';')[0].trim() !== 'application/json') {
      return send(415, { error: 'Expected JSON' });
    }
    const chunks = [];
    let size = 0;
    for await (const chunk of request) {
      size += chunk.length;
      if (size > 4096) return send(413, { error: 'Request too large' });
      chunks.push(chunk);
    }
    let data;
    try {
      data = JSON.parse(Buffer.concat(chunks).toString());
    } catch {
      return send(400, { error: 'Invalid JSON' });
    }
    const id = data?.id;
    const name = typeof data?.name === 'string' ? data.name.trim() : '';
    if (typeof id !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(id)
        || !name || name.length > 100) {
      return send(400, { error: 'Invalid area ID or name' });
    }
    const { changes } = store.insert.run(id, name);
    const area = store.lookup.get(id);
    if (area.name !== name) return send(409, { error: 'This creation was already saved with a different name' });
    send(changes ? 201 : 200, area);
  } catch (error) {
    console.error('Business area request failed:', error.code ?? 'storage unavailable');
    send(503, { error: 'Business area storage is unavailable' });
  }
}
