import test from 'node:test';
import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import { spawn } from 'node:child_process';
import { createServer } from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { maintainStorage } from './storage-cli.mjs';

test('HTTP deletion, damaged files, project lock and restart stay consistent', { timeout: 30000 }, async t => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'k6-catalog-http-'));
  const ui = path.join(root, 'ui');
  const here = path.dirname(fileURLToPath(import.meta.url));
  await fs.mkdir(ui);
  await fs.mkdir(path.join(ui, 'public'));
  await fs.copyFile(path.join(here, 'public/catalog-state.js'), path.join(ui, 'public/catalog-state.js'));
  await fs.writeFile(path.join(ui, 'public/index.html'), '<h1>FlowLoad test UI</h1>');
  await fs.writeFile(path.join(ui, 'package.json'), '{"type":"module"}');
  for (const name of ['server.mjs', 'swagger-catalog.mjs', 'swagger-url.mjs', 'workspaces.mjs', 'atomic-file.mjs', 'server-lock.mjs', 'saved-documents.mjs', 'run-history.mjs', 'document-revisions.mjs', 'recoverable-json.mjs']) {
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
    child = spawn(process.execPath, [path.join(ui, 'server.mjs')], { env: { ...process.env, PORT: String(port), OPEN_UI: 'false' }, stdio: 'ignore' });
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
  const assertSecondServerBlocked = async () => {
    const other = spawn(process.execPath, [path.join(ui, 'server.mjs')], {
      env: { ...process.env, PORT: '0', OPEN_UI: 'false' }, stdio: ['ignore', 'pipe', 'pipe'],
    });
    t.after(() => { if (other.exitCode === null && other.signalCode === null) other.kill('SIGKILL'); });
    let output = '';
    other.stdout.on('data', chunk => { output += chunk; });
    other.stderr.on('data', chunk => { output += chunk; });
    const code = await new Promise(resolve => other.once('close', resolve));
    assert.equal(code, 1);
    assert.match(output, /FlowLoad уже запущен/);
  };
  await assertSecondServerBlocked();
  assert.equal((await fetch(`http://127.0.0.1:${port}/api/status`)).headers.get('cache-control'), 'no-store');
  assert.equal((await fetch(`http://127.0.0.1:${port}/catalog-state.js`)).headers.get('cache-control'), 'no-store');
  assert.equal((await request('/api/status')).data.tokenCount, 0);
  assert.equal((await request('/api/token', 'POST', { content: 'test-only-one\ntest-only-two' })).status, 200);
  assert.equal((await request('/api/status')).data.tokenCount, 2);
  const appended = await request('/api/token', 'POST', { token: 'test-only-three' });
  assert.equal(appended.status, 200);
  assert.equal(appended.data.tokenCount, 3);
  assert.equal((await request('/api/status')).data.tokenCount, 3);
  const tokenPath = path.join(root, 'load-testing/k6/tokens.txt');
  assert.deepEqual((await fs.readFile(tokenPath, 'utf8')).split('\n').filter(line => line && !line.startsWith('#')),
    ['test-only-one', 'test-only-two', 'test-only-three']);
  assert.equal((await request('/api/token', 'POST', { token: 'test-only-three' })).data.tokenCount, 3);
  await Promise.all(['test-four', 'test-five'].map(token => request('/api/token', 'POST', { token })));
  assert.equal((await request('/api/status')).data.tokenCount, 5);
  assert.equal((await request('/api/token', 'POST', { token: 'bad token' })).status, 400);
  assert.equal((await request('/api/status')).data.tokenCount, 5);
  assert.equal((await request('/api/token', 'POST', { content: 'replacement-only' })).data.tokenCount, 1);
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
  await fs.writeFile(path.join(root, 'Makefile'), 'route:\n\t@sleep 1\n\t@printf "%s\\n" "$(BASE_URL)" "$(TOKENS_FILE)" "$(K6_RESULTS)" "token=$(SESSION_TOKEN_FOR_K6)"\n%:\n\t@:\n');
  const started = await request('/api/run', 'POST', { command: 'route', users: '1', routeFile: 'same.route.json' }, b);
  assert.equal(started.status, 202);
  assert.equal((await request('/api/swagger/catalog', 'DELETE', { sourceId: specB.id }, b)).status, 409);
  assert.equal((await request('/api/routes/same.route.json', 'DELETE', undefined, b)).status, 409);
  assert.equal((await request('/api/routes', 'POST', { name: 'same', steps: specB.endpoints }, b)).status, 409);
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

  const bDir = path.join(ui, '.local/workspaces', b);
  for (const kind of ['route', 'profile']) {
    const isRoute = kind === 'route';
    const api = isRoute ? '/api/routes' : '/api/load-profiles';
    const name = `revision-${kind}`;
    const items = specB.endpoints.map(step => ({ ...step, weight: 10 }));
    const payload = { name, [isRoute ? 'steps' : 'targets']: items };
    const created = await request(api, 'POST', payload, b);
    assert.equal(created.status, 200);
    const initial = created.data[kind];
    const url = `${api}/${initial.fileName}`;
    const tabA = (await request(url, 'GET', undefined, b)).data;
    const tabB = (await request(url, 'GET', undefined, b)).data;
    assert.equal(tabA.revision, initial.revision);
    assert.equal(tabA.revision, tabB.revision);
    const save = (summary, baseRevision = initial.revision) => request(api, 'POST', {
      ...payload, baseRevision, [isRoute ? 'steps' : 'targets']: items.map(item => ({ ...item, summary })),
    }, b);
    const results = await Promise.all([save('tab-a'), save('tab-b')]);
    assert.deepEqual(results.map(result => result.status).sort(), [200, 409]);
    assert.equal(results.find(result => result.status === 409).data.code, 'REVISION_CONFLICT');
    const winner = results.find(result => result.status === 200).data[kind];
    const stored = (await request(url, 'GET', undefined, b)).data;
    assert.equal(stored.revision, winner.revision);
    const summary = stored[kind][isRoute ? 'steps' : 'targets'][0].summary;
    assert.equal(summary, results[0].status === 200 ? 'tab-a' : 'tab-b');
    assert.equal((await request(api, 'POST', payload, b)).status, 409);
    assert.equal((await request(url, 'DELETE', { baseRevision: tabB.revision }, b)).status, 409);
    assert.equal((await request(url, 'GET', undefined, b)).data.revision, winner.revision);
    await stop();
    await start();
    assert.equal((await request(url, 'GET', undefined, b)).data.revision, winner.revision);
    const savedAgain = await save('updated', winner.revision);
    assert.equal(savedAgain.status, 200);
    const latest = savedAgain.data[kind].revision;
    const copy = await request(api, 'POST', { ...payload, name: `${name}-copy`, baseRevision: null }, b);
    assert.equal(copy.status, 200);
    assert.equal((await request(url, 'GET', undefined, b)).data.revision, latest);
    assert.equal((await request(url, 'DELETE', { baseRevision: latest }, b)).status, 200);
    assert.equal((await save('must-not-resurrect', latest)).status, 409);
    assert.equal((await request(url, 'GET', undefined, b)).status, 404);
    const copied = copy.data[kind];
    assert.equal((await request(`${api}/${copied.fileName}`, 'DELETE', { baseRevision: copied.revision }, b)).status, 200);
  }

  await fs.writeFile(path.join(bDir, 'routes/broken.route.json'), '{"private-fragment":');
  await fs.writeFile(path.join(bDir, 'routes/empty.route.json'), '{"name":"empty","steps":[]}');
  await fs.mkdir(path.join(bDir, 'load-profiles'), { recursive: true });
  await fs.writeFile(path.join(bDir, 'load-profiles/broken.load.json'), '{"name":"broken","targets":null}');
  const withBroken = await request('/api/status', 'GET', undefined, b);
  assert.equal(withBroken.status, 200);
  assert.equal(withBroken.data.routes.find(row => row.name === 'same').invalid, false);
  assert.equal(withBroken.data.routes.filter(row => row.fileError && row.invalid).length, 2);
  assert.equal(withBroken.data.loadProfiles[0].invalid, true);
  assert.ok(!JSON.stringify(withBroken.data).includes('private-fragment'));
  for (const routeFile of ['broken.route.json', 'empty.route.json']) {
    const response = await request('/api/run', 'POST', { command: 'route', routeFile }, b);
    assert.equal(response.status, 409);
    assert.match(response.data.error, /Файл повреждён/);
  }
  assert.equal((await request('/api/run', 'POST', { command: 'profile', profileFile: 'broken.load.json' }, b)).status, 409);
  assert.equal((await request('/api/status', 'GET', undefined, a)).data.routes.length, 1);
  const brokenRevision = withBroken.data.routes.find(row => row.fileName === 'broken.route.json').revision;
  assert.equal((await request('/api/routes/broken.route.json', 'DELETE', { baseRevision: brokenRevision }, b)).status, 200);
  assert.equal((await request('/api/status', 'GET', undefined, b)).data.routes.length, 2);

  // SIGTERM must not unlock input data while the generator is still reading it.
  await fs.writeFile(path.join(root, 'Makefile'), 'route:\n\t@while [ ! -f allow-exit ]; do sleep 0.05; done\n%:\n\t@:\n');
  const lastRun = await request('/api/run', 'POST', { command: 'route', routeFile: 'same.route.json' }, b);
  assert.equal(lastRun.status, 202);
  const closed = new Promise(resolve => child.once('close', resolve));
  child.kill('SIGTERM');
  let refusing = false;
  for (let i = 0; i < 100; i++) {
    if ((await request('/api/token', 'DELETE', undefined, b)).status === 503) { refusing = true; break; }
    await new Promise(resolve => setTimeout(resolve, 10));
  }
  assert.equal(refusing, true);
  assert.equal(child.exitCode, null);
  await assertSecondServerBlocked();
  await fs.writeFile(path.join(root, 'allow-exit'), 'done');
  assert.equal(await closed, 0);
  await start();
  assert.equal((await request('/api/status', 'GET', undefined, b)).data.tokenCount, 2);

  const maintain = options => maintainStorage(root, options, () => {});
  const catalogB = path.join(bDir, 'swagger-catalog.json');
  await fs.writeFile(catalogB, '{private-fragment');
  for (const url of ['/api/swagger/catalog', '/api/status', '/api/routes']) {
    const result = await request(url, 'GET', undefined, b);
    assert.equal(result.status, 503);
    assert.equal(result.data.code, 'STORAGE_RECOVERY_REQUIRED');
    assert.ok(!result.data.error.includes('private-fragment'));
  }
  assert.equal((await request('/api/run', 'POST', { command: 'route', routeFile: 'same.route.json' }, b)).status, 503);
  assert.equal((await request('/api/swagger/catalog', 'POST', { name: 'must-not-reset', endpoints: steps }, b)).status, 503);
  assert.equal((await request('/api/status', 'GET', undefined, a)).status, 200);
  assert.equal((await fetch(`http://127.0.0.1:${port}/?workspace=${b}`)).status, 200);
  await assert.rejects(maintain({ action: 'recover', target: 'catalog', workspaceId: b, confirm: true }), /уже запущен/);
  await stop();
  await maintain({ action: 'recover', target: 'catalog', workspaceId: b, confirm: true });
  await start();
  assert.equal((await request('/api/status', 'GET', undefined, b)).data.tokenCount, 2);
  assert.equal((await request('/api/swagger/catalog', 'GET', undefined, b)).data.sources[0].id, specB.id);

  const registry = path.join(ui, '.local/workspaces/index.json');
  await fs.writeFile(registry, '[]');
  const unavailable = await request('/api/workspaces');
  assert.equal(unavailable.status, 503);
  assert.equal(unavailable.data.code, 'STORAGE_RECOVERY_REQUIRED');
  assert.equal((await request('/api/workspaces', 'POST', { name: 'must-not-reset', baseUrl: 'https://example.com' })).status, 503);
  const staticPage = await fetch(`http://127.0.0.1:${port}/`);
  assert.equal(staticPage.status, 200);
  assert.match(await staticPage.text(), /FlowLoad test UI/);
  await stop();
  await maintain({ action: 'recover', target: 'workspaces', confirm: true });
  await start();
  assert.equal((await request('/api/workspaces')).data.workspaces.length, 3);
  assert.equal((await request('/api/status', 'GET', undefined, b)).data.tokenCount, 2);
  assert.equal((await request('/api/routes')).data.routes[0].invalid, true);
  assert.equal((await request('/api/run', 'POST', { command: 'route', routeFile: route.data.route.fileName })).status, 409);
});
