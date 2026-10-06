import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const testDirectory = path.dirname(fileURLToPath(import.meta.url));
const testFiles = [
  'verifyAuth.js',
  'verifyTimesheetFlow.js',
  'verifyTimeOffFlow.js',
  'verifyExpiryFlow.js',
  'verifyHistoryFlow.js',
  'verifySecurityHardening.js',
];

for (const testFile of testFiles) {
  const result = spawnSync(process.execPath, [path.join(testDirectory, testFile)], {
    stdio: 'inherit',
    env: process.env,
  });
  if (result.status !== 0) {
    process.exit(result.status ?? 1);
  }
}
