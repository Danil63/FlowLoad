import test from 'node:test';
import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import { spawn } from 'node:child_process';
import { createServer } from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

test('HTTP deletion blocks route/profile execution and survives server restart', { timeout: 20000 }, async t => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'k6-catalog-http-'));
  const ui = path.join(root, 'ui');
  const here = path.dirname(fileURLToPath(import.meta.url));
  await fs.mkdir(ui);
  for (const name of ['server.mjs', 'swagger-catalog.mjs', 'swagger-url.mjs', 'workspaces.mjs']) {
    await fs.copyFile(path.join(here, name), path.join(ui, name));
  }
  await fs.symlink(path.join(here, 'node_modules'), path.join(ui, 'node_modules'));
  const listener = createServer();
  await new Promise(resolve => listener.listen(0, '127.0.0.1', resolve));
  const port = listener.address().port;
  await new Promise(resolve => listener.close(resolve));
  let child;
  const stop = async () => {
    if (child && child.exitCode === null && child.signalCode === null) {
      const exited = new Promise(resolve => child.once('exit', resolve));
      child.kill('SIGTERM');
      await exited;
    }
  };
  t.after(async () => { await stop(); await fs.rm(root, { recursive: true, force: true }); });
  const start = async () => {
    child = spawn(process.execPath, [path.join(ui, 'server.mjs')], { env: { ...process.env, PORT: String(port) }, stdio: 'ignore' });
    for (let i = 0; i < 100; i++) {
      try { if ((await fetch(`http://127.0.0.1:${port}/api/swagger/catalog`)).ok) return; } catch {}
      await new Promise(resolve => setTimeout(resolve, 30));
    }
    throw new Error('Test server did not start');
  };
  const request = async (url, method = 'GET', body, workspace = 'default') => {
    const res = await fetch(`http://127.0.0.1:${port}${url}`, { method,
      headers: { 'Content-Type': 'application/json', 'X-Workspace-Id': workspace }, body: body ? JSON.stringify(body) : undefined });
    return { status: res.status, data: await res.json() };
  };
  await start();
  assert.equal((await request('/api/status')).data.tokenCount, 0);
  assert.equal((await request('/api/token', 'POST', { content: 'test-only-one\ntest-only-two' })).status, 200);
  assert.equal((await request('/api/status')).data.tokenCount, 2);
  const deletedTokens = await request('/api/token', 'DELETE');
  assert.equal(deletedTokens.status, 200);
  assert.equal(deletedTokens.data.tokenReady, false);
  assert.equal((await request('/api/status')).data.tokenCount, 0);
  assert.equal(await fs.readFile(path.join(root, 'load-testing/k6/tokens.txt'), 'utf8'), '');
  assert.equal((await request('/api/token', 'DELETE')).status, 200);
  assert.equal((await request('/api/token', 'POST', { token: 'test-only-new' })).status, 200);
  assert.equal((await request('/api/status')).data.tokenCount, 1);
  await request('/api/token', 'DELETE');
  const parsed = await request('/api/swagger', 'POST', { name: 'test.json', content: JSON.stringify({ openapi: '3.0.0', paths: { '/example': { get: {} } } }) });
  assert.equal(parsed.status, 200);
  const catalog = await request('/api/swagger/catalog', 'POST', { name: 'test.json', endpoints: parsed.data.endpoints });
  const source = catalog.data.sources[0];
  const steps = source.endpoints;
  const route = await request('/api/routes', 'POST', { name: 'test', steps });
  const profile = await request('/api/load-profiles', 'POST', { name: 'test', targets: steps.map(s => ({ ...s, weight: 1 })) });
  assert.equal(route.status, 200);
  assert.equal(profile.status, 200);
  await request('/api/swagger/catalog', 'DELETE', { sourceId: source.id, methodId: steps[0].catalogMethodId });
  assert.equal((await request('/api/routes')).data.routes[0].invalid, true);
  const blocked = await request('/api/run', 'POST', { command: 'route', users: '1', routeFile: route.data.route.fileName });
  assert.equal(blocked.status, 409);
  const profileList = await request('/api/load-profiles');
  const fileName = (profileList.data.loadProfiles || profileList.data.profiles)[0].fileName;
  assert.equal((await request('/api/run', 'POST', { command: 'profile', profileFile: fileName })).status, 409);
  await stop();
  await start();
  assert.equal((await request('/api/routes')).data.routes[0].invalid, true);
  assert.equal((await request('/api/swagger/catalog')).data.sources[0].endpoints.length, 0);
  assert.equal((await request('/api/local-files')).status, 404);

  const a = (await request('/api/workspaces', 'POST', { name: 'Project A', baseUrl: 'https://a.example.com' })).data.workspace.id;
  const b = (await request('/api/workspaces', 'POST', { name: 'Project B', baseUrl: 'https://b.example.com' })).data.workspace.id;
  assert.equal((await request('/api/status', 'GET', undefined, a)).data.routes.length, 0);
  await Promise.all([request('/api/token', 'POST', { token: 'test-a' }, a), request('/api/token', 'POST', { content: 'test-b1\ntest-b2' }, b)]);
  assert.equal((await request('/api/status', 'GET', undefined, a)).data.tokenCount, 1);
  assert.equal((await request('/api/status', 'GET', undefined, b)).data.tokenCount, 2);
  await request('/api/token', 'DELETE', undefined, a);
  assert.equal((await request('/api/status', 'GET', undefined, b)).data.tokenCount, 2);
  const specA = (await request('/api/swagger/catalog', 'POST', { name: 'api', endpoints: [{ method: 'GET', path: '/a' }] }, a)).data.sources[0];
  const specB = (await request('/api/swagger/catalog', 'POST', { name: 'api', endpoints: [{ method: 'GET', path: '/b' }] }, b)).data.sources[0];
  await Promise.all([request('/api/routes', 'POST', { name: 'same', steps: specA.endpoints }, a), request('/api/routes', 'POST', { name: 'same', steps: specB.endpoints }, b)]);
  assert.equal((await request('/api/routes/same.route.json', 'GET', undefined, a)).data.route.steps[0].path, '/a');
  assert.equal((await request('/api/routes/same.route.json', 'GET', undefined, b)).data.route.steps[0].path, '/b');
  const profileA = await request('/api/load-profiles', 'POST', { name: 'only-a', targets: specA.endpoints.map(step => ({ ...step, weight: 23 })) }, a);
  assert.equal(profileA.status, 200);
  assert.equal((await request('/api/status', 'GET', undefined, a)).data.loadProfiles.length, 1);
  assert.equal((await request('/api/status', 'GET', undefined, b)).data.loadProfiles.length, 0);
  assert.equal((await request('/api/swagger/catalog', 'GET', undefined, b)).data.sources[0].endpoints[0].path, '/b');
  await request('/api/swagger/catalog', 'DELETE', { sourceId: specA.id }, a);
  assert.equal((await request('/api/routes', 'GET', undefined, a)).data.routes[0].invalid, true);
  assert.equal((await request('/api/routes', 'GET', undefined, b)).data.routes[0].invalid, false);
  assert.equal((await request('/api/status', 'GET', undefined, '../../bad')).status, 404);
  await fs.writeFile(path.join(root, 'Makefile'), 'route:\n\t@printf "%s\\n" "$(BASE_URL)" "$(TOKENS_FILE)" "$(K6_RESULTS)" "token=$(SESSION_TOKEN_FOR_K6)"\n%:\n\t@:\n');
  const started = await request('/api/run', 'POST', { command: 'route', users: '1', routeFile: 'same.route.json' }, b);
  assert.equal(started.status, 202);
  const id = started.data.run.id;
  let finished;
  for (let i = 0; i < 100; i++) {
    finished = (await request(`/api/run/${id}`, 'GET', undefined, b)).data.run;
    if (finished?.status !== 'running') break;
    await new Promise(resolve => setTimeout(resolve, 20));
  }
  assert.equal(finished?.status, 'passed');
  assert.match(finished.output, /https:\/\/b.example.com/);
  assert.ok(finished.output.includes(path.join(root, 'ui/.local/workspaces', b, 'tokens.txt')));
  assert.equal((await request(`/api/run/${id}`, 'GET', undefined, a)).data.run, null);
  const reportDir = path.join(root, 'ui/.local/workspaces', b, 'results');
  await fs.mkdir(reportDir, { recursive: true });
  await fs.writeFile(path.join(reportDir, 'test.html'), '<h1>Project B</h1>');
  assert.equal((await request('/reports/test.html', 'GET', undefined, a)).status, 404);
  const report = await fetch(`http://127.0.0.1:${port}/reports/test.html?workspace=${b}`);
  assert.equal(await report.text(), '<h1>Project B</h1>');
  await stop();
  await start();
  assert.equal((await request('/api/workspaces')).data.workspaces.length, 3);
  assert.equal((await request('/api/status', 'GET', undefined, b)).data.tokenCount, 2);
});
