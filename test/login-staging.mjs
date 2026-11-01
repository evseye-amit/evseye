const baseUrl = process.env.LOGIN_STAGING_URL;
const accessToken = process.env.LOGIN_ACCESS_TOKEN;
const refreshToken = process.env.LOGIN_REFRESH_TOKEN;
if (!baseUrl || !accessToken || !refreshToken) {
  console.log('Login staging E2E skipped: set LOGIN_STAGING_URL, LOGIN_ACCESS_TOKEN, and LOGIN_REFRESH_TOKEN.');
  process.exit(0);
}
const headers = { Authorization: `Bearer ${accessToken}` };
const logout = await fetch(new URL('/api/v1/auth/logout', baseUrl), {
  method: 'POST', headers: { ...headers, 'content-type': 'application/json' }, body: JSON.stringify({ refreshToken }),
});
if (!logout.ok) throw new Error(`Logout failed: ${logout.status}`);
const accessAfterLogout = await fetch(new URL('/api/v1/auth/me', baseUrl), { headers });
if (![401, 403].includes(accessAfterLogout.status)) throw new Error(`Access token was accepted after logout: ${accessAfterLogout.status}`);
const refreshAfterLogout = await fetch(new URL('/api/v1/auth/refresh', baseUrl), {
  method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ refreshToken }),
});
if (![401, 403].includes(refreshAfterLogout.status)) throw new Error(`Refresh token was accepted after logout: ${refreshAfterLogout.status}`);
console.log(JSON.stringify({ logout: logout.status, accessAfterLogout: accessAfterLogout.status, refreshAfterLogout: refreshAfterLogout.status }));
