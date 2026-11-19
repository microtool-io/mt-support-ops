import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { settings } from './config.js';
import { Workspace } from './store.js';
import { createApp } from './server.js';

process.umask(0o077);
const config = settings();
mkdirSync(config.dataDir, {recursive: true, mode: 0o700});
const store = new Workspace(join(config.dataDir, 'workspace.sqlite'));
const app = createApp(config, store);
app.on('error', error => {
  console.error(error.code === 'EADDRINUSE' ? 'Port is in use. Set PORT to another local port.' : 'Unable to start the local workspace: ' + error.code);
  store.close();
  process.exitCode = 1;
});
app.listen(config.port, '127.0.0.1', () => console.log('Support Ops is ready at http://127.0.0.1:' + config.port));
for (const signal of ['SIGTERM', 'SIGINT']) process.once(signal, () => app.close(() => store.close()));
