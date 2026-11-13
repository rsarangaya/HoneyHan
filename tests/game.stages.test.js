// Stages: four themed stages of five floors, the placeholder final boss, the way between stages (down by the safe room's
// stairs; up only into cached floors, otherwise sealed), stage scaling and loot depth, the memory bound, HUD text, the stage
// start message, glossary cards and the run's end and restart. Run on its own: node tests/game.stages.test.js
const { run } = require('./lib');

// Page-side helpers. goDown and goUp teleport the player onto the stairs (the same trick as game.stairs.test.js); the frame loop
// then takes the stairs. killBoss turns the boss's last hit into a kill through the real damage code.
const STAGE_HELPERS = () => {
  window.ST = {
    goDown() { const f = game.floor, P = game.player; P.x = (f.stairs.x + 0.5) * TILE; P.z = (f.stairs.y + 0.5) * TILE + 1.1; },
    goUp() { const u = upBox, P = game.player; P.x = (u.x0 + u.x1) / 2; P.z = u.dir > 0 ? u.z0 + 0.1 : u.z1 - 0.1; },
    // Stand 4 m south of the arena boss facing it, let the glossary see it (the real discovery code), then land one blow.
    killBoss() {
      const b = game.enemies.find(e => e.boss), P = game.player;
      P.x = b.x; P.z = b.z + 4; P.yaw = Math.atan2(-(b.x - P.x), -(b.z - P.z)); P.keys = {};
      discoverEnemiesInView();
      b.hp = 1; dealHit(b, 'body', 20, weaponStats(makeItem({ type: 'weapon', base: 'sword', tier: 0 })), 0);
      return b;
    },
    cached() { let n = 0; for (const c of Object.values(game.stageCaches)) n += Object.keys(c).length; return n; },
    snap() { const i = game.inv; return { gold: i.gold, pack: i.pack.map(x => x.kind || x.type).join(','), hp: i.hp, maxHp: i.maxHp, hunger: game.hunger.v, stam: i.stamBonus }; },
    log() { return document.getElementById('log').textContent; },
    rec() {
      const f = game.floor, r = game.renderInfo();
      return { s: stage, n: floorNum, shop: !!f.shop, armory: f.rooms.some(x => x.theme === 'armory'), quest: f.quest ? f.quest.type : null,
        plan: questPlan[floorNum] || null, hud: document.getElementById('floor').textContent, theme: document.getElementById('theme').textContent,
        log: document.getElementById('log').textContent, cached: ST.cached(), geos: r.geos, tex: r.tex, rng: gameRng(), boss: !!f.boss, final: !!(f.enemies.find(e => e.boss) || {}).final };
    },
  };
};

run('Four stages, the final boss, the way between stages, scaling, memory and HUD', async ({ open, check }) => {
  let page = await open(7);
  await page.evaluate(STAGE_HELPERS);

  // 1. Themes: four different ones from the pool, stage 1 is the seed's own theme, and the same seed gives the same four.
  const th = await page.evaluate(() => ({ names: stageThemes.map(t => t.name), bossNames: stageThemes.map(t => bossNameFor(t.name)), pool: THEMES.map(t => t.name), seedPick: makeRng(runSeed).pick(THEMES).name, final: FINAL_THEME.name }));
  const again = await open(7);
  const th2 = await again.evaluate(() => stageThemes.map(t => t.name));
  await again.close();
  check('stages 1 to 4 get four different themes from the pool, stage 1 keeps the seed theme, the same seed repeats them',
    new Set(th.names).size === 4 && th.names.every(n => th.pool.includes(n)) && th.names[0] === th.seedPick && !th.names.includes(th.final) && th2.join('|') === th.names.join('|'), th.names.join(' / '));

  // 2. Scaling (no transitions): goblin HP and damage per stage and floor, the stage bosses, the final boss, the loot depth.
  const sc = await page.evaluate(() => {
    const out = {}, mk = () => new Enemy({ x: floor.start.x, y: floor.start.y, route: [floor.start, floor.start], seed: 12345, type: 'goblin' }, floor);
    game.startStage(2); game.startFloor(1); let e = mk(); out.g2 = e.maxHp; out.g2dmg = e.dmgMul / e.T.dmgMul;
    game.startStage(2); game.startFloor(3); out.g2f3 = mk().maxHp;
    game.startStage(1); game.startFloor(1); out.g1 = mk().maxHp;
    out.boss = [];
    for (const s of [1, 2, 3, 4]) { game.startStage(s); game.startFloor(5); const b = game.enemies.find(x => x.boss); out.boss.push([b.maxHp, b.dmgMul, b.final]); }
    game.startStage(5); const fb = game.enemies.find(x => x.boss); out.final = [fb.maxHp, fb.dmgMul, fb.final, fb.scaleK / BOSS_SCALE];
    game.startStage(3); game.startFloor(2); out.eff32 = effFloor();
    game.startStage(4); game.startFloor(4); out.eff44 = effFloor();
    game.startStage(1);
    return out;
  });
  check('stage 2 floor 1 goblin: 55 HP x 1.35 = 74.25, damage x 1.2', Math.abs(sc.g2 - 74.25) < 1e-6 && Math.abs(sc.g2dmg - 1.2) < 1e-9, `${sc.g2} HP, x${sc.g2dmg.toFixed(3)} damage`);
  check('stage 2 floor 3 goblin stacks the floor and stage scaling (55 x 1.24 x 1.35)', Math.abs(sc.g2f3 - 55 * 1.24 * 1.35) < 1e-6, sc.g2f3.toFixed(2));
  check('stage 1 goblins are unchanged (55 HP)', Math.abs(sc.g1 - 55) < 1e-6, String(sc.g1));
  const bossWant = [[220, 1.4], [330, 1.68], [440, 1.96], [550, 2.24]];
  check('stage bosses: HP 220 x (1 + 0.5 x (stage - 1)), damage x (1 + 0.2 x (stage - 1))',
    sc.boss.every(([hp, dm, fin], i) => Math.abs(hp - bossWant[i][0]) < 1e-6 && Math.abs(dm - bossWant[i][1]) < 1e-9 && !fin), JSON.stringify(sc.boss.map(b => b.slice(0, 2))));
  check('the final boss: 660 HP (3x), damage 1.8x the stage 1 boss, drawn 1.25x bigger',
    Math.abs(sc.final[0] - 660) < 1e-6 && Math.abs(sc.final[1] - 2.52) < 1e-9 && sc.final[2] && Math.abs(sc.final[3] - 1.25) < 1e-9, JSON.stringify(sc.final));
  check('loot depth follows the stage: effFloor = floor + 1.5 x (stage - 1)', Math.abs(sc.eff32 - 5) < 1e-9 && Math.abs(sc.eff44 - 8.5) < 1e-9, `stage 3 floor 2: ${sc.eff32}, stage 4 floor 4: ${sc.eff44}`);

  // 3. The run: 4 stages x 5 floors by the real stairs, the boss of each stage killed, then the final arena. Recorded as it goes.
  const A = await page.evaluate(async () => {
    const out = { recs: [], maxCached: 0, climbs: {}, hudOK: {}, disc: {}, first: {} };
    const rec = () => { const r = ST.rec(); out.maxCached = Math.max(out.maxCached, r.cached); out.recs.push(r); return r; };
    const inv = game.inv;
    game.startStage(1); game.startFloor(1); await T.sleep(150);
    game.inv.hp = 60; inv.maxHp = 85; inv.gold = 150; inv.stamBonus = 0.25; game.hunger.v = 40; inv.add({ type: 'potion', kind: 'heal', n: 1 });
    const before = ST.snap();
    for (let s = 1; s <= 4; s++) {
      if (s > 1) await T.until(() => stage === s && floorNum === 1, 8000);
      await T.sleep(150);
      const first = rec(); out.first[s] = first;
      if (s === 2) out.pack = { before, after: ST.snap() };
      if (s === 2) {                                                 // stage 2 floor 1 climbs into stage 1's safe room; the floor beyond it is sealed
        const f21 = game.floor, s1 = out.s1Boss;
        ST.goUp(); await T.until(() => stage === 1 && floorNum === 5, 6000); await T.sleep(150);
        const f15 = game.floor, en = game.enemies.length, pr = propObjs.length, c0 = ST.cached();
        out.climbs.into = { stage: stage, n: floorNum, sameArena: game.floor === s1, msg: ST.log().slice(-200) };
        ST.goUp(); await T.sleep(700);                              // stage 1 floor 4 was trimmed when stage 2 was entered: sealed
        out.climbs.sealed = { stage: stage, n: floorNum, sameFloor: game.floor === f15, enemies: game.enemies.length === en, props: propObjs.length === pr, cached: ST.cached() === c0, log: ST.log().slice(-200) };
        ST.goDown(); await T.until(() => stage === 2 && floorNum === 1, 6000); await T.sleep(150);
        out.climbs.back = game.floor === f21;
      }
      for (let n = 1; n <= 5; n++) {
        if (n > 1) { await T.until(() => stage === s && floorNum === n, 8000); await T.sleep(120); }
        const r = n === 1 ? first : rec();
        if (n > 1) r.note = 'arrived';
        if (n === 3) out.hudOK[s] = r.hud;
        if (n === 5) { if (s === 1) out.s1Boss = game.floor; out.bossRec = r; }
        if (n < 5) { ST.goDown(); continue; }
        ST.killBoss();
        const opened = await T.until(() => game.floor.safe.open, 5000);
        out.disc[s] = discovered.has('enemy:boss:' + bossNameFor(theme.name));
        if (!opened) break;
        ST.goDown();
      }
      if (s === 4) {                                                 // the safe room's stairs of stage 4 lead to the final arena
        await T.until(() => stage === 5 && floorNum === 1, 8000); await T.sleep(150);
        const fin = rec(); out.first[5] = fin;
        // climb to stage 4's safe room (cached) and try to go further up (sealed); then back down to the same arena
        const f51 = game.floor, s4 = game.enemies.length;
        ST.goUp(); await T.until(() => stage === 4 && floorNum === 5, 6000); await T.sleep(150);
        const f45 = game.floor;
        out.climbs.final = { stage: stage, n: floorNum };
        ST.goUp(); await T.sleep(700);                              // stage 4 floor 4 was trimmed: sealed
        out.climbs.finalSealed = { same: game.floor === f45 && stage === 4 && floorNum === 5, log: ST.log().slice(-160) };
        ST.goDown(); await T.until(() => stage === 5 && floorNum === 1, 6000); await T.sleep(150);
        out.climbs.finalBack = game.floor === f51 && game.enemies.length === s4;
        out.finalRec = rec();
        // the final boss: its glossary card, then the kill
        const b = game.enemies.find(x => x.boss); out.finalBoss = { final: !!b.final, maxHp: b.maxHp };
        ST.killBoss();
        out.won = await T.until(() => game.state === 'won', 6000);
        out.overlay = document.getElementById('overlayText').textContent.slice(0, 80);
        out.discFinal = discovered.has('enemy:boss:' + FINAL_BOSS.name);
      }
    }
    out.finalState = game.state; out.maxCached = Math.max(out.maxCached, ST.cached());
    return out;
  });

  // Checks from the run
  const recs = A.recs;
  const shopFloors = [1, 2, 3, 4].map(s => recs.filter(r => r.s === s && r.n <= 4 && r.shop).length);
  const armFloors = [1, 2, 3, 4].map(s => recs.filter(r => r.s === s && r.n <= 4 && r.armory).length);
  check('each stage has exactly one shop floor and one armory floor among floors 1 to 4', shopFloors.every(v => v === 1) && armFloors.every(v => v === 1), `shops ${shopFloors}, armories ${armFloors}`);
  const planOK = recs.filter(r => r.n <= 4).every(r => (r.quest || null) === (r.plan || null));
  check('each stage runs its own encounter plan (the floor carries the type rolled for it)', planOK);
  const perStage = [1, 2, 3, 4].map(s => { const q = recs.filter(r => r.s === s && r.n <= 4 && r.quest); return { prisoner: q.filter(r => r.quest === 'prisoner').length, ally: q.filter(r => r.quest === 'ally').length }; });
  check('at most one prisoner and one ally per stage', perStage.every(p => p.prisoner <= 1 && p.ally <= 1), JSON.stringify(perStage));
  check('the stage-start message names the stage and its theme',
    [2, 3, 4].every(s => A.first[s].log.includes(`Stage ${s} of 4: ${th.names[s - 1]}`)) && A.first[5].log.includes('The final stage'), A.first[2].log.slice(-90));
  check('HUD reads "Stage s / 4 - Floor n / 5 - Theme" and the theme line', [1, 2, 3, 4].every(s => A.hudOK[s] === `Stage ${s} / 4 - Floor 3 / 5 - ${th.names[s - 1]}`), Object.values(A.hudOK).join(' | '));
  check('HUD on the boss floor and in the final stage', /Floor 5 \/ 5 - .* \(boss floor\)$/.test(A.bossRec.hud) && A.first[5].hud === 'Final stage', `${A.bossRec.hud} | ${A.first[5].hud}`);
  check('the stage bosses and the final boss get their own glossary cards once seen', [1, 2, 3, 4].every(s => A.disc[s]) && A.discFinal, JSON.stringify(A.disc));

  const p2 = A.pack;
  check('the pack carries over: items, gold, hunger, HP, max HP and the stamina boon', p2 && p2.after.pack === p2.before.pack && p2.after.gold === p2.before.gold && p2.after.maxHp === 85 && p2.after.hp === 60 && p2.after.stam === 0.25 && Math.abs(p2.after.hunger - p2.before.hunger) < 2, JSON.stringify(p2));
  check('each stage starts with a new seeded RNG (distinct values)', new Set([1, 2, 3, 4, 5].map(s => A.first[s].rng)).size === 5);
  check('floor cache holds at most 6 floors at every point of the run', A.maxCached <= 6, `max ${A.maxCached}`);

  // Floor 1 arrivals of stages 2 to 4 (each holds the previous stage's boss floor, the rest is trimmed). Layouts differ per stage,
  // so the geometry count moves with the layout and the theme (the Jungle and the Chapel have more furniture kinds; 75 to 180 seen); the check is that it stays bounded (a leak would climb past it, and tests/game.jungle.test.js rebuilds a floor and compares), and textures stay flat.
  const g = [2, 3, 4].map(s => A.first[s].geos), t = [2, 3, 4, 5].map(s => A.first[s].tex);
  check('renderer geometries stay bounded stage over stage, and textures stay flat (floor 1 arrivals)', g.every(v => v < 260) && t.every(v => v === t[0]),
    `geometries stage 2/3/4 ${g.join('/')}, final arena ${A.first[5].geos}; textures ${t.join('/')} (stage 1: ${A.first[1].geos}/${A.first[1].tex})`);

  const c = A.climbs;
  check('from stage 2 floor 1, going up enters stage 1\'s safe room (its cached arena)', c.into && c.into.stage === 1 && c.into.n === 5 && c.into.sameArena, JSON.stringify(c.into && { s: c.into.stage, n: c.into.n }));
  check('climbing further from there is sealed: same floor, no new enemies or props, no new cache entry', c.sealed && c.sealed.stage === 1 && c.sealed.n === 5 && c.sealed.sameFloor && c.sealed.enemies && c.sealed.props && c.sealed.cached, JSON.stringify(c.sealed));
  check('going back down returns to the same stage 2 floor 1 (kept, not rebuilt)', c.back === true);
  check('from stage 5 (final) floor 1, going up enters stage 4\'s safe room; further up is sealed', c.final && c.final.stage === 4 && c.final.n === 5 && c.finalBack === true && c.finalSealed && c.finalSealed.same, JSON.stringify(c.final));

  check('the final arena is a boss arena with the placeholder final boss, and the run ends in "Run complete"', A.finalBoss.final && A.finalBoss.maxHp === 660 && A.won && /Run complete/.test(A.overlay) && A.finalState === 'won', `${A.finalState}, ${A.overlay}`);
  check('the final stage has no shop or armory floor', A.first[5].shop === false && A.first[5].armory === false);

  // The glossary lists the stage bosses (their names show once discovered) and the final boss.
  const gl = await page.evaluate(() => { pauseMenu.open('glossary'); document.querySelector('#pauseMenu [data-g="enemies"]').click(); const txt = document.getElementById('pauseMenu').textContent; pauseMenu.close(); return txt; });
  check('the glossary shows each stage boss card and the placeholder final boss card', th.bossNames.every(n => gl.includes(n)) && gl.includes('The Final Boss') && gl.includes('Placeholder final boss'), gl.length + ' chars');

  // Restart from the win screen: the overlay button starts a new run on a new seed.
  const url0 = page.url();
  await page.click('#overlayText button');
  await page.waitForURL(u => u.toString() !== url0, { timeout: 8000 });
  await page.waitForFunction(() => window.game && game.floor, null, { timeout: 10000 });
  await page.click('#overlay', { position: { x: 5, y: 5 } });
  const restarted = await page.waitForFunction(() => game.state === 'play' && game.stage === 1, null, { timeout: 8000 }).then(() => true, () => false);
  check('the restart button starts a new run on a new seed at stage 1', restarted && page.url() !== url0, page.url().split('?')[1]);

  await page.close();
});
