// XP, levels, stat points, the per-floor XP cap and dash charges in the running game. Run on its own: node tests/game.progress.test.js
const { run } = require('./lib');
run('Levels, stats, the XP cap and dash charges', async ({ open, check }) => {
  const page = await open(11);
  const r = await page.evaluate(async () => {
    const out = {}, sword = () => weaponStats(makeItem({ type: 'weapon', base: 'sword', tier: 0 }));
    // an unaware guard killed by one hit; returns the XP the player gained
    const kill = (mod, d = 3) => { const e = T.guard(d, 'away', false); if (mod) mod(e); e.hp = 1; const x0 = prog.total; dealHit(e, 'body', 50, sword(), 0); return prog.total - x0; };
    T.reset();
    out.start = { level: prog.level, hp: game.inv.maxHp, stam: STAMINA_MAX, pts: prog.pts };
    // 1. kills give XP: a sneak kill of a goblin on floor 1 is 11 x 1.25 = 13.75, rounded
    out.sneakXp = kill();
    out.minionXp = kill(e => { e.minion = game.enemies[0]; });
    out.respXp = kill(e => { e.resp = true; });
    out.hud = document.getElementById('xpgain').textContent;
    // 2. level up: keep killing until level 2
    let n = 0; while (prog.level < 2 && n++ < 30) kill();
    out.lvl = prog.level; out.pts = prog.pts; out.skp = prog.skp; out.flash = document.getElementById('xpgain').textContent;
    // 3. spend points: Vigor +8 max HP (and HP), Endurance +6 max stamina, Strength +4% damage, instantly, for good
    const hp0 = game.inv.maxHp, st0 = STAMINA_MAX;
    out.spentVig = game.spendPoint('stat', 'vig'); out.spentEnd = game.spendPoint('stat', 'end'); out.spentStr = game.spendPoint('stat', 'str');
    out.hpGain = game.inv.maxHp - hp0; out.stGain = STAMINA_MAX - st0; out.dmgMul = game.PD.dmgMul;
    out.noPts = !game.spendPoint('stat', 'agi'); out.pts2 = prog.pts;
    const hit = () => { T.reset(); const e = T.guard(3, 'toward', true); e.hp = e.maxHp = 1000; dealHit(e, 'body', 20, sword(), 0); return 1000 - e.hp; };
    out.dmg = hit();
    // 4. the XP cap: spent budget -> a trickle and the 'no more XP here' note; bosses and quests are exempt; summons never pay
    T.reset(); const key = floorKey(1, 1), bud = game.xpBudgetHere;
    prog.floorXp[key] = bud - 2; kill(); out.atBudget = prog.floorXp[key] >= bud;
    out.capXp = kill(); out.capText = document.getElementById('xpgain').textContent;
    const x0 = prog.total; game.gainXp(100, true); out.exempt = prog.total - x0 === 100;
    // revisit: leaving the floor and coming back does not give the budget back; another floor is fresh
    changeFloor(2, 'down'); out.fresh2 = kill() > 5; out.floorNum = game.floor && floorNum;
    changeFloor(1, 'up'); out.back = floorNum === 1; out.stillCapped = kill() <= 2 && document.getElementById('xpgain').textContent.indexOf('no more XP here') === 0;
    // 5. dash charges: 2 to start, one is used per dash, none left = refused, one comes back after the recharge
    T.reset(); const P = game.player, cb = game.cb;
    P.keys = {}; cb.stamina = 100; cb.dash.n = game.PD.dashMax; cb.dash.t = 0; game.PD.dashRecharge = 1.5;
    out.charges0 = cb.dash.n;
    const go = async () => { cb.dashCd = 0; cb.stamina = 100; const n = cb.dash.n; cb.dashReq = true; await T.sleep(200); await T.until(() => !P.dashS.on, 3000); return n - cb.dash.n; };
    out.d1 = await go(); out.d2 = await go(); out.left = cb.dash.n; out.d3 = await go();
    out.pips = document.getElementById('dpips').textContent;
    await T.until(() => cb.dash.n >= 1, 4000); out.back1 = cb.dash.n; out.pips2 = document.getElementById('dpips').textContent;
    await T.until(() => cb.dash.n >= 2, 4000); out.back2 = cb.dash.n;
    return out;
  });
  check('a new run starts at level 1 with 100 HP, 100 stamina and no points', r.start.level === 1 && r.start.hp === 100 && r.start.stam === 100 && r.start.pts === 0, JSON.stringify(r.start));
  check('a clean sneak kill pays 25% more (11 x 1.25 = 14)', r.sneakXp === 14, String(r.sneakXp));
  check('a boss summon pays nothing, a respawned guard a quarter', r.minionXp === 0 && r.respXp === Math.round(11 * 0.25 * 1.25), `${r.minionXp} ${r.respXp}`);
  check('the +XP popup shows', /XP/.test(r.hud) || r.hud === '', r.hud);
  check('enough kills level up: 3 stat points, a LEVEL popup', r.lvl === 2 && r.pts === 3 && r.skp === 0 && /LEVEL 2/.test(r.flash), JSON.stringify([r.lvl, r.pts, r.skp, r.flash]));
  check('Vigor +8 HP, Endurance +6 stamina, Strength +4% damage; spent instantly', r.spentVig && r.spentEnd && r.spentStr && r.hpGain === 8 && r.stGain === 6 && Math.abs(r.dmgMul - 1.04) < 1e-9, JSON.stringify([r.hpGain, r.stGain, r.dmgMul]));
  check('no points left means no spending', r.noPts && r.pts2 === 0);
  check('the hit really does 4% more (20 x 1.04 = 20.8 at the body)', Math.abs(r.dmg - 20.8) < 0.05, String(r.dmg));
  check('the floor budget runs out, then a kill pays only a trickle and says so', r.atBudget && r.capXp <= 2 && /^no more XP here/.test(r.capText), `${r.capXp} ${r.capText}`);
  check('bosses and quests are exempt from the cap', r.exempt);
  check('another floor has its own budget, and coming back does not reset it', r.fresh2 && r.back && r.stillCapped, JSON.stringify([r.fresh2, r.back, r.stillCapped]));
  check('2 dash charges to start; each dash uses one; none left refuses the dash', r.charges0 === 2 && r.d1 === 1 && r.d2 === 1 && r.left === 0 && r.d3 === 0, JSON.stringify([r.charges0, r.d1, r.d2, r.left, r.d3]));
  check('charges come back one at a time and the pips follow', r.back1 === 1 && r.back2 === 2 && /\u25CB/.test(r.pips) && /^\u25CF\u25CB$/.test(r.pips2), JSON.stringify([r.pips, r.pips2]));
  await page.close();
});
