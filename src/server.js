import { createServer } from 'node:http';
import { readFileSync } from 'node:fs';
import { listModels, ask } from './model.js';
import { AppError } from './errors.js';

const files = {
  '/': ['index.html', 'text/html; charset=utf-8'],
  '/app.js': ['app.js', 'text/javascript; charset=utf-8'],
  '/style.css': ['style.css', 'text/css; charset=utf-8'],
  '/mark.svg': ['mark.svg', 'image/svg+xml'],
  '/fonts/instrument-sans.css': ['fonts/instrument-sans.css', 'text/css'],
  '/fonts/instrument-sans-latin.woff2': ['fonts/instrument-sans-latin.woff2', 'font/woff2'],
  '/fonts/instrument-sans-latin-ext.woff2': ['fonts/instrument-sans-latin-ext.woff2', 'font/woff2']
};
const uuid = /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i;
function requestId(value) {
  if (typeof value !== 'string' || !uuid.test(value)) throw new AppError(400, 'Invalid request identifier.');
  return value;
}
function field(value, max, label) {
  if (typeof value !== 'string' || !value.trim() || value.length > max) throw new AppError(400, 'Check the ' + label + ' field.');
  return value.trim();
}
async function bodyOf(req) {
  if (req.headers['content-type']?.split(';')[0].trim() !== 'application/json') throw new AppError(415, 'Expected JSON.');
  let size = 0;
  const chunks = [];
  for await (const buf of req) {
    size += buf.length;
    if (size > 32_768) throw new AppError(413, 'Request is too large.');
    chunks.push(buf);
  }
  try {
    const data = JSON.parse(Buffer.concat(chunks));
    if (data && typeof data === 'object' && !Array.isArray(data)) return data;
  } catch { /* Present one input error for invalid request bodies. */ }
  throw new AppError(400, 'Invalid request.');
}
export function createApp(config, store) {
  const assets = new Map(Object.entries(files).map(([path, [file, type]]) =>
    [path, {type, content: readFileSync(new URL('../public/' + file, import.meta.url))}]));
  const pending = new Set();
  let connectionRevision = 0;
  const connection = () => ({endpoint: config.base, credentialConfigured: Boolean(config.key), model: store.connection(config.base)});
  return createServer({requestTimeout: 20_000, headersTimeout: 10_000}, async (req, res) => {
    const json = (status, data) => {
      res.writeHead(status, {'Content-Type': 'application/json; charset=utf-8'});
      res.end(JSON.stringify(data));
    };
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'no-referrer');
    res.setHeader('Cross-Origin-Resource-Policy', 'same-origin');
    res.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self'; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; object-src 'none'; form-action 'self'");
    try {
      const port = req.socket.localPort;
      const host = req.headers.host;
      if (host !== '127.0.0.1:' + port && host !== 'localhost:' + port) throw new AppError(403, 'Use the local workspace address.');
      const path = req.url.split('?')[0];
      const detail = /^\/api\/departments\/([^/]+)(?:\/(updates|ask))?$/.exec(path);
      if (req.method === 'GET') {
        const asset = assets.get(path);
        if (asset) { res.writeHead(200, {'Content-Type': asset.type}); return res.end(asset.content); }
        if (path === '/api/workspace') return json(200, {departments: store.departments(), connection: connection()});
        if (detail && !detail[2]) {
          const dept = store.department(requestId(detail[1]));
          return json(200, {department: dept, updates: store.updates(dept.id, 50), exchanges: store.exchanges(dept.id, 20)});
        }
        throw new AppError(404, 'Page not found.');
      }
      if (req.method !== 'POST') throw new AppError(405, 'Unsupported method.');
      if (req.headers.origin !== 'http://' + host) throw new AppError(403, 'The request must come from this workspace.');
      const data = await bodyOf(req);
      if (path === '/api/departments') {
        const name = field(data.name, 70, 'department name');
        return json(201, store.create({id: requestId(data.id), name, remit: field(data.remit, 1000, 'support remit'),
          manager: data.manager ? field(data.manager, 90, 'manager name') : name + ' manager'}));
      }
      if (path === '/api/connection/models') return json(200, {models: await listModels(config)});
      if (path === '/api/connection/disconnect') {
        connectionRevision++; store.disconnect(); return json(200, connection());
      }
      if (path === '/api/connection/connect') {
        const model = field(data.model, 200, 'model');
        const revision = ++connectionRevision;
        if (data.endpoint !== config.base || !(await listModels(config)).includes(model)) throw new AppError(409, 'Refresh the model list and select an available model.');
        if (revision !== connectionRevision) throw new AppError(409, 'The connection was changed. Try again.');
        store.connect(config.base, model);
        return json(200, connection());
      }
      if (!detail || !detail[2]) throw new AppError(404, 'Page not found.');
      const dept = store.department(requestId(detail[1]));
      const id = requestId(data.id);
      if (detail[2] === 'updates') return json(201, store.addUpdate(dept.id, id, field(data.body, 3000, 'update')));
      const question = field(data.question, 2000, 'question');
      const previous = store.previousExchange(dept.id, id, question);
      if (previous) return json(200, previous);
      const model = store.connection(config.base);
      if (!model) throw new AppError(409, 'Connect a model before asking the manager.');
      if (pending.has(dept.id) || pending.size >= 3) throw new AppError(429, 'An agent is busy. Please try again shortly.');
      pending.add(dept.id);
      try {
        const answer = await ask(config, model, dept, store.updates(dept.id, 12), store.exchanges(dept.id, 3), question);
        return json(201, store.recordExchange(dept.id, id, question, answer, model));
      } finally { pending.delete(dept.id); }
    } catch (error) {
      if (!(error instanceof AppError)) console.error('Workspace request failed:', error.code || error.name);
      json(error instanceof AppError ? error.status : 500, {error: error instanceof AppError ? error.message : 'The operation could not be completed.'});
    }
  });
}
