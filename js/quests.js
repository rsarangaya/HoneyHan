// Optional encounters (DESIGN.md section 16): a stage rolls 0 to 2 of them on floors 2 to 4, at most one a floor, never on the
// shop floor or the boss floor. Today: the locked mini-boss room ('miniboss'), the shrine bargain ('shrine'), the wanted guard, the sneak thief and the prisoner rescue.
// Skipping or declining costs nothing. Everything is seeded, so a seeded run repeats.
//   js/gen.js lays the encounter out (opts.quest -> floor.quest). This file rolls which floor gets which type, adds the mini-boss
//   after assignEnemyTypes, builds the runtime bits (name tag, altar spot), and runs the shrine's deal screen.
// A new type (ally) plugs in by adding a row to QUEST_TYPES and a layout branch in gen.js.
// No per-frame work: everything here runs at floor build, on a search finishing, or when the inventory or deal screen opens.
const QUESTS = {
  roll: { none: 25, one: 45, two: 30, floorMin: 2, floorMax: 4 },                        // odds (weights) of 0, 1 or 2 encounters per stage; floors they may land on
  // mini-boss: its body numbers are the 'miniboss' row of ENEMY_TYPES. Reward: Rare+ gear (minTier), gold goldMin..goldMax + goldPerFloor x floor, maybe a potion
  miniboss: { minTier: 2, goldMin: 30, goldMax: 50, goldPerFloor: 10, potion: 0.5 },
  // shrine: price weights, boon weights, the max HP price, the lowest max HP it will take you to, regen bonus, weapon boon tier range
  shrine: { priceHp: 1, priceGear: 1, pricePotions: 1, boonWeapon: 1, boonStamina: 1, boonTreasure: 1, hpLoss: 15, minMaxHp: 40, stamBonus: 0.25, weaponMinTier: 2, weaponMaxTier: 3 },
  // wanted guard: the reward is a potion (share potionShare, of kind potionKinds x potionN) or gear gearMinTier+ (a tier more from floor 3 on)
  wanted: { potionShare: 0.5, potionKinds: ['heal', 'might', 'stoneskin'], potionN: 2, gearMinTier: 2 },
  // sack thief: the sack is gold goldMin..goldMax + goldPerFloor x floor and one item of minTier+. think: seconds between flee decisions;
  // escapeDist: metres from the stairs' centre at which a running thief gets away; stairsBonus: extra tiles of appeal the stairs spot has;
  // keep: how much better a new spot must be to swap; giveUp: seconds out of sight before it calms down. Its speed is the 'sackthief' row of ENEMY_TYPES.
  // prisoner: the freed captive pays out in the safe room after the boss, ONE of: gear gearMinTier+ (scaled by the floor it was freed on), a potion pair
  // (potionKinds x potionN) or gold goldMin..goldMax + goldPerFloor x floor (the three weights pick which). speed: m/s it walks to the stairs; think: seconds
  // between its step re-plans; wait: seconds it stands there after the door opens.
  prisoner: { gearWeight: 1, potionWeight: 1, goldWeight: 1, gearMinTier: 2, potionKinds: ['heal', 'might', 'stoneskin'], potionN: 2, goldMin: 60, goldMax: 120, goldPerFloor: 20, speed: 3.2, think: 0.5, wait: 1.5 },
  thief: { goldMin: 40, goldMax: 80, goldPerFloor: 15, minTier: 1, think: 0.5, escapeDist: 3.3, stairsBonus: 4, keep: 4, giveUp: 4 },
};
const MINIBOSS_NAMES = ['Grub the Butcher', 'Old Gnash', 'Mogra Bonecrusher', 'Skarn the Unwashed', 'Big Dreg', 'Hobb Ironjaw', 'Madam Cleaver', 'Rotgut Brannoch', 'Snaggle the Tall', 'Urkul Two-Pots'];
const SHRINE_GEAR_SLOTS = ['helmet', 'chest', 'boots', 'offhand'];                       // the equipped pieces a bargain may take (never the weapon)

// A floating name over a named enemy: one canvas and one sprite, made once at floor build.
function nameTag(e, name, color) {
  const c = document.createElement('canvas'); c.width = 320; c.height = 56;
  const g = c.getContext('2d'); g.font = 'bold 30px system-ui, sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle';
  g.lineWidth = 6; g.strokeStyle = '#000c'; g.strokeText(name, 160, 29); g.fillStyle = color; g.fillText(name, 160, 29);
  const tag = new THREE.Sprite(new THREE.SpriteMaterial({ map: new THREE.CanvasTexture(c), transparent: true, depthWrite: false }));
  tag.scale.set(2.6, 0.455, 1); tag.position.y = 2.55; tag.renderOrder = 9;
  e.mesh.add(tag); e.tag = tag;
}
const WANTED_ROOMS = { generic: 'plain room', messhall: 'mess hall', storeroom: 'storeroom', barracks: 'barracks', library: 'library', shrine: 'shrine', brewery: 'brewery' };

// ---- the table of encounter types. weight: how often it is rolled. spawn(f): extra enemies, after assignEnemyTypes.
// build(f, ctx): runtime pieces once the floor's meshes exist. line(f): the one short line for the inventory screen ('' when done). ----
const QUEST_TYPES = {
  miniboss: {
    weight: 1,
    spawn(f) {
      const q = f.quest; q.name = makeRng(q.seed).pick(MINIBOSS_NAMES);
      f.enemies.push({ x: q.route[0].x, y: q.route[0].y, route: q.route, seed: q.seed, type: 'miniboss', mini: { name: q.name } });
    },
    build(f, ctx) {
      const e = ctx.enemies.find(en => en.spec.mini); if (!e) return;
      f.quest.boss = e; nameTag(e, f.quest.name, '#ff9a6a');
    },
    line(f) {
      const q = f.quest; if (q.boss && q.boss.dead) return '';
      return `${q.name} waits in a locked room on this floor (${inv.has('key', q.lock) ? 'you have its key' : 'its key is in a chest'}).`;
    },
  },
  shrine: {
    weight: 1,
    spawn() {},
    build(f, ctx) {
      const a = f.quest.altar, o = ctx.decorObjs.find(d => d.kind === 'altar' && d.p.x === a.x && d.p.y === a.y); if (!o) return;
      f.quest.prop = { p: { kind: 'altar', x: a.x, y: a.y, opened: !!f.quest.used }, mesh: new THREE.Group(), x: o.x, z: o.z, r: 0, lid: null, mats: [] };   // the altar's mesh is plain merged decor; this is just the spot you use
      ctx.propObjs.push(f.quest.prop);
    },
    line(f) { return f.quest.used ? '' : 'A shrine on this floor offers a bargain. Hold E at its altar; you may decline.'; },
  },
  // Wanted guard: a hooded defector stands in the start room (a body that is not in the enemy list, so it cannot be hit and guards ignore it).
  // Talk to it (hold E) for the target's name and room; kill the target any way you like and talk to it again for the reward.
  wanted: {
    weight: 1,
    spawn(f) {
      const q = f.quest; q.name = makeRng(q.seed).pick(MINIBOSS_NAMES);
      f.enemies.push({ x: q.route[0].x, y: q.route[0].y, route: q.route, seed: q.seed, type: 'wanted', mini: { name: q.name } });
    },
    build(f, ctx) {
      const q = f.quest, e = ctx.enemies.find(en => en.spec.mini); if (!e) return;
      q.boss = e; nameTag(e, q.name, '#ffd23a');
      const n = new Enemy({ x: q.npc.x, y: q.npc.y, route: [q.npc, q.npc], seed: (q.seed ^ 0x6a09e) >>> 0, type: 'defector' }, f);   // the quest-giver: built, posed once, never updated
      n.yaw = Math.atan2(-((f.start.x + 0.5) * TILE - n.x), -((f.start.y + 0.5) * TILE - n.z)); n.sync(0); n.icon.visible = false; n.cone.visible = false;
      group.add(n.mesh);
      f.solids.push({ x: n.x, z: n.z, r: 0.45 });                                                // guards walk round it
      ctx.propObjs.push({ p: { kind: 'questnpc', x: q.npc.x, y: q.npc.y, opened: false }, mesh: n.mesh, x: n.x, z: n.z, r: 0.45, lid: null, mats: [] });
    },
    prompt(q) { return q.done ? 'Talk to the defector' : q.boss && q.boss.dead ? 'Claim your reward' : q.talked ? 'Talk to the defector' : 'Talk to the hooded stranger'; },
    talk(f) {
      const q = f.quest, room = WANTED_ROOMS[q.room] || 'room';
      if (q.done) { flash('"Thank you again. The dungeon is a little safer."'); return; }
      if (q.boss && q.boss.dead) {                                                                 // reward: rolled once from the quest seed, handed over when there is room
        const rng = makeRng((q.seed ^ 0x3a17) >>> 0), W = QUESTS.wanted;
        const d = q.reward || (q.reward = rng() < W.potionShare ? { type: 'potion', kind: rng.pick(W.potionKinds), n: W.potionN } : rollEquipment(floorNum, rng, { minTier: W.gearMinTier, boost: floorNum >= 3 ? 1 : 0 }));
        const got = inv.add(d);
        if (!got) { flash('"Make room in your pack first."'); return; }
        q.done = true; flash(`"${q.name} is dead? Take this." You receive: ${got}.`); return;
      }
      q.talked = true; discover('quest:wanted', 'Wanted guard');
      flash(`"Kill ${q.name}. He patrols the ${room}. Come back to me after."`);
    },
    line(f) {
      const q = f.quest, room = WANTED_ROOMS[q.room] || 'room';
      if (q.done) return '';
      if (q.boss && q.boss.dead) return `${q.name} is dead. Return to the defector near the start for your reward.`;
      return q.talked ? `Hunt ${q.name}, who patrols the ${room}. Then return to the defector near the start.` : 'A hooded defector near the start room has a request. Talk to it (hold E).';
    },
  },
  // Sneak thief chase: one thief with a loot sack wanders; see Enemy.updateFleer. The sack is the thief's corpse loot (rollLootBase).
  thief: {
    weight: 1,
    spawn(f) { const q = f.quest; f.enemies.push({ x: q.route[0].x, y: q.route[0].y, route: q.route, seed: q.seed, type: 'sackthief' }); },
    build(f, ctx) { f.quest.thief = ctx.enemies.find(en => en.type === 'sackthief') || null; },
    line(f) {
      const q = f.quest;
      if (q.gone || !q.thief || q.thief.dead) return '';
      return 'A thief with a loot sack lurks on this floor. Stab it unaware, or shoot it down before it reaches the stairs.';
    },
  },
  // Prisoner rescue: a captive in a locked cell (gen.js), one extra guard on the approach. The cell key is carried by another guard (spec.carry: it hangs on
  // its belt and is in its corpse's loot) or, if there is none, lies in a chest. Unlocking the door frees the prisoner (prisonerFree): it walks to the stairs and
  // is gone. The run remembers it (prisonerRun), and the safe room after the boss holds it again (prisonerSafeBuild), where hold E pays the reward (prisonerTalk).
  prisoner: {
    weight: 1,
    spawn(f) {
      const q = f.quest, rng = makeRng((q.seed ^ 0x4b3d1) >>> 0), key = { type: 'key', lock: q.lock, label: LOCKED_ROOMS.cell.key };
      const cands = f.enemies.filter(e => !e.boss && !e.qguard && !CARRY_NO.has(e.type) && !CARRY_SOFT.has(e.type));
      const chest = q.holder && f.props.find(p => p.kind === 'chest' && p.x === q.holder.x && p.y === q.holder.y);
      if (cands.length) { rng.pick(cands).carry = key; q.keyOn = 'guard'; }
      else if (chest) { chest.extra = [...(chest.extra || []), key]; chest.holdsKey = true; q.keyOn = 'chest'; }
      else {                                                                                // no other guard and no chest: the patrol (or any guard that leaves a body) carries it
        const last = f.enemies.find(e => e.qguard && !CARRY_NO.has(e.type) && !CARRY_SOFT.has(e.type)) || f.enemies.find(e => !e.boss && !CARRY_NO.has(e.type));
        if (last) { last.carry = key; q.keyOn = 'guard'; }
      }
    },
    build(f, ctx) {
      const q = f.quest, T = TILE, n = new Enemy({ x: q.npc.x, y: q.npc.y, route: [q.npc, q.npc], seed: (q.seed ^ 0x51ed) >>> 0, type: 'prisoner' }, f);   // built, posed once, not updated until freed
      n.yaw = Math.atan2(-((q.door.x + 0.5) * T - n.x), -((q.door.y + 0.5) * T - n.z)); n.sync(0); n.icon.visible = false; n.cone.visible = false;
      group.add(n.mesh);
      const sol = { x: n.x, z: n.z, r: 0.45 }, o = { p: { kind: 'decor', opened: true, x: q.npc.x, y: q.npc.y }, mesh: n.mesh, x: n.x, z: n.z, r: 0.45, lid: null, mats: [] };
      f.solids.push(sol); ctx.propObjs.push(o);                                            // a body you cannot walk through, until it is freed
      q.cell = { e: n, o, sol };
    },
    line(f) {
      const q = f.quest;
      if (q.freed) return prisonerRun && !prisonerRun.paid ? 'You freed the prisoner. Meet them in the safe room after the boss.' : '';
      return inv.has('key', q.lock) ? 'You have the cell key. Unlock the cell to free the prisoner.' : `A prisoner is locked in a cell on this floor. Find the cell key (${q.keyOn === 'chest' ? 'it is in a chest' : 'a guard carries it'}).`;
    },
  },
};
const CARRY_NO = new Set(['bomber', 'mimic', 'sackthief']);                                 // never the cell key: they leave no lootable body (a bomb goblin blows itself up, a thief may escape)
const CARRY_SOFT = new Set(['wolf', 'rat']);                                                // animals: only if nothing else can
// Run-level prisoner state, so it survives floor changes: { floor: the floor it was freed on, paid, reward }. prisonerWalk: the one prisoner on its way to the stairs.
let prisonerRun = null, prisonerWalk = null;
// Door unlocked: the cell frees its captive. The distance field to the stairs is built once (shared queue, one buffer for the run); the walk then only reads it.
function prisonerFree() {
  const f = floor, q = f.quest; if (!q || q.type !== 'prisoner' || q.freed) return;
  const c = q.cell, P = QUESTS.prisoner, sp = nearPoint(f, f.stairs.x, f.stairs.y, 0), dist = new Int32Array(f.w * f.h);
  q.freed = true; c.o.r = 0;
  prisonerRun = prisonerRun || { floor: floorNum, paid: false, reward: null };
  const i = f.solids.indexOf(c.sol); if (i >= 0) f.solids.splice(i, 1);
  const j = propObjs.indexOf(c.o); if (j >= 0) propObjs.splice(j, 1);                       // out of the prop list, so distance culling leaves the walking mesh alone
  c.e.yaw = Math.atan2(-(player.x - c.e.x), -(player.z - c.e.z)); c.e.mesh.visible = true; c.e.sync(0);
  floodDist(f, sp.x, sp.y, dist);
  if (dist[Math.floor(c.e.z / TILE) * f.w + Math.floor(c.e.x / TILE)] < 0) {                // no way to the stairs: it waits in the cell (the reward is still due)
    console.warn('prisoner: no path from the cell to the stairs'); addLog('The prisoner is free, but cannot reach the stairs and waits here.', '#9ad8ff');
  } else prisonerWalk = { e: c.e, f, dist, wait: P.wait, re: 0, gx: c.e.x, gz: c.e.z };
  discover('quest:prisoner', 'Prisoner rescue');
  flash('"You freed me! Thank you! I will wait for you beyond the boss."'); addLog('The prisoner is free. It will meet you in the safe room after the boss.', '#9ad8ff');
}
// One step of the walk (main.js calls it only while prisonerWalk is set): re-plan from the distance field when it reaches its waypoint or every P.think seconds
// (4 array reads), then walk straight to the next tile's centre. Reaching the tile beside the stairs ends it.
function prisonerStep(dt) {
  const w = prisonerWalk, e = w.e, F = w.f, T = TILE, P = QUESTS.prisoner;
  if (w.wait > 0) { w.wait -= dt; return; }
  let dx = w.gx - e.x, dz = w.gz - e.z;
  if ((w.re -= dt) <= 0 || dx * dx + dz * dz < 0.04) {
    w.re = P.think;
    const tx = Math.floor(e.x / T), ty = Math.floor(e.z / T), d = w.dist[ty * F.w + tx];
    if (d < 0) { console.warn('prisoner: lost its path'); prisonerWalk = null; return; }
    if (d === 0) { e.mesh.visible = false; prisonerWalk = null; if (F === floor) addLog('The prisoner slips down the stairs.', '#9ad8ff'); return; }   // hidden, not removed: the floor's group is disposed whole
    for (let k = 0; k < 4; k++) {
      const nx = tx + (k === 0 ? 1 : k === 1 ? -1 : 0), ny = ty + (k === 2 ? 1 : k === 3 ? -1 : 0);
      if (w.dist[ny * F.w + nx] === d - 1) { w.gx = (nx + 0.5) * T; w.gz = (ny + 0.5) * T; break; }
    }
    dx = w.gx - e.x; dz = w.gz - e.z;
  }
  const d = Math.hypot(dx, dz) || 1, step = Math.min(P.speed * dt, d);
  const nx = e.x + dx / d * step, nz = e.z + dz / d * step, ox = e.x, oz = e.z;
  collider.props = F.solids;                                                                 // steer round props like every other mover; slide along one axis, snap to the tile centre if stuck
  if (!Player.prototype.blocked.call(collider, F, nx, e.z)) e.x = nx;
  if (!Player.prototype.blocked.call(collider, F, e.x, nz)) e.z = nz;
  if (step > 0.005 && Math.hypot(e.x - ox, e.z - oz) < step * 0.3) { if ((e.stuckT += dt) > 1) { e.x = (Math.floor(e.x / T) + 0.5) * T; e.z = (Math.floor(e.z / T) + 0.5) * T; e.stuckT = 0; w.re = 0; } } else e.stuckT = 0;
  e.yaw = turnToward(e.yaw, Math.atan2(-dx, -dz), 8 * dt); e.walkT += step * 5; e.sync(dt);
}
// After the boss: the freed prisoner stands in the safe room, by the stairs (called from questBuild on the boss floor).
function prisonerSafeBuild(f, ctx) {
  const x = f.stairs.x + 2, y = f.stairs.y + 1, d = f.safe.door, T = TILE;
  const n = new Enemy({ x, y, route: [{ x, y }, { x, y }], seed: (runSeed ^ 0x51ed) >>> 0, type: 'prisoner' }, f);
  n.yaw = Math.atan2(-((d.x + 0.5) * T - n.x), -((d.y + 0.5) * T - n.z)); n.sync(0); n.icon.visible = false; n.cone.visible = false;
  group.add(n.mesh);
  f.solids.push({ x: n.x, z: n.z, r: 0.45 });
  ctx.propObjs.push({ p: { kind: 'questnpc', who: 'prisoner', x, y, opened: false }, mesh: n.mesh, x: n.x, z: n.z, r: 0.45, lid: null, mats: [] });
}
// Hold E on it: the reward, rolled once from the run seed (the kind by weight, the gear scaled by the floor it was freed on). Needs room in the pack for gear or potions.
function prisonerTalk(o) {
  const R = prisonerRun, P = QUESTS.prisoner; if (!R || R.paid) return;
  if (!R.reward) {
    const rng = makeRng((runSeed ^ 0x7e55) >>> 0), k = weightedIndex(rng, [P.gearWeight, P.potionWeight, P.goldWeight]);
    R.reward = k === 0 ? rollEquipment(R.floor, rng, { minTier: P.gearMinTier, boost: R.floor >= 3 ? 1 : 0 }) : k === 1 ? { type: 'potion', kind: rng.pick(P.potionKinds), n: P.potionN } : { type: 'gold', n: rng.int(P.goldMin, P.goldMax) + P.goldPerFloor * R.floor };
  }
  const got = inv.add(R.reward);
  if (!got) { flash('"Make room in your pack first."'); return; }
  R.paid = true; o.p.opened = true;                                                          // done: no more prompt
  flash(`"You saved me. Take this." You receive: ${got}.`);
}
// The Hold E label and the talk action of a quest NPC (main.js: targetInfo, finishSearch): the wanted guard's quest-giver, or the freed prisoner in the safe room.
const questPrompt = (f, o) => o && o.p.who === 'prisoner' ? 'Take the prisoner\'s reward' : f.quest && f.quest.type === 'wanted' ? QUEST_TYPES.wanted.prompt(f.quest) : 'Talk';
function questTalk(o) {
  player.keys[KEYS.interact] = false;                                                              // one talk per press, not one every hold
  if (o && o.p.who === 'prisoner') { prisonerTalk(o); return; }
  if (floor.quest && QUEST_TYPES[floor.quest.type].talk) QUEST_TYPES[floor.quest.type].talk(floor);
}
// A sack thief reached the stairs while running (main.js wires this to Enemy.escaped): it is gone, and so is the sack.
function questThiefEscaped(e) {
  if (e.mesh.parent) e.mesh.parent.remove(e.mesh);
  if (floor.quest && floor.quest.thief === e) floor.quest.gone = true;
  discover('quest:thief', 'Sneak thief chase'); flash('The sack thief escapes down the stairs with its loot!');
}

// Which floor gets which type for this run: { floorNumber: type }. Seeded; at most one per floor.
function rollQuests(seed, maxFloor, shopFloor) {
  const rng = makeRng((seed ^ 0x2c1b3c6d) >>> 0), R = QUESTS.roll, out = {};
  const n = weightedIndex(rng, [R.none, R.one, R.two]), floors = [];
  for (let f = R.floorMin; f <= Math.min(R.floorMax, maxFloor - 1); f++) if (f !== shopFloor) floors.push(f);
  rng.shuffle(floors);
  const types = Object.keys(QUEST_TYPES), w = types.map(t => QUEST_TYPES[t].weight);
  let jail = false;                                                                         // at most one prisoner per run (its walk and reward are run-level state)
  for (const f of floors.slice(0, n)) {
    let t = types[weightedIndex(rng, w)];
    if (t === 'prisoner' && jail) { const w2 = w.map((x, i) => types[i] === 'prisoner' ? 0 : x); t = types[weightedIndex(rng, w2)]; }
    if (t === 'prisoner') jail = true;
    out[f] = t;
  }
  return out;
}

const questSpawn = f => { if (f.quest) QUEST_TYPES[f.quest.type].spawn(f); };               // after assignEnemyTypes
const questBuild = (f, ctx) => { if (f.quest) QUEST_TYPES[f.quest.type].build(f, ctx); if (f.safe && prisonerRun) prisonerSafeBuild(f, ctx); };   // after the floor's meshes and enemies exist
const questLine = f => f.quest ? QUEST_TYPES[f.quest.type].line(f) : f.safe && prisonerRun && !prisonerRun.paid ? 'The prisoner you freed waits in the safe room beyond the boss (hold E to talk).' : '';   // the inventory screen's line
function questDoorOpened(o) {                                                               // a quest room's door was unlocked
  if (o.p.room === 'cell') { prisonerFree(); return; }
  if (o.p.room !== 'lair' || !floor.quest) return;
  discover('quest:lair', 'Locked mini-boss room');
  addLog(`${floor.quest.name} is in there.`, '#ff9a6a');
}

// ---- the shrine's deal: ONE seeded deal per altar (a price and a boon). All the rules are plain functions of the inventory. ----
function rollDeal(seed) {
  const rng = makeRng((seed ^ 0x5b17e) >>> 0), S = QUESTS.shrine;
  return { price: ['maxhp', 'gear', 'potions'][weightedIndex(rng, [S.priceHp, S.priceGear, S.pricePotions])], slot0: rng.int(0, 3),
    boon: ['weapon', 'stamina', 'treasure'][weightedIndex(rng, [S.boonWeapon, S.boonStamina, S.boonTreasure])] };
}
// What the price is for this pack right now. A price that cannot be paid (no gear worn, no potions) becomes the max HP price.
function resolvePrice(deal, inv) {
  const S = QUESTS.shrine;
  if (deal.price === 'gear') for (let i = 0; i < 4; i++) { const slot = SHRINE_GEAR_SLOTS[(deal.slot0 + i) % 4], it = inv.equip[slot]; if (it) return { kind: 'gear', slot, text: `Give up your equipped ${slot === 'offhand' ? 'off-hand' : slot}: <b style="color:${itemColor(it)};font-size:inherit">${itemName(it)}</b> (${tierName(it)}${it.unique ? ', one of a kind' : ''}) for good` }; }
  if (deal.price === 'potions') { const st = inv.pack.filter(i => i.type === 'potion').sort((a, b) => b.n - a.n)[0]; if (st) return { kind: 'potions', stack: st, text: `Hand over all your ${itemName(st)} (x${st.n})` }; }
  return { kind: 'maxhp', text: `Lose ${S.hpLoss} max HP for the rest of the run (${inv.maxHp} to ${inv.maxHp - S.hpLoss})`, bad: inv.maxHp - S.hpLoss < S.minMaxHp && `Your max HP is too low to pay this.` };
}
const BOON_TEXT = { weapon: () => `A ${TIERS[QUESTS.shrine.weaponMinTier].name} or better weapon`, stamina: () => `+${Math.round(QUESTS.shrine.stamBonus * 100)}% stamina regeneration for the rest of the run`, treasure: () => 'An unknown treasure' };
// The boon as drop descriptors (seeded by the altar, so it never changes between looks).
function boonItems(deal, seed, floorNum) {
  const rng = makeRng((seed ^ 0xb00f) >>> 0), S = QUESTS.shrine;
  if (deal.boon === 'weapon') return [{ type: 'weapon', base: rng.pick(['dagger', 'sword', 'mace', 'bow']), tier: Math.max(S.weaponMinTier, Math.min(S.weaponMaxTier, rollTier(floorNum, rng, 1))) }];
  if (deal.boon === 'treasure') return rollLoot('vaultchest', floorNum, rng);
  return [];
}
// Pays the price and hands over the boon. Returns { ok, msg }; nothing changes when ok is false.
function applyDeal(inv, deal, seed, floorNum) {
  const price = resolvePrice(deal, inv), items = boonItems(deal, seed, floorNum);
  if (price.bad) return { ok: false, msg: price.bad };
  const need = items.filter(d => d.type !== 'gold' && d.type !== 'arrows').length, room = PACK_MAX - inv.pack.length + (price.kind === 'potions' ? 1 : 0);
  if (need > room) return { ok: false, msg: 'Make room in your pack first.' };
  if (price.kind === 'maxhp') { inv.maxHp -= QUESTS.shrine.hpLoss; inv.hp = Math.min(inv.hp, inv.maxHp); }
  else if (price.kind === 'gear') inv.equip[price.slot] = null;
  else inv.remove(price.stack);
  const got = items.map(d => inv.add(d)).filter(Boolean);
  if (deal.boon === 'stamina') { inv.stamBonus += QUESTS.shrine.stamBonus; got.push(`+${Math.round(QUESTS.shrine.stamBonus * 100)}% stamina regeneration`); }
  return { ok: true, msg: `The shrine takes its price. You receive: ${got.join(', ') || 'nothing'}.` };
}

// ---- the deal screen: DOM built the first time it opens, drawn only on open and on a click (no per-frame writes) ----
const dealUI = (() => {
  let root = null, altar = null, deal = null, note = '';
  function make() {
    const css = document.createElement('style');
    css.textContent = `
      #dealScreen { position: fixed; inset: 0; z-index: 30; display: none; align-items: center; justify-content: center; background: #000b; font: 13px system-ui, sans-serif; color: #eee; }
      #dealScreen .win { width: min(520px, 94vw); background: #15130f; border: 1px solid #c8a0ff; padding: 14px 16px; }
      #dealScreen b { font-size: 18px; color: #c8a0ff; }
      #dealScreen .row { margin: 10px 0; padding: 8px 10px; border: 1px solid #fff3; background: #0007; }
      #dealScreen .row small { display: block; opacity: .6; font-size: 11px; margin-bottom: 3px; text-transform: uppercase; letter-spacing: .08em; }
      #dealScreen button { font: 13px system-ui; padding: 5px 14px; margin-right: 8px; cursor: pointer; }
      #dealScreen button[disabled] { opacity: .4; cursor: default; }
      #dealScreen .note { min-height: 18px; color: #e8c860; margin: 6px 0; }
    `;
    document.head.appendChild(css);
    root = document.createElement('div'); root.id = 'dealScreen';
    document.body.appendChild(root);
    root.addEventListener('click', e => {
      const t = e.target.closest('[data-act]'); if (!t || t.disabled) return;
      if (t.dataset.act === 'accept') {
        const r = applyDeal(inv, deal, floor.quest.seed, floorNum);
        if (!r.ok) { note = r.msg; render(); return; }
        floor.quest.used = true; altar.p.opened = true;
        flash(r.msg); addLog(r.msg, '#c8a0ff');
      }
      close();
    });
    addEventListener('keydown', e => { if (e.code === 'Escape' && state === 'deal') { e.preventDefault(); e.stopImmediatePropagation(); close(); } });   // stop the pause menu opening on the same key
  }
  function render() {
    const price = resolvePrice(deal, inv), bad = price.bad;
    root.innerHTML = `<div class="win"><b>The Shrine Bargain</b>
      <div class="row"><small>The shrine asks</small>${price.text}</div>
      <div class="row"><small>In return</small>${BOON_TEXT[deal.boon]()}</div>
      <div class="note">${note || bad || 'The altar waits. You may walk away: it costs nothing.'}</div>
      <button data-act="accept" ${bad ? 'disabled' : ''}>Accept</button><button data-act="decline">Decline (Esc)</button></div>`;
  }
  function open(o) {
    if (state !== 'play' || !floor.quest || floor.quest.used) return;
    if (!root) make();
    altar = o; deal = floor.quest.deal || (floor.quest.deal = rollDeal(floor.quest.seed)); note = '';
    state = 'deal';
    document.exitPointerLock();
    cb.want = false; cb.press = false; cb.draw = null;
    el('prompt').style.display = 'none';                                                   // the Hold E prompt would otherwise sit under the overlay
    discover('quest:shrine', 'Shrine bargain');
    render();
    root.style.display = 'flex';
  }
  function close() {
    root.style.display = 'none';
    state = 'play';
    player.keys[KEYS.interact] = false;                                                   // do not reopen at once if E is still held
    try { canvas.requestPointerLock(); } catch (e) {}
  }
  return { open, close, render };
})();
