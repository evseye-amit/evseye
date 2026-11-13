import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const names = ['RENTAL_PAYMENT_TEST_DATABASE_URL', 'AUTOPAY_TEST_DATABASE_URL', 'PENALTY_PAYMENT_TEST_DATABASE_URL', 'PAYMENT_CONFIGURATION_TEST_DATABASE_URL', 'DEPLOYMENT_PLAN_TEST_DATABASE_URL'];
for (const name of names) {
  try {
    const url = new URL(process.env[name] ?? '');
    if (!['postgres:', 'postgresql:'].includes(url.protocol) || !url.pathname.includes('_test_')) throw new Error();
  } catch {
    console.error(`${name} must explicitly identify a disposable _test_ PostgreSQL database. Release validation must not skip database suites.`);
    process.exit(1);
  }
}
const result = spawnSync(process.execPath, ['node_modules/vitest/vitest.mjs', 'run', 'test/payments', 'test/allocations/deployment-commercial.integration.spec.ts', '--no-file-parallelism', '--reporter=dot'], {
  cwd: fileURLToPath(new URL('../', import.meta.url)), stdio: 'inherit', env: process.env,
});
if (result.error) console.error('Unable to start the payment release test runner.');
process.exitCode = result.status ?? 1;
