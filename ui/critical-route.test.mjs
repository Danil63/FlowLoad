import { test } from 'node:test';
import assert from 'node:assert/strict';
import { suggestCriticalRoute } from './public/critical-route.js';
const paths = ['/profile', '/aircraft', '/routes', '/routes/map', '/quests', '/carousel', '/shop', '/raffles/me'];
const fixtures = paths.map(path => ({ method: 'GET', path }));
test('orders the game opening journey independently of Swagger order', () => {
  const result = suggestCriticalRoute([...fixtures].reverse());
  assert.deepEqual(result.steps.map(step => step.path), paths);
  assert.deepEqual(result.missing, []);
});
test('does not include flight writes, admin endpoints or parameterized requests', () => {
  const result = suggestCriticalRoute([...fixtures, { method: 'POST', path: '/flights/start' }, { method: 'GET', path: '/admin/me' }, { method: 'GET', path: '/cities/{cityId}' }]);
  assert.deepEqual(result.steps, fixtures);
});
test('reports missing optional methods without inventing them', () => {
  const result = suggestCriticalRoute(fixtures.slice(0, 3));
  assert.equal(result.steps.length, 3);
  assert.deepEqual(result.missing, paths.slice(3));
});
test('does not claim a critical route for an unknown or incomplete API', () => {
  assert.equal(suggestCriticalRoute([{ method: 'GET', path: '/orders' }]).steps.length, 0);
  assert.equal(suggestCriticalRoute([{ method: 'POST', path: '/profile' }, ...fixtures.slice(1)]).steps.length, 0);
  assert.equal(suggestCriticalRoute([]).steps.length, 0);
});
