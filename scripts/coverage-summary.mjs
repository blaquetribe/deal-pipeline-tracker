// Prints the coverage totals and the weakest files as Markdown, for the CI job summary.
// Usage: node scripts/coverage-summary.mjs >> "$GITHUB_STEP_SUMMARY"
import { existsSync, readFileSync } from 'node:fs';
import { relative } from 'node:path';

const file = process.argv[2] ?? 'coverage/coverage-summary.json';

if (!existsSync(file)) {
  console.log('### Coverage\n\nNo coverage summary was produced.');
  process.exit(0);
}

const summary = JSON.parse(readFileSync(file, 'utf8'));
const { total, ...files } = summary;
const pct = (metric) => `${metric.pct}% (${metric.covered}/${metric.total})`;

console.log('### Coverage\n');
console.log('| Metric | Covered |\n|---|---|');
for (const key of ['statements', 'branches', 'functions', 'lines']) {
  console.log(`| ${key} | ${pct(total[key])} |`);
}

const weakest = Object.entries(files)
  // Files with no executable lines (barrel re-exports) have nothing to cover.
  .filter(([, metrics]) => metrics.lines.total > 0)
  .map(([path, metrics]) => ({ path: relative(process.cwd(), path), lines: metrics.lines.pct }))
  .toSorted((a, b) => a.lines - b.lines)
  .slice(0, 5);

if (weakest.length > 0) {
  console.log('\nLowest line coverage:\n\n| File | Lines |\n|---|---|');
  for (const { path, lines } of weakest) {
    console.log(`| \`${path}\` | ${lines}% |`);
  }
}
