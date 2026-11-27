import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { once } from 'node:events';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createInterface } from 'node:readline';

const storage = await mkdtemp(join(tmpdir(), 'mt-startup-'));
const windows = process.platform === 'win32';
const env = { ...process.env, MT_DATA_DIR: storage, PORT: '0' };
delete env.HUBSPOT_SERVICE_KEY;
const server = spawn(windows ? 'cmd.exe' : 'npm', windows ? ['/d', '/c', 'npm start'] : ['start'], {
  env, detached: !windows, stdio: ['ignore', 'pipe', 'inherit'],
});
const closed = once(server, 'close');
const lines = createInterface({ input: server.stdout });
const deadline = setTimeout(() => lines.close(), 20000);

try {
  let origin;
  for await (const line of lines) {
    if (/^http:\/\/127\.0\.0\.1:\d+$/.test(line)) {
      origin = line;
      break;
    }
  }
  assert.ok(origin, 'npm start did not print a loopback address');
  for (const [path, type] of [['/', 'text/html'], ['/style.css', 'text/css'], ['/sidebar.js', 'text/javascript']]) {
    const response = await fetch(origin + path, { signal: AbortSignal.timeout(3000) });
    assert.equal(response.status, 200);
    assert.equal(response.headers.get('content-type').split(';')[0], type);
    assert.ok((await response.text()).length);
  }
  const check = await fetch(origin + '/api/connections/hubspot/check', {
    method: 'POST', headers: { Origin: origin }, signal: AbortSignal.timeout(3000),
  });
  assert.equal(check.status, 200);
  assert.deepEqual(await check.json(), { status: 'not_configured' });
  console.log('npm start served the workspace and reported HubSpot unconfigured.');
} finally {
  clearTimeout(deadline);
  if (server.pid && server.exitCode === null && server.signalCode === null) {
    if (windows) spawnSync('taskkill', ['/pid', String(server.pid), '/t', '/f']);
    else process.kill(-server.pid, 'SIGTERM');
  }
  await closed;
  await rm(storage, { recursive: true, force: true, maxRetries: 3 });
}
