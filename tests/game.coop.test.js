// Co-op in the browser: two pages in one headless Chromium, connected through the copy-paste code flow (loopback, no STUN needed).
// node tests/game.coop.test.js
const { run } = require('./lib');

// Connect two pages: the host's invite code to the guest, the guest's answer code back.
async function connect(host, guest) {
  const invite = await host.evaluate(() => coop.hostInvite());
  const answer = await guest.evaluate(c => coop.join(c), invite);
  await host.evaluate(c => coop.hostConnect(c), answer);
  const up = () => T.until(() => coop.on && coopS.ready, 20000);
  return { invite, answer, ok: (await host.evaluate(up)) && (await guest.evaluate(up)) };
}
const signature = () => JSON.stringify([stage, floorNum, floor.w, floor.h, floor.start, floor.stairs, theme.name, floor.tiles.reduce((s, t, i) => (s * 31 + t + i) % 1000003, 7), enemies.map(e => [e.nid, e.type, Math.round(e.maxHp)])]);

run('co-op', async ({ open, check }) => {
  let at0;
  const host = await open(4242), guest = await open(999);
  const c = await connect(host, guest);
  check('two pages connect through the copy-paste codes', c.ok);
  check('codes are short enough to paste into a chat', c.invite.length < 900 && c.answer.length < 900, `invite ${c.invite.length}, answer ${c.answer.length} chars`);
  check('roles: one host, one guest', await host.evaluate(() => coop.host && !coop.guest) && await guest.evaluate(() => coop.guest && !coop.host));
  const sh = await host.evaluate(signature), sg = await guest.evaluate(signature);
  check('the guest generated the same floor from the host seed', sh === sg, sh === sg ? '' : sh.slice(0, 150) + ' / ' + sg.slice(0, 150));
  check('the partner avatar shows on both', await host.evaluate(() => T.until(() => coopS.av && coopS.av.mesh.visible, 5000)) && await guest.evaluate(() => T.until(() => coopS.av && coopS.av.mesh.visible, 5000)));

  // every guard asleep, so nothing interferes with what follows (sleepers still stream in snapshots)
  await host.evaluate(() => { for (const e of enemies) e.sleepT = 1e9; });

  // ---- friendly fire (both at the floor start; the guest steps 1.1 m aside and swings at the host) ----
  const hp0 = await host.evaluate(() => inv.hp), hpos = await host.evaluate(() => ({ x: player.x, z: player.z }));
  let ff = null;
  for (const [dx, dz] of [[1.1, 0], [-1.1, 0], [0, 1.1], [0, -1.1]]) {
    ff = await guest.evaluate(async ([h, dx, dz]) => {
      player.x = h.x + dx; player.z = h.z + dz; player.vx = player.vz = 0; player.pitch = -0.2; player.yaw = Math.atan2(dx, dz);
      await T.sleep(300);
      const w = wstats(), hit = coop.melee(null, w);
      return { hit, max: w.dmg * 1.6 * TUNE.coopFF };
    }, [hpos, dx, dz]);
    if (ff.hit) break;
  }
  await host.evaluate(h => T.until(() => inv.hp < h, 3000), hp0);
  const lost = hp0 - await host.evaluate(() => inv.hp);
  check('friendly fire: a guest swing hurts the host, at the reduced multiplier', ff.hit && lost > 0 && lost <= ff.max + 0.2, `lost ${lost.toFixed(1)}, cap ${ff.max.toFixed(1)}`);

  // ---- guest sees host-moved enemies ----
  const moved = await host.evaluate(async () => {
    const e = enemies.filter(e => !e.boss && !e.dead).sort((a, b) => Math.hypot(a.x - player.x, a.z - player.z) - Math.hypot(b.x - player.x, b.z - player.z))[0];
    player.x = e.x; player.z = e.z + 3; e.x += 0.8;
    return { n: e.nid, x: e.x, z: e.z };
  });
  const seen = await guest.evaluate(async m => { const e = () => enemies.find(e => e.nid === m.n); const ok = await T.until(() => Math.abs(e().x - m.x) < 0.1 && Math.abs(e().z - m.z) < 0.1, 4000); return { ok, x: e().x }; }, moved);
  check('the guest sees the enemy where the host moved it', seen.ok, `host ${moved.x.toFixed(2)}, guest ${seen.x.toFixed(2)}`);

  // ---- a guest hit damages the enemy on the host; a killing hit kills it on both ----
  const hpE = await host.evaluate(n => enemies.find(e => e.nid === n).hp, moved.n);
  await guest.evaluate(async n => { const e = enemies.find(e => e.nid === n); player.x = e.x + 1.2; player.z = e.z; await T.sleep(300); dealHit(e, 'body', 3, wstats(), 0); }, moved.n);   // (the host checks range against the position it has)
  await host.evaluate(([n, h]) => T.until(() => enemies.find(e => e.nid === n).hp < h, 3000), [moved.n, hpE]);
  const hpAfter = await host.evaluate(n => enemies.find(e => e.nid === n).hp, moved.n);
  check('a guest hit damages the enemy on the host', hpAfter < hpE, `${hpE.toFixed(0)} to ${hpAfter.toFixed(0)}`);
  const xp0 = await guest.evaluate(() => JSON.stringify([prog.level, prog.xp, prog.floorXp]));
  await guest.evaluate(n => { const e = enemies.find(e => e.nid === n); player.x = e.x + 1.2; player.z = e.z; dealHit(e, 'body', 250, wstats(), 0); }, moved.n);
  const dead = await host.evaluate(n => T.until(() => enemies.find(e => e.nid === n).dead, 3000), moved.n);
  check('the killing hit kills it on the host and then on the guest', dead && await guest.evaluate(n => T.until(() => enemies.find(e => e.nid === n).dead, 3000), moved.n));
  check('the guest got XP for the kill (within range)', await guest.evaluate(x => T.until(() => JSON.stringify([prog.level, prog.xp, prog.floorXp]) !== x, 3000), xp0));

  // ---- each floor drop goes to exactly one player ----
  await host.evaluate(() => { player.x = floor.start.x * TILE + TILE / 2; player.z = floor.start.y * TILE + TILE / 2; dropClear(); });
  await guest.evaluate(() => { dropStore(); dropClear(); });
  const at = await host.evaluate(() => ({ x: player.x, z: player.z }));
  await guest.evaluate(p => { player.x = p.x + 0.3; player.z = p.z; floor.items.seq = 500; }, at);
  await host.evaluate(() => { dropStore().seq = 500; });
  const g0 = (await host.evaluate(() => inv.gold)) + (await guest.evaluate(() => inv.gold));
  await host.evaluate(p => { for (let i = 0; i < 5; i++) dropSpawn({ type: 'gold', n: 7 }, p.x + 0.15, p.z, false, () => 0.5); }, at);
  await host.evaluate(() => T.sleep(2500));
  const gh = await host.evaluate(() => ({ gold: inv.gold, left: floor.items.list.length })), gg = await guest.evaluate(() => ({ gold: inv.gold, left: floor.items.list.length }));
  check('contested pickups: each drop goes to exactly one player', gh.gold + gg.gold - g0 === 35 && gh.left === 0 && gg.left === 0, `gold +${gh.gold + gg.gold - g0}, left ${gh.left}/${gg.left}`);
  // a drop only the guest can reach: the host grants it
  const gold1 = await guest.evaluate(() => inv.gold);
  await host.evaluate(p => { player.x = p.x - 9; dropSpawn({ type: 'gold', n: 3 }, p.x + 0.3, p.z, false, () => 0.5); }, at);
  check('a drop beside the guest is granted to the guest', await guest.evaluate(g => T.until(() => inv.gold === g + 3 && floor.items.list.length === 0, 4000), gold1));

  // ---- a hostile peer: markup, NaN and unknown types are ignored ----
  const hostile = await guest.evaluate(() => {
    const X = '<img src=x onerror="window.pwned=1">', before = JSON.stringify([inv.pack, inv.gold, inv.hp, prog.level, prog.xp, floor.items.list.length]), fk = coopFloorKey();
    for (const d of [{ type: 'key', lock: 'zz', label: X }, { type: 'potion', kind: 'heal', n: X }, { type: 'wand', kind: 'fire', charges: X }, { type: '__proto__' }, { type: 'potion', kind: 'constructor' }]) {
      coopMsg({ k: 'dy', id: 4000, d }); coopMsg({ k: 'dr', fk, id: 4001, x: player.x, z: player.z, d }); coopMsg({ k: 'sg', fk, i: 0, d: [d] });
    }
    coopMsg({ k: 'ff', d: NaN, z: 'body' }); coopMsg({ k: 'ff', d: 5, z: '__proto__' }); coopMsg({ k: 'xp', b: NaN }); coopMsg({ k: 'xp', b: 'lots' }); coopMsg(null); coopMsg({ k: 'op', fk, i: 'length' });
    return { same: before === JSON.stringify([inv.pack, inv.gold, inv.hp, prog.level, prog.xp, floor.items.list.length]), pwned: !!window.pwned || /onerror/.test(document.body.innerHTML) };
  });
  check('hostile items and values change nothing and inject no markup (guest)', hostile.same && !hostile.pwned);
  const hostSide = await host.evaluate(async () => {
    coopMsg({ k: 'hit', n: 1, z: 'body', d: NaN }); coopMsg({ k: 'ff', d: NaN, z: 'body' }); coopMsg({ k: 'xp', b: 1e9 }); coopMsg({ k: 'du', id: 4000, d: { type: 'gold', n: 999 } });
    const v = Net.sendView(Net.packPlayer({ x: NaN, z: NaN, yaw: 0, pitch: 0, flags: 0, hp: 1, floor: coopFloorKey(), seq: (coopS.avSeq + 1) & 65535, noise: 0, speed: 0 }));
    coopState(new DataView(v.buffer.slice(0, v.length))); coopState(new DataView(new ArrayBuffer(2)));
    await T.sleep(200);
    return Number.isFinite(coopS.rp.x) && Number.isFinite(inv.hp) && enemies.every(e => Number.isFinite(e.hp) && Number.isFinite(e.x)) && !floor.items.list.some(i => i.d.n === 999);
  });
  check('hostile values from the guest change nothing on the host', hostSide);

  // ---- every guest damage source goes to the host; nothing dies or is hurt only on the guest ----
  const n2 = await host.evaluate(p => { const e = enemies.find(e => !e.dead && !e.boss); e.x = p.x; e.z = p.z; e.hp = e.maxHp = 500; e.sleepT = 1e9; return e.nid; }, at0 = hpos);   // (where both stood at the start: open floor)
  await guest.evaluate(async ([n, p]) => { const e = enemies.find(e => e.nid === n); e.maxHp = e.hp = 500; await T.until(() => Math.hypot(e.x - p.x, e.z - p.z) < 0.1, 3000); }, [n2, at0]);
  const hostHp = () => host.evaluate(n => enemies.find(e => e.nid === n).hp, n2);
  const local = await guest.evaluate(n => { const e = enemies.find(e => e.nid === n), hp = e.hp; e.hurt(9999, { x: e.x, z: e.z }); e.addStatus('bleed', 9); explodeAt(e.x, e.z, null); inv.hp = inv.maxHp; pst.clear(); return !e.dead && e.hp === hp; }, n2);
  check('blasts and other local effects cannot hurt or kill a guard on the guest', local && await hostHp() === 500);
  for (const [name, act] of [['shield bash', () => { inv.equip.offhand = makeItem({ type: 'shield', tier: 0 }); cb.bashCd = 0; cb.eat = null; cb.stamina = 100; bash(); }], ['wand', null]]) {
    const before = await hostHp();
    await guest.evaluate(async ([n, name, src]) => {
      const e = enemies.find(e => e.nid === n);
      for (const [dx, dz] of [[1.1, 0], [-1.1, 0], [0, 1.1], [0, -1.1]]) {           // a side of it that is open floor
        player.x = e.x + dx; player.z = e.z + dz; player.yaw = Math.atan2(dx, dz); player.pitch = -0.2;
        const t = findMeleeTarget(player, eyeY(), enemies, floor, SHIELD.bashReach); if (t && t.e === e) break;
      }
      await T.sleep(300);
      if (name === 'wand') applyWand('fire', e); else (0, eval)('(' + src + ')')();
    }, [n2, name, String(act)]);
    await host.evaluate(([n, h]) => T.until(() => enemies.find(e => e.nid === n).hp < h, 3000), [n2, before]);
    check(`a guest ${name} is applied by the host`, await hostHp() < before, `${before.toFixed(0)} to ${(await hostHp()).toFixed(0)}`);
  }

  await host.evaluate(n => { const e = enemies.find(e => e.nid === n); e.sleepT = 1e9; e.x += 30; inv.hp = inv.maxHp; pst.clear(); }, n2);   // out of the way again
  await guest.evaluate(() => { inv.hp = inv.maxHp; pst.clear(); });

  // ---- containers: the host alone owns the contents ----
  const idx = await host.evaluate(() => propObjs.map((o, i) => i).filter(i => { const o = propObjs[i]; return coopLootable(o) && !o.p.opened && !o.p.mimic; }).slice(0, 3));
  const stand = async i => { const p = await host.evaluate(i => ({ x: propObjs[i].x, z: propObjs[i].z }), i); for (const pg of [host, guest]) await pg.evaluate(p => { player.x = p.x + 0.7; player.z = p.z; }, p); await host.evaluate(() => T.sleep(300)); };
  const have = () => ({ gold: inv.gold, potions: inv.pack.filter(i => i.type === 'potion' && i.kind === 'heal').reduce((a, i) => a + i.n, 0) });
  await stand(idx[0]);
  await host.evaluate(i => { const p = propObjs[i].p; p.locked = false; p.trap = null; p.left = [{ type: 'gold', n: 11 }, { type: 'potion', kind: 'heal', n: 1 }]; }, idx[0]);
  const a0 = await host.evaluate(have), b0 = await guest.evaluate(have);
  const open1 = i => { finishSearch(propObjs[i]); };
  await Promise.all([guest.evaluate(open1, idx[0]), host.evaluate(open1, idx[0])]);
  await host.evaluate(() => T.sleep(800));
  await guest.evaluate(open1, idx[0]);
  await host.evaluate(() => T.sleep(500));
  const a1 = await host.evaluate(have), b1 = await guest.evaluate(have);
  check('a chest searched by both pays out once', a1.gold - a0.gold + b1.gold - b0.gold === 11 && a1.potions - a0.potions + b1.potions - b0.potions === 1, `gold +${a1.gold - a0.gold}/+${b1.gold - b0.gold}`);
  check('and is opened on both', await host.evaluate(i => propObjs[i].p.opened, idx[0]) && await guest.evaluate(i => T.until(() => propObjs[i].p.opened, 3000), idx[0]));
  await stand(idx[1]);
  await host.evaluate(i => { const p = propObjs[i].p; p.locked = false; p.trap = null; p.left = [{ type: 'weapon', base: 'sword', tier: 1 }, { type: 'gold', n: 5 }]; }, idx[1]);
  const part = await guest.evaluate(async i => { const pack = inv.pack, gold = inv.gold; inv.pack = Array.from({ length: PACK_MAX }, () => makeItem({ type: 'shield', tier: 0 })); finishSearch(propObjs[i]); await T.until(() => inv.gold > gold, 3000); inv.pack = pack; return inv.gold - gold; }, idx[1]);
  const kept = await host.evaluate(async i => { const p = propObjs[i].p; await T.until(() => !p.busy, 3000); return { n: p.left && p.left.length, type: p.left && p.left[0].type, opened: !!p.opened }; }, idx[1]);
  check('a partly looted chest keeps the rest on the host', part === 5 && kept.n === 1 && kept.type === 'weapon' && !kept.opened, JSON.stringify(kept));

  // ---- a mimic opened by the guest wakes on the host ----
  await stand(idx[2]);
  for (const pg of [host, guest]) await pg.evaluate(i => { const o = propObjs[i], e = new Enemy({ x: o.p.x, y: o.p.y, route: [{ x: o.p.x, y: o.p.y }, { x: o.p.x, y: o.p.y }], seed: 5, type: 'mimic', tier: 1 }, floor); e.x = o.x; e.z = o.z; e.nid = 900; o.p.mimic = true; o.mimic = e; e.propObj = o; enemies.push(e); group.add(e.mesh); coopS.byRef = null; }, idx[2]);
  await guest.evaluate(open1, idx[2]);
  check('a mimic opened by the guest wakes on the host', await host.evaluate(i => T.until(() => !propObjs[i].mimic.dormant, 3000), idx[2]));
  await host.evaluate(i => { const e = propObjs[i].mimic; e.sleepT = 1e9; e.x += 30; }, idx[2]);

  // ---- down and revive ----
  await host.evaluate(p => { player.x = p.x; player.z = p.z; inv.hp = inv.maxHp; cb.iframe = 0; }, at);
  await guest.evaluate(p => { player.x = p.x + 0.8; player.z = p.z; cb.iframe = 0; damage(9999); }, at);
  check('at 0 HP in co-op a player is down, not dead', await guest.evaluate(() => coop.down && state === 'play'));
  check('the host learns the partner is down', await host.evaluate(() => T.until(() => coopS.rp.down, 3000)));
  const t0 = Date.now();
  await host.evaluate(() => { player.keys[KEYS.interact] = true; });
  const rev = await guest.evaluate(() => T.until(() => !coop.down, 20000));
  await host.evaluate(() => { player.keys[KEYS.interact] = false; });
  const got = await guest.evaluate(() => ({ hp: inv.hp, want: inv.maxHp * TUNE.coopReviveHp }));
  check('holding interact by the body revives after about 3 s', rev && Date.now() - t0 > 2000 && Math.abs(got.hp - got.want) < 2, `${((Date.now() - t0) / 1000).toFixed(1)} s, hp ${got.hp.toFixed(0)}`);

  // ---- stairs: one waits, then both go ----
  const toStairs = () => { const b = stairBox; player.x = (b.x0 + b.x1) / 2; player.z = b.z0 + (b.z1 - b.z0) * 0.6; player.vx = player.vz = 0; };
  await guest.evaluate(toStairs);
  await host.evaluate(() => T.sleep(1200));
  check('one player at the stairs waits for the other', (await host.evaluate(() => floorNum === 1 && coopS.stairPeer)) && (await guest.evaluate(() => floorNum === 1 && coopS.stairMe)));
  await host.evaluate(toStairs);
  const went = await host.evaluate(() => T.until(() => floorNum === 2, 6000)) && await guest.evaluate(() => T.until(() => floorNum === 2, 6000));
  check('both take the stairs together', went);
  check('and generate the same floor 2', await host.evaluate(signature) === await guest.evaluate(signature));
  check('they see each other on floor 2', await guest.evaluate(() => T.until(() => coopS.rp.on && coopS.av.mesh.visible, 5000)));

  // ---- bandwidth: the biggest packets ----
  const size = await host.evaluate(() => { Net.snapBegin(0, 0); for (const e of enemies) Net.snapAdd(e.nid, e.x, e.z, e.yaw, 0, 1); return Net.snapEnd(); });
  check('a whole-floor snapshot stays under 600 bytes', size < 600, size + ' bytes');

  // ---- disconnect ----
  await host.evaluate(() => coop.leave());
  check('host leaves: the host plays on solo', await host.evaluate(() => !coop.on && state === 'play'));
  check('the guest returns to the menu with a message', await guest.evaluate(() => T.until(() => state === 'dead' && /Co-op ended/.test(hud.overlayText.textContent), 15000)));
  await host.close(); await guest.close();

  // ---- both down ends the run ----
  const h2 = await open(31), g2 = await open(32);
  const c2 = await connect(h2, g2);
  await h2.evaluate(() => { for (const e of enemies) e.sleepT = 1e9; });
  await g2.evaluate(() => { cb.iframe = 0; damage(9999); });
  await h2.evaluate(() => T.until(() => coopS.rp.down, 3000));
  await g2.evaluate(() => invUI.open());                                          // screens open while the run ends
  await h2.evaluate(() => { invUI.open(); cb.iframe = 0; damage(9999); });
  check('both down: the run ends for both', c2.ok && await h2.evaluate(() => T.until(() => state === 'dead', 3000)) && await g2.evaluate(() => T.until(() => state === 'dead', 3000)));
  const after = () => { invUI.close(); shopUI.close(); dealUI && state === 'deal' && dealUI.close(); return state === 'dead' && document.getElementById('invScreen').style.display === 'none'; };
  check('closing a screen does not bring a finished run back', await h2.evaluate(after) && await g2.evaluate(after));
}, { args: ['--disable-features=WebRtcHideLocalIpsWithMdns', '--disable-background-timer-throttling', '--disable-renderer-backgrounding', '--disable-backgrounding-occluded-windows'] });
