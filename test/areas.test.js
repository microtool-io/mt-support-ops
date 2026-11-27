import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { cp, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const root = fileURLToPath(new URL('../', import.meta.url));

test('areas survive replacing the application and stay scoped to their installation', { timeout: 30000 }, async t => {
  const temp = await mkdtemp(join(tmpdir(), 'mt-areas-'));
  const servers = [];
  t.after(async () => {
    await Promise.all(servers.map(stop => stop()));
    await rm(temp, { recursive: true, force: true });
  });
  async function checkout(name) {
    const dir = join(temp, name);
    await mkdir(dir);
    for (const path of ['src', 'public', 'package.json']) {
      await cp(join(root, path), join(dir, path), { recursive: true });
    }
    return dir;
  }

  async function start(dir, storage) {
    const child = spawn(process.execPath, ['src/main.js'], {
      cwd: dir, env: { ...process.env, MT_DATA_DIR: storage, PORT: '0' },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    const exited = once(child, 'exit');
    async function stop() {
      if (child.exitCode === null && child.signalCode === null) child.kill();
      await exited;
    }
    servers.push(stop);
    const output = await Promise.race([
      once(child.stdout, 'data').then(([chunk]) => chunk.toString().trim()),
      exited.then(() => { throw new Error('Server exited before startup'); }),
    ]);
    return { url: output + '/api/areas', stop };
  }

  const data = join(temp, 'installation');
  const first = await start(await checkout('original'), data);
  const area = { id: crypto.randomUUID(), name: 'Sample area' };
  function post(body, headers = {}) {
    return fetch(first.url, {
      method: 'POST', headers: { 'Content-Type': 'application/json', ...headers },
      body: JSON.stringify(body),
    });
  }
  assert.equal((await post(area, { Origin: 'https://other.example' })).status, 403);
  assert.equal((await post({ ...area, name: ' ' })).status, 400);
  assert.equal((await post({ ...area, name: 'a'.repeat(101) })).status, 400);
  assert.equal((await post({ ...area, name: 'a'.repeat(5000) })).status, 413);
  assert.deepEqual(await (await fetch(first.url)).json(), []);
  const responses = await Promise.all([post(area), post(area)]);
  assert.deepEqual(responses.map(r => r.status).sort(), [200, 201]);
  for (const response of responses) assert.deepEqual(await response.json(), area);
  assert.equal((await post({ ...area, name: 'Different' })).status, 409);
  assert.deepEqual(await (await fetch(first.url)).json(), [area]);
  await first.stop();

  const replacement = await checkout('replacement');
  const updated = await start(replacement, data);
  assert.deepEqual(await (await fetch(updated.url)).json(), [area]);
  const separate = await start(replacement, join(temp, 'other-installation'));
  assert.deepEqual(await (await fetch(separate.url)).json(), []);

  const unavailable = join(temp, 'regular-file');
  await writeFile(unavailable, '');
  await assert.rejects(start(replacement, unavailable), /exited before startup/);
});
