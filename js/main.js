// Scene building, HUD, minimap, and the floor-to-floor loop.
const MAX_FLOOR = 5;       // floors per stage: floorNum is the floor WITHIN the stage, and floor 5 is the stage's boss arena (with the safe room)
const STAGES = 4, FINAL_STAGE = 5;   // 4 themed stages, then stage 5: one boss arena with the placeholder final boss
const params = new URLSearchParams(location.search);
const runSeed = params.has('seed') ? (parseInt(params.get('seed'), 10) >>> 0) : (Math.random() * 4294967296) >>> 0;
// Stage 1 keeps the theme the seed always picked; stages 2 to 4 take three other themes, shuffled from the seed (no repeats).
const stageThemes = (() => { const t0 = makeRng(runSeed).pick(THEMES); return [t0, ...makeRng((runSeed ^ 0x7e3a11) >>> 0).shuffle(THEMES.filter(t => t !== t0)).slice(0, STAGES - 1)]; })();
let stage = 1, stageSeed = runSeed, theme = stageThemes[0];   // stageSeed is the run seed for stage 1 (so stage 1 generates exactly as before) and a seeded mix of it for the others

const canvas = document.getElementById('game');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
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
const stageCaches = { 1: {} };   // stage -> the floors you have left there, kept exactly as they were (guards, opened chests, bodies, explored map); bounded by trimCaches
let floorCache = stageCaches[1];   // the current stage's, keyed by floor within the stage
const bossDead = {}, prisonerRuns = {};   // per stage: its boss is dead (a rebuilt arena has no boss and an open door); its prisoner's state
const SAFE_CEIL = 4;       // the safe room's ceiling height (m)
const BOSS_WALL_H = 10;    // the arena ceiling, so the boss (about 3 m tall) has room
const STAIR_HALF_W = 1.1, STAIR_HALF_L = 1.3, STAIR_DEPTH = 1.5, UP_RISE = 1.4;   // the way down sinks 1.5 m; the way back up rises 1.4 m
let state = 'menu';        // menu | play | won
let msgTimer = 0;
const PATCH_KINDS = THEME_DEFS.filter(t => t.mechanic.n).map(t => t.mechanic.kind);   // the decal kinds the themes' mechanics place (puddle, grass, glowcap, bell, ice)
let HUSH = theme.mechanic.hush || 1;           // the Library's dead silence: every sound you make carries farther
// Mechanic handlers, by the theme's mechanic.kind: what standing on a decal of that kind does to the player (hot path: one lookup a frame, no allocation).
//   slippery: you slide.  seen: multiplier on how far guards see you.  disc: glossary entry.
const MECH_PATCH = {
  grass:   { seen: () => player.crouching ? 0.55 : 0.85, disc: ['item:grass', 'Tall grass'] },
  glowcap: { seen: () => 1.4, disc: ['item:glow', 'Glowing spores'] },
  ice:     { slippery: true, disc: ['item:ice', 'Ice'] },
  brush:   { seen: () => { const t = theme.mechanic.TUNE; return player.crouching ? t.stealthCrouch : t.stealth; }, disc: ['item:brush', 'Thick brush'] },   // the Jungle: a player-only stealth bonus (enemies see through it as ever)
};
const stageSeedOf = s => s === 1 ? runSeed : (runSeed ^ Math.imul(s, 0x9e3779b1)) >>> 0;
let shopFloor = 0, armoryFloor = 0, questPlan = {};
// This stage's plan, all seeded: its shop floor (not the boss arena; the player is not told which), its armory floor, and which floors carry an optional encounter (js/quests.js).
function planStage(s) {
  stageSeed = stageSeedOf(s);
  shopFloor = makeRng((stageSeed ^ 0x51ed270b) >>> 0).int(1, MAX_FLOOR - 1);
  armoryFloor = makeRng((stageSeed ^ 0x5bd1e995) >>> 0).int(1, MAX_FLOOR - 1);   // never the boss floor, which has no rooms
  questPlan = rollQuests(stageSeed, MAX_FLOOR, shopFloor);
}
planStage(1);
function effFloor(n = floorNum) { return n + TUNE.stageLootDepth * (stage - 1); }   // loot depth: tiers, gold, potions and shop stock follow this, not the floor alone

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
// Jungle and Frozen Chapel textures: 256 px (ceilings 128), painted once per theme (themeTexture) from the theme's colours.
function paintTex(base, tag, S, fn, repeat = 1) {
  const c = document.createElement('canvas'); c.width = c.height = S; const g = c.getContext('2d'), rng = makeRng(hashStr(base + tag)), col = new THREE.Color(base);
  fn(g, S, rng, col); return finishTexture(c, repeat, repeat);
}
const blob = (g, x, y, rx, ry, style) => { g.fillStyle = style; g.beginPath(); g.ellipse(x, y, rx, ry, 0, 0, 7); g.fill(); };
// Vine stone: rough blocks, moss in the joints, vines hanging down with small leaves.
const vineWallTexture = base => paintTex(base, 'vine', 256, (g, S, rng, col) => {
  g.fillStyle = shade(col, 0.4); g.fillRect(0, 0, S, S);
  for (let r = 0; r < 6; r++) for (let b = -1; b < 4; b++) { const x = b * 64 + (r % 2 ? 32 : 0) + (rng() - 0.5) * 6, y = r * 43 + (rng() - 0.5) * 4; g.fillStyle = shade(col, 0.55 + rng() * 0.35); g.fillRect(x + 2, y + 2, 60, 39); }
  for (let i = 0; i < 40; i++) blob(g, rng() * S, rng() * S, 4 + rng() * 14, 3 + rng() * 8, `rgba(70,130,40,${0.1 + rng() * 0.25})`);   // moss
  for (let v = 0; v < 9; v++) {                                                                                                               // vines
    let x = rng() * S; g.strokeStyle = 'rgba(30,80,22,0.85)'; g.lineWidth = 1.5 + rng() * 1.5; g.beginPath(); g.moveTo(x, 0);
    for (let y = 0; y < S; y += 32) { x += (rng() - 0.5) * 16; g.lineTo(x, y + 32); blob(g, x + (rng() - 0.5) * 8, y + 20, 5, 2.5, 'rgba(60,140,40,0.9)'); } g.stroke();
  }
  speckle(g, S, 1200, rng);
  const gr = g.createLinearGradient(0, 0, 0, S); gr.addColorStop(0, 'rgba(0,0,0,0.3)'); gr.addColorStop(0.14, 'rgba(0,0,0,0)'); gr.addColorStop(0.86, 'rgba(0,0,0,0)'); gr.addColorStop(1, 'rgba(0,0,0,0.4)'); g.fillStyle = gr; g.fillRect(0, 0, S, S);
});
// Cave rock (the Jungle's locked rooms): dark, lumpy, no mortar.
const caveWallTexture = base => paintTex(base, 'cave', 256, (g, S, rng, col) => {
  g.fillStyle = shade(col, 0.22); g.fillRect(0, 0, S, S);
  for (let i = 0; i < 90; i++) blob(g, rng() * S, rng() * S, 8 + rng() * 26, 6 + rng() * 18, `rgba(${20 + rng() * 30 | 0},${20 + rng() * 26 | 0},${16 + rng() * 20 | 0},0.5)`);
  for (let i = 0; i < 14; i++) blob(g, rng() * S, rng() * S, 3 + rng() * 8, 2 + rng() * 4, 'rgba(60,110,40,0.25)');
  speckle(g, S, 1400, rng);
});
// Moss floor: dirt with soft green mottling and fallen leaves.
const mossFloorTexture = base => paintTex(base, 'moss', 256, (g, S, rng, col) => {
  g.fillStyle = shade(col, 0.7); g.fillRect(0, 0, S, S);
  for (let i = 0; i < 70; i++) blob(g, rng() * S, rng() * S, 6 + rng() * 22, 5 + rng() * 14, rng() < 0.6 ? `rgba(70,120,40,${0.15 + rng() * 0.25})` : `rgba(60,40,24,${0.15 + rng() * 0.2})`);
  for (let i = 0; i < 40; i++) blob(g, rng() * S, rng() * S, 2 + rng() * 3, 1 + rng() * 1.5, `rgba(${120 + rng() * 60 | 0},${130 + rng() * 40 | 0},40,0.6)`);
  speckle(g, S, 1600, rng);
});
// Canopy ceiling: dark leaves with lighter gaps where the light gets through.
const canopyTexture = base => paintTex(base, 'canopy', 128, (g, S, rng, col) => {
  g.fillStyle = shade(col, 0.7); g.fillRect(0, 0, S, S);
  for (let i = 0; i < 70; i++) blob(g, rng() * S, rng() * S, 4 + rng() * 10, 2 + rng() * 5, `rgba(${30 + rng() * 40 | 0},${80 + rng() * 60 | 0},${30 + rng() * 20 | 0},0.7)`);
  for (let i = 0; i < 9; i++) blob(g, rng() * S, rng() * S, 3 + rng() * 5, 3 + rng() * 5, 'rgba(230,240,150,0.5)');
}, 1);
// Ice blocks: pale blue blocks with bright edges, hairline cracks and frost.
const iceWallTexture = base => paintTex(base, 'ice', 256, (g, S, rng, col) => {
  g.fillStyle = shade(col, 0.5); g.fillRect(0, 0, S, S);
  for (let r = 0; r < 8; r++) for (let b = -1; b < 4; b++) {
    const x = b * 64 + (r % 2 ? 32 : 0), y = r * 32, k = 0.8 + rng() * 0.3;
    g.fillStyle = shade(col, k); g.fillRect(x + 1.5, y + 1.5, 61, 29); g.fillStyle = 'rgba(255,255,255,0.22)'; g.fillRect(x + 1.5, y + 1.5, 61, 2); g.fillStyle = 'rgba(20,50,90,0.14)'; g.fillRect(x + 1.5, y + 28, 61, 2);
  }
  g.strokeStyle = 'rgba(255,255,255,0.5)'; g.lineWidth = 1;
  for (let i = 0; i < 12; i++) { let x = rng() * S, y = rng() * S; g.beginPath(); g.moveTo(x, y); for (let k = 0; k < 4; k++) { x += (rng() - 0.5) * 30; y += 8 + rng() * 14; g.lineTo(x, y); } g.stroke(); }
  for (let i = 0; i < 700; i++) { g.fillStyle = 'rgba(255,255,255,0.18)'; g.fillRect(rng() * S, rng() * S, 1 + rng() * 1.5, 1 + rng() * 1.5); }
  const gr = g.createLinearGradient(0, 0, 0, S); gr.addColorStop(0, 'rgba(0,0,0,0.22)'); gr.addColorStop(0.12, 'rgba(0,0,0,0)'); gr.addColorStop(0.88, 'rgba(0,0,0,0)'); gr.addColorStop(1, 'rgba(0,0,0,0.3)'); g.fillStyle = gr; g.fillRect(0, 0, S, S);
});
// Frosted nave floor: flagstones under a skin of frost with drifted snow in the joints.
const frostFloorTexture = base => paintTex(base, 'frost', 256, (g, S, rng, col) => {
  g.fillStyle = shade(col, 0.45); g.fillRect(0, 0, S, S);
  for (let r = 0; r < 3; r++) for (let q = 0; q < 3; q++) for (const dx of [0, -85]) { const x = q * 85 + (r % 2 ? 30 : 0) + dx, y = r * 85, k = 0.85 + rng() * 0.3; g.fillStyle = shade(col, k); g.fillRect(x + 2, y + 2, 81, 81); g.fillStyle = 'rgba(255,255,255,0.12)'; g.fillRect(x + 2, y + 2, 81, 2); }
  for (let i = 0; i < 40; i++) blob(g, rng() * S, rng() * S, 6 + rng() * 20, 4 + rng() * 12, `rgba(235,245,255,${0.08 + rng() * 0.16})`);
  for (let i = 0; i < 900; i++) { g.fillStyle = 'rgba(255,255,255,0.2)'; g.fillRect(rng() * S, rng() * S, 1 + rng() * 1.5, 1 + rng() * 1.5); }
});
// Chapel vault ceiling: pale stone ribs.
const vaultTexture = base => paintTex(base, 'vault', 128, (g, S, rng, col) => {
  g.fillStyle = shade(col, 0.8); g.fillRect(0, 0, S, S);
  for (let i = 0; i < 4; i++) { g.fillStyle = shade(col, 1.15); g.fillRect(i * 32 + 14, 0, 4, S); g.fillRect(0, i * 32 + 14, S, 4); }
  speckle(g, S, 400, rng);
});
// Texture generators by the theme schema's tex keys (theme.tex.wall / floor / ceil), each from the theme's base colour.
const TEX_GENERATORS = {
  wall:  { stone: c => wallTexture(c), vine: c => vineWallTexture(c), iceblock: c => iceWallTexture(c), cave: c => caveWallTexture(c) },
  floor: { tile: c => floorTexture(c, false), planks: c => floorTexture(c, true), moss: c => mossFloorTexture(c), frost: c => frostFloorTexture(c) },
  ceil:  { beams: c => ceilingTexture(c), canopy: c => canopyTexture(c), vault: c => vaultTexture(c) },
};
// Wall geometry by the theme's wallStyle (up to 3 wall InstancedMeshes in all). 'rough' (Jungle): a box whose side faces bulge a little (a hash of each vertex, so shared corners stay closed);
// every tile is also turned a quarter-turn at random and widened a hair (buildFloor), so a wall does not look stamped.
const WALL_GEO = {
  box: () => new THREE.BoxGeometry(TILE, WALL_H, TILE),
  rough: () => {
    const g = new THREE.BoxGeometry(TILE, WALL_H, TILE, 2, 3, 2), p = g.attributes.position;
    for (let i = 0; i < p.count; i++) {
      const x = p.getX(i), y = p.getY(i), z = p.getZ(i), s = Math.sin(x * 12.9898 + y * 78.233 + z * 37.719) * 43758.5453, k = 1 + (s - Math.floor(s)) * 0.09 - 0.015;
      p.setXYZ(i, x * k, y, z * k);
    }
    g.computeVertexNormals(); return g;
  },
};
// Door open animations by the theme's doors.openAnim: t runs 0 to 1. slide: up out of the way. roll (cave mouth): the curtain and boulders roll up to the lintel. sink (ice seal): the slab drops through the floor.
const DOOR_ANIM = {
  slide: (o, t) => { o.mesh.position.y = t * WALL_H; },
  roll: (o, t) => { const s = 1 - 0.95 * t; o.mesh.scale.y = s; o.mesh.position.y = (1 - s) * WALL_H + t * 0.5; },   // (the last 0.5 m lifts the rolled-up sliver above the ceiling plane, so a culling pass that shows the mesh again cannot reveal it)
  sink: (o, t) => { o.mesh.position.y = -t * (WALL_H + 0.2); },
};

// Free one object's GPU memory. Anything flagged userData.shared (the per-theme textures, creature part geometries, shared merged
// materials, icons) outlives the floor and is never disposed here.
function freeObject(o) {
  if (o.geometry && !o.geometry.userData.shared) o.geometry.dispose();
  const ms = o.material; if (!ms) return;
  if (Array.isArray(ms)) { for (const m of ms) freeMaterial(m); } else freeMaterial(ms);
}
function freeMaterial(m) { if (m.userData.shared) return; if (m.map && !(m.map.userData && m.map.userData.shared)) m.map.dispose(); m.dispose(); }
// Floor, wall and ceiling textures are painted once per theme and shared by every floor of it. A theme's are freed when no cached
// floor of it is left (pruneThemeTextures, after a stage change).
// The wall, floor and ceiling materials are shared the same way (a floor that is rebuilt would otherwise free the shader programs
// and compile them again on its first frame).
const themeTex = new Map();
function themeTexture(kind, make) {
  const key = theme.name + '|' + kind;
  let t = themeTex.get(key); if (!t) { t = make(); t.userData = { shared: true }; themeTex.set(key, t); }
  return t;
}
const sharedLams = new Map();   // plain lit materials of the stairs, shared by every floor
function sharedLam(c) { let m = sharedLams.get(c); if (!m) { m = new THREE.MeshLambertMaterial({ color: c }); m.userData.shared = true; sharedLams.set(c, m); } return m; }
function pruneThemeTextures() {
  const live = new Set([theme.name]);
  for (const k of Object.keys(stageCaches)) if (Object.keys(stageCaches[k]).length) live.add((+k === FINAL_STAGE ? FINAL_THEME : stageThemes[k - 1]).name);
  for (const [key, t] of themeTex) if (!live.has(key.split('|')[0])) { t.dispose(); themeTex.delete(key); }   // (a material's map is its own entry, so disposing both is fine)
}

function buildFloor() {
  if (group) {   // free the old floor's GPU memory: geometry, materials and their textures
    scene.remove(group);
    group.traverse(freeObject);
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
  const wallTex = themeTexture('wall', () => TEX_GENERATORS.wall[theme.tex.wall](theme.pal.wall));
  const rough = theme.wallStyle === 'rough', wallGeo = (WALL_GEO[theme.wallStyle] || WALL_GEO.box)();
  const m = new THREE.Matrix4(), wp = new THREE.Vector3(), wq = new THREE.Quaternion(), ws = new THREE.Vector3(), yAxis = new THREE.Vector3(0, 1, 0);
  const wallMesh = (list, mat) => {                // one InstancedMesh per wall material: at most 2 (plus the safe room's) draws
    const im = new THREE.InstancedMesh(wallGeo, mat, list.length);
    list.forEach(([x, y], i) => {
      if (rough) { const hh = ((x * 73856093) ^ (y * 19349663)) >>> 0, k = 1 + ((hh >> 2) & 7) * 0.006; wq.setFromAxisAngle(yAxis, (hh & 3) * Math.PI / 2); m.compose(wp.set((x + 0.5) * TILE, WALL_H / 2, (y + 0.5) * TILE), wq, ws.set(k, 1, k)); }
      else m.setPosition((x + 0.5) * TILE, WALL_H / 2, (y + 0.5) * TILE);
      im.setMatrixAt(i, m);
    });
    im.frustumCulled = false;                      // an instanced mesh is culled by its first box only, so never cull it
    group.add(im); return im;
  };
  let caveList = null;                             // the Jungle's locked rooms are dark caves: their walls (and a dark patch on the floor) use cave rock
  if (rough && floor.rooms.some(r => r.locked)) {
    const mask = new Uint8Array(w * h); caveList = [];
    for (const r of floor.rooms) if (r.locked) for (let y = r.y - 1; y <= r.y + r.h; y++) for (let x = r.x - 1; x <= r.x + r.w; x++) if (x >= 0 && y >= 0 && x < w && y < h) mask[y * w + x] = 1;
    for (let i = wallPos.length - 1; i >= 0; i--) if (mask[wallPos[i][1] * w + wallPos[i][0]]) caveList.push(wallPos.splice(i, 1)[0]);
  }
  const walls = wallMesh(wallPos, themeTexture('wallmat', () => new THREE.MeshPhongMaterial({ map: wallTex, shininess: 5, specular: 0x151515 })));   // per-pixel lighting: torch light pools smoothly across big faces
  if (caveList && caveList.length) {
    wallMesh(caveList, themeTexture('cavemat', () => new THREE.MeshPhongMaterial({ map: themeTexture('cavewall', () => TEX_GENERATORS.wall.cave('#3a3830')), shininess: 2, specular: 0x050505 })));
    const dark = themeTexture('cavedark', () => new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.45, depthWrite: false }));
    for (const r of floor.rooms) if (r.locked) { const p = new THREE.Mesh(new THREE.PlaneGeometry(r.w * TILE, r.h * TILE), dark); p.rotation.x = -Math.PI / 2; p.position.set((r.x + r.w / 2) * TILE, 0.02, (r.y + r.h / 2) * TILE); p.renderOrder = 1; group.add(p); }
  }

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
  const floorTex = themeTexture('floor', () => { const t = TEX_GENERATORS.floor[theme.tex.floor](theme.pal.floor); t.repeat.set(1 / TILE, 1 / TILE); return t; });
  const fl = new THREE.Mesh(new THREE.ShapeGeometry(floorShape), themeTexture('floormat', () => new THREE.MeshPhongMaterial({ map: floorTex, shininess: 12, specular: 0x222222 })));
  fl.rotation.x = -Math.PI / 2;
  const ceilTex = themeTexture('ceil', () => TEX_GENERATORS.ceil[theme.tex.ceil](theme.pal.ceil));   // one repeat per tile: the plane's UVs below carry the size, so the texture is shared by every floor
  { const uv = planeGeo.attributes.uv; for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * w, uv.getY(i) * h); }
  const ce = new THREE.Mesh(planeGeo, themeTexture('ceilmat', () => new THREE.MeshPhongMaterial({ map: ceilTex, shininess: 2, specular: 0x050505 })));
  ce.rotation.x = Math.PI / 2; ce.position.set(w * TILE / 2, WALL_H, h * TILE / 2);
  group.add(fl, ce);

  // stairwell: steps descending along +z into the hole, with side and end walls
  const stairMat = sharedLam(0x9a9284);
  const pitMat = sharedLam(0x1a1612);
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
  if (floorNum > 1 || stage > 1) {                         // (floor 1 of stage 2 and later leads back to the previous stage's safe room)
    const st = floor.start, open = (x, y) => floor.tiles[y * w + x] === T_FLOOR || floor.tiles[y * w + x] === T_START;
    const dir = open(st.x, st.y + 1) && !floor.blocked[(st.y + 1) * w + st.x] ? 1 : -1;      // which side you step on from
    const ux = (st.x + 0.5) * TILE, uz = (st.y + 0.5) * TILE;
    upBox = { x0: ux - STAIR_HALF_W, x1: ux + STAIR_HALF_W, z0: uz - STAIR_HALF_L, z1: uz + STAIR_HALF_L, dir };
    floor.up = { x: st.x, y: st.y, dir };
    const base = dir > 0 ? upBox.z1 : upBox.z0, steps = 6, ulen = STAIR_HALF_L * 2, uw = STAIR_HALF_W * 2;
    const stoneMat = sharedLam(0x8a8478), edgeMat = sharedLam(0xa8a294);
    for (let i = 0; i < steps; i++) {
      const hgt = (i + 1) * UP_RISE / steps, zc = base - dir * ((i + 0.5) * ulen / steps);
      const s = new THREE.Mesh(new THREE.BoxGeometry(uw, hgt, ulen / steps), stoneMat); s.position.set(ux, hgt / 2, zc); group.add(s);
      const lip = new THREE.Mesh(new THREE.BoxGeometry(uw + 0.06, 0.05, 0.1), edgeMat); lip.position.set(ux, hgt + 0.01, zc + dir * (ulen / steps / 2 - 0.05)); group.add(lip);   // a lighter nosing on each step
    }
    for (const side of [-1, 1]) {                                                           // low stone cheeks on both sides
      const ch = new THREE.Mesh(new THREE.BoxGeometry(0.16, UP_RISE + 0.5, ulen), stoneMat); ch.position.set(ux + side * (STAIR_HALF_W + 0.08), (UP_RISE + 0.5) / 2, uz); group.add(ch);
    }
    const top = new THREE.Mesh(new THREE.BoxGeometry(uw + 0.3, 0.3, 0.3), sharedLam(0x15120e)); top.position.set(ux, UP_RISE + 0.6, base - dir * ulen); group.add(top);   // a dark opening at the top
    upLight = new THREE.PointLight(0xa8c8ff, 0.3, 9); upLight.position.set(ux, 1.8, uz); group.add(upLight);                // a cool light from above
  } else group.add(new THREE.PointLight(0xa8c8ff, 0, 9));  // an unlit stand-in: the lit materials' shader depends on the light count, so every floor keeps the same count (no recompile hitch on the first floor with stairs up)

  propObjs = floor.props.map(p => { const o = makeProp(p); if (p.mimic) { o.mats.forEach(m => m.dispose()); o.mats = []; o.mesh = new THREE.Group(); } return o; });   // a mimic's chest is drawn by its enemy (below), so its prop is only the thing you search
  propObjs.forEach(o => group.add(o.mesh));
  floor.solids = [{ x: sx, z: sz, r: 1.5 }, ...propObjs.filter(o => !o.p.mimic).map(o => ({ x: o.x, z: o.z, r: o.r }))];   // what guards cannot walk through (a mimic is a body of its own): stairwell, props, furniture
  if (floor.up) floor.solids.push({ x: (floor.up.x + 0.5) * TILE, z: (floor.up.y + 0.5) * TILE, r: 1.5 });   // and the stairs up
  decorObjs = floor.decor.map(makeDecor);
  for (const o of decorObjs) {
    group.add(o.mesh);
    if (o.r > 0) { propObjs.push(o); if (o.r > 0.3) floor.solids.push({ x: o.x, z: o.z, r: o.r }); }   // small floor clutter (candles) never traps a guard   // rugs, bones and banners are flat or hung: no collision
  }
  for (const dr of floor.doors) { const o = makeDoor(dr); group.add(o.mesh); propObjs.push(o); }
  if (floor.shop) buildShop();
  if (floor.safe) buildSafeRoom(walls.material, ce.material);
  // thousands of tiny meshes become a few merged ones per 12 m chunk (tripwire bells stay separate: they hide when rung)
  cullChunks = mergeStatic(decorObjs.filter(o => o.kind !== 'bell').map(o => o.mesh), group);
  buildTorches();
  cullChunks.push(...mergeStatic(torchGroups, group));
  enemies = floor.enemies.map(s => new Enemy(s, floor));
  for (const o of propObjs) if (o.p.mimic) {                                           // each flagged chest is really a dormant mimic, standing exactly where the chest would
    const p = o.p, e = new Enemy({ x: p.x, y: p.y, route: [{ x: p.x, y: p.y }, { x: p.x, y: p.y }], seed: p.seed, type: 'mimic', tier: p.tier }, floor);
    e.x = o.x; e.z = o.z; e.route = [{ x: o.x, z: o.z }, { x: o.x, z: o.z }]; e.yaw = p.yaw + Math.PI; e.propObj = o; o.mimic = e;
    enemies.push(e);
  }
  Enemy.all = enemies;
  linkHandlers(enemies);
  enemies.forEach(e => { e.cone.visible = dev.on; group.add(e.mesh); });
  const fb = enemies.find(e => e.final); if (fb) nameTag(fb, FINAL_BOSS.tag, '#c060ff');                // the placeholder final boss says what it is
  questBuild(floor, { enemies, propObjs, decorObjs });                                  // the mini-boss's name tag, the shrine's altar spot, the wanted guard's tag and quest-giver, the sack thief

  floor.prints = theme.mechanic.prints && !floor.boss ? buildPrints() : null;
  scene.add(group);
  scene.background = new THREE.Color(theme.pal.fog);
  scene.fog = new THREE.FogExp2(theme.pal.fog, theme.fog.density);
}

// ---- Frozen Chapel footprints: the last 8 steps you took in the snow, one merged quad mesh over a ring buffer (no allocation after the floor is built).
// Guards that are not alerted follow a fresh print they can see (Enemy.followPrints in js/enemy.js), newest first. Numbers: theme.mechanic.TUNE (printAge, printSusp, printGap, printSight). ----
const PRINT_N = 8;
let gameT = 0;                                      // seconds of play, for the age of a print
function buildPrints() {
  const pos = new Float32Array(PRINT_N * 12), idx = [];
  for (let i = 0; i < PRINT_N; i++) idx.push(i * 4, i * 4 + 1, i * 4 + 2, i * 4, i * 4 + 2, i * 4 + 3);
  const geo = new THREE.BufferGeometry(); geo.setAttribute('position', new THREE.BufferAttribute(pos, 3)); geo.setIndex(idx);
  const mesh = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ color: 0x14202e, transparent: true, opacity: 0.5, depthWrite: false, side: THREE.DoubleSide }));
  mesh.frustumCulled = false; mesh.renderOrder = 1; group.add(mesh);
  return { list: Array.from({ length: PRINT_N }, () => ({ x: 0, z: 0, t: -1e9, id: 0 })), next: 0, id: 0, lx: 1e9, lz: 1e9, side: 1, chk: 0, pos, geo };
}
function layPrint(P, fx, fz) {                     // (fx, fz): the unit direction you are walking
  const p = P.list[P.next], a = P.next * 12, pos = P.pos, rx = -fz, rz = fx, ox = player.x + rx * 0.12 * P.side, oz = player.z + rz * 0.12 * P.side;
  p.x = player.x; p.z = player.z; p.t = gameT; p.id = ++P.id; P.side = -P.side;
  for (let k = 0; k < 4; k++) { const sx = k === 0 || k === 3 ? -1 : 1, sf = k < 2 ? -1 : 1; pos[a + k * 3] = ox + rx * 0.08 * sx + fx * 0.17 * sf; pos[a + k * 3 + 1] = 0.03; pos[a + k * 3 + 2] = oz + rz * 0.08 * sx + fz * 0.17 * sf; }
  P.geo.attributes.position.needsUpdate = true; P.next = (P.next + 1) % PRINT_N;
}
function updatePrints(dt) {
  const P = floor.prints, T = theme.mechanic.TUNE, vl = Math.hypot(player.vx, player.vz);
  if (vl > 0.5 && Math.hypot(player.x - P.lx, player.z - P.lz) >= T.printGap) { layPrint(P, player.vx / vl, player.vz / vl); P.lx = player.x; P.lz = player.z; }
  if ((P.chk -= dt) > 0) return;
  P.chk = 0.5;                                      // twice a second: wipe the prints that have faded
  for (let i = 0; i < PRINT_N; i++) if (P.list[i].t > -1e8 && gameT - P.list[i].t > T.printAge) { P.list[i].t = -1e9; P.pos.fill(0, i * 12, i * 12 + 12); P.geo.attributes.position.needsUpdate = true; }
}
// Jungle: an enemy standing in brush is drawn faint (its body material goes see-through) and is left off the dev minimap. Every third frame, only on brush floors.
function updateBrush() {
  const fade = theme.mechanic.TUNE.fade;
  for (let i = 0; i < enemies.length; i++) {
    const e = enemies[i], mt = e.mats[0];
    if (!mt || e.dead) continue;
    const inB = floor.patches.get(((e.z / TILE) | 0) * floor.w + ((e.x / TILE) | 0)) === 'brush';
    if (inB === !!e.inBrush && (!inB || mt.opacity === fade)) continue;
    e.inBrush = inB; mt.transparent = inB; mt.opacity = inB ? fade : 1;
  }
}

// ---- the safe room behind the boss arena (floor.safe, built in js/gen.js layoutBoss). Until the boss dies its door is a slab that looks like
// the wall around it; bossDefeated opens it (openSafeDoor) and updateDoors slides it up. The room gets a low ceiling (the arena's is 10 m) so it feels snug. ----
function buildSafeRoom(wallMat, ceilMat) {
  const s = floor.safe, d = s.door, r = s.rect, slab = new THREE.Group();
  const block = new THREE.Mesh(new THREE.BoxGeometry(TILE, WALL_H, TILE), wallMat);      // the same material as the wall tiles: it does not show
  block.position.y = WALL_H / 2; slab.add(block);
  const x = (d.x + 0.5) * TILE, z = (d.y + 0.5) * TILE;
  slab.position.set(x, 0, z); group.add(slab);
  s.o = { p: { kind: 'door', opened: true, x: d.x, y: d.y }, mesh: slab, x, z, r: 0, lid: null, mats: [] };   // opened: true, so it is never a prompt target; updateDoors animates it once o.anim is set
  propObjs.push(s.o);
  const ceil = (tx, ty, tw, th) => {
    const g = new THREE.PlaneGeometry(tw * TILE, th * TILE), uv = g.attributes.uv;
    for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * tw, uv.getY(i) * th);   // one texture repeat per tile, like the big ceiling
    const m = new THREE.Mesh(g, ceilMat); m.rotation.x = Math.PI / 2; m.position.set((tx + tw / 2) * TILE, SAFE_CEIL, (ty + th / 2) * TILE); group.add(m);
  };
  s.inside = new Uint8Array(floor.w * floor.h);                                          // the room and its passage (not the door tile, not the arena): the tiles where you are safe
  for (let y = r.y0; y <= r.y1; y++) for (let tx = r.x0; tx <= r.x1; tx++) s.inside[y * floor.w + tx] = 1;
  for (let y = r.y1 + 1; y < d.y; y++) s.inside[y * floor.w + d.x] = 1;
  ceil(r.x0, r.y0, r.x1 - r.x0 + 1, r.y1 - r.y0 + 1);
  ceil(d.x, r.y1 + 1, 1, d.y - r.y1 - 1);                                                // the passage from the room to the door
}
// The boss is dead: the hidden door grinds open (once), the tile stops being solid for the player but stays a wall to every enemy.
function openSafeDoor() {
  const s = floor.safe;
  if (!s || s.open) return;
  s.open = true; floor.tiles[s.door.y * floor.w + s.door.x] = T_SAFEDOOR; s.o.anim = 0;
  shake.mag = 0.03; shake.t = shake.dur;
}

// ---- light sources: wall torches plus glowing furniture (hearths, cauldrons, candles, altars).
// Emissive meshes everywhere, real light only on the 4 nearest to the player. ----
// The merchant: a goblin in an apron behind his counter (not an enemy, never moves), a solid circle so you cannot walk
// through him, and an invisible trading spot at the counter. The stock is seeded per floor.
function buildShop() {
  const sh = floor.shop;
  floor.shopStock = makeStock(stageSeed, effFloor());
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
const torchLights = Array.from({ length: 4 }, () => { const l = new THREE.PointLight(theme.pal.light, 0, 14, 1.5); scene.add(l); return l; });
function buildTorches() {
  const iron = new THREE.MeshLambertMaterial({ color: 0x2a2420 });
  const fire = new THREE.MeshBasicMaterial({ color: 0xffa94a });
  torchGroups = [];
  torchPts = floor.torches.map(t => {
    const x = (t.x + 0.5) * TILE + t.dx * 1.42, z = (t.y + 0.5) * TILE + t.dy * 1.42;
    const g = new THREE.Group(); g.position.set(x, floor.boss && !t.low ? 3.6 : 2.0, z);       // higher on the tall arena walls (not in the low safe room)
    const stick = new THREE.Mesh(TORCH_STICK, iron); stick.position.y = -0.05;                                  // a round bracket and a tapering flame, not boxes
    const flame = new THREE.Mesh(TORCH_FLAME, fire); flame.position.y = 0.26;
    g.add(stick, flame); group.add(g); torchGroups.push(g);
    return { lx: x - t.dx * 0.6, lz: z - t.dy * 0.6, y: floor.boss && !t.low ? 3.8 : 2.2, color: theme.pal.light, str: 1 };
  });
  for (const o of decorObjs) {
    const l = DECOR_LIGHT[o.kind];
    if (l) torchPts.push({ lx: o.x + Math.sin(o.yaw) * 0.6, lz: o.z + Math.cos(o.yaw) * 0.6, y: o.ly ?? l.y, color: l.color, str: l.str * (o.ls || 1) });
  }
}
const nearT = new Array(4).fill(null), nearD = new Float64Array(4);   // the nearest lights, nearest first (reused: no per-call arrays or sort)
function updateTorches(now) {
  let cnt = 0;
  for (let i = 0; i < torchPts.length; i++) {
    const t = torchPts[i], d = (t.lx - player.x) ** 2 + (t.lz - player.z) ** 2;
    if (cnt === 4 && d >= nearD[3]) continue;
    let j = cnt < 4 ? cnt++ : 3;                       // insertion into the sorted top 4
    while (j > 0 && nearD[j - 1] > d) { nearD[j] = nearD[j - 1]; nearT[j] = nearT[j - 1]; j--; }
    nearD[j] = d; nearT[j] = t;
  }
  for (let i = 0; i < 4; i++) {
    const l = torchLights[i], t = i < cnt ? nearT[i] : null;
    if (!t) { l.intensity = 0; continue; }
    l.position.set(t.lx, t.y, t.lz);
    l.color.setHex(t.color);
    l.intensity = t.str * (0.95 + Math.sin(now / 110 + i * 2 + t.lx) * 0.12 + Math.sin(now / 37 + t.lz) * 0.06);
  }
}

const dropTell = o => { if (o.tell && o.tell.parent) o.tell.parent.remove(o.tell); };   // a padlock or tripwire goes when its job is done (they are not part of any merged chunk)
function markOpened(o) {
  o.p.opened = true; dropTell(o);
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
  if (!t) { if (!smashChest(w)) loud(2); return; }   // swung at nothing (or at a locked chest)
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
  const hunted = enemies.some(e => !e.dead && e.state === 'alerted' && !e.boss && !e.T.fleer);   // a fleeing thief is not hunting you
  if (hat.hidden) {
    hat.hiddenT += dt;
    if (moving || !player.crouching || hunted || hat.hiddenT > DUNCE.hideMax) { hat.hidden = false; hat.cd = DUNCE.hideCd; hat.still = 0; flash('Guards can see you again.'); }
  } else if (player.crouching && !moving && !hunted) {
    if ((hat.still += dt) >= DUNCE.hideStill && hat.cd <= 0) { hat.hidden = true; hat.hiddenT = 0; flash('You crouch motionless. The guards look right past you.'); }
  } else hat.still = 0;
  if (!hat.coned.has(floorNum)) {                                                  // Cone of Shame
    const g = enemies.find(e => !e.dead && e.state === 'alerted' && e.seen && !e.rageT && !e.boss && !e.T.fleer);
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
  if (!e.boss && !e.st.has('stuck') && !Player.wallHit(floor, e.x + dx / d * SHIELD.bashPush, e.z + dz / d * SHIELD.bashPush, e.r, true)) { e.x += dx / d * SHIELD.bashPush; e.z += dz / d * SHIELD.bashPush; }
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
const SPEAK = typeof speechSynthesis !== 'undefined' && !params.has('mute') && !params.has('norender') ? speechSynthesis : null;   // ?mute=1 or the test mode (?norender=1) silences the voice lines
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
Enemy.escaped = questThiefEscaped;   // a sack thief reaching the stairs (js/quests.js)
// A spore puffer bursting: Slow and Daze for anything within 3 m, you included.
Enemy.burst = e => {
  if (Math.hypot(e.x - player.x, e.z - player.z) < 3) {
    if (pst.apply('slow', 4)) discover('status:slow', 'Slow'); if (pst.apply('daze', 3)) discover('status:daze', 'Daze');
    hitReaction(3); flash('The puffer bursts! Spores!');
  }
  for (const o of enemies) if (o !== e && !o.dead && Math.hypot(o.x - e.x, o.z - e.z) < 3) o.addStatus('slow', 4);
  const al = Enemy.ally; if (al && !al.dead && al.floor === floor && Math.hypot(al.x - e.x, al.z - e.z) < 3) al.addStatus('slow', 4);
};

// ---- enemy shots: an archer's arrows and a shaman's hexes fly at you. Arrows can be blocked, hexes cannot ----
function spawnEnemyShot(s) {
  const gravity = s.kind === 'arrow' ? 4 : 0, tx = player.x, ty = eyeY() - 0.3, tz = player.z;
  const dx = tx - s.x, dy = ty - s.y, dz = tz - s.z, dist = Math.hypot(dx, dz) || 1, t = Math.max(0.05, Math.hypot(dx, dy, dz) / s.speed);
  const jitter = () => (gameRng() - 0.5) * 0.05 * dist / t;                       // a little inaccuracy
  const a = { x: s.x, y: s.y, z: s.z, vx: dx / t + jitter(), vy: (dy + 0.5 * gravity * t * t) / t, vz: dz / t + jitter(), gravity, life: 4, owner: 'enemy', kind: s.kind, from: s.from, stuck: false, mesh: s.kind === 'arrow' ? makeArrowMesh() : makeBoltMesh({ hex: '#b060ff', thorn: '#4ac84a', curse: '#9adaff', dart: '#7aff5a' }[s.kind]) };
  a.mesh.position.set(a.x, a.y, a.z); group.add(a.mesh); arrows.push(a);
}
// An enemy shot (arrow, hex, thorn, curse, dart) that reached the player's ally first: arrows hurt by zone, the others apply their status.
function allyShotHit(a, ev) {
  const al = ev.e, k = a.kind;
  if (k === 'thorn') al.addStatus('bleed', 4); else if (k === 'dart') al.addStatus('bleed', 5); else if (k === 'curse') al.addStatus('slow', 5); else if (k === 'hex') al.addStatus(gameRng() < 0.5 ? 'slow' : 'daze', 4);
  else { al.cause = 'was shot'; al.hurt(TUNE.enemyDmg * a.from.dmgMul * ZONE_MUL[ev.zone] * (al.resist[ev.zone] || 1), a.from); }
}
function enemyShotHit(a) {
  if (a.kind === 'dart') {                                                           // a poison dart: bleed for 5 s, no block stops it
    hitReaction(4);
    if (pst.apply('bleed', 5)) discover('status:bleed', STATUS.bleed.name);
    mark('POISONED', '#7aff5a'); addLog('Poisoned: Bleed!', '#7aff5a');
    return;
  }
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
  if (inSafe) return;
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
      const ev = stepArrow(a, dt, floor, enemies, player, Enemy.ally && Enemy.ally.floor === floor ? Enemy.ally : null);
      a.life -= dt; a.mesh.position.set(a.x, a.y, a.z);
      if (a.kind === 'arrow') a.mesh.lookAt(a.x + a.vx, a.y + a.vy, a.z + a.vz);
      if (ev && ev.type === 'player') enemyShotHit(a);
      else if (ev && ev.type === 'ally') allyShotHit(a, ev);
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
let winTimer = 0;   // the final boss's delayed Run complete; cleared when a stage is restarted
function bossDefeated(e) {
  e.corpseDone = true;
  const rng = makeRng((e.seed ^ 0xb055) >>> 0);
  bossDead[stage] = true;
  if (e.final) { flash('The Final Boss falls!'); clearTimeout(winTimer); winTimer = setTimeout(() => { if (state === 'play') finishRun(); }, 2500); return; }   // placeholder: the run ends
  const epic = rollEquipment(effFloor(), rng, {});
  epic.tier = rng() < TUNE.bossLegendary ? 4 : 3;
  const uniq = epic.tier === 4 ? rollUniqueGear(rng, rng() < 0.5) : null, bust = rollBust(rng, 0.12);    // a Legendary body may hold a one-of-a-kind piece
  const extra = rollEquipment(effFloor(), rng, { boost: 1, minTier: 2 });
  const left = [uniq || epic, extra, { type: 'gold', n: rng.int(120, 200) }, ...(rng() < 0.25 ? [{ type: 'rage' }] : []), ...(bust ? [bust] : [])];
  propObjs.push({
    p: { kind: 'corpse', x: Math.floor(e.x / TILE), y: Math.floor(e.z / TILE), opened: false, seed: e.seed, left },
    mesh: e.mesh, x: e.x, z: e.z, r: 0, lid: null, mats: [],
  });
  flash('The boss falls! Loot its body. A rumble shakes the arena: a hidden door in the north wall grinds open.');
  openSafeDoor();
}

// A dead enemy leaves a lootable body only if its drop roll gave something.
function makeCorpse(e, sneak) {
  e.corpseDone = true;
  if (e.T.mimic) return mimicCorpse(e);
  const bonus = sneak ? 0.15 : 0;
  if (!dryRoll(() => rollLoot('corpse', effFloor(), makeRng(e.seed), bonus, e.gear, e.type)).length && !e.loot && !e.spec.carry) return;
  propObjs.push({
    p: { kind: 'corpse', x: Math.floor(e.x / TILE), y: Math.floor(e.z / TILE), opened: false, seed: e.seed, bonus, gear: e.gear, type: e.type, extra: e.loot || e.spec.carry ? [...(e.loot ? [{ type: 'gold', n: e.loot }] : []), ...(e.spec.carry ? [e.spec.carry] : [])] : undefined },   // stolen gold, and the cell key a prisoner quest guard carries
    mesh: e.mesh, x: e.x, z: e.z, r: 0, lid: null, mats: [],
  });
}

// A dead mimic pays out like a chest one grade better, with gear guaranteed (it is a lootable body, like the boss's).
function mimicCorpse(e) {
  const rng = makeRng((e.seed ^ 0x31c1c) >>> 0), t = Math.min(4, (e.spec.tier | 0) + 1);
  const left = rollLoot('chest', effFloor(), rng, 0, [], undefined, t);
  if (!left.some(d => d.type === 'weapon' || d.type === 'armor' || d.type === 'shield')) left.push(rollEquipment(effFloor(), rng, { boost: t >= 3 ? 1 : 0, minTier: t >= 2 ? t - 1 : 0 }));
  propObjs.push({ p: { kind: 'corpse', x: Math.floor(e.x / TILE), y: Math.floor(e.z / TILE), opened: false, seed: e.seed, left }, mesh: e.mesh, x: e.x, z: e.z, r: 0, lid: null, mats: [] });
}

// ---- bombs (numbers: BOMB in js/enemytypes.js). One pooled fireball per live blast and a few pooled dropped bombs, built once:
// no point lights and nothing allocated per explosion or per frame. A blast hurts the player and every enemy in range in a single pass. ----
const blastFx = Array.from({ length: 4 }, () => {
  const m = new THREE.Mesh(new THREE.SphereGeometry(1, 12, 8), new THREE.MeshBasicMaterial({ color: 0xffb040, transparent: true, opacity: 0, depthWrite: false, side: THREE.DoubleSide }));
  m.visible = false; scene.add(m); return { m, t: 0, r: 0, on: false };
});
const bombs = (() => {
  const body = new THREE.SphereGeometry(0.17, 8, 6), spark = new THREE.SphereGeometry(0.06, 6, 5), black = new THREE.MeshLambertMaterial({ color: 0x151515 });
  return Array.from({ length: 6 }, () => {
    const g = new THREE.Group(), sp = new THREE.Mesh(spark, new THREE.MeshBasicMaterial({ color: 0xffa030 }));
    const b = new THREE.Mesh(body, black); b.position.y = 0.17; sp.position.y = 0.4; g.add(b, sp); g.visible = false; scene.add(g);
    return { g, sp, t: 0, x: 0, z: 0, on: false };
  });
})();
function clearBombs() { gasFx.on = false; gasFx.m.visible = false; for (const b of bombs) { b.on = false; b.g.visible = false; } for (const f of blastFx) { f.on = false; f.m.visible = false; } }
const blastDmg = d => BOMB.dmg * (1 - BOMB.falloff * d / BOMB.radius);          // full at the centre, (1 - falloff) of it at the edge
function explodeAt(x, z, src) {
  let fx = blastFx[0]; for (const f of blastFx) if (!f.on) { fx = f; break; }
  fx.on = true; fx.t = 0; fx.r = BOMB.radius; fx.m.position.set(x, 0.7, z); fx.m.visible = true;
  pending.push({ x, z, r: BOMB.noise, src: null });                              // the bang is heard far and wide
  const dp = Math.hypot(player.x - x, player.z - z);
  if (!inSafe && dp < BOMB.radius && hasLOS(floor, x, z, player.x, player.z)) {
    damage(blastDmg(dp) * (1 - inv.armorRed('body')));
    pst.apply('daze', 2); discover('status:daze', 'Daze'); mark('BLASTED', '#ff9a3a'); addLog('Caught in the blast!', '#ff9a3a');
  }
  for (const e of enemies) {                                                      // everything else too: guards, other bomb goblins, the lot
    if (e === src || e.dead) continue;
    const d = Math.hypot(e.x - x, e.z - z);
    if (d >= BOMB.radius || !hasLOS(floor, x, z, e.x, e.z)) continue;
    e.cause = 'was blown up';
    if (e.boss && e.dormant) { e.dormant = false; e.justWoke = true; }               // a blast wakes the boss like any noise
    if (e.T.bomb && e.fuse > 0) e.chained = true;                                    // a lit bomb goblin killed by a blast still goes off within BOMB.chain
    e.hurt(blastDmg(d), { x, z });
    if (e.T.bomb && !e.dead && e.fuse > BOMB.chain) e.fuse = BOMB.chain;          // a lit bomb goblin in the blast goes off right after
  }
  const al = Enemy.ally;                                                          // and the player's ally
  if (al && !al.dead && al.floor === floor) {
    const d = Math.hypot(al.x - x, al.z - z);
    if (d < BOMB.radius && hasLOS(floor, x, z, al.x, al.z)) { al.cause = 'was blown up'; al.hurt(blastDmg(d), { x, z }); }
  }
  if (dp < 20) discover('enemy:bomber', 'Bomb Goblin');
}
Enemy.explode = e => { if (e.mesh.parent) e.mesh.parent.remove(e.mesh); explodeAt(e.x, e.z, e); };
Enemy.dropBomb = e => {
  for (const b of bombs) if (!b.on) { b.on = true; b.t = e.chained ? BOMB.chain : BOMB.dropDelay; b.x = e.x; b.z = e.z; b.g.position.set(e.x, 0, e.z); b.g.visible = true; return; }
};
function updateBombs(dt) {
  for (const b of bombs) {
    if (!b.on) continue;
    b.t -= dt; b.sp.scale.setScalar(b.t < BOMB.warn ? (((b.t * 14) | 0) % 2 ? 1 : 2.4) : 0.8 + 0.5 * Math.sin(b.t * 40));   // it fizzes, then flashes
    if (b.t <= 0) { b.on = false; b.g.visible = false; explodeAt(b.x, b.z, null); }
  }
  for (const f of blastFx) {
    if (!f.on) continue;
    f.t += dt; const k = f.t / BOMB.fx;
    if (k >= 1) { f.on = false; f.m.visible = false; continue; }
    f.m.scale.setScalar(f.r * (1 - (1 - k) * (1 - k)) + 0.05); f.m.material.opacity = 0.7 * (1 - k);
  }
}

// ---- trapped chests (numbers: TRAP in js/loot.js). The gas cloud is one pooled translucent sphere built once, no light; its effects are
// applied in a single pass over the enemies when it spawns, and nothing runs per frame once it has faded. ----
const gasFx = (() => { const m = new THREE.Mesh(new THREE.SphereGeometry(1, 12, 8), new THREE.MeshBasicMaterial({ color: 0x9bd86a, transparent: true, opacity: 0, depthWrite: false, side: THREE.DoubleSide })); m.visible = false; scene.add(m); return { m, t: 0, on: false }; })();
function springTrap(kind, o) {
  if (kind === 'dart') {
    damage(TRAP.dart);
    if (pst.apply('bleed', TRAP.bleed)) discover('status:bleed', 'Bleed');
    hitReaction(TRAP.dart); flash('A dart shoots out of the chest!'); addLog(`A trap dart hits you: ${TRAP.dart} damage and bleeding.`, '#ff6a6a');
  } else if (kind === 'gas') {
    gasFx.on = true; gasFx.t = 0; gasFx.m.position.set(o.x, 0.9, o.z); gasFx.m.visible = true;
    if (!inSafe && Math.hypot(player.x - o.x, player.z - o.z) < TRAP.gasRadius && hasLOS(floor, o.x, o.z, player.x, player.z)) {
      if (pst.apply('daze', TRAP.gasDaze)) discover('status:daze', 'Daze'); if (pst.apply('slow', TRAP.gasSlow)) discover('status:slow', 'Slow');
    }
    for (const e of enemies) {
      if (e.dead || Math.hypot(e.x - o.x, e.z - o.z) >= TRAP.gasRadius || !hasLOS(floor, o.x, o.z, e.x, e.z)) continue;
      e.addStatus('daze', TRAP.gasDaze); e.addStatus('slow', TRAP.gasSlow);
    }
    const al = Enemy.ally;
    if (al && !al.dead && al.floor === floor && Math.hypot(al.x - o.x, al.z - o.z) < TRAP.gasRadius && hasLOS(floor, o.x, o.z, al.x, al.z)) { al.addStatus('daze', TRAP.gasDaze); al.addStatus('slow', TRAP.gasSlow); }
    flash('A cloud of gas bursts from the chest!'); addLog('Trap gas: daze and slow.', '#9bd86a');
  } else {
    loud(TRAP.alarmNoise); flash('An alarm bell clangs!'); addLog(`An alarm bell rings (${TRAP.alarmNoise} m).`, '#d8a030');
  }
}
function updateGas(dt) {
  if (!gasFx.on) return;
  gasFx.t += dt; const k = gasFx.t / TRAP.fx;
  if (k >= 1) { gasFx.on = false; gasFx.m.visible = false; return; }
  gasFx.m.scale.setScalar(TRAP.gasRadius * (1 - (1 - k) * (1 - k)) + 0.05); gasFx.m.material.opacity = 0.5 * (1 - k);
}
// Smashing a locked chest: each melee swing that hits no enemy but lands on its chest counts (a mace needs fewer). Returns whether one did.
function smashChest(w) {
  const fx = -Math.sin(player.yaw), fz = -Math.cos(player.yaw), reach = w.reach + 0.9;
  for (const o of propObjs) {
    if (o.p.kind !== 'chest' || !o.p.locked || o.p.opened) continue;
    const dx = o.x - player.x, dz = o.z - player.z, d = Math.hypot(dx, dz);
    if (d > reach || (dx * fx + dz * fz) / (d || 1) < 0.7 || !hasLOS(floor, player.x, player.z, o.x, o.z)) continue;
    const need = inv.equip.weapon.base === 'mace' ? LOCKED.maceHits : LOCKED.hits;
    loud(LOCKED.noise);
    o.p.hits = (o.p.hits | 0) + 1;
    if (o.p.hits >= need) finishSearch(o, true);
    else flash(`The lock rattles (${o.p.hits}/${need})`);
    return true;
  }
  return false;
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

// In the safe room (floor.safe, north of its door tile): nothing can hurt you, nothing drains, attacks do nothing. One flag, set once a frame.
let inSafe = false, safeMsgT = 0;
function updateCombat(dt) {
  inSafe = floor.safe !== undefined && floor.safe.open && floor.safe.inside[player.tileY * floor.w + player.tileX] === 1;
  // gear and potions feed the player and the guards' senses
  player.speedMul = (dev.on ? 5 : 1) * (inv.buffs.swift > 0 ? 1.35 : 1) * pst.moveMul();
  const bleed = pst.update(dt);
  if (bleed > 0 && !dev.on && !inSafe && inv.hp > 1) inv.hp = Math.max(1, inv.hp - bleed);   // bleeding never kills on its own
  if (pst.has('daze')) spend(STATUS.daze.drain * dt);
  if (!dev.on && !inSafe) {                         // hunger drains while you play (frozen in dev mode and in the safe room: it is not restored there either)
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
  const mech = patch && MECH_PATCH[patch];                                       // the theme mechanic's handler for this decal (puddles and bells act elsewhere)
  const mt = theme.mechanic.TUNE;                                                 // the theme's mechanic numbers (undefined in themes with none)
  if (mech && mech.slippery) player.slipT = mt.carry; else if (player.slipT > 0) player.slipT -= dt;   // ice: the slide carries on for a moment after you leave it
  player.slippery = player.slipT > 0; if (mt && mt.slip) player.slipRate = mt.slip;
  if (floor.prints) updatePrints(dt);
  let seenMul = 1;
  if (mech) { if (mech.seen) seenMul = mech.seen(); discover(mech.disc[0], mech.disc[1]); }
  const hidden = hatUpdate(dt);
  player.stealthMul = hidden ? 0 : (inv.buffs.shadow > 0 ? 0.5 : 1) * seenMul;
  if (inv.refillStamina) { cb.stamina = STAMINA_MAX; inv.refillStamina = false; }

  if (player.sprinting) spend(TUNE.sprintDrain * dt);
  else if (cb.delay > 0) cb.delay -= dt;
  else cb.stamina = Math.min(STAMINA_MAX, cb.stamina + TUNE.staminaRegen * (inv.buffs.vigor > 0 ? 2 : 1) * (inv.buffs.hearty > 0 ? 1.5 : 1) * (1 + inv.stamBonus) * hunger.regenMul() * dt);
  cb.stamina = Math.min(cb.stamina, STAMINA_MAX * hunger.maxStaminaMul());   // Weak: max stamina is cut
  if (dev.on) cb.stamina = STAMINA_MAX;
  if (cb.stamina <= 1) cb.canSprint = false; else if (cb.stamina > 25) cb.canSprint = true;
  player.canSprint = cb.canSprint && hunger.canSprint() && !cb.eat;

  if (cb.bashCd > 0) cb.bashCd -= dt;
  if (cb.rageCd > 0) cb.rageCd -= dt;
  if (cb.limpMsg > 0) cb.limpMsg -= dt;
  if (inv.rageReq) { playRage(inv.rageReq); inv.rageReq = null; }
  if (cb.bash > 0) cb.bash -= dt;
  if (cb.press) {
    cb.press = false;
    if (!inSafe || cb.eat) startAttack();                                                    // in the safe room an attack does nothing (but still stops a meal)
    else if (performance.now() - safeMsgT > 4000) { safeMsgT = performance.now(); flash('No one fights in the safe room.'); }
  }
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
  if (inSafe) return;                              // the safe room: nothing can hurt you
  hitReaction(n);
  hunger.fight = 3;
  if (cb.eat) { cb.eat = null; flash('Interrupted!'); }
  if (dev.on) return;
  inv.hp = Math.max(0, inv.hp - n);
  if (inv.hp <= 0) {
    state = 'dead';
    document.exitPointerLock();
    hud.overlayText.innerHTML = `<h1>You died on stage ${stage}, floor ${floorNum}</h1><p>Click to start a new run.</p>`;
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
  if (o.p.kind === 'chest') {
    const t = o.p.tier | 0, base = 0.9 + 0.15 * t;                                  // better chests take a little longer
    if (o.p.locked) { const pk = inv.pack.find(i => i.type === 'lockpick'); return pk ? { label: `Pick the lock of the ${CHEST_NAMES[t]} (${pk.n} lockpick${pk.n > 1 ? 's' : ''})`, time: LOCKPICK.time } : { label: `Locked: needs a lockpick, or smash it with a weapon`, time: 0, locked: true }; }
    return player.crouching ? { label: `Search carefully: ${CHEST_NAMES[t]}`, time: base * TRAP.disarmMul } : { label: `Open ${CHEST_NAMES[t]}`, time: base };   // crouched is slower for every chest, so the bar never gives a trap away (a trapped one is then disarmed)
  }
  if (o.p.kind === 'questnpc') return { label: questPrompt(floor, o), time: PROP_INFO.questnpc.time };
  const pi = PROP_INFO[o.p.kind];
  return player.crouching && (o.p.kind === 'barrel' || o.p.kind === 'rubble') ? { label: 'Search carefully', time: pi.time * TRAP.disarmMul } : pi;
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
function finishSearch(o, smashed) {
  if (o.p.kind === 'merchant') { shopUI.open(); return; }
  if (o.p.kind === 'altar') { dealUI.open(o); return; }
  if (o.p.kind === 'questnpc') { questTalk(o); return; }
  if (o.p.mimic && o.mimic && o.mimic.dormant) {                                    // it was a mimic: the lid yawns and it bites
    const m = o.mimic; m.wake(true, player); m.yaw = Math.atan2(-(player.x - m.x), -(player.z - m.z));
    discover('enemy:mimic', 'Mimic'); flash('It is a MIMIC!'); addLog('The chest was a mimic!', '#ff6a6a');
    return;
  }
  const chest = o.p.kind === 'chest', unlocked = chest && o.p.locked;
  let noise = (SEARCH_NOISE[o.p.kind] || 0) + (chest ? 0.5 * (o.p.tier | 0) : 0);
  if (unlocked) {
    const pk = inv.pack.find(i => i.type === 'lockpick');
    if (smashed) noise = 0;                                                         // the blows were loud already
    else {
      if (!pk) return;
      noise = LOCKPICK.noise; discover('item:lockpick', 'Lockpick');
      if (gameRng() < LOCKPICK.breakChance) { if (--pk.n <= 0) inv.remove(pk); flash('The lockpick snapped!'); addLog('The lockpick snapped.', '#c8ccd4'); }
    }
    o.p.locked = false; o.p.grade = LOCKED.gradeUp; dropTell(o); discover('chest:locked', 'Locked chests');
  } else if (chest && o.p.trap) {
    const kind = o.p.trap; o.p.trap = null; dropTell(o); discover('chest:trap', 'Trapped chests');
    if (player.crouching) { noise = 0; flash('You disarm the trap.'); addLog('You disarmed the trap.', '#9ac8ff'); }   // quiet, and the trap is gone
    else springTrap(kind, o);
    if (state === 'dead') return;
  }
  loud(noise);
  if (chest) discover('item:chest', 'Chests');
  if (o.p.kind === 'door') {
    inv.remove(inv.pack.find(i => i.type === 'key' && i.lock === o.p.lock));
    openDoor(o);
    if (theme.doors.noise) loud(theme.doors.noise);                         // an ice seal shatters loudly
    flash(`Unlocked the ${o.p.room}`); questDoorOpened(o);
    return;
  }
  let drops = o.p.left || (o.p.fixed ? [{ type: 'potion', kind: o.p.fixed, n: 1 }] : [...rollLoot(o.p.kind, effFloor(), makeRng(o.p.seed), o.p.bonus || 0, o.p.gear || [], o.p.type, Math.min(4, (o.p.tier | 0) + (o.p.grade | 0))), ...(o.p.extra || [])]);
  const got = [], left = [], notes = [];
  if (smashed && !o.p.left) {                                                       // smashing a lock rattles what is inside
    let broke = 0;
    drops = drops.filter(d => { if (d.type !== 'potion') return true; let keep = 0; for (let i = d.n || 1; i > 0; i--) if (gameRng() >= LOCKED.potionBreak) keep++; broke += (d.n || 1) - keep; d.n = keep; return keep > 0; });
    if (broke) notes.push(`${broke} potion${broke > 1 ? 's' : ''} broke`);
  }
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
  const anim = DOOR_ANIM[theme.doors.openAnim] || DOOR_ANIM.slide;
  for (const o of propObjs) {
    if (o.p.kind !== 'door' || o.anim === undefined || o.anim >= 1) continue;
    o.anim = Math.min(1, o.anim + dt);
    anim(o, o.anim);
    if (o.anim >= 1) o.mesh.visible = false;
  }
}

let hudKey = '';
const HUNGER_COLOR = { fed: '#d9a441', hungry: '#e08a2a', weak: '#d4562a', starving: '#b01e1e' };
const styleSeen = new Map();   // 'id.prop' -> the last value written, so an unchanged value costs no DOM write
function setStyle(id, prop, v) { const k = id + '.' + prop; if (styleSeen.get(k) === v) return; styleSeen.set(k, v); el(id).style[prop] = v; }
function updateHud() {
  let boss = null; for (let i = 0; i < enemies.length; i++) if (enemies[i].boss) { boss = enemies[i]; break; }
  if (boss && boss.justWoke) { boss.justWoke = false; flash('The boss wakes!'); }
  setStyle('boss', 'display', boss && !boss.dormant && !boss.dead ? 'block' : 'none');
  if (boss) setStyle('bossFill', 'width', Math.max(0, boss.hp / boss.maxHp * 100) + '%');
  setStyle('hpFill', 'width', (inv.hp / inv.maxHp * 100) + '%');
  setStyle('stamFill', 'width', (cb.stamina / STAMINA_MAX * 100) + '%');
  setStyle('stamFill', 'background', cb.canSprint ? '#4cc36a' : '#c9a23a');
  setStyle('hungerFill', 'width', hunger.v + '%');
  setStyle('hungerFill', 'background', HUNGER_COLOR[hunger.stage]);
  if (frameCount % 3 !== 0) return;                    // the text part builds strings: 20 times a second is plenty
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
const torch = new THREE.PointLight(theme.pal.light, 0.75, 16, 1.6);   // player lantern, brighter than the ambient so rooms read
scene.add(ambient);
camera.add(torch);

// The armory (a locked room) is on one floor of each stage, picked from the seed (planStage).
let respawnT = Infinity, baseGuards = 0;

function disposeGroup(g) { g.traverse(freeObject); }   // free a floor's GPU memory: geometry, materials and their textures
// Keep the floor you are on so you can come back to it exactly as you left it.
function saveFloor() {
  clearBombs();
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
  if (n === 1 && theme.mechanic.hint) addLog(theme.mechanic.hint, '#9ac8ff');
  hud.floor.textContent = stage === FINAL_STAGE ? 'Final stage' : `Stage ${stage} / ${STAGES} - Floor ${n} / ${MAX_FLOOR} - ${theme.name}` + (n === MAX_FLOOR ? ' (boss floor)' : '');
}
const bossFloorAt = n => stage === FINAL_STAGE || n === MAX_FLOOR;   // the final stage is one boss arena (its floorNum is 1, so the way up leads back to stage 4's safe room)

// A brand new floor n (also what the dev keys and the tests use): any old copy of it is thrown away.
function startFloor(n) {
  allyReset();                                          // a fresh floor 1 (or a dev jump) starts without an ally
  if (floorCache[n]) { disposeGroup(floorCache[n].group); delete floorCache[n]; }
  generateAndEnter(n, n > 1 ? 'down' : null);
  const locked = floor.doors.map(d => d.room).join(', ');
  if (floor.boss) flash(bossMsg());
  else flash(`${n === 1 ? '' : `Floor ${n}. `}Find the stairs.${locked ? ` Locked: ${locked}. Keys hide in chests.` : ''}`);
}
const bossMsg = () => stage === FINAL_STAGE ? 'The final chamber. Something huge waits in the middle. One healing potion hides along the walls.' : 'The boss arena. Something huge sleeps in the middle. One healing potion hides along the walls.';
function generateAndEnter(n, arrive) {
  clearBombs();
  gameRng = makeRng(((stageSeed ^ 0x6a09e667) >>> 0) + n * 69069);   // gameplay RNG for this floor (guard zones, procs, respawns)
  floorNum = n;
  const final = stage === FINAL_STAGE, gn = final ? MAX_FLOOR : n;   // the final stage's one floor is generated as a floor 5 arena
  floor = generateFloor(stageSeed, gn, { armory: !final && n === armoryFloor, boss: bossFloorAt(n), shop: !final && n === shopFloor, quest: final ? undefined : questPlan[n], themeName: theme.name, layoutStyle: theme.layout.style, depth: effFloor(0) });
  assignEnemyTypes(floor, stageSeed, gn, theme.name);       // natives, rat packs, wolves and their handlers (js/enemytypes.js)
  questSpawn(floor);                                        // then the floor's mini-boss, if any (js/quests.js), so the type pass never touches it
  if (floor.boss) { const b = floor.enemies.find(e => e.boss), tb = final ? FINAL_BOSS : THEME_BOSS[theme.name]; if (b && tb) { b.dress = tb.dress; b.skin = tb.skin; b.final = final; } }   // each theme's boss has its own look
  floor.patches = new Map(floor.decor.filter(d => PATCH_KINDS.includes(d.kind)).map(d => [d.y * floor.w + d.x, d.kind]));   // the theme's floor gimmick, by tile
  WALL_H = floor.boss ? BOSS_WALL_H : 3.6;
  explored = new Uint8Array(floor.w * floor.h);
  buildFloor();
  if (floor.boss && !final && bossDead[stage]) {            // a stage arena rebuilt after its boss fell (the cache was trimmed): no boss, the safe room door already open
    const bi = enemies.findIndex(e => e.boss); if (bi >= 0) { group.remove(enemies[bi].mesh); enemies.splice(bi, 1); }
    const s = floor.safe; s.open = true; floor.tiles[s.door.y * floor.w + s.door.x] = T_SAFEDOOR; s.o.anim = 1; s.o.mesh.position.y = WALL_H; s.o.mesh.visible = false;
  }
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
  if (dir === 'up' && !floorCache[n]) { sealedUp(); return; }   // never rebuild a floor you already left
  allyDepart();                                       // a following ally within a few metres comes too (js/quests.js)
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
    if (floor.boss) flash(bossMsg());
    else flash(`Floor ${n}. Find the stairs.${locked ? ` Locked: ${locked}. Keys hide in chests.` : ''}`);
  }
  allyArrive();
  hunger.fight = 0;
}

// Floors 3 and deeper: every 35 to 70 seconds a guard appears in a room you cannot see, up to 1.5x the floor's guard count.
function updateRespawn(dt) {
  if (floorNum < 3 || floor.boss) return;
  respawnT -= dt;
  if (respawnT > 0) return;
  respawnT = 35 + gameRng() * 35;
  if (enemies.filter(e => !e.dead && !e.T.mimic).length >= Math.ceil(baseGuards * 1.5)) return;
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
    mctx.fillStyle = t === T_WALL || (t === T_DOOR && floor.safe) ? '#2a2a33' : t === T_STAIRS ? '#ffd24a' : t === T_START && floor.up ? '#5aa0ff' : t === T_DOOR ? '#c0702a' : '#6a6a78';   // gold: the way down, blue: the way back up
    mctx.fillRect(x * S, y * S, S + 0.5, S + 0.5);
  }
  if (dev.on) for (const e of enemies) {
    if (e.dead || e.inBrush) continue;                        // (an enemy in Jungle brush is hidden on the minimap)
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
    mctx.fillStyle = o.p.kind === 'chest' ? TIERS[o.p.tier | 0].color : o.p.kind === 'merchant' ? '#6cf' : o.p.kind === 'questnpc' ? '#ff9a6a' : '#b08a5a';   // a chest's dot is its grade colour
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
function sealedUp() { if (performance.now() - sealedMsgT > 2500) { sealedMsgT = performance.now(); flash('The way back is sealed.'); } }
function checkStairs() {
  if (floor.boss && enemies.some(e => e.boss && !e.dead) && stairProgress() > 0.25) {   // sealed until the boss falls
    player.z = stairBox.z0 - 0.45; player.vz = 0;
    if (performance.now() - sealedMsgT > 2500) { sealedMsgT = performance.now(); flash('The way down is sealed until the boss falls.'); }
    return;
  }
  const up = upProgress();                                                          // climbing back up works only into floors still cached (never rebuilds one you left)
  if (up > 0.25) {
    const dest = floorNum > 1 ? floorCache[floorNum - 1] : stageCaches[stage - 1] && stageCaches[stage - 1][MAX_FLOOR];
    if (!dest) { player.z = upBox.dir > 0 ? upBox.z1 + 0.45 : upBox.z0 - 0.45; player.vz = 0; sealedUp(); return; }
    if (up >= 0.85) { if (floorNum > 1) changeFloor(floorNum - 1, 'up'); else changeStage(stage - 1, 'up'); return; }   // climbed back up (from floor 1: to the previous stage's safe room)
  }
  if (stairProgress() < 0.85) return;
  if (floorNum < MAX_FLOOR && stage !== FINAL_STAGE) changeFloor(floorNum + 1, 'down');
  else enterNextStage();
}
// Switch to stage s: its theme, look, seed and plan (shop, armory, encounters). The pack, hunger and health are untouched, so everything carries over.
function useStage(s) {
  prisonerRuns[stage] = prisonerRun;
  stage = s; floorCache = stageCaches[s] || (stageCaches[s] = {});
  theme = s === FINAL_STAGE ? FINAL_THEME : stageThemes[s - 1];
  HUSH = theme.mechanic.hush || 1;
  if (s < FINAL_STAGE) planStage(s); else { stageSeed = stageSeedOf(s); questPlan = {}; }
  prisonerRun = prisonerRuns[s] || null;
  for (const l of torchLights) l.color.setHex(theme.pal.light);
  torch.color.setHex(theme.pal.light);
  scene.background = new THREE.Color(theme.pal.fog); scene.fog = new THREE.FogExp2(theme.pal.fog, theme.fog.density);
  hud.theme.textContent = theme.name;
}
// Memory: at most 6 floors stay cached. Going down into stage cur keeps only the previous stage's boss floor (its safe room); climbing keeps the stage you left on its floor 1.
function disposeCache(c, keep) { for (const k of Object.keys(c)) if (!keep || !keep(+k)) { disposeGroup(c[k].group); delete c[k]; } }
function trimCaches(cur, dir) {
  for (const k of Object.keys(stageCaches)) {
    const t = +k; if (t === cur) continue;
    if (t === cur - 1 && dir === 'down') disposeCache(stageCaches[t], n => n === MAX_FLOOR);
    else if (t === cur + 1 && dir === 'up') disposeCache(stageCaches[t], n => n === 1);
    else { disposeCache(stageCaches[t]); delete stageCaches[t]; }
  }
}
// The stairs between stages. dir 'down': into stage s floor 1 (from the previous stage's safe room); 'up': into stage s's boss floor, its safe room, from the stage after it.
function changeStage(s, dir) {
  if (dir === 'up' && !(stageCaches[s] && stageCaches[s][MAX_FLOOR])) { sealedUp(); return; }
  allyDepart();
  saveFloor();                                         // into the old stage's cache
  search = null; cb.draw = null; cb.eat = null;
  useStage(s); trimCaches(s, dir);
  const n = dir === 'up' ? MAX_FLOOR : 1, c = floorCache[n];
  if (c) { loadFloor(n, c); arriveBy(dir); floorBanner(n); }
  else { group = null; generateAndEnter(n, dir); }
  flash(s === FINAL_STAGE ? 'The final stage. Whatever waits here has no name yet.' : dir === 'up' ? `You climb back up to stage ${s}: ${theme.name}, the safe room.` : `Stage ${s} of ${STAGES}: ${theme.name}. ${floor.boss ? '' : 'Find the stairs.'}`);
  allyArrive();
  hunger.fight = 0;
  pruneThemeTextures();                                // free the textures of themes with no floor left
}
// The stairs in the safe room lead to the next stage; after the last stage (the final boss) the run is over.
function enterNextStage() { if (stage < FINAL_STAGE) changeStage(stage + 1, 'down'); else finishRun(); }
// Dev and tests: a fresh stage s (all caches thrown away, no ally, no prisoner).
function startStage(s) {
  clearTimeout(winTimer);
  s = Math.max(1, Math.min(FINAL_STAGE, s | 0));
  for (const k of Object.keys(stageCaches)) { disposeCache(stageCaches[k]); delete stageCaches[k]; }
  allyReset(); prisonerRun = null; prisonerWalk = null; for (const k of Object.keys(prisonerRuns)) delete prisonerRuns[k]; for (const k of Object.keys(bossDead)) delete bossDead[k];
  useStage(s); startFloor(1); pruneThemeTextures();
}
function finishRun() {
  state = 'won';
  document.exitPointerLock();
  hud.overlayText.innerHTML = `<h1>Run complete</h1><p>The placeholder final boss is dead. You made it through all ${STAGES} stages. The real final fight is not designed yet.</p><p><button type="button" style="font:inherit;padding:6px 18px;cursor:pointer">Start a new run</button></p>`;
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
    if (e.code === 'KeyN') { if (floorNum < MAX_FLOOR && stage !== FINAL_STAGE) startFloor(floorNum + 1); else enterNextStage(); }
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
    gameT += dt;
    updateRespawn(dt);
    updateArrows(dt);
    updateDoors(dt);
    if (prisonerWalk) prisonerStep(Math.min(dt, 0.05));                                // a freed prisoner on its way to the stairs (js/quests.js): only while one is walking
    const events = pending.splice(0);              // noises guards made last frame
    for (const n of events) rings.push({ x: n.x, z: n.z, r: n.r, t: 0 });
    const under = floor.patches.get(player.tileY * floor.w + player.tileX), mt = theme.mechanic.TUNE;
    const hush = HUSH * (player.crouching && mt && mt.wind ? mt.wind : 1);          // the Frozen Chapel's wind muffles a crouching player
    if (pulse > 0) { events.push({ x: player.x, z: player.z, r: pulse * hush }); rings.push({ x: player.x, z: player.z, r: pulse * hush, t: 0 }); }
    if (player.noiseRadius > 0) events.push({ x: player.x, z: player.z, r: (player.noiseRadius + (under === 'brush' ? mt.rustle : 0)) * hush });   // brush rustles: +3 m while you move in it
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
    const noise = { events, emit: (x, z, r, src) => pending.push({ x, z, r, src }), shoot: spawnEnemyShot, steal: stealGold, prints: floor.prints, pt: mt, t: gameT };
    for (const e of enemies) { const zone = e.update(Math.min(dt, 0.05), player, noise); if (zone) resolveEnemyAttack(e, zone); }
    if (allyRun) allyStep(Math.min(dt, 0.05), noise);                                  // the recruited ally (js/quests.js): returns at once unless one is alive on this floor
    separateBodies(enemies, player, floor);
    updateBombs(dt); updateGas(dt);
    for (const e of enemies) if (e.dead && !e.corpseDone) { if (e.boss) bossDefeated(e); else makeCorpse(e, false); addLog(e.spec.mini ? `${e.spec.mini.name} ${e.cause}.` : `The ${e.T.name.toLowerCase()} ${e.cause}.`, '#ff6a6a'); }
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
  if (frameCount % 3 === 0) { if (state === 'play' && theme.mechanic.kind === 'brush') updateBrush(); drawMinimap(3); }                      // and the minimap three times a second per 9 frames, not every frame
  updateHud();
  perfStats.logic = perfStats.logic * 0.95 + (performance.now() - tl0) * 0.05;
  if (!params.has('norender')) { renderer.render(scene, camera); if (state === 'play') adaptQuality(dt, r => { renderer.setPixelRatio(r); resize(); }); }   // ?norender=1: tests skip the (software) drawing and keep all the game logic
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);

// Debug hook for testing from the console.
window.game = {
  player, startFloor, startStage, changeStage, inv, cb, pst, hunger, arrows, perfStats, get floorCache() { return floorCache; }, get stageCaches() { return stageCaches; }, get stage() { return stage; }, get shopFloor() { return shopFloor; }, get stageThemes() { return stageThemes; }, renderInfo() { camera.position.set(player.x, eyeY(), player.z); camera.rotation.set(player.pitch, player.yaw, 0); updateCulling(player, cullChunks, propObjs, enemies); renderer.render(scene, camera); return { calls: renderer.info.render.calls, tris: renderer.info.render.triangles, geos: renderer.info.memory.geometries, tex: renderer.info.memory.textures }; }, get shopUI() { return shopUI; }, get rings() { return rings; }, get floor() { return floor; }, get enemies() { return enemies; }, get state() { return state; },
  draw() {
    camera.position.set(player.x, eyeY(), player.z);
    camera.rotation.set(player.pitch, player.yaw, 0);
    updateViewmodel(1); updateCulling(player, cullChunks, propObjs, enemies); updateTorches(performance.now()); drawMinimap(); renderer.render(scene, camera);
  },
};
