// Co-op, the game side (2 players, host + guest, js/net.js has the wire). HOST-AUTHORITATIVE: the host runs enemy AI, drops, bosses and
// floor changes. The guest generates the same floors from the host's seed, moves itself (client-side prediction), and shows enemies
// interpolated from the host's snapshots. Everything here is behind `coop.on`; solo play never runs any of it.
// A run can only be joined before it starts (a lobby on the welcome screen; the host presses Start). A disconnect mid run leaves the one
// left playing solo (a guest takes over the enemies), with no rejoin.
// What the partner does or changes is sent so it can be SEEN here: look and poses, arrows and bolts, wand and trap effects, enemy statuses and
// alert marks, shelves, bells, prints, the ally. Per player by design: quest talk and rewards, the shrine, prayer, the shop's stock.
// Known limits: going back up stairs is sealed; the host's guards do not react to the guest's ally. Everything a peer
// sends goes through Net.cleanMsg / Net.packetOk first, and no peer string is ever shown or used as markup.
const COOP = { names: ['Host', 'Guest'], hex: ['#e8a838', '#4aa8ff'], col: [0xe8a838, 0x4aa8ff], stateEvery: 0.05, snapEvery: 1 / 15, snapR: 45, delay: 100 };

const coopS = {
  link: null, role: -1, ready: false, status: '', onStatus: null,
  sid: 0, gtT: 0, lkW: null, lkS: null, lkL: false, look: null, avRole: -1, zapKind: '', plx: 1e9, plz: 1e9, reviving: false, peerRevive: false, mine: new Net.Revive(3),
  ally: null, allyTrack: new Net.Track(), allyIn: { floor: 0, x: 0, z: 0, yaw: 0, flags: 0 }, allyAt: -1e9,
  rp: { block: false, dash: false, draw: false, zap: false, x: 0, z: 0, vx: 0, vz: 0, yaw: 0, pitch: 0, eye: 1.6, radius: 0.35, crouching: false, sprinting: false, stealthMul: 1, senseMul: 1, tileX: 0, tileY: 0, noiseRadius: 0, on: false, down: false, hp: 1, atk: false, noise: 0, noiseT: 0 },   // the partner as the AI sees it
  av: null, avTrack: new Net.Track(), avSeq: -1, avList: [null], avWind: 0,
  ps: { x: 0, z: 0, yaw: 0, pitch: 0, flags: 0, hp: 1, floor: 0, seq: 0, noise: 0, speed: 0 }, pu: { x: 0, z: 0, yaw: 0, pitch: 0, flags: 0, hp: 1, floor: 0, seq: 0, noise: 0, speed: 0 }, sh: { floor: 0, seq: 0, n: 0 }, se: { nid: 0, x: 0, z: 0, yaw: 0, flags: 0, hp: 0 },
  seq: 0, putBack: false, hudNum: -1, sT: 0, nT: 0, snapSeq: 0, snapIn: -1, pulseMax: 0, fk: -1,
  noiseEv: { x: 0, z: 0, r: 0 }, nextNid: 1000, bossOut: {}, bossIn: {}, granted: new Map(), rageAt: 0,
  claims: new Net.ClaimBook(), revive: new Net.Revive(3), gate: new Net.StairGate(8), stairMe: false, stairPeer: false,
  byNid: new Map(), byRef: null, hudEl: null, hudTxt: null, hudBar: null, rng: null,
};
const coopFloorKey = () => (((stage - 1) * MAX_FLOOR + floorNum - 1) & 255);

coop.src = null;                                                                   // host: who a wand being worked for the guest came from
// what Net.cleanMsg checks a peer's message against
const coopTables = () => ({ WEAPON_NAMES, ARMOR_NAMES, POTIONS, FOOD, WANDS, STATUS, BOSS_SHOT, ENEMY_TYPES, spearKills: WSTATS.spear.kills, rageCharges: RAGE.charges, doors: floor.doors });
// A death or a co-op end must not be undone by closing a screen that was open (inventory, shop, shrine, pause).
function coopCloseScreens() {
  if (state === 'inv') invUI.close(); else if (state === 'shop') shopUI.close(); else if (state === 'deal') dealUI.close(); else if (state === 'menu' && session.started) pauseMenu.close();
}

// ---- connection lifecycle ----
function coopLink() {
  if (coopS.link) coopS.link.close();
  coopS.ready = false;
  coopS.link = new Net.Link({
    onRel: coopMsg, onState: coopState,
    onStatus: t => { coopS.status = t; if (coopS.onStatus) coopS.onStatus(t); },
    onOpen: coopOpened, onClose: coopClosed,
  });
  return coopS.link;
}
function coopOpened() {
  if (session.started) { coop.leave(); return; }                                  // too late: nobody joins a run that has begun
  coop.on = true; coop.host = coopS.role === 0; coop.guest = coopS.role === 1; coop.down = false;
  coopS.revive.secs = TUNE.coopRevive; coopS.gate.wait = TUNE.coopStairWait;
  coopS.mine.secs = TUNE.coopRevive; coopS.mine.t = 0; coopS.reviving = coopS.peerRevive = false; coopS.lkW = coopS.lkS = null; coopS.look = null; coopS.ally = null; coopS.byRef = null;
  coopS.claims.reset(); coopS.fk = -1; coopS.snapIn = -1; coopS.avSeq = -1; coopS.rp.on = false; coopS.rp.down = false; coopS.stairMe = coopS.stairPeer = false;
  if (coop.host) coop.send({ k: 'hello', seed: runSeed, stage: 1, floor: 1, v: 1 });
  coopHud(true);
  if (coopMenu) coopMenu.opened();
}
function coopClosed(why) {
  const wasGuest = coop.guest;
  coop.on = coop.host = coop.guest = false; coopS.ready = false; coopS.rp.on = false; coopS.rp.down = false; coopS.stairMe = coopS.stairPeer = false;
  if (coop.down) { coop.down = false; inv.hp = Math.max(1, inv.maxHp * TUNE.coopReviveHp); }
  if (coopS.av) coopS.av.mesh.visible = false;
  for (const e of enemies) if (e.boss) e.other = e.coopFx = null;
  for (const o of propObjs) if (o.p.busy) { o.p.busy = false; o.p.left = o.grant; o.grant = null; }   // a container the partner was emptying: still there
  coopHud(false);
  if (coopS.ally && coopS.ally.mesh.parent) coopS.ally.mesh.parent.remove(coopS.ally.mesh);
  coopS.ally = null;
  if (wasGuest) coopTakeover();                                                   // lobby or mid run: puppets must never outlive the link
  if (session.started && state !== 'dead' && state !== 'won') {                   // mid run: the one left carries on alone, and nobody can rejoin
    flash(`${why} Continuing solo.`);
  }
  if (coopMenu) coopMenu.closed(why);
}
// The host is gone: the guest's puppets become real enemies again, on this floor and every cached one.
function coopTakeover() {
  coopS.byRef = null; coopS.byNid.clear(); bossTeleHide();
  enemies.forEach(coopFree);
  for (const s in stageCaches) for (const n in stageCaches[s]) stageCaches[s][n].enemies.forEach(coopFree);
}
function coopFree(e) {
  delete e.hurt; delete e.addStatus; delete e.sleep; delete e.enrage;
  const glued = e.st.has('stuck'); e.net = null; e.st.clear(); if (glued) e.st.apply('stuck'); e.stun = 0; e.sleepT = 0; e.rageT = 0; e.healFx = 0; e.winding = false; e.path = []; e.pk = ''; e.rp = 0; e.lostT = 0; e.shouted = false;
  if (e.dead) { e.rq = true; return; }                                            // (long dead: no burst of replacement guards)
  if (e.state !== 'unaware') e.last = { x: player.x, z: player.z };               // an alerted puppet had no idea where to go
  const bs = e.bs;
  if (!bs) return;
  e.mv = bs.mv = null; bs.nx = null; bs.combo = 0; e.teleOn = false; e.altT = undefined;
  if (e.dormant) return;
  const p = e.def.phases[bs.phase - 1];
  if (p) { bs.spd = (p.speedMul || 1) * (p.enrage || 1); bs.windMul = p.windMul || 1; bs.gcdMul = p.gcdMul || 1; }
  bs.st = 'chase';
  if (e.def.fly) { bs.hx = e.route[0].x; bs.hz = e.route[0].z; bs.hp0 = e.hp; bs.cyc = bossCyc(e, bs.air); bs.R = bossOrbitR(e); } else e.alt = 0;
}
coop.send = o => { if (coopS.link) coopS.link.send(o); };
// Host and Join exist only before the run has begun.
function coopBefore() { if (session.started) throw new Error('Co-op can only be started before a run begins.'); }
coop.hostInvite = async () => { coopBefore(); coopS.role = 0; return coopLink().createInvite(); };
coop.hostConnect = async code => { coopBefore(); if (!coopS.link) throw new Error('Create an invite first.'); return coopS.link.acceptAnswer(code); };
coop.join = async code => { coopBefore(); coopS.role = 1; return coopLink().join(code); };
coop.leave = () => { if (coopS.link) { const l = coopS.link; coopS.link = null; l.close(); if (coop.on) coopClosed('You left the co-op game.'); } };
// main.js begin(): a connected lobby waits for the host's Start; starting solo drops any half-made connection.
coop.beforeStart = () => { if (coop.on) { coopMenu.open(); return false; } coop.leave(); coopMenu.hide(); return true; };
function coopRunStart() { coopMenu.hide(); pauseMenu.close(); startRun(); }
coop.start = () => {                                                              // host only: both begin floor 1 together
  if (!coop.host || !coopS.ready || session.started) return false;
  coop.send({ k: 'start' }); coopRunStart();
  try { const p = canvas.requestPointerLock(); if (p) p.catch(() => {}); } catch (e) { /* no gesture: a click on the canvas takes it */ }
  return true;
};
coop.partner = coopS.rp;                                                           // for tests and the HUD

// ---- the avatar: one existing humanoid (a goblin), tinted by its skin colour, a name tag, and the usual limb animation. Not in `enemies`: no AI, no loot. ----
function coopAvatar() {
  if (coopS.av && coopS.avRole === coopS.role) return coopS.av;
  if (coopS.av) scene.remove(coopS.av.mesh);                                      // (hosted before, joined now: another name and colour)
  const idx = 1 - coopS.role;
  const e = new Enemy({ x: 0, y: 0, route: [{ x: 0, y: 0 }, { x: 0, y: 0 }], seed: 4242, type: 'goblin', skin: COOP.col[idx], noArms: true }, floor);
  nameTag(e, COOP.names[idx], COOP.hex[idx]);
  e.mesh.visible = false; scene.add(e.mesh); e.wait = 1e9;
  // what the partner holds: the weapon in the right hand, the shield and a zapped wand on the left
  e.hold = new THREE.Group(); e.hold.position.set(0, -0.62, -0.04); e.hold.rotation.x = -Math.PI / 2; e.arms[1].add(e.hold);
  e.off = new THREE.Group(); e.off.position.set(-0.14, -0.42, -0.14); e.arms[0].add(e.off);
  e.zapW = new THREE.Group(); e.zapW.position.set(0, -0.62, -0.04); e.zapW.rotation.x = -Math.PI / 2; e.zapW.visible = false; e.arms[0].add(e.zapW);
  e.lookKey = undefined; e.zapKind = '';
  coopS.avList[0] = e; coopS.avRole = coopS.role;
  return coopS.av = e;
}
// The weapon, shield and wand models are shared geometry: swapping them frees nothing.
function coopDress(av) {
  const L = coopS.look;
  if (av.lookKey === L) return;
  av.lookKey = L;
  while (av.hold.children.length) av.hold.remove(av.hold.children[0]);
  while (av.off.children.length) av.off.remove(av.off.children[0]);
  av.hold.add(buildWeaponModel(L ? L.w + (L.l ? ':limp' : '') : 'sword', L ? L.t : 0));
  if (L && L.s >= 0) { const sh = buildShieldMesh(L.s); sh.scale.setScalar(0.7); av.off.add(sh); }
}
// Poses on top of the usual limb animation (sync() resets them every frame): crouch, dash, zap, bow draw, block high or low.
function coopPose(av, rp) {
  const sy = av.scaleK * (rp.crouching && !rp.down ? 0.72 : 1);
  if (av.mesh.scale.y !== sy) av.mesh.scale.y = sy;
  const zap = rp.zap && !rp.down && !!coopS.zapKind;
  if (av.zapW.visible !== zap) av.zapW.visible = zap;
  if (zap && av.zapKind !== coopS.zapKind) { while (av.zapW.children.length) av.zapW.remove(av.zapW.children[0]); av.zapW.add(buildWeaponModel('wand:' + coopS.zapKind, 0)); av.zapKind = coopS.zapKind; }
  if (!rp.down) {
    const L = av.arms[0], R = av.arms[1];
    if (rp.dash) { av.upper.rotation.x = -0.6; L.rotation.x = R.rotation.x = -0.8; }
    else if (rp.zap) L.rotation.x = 1.5;
    else if (rp.draw) { L.rotation.x = 1.55; R.rotation.x = 1.45; }
    else if (rp.block) L.rotation.x = R.rotation.x = rp.pitch <= LOWGUARD.pitch ? 0.55 : 1.5;
  }
  av.off.rotation.x = -av.arms[0].rotation.x;                                     // the shield stays facing forward
}
function coopAvatarStep(dt, now) {
  const rp = coopS.rp, av = coopAvatar();
  av.floor = floor;
  const show = rp.on && floorNum > 0;
  if (av.mesh.visible !== show) av.mesh.visible = show;
  if (!show) return;
  const tr = coopS.avTrack.at(now - COOP.delay);
  av.x = tr.x; av.z = tr.z; av.yaw = tr.yaw; av.walkT += tr.speed * dt * 5;
  if (rp.down !== av.dead) { av.dead = rp.down; av.deadT = 0; if (rp.down) av.winding = false; }
  if (av.dead) av.deadT += dt;
  else if (rp.atk) { if (!av.winding) { av.winding = true; av.windT = 0; av.windT_ = TUNE.windup; av.zone = 'body'; } av.windT += dt; if (av.windT > av.windT_ + 0.5) av.windT = 0; }
  else av.winding = false;
  coopDress(av);
  av.sync(dt);
  coopPose(av, rp);
  const P = floor.prints;                                                         // the partner leaves footprints in the snow too
  if (P && !rp.down) {
    const d = Math.hypot(av.x - coopS.plx, av.z - coopS.plz);
    if (d >= theme.mechanic.TUNE.printGap) {
      if (d < 4) layPrint(P, -Math.sin(av.yaw), -Math.cos(av.yaw), av.x, av.z);
      coopS.plx = av.x; coopS.plz = av.z;
    }
  }
}
function coopDot(ctx, S) {                                                        // drawMinimap
  const rp = coopS.rp; if (!rp.on) return;
  ctx.fillStyle = COOP.hex[1 - coopS.role]; ctx.beginPath(); ctx.arc(rp.x / TILE * S, rp.z / TILE * S, 3.5, 0, 7); ctx.fill();
}

// ---- seeing what the partner does ----
coop.shot = a => coop.send({ k: 'pr', fk: coopFloorKey(), x: a.x, y: a.y, z: a.z, vx: a.vx, vy: a.vy, vz: a.vz, w: a.kind === 'wand' ? a.wand : undefined });
coop.stuck = a => { a.sid = ++coopS.sid; coop.send({ k: 'as', fk: coopFloorKey(), id: a.sid, x: a.x, z: a.z, yaw: a.mesh.rotation.y }); };
coop.unstuck = a => coop.send({ k: 'ag', fk: coopFloorKey(), id: a.sid });
coop.fx = (t, w, x, y, z, r) => coop.send({ k: 'fx', fk: coopFloorKey(), t, w, x, y, z, r });
coop.bell = (i, rang) => coop.send({ k: 'bt', fk: coopFloorKey(), i, r: rang });
coop.mover = (j, s) => coop.send({ k: 'mv', fk: coopFloorKey(), i: j, s });
coop.propState = o => coop.send({ k: 'ps', fk: coopFloorKey(), i: propObjs.indexOf(o) });
coop.recruited = () => coop.send({ k: 'al', fk: coopFloorKey() });
function coopGhostShot(m) {                                                       // drawn only: the shooter's machine decides what it hits
  if (arrows.length > 80) return;
  const wand = !!m.w, mesh = wand ? wandFxBolt(group, m.w) : makeArrowMesh();
  const a = { ghost: true, owner: 'player', stuck: false, x: m.x, y: m.y, z: m.z, vx: m.vx, vy: m.vy, vz: m.vz, life: wand ? WAND.range / WAND.speed : 4, mesh };
  if (wand) { a.kind = 'wand'; a.wand = m.w; a.wfx = true; a.gravity = 0; coopS.zapKind = m.w; } else group.add(mesh);
  mesh.position.set(a.x, a.y, a.z); mesh.lookAt(a.x + a.vx, a.y + a.vy, a.z + a.vz);
  arrows.push(a);
}
function coopGhostArrow(a, i, dt) {                                               // updateArrows
  if (a.stuck) return;
  const ev = stepArrow(a, dt, floor, enemies, player);
  a.life -= dt; a.mesh.position.set(a.x, a.y, a.z);
  if (a.kind === 'wand') wandBoltAnim(a.mesh, gameT); else a.mesh.lookAt(a.x + a.vx, a.y + a.vy, a.z + a.vz);
  const atMe = (a.x - player.x) ** 2 + (a.z - player.z) ** 2 < (player.radius + 0.1) ** 2 && a.y < player.eye + 0.2;
  if (!ev && !atMe && a.life > 0) return;
  if (a.kind === 'wand' && ev && ev.type !== 'hit') wandImpact(group, a.wand, a.px === undefined ? a.x : a.px, a.y, a.pz === undefined ? a.z : a.pz, 0.6);
  dropArrowMesh(a); arrows.splice(i, 1);
}
function coopStuckArrow(m) {
  let n = 0, old = -1;
  for (let i = 0; i < arrows.length; i++) if (arrows[i].ghost && arrows[i].stuck) { n++; if (old < 0) old = i; }
  if (n >= BOW.maxStuck) { group.remove(arrows[old].mesh); arrows.splice(old, 1); }
  const mesh = makeArrowMesh(); mesh.position.set(m.x, 0.05, m.z); mesh.rotation.set(0, m.yaw, 0); group.add(mesh);
  arrows.push({ ghost: true, owner: 'player', stuck: true, sid: m.id, x: m.x, y: 0.05, z: m.z, mesh });
}
// An enemy's status marks, alertness and attack zone as 15 bits; sent only when they change.
const COOP_ST = ['burn', 'freeze', 'slow', 'stun', 'stuck', 'bleed', 'cripple', 'daze'], COOP_ZONES = ['head', 'body', 'legs', 'shoot'];
const COOP_CALM = 1 << 13;                                                        // the mask of an enemy with nothing to show
function coopMask(e) {
  let m = 0;
  for (let i = 0; i < COOP_ST.length; i++) if (e.st.t[COOP_ST[i]] > 0) m |= 1 << i;
  if (e.rageT > 0) m |= 256;
  if (e.healFx > 0) m |= 512;
  if (e.fuse > 0) m |= 1024;
  const z = e.winding ? COOP_ZONES.indexOf(e.zone) : -1;
  return m | ((e.aware > 0.8 ? 3 : e.aware > 0.5 ? 2 : e.aware > 0.2 ? 1 : 0) << 11) | ((z < 0 ? 1 : z) << 13);
}
function coopUnmask(e, m) {                                                       // guest: the puppet's marks (its status timers never run)
  for (let i = 0; i < COOP_ST.length; i++) { if (m & (1 << i)) e.st.t[COOP_ST[i]] = 99; else delete e.st.t[COOP_ST[i]]; }
  e.rageT = m & 256 ? 1 : 0;
  if (m & 512 && !(e.stm & 512)) e.healFx = 0.7;
  e.fuse = m & 1024 ? (e.fuse > 0 ? e.fuse : BOMB.fuse) : -1;
  e.aware = [0, 0.35, 0.65, 1][(m >> 11) & 3];
  if (!e.bs) e.zone = COOP_ZONES[(m >> 13) & 3];
  e.stm = m;
}
// The partner's recruited ally: its idle NPC here becomes a puppet that follows the packets.
function coopAllyTaken() {
  const A = allyRun;
  if (!A || A.recruited || A.mode === 'gone' || A.f !== floor) return;
  A.mode = 'gone'; A.o.p.opened = true;
  const i = A.f.solids.indexOf(A.sol); if (i >= 0) A.f.solids.splice(i, 1);
  const j = propObjs.indexOf(A.o); if (j >= 0) propObjs.splice(j, 1);
  coopS.ally = A.e; coopS.allyTrack.n = 0; coopS.allyAt = -1e9;
  addLog(`${COOP.names[1 - coopS.role]} recruited the ${A.name}.`, '#7ad8ff');
}
function coopAllyStep(dt, now) {
  const e = coopS.ally; if (!e) return;
  const p = coopS.allyIn, on = now - coopS.allyAt < 1000 && p.floor === coopS.fk;
  if (!on) { if (e.mesh.parent) e.mesh.parent.remove(e.mesh); return; }
  if (e.mesh.parent !== group) group.add(e.mesh);                                 // it came down the stairs with them
  const tr = coopS.allyTrack.at(now - COOP.delay), dead = !!(p.flags & 1), wd = !!(p.flags & 2);
  e.floor = floor; e.x = tr.x; e.z = tr.z; e.yaw = tr.yaw; e.walkT += tr.speed * dt * 5; e.mesh.visible = true;
  if (dead !== e.dead) { e.dead = dead; e.deadT = 0; }
  if (dead) e.deadT += dt;
  if (wd) { if (!e.winding) e.windT = 0; e.windT += dt; }
  e.winding = wd; e.sync(dt); e.icon.visible = false;
}

// ---- per frame (state === 'play', coop.on) ----
coop.tick = function (dt) {
  const now = performance.now(), S = coopS, link = S.link, rp = S.rp;
  if (!link || !link.open) return;
  const fk = coopFloorKey();
  if (coop.guest) coopByNid(0);                                                   // (new floor: make its enemies puppets at once)
  if (fk !== S.fk) { S.plx = S.plz = 1e9; S.peerRevive = false; S.fk = fk; S.granted.clear(); S.claims.reset(); S.stairMe = S.stairPeer = false; S.avTrack.n = 0; rp.on = false; S.snapIn = -1; }
  if (coop.down && inv.hp > 0) inv.hp = 0;
  if (pulse > S.pulseMax) S.pulseMax = pulse;
  // send my state (20 Hz)
  if ((S.sT -= dt) <= 0) {
    S.sT = COOP.stateEvery;
    const p = S.ps;
    p.x = player.x; p.z = player.z; p.yaw = player.yaw; p.pitch = player.pitch; p.hp = inv.hp / inv.maxHp; p.floor = fk; p.seq = ++S.seq;
    p.flags = (player.crouching ? Net.F.CROUCH : 0) | (player.sprinting ? Net.F.SPRINT : 0) | (cb.atk || cb.bash > 0 ? Net.F.ATTACK : 0) | (coop.down ? Net.F.DOWN : 0) | (cb.block ? Net.F.BLOCK : 0) | (player.dashS.on ? Net.F.DASH : 0) | (cb.draw ? Net.F.DRAW : 0) | (cb.zap ? Net.F.ZAP : 0);
    p.noise = Math.max(player.noiseRadius * (player.crouching ? PD.crouchNoise : 1), S.pulseMax) * HUSH * PD.noiseMul; S.pulseMax = 0;
    p.speed = Math.hypot(player.vx, player.vz);
    link.sendState(Net.sendView(Net.packPlayer(p)));
    const w = inv.equip.weapon, sh = shield(), limp = !!w && isLimp(w);           // what I hold, sent only when it changes
    if (w && (w !== S.lkW || sh !== S.lkS || limp !== S.lkL)) { S.lkW = w; S.lkS = sh; S.lkL = limp; coop.send({ k: 'lk', w: w.base, t: w.tier | 0, s: sh ? sh.tier | 0 : -1, l: limp ? 1 : 0 }); }
    const A = allyRun;                                                            // my ally, if it is here with me
    if (A && A.recruited && A.mode !== 'gone' && A.f === floor) link.sendState(Net.sendView(Net.packAlly(fk, A.e.x, A.e.z, A.e.yaw, (A.e.dead ? 1 : 0) | (A.e.winding ? 2 : 0))));
  }
  if (coop.host) {
    if (rp.on && rp.noise > 0 && now - rp.noiseT < 400 && !rp.down) { const n = S.noiseEv; n.x = rp.x; n.z = rp.z; n.r = rp.noise; pending.push(n); }   // what the partner makes is heard by the guards (one reused event)
    if (S.ready && (S.nT -= dt) <= 0) { S.nT = COOP.snapEvery; coopSnapshot(fk); }
    if (floor.runes && (S.gtT -= dt) <= 0) { S.gtT = 2; coop.send({ k: 'gt', t: gameT }); }   // the rune circle flares by the clock: keep the clocks together
    const act = S.ready && rp.on;
    if (S.stairMe || S.stairPeer) { if (S.gate.step(dt, S.stairMe, S.stairPeer, !coop.down, act && !rp.down)) coopGo(); } else S.gate.t = 0;
  }
  coopAvatarStep(dt, now);
  coopAllyStep(dt, now);
  coopArrows();
  coopRevive(dt);
  coopHud(false, dt);
};

// ---- host: choose the target, run the AI, route the attack ----
coop.enemies = function (dt, noise) {
  const rp = coopS.rp, host = coop.host && rp.on && !rp.down;
  if (coop.guest) { coopPuppets(dt); return; }
  for (let i = 0; i < enemies.length; i++) {
    const e = enemies[i];
    let tgt = player;
    if (host && !e.dead) {
      const bst = e.bs && e.bs.st, free = !bst || bst === 'chase' || bst === 'idle' || bst === 'recover';   // a boss keeps its target through a move
      if ((e.pickT = (e.pickT || 0) - dt) <= 0 && free) { e.pickT = 0.25; e.pickR = coopPickRemote(e); }   // re-chosen 4 times a second, not every frame
      if (coop.down || e.pickR) tgt = rp;
    }
    if (e.boss) { e.other = tgt === rp ? (coop.down ? null : player) : host ? rp : null; e.otherHit = coopOtherHit; e.coopFx = coopBossFx; }   // its strikes test both
    coop.shotTgt = tgt === rp ? rp : null;
    const zone = e.update(dt, tgt, noise);
    if (zone) { if (tgt === rp) coopHitGuest(e, zone); else resolveEnemyAttack(e, zone); }
    if (e.dead && !e.sentDead && e.nid !== undefined) { e.sentDead = true; coop.send({ k: 'ed', n: e.nid, g: e.escaped ? 1 : 0 }); }
  }
  coop.shotTgt = null;
};
// A host enemy's blow landing on the guest: the move in play and its multiplier go along, so the guest resolves it exactly as in solo.
function coopHitGuest(e, zone) {
  if (e.nid !== undefined) coop.send({ k: 'eh', n: e.nid, z: zone, hm: e.hitMul || 1, mv: e.mv ? e.mv.id : '' });
  e.hitMul = 1;
}
// A boss strike that also caught the player it was not aiming at (js/boss.js bossOther).
function coopOtherHit(zone) {
  const hm = this.hitMul;
  if (this.other === coopS.rp) coopHitGuest(this, zone); else if (!coop.down) resolveEnemyAttack(this, zone);
  this.hitMul = hm;
}
// Boss floor hazards made on the host that the guest's floor needs too: the ice lane and the Fire Sweep's flame patches.
function coopBossFx(kind, mv, x, z) {
  if (kind === 'ln') coop.send({ k: 'ln', fk: coopFloorKey(), n: this.nid, mv: mv.id, x: this.x, z: this.z, yaw: this.yaw });
  else coop.send({ k: 'fl', fk: coopFloorKey(), x, z, r: mv.flame.r, dur: mv.flame.dur });
}
coop.shotSent = function (a, s) {                                                  // every enemy shot flies on the guest too, which decides whether it hits the guest
  if (!coopS.ready || !s.from || s.from.nid === undefined) return;
  coop.send({ k: 'sp', fk: coopFloorKey(), n: s.from.nid, kind: a.kind, x: a.x, y: a.y, z: a.z, vx: a.vx, vy: a.vy, vz: a.vz, dmg: a.dmg, ring: a.ring, mv: a.mv ? a.mv.id : '', tx: s.tx, tz: s.tz });
};
coop.summoned = function (e, boss) {
  e.nid = ++coopS.nextNid;
  if (coopS.byRef === enemies) coopS.byNid.set(e.nid, e);
  coop.send({ k: 'sm', fk: coopFloorKey(), n: e.nid, bn: boss.nid | 0, type: e.type, x: e.x, z: e.z, seed: e.seed });
};
coop.parried = function (e) { if (e.nid !== undefined) coop.send({ k: 'pa', n: e.nid }); };
const coopMove = (e, id) => e.def && id && Object.prototype.hasOwnProperty.call(e.def.byId, id) ? e.def.byId[id] : null;
function coopSendBoss(e, fk) {
  const bs = e.bs, o = coopS.bossOut, z = Net.ZONES.indexOf(e.zone), st = Net.BOSS_ST.indexOf(bs.st), mv = e.mv ? e.def.moves.indexOf(e.mv) : -1;
  o.floor = fk; o.seq = coopS.snapSeq; o.nid = e.nid; o.alt = e.alt; o.st = st < 0 ? 0 : st; o.mv = mv < 0 ? 255 : mv; o.zone = z < 0 ? 1 : z; o.air = bs.air; o.expAll = bs.expAll; o.cw = bs.cw;
  o.windT = e.windT; o.tx = bs.tx; o.tz = bs.tz; o.ox = bs.ox; o.oz = bs.oz; o.dx = bs.dx; o.dz = bs.dz; o.dl = bs.dl; o.exp = bs.exp; o.expMul = bs.expMul; o.lowT = bs.lowT; o.phase = bs.phase; o.stun = e.stun;
  coopS.link.sendState(Net.sendView(Net.packBoss(o)));
}
// guest: the boss's detail, then every frame its height, timers and floor marks
function coopBossState(dv) {
  const p = Net.unpackBoss(dv, coopS.bossIn);
  if (p.floor !== coopFloorKey()) return;
  const e = coopByNid(p.nid);
  if (!e || !e.bs || e.dead) return;
  const bs = e.bs, ph = e.def.phases[p.phase - 1];
  e.mv = bs.mv = e.def.moves[p.mv] || null; bs.st = Net.BOSS_ST[p.st]; e.zone = Net.ZONES[p.zone]; e.windT = p.windT; e.altT = p.alt; e.stun = p.stun;
  bs.air = p.air; bs.cw = p.cw; bs.tx = p.tx; bs.tz = p.tz; bs.ox = p.ox; bs.oz = p.oz; bs.dx = p.dx; bs.dz = p.dz; bs.dl = p.dl; bs.exp = p.exp; bs.expMul = p.expMul; bs.expAll = p.expAll; bs.lowT = p.lowT;
  bs.phase = p.phase; bs.windMul = ph && ph.windMul || 1;
}
function coopBossStep(e, dt) {
  const bs = e.bs, mv = e.mv, st = bs.st;
  if (e.altT !== undefined) e.alt += (e.altT - e.alt) * Math.min(1, dt * 14);
  if (bs.exp > 0) bs.exp -= dt;
  if (bs.lowT > 0) bs.lowT -= dt;
  const wind = st === 'telegraph' || st === 'attack';
  if (mv && (mv.ground || mv.tele) && (wind || st === 'spin' || st === 'sweep' || (st === 'special' && (mv.shape === 'leap' || mv.shape === 'dive')))) { bossTeleDraw(e, mv, wind ? Math.min(1, e.windT / e.windT_) : 1); e.teleOn = true; }
  else if (e.teleOn) { bossTeleHide(); e.teleOn = false; }
}

// Which player a guard goes for: the nearer one, a player it has no line of sight to counting as 30 m farther (so either one in view is noticed).
function coopPickRemote(e) {
  const rp = coopS.rp;
  const a = Math.hypot(e.x - player.x, e.z - player.z), b = Math.hypot(e.x - rp.x, e.z - rp.z);
  if (a > 40 && b > 40) return b < a;                                             // far from both: no sight checks
  return b + (hasLOS(floor, e.x, e.z, rp.x, rp.z) ? 0 : 30) < a + (hasLOS(floor, e.x, e.z, player.x, player.z) ? 0 : 30);
}
function coopSnapshot(fk) {
  const rp = coopS.rp, R2 = COOP.snapR * COOP.snapR, E = Net.E, S = Net.STATES;
  Net.snapBegin(fk, ++coopS.snapSeq);
  for (let i = 0; i < enemies.length; i++) {
    const e = enemies[i];
    if (e.nid === undefined || (e.dead && (e.deadT > 3 || e.exploded || e.escaped))) continue;   // (a blast or an escape arrives as its own message)
    const dx = e.x - player.x, dz = e.z - player.z;
    if (!e.boss && dx * dx + dz * dz > R2) { const rx = e.x - rp.x, rz = e.z - rp.z; if (!rp.on || rx * rx + rz * rz > R2) continue; }
    if (!e.dead) { const m = coopMask(e); if (m !== (e.stm === undefined ? COOP_CALM : e.stm)) { e.stm = m; coop.send({ k: 'es', fk, n: e.nid, m }); } }
    const si = S.indexOf(e.state);
    if (!Net.snapAdd(e.nid, e.x, e.z, e.yaw, (si < 0 ? 0 : si) | (e.dead ? E.DEAD : 0) | (e.stun > 0 ? E.STUN : 0) | (e.winding ? E.WIND : 0) | (e.seen ? E.SEEN : 0) | (e.dormant ? E.DORM : 0) | (e.sleepT > 0 ? E.SLEEP : 0), e.hp / e.maxHp)) break;
  }
  coopS.link.sendState(Net.sendView(Net.snapEnd()));
  for (let i = 0; i < enemies.length; i++) { const e = enemies[i]; if (e.bs && !e.dead && e.nid !== undefined) coopSendBoss(e, fk); }
}
// ---- guest: enemies are puppets of the host's snapshots, 100 ms in the past ----
function coopByNid(n) {
  const S = coopS;
  if (S.byRef !== enemies) { S.byRef = enemies; S.byNid.clear(); for (const e of enemies) { if (e.nid !== undefined) S.byNid.set(e.nid, e); if (coop.guest) coopMakePuppet(e); } }
  return S.byNid.get(n);
}
// A guest's enemy can never be hurt, statused or killed here, whatever code path tries (blasts, clouds, an ally, anything added later):
// player-made damage is sent to the host by its own hook (dealHit, bash, applyWand, playRage); the rest the host already simulates.
function coopPuppetHurt(dmg, src) {
  if (src && src === Enemy.ally) coop.hit(this, dmg, 'body', false, false, null);   // the guest's recruited ally exists only here, so its blows are claimed too
  this.hitT = 0.14;
  return false;
}
const coopNo = () => false;
function coopMakePuppet(e) { e.hurt = coopPuppetHurt; e.addStatus = coopNo; e.sleep = coopNo; e.enrage = coopNo; }
function coopPuppets(dt) {
  const t = performance.now() - COOP.delay;
  for (let i = 0; i < enemies.length; i++) {
    const e = enemies[i], tr = e.net;
    if (e.dead) { e.deadT += dt; e.sync(dt); continue; }
    if (tr) { tr.at(t); e.x = tr.x; e.z = tr.z; e.yaw = tr.yaw; e.walkT += tr.speed * dt * 5; }
    if (e.winding) e.windT += dt;
    if (e.fuse > 0.05) e.fuse -= dt;                                               // a lit bomb flashes
    if (e.bs) coopBossStep(e, dt);
    e.sync(dt);
  }
}
function coopKill(e) { if (e.dead) return; e.hp = 0; e.cause = 'died'; e.die(); }
function coopGuestHit(e, zone, dmg, sneak, guarded, w, noise) {                    // the guest's dealHit: feedback here, the damage happens on the host
  const pr = w && w.proc, proc = pr && pr.zone === zone && gameRng() < pr.chance ? pr : null;
  coop.hit(e, dmg, zone, sneak, !(w && w.ranged), proc);
  e.hitT = 0.14;                                                                  // a local flinch; the host's snapshot sets the real hp
  Sfx.play('hit'); Sfx.play('ehurt'); if (noise) loud(noise);
  mark(`${zone.toUpperCase()}${sneak ? ' SNEAK' : ''}${guarded ? ' GUARDED' : ''} ${Math.round(dmg)}${proc ? ' +' + STATUS[pr.status].name.toUpperCase() : ''}`, zone === 'head' ? '#ff9a3a' : '#fff');
}
coop.hit = function (e, dmg, zone, sneak, melee, proc) {
  if (e.nid === undefined) return;
  coop.send({ k: 'hit', n: e.nid, d: Math.round(dmg * 10) / 10, z: zone, sn: sneak ? 1 : 0, m: melee ? 1 : 0, ps: proc ? proc.status : 0, pd: proc ? proc.dur : 0 });
};

// ---- what else a guest does to the world is asked of the host ----
coop.wand = function (kind, e) {
  wandImpact(group, kind, e.x, Math.max(0.3, Math.min(1.5, (e.T.height || 1.7) * 0.6 * (e.scaleK || 1))) + (e.alt || 0), e.z);
  if (e.nid !== undefined) coop.send({ k: 'wz', n: e.nid, w: kind });
};
coop.rage = function () { coop.send({ k: 'rg' }); return rageVictims(enemies, player.x, player.z); };   // (the list only words the message)
coop.mimicWake = function (o) { coop.send({ k: 'mw', fk: coopFloorKey(), i: propObjs.indexOf(o) }); };
coop.requestLoot = function (o, smashed, unlocked, sprung) {                     // a chest, barrel, shelf...: the host rolls and hands out its contents
  const now = performance.now();
  if (now - (o.asked || -1e9) < 1500) return;
  o.asked = now; o.wasLocked = unlocked;
  coop.send({ k: 'se', fk: coopFloorKey(), i: propObjs.indexOf(o), u: unlocked ? 1 : 0, s: smashed ? 1 : 0, t: sprung ? 1 : 0 });
};
coop.blast = function (src, x, z) { if (src.nid !== undefined) coop.send({ k: 'bl', n: src.nid, x, z }); };
const coopLootable = o => o.p.kind !== 'door' && o.p.kind !== 'merchant' && o.p.kind !== 'altar' && o.p.kind !== 'prayer' && o.p.kind !== 'questnpc';
const coopNearProp = o => coopS.rp.on && Math.hypot(coopS.rp.x - o.x, coopS.rp.z - o.z) < 8;
// host: the guest searched a container. The host alone owns its contents, so it can be emptied only once.
function coopGrant(m) {
  const o = propObjs[m.i];
  if (!o || !coopLootable(o) || o.p.opened || o.p.busy || o.p.mimic || (o.p.locked && !m.u) || !coopNearProp(o)) { coop.send({ k: 'sg', fk: m.fk, i: m.i, no: 1 }); return; }
  if (o.p.locked) { o.p.locked = false; o.p.grade = LOCKED.gradeUp; dropTell(o); }
  if (o.p.trap) {
    const kind = o.p.trap; o.p.trap = null; dropTell(o);
    if (m.t && kind === 'gas') for (const e of enemies) if (!e.dead && Math.hypot(e.x - o.x, e.z - o.z) < TRAP.gasRadius && hasLOS(floor, o.x, o.z, e.x, e.z)) { e.addStatus('daze', TRAP.gasDaze); e.addStatus('slow', TRAP.gasSlow); }
  }
  let d = propDrops(o);
  if (m.s && !o.p.left) d = breakPotions(d);
  o.p.busy = true; o.grant = d;
  coop.send({ k: 'sg', fk: m.fk, i: m.i, d });
}
// guest: the contents arrived. What does not fit is reported back and stays in the container.
function coopTake(m) {
  const o = propObjs[m.i];
  if (!o) return;
  if (m.no) { if (o.wasLocked) o.p.locked = true; return; }
  const got = [], left = [];
  let quiver = false;
  m.d.forEach((d, j) => { if (!d) return; const t = inv.add(d); if (t) got.push(t); else if (d.type === 'arrows') quiver = true; else left.push(j); });
  coop.send({ k: 'sr', fk: m.fk, i: m.i, left });
  o.asked = -1e9; o.wasLocked = false;
  if (got.length) Sfx.play('pickup');
  flash((got.length ? 'Found ' + got.join(', ') : left.length ? '' : 'Nothing useful') + (left.length ? ` (pack full, ${left.length} left behind)` : quiver ? ' (quiver full)' : ''));
}

// ---- friendly fire ----
// melee: the partner's avatar is a target like any guard; the swing hits whichever is nearer. Returns true when the partner took it.
coop.melee = function (t, w) {
  const S = coopS, rp = S.rp;
  if (!rp.on || rp.down || w.ranged || !S.av || !S.av.mesh.visible) return false;
  const r = findMeleeTarget(player, eyeY(), S.avList, floor, w.reach);
  if (!r || !r.zone || (t && t.e && t.dist <= r.dist)) return false;
  const dmg = w.dmg * Math.min(TUNE.damageCap, ZONE_MUL[r.zone]) * (inv.buffs.might > 0 ? 1.4 : 1) * PD.dmgMul;
  coopFriendly(Net.ffDamage(dmg, TUNE.coopFF), r.zone);
  if (w.noise) loud(w.noise);
  return true;
};
function coopFriendly(d, zone) {
  coop.send({ k: 'ff', d: Math.round(d * 10) / 10, z: zone });
  coopS.av.hitT = 0.14; Sfx.play('hit'); mark(`FRIENDLY FIRE ${Math.round(d)}`, '#ff6a4a'); addLog(`You hit ${COOP.names[1 - coopS.role]}!`, '#ff6a4a');
}
function coopArrows() {                                                           // my arrows and wand bolts against the partner (cheap: a handful of arrows at most)
  const S = coopS, av = S.av, rp = S.rp;
  if (!arrows.length || !rp.on || rp.down || !av || !av.mesh.visible) return;
  for (let i = arrows.length - 1; i >= 0; i--) {
    const a = arrows[i];
    if (a.stuck || a.ghost) continue;
    const dx = a.x - av.x, dz = a.z - av.z;
    if (a.owner !== 'player') {                                                    // an enemy's arrow or bolt that struck the partner stops there (looks only; not one that is also at me)
      if (!a.pool && a.ring < 0 && !(a.mv && a.mv.puddle) && dx * dx + dz * dz < av.r * av.r && a.y < 1.8 && (a.x - player.x) ** 2 + (a.z - player.z) ** 2 > 1.4) { dropArrowMesh(a); arrows.splice(i, 1); }
      continue;
    }
    if (dx * dx + dz * dz > (av.r + 0.05) * (av.r + 0.05)) continue;
    const zone = zoneAtHeight(a.y, av); if (!zone) continue;
    const base = a.kind === 'wand' ? (WANDS[a.wand].dmg || 8) : a.dmg * Math.min(TUNE.damageCap, ZONE_MUL[zone]) * PD.dmgMul;
    if (a.kind === 'wand') wandFxRelease(a.mesh); else group.remove(a.mesh);
    arrows.splice(i, 1);
    coopFriendly(Net.ffDamage(base, TUNE.coopFF), zone);
  }
}

// ---- down, revive, end ----
coop.downed = function () {                                                       // called by damage() at 0 HP: true = down (the partner can revive), false = the run is over
  const S = coopS;
  if (S.rp.down || !S.link || !S.link.open) { coop.send({ k: 'end' }); coopCloseScreens(); return false; }
  coop.down = true; inv.hp = 0; cb.atk = null; cb.draw = null; cb.eat = null; cb.zap = null; player.vx = player.vz = 0; player.dashS.on = false; knock.m = 0;
  coop.send({ k: 'dn' });
  flash('You are down! Your partner can revive you (hold interact).');
  return true;
};
function coopEnd() {
  if (state === 'dead' || state === 'won') return;
  coopCloseScreens(); state = 'dead'; coop.down = false; document.exitPointerLock();
  hud.overlayText.innerHTML = `<h1>You both fell on stage ${stage}, floor ${floorNum}</h1><p>Click to start a new run.</p>`; hud.overlay.style.display = 'flex';
}
const coopNearBody = () => coopS.rp.on && coopS.rp.down && !coop.down && Math.hypot(coopS.rp.x - player.x, coopS.rp.z - player.z) < 2.2;
function coopRevive(dt) {
  const S = coopS, rp = S.rp;
  const near = coopNearBody(), holding = near && !!player.keys[KEYS.interact];
  if (holding !== S.reviving) { S.reviving = holding; coop.send({ k: 'rp', v: holding ? 1 : 0 }); }
  S.mine.step(dt, coop.down && S.peerRevive);                                     // the downed player sees the progress too
  if (S.revive.step(dt, holding)) {
    rp.down = false; coop.send({ k: 'rv' }); addLog(`You revived ${COOP.names[1 - S.role]}.`, '#9aff9a');
  }
  if (!near && S.revive.t > 0) S.revive.step(dt, false);
}
function coopRevived() {
  coopS.peerRevive = false; coopS.mine.t = 0; coop.down = false; inv.hp = inv.maxHp * TUNE.coopReviveHp; cb.iframe = 1.5; knock.m = 0;
  flash('Your partner revived you.');
}

// ---- stairs: both take them together; one waiting pulls the other along after TUNE.coopStairWait seconds ----
coop.stairs = function () {
  if (!stairBox) return true;
  const S = coopS;
  if (upProgress() > 0.25) { player.z = upBox.dir > 0 ? upBox.z1 + 0.45 : upBox.z0 - 0.45; player.vz = 0; sealedUp(); return true; }   // no going back in co-op
  const b = stairBox, on = stairProgress() > 0.25;
  if (on) {
    player.z = b.z0 - 0.45; player.vz = 0;
    if (!S.stairMe) { S.stairMe = true; flash('Waiting for your partner at the stairs...'); coopStairSend(); }
  } else if (S.stairMe && Math.hypot(player.x - (b.x0 + b.x1) / 2, player.z - b.z0) > 2.5) { S.stairMe = false; coopStairSend(); }
  return true;
};
function coopStairSend() { coop.send({ k: 'sa', v: coopS.stairMe ? 1 : 0 }); }
function coopGo() {                                                               // host decided: both go (the guest gets the message and does the same)
  coop.send({ k: 'go', fk: coopFloorKey() });
  coopDoGo();
}
function coopDoGo() {
  const S = coopS, hadDown = coop.down || S.rp.down;
  S.stairMe = S.stairPeer = false; S.gate.t = 0; S.rp.on = false;
  if (coop.down) coopRevived();
  S.rp.down = false;
  if (hadDown) addLog('Everyone is back on their feet on the new floor.', '#9aff9a');
  if (floorNum < MAX_FLOOR && stage !== FINAL_STAGE) changeFloor(floorNum + 1, 'down'); else enterNextStage();
  if (coop.guest) coopByNid(0);
}

// ---- XP: a kill pays each player within range ----
coop.share = function (e, base, exempt) {                                         // host only (the guest never awards kills); true = the host gets it too
  const S = coopS, rp = S.rp, R = TUNE.coopXpRange;
  if (!coop.host) return true;
  if (e.boss) { coop.send({ k: 'xp', b: base, ex: exempt ? 1 : 0 }); return true; }   // an arena is big: a boss pays both wherever they stand
  if (rp.on && Net.xpInRange(rp.x - e.x, rp.z - e.z, R)) coop.send({ k: 'xp', b: base, ex: exempt ? 1 : 0 });
  return Net.xpInRange(player.x - e.x, player.z - e.z, R) || !rp.on;
};
coop.bossDown = function (e) { coop.send({ k: 'bd', f: e.final ? 1 : 0 }); };

// ---- floor drops: the host decides who gets what ----
const coopDropIdx = id => { const S = floor.items; if (!S) return -1; for (let i = 0; i < S.list.length; i++) if (S.list[i].id === id) return i; return -1; };
coop.dropMade = function (it) {
  if (!coopS.ready || !coopS.link || !coopS.link.open) return;
  coop.send({ k: 'dr', f: coopS.putBack ? 1 : 0, fk: coopFloorKey(), id: it.id, d: it.d, x: Math.round(it.x * 100) / 100, z: Math.round(it.z * 100) / 100, q: it.q ? 1 : 0 });
};
coop.pickup = function (it) {                                                     // true: this machine may take it now
  if (coop.host) return coopS.claims.claim(it.id, 0);
  const now = performance.now();
  if (it.pend && now - it.pendT < 1500) return false;
  it.pend = true; it.pendT = now; coop.send({ k: 'dc', id: it.id, fk: coopFloorKey() });
  return false;
};
coop.pickedUp = function (it) { if (coop.host) coop.send({ k: 'dg', id: it.id }); };
coop.pickFail = function (it) { if (coop.host) coopS.claims.release(it.id); };
coop.opened = function (o) {
  const i = propObjs.indexOf(o);
  if (i >= 0) coop.send({ k: 'op', fk: coopFloorKey(), i, d: o.p.kind === 'door' ? 1 : 0 });
};

// ---- incoming ----
function coopState(dv) {                                                          // the unreliable channel
  if (!Net.packetOk(dv)) return;
  const S = coopS, k = Net.kindOf(dv), now = performance.now();
  if (k === Net.T_PLAYER) {
    const p = Net.unpackPlayer(dv, S.pu), rp = S.rp;
    if (((p.seq - S.avSeq) & 65535) > 32768 && S.avSeq >= 0) return;               // an old packet overtaken by a newer one
    S.avSeq = p.seq;
    if (p.floor !== S.fk) { rp.on = false; return; }
    if (rp.on && p.hp < rp.hp - 0.01 && S.av) S.av.hitT = 0.14;                     // the partner is being hurt: they flash
    rp.block = !!(p.flags & Net.F.BLOCK); rp.dash = !!(p.flags & Net.F.DASH); rp.draw = !!(p.flags & Net.F.DRAW); rp.zap = !!(p.flags & Net.F.ZAP);
    rp.on = true; rp.x = p.x; rp.z = p.z; rp.yaw = p.yaw; rp.pitch = p.pitch; rp.hp = p.hp; rp.atk = !!(p.flags & Net.F.ATTACK);
    rp.crouching = !!(p.flags & Net.F.CROUCH); rp.sprinting = !!(p.flags & Net.F.SPRINT);
    rp.vx = -Math.sin(p.yaw) * p.speed; rp.vz = -Math.cos(p.yaw) * p.speed; rp.noise = p.noise; rp.noiseRadius = p.noise; rp.noiseT = now; rp.tileX = Math.floor(p.x / TILE); rp.tileY = Math.floor(p.z / TILE);
    S.avTrack.push(now, p.x, p.z, p.yaw);
  } else if (k === Net.T_ALLY) {
    const p = Net.unpackAlly(dv, S.allyIn);
    if (p.floor === S.fk) { S.allyAt = now; S.allyTrack.push(now, p.x, p.z, p.yaw); }
  } else if (k === Net.T_BOSS) {
    if (coop.guest) coopBossState(dv);
  } else if (k === Net.T_SNAP && coop.guest) {
    const h = Net.snapHead(dv, S.sh);
    if (h.floor !== coopFloorKey() || ((h.seq - S.snapIn) & 65535) > 32768 && S.snapIn >= 0) return;
    S.snapIn = h.seq;
    const E = Net.E, ST = Net.STATES, se = S.se;
    for (let i = 0; i < h.n; i++) {
      Net.snapAt(dv, i, se);
      const e = coopByNid(se.nid); if (!e) continue;
      const tr = e.net || (e.net = new Net.Track()); tr.push(now, se.x, se.z, se.yaw);
      const f = se.flags;
      if (e.boss && e.dormant && !(f & E.DORM)) e.justWoke = true;
      e.state = ST[f & 3]; e.seen = !!(f & E.SEEN); e.dormant = !!(f & E.DORM); e.sleepT = f & E.SLEEP ? 1 : 0; e.stun = f & E.STUN ? 1 : 0;
      const wd = !!(f & E.WIND); if (wd && !e.winding && !e.bs) e.windT = 0; e.winding = wd;
      if (e.propObj && !e.dormant && !e.propObj.p.opened) { e.propObj.p.opened = true; e.propObj.r = 0; }   // a woken mimic is no chest
      const hp = se.hp * e.maxHp; if (hp < e.hp - 0.5) e.hitT = 0.14; e.hp = hp;
      if (f & E.DEAD) coopKill(e);
    }
  }
}
function coopMsg(raw) {                                                           // the reliable channel
  const S = coopS, rp = S.rp;
  const m = Net.cleanMsg(raw, S.role === 0 ? 'guest' : 'host', coopTables());       // untrusted: only checked fields get through
  if (!m) return;
  switch (m.k) {
    case 'hello': {                                                               // guest: play the host's run
      if (S.ready || session.started) return;                                     // only ever in the lobby, before the run
      setRunSeed(m.seed); startStage(1);                                          // both begin at floor 1
      coopByNid(0); S.fk = -1; S.ready = true; coop.send({ k: 'ready' });
      if (coopMenu) coopMenu.joined(); break;
    }
    case 'ready': S.ready = true; if (coopMenu) coopMenu.ready(); break;
    case 'start': if (S.ready && !session.started) { coopRunStart(); flash('The host started the run. Click to take the mouse.'); } break;
    case 'pr': if (m.fk === coopFloorKey()) coopGhostShot(m); break;
    case 'as': if (m.fk === coopFloorKey() && arrows.length <= 120) coopStuckArrow(m); break;
    case 'ag': { const i = arrows.findIndex(a => a.ghost && a.sid === m.id); if (i >= 0) { group.remove(arrows[i].mesh); arrows.splice(i, 1); } break; }
    case 'fx':
      if (m.fk !== coopFloorKey()) return;
      if (m.t === 0) wandImpact(group, m.w, m.x, m.y, m.z, m.r || 1); else if (m.t === 1) wandRing(group, m.w, m.x, m.z, m.r, m.w === 'rage' ? 0.7 : 0.35); else showGas(m.x, m.z);
      break;
    case 'es': { const e = m.fk === coopFloorKey() && coopByNid(m.n); if (e && !e.dead) coopUnmask(e, m.m); break; }
    case 'ps': { const o = m.fk === coopFloorKey() && propObjs[m.i]; if (o && o.p.kind === 'chest') { o.p.locked = false; o.p.trap = null; dropTell(o); } break; }
    case 'bt': {
      if (m.fk !== coopFloorKey() || floor.patches.get(m.i) !== 'bell') return;
      floor.patches.delete(m.i);
      const x = m.i % floor.w, y = Math.floor(m.i / floor.w), bo = decorObjs.find(o => o.kind === 'bell' && o.p.x === x && o.p.y === y);
      if (bo) bo.mesh.visible = false;
      if (m.r) { addLog(`DING! ${COOP.names[1 - S.role]} rang a tripwire bell.`, '#d8a030'); if (coop.host) pending.push({ x: (x + 0.5) * TILE, z: (y + 0.5) * TILE, r: 14 }); }
      break;
    }
    case 'mv': {                                                                  // guest: a shelf starts to slide
      const sm = floor.movers && floor.movers[m.i];
      if (m.fk !== coopFloorKey() || !sm || !floor.moverMesh) return;
      if (sm.k !== m.s) {                                                         // out of step: put it where the host has it
        for (let i = 0; i < 4; i++) floor.tiles[moverTile(sm, i)] = i >> 1 === m.s ? T_WALL : T_FLOOR;
        sm.k = m.s; sm.sliding = false; posMover(sm, m.i, 0);
        const im = floor.moverMesh.instanceMatrix; im.updateRange.offset = floor.moverBase * 16; im.updateRange.count = floor.movers.length * 32; im.needsUpdate = true;
      }
      if (!sm.sliding) { sm.t = theme.mechanic.TUNE.shelfEvery - theme.mechanic.TUNE.shelfSlide; sm.go = 1; }
      break;
    }
    case 'gt': gameT = m.t; break;
    case 'lk': S.look = m; break;
    case 'al': if (m.fk === coopFloorKey()) coopAllyTaken(); break;
    case 'rp': S.peerRevive = !!m.v; break;
    case 'hit': {                                                                 // host: the guest hit one of its enemies
      if (!coop.host) return;
      const e = coopByNid(m.n);
      if (!e || e.dead) return;
      if (m.m && !Net.meleeOk(Math.hypot(rp.x - e.x, rp.z - e.z), 7)) return;      // loose range check on melee (a spear reaches about 7 m)
      const killed = e.hurt(m.d, rp);
      if (killed) { if (e.boss) bossDefeated(e); else makeCorpse(e, !!m.sn); }
      else if (m.ps) e.addStatus(m.ps, m.pd);
      break;
    }
    case 'wz': {                                                                  // host: the guest's wand bolt reached an enemy
      const e = coopByNid(m.n);
      if (!e || e.dead || Math.hypot(rp.x - e.x, rp.z - e.z) > WAND.range + 4) return;
      coop.src = rp; try { applyWand(m.w, e); } finally { coop.src = null; }
      break;
    }
    case 'rg': {                                                                  // host: the guest played Hanahan's Rage
      const now = performance.now();
      if (now - S.rageAt < RAGE.cd * 800) return;
      S.rageAt = now; wandRing(group, 'rage', rp.x, rp.z, RAGE.radius, 0.7);
      for (const e of rageVictims(enemies, rp.x, rp.z)) e.enrage(RAGE.dur, rp.x, rp.z);
      break;
    }
    case 'mw': {                                                                  // host: the guest opened a mimic
      const o = propObjs[m.i];
      if (m.fk !== coopFloorKey() || !o || !o.p.mimic || !o.mimic || !o.mimic.dormant || !coopNearProp(o)) return;
      o.mimic.wake(true, rp); o.mimic.yaw = Math.atan2(-(rp.x - o.mimic.x), -(rp.z - o.mimic.z));
      break;
    }
    case 'se': if (m.fk === coopFloorKey()) coopGrant(m); break;
    case 'sg': if (m.fk === coopFloorKey()) coopTake(m); break;
    case 'sr': {                                                                  // host: what the guest could not carry stays
      const o = propObjs[m.i];
      if (m.fk !== coopFloorKey() || !o || !o.p.busy) return;
      const left = m.left.map(j => o.grant[j]).filter(Boolean);
      o.p.busy = false; o.grant = null;
      if (left.length) o.p.left = left; else { markOpened(o); coop.opened(o); }
      break;
    }
    case 'bl': { const e = coopByNid(m.n); if (e) { e.exploded = true; if (e.mesh.parent) e.mesh.parent.remove(e.mesh); } explodeAt(m.x, m.z, e || null); break; }   // guest: a goblin blew itself up
    case 'eh': {                                                                  // guest: a host enemy's blow landed on you
      const e = coopByNid(m.n); if (!e || coop.down) break;
      if (e.bs) e.mv = e.bs.mv = coopMove(e, m.mv);
      e.hitMul = m.hm; resolveEnemyAttack(e, m.z); break;
    }
    case 'sp': {                                                                  // guest: a shot was loosed
      const e = coopByNid(m.n); if (!e || m.fk !== coopFloorKey() || arrows.length > 80) break;
      const mv = coopMove(e, m.mv);
      if (m.ring >= 0 && !(mv && mv.r)) break;
      if (spawnEnemyShot({ from: e, kind: m.kind, x: m.x, y: m.y, z: m.z, speed: 12, tx: m.tx, tz: m.tz, dmg: m.dmg, mv, ring: m.ring, vel: [m.vx, m.vy, m.vz] }) && m.ring >= 0) bossTeleShow(m.ring, 'disc', m.tx, m.tz, 0, mv.r, mv.r);
      break;
    }
    case 'ln': { const e = coopByNid(m.n), mv = e && coopMove(e, m.mv); if (m.fk === coopFloorKey() && mv && mv.lane) bossLaneAdd({ x: m.x, z: m.z, yaw: m.yaw }, mv); break; }
    case 'fl': if (m.fk === coopFloorKey()) bossFlameAdd(m.x, m.z, m.r, m.dur); break;
    case 'cl': if (m.fk === coopFloorKey()) spawnCloud(m.x, m.z, m.r, m.dur, m.daze, true); break;
    case 'sm': {                                                                  // guest: a boss called help
      if (m.fk !== coopFloorKey() || coopByNid(m.n) || enemies.length > 200) break;
      const tx = Math.floor(m.x / TILE), ty = Math.floor(m.z / TILE);
      const e = new Enemy({ x: tx, y: ty, route: [{ x: tx, y: ty }, { x: tx, y: ty }], seed: m.seed, type: m.type }, floor);
      e.x = m.x; e.z = m.z; e.minion = coopByNid(m.bn) || true; e.nid = m.n; e.last = { x: m.x, z: m.z }; e.set('alerted');
      coopMakePuppet(e); e.cone.visible = dev.on; group.add(e.mesh); enemies.push(e); S.byNid.set(m.n, e); e.sync(0);
      break;
    }
    case 'pa': {                                                                  // host: the guest parried one of its enemies
      const e = coopByNid(m.n);
      if (e && !e.dead && Math.hypot(rp.x - e.x, rp.z - e.z) < 16) { e.stun = 1.0; e.winding = false; e.atkCd = 0.6; }
      break;
    }
    case 'ff': {                                                                  // the partner hit you
      if (coop.down) break;
      const n = m.d * (1 - inv.armorRed(m.z));
      addLog(`${COOP.names[1 - S.role]} hit you for ${Math.round(n)}!`, '#ff6a4a'); damage(n);
      break;
    }
    case 'ed': {
      const e = coopByNid(m.n); if (!e || !coop.guest) break;
      if (!m.g) coopKill(e);
      else if (!e.dead) { e.escaped = e.dead = e.corpseDone = true; e.icon.visible = false; questThiefEscaped(e); }   // the sack thief got away
      break;
    }
    case 'xp': gainXp(m.b, !!m.ex); break;
    case 'bd': {
      if (!coop.guest) return;
      bossDead[stage] = true;
      if (m.f) { flash('The Cinder Wyrm falls! The chamber goes quiet.'); clearTimeout(winTimer); winTimer = setTimeout(() => { if (state === 'play') finishRun(); }, 2500); }
      else { flash('The boss falls! A hidden door in the north wall grinds open.'); if (floor.safe) openSafeDoor(); }
      break;
    }
    case 'dr': {                                                                  // guest: a drop appeared
      if (m.fk !== coopFloorKey() || coopDropIdx(m.id) >= 0) return;
      dropSpawn(m.d, m.x - 0.25, m.z, !!m.q, () => 0);                            // (rng 0: it lands exactly at x, z)
      const L = floor.items.list, it = L[L.length - 1]; it.id = m.id; if (floor.items.seq < m.id) floor.items.seq = m.id;
      if (m.f) { it.fail = true; it.cd = DROPS.retry; }                           // put back because my pack was full: retry only on holding interact
      break;
    }
    case 'dc': {                                                                  // host: the guest wants a drop. First claim wins.
      if (m.fk !== coopFloorKey()) return;
      const i = coopDropIdx(m.id);
      if (i < 0 || !Net.meleeOk(Math.hypot(floor.items.list[i].x - rp.x, floor.items.list[i].z - rp.z), DROPS.pick) || !coopS.claims.claim(m.id, 1)) { coop.send({ k: 'dg', id: m.id, no: 1 }); return; }
      const it = floor.items.list[i]; dropRemove(floor.items, i); S.granted.set(m.id, { d: it.d, q: it.q }); coop.send({ k: 'dy', id: m.id, d: it.d });
      break;
    }
    case 'dy': {                                                                  // guest: it is yours
      const i = coopDropIdx(m.id); if (i >= 0) dropRemove(floor.items, i);
      const text = inv.add(m.d);
      if (text) { flash('Found ' + text); Sfx.play('pickup'); } else { flash('Pack full: it stays on the floor'); coop.send({ k: 'du', id: m.id }); }
      break;
    }
    case 'du': {                                                                  // host: the guest's pack was full, put it back down where they stand
      const g = S.granted.get(m.id); if (!g) return;                             // only something the host itself handed over, and only once
      S.granted.delete(m.id);
      S.rng = S.rng || makeRng(0x5eed); S.putBack = true; dropSpawn(g.d, rp.x, rp.z, g.q, S.rng); S.putBack = false;
      break;
    }
    case 'dg': {                                                                  // a drop is gone (taken), or (no: 1) the host refused my claim
      const i = coopDropIdx(m.id); if (i < 0) break;
      if (!m.no && coop.guest) dropRemove(floor.items, i);                         // refused: ask again after the pend time-out
      break;
    }
    case 'op': {
      if (m.fk !== coopFloorKey()) return;
      const o = propObjs[m.i]; if (!o || o.p.opened || (o.p.kind === 'door') !== !!m.d) return;
      if (coop.host) {                                                            // from the guest only a door: containers are the host's
        if (!m.d || !coopNearProp(o)) return;
        openDoor(o); questDoorOpened(o);
        if (theme.doors.style === 'spore') { const T = theme.mechanic.TUNE; coop.mute = true; spawnCloud(o.x, o.z, T.puffR, T.puffDur, T.puffDaze, true); coop.mute = false; }   // (the guest already has its own cloud)
      } else if (m.d) { openDoor(o); questDoorOpened(o); } else markOpened(o);   // (a cell door frees the prisoner on both)
      break;
    }
    case 'sa': S.stairPeer = !!m.v; break;
    case 'go': if (coop.guest && m.fk === coopFloorKey()) coopDoGo(); break;
    case 'dn': { rp.down = true; if (coop.down) { coopEnd(); } break; }
    case 'rv': if (coop.down) coopRevived(); break;
    case 'end': coopEnd(); break;
  }
}

// ---- HUD: the partner's HP, their state, and the revive progress. Written to the DOM only when the text changes. ----
function coopHud(reset) {
  const S = coopS;
  if (reset === true || !S.hudEl) {
    if (!S.hudEl) {
      const d = document.createElement('div'); d.className = 'hud'; d.id = 'partner'; d.style.cssText = 'top:78px;left:14px;font-size:13px;display:none';
      d.innerHTML = '<span id="partnerTxt"></span><span style="display:block;width:120px;height:5px;margin-top:3px;background:#0008;border:1px solid #fff5"><span id="partnerBar" style="display:block;height:100%;width:0;background:#4cc36a"></span></span>';
      document.body.appendChild(d); S.hudEl = d; S.hudTxt = d.firstChild; S.hudBar = d.lastChild.firstChild;
    }
    S.hudNum = -1; S.hudEl.style.display = coop.on ? 'block' : 'none';
    if (!coop.on) return;
  }
  if (!coop.on) return;
  const rp = S.rp, hp = Math.round(rp.hp * 100), rv = Math.round(S.revive.frac * 100);
  const near = coopNearBody();
  const mine = Math.round(S.mine.frac * 100);
  const num = hp + rv * 128 + (rp.on ? 1 << 20 : 0) + (rp.down ? 1 << 21 : 0) + (coop.down ? 1 << 22 : 0) + (S.stairMe ? 1 << 23 : 0) + (near ? 1 << 24 : 0) + (S.stairPeer ? 1 << 25 : 0) + mine * (1 << 26);
  if (num === S.hudNum) return;                                                   // nothing changed: no strings built, no DOM write
  S.hudNum = num;
  const txt = !rp.on ? `${COOP.names[1 - S.role]}: elsewhere` : rp.down ? (coop.down ? 'Both down' : near ? `Hold E to revive ${COOP.names[1 - S.role]} ${rv}%` : `${COOP.names[1 - S.role]} is down: go to them`) : `${COOP.names[1 - S.role]} ${hp}%`;
  S.hudTxt.textContent = txt + (coop.down ? (mine ? `  (being revived ${mine}%)` : '  (you are down: wait for a revive)') : S.stairMe ? '  (waiting at the stairs)' : S.stairPeer ? '  (partner is at the stairs)' : '');
  S.hudTxt.style.color = COOP.hex[1 - S.role]; S.hudBar.style.width = (rp.down ? 0 : hp) + '%';
}

// ---- menu: Host / Join with copy-paste codes (opened from the welcome screen's Co-op button, js/menu.js) ----
const coopMenu = (() => {
  const root = document.createElement('div');
  root.style.cssText = 'position:fixed;inset:0;z-index:20;display:none;align-items:center;justify-content:center;background:#000c;font:13px system-ui,sans-serif;color:#eee';
  root.innerHTML = `<div style="width:min(560px,94vw);max-height:96vh;overflow:auto;background:#15130f;border:1px solid #e8c860;padding:14px 16px;box-sizing:border-box">
    <div style="display:flex;justify-content:space-between;align-items:center"><b style="font-size:20px;color:#e8c860">Co-op (2 players)</b><button data-a="close">Close</button></div>
    <p style="opacity:.8;margin:8px 0">Play together online with one friend, friendly fire on. No server: you swap two codes (paste them into a chat). It uses Google's public STUN server, so two players on very strict networks (symmetric NAT) may not be able to connect.</p>
    <p style="color:#ff9a6a;margin:8px 0">The code you share includes your IP address: share it only with people you trust.</p>
    <div data-p="pick"><button data-a="host">Host a game</button> <button data-a="join">Join a game</button></div>
    <div data-p="lobby" style="display:none"><p data-r="lobby"></p><button data-a="start" disabled>Start the run</button></div>
    <div data-p="host" style="display:none"><p>1. Send this invite code to your friend:</p><textarea data-r="invite" readonly rows="3" style="width:100%;box-sizing:border-box"></textarea><button data-a="copyInvite">Copy</button>
      <p>2. Paste the answer code they send back, then connect:</p><textarea data-r="answerIn" rows="3" style="width:100%;box-sizing:border-box"></textarea><button data-a="connect">Connect</button></div>
    <div data-p="join" style="display:none"><p>1. Paste the invite code from the host:</p><textarea data-r="inviteIn" rows="3" style="width:100%;box-sizing:border-box"></textarea><button data-a="answer">Create answer code</button>
      <p>2. Send this answer code back to the host:</p><textarea data-r="answer" readonly rows="3" style="width:100%;box-sizing:border-box"></textarea><button data-a="copyAnswer">Copy</button></div>
    <p data-r="status" style="color:#e8c860;min-height:18px;margin:8px 0 0"></p></div>`;
  document.body.appendChild(root);
  const q = s => root.querySelector(s), r = n => q(`[data-r="${n}"]`), pane = n => q(`[data-p="${n}"]`);
  const say = t => { r('status').textContent = t; };
  const show = n => { for (const p of ['pick', 'host', 'join', 'lobby']) pane(p).style.display = p === n ? 'block' : 'none'; };
  for (const ta of root.querySelectorAll('textarea')) { ta.addEventListener('keydown', e => e.stopPropagation()); ta.addEventListener('keyup', e => e.stopPropagation()); }   // typing must not move the player
  root.addEventListener('click', e => e.stopPropagation());
  const copy = n => { const t = r(n); t.select(); try { navigator.clipboard.writeText(t.value); say('Copied.'); } catch (err) { document.execCommand && document.execCommand('copy'); say('Copied (or press Ctrl+C).'); } };
  const fail = e => say('Problem: ' + (e && e.message || e));
  const act = {
    close() { root.style.display = 'none'; },
    start() { coop.start(); },
    host() { show('host'); coopS.onStatus = say; say('Creating invite...'); coop.hostInvite().then(c => { r('invite').value = c; }, fail); },
    join() { show('join'); coopS.onStatus = say; say('Paste the invite code.'); },
    copyInvite() { copy('invite'); }, copyAnswer() { copy('answer'); },
    connect() { coop.hostConnect(r('answerIn').value).then(() => say('Connecting...'), fail); },
    answer() { say('Creating answer...'); coop.join(r('inviteIn').value).then(c => { r('answer').value = c; }, fail); },
  };
  root.addEventListener('click', e => { const a = e.target.dataset && e.target.dataset.a; if (a && act[a]) act[a](); });
  const go = q('[data-a="start"]');
  return {
    open() { if (session.started) return; root.style.display = 'flex'; if (!coop.on) show('pick'); },
    hide() { root.style.display = 'none'; },
    opened() {
      show('lobby'); go.disabled = true; go.style.display = coop.host ? '' : 'none';
      r('lobby').textContent = coop.host ? 'Your friend is connected. Press Start to begin floor 1 together.' : 'Connected. Waiting for the host to start the run.';
      say('Connected!');
    },
    ready() { go.disabled = false; },
    joined() { say('Connected to the host. The run begins when they press Start.'); },
    closed(why) { if (!session.started) show('pick'); say(why); },
  };
})();
