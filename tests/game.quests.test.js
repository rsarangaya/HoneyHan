// Encounters (js/quests.js): the locked mini-boss room and the shrine bargain, in the running game. Run on its own:
// node tests/game.quests.test.js. The layouts and the roll are checked in plain Node by tests/gen.test.js.
// Seeds (found with generateFloor and rollQuests, themes included): seed 38 has the mini-boss on floor 2 (the lair key is on a
// reachable chest); seed 48 has the shrine on floor 4 and no encounter on floor 1. The wanted guard (defector, target, reward) is
// checked on seed 3 floor 2, and the sack thief (wander, flee, cornered, escape, kills, sack) on seed 10 floor 2 (see the end of the run).
// The flee checks use free tiles and the thief's own collider; one check there is a known defect and fails on purpose (see its comment).
const { run } = require('./lib');
const MINI_SEED = 38, MINI_FLOOR = 2, SHRINE_SEED = 48;   // seed 38: mini-boss on floor 2; seed 48: shrine on floor 4

// Page-side helpers: hold or release E, face a prop (1.1 m off), open and close the inventory with Tab / Escape.
const QH = () => {
  window.Qs = {
    key: on => { game.player.keys[KEYS.interact] = on; },
    // A free spot 1.2 to 2.1 m from o, facing it (the altar's own collision keeps 1.1 m out).
    face(o) {
      const P = game.player, f = game.floor;
      for (const d of [1.2, 1.5, 1.8, 2.1]) for (let k = 0; k < 16; k++) {
        const a = k * Math.PI / 8, x = o.x + Math.sin(a) * d, z = o.z + Math.cos(a) * d;
        if (!P.blocked(f, x, z)) { P.x = x; P.z = z; P.yaw = Math.atan2(-(o.x - x), -(o.z - z)); P.pitch = 0; P.vx = P.vz = 0; return true; }
      }
      return false;
    },
    altar: () => propObjs.find(o => o.p.kind === 'altar'),
    // the shrine scenarios are about the altar, not the floor's guards (a theme's ambushers, such as the Jungle's jaguars, would otherwise wake and bite while the test stands there)
    calm() { for (const e of game.enemies) e.mesh.parent && e.mesh.parent.remove(e.mesh); game.enemies.length = 0; },
    press: code => window.dispatchEvent(new KeyboardEvent('keydown', { code, bubbles: true, cancelable: true })),
    invText: () => { const r = document.getElementById('invScreen'); return r && r.style.display !== 'none' ? r.textContent : null; },
    // a clean pack, full health, a deal for this altar, and no leftovers from the last scenario
    fresh(deal) {
      game.inv.maxHp = 100; game.inv.hp = 100; game.inv.stamBonus = 0; game.inv.pack = []; game.inv.equip.helmet = null;
      game.cb.stamina = 100; game.cb.delay = 0; Qs.calm();
      if (deal) game.floor.quest.deal = deal;
    },
  };
};

run('Encounters: the mini-boss room and the shrine bargain', async ({ open, check }) => {
  // ---- The locked mini-boss room (seed 38, floor 2) ----
  const mini = await open(MINI_SEED);
  await mini.evaluate(QH);
  const m = await mini.evaluate(async n => {
    game.startFloor(n);
    const f = game.floor, q = f.quest, boss = q && q.boss, out = {};
    out.type = q && q.type;
    out.lair = f.doors.some(d => d.room === 'lair' && d.lock === q.lock);
    out.bossFound = !!boss;
    if (!boss) return out;
    const guard = new Enemy({ x: boss.spec.x, y: boss.spec.y, route: [{ x: boss.spec.x, y: boss.spec.y }], seed: 1, type: 'goblin' }, f);
    out.hpRatio = boss.maxHp / guard.maxHp;
    out.dmgMul = boss.T.dmgMul; out.elite = boss.elite; out.noStagger = !!boss.T.noStagger;
    out.sneakCap = boss.T.sneakCap; out.daggerSneak = WSTATS.dagger.sneak;
    out.tag = !!(boss.tag && boss.tag.parent === boss.mesh); out.name = q.name; out.bossName = boss.spec.mini && boss.spec.mini.name;
    out.line = questLine(f);
    return out;
  }, MINI_FLOOR);
  check('the lair door is on the floor and the mini-boss is the quest', m.type === 'miniboss' && m.lair && m.bossFound, JSON.stringify(m));
  check('the mini-boss has about three times a guard\'s health and 1.5 times its damage', Math.abs(m.hpRatio - 3) < 0.01 && m.dmgMul === 1.5, `hp x${m.hpRatio}, dmg x${m.dmgMul}`);
  check('the mini-boss is an elite: no stagger, and a sneak attack is capped below a dagger instakill', m.elite && m.noStagger && m.sneakCap < m.daggerSneak, `sneakCap ${m.sneakCap}, dagger ${m.daggerSneak}`);
  check('the mini-boss has its name over its head and the line names it', m.tag && m.bossName === m.name && m.line.includes(m.name), m.line);

  // The inventory says so, and only while the mini-boss lives.
  await mini.evaluate(() => Qs.press('Tab'));
  const invOpen = await mini.evaluate(() => T.until(() => Qs.invText() !== null, 3000));
  const invTxt = await mini.evaluate(() => Qs.invText() || '');
  await mini.evaluate(() => Qs.press('Tab'));                       // Tab closes it (Escape would also open the pause menu, see the report)
  check('the inventory shows the "Optional:" line while the mini-boss lives', invOpen && /Optional:/.test(invTxt) && invTxt.includes(m.name), invTxt.slice(0, 80));

  // Killing it: a corpse with its loot, the tag goes, and the line goes.
  const kill = await mini.evaluate(async () => {
    const boss = floor.quest.boss;
    boss.hurt(1e9, game.player);
    const done = await T.until(() => boss.corpseDone, 5000);
    const corpse = propObjs.find(o => o.p.kind === 'corpse' && o.p.type === 'miniboss');
    return { done, corpse: !!corpse, tagHidden: !!boss.tag && !boss.tag.visible, line: questLine(floor), log: document.getElementById('log').textContent };
  });
  check('killing the mini-boss leaves a corpse with its loot, hides its tag and clears the line', kill.done && kill.corpse && kill.tagHidden && kill.line === '', JSON.stringify({ ...kill, log: undefined }));
  check('the kill is logged with the mini-boss\'s name', kill.log.includes(m.name), '');
  await mini.close();

  // A floor with no encounter has no line.
  const plain = await open(SHRINE_SEED);
  await plain.evaluate(QH);
  const none = await plain.evaluate(() => { game.startFloor(1); Qs.press('Tab'); return { line: questLine(floor), txt: Qs.invText() }; });
  await plain.evaluate(() => Qs.press('Tab'));
  check('a floor with no encounter shows no "Optional:" line', none.line === '' && none.txt !== null && !/Optional:/.test(none.txt), none.line);

  // ---- The shrine bargain (seed 48, floor 4) ----
  const shrineOn = () => plain.evaluate(() => { game.startFloor(4); return !!(floor.quest && floor.quest.type === 'shrine' && Qs.altar()); });
  check('the shrine floor has an altar where the quest says', await shrineOn());
  const cant = await plain.evaluate(async () => {
    game.startFloor(4); Qs.calm(); const a = Qs.altar(); Qs.face(a); game.inv.hp = 100;
    playerHit();                                   // swing at the altar
    await T.sleep(50);
    return { state: game.state, opened: !!a.p.opened, used: !!floor.quest.used, hp: game.inv.hp };
  });
  check('an altar cannot be attacked: a swing does nothing and the deal screen stays shut', cant.state === 'play' && !cant.opened && !cant.used, JSON.stringify(cant));
  const inline = await plain.evaluate(() => questLine(floor));
  check('the shrine line is shown until the altar is used', /altar/.test(inline), inline);

  // Hold E: the deal screen opens (the game pauses, the screen is shown).
  const holdE = async () => {
    await plain.evaluate(() => { Qs.calm(); Qs.face(Qs.altar()); Qs.key(true); });
    const ok = await plain.evaluate(() => T.until(() => game.state === 'deal', 15000));
    await plain.evaluate(() => Qs.key(false));
    return ok;
  };
  const screenShown = () => plain.evaluate(() => { const e = document.getElementById('dealScreen'); return !!e && getComputedStyle(e).display === 'flex'; });
  // Decline: nothing changes, and the altar is still there to use.
  await plain.evaluate(() => Qs.fresh({ price: 'maxhp', slot0: 0, boon: 'stamina' }));
  const opened1 = await holdE();
  const shown1 = await screenShown();
  await plain.evaluate(() => document.querySelector('#dealScreen [data-act="decline"]').click());
  const afterDecline = await plain.evaluate(() => ({ state: game.state, used: !!floor.quest.used, maxHp: game.inv.maxHp, stam: game.inv.stamBonus }));
  check('holding E at the altar opens the deal screen', opened1 && shown1, '');
  check('declining closes the screen with nothing paid or given, and the altar is still usable', afterDecline.state === 'play' && !afterDecline.used && afterDecline.maxHp === 100 && afterDecline.stam === 0, JSON.stringify(afterDecline));
  const opened2 = await holdE();
  await plain.evaluate(() => Qs.press('Escape'));
  const afterEsc = await plain.evaluate(() => game.state);
  check('the altar opens again after a decline, and Escape walks away too', opened2 && afterEsc === 'play', afterEsc);

  // Accept, max HP price + stamina boon: 15 max HP gone (health capped and the HUD follows), +25% stamina regen, altar used up.
  await plain.evaluate(() => Qs.fresh({ price: 'maxhp', slot0: 0, boon: 'stamina' }));
  await holdE();
  await plain.evaluate(() => document.querySelector('#dealScreen [data-act="accept"]').click());
  await plain.evaluate(() => T.until(() => document.getElementById('hpFill').style.width === '85%', 2000));
  const maxhpRes = await plain.evaluate(() => ({ maxHp: game.inv.maxHp, hp: game.inv.hp, bar: document.getElementById('hpFill').style.width, stam: game.inv.stamBonus, used: !!floor.quest.used, opened: !!Qs.altar().p.opened, state: game.state, shown: (document.getElementById('dealScreen') && getComputedStyle(document.getElementById('dealScreen')).display) || 'none' }));
  check('max HP price: max HP drops by 15, health and the HUD follow, +25% stamina regen, the altar is used up', maxhpRes.maxHp === 85 && maxhpRes.hp === 85 && maxhpRes.bar === '100%' && maxhpRes.stam === 0.25 && maxhpRes.used && maxhpRes.opened && maxhpRes.state === 'play' && maxhpRes.shown === 'none', JSON.stringify(maxhpRes));
  const usedAgain = await plain.evaluate(async () => { Qs.face(Qs.altar()); Qs.key(true); const ok = await T.until(() => game.state === 'deal', 1500); Qs.key(false); return { ok, state: game.state }; });
  check('a used altar does not open the deal screen again', !usedAgain.ok && usedAgain.state === 'play', JSON.stringify(usedAgain));
  const lineAfter = await plain.evaluate(() => questLine(floor));
  check('a used shrine drops out of the "Optional:" line', lineAfter === '', lineAfter);

  // Refused below 40 max HP: the accept button is disabled and nothing changes.
  await plain.evaluate(() => { game.startFloor(4); Qs.fresh({ price: 'maxhp', slot0: 0, boon: 'stamina' }); game.inv.maxHp = 50; game.inv.hp = 50; });
  await holdE();
  const low = await plain.evaluate(() => ({ disabled: document.querySelector('#dealScreen [data-act="accept"]').disabled, maxHp: game.inv.maxHp, text: document.querySelector('#dealScreen .note').textContent }));
  check('max HP below 40: the bargain is refused and the accept button is disabled', low.disabled && low.maxHp === 50 && /max HP/.test(low.text), JSON.stringify(low));
  await plain.evaluate(() => Qs.press('Escape'));

  // Accept, gear price + weapon boon: the equipped helmet is gone, a Rare-Epic weapon comes to the pack.
  const gearOut = await plain.evaluate(() => {
    game.startFloor(4); Qs.fresh({ price: 'gear', slot0: 0, boon: 'weapon' });
    game.inv.equip.helmet = makeItem({ type: 'armor', slot: 'helmet', cls: Object.keys(ARMOR_NAMES.helmet)[0], tier: 0 });
    game.floor.quest.deal = { price: 'gear', slot0: 0, boon: 'weapon' };
    return { ok: true };
  });
  await holdE();
  await plain.evaluate(() => document.querySelector('#dealScreen [data-act="accept"]').click());
  const gearRes = await plain.evaluate(() => ({ helmet: game.inv.equip.helmet, weapons: game.inv.pack.filter(i => i.type === 'weapon').map(i => i.tier), used: !!floor.quest.used }));
  check('gear price: the equipped helmet is given up and a Rare or Epic weapon is received', gearOut.ok && gearRes.helmet === null && gearRes.weapons.some(t => t === 2 || t === 3) && gearRes.used, JSON.stringify(gearRes));

  // Accept, potion price + treasure boon: the biggest potion stack goes, an unknown treasure comes.
  const potOut = await plain.evaluate(() => {
    game.startFloor(4); Qs.fresh({ price: 'potions', slot0: 0, boon: 'treasure' });
    game.inv.add({ type: 'potion', kind: Object.keys(POTIONS)[0], n: 3 });
    game.floor.quest.deal = { price: 'potions', slot0: 0, boon: 'treasure' };
    return { stackId: game.inv.pack[0].id, gold: game.inv.gold, arrows: game.inv.arrows };
  });
  await holdE();
  await plain.evaluate(() => document.querySelector('#dealScreen [data-act="accept"]').click());
  const potRes = await plain.evaluate(id => ({ stackGone: !game.inv.pack.some(i => i.id === id), packNow: game.inv.pack.length, gold: game.inv.gold, arrows: game.inv.arrows, used: !!floor.quest.used }), potOut.stackId);
  check('potion price: the whole potion stack goes and the treasure is received', potRes.stackGone && (potRes.packNow > 0 || potRes.gold > potOut.gold || potRes.arrows > potOut.arrows) && potRes.used, JSON.stringify({ potRes, potOut }));
  await plain.close();
  // ---- The wanted guard (seed 3: defector on floor 2; floor 4 is its shop floor) and the sack thief (seed 10: thief on floor 2) ----
  // Each case starts a fresh floor from the same run seed. A fight runs inside one evaluate call (no frames in between), so the
  // swings, shots and stabs land exactly where the test put the enemy. Frames still run between calls (Hold E, escapes, corpses).
  const WANT_SEED = 3, THIEF_SEED = 10;
  const WH = () => {
    const inR = (r, p) => p.x >= r.x && p.x < r.x + r.w && p.y >= r.y && p.y < r.y + r.h;
    const dist = (e, P) => Math.hypot(e.x - P.x, e.z - P.z);
    window.Ws = {
      inR, dist,
      // A fresh floor n: full health, an empty pack, a sword in hand, the regular guards removed (the quest's own enemies stay),
      // and the player at the open end of the longest line of sight.
      fresh(n) {
        game.startFloor(n);
        const q = floor.quest, keep = e => e === (q && q.boss) || e === (q && q.thief) || e.type === 'sackthief' || e.type === 'wanted';
        for (let i = game.enemies.length - 1; i >= 0; i--) { const e = game.enemies[i]; if (keep(e)) continue; if (e.mesh.parent) e.mesh.parent.remove(e.mesh); game.enemies.splice(i, 1); }
        game.inv.maxHp = 100; game.inv.hp = 100; game.inv.pack = []; game.inv.quick = [null, null, null, null]; game.inv.arrows = 20;
        game.inv.equip.weapon = makeItem({ type: 'weapon', base: 'sword', tier: 0 });
        game.cb.stamina = 100; game.cb.delay = 0; game.cb.want = false; game.cb.draw = null; game.cb.atk = null;
        Ws.aimLongest();
        return q || null;
      },
      aimLongest() {
        const P = game.player, f = game.floor;
        let best = 0, yaw = 0;
        for (let k = 0; k < 16; k++) { const a = k * Math.PI / 8; let d = 0; while (d < 8 && !P.blocked(f, P.x - Math.sin(a) * (d + 0.5), P.z - Math.cos(a) * (d + 0.5))) d += 0.5; if (d > best) { best = d; yaw = a; } }
        P.yaw = yaw; P.pitch = 0; P.vx = P.vz = 0; P.keys = {};
      },
      // Move the player to the free tile farthest from the given points, so nothing on that route can see them.
      far(points) {
        const P = game.player, f = game.floor; let bx = P.x, bz = P.z, bd = -1;
        for (let y = 1; y < f.h - 1; y++) for (let x = 1; x < f.w - 1; x++) {
          if (f.tiles[y * f.w + x] !== 1 || f.blocked[y * f.w + x]) continue;
          const px = (x + 0.5) * TILE, pz = (y + 0.5) * TILE;
          const d = Math.min(...points.map(p => Math.hypot((p.x + 0.5) * TILE - px, (p.y + 0.5) * TILE - pz)));
          if (d > bd) { bd = d; bx = px; bz = pz; }
        }
        P.x = bx; P.z = bz; return bd;
      },
      // Put an enemy d metres in front of the player: facing the player ('toward') or the player's own way ('away').
      place(e, d, facing) {
        const P = game.player, f = game.floor;
        collider.props = f.solids;                              // the enemy collider: furniture and the stairwell, as goTo uses it
        const free = (x, z) => !Player.prototype.blocked.call(collider, f, x, z) && !f.solids.some(s => s.r > 0 && (x - s.x) ** 2 + (z - s.z) ** 2 < (s.r + 0.36) ** 2);
        for (const dd of [d, d - 0.5, d + 0.5, d - 1, d + 1, 2]) {
          const x = P.x - Math.sin(P.yaw) * dd, z = P.z - Math.cos(P.yaw) * dd;
          if (!free(x, z)) continue;
          e.x = x; e.z = z; e.yaw = facing === 'toward' ? Math.atan2(-(P.x - x), -(P.z - z)) : P.yaw; e.sync(0);
          return true;
        }
        return false;
      },
      spotNear(dmin, dmax) {
        const P = game.player, f = game.floor;
        collider.props = f.solids;
        const free = (x, z) => !Player.prototype.blocked.call(collider, f, x, z) && !f.solids.some(s => s.r > 0 && (x - s.x) ** 2 + (z - s.z) ** 2 < (s.r + 0.36) ** 2);
        for (let dy = -8; dy <= 8; dy++) for (let dx = -8; dx <= 8; dx++) {
          const x = (Math.floor(P.x / TILE) + dx + 0.5) * TILE, z = (Math.floor(P.z / TILE) + dy + 0.5) * TILE, d = Math.hypot(x - P.x, z - P.z);
          if (d < dmin || d > dmax || !free(x, z) || !hasLOS(f, x, z, P.x, P.z)) continue;
          return { x, z };
        }
        return null;
      },
      npc: () => propObjs.find(o => o.p.kind === 'questnpc'),
      log: () => document.getElementById('log').textContent,
      msg: () => document.getElementById('msg').textContent,
      corpses: type => propObjs.filter(o => o.p.kind === 'corpse' && o.p.type === type),
      // The sack on the thief's body, rolled exactly as the game rolls it when the body is opened.
      sack() {
        const c = Ws.corpses('sackthief')[0];
        if (!c) return null;
        const drop = rollLoot('corpse', floorNum, makeRng(c.p.seed), c.p.bonus || 0, c.p.gear || [], c.p.type);
        return { gold: drop.filter(d => d.type === 'gold').reduce((a, d) => a + d.n, 0), gear: drop.filter(d => ['weapon', 'armor', 'shield'].includes(d.type)).map(d => d.tier) };
      },
    };
  };
  // Hold E on the defector until the page says the talk happened (target is a page-side function that returns a promise or a value).
  const holdDefector = async (page, target) => {
    await page.evaluate(() => { Qs.face(Ws.npc()); Qs.key(true); });
    await page.evaluate(target);
    await page.evaluate(() => Qs.key(false));
  };

  // ---- the wanted guard, seed 3 ----
  const WG = await open(WANT_SEED);
  await WG.evaluate(QH); await WG.evaluate(WH);
  const wa = await WG.evaluate(() => {
    const q = Ws.fresh(2), out = { type: q && q.type };
    if (!q) return out;
    const r0 = floor.rooms[0], npc = Ws.npc(), boss = q.boss;
    out.npcOnFloor = !!npc; out.npcInStart = Ws.inR(r0, q.npc);
    out.npcBlocked = !!floor.blocked[q.npc.y * floor.w + q.npc.x];
    out.defectorInEnemies = enemies.some(e => e.type === 'defector');
    out.targetFound = !!boss;
    if (!boss) return out;
    const guard = new Enemy({ x: boss.spec.x, y: boss.spec.y, route: [{ x: boss.spec.x, y: boss.spec.y }], seed: 1, type: 'goblin' }, floor);
    out.hpRatio = boss.maxHp / guard.maxHp; out.dmgRatio = boss.dmgMul / guard.dmgMul;
    out.elite = boss.elite; out.plate = boss.gear.filter(g => g.type === 'armor' && g.cls === 2).length;
    out.tag = !!(boss.tag && boss.tag.parent === boss.mesh && boss.spec.mini.name === q.name);
    out.patrolsRoom = !!floor.rooms.find(r => r.theme === q.room && r !== r0 && q.route.every(p => Ws.inR(r, p)));
    out.routeLen = q.route.length;
    out.line = questLine(floor); out.prompt = targetInfo(npc).label;
    out.name = q.name; out.room = q.room;
    return out;
  });
  check('the defector stands in the start room on a blocked tile, and is not in the enemy list', wa.npcOnFloor && wa.npcInStart && wa.npcBlocked && !wa.defectorInEnemies, JSON.stringify({ npcOnFloor: wa.npcOnFloor, npcInStart: wa.npcInStart, npcBlocked: wa.npcBlocked, inList: wa.defectorInEnemies }));
  check('the target has about twice a guard\'s health, 1.3 times its damage, plate, the elite rules and a name tag', Math.abs(wa.hpRatio - 2) < 0.01 && Math.abs(wa.dmgRatio - 1.3) < 0.01 && wa.elite && wa.plate >= 3 && wa.tag, JSON.stringify({ hp: wa.hpRatio, dmg: wa.dmgRatio, plate: wa.plate, tag: wa.tag }));
  check('the target patrols a two-point route inside an ordinary room of the named kind', wa.patrolsRoom && wa.routeLen === 2, `${wa.room}`);
  check('before talking, the Hold E label and the line say so', wa.prompt === 'Talk to the hooded stranger' && /Talk to it \(hold E\)/.test(wa.line), `${wa.prompt} | ${wa.line}`);

  // The target's patrol, stepped in game time with the player out of sight: it walks between its two points and never sees the player.
  const wp = await WG.evaluate(() => {
    const q = floor.quest, P = game.player, out = {};
    Ws.far(q.route);
    const b = new Enemy({ x: q.route[0].x, y: q.route[0].y, route: q.route, seed: q.seed, type: 'wanted', mini: { name: q.name } }, floor);
    const noise = { events: [], emit() {}, shoot() {}, steal() {} }, dt = 1 / 60;
    let turns = 0, last = b.ri, alerted = false;
    for (let i = 0; i < 60 * 100; i++) { b.update(dt, P, noise); if (b.ri !== last) { turns++; last = b.ri; } if (b.state === 'alerted') alerted = true; }
    out.turns = turns; out.alerted = alerted;
    return out;
  });
  check('the target patrols: it reaches both route points within 100 s and does not notice a player out of sight', wp.turns >= 2 && !wp.alerted, JSON.stringify(wp));

  // The defector cannot be hurt: a swing at it does nothing, and an arrow flying into it stops at the body without a hit.
  const wd = await WG.evaluate(() => {
    const q = floor.quest, npc = Ws.npc(), P = game.player, before = enemies.length;
    Qs.face(npc);
    playerHit();
    const a = { x: npc.x - 0.9, y: 1.0, z: npc.z, vx: 16, vy: 0, vz: 0, owner: 'player', stuck: false, dmg: 50, w: {} };
    let ev = null;
    for (let i = 0; i < 60 && !ev; i++) ev = stepArrow(a, 1 / 60, floor, enemies, P);
    return { stillThere: propObjs.includes(npc), enemiesSame: enemies.length === before, arrow: ev && ev.type, talked: !!q.talked };
  });
  check('the defector cannot be hit: a swing does nothing, an arrow stops at its body, nothing reacts', wd.stillThere && wd.enemiesSame && wd.arrow === 'wall' && !wd.talked, JSON.stringify(wd));

  // Hold E: the talk gives the target's name and room, and the prompt and line move on.
  await holdDefector(WG, () => T.until(() => floor.quest.talked, 6000));
  const wt = await WG.evaluate(() => ({ talked: floor.quest.talked, log: Ws.log(), prompt: targetInfo(Ws.npc()).label, line: questLine(floor), room: WANTED_ROOMS[floor.quest.room], name: floor.quest.name }));
  check('Hold E talk names the target and its room, and the prompt and line move on', wt.talked && wt.log.includes(wt.name) && wt.log.includes(wt.room) && wt.prompt === 'Talk to the defector' && wt.line.includes(`Hunt ${wt.name}, who patrols the ${wt.room}`), `${wt.room} | ${wt.prompt} | ${wt.line}`);

  // Kill with a normal swing, never talking first on this floor is not needed here: the claim comes after the kill.
  await WG.evaluate(() => Ws.fresh(2));
  await holdDefector(WG, () => T.until(() => floor.quest.talked, 6000));
  const kill1 = await WG.evaluate(() => {
    const boss = floor.quest.boss, P = game.player;
    Ws.place(boss, 1.2, 'toward'); boss.set('alerted'); boss.last = { x: P.x, z: P.z };
    for (let i = 0; i < 60 && !boss.dead; i++) playerHit();
    Ws.corpses('wanted').forEach(o => { o.p.opened = true; });       // searched already: the Hold E below is for the defector, not its loot
    return { dead: boss.dead, corpseDone: boss.corpseDone, line: questLine(floor) };
  });
  check('a normal melee kill ends the target and the line asks for the return', kill1.dead && kill1.corpseDone && /is dead\. Return to the defector/.test(kill1.line), JSON.stringify(kill1));
  await holdDefector(WG, () => T.until(() => floor.quest.done, 6000));
  const r1 = await WG.evaluate(() => ({ done: !!floor.quest.done, pack: game.inv.pack.map(i => i.type + (i.kind ? ':' + i.kind : '') + (i.tier !== undefined ? ':t' + i.tier : '')), line: questLine(floor) }));
  check('the reward after a melee kill: one potion or Rare-or-better gear, and the line clears', r1.done && r1.pack.length === 1 && r1.line === '', JSON.stringify(r1));
  await holdDefector(WG, () => T.until(() => /Thank you/.test(Ws.msg()), 6000));
  const r2 = await WG.evaluate(() => ({ pack: game.inv.pack.length, msg: Ws.msg() }));
  check('the reward is given only once: the second talk thanks you and the pack is unchanged', r2.pack === 1 && /Thank you/.test(r2.msg), JSON.stringify(r2));

  // Sneak kill: talk first, then one clean stab from behind while it is unaware, then claim.
  await WG.evaluate(() => Ws.fresh(2));
  await holdDefector(WG, () => T.until(() => floor.quest.talked, 6000));
  const wsn = await WG.evaluate(() => {
    const boss = floor.quest.boss;
    boss.hp = 1;                                                // a sneak sword does ~110 on a wooden target at most; the stab is what is tested, not the damage sum
    Ws.place(boss, 1.2, 'away'); boss.set('unaware'); boss.aware = 0; boss.last = null; boss.seen = false;
    playerHit();
    Ws.corpses('wanted').forEach(o => { o.p.opened = true; });
    return { dead: boss.dead, state: boss.state };
  });
  check('a sneak stab from behind kills the target', wsn.dead, JSON.stringify(wsn));
  await holdDefector(WG, () => T.until(() => floor.quest.done, 6000));
  const r3 = await WG.evaluate(() => ({ done: !!floor.quest.done, pack: game.inv.pack.length }));
  check('the reward after a sneak kill is claimed', r3.done && r3.pack === 1, JSON.stringify(r3));

  // Ranged: a sneak arrow (bow, unaware target), then claim without a talk.
  await WG.evaluate(() => Ws.fresh(2));
  const wr = await WG.evaluate(() => {
    const boss = floor.quest.boss, P = game.player;
    game.inv.equip.weapon = makeItem({ type: 'weapon', base: 'bow', tier: 0 });
    boss.hp = 1; Ws.place(boss, 6, 'away'); boss.set('unaware'); boss.aware = 0; boss.last = null; boss.seen = false;
    P.pitch = 0;
    let shots = 0;
    for (let i = 0; i < 8 && !boss.dead; i++) { fireArrow(1); shots++; for (let k = 0; k < 600 && arrows.some(a => a.owner === 'player' && !a.stuck); k++) updateArrows(1 / 120); }
    Ws.corpses('wanted').forEach(o => { o.p.opened = true; });
    return { dead: boss.dead, shots };
  });
  check('an arrow kills the target too', wr.dead, JSON.stringify(wr));
  await holdDefector(WG, () => T.until(() => floor.quest.done, 6000));
  const r4 = await WG.evaluate(() => ({ done: !!floor.quest.done, pack: game.inv.pack.length }));
  check('the reward after an arrow kill, claimed without any talk first, is given', r4.done && r4.pack === 1, JSON.stringify(r4));

  // Seeded repeat: the same seed gives the same defector, target, name and route on a second run.
  const WG2 = await open(WANT_SEED);
  await WG2.evaluate(QH); await WG2.evaluate(WH);
  const sig = page => page.evaluate(() => { const q = Ws.fresh(2); return JSON.stringify({ npc: q.npc, route: q.route, name: q.name, room: q.room }); });
  const sigA = await sig(WG), sigB = await sig(WG2);
  check('a seeded wanted guard repeats: the same defector, target and route on a second run', sigA === sigB, sigA.slice(0, 120));
  await WG2.close(); await WG.close();

  // ---- the sack thief, seed 10 (floor 2) ----
  const TH = await open(THIEF_SEED);
  await TH.evaluate(QH); await TH.evaluate(WH);
  // Wandering: a thief that has not noticed you walks between its two rooms and never sees you from out of sight. (90 s: seed 10 is the Mushroom Cellar now, whose winding one-tile passages make the walk between two rooms longer than a plain floor's.)
  const tw = await TH.evaluate(() => {
    const q = Ws.fresh(2), P = game.player, out = { line: questLine(floor) };
    Ws.far(q.route);
    const th = new Enemy({ x: q.route[0].x, y: q.route[0].y, route: q.route, seed: q.seed, type: 'sackthief' }, floor);
    const noise = { events: [], emit() {}, shoot() {}, steal() {} }, dt = 1 / 60;
    let turns = 0, last = th.ri, alerted = false;
    for (let i = 0; i < 60 * 90; i++) { th.update(dt, P, noise); if (th.ri !== last) { turns++; last = th.ri; } if (th.state === 'alerted') alerted = true; }
    out.turns = turns; out.alerted = alerted;
    return out;
  });
  check('the thief line shows on the floor, and the thief wanders between its rooms unseen', /loot sack/.test(tw.line) && tw.turns >= 2 && !tw.alerted, JSON.stringify(tw));

  // Flee on sight: a free spot 3.5 to 5 m away, facing you. Counts the flee re-plans (floodDist calls) while it is alerted, and times the AI.
  const tf = await TH.evaluate(() => {
    Ws.fresh(2);
    const P = game.player, out = {}, real = floodDist;
    Ws.fd = 0; window.floodDist = (...a) => { Ws.fd++; return real(...a); };
    const th = new Enemy({ x: 0, y: 0, route: [{ x: 0, y: 0 }, { x: 0, y: 0 }], seed: 77, type: 'sackthief' }, floor);
    const sp = Ws.spotNear(3.5, 5);
    out.placed = !!sp;
    if (sp) { th.x = sp.x; th.z = sp.z; th.yaw = Math.atan2(-(P.x - sp.x), -(P.z - sp.z)); }
    th.route = [{ x: th.x, z: th.z }, { x: th.x, z: th.z }];
    const noise = { events: [], emit() {}, shoot() {}, steal() {} }, dt = 1 / 60;
    const hp0 = game.inv.hp, gold0 = game.inv.gold;
    let zones = 0, alertedAt = -1, t = 0, minBefore = 1e9;
    out.d0 = Ws.dist(th, P);
    for (let i = 0; i < 60 * 3 && alertedAt < 0; i++) {
      t += dt; minBefore = Math.min(minBefore, Ws.dist(th, P));
      if (th.update(dt, P, noise)) zones++;
      if (th.state === 'alerted') alertedAt = t;
    }
    out.minBefore = minBefore; out.dAlert = Ws.dist(th, P);
    const fd0 = Ws.fd, frames = 60 * 6, t0 = performance.now();
    let alertedFrames = 0;
    for (let i = 0; i < frames; i++) { if (th.state === 'alerted') alertedFrames++; if (th.update(dt, P, noise)) zones++; }
    const ms = performance.now() - t0;
    window.floodDist = real;
    out.alertedAt = alertedAt; out.dEnd = Ws.dist(th, P);
    out.thinks = (Ws.fd - fd0) / 2; out.seconds = alertedFrames * dt; out.zones = zones;
    out.hpSame = game.inv.hp === hp0; out.goldSame = game.inv.gold === gold0; out.escaped = th.escaped; out.state = th.state;
    out.msPerUpdate = ms / frames;
    return out;
  });
  check('a thief that sees you runs (alerted within 3 s, farther away 6 s later), never attacks, never steals', tf.placed && tf.alertedAt >= 0 && tf.dEnd > tf.dAlert + 1 && tf.zones === 0 && tf.hpSame && tf.goldSame, JSON.stringify({ d0: tf.d0, alertedAt: tf.alertedAt, dAlert: tf.dAlert, dEnd: tf.dEnd, zones: tf.zones, hpSame: tf.hpSame, goldSame: tf.goldSame }));
  check('the flee route is re-planned about every 0.5 s while it runs, not every frame', tf.thinks >= tf.seconds / 0.5 - 1.5 && tf.thinks <= tf.seconds / 0.5 + 2, `${tf.thinks} re-plans in ${tf.seconds.toFixed(1)} s alerted`);
  console.log(`perf: a fleeing sack thief costs ${tf.msPerUpdate.toFixed(4)} ms per AI update (budget: about 1 ms of game logic a frame for all enemies)`);
  // Known defect, kept failing on purpose until fixed: a thief that sees you steps toward you while it is still making up its mind
  // (enemy.js, the suspicious case walks to the last place it saw you). A thief should turn and run from the first sight.
  check('a thief that sees you does not walk toward you before it runs', tf.minBefore >= tf.d0 - 0.25, `${tf.d0.toFixed(2)} m when it saw you, closest ${tf.minBefore.toFixed(2)} m before it turned to run`);

  // Cornered: no spot it can reach first (the floor's flee spots are empty) means it cowers, stops and turns to you.
  const tc = await TH.evaluate(() => {
    const q = Ws.fresh(2), P = game.player;
    floor.fleeSpots = []; floor.fleeA = new Int32Array(floor.w * floor.h); floor.fleeB = new Int32Array(floor.w * floor.h);   // no spot the thief reaches before you: a dead end
    const th = new Enemy({ x: 0, y: 0, route: [{ x: 0, y: 0 }, { x: 0, y: 0 }], seed: 78, type: 'sackthief' }, floor);
    Ws.place(th, 3, 'away'); th.route = [{ x: th.x, z: th.z }, { x: th.x, z: th.z }];
    th.set('alerted'); th.last = { x: P.x, z: P.z };
    const noise = { events: [], emit() {}, shoot() {}, steal() {} }, dt = 1 / 60;
    for (let i = 0; i < 60; i++) th.update(dt, P, noise);     // a second to notice the dead end
    const x0 = th.x, z0 = th.z, out = { cower: th.cower };
    let zones = 0;
    for (let i = 0; i < 120; i++) if (th.update(dt, P, noise)) zones++;
    const want = Math.atan2(-(P.x - th.x), -(P.z - th.z));
    out.moved = Math.hypot(th.x - x0, th.z - z0); out.zones = zones; out.escaped = th.escaped;
    out.facingOff = Math.abs(Math.atan2(Math.sin(want - th.yaw), Math.cos(want - th.yaw)));
    return out;
  });
  check('cornered in a dead end the thief cowers: it stops, turns to you, and never attacks', tc.cower && tc.moved < 0.01 && tc.zones === 0 && !tc.escaped && tc.facingOff < 0.2, JSON.stringify(tc));

  // Escape: next to the stairs and running, it gets down them. The message says so, the sack is lost, nothing is paid.
  await TH.evaluate(() => Ws.fresh(2));
  const te = await TH.evaluate(() => {
    const th = floor.quest.thief, S = floor.stairs, P = game.player, cx = (S.x + 0.5) * TILE, cz = (S.y + 0.5) * TILE;
    let placed = false;
    for (const d of [2, 1.5, 2.5]) for (let k = 0; k < 16 && !placed; k++) {
      const a = k * Math.PI / 8, x = cx + Math.sin(a) * d, z = cz + Math.cos(a) * d;
      if (!P.blocked(floor, x, z)) { th.x = x; th.z = z; th.sync(0); placed = true; }
    }
    th.set('alerted'); th.last = { x: P.x, z: P.z }; th.seen = false;
    return { placed, gold: game.inv.gold };
  });
  const tEsc = await TH.evaluate(() => T.until(() => floor.quest.thief.escaped, 4000));
  const te2 = await TH.evaluate(() => ({ dead: floor.quest.thief.dead, gone: !!floor.quest.gone, msg: Ws.msg(), sacks: Ws.corpses('sackthief').length, gold: game.inv.gold, line: questLine(floor), pack: game.inv.pack.length }));
  check('a thief that reaches the stairs escapes with a message, the sack is lost and nothing is paid', te.placed && tEsc && te2.dead && te2.gone && /escapes down the stairs/.test(te2.msg) && te2.sacks === 0 && te2.gold === te.gold && te2.pack === 0 && te2.line === '', JSON.stringify({ placed: te.placed, tEsc, ...te2 }));

  // Any kill drops the sack, whichever way it dies: a sneak stab, a melee swing, an arrow. Each run starts a fresh floor.
  const kills = {};
  kills.sneak = await TH.evaluate(() => {
    const th = Ws.fresh(2).thief;
    Ws.place(th, 1.2, 'away'); th.set('unaware'); th.aware = 0; th.last = null; th.seen = false;
    playerHit();
    return { dead: th.dead, sack: Ws.sack(), line: questLine(floor) };
  });
  kills.melee = await TH.evaluate(() => {
    const th = Ws.fresh(2).thief, P = game.player;
    Ws.place(th, 1.2, 'toward'); th.set('alerted'); th.last = { x: P.x, z: P.z };
    for (let i = 0; i < 40 && !th.dead; i++) playerHit();
    return { dead: th.dead, sack: Ws.sack() };
  });
  kills.arrow = await TH.evaluate(() => {
    const th = Ws.fresh(2).thief, P = game.player;
    game.inv.equip.weapon = makeItem({ type: 'weapon', base: 'bow', tier: 0 });
    Ws.place(th, 4, 'away'); th.set('unaware'); th.aware = 0; th.last = null; th.seen = false; P.pitch = 0;
    for (let i = 0; i < 8 && !th.dead; i++) { fireArrow(1); for (let k = 0; k < 600 && arrows.some(a => a.owner === 'player' && !a.stuck); k++) updateArrows(1 / 120); }
    return { dead: th.dead, sack: Ws.sack() };
  });
  // Floor 2: gold 40 to 80 plus 15 a floor (70 to 110), and one Uncommon or better item.
  const sackOk = s => s && s.gold >= 70 && s.gold <= 110 && s.gear.length === 1 && s.gear[0] >= 1;
  check('a sneak stab, a melee swing and an arrow each kill the thief and leave its sack (gold and an Uncommon+ item)', ['sneak', 'melee', 'arrow'].every(k => kills[k].dead && sackOk(kills[k].sack)), JSON.stringify(kills));
  check('the thief line clears once the thief is dead', kills.sneak.line === '', kills.sneak.line);

  // Seeded repeat for the thief: the same route and start on a second run.
  const TH2 = await open(THIEF_SEED);
  await TH2.evaluate(QH); await TH2.evaluate(WH);
  const tsig = page => page.evaluate(() => { const q = Ws.fresh(2); return JSON.stringify({ route: q.route, thief: [q.thief.x, q.thief.z] }); });
  const tA = await tsig(TH), tB = await tsig(TH2);
  check('a seeded sack thief repeats: the same route and start on a second run', tA === tB, tA.slice(0, 100));
  await TH2.close(); await TH.close();
  // ---- The prisoner rescue (seeds 56 and 110 on floor 2, 52 on floor 3: the cell fits and the key sits on a guard; found with generateFloor) ----
  // The cell door and body, the untargetable captive, the key from a melee kill and a sneak kill, the door, the walk to the stairs (fixed
  // steps, every step checked against solid props), the frame hook (no work when nothing walks), the safe-room reward: paid once, kept across floors.
  {
    const PH = () => {
      window.PR = {
        place(e, d, facing) {
          const P = game.player, f = game.floor;
          for (const dd of [d, d - 0.5, d + 0.5, 2]) {
            const x = P.x - Math.sin(P.yaw) * dd, z = P.z - Math.cos(P.yaw) * dd;
            if (!P.blocked(f, x, z)) { e.x = x; e.z = z; e.yaw = facing === 'away' ? P.yaw : Math.atan2(-(P.x - x), -(P.z - z)); e.sync(0); return true; }
          }
          return false;
        },
        cellDoor: () => propObjs.find(o => o.p.room === 'cell'),
        corpseWithKey: () => propObjs.find(o => o.p.kind === 'corpse' && (o.p.extra || []).some(it => it.type === 'key')),
        frames: async n => { for (let i = 0; i < n; i++) await new Promise(r => requestAnimationFrame(r)); },
        // Walks the freed prisoner with fixed 1/60 s steps (no frames run inside this call) until it is gone or 90 s of game time pass.
        walk() {
          const F = floor, e = F.quest.cell.e, T = TILE, S = F.stairs, out = { steps: 0, through: 0 };
          collider.props = F.solids;
          const x0 = e.x, z0 = e.z, t0 = performance.now(), log0 = pending.length;
          while (prisonerWalk && out.steps < 60 * 90) {
            prisonerStep(1 / 60); out.steps++;
            if (prisonerWalk && Player.prototype.blocked.call(collider, F, e.x, e.z)) out.through++;   // inside a solid prop or a wall
          }
          out.ms = (performance.now() - t0) / Math.max(1, out.steps);
          out.moved = Math.hypot(e.x - x0, e.z - z0);
          out.gone = !prisonerWalk && !e.mesh.visible;
          out.nearStairs = Math.max(Math.abs(Math.floor(e.x / T) - S.x), Math.abs(Math.floor(e.z / T) - S.y)) <= 1;
          out.slipLog = document.getElementById('log').textContent.includes('slips down the stairs');
          out.noise = pending.length - log0;                                             // what guards would hear: nothing from the walk
          return out;
        },
      };
    };
    const SEEDS = [[56, 2], [110, 2], [52, 3]];
    const walks = [];
    for (const [seed, n] of SEEDS) {
      const pg = await open(seed);
      await pg.evaluate(QH); await pg.evaluate(PH);
      if (seed === 56) await pg.evaluate(() => { window.psCalls = 0; const real = prisonerStep; window.prisonerStep = dt => { psCalls++; return real(dt); }; });
      const info = await pg.evaluate(async n => {
        game.startFloor(n);
        const q = floor.quest, out = { type: q && q.type };
        if (!q || q.type !== 'prisoner') return out;
        const body = q.cell.o, d = PR.cellDoor();
        out.keyOn = q.keyOn; out.doorLabel = d ? targetInfo(d).label : null;
        out.bodySolid = floor.solids.includes(q.cell.sol); out.bodyInProps = propObjs.includes(body);
        out.enemyListHasPrisoner = enemies.some(e => e.type === 'prisoner');
        Qs.face(body);
        out.bodyTargetInfo = !!targetInfo(body); out.bodyLookTarget = lookTarget() === body;
        out.line = questLine(floor);
        if (typeof psCalls === 'number') { const c0 = psCalls; for (let i = 0; i < 20; i++) await new Promise(r => requestAnimationFrame(r)); out.idleCalls = psCalls - c0; }
        return out;
      }, n);
      check(`seed ${seed}: floor ${n} has a prisoner; the cell door says it needs its theme's key; the body is solid, not an enemy, not a target`,
        info.type === 'prisoner' && /Cell Key|Cask Key|Garden Key/.test(info.doorLabel || '') && info.bodySolid && info.bodyInProps && !info.enemyListHasPrisoner && !info.bodyTargetInfo && !info.bodyLookTarget,
        JSON.stringify(info));
      check(`seed ${seed}: the Optional line says where the key is`, /a guard carries it|it is in a chest/.test(info.line || ''), info.line);
      if (seed === 113) check('before the cell opens, the frame loop calls the walk step zero times in 20 frames', info.idleCalls === 0, `${info.idleCalls} calls`);

      // Untargetable: swings, a bow shot and a blast right on the captive leave it whole, and the body stays put.
      const hit = await pg.evaluate(() => {
        const q = floor.quest, e = q.cell.e, hp0 = e.hp, body = q.cell.o, P = game.player;
        game.inv.equip.weapon = makeItem({ type: 'weapon', base: 'sword', tier: 0 }); game.inv.hp = game.inv.maxHp;
        Qs.face(body); P.keys = {};
        for (let i = 0; i < 40; i++) playerHit();
        game.inv.equip.weapon = makeItem({ type: 'weapon', base: 'bow', tier: 0 }); game.inv.arrows = 20;
        P.pitch = 0; fireArrow(1);
        for (let k = 0; k < 900 && arrows.some(a => a.owner === 'player' && !a.stuck); k++) updateArrows(1 / 120);
        explodeAt(e.x, e.z, null);
        return { hp: e.hp, hp0, dead: !!e.dead, body: propObjs.includes(body) };
      });
      check(`seed ${seed}: the prisoner takes no damage from a sword, an arrow or a blast`, hit.hp === hit.hp0 && !hit.dead && hit.body, JSON.stringify(hit));

      if (seed === 113) {
        // The key from a melee kill of the guard that carries it: an awake fight, then the corpse with the key on it.
        const kill = await pg.evaluate(async () => {
          const c = enemies.find(e => e.spec.carry);
          if (!c) return { found: false };
          game.inv.hp = game.inv.maxHp; game.inv.equip.weapon = makeItem({ type: 'weapon', base: 'sword', tier: 0 });
          PR.place(c, 1.2, 'toward'); c.set('alerted'); c.last = { x: game.player.x, z: game.player.z };
          for (let i = 0; i < 80 && !c.dead; i++) playerHit();
          const done = await T.until(() => c.corpseDone, 5000);
          return { found: true, dead: c.dead, done, corpse: !!PR.corpseWithKey() };
        });
        check('the guard carrying the cell key dies to a melee kill and leaves a corpse with the key on it', kill.found && kill.dead && kill.done && kill.corpse, JSON.stringify(kill));
        const loot = await pg.evaluate(async () => {
          const c = PR.corpseWithKey(); Qs.face(c); Qs.key(true);
          const ok = await T.until(() => game.inv.has('key', floor.quest.lock), 15000); Qs.key(false);
          return { ok, line: questLine(floor) };
        });
        check('searching that corpse puts the cell key in the pack and the line says so', loot.ok && /You have the cell key/.test(loot.line), JSON.stringify(loot));
        // A sneak stab from behind kills the carrier too: a fresh floor 2 (same seed, same carrier).
        const sneak = await pg.evaluate(() => {
          game.startFloor(2);
          const c = enemies.find(e => e.spec.carry);
          if (!c) return { found: false };
          game.inv.equip.weapon = makeItem({ type: 'weapon', base: 'sword', tier: 0 });
          PR.place(c, 1.2, 'away'); c.set('unaware'); c.aware = 0; c.last = null; c.seen = false;
          playerHit();
          return { found: true, dead: c.dead, corpse: !!PR.corpseWithKey() };
        });
        check('a sneak stab on the key guard kills it and leaves the key on its corpse', sneak.found && sneak.dead && sneak.corpse, JSON.stringify(sneak));
      } else {
        await pg.evaluate(() => game.inv.add({ type: 'key', lock: floor.quest.lock, label: 'Cell Key' }));   // the key, as if looted
      }

      // Free it: hold E on the cell door with the key. The line says it is free and due in the safe room.
      const freed = await pg.evaluate(async () => {
        const o = PR.cellDoor(), q = floor.quest, c = q.cell.e;
        Qs.face(o); Qs.key(true);
        const ok = await T.until(() => q.freed, 15000); Qs.key(false);
        return { ok, line: questLine(floor), doorTile: floor.tiles[o.p.y * floor.w + o.p.x], walking: !!prisonerWalk, visible: c.mesh.visible };
      });
      check(`seed ${seed}: holding E with the key opens the cell; the prisoner is free and walking`, freed.ok && freed.walking && freed.visible && freed.doorTile === 1 && /You freed the prisoner/.test(freed.line), JSON.stringify(freed));

      // The walk: reaches the stairs and is gone within 90 s of game time, never inside a solid prop, and makes no noise.
      const w = await pg.evaluate(() => PR.walk());
      walks.push({ seed, ...w });
      check(`seed ${seed}: the freed prisoner reaches the stairs and is gone within 90 s, through no solid prop`,
        w.gone && w.nearStairs && w.slipLog && w.through === 0 && w.steps < 60 * 90 && w.moved > 3 && w.noise === 0,
        `${(w.steps / 60).toFixed(1)} s, moved ${w.moved.toFixed(1)} m, solid contacts ${w.through}, noise ${w.noise}, near stairs ${w.nearStairs}, log ${w.slipLog}`);

      if (seed === 113) {
        // The safe room after the boss: the prisoner stands inside the room, prompts, and survives leaving and coming back.
        const boss = await pg.evaluate(async () => {
          game.startFloor(5);
          const b = enemies.find(e => e.boss); b.hp = 1;
          dealHit(b, 'body', 20, weaponStats(makeItem({ type: 'weapon', base: 'sword', tier: 0 })), 0);
          const open = await T.until(() => floor.safe && floor.safe.open, 4000);
          const r = floor.safe.rect, o = propObjs.find(p => p.p.who === 'prisoner'), out = { open, has: !!o };
          if (!o) return out;
          const tx = Math.floor(o.x / TILE), ty = Math.floor(o.z / TILE);
          out.inRoom = tx >= r.x0 && tx <= r.x1 && ty >= r.y0 && ty <= r.y1 && !(tx === floor.stairs.x && ty === floor.stairs.y);
          out.label = targetInfo(o).label; out.line = questLine(floor);
          changeFloor(4, 'up'); changeFloor(5, 'down');
          out.kept = propObjs.some(p => p.p.who === 'prisoner') && !prisonerRun.paid;
          return out;
        });
        check('the safe room after the boss holds the freed prisoner inside the room, with a reward prompt and a line', boss.open && boss.has && boss.inRoom && /Take the prisoner/.test(boss.label) && /waits in the safe room/.test(boss.line || ''), JSON.stringify(boss));
        check('after leaving the boss floor and coming back, the prisoner is still there and unpaid', boss.kept, JSON.stringify(boss));
        const pay = await pg.evaluate(async () => {
          const o = propObjs.find(p => p.p.who === 'prisoner'), I = game.inv;
          const snap = () => JSON.stringify({ pack: I.pack.map(i => i.id), gold: I.gold, arrows: I.arrows });
          const before = snap();
          Qs.face(o); Qs.key(true);
          const paid = await T.until(() => prisonerRun.paid, 15000); Qs.key(false);
          const got = snap(), line = questLine(floor);
          Qs.face(o); Qs.key(true); await PR.frames(20); Qs.key(false);            // a second hold: nothing more
          return { paid, changed: got !== before, line, once: snap() === got, opened: !!o.p.opened, msg: document.getElementById('msg').textContent };
        });
        check('holding E pays the reward once: the pack, gold or arrows change, the line clears, a second hold pays nothing', pay.paid && pay.changed && pay.line === '' && pay.once && pay.opened, JSON.stringify(pay));
        const idleAfter = await pg.evaluate(async () => { const c0 = psCalls; await PR.frames(20); return psCalls - c0; });
        check('after the walk, the frame loop calls the walk step zero times in 20 frames', idleAfter === 0, `${idleAfter} calls`);
      }
      await pg.close();
    }
    for (const w of walks) console.log(`prisoner walk seed ${w.seed}: ${(w.steps / 60).toFixed(1)} s game time, ${w.ms.toFixed(4)} ms per step (budget: well under 0.1 ms a step)`);
  }
  // ---- The ally recruit (run seed 2563011894 floor 2: a Healing Potion ask; run seed 4015597624 floor 2: a gold ask of 70; found with rollQuests, the run theme and generateFloor) ----
  // Page helpers: a stub noise sink, real enemies placed by hand, and a fixed-step runner (player walk, enemy updates, allyStep) that runs no frames.
  {
    const AH = () => {
      const pl = () => game.player;
      window.AL = {
        noise: { n: 0, r: [], events: [], shoot() {}, steal() {}, emit(x, z, r) { this.n++; this.r.push(r); } },
        clearEnemies() { for (const e of enemies) if (e.mesh.parent) e.mesh.parent.remove(e.mesh); enemies.length = 0; },
        mk(x0, z0, yaw, type = 'goblin') {
          const sp = AL.spot(x0, z0), x = sp.x, z = sp.z;                             // a free spot near the one asked for
          const e = new Enemy({ x: Math.floor(x / TILE), y: Math.floor(z / TILE), route: [{ x: 0, y: 0 }, { x: 0, y: 0 }], seed: 777, type }, floor);
          e.x = x; e.z = z; e.yaw = yaw; e.wait = 1e9; e.mesh.visible = true; scene.add(e.mesh); enemies.push(e); e.sync(0); return e;
        },
        spot(x, z) { for (const d of [0, 0.5, 1, 1.5, 2, 2.5]) for (let k = 0; k < 8; k++) { const a = k * Math.PI / 4, xx = x + Math.sin(a) * d, zz = z + Math.cos(a) * d; if (!pl().blocked(floor, xx, zz)) return { x: xx, z: zz }; } return { x, z }; },
        ring(x, z, d) { for (let k = 0; k < 32; k++) { const a = k * Math.PI / 16, xx = x + Math.sin(a) * d, zz = z + Math.cos(a) * d; if (!pl().blocked(floor, xx, zz)) return { x: xx, z: zz }; } return { x, z }; },
        place(x, z) { const s = AL.spot(x, z), p = pl(); p.x = s.x; p.z = s.z; p.vx = p.vz = 0; return s; },
        putAlly(x0, z0) { const e = allyRun.e, sp = AL.spot(x0, z0), x = sp.x, z = sp.z; e.x = x; e.z = z; e.yaw = 0; allyRun.ptile = -1; allyRun.walk = false; allyRun.foeE = null; allyRun.fightT = 0; allyRun.think = 0; e.sync(0); return e; },
        dist() { const e = allyRun.e; return Math.hypot(e.x - pl().x, e.z - pl().z); },
        // sec seconds of fixed 1/60 s steps: the player walks on its keys (walk), the enemies update (enemies), then the ally. Returns the largest ally-player gap.
        steps(sec, o = {}) {
          const n = Math.round(sec * 60), dt = 1 / 60; let maxD = 0;
          for (let i = 0; i < n; i++) {
            if (o.walk) pl().update(dt, floor);
            if (o.enemies) for (const c of enemies.slice()) c.update(dt, pl(), AL.noise);
            allyStep(dt, AL.noise);
            maxD = Math.max(maxD, AL.dist());
          }
          return maxD;
        },
        longest() { let best = 0, yaw = 0; for (let k = 0; k < 16; k++) { const a = k * Math.PI / 8; let d = 0; while (d < 10 && !pl().blocked(floor, pl().x + Math.sin(a) * (d + 0.5), pl().z + Math.cos(a) * (d + 0.5))) d += 0.5; if (d > best) { best = d; yaw = a; } } return yaw; },
        walk(on, yaw = 0, crouch = false) { pl().yaw = yaw; pl().keys = { ...(on ? { [KEYS.forward]: true } : {}), ...(crouch ? { [KEYS.crouch]: true } : {}) }; },
        async holdE(o, cond, ms = 15000) { Qs.face(o); Qs.key(true); const ok = await T.until(cond, ms); Qs.key(false); return ok; },
        potions: () => inv.pack.filter(i => i.type === 'potion' && i.kind === 'heal').reduce((a, i) => a + i.n, 0),
        // a fresh ally for each check: full HP, follow, on the recruit's own tile (or the nearest free one), think timer reset; the player 9 m east, 12 m south
        stage() { AL.clearEnemies(); const A = allyRun, q = floor.quest.npc; A.mode = 'follow'; A.e.hp = A.e.maxHp; AL.putAlly((q.x + 0.5) * TILE, (q.y + 0.5) * TILE); AL.place(A.e.x + 9, A.e.z - 12); return A; },
        // a free spot 3 to 7 m from the ally with a clear line to it, and a yaw that faces the ally (the cone test in allyThink)
        watch(A) { for (const r of [4, 5, 6, 3, 7]) for (let k = 0; k < 16; k++) { const a = k * Math.PI / 8, x = A.e.x + Math.sin(a) * r, z = A.e.z + Math.cos(a) * r; if (pl().blocked(floor, x, z) || !hasLOS(floor, A.e.x, A.e.z, x, z)) continue; return { x, z, yaw: Math.atan2(x - A.e.x, z - A.e.z) }; } return { x: A.e.x, z: A.e.z - 4, yaw: Math.PI }; },
        msg: () => document.getElementById('msg').textContent,
      };
    };
    const pg = await open(2563011894);
    await pg.evaluate(QH); await pg.evaluate(AH);
    const first = await pg.evaluate(() => { game.startFloor(2); const A = allyRun; return [A.ask, A.price, A.name, A.e.x, A.e.z]; });

    // 1. Before the recruit: a neutral body, not an enemy, not a target of a swing, not Rage's pick; the prompt names the ask.
    const pre = await pg.evaluate(() => {
      const A = allyRun, out = { has: !!A };
      if (!A) return out;
      out.ask = A.ask; out.inEnemies = enemies.includes(A.e); out.enemyAlly = Enemy.ally === A.e;
      out.label = targetInfo(A.o).label; out.recruited = A.recruited;
      const g = AL.mk(A.e.x - 3, A.e.z, Math.PI / 2);                             // a raging goblin 3 m off
      g.enrage(5, A.e.x, A.e.z); g.update(1 / 60, game.player, AL.noise);
      out.rageAtAlly = g.rageTarget === A.e;
      game.inv.equip.weapon = makeItem({ type: 'weapon', base: 'sword', tier: 0 }); Qs.face(A.o); const hp0 = A.e.hp;
      for (let i = 0; i < 40; i++) playerHit();
      out.hpSame = A.e.hp === hp0;
      AL.clearEnemies();
      return out;
    });
    check('before the recruit the ally is a neutral body: not an enemy, prompts the ask, and Rage and swings never pick it',
      pre.has && !pre.inEnemies && !pre.enemyAlly && !pre.recruited && pre.hpSame && !pre.rageAtAlly && /Recruit the .*Healing Potion/.test(pre.label) && pre.ask === 'potion', JSON.stringify(pre));

    // 2. The Healing Potion ask: refused with none (nothing taken), then accepted with one (the potion is used up, the ally follows).
    const refused = await pg.evaluate(async () => {
      inv.pack = []; const ok = await AL.holdE(allyRun.o, () => /you have none/.test(AL.msg()) || allyRun.recruited, 8000);
      return { ok, recruited: allyRun.recruited, msg: AL.msg() };
    });
    check('a Healing Potion ask with no potion is refused and the ally stays unrecruited', refused.ok && !refused.recruited && /you have none/.test(refused.msg), JSON.stringify(refused));
    const took = await pg.evaluate(async () => {
      inv.pack.push(makeItem({ type: 'potion', kind: 'heal', n: 1 })); const before = AL.potions();
      const ok = await AL.holdE(allyRun.o, () => allyRun.recruited, 15000);
      return { ok, before, after: AL.potions(), mode: allyRun.mode, enemyAlly: Enemy.ally === allyRun.e, line: questLine(floor) };
    });
    check('a Healing Potion recruits the ally: the potion is used up, it follows, and the line says so', took.ok && took.before === 1 && took.after === 0 && took.mode === 'follow' && took.enemyAlly && /follows you/.test(took.line), JSON.stringify(took));

    // 3. Following: 2.5 to 3.8 m behind once it settles, closes in from 6 m, walks alongside (under 8 m), makes a 4 m walk noise only while walking.
    const follow = await pg.evaluate(() => {
      const out = {}; const P = game.player, A = allyRun;
      const far = AL.ring(P.x, P.z, 6); AL.putAlly(far.x, far.z); out.farStart = AL.dist();
      AL.steps(6); out.settled = AL.dist();
      AL.noise.n = 0; AL.noise.r = [];
      const dir = AL.longest(); AL.walk(true, dir); out.walkMax = AL.steps(6, { walk: true }); AL.walk(false);
      out.walkNoise = AL.noise.n; out.noiseR = [...new Set(AL.noise.r)]; out.walkedFar = out.walkMax > 3.8;
      AL.noise.n = 0; AL.steps(5); out.stillNoise = AL.noise.n; out.stillDist = AL.dist();
      A.mode = 'wait'; const x0 = A.e.x, z0 = A.e.z; AL.walk(true, dir); AL.steps(4, { walk: true }); AL.walk(false); A.mode = 'follow';
      out.waitMove = Math.hypot(A.e.x - x0, A.e.z - z0);
      AL.noise.n = 0; AL.walk(true, dir, true); AL.steps(4, { walk: true }); AL.walk(false); out.crouchNoise = AL.noise.n;
      return out;
    });
    check('it follows 2.5 to 3.8 m behind: closes in from 6 m, settles in that band, and keeps within 8 m while you walk',
      follow.farStart > 5.9 && follow.settled >= 2.4 && follow.settled <= 3.8 && follow.stillDist >= 2.4 && follow.stillDist <= 3.8 && follow.walkMax < 8, JSON.stringify(follow));
    check('it makes a walking noise of 4 m while it walks; none standing still, waiting or sneaking',
      follow.walkNoise >= 1 && follow.noiseR.length === 1 && follow.noiseR[0] === 4 && follow.stillNoise === 0 && follow.waitMove === 0 && follow.crouchNoise === 0, JSON.stringify(follow));

    // 4. Wait / Follow: Hold E on it toggles, and the message says which.
    const toggle = await pg.evaluate(async () => {
      const a = await AL.holdE(allyRun.o, () => allyRun.mode === 'wait', 15000); const m1 = allyRun.mode, msg1 = AL.msg();
      const b = await AL.holdE(allyRun.o, () => allyRun.mode === 'follow', 15000);
      return { a, m1, msg1, b, m2: allyRun.mode };
    });
    check('Hold E toggles the ally between wait and follow', toggle.a && toggle.m1 === 'wait' && /waits here/.test(toggle.msg1) && toggle.b && toggle.m2 === 'follow', JSON.stringify(toggle));

    // 5. Fights. Guards are cleared for each check; the player stands 9 m east and 12 m south of the ally (inside the leash, outside every goblin's sight).
    const unaware = await pg.evaluate(() => {
      const A = AL.stage(), g = AL.mk(A.e.x, A.e.z - 3, Math.PI / 2);                // faces west, away from the ally
      g.set('unaware'); g.wait = 1e9; g.aware = 0; const hp0 = g.hp;
      AL.steps(5, { enemies: true });
      return { state: g.state, hurt: g.hp < hp0, foeNull: A.foeE === null, dead: g.dead };
    });
    check('it ignores unaware guards that have not spotted it: no fight, no alert, no hit', unaware.state === 'unaware' && !unaware.hurt && unaware.foeNull && !unaware.dead, JSON.stringify(unaware));

    const notice = await pg.evaluate(() => {
      const A = AL.stage(), w = AL.watch(A), g = AL.mk(w.x, w.z, w.yaw);               // faces the ally with a clear line, the player out of sight
      g.set('unaware'); g.wait = 1e9; g.aware = 0;
      AL.steps(5, { enemies: true });
      return { state: g.state, aware: g.aware, sawPlayer: g.seen };
    });
    check('a guard that sees the ally walk, with no fight, does not turn on it (it may only go suspicious)', notice.state !== 'alerted' && notice.aware < 1 && !notice.sawPlayer, JSON.stringify(notice));

    const fight = await pg.evaluate(() => {
      const A = AL.stage(), w = AL.watch(A), g = AL.mk(w.x, w.z, w.yaw);               // faces the ally with a clear line: it sees the fight, not the ally standing
      g.set('unaware'); g.wait = 1e9; g.aware = 0;
      const z = AL.mk(A.e.x, A.e.z + 3, Math.PI); z.set('alerted'); z.last = { x: A.e.x, z: A.e.z };
      const hp0 = z.hp; let everAlerted = false;
      for (let i = 0; i < 180; i++) { for (const c of enemies.slice()) c.update(1 / 60, game.player, AL.noise); allyStep(1 / 60, AL.noise); if (g.state === 'alerted') everAlerted = true; }
      return { everAlerted, watcher: g.state, zHurt: z.hp < hp0 || z.dead, zHp: z.hp, hp0, allyHp: A.e.hp, foeE: A.foeE === z, zFoe: z.foe === A.e, d: Math.hypot(z.x - A.e.x, z.z - A.e.z), fightT: A.fightT, sawPlayer: g.seen };
    });
    check('a guard that sees the ally fight alerts on it, and the goblin the ally fights is hurt', fight.everAlerted && fight.zHurt && !fight.sawPlayer, JSON.stringify(fight));

    const crouch = await pg.evaluate(() => {
      const A = AL.stage(), out = {};
      const x = AL.mk(A.e.x + 4, A.e.z, Math.PI / 2); x.set('alerted'); x.seen = true; x.last = { x: game.player.x, z: game.player.z };
      AL.place(A.e.x + 8, A.e.z);                                                // you are as near the goblin as the ally is
      game.player.crouching = true; A.think = 0; AL.steps(1 / 60); out.crouchFoe = A.foeE === x;
      game.player.crouching = false; A.think = 0; AL.steps(1 / 60); out.standFoe = A.foeE === x; out.dist = Math.hypot(x.x - A.e.x, x.z - A.e.z); out.los = hasLOS(floor, A.e.x, A.e.z, x.x, x.z);
      return out;
    });
    check('crouching makes it hold back from a guard that has seen you; standing up, it goes for that guard', !crouch.crouchFoe && crouch.standFoe, JSON.stringify(crouch));

    const rageAlly = await pg.evaluate(() => {
      const A = AL.stage(), g = AL.mk(A.e.x - 1.5, A.e.z, Math.PI / 2);          // a goblin in Rage, the ally the nearest other creature
      g.enrage(5, A.e.x, A.e.z); g.update(1 / 60, game.player, AL.noise);
      return { target: g.rageTarget === A.e };
    });
    check('a Rage-crazed goblin picks the recruited ally as its target', rageAlly.target, JSON.stringify(rageAlly));

    const hitFoe = await pg.evaluate(() => {
      const A = AL.stage();
      const z = AL.mk(A.e.x, A.e.z + 3, Math.PI); z.set('alerted'); z.last = { x: A.e.x, z: A.e.z };
      AL.steps(1.5, { enemies: true });
      const hadFoe = z.foe === A.e;
      game.inv.equip.weapon = makeItem({ type: 'weapon', base: 'sword', tier: 0 });
      Qs.face(z); const hp0 = z.hp;
      for (let i = 0; i < 40 && !z.dead && z.hp === hp0; i++) playerHit();
      return { hadFoe, foeAfterHit: z.foe, hit: z.hp < hp0 || z.dead };
    });
    check('a guard fighting the ally that you hit turns on you (it drops the ally as its foe)', hitFoe.hit && hitFoe.foeAfterHit === null, JSON.stringify(hitFoe));

    const shots = await pg.evaluate(() => {
      const A = AL.stage(), out = {}, hp0 = A.e.hp;
      game.inv.equip.weapon = makeItem({ type: 'weapon', base: 'sword', tier: 0 }); Qs.face(A.o);
      for (let i = 0; i < 40; i++) playerHit();
      out.melee = A.e.hp === hp0;
      game.inv.equip.weapon = makeItem({ type: 'weapon', base: 'bow', tier: 0 }); game.inv.arrows = 20;
      game.player.pitch = 0; fireArrow(1);
      for (let k = 0; k < 900 && arrows.some(a => a.owner === 'player' && !a.stuck); k++) updateArrows(1 / 120);
      out.bow = A.e.hp === hp0 && !A.e.dead;
      game.inv.equip.weapon = makeItem({ type: 'weapon', base: 'sword', tier: 0 });
      return out;
    });
    check('your own melee and arrows never hit the ally', shots.melee && shots.bow, JSON.stringify(shots));

    const blast = await pg.evaluate(() => {
      const A = AL.stage(), out = {}; A.e.hp = A.e.maxHp;
      explodeAt(A.e.x + 20, A.e.z, null); out.far = A.e.hp === A.e.maxHp;             // beyond the blast radius
      explodeAt(A.e.x, A.e.z, null); out.near = A.e.hp < A.e.maxHp; out.nearHp = A.e.hp;
      return out;
    });
    check('a bomb blast hurts the ally within its radius and line of sight, and not beyond', blast.far && blast.near, JSON.stringify(blast));

    const gas = await pg.evaluate(() => {
      const A = AL.stage(), out = {};
      springTrap('gas', { x: A.e.x + 20, z: A.e.z }); out.far = !A.e.st.has('daze') && !A.e.st.has('slow');
      springTrap('gas', { x: A.e.x, z: A.e.z }); out.near = A.e.st.has('daze') && A.e.st.has('slow');
      return out;
    });
    check('trap gas dazes and slows the ally inside the cloud only', gas.far && gas.near, JSON.stringify(gas));

    const arrow = await pg.evaluate(() => {
      const A = AL.stage(), out = {}; A.e.hp = A.e.maxHp;
      const shooter = AL.mk(A.e.x - 20, A.e.z, 0);                              // the enemy that loosed it
      const nobody = { x: -999, z: -999, radius: 0.35 };
      let a = null, ev = null; const pl = () => game.player;
      for (let k = 0; k < 8 && !(ev && ev.type === 'ally'); k++) {          // the first direction with a clear line from 3 m out to the ally
        const ang = k * Math.PI / 4, cx = Math.cos(ang), cz = Math.sin(ang), sx = A.e.x + cx * 3, sz = A.e.z + cz * 3;
        let clear = true; for (let q = 1; q <= 6; q++) if (pl().blocked(floor, A.e.x + cx * q * 0.5, A.e.z + cz * q * 0.5)) clear = false;
        if (!clear) continue;
        a = { x: sx, y: 1, z: sz, vx: -cx * 12, vy: 0, vz: -cz * 12, gravity: 0, owner: 'enemy', kind: 'arrow', life: 4, stuck: false, px: sx, pz: sz, from: shooter };
        ev = null; for (let i = 0; i < 80 && !ev; i++) ev = stepArrow(a, 0.02, floor, [], nobody, Enemy.ally);
      }
      if (ev && ev.type === 'ally') allyShotHit(a, ev);
      out.type = ev && ev.type; out.hp = A.e.hp; out.maxHp = A.e.maxHp; out.tried = !!a;
      return out;
    });
    check('an enemy arrow in the line of fire hits the ally', arrow.type === 'ally' && arrow.hp < arrow.maxHp, JSON.stringify(arrow));

    // 6. Death by bleeding: the gear is left on a corpse, the line is gone, the ally is gone once the fall is over.
    const death = await pg.evaluate(() => {
      const A = AL.stage(), out = { gear: A.e.gear.length };
      A.e.hp = 1; A.e.addStatus('bleed', 10);
      AL.steps(4);
      out.dead = A.e.dead; out.kind = A.o.p.kind; out.left = (A.o.p.left || []).length; out.line = questLine(floor);
      out.enemyAlly = Enemy.ally; AL.steps(1.5); out.mode = A.mode;
      return out;
    });
    check('bleeding to death leaves the gear on a corpse, ends the quest line and the ally is gone', death.dead && death.kind === 'corpse' && death.left === death.gear && death.line === '' && death.enemyAlly === null && death.mode === 'gone', JSON.stringify(death));
    await pg.close();

    // 7. Seeded repeat: a second load of the same seed gives the same ask, price, name and recruit spot.
    const again = await open(2563011894);
    await again.evaluate(QH); await again.evaluate(AH);
    const second = await again.evaluate(() => { game.startFloor(2); const A = allyRun; return [A.ask, A.price, A.name, A.e.x, A.e.z]; });
    check('a seeded run repeats: the same ask, price, name and recruit spot on a second load', JSON.stringify(first) === JSON.stringify(second), `${JSON.stringify(first)} vs ${JSON.stringify(second)}`);
    await again.close();

    // 8. Gold ask on seed 156: refused at 69 gold, taken at 70 (the price is 40 + 15 x floor).
    const g = await open(4015597624);
    await g.evaluate(QH); await g.evaluate(AH);
    await g.evaluate(() => { game.startFloor(2); });
    const gold = await g.evaluate(async () => {
      const A = allyRun, out = { ask: A.ask, price: A.price };
      inv.gold = 69; await AL.holdE(A.o, () => /You only have/.test(AL.msg()) || A.recruited, 8000);
      out.refusedMsg = AL.msg(); out.refusedGold = inv.gold; out.refused = !A.recruited;
      inv.gold = 70; const ok = await AL.holdE(A.o, () => A.recruited, 15000);
      out.accepted = ok && A.recruited; out.goldLeft = inv.gold;
      return out;
    });
    check('a gold ask is refused with too little gold and taken at its price', gold.ask === 'gold' && gold.price === 70 && gold.refused && gold.refusedGold === 69 && gold.accepted && gold.goldLeft === 0, JSON.stringify(gold));

    // Stairs: a following ally within 6 m comes down with you; one 9 m back waits on its floor and is still there on the way back.
    const stairs = await g.evaluate(() => {
      const A = allyRun, P = game.player, out = {}, home = floorNum;
      AL.putAlly(P.x + 2, P.z);
      changeFloor(home + 1, 'down');
      out.carried = A.f === floor && A.n === floorNum && A.mode === 'follow';
      out.dist = AL.dist();
      changeFloor(home, 'up');
      out.backWithYou = A.f === floor && A.mode === 'follow';
      const far = AL.ring(game.player.x, game.player.z, 9); A.e.x = far.x; A.e.z = far.z;
      const fx = A.e.x, fz = A.e.z; changeFloor(home + 1, 'down');
      out.leftBehind = A.mode === 'wait' && A.f !== floor;
      out.lineAway = allyLine(floor);
      changeFloor(home, 'up');
      out.back = A.f === floor && A.mode === 'wait' && propObjs.includes(A.o) && Math.abs(A.e.x - fx) < 0.01 && Math.abs(A.e.z - fz) < 0.01;
      return out;
    });
    check('a following ally within 6 m comes down the stairs; one 9 m back waits on its floor and is still there on the way back',
      stairs.carried && stairs.dist < 6 && stairs.backWithYou && stairs.leftBehind && stairs.back, JSON.stringify(stairs));
    await g.close();
  }

  // ---- No ally, no work: with no recruit on the floor, the frame loop never calls the ally step and the step itself returns at once ----
  {
    const f1 = await open(7);
    await f1.evaluate(QH);
    const idle = await f1.evaluate(async () => {
      game.startFloor(1); let calls = 0; const real = window.allyStep; window.allyStep = (...a) => { calls++; return real(...a); };
      await T.until(() => false, 300);                                           // about 20 frames of the live loop
      const framesCalls = calls, emits = []; allyStep(1 / 60, { emit: (...a) => emits.push(a) });
      window.allyStep = real;
      return { calls: framesCalls, emits: emits.length, none: allyRun === null };
    });
    check('with no ally on the floor the frame loop never calls the ally step, and a direct call does nothing', idle.calls === 0 && idle.emits === 0 && idle.none, JSON.stringify(idle));
    await f1.close();
  }
});
