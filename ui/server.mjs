import { createServer } from 'node:http';
import { createReadStream, promises as fs } from 'node:fs';
import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import YAML from 'yaml';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, '..');
const publicDir = path.join(__dirname, 'public');
const k6Dir = path.join(rootDir, 'load-testing', 'k6');
const tokensFile = path.join(k6Dir, 'tokens.txt');
const resultsDir = path.join(k6Dir, 'results');
const routesDir = path.join(rootDir, 'load-testing', 'routes', 'local');
const port = Number(process.env.PORT || 8787);

const runs = new Map();
let activeRunId = null;

const allowedRuns = {
  ping: { args: ['ping'], users: false },
  public: { args: ['public'], users: true },
  auth: { args: ['auth'], users: true },
  'auth-status': { args: ['auth-status'], users: false },
  'auth-1': { args: ['auth-1'], users: false },
  'auth-5': { args: ['auth-5'], users: false },
  'auth-50': { args: ['auth-50'], users: false },
  browser: { args: ['browser'], users: false },
};

function json(res, status, data) {
  const body = JSON.stringify(data);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(body),
  });
  res.end(body);
}

function notFound(res) {
  json(res, 404, { error: 'Not found' });
}

function contentType(filePath) {
  if (filePath.endsWith('.html')) return 'text/html; charset=utf-8';
  if (filePath.endsWith('.css')) return 'text/css; charset=utf-8';
  if (filePath.endsWith('.js')) return 'text/javascript; charset=utf-8';
  return 'application/octet-stream';
}

async function readBody(req) {
  const chunks = [];
  for await (const chunk of req) {
    chunks.push(chunk);
  }

  const raw = Buffer.concat(chunks).toString('utf8');
  return raw ? JSON.parse(raw) : {};
}

function parseDocument(content) {
  const text = String(content || '').trim();
  if (!text) {
    throw new Error('Swagger file is empty');
  }

  try {
    return JSON.parse(text);
  } catch (_jsonError) {
    return YAML.parse(text);
  }
}

function methodRisk(method, urlPath) {
  const normalizedMethod = method.toUpperCase();
  const normalizedPath = urlPath.toLowerCase();
  const dangerousWords = /(delete|remove|reset|admin|purchase|checkout|charge|payment|spin|claim|complete|redeem|enter)/;

  if (normalizedMethod === 'DELETE' || dangerousWords.test(normalizedPath)) {
    return 'danger';
  }

  if (['POST', 'PUT', 'PATCH'].includes(normalizedMethod)) {
    return 'write';
  }

  return 'read';
}

function operationAuthRequired(rootSecurity, operation) {
  if (Array.isArray(operation.security)) {
    return operation.security.length > 0;
  }

  return Array.isArray(rootSecurity) && rootSecurity.length > 0;
}

function endpointId(method, urlPath, index) {
  return `${method.toUpperCase()} ${urlPath} #${index}`;
}

function extractEndpoints(document) {
  if (!document || typeof document !== 'object' || !document.paths || typeof document.paths !== 'object') {
    throw new Error('Swagger/OpenAPI file must contain a paths object');
  }

  const endpoints = [];
  const supportedMethods = new Set(['get', 'post', 'put', 'patch', 'delete', 'head', 'options']);
  let index = 0;

  for (const [urlPath, pathItem] of Object.entries(document.paths)) {
    if (!pathItem || typeof pathItem !== 'object') continue;

    for (const [method, operation] of Object.entries(pathItem)) {
      if (!supportedMethods.has(method.toLowerCase())) continue;
      if (!operation || typeof operation !== 'object') continue;

      index += 1;
      const normalizedMethod = method.toUpperCase();
      const tags = Array.isArray(operation.tags) ? operation.tags.map(String) : [];

      endpoints.push({
        id: endpointId(normalizedMethod, urlPath, index),
        method: normalizedMethod,
        path: urlPath,
        summary: String(operation.summary || operation.description || operation.operationId || '').trim(),
        operationId: String(operation.operationId || '').trim(),
        tags,
        authRequired: operationAuthRequired(document.security, operation),
        risk: methodRisk(normalizedMethod, urlPath),
      });
    }
  }

  if (!endpoints.length) {
    throw new Error('No HTTP methods were found in this Swagger/OpenAPI file');
  }

  return endpoints;
}

function slugify(value) {
  const slug = String(value || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9а-яё_-]+/gi, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80);

  return slug || `route-${Date.now()}`;
}

async function listRoutes() {
  try {
    const entries = await fs.readdir(routesDir, { withFileTypes: true });
    const routes = [];

    for (const entry of entries) {
      if (!entry.isFile() || !entry.name.endsWith('.route.json')) continue;

      const fullPath = path.join(routesDir, entry.name);
      const [raw, stat] = await Promise.all([fs.readFile(fullPath, 'utf8'), fs.stat(fullPath)]);
      const route = JSON.parse(raw);
      routes.push({
        name: route.name || entry.name.replace(/\.route\.json$/, ''),
        fileName: entry.name,
        stepsCount: Array.isArray(route.steps) ? route.steps.length : 0,
        updatedAt: stat.mtimeMs,
      });
    }

    routes.sort((a, b) => b.updatedAt - a.updatedAt);
    return routes;
  } catch (_error) {
    return [];
  }
}

async function hasRealTokens() {
  try {
    const raw = await fs.readFile(tokensFile, 'utf8');
    return raw
      .split(/\r?\n|,/)
      .map((value) => value.trim())
      .some((value) => value && !value.startsWith('#') && !value.startsWith('example-token-'));
  } catch (_error) {
    return false;
  }
}

async function listReports() {
  try {
    const entries = await fs.readdir(resultsDir, { withFileTypes: true });
    const reports = [];

    for (const entry of entries) {
      if (!entry.isFile() || !entry.name.endsWith('.html')) continue;

      const fullPath = path.join(resultsDir, entry.name);
      const stat = await fs.stat(fullPath);
      reports.push({
        name: entry.name,
        url: `/reports/${encodeURIComponent(entry.name)}`,
        createdAt: stat.mtimeMs,
      });
    }

    reports.sort((a, b) => b.createdAt - a.createdAt);
    return reports.slice(0, 20);
  } catch (_error) {
    return [];
  }
}

async function handleStatus(_req, res) {
  const [tokenReady, reports, routes] = await Promise.all([hasRealTokens(), listReports(), listRoutes()]);
  json(res, 200, {
    rootDir,
    tokenReady,
    activeRunId,
    activeRun: activeRunId ? runs.get(activeRunId) : null,
    reports,
    routes,
  });
}

async function saveToken(req, res) {
  const body = await readBody(req);
  const token = String(body.token || '').trim();

  if (!token) {
    json(res, 400, { error: 'Token is required' });
    return;
  }

  await fs.mkdir(k6Dir, { recursive: true });
  await fs.writeFile(tokensFile, `# Local session tokens. Do not commit this file.\n# One token per line.\n${token}\n`, {
    mode: 0o600,
  });
  await fs.chmod(tokensFile, 0o600).catch(() => {});
  json(res, 200, { ok: true });
}

async function parseSwagger(req, res) {
  const body = await readBody(req);
  const document = parseDocument(body.content);
  const endpoints = extractEndpoints(document);

  json(res, 200, {
    ok: true,
    name: String(body.name || document.info?.title || 'swagger').trim(),
    title: document.info?.title || '',
    version: document.info?.version || '',
    endpoints,
  });
}

async function saveRoute(req, res) {
  const body = await readBody(req);
  const name = String(body.name || '').trim();
  const steps = Array.isArray(body.steps) ? body.steps : [];

  if (!name) {
    json(res, 400, { error: 'Route name is required' });
    return;
  }

  if (!steps.length) {
    json(res, 400, { error: 'Route must contain at least one method' });
    return;
  }

  const route = {
    name,
    createdAt: new Date().toISOString(),
    steps: steps.map((step, index) => ({
      order: index + 1,
      method: String(step.method || '').toUpperCase(),
      path: String(step.path || ''),
      summary: String(step.summary || ''),
      operationId: String(step.operationId || ''),
      tags: Array.isArray(step.tags) ? step.tags.map(String) : [],
      authRequired: Boolean(step.authRequired),
      risk: String(step.risk || 'read'),
      expectStatus: Number(step.expectStatus || 200),
    })),
  };

  await fs.mkdir(routesDir, { recursive: true });
  const fileName = `${slugify(name)}.route.json`;
  const routePath = path.join(routesDir, fileName);
  await fs.writeFile(routePath, `${JSON.stringify(route, null, 2)}\n`, { mode: 0o600 });
  await fs.chmod(routePath, 0o600).catch(() => {});

  json(res, 200, {
    ok: true,
    route: {
      name: route.name,
      fileName,
      stepsCount: route.steps.length,
    },
  });
}

function createRun(command, args) {
  const id = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  const run = {
    id,
    command,
    args,
    status: 'running',
    startedAt: Date.now(),
    finishedAt: null,
    exitCode: null,
    output: '',
  };

  runs.set(id, run);
  activeRunId = id;

  const child = spawn('make', args, {
    cwd: rootDir,
    env: {
      ...process.env,
      OPEN_REPORT: 'true',
    },
  });

  const append = (chunk) => {
    run.output += chunk.toString();
    if (run.output.length > 120000) {
      run.output = run.output.slice(-120000);
    }
  };

  child.stdout.on('data', append);
  child.stderr.on('data', append);
  child.on('close', (code) => {
    run.status = code === 0 ? 'passed' : 'failed';
    run.finishedAt = Date.now();
    run.exitCode = code;
    if (activeRunId === id) {
      activeRunId = null;
    }
  });

  child.on('error', (error) => {
    run.status = 'failed';
    run.finishedAt = Date.now();
    run.exitCode = 1;
    run.output += `\n${error.message}\n`;
    if (activeRunId === id) {
      activeRunId = null;
    }
  });

  return run;
}

async function startRun(req, res) {
  if (activeRunId) {
    json(res, 409, { error: 'A test is already running', run: runs.get(activeRunId) });
    return;
  }

  const body = await readBody(req);
  const command = String(body.command || '').trim();
  const config = allowedRuns[command];

  if (!config) {
    json(res, 400, { error: 'Unknown command' });
    return;
  }

  const args = [...config.args];
  const users = String(body.users || '').trim();

  if (config.users && users) {
    if (!/^\d+$/.test(users) || Number(users) < 1 || Number(users) > 10000) {
      json(res, 400, { error: 'Users must be a number from 1 to 10000' });
      return;
    }

    args.push(users);
  }

  const run = createRun(command, args);
  json(res, 202, { run });
}

async function getRun(req, res, runId) {
  const run = runId === 'current' && activeRunId ? runs.get(activeRunId) : runs.get(runId);
  if (!run) {
    json(res, 200, { run: null });
    return;
  }

  json(res, 200, { run });
}

async function serveReport(req, res, name) {
  const reportName = path.basename(decodeURIComponent(name));
  if (!reportName.endsWith('.html')) {
    notFound(res);
    return;
  }

  const reportPath = path.join(resultsDir, reportName);
  try {
    await fs.access(reportPath);
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    createReadStream(reportPath).pipe(res);
  } catch (_error) {
    notFound(res);
  }
}

async function serveStatic(req, res) {
  const url = new URL(req.url, `http://127.0.0.1:${port}`);
  const pathname = url.pathname === '/' ? '/index.html' : url.pathname;
  const filePath = path.normalize(path.join(publicDir, pathname));

  if (!filePath.startsWith(publicDir)) {
    notFound(res);
    return;
  }

  try {
    await fs.access(filePath);
    res.writeHead(200, { 'Content-Type': contentType(filePath) });
    createReadStream(filePath).pipe(res);
  } catch (_error) {
    notFound(res);
  }
}

const server = createServer(async (req, res) => {
  try {
    const url = new URL(req.url, `http://127.0.0.1:${port}`);

    if (req.method === 'GET' && url.pathname === '/api/status') {
      await handleStatus(req, res);
      return;
    }

    if (req.method === 'POST' && url.pathname === '/api/token') {
      await saveToken(req, res);
      return;
    }

    if (req.method === 'POST' && url.pathname === '/api/swagger') {
      await parseSwagger(req, res);
      return;
    }

    if (req.method === 'GET' && url.pathname === '/api/routes') {
      json(res, 200, { routes: await listRoutes() });
      return;
    }

    if (req.method === 'POST' && url.pathname === '/api/routes') {
      await saveRoute(req, res);
      return;
    }

    if (req.method === 'POST' && url.pathname === '/api/run') {
      await startRun(req, res);
      return;
    }

    if (req.method === 'GET' && url.pathname.startsWith('/api/run/')) {
      await getRun(req, res, decodeURIComponent(url.pathname.slice('/api/run/'.length)));
      return;
    }

    if (req.method === 'GET' && url.pathname.startsWith('/reports/')) {
      await serveReport(req, res, url.pathname.slice('/reports/'.length));
      return;
    }

    if (req.method === 'GET') {
      await serveStatic(req, res);
      return;
    }

    notFound(res);
  } catch (error) {
    json(res, 500, { error: error.message });
  }
});

function openBrowser(url) {
  const opener = process.platform === 'darwin' ? 'open' : process.platform === 'win32' ? 'cmd' : 'xdg-open';
  const args = process.platform === 'win32' ? ['/c', 'start', '', url] : [url];
  const child = spawn(opener, args, { detached: true, stdio: 'ignore' });
  child.unref();
}

server.on('error', (error) => {
  if (error.code === 'EADDRINUSE') {
    console.error(`Port ${port} is already in use. Try UI_PORT=8790 make ui`);
  } else {
    console.error(`Local UI failed to start: ${error.message}`);
  }

  process.exit(1);
});

server.listen(port, '127.0.0.1', () => {
  const url = `http://127.0.0.1:${port}`;
  console.log(`Local UI: ${url}`);
  if (process.env.OPEN_UI !== 'false') {
    openBrowser(url);
  }
});
