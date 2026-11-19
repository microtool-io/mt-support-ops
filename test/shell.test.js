import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { createServer, get } from 'node:http';
import { randomUUID } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createApp } from '../src/server.js';
import { Workspace } from '../src/store.js';
import { settings } from '../src/config.js';

async function listen(t, server) {
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(() => new Promise(resolve => { server.close(resolve); server.closeAllConnections(); }));
  return 'http://127.0.0.1:' + server.address().port;
}
async function setup(t, override = {}) {
  const store = new Workspace(':memory:');
  t.after(() => store.close());
  const cfg = {...settings({}), ...override};
  const origin = await listen(t, createApp(cfg, store));
  const call = async (path, data, headers) => {
    const res = await fetch(origin + '/api/' + path, data === undefined ? {} : {
      method:'POST', headers:{Origin:origin, 'Content-Type':'application/json', ...headers}, body:JSON.stringify(data)
    });
    return {status:res.status, body:await res.json()};
  };
  return {store, origin, call, cfg};
}
const department = (name, remit = 'Track support handoffs') => ({id:randomUUID(), name, remit, manager:''});

test('configuration binds keys to explicit endpoints and requires TLS off loopback', () => {
  for (const env of [{MT_LLM_API_KEY:'test'}, {MT_DATA_DIR:'relative'}, {MT_LLM_BASE_URL:'http://model.example/v1'},
    {MT_LLM_BASE_URL:'https://user:key@approved.example/v1'}, {MT_LLM_BASE_URL:'https://model.example/v1?secret=value'}]) {
    assert.throws(() => settings(env));
  }
  assert.equal(settings({MT_LLM_BASE_URL:'https://approved.example/v1/', MT_LLM_API_KEY:'example'}).base, 'https://approved.example/v1');
});
test('workspace opens empty, serves its shell locally and protects model secrets and writes', async t => {
  const {origin,call} = await setup(t, {key:'test-server-only-secret'});
  const page = await fetch(origin);
  assert.equal(page.status, 200);
  assert.match(page.headers.get('content-security-policy'), /connect-src 'self'/);
  const home = (await call('workspace')).body;
  assert.deepEqual(home.departments, []);
  assert.equal(home.connection.model, null);
  assert.equal(home.connection.credentialConfigured, true);
  assert.ok(!JSON.stringify(home).includes('test-server-only-secret'));
  assert.equal((await call('departments', department('Ops'), {Origin:'https://other.test'})).status, 403);
  assert.equal((await call('departments', department('Ops'), {'Content-Type':'text/plain'})).status, 415);
  const hostCheck = await new Promise((resolve, reject) => {
    get(origin + '/api/workspace', {headers:{Host:'elsewhere.test'}}, res => {
      res.resume(); resolve(res.statusCode);
    }).on('error', reject);
  });
  assert.equal(hostCheck, 403);
  assert.equal((await fetch(origin + '/.env.local')).status, 404);
  assert.equal((await fetch(origin + '/api/workspace')).headers.get('access-control-allow-origin'), null);
});
test('department creation and update retries preserve one copy; conflicts and invalid input are reported', async t => {
  const {call} = await setup(t);
  const a = department('Support operations');
  const b = department('Product');
  assert.equal((await call('departments', a)).body.manager, 'Support operations manager');
  assert.equal((await call('departments', a)).body.id, a.id);
  assert.equal((await call('departments', {...a, name:'Other'})).status, 409);
  assert.equal((await call('departments', department('support operations'))).status, 409);
  assert.equal((await call('departments', {...a,id:randomUUID(),remit:''})).status, 400);
  await call('departments', b);
  const note = {id:randomUUID(), body:'Handoff recorded'};
  for (let i=0;i<2;i++) assert.equal((await call('departments/' + a.id + '/updates', note)).status, 201);
  assert.equal((await call('departments/' + b.id + '/updates', note)).status, 409);
  assert.equal((await call('departments/' + a.id)).body.updates.length, 1);
  assert.equal((await call('departments/' + b.id)).body.updates.length, 0);
  assert.equal((await call('departments/' + a.id + '/ask', {id:randomUUID(), question:'Status?'})).status, 409);
});
test('manager requests use only selected department context; failures, retries and disconnection preserve history', async t => {
  const requests = [];
  let mode = 'ok';
  const provider = await listen(t, createServer(async (req,res) => {
    assert.equal(req.headers.authorization, 'Bearer synthetic-test-key');
    res.setHeader('Content-Type','application/json');
    if (req.url === '/v1/models') return res.end(JSON.stringify({data:[{id:'model-a'}]}));
    assert.equal(req.url,'/v1/chat/completions');
    const chunks=[]; for await (const chunk of req) chunks.push(chunk);
    requests.push(JSON.parse(Buffer.concat(chunks)));
    if (mode === 'error') { res.writeHead(401); return res.end('private vendor diagnostic'); }
    res.end(JSON.stringify({choices:[{message:{content:'Department reply'}}]}));
  }));
  const {call, store} = await setup(t,{base:provider+'/v1',key:'synthetic-test-key'});
  assert.deepEqual((await call('connection/models', {})).body.models, ['model-a']);
  assert.equal((await call('connection/connect',{endpoint:'https://other.test',model:'model-a'})).status, 409);
  assert.equal((await call('connection/connect',{endpoint:provider+'/v1',model:'model-a'})).status, 200);
  const a=department('Product support'), b=department('Accounts', 'OTHER-REMIT');
  await call('departments',a); await call('departments',b);
  await call('departments/'+b.id+'/updates',{id:randomUUID(),body:'OTHER-PRIVATE-NOTE'});
  store.recordExchange(b.id,randomUUID(),'OTHER-QUESTION','OTHER-ANSWER','model-a');
  const path='departments/'+a.id;
  await call(path+'/updates',{id:randomUUID(),body:'Product import fix is ready'});
  const question={id:randomUUID(),question:'What changed today?'};
  assert.equal((await call(path+'/ask',question)).status,201);
  assert.equal((await call(path+'/ask',question)).status,200);
  assert.equal(requests.length,1);
  assert.match(JSON.stringify(requests[0]),/Product import fix is ready/);
  assert.doesNotMatch(JSON.stringify(requests[0]),/OTHER-|synthetic-test-key/);
  await call(path+'/ask',{id:randomUUID(),question:'Follow up'});
  assert.ok(requests[1].messages.some(m=>m.role==='assistant' && m.content==='Department reply'));
  mode='error';
  const failed=await call(path+'/ask',{id:randomUUID(),question:'New question'});
  assert.equal(failed.status,502);
  assert.doesNotMatch(JSON.stringify(failed.body),/private vendor diagnostic|synthetic-test-key/);
  assert.equal((await call(path)).body.exchanges.length,2);
  assert.equal((await call('connection/disconnect',{})).body.model,null);
  assert.equal((await call(path+'/ask',{id:randomUUID(),question:'Status?'})).status,409);
});
test('a saved workspace reopens with its records; changing endpoint clears the effective connection', t => {
  const dir=mkdtempSync(join(tmpdir(),'mt-shell-'));
  t.after(()=>rmSync(dir,{recursive:true,force:true}));
  const file=join(dir,'workspace.sqlite');
  const first=new Workspace(file), dept=department('Finance');
  first.create({...dept,manager:'Billing manager'});
  first.addUpdate(dept.id,randomUUID(),'A synthetic note');
  first.recordExchange(dept.id,randomUUID(),'Status?','A synthetic answer','local-test');
  first.connect('https://approved.test/v1','local-test');
  first.close();
  const next=new Workspace(file);
  try {
    assert.equal(next.department(dept.id).manager,'Billing manager');
    assert.equal(next.updates(dept.id,10)[0].body,'A synthetic note');
    assert.equal(next.exchanges(dept.id,10)[0].answer,'A synthetic answer');
    assert.equal(next.connection('https://approved.test/v1'),'local-test');
    assert.equal(next.connection('https://different.test/v1'),null);
  } finally { next.close(); }
});
