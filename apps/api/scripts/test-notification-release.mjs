import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

for (const name of [
  'NOTIFICATION_FOUNDATION_TEST_DATABASE_URL',
  'NOTIFICATION_TEST_DATABASE_URL',
]) {
  try {
    const url = new URL(process.env[name] ?? '');
    if (
      !['postgres:', 'postgresql:'].includes(url.protocol) ||
      !url.pathname.includes('_test_')
    )
      throw new Error();
  } catch {
    console.error(
      `${name} must explicitly identify a disposable _test_ database. Notification release validation cannot skip database suites.`,
    );
    process.exit(1);
  }
}
const reportDirectory = mkdtempSync(join(tmpdir(), 'notification-release-'));
const reportPath = join(reportDirectory, 'results.json');
const result = spawnSync(
  process.execPath,
  [
    'node_modules/vitest/vitest.mjs',
    'run',
    'test/notifications',
    'test/auth/auth.service.spec.ts',
    'test/allocations/allocation-notification.spec.ts',
    'test/allocations/allocations.service.spec.ts',
    'test/allocations/mobile-deployment.service.spec.ts',
    '--no-file-parallelism',
    '--reporter=default',
    '--reporter=json',
    `--outputFile.json=${reportPath}`,
  ],
  {
    cwd: fileURLToPath(new URL('../', import.meta.url)),
    stdio: 'inherit',
    env: process.env,
  },
);
if (result.error)
  console.error('Unable to start notification release validation.');
if (result.signal)
  console.error('Notification release validation was interrupted.');
let failed = (result.status ?? 1) !== 0;
try {
  const report = JSON.parse(readFileSync(reportPath, 'utf8'));
  if (
    !report.success ||
    report.numPendingTests > 0 ||
    report.numTodoTests > 0 ||
    !report.numTotalTests
  ) {
    console.error(
      'Release validation failed: tests failed, were skipped, or no tests ran.',
    );
    failed = true;
  }
} catch {
  console.error(
    'Release validation failed: no valid machine-readable test report.',
  );
  failed = true;
} finally {
  rmSync(reportDirectory, { recursive: true, force: true });
}
process.exitCode = failed ? 1 : 0;
