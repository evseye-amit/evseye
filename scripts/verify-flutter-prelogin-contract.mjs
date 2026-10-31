import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const root = resolve(new URL('..', import.meta.url).pathname);
const flutterRoot = process.env.FLUTTER_REPO ?? resolve(root, '../rider_app');
const api = await readFile(resolve(root, 'apps/api/src/client-identity/pre-login-error-codes.ts'), 'utf8');
const flutter = await readFile(resolve(flutterRoot, 'packages/evseye_core/lib/src/api/pre_login_error_codes.g.dart'), 'utf8');
const expected = [...api.matchAll(/'([A-Z][A-Z0-9_]+)'/g)].map((match) => match[1]);
const actual = [...flutter.matchAll(/'([A-Z][A-Z0-9_]+)'/g)].map((match) => match[1]).filter((code, index, values) => expected.includes(code) && values.indexOf(code) === index);
if (expected.length !== actual.length || expected.some((code, index) => code !== actual[index])) {
  throw new Error(`Flutter pre-login catalog is stale. Expected ${expected.join(', ')}; found ${actual.join(', ')}.`);
}
console.log(`Flutter pre-login catalog is synchronized (${expected.length} codes).`);
