// Scene building, HUD, minimap, and the floor-to-floor loop.
const MAX_FLOOR = 5;
const params = new URLSearchParams(location.search);
const runSeed = params.has('seed') ? (parseInt(params.get('seed'), 10) >>> 0) : (Math.random() * 4294967296) >>> 0;
const theme = makeRng(runSeed).pick(THEMES);     // one theme per run, picked from the seed

const canvas = document.getElementById('game');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
renderer.setPixelRatio(quality.cur);   // 1.5 at most; js/perf.js lowers it if the frame rate drops
renderer.toneMapping = THREE.ACESFilmicToneMapping; renderer.toneMappingExposure = 0.95;   // a filmic curve instead of hard clipping
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
let cullChunks = [];        // the merged furniture and torches of the current floor, for distance culling (js/perf.js)
let floor = null, floorNum = 1, group = null, stairsLight = null, explored = null, stairBox = null, upBox = null, upLight = null;
const floorCache = {};      // floors you have left, kept exactly as they were (guards, opened chests, bodies, explored map)
const BOSS_WALL_H = 10;    // the arena ceiling, so the boss (about 3 m tall) has room
const STAIR_HALF_W = 1.1, STAIR_HALF_L = 1.3, STAIR_DEPTH = 1.5, UP_RISE = 1.4;   // the way down sinks 1.5 m; the way back up rises 1.4 m
let state = 'menu';        // menu | play | won
let msgTimer = 0;
const PATCH_KINDS = ['puddle', 'grass', 'glowcap', 'bell', 'ice'];
const HUSH = theme.name === 'The Clockwork Library' ? 1.4 : 1;           // the Library's dead silence: every sound you make carries farther
const THEME_HINT = { 'The Sunken Tavern': 'Shallow puddles splash when you step in them, even when you creep.', 'The Moonlit Orchard': 'Tall grass hides a crouching player. Scarecrows are not all scenery.', 'The Clockwork Library': 'The library is eerily silent: every sound you make carries 40% farther.', 'The Mushroom Cellar': 'Glowing spores light you up: guards see you from farther in them.', 'The Goblin Market': 'Tripwire bells ring a loud alarm when you step on one. Thieves work the crowd.', 'The Frozen Chapel': 'Patches of ice make you slide.' };
const shopFloor = makeRng((runSeed ^ 0x51ed270b) >>> 0).int(1, MAX_FLOOR - 1);   // the one floor of this stage with a shop (not the boss arena); the player is not told which

// Procedural textures. Smooth filtering with mipmaps (no chunky pixels), a seeded pattern per colour so a theme looks
// the same every run: brick walls, plank or flagstone floors, a dark plank ceiling.
function hashStr(s) { let h = 2166136261; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); } return h >>> 0; }
function finishTexture(c, repeatX = 1, repeatY = 1) {
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.magFilter = THREE.LinearFilter; t.minFilter = THREE.LinearMipmapLinearFilter;
  t.anisotropy = Math.min(8, renderer.capabilities.getMaxAnisotropy());
  t.repeat.set(repeatX, repeatY);
  return t;
}
const shade = (col, k) => `rgb(${Math.max(0, Math.min(255, Math.round(col.r * 255 * k)))},${Math.max(0, Math.min(255, Math.round(col.g * 255 * k)))},${Math.max(0, Math.min(255, Math.round(col.b * 255 * k)))})`;
function speckle(g, S, n, rng) {   // fine grain on top of a pattern
  for (let i = 0; i < n; i++) { g.fillStyle = rng() < 0.5 ? 'rgba(0,0,0,0.10)' : 'rgba(255,255,255,0.05)'; g.fillRect(rng() * S, rng() * S, 1 + rng() * 1.5, 1 + rng() * 1.5); }
}
// Walls: 6 bricks across a 3 m tile, 12 rows over 3.6 m, every other row offset, each brick its own tint, mortar between,
// and a gentle darkening at the top and bottom (a soft ambient-occlusion look).
function wallTexture(base) {
  const S = 256, c = document.createElement('canvas'); c.width = c.height = S; const g = c.getContext('2d'), rng = makeRng(hashStr(base)), col = new THREE.Color(base);
  g.fillStyle = shade(col, 0.45); g.fillRect(0, 0, S, S);                       // mortar
  const rows = 12, bw = S / 6, bh = S / rows;
  for (let r = 0; r < rows; r++) for (let b = -1; b < 6; b++) {
    const off = r % 2 ? bw / 2 : 0, x = b * bw + off, y = r * bh, k = 0.68 + rng() * 0.28;
    g.fillStyle = shade(col, k); g.fillRect(x + 1.5, y + 1.5, bw - 3, bh - 3);
    g.fillStyle = 'rgba(255,255,255,0.08)'; g.fillRect(x + 1.5, y + 1.5, bw - 3, 2);   // a lit top edge
    g.fillStyle = 'rgba(0,0,0,0.12)'; g.fillRect(x + 1.5, y + bh - 3.5, bw - 3, 2);     // a shaded bottom edge
    for (let i = 0; i < 5; i++) { g.fillStyle = `rgba(0,0,0,${0.04 + rng() * 0.06})`; g.fillRect(x + 3 + rng() * (bw - 8), y + 3 + rng() * (bh - 8), 2 + rng() * 5, 1 + rng() * 2); }   // pits and chips
  }
  speckle(g, S, 1400, rng);
  const grad = g.createLinearGradient(0, 0, 0, S); grad.addColorStop(0, 'rgba(0,0,0,0.30)'); grad.addColorStop(0.12, 'rgba(0,0,0,0)'); grad.addColorStop(0.86, 'rgba(0,0,0,0)'); grad.addColorStop(1, 'rgba(0,0,0,0.42)');
  g.fillStyle = grad; g.fillRect(0, 0, S, S);
  return finishTexture(c);
}
// Floors: planks (6 across a 3 m tile with butt joints and grain) or irregular flagstones, depending on the theme.
function floorTexture(base, planks) {
  const S = 256, c = document.createElement('canvas'); c.width = c.height = S; const g = c.getContext('2d'), rng = makeRng(hashStr(base + 'f')), col = new THREE.Color(base);
  g.fillStyle = shade(col, 0.4); g.fillRect(0, 0, S, S);
  if (planks) {
    const pw = S / 6;
    for (let p = 0; p < 6; p++) {
      let y = -rng() * 60;
      while (y < S) {
        const len = 70 + rng() * 90, k = 0.78 + rng() * 0.3;
        g.fillStyle = shade(col, k); g.fillRect(p * pw + 1.5, y + 1.5, pw - 3, len - 3);
        for (let l = 0; l < 6; l++) { g.strokeStyle = `rgba(0,0,0,${0.05 + rng() * 0.07})`; g.beginPath(); const gx = p * pw + 4 + rng() * (pw - 8); g.moveTo(gx, y + 3); g.lineTo(gx + (rng() - 0.5) * 3, y + len - 3); g.stroke(); }   // grain
        g.fillStyle = 'rgba(255,255,255,0.05)'; g.fillRect(p * pw + 1.5, y + 1.5, pw - 3, 2);
        y += len;
      }
    }
  } else {
    const n = 3, sw = S / n;
    for (let r = 0; r < n; r++) for (let q = 0; q < n; q++) {
      const x = q * sw + (r % 2 ? sw * 0.35 : 0), y = r * sw, k = 0.8 + rng() * 0.3;
      for (const dx of [0, -sw]) { g.fillStyle = shade(col, k); g.fillRect(x + dx + 2, y + 2, sw - 4, sw - 4); g.fillStyle = 'rgba(255,255,255,0.06)'; g.fillRect(x + dx + 2, y + 2, sw - 4, 2); }
    }
  }
  speckle(g, S, 1600, rng);
  return finishTexture(c);
}
function ceilingTexture(base) {
  const S = 128, c = document.createElement('canvas'); c.width = c.height = S; const g = c.getContext('2d'), rng = makeRng(hashStr(base + 'c')), col = new THREE.Color(base);
  g.fillStyle = shade(col, 0.9); g.fillRect(0, 0, S, S);
  for (let i = 0; i < 8; i++) { g.fillStyle = shade(col, 0.7 + rng() * 0.4); g.fillRect(0, i * 16 + 1, S, 14); }
  speckle(g, S, 500, rng);
  return finishTexture(c, 1, 1);
}
const PLANK_THEMES = new Set(['The Sunken Tavern', 'The Clockwork Library', 'The Goblin Market', 'The Moonlit Orchard']);

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
  const wallTex = wallTexture(theme.wall);
  const walls = new THREE.InstancedMesh(new THREE.BoxGeometry(TILE, WALL_H, TILE),
    new THREE.MeshPhongMaterial({ map: wallTex, shininess: 5, specular: 0x151515 }), wallPos.length);   // per-pixel lighting: torch light pools smoothly across big faces
  const m = new THREE.Matrix4();
  wallPos.forEach(([x, y], i) => { m.setPosition((x + 0.5) * TILE, WALL_H / 2, (y + 0.5) * TILE); walls.setMatrixAt(i, m); });
  walls.frustumCulled = false;                    // an instanced mesh is culled by its first box only, so never cull it
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
  const floorTex = floorTexture(theme.floor, PLANK_THEMES.has(theme.name)); floorTex.repeat.set(1 / TILE, 1 / TILE);
  const fl = new THREE.Mesh(new THREE.ShapeGeometry(floorShape), new THREE.MeshPhongMaterial({ map: floorTex, shininess: 12, specular: 0x222222 }));
  fl.rotation.x = -Math.PI / 2;
  const ceilTex = ceilingTexture(theme.ceil); ceilTex.repeat.set(w, h);
  const ce = new THREE.Mesh(planeGeo, new THREE.MeshPhongMaterial({ map: ceilTex, shininess: 2, specular: 0x050505 }));
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

  // the stairs back up (floors 2 and deeper): a flight of steps on the start tile, rising from the open side
  upBox = null; upLight = null; floor.up = null;
  if (floorNum > 1) {
    const st = floor.start, open = (x, y) => floor.tiles[y * w + x] === T_FLOOR || floor.tiles[y * w + x] === T_START;
    const dir = open(st.x, st.y + 1) && !floor.blocked[(st.y + 1) * w + st.x] ? 1 : -1;      // which side you step on from
    const ux = (st.x + 0.5) * TILE, uz = (st.y + 0.5) * TILE;
    upBox = { x0: ux - STAIR_HALF_W, x1: ux + STAIR_HALF_W, z0: uz - STAIR_HALF_L, z1: uz + STAIR_HALF_L, dir };
    floor.up = { x: st.x, y: st.y, dir };
    const base = dir > 0 ? upBox.z1 : upBox.z0, steps = 6, ulen = STAIR_HALF_L * 2, uw = STAIR_HALF_W * 2;
    const stoneMat = new THREE.MeshLambertMaterial({ color: 0x8a8478 }), edgeMat = new THREE.MeshLambertMaterial({ color: 0xa8a294 });
    for (let i = 0; i < steps; i++) {
      const hgt = (i + 1) * UP_RISE / steps, zc = base - dir * ((i + 0.5) * ulen / steps);
      const s = new THREE.Mesh(new THREE.BoxGeometry(uw, hgt, ulen / steps), stoneMat); s.position.set(ux, hgt / 2, zc); group.add(s);
      const lip = new THREE.Mesh(new THREE.BoxGeometry(uw + 0.06, 0.05, 0.1), edgeMat); lip.position.set(ux, hgt + 0.01, zc + dir * (ulen / steps / 2 - 0.05)); group.add(lip);   // a lighter nosing on each step
    }
    for (const side of [-1, 1]) {                                                           // low stone cheeks on both sides
      const ch = new THREE.Mesh(new THREE.BoxGeometry(0.16, UP_RISE + 0.5, ulen), stoneMat); ch.position.set(ux + side * (STAIR_HALF_W + 0.08), (UP_RISE + 0.5) / 2, uz); group.add(ch);
    }
    const top = new THREE.Mesh(new THREE.BoxGeometry(uw + 0.3, 0.3, 0.3), new THREE.MeshLambertMaterial({ color: 0x15120e })); top.position.set(ux, UP_RISE + 0.6, base - dir * ulen); group.add(top);   // a dark opening at the top
    upLight = new THREE.PointLight(0xa8c8ff, 0.3, 9); upLight.position.set(ux, 1.8, uz); group.add(upLight);                // a cool light from above
  }

  propObjs = floor.props.map(p => makeProp(p));
  propObjs.forEach(o => group.add(o.mesh));
  floor.solids = [{ x: sx, z: sz, r: 1.5 }, ...propObjs.map(o => ({ x: o.x, z: o.z, r: o.r }))];   // what guards cannot walk through: stairwell, props, furniture
  if (floor.up) floor.solids.push({ x: (floor.up.x + 0.5) * TILE, z: (floor.up.y + 0.5) * TILE, r: 1.5 });   // and the stairs up
  decorObjs = floor.decor.map(makeDecor);
  for (const o of decorObjs) {
    group.add(o.mesh);
    if (o.r > 0) { propObjs.push(o); if (o.r > 0.3) floor.solids.push({ x: o.x, z: o.z, r: o.r }); }   // small floor clutter (candles) never traps a guard   // rugs, bones and banners are flat or hung: no collision
  }
  for (const dr of floor.doors) { const o = makeDoor(dr); group.add(o.mesh); propObjs.push(o); }
  if (floor.shop) buildShop();
  // thousands of tiny meshes become a few merged ones per 12 m chunk (tripwire bells stay separate: they hide when rung)
  cullChunks = mergeStatic(decorObjs.filter(o => o.kind !== 'bell').map(o => o.mesh), group);
  buildTorches();
  cullChunks.push(...mergeStatic(torchGroups, group));
  enemies = floor.enemies.map(s => new Enemy(s, floor));
  Enemy.all = enemies;
  linkHandlers(enemies);
  enemies.forEach(e => { e.cone.visible = dev.on; group.add(e.mesh); });

  scene.add(group);
  scene.background = new THREE.Color(theme.fog);
  scene.fog = new THREE.FogExp2(theme.fog, 0.085);
}

// ---- light sources: wall torches plus glowing furniture (hearths, cauldrons, candles, altars).
// Emissive meshes everywhere, real light only on the 4 nearest to the player. ----
// The merchant: a goblin in an apron behind his counter (not an enemy, never moves), a solid circle so you cannot walk
// through him, and an invisible trading spot at the counter. The stock is seeded per floor.
function buildShop() {
  const sh = floor.shop;
  floor.shopStock = makeStock(runSeed, floorNum);
  const mn = new Enemy({ x: sh.merchant.x, y: sh.merchant.y, route: [sh.merchant, sh.merchant], seed: sh.seed, type: 'cook' }, floor);
  mn.yaw = sh.merchant.yaw; mn.sync(0); mn.icon.visible = false; mn.cone.visible = false;
  group.add(mn.mesh);
  propObjs.push({ p: { kind: 'decor', opened: true, x: sh.merchant.x, y: sh.merchant.y }, mesh: mn.mesh, x: mn.x, z: mn.z, r: 0.45, lid: null, mats: [] });
  floor.solids.push({ x: mn.x, z: mn.z, r: 0.45 });
  const co = decorObjs.find(o => o.kind === 'counter');
  propObjs.push({ p: { kind: 'merchant', x: sh.counter.x, y: sh.counter.y, opened: false }, mesh: new THREE.Group(), x: co.x, z: co.z, r: 0, lid: null, mats: [] });
  floor.shopSeen = false;
}
// The first time you see the merchant's counter you are told how to trade.
function checkShopSight() {
  if (!floor.shop || floor.shopSeen) return;
  const c = floor.shop.counter, cx = (c.x + 0.5) * TILE, cz = (c.y + 0.5) * TILE;
  if (Math.hypot(cx - player.x, cz - player.z) < 9 && hasLOS(floor, player.x, player.z, cx, cz)) { floor.shopSeen = true; flash('A goblin merchant! Hold E at his counter to trade.'); }
}

let torchPts = [], torchGroups = [];
const TORCH_STICK = new THREE.CylinderGeometry(0.04, 0.05, 0.4, 7), TORCH_FLAME = new THREE.ConeGeometry(0.1, 0.3, 7);
const torchLights = Array.from({ length: 4 }, () => { const l = new THREE.PointLight(theme.light, 0, 14, 1.5); scene.add(l); return l; });
function buildTorches() {
  const iron = new THREE.MeshLambertMaterial({ color: 0x2a2420 });
  const fire = new THREE.MeshBasicMaterial({ color: 0xffa94a });
  torchGroups = [];
  torchPts = floor.torches.map(t => {
    const x = (t.x + 0.5) * TILE + t.dx * 1.42, z = (t.y + 0.5) * TILE + t.dy * 1.42;
    const g = new THREE.Group(); g.position.set(x, floor.boss ? 3.6 : 2.0, z);       // higher on the tall arena walls
    const stick = new THREE.Mesh(TORCH_STICK, iron); stick.position.y = -0.05;                                  // a round bracket and a tapering flame, not boxes
    const flame = new THREE.Mesh(TORCH_FLAME, fire); flame.position.y = 0.26;
    g.add(stick, flame); group.add(g); torchGroups.push(g);
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
const cb = { limpMsg: 0, draw: null, bashCd: 0, bash: 0, rageCd: 0, stamina: STAMINA_MAX, delay: 0, atk: null, press: false, want: false, block: false, blockT: 0, canSprint: true };
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
  if (isLimp(inv.equip.weapon)) { if (!cb.atk && cb.limpMsg <= 0) { flash("Ian's Hog has gone limp. It needs a Recharge Wand."); cb.limpMsg = 1.2; } return; }
  if (cb.atk || cb.block || inv.swapT > 0 || pst.has('stun') || (cb.stamina < w.stam && !dev.on)) return;
  spend(w.stam); hunger.fight = 3;
  if (w.wand) { cb.atk = { t: 0, hit: true }; castWand(w); return; }   // a wand fires at once; the swing timer is just its recovery
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
  const guarded = !sneak && e.stun <= 0 && e.T.blockFront < 1 && e.facesPlayer(player);        // a raised shield or guard takes hits from the front
  const dmg = base * Math.min(TUNE.damageCap, ZONE_MUL[zone]) * (sneak ? Math.min(w.sneak, e.T.sneakCap) : 1) * (guarded ? e.T.blockFront : 1)
    * (inv.buffs.might > 0 ? 1.4 : 1) * (e.resist[zone] || 1);
  const killed = e.hurt(dmg, player);
  if (noise) loud(sneak && killed ? 2 : noise);   // a clean kill is nearly silent
  if (killed) { if (e.boss) bossDefeated(e); else makeCorpse(e, sneak); mark(sneak ? 'SNEAK KILL' : 'KILLED', '#ffd23a'); if (w.kills) hogKill(); }
  else {
    const pr = w.proc;                              // weapon passive: dagger bleeds, mace stuns, sword sometimes cripples, bow slows
    const proc = pr && pr.zone === zone && gameRng() < pr.chance && e.addStatus(pr.status, pr.dur);
    if (proc) discover('status:' + pr.status, STATUS[pr.status].name);
    mark(`${zone.toUpperCase()}${sneak ? ' SNEAK' : ''}${guarded ? ' GUARDED' : ''} ${Math.round(dmg)}${proc ? ' +' + STATUS[pr.status].name.toUpperCase() : ''}`, zone === 'head' ? '#ff9a3a' : '#fff');
  }
}

// AK's Dumbass (js/loot.js DUNCE): Corner Time (crouch still, and unaware guards stop noticing you) and Cone of Shame
// (the first guard on each floor to spot you is stunned by laughter). Fool's Fortune lives in Inventory.add. Returns
// true while you are hidden.
const hat = { still: 0, hidden: false, hiddenT: 0, cd: 0, coned: new Set() };
function hatUpdate(dt) {
  if (hat.cd > 0) hat.cd -= dt;
  if (!wearingDunce(inv)) { hat.still = 0; hat.hidden = false; return false; }
  const moving = Math.hypot(player.vx, player.vz) > 0.3 || cb.atk || cb.draw || cb.eat;
  const hunted = enemies.some(e => !e.dead && e.state === 'alerted' && !e.boss);
  if (hat.hidden) {
    hat.hiddenT += dt;
    if (moving || !player.crouching || hunted || hat.hiddenT > DUNCE.hideMax) { hat.hidden = false; hat.cd = DUNCE.hideCd; hat.still = 0; flash('Guards can see you again.'); }
  } else if (player.crouching && !moving && !hunted) {
    if ((hat.still += dt) >= DUNCE.hideStill && hat.cd <= 0) { hat.hidden = true; hat.hiddenT = 0; flash('You crouch motionless. The guards look right past you.'); }
  } else hat.still = 0;
  if (!hat.coned.has(floorNum)) {                                                  // Cone of Shame
    const g = enemies.find(e => !e.dead && e.state === 'alerted' && e.seen && !e.rageT && !e.boss);
    if (g) { hat.coned.add(floorNum); if (g.addStatus('stun', DUNCE.laugh)) { discover('status:stun', 'Stun'); flash('A guard spots your hat and bursts out laughing!'); } }
  }
  return hat.hidden;
}

// Ian's Hog: every kill with it uses up a charge. At 0 it goes limp (see isLimp) until a recharge wand stiffens it.
function hogKill() {
  const it = inv.equip.weapon;
  if (!it || it.base !== 'spear' || it.charges <= 0) return;
  it.charges--;
  flash(it.charges <= 0 ? "Ian's Hog goes limp! Find a Recharge Wand to stiffen it again." : `Ian's Hog: ${it.charges} kill${it.charges === 1 ? '' : 's'} left before it goes limp.`);
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
  if (!e.boss && !e.st.has('stuck') && !Player.wallHit(floor, e.x + dx / d * SHIELD.bashPush, e.z + dz / d * SHIELD.bashPush, e.r)) { e.x += dx / d * SHIELD.bashPush; e.z += dz / d * SHIELD.bashPush; }
  mark(stunned ? 'BASH +STUN' : 'BASH', '#7fe8ff');
}

// ---- wands: attack fires a bolt that ignores armor and hit zones; a charge per cast, and the wand breaks at 0 ----
function castWand(w) {
  const it = inv.equip.weapon, W = WANDS[it.kind];
  const cp = Math.cos(player.pitch), dx = -Math.sin(player.yaw) * cp, dy = Math.sin(player.pitch), dz = -Math.cos(player.yaw) * cp;
  const a = { x: player.x + dx * 0.5, y: eyeY() - 0.1, z: player.z + dz * 0.5, vx: dx * WAND.speed, vy: dy * WAND.speed, vz: dz * WAND.speed, gravity: 0, life: WAND.range / WAND.speed, owner: 'player', kind: 'wand', wand: it.kind, stuck: false, mesh: makeBoltMesh(W.color) };
  a.mesh.position.set(a.x, a.y, a.z);
  group.add(a.mesh); arrows.push(a);
  loud(W.noise);
  discover('wand:' + it.kind, W.name);
  if (--it.charges <= 0) breakWand(it);
  else if (it.charges === 1) flash(`The ${W.name} is nearly spent (1 charge).`);
}
function breakWand(w) {
  const best = inv.pack.filter(i => i.type === 'weapon').sort((a, b) => weaponStats(b).dmg - weaponStats(a).dmg)[0];
  if (best) { inv.equipItem(best); inv.remove(w); }                          // equipItem put the wand in the pack: it is gone
  else inv.equip.weapon = makeItem({ type: 'weapon', base: 'dagger', tier: 0 });
  inv.quick = inv.quick.map(id => id === w.id ? null : id);
  cb.atk = null;
  flash(`The ${WANDS[w.kind].name} crumbles to dust.` + (best ? '' : ' You pull out a dagger.'));
}
function hurtByWand(e, dmg) {                                                 // wand damage ignores armor
  const killed = e.hurt(dmg, player);
  if (killed) { if (e.boss) bossDefeated(e); else makeCorpse(e, false); }
  return killed;
}
function applyWand(kind, e) {
  const W = WANDS[kind], tag = s => { discover('status:' + s, STATUS[s].name); };
  if (kind === 'fire') { hurtByWand(e, W.dmg); mark(`FIRE ${W.dmg}`, '#ff9a3a'); }
  else if (kind === 'frost') { if (!hurtByWand(e, W.dmg) && e.addStatus('slow', W.slow)) tag('slow'); mark('FROST +SLOW', '#7fd8ff'); }
  else if (kind === 'lightning') {
    if (!hurtByWand(e, W.dmg) && e.addStatus('stun', W.stun)) tag('stun');
    const o = nearestOther(e, enemies, W.chain);
    if (o && !hurtByWand(o, W.chainDmg) && o.addStatus('stun', W.chainStun)) tag('stun');
    mark(o ? 'LIGHTNING ARCS' : 'LIGHTNING +STUN', '#ffe84a');
  } else if (kind === 'force') {
    const dx = e.x - player.x, dz = e.z - player.z, d = Math.hypot(dx, dz) || 1;
    let moved = 0, hitWall = false;
    if (!e.boss && !e.st.has('stuck')) {
      collider.props = floor.solids;
      for (; moved < W.push; moved += 0.25) {
        const nx = e.x + dx / d * 0.25, nz = e.z + dz / d * 0.25;
        if (Player.prototype.blocked.call(collider, floor, nx, nz)) { hitWall = true; break; }
        e.x = nx; e.z = nz;
      }
      e.rp = 0;
    }
    hurtByWand(e, W.dmg + (hitWall ? W.wallDmg : 0));
    mark(hitWall ? 'FORCE: SLAMMED' : 'FORCE', '#c58aff');
  } else if (kind === 'bust') {
    if (e.elite) mark('TOO BIG TO STICK', '#aaa');                                // elites and bosses shrug it off
    else if (e.st.has('stuck')) mark('ALREADY STUCK', '#aaa');
    else if (e.addStatus('stuck')) { tag('stuck'); mark('STUCK FAST', '#ffffff'); }
  } else if (kind === 'sleep') { if (e.sleep(W.sleep)) mark('ASLEEP', '#8a9aff'); else mark('IT WILL NOT SLEEP', '#aaa'); }
}

// ---- Hanahan's Rage: nearby enemies fight each other for a while ----
const SPEAK = typeof speechSynthesis !== 'undefined' ? speechSynthesis : null;
function playRage(it) {
  if (cb.rageCd > 0) { flash('The recorder is still rewinding.'); return; }
  cb.rageCd = RAGE.cd; loud(RAGE.noise);
  const victims = rageVictims(enemies, player.x, player.z).filter(e => e.enrage(RAGE.dur, player.x, player.z));
  discover('item:rage', "Hanahan's Rage");
  try { if (SPEAK) { SPEAK.cancel(); const u = new SpeechSynthesisUtterance(RAGE_LINES[Math.floor(Math.random() * RAGE_LINES.length)]); u.pitch = 0.55; u.rate = 1.15; SPEAK.speak(u); } } catch (err) {}
  flash(victims.length ? `Hanahan's Rage! ${victims.length} ${victims.length === 1 ? 'enemy turns' : 'enemies turn'} on each other.` : "Hanahan's Rage plays... but nobody is close enough to hear it.");
  if (--it.charges <= 0) { inv.remove(it); addLog("The recorder's speakers blow out.", '#ff9a2a'); }
}

// A thief's blow takes gold instead of health. It keeps the gold and drops it when it dies.
function stealGold(e) {
  const n = Math.min(inv.gold, 25); inv.gold -= n; e.loot += n; hitReaction(4);
  flash(n ? `Thief! ${n} gold stolen. Kill it to get it back.` : 'A thief rifles your pockets and finds nothing.');
  discover('enemy:thief', 'Thief Goblin');
}
// A spore puffer bursting: Slow and Daze for anything within 3 m, you included.
Enemy.burst = e => {
  if (Math.hypot(e.x - player.x, e.z - player.z) < 3) {
    if (pst.apply('slow', 4)) discover('status:slow', 'Slow'); if (pst.apply('daze', 3)) discover('status:daze', 'Daze');
    hitReaction(3); flash('The puffer bursts! Spores!');
  }
  for (const o of enemies) if (o !== e && !o.dead && Math.hypot(o.x - e.x, o.z - e.z) < 3) o.addStatus('slow', 4);
};

// ---- enemy shots: an archer's arrows and a shaman's hexes fly at you. Arrows can be blocked, hexes cannot ----
function spawnEnemyShot(s) {
  const gravity = s.kind === 'arrow' ? 4 : 0, tx = player.x, ty = eyeY() - 0.3, tz = player.z;
  const dx = tx - s.x, dy = ty - s.y, dz = tz - s.z, dist = Math.hypot(dx, dz) || 1, t = Math.max(0.05, Math.hypot(dx, dy, dz) / s.speed);
  const jitter = () => (gameRng() - 0.5) * 0.05 * dist / t;                       // a little inaccuracy
  const a = { x: s.x, y: s.y, z: s.z, vx: dx / t + jitter(), vy: (dy + 0.5 * gravity * t * t) / t, vz: dz / t + jitter(), gravity, life: 4, owner: 'enemy', kind: s.kind, from: s.from, stuck: false, mesh: s.kind === 'arrow' ? makeArrowMesh() : makeBoltMesh({ hex: '#b060ff', thorn: '#4ac84a', curse: '#9adaff' }[s.kind]) };
  a.mesh.position.set(a.x, a.y, a.z); group.add(a.mesh); arrows.push(a);
}
function enemyShotHit(a) {
  if (a.kind === 'thorn' || a.kind === 'curse') {                                    // thorns make you bleed, a curse slows you; no block stops them
    hitReaction(4);
    const s = a.kind === 'thorn' ? 'bleed' : 'slow';
    if (pst.apply(s, a.kind === 'thorn' ? 4 : 5)) discover('status:' + s, STATUS[s].name);
    mark(a.kind === 'thorn' ? 'THORNS' : 'CURSED', a.kind === 'thorn' ? '#6aff6a' : '#9adaff'); addLog(`${a.kind === 'thorn' ? 'Thorns' : 'Cursed'}: ${STATUS[s].name}!`, '#9adaff');
    return;
  }
  if (a.kind === 'hex') {                                                            // a hex slows or dazes, and no block stops it
    hitReaction(4);
    const s = gameRng() < 0.5 ? 'slow' : 'daze';
    if (pst.apply(s, 4)) discover('status:' + s, STATUS[s].name);
    mark('HEXED', '#c58aff'); addLog(`Hexed: ${STATUS[s].name}!`, '#c58aff');
    return;
  }
  const zone = a.y > player.eye - 0.4 ? 'head' : a.y > 0.65 ? 'body' : 'legs';       // where it landed, by your height
  resolveEnemyAttack(a.from, zone, true);
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
  const keep = gameRng() < (hitEnemy ? BOW.recoverHit : BOW.recoverWorld) && arrows.filter(q => q.stuck).length <= BOW.maxStuck;
  if (!keep) { group.remove(a.mesh); arrows.splice(arrows.indexOf(a), 1); return; }
  if (!hitEnemy && a.px !== undefined) { a.x = a.px; a.z = a.pz; }                     // lie in front of the wall, not inside it
  a.y = 0.05; a.mesh.position.set(a.x, 0.05, a.z); a.mesh.rotation.set(0, Math.atan2(a.dirx || 0, a.dirz || 1), 0);
}
function updateArrows(dt) {
  for (let i = arrows.length - 1; i >= 0; i--) {
    const a = arrows[i];
    if (a.stuck) {
      if (a.kind !== 'wand' && Math.hypot(a.x - player.x, a.z - player.z) < 1.0 && inv.arrows < QUIVER_MAX) { inv.arrows++; group.remove(a.mesh); arrows.splice(i, 1); addLog('Picked up an arrow.', '#cfc'); }
      continue;
    }
    if (a.owner === 'enemy') {
      const ev = stepArrow(a, dt, floor, enemies, player);
      a.life -= dt; a.mesh.position.set(a.x, a.y, a.z);
      if (a.kind === 'arrow') a.mesh.lookAt(a.x + a.vx, a.y + a.vy, a.z + a.vz);
      if (ev && ev.type === 'player') enemyShotHit(a);
      if (ev || a.life <= 0) { group.remove(a.mesh); arrows.splice(i, 1); }
      continue;
    }
    if (a.kind === 'wand') {                                                       // a wand bolt: no drop, no recovery, hits anything alive
      const ev = stepArrow(a, dt, floor, enemies, player);
      a.life -= dt; a.mesh.position.set(a.x, a.y, a.z);
      if (ev && ev.type === 'hit') applyWand(a.wand, ev.e);
      if (ev || a.life <= 0) { group.remove(a.mesh); arrows.splice(i, 1); }
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
  const uniq = epic.tier === 4 ? rollUniqueGear(rng, rng() < 0.5) : null, bust = rollBust(rng, 0.12);    // a Legendary body may hold a one-of-a-kind piece
  const extra = rollEquipment(floorNum, rng, { boost: 1, minTier: 2 });
  const left = [uniq || epic, extra, { type: 'gold', n: rng.int(120, 200) }, ...(rng() < 0.25 ? [{ type: 'rage' }] : []), ...(bust ? [bust] : [])];
  propObjs.push({
    p: { kind: 'corpse', x: Math.floor(e.x / TILE), y: Math.floor(e.z / TILE), opened: false, seed: e.seed, left },
    mesh: e.mesh, x: e.x, z: e.z, r: 0, lid: null, mats: [],
  });
  flash('The boss falls! Loot its body. The way down is open.');
}

// A dead enemy leaves a lootable body only if its drop roll gave something.
function makeCorpse(e, sneak) {
  e.corpseDone = true;
  const bonus = sneak ? 0.15 : 0;
  if (!dryRoll(() => rollLoot('corpse', floorNum, makeRng(e.seed), bonus, e.gear, e.type)).length && !e.loot) return;
  propObjs.push({
    p: { kind: 'corpse', x: Math.floor(e.x / TILE), y: Math.floor(e.z / TILE), opened: false, seed: e.seed, bonus, gear: e.gear, type: e.type, extra: e.loot ? [{ type: 'gold', n: e.loot }] : undefined },
    mesh: e.mesh, x: e.x, z: e.z, r: 0, lid: null, mats: [],
  });
}

function resolveEnemyAttack(e, zone, ranged = false) {
  const w = wstats();
  const fx = -Math.sin(player.yaw), fz = -Math.cos(player.yaw);
  const dx = e.x - player.x, dz = e.z - player.z, d = Math.hypot(dx, dz) || 1;
  const facing = (dx * fx + dz * fz) / d > 0.2;
  const full = TUNE.enemyDmg * e.dmgMul * (e.hitMul || 1) * ZONE_MUL[zone] * (1 - inv.armorRed(zone));
  e.hitMul = 1;   // armor in that zone's slot cuts it
  const bs = blockStats();
  if (cb.block && facing && !w.ranged) {
    if (zone === 'legs' && !bs.legs) mark('LEG SWEEP', '#ff6a4a');           // goes under a plain block
    else if (zone === 'legs') {                                              // a shield covers most of a low sweep
      const c = bs.cost * SHIELD.legsCost;
      if (cb.stamina >= c || dev.on) { spend(c); mark('LOW BLOCK', '#cfe'); loud(5); cb.atk = null; damage(full * SHIELD.legsTake); return; }
      cb.stamina = 0; mark('GUARD BROKEN', '#ff6a4a'); damage(full * 0.5); hitStatuses(e, zone); return;
    }
    else if (cb.blockT <= bs.parryWin) {
      if (!ranged) { e.stun = 1.0; e.winding = false; e.atkCd = 0.6; }            // parrying a blow staggers the attacker, an arrow just stops
      mark(ranged ? 'ARROW BLOCKED' : 'PARRY', '#7fe8ff'); loud(5); return;
    } else if (bs.cost > 0) {
      if (cb.stamina >= bs.cost || dev.on) { spend(bs.cost); mark(ranged ? 'ARROW BLOCKED' : 'BLOCKED', '#cfe'); loud(5); return; }
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
  if (e.T.onHit) add(e.T.onHit);                                                    // a frost wisp's touch slows
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
    const r = hunger.update(dt, { sprinting: player.sprinting, still: Math.hypot(player.vx, player.vz) < 0.2, crouching: player.crouching }, gameRng);
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
  const patch = floor.patches.get(player.tileY * floor.w + player.tileX);       // the theme's gimmick under your feet
  player.slippery = patch === 'ice';
  let seenMul = 1;
  if (patch === 'grass') { seenMul = player.crouching ? 0.55 : 0.85; discover('item:grass', 'Tall grass'); }
  else if (patch === 'glowcap') { seenMul = 1.4; discover('item:glow', 'Glowing spores'); }
  else if (patch === 'ice') discover('item:ice', 'Ice');
  const hidden = hatUpdate(dt);
  player.stealthMul = hidden ? 0 : (inv.buffs.shadow > 0 ? 0.5 : 1) * seenMul;
  if (inv.refillStamina) { cb.stamina = STAMINA_MAX; inv.refillStamina = false; }

  if (player.sprinting) spend(TUNE.sprintDrain * dt);
  else if (cb.delay > 0) cb.delay -= dt;
  else cb.stamina = Math.min(STAMINA_MAX, cb.stamina + TUNE.staminaRegen * (inv.buffs.vigor > 0 ? 2 : 1) * (inv.buffs.hearty > 0 ? 1.5 : 1) * hunger.regenMul() * dt);
  cb.stamina = Math.min(cb.stamina, STAMINA_MAX * hunger.maxStaminaMul());   // Weak: max stamina is cut
  if (dev.on) cb.stamina = STAMINA_MAX;
  if (cb.stamina <= 1) cb.canSprint = false; else if (cb.stamina > 25) cb.canSprint = true;
  player.canSprint = cb.canSprint && hunger.canSprint() && !cb.eat;

  if (cb.bashCd > 0) cb.bashCd -= dt;
  if (cb.rageCd > 0) cb.rageCd -= dt;
  if (cb.limpMsg > 0) cb.limpMsg -= dt;
  if (inv.rageReq) { playRage(inv.rageReq); inv.rageReq = null; }
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
  const canBlock = cb.want && !cb.atk && inv.swapT <= 0 && !pst.has('stun') && !cb.eat && !wstats().ranged && !wstats().wand && (cb.stamina > 0 || dev.on);
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
  const wkey = inv.weapon + (isLimp(inv.equip.weapon) ? ':limp' : '');                // a limp Ian's Hog is a different model
  if (vm.id !== wkey) {
    if (vm.model) vm.group.remove(vm.model);
    vm.model = buildWeaponModel(wkey); vm.group.add(vm.model); vm.id = wkey;
  }
  const spear = inv.weapon === 'spear', limp = isLimp(inv.equip.weapon);
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
  if (spear) { x = 0.32; y = -0.62; z = -0.5; rx = limp ? -0.85 : -1.2; rz = 0.04; }   // a spear is held pointing forward, a limp one sags
  if (cb.draw) { const f = Math.min(1, cb.draw.t / wstats().draw); x = 0.2; y = -0.38; z = -0.8 + 0.18 * f; rx = 0.05; rz = 0.02; }   // the bow is raised and the string drawn back
  if (cb.block) { x = 0.05; y = -0.36; z = -0.62; rx = -0.05; rz = 0; }
  if (inv.swapT > 0) y -= 0.5 * Math.sin(inv.swapT / SWAP_TIME * Math.PI);
  let k = 1 - Math.exp(-16 * dt);
  if (cb.atk) {
    const w = wstats(), p = Math.min(1, cb.atk.t / w.dur), s = Math.sin(p * Math.PI);
    if (spear) { x -= 0.08 * s; z -= 0.9 * s; y += 0.06 * s; }              // a thrust, not a swing
    else { x -= 0.6 * s; z -= 0.25 * s; rx -= 1.25 * s; rz += 0.7 * s; }
    k = 1;
  }
  // Keep the weapon out of walls and furniture: pull it back toward the camera by however far it
  // would reach past the nearest obstacle (a swing reaches much farther than the rest pose).
  const pull = Math.max(0, Math.min(1.3, (cb.atk ? 1.9 : 0.95) - freeAhead()));
  z += pull; y -= pull * 0.15; rx += pull * 0.5;
  if (limp) { const t = performance.now() / 1000; rz += Math.sin(t * 1.7) * 0.05; rx += Math.sin(t * 1.1) * 0.03; }   // it dangles and sways
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
  if (o.p.kind === 'chest') { const t = o.p.tier | 0; return { label: `Open ${CHEST_NAMES[t]}`, time: 0.9 + 0.15 * t }; }   // better chests take a little longer
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
  if (o.p.kind === 'merchant') { shopUI.open(); return; }
  loud((SEARCH_NOISE[o.p.kind] || 0) + (o.p.kind === 'chest' ? 0.5 * (o.p.tier | 0) : 0));
  if (o.p.kind === 'chest') discover('item:chest', 'Chests');
  if (o.p.kind === 'door') {
    inv.remove(inv.pack.find(i => i.type === 'key' && i.lock === o.p.lock));
    openDoor(o);
    flash(`Unlocked the ${o.p.room}`);
    return;
  }
  const drops = o.p.left || (o.p.fixed ? [{ type: 'potion', kind: o.p.fixed, n: 1 }] : [...rollLoot(o.p.kind, floorNum, makeRng(o.p.seed), o.p.bonus || 0, o.p.gear || [], o.p.type, o.p.tier), ...(o.p.extra || [])]);
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
    const name = !it ? '' : it.type === 'potion' || it.type === 'food' ? `${itemName(it)} x${it.n}` : it.type === 'wand' || it.type === 'rage' ? `${itemName(it)} (${it.charges})` : it.base === 'spear' ? `${itemName(it)} (${isLimp(it) ? 'LIMP' : it.charges})` : itemName(it);
    const c = it ? itemColor(it) : '#fff5';
    return `<div class="slot" style="border-color:${c}"><i>${i + 1}</i><span style="color:${c}">${name || '&nbsp;'}</span></div>`;
  }).join('');
  const w = inv.equip.weapon;
  const arm = ['head', 'body', 'legs'].map(z => `${z[0].toUpperCase()}${Math.round(inv.armorRed(z) * 100)}`).join(' ');
  const buffs = Object.entries(inv.buffs).map(([k, t]) => `${k} ${Math.ceil(t)}s`)
    .concat(pst.list().map(([k, t]) => `<span style="color:${STATUS[k].color}">${STATUS[k].name} ${Math.ceil(t)}s</span>`)).join(' &middot; ');
  const line = `<span style="color:${itemColor(w)}">${itemName(w)}${w.type === 'wand' ? ` (${w.charges})` : w.base === 'spear' ? (isLimp(w) ? ' (LIMP)' : ` (${w.charges} kills left)`) : ''}</span>${inv.equip.offhand ? ` + <span style="color:${itemColor(inv.equip.offhand)}">${itemName(inv.equip.offhand)}</span>${wstats().ranged ? ' (stowed)' : ''}` : ''}${inv.swapT > 0 ? ' (swapping)' : ''} &middot; Armor ${arm}% &middot; Arrows ${inv.arrows}/${QUIVER_MAX} &middot; Gold ${inv.gold} &middot; Pack ${inv.pack.length}/${PACK_MAX}${hunger.stage === 'fed' ? '' : ` &middot; <span style="color:#e08a2a">${hunger.stage[0].toUpperCase() + hunger.stage.slice(1)}</span>`}${buffs ? '<br>' + buffs : ''}`;
  const key = slots + line + inv.hp;
  if (key === hudKey) return;
  hudKey = key;
  el('slots').innerHTML = slots;
  el('line').innerHTML = line;
}

const ambient = new THREE.HemisphereLight(0xfff0dc, 0x2a2018, 0.62);   // warm from above, dark from below: faces get a little shape
const torch = new THREE.PointLight(theme.light, 0.75, 16, 1.6);   // player lantern, brighter than the ambient so rooms read
scene.add(ambient);
camera.add(torch);

// The armory is on one random floor of the run, picked from the seed. It is always a locked room.
const armoryFloor = makeRng((runSeed ^ 0x5bd1e995) >>> 0).int(1, MAX_FLOOR - 1);   // never the boss floor, which has no rooms
let respawnT = Infinity, baseGuards = 0;

function disposeGroup(g) {   // free a floor's GPU memory: geometry, materials and their textures
  g.traverse(o => {
    if (o.geometry) o.geometry.dispose();
    for (const m of [].concat(o.material || [])) { if (m.map) m.map.dispose(); m.dispose(); }
  });
}
// Keep the floor you are on so you can come back to it exactly as you left it.
function saveFloor() {
  arrows.forEach(a => group.remove(a.mesh)); arrows.length = 0;
  floorCache[floorNum] = { floor, group, stairBox, upBox, stairsLight, upLight, propObjs, decorObjs, enemies, torchPts, cullChunks, explored, WALL_H, baseGuards, respawnT };
  scene.remove(group);
}
function loadFloor(n, c) {
  floorNum = n; delete floorCache[n];
  ({ floor, group, stairBox, upBox, stairsLight, upLight, propObjs, decorObjs, enemies, torchPts, cullChunks, explored, WALL_H, baseGuards, respawnT } = c);
  scene.add(group);
  enemies.forEach(e => { e.cone.visible = dev.on; });
  Enemy.all = enemies; player.props = propObjs; player.mobs = enemies;
  updateCulling(player, cullChunks, propObjs, enemies);
}
// Put the player beside the stairs they came by: 'down' = came down, so appear by the stairs up; 'up' = came up, by the stairs down.
function arriveBy(dir) {
  const anchor = dir === 'up' ? floor.stairs : floor.start, w = floor.w;
  const ok = (x, y) => floor.tiles[y * w + x] === T_FLOOR && !floor.blocked[y * w + x];
  const pref = dir === 'down' && floor.up ? [[0, floor.up.dir], [0, -floor.up.dir], [1, 0], [-1, 0]] : [[0, 1], [0, -1], [1, 0], [-1, 0]];
  const nb = pref.find(([dx, dy]) => ok(anchor.x + dx, anchor.y + dy));
  if (!nb) { player.place(floor); return; }
  player.x = (anchor.x + nb[0] + 0.5) * TILE; player.z = (anchor.y + nb[1] + 0.5) * TILE;
  player.vx = player.vz = 0; player.pitch = 0;
  player.yaw = Math.atan2(-nb[0], -nb[1]);                     // face away from the stairs
}
function floorBanner(n) {
  el('boss').firstElementChild.textContent = bossNameFor(theme.name);
  if (n === 1 && THEME_HINT[theme.name]) addLog(THEME_HINT[theme.name], '#9ac8ff');
  hud.floor.textContent = `Floor ${n} / ${MAX_FLOOR}` + (n === MAX_FLOOR ? ' (boss floor)' : '');
}

// A brand new floor n (also what the dev keys and the tests use): any old copy of it is thrown away.
function startFloor(n) {
  if (floorCache[n]) { disposeGroup(floorCache[n].group); delete floorCache[n]; }
  generateAndEnter(n, n > 1 ? 'down' : null);
  const locked = floor.doors.map(d => d.room).join(', ');
  if (floor.boss) flash('The boss arena. Something huge sleeps in the middle. One healing potion hides along the walls.');
  else flash(`${n === 1 ? '' : `Floor ${n}. `}Find the stairs.${locked ? ` Locked: ${locked}. Keys hide in chests.` : ''}`);
}
function generateAndEnter(n, arrive) {
  gameRng = makeRng(((runSeed ^ 0x6a09e667) >>> 0) + n * 69069);   // gameplay RNG for this floor (guard zones, procs, respawns)
  floorNum = n;
  floor = generateFloor(runSeed, n, { armory: n === armoryFloor, boss: n === MAX_FLOOR, shop: n === shopFloor, themeName: theme.name });
  assignEnemyTypes(floor, runSeed, n, theme.name);          // natives, rat packs, wolves and their handlers (js/enemytypes.js)
  if (floor.boss) { const b = floor.enemies.find(e => e.boss), tb = THEME_BOSS[theme.name]; if (b && tb) { b.dress = tb.dress; b.skin = tb.skin; } }   // each theme's boss has its own look
  floor.patches = new Map(floor.decor.filter(d => PATCH_KINDS.includes(d.kind)).map(d => [d.y * floor.w + d.x, d.kind]));   // the theme's floor gimmick, by tile
  WALL_H = floor.boss ? BOSS_WALL_H : 3.6;
  explored = new Uint8Array(floor.w * floor.h);
  buildFloor();
  player.props = propObjs;
  player.mobs = enemies;
  search = null;
  arrows.length = 0;                                  // the old floor's group (and its arrows) is gone
  cb.draw = null;
  if (arrive) arriveBy(arrive); else player.place(floor);
  updateCulling(player, cullChunks, propObjs, enemies);
  baseGuards = floor.enemies.length;
  respawnT = n >= 3 && !floor.boss ? 35 + gameRng() * 35 : Infinity;   // from floor 3 on, guards keep turning up (not in the boss arena)
  floorBanner(n);
}

// Take the stairs. The floor you leave is kept; the one you arrive on is restored if you have been there, else built.
// dir: 'down' (you go to floor n and arrive by its stairs up) or 'up' (you arrive by its stairs down).
function changeFloor(n, dir) {
  saveFloor();
  search = null; cb.draw = null; cb.eat = null;
  const c = floorCache[n];
  if (c) {
    loadFloor(n, c); arriveBy(dir); floorBanner(n);
    flash(`${dir === 'up' ? 'You climb back up to' : 'Back down on'} floor ${n}.`);
  } else {
    group = null;                                     // the floor we left is cached: buildFloor must not dispose it
    generateAndEnter(n, dir);
    const locked = floor.doors.map(d => d.room).join(', ');
    if (floor.boss) flash('The boss arena. Something huge sleeps in the middle. One healing potion hides along the walls.');
    else flash(`Floor ${n}. Find the stairs.${locked ? ` Locked: ${locked}. Keys hide in chests.` : ''}`);
  }
  hunger.fight = 0;
}

// Floors 3 and deeper: every 35 to 70 seconds a guard appears in a room you cannot see, up to 1.5x the floor's guard count.
function updateRespawn(dt) {
  if (floorNum < 3 || floor.boss) return;
  respawnT -= dt;
  if (respawnT > 0) return;
  respawnT = 35 + gameRng() * 35;
  if (enemies.filter(e => !e.dead).length >= Math.ceil(baseGuards * 1.5)) return;
  const open = floor.rooms.filter(r => !r.locked && r.theme !== 'shop');
  const homes = open.filter((r, i) => r !== floor.rooms[0]
    && Math.hypot((r.cx + 0.5) * TILE - player.x, (r.cy + 0.5) * TILE - player.z) > 24
    && !hasLOS(floor, player.x, player.z, (r.cx + 0.5) * TILE, (r.cy + 0.5) * TILE));
  if (!homes.length) { respawnT = 8; return; }
  const pick = arr => arr[Math.floor(gameRng() * arr.length)];
  const a = roomPoint(floor, pick(homes), Math.floor(gameRng() * 8)), b = roomPoint(floor, pick(open), Math.floor(gameRng() * 8));
  const e = new Enemy({ x: a.x, y: a.y, route: [a, b], seed: (gameRng() * 4294967296) >>> 0, type: respawnType(theme.name, floorNum, gameRng) }, floor);
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

function drawMinimap(step = 1) {
  const S = hud.mini.width / floor.w;
  mctx.fillStyle = '#000'; mctx.fillRect(0, 0, hud.mini.width, hud.mini.height);
  for (let y = 0; y < floor.h; y++) for (let x = 0; x < floor.w; x++) {
    if (!explored[y * floor.w + x]) continue;
    const t = floor.tiles[y * floor.w + x];
    mctx.fillStyle = t === T_WALL ? '#2a2a33' : t === T_STAIRS ? '#ffd24a' : t === T_START && floor.up ? '#5aa0ff' : t === T_DOOR ? '#c0702a' : '#6a6a78';   // gold: the way down, blue: the way back up
    mctx.fillRect(x * S, y * S, S + 0.5, S + 0.5);
  }
  if (dev.on) for (const e of enemies) {
    if (e.dead) continue;
    mctx.fillStyle = e.state === 'alerted' ? '#ff3a3a' : e.state === 'unaware' ? '#e07a3a' : '#ffc23a';
    mctx.beginPath(); mctx.arc(e.x / TILE * S, e.z / TILE * S, 2.5, 0, 7); mctx.fill();
  }
  if (dev.on) for (let i = rings.length - 1; i >= 0; i--) {   // noise rings fade as they pass
    const n = rings[i]; n.t += step / 60;
    if (n.t > 0.6) { rings.splice(i, 1); continue; }
    mctx.strokeStyle = `rgba(120,200,255,${1 - n.t / 0.6})`;
    mctx.beginPath(); mctx.arc(n.x / TILE * S, n.z / TILE * S, n.r / TILE * S * (0.3 + n.t / 0.6 * 0.7), 0, 7); mctx.stroke();
  } else rings.length = 0;
  for (const o of propObjs) {
    if (o.p.opened || !explored[o.p.y * floor.w + o.p.x]) continue;
    mctx.fillStyle = o.p.kind === 'chest' ? TIERS[o.p.tier | 0].color : o.p.kind === 'merchant' ? '#6cf' : '#b08a5a';   // a chest's dot is its grade colour
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
// 0 off the stairs up, 1 at the top step; the eye rises as you climb
function upProgress() {
  const b = upBox;
  if (!b || player.x < b.x0 || player.x > b.x1 || player.z < b.z0 || player.z > b.z1) return 0;
  const t = b.dir > 0 ? (b.z1 - player.z) / (b.z1 - b.z0) : (player.z - b.z0) / (b.z1 - b.z0);
  return Math.max(0.02, Math.min(1, t));
}
function eyeY() { return player.eye - stairProgress() * STAIR_DEPTH + upProgress() * UP_RISE; }

let sealedMsgT = 0;
function checkStairs() {
  if (floor.boss && enemies.some(e => e.boss && !e.dead) && stairProgress() > 0.25) {   // sealed until the boss falls
    player.z = stairBox.z0 - 0.45; player.vz = 0;
    if (performance.now() - sealedMsgT > 2500) { sealedMsgT = performance.now(); flash('The way down is sealed until the boss falls.'); }
    return;
  }
  if (upProgress() >= 0.85 && floorNum > 1) { changeFloor(floorNum - 1, 'up'); return; }   // climbed back up
  if (stairProgress() < 0.85) return;
  if (floorNum < MAX_FLOOR) changeFloor(floorNum + 1, 'down');
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
let last = performance.now(), frameNo = 0, dazeOn = false, frameCount = 0;
const perfStats = { logic: 0 };   // average milliseconds of game logic per frame (everything but drawing), for the tests
function frame(now) {
  const dt = (now - last) / 1000; last = now; const tl0 = performance.now();
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
    if (pulse > 0) { events.push({ x: player.x, z: player.z, r: pulse * HUSH }); rings.push({ x: player.x, z: player.z, r: pulse * HUSH, t: 0 }); }
    if (player.noiseRadius > 0) events.push({ x: player.x, z: player.z, r: player.noiseRadius * HUSH });
    const under = floor.patches.get(player.tileY * floor.w + player.tileX);
    if (under === 'bell') {                                                                                          // a tripwire bell: one loud alarm, then it is spent
      floor.patches.delete(player.tileY * floor.w + player.tileX);
      const bo = decorObjs.find(o => o.kind === 'bell' && o.p.x === player.tileX && o.p.y === player.tileY); if (bo) bo.mesh.visible = false;
      events.push({ x: player.x, z: player.z, r: 14 }); rings.push({ x: player.x, z: player.z, r: 14, t: 0 });
      discover('item:bell', 'Tripwire bells'); flash('DING! A tripwire bell rings.');
    }
    if (player.noiseRadius > 0 && under === 'puddle') {   // shallow water: a moving step splashes, even a crouched one
      const r = player.crouching ? 4 : 8;
      events.push({ x: player.x, z: player.z, r }); rings.push({ x: player.x, z: player.z, r, t: 0 });
      if (discover('item:puddle', 'Shallow water')) flash('Splash! Shallow water carries sound.');
    }
    pulse = 0;
    const noise = { events, emit: (x, z, r, src) => pending.push({ x, z, r, src }), shoot: spawnEnemyShot, steal: stealGold };
    for (const e of enemies) { const zone = e.update(Math.min(dt, 0.05), player, noise); if (zone) resolveEnemyAttack(e, zone); }
    separateBodies(enemies, player, floor);
    for (const e of enemies) if (e.dead && !e.corpseDone) { if (e.boss) bossDefeated(e); else makeCorpse(e, false); addLog(`The ${e.T.name.toLowerCase()} ${e.cause}.`, '#ff6a6a'); }
    reveal();
    if ((frameNo = (frameNo + 1) % 15) === 0) discoverEnemiesInView();
    checkStairs();
    checkShopSight();
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
  frameCount++;
  if (frameCount % 3 === 0) updateCulling(player, cullChunks, propObjs, enemies);
  if (frameCount % 2 === 0) updateTorches(now);                  // the lights drift slowly: every other frame is plenty
  if (frameCount % 3 === 0) drawMinimap(3);                      // and the minimap three times a second per 9 frames, not every frame
  updateHud();
  perfStats.logic = perfStats.logic * 0.95 + (performance.now() - tl0) * 0.05;
  if (!params.has('norender')) { renderer.render(scene, camera); if (state === 'play') adaptQuality(dt, r => { renderer.setPixelRatio(r); resize(); }); }   // ?norender=1: tests skip the (software) drawing and keep all the game logic
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);

// Debug hook for testing from the console.
window.game = {
  player, startFloor, inv, cb, pst, hunger, arrows, floorCache, perfStats, shopFloor, renderInfo() { camera.position.set(player.x, eyeY(), player.z); camera.rotation.set(player.pitch, player.yaw, 0); updateCulling(player, cullChunks, propObjs, enemies); renderer.render(scene, camera); return { calls: renderer.info.render.calls, tris: renderer.info.render.triangles, geos: renderer.info.memory.geometries, tex: renderer.info.memory.textures }; }, get shopUI() { return shopUI; }, get rings() { return rings; }, get floor() { return floor; }, get enemies() { return enemies; }, get state() { return state; },
  draw() {
    camera.position.set(player.x, eyeY(), player.z);
    camera.rotation.set(player.pitch, player.yaw, 0);
    updateViewmodel(1); updateCulling(player, cullChunks, propObjs, enemies); updateTorches(performance.now()); drawMinimap(); renderer.render(scene, camera);
  },
};
