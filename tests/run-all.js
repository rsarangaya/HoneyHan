// Runs every test file in order and stops at the first failure: node tests/run-all.js
const { spawnSync } = require('child_process');
const files = require('fs').readdirSync(__dirname).filter(f => f.endsWith('.test.js')).sort();
for (const f of files) {
  console.log(`\n=== ${f}`);
  const r = spawnSync('node', [require('path').join(__dirname, f)], { stdio: ['ignore', 'pipe', 'inherit'], encoding: 'utf8' });
  process.stdout.write((r.stdout || '').split('\n').filter(l => !/GL Driver/.test(l)).join('\n'));
  if (r.status !== 0) { console.log(`\n${f} FAILED`); process.exit(1); }
}
console.log('\nALL TEST FILES PASSED');
