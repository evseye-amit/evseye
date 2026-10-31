import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const root = resolve(new URL('..', import.meta.url).pathname);
const source = resolve(root, 'apps/api/src/client-identity/pre-login-error-codes.ts');
const contract = resolve(root, 'contracts/prelogin-error-codes.json');
const flutterTarget = process.env.FLUTTER_REPO
  ? resolve(process.env.FLUTTER_REPO, 'packages/evseye_core/lib/src/api/pre_login_error_codes.g.dart')
  : resolve(root, '../rider_app/packages/evseye_core/lib/src/api/pre_login_error_codes.g.dart');
const text = await readFile(source, 'utf8');
const codes = [...text.matchAll(/'([A-Z][A-Z0-9_]+)'/g)].map((match) => match[1]);
if (codes.length !== 7 || new Set(codes).size !== codes.length) throw new Error('Unexpected pre-login error catalog.');
const output = `// GENERATED CONTRACT. Do not edit by hand; regenerate from the API pre-login error catalog.\nconst Set<String> preLoginErrorCodes = <String>{\n${codes.map((code) => `  '${code}',`).join('\n')}\n};\n`;
await writeFile(contract, `${JSON.stringify({ codes }, null, 2)}\n`);
try { await writeFile(flutterTarget, output); console.log(`Generated Flutter catalog at ${flutterTarget}`); } catch { /* Flutter repo is optional in monorepo CI. */ }
console.log(`Generated canonical contract at ${contract}`);
