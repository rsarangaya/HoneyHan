// Every boss fought in co-op: two pages in one headless Chromium. node tests/game.coopboss.test.js [bossId ...]
// For each boss: the same arena on both, the guest sees it move, pose and fly, every move reaches the guest, summons exist on both, both
// players' hits land, defeat happens once with shared loot, and both go on. (Solo boss fights are covered by tests/game.bosses.test.js.)
const { run } = require('./lib');

const BOSSES = ['scarecrow', 'mushroom', 'lich', 'giant', 'werewolf', 'innkeeper', 'warlord', 'dragon'];
const only = process.argv.slice(2);

async function connect(host, guest) {
  const invite = await host.evaluate(() => coop.hostInvite());
  const answer = await guest.evaluate(c => coop.join(c), invite);
  await host.evaluate(c => coop.hostConnect(c), answer);
  const up = () => T.until(() => coop.on && coopS.ready, 20000);
  return (await host.evaluate(up)) && (await guest.evaluate(up));
}

// page side: build the boss's arena the same way on both pages
const arena = id => {
  const d = BOSS_DEFS[id], final = id === 'dragon';
  if (!final) stageThemes = [THEME_BY_NAME[d.theme], ...stageThemes.slice(1)];
  hud.overlay.style.display = 'none'; state = 'play';
  startStage(final ? FINAL_STAGE : 1); if (!final) startFloor(MAX_FLOOR);
  coopS.fk = -1; coopS.byRef = null; coop.down = false; coopS.rp.down = false;
  inv.maxHp = inv.hp = 1e5; inv.equip.weapon = makeItem({ type: 'weapon', base: 'sword', tier: 0 });
  const b = enemies.find(e => e.boss);
  return { def: b.def.id, nid: b.nid, hp: b.maxHp, x: b.x, z: b.z };
};
// page side: stand dx, dz from the boss (or from a point), facing it, on open floor
const near = ([x, z]) => { player.x = x; player.z = z; player.vx = player.vz = 0; const b = enemies.find(e => e.boss); player.yaw = Math.atan2(-(b.x - x), -(b.z - z)); player.pitch = 0; };
const heal = () => { inv.hp = inv.maxHp; pst.clear(); knock.m = 0; cb.block = false; cb.want = false; };

async function fight(host, guest, id, check, first) {
  const final = id === 'dragon', ok = (name, v, detail) => check(`${id}: ${name}`, v, detail);
  const a = await host.evaluate(arena, id), b = await guest.evaluate(arena, id);
  ok('the same boss arena on both', a.def === b.def && a.nid === b.nid && a.hp === b.hp && Math.abs(a.x - b.x) < 0.01, `${a.def}/${b.def}`);
  const home = { x: a.x, z: a.z };
  // the arena is quiet until we say so
  await host.evaluate(() => {
    window.calls = window.calls || { defeat: 0, wrapped: false };
    if (!calls.wrapped) { calls.wrapped = true; const f = bossDefeated; bossDefeated = e => { calls.defeat++; f(e); }; }
    calls.defeat = 0;
    const b = enemies.find(e => e.boss); b.atkCd = 1e9;
  });
  await host.evaluate(near, [home.x, home.z + 6]);
  await guest.evaluate(near, [home.x + 1.5, home.z + 6]);
  await host.evaluate(() => T.sleep(500));
  await host.evaluate(() => { const b = enemies.find(e => e.boss); b.dormant = false; b.set('alerted'); b.atkCd = 1e9; b.last = { x: player.x, z: player.z }; });
  ok('it wakes for the guest too (health bar up)', await guest.evaluate(() => T.until(() => { const b = enemies.find(e => e.boss); return !b.dormant && document.getElementById('boss').style.display === 'block'; }, 4000)));

  // movement: send it somewhere and compare (a flying boss: put it in the air)
  await host.evaluate(([h, final]) => { const b = enemies.find(e => e.boss); if (final) { b.bs.st = 'chase'; b.bs.hx = h.x; b.bs.hz = h.z; bossTakeoff(b); b.bs.cyc = 1e9; b.atkCd = 1e9; } }, [home, final]);
  await host.evaluate(ms => T.sleep(ms), final ? 2500 : 1500);
  const where = () => { const b = enemies.find(e => e.boss); return { x: b.x, z: b.z, alt: b.alt, air: b.bs.air, walk: b.walkT }; };
  const m1 = await host.evaluate(where), g1 = await guest.evaluate(where);
  const gap = Math.hypot(m1.x - g1.x, m1.z - g1.z), moved = Math.hypot(m1.x - home.x, m1.z - home.z);
  ok('the guest sees it move' + (final ? ' and fly' : ''), moved > 0.5 && gap < (final ? 3 : 1.5) && (!final || (g1.air && m1.alt > 4 && Math.abs(m1.alt - g1.alt) < 1.2)), `moved ${moved.toFixed(1)} m, gap ${gap.toFixed(2)} m, alt ${m1.alt.toFixed(1)}/${g1.alt.toFixed(1)}`);

  // every move, aimed at the host (the nearer one) while the guest stands in the same spot: both must be hit by it
  const moves = await host.evaluate(id => BOSS_DEFS[id].moves.filter(m => !m.chain || m.id === 'land' || m.id === 'buffet').map(m => ({ id: m.id, shape: m.shape, air: !!m.air, dmg: m.dmg, cloud: !!m.cloud, r: m.r || 0, reach: m.reach || 0, minD: m.minD || 0, ring: !!m.ring, expose: !!m.expose, lowHead: !!m.lowHead, lane: !!m.lane })), id);
  const missed = [], unseen = [], hostMissed = [], windows = [], extras = [];
  for (const mv of moves) {
    const hurts = mv.dmg > 0 && !['summon', 'blink'].includes(mv.shape) && !mv.cloud;
    let hit = false, hostHit = false, seen = false;
    for (let tries = 0; tries < 3 && !(seen && (!hurts || (hit && hostHit))); tries++) {
      // distance from the boss: inside the move's reach
      const d = mv.shape === 'cone' ? 3 : mv.shape === 'circle' ? (mv.minD ? Math.max(mv.minD, 3) : 2.2) : mv.shape === 'sweep' ? 8 : mv.shape === 'dive' ? 10 : mv.shape === 'land' ? 6 : mv.shape === 'charge' ? 7 : 6;
      await host.evaluate(near, [home.x, home.z + d]);
      await guest.evaluate(near, [home.x + 0.3, home.z + d]);
      await host.evaluate(heal); await guest.evaluate(heal);
      await host.evaluate(([h, mv]) => {
        const b = enemies.find(e => e.boss);
        for (const e of enemies) if (e.minion && !e.dead) { e.sleepT = 1e9; e.x = h.x - 14; }
        arrows.forEach(dropArrowMesh); arrows.length = 0; bossTeleHide(); bossFlamesClear(); bossPuddlesClear(); bossLanesClear();
        b.x = h.x; b.z = h.z; b.alt = mv.air ? b.def.fly.alt : 0; b.bs.air = mv.air; b.bs.cyc = 1e9; b.bs.hx = h.x; b.bs.hz = h.z; b.stun = 0; b.winding = false; b.atkCd = 1e9; b.mv = null; b.hp = b.maxHp * (b.bs.phase ? 0.4 : 1); b.bs.hp0 = b.hp;
        b.bs.st = 'chase'; b.pickR = false; b.pickT = 1e9; b.dormant = false; b.set('alerted'); b.atkCd = 1e9;
        b.yaw = Math.atan2(-(player.x - b.x), -(player.z - b.z)); b.last = { x: player.x, z: player.z };
      }, [home, mv]);
      await guest.evaluate(() => { arrows.forEach(dropArrowMesh); arrows.length = 0; bossFlamesClear(); bossPuddlesClear(); bossLanesClear(); clearClouds(); });
      await host.evaluate(() => clearClouds());
      await host.evaluate(() => T.sleep(250));
      const watch = id => new Promise(done => {
        // only blows count (damage() calls), not a bleed ticking on from an earlier move
        if (!window.blows) { const f = damage; window.blows = { n: 0 }; damage = n => { if (n > 0) blows.n++; f(n); }; }
        const b = enemies.find(e => e.boss), n0 = blows.n, res = { seen: false, hit: false, exp: false, low: false, arrows: 0, tele: 0, flame: 0, lane: 0, cloud: 0, air: 0 };
        const t0 = performance.now();
        const tick = () => {
          if (b.mv && b.mv.id === id) res.seen = true;
          if (blows.n > n0) res.hit = true;
          if (b.bs.exp > 0) res.exp = true;
          if (b.bs.lowT > 0) res.low = true;
          res.arrows = Math.max(res.arrows, arrows.filter(a => a.owner === 'enemy').length);
          res.tele = Math.max(res.tele, group.userData.bossFx ? group.userData.bossFx.tele.filter(m => m.visible).length : 0);
          res.flame = Math.max(res.flame, BOSS_FLAME.n); res.lane = Math.max(res.lane, BOSS_LANE.n); res.cloud = Math.max(res.cloud, cloudsOn);
          if (performance.now() - t0 > 4200) done(res); else requestAnimationFrame(tick);
        };
        requestAnimationFrame(tick);
      });
      const gw = guest.evaluate(watch, mv.id), hw = host.evaluate(watch, mv.id);
      await host.evaluate(mid => { const b = enemies.find(e => e.boss); bossStart(b, b.def.byId[mid], player); }, mv.id);
      const g = await gw, h = await hw;
      seen = seen || g.seen; hit = hit || g.hit; hostHit = hostHit || h.hit;
      if (g.exp) windows.push(mv.id + ' exposed');
      if (g.low) windows.push(mv.id + ' head low');
      if (h.cloud && g.cloud) extras.push('cloud');
      if (h.flame && g.flame) extras.push('flames');
      if (h.lane && g.lane) extras.push('ice lane');
    }
    if (!seen) unseen.push(mv.id);
    if (hurts && !hit) missed.push(mv.id);
    if (hurts && !hostHit) hostMissed.push(mv.id);
  }
  ok(`the guest sees every move (${moves.length})`, unseen.length === 0, unseen.join(', '));
  ok('every damaging move hurts the guest (even when aimed at the host)', missed.length === 0, missed.join(', '));
  ok('and the host', hostMissed.length === 0, hostMissed.join(', '));
  const wantWin = moves.filter(m => m.expose).map(m => m.id + ' exposed').concat(moves.filter(m => m.lowHead).map(m => m.id + ' head low'));
  if (wantWin.length) ok('weak-point windows reach the guest', wantWin.every(w => windows.includes(w)), wantWin.join(', '));
  const wantFx = [].concat(moves.some(m => m.cloud) ? ['cloud'] : [], moves.some(m => m.shape === 'sweep') ? ['flames'] : [], moves.some(m => m.lane) ? ['ice lane'] : []);
  if (wantFx.length) ok(`floor hazards on the guest: ${wantFx.join(', ')}`, wantFx.every(f => extras.includes(f)), [...new Set(extras)].join(', '));

  // phases and summons
  await host.evaluate(near, [home.x, home.z + 8]); await guest.evaluate(near, [home.x + 1, home.z + 8]);
  await host.evaluate(heal); await guest.evaluate(heal);
  const nPhases = await host.evaluate(h => {
    const b = enemies.find(e => e.boss);
    for (const e of enemies) if (e.minion && !e.dead) e.die();
    b.x = h.x; b.z = h.z; b.alt = 0; b.bs.air = false; b.bs.cyc = 1e9; b.bs.st = 'chase'; b.bs.phase = 0; b.stun = 0; b.winding = false; b.atkCd = 1e9; b.hp = b.maxHp * 0.3; b.bs.hp0 = b.hp; b.pickT = 0;
    return b.def.phases.length;
  }, home);
  if (nPhases) {
    await host.evaluate(n => T.until(() => enemies.find(e => e.boss).bs.phase === n, 8000), nPhases);
    ok('phase changes reach the guest', await guest.evaluate(n => T.until(() => enemies.find(e => e.boss).bs.phase === n, 4000), nPhases), `phase ${nPhases}`);
  }
  const summonMove = await host.evaluate(() => { const b = enemies.find(e => e.boss); b.bs.st = 'chase'; b.atkCd = 1e9; const m = b.def.moves.find(m => m.shape === 'summon'); if (m) bossStart(b, m, player); return !!m; });
  const adds = await host.evaluate(() => enemies.find(e => e.boss).def.phases.some(p => p.add));
  if (summonMove || adds) {
    await host.evaluate(() => T.until(() => enemies.some(e => e.minion && !e.dead), 6000));
    await host.evaluate(() => { for (const e of enemies) if (e.minion && !e.dead) e.sleepT = 1e9; });
    const mine = () => enemies.filter(e => e.minion && !e.dead).map(e => e.nid + ':' + e.type).sort().join();
    const hm = await host.evaluate(mine);
    const synced = await guest.evaluate(w => T.until(() => enemies.filter(e => e.minion && !e.dead).map(e => e.nid + ':' + e.type).sort().join() === w, 4000), hm);
    ok('summons exist on both', hm.length > 0 && synced, `${hm} / ${await guest.evaluate(mine)}`);
    const ids = await host.evaluate(() => enemies.filter(e => e.minion && !e.dead).slice(0, 2).map(e => e.nid));
    await guest.evaluate(async n => { const e = enemies.find(e => e.nid === n); player.x = e.x + 1; player.z = e.z; await T.sleep(300); dealHit(e, 'body', 900, wstats(), 0); }, ids[0]);
    let killed = await host.evaluate(n => T.until(() => enemies.find(e => e.nid === n).dead, 3000), ids[0]);
    if (ids[1] !== undefined) {
      await host.evaluate(n => dealHit(enemies.find(e => e.nid === n), 'body', 900, wstats(), 0), ids[1]);
      killed = killed && await guest.evaluate(n => T.until(() => enemies.find(e => e.nid === n).dead, 3000), ids[1]);
    }
    ok('either player can kill a summon', killed);
  }

  // both players' hits reach the boss, and the bar follows
  await host.evaluate(h => { const b = enemies.find(e => e.boss); for (const e of enemies) if (e.minion && !e.dead) e.sleepT = 1e9; b.x = h.x; b.z = h.z; b.alt = 0; b.bs.air = false; b.bs.cyc = 1e9; b.bs.st = 'chase'; b.stun = 0; b.winding = false; b.mv = null; b.atkCd = 1e9; b.bs.exp = 0; b.hp = b.maxHp; b.bs.hp0 = b.hp; b.pickT = 1e9; b.pickR = false; }, home);
  await host.evaluate(near, [home.x, home.z + 3]); await guest.evaluate(near, [home.x + 0.5, home.z + 3]);
  await host.evaluate(heal); await guest.evaluate(heal);
  await host.evaluate(() => T.sleep(500));
  const bossHp = () => enemies.find(e => e.boss).hp;
  const h0 = await host.evaluate(bossHp);
  const claim = await guest.evaluate(() => { const b = enemies.find(e => e.boss); let sent = 0; const f = coop.hit; coop.hit = (...a) => { sent = a[1]; f(...a); }; dealHit(b, 'body', 30, wstats(), 0); coop.hit = f; return sent; });
  await host.evaluate(h => T.until(() => enemies.find(e => e.boss).hp < h, 3000), h0);
  const h1 = await host.evaluate(bossHp);
  ok('a guest hit lowers the boss HP by its multiplied damage', claim > 0 && Math.abs((h0 - h1) - claim) < 0.2, `claimed ${claim.toFixed(1)}, lost ${(h0 - h1).toFixed(1)}`);
  await host.evaluate(() => dealHit(enemies.find(e => e.boss), 'body', 30, wstats(), 0));
  const h2 = await host.evaluate(bossHp);
  const bar = await guest.evaluate(h => T.until(() => { const b = enemies.find(e => e.boss); return Math.abs(parseFloat(document.getElementById('bossFill').style.width) - h / b.maxHp * 100) < 1; }, 4000), h2);
  ok('a host hit counts too and the guest health bar follows', h2 < h1 && bar, `${h0.toFixed(0)} > ${h1.toFixed(0)} > ${h2.toFixed(0)}`);

  // the boss picks the nearer player, whichever it is
  await host.evaluate(near, [home.x, home.z + 12]); await guest.evaluate(near, [home.x + 0.5, home.z + 3]);
  await host.evaluate(() => { enemies.find(e => e.boss).pickT = 0; });
  const onGuest = await host.evaluate(() => T.until(() => enemies.find(e => e.boss).pickR === true, 3000));
  await guest.evaluate(near, [home.x + 0.5, home.z + 12]); await host.evaluate(near, [home.x, home.z + 3]);
  await host.evaluate(() => { const b = enemies.find(e => e.boss); b.bs.st = 'chase'; b.x = b.x; b.pickT = 0; });
  const onHost = await host.evaluate(() => T.until(() => enemies.find(e => e.boss).pickR === false, 3000));
  ok('the boss targets either player', onGuest && onHost);

  if (first) {                                                                // once: parry, and down / revive in the arena
    await guest.evaluate(() => { coop.parried(enemies.find(e => e.boss)); });
    await host.evaluate(h => { const b = enemies.find(e => e.boss); b.x = h.x; b.z = h.z; b.atkCd = 1e9; }, home);
    ok('a guest parry staggers it on the host', await host.evaluate(() => T.until(() => enemies.find(e => e.boss).stun > 0 || enemies.find(e => e.boss).bs.st === 'stagger', 2000)));
    await host.evaluate(() => T.sleep(1500));
    await guest.evaluate(near, [home.x + 0.3, home.z + 2.5]); await host.evaluate(near, [home.x, home.z + 2.5]);
    await guest.evaluate(() => { inv.hp = 1; cb.iframe = 0; });
    await host.evaluate(() => T.sleep(300));
    await host.evaluate(() => { const b = enemies.find(e => e.boss); b.bs.st = 'chase'; b.stun = 0; b.pickR = false; bossStart(b, b.def.moves[0], player); });
    ok('a boss blow downs the guest in the arena', await guest.evaluate(() => T.until(() => coop.down && state === 'play', 5000)));
    await host.evaluate(() => { const b = enemies.find(e => e.boss); b.atkCd = 1e9; b.bs.st = 'chase'; b.winding = false; b.stun = 0; });
    const p = await guest.evaluate(() => ({ x: player.x, z: player.z }));
    await host.evaluate(p => { player.x = p.x - 0.8; player.z = p.z; heal; inv.hp = inv.maxHp; player.keys[KEYS.interact] = true; }, p);
    ok('and the host revives them there', await guest.evaluate(() => T.until(() => !coop.down, 15000)));
    await host.evaluate(() => { player.keys[KEYS.interact] = false; });
    await guest.evaluate(() => { inv.hp = inv.maxHp; });
  }

  // defeat: once, loot for both, then both go on
  await host.evaluate(h => { const b = enemies.find(e => e.boss); dropClear(); for (const e of enemies) if (e.minion && !e.dead) e.sleepT = 1e9; b.x = h.x; b.z = h.z; b.alt = 0; b.bs.air = false; b.bs.st = 'chase'; b.winding = false; b.atkCd = 1e9; b.hp = 3; }, home);
  await guest.evaluate(() => { dropStore(); dropClear(); });
  await host.evaluate(near, [home.x, home.z + 9]); await guest.evaluate(near, [home.x + 2.5, home.z + 3]);
  await host.evaluate(heal); await guest.evaluate(heal);
  await host.evaluate(() => T.sleep(400));
  const xp0 = await guest.evaluate(() => JSON.stringify([prog.level, prog.xp]));
  await guest.evaluate(() => { const b = enemies.find(e => e.boss); dealHit(b, 'body', 400, wstats(), 0); dealHit(b, 'body', 400, wstats(), 0); });   // two claims: still one death
  await host.evaluate(() => T.until(() => enemies.find(e => e.boss).dead, 4000));
  await host.evaluate(() => T.sleep(700));
  ok('defeated on both, exactly once', await host.evaluate(() => calls.defeat === 1) && await guest.evaluate(() => T.until(() => enemies.find(e => e.boss).dead, 3000)), `defeat calls ${await host.evaluate(() => calls.defeat)}`);
  ok('the guest gets the boss XP', await guest.evaluate(x => T.until(() => JSON.stringify([prog.level, prog.xp]) !== x, 3000), xp0));
  const loot = () => floor.items ? floor.items.list.map(i => i.id).sort((a, b) => a - b).join() : '';
  const hl = await host.evaluate(loot);
  ok('its loot lies on both floors', hl.length > 0 && await guest.evaluate(([w, l]) => T.until(() => floor.items && floor.items.list.map(i => i.id).sort((a, b) => a - b).join() === w, 4000), [hl, 0]), `host ${hl} / guest ${await guest.evaluate(loot)}`);

  if (final) {
    ok('the run is won for both', await host.evaluate(() => T.until(() => state === 'won', 8000)) && await guest.evaluate(() => T.until(() => state === 'won', 8000)));
    return;
  }
  ok('the safe room opens on both', await host.evaluate(() => floor.safe.open) && await guest.evaluate(() => T.until(() => floor.safe.open, 3000)));
  const stairs = () => { const b = stairBox; player.x = (b.x0 + b.x1) / 2; player.z = b.z0 + (b.z1 - b.z0) * 0.6; player.vx = player.vz = 0; };
  await guest.evaluate(stairs); await host.evaluate(() => T.sleep(800));
  const waited = await host.evaluate(() => stage === 1);
  await host.evaluate(stairs);
  const went = await host.evaluate(() => T.until(() => stage === 2 && floorNum === 1, 12000)) && await guest.evaluate(() => T.until(() => stage === 2 && floorNum === 1, 12000));
  ok('the stage advance takes both', waited && went);
}

run('co-op bosses', async ({ open, check }) => {
  const host = await open(4242), guest = await open(999);
  check('connected', await connect(host, guest));
  for (const p of [host, guest]) await p.evaluate(`window.near = ${near}; window.heal = ${heal};`);
  const list = only.length ? only : BOSSES;
  for (let i = 0; i < list.length; i++) {
    try { await fight(host, guest, list[i], check, i === 0); }
    catch (e) { check(`${list[i]}: ran to the end`, false, e.message.split('\n')[0]); }
  }
}, { args: ['--disable-features=WebRtcHideLocalIpsWithMdns', '--disable-background-timer-throttling', '--disable-renderer-backgrounding', '--disable-backgrounding-occluded-windows'] });
