import { test } from 'node:test';
import assert from 'node:assert/strict';
import { boundedBody, BodyLimitError, MAX_API_BODY_BYTES, sameOriginRequest, sessionCookieNames, forwardApplicationHeaders } from '../apps/web/src/lib/gateway-security.ts';
const request = (origin, site) => new Request('https://acme.example.com/api/v1/test', { method: 'POST', headers: { host: 'acme.example.com', ...(origin ? { origin } : {}), ...(site ? { 'sec-fetch-site': site } : {}) } });
test('gateway preserves notification request keys across retries without forwarding browser credentials', () => {
  const key = 'notification-12345678-1234-4321-abcd-123456789012';
  const source = new Headers({
    'Idempotency-Key': key,
    'Content-Type': 'application/json',
    Accept: 'application/json',
    Authorization: 'Bearer untrusted',
    Cookie: 'untrusted=session',
    'X-Client-Id': 'untrusted-client',
  });
  for (let attempt = 0; attempt < 2; attempt++) {
    const target = new Headers({ 'X-Client-Id': 'server-client' });
    forwardApplicationHeaders(source, target);
    assert.equal(target.get('idempotency-key'), key);
    assert.equal(target.get('content-type'), 'application/json');
    assert.equal(target.get('accept'), 'application/json');
    assert.equal(target.get('x-client-id'), 'server-client');
    assert.equal(target.has('authorization'), false);
    assert.equal(target.has('cookie'), false);
  }
  const target = new Headers();
  forwardApplicationHeaders(new Headers(), target);
  assert.equal(target.has('idempotency-key'), false);
});
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
