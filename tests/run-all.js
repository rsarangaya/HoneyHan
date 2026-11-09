// Runs every test file: node tests/run-all.js
// Runs the plain Node tests first (seconds) and then the in-browser tests (game.*.test.js), one after another.
// The browser tests run with ?norender=1 (no drawing, all the game logic), about a minute in all. They are not run
// in parallel: software-rendered browsers fight for the CPU and the timing-based checks then fail.
// Exits non-zero if anything fails, and prints a failed file's full output.
const { spawn } = require('child_process');
const path = require('path');
const files = require('fs').readdirSync(__dirname).filter(f => f.endsWith('.test.js')).sort();
const quick = files.filter(f => !f.startsWith('game.')), browser = files.filter(f => f.startsWith('game.'));

const runFile = f => new Promise(resolve => {
  const t0 = Date.now();
  const p = spawn('node', [path.join(__dirname, f)], { stdio: ['ignore', 'pipe', 'pipe'] });
  let out = '';
  p.stdout.on('data', d => out += d); p.stderr.on('data', d => out += d);
  p.on('close', code => resolve({ f, code, out: out.split('\n').filter(l => !/GL Driver/.test(l)).join('\n'), secs: ((Date.now() - t0) / 1000).toFixed(0) }));
});

(async () => {
  const results = [];
  for (const f of quick) results.push(await runFile(f));
  for (const f of browser) results.push(await runFile(f));
  let bad = 0;
  for (const r of results) {
    const lines = r.out.trim().split('\n');
    const failed = r.code !== 0;
    if (failed) bad++;
    console.log(`${failed ? 'FAIL' : 'ok  '} ${r.f} (${r.secs} s): ${failed ? '\n' + r.out : lines[lines.length - 1]}`);
  }
  console.log(bad ? `\n${bad} TEST FILE(S) FAILED` : '\nALL TEST FILES PASSED');
  process.exit(bad ? 1 : 0);
})();
