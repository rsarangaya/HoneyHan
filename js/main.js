// Scene building, HUD, minimap, and the floor-to-floor loop.
const MAX_FLOOR = 5;
const params = new URLSearchParams(location.search);
const runSeed = params.has('seed') ? (parseInt(params.get('seed'), 10) >>> 0) : (Math.random() * 4294967296) >>> 0;
const theme = makeRng(runSeed).pick(THEMES);     // one theme per run, picked from the seed

const canvas = document.getElementById('game');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(75, 1, 0.05, 80);
camera.rotation.order = 'YXZ';
scene.add(camera);

const hud = {
  floor: document.getElementById('floor'),
  theme: document.getElementById('theme'),
  seed: document.getElementById('seed'),
  msg: document.getElementById('msg'),
  overlay: document.getElementById('overlay'),
  overlayText: document.getElementById('overlayText'),
  mini: document.getElementById('mini'),
};
const mctx = hud.mini.getContext('2d');

const player = new Player();
let floor = null, floorNum = 1, group = null, stairsLight = null, explored = null, stairBox = null;
const BOSS_WALL_H = 10;    // the arena ceiling, so the boss (about 3 m tall) has room
const STAIR_HALF_W = 1.1, STAIR_HALF_L = 1.3, STAIR_DEPTH = 1.5;
let state = 'menu';        // menu | play | won
let msgTimer = 0;

function noiseTexture(base) {
  const c = document.createElement('canvas'); c.width = c.height = 64;
  const g = c.getContext('2d');
  g.fillStyle = base; g.fillRect(0, 0, 64, 64);
  for (let i = 0; i < 700; i++) {
    g.fillStyle = Math.random() < 0.5 ? 'rgba(0,0,0,0.16)' : 'rgba(255,255,255,0.07)';
    g.fillRect((Math.random() * 64) | 0, (Math.random() * 64) | 0, 2, 2);
  }
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.magFilter = THREE.NearestFilter;
  return t;
}

function buildFloor() {
  if (group) {   // free the old floor's GPU memory: geometry, materials and their textures
    scene.remove(group);
    group.traverse(o => {
      if (o.geometry) o.geometry.dispose();
      for (const m of [].concat(o.material || [])) { if (m.map) m.map.dispose(); m.dispose(); }
    });
  }
  group = new THREE.Group();
  const { w, h, tiles } = floor;
  const solid = (x, y) => x < 0 || y < 0 || x >= w || y >= h || tiles[y * w + x] === T_WALL;

  // walls: only tiles that touch an open tile (8-neighbourhood) get a box
  const wallPos = [];
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    if (tiles[y * w + x] !== T_WALL) continue;
    let touches = false;
    for (let dy = -1; dy <= 1 && !touches; dy++) for (let dx = -1; dx <= 1; dx++) if (!solid(x + dx, y + dy)) { touches = true; break; }
    if (touches) wallPos.push([x, y]);
  }
  const wallTex = noiseTexture(theme.wall);
  const walls = new THREE.InstancedMesh(new THREE.BoxGeometry(TILE, WALL_H, TILE),
    new THREE.MeshLambertMaterial({ map: wallTex }), wallPos.length);
  const m = new THREE.Matrix4();
  wallPos.forEach(([x, y], i) => { m.setPosition((x + 0.5) * TILE, WALL_H / 2, (y + 0.5) * TILE); walls.setMatrixAt(i, m); });
  group.add(walls);

  const planeGeo = new THREE.PlaneGeometry(w * TILE, h * TILE);
  // floor is a shape with a rectangular hole where the stairwell goes down
  const sx = (floor.stairs.x + 0.5) * TILE, sz = (floor.stairs.y + 0.5) * TILE;
  stairBox = { x0: sx - STAIR_HALF_W, x1: sx + STAIR_HALF_W, z0: sz - STAIR_HALF_L, z1: sz + STAIR_HALF_L };
  const floorShape = new THREE.Shape();
  floorShape.moveTo(0, 0); floorShape.lineTo(w * TILE, 0); floorShape.lineTo(w * TILE, -h * TILE); floorShape.lineTo(0, -h * TILE);
  const hole = new THREE.Path();           // shape y maps to world -z after rotation
  hole.moveTo(stairBox.x0, -stairBox.z0); hole.lineTo(stairBox.x0, -stairBox.z1);
  hole.lineTo(stairBox.x1, -stairBox.z1); hole.lineTo(stairBox.x1, -stairBox.z0);
  floorShape.holes.push(hole);
  const floorTex = noiseTexture(theme.floor); floorTex.repeat.set(1 / TILE, 1 / TILE);
  const fl = new THREE.Mesh(new THREE.ShapeGeometry(floorShape), new THREE.MeshLambertMaterial({ map: floorTex }));
  fl.rotation.x = -Math.PI / 2;
  const ceilTex = noiseTexture(theme.ceil); ceilTex.repeat.set(w, h);
  const ce = new THREE.Mesh(planeGeo, new THREE.MeshLambertMaterial({ map: ceilTex }));
  ce.rotation.x = Math.PI / 2; ce.position.set(w * TILE / 2, WALL_H, h * TILE / 2);
  group.add(fl, ce);

  // stairwell: steps descending along +z into the hole, with side and end walls
  const stairMat = new THREE.MeshLambertMaterial({ color: 0x9a9284 });
  const pitMat = new THREE.MeshLambertMaterial({ color: 0x1a1612 });
  const len = STAIR_HALF_L * 2, wid = STAIR_HALF_W * 2, N = 7, rise = STAIR_DEPTH / N;
  for (let i = 0; i < N; i++) {
    const top = -(i + 1) * rise;
    const s = new THREE.Mesh(new THREE.BoxGeometry(wid, rise, len / N), stairMat);
    s.position.set(sx, top - rise / 2, stairBox.z0 + (i + 0.5) * len / N);
    group.add(s);
  }
  for (const side of [-1, 1]) {
    const wall = new THREE.Mesh(new THREE.BoxGeometry(0.1, STAIR_DEPTH + 0.4, len), pitMat);
    wall.position.set(sx + side * (STAIR_HALF_W + 0.05), -STAIR_DEPTH / 2 - 0.2, sz);
    group.add(wall);
  }
  const endWall = new THREE.Mesh(new THREE.BoxGeometry(wid + 0.2, STAIR_DEPTH + 0.4, 0.1), pitMat);
  endWall.position.set(sx, -STAIR_DEPTH / 2 - 0.2, stairBox.z1 + 0.05);
  group.add(endWall);
  stairsLight = new THREE.PointLight(0xffe0a0, 0.35, 12);
  stairsLight.position.set(sx, 0.6, sz);
  group.add(stairsLight);

  propObjs = floor.props.map(p => makeProp(p));
  propObjs.forEach(o => group.add(o.mesh));
  floor.solids = [{ x: sx, z: sz, r: 1.5 }, ...propObjs.map(o => ({ x: o.x, z: o.z, r: o.r }))];   // what guards cannot walk through: stairwell, props, furniture
  decorObjs = floor.decor.map(makeDecor);
  for (const o of decorObjs) {
    group.add(o.mesh);
    if (o.r > 0) { propObjs.push(o); if (o.r > 0.3) floor.solids.push({ x: o.x, z: o.z, r: o.r }); }   // small floor clutter (candles) never traps a guard   // rugs, bones and banners are flat or hung: no collision
  }
  for (const dr of floor.doors) { const o = makeDoor(dr); group.add(o.mesh); propObjs.push(o); }
  buildTorches();
  enemies = floor.enemies.map(s => new Enemy(s, floor));
  linkHandlers(enemies);
  enemies.forEach(e => { e.cone.visible = dev.on; group.add(e.mesh); });

  scene.add(group);
  scene.background = new THREE.Color(theme.fog);
  scene.fog = new THREE.FogExp2(theme.fog, 0.085);
}

// ---- light sources: wall torches plus glowing furniture (hearths, cauldrons, candles, altars).
// Emissive meshes everywhere, real light only on the 4 nearest to the player. ----
let torchPts = [];
const torchLights = Array.from({ length: 6 }, () => { const l = new THREE.PointLight(theme.light, 0, 14, 1.5); scene.add(l); return l; });
function buildTorches() {
  const iron = new THREE.MeshLambertMaterial({ color: 0x2a2420 });
  const fire = new THREE.MeshBasicMaterial({ color: 0xffa94a });
  torchPts = floor.torches.map(t => {
    const x = (t.x + 0.5) * TILE + t.dx * 1.42, z = (t.y + 0.5) * TILE + t.dy * 1.42;
    const g = new THREE.Group(); g.position.set(x, floor.boss ? 3.6 : 2.0, z);       // higher on the tall arena walls
    const stick = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.4, 0.1), iron); stick.position.y = -0.05;
    const flame = new THREE.Mesh(new THREE.BoxGeometry(0.17, 0.22, 0.17), fire); flame.position.y = 0.22;
    g.add(stick, flame); group.add(g);
    return { lx: x - t.dx * 0.6, lz: z - t.dy * 0.6, y: floor.boss ? 3.8 : 2.2, color: theme.light, str: 1 };
  });
  for (const o of decorObjs) {
    const l = DECOR_LIGHT[o.kind];
    if (l) torchPts.push({ lx: o.x + Math.sin(o.yaw) * 0.6, lz: o.z + Math.cos(o.yaw) * 0.6, y: o.ly ?? l.y, color: l.color, str: l.str * (o.ls || 1) });
  }
}
function updateTorches(now) {
  const near = torchPts.map(t => ({ t, d: (t.lx - player.x) ** 2 + (t.lz - player.z) ** 2 })).sort((a, b) => a.d - b.d);
  torchLights.forEach((l, i) => {
    const n = near[i];
    if (!n) { l.intensity = 0; return; }
    l.position.set(n.t.lx, n.t.y, n.t.lz);
    l.color.setHex(n.t.color);
    l.intensity = n.t.str * (0.95 + Math.sin(now / 110 + i * 2 + n.t.lx) * 0.12 + Math.sin(now / 37 + n.t.lz) * 0.06);
  });
}

function markOpened(o) {
  o.p.opened = true;
  if (o.lid) o.lid.rotation.x = -1.15;
  else o.mats.forEach(m => m.color.multiplyScalar(0.45));
}

// ---- searching: hold E on the prop you are looking at ----
const inv = new Inventory();
let propObjs = [], decorObjs = [], enemies = [], search = null;

// ---- dev mode: 5x speed, god mode, vision cones, enemy dots, N skips a floor, M reveals the map ----
const dev = { on: false };
function setDev(on) {
  dev.on = on;
  enemies.forEach(e => { e.cone.visible = on && !e.dead; });
  el('dev').style.display = on ? 'block' : 'none';
  if (typeof tunePanel !== 'undefined') tunePanel.show(on);
  if (on) inv.hp = inv.maxHp;
}

// ---- combat: stamina, melee attacks, block and parry (numbers live in combat.js) ----
const cb = { draw: null, bashCd: 0, bash: 0, stamina: STAMINA_MAX, delay: 0, atk: null, press: false, want: false, block: false, blockT: 0, canSprint: true };
let pulse = 0;                                   // noise made by combat this frame, in metres
const loud = r => { pulse = Math.max(pulse, r); };
const pending = [], rings = [];                  // noises guards made, and expanding rings for the dev minimap
const spend = n => { cb.stamina = Math.max(0, cb.stamina - n); cb.delay = TUNE.staminaDelay; };
const wstats = () => weaponStats(inv.equip.weapon);   // equipped weapon, tier applied
let markTimer = 0;
function mark(text, color = '#fff') {
  const m = document.getElementById('hitmark');
  m.textContent = text; m.style.color = color; m.style.opacity = 1; markTimer = 0.8;
  addLog(/KILL/.test(text) ? text : 'Hit: ' + text.toLowerCase(), color);
}

function startAttack() {
  if (cb.eat) { cb.eat = null; flash('Stopped eating'); return; }
  const w = wstats();
  if (w.ranged) return startDraw(w);
  if (cb.block && shield()) return bash();            // a shield bash: attack while blocking
  if (cb.atk || cb.block || inv.swapT > 0 || pst.has('stun') || (cb.stamina < w.stam && !dev.on)) return;
  spend(w.stam); hunger.fight = 3;
  cb.atk = { t: 0, hit: false };
}

function playerHit() {
  const w = wstats();
  const t = findMeleeTarget(player, eyeY(), enemies, floor, w.reach);
  if (!t) { loud(2); return; }                    // swung at nothing
  if (!t.zone) { loud(2); mark('aim off', '#aaa'); return; }
  dealHit(t.e, t.zone, w.dmg, w, w.noise);
}

// Damage the player deals with a melee swing or an arrow. base: the weapon's damage (already scaled by tier and
// draw). noise: metres heard at once (a bow's noise is made when it is loosed and when the arrow lands instead).
function dealHit(e, zone, base, w, noise) {
  const sneak = !e.boss && e.state !== 'alerted' && !e.seen; // unaware and not looking at you (or smelling you); the boss cannot be sneak-killed
  const dmg = base * Math.min(TUNE.damageCap, ZONE_MUL[zone]) * (sneak ? Math.min(w.sneak, e.T.sneakCap) : 1)
    * (inv.buffs.might > 0 ? 1.4 : 1) * (e.resist[zone] || 1);
  const killed = e.hurt(dmg, player);
  if (noise) loud(sneak && killed ? 2 : noise);   // a clean kill is nearly silent
  if (killed) { if (e.boss) bossDefeated(e); else makeCorpse(e, sneak); mark(sneak ? 'SNEAK KILL' : 'KILLED', '#ffd23a'); }
  else {
    const pr = w.proc;                              // weapon passive: dagger bleeds, mace stuns, sword sometimes cripples, bow slows
    const proc = pr && pr.zone === zone && Math.random() < pr.chance && e.addStatus(pr.status, pr.dur);
    if (proc) discover('status:' + pr.status, STATUS[pr.status].name);
    mark(`${zone.toUpperCase()}${sneak ? ' SNEAK' : ''} ${Math.round(dmg)}${proc ? ' +' + STATUS[pr.status].name.toUpperCase() : ''}`, zone === 'head' ? '#ff9a3a' : '#fff');
  }
}

// ---- shield: blocks properly (even with a dagger), covers leg sweeps, and bashes ----
const shield = () => inv.equip.offhand && !wstats().ranged ? inv.equip.offhand : null;   // stowed while the bow is out
function blockStats() {
  const w = wstats(), sh = shield();
  if (!sh) return { parryWin: w.parryWin, cost: w.blockCost, legs: false };
  return { parryWin: Math.max(w.parryWin, SHIELD.parryWin), cost: SHIELD.cost / TIERS[sh.tier].mul, legs: true };
}
function bash() {
  if (cb.bashCd > 0 || cb.eat || (cb.stamina < SHIELD.bashStam && !dev.on)) return;
  spend(SHIELD.bashStam); cb.bashCd = SHIELD.bashCd; cb.bash = 0.25; loud(SHIELD.noise);
  const t = findMeleeTarget(player, eyeY(), enemies, floor, SHIELD.bashReach);
  if (!t) return;
  const e = t.e, sh = inv.equip.offhand;
  const killed = e.hurt(SHIELD.bashDmg * TIERS[sh.tier].mul, player);
  if (killed) { if (e.boss) bossDefeated(e); else makeCorpse(e, false); mark('KILLED', '#ffd23a'); return; }
  const stunned = e.addStatus('stun', SHIELD.bashStun);
  if (stunned) discover('status:stun', 'Stun');
  const dx = e.x - player.x, dz = e.z - player.z, d = Math.hypot(dx, dz) || 1;       // shove it back if there is room
  if (!e.boss && !Player.wallHit(floor, e.x + dx / d * SHIELD.bashPush, e.z + dz / d * SHIELD.bashPush, e.r)) { e.x += dx / d * SHIELD.bashPush; e.z += dz / d * SHIELD.bashPush; }
  mark(stunned ? 'BASH +STUN' : 'BASH', '#7fe8ff');
}

// ---- bow: hold attack to draw, release to fire. One arrow per shot, found arrows can be picked up again ----
const arrows = [];          // flying and stuck arrows
function startDraw(w) {
  if (cb.draw || inv.swapT > 0 || pst.has('stun') || cb.eat) return;
  if (inv.arrows <= 0 && !dev.on) { flash('No arrows'); return; }
  if (cb.stamina < w.stam && !dev.on) return;
  spend(w.stam); hunger.fight = 3;
  cb.draw = { t: 0 };
}
function fireArrow(frac) {
  const w = wstats();
  const cp = Math.cos(player.pitch), dx = -Math.sin(player.yaw) * cp, dy = Math.sin(player.pitch), dz = -Math.cos(player.yaw) * cp;
  const sp = BOW.speedMin + (BOW.speedMax - BOW.speedMin) * frac;
  const a = { x: player.x + dx * 0.5, y: eyeY() - 0.1, z: player.z + dz * 0.5, vx: dx * sp, vy: dy * sp, vz: dz * sp, dmg: w.dmg * (0.4 + 0.6 * frac), owner: 'player', stuck: false, w, mesh: makeArrowMesh() };
  a.mesh.position.set(a.x, a.y, a.z); a.mesh.lookAt(a.x + dx, a.y + dy, a.z + dz);
  group.add(a.mesh); arrows.push(a);
  if (!dev.on) inv.arrows--;
  loud(w.noise);
}
function stickArrow(a, hitEnemy) {
  a.stuck = true; a.vx = a.vy = a.vz = 0;
  const keep = Math.random() < (hitEnemy ? BOW.recoverHit : BOW.recoverWorld) && arrows.filter(q => q.stuck).length <= BOW.maxStuck;
  if (!keep) { group.remove(a.mesh); arrows.splice(arrows.indexOf(a), 1); return; }
  if (!hitEnemy && a.px !== undefined) { a.x = a.px; a.z = a.pz; }                     // lie in front of the wall, not inside it
  a.y = 0.05; a.mesh.position.set(a.x, 0.05, a.z); a.mesh.rotation.set(0, Math.atan2(a.dirx || 0, a.dirz || 1), 0);
}
function updateArrows(dt) {
  for (let i = arrows.length - 1; i >= 0; i--) {
    const a = arrows[i];
    if (a.stuck) {
      if (Math.hypot(a.x - player.x, a.z - player.z) < 1.0 && inv.arrows < QUIVER_MAX) { inv.arrows++; group.remove(a.mesh); arrows.splice(i, 1); addLog('Picked up an arrow.', '#cfc'); }
      continue;
    }
    const sp = Math.hypot(a.vx, a.vz) || 1; a.dirx = a.vx / sp; a.dirz = a.vz / sp;
    const ev = stepArrow(a, dt, floor, enemies, player);
    a.mesh.position.set(a.x, a.y, a.z); a.mesh.lookAt(a.x + a.vx, a.y + a.vy, a.z + a.vz);
    if (!ev) continue;
    pending.push({ x: a.x, z: a.z, r: BOW.impactNoise });                              // an arrow hitting something is heard
    if (ev.type === 'hit') { dealHit(ev.e, ev.zone, a.dmg, a.w, 0); stickArrow(a, true); }
    else stickArrow(a, false);
  }
}

// The boss always leaves a body holding: one Epic piece (small chance of Legendary), one more rolled
// piece of equipment (Rare or better) and gold.
function bossDefeated(e) {
  e.corpseDone = true;
  const rng = makeRng((e.seed ^ 0xb055) >>> 0);
  const epic = rollEquipment(floorNum, rng, {});
  epic.tier = rng() < TUNE.bossLegendary ? 4 : 3;
  const extra = rollEquipment(floorNum, rng, { boost: 1, minTier: 2 });
  propObjs.push({
    p: { kind: 'corpse', x: Math.floor(e.x / TILE), y: Math.floor(e.z / TILE), opened: false, seed: e.seed, left: [epic, extra, { type: 'gold', n: rng.int(120, 200) }] },
    mesh: e.mesh, x: e.x, z: e.z, r: 0, lid: null, mats: [],
  });
  flash('The boss falls! Loot its body. The way down is open.');
}

// A dead enemy leaves a lootable body only if its drop roll gave something.
function makeCorpse(e, sneak) {
  e.corpseDone = true;
  const bonus = sneak ? 0.15 : 0;
  if (!rollLoot('corpse', floorNum, makeRng(e.seed), bonus, e.gear, e.type).length) return;
  propObjs.push({
    p: { kind: 'corpse', x: Math.floor(e.x / TILE), y: Math.floor(e.z / TILE), opened: false, seed: e.seed, bonus, gear: e.gear, type: e.type },
    mesh: e.mesh, x: e.x, z: e.z, r: 0, lid: null, mats: [],
  });
}

function resolveEnemyAttack(e, zone) {
  const w = wstats();
  const fx = -Math.sin(player.yaw), fz = -Math.cos(player.yaw);
  const dx = e.x - player.x, dz = e.z - player.z, d = Math.hypot(dx, dz) || 1;
  const facing = (dx * fx + dz * fz) / d > 0.2;
  const full = TUNE.enemyDmg * e.dmgMul * ZONE_MUL[zone] * (1 - inv.armorRed(zone));   // armor in that zone's slot cuts it
  const bs = blockStats();
  if (cb.block && facing && !w.ranged) {
    if (zone === 'legs' && !bs.legs) mark('LEG SWEEP', '#ff6a4a');           // goes under a plain block
    else if (zone === 'legs') {                                              // a shield covers most of a low sweep
      const c = bs.cost * SHIELD.legsCost;
      if (cb.stamina >= c || dev.on) { spend(c); mark('LOW BLOCK', '#cfe'); loud(5); cb.atk = null; damage(full * SHIELD.legsTake); return; }
      cb.stamina = 0; mark('GUARD BROKEN', '#ff6a4a'); damage(full * 0.5); hitStatuses(e, zone); return;
    }
    else if (cb.blockT <= bs.parryWin) {
      e.stun = 1.0; e.winding = false; e.atkCd = 0.6;
      mark('PARRY', '#7fe8ff'); loud(5); return;
    } else if (bs.cost > 0) {
      if (cb.stamina >= bs.cost || dev.on) { spend(bs.cost); mark('BLOCKED', '#cfe'); loud(5); return; }
      cb.stamina = 0; mark('GUARD BROKEN', '#ff6a4a'); damage(full * 0.5); hitStatuses(e, zone); return;
    }
  }
  cb.atk = null;
  damage(full);
  hitStatuses(e, zone);
}
// What a landed hit does besides damage: leg hits slow (the boss cripples), head hits daze, a dagger bleeds.
function hitStatuses(e, zone) {
  const add = n => { if (pst.apply(n)) { discover('status:' + n, STATUS[n].name); addLog(STATUS[n].name + '!', STATUS[n].color); } };
  if (zone === 'legs') add(e.boss ? 'cripple' : 'slow');
  else if (zone === 'head') add('daze');
  else if (e.weaponKind === 'dagger') add('bleed');
}

const HUNGER_MSG = { hungry: 'Your stomach growls. You are hungry.', weak: 'You feel weak with hunger.', starving: 'You are starving! Find food.', fed: 'You feel fed.' };
function startEat(it) {
  if (cb.eat || !inv.find(it.id)) return;
  if (hunger.v >= 97) { flash('You are not hungry.'); return; }
  cb.eat = { it, t: 0, dur: FOOD[it.kind].time };
}
function finishEat() {
  const it = cb.eat.it, f = FOOD[it.kind]; cb.eat = null;
  const hearth = decorObjs.some(o => o.kind === 'hearth' && Math.hypot(o.x - player.x, o.z - player.z) < 3.2);   // a lit hearth makes the same meal go further
  const feed = Math.round(f.feed * (hearth ? 1.25 : 1));
  hunger.feed(feed);
  if (f.buff) inv.buffs[f.buff] = BUFF_TIME[f.buff];
  if (--it.n <= 0) inv.remove(it);
  flash(`Ate ${f.name}${hearth ? ' by the fire' : ''}. +${feed} food`);
}

function updateCombat(dt) {
  // gear and potions feed the player and the guards' senses
  player.speedMul = (dev.on ? 5 : 1) * (inv.buffs.swift > 0 ? 1.35 : 1) * pst.moveMul();
  const bleed = pst.update(dt);
  if (bleed > 0 && !dev.on && inv.hp > 1) inv.hp = Math.max(1, inv.hp - bleed);   // bleeding never kills on its own
  if (pst.has('daze')) spend(STATUS.daze.drain * dt);
  if (!dev.on) {                                    // hunger drains while you play (frozen in dev mode)
    const r = hunger.update(dt, { sprinting: player.sprinting, still: Math.hypot(player.vx, player.vz) < 0.2, crouching: player.crouching });
    if (r.growl) loud(r.growl);                     // a stomach growl is a faint noise
    if (r.hp && inv.hp > 1) inv.hp = Math.max(1, inv.hp - r.hp);   // starving hurts but never kills
    if (r.stage) { flash(HUNGER_MSG[r.stage]); if (r.stage !== 'fed') discover('item:hunger', 'Hunger'); }
  }
  if (inv.eatReq) { startEat(inv.eatReq); inv.eatReq = null; }
  if (cb.eat) {
    const ea = cb.eat; ea.t += dt; cb.atk = null; cb.block = false;
    player.speedMul *= 0.5;                         // you shuffle while eating
    if ((ea.n = (ea.n || 0) + dt) > 0.6) { ea.n = 0; loud(2); }
    el('prompt').style.display = 'block'; el('promptText').textContent = `Eating ${FOOD[ea.it.kind].name}... (attack to stop)`; el('barFill').style.width = Math.min(1, ea.t / ea.dur) * 100 + '%';
    if (!inv.find(ea.it.id)) cb.eat = null; else if (ea.t >= ea.dur) finishEat();
  }
  player.noiseBonus = inv.armorNoise();
  player.stealthMul = inv.buffs.shadow > 0 ? 0.5 : 1;
  if (inv.refillStamina) { cb.stamina = STAMINA_MAX; inv.refillStamina = false; }

  if (player.sprinting) spend(TUNE.sprintDrain * dt);
  else if (cb.delay > 0) cb.delay -= dt;
  else cb.stamina = Math.min(STAMINA_MAX, cb.stamina + TUNE.staminaRegen * (inv.buffs.vigor > 0 ? 2 : 1) * (inv.buffs.hearty > 0 ? 1.5 : 1) * hunger.regenMul() * dt);
  cb.stamina = Math.min(cb.stamina, STAMINA_MAX * hunger.maxStaminaMul());   // Weak: max stamina is cut
  if (dev.on) cb.stamina = STAMINA_MAX;
  if (cb.stamina <= 1) cb.canSprint = false; else if (cb.stamina > 25) cb.canSprint = true;
  player.canSprint = cb.canSprint && hunger.canSprint() && !cb.eat;

  if (cb.bashCd > 0) cb.bashCd -= dt;
  if (cb.bash > 0) cb.bash -= dt;
  if (cb.press) { startAttack(); cb.press = false; }
  if (cb.draw) {                                    // drawing the bow: slow, release to fire, block cancels
    const w = wstats();
    cb.draw.t += dt; player.speedMul *= 0.4;
    if (!w.ranged || inv.swapT > 0 || cb.eat || pst.has('stun') || cb.want) cb.draw = null;
    else if (!player.keys[KEYS.attack]) {
      const frac = Math.min(1, cb.draw.t / w.draw);
      if (frac >= BOW.minDraw) fireArrow(frac);
      cb.draw = null;
    } else {
      const frac = Math.min(1, cb.draw.t / w.draw);
      el('prompt').style.display = 'block'; el('promptText').textContent = frac >= 1 ? 'Release to fire' : 'Drawing...'; el('barFill').style.width = frac * 100 + '%';
    }
  }
  if (cb.atk) {
    const w = wstats();
    cb.atk.t += dt;
    if (!cb.atk.hit && cb.atk.t >= w.dur * w.hitAt) { cb.atk.hit = true; playerHit(); }
    if (cb.atk.t >= w.dur) cb.atk = null;
  }
  const canBlock = cb.want && !cb.atk && inv.swapT <= 0 && !pst.has('stun') && !cb.eat && !wstats().ranged && (cb.stamina > 0 || dev.on);
  if (canBlock) { if (!cb.block) { cb.block = true; cb.blockT = 0; } else cb.blockT += dt; } else cb.block = false;

  if (markTimer > 0) { markTimer -= dt; if (markTimer <= 0) document.getElementById('hitmark').style.opacity = 0; }
}

// Free distance in front of the camera before a wall or solid prop, checked left, centre and right of the blade (max 2 m).
function freeAhead() {
  const fx = -Math.sin(player.yaw), fz = -Math.cos(player.yaw), rx = Math.cos(player.yaw), rz = -Math.sin(player.yaw);
  let free = 2;
  for (const off of [-0.4, 0, 0.45]) for (let d = 0.1; d < free; d += 0.1) {
    const px = player.x + fx * d + rx * off, pz = player.z + fz * d + rz * off;
    if (wallAt(floor, Math.floor(px / TILE), Math.floor(pz / TILE)) || floor.solids.some(s => s.r > 0.3 && (px - s.x) ** 2 + (pz - s.z) ** 2 < s.r * s.r)) { free = d; break; }
  }
  return free;
}

// first-person weapon: rest, swing, block and swap poses
const vm = { id: null, group: new THREE.Group(), model: null, shield: new THREE.Group(), shieldId: null };
camera.add(vm.group); camera.add(vm.shield);
function buildShieldModel(it) {
  const g = new THREE.Group(), c = new THREE.Color(TIERS[it.tier].color);
  const add = (w, h, d, col, x, y, z) => { const b = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), new THREE.MeshLambertMaterial({ color: col })); b.position.set(x, y, z); g.add(b); };
  add(0.42, 0.56, 0.05, 0x5a3a20, 0, 0, 0);                                    // wooden board
  add(0.36, 0.5, 0.02, c.getHex(), 0, 0, -0.03);                                // tier-coloured face
  add(0.1, 0.1, 0.06, 0xb8bcc4, 0, 0, -0.05);                                   // boss
  add(0.42, 0.04, 0.06, 0xb8bcc4, 0, 0.27, -0.02); add(0.42, 0.04, 0.06, 0xb8bcc4, 0, -0.27, -0.02);   // rims
  return g;
}
function updateViewmodel(dt) {
  if (vm.id !== inv.weapon) {
    if (vm.model) vm.group.remove(vm.model);
    vm.model = buildWeaponModel(inv.weapon); vm.group.add(vm.model); vm.id = inv.weapon;
  }
  const sh = shield();                                     // the off-hand shield, raised while blocking, thrust forward on a bash
  if ((sh && sh.id) !== vm.shieldId) {
    while (vm.shield.children.length) vm.shield.remove(vm.shield.children[0]);
    if (sh) vm.shield.add(buildShieldModel(sh));
    vm.shieldId = sh && sh.id;
  }
  vm.shield.visible = !!sh;
  if (sh) {
    const bashK = cb.bash > 0 ? Math.sin((1 - cb.bash / 0.25) * Math.PI) : 0;
    const tx = cb.block ? -0.1 : -0.42, ty = cb.block ? -0.2 : -0.4, tz = (cb.block ? -0.62 : -0.68) - 0.3 * bashK;
    const k2 = 1 - Math.exp(-16 * dt), sp = vm.shield.position;
    sp.x += (tx - sp.x) * k2; sp.y += (ty - sp.y) * k2; sp.z += (tz - sp.z) * k2;
    vm.shield.rotation.y += ((cb.block ? 0.05 : 0.4) - vm.shield.rotation.y) * k2;
  }
  let x = 0.38, y = -0.5, z = -0.7, rx = -0.15, rz = 0.15;
  if (cb.draw) { const f = Math.min(1, cb.draw.t / wstats().draw); x = 0.2; y = -0.38; z = -0.8 + 0.18 * f; rx = 0.05; rz = 0.02; }   // the bow is raised and the string drawn back
  if (cb.block) { x = 0.05; y = -0.36; z = -0.62; rx = -0.05; rz = 0; }
  if (inv.swapT > 0) y -= 0.5 * Math.sin(inv.swapT / SWAP_TIME * Math.PI);
  let k = 1 - Math.exp(-16 * dt);
  if (cb.atk) {
    const w = wstats(), p = Math.min(1, cb.atk.t / w.dur), s = Math.sin(p * Math.PI);
    x -= 0.6 * s; z -= 0.25 * s; rx -= 1.25 * s; rz += 0.7 * s;
    k = 1;
  }
  // Keep the weapon out of walls and furniture: pull it back toward the camera by however far it
  // would reach past the nearest obstacle (a swing reaches much farther than the rest pose).
  const pull = Math.max(0, Math.min(1.3, (cb.atk ? 1.9 : 0.95) - freeAhead()));
  z += pull; y -= pull * 0.15; rx += pull * 0.5;
  const g = vm.group;
  g.position.x += (x - g.position.x) * k; g.position.y += (y - g.position.y) * k; g.position.z += (z - g.position.z) * k;
  g.rotation.x += (rx - g.rotation.x) * k; g.rotation.z += (rz - g.rotation.z) * k;
}

// ---- damage and death ----
// Getting hit: a red screen flash plus a quick camera shake, both scaled by the damage (shown in dev mode too, with no HP lost).
const shake = { t: 0, dur: 0.32, mag: 0 };
function hitReaction(n) {
  shake.mag = Math.min(0.055, 0.012 + n * 0.0012); shake.t = shake.dur;
  const f = el('flash');
  f.style.transition = 'none'; f.style.opacity = Math.min(1, 0.45 + n / 25);
  requestAnimationFrame(() => { f.style.transition = 'opacity .35s'; f.style.opacity = 0; });
}
function damage(n) {
  hitReaction(n);
  hunger.fight = 3;
  if (cb.eat) { cb.eat = null; flash('Interrupted!'); }
  if (dev.on) return;
  inv.hp = Math.max(0, inv.hp - n);
  if (inv.hp <= 0) {
    state = 'dead';
    document.exitPointerLock();
    hud.overlayText.innerHTML = `<h1>You died on floor ${floorNum}</h1><p>Click to start a new run.</p>`;
    hud.overlay.style.display = 'flex';
  }
}
const el = id => document.getElementById(id);

function lookTarget() {
  const dx = -Math.sin(player.yaw), dz = -Math.cos(player.yaw);
  let best = null, bestD = 1e9;
  for (const o of propObjs) {
    if (o.p.opened) continue;
    const vx = o.x - player.x, vz = o.z - player.z, d = Math.hypot(vx, vz);
    if (d > 2.4 || (vx * dx + vz * dz) / d < 0.8) continue;
    if (d < bestD) { best = o; bestD = d; }
  }
  return best;
}

// What the prompt shows and how long the hold takes. A locked door cannot be held open without its key.
function targetInfo(o) {
  if (o.p.kind === 'door' && !inv.has('key', o.p.lock)) return { label: `Locked: needs the ${o.p.keyLabel}`, time: 0, locked: true };
  return PROP_INFO[o.p.kind];
}

function updateSearch(dt) {
  const target = lookTarget();
  const info = target && targetInfo(target);
  if (target && !info.locked && player.keys[KEYS.interact]) {
    if (!search || search.o !== target) search = { o: target, t: 0 };
    search.t += dt;
    if (search.t >= info.time) { finishSearch(target); search = null; }
  } else search = null;

  const prompt = el('prompt');
  if (target) {
    prompt.style.display = 'block';
    el('promptText').textContent = info.locked ? info.label : `Hold E: ${info.label}`;
    el('barFill').style.width = (search && info.time ? Math.min(1, search.t / info.time) * 100 : 0) + '%';
  } else prompt.style.display = 'none';
}

const SEARCH_NOISE = { chest: 3, vaultchest: 3, barrel: 4, rubble: 4, pantry: 3, door: 5 };   // metres, heard when the search finishes
function finishSearch(o) {
  loud(SEARCH_NOISE[o.p.kind] || 0);
  if (o.p.kind === 'door') {
    inv.remove(inv.pack.find(i => i.type === 'key' && i.lock === o.p.lock));
    openDoor(o);
    flash(`Unlocked the ${o.p.room}`);
    return;
  }
  const drops = o.p.left || (o.p.fixed ? [{ type: 'potion', kind: o.p.fixed, n: 1 }] : [...rollLoot(o.p.kind, floorNum, makeRng(o.p.seed), o.p.bonus || 0, o.p.gear || [], o.p.type), ...(o.p.extra || [])]);
  const got = [], left = [], notes = [];
  for (const d of drops) {
    const text = inv.add(d);
    if (text) got.push(text);
    else if (d.type === 'arrows') notes.push('quiver full');
    else left.push(d);
  }
  if (left.length) { o.p.left = left; notes.push(`pack full, ${left.length} left behind`); }
  else markOpened(o);
  let msg = got.length ? 'Found ' + got.join(', ') : left.length ? '' : 'Nothing useful';
  if (notes.length) msg += (msg ? ' ' : '') + `(${notes.join(', ')})`;
  flash(msg);
}

// Doors slide up out of the way once unlocked.
function openDoor(o) {
  floor.tiles[o.p.y * floor.w + o.p.x] = T_FLOOR;
  o.p.opened = true; o.anim = 0;
}
function updateDoors(dt) {
  for (const o of propObjs) {
    if (o.p.kind !== 'door' || o.anim === undefined || o.anim >= 1) continue;
    o.anim = Math.min(1, o.anim + dt);
    o.mesh.position.y = o.anim * WALL_H;
    if (o.anim >= 1) o.mesh.visible = false;
  }
}

let hudKey = '';
function updateHud() {
  const boss = enemies.find(e => e.boss);
  if (boss && boss.justWoke) { boss.justWoke = false; flash('The boss wakes!'); }
  el('boss').style.display = boss && !boss.dormant && !boss.dead ? 'block' : 'none';
  if (boss) el('bossFill').style.width = Math.max(0, boss.hp / boss.maxHp * 100) + '%';
  el('hpFill').style.width = (inv.hp / inv.maxHp * 100) + '%';
  el('stamFill').style.width = (cb.stamina / STAMINA_MAX * 100) + '%';
  el('stamFill').style.background = cb.canSprint ? '#4cc36a' : '#c9a23a';
  el('hungerFill').style.width = hunger.v + '%';
  el('hungerFill').style.background = { fed: '#d9a441', hungry: '#e08a2a', weak: '#d4562a', starving: '#b01e1e' }[hunger.stage];
  const slots = inv.quick.map((_, i) => {
    const it = inv.quickItem(i);
    const name = !it ? '' : it.type === 'potion' || it.type === 'food' ? `${itemName(it)} x${it.n}` : itemName(it);
    const c = it ? itemColor(it) : '#fff5';
    return `<div class="slot" style="border-color:${c}"><i>${i + 1}</i><span style="color:${c}">${name || '&nbsp;'}</span></div>`;
  }).join('');
  const w = inv.equip.weapon;
  const arm = ['head', 'body', 'legs'].map(z => `${z[0].toUpperCase()}${Math.round(inv.armorRed(z) * 100)}`).join(' ');
  const buffs = Object.entries(inv.buffs).map(([k, t]) => `${k} ${Math.ceil(t)}s`)
    .concat(pst.list().map(([k, t]) => `<span style="color:${STATUS[k].color}">${STATUS[k].name} ${Math.ceil(t)}s</span>`)).join(' &middot; ');
  const line = `<span style="color:${itemColor(w)}">${itemName(w)}</span>${inv.equip.offhand ? ` + <span style="color:${itemColor(inv.equip.offhand)}">${itemName(inv.equip.offhand)}</span>${wstats().ranged ? ' (stowed)' : ''}` : ''}${inv.swapT > 0 ? ' (swapping)' : ''} &middot; Armor ${arm}% &middot; Arrows ${inv.arrows}/${QUIVER_MAX} &middot; Gold ${inv.gold} &middot; Pack ${inv.pack.length}/${PACK_MAX}${hunger.stage === 'fed' ? '' : ` &middot; <span style="color:#e08a2a">${hunger.stage[0].toUpperCase() + hunger.stage.slice(1)}</span>`}${buffs ? '<br>' + buffs : ''}`;
  const key = slots + line + inv.hp;
  if (key === hudKey) return;
  hudKey = key;
  el('slots').innerHTML = slots;
  el('line').innerHTML = line;
}

const ambient = new THREE.AmbientLight(0xffffff, 0.5);
const torch = new THREE.PointLight(theme.light, 1.0, 16, 1.6);   // player lantern, brighter than the ambient so rooms read
scene.add(ambient);
camera.add(torch);

// The armory is on one random floor of the run, picked from the seed. It is always a locked room.
const armoryFloor = makeRng((runSeed ^ 0x5bd1e995) >>> 0).int(1, MAX_FLOOR - 1);   // never the boss floor, which has no rooms
let respawnT = Infinity, baseGuards = 0;

function startFloor(n) {
  floorNum = n;
  floor = generateFloor(runSeed, n, { armory: n === armoryFloor, boss: n === MAX_FLOOR });
  assignEnemyTypes(floor, runSeed, n, theme.name);          // natives, rat packs, wolves and their handlers (js/enemytypes.js)
  WALL_H = floor.boss ? BOSS_WALL_H : 3.6;
  explored = new Uint8Array(floor.w * floor.h);
  buildFloor();
  player.props = propObjs;
  player.mobs = enemies;
  search = null;
  arrows.length = 0;                                  // the old floor's group (and its arrows) is gone
  cb.draw = null;
  player.place(floor);
  baseGuards = floor.enemies.length;
  respawnT = n >= 3 && !floor.boss ? 35 + Math.random() * 35 : Infinity;   // from floor 3 on, guards keep turning up (not in the boss arena)
  hud.floor.textContent = `Floor ${n} / ${MAX_FLOOR}` + (n === MAX_FLOOR ? ' (boss floor)' : '');
  const locked = floor.doors.map(d => d.room).join(', ');
  if (floor.boss) flash('The boss arena. Something huge sleeps in the middle. One healing potion hides along the walls.');
  else flash(`${n === 1 ? '' : `Floor ${n}. `}Find the stairs.${locked ? ` Locked: ${locked}. Keys hide in chests.` : ''}`);
}

// Floors 3 and deeper: every 35 to 70 seconds a guard appears in a room you cannot see, up to 1.5x the floor's guard count.
function updateRespawn(dt) {
  if (floorNum < 3 || floor.boss) return;
  respawnT -= dt;
  if (respawnT > 0) return;
  respawnT = 35 + Math.random() * 35;
  if (enemies.filter(e => !e.dead).length >= Math.ceil(baseGuards * 1.5)) return;
  const open = floor.rooms.filter(r => !r.locked);
  const homes = open.filter((r, i) => r !== floor.rooms[0]
    && Math.hypot((r.cx + 0.5) * TILE - player.x, (r.cy + 0.5) * TILE - player.z) > 24
    && !hasLOS(floor, player.x, player.z, (r.cx + 0.5) * TILE, (r.cy + 0.5) * TILE));
  if (!homes.length) { respawnT = 8; return; }
  const pick = arr => arr[Math.floor(Math.random() * arr.length)];
  const a = roomPoint(floor, pick(homes), Math.floor(Math.random() * 8)), b = roomPoint(floor, pick(open), Math.floor(Math.random() * 8));
  const e = new Enemy({ x: a.x, y: a.y, route: [a, b], seed: (Math.random() * 4294967296) >>> 0, type: respawnType(theme.name, floorNum, Math.random) }, floor);
  e.cone.visible = dev.on; group.add(e.mesh); enemies.push(e);
}

// Event log, bottom left: newest line at the bottom, older lines fade as they age.
const LOG_MAX = 8;
function addLog(text, color = '#ddd') {
  if (!text) return;
  const box = document.getElementById('log'), line = document.createElement('div');
  line.textContent = text; line.style.color = color; line.dataset.t = performance.now();
  box.appendChild(line);
  while (box.children.length > LOG_MAX) box.firstChild.remove();
  [...box.children].forEach((c, i, a) => c.style.opacity = 0.4 + 0.6 * (i + 1) / a.length);
}
function flash(text) { hud.msg.textContent = text; msgTimer = 3; hud.msg.style.opacity = 1; addLog(text); }

function reveal() {
  const R = 5, px = player.tileX, py = player.tileY;
  for (let dy = -R; dy <= R; dy++) for (let dx = -R; dx <= R; dx++) {
    const x = px + dx, y = py + dy;
    if (x < 0 || y < 0 || x >= floor.w || y >= floor.h || dx * dx + dy * dy > R * R) continue;
    if (explored[y * floor.w + x]) continue;
    // only what you could actually see: locked rooms stay hidden behind their walls
    if (hasLOS(floor, player.x, player.z, (x + 0.5) * TILE, (y + 0.5) * TILE)) explored[y * floor.w + x] = 1;
  }
}

function drawMinimap() {
  const S = hud.mini.width / floor.w;
  mctx.fillStyle = '#000'; mctx.fillRect(0, 0, hud.mini.width, hud.mini.height);
  for (let y = 0; y < floor.h; y++) for (let x = 0; x < floor.w; x++) {
    if (!explored[y * floor.w + x]) continue;
    const t = floor.tiles[y * floor.w + x];
    mctx.fillStyle = t === T_WALL ? '#2a2a33' : t === T_STAIRS ? '#ffd24a' : t === T_DOOR ? '#c0702a' : '#6a6a78';
    mctx.fillRect(x * S, y * S, S + 0.5, S + 0.5);
  }
  if (dev.on) for (const e of enemies) {
    if (e.dead) continue;
    mctx.fillStyle = e.state === 'alerted' ? '#ff3a3a' : e.state === 'unaware' ? '#e07a3a' : '#ffc23a';
    mctx.beginPath(); mctx.arc(e.x / TILE * S, e.z / TILE * S, 2.5, 0, 7); mctx.fill();
  }
  if (dev.on) for (let i = rings.length - 1; i >= 0; i--) {   // noise rings fade as they pass
    const n = rings[i]; n.t += 1 / 60;
    if (n.t > 0.6) { rings.splice(i, 1); continue; }
    mctx.strokeStyle = `rgba(120,200,255,${1 - n.t / 0.6})`;
    mctx.beginPath(); mctx.arc(n.x / TILE * S, n.z / TILE * S, n.r / TILE * S * (0.3 + n.t / 0.6 * 0.7), 0, 7); mctx.stroke();
  } else rings.length = 0;
  for (const o of propObjs) {
    if (o.p.opened || !explored[o.p.y * floor.w + o.p.x]) continue;
    mctx.fillStyle = o.p.kind === 'chest' ? '#e8c860' : '#b08a5a';
    mctx.fillRect(o.p.x * S + S / 4, o.p.y * S + S / 4, S / 2 + 1, S / 2 + 1);
  }
  const px = player.x / TILE * S, py = player.z / TILE * S;
  mctx.save(); mctx.translate(px, py); mctx.rotate(-player.yaw);
  mctx.fillStyle = '#5fe08a';
  mctx.beginPath(); mctx.moveTo(0, -5); mctx.lineTo(3.5, 4); mctx.lineTo(-3.5, 4); mctx.closePath(); mctx.fill();
  mctx.restore();
}

// 0 outside the stairwell, up to 1 at the bottom step; the eye sinks as you walk down
function stairProgress() {
  const b = stairBox;
  if (player.x < b.x0 || player.x > b.x1 || player.z < b.z0 || player.z > b.z1) return 0;
  return Math.max(0.02, (player.z - b.z0) / (b.z1 - b.z0));
}
function eyeY() { return player.eye - stairProgress() * STAIR_DEPTH; }

let sealedMsgT = 0;
function checkStairs() {
  if (floor.boss && enemies.some(e => e.boss && !e.dead) && stairProgress() > 0.25) {   // sealed until the boss falls
    player.z = stairBox.z0 - 0.45; player.vz = 0;
    if (performance.now() - sealedMsgT > 2500) { sealedMsgT = performance.now(); flash('The way down is sealed until the boss falls.'); }
    return;
  }
  if (stairProgress() < 0.85) return;
  if (floorNum < MAX_FLOOR) startFloor(floorNum + 1);
  else finishRun();
}
function finishRun() {
  state = 'won';
  document.exitPointerLock();
  hud.overlayText.innerHTML = `<h1>Boss defeated</h1><p>You took the stairs down from floor ${MAX_FLOOR}. That is the end of this iteration.</p><p>Click to start a new run.</p>`;
  hud.overlay.style.display = 'flex';
}

function resize() {
  renderer.setSize(innerWidth, innerHeight, false);
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
}
addEventListener('resize', resize); resize();

hud.theme.textContent = theme.name;
hud.seed.textContent = `seed ${runSeed}`;

function begin() {
  if (state === 'won' || state === 'dead') { location.search = '?seed=' + ((Math.random() * 4294967296) >>> 0); return; }
  state = 'play'; session.started = true;
  hud.overlay.style.display = 'none';
  canvas.requestPointerLock();
}
hud.overlay.addEventListener('click', begin);
canvas.addEventListener('click', () => { if (state === 'play' && document.pointerLockElement !== canvas) canvas.requestPointerLock(); });
document.addEventListener('pointerlockchange', () => {
  if (state === 'play' && document.pointerLockElement !== canvas) pauseMenu.open();
});
addEventListener('mousemove', e => { if (document.pointerLockElement === canvas) player.look(e.movementX, e.movementY); });
addEventListener('keydown', e => {
  if (!e.repeat && e.code === 'Backquote') setDev(!dev.on);
  if (dev.on && !e.repeat && state === 'play') {
    if (e.code === 'KeyN') { if (floorNum < MAX_FLOOR) startFloor(floorNum + 1); else finishRun(); }
    if (e.code === 'KeyM') explored.fill(1);
  }
  const slot = [KEYS.slot1, KEYS.slot2, KEYS.slot3, KEYS.slot4].indexOf(e.code);
  if (state === 'play' && !e.repeat && slot >= 0) {
    const msg = inv.use(slot);
    if (msg) flash(msg);
    if (inv.swapT > 0) cb.atk = null;
  }
  if (state === 'play' && !e.repeat) pressAction(e.code);
  player.keys[e.code] = true; if (e.code === 'ControlLeft') e.preventDefault(); });
addEventListener('keyup', e => { player.keys[e.code] = false; if (e.code === KEYS.block) cb.want = false; });
// Attack and block can be bound to a key or a mouse button, so both go through here.
function pressAction(code) {
  if (code === KEYS.attack) cb.press = true;
  if (code === KEYS.block) cb.want = true;
}
addEventListener('blur', () => { player.keys = {}; cb.want = false; });
// A stray Ctrl+W, Ctrl+R or back button during a run asks before leaving instead of losing it.
addEventListener('beforeunload', e => { if (state === 'play' && !dev.on) { e.preventDefault(); e.returnValue = ''; } });
addEventListener('mousedown', e => {
  if (state !== 'play' || document.pointerLockElement !== canvas) return;
  player.keys['Mouse' + e.button] = true;
  pressAction('Mouse' + e.button);
});
addEventListener('mouseup', e => { player.keys['Mouse' + e.button] = false; if ('Mouse' + e.button === KEYS.block) cb.want = false; });
addEventListener('contextmenu', e => e.preventDefault());

startFloor(1);
if (params.has('dev')) setDev(true);
let last = performance.now(), frameNo = 0, dazeOn = false;
function frame(now) {
  const dt = (now - last) / 1000; last = now;
  if (state === 'play') {
    player.update(dt, floor);
    inv.update(dt);
    updateSearch(dt);
    updateCombat(dt);
    updateRespawn(dt);
    updateArrows(dt);
    updateDoors(dt);
    const events = pending.splice(0);              // noises guards made last frame
    for (const n of events) rings.push({ x: n.x, z: n.z, r: n.r, t: 0 });
    if (pulse > 0) { events.push({ x: player.x, z: player.z, r: pulse }); rings.push({ x: player.x, z: player.z, r: pulse, t: 0 }); }
    if (player.noiseRadius > 0) events.push({ x: player.x, z: player.z, r: player.noiseRadius });
    pulse = 0;
    const noise = { events, emit: (x, z, r, src) => pending.push({ x, z, r, src }) };
    for (const e of enemies) { const zone = e.update(Math.min(dt, 0.05), player, noise); if (zone) resolveEnemyAttack(e, zone); }
    separateBodies(enemies, player, floor);
    for (const e of enemies) if (e.dead && !e.corpseDone) { if (e.boss) bossDefeated(e); else makeCorpse(e, false); addLog(`The ${e.T.name.toLowerCase()} bled out.`, '#ff6a6a'); }
    reveal();
    if ((frameNo = (frameNo + 1) % 15) === 0) discoverEnemiesInView();
    checkStairs();
    if (msgTimer > 0) { msgTimer -= dt; if (msgTimer <= 0) hud.msg.style.opacity = 0; }
  }
  camera.position.set(player.x, eyeY(), player.z);
  camera.rotation.set(player.pitch, player.yaw, 0);
  if (shake.t > 0) {                               // decaying jolt: a sharp kick that settles over 0.3 s
    shake.t = Math.max(0, shake.t - dt);
    const s = shake.mag * (shake.t / shake.dur) ** 1.5;
    camera.rotation.x += (Math.random() - 0.5) * 2 * s; camera.rotation.y += (Math.random() - 0.5) * 2 * s; camera.rotation.z += (Math.random() - 0.5) * 3 * s;
    camera.position.y -= s * 2;
  }
  const dazed = pst.has('daze');
  if (dazed !== dazeOn) { dazeOn = dazed; canvas.style.filter = dazed ? 'blur(2.5px)' : ''; }
  if (dazed) camera.rotation.z += Math.sin(now / 180) * 0.035;
  stairsLight.intensity = 0.35 + Math.sin(now / 300) * 0.08;
  updateViewmodel(dt);
  updateTorches(now);
  drawMinimap();
  updateHud();
  if (!params.has('norender')) renderer.render(scene, camera);   // ?norender=1: tests skip the (software) drawing and keep all the game logic
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);

// Debug hook for testing from the console.
window.game = {
  player, startFloor, inv, cb, pst, hunger, arrows, get rings() { return rings; }, get floor() { return floor; }, get enemies() { return enemies; }, get state() { return state; },
  draw() {
    camera.position.set(player.x, eyeY(), player.z);
    camera.rotation.set(player.pitch, player.yaw, 0);
    updateViewmodel(1); updateTorches(performance.now()); drawMinimap(); renderer.render(scene, camera);
  },
};
