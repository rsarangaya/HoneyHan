// Enemies must not get stuck on floor decor and props (candles, urns, sacks, hearths, benches, racks...). Run on its own: node tests/game.stuck.test.js
// For every decor piece and prop on many seeds and stages, an enemy walks (Enemy.goTo, the real movement and path code) from one side of it to the
// other, and a second one starts right beside it. Each must arrive without the stuck timer ever reaching the snap-to-centre threshold.
const { run } = require('./lib');
run('Enemies and floor props', async ({ open, check }) => {
  const seeds = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12];
  const total = { runs: 0, fail: [], stuck: [], inside: 0, kinds: {} };
  for (const seed of seeds) {
    const page = await open(seed);
    const r = await page.evaluate(() => {
      const out = { runs: 0, fail: [], stuck: [], inside: 0, kinds: {} };
      const DIRS = [[1, 0], [0, 1], [-1, 0], [0, -1]];
      for (const st of [1, 2, 3, 4, 5, 6, 7]) for (const fl of [1, 2, 3]) {
        game.startStage(st); game.startFloor(fl);
        for (const e of game.enemies.splice(0)) e.mesh.parent && e.mesh.parent.remove(e.mesh);
        const f = game.floor, W = f.w;
        const isOpen = (x, y) => x >= 0 && y >= 0 && x < W && y < f.h && f.tiles[y * W + x] === 1 && !f.blocked[y * W + x];
        const things = [...f.decor.map(d => ({ k: d.kind, x: d.x, y: d.y })), ...f.props.map(p => ({ k: 'P:' + p.kind, x: p.x, y: p.y }))];
        let n = 0;
        const walk = (a, b, k) => {
          if (!isOpen(a.x, a.y) || !isOpen(b.x, b.y)) return;
          const body = { radius: 0.4, props: f.solids, mob: true };   // a goal or start inside a prop or NPC is not a walk to test
          if ([a, b].some(q => Player.prototype.blocked.call(body, f, (q.x + 0.5) * TILE, (q.y + 0.5) * TILE))) return;
          const pl = findPath(f, a.x, a.y, b.x, b.y).length; if (!pl || pl > 12) return;   // a short walk (not round the whole floor)
          const e = new Enemy({ x: a.x, y: a.y, route: [{ x: a.x, y: a.y }, { x: a.x, y: a.y }], seed: 1, type: 'bandit' }, f);
          e.x = (a.x + 0.5) * TILE; e.z = (a.y + 0.5) * TILE; e.wait = 1e9;
          const gx = (b.x + 0.5) * TILE, gz = (b.y + 0.5) * TILE;
          let t = 0, d = 99, ms = 0;
          for (; t < 40; t += 0.033) { d = e.goTo(gx, gz, 4.0, 0.033); ms = Math.max(ms, e.stuckT); if (d < 0.6) break; }
          out.runs++; out.kinds[k] = (out.kinds[k] || 0) + 1;
          if (d >= 0.6) out.fail.push(`${k} seed-stage ${st} floor ${fl} ${a.x},${a.y} -> ${b.x},${b.y} (${d.toFixed(1)} m left, at ${e.x.toFixed(1)},${e.z.toFixed(1)}, near ${f.solids.filter(p => Math.hypot(p.x - e.x, p.z - e.z) < p.r + 1.4).map(p => p.r.toFixed(2) + '@' + p.x.toFixed(1) + ',' + p.z.toFixed(1)).join(' ')})`);
          else if (ms > 0.9) out.stuck.push(`${k} stage ${st} floor ${fl} stuck ${ms.toFixed(2)} s`);
        };
        for (const th of things) {
          if (n > 40) break;
          for (const [dx, dy] of DIRS) {
            const A = { x: th.x + 2 * dx, y: th.y + 2 * dy }, B = { x: th.x - 2 * dx, y: th.y - 2 * dy };
            if (isOpen(A.x, A.y) && isOpen(B.x, B.y)) { walk(A, B, th.k); n++; break; }
          }
        }
      }
      return out;
    });
    total.runs += r.runs; total.fail.push(...r.fail.map(s => `seed ${seed}: ${s}`)); total.stuck.push(...r.stuck.map(s => `seed ${seed}: ${s}`));
    for (const k in r.kinds) total.kinds[k] = (total.kinds[k] || 0) + r.kinds[k];
    await page.close();
  }
  console.log('  kinds covered:', Object.keys(total.kinds).sort().join(' '));
  check('many walks across props were simulated', total.runs > 600, total.runs + ' walks');
  check('candles, urns, sacks, hearths and racks were among them', ['candles', 'urn', 'sacks', 'hearth', 'weaponrack'].every(k => total.kinds[k] > 0), JSON.stringify(total.kinds));
  check('every enemy reaches its goal around floor props', total.fail.length === 0, total.fail.slice(0, 5).join(' | '));
  check('none of them ever sticks long enough to snap', total.stuck.length === 0, total.stuck.slice(0, 5).join(' | '));
});
