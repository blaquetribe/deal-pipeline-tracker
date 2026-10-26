// Fails if an env template contains anything but placeholders.
// Usage: node scripts/check-env-example.mjs [file ...]   (default: .env.example)
import { readFileSync } from 'node:fs';

import { findProblems } from './env-guard.mjs';

const files = process.argv.length > 2 ? process.argv.slice(2) : ['.env.example'];
let failures = 0;

for (const file of files) {
  let text;
  try {
    text = readFileSync(file, 'utf8');
  } catch {
    continue; // a missing template is not a leak
  }
  for (const problem of findProblems(text)) {
    console.error(`${file}:${problem.line}: ${problem.key}: ${problem.reason}`);
    failures += 1;
  }
}

if (failures > 0) {
  console.error(
    '\nSecrets must not be committed. Put real values in the untracked .env file; ' +
      '.env.example holds placeholders only. Rotate any credential that was shared.',
  );
  process.exit(1);
}
