// Round walls: shrub hedges + apple trees (Orchard), trees (Jungle), cave rock (Cellar) are visual only; the other themes keep boxes.
// Run on its own: node tests/game.walls.test.js
const { run } = require('./lib');
run('Round walls (shrub, tree, rock)', async ({ open, check }) => {
  let page = await open(7);
  const seeds = await page.evaluate(() => { const out = {}; for (let s = 1; s < 400 && Object.keys(out).length < THEMES.length; s++) { const n = makeRng(s).pick(THEMES).name; if (!out[n]) out[n] = s; } return out; });
  await page.close();
  const STYLE = { 'The Moonlit Orchard': 'shrub', 'The Overgrown Ruin': 'tree', 'The Mushroom Cellar': 'rock' };
  for (const [name, seed] of Object.entries(seeds)) {
    const pg = await open(seed);
    const r = await pg.evaluate(async () => {
      const out = { style: theme.wallStyle, floors: [] };
      for (const n of [1, 2, 3, 4]) {
        game.startFloor(n); await T.sleep(80);
        const f = game.floor, P = game.player, meshes = [];
        group.traverse(o => { if (o.isInstancedMesh) meshes.push(o); });
        const i = game.renderInfo(); let tris = 0, boxes = 0, notShared = 0, badTile = 0, reach = 0, overW = 0;
        for (const im of meshes) {
          const g = im.geometry; if (g.type === 'BoxGeometry') boxes++; if (!g.userData.shared && g.type !== 'BoxGeometry') notShared++;
          tris += im.count * (g.index ? g.index.count / 3 : g.attributes.position.count / 3);
          const pos = g.attributes.position; for (let k = 0; k < pos.count; k++) reach = Math.max(reach, Math.hypot(pos.getX(k), pos.getZ(k)));
          const m = new THREE.Matrix4(), v = new THREE.Vector3();
          for (let k = 0; k < im.count; k++) { im.getMatrixAt(k, m); v.setFromMatrixPosition(m); if (v.x === 0 && v.z === 0) continue; if (f.tiles[Math.floor(v.z / TILE) * f.w + Math.floor(v.x / TILE)] !== T_WALL) badTile++; }
        }
        // tile collision: a wall tile touching the open floor still blocks at its centre and just inside its edge
        let blockedOk = true, tested = 0;
        for (let y = 1; y < f.h - 1 && tested < 40; y++) for (let x = 1; x < f.w - 1 && tested < 40; x++) {
          if (f.tiles[y * f.w + x] !== T_WALL || f.tiles[y * f.w + x - 1] === T_WALL) continue;
          tested++; if (!P.blocked(f, (x + 0.5) * TILE, (y + 0.5) * TILE) || !P.blocked(f, (x + 0.1) * TILE, (y + 0.5) * TILE)) blockedOk = false;
        }
        out.floors.push({ n, calls: i.calls, tris: i.tris, wallTris: tris, meshes: meshes.length, boxes, notShared, badTile, reach, blockedOk, tested, geos: i.geos });
      }
      const geos = []; for (let k = 0; k < 3; k++) { game.startFloor(1); await T.sleep(80); geos.push(game.renderInfo().geos); } out.geos = geos;
      return out;
    });
    const want = STYLE[name], round = !!want;
    check(`${name}: wallStyle ${want || 'box'}`, r.style === (want || 'box'), r.style);
    check(`${name}: wall meshes are ${round ? 'round shared geometry (no boxes)' : 'boxes'}, at most 3 wall draws`, r.floors.every(f => f.meshes >= 1 && f.meshes <= 3 && (round ? f.boxes === 0 && f.notShared === 0 : f.boxes === f.meshes)), JSON.stringify(r.floors.map(f => [f.meshes, f.boxes, f.notShared])));
    check(`${name}: wall instances sit on wall tiles and walls still block (tile collision unchanged)`, r.floors.every(f => f.badTile === 0 && f.blockedOk && f.tested > 0), JSON.stringify(r.floors.map(f => [f.badTile, f.blockedOk, f.tested])));
    check(`${name}: worst floor stays under 150k triangles and 220 draw calls`, r.floors.every(f => f.tris < 150000 && f.calls < 220), r.floors.map(f => `${f.calls}c/${(f.tris / 1000).toFixed(0)}k wall ${(f.wallTris / 1000).toFixed(0)}k`).join(', '));
    if (round) check(`${name}: blobs reach at most 1.75 m from the tile centre (about 0.25 m past the edge)`, r.floors.every(f => f.reach <= 1.76 + 1e-6), r.floors.map(f => f.reach.toFixed(2)).join(', '));
    check(`${name}: rebuilding a floor leaks no geometry`, r.geos[1] === r.geos[0] && r.geos[2] === r.geos[0], r.geos.join(', '));
    await pg.close();
  }
});
