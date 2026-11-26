// Co-op: each player SEES what the other does and what the world does, in both directions, and co-op can only be started before a run.
// node tests/game.coopsee.test.js
const { run } = require('./lib');

// page side: rebuild floor n of stage 1 the same way on both pages, optionally with a theme or a quest, guards asleep
const rebuild = ({ theme: mech, quest, n = 1, stage: st = 1 }) => {
  if (mech) { const t = THEME_DEFS.find(t => mech === 'aisles' ? t.layout.style === 'aisles' : t.mechanic.prints); stageThemes = [t, ...stageThemes.filter(q => q !== t)].slice(0, 4); }
  startStage(st);
  if (quest) questPlan[n] = quest;
  if (n > 1) startFloor(n);
  coopS.fk = -1; coopS.byRef = null; coopByNid(0);
  for (const e of enemies) e.sleepT = 1e9;
  inv.maxHp = inv.hp = 1e5;
};
const home = () => ({ x: (floor.start.x + 0.5) * TILE, z: (floor.start.y + 0.5) * TILE });
const put = p => { player.x = p.x; player.z = p.z; player.vx = player.vz = 0; };

run('co-op visibility', async ({ open, check, link, pair }) => {
  // ---- the lobby: only before a run ----
  const solo = await open(5, { start: false }), other = await open(6, { start: false });
  await solo.evaluate(() => coop.hostInvite());                                   // an invite is waiting...
  await solo.click('#overlay', { position: { x: 5, y: 5 } });                     // ...and the player starts alone
  check('starting solo drops a half-made connection', await solo.evaluate(() => state === 'play' && !coop.on && !coopS.link));
  await solo.close();
  const h0 = await open(7, { start: false });
  await link(h0, other);
  await h0.evaluate(() => coop.leave());
  check('a disconnect in the lobby returns to Host / Join, no run lost', await other.evaluate(() => T.until(() => !coop.on, 15000)) && await other.evaluate(() => state === 'menu' && !session.started));
  await other.evaluate(() => coop.leave());
  const again = await link(h0, other);
  check('and the same two can connect again before starting', again.ok);
  await h0.close(); await other.close();

  const { host, guest, ok } = await pair(4242, 999);
  check('connected and started', ok);
  const both = fn => Promise.all([host.evaluate(fn), guest.evaluate(fn)]);
  const all = (fn, arg) => Promise.all([host.evaluate(fn, arg), guest.evaluate(fn, arg)]);
  await both(() => { for (const e of enemies) e.sleepT = 1e9; inv.maxHp = inv.hp = 1e5; });
  const at = await host.evaluate(home);
  const dirs = [['host', host, guest], ['guest', guest, host]];

  for (const [who, a, b] of dirs) {
    const see = (name, v, detail) => check(`${who} to partner: ${name}`, v, detail);
    const until = (fn, arg, ms = 5000) => b.evaluate(([src, arg, ms]) => T.until(() => (0, eval)('(' + src + ')')(arg), ms), [String(fn), arg, ms]);
    await both(() => { arrows.forEach(dropArrowMesh); arrows.length = 0; });
    // A stands at the start facing the longest open line; B behind A (out of the line of fire)
    const yaw = await a.evaluate(p => {
      player.x = p.x; player.z = p.z; player.vx = player.vz = 0;
      let best = 0, yaw = 0;
      for (let k = 0; k < 16; k++) { const w = k * Math.PI / 8; let d = 0; while (d < 9 && !player.blocked(floor, p.x - Math.sin(w) * (d + 0.5), p.z - Math.cos(w) * (d + 0.5))) d += 0.5; if (d > best) { best = d; yaw = w; } }
      player.yaw = yaw; player.pitch = 0; return yaw;
    }, at);
    await b.evaluate(([p, y]) => { player.x = p.x + Math.sin(y) * 1.1; player.z = p.z + Math.cos(y) * 1.1; player.vx = player.vz = 0; player.yaw = y; }, [at, yaw]);

    // weapon and shield in hand
    await a.evaluate(() => { inv.equip.weapon = makeItem({ type: 'weapon', base: 'mace', tier: 2 }); inv.equip.offhand = makeItem({ type: 'shield', tier: 1 }); });
    see('the weapon and shield held', await until(() => coopS.look && coopS.look.w === 'mace' && coopS.look.s === 1 && coopS.av.lookKey === coopS.look && coopS.av.hold.children.length === 1 && coopS.av.off.children.length === 1));
    // poses
    await a.evaluate(() => { cb.want = true; });
    see('blocking', await until(() => coopS.rp.block && coopS.av.arms[1].rotation.x > 1.4));
    await a.evaluate(() => { cb.want = false; player.keys[KEYS.crouch] = true; });
    see('crouching', await until(() => coopS.rp.crouching && coopS.av.mesh.scale.y < coopS.av.scaleK * 0.8));
    await a.evaluate(() => { player.keys[KEYS.crouch] = false; });
    see('swinging', (await Promise.all([until(() => coopS.rp.atk && coopS.av.winding), a.evaluate(() => { cb.stamina = 100; startAttack(); })]))[0]);
    see('dashing', (await Promise.all([until(() => coopS.rp.dash && coopS.av.upper.rotation.x < -0.5), a.evaluate(async () => { for (let i = 0; i < 4; i++) { cb.dashCd = 0; cb.dash.n = 2; cb.stamina = 100; tryDash(); await T.sleep(200); } })]))[0]);
    await a.evaluate(p => { player.x = p.x; player.z = p.z; player.vx = player.vz = 0; }, at);

    // an arrow in flight, stuck, and picked up again
    await a.evaluate(() => { inv.equip.offhand = null; inv.equip.weapon = makeItem({ type: 'weapon', base: 'bow', tier: 0 }); inv.arrows = 10; cb.stamina = 100; });
    const [flew] = await Promise.all([until(() => arrows.some(q => q.ghost && !q.stuck)), a.evaluate(() => { window.rng0 = gameRng; gameRng = () => 0; player.pitch = -0.12; fireArrow(1); })]);
    see('an arrow in flight', flew);
    see('the arrow left stuck', await until(() => arrows.some(q => q.ghost && q.stuck)));
    await a.evaluate(async () => { gameRng = window.rng0; await T.until(() => arrows.some(q => q.stuck && !q.ghost), 5000); const s = arrows.find(q => q.stuck && !q.ghost); inv.arrows = 1; if (s) { player.x = s.x; player.z = s.z; } });
    see('and gone once picked up', await until(() => !arrows.some(q => q.ghost && q.stuck)));
    await a.evaluate(p => { player.x = p.x; player.z = p.z; player.pitch = 0; }, at);
    await a.evaluate(() => { player.keys[KEYS.attack] = true; cb.stamina = 100; startDraw(wstats()); });
    see('drawing the bow', await until(() => coopS.rp.draw && coopS.av.arms[0].rotation.x > 1.4));
    await a.evaluate(() => { cb.draw = null; player.keys[KEYS.attack] = false; });

    // a wand: the bolt, the arm, and it fizzling on a wall
    const [bolt, zapPose] = await Promise.all([
      until(() => arrows.some(q => q.ghost && q.kind === 'wand' && q.wand === 'frost')), until(() => coopS.rp.zap && coopS.av.zapW.visible),
      a.evaluate(() => { const it = makeItem(newWand('frost')); inv.pack.push(it); cb.zap = null; cb.stamina = 100; zapWand(it); }),
    ]);
    see('a wand bolt', bolt); see('the wand raised', zapPose);

    // Rage's ring and trap gas
    await both(() => { const f = group.userData.wandFx; if (f && f.ring) f.ring.visible = false; gasFx.on = false; gasFx.m.visible = false; });
    const [ring] = await Promise.all([until(() => { const f = group.userData.wandFx; return f && f.ring && f.ring.visible && f.ringR === RAGE.radius; }), a.evaluate(() => { cb.rageCd = 0; playRage({ type: 'rage', charges: 2 }); })]);
    see("Hanahan's Rage ring", ring);
    const [gas] = await Promise.all([until(() => gasFx.on && gasFx.m.visible), a.evaluate(() => springTrap('gas', { x: player.x + 6, z: player.z }))]);
    see('trap gas', gas);
    await both(() => { pst.clear(); for (const e of enemies) { e.rageT = 0; e.st.clear(); e.sleepT = e.sleepT > 0 || !coop.guest ? 1e9 : 0; } });

    // a tripwire bell rung
    const cell = await a.evaluate(() => (floor.start.y) * floor.w + floor.start.x);
    await all(i => floor.patches.set(i, 'bell'), cell);
    await a.evaluate(p => { player.x = p.x; player.z = p.z; }, at);
    see('a bell rung is spent on both', await until(i => !floor.patches.has(i), cell) && await a.evaluate(i => !floor.patches.has(i), cell));

    // a door opened
    const door = await a.evaluate(() => propObjs.findIndex(o => o.p.kind === 'door' && !o.p.opened));
    if (door >= 0) {
      await all(i => { const o = propObjs[i]; for (const pg of [coopS.rp, player]) { pg.x = o.x; pg.z = o.z + 2; } }, door);
      await a.evaluate(() => T.sleep(300));
      await a.evaluate(i => { openDoor(propObjs[i]); coop.opened(propObjs[i]); }, door);
      see('a door opened', await until(i => propObjs[i].p.opened, door));
      await all(i => { const o = propObjs[i]; o.p.opened = false; o.anim = undefined; floor.tiles[o.p.y * floor.w + o.p.x] = T_DOOR; }, door);
    }

    // down, the revive progress, the hit flash
    await all(p => { player.x = p.x; player.z = p.z; cb.iframe = 0; inv.hp = inv.maxHp; }, at);
    await a.evaluate(() => T.sleep(300));
    await a.evaluate(() => damage(inv.maxHp * 0.3));
    see('being hurt (the avatar flashes)', await until(() => coopS.av.hitT > 0));
    await a.evaluate(() => damage(1e9));
    see('down: the body lies there', await until(() => coopS.rp.down && coopS.av.dead && coopS.av.mesh.visible));
    await b.evaluate(() => { player.keys[KEYS.interact] = true; });
    check(`${who} down: sees the revive progress`, await a.evaluate(() => T.until(() => coopS.mine.frac > 0.2 && /being revived \d+%/.test(coopS.hudTxt.textContent), 8000)));
    check(`${who} is revived`, await a.evaluate(() => T.until(() => !coop.down, 20000)));
    await b.evaluate(() => { player.keys[KEYS.interact] = false; });
    await both(() => { inv.hp = inv.maxHp; });

    // the minimap dot
    await a.evaluate(p => { player.x = p.x; player.z = p.z; }, at);
    await b.evaluate(p => { player.x = p.x + 6; player.z = p.z + 6; }, at);
    await until(p => Math.hypot(coopS.rp.x - p.x, coopS.rp.z - p.z) < 0.2, at);
    see('a dot on the minimap', await b.evaluate(() => {
      drawMinimap(); const S = hud.mini.width / floor.w, d = mctx.getImageData(Math.round(coopS.rp.x / TILE * S), Math.round(coopS.rp.z / TILE * S), 1, 1).data, c = COOP.col[1 - coopS.role];
      return Math.abs(d[0] - (c >> 16)) < 24 && Math.abs(d[1] - (c >> 8 & 255)) < 24 && Math.abs(d[2] - (c & 255)) < 24;
    }));

    // waiting at the stairs
    await a.evaluate(() => { const s = stairBox; player.x = (s.x0 + s.x1) / 2; player.z = s.z0 + (s.z1 - s.z0) * 0.6; });
    see('waiting at the stairs', await until(() => coopS.stairPeer && /partner is at the stairs/.test(coopS.hudTxt.textContent)));
    await a.evaluate(p => { player.x = p.x; player.z = p.z; }, at);
    see('and no longer waiting', await until(() => !coopS.stairPeer));

    // a floor drop appears, and goes when taken
    await both(() => dropClear && floor.items && dropClear());
    await a.evaluate(p => { player.x = p.x; player.z = p.z; }, at);
    await b.evaluate(p => { player.x = p.x + 8; player.z = p.z; }, at);
    await host.evaluate(p => { dropStore(); dropSpawn({ type: 'gold', n: 2 }, p.x + 7, p.z + 7, false, () => 0.5); }, at);
    see('a drop on the floor', await until(() => floor.items && floor.items.list.length === 1) && await a.evaluate(() => T.until(() => floor.items && floor.items.list.length === 1, 3000)));
    await a.evaluate(() => { const it = floor.items.list[0]; player.x = it.x; player.z = it.z; });
    see('and it gone once taken', await until(() => floor.items.list.length === 0));
  }

  // ---- what only the host works out, seen by the guest ----
  const n = await host.evaluate(() => { const e = enemies.find(e => !e.dead && !e.boss && !e.T.mimic && !e.T.bomb); e.sleepT = 1e9; e.x = player.x; e.z = player.z + 3; e.hp = e.maxHp = 1000; return e.nid; });
  await host.evaluate(n => { const e = enemies.find(e => e.nid === n); e.addStatus('burn', 60); e.addStatus('stuck'); e.rageT = 60; e.fuse = 60; e.winding = true; e.zone = 'legs'; }, n);
  const marks = await guest.evaluate(n => T.until(() => { const e = enemies.find(e => e.nid === n); return e.st.has('burn') && e.st.has('stuck') && e.goo && e.rageT > 0 && e.fuse > 0 && e.winding && e.zone === 'legs' && e.icon.visible; }, 4000), n);
  check('enemy burn, glue, rage, lit fuse and attack zone show on the guest', marks);
  await host.evaluate(n => { const e = enemies.find(e => e.nid === n); e.st.clear(); e.rageT = 0; e.fuse = -1; e.winding = false; e.sleepT = 0; e.addStatus('freeze', 60); e.set('suspicious'); e.aware = 0.9; e.last = { x: e.x, z: e.z }; }, n);
  check('freeze and the suspicious mark show, old marks clear', await guest.evaluate(n => T.until(() => { const e = enemies.find(e => e.nid === n); return e.st.has('freeze') && !e.st.has('burn') && !e.rageT && e.aware > 0.5 && e.state === 'suspicious' && e.icon.visible; }, 4000), n));
  await host.evaluate(n => { const e = enemies.find(e => e.nid === n); e.st.clear(); e.sleepT = 1e9; }, n);
  // the guest's own zap: its status mark comes back to it; the host's chain lightning and force ring are seen
  await guest.evaluate(async n => { const e = enemies.find(e => e.nid === n); await T.sleep(300); player.x = e.x + 2; player.z = e.z; await T.sleep(300); applyWand('frost', e); }, n);
  check('a guest frost zap: the guest sees the slow it caused', await guest.evaluate(n => T.until(() => { const e = enemies.find(e => e.nid === n); return e.st.has('slow') || e.st.has('freeze'); }, 4000), n));
  await guest.evaluate(() => { const f = group.userData.wandFx; if (f) { for (const m of f.flashes) m.visible = false; if (f.ring) f.ring.visible = false; } });
  const [fx] = await Promise.all([
    guest.evaluate(() => T.until(() => { const f = group.userData.wandFx; return f && f.flashes.some(m => m.visible) && f.ring && f.ring.visible; }, 4000)),
    host.evaluate(n => applyWand('force', enemies.find(e => e.nid === n)), n),
  ]);
  check("the host's zap: the impact flash and force ring show on the guest", fx);

  // a locked or trapped chest the host deals with
  const chest = await host.evaluate(() => propObjs.findIndex(o => o.p.kind === 'chest' && !o.p.opened && !o.p.mimic));
  if (chest >= 0) {
    await all(i => { const p = propObjs[i].p; p.locked = true; p.trap = null; p.left = [{ type: 'weapon', base: 'sword', tier: 1 }]; }, chest);
    await host.evaluate(i => { inv.pack = Array.from({ length: PACK_MAX }, () => makeItem({ type: 'shield', tier: 0 })); finishSearch(propObjs[i], true); inv.pack = []; }, chest);
    check('a lock the host breaks is gone for the guest too', await guest.evaluate(i => T.until(() => !propObjs[i].p.locked && (!propObjs[i].tell || !propObjs[i].tell.parent), 4000), chest));
  } else check('a chest exists to test', false);

  // a woken mimic is no longer a chest on the guest
  await all(i => { const o = propObjs[i], e = new Enemy({ x: o.p.x, y: o.p.y, route: [{ x: o.p.x, y: o.p.y }, { x: o.p.x, y: o.p.y }], seed: 5, type: 'mimic', tier: 1 }, floor); e.x = o.x; e.z = o.z; e.nid = 900; o.p.mimic = true; o.p.opened = false; o.mimic = e; e.propObj = o; enemies.push(e); group.add(e.mesh); coopS.byRef = null; coopByNid(0); }, chest);
  await host.evaluate(i => { const m = propObjs[i].mimic; player.x = m.x; player.z = m.z + 2; m.wake(true, player); m.sleepT = 1e9; }, chest);
  await guest.evaluate(p => { player.x = p.x; player.z = p.z; }, at);
  await host.evaluate(i => { player.x = propObjs[i].x + 1; player.z = propObjs[i].z + 1; }, chest);
  check('a mimic woken on the host shows on the guest', await guest.evaluate(i => T.until(() => !propObjs[i].mimic.dormant && propObjs[i].p.opened, 4000), chest));

  // a thief escaping is not seen as a death
  await host.evaluate(n => { const e = enemies.find(e => e.nid === n); e.x = player.x; e.z = player.z + 2; e.escape(); }, n);
  check('an escaped enemy vanishes on the guest (no body)', await guest.evaluate(n => T.until(() => { const e = enemies.find(e => e.nid === n); return e.escaped && !e.mesh.parent; }, 4000), n));

  // ---- hostile values for the new messages ----
  const hostile = await guest.evaluate(() => {
    const fk = coopFloorKey(), X = '<img src=x onerror="window.pwned=1">', a = arrows.length, look = coopS.look, t = gameT;
    coopMsg({ k: 'pr', fk, x: NaN, y: 1, z: 1, vx: 0, vy: 0, vz: 0 }); coopMsg({ k: 'pr', fk, x: 1, y: 1, z: 1, vx: 1e9, vy: 0, vz: NaN }); coopMsg({ k: 'pr', fk, x: 1, y: 1, z: 1, vx: 1, vy: 0, vz: 0, w: '__proto__' });
    coopMsg({ k: 'as', fk, id: X, x: 1, z: 1, yaw: 0 }); coopMsg({ k: 'fx', fk, t: 0, w: X, x: 1, y: 1, z: 1, r: 1 }); coopMsg({ k: 'fx', fk, t: 9, x: 1, y: 1, z: 1, r: 1 });
    coopMsg({ k: 'es', fk, n: 0, m: 1e9 }); coopMsg({ k: 'lk', w: 'constructor', t: 0, s: 0 }); coopMsg({ k: 'lk', w: 'sword', t: 99, s: 0 }); coopMsg({ k: 'ps', fk, i: 'length' }); coopMsg({ k: 'bt', fk, i: -1 }); coopMsg({ k: 'mv', fk, i: 1e9, s: 0 }); coopMsg({ k: 'gt', t: NaN });
    const v = new DataView(new ArrayBuffer(9)); v.setUint8(0, 4); v.setUint8(1, fk); coopState(v);   // an ally packet with no ally recruited
    return arrows.length === a && coopS.look === look && gameT >= t && !window.pwned && !/onerror/.test(document.body.innerHTML);
  });
  check('hostile values in the new messages change nothing', hostile);

  // ---- Library shelves move together ----
  await all(rebuild, { theme: 'aisles' });
  for (let f = 2; f <= 4 && !await host.evaluate(() => floor.movers && floor.movers.length); f++) await all(rebuild, { theme: 'aisles', n: f });
  const held = await guest.evaluate(async () => { const m = floor.movers[0]; m.t = 100; await T.sleep(500); return !m.sliding; });
  check('the guest shelf waits for the host', held);
  const k = await host.evaluate(() => { const m = floor.movers[0]; m.k ^= 0; m.t = theme.mechanic.TUNE.shelfEvery - theme.mechanic.TUNE.shelfSlide; for (const q of floor.movers.slice(1)) q.t = -1e9; return m.k; });
  check('and slides when the host shelf does, ending in the same place', await guest.evaluate(k => T.until(() => floor.movers[0].k !== k && !floor.movers[0].sliding, 8000), k) && await host.evaluate(k => T.until(() => floor.movers[0].k !== k, 8000), k));

  // ---- the partner's footprints in the snow (both directions) ----
  await all(rebuild, { theme: 'ice' });
  const snow = await host.evaluate(home);
  for (const [who, a, b] of dirs) {
    await b.evaluate(p => { player.x = p.x; player.z = p.z; }, snow);
    await b.evaluate(() => { for (const q of floor.prints.list) q.t = -1e9; });
    for (let i = 0; i < 5; i++) { await a.evaluate(([p, i]) => { player.x = p.x + (i % 2) * 1.6; player.z = p.z + 0.2; player.vx = player.vz = 0; }, [snow, i]); await a.evaluate(() => T.sleep(250)); }
    check(`${who} to partner: footprints in the snow`, await b.evaluate(() => T.until(() => floor.prints.list.some(q => q.t > -1e8), 3000)));
  }

  // ---- the rune circle flares by one clock ----
  await all(rebuild, { stage: 5 });
  await host.evaluate(() => { gameT = 5000; });
  check('the rune circle runs on the host clock', await guest.evaluate(() => T.until(() => floor.runes && Math.abs(gameT - 5000) < 20 && gameT >= 5000, 6000)));

  // ---- the host drops out mid boss fight: the guest fights the flying dragon on alone ----
  const dropOut = async () => {
    await all(rebuild, { stage: 5 });
    await host.evaluate(() => { const b = enemies.find(e => e.boss); b.sleepT = 0; b.dormant = false; b.set('alerted'); b.bs.st = 'chase'; b.bs.hx = b.x; b.bs.hz = b.z; b.bs.cyc = 1e9; bossTakeoff(b); b.bs.cyc = 1e9; b.last = { x: player.x, z: player.z }; });
    await guest.evaluate(() => T.until(() => { const b = enemies.find(e => e.boss); return b.bs.air && b.alt > 3; }, 8000));
    await host.evaluate(() => coop.leave());
    return guest.evaluate(async () => {
      const b = enemies.find(e => e.boss); await T.until(() => !coop.on, 15000);
      const x = b.x, z = b.z; await T.sleep(1500);
      const hp = b.hp; b.hurt(5, player);
      return !coop.on && state === 'play' && Number.isFinite(b.x + b.z + b.alt + b.bs.cyc) && Math.hypot(b.x - x, b.z - z) > 0.5 && b.hp < hp;
    });
  };

  // ---- the ally and the prisoner (both directions) ----
  for (const [who, a, b] of dirs) {
    await all(rebuild, { quest: 'ally', n: 2 });
    const there = await a.evaluate(() => !!(allyRun && allyRun.f === floor));
    check(`${who}: an ally waits on the test floor`, there);
    await a.evaluate(() => { player.x = allyRun.e.x; player.z = allyRun.e.z + 1.2; inv.gold = 9999; inv.add({ type: 'potion', kind: 'heal', n: 1 }); allyTalk(allyRun); });
    check(`${who} to partner: the recruited ally follows on screen, and cannot be recruited twice`, await b.evaluate(() => T.until(() => coopS.ally && coopS.ally.mesh.parent === group && allyRun.mode === 'gone' && !propObjs.includes(allyRun.o), 5000)));
    const goal = await a.evaluate(() => { allyRun.mode = 'wait'; allyRun.e.x += 0.6; return { x: allyRun.e.x, z: allyRun.e.z }; });
    check(`${who} to partner: where the ally is`, await b.evaluate(p => T.until(() => Math.hypot(coopS.ally.x - p.x, coopS.ally.z - p.z) < 0.15, 4000), goal));

    await all(rebuild, { quest: 'prisoner', n: 2 });
    const cell = await a.evaluate(() => propObjs.findIndex(o => o.p.kind === 'door' && o.p.room === 'cell'));
    if (cell < 0) { check(`${who}: a cell exists`, false); continue; }
    await all(i => { player.x = propObjs[i].x; player.z = propObjs[i].z + 1.5; }, cell);
    await a.evaluate(() => T.sleep(400));
    await a.evaluate(i => { const o = propObjs[i]; openDoor(o); coop.opened(o); questDoorOpened(o); }, cell);
    check(`${who} to partner: the cell opens and the prisoner is freed`, await b.evaluate(() => T.until(() => floor.quest.freed, 4000)));
  }

  check('a disconnect mid boss fight: the survivor fights on, the dragon still flies', await dropOut());
});
