import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const root = resolve(new URL('..', import.meta.url).pathname);
const source = resolve(root, 'apps/api/src/client-identity/pre-login-error-codes.ts');
const authSource = resolve(root, 'apps/api/src/auth/auth-error-codes.ts');
const contract = resolve(root, 'contracts/prelogin-error-codes.json');
const webTarget = resolve(root, 'apps/web/src/lib/prelogin-error-codes.generated.ts');
const flutterTarget = process.env.FLUTTER_REPO
  ? resolve(process.env.FLUTTER_REPO, 'packages/evseye_core/lib/src/api/pre_login_error_codes.g.dart')
  : resolve(root, '../rider_app/packages/evseye_core/lib/src/api/pre_login_error_codes.g.dart');
const text = await readFile(source, 'utf8');
const authText = await readFile(authSource, 'utf8');
const codes = [...text.matchAll(/'([A-Z][A-Z0-9_]+)'/g)].map((match) => match[1]);
const authCodes = [...authText.matchAll(/'([A-Z][A-Z0-9_]+)'/g)].map((match) => match[1]);
if (codes.length < 7 || new Set(codes).size !== codes.length) throw new Error('Unexpected pre-login error catalog.');
const output = `// GENERATED CONTRACT. Do not edit by hand; regenerate from the API pre-login error catalog.\nconst Set<String> preLoginErrorCodes = <String>{\n${codes.map((code) => `  '${code}',`).join('\n')}\n};\n\nconst Map<String, String> preLoginErrorMessageKeys = <String, String>{\n${codes.map((code) => `  '${code}': 'preLogin.${code}',`).join('\n')}\n};\n\nconst Set<String> preLoginNotFoundCodes = <String>{'WORKSPACE_NOT_FOUND'};\nconst Set<String> preLoginUnavailableCodes = <String>{\n${codes.filter((code) => code !== 'WORKSPACE_NOT_FOUND').map((code) => `  '${code}',`).join('\n')}\n};\n`;
const authOutput = `// GENERATED CONTRACT. Do not edit by hand.\nconst Set<String> authErrorCodes = <String>{\n${authCodes.map((code) => `  '${code}',`).join('\n')}\n};\n`;
await writeFile(contract, `${JSON.stringify({ codes }, null, 2)}\n`);
await writeFile(webTarget, `// GENERATED CONTRACT. Do not edit by hand.\nexport const PRE_LOGIN_ERROR_CODES = ${JSON.stringify(codes)} as const;\nexport type PreLoginErrorCode = (typeof PRE_LOGIN_ERROR_CODES)[number];\nexport const isPreLoginErrorCode = (value: unknown): value is PreLoginErrorCode => typeof value === 'string' && (PRE_LOGIN_ERROR_CODES as readonly string[]).includes(value);\n`);
await writeFile(resolve(root, 'contracts/auth-error-codes.json'), `${JSON.stringify({ codes: authCodes }, null, 2)}\n`);
try { await writeFile(flutterTarget, output); console.log(`Generated Flutter catalog at ${flutterTarget}`); } catch (error) {
  if (process.env.REQUIRE_FLUTTER_CONTRACT === '1') throw error;
}
try { await writeFile(resolve(process.env.FLUTTER_REPO ?? resolve(root, '../rider_app'), 'packages/evseye_core/lib/src/api/auth_error_codes.g.dart'), authOutput); } catch (error) {
  if (process.env.REQUIRE_FLUTTER_CONTRACT === '1') throw error;
}
console.log(`Generated canonical contract at ${contract}`);
