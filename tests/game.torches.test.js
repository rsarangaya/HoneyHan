// Torches sit on things: every wall torch's plate is within 0.1 m of the real wall surface (box face, hedge, trunk, boulder), the rest stand on posts from the floor.
// Run on its own: node tests/game.torches.test.js
const { run } = require('./lib');
run('Torches hang on wall surfaces or stand on posts', async ({ open, check }) => {
  const seeds = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12];
  const tot = { wall: 0, post: 0, floors: 0, off: 0, floating: 0, dropped: 0, torches: 0, worstCalls: 0, kinds: new Set(), themes: new Set(), maxTrisPerTorch: 0, geos: [] };
  for (const seed of seeds) {
    const pg = await open(seed);
    const r = await pg.evaluate(async () => {
      const out = { wall: 0, post: 0, floors: 0, off: 0, floating: 0, dropped: 0, torches: 0, worstCalls: 0, kinds: [], themes: [], tpt: 0 };
      for (let s = 1; s <= 5; s++) {
        game.startStage(s);
        for (const n of s === 5 ? [1, 5] : [1, 3, 5]) {
          game.startFloor(n); await T.sleep(30);
          const f = game.floor; out.floors++; out.themes.push(theme.name); out.torches += f.torches.length; out.dropped += f.torches.length - f.torchMounts.length;
          for (const m of f.torchMounts) {
            if (m.kind === 'post') { out.post++; if (m.y !== 0) out.floating++; continue; }
            out.wall++;
            const tx = Math.floor(m.wx / TILE), ty = Math.floor(m.wz / TILE), s0 = wallSurface(tx, ty, m.nx, m.nz, m.y), d = Math.hypot(m.x - m.wx, m.z - m.wz) + 0.05;
            out.kinds.push(wallKinds.get(ty * f.w + tx));
            if (s0 === null || Math.abs(d - s0) > 0.1) out.off++;
          }
          if (n === 1 || n === 5) out.worstCalls = Math.max(out.worstCalls, game.renderInfo().calls);
        }
      }
      let tris = 0, k = 0; for (const g of [TORCH_STICK, TORCH_FLAME, TORCH_PLATE, TORCH_ARM]) tris += g.index.count / 3; out.tpt = tris;
      const geos = []; for (let i = 0; i < 3; i++) { game.startFloor(1); await T.sleep(40); geos.push(game.renderInfo().geos); } out.geos = geos;
      return out;
    });
    for (const k of ['wall', 'post', 'floors', 'off', 'floating', 'dropped', 'torches']) tot[k] += r[k];
    r.kinds.forEach(k => tot.kinds.add(k)); r.themes.forEach(k => tot.themes.add(k)); tot.worstCalls = Math.max(tot.worstCalls, r.worstCalls); tot.maxTrisPerTorch = Math.max(tot.maxTrisPerTorch, r.tpt); tot.geos.push(r.geos);
    await pg.close();
  }
  check(`checked ${tot.floors} floors, ${tot.wall} wall torches, ${tot.post} posts, ${tot.themes.size} themes`, tot.wall > 100 && tot.themes.size >= 8);
  check('torches sit on all of box, shrub, tree and rock walls', ['box', 'shrub', 'tree', 'rock'].every(k => tot.kinds.has(k)), [...tot.kinds].join(','));
  check('every wall torch plate is within 0.1 m of the wall surface', tot.off === 0, tot.off + ' off');
  check('every post stands on the floor', tot.floating === 0);
  check('few torch spots are dropped (tall decor, doors)', tot.dropped < tot.torches * 0.1, `${tot.dropped} of ${tot.torches}`);
  check('draw calls stay under 260', tot.worstCalls < 260, tot.worstCalls + '');
  check('a torch costs about 90 triangles', tot.maxTrisPerTorch <= 100, tot.maxTrisPerTorch + '');
  check('rebuilding a floor leaks no geometry', tot.geos.every(g => g[1] === g[0] && g[2] === g[0]), JSON.stringify(tot.geos));
});
