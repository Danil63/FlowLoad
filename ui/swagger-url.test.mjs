import { test } from 'node:test';
import assert from 'node:assert/strict';
import dns from 'node:dns/promises';
import http from 'node:http';
import https from 'node:https';
import { EventEmitter } from 'node:events';
import { Readable } from 'node:stream';
import { downloadSwagger } from './swagger-url.mjs';

function remote(t, replies) {
  const calls = [];
  t.mock.method(dns, 'lookup', async (host) => [{ address: host === 'private.test' ? '10.0.0.1' : '93.184.215.14', family: 4 }]);
  const request = (url, options, callback) => {
    calls.push({ url: url.href, options });
    const reply = replies.shift();
    assert.ok(reply, 'Unexpected outbound request');
    const req = new EventEmitter();
    req.end = () => {
      const response = Readable.from((reply.chunks || [reply.content || '']).map(value => Buffer.from(value)));
      response.statusCode = reply.status || 200;
      response.headers = reply.headers || {};
      queueMicrotask(() => callback(response));
    };
    return req;
  };
  t.mock.method(http, 'request', request);
  t.mock.method(https, 'request', request);
  return calls;
}

test('downloads JSON and YAML without forwarding authentication, and pins DNS', async t => {
  const json = '{"openapi":"3.0.3","paths":{}}';
  const yaml = 'openapi: 3.0.3\npaths: {}';
  const calls = remote(t, [{ content: json }, { content: yaml }]);
  assert.equal((await downloadSwagger('https://public.test/docs-json')).content, json);
  assert.equal((await downloadSwagger('https://public.test/openapi.yaml')).content, yaml);
  assert.equal(calls[0].options.headers.Cookie, undefined);
  assert.equal(calls[0].options.headers.Authorization, undefined);
  calls[0].options.lookup('public.test', {}, (error, address, family) => {
    assert.equal(error, null);
    assert.equal(address, '93.184.215.14');
    assert.equal(family, 4);
  });
});

test('follows relative redirects but refuses redirects to private destinations', async t => {
  const calls = remote(t, [
    { status: 302, headers: { location: '/openapi.json' } },
    { content: '{}' },
    { status: 302, headers: { location: 'http://private.test/secret' } },
  ]);
  await downloadSwagger('https://public.test/docs');
  assert.equal(calls[1].url, 'https://public.test/openapi.json');
  await assert.rejects(downloadSwagger('https://public.test/docs'), /непубличный/);
  assert.equal(calls.length, 3);
});

test('rejects invalid URLs, credentials, unsupported protocols and private DNS', async t => {
  const calls = remote(t, []);
  for (const url of ['bad', 'file:///tmp/spec.json', 'https://user:password@public.test/spec', 'http://private.test/spec']) {
    await assert.rejects(downloadSwagger(url));
  }
  assert.equal(calls.length, 0);
});

test('reports HTML, HTTP errors and both declared and streamed size limits', async t => {
  remote(t, [
    { content: '<html>Swagger UI</html>', headers: { 'content-type': 'text/html' } },
    { status: 401 },
    { headers: { 'content-length': String(6 * 1024 * 1024) } },
    { chunks: ['x'.repeat(3 * 1024 * 1024), 'x'.repeat(3 * 1024 * 1024)] },
  ]);
  for (const error of [/HTML/, /HTTP 401/, /5 МБ/, /5 МБ/]) {
    await assert.rejects(downloadSwagger('https://public.test/spec'), error);
  }
});

test('resolves Swagger UI docs pages to docs-json, including nested paths', async t => {
  const content = '{"openapi":"3.0.0","paths":{}}';
  const calls = remote(t, [
    { content: '<html><div id="swagger-ui"></div></html>', headers: { 'content-type': 'text/html' } },
    { content },
  ]);
  assert.equal((await downloadSwagger('https://public.test/api/docs/')).content, content);
  assert.equal(calls[1].url, 'https://public.test/api/docs-json');
});

test('docs-json discovery preserves private redirect protection', async t => {
  remote(t, [
    { content: '<html>swagger-ui</html>' },
    { status: 302, headers: { location: 'http://private.test/spec' } },
  ]);
  await assert.rejects(downloadSwagger('https://public.test/docs'), /непубличный/);
});

test('bounds redirect loops', async t => {
  const calls = remote(t, Array.from({ length: 6 }, () => ({ status: 302, headers: { location: '/again' } })));
  await assert.rejects(downloadSwagger('https://public.test/spec'), /перенаправлений/);
  assert.equal(calls.length, 6);
});

test('timeout includes DNS resolution', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  t.mock.method(dns, 'lookup', () => new Promise(() => {}));
  const failure = assert.rejects(downloadSwagger('https://public.test/spec'), /15 секунд/);
  t.mock.timers.tick(15000);
  await failure;
});
