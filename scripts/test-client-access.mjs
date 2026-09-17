/** Local-only HTTP/HTTPS regression checks. Run after opt-in demo seeding. */
import assert from 'node:assert/strict';
import http from 'node:http';
import https from 'node:https';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
const require = createRequire(new URL('../apps/api/package.json', import.meta.url));
const { PrismaClient } = require('@prisma/client');
const { S3Client, DeleteObjectCommand } = require('@aws-sdk/client-s3');
const base = new URL(process.env.CLIENT_TEST_URL || 'http://localhost:3001');
if (process.env.NODE_ENV === 'production' || !['localhost', '127.0.0.1'].includes(base.hostname)) throw new Error('This suite only runs against local development.');
const secure = base.protocol === 'https:';
const ca = secure ? readFileSync(new URL('../deployment/client-access/local-tls/cert.pem', import.meta.url)) : undefined;
const port = base.port || (secure ? '443' : '80');
const cookieNames = secure ? ['__Host-evseye-access', '__Host-evseye-refresh'] : ['evseye-access', 'evseye-refresh'];
const jar = new Map();
async function api(host, path, { method = 'GET', body, cookies = jar.get(host), origin = `${base.protocol}//${host}:${port}`, headers = {} } = {}) {
  return new Promise((resolve, reject) => {
    const req = (secure ? https : http).request({ hostname: '127.0.0.1', port, servername: host, ca, path: '/api/v1' + path, method, headers: { host: `${host}:${port}`, ...(origin ? { origin } : {}), ...(cookies ? { cookie: cookies } : {}), ...(body !== undefined ? { 'content-type': 'application/json' } : {}), ...headers } }, res => {
      let text = ''; res.on('data', chunk => text += chunk);
      res.on('end', () => {
        const setCookies = res.headers['set-cookie'] || [];
        if (setCookies.length) jar.set(host, setCookies.map(value => value.split(';')[0]).join('; '));
        let data; try { data = JSON.parse(text); } catch { data = text; }
        resolve({ status: res.statusCode, body: data, setCookies });
      });
    });
    req.setTimeout(35000, () => req.destroy(new Error('Request timed out')));
    req.on('error', reject); req.end(body === undefined ? undefined : JSON.stringify(body));
  });
}
const a = 'acme.localhost', b = 'bluemobility.localhost';
for (let attempt = 0; attempt < 30; attempt++) {
  const ready = await api('localhost', '/public/client-context').catch(() => null);
  if (ready?.status === 200) break;
  if (attempt === 29) throw new Error('Local app did not become ready within 30 seconds.');
  await new Promise(resolve => setTimeout(resolve, 1000));
}
const generic = await api('localhost', '/public/client-context');
assert.equal(generic.status, 200); assert.equal(generic.body.data.client, null);
const acme = await api(a, '/public/client-context'), blue = await api(b, '/public/client-context');
assert.equal(acme.status, 200); assert.equal(blue.status, 200);
assert.notEqual(acme.body.data.branding.primaryColor, blue.body.data.branding.primaryColor);
assert.equal((await api('unknown.localhost', '/public/client-context')).status, 404);
assert.equal((await api(a, '/auth/otp/request', { method: 'POST', origin: 'https://evil.example', body: {} })).status, 403);
assert.equal((await api(a, '/auth/otp/request', { method: 'POST', origin: '', body: {} })).status, 403);
assert.equal((await api(a, '/client/identity/branding', { method: 'PATCH', body: { value: 'a'.repeat(1024 * 1024) } })).status, 413);
const requested = await api(a, '/auth/otp/request', { method: 'POST', body: { phone: '9100000101' } });
assert.equal(requested.status, 202);
const verification = { otpRequestId: requested.body.data.otpRequestId, code: '123456' };
assert.equal((await api(b, '/auth/otp/verify', { method: 'POST', body: verification })).status, 401);
const login = await api(a, '/auth/otp/verify', { method: 'POST', body: verification });
assert.equal(login.status, 201, 'Demo login failed. Wait 60 seconds after another OTP request before rerunning.');
assert.deepEqual(login.body.data, { authenticated: true });
for (const name of cookieNames) {
  const cookie = login.setCookies.find(value => value.startsWith(name + '='));
  assert.ok(cookie?.toLowerCase().includes('httponly'));
  assert.ok(cookie.toLowerCase().includes('samesite=strict'));
  assert.ok(!cookie.toLowerCase().includes('domain='));
  if (secure) assert.ok(cookie.toLowerCase().includes('secure'));
}
const originalCookies = jar.get(a);
assert.equal((await api(a, '/client/identity/context')).status, 200);
assert.equal((await api(b, '/client/identity/context', { cookies: originalCookies })).status, 403);
assert.equal((await api(a, '/client/identity/branding', { method: 'PATCH', body: { clientId: 'other-client' } })).status, 400);
const prisma = new PrismaClient();
let fleet, rider, imageKey, acmeClient, previousFavicon;
try {
  acmeClient = await prisma.client.findUniqueOrThrow({ where: { slug: 'acme' }, include: { branding: true } });
  previousFavicon = acmeClient.branding?.faviconObjectKey ?? null;
  const bytes = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aO0kAAAAASUVORK5CYII=', 'base64');
  const intent = await api(a, '/client/identity/branding/upload-intents', { method: 'POST', body: { kind: 'favicon', mimeType: 'image/png', sizeBytes: bytes.length } });
  assert.equal(intent.status, 201);
  imageKey = intent.body.data.objectKey;
  const uploaded = await new Promise((resolve, reject) => {
    const url = new URL(intent.body.data.uploadUrl);
    const req = (url.protocol === 'https:' ? https : http).request(url, { method: 'PUT', ca, headers: { 'content-type': 'image/png', 'content-length': bytes.length } }, res => { res.resume(); res.on('end', () => resolve(res.statusCode)); });
    req.on('error', reject); req.end(bytes);
  });
  assert.equal(uploaded, 200);
  assert.equal((await api(a, '/client/identity/branding/upload-complete', { method: 'POST', body: { kind: 'favicon', objectKey: imageKey } })).status, 201);
  const client = await prisma.client.findUniqueOrThrow({ where: { slug: 'bluemobility' } });
  const type = await prisma.vehicleType.findFirstOrThrow(), oem = await prisma.oem.findFirstOrThrow();
  const marker = `ACCESS-TEST-${Date.now()}`;
  fleet = await prisma.fleet.create({ data: { clientId: client.id, fleetCode: marker, chassisNumber: marker, oemId: oem.id, vehicleCategoryId: type.categoryId, vehicleTypeId: type.id, speedType: 'SLOW_SPEED' } });
  rider = await prisma.rider.create({ data: { clientId: client.id, name: marker, mobile: marker } });
  for (const [entity, id] of [['fleets', fleet.id], ['riders', rider.id]]) {
    assert.equal((await api(a, `/${entity}/${id}`)).status, 404);
    assert.equal((await api(b, `/${entity}/${id}`, { cookies: originalCookies })).status, 403);
  }
  const refreshed = await api(a, '/auth/refresh', { method: 'POST' });
  assert.equal(refreshed.status, 201); assert.deepEqual(refreshed.body.data, { authenticated: true });
  assert.equal((await api(a, '/auth/me', { cookies: originalCookies })).status, 401, 'Rotated session must be revoked');
  assert.equal((await api(a, '/auth/me')).status, 200);
  const currentCookies = jar.get(a);
  assert.equal((await api(a, '/auth/logout', { method: 'POST' })).status, 204);
  assert.equal((await api(a, '/auth/me', { cookies: currentCookies })).status, 401, 'Logout must revoke the session');
  console.log(`PASS ${secure ? 'HTTPS Secure' : 'HTTP local'} cookies, CSRF, body limit, presigned MinIO image upload, host isolation, Fleet/Rider IDOR, refresh rotation and logout.`);
} finally {
  if (acmeClient) await prisma.clientBranding.update({ where: { clientId: acmeClient.id }, data: { faviconObjectKey: previousFavicon } });
  if (imageKey) {
    const storage = new S3Client({ endpoint: 'http://127.0.0.1:9000', region: 'ap-south-1', forcePathStyle: true, credentials: { accessKeyId: 'evseye-minio', secretAccessKey: 'evseye-minio-local-password' } });
    try { await storage.send(new DeleteObjectCommand({ Bucket: 'evs-eye-local', Key: imageKey })); } finally { storage.destroy(); }
  }
  if (rider) await prisma.rider.delete({ where: { id: rider.id } });
  if (fleet) await prisma.fleet.delete({ where: { id: fleet.id } });
  await prisma.$disconnect();
  await api(a, '/auth/logout', { method: 'POST' }).catch(() => undefined);
}
