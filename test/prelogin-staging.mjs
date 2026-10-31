const baseUrl = process.env.PRELOGIN_STAGING_URL;
const companyCode = process.env.PRELOGIN_COMPANY_CODE;
const host = process.env.PRELOGIN_HOST;
if (!baseUrl || !companyCode || !host) {
  console.log('Pre-login staging E2E skipped: set PRELOGIN_STAGING_URL, PRELOGIN_COMPANY_CODE, and PRELOGIN_HOST.');
  process.exit(0);
}

async function bootstrap(headers = {}) {
  const url = new URL('/api/v1/public/app/bootstrap', baseUrl);
  url.searchParams.set('companyCode', companyCode);
  url.searchParams.set('appCode', 'RIDER');
  url.searchParams.set('role', 'RIDER');
  const response = await fetch(url, { headers });
  return { status: response.status, body: await response.json() };
}

const hostnameResult = await bootstrap({ Host: host });
if (hostnameResult.status >= 500) throw new Error(`Hostname bootstrap failed: ${hostnameResult.status}`);

const proxyResult = await bootstrap({ 'x-client-host': host, 'x-client-proxy-secret': process.env.CLIENT_PROXY_SECRET ?? '' });
if (proxyResult.status >= 500) throw new Error(`Proxy bootstrap failed: ${proxyResult.status}`);

const mismatch = await bootstrap({ Host: host, Origin: 'https://mismatch.example' });
if (![400, 403, 404].includes(mismatch.status)) throw new Error(`Expected mismatch rejection, got ${mismatch.status}`);

console.log(JSON.stringify({ hostname: hostnameResult.status, proxy: proxyResult.status, mismatch: mismatch.status }));
