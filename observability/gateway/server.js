const http = require('http');

const PORT = Number(process.env.PORT || 10000);
const TOKEN = process.env.GATEWAY_TOKEN || '';
const PROMETHEUS_HOSTPORT = process.env.PROMETHEUS_HOSTPORT || '';
const LOKI_HOSTPORT = process.env.LOKI_HOSTPORT || '';
const MAX_BODY_BYTES = Number(process.env.MAX_BODY_BYTES || 25 * 1024 * 1024);

function send(res, statusCode, body, headers = {}) {
  res.writeHead(statusCode, {
    'content-type': 'text/plain; charset=utf-8',
    ...headers,
  });
  res.end(body);
}

function isAuthorized(req) {
  if (!TOKEN) {
    return false;
  }

  const authorization = req.headers.authorization || '';
  const gatewayToken = req.headers['x-gateway-token'] || '';

  return authorization === `Bearer ${TOKEN}` || gatewayToken === TOKEN;
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;

    req.on('data', (chunk) => {
      size += chunk.length;

      if (size > MAX_BODY_BYTES) {
        reject(new Error('Request body is too large'));
        req.destroy();
        return;
      }

      chunks.push(chunk);
    });

    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

function targetForPath(pathname) {
  if (pathname === '/api/v1/write') {
    return {
      hostport: PROMETHEUS_HOSTPORT,
      path: '/api/v1/write',
      name: 'prometheus',
    };
  }

  if (pathname === '/loki/api/v1/push') {
    return {
      hostport: LOKI_HOSTPORT,
      path: '/loki/api/v1/push',
      name: 'loki',
    };
  }

  return null;
}

function upstreamRequest(target, body, req) {
  return new Promise((resolve, reject) => {
    const upstream = http.request(
      `http://${target.hostport}${target.path}`,
      {
        method: 'POST',
        headers: {
          'content-type': req.headers['content-type'] || 'application/octet-stream',
          'content-encoding': req.headers['content-encoding'] || undefined,
          'content-length': body.length,
        },
      },
      (upstreamRes) => {
        const chunks = [];

        upstreamRes.on('data', (chunk) => chunks.push(chunk));
        upstreamRes.on('end', () => {
          resolve({
            statusCode: upstreamRes.statusCode || 502,
            headers: upstreamRes.headers,
            body: Buffer.concat(chunks),
          });
        });
      },
    );

    upstream.on('error', reject);
    upstream.write(body);
    upstream.end();
  });
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`);

  if (req.method === 'GET' && url.pathname === '/health') {
    send(res, 200, 'ok');
    return;
  }

  if (req.method !== 'POST') {
    send(res, 405, 'method not allowed');
    return;
  }

  if (!isAuthorized(req)) {
    send(res, 401, 'unauthorized');
    return;
  }

  const target = targetForPath(url.pathname);

  if (!target) {
    send(res, 404, 'not found');
    return;
  }

  if (!target.hostport) {
    send(res, 503, `${target.name} upstream is not configured`);
    return;
  }

  try {
    const body = await readBody(req);
    const upstream = await upstreamRequest(target, body, req);
    res.writeHead(upstream.statusCode, {
      'content-type': upstream.headers['content-type'] || 'text/plain; charset=utf-8',
    });
    res.end(upstream.body);
  } catch (error) {
    send(res, 502, error.message || 'upstream error');
  }
});

server.listen(PORT, '0.0.0.0', () => {
  console.log(`k6 observability gateway listening on ${PORT}`);
});
