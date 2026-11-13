// The safe room behind the boss arena: sealed while the boss lives, open after it dies, no harm and no hunger inside, normal rules
// outside, the stairs end stage 1. Run on its own: node tests/game.safe.test.js
const { run } = require('./lib');
const T_WALL = 0, T_DOOR = 4, T_SAFEDOOR = 5;   // tile codes from js/gen.js, for the checks made in Node

// Page-side helpers (installed on each page). S.walk moves the player with the real movement code (fixed 120 Hz steps, wall
// collision) until cond() holds; S.reach is a flood fill from the start (T_DOOR stays shut unless doors is true); S.clearGuards
// removes the arena's guards (the boss stays, dormant, so the frame loop cannot hit you during a check).
const SAFE_HELPERS = () => {
  window.S = {
    walk(yaw, cond, max = 4000) {
      const P = game.player; P.yaw = yaw; P.keys = { [KEYS.forward]: true }; let n = 0;
      while (!cond() && n < max) { P.update(1 / 60, game.floor); n++; }
      P.keys = {}; P.vx = P.vz = 0; return n;
    },
    reach(f, doors) {
      const seen = new Uint8Array(f.w * f.h), q = [f.start.y * f.w + f.start.x]; seen[q[0]] = 1;
      for (let i = 0; i < q.length; i++) {
        const x = q[i] % f.w, y = (q[i] / f.w) | 0;
        for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
          const nx = x + dx, ny = y + dy; if (nx < 0 || ny < 0 || nx >= f.w || ny >= f.h) continue;
          const j = ny * f.w + nx, t = f.tiles[j];
          if (!seen[j] && t !== T_WALL && (doors || t !== T_DOOR)) { seen[j] = 1; q.push(j); }
        }
      }
      return seen;
    },
    clearGuards() {
      const keep = game.enemies.filter(e => e.boss);
      for (const e of game.enemies) if (!e.boss && e.mesh.parent) e.mesh.parent.remove(e.mesh);
      game.enemies.length = 0; game.enemies.push(...keep);
    },
  };
};

run('The safe room behind the boss', async ({ open, check }) => {
  let page = await open(7);
  await page.evaluate(SAFE_HELPERS);

  // 1. Before the boss dies: the door is a wall that looks like the arena wall, the safe room and its stairs cannot be reached, and you cannot walk through.
  const sealed = await page.evaluate(() => {
    game.startFloor(5); S.clearGuards();
    const f = game.floor, s = f.safe, d = s.door, r = s.rect, P = game.player;
    const seen = S.reach(f, false);
    let roomSeen = false; for (let y = r.y0; y <= r.y1; y++) for (let x = r.x0; x <= r.x1; x++) if (seen[y * f.w + x]) roomSeen = true;
    const block = s.o.mesh.children[0];
    const out = {
      door: f.tiles[d.y * f.w + d.x], doorBlocksPlayer: P.blocked(f, (d.x + 0.5) * TILE, (d.y + 0.5) * TILE),
      slabLowered: s.o.mesh.position.y === 0,
      sharesWallMaterial: group.children.some(c => c.isInstancedMesh && c.material === block.material),   // the arena wall tiles are one instanced mesh
      roomSeen, stairsSeen: seen[f.stairs.y * f.w + f.stairs.x] === 1,
    };
    P.x = (s.gate.x + 0.5) * TILE; P.z = (s.gate.y + 0.5) * TILE;      // stand on the gate, in front of the door, and walk north
    S.walk(0, () => false, 600);
    out.gateRow = s.gate.y; out.endRow = P.tileY;
    return out;
  });
  check('the hidden door is a closed door tile that looks like the arena wall', sealed.door === T_DOOR && sealed.slabLowered && sealed.sharesWallMaterial, JSON.stringify(sealed));
  check('before the boss dies the safe room and its stairs cannot be reached', !sealed.roomSeen && !sealed.stairsSeen && sealed.doorBlocksPlayer, `room ${sealed.roomSeen}, stairs ${sealed.stairsSeen}`);
  check('you cannot walk through the closed door', sealed.endRow === sealed.gateRow, `ended on row ${sealed.endRow}, gate row ${sealed.gateRow}`);

  // Mark an arena chest opened before the boss falls, so the walk back can check that opened chests are kept.
  await page.evaluate(() => {
    const chest = propObjs.find(o => ['chest', 'barrel', 'rubble'].includes(o.p.kind) && !o.p.opened);
    markOpened(chest); window.chestRef = chest;
  });

  // 2. The boss dies: a rumble, the door slides up, the room and its stairs become reachable; enemies still cannot see, path to or shoot through it.
  await page.evaluate(() => {
    const b = game.enemies.find(e => e.boss); b.hp = 1;
    dealHit(b, 'body', 20, weaponStats(makeItem({ type: 'weapon', base: 'sword', tier: 0 })), 0);
  });
  const fell = await page.evaluate(() => T.until(() => game.floor.safe.open, 4000));
  const rumble = await page.evaluate(() => ({ msg: document.getElementById('msg').textContent, tile: game.floor.tiles[game.floor.safe.door.y * game.floor.w + game.floor.safe.door.x] }));
  check('the boss falls and a rumble says the hidden door grinds open', fell && rumble.tile === T_SAFEDOOR && /rumble/i.test(rumble.msg), rumble.msg);
  const lowered = await page.evaluate(() => T.until(() => game.floor.safe.o.anim >= 1, 5000));
  check('the door slides up out of the way', lowered);

  const after = await page.evaluate(() => {
    const f = game.floor, s = f.safe, d = s.door, r = s.rect, P = game.player;
    const seen = S.reach(f, false);
    let roomSeen = false; for (let y = r.y0; y <= r.y1; y++) for (let x = r.x0; x <= r.x1; x++) if (seen[y * f.w + x]) roomSeen = true;
    const cx = (d.x + 0.5) * TILE, cz = (d.y + 0.5) * TILE;
    const gateX = (s.gate.x + 0.5) * TILE, gateZ = (s.gate.y + 0.5) * TILE, roomX = cx, roomZ = (r.y0 + 3.5) * TILE;
    const a = { x: gateX, y: 1, z: gateZ, vx: 0, vy: 0, vz: -12, gravity: 0, owner: 'enemy', kind: 'arrow', life: 4, stuck: false, px: gateX, pz: gateZ };
    const nobody = { x: -999, z: -999, radius: 0.35 };   // the arrow only meets walls here
    let ev = null; for (let i = 0; i < 80 && !ev; i++) ev = stepArrow(a, 0.02, f, [], nobody);   // an enemy arrow fired north from the gate
    return {
      tile: f.tiles[d.y * f.w + d.x], playerThrough: !P.blocked(f, cx, cz), roomSeen, stairs: seen[f.stairs.y * f.w + f.stairs.x] === 1,
      wallAt: wallAt(f, d.x, d.y),                                                                // enemy.js: a wall to guards
      mobBlocked: Player.prototype.blocked.call({ radius: 0.4, props: [], mob: true }, f, cx, cz),   // a guard's collider cannot enter
      losThroughDoor: hasLOS(f, gateX, gateZ, roomX, roomZ),
      enemyPath: findPath(f, s.gate.x, s.gate.y, f.stairs.x, f.stairs.y).length,
      arrow: ev && ev.type, arrowInDoor: Math.floor(a.z / TILE) === d.y,
    };
  });
  check('the open door is open to you and a wall to every enemy', after.tile === T_SAFEDOOR && after.playerThrough && after.wallAt && after.mobBlocked, JSON.stringify(after));
  check('after the boss dies the room and its stairs are reachable', after.roomSeen && after.stairs, `room ${after.roomSeen}, stairs ${after.stairs}`);
  check('no enemy can see, path to or shoot through the door', !after.losThroughDoor && after.enemyPath === 0 && after.arrow === 'wall' && after.arrowInDoor, `los ${after.losThroughDoor}, path ${after.enemyPath}, arrow ${after.arrow}`);

  // 3. Inside the safe room (walked in through the door): nothing hurts you, nothing drains, attacks and the bow do nothing, eating and potions work.
  const safe = await page.evaluate(() => {
    const f = game.floor, s = f.safe, d = s.door, r = s.rect, P = game.player, I = game.inv, cb = game.cb, H = game.hunger;
    P.x = (s.gate.x + 0.5) * TILE; P.z = (s.gate.y + 0.5) * TILE;
    S.walk(0, () => P.tileY <= r.y1, 3000);                                      // through the door and into the room
    updateCombat(0);
    const out = { inSafe, row: P.tileY, roomBottom: r.y1, door: d.y };
    I.hp = 60; H.v = 60; cb.stamina = 100; pst.clear();
    damage(15); out.hitHp = I.hp;
    const g = T.guard(1.2, 'toward', true); resolveEnemyAttack(g, 'body');     // a guard strikes you point blank
    g.mesh.parent && g.mesh.parent.remove(g.mesh); game.enemies.splice(game.enemies.indexOf(g), 1);
    out.guardHp = I.hp;
    I.hp = 60; pst.apply('bleed', 6); for (let i = 0; i < 12; i++) updateCombat(0.5);
    out.bleedHp = I.hp; pst.clear();
    H.v = 0; I.hp = 60; for (let i = 0; i < 240; i++) updateCombat(0.5);         // two minutes starving
    out.starveHp = I.hp; out.starveV = H.v;
    H.v = 60; for (let i = 0; i < 240; i++) updateCombat(0.5);                   // two minutes peckish: no drain
    out.drainV = H.v;
    I.hp = 20; for (let i = 0; i < 240; i++) updateCombat(0.5);                  // passive healing works here but stops at the 50% tier
    out.idleHp = I.hp; out.idleCap = I.maxHp * 0.5;
    I.hp = 60; springTrap('gas', { x: P.x, z: P.z }); out.gasHp = I.hp; pst.clear();
    explodeAt(P.x, P.z, null); out.blastHp = I.hp;                               // a blast right on top of you
    explodeAt((d.x + 0.5) * TILE, (d.y + 0.5) * TILE, null); out.doorBlastHp = I.hp;   // a blast at the door, from outside
    pst.clear(); I.hp = 60; H.v = 60;
    cb.stamina = 100; cb.press = true; updateCombat(0.02); cb.press = false;
    out.swing = cb.atk !== null || cb.draw !== null;
    const w0 = I.equip.weapon; I.equip.weapon = makeItem({ type: 'weapon', base: 'bow', tier: 0 }); I.arrows = 10;
    const shots = arrows.length;
    cb.press = true; updateCombat(0.02); cb.press = false; out.bowDraw = cb.draw !== null;
    fireArrow(1); out.bowShot = arrows.length !== shots || I.arrows !== 10;
    I.equip.weapon = w0; cb.draw = null;
    const food = makeItem({ type: 'food', kind: 'bread', n: 1 }); I.pack.push(food);
    H.v = 40; I.eatReq = food; updateCombat(0.02); out.eating = !!cb.eat;
    updateCombat(1.5); out.fedTo = H.v; out.ateItem = !I.find(food.id);
    const pot = makeItem({ type: 'potion', kind: 'heal', n: 1 }); I.pack.push(pot);
    I.hp = 20; I.drink(pot); out.potionHp = I.hp;
    I.hp = 60; H.v = 100; cb.stamina = 100;
    return out;
  });
  check('the player is inside the safe room, past the door', safe.inSafe && safe.row <= safe.roomBottom, `row ${safe.row}, room bottom ${safe.roomBottom}`);
  check('no damage from an enemy hit, bleeding, starving, a gas trap or a bomb blast', [safe.hitHp, safe.guardHp, safe.bleedHp, safe.starveHp, safe.gasHp, safe.blastHp, safe.doorBlastHp].every(h => h === 60) && safe.hitHp === 60, JSON.stringify(safe));
  check('hunger neither drains nor refills by itself, and passive healing here stops at the 50% tier', safe.starveV === 0 && safe.drainV === 60 && Math.abs(safe.idleHp - safe.idleCap) < 0.01, `starving ${safe.starveV}, fed ${safe.drainV}, hp ${safe.idleHp}`);
  check('attacks and the bow do nothing (no swing, no draw, no arrow)', !safe.swing && !safe.bowDraw && !safe.bowShot, JSON.stringify({ swing: safe.swing, draw: safe.bowDraw, shot: safe.bowShot }));
  check('eating from the pack still works and feeds', safe.eating && safe.ateItem && Math.abs(safe.fedTo - 65) < 1, `hunger ${safe.fedTo}`);
  check('a potion from the pack still heals', safe.potionHp === 60, `hp ${safe.potionHp}`);

  // 4. Walking back out to the arena: the door stays open, the normal rules come back, and the boss's body and the opened chest are kept.
  const back = await page.evaluate(() => {
    const f = game.floor, s = f.safe, d = s.door, P = game.player, I = game.inv, H = game.hunger, cb = game.cb;
    S.walk(Math.PI, () => P.tileY > d.y + 1, 3000);                              // south, out through the door
    updateCombat(0.02);
    const out = { inSafe, tile: f.tiles[d.y * f.w + d.x], lowered: s.o.anim >= 1 };
    I.hp = 60; damage(10); out.hitHp = I.hp;
    I.hp = 60; pst.apply('bleed', 6); for (let i = 0; i < 4; i++) updateCombat(0.5); out.bleedHp = I.hp; pst.clear();
    H.v = 60; H.fight = 0; updateCombat(10); out.drains = H.v < 60;
    H.v = 0; I.hp = 60; for (let i = 0; i < 20; i++) updateCombat(0.5); out.starveHp = I.hp;
    H.v = 100; I.hp = 60; cb.stamina = 100; cb.press = true; updateCombat(0.001); cb.press = false; out.swing = cb.atk !== null;
    cb.atk = null; I.hp = 60; H.v = 100;
    out.bodies = propObjs.some(o => o.p.kind === 'corpse' && o.p.left && o.p.left.length > 0);
    out.chestOpen = !!window.chestRef && window.chestRef.p.opened;
    return out;
  });
  check('back in the arena: the door stays open and the normal rules are back', !back.inSafe && back.tile === T_SAFEDOOR && back.lowered, JSON.stringify(back));
  check('back in the arena: hits, bleeding, hunger and starving hurt or drain as usual', back.hitHp === 50 && back.bleedHp < 60 && back.drains && back.starveHp < 60, JSON.stringify({ hit: back.hitHp, bleed: back.bleedHp, drains: back.drains, starve: back.starveHp }));
  check('back in the arena: attacks work again', back.swing);
  check('the boss body and the opened chest are kept', back.bodies && back.chestOpen);

  // 5. The stairs in the safe room: walking onto them goes through enterNextStage into stage 2 floor 1 (the run goes on; the pack carries over).
  await page.evaluate(() => {
    window.hookCalls = 0; const orig = enterNextStage; window.enterNextStage = () => { hookCalls++; orig(); };
    window.packBefore = game.inv.pack.length + '/' + game.inv.gold;
    const P = game.player, f = game.floor;
    P.x = (f.safe.gate.x + 0.5) * TILE; P.z = (f.safe.gate.y + 0.5) * TILE; P.keys = { [KEYS.forward]: true }; P.yaw = 0;
    game.inv.hp = game.inv.maxHp;
  });
  const next = await page.evaluate(() => T.until(() => game.stage === 2, 15000));
  const end = await page.evaluate(() => { game.player.keys = {}; return {
    hook: window.hookCalls, state: game.state, stage: game.stage, floorNum, text: document.getElementById('floor').textContent,
    pack: game.inv.pack.length + '/' + game.inv.gold === window.packBefore, boss: game.floor.boss === undefined || !game.floor.boss,
  }; });
  check('the stairs in the safe room go through enterNextStage to stage 2 floor 1 with the pack kept', next && end.hook === 1 && end.state === 'play' && end.floorNum === 1 && /Stage 2 \/ 4 - Floor 1 \/ 5/.test(end.text) && end.pack && end.boss, JSON.stringify(end));
  await page.evaluate(() => finishRun());   // end the run for the restart check below

  // 6. The restart button starts a fresh run on a new seed.
  const url0 = page.url();
  await Promise.all([page.waitForURL(u => u.toString() !== url0, { timeout: 20000 }), page.click('#overlay button')]);
  await page.waitForFunction(() => window.game && game.floor, null, { timeout: 20000 });
  const fresh = await page.evaluate(() => ({ seed: new URL(location.href).searchParams.get('seed'), state: game.state }));
  check('the restart button starts a new run on a new seed', fresh.seed !== '7' && fresh.state === 'menu', JSON.stringify(fresh));
  await page.close();

  // 7. Regression: main.js inSafe is a row test (tileY < door.y). On seed 3816266512 the boss arena has floor tiles north of the door row,
  //    so standing on one counts as the safe room (no damage, no hunger drain, no attacks). Expected to fail until inSafe checks the room.
  const p2 = await open(3816266512);
  await p2.evaluate(SAFE_HELPERS);
  await p2.evaluate(() => {
    game.startFloor(5); S.clearGuards();
    const b = game.enemies.find(e => e.boss); b.hp = 1;
    dealHit(b, "body", 20, weaponStats(makeItem({ type: "weapon", base: "sword", tier: 0 })), 0);
  });
  await p2.evaluate(() => T.until(() => game.floor.safe.open, 4000));
  const row = await p2.evaluate(() => {
    const f = game.floor;
    const d = f.safe.door, P = game.player, I = game.inv, H = game.hunger;
    const seen = S.reach(f, false), r = f.safe.rect;
    let spot = null;
    for (let y = 0; y < d.y && !spot; y++) for (let x = 0; x < f.w && !spot; x++) {
      if (!seen[y * f.w + x]) continue;
      const inRoom = x >= r.x0 && x <= r.x1 && y >= r.y0 && y <= r.y1, inPassage = x === d.x && y > r.y1;
      if (inRoom || inPassage) continue;                                           // the arena only: the room itself is safe by design
      const px = (x + 0.5) * TILE, pz = (y + 0.5) * TILE;
      if (!P.blocked(f, px, pz)) spot = { x: px, z: pz, y };
    }
    if (!spot) return { found: false };
    P.x = spot.x; P.z = spot.z; P.keys = {};
    updateCombat(0.02);
    const inside = f.safe.inside, rr = f.safe.rect; let inCount = 0; for (let i = 0; i < inside.length; i++) inCount += inside[i];
    const out = { found: true, row: spot.y, doorRow: d.y, inSafe, maskOk: inCount === (rr.x1 - rr.x0 + 1) * (rr.y1 - rr.y0 + 1) + (d.y - rr.y1 - 1) && !inside[d.y * f.w + d.x] && inside[(rr.y0) * f.w + rr.x0] === 1, mask: inCount };
    I.hp = 60; damage(10); out.hp = I.hp;
    H.v = 60; updateCombat(10); out.hunger = H.v;
    return out;
  });
  check('the safe-room mask is the room and its passage, and an arena tile north of the door row is not safe', row.found && row.maskOk && row.inSafe === false && row.hp === 50 && row.hunger < 60, JSON.stringify(row));
  await p2.close();
  // ---- The ally on the boss floor and in the safe room (run seed 2563011894: a Healing Potion recruit on floor 2, carried down to floor 5) ----
  // The boss attacks you while the ally fights it, and the boss never takes the ally as its foe. After the boss falls the ally rests in the
  // safe room and Hold E (allyTalk) gives its thank-you once; it leaves. Fixed steps for the fight (no frames run inside the call).
  {
    let page = await open(2563011894);
    await page.evaluate(SAFE_HELPERS);
    await page.evaluate(() => {
      window.AB = {
        noise: { n: 0, events: [], shoot() {}, steal() {}, emit() { this.n++; } },
        free(x, z, r = 2.5) { for (let d = 0; d <= r; d += 0.5) for (let k = 0; k < 16; k++) { const a = k * Math.PI / 8, xx = x + Math.sin(a) * d, zz = z + Math.cos(a) * d; if (!game.player.blocked(floor, xx, zz)) return { x: xx, z: zz }; } return { x, z }; },
        // fixed 1/60 s steps: the enemies update (returns their attack zones), then the ally; counts the zones the boss strikes with
        fight(sec, boss) {
          const dt = 1 / 60, n = Math.round(sec * 60), out = { zones: 0, fociOnAlly: 0 };
          for (let i = 0; i < n; i++) {
            for (const c of enemies.slice()) { const z = c.update(dt, game.player, AB.noise); if (c === boss && z) out.zones++; }
            allyStep(dt, AB.noise);
            if (boss.foe) out.fociOnAlly++;
          }
          return out;
        },
      };
    });
    const down = await page.evaluate(() => {
      game.startFloor(2); const A = allyRun, out = {};
      inv.pack.push(makeItem({ type: 'potion', kind: 'heal', n: 1 }));
      allyTalk(A); out.recruited = A.recruited;
      for (const n of [3, 4, 5]) {                                             // down the stairs, the ally within 6 m each time
        const s = AB.free(game.player.x, game.player.z, 1.5); A.e.x = s.x; A.e.z = s.z;
        changeFloor(n, 'down');
        out['floor' + n] = A.f === floor && A.mode === 'follow';
      }
      out.floorNum = floorNum;
      return out;
    });
    check('the recruit comes down the stairs with you to the boss floor', down.recruited && down.floor3 && down.floor4 && down.floor5 && down.floorNum === 5, JSON.stringify(down));

    const fight = await page.evaluate(() => {
      S.clearGuards(); const A = allyRun, b = enemies.find(e => e.boss), P = game.player, out = {};
      b.dormant = false; b.justWoke = true; b.set('alerted'); b.last = { x: P.x, z: P.z };
      const s = AB.free(b.x - 2.5, b.z, 1); A.e.x = s.x; A.e.z = s.z; A.foeE = null; A.think = 0; A.fightT = 0;
      const p = AB.free(b.x + 4.5, b.z, 1); P.x = p.x; P.z = p.z;
      out.hp0 = A.e.hp; out.bossHp0 = b.hp;
      const r = AB.fight(8, b);
      out.zones = r.zones; out.foeOnAlly = r.fociOnAlly; out.allyHp = A.e.hp; out.bossHp = b.hp; out.bossTargetsPlayer = !b.foe;
      out.ally = !!A.e && A.mode;
      return out;
    });
    check('the boss strikes at the player while the ally fights it, and never takes the ally as its foe', fight.zones > 0 && fight.foeOnAlly === 0, JSON.stringify(fight));

    await page.close();
    // The same chain on a second load, with no boss fight: the ally rests in the safe room and gives its thank-you.
    page = await open(2563011894);
    await page.evaluate(SAFE_HELPERS);
    await page.evaluate(() => {
      window.AB = {
        noise: { n: 0, events: [], shoot() {}, steal() {}, emit() { this.n++; } },
        free(x, z, r = 2.5) { for (let d = 0; d <= r; d += 0.5) for (let k = 0; k < 16; k++) { const a = k * Math.PI / 8, xx = x + Math.sin(a) * d, zz = z + Math.cos(a) * d; if (!game.player.blocked(floor, xx, zz)) return { x: xx, z: zz }; } return { x, z }; },
        // fixed 1/60 s steps: the enemies update (returns their attack zones), then the ally; counts the zones the boss strikes with
        fight(sec, boss) {
          const dt = 1 / 60, n = Math.round(sec * 60), out = { zones: 0, fociOnAlly: 0 };
          for (let i = 0; i < n; i++) {
            for (const c of enemies.slice()) { const z = c.update(dt, game.player, AB.noise); if (c === boss && z) out.zones++; }
            allyStep(dt, AB.noise);
            if (boss.foe) out.fociOnAlly++;
          }
          return out;
        },
      };
    });
    const down2 = await page.evaluate(() => {
      game.startFloor(2); const A = allyRun, out = {};
      inv.pack.push(makeItem({ type: 'potion', kind: 'heal', n: 1 }));
      allyTalk(A); out.recruited = A.recruited;
      for (const n of [3, 4, 5]) {                                             // down the stairs, the ally within 6 m each time
        const s = AB.free(game.player.x, game.player.z, 1.5); A.e.x = s.x; A.e.z = s.z;
        changeFloor(n, 'down');
        out['floor' + n] = A.f === floor && A.mode === 'follow';
      }
      out.floorNum = floorNum;
      return out;
    });

    const kill = await page.evaluate(async () => {
      const A = allyRun, b = enemies.find(e => e.boss); const out = {};
      b.foe = null; b.dormant = true; b.set('unaware'); b.hp = 1; dealHit(b, 'body', 20, weaponStats(makeItem({ type: 'weapon', base: 'sword', tier: 0 })), 0);
      out.open = await T.until(() => floor.safe && floor.safe.open, 4000);
      const r = floor.safe.rect, P = game.player, f = floor, s = f.safe;
      P.x = (s.gate.x + 0.5) * TILE; P.z = (s.gate.y + 0.5) * TILE;
      S.walk(0, () => P.tileY <= r.y1, 3000);                                  // into the safe room
      out.inRoomWait = await T.until(() => A.mode === 'safe', 5000);
      out.mode = A.mode; out.label = targetInfo(A.o).label;
      return out;
    });
    check('after the boss falls the ally rests in the safe room and its Hold E prompt offers the thank-you', kill.open && kill.inRoomWait && kill.mode === 'safe' && /thank-you/.test(kill.label), JSON.stringify(kill));

    const reward = await page.evaluate(() => {
      const A = allyRun, I = inv, before = { gold: I.gold, pack: I.pack.map(i => i.id) };
      allyTalk(A); const got = { gold: I.gold - before.gold, newItems: I.pack.filter(i => !before.pack.includes(i.id)) };
      const left = A.mode === 'gone' && !propObjs.includes(A.o) && !A.e.mesh.parent;
      const g2 = I.gold, p2 = I.pack.length; allyTalk(A);
      return { gold: got.gold, items: got.newItems.map(i => ({ type: i.type, tier: i.tier })), left, once: I.gold === g2 && I.pack.length === p2, line: allyLine(floor) };
    });
    const gearOk = reward.items.length === 1 && reward.items[0].tier >= 2, goldOk = reward.gold >= 150 && reward.gold <= 200;
    check('Hold E on the ally in the safe room gives one thank-you (Rare+ gear, or 150 to 200 gold on floor 5) and the ally leaves', (gearOk || goldOk) && reward.left && reward.once && reward.line === '', JSON.stringify(reward));
    await page.close();
  }
});
