import assert from 'node:assert/strict';
import test from 'node:test';
import { buildUrl, redactUrl } from '../src/api-client.js';
import { loadConfig } from '../src/config.js';

test('buildUrl skips empty params and joins paths', () => {
  const url = buildUrl('http://localhost:3000', '/box-scores', {
    week: 3,
    includeLineup: true,
    position: '',
    size: null,
    offset: undefined
  });
  assert.equal(url.pathname, '/box-scores');
  assert.equal(url.searchParams.get('week'), '3');
  assert.equal(url.searchParams.get('includeLineup'), 'true');
  assert.equal(url.searchParams.has('position'), false);
  assert.equal(url.searchParams.has('size'), false);
  assert.equal(url.searchParams.has('offset'), false);
});

test('redactUrl masks ESPN cookie values', () => {
  const url = buildUrl('http://localhost:3000', '/league', {
    leagueId: 1,
    espnS2: 'super-secret',
    swid: '{abc-123}'
  });
  const redacted = redactUrl(url);
  assert.ok(!redacted.includes('super-secret'));
  assert.ok(!redacted.includes('abc-123'));
  assert.ok(redacted.includes('espnS2=***'));
  assert.ok(redacted.includes('leagueId=1'));
});

test('loadConfig strips credentials and trailing slashes from the base URL', () => {
  const config = loadConfig({ FF_API_BASE_URL: 'http://user:pass@localhost:3000/' });
  assert.equal(config.baseUrl, 'http://localhost:3000');
});

test('loadConfig rejects non-http protocols', () => {
  assert.throws(() => loadConfig({ FF_API_BASE_URL: 'file:///etc/passwd' }), /must use http or https/);
});

test('loadConfig falls back to defaults', () => {
  const config = loadConfig({});
  assert.equal(config.baseUrl, 'http://localhost:3000');
  assert.equal(config.defaultLeagueId, null);
  assert.equal(config.timeoutMs, 20_000);
});
