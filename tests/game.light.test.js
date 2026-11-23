// Baked torch light (js/light.js): the static light of a floor is a light grid read by every Lambert and Phong material; the lantern is the only real light.
// Run on its own: node tests/game.light.test.js
const { run } = require('./lib');
run('Torch light is baked into a light grid', async ({ open, check }) => {
  const pg = await open(7);
  // 1. A synthetic floor: a torch in a room, a wall column, a second room behind it. The far room stays dark, the near side is lit, walls hold no light, doors block.
  const syn = await pg.evaluate(() => {
    const w = 8, h = 3, tiles = new Uint8Array(w * h).fill(T_FLOOR);
    for (let y = 0; y < h; y++) { tiles[y * w] = T_WALL; tiles[y * w + w - 1] = T_WALL; tiles[y * w + 4] = T_WALL; }   // wall column at x = 4
    const b = bakeLights({ w, h, tiles }, [{ lx: 2.5 * TILE, lz: 1.5 * TILE, y: 2, color: 0xffffff, str: 1 }]);
    const d = b.tex.image.data, nx = w * TILE / BAKE_RES, at = (x, z) => d[((Math.floor(z / BAKE_RES)) * nx + Math.floor(x / BAKE_RES)) * 4];
    const out = { under: at(2.5 * TILE, 1.5 * TILE), near: at(2.5 * TILE + 1.5, 1.5 * TILE), far: at(2.5 * TILE + 4, 1.5 * TILE), behind: at(5.5 * TILE, 1.5 * TILE), inWall: at(4.5 * TILE - 1.4, 1.5 * TILE), tw: b.tex.image.width, th: b.tex.image.height };
    tiles[1 * w + 4] = T_FLOOR; const b2 = bakeLights({ w, h, tiles }, [{ lx: 2.5 * TILE, lz: 1.5 * TILE, y: 2, color: 0xffffff, str: 1 }]);   // the wall gets a gap: light goes through
    const d2 = b2.tex.image.data; out.gapLit = d2[((Math.floor(1.5 * TILE / BAKE_RES)) * nx + Math.floor(5.5 * TILE / BAKE_RES)) * 4];
    bakeFree(b); bakeFree(b2); return out;
  });
  check('the grid has 0.5 m texels (6 per tile)', syn.tw === 8 * 6 && syn.th === 3 * 6, JSON.stringify([syn.tw, syn.th]));
  check('light is brightest at the torch and falls off with distance', syn.under > syn.near && syn.near > syn.far && syn.far > 0, JSON.stringify(syn));
  check('a wall stops the light: the room behind it is dark, the gap in the wall lets it through', syn.behind === 0 && syn.gapLit > 0, `behind ${syn.behind}, gap ${syn.gapLit}`);
  check('a wall tile itself holds no light', syn.inWall === 0, syn.inWall + '');

  // 2. Real floors: every floor of every theme has a grid, no torch is a real light, the shaders compile, a floor rebuild leaks no textures, and a cached floor brings its own grid back.
  const r = await pg.evaluate(async () => {
    const out = { floors: 0, noGrid: 0, lights: 0, themes: [], diag: 0, bad: 0, lit: 0, texLeak: [], cacheBack: true, lantern: 0 };
    for (let s = 1; s <= 5; s++) {
      game.startStage(s);
      for (const n of s === 5 ? [1] : [1, 3, 5]) {
        game.startFloor(n); await T.sleep(30); out.floors++; out.themes.push(theme.name);
        const b = game.group.userData.bake; if (!b || BAKE.map.value !== b.tex) out.noGrid++;
        let pl = 0; scene.traverse(o => { if (o.isPointLight && o.visible) pl++; }); out.lights = Math.max(out.lights, pl);
        let any = 0; const d = b ? b.tex.image.data : []; for (let i = 0; i < d.length; i += 4) if (d[i] > 0) any++; if (any > 50) out.lit++;
      }
    }
    game.draw(); out.diag = renderer.info.programs.filter(p => p.diagnostics).length;   // a shader error would leave diagnostics on the program
    const tx = []; for (let i = 0; i < 3; i++) { game.startFloor(1); await T.sleep(40); tx.push(renderer.info.memory.textures); } out.texLeak = tx;
    game.startStage(1); game.startFloor(1); await T.sleep(30);
    game.startFloor(2); await T.sleep(30);
    const g2 = game.group.userData.bake; game.startFloor(1); await T.sleep(30); game.startFloor(2); await T.sleep(30);   // floor 2 comes back from the cache
    out.cacheBack = BAKE.map.value === game.group.userData.bake.tex;
    out.protoLambert = THREE.MeshLambertMaterial.prototype.onBeforeCompile === bakeLambert && THREE.MeshPhongMaterial.prototype.onBeforeCompile === bakePhong;
    return out;
  });
  check(`${r.floors} floors in ${new Set(r.themes).size} themes each own a light grid that is the one in use`, r.noGrid === 0 && r.floors >= 13 && new Set(r.themes).size >= 5, r.noGrid + ' without');
  check('the grids hold light (torches, hearths and stair glows were baked)', r.lit === r.floors, r.lit + '/' + r.floors);
  check('only the lantern is a real light (it was 6 point lights)', r.lights <= 1, r.lights + '');
  check('the patched Lambert and Phong shaders compile', r.diag === 0 && r.protoLambert, r.diag + ' programs with errors');
  check('rebuilding a floor leaks no textures', r.texLeak[1] === r.texLeak[0] && r.texLeak[2] === r.texLeak[0], JSON.stringify(r.texLeak));
  check('a floor brought back from the cache uses its own grid again', r.cacheBack);
  await pg.close();
});
