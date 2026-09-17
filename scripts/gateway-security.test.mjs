import { test } from 'node:test';
import assert from 'node:assert/strict';
import { boundedBody, BodyLimitError, MAX_API_BODY_BYTES, sameOriginRequest, sessionCookieNames } from '../apps/web/src/lib/gateway-security.ts';
const request = (origin, site) => new Request('https://acme.example.com/api/v1/test', { method: 'POST', headers: { host: 'acme.example.com', ...(origin ? { origin } : {}), ...(site ? { 'sec-fetch-site': site } : {}) } });
test('cookie mutations require an exact HTTPS origin', () => {
  assert.equal(sameOriginRequest(request('https://acme.example.com'), true), true);
  for (const req of [request(), request('https://blue.example.com'), request('http://acme.example.com'), request('https://acme.example.com', 'cross-site')]) assert.equal(sameOriginRequest(req, true), false);
});
test('production cookie names use the host prefix', () => {
  assert.equal(sessionCookieNames(true).access, '__Host-evseye-access');
  assert.equal(sessionCookieNames(false).access, 'evseye-access');
});
test('bounds actual bytes without relying on content length', async () => {
  await assert.rejects(boundedBody(new Request('http://localhost', { method: 'POST', body: 'a'.repeat(MAX_API_BODY_BYTES + 1) })), BodyLimitError);
  const body = await boundedBody(new Request('http://localhost', { method: 'POST', body: '{"ok":true}' }));
  assert.equal(new TextDecoder().decode(body), '{"ok":true}');
});
