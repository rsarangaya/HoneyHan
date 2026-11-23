// Water, ale and ice decals are organic shared shapes, merged with the floor. Run on its own: node tests/game.decals.test.js
const { run } = require('./lib');
run('Organic water and ice decals', async ({ open, check }) => {
  let page = await open(7);
  const seeds = await page.evaluate(() => { const out = {}; for (let s = 1; s < 400 && Object.keys(out).length < THEMES.length; s++) { const n = makeRng(s).pick(THEMES).name; if (!out[n]) out[n] = s; } return out; });
  await page.close();
  for (const [theme, kind] of [['The Sunken Tavern', 'puddle'], ['The Frozen Chapel', 'ice']]) {
    page = await open(seeds[theme]);
    const r = await page.evaluate(kind => {
      const decals = new Set(Object.keys(GEO).filter(k => /^(blob|ice|ripple)/.test(k)).map(k => GEO[k]));
      let loose = 0; game.group.traverse(o => { if (o.isMesh && decals.has(o.geometry)) loose++; });
      return { n: game.floor.decor.filter(d => d.kind === kind).length, shapes: decals.size, loose };
    }, kind);
    check(`${theme}: has ${kind} decals`, r.n > 0, r.n);
    check(`${theme}: few shared decal shapes (at most 21 blobs + 10 ice + 3 ripples)`, r.shapes <= 34, r.shapes);
    check(`${theme}: decals are merged into the floor, none left loose`, r.loose === 0, r.loose);
    await page.close();
  }
  page = await open(seeds['The Sunken Tavern']);
  const b = await page.evaluate(() => {
    const mv = { puddle: { dur: 5, r: 1.2, slow: 0.7 } }; bossPuddlesClear(); bossPuddleAdd(10, 10, mv);
    const m = game.group.userData.bossFx.pud[0], inside = bossPuddleMul(10 + 1.2, 10) === 0.7, outside = bossPuddleMul(10 + 1.4, 10) === 1;
    const geos = new Set(); for (let i = 0; i < 20; i++) { bossPuddleAdd(10, 10, mv); geos.add(game.group.userData.bossFx.pud[i % 6].geometry); }
    bossPuddlesClear(); bossLanesClear(); bossLaneAdd({ x: 5, z: 5, yaw: 0 }, { lane: { dur: 5 }, len: 14, width: 2.4 });
    const lane = bossLaneAt(5, 5 - 7) && bossLaneAt(5 + 1.25, 5 - 7) && !bossLaneAt(5 + 1.4, 5 - 7), box = game.group.userData.bossFx.lane[0].geometry; box.computeBoundingBox();
    const bb = box.boundingBox; bossLanesClear();
    return { inside, outside, geos: geos.size, lane, lx: bb.max.x <= 0.5 && bb.min.x >= -0.5 && bb.max.z <= 0 && bb.min.z >= -1 };
  });
  check('ale puddle: hit radius unchanged', b.inside && b.outside);
  check('ale puddles use a few shared outlines', b.geos > 1 && b.geos <= 7, b.geos);
  check('ice lane: hit shape unchanged, ragged visual stays inside the rectangle', b.lane && b.lx);
  await page.close();
});
