// Scene building, HUD, minimap, and the floor-to-floor loop.
const MAX_FLOOR = 5;       // floors per stage: floorNum is the floor WITHIN the stage, and floor 5 is the stage's boss arena (with the safe room)
const STAGES = 4, FINAL_STAGE = 5;   // 4 themed stages, then stage 5: one boss arena with the final boss, the Cinder Wyrm
const params = new URLSearchParams(location.search);
const runSeed = params.has('seed') ? (parseInt(params.get('seed'), 10) >>> 0) : (Math.random() * 4294967296) >>> 0;
// Stage 1 keeps the theme the seed always picked; stages 2 to 4 take three other themes, shuffled from the seed (no repeats).
const stageThemes = (() => { const t0 = makeRng(runSeed).pick(THEMES); return [t0, ...makeRng((runSeed ^ 0x7e3a11) >>> 0).shuffle(THEMES.filter(t => t !== t0)).slice(0, STAGES - 1)]; })();
let stage = 1, stageSeed = runSeed, theme = stageThemes[0];   // stageSeed is the run seed for stage 1 (so stage 1 generates exactly as before) and a seeded mix of it for the others

const canvas = document.getElementById('game');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: 'high-performance' });
renderer.setPixelRatio(quality.cur);   // 1.5 at most; js/perf.js lowers it if the frame rate drops
// An integrated Intel GPU (the browser often picks it on dual-GPU laptops whatever powerPreference says) starts one stage down at pixel ratio 1; Auto still steps up if frames allow.
try { const gl = renderer.getContext(), x = gl.getExtension("WEBGL_debug_renderer_info"), n = x ? String(gl.getParameter(x.UNMASKED_RENDERER_WEBGL)) : ""; quality.gpu = n; if (/Intel/i.test(n) && quality.mode === "auto" && quality.level === 0) { setQualityLevel(1); quality.cur = Math.min(quality.max, 1); renderer.setPixelRatio(quality.cur); } } catch (e) { }
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
Enemy.target = player;   // for the Easy-mode vision fans (js/enemy.js)
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
const PATCH_KINDS = THEME_DEFS.flatMap(t => t.mechanic.n ? [t.mechanic.kind, ...(t.mechanic.also || []).map(a => a.kind)] : []);   // the decal kinds the themes' mechanics place (puddle, grass, glowcap, dark, bell, ice, brush)
let HUSH = theme.mechanic.hush || 1;           // the Library's dead silence: every sound you make carries farther
// Mechanic handlers, by the theme's mechanic.kind: what standing on a decal of that kind does to the player (hot path: one lookup a frame, no allocation).
//   slippery: you slide.  seen: multiplier on how far guards see you.  disc: glossary entry.
const MECH_PATCH = {
  puddle:  { slow: true, disc: ['item:puddle', 'Shallow water'] },   // the Tavern's flooded patches: you wade (x TUNE.slow); the splash noise is in the frame loop, guards wade too (js/enemy.js goTo, floor.waterSlow)
  moon:    { seen: () => theme.mechanic.TUNE.moon, disc: ['item:moon', 'Moonlight'] },       // the Orchard: guards see you farther on a moonlit patch...
  shade:   { seen: () => theme.mechanic.TUNE.shade, disc: ['item:moon', 'Moonlight'] },     // ...and less far in the shade of the trees
  glowcap: { seen: () => { const t = theme.mechanic.TUNE; return t && t.glow || 1.4; }, disc: ['item:glow', 'Glowing spores'] },
  dark:    { seen: () => theme.mechanic.TUNE.dark, disc: ['item:dark', 'Dark pockets'] },   // the Cellar: guards see you x TUNE.dark here, and your footsteps are quieter (the frame loop)
  ice:     { slippery: true, disc: ['item:ice', 'Ice'] },
  crowd:   { seen: () => theme.mechanic.TUNE.blend, disc: ['item:crowd', 'Market crowd'] },   // the Goblin Market: you blend into a busy patch (guards see you x blend); your footsteps are muffled there too (din, in the frame loop)
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
  for (let i = 0; i < 26; i++) {   // frost as jagged shards (not round blobs): a spiky polygon, a few of them with a bright rim
    const cx = rng() * S, cy = rng() * S, R = 6 + rng() * 18, n = 5 + Math.floor(rng() * 4), a0 = rng() * 6.28, sq = 0.45 + rng() * 0.5;
    g.beginPath();
    for (let k = 0; k < n * 2; k++) { const a = a0 + k / (n * 2) * 6.283, r = R * (k % 2 ? 0.3 + rng() * 0.25 : 0.7 + rng() * 0.5); g.lineTo(cx + Math.cos(a) * r, cy + Math.sin(a) * r * sq); }
    g.closePath(); g.fillStyle = `rgba(235,245,255,${0.08 + rng() * 0.16})`; g.fill();
    if (rng() < 0.4) { g.strokeStyle = 'rgba(255,255,255,0.22)'; g.lineWidth = 1; g.stroke(); }
  }
  g.strokeStyle = 'rgba(255,255,255,0.14)'; g.lineWidth = 1;   // hairline cracks
  for (let i = 0; i < 14; i++) { let x = rng() * S, y = rng() * S, a = rng() * 6.28; g.beginPath(); g.moveTo(x, y); for (let k = 0; k < 4; k++) { a += (rng() - 0.5) * 1.2; x += Math.cos(a) * (6 + rng() * 10); y += Math.sin(a) * (6 + rng() * 10); g.lineTo(x, y); } g.stroke(); }
  for (let i = 0; i < 900; i++) { g.fillStyle = 'rgba(255,255,255,0.2)'; g.fillRect(rng() * S, rng() * S, 1 + rng() * 1.5, 1 + rng() * 1.5); }
});
// Chapel vault ceiling: pale stone ribs.
const vaultTexture = base => paintTex(base, 'vault', 128, (g, S, rng, col) => {
  g.fillStyle = shade(col, 0.8); g.fillRect(0, 0, S, S);
  for (let i = 0; i < 4; i++) { g.fillStyle = shade(col, 1.15); g.fillRect(i * 32 + 14, 0, 4, S); g.fillRect(0, i * 32 + 14, S, 4); }
  speckle(g, S, 400, rng);
});
// Mushroom Cellar and Clockwork Library textures (256 px, painted once per theme).
// Cap-stone wall: dark ashlar whose blocks have rounded caps, a wine rack set into the middle band (a lattice with bottle ends in every cell).
const capstoneTexture = base => paintTex(base, 'cap', 256, (g, S, rng, col) => {
  g.fillStyle = shade(col, 0.4); g.fillRect(0, 0, S, S);
  for (let r = 0; r < 8; r++) for (let b = -1; b < 4; b++) {
    if (r >= 3 && r <= 5) continue;
    const x = b * 64 + (r % 2 ? 32 : 0), y = r * 32; g.fillStyle = shade(col, 0.68 + rng() * 0.32);
    g.beginPath(); g.moveTo(x + 2, y + 31); g.lineTo(x + 2, y + 11); g.quadraticCurveTo(x + 32, y - 3, x + 62, y + 11); g.lineTo(x + 62, y + 31); g.fill();
    if (rng() < 0.3) blob(g, x + 10 + rng() * 44, y + 8 + rng() * 14, 5 + rng() * 8, 3 + rng() * 4, 'rgba(120,210,190,0.16)');   // a bloom of spores
  }
  g.fillStyle = '#1c1210'; g.fillRect(0, 96, S, 96);
  const glass = ['#2a4a3a', '#3a2a5a', '#2a3a4a', '#4a2a3a'];
  for (let gy = 0; gy < 3; gy++) for (let gx = 0; gx < 8; gx++) { const cx = gx * 32 + 16, cy = 96 + gy * 32 + 16; blob(g, cx, cy, 11, 11, glass[(rng() * 4) | 0]); blob(g, cx - 3, cy - 3, 3.5, 3, 'rgba(255,255,255,0.28)'); }
  g.fillStyle = '#4a3220'; for (let i = 0; i <= 8; i++) g.fillRect(i * 32 - 2, 96, 4, 96); for (let j = 0; j <= 3; j++) g.fillRect(0, 96 + j * 32 - 2, S, 4);
  speckle(g, S, 1000, rng);
  const gr = g.createLinearGradient(0, 0, 0, S); gr.addColorStop(0, 'rgba(0,0,0,0.3)'); gr.addColorStop(0.12, 'rgba(0,0,0,0)'); gr.addColorStop(0.86, 'rgba(0,0,0,0)'); gr.addColorStop(1, 'rgba(0,0,0,0.4)'); g.fillStyle = gr; g.fillRect(0, 0, S, S);
});
// Damp cellar floor: dark flagstones, wet sheen in the dips and a few glowing spores.
const dampFloorTexture = base => paintTex(base, 'damp', 256, (g, S, rng, col) => {
  g.fillStyle = shade(col, 0.4); g.fillRect(0, 0, S, S);
  for (let r = 0; r < 3; r++) for (let q = 0; q < 3; q++) for (const dx of [0, -85]) { const x = q * 85 + (r % 2 ? 30 : 0) + dx, y = r * 85; g.fillStyle = shade(col, 0.6 + rng() * 0.3); g.fillRect(x + 2, y + 2, 81, 81); }
  for (let i = 0; i < 26; i++) blob(g, rng() * S, rng() * S, 8 + rng() * 22, 5 + rng() * 12, 'rgba(70,120,140,0.14)');
  for (let i = 0; i < 40; i++) blob(g, rng() * S, rng() * S, 1 + rng() * 2, 1 + rng() * 2, 'rgba(140,255,210,0.35)');
  speckle(g, S, 1500, rng);
});
// Tavern: plank walls (upright boards between dark timbers, a water stain at the foot), a wet dark plank floor.
const plankWallTexture = base => paintTex(base, 'plankwall', 256, (g, S, rng, col) => {
  g.fillStyle = shade(col, 0.35); g.fillRect(0, 0, S, S);
  for (let b = 0; b < 8; b++) {
    g.fillStyle = shade(col, 0.65 + rng() * 0.3); g.fillRect(b * 32 + 1, 0, 30, S);
    for (let l = 0; l < 5; l++) { g.fillStyle = `rgba(0,0,0,${0.05 + rng() * 0.08})`; g.fillRect(b * 32 + 4 + rng() * 22, rng() * S, 1, 20 + rng() * 50); }
    g.fillStyle = 'rgba(20,16,12,0.7)'; g.fillRect(b * 32 + 6, 40, 2, 2); g.fillRect(b * 32 + 24, 150, 2, 2);   // nail heads
  }
  g.fillStyle = shade(col, 0.4); for (const y of [0, 120]) g.fillRect(0, y, S, 18);                           // two timber beams
  g.fillStyle = shade(col, 0.5); g.fillRect(0, 0, 14, S);                                                    // a post at the edge
  const gr = g.createLinearGradient(0, S * 0.65, 0, S); gr.addColorStop(0, 'rgba(30,60,70,0)'); gr.addColorStop(1, 'rgba(30,60,70,0.55)'); g.fillStyle = gr; g.fillRect(0, S * 0.65, S, S * 0.35);   // flood stain
  speckle(g, S, 1200, rng);
});
const wetWoodTexture = base => paintTex(base, 'wetwood', 256, (g, S, rng, col) => {
  g.fillStyle = shade(col, 0.4); g.fillRect(0, 0, S, S);
  for (let p = 0; p < 6; p++) for (let y = -rng() * 60; y < S;) { const len = 70 + rng() * 90; g.fillStyle = shade(col, 0.6 + rng() * 0.3); g.fillRect(p * 42.6 + 1.5, y + 1.5, 39.6, len - 3); y += len; }
  for (let i = 0; i < 30; i++) blob(g, rng() * S, rng() * S, 8 + rng() * 22, 5 + rng() * 12, 'rgba(60,100,125,0.2)');   // wet sheen
  speckle(g, S, 1400, rng);
});
// Orchard: a clipped hedge for the walls, short grass for the floor, a starry night for the sky.
const hedgeWallTexture = base => paintTex(base, 'hedge', 256, (g, S, rng, col) => {
  g.fillStyle = shade(col, 0.4); g.fillRect(0, 0, S, S);
  for (let i = 0; i < 170; i++) blob(g, rng() * S, rng() * S, 5 + rng() * 11, 4 + rng() * 8, shade(col, 0.5 + rng() * 0.7));
  for (let i = 0; i < 14; i++) blob(g, rng() * S, rng() * S, 1.5, 1.5, 'rgba(220,230,255,0.55)');         // moonlit blossom
  speckle(g, S, 900, rng);
  const gr = g.createLinearGradient(0, 0, 0, S); gr.addColorStop(0, 'rgba(0,0,0,0.25)'); gr.addColorStop(0.14, 'rgba(0,0,0,0)'); gr.addColorStop(0.86, 'rgba(0,0,0,0)'); gr.addColorStop(1, 'rgba(0,0,0,0.4)'); g.fillStyle = gr; g.fillRect(0, 0, S, S);
});
const grassFloorTexture = base => paintTex(base, 'grassfloor', 256, (g, S, rng, col) => {
  g.fillStyle = shade(col, 0.75); g.fillRect(0, 0, S, S);
  for (let i = 0; i < 50; i++) blob(g, rng() * S, rng() * S, 8 + rng() * 22, 6 + rng() * 14, rng() < 0.5 ? 'rgba(70,120,70,0.18)' : 'rgba(30,50,40,0.2)');
  g.lineWidth = 1; for (let i = 0; i < 500; i++) { g.strokeStyle = shade(col, 0.8 + rng() * 0.7); const x = rng() * S, y = rng() * S; g.beginPath(); g.moveTo(x, y); g.lineTo(x + (rng() - 0.5) * 3, y - 3 - rng() * 4); g.stroke(); }
});
const starryTexture = base => paintTex(base, 'starry', 128, (g, S, rng, col) => {
  g.fillStyle = shade(col, 0.8); g.fillRect(0, 0, S, S);
  for (let i = 0; i < 5; i++) blob(g, rng() * S, rng() * S, 14 + rng() * 22, 3 + rng() * 5, 'rgba(120,140,190,0.12)');   // thin cloud
  for (let i = 0; i < 40; i++) { const k = 0.4 + rng() * 0.6; g.fillStyle = `rgba(230,236,255,${k})`; g.fillRect(rng() * S, rng() * S, 1 + (rng() < 0.2), 1 + (rng() < 0.2)); }
}, 1);
// Night sky for open-air themes (theme.sky): a deep gradient, haze at the horizon, stars and a pale moon, painted once on a hemisphere dome (the canvas top is the zenith, the bottom the horizon).
const skyTexture = (base, kind) => paintTex(base, 'sky' + kind, 512, kind === 'day' ? (g, S, rng) => {   // 'day' (Jungle): a pale green-gold sky seen through gaps in the leaves, with a warm sun glow
  const gr = g.createLinearGradient(0, 0, 0, S); gr.addColorStop(0, '#5f9a86'); gr.addColorStop(0.7, '#a9cf9a'); gr.addColorStop(1, '#e6e2a0'); g.fillStyle = gr; g.fillRect(0, 0, S, S);
  for (let i = 0; i < 5; i++) blob(g, rng() * S, S * (0.2 + rng() * 0.5), 50 + rng() * 60, 5 + rng() * 9, 'rgba(255,255,235,0.18)');
  const mx = S * 0.3, my = S * 0.4, mg = g.createRadialGradient(mx, my, 4, mx, my, 90); mg.addColorStop(0, 'rgba(255,248,200,1)'); mg.addColorStop(0.15, 'rgba(255,240,170,0.7)'); mg.addColorStop(1, 'rgba(255,230,150,0)'); g.fillStyle = mg; g.fillRect(mx - 90, my - 90, 180, 180);
  for (let i = 0; i < 150; i++) { const y = S * Math.pow(rng(), 0.6); blob(g, rng() * S, y, 6 + rng() * 20, 4 + rng() * 12, `rgba(${14 + (rng() * 20 | 0)},${46 + (rng() * 36 | 0)},${14 + (rng() * 16 | 0)},${0.55 + rng() * 0.4})`); }   // leaf clumps, thickest at the horizon
} : (g, S, rng, col) => {
  const gr = g.createLinearGradient(0, 0, 0, S); gr.addColorStop(0, shade(col, 0.7)); gr.addColorStop(0.7, shade(col, 1.5)); gr.addColorStop(1, shade(col, 2.6)); g.fillStyle = gr; g.fillRect(0, 0, S, S);
  for (let i = 0; i < 6; i++) blob(g, rng() * S, S * (0.3 + rng() * 0.5), 40 + rng() * 60, 4 + rng() * 8, 'rgba(120,140,190,0.10)');
  for (let i = 0; i < 260; i++) { const k = 0.35 + rng() * 0.65; g.fillStyle = `rgba(230,236,255,${k})`; g.fillRect(rng() * S, rng() * S * 0.85, 1 + (rng() < 0.15), 1 + (rng() < 0.15)); }
  const mx = S * 0.3, my = S * 0.42, mg = g.createRadialGradient(mx, my, 6, mx, my, 38); mg.addColorStop(0, 'rgba(210,225,255,0.5)'); mg.addColorStop(1, 'rgba(210,225,255,0)'); g.fillStyle = mg; g.fillRect(mx - 40, my - 40, 80, 80);   // glow
  blob(g, mx, my, 11, 11, '#eef3ff'); blob(g, mx + 3, my - 2, 3, 3, 'rgba(160,175,210,0.5)');
});
// Library wall: rows of book spines (a small colour palette) on dark wood shelves with brass edging.
const shelfWallTexture = base => paintTex(base, 'shelf', 256, (g, S, rng, col) => {
  g.fillStyle = shade(col, 0.35); g.fillRect(0, 0, S, S);
  const pal = ['#6a2a2a', '#2a4a6a', '#3a6a3a', '#6a5a2a', '#5a2a6a', '#4a3a2a', '#7a4a2a', '#2a5a5a'];
  for (let row = 0; row < 4; row++) {
    const y0 = row * 64;
    for (let x = 5; x < S - 9;) {
      const bw = 7 + rng() * 9, bh = 34 + rng() * 20;
      if (rng() < 0.08) { x += 10; continue; }
      g.fillStyle = pal[(rng() * 8) | 0]; g.fillRect(x, y0 + 57 - bh, bw, bh); g.fillStyle = 'rgba(255,255,255,0.13)'; g.fillRect(x, y0 + 57 - bh, 1.5, bh); g.fillStyle = 'rgba(201,162,58,0.7)'; g.fillRect(x, y0 + 63 - bh, bw, 2); x += bw + 1;
    }
    g.fillStyle = shade(col, 0.8); g.fillRect(0, y0 + 57, S, 7); g.fillStyle = 'rgba(201,162,58,0.55)'; g.fillRect(0, y0 + 57, S, 1.5);
  }
  g.fillStyle = shade(col, 0.7); g.fillRect(0, 0, 5, S); g.fillRect(S - 5, 0, 5, S);
  speckle(g, S, 700, rng);
  const gr = g.createLinearGradient(0, 0, 0, S); gr.addColorStop(0, 'rgba(0,0,0,0.3)'); gr.addColorStop(0.12, 'rgba(0,0,0,0)'); gr.addColorStop(0.86, 'rgba(0,0,0,0)'); gr.addColorStop(1, 'rgba(0,0,0,0.4)'); g.fillStyle = gr; g.fillRect(0, 0, S, S);
});
// Parquet: basket-weave blocks of four planks with a thin brass inlay.
const parquetTexture = base => paintTex(base, 'parq', 256, (g, S, rng, col) => {
  g.fillStyle = shade(col, 0.35); g.fillRect(0, 0, S, S);
  for (let by = 0; by < 4; by++) for (let bx = 0; bx < 4; bx++) for (let i = 0; i < 4; i++) {
    g.fillStyle = shade(col, 0.75 + rng() * 0.4);
    if ((bx + by) % 2) g.fillRect(bx * 64 + 1, by * 64 + i * 16 + 1, 62, 14); else g.fillRect(bx * 64 + i * 16 + 1, by * 64 + 1, 14, 62);
  }
  g.fillStyle = 'rgba(201,162,58,0.28)'; g.fillRect(0, 126, S, 3); g.fillRect(126, 0, 3, S);
  speckle(g, S, 1400, rng);
});
// Goblin Market: canvas-and-timber walls (striped canvas panels between dark posts, rope, stitched patches), a cobbled floor strewn with straw, a patchwork cloth ceiling.
const canvasWallTexture = base => paintTex(base, 'canvas', 256, (g, S, rng, col) => {
  g.fillStyle = shade(col, 0.3); g.fillRect(0, 0, S, S);
  for (let p = 0; p < 4; p++) {
    g.fillStyle = shade(col, 0.65 + (p % 2) * 0.4 + rng() * 0.1); g.fillRect(p * 64 + 6, 0, 52, S);
    g.fillStyle = 'rgba(0,0,0,0.07)'; for (let y = 0; y < S; y += 4) g.fillRect(p * 64 + 6, y, 52, 1);                                  // canvas weave
    if (rng() < 0.75) { const x = p * 64 + 10 + rng() * 18, y = 20 + rng() * 190, w = 18 + rng() * 14, h = 18 + rng() * 18; g.fillStyle = shade(col, 0.5 + rng() * 0.9); g.fillRect(x, y, w, h); g.strokeStyle = 'rgba(30,20,10,0.6)'; g.setLineDash([3, 2]); g.strokeRect(x + 1, y + 1, w - 2, h - 2); g.setLineDash([]); }   // a stitched patch
  }
  g.fillStyle = shade(col, 0.25); for (let p = 0; p <= 4; p++) g.fillRect(p * 64 - 4, 0, 8, S);                                       // timber posts
  g.strokeStyle = 'rgba(200,170,110,0.75)'; g.lineWidth = 3; for (const y of [60, 170]) { g.beginPath(); g.moveTo(0, y); g.lineTo(S, y); g.stroke(); }   // rope bindings
  speckle(g, S, 900, rng);
  const gr = g.createLinearGradient(0, 0, 0, S); gr.addColorStop(0, 'rgba(0,0,0,0.25)'); gr.addColorStop(0.12, 'rgba(0,0,0,0)'); gr.addColorStop(0.8, 'rgba(0,0,0,0)'); gr.addColorStop(1, 'rgba(40,24,10,0.5)'); g.fillStyle = gr; g.fillRect(0, 0, S, S);   // dirt at the foot
});
const cobbleFloorTexture = base => paintTex(base, 'cobble', 256, (g, S, rng, col) => {
  g.fillStyle = shade(col, 0.3); g.fillRect(0, 0, S, S);
  for (let r = 0; r < 8; r++) for (let c = -1; c < 8; c++) { const x = c * 32 + (r % 2 ? 16 : 0), y = r * 32; g.fillStyle = shade(col, 0.6 + rng() * 0.5); g.beginPath(); g.ellipse(x + 16, y + 16, 14 + rng() * 2, 13 + rng() * 2, 0, 0, 7); g.fill(); }   // round cobbles
  for (let i = 0; i < 30; i++) blob(g, rng() * S, rng() * S, 6 + rng() * 14, 4 + rng() * 8, 'rgba(50,34,20,0.2)');                  // mud
  g.lineWidth = 1; for (let i = 0; i < 160; i++) { g.strokeStyle = `rgba(${200 + rng() * 40 | 0},${160 + rng() * 40 | 0},80,0.6)`; const x = rng() * S, y = rng() * S; g.beginPath(); g.moveTo(x, y); g.lineTo(x + (rng() - 0.5) * 9, y + (rng() - 0.5) * 9); g.stroke(); }   // straw
  speckle(g, S, 1200, rng);
});
const patchworkTexture = base => paintTex(base, 'patch', 128, (g, S, rng, col) => {
  const pal = ['#8a3a2a', '#2a4a6a', '#6a5a2a', '#4a6a3a', '#6a3a5a', '#8a7a5a'];
  for (let y = 0; y < 4; y++) for (let x = 0; x < 4; x++) { g.fillStyle = pal[(rng() * 6) | 0]; g.fillRect(x * 32, y * 32, 32, 32); g.fillStyle = `rgba(0,0,0,${0.3 + rng() * 0.25})`; g.fillRect(x * 32, y * 32, 32, 32); }
  g.strokeStyle = 'rgba(230,210,160,0.4)'; g.setLineDash([3, 3]); for (let y = 0; y < 4; y++) for (let x = 0; x < 4; x++) g.strokeRect(x * 32 + 2, y * 32 + 2, 28, 28);
  g.setLineDash([]); speckle(g, S, 300, rng);
}, 1);
// Final Chamber: dark purple ashlar with faint glowing runes, polished black slabs veined with violet, a void of a ceiling.
const voidWallTexture = base => paintTex(base, 'voidwall', 256, (g, S, rng, col) => {
  g.fillStyle = shade(col, 0.3); g.fillRect(0, 0, S, S);
  for (let r = 0; r < 4; r++) for (let b = -1; b < 3; b++) { const x = b * 128 + (r % 2 ? 64 : 0), y = r * 64; g.fillStyle = shade(col, 0.55 + rng() * 0.4); g.fillRect(x + 3, y + 3, 122, 58); g.fillStyle = 'rgba(255,255,255,0.05)'; g.fillRect(x + 3, y + 3, 122, 2); }
  g.strokeStyle = 'rgba(170,100,255,0.8)'; g.lineWidth = 1.5; g.shadowColor = 'rgba(170,100,255,0.9)'; g.shadowBlur = 6;   // glowing runes: short right-angled strokes
  for (let i = 0; i < 9; i++) { const x = 12 + rng() * 220, y = 12 + rng() * 220; g.beginPath(); g.moveTo(x, y); g.lineTo(x + 6 + rng() * 8, y); g.lineTo(x + 6 + rng() * 8, y + 6 + rng() * 10); g.lineTo(x + rng() * 6, y + 12 + rng() * 6); g.stroke(); }
  g.shadowBlur = 0; speckle(g, S, 900, rng);
  const gr = g.createLinearGradient(0, 0, 0, S); gr.addColorStop(0, 'rgba(0,0,0,0.3)'); gr.addColorStop(0.14, 'rgba(0,0,0,0)'); gr.addColorStop(0.86, 'rgba(0,0,0,0)'); gr.addColorStop(1, 'rgba(0,0,0,0.45)'); g.fillStyle = gr; g.fillRect(0, 0, S, S);
});
const obsidianFloorTexture = base => paintTex(base, 'obsidian', 256, (g, S, rng, col) => {
  g.fillStyle = shade(col, 0.4); g.fillRect(0, 0, S, S);
  for (let r = 0; r < 2; r++) for (let c = 0; c < 2; c++) { g.fillStyle = shade(col, 0.6 + rng() * 0.5); g.fillRect(c * 128 + 2, r * 128 + 2, 124, 124); }
  for (let i = 0; i < 24; i++) blob(g, rng() * S, rng() * S, 8 + rng() * 24, 5 + rng() * 14, 'rgba(120,90,180,0.07)');                   // a dull sheen
  g.strokeStyle = 'rgba(150,90,230,0.4)'; g.lineWidth = 1; for (let i = 0; i < 9; i++) { let x = rng() * S, y = rng() * S; g.beginPath(); g.moveTo(x, y); for (let k = 0; k < 5; k++) { x += (rng() - 0.5) * 40; y += (rng() - 0.5) * 40; g.lineTo(x, y); } g.stroke(); }   // violet veins
  speckle(g, S, 1000, rng);
});
const voidTexture = base => paintTex(base, 'void', 128, (g, S, rng, col) => {
  g.fillStyle = shade(col, 0.6); g.fillRect(0, 0, S, S);
  for (let i = 0; i < 8; i++) blob(g, rng() * S, rng() * S, 14 + rng() * 26, 6 + rng() * 14, 'rgba(90,50,150,0.14)');
  for (let i = 0; i < 24; i++) { g.fillStyle = `rgba(200,170,255,${0.3 + rng() * 0.5})`; g.fillRect(rng() * S, rng() * S, 1, 1); }
}, 1);
// Texture generators by the theme schema's tex keys (theme.tex.wall / floor / ceil), each from the theme's base colour.
const TEX_GENERATORS = {
  wall:  { stone: c => wallTexture(c), vine: c => vineWallTexture(c), iceblock: c => iceWallTexture(c), cave: c => caveWallTexture(c), capstone: c => capstoneTexture(c), shelf: c => shelfWallTexture(c), planks: c => plankWallTexture(c), hedge: c => hedgeWallTexture(c), canvas: c => canvasWallTexture(c), voidstone: c => voidWallTexture(c) },
  floor: { tile: c => floorTexture(c, false), planks: c => floorTexture(c, true), moss: c => mossFloorTexture(c), frost: c => frostFloorTexture(c), damp: c => dampFloorTexture(c), parquet: c => parquetTexture(c), wetwood: c => wetWoodTexture(c), grass: c => grassFloorTexture(c), cobble: c => cobbleFloorTexture(c), obsidian: c => obsidianFloorTexture(c) },
  ceil:  { beams: c => ceilingTexture(c), canopy: c => canopyTexture(c), vault: c => vaultTexture(c), starry: c => starryTexture(c), patchwork: c => patchworkTexture(c), void: c => voidTexture(c) },
};
// Wall geometry by the theme's wallStyle (up to 3 wall InstancedMeshes in all). 'box': plain boxes (buildings). The round styles ('shrub' Orchard hedges, 'tree' Jungle, 'rock' Cellar caves) are visual only: a few lumpy blobs
// merged into one shared geometry per kind (vertex colours, radial normals, hashed lumps), stamped once per wall tile that touches open floor with a hash of the tile for turn, size and tint (no rng draws).
// Nothing reaches more than ~0.3 m past the tile edge (blobs are clamped to a 1.75 m radius), so the walkable floor stays honest. Collision, sight and the minimap stay tile based.
const hash3 = (x, y, z) => { const s = Math.sin(x * 12.9898 + y * 78.233 + z * 37.719) * 43758.5453; return s - Math.floor(s); };
function addPart(P, geo, col, fn) {              // append a geometry to the merge lists; fn(v, n) may move the vertex and the normal and returns a brightness factor
  const p = geo.attributes.position, n = geo.attributes.normal, uv = geo.attributes.uv, base = P.pos.length / 3, c = new THREE.Color(col), v = new THREE.Vector3(), nn = new THREE.Vector3();
  for (let i = 0; i < p.count; i++) {
    v.fromBufferAttribute(p, i); nn.fromBufferAttribute(n, i); const f = fn(v, nn);
    P.pos.push(v.x, v.y, v.z); P.nor.push(nn.x, nn.y, nn.z); P.col.push(c.r * f * P.gain, c.g * f * P.gain, c.b * f * P.gain); P.uv.push(uv.getX(i) * 2, uv.getY(i) * 2);
  }
  for (const i of geo.index.array) P.idx.push(base + i);
  geo.dispose();
}
// A lumpy ellipsoid at (cx, cy, cz) with radii (rx, ry, rz): a dome (up: half sphere standing on its rim, down: hanging from it) or a whole one; lumps = hashed in/out push; darker toward the ground.
function leafBlob(P, col, cx, cy, cz, rx, ry, rz, lump = 0.14, part = 'full', w = 8, h = 4) {
  const geo = new THREE.SphereGeometry(1, w, h, 0, Math.PI * 2, part === 'down' ? Math.PI / 2 : 0, part === 'full' ? Math.PI : Math.PI / 2);
  addPart(P, geo, col, (v, nn) => {
    const dx = v.x, dy = v.y, dz = v.z, q = hash3(Math.round(dx * 997) + cx * 7.3, Math.round(dy * 997) + cy * 3.1, Math.round(dz * 997) + cz * 5.7), k = 1 + (q - 0.5) * 2 * lump;
    let x = cx + dx * rx * k, y = cy + dy * ry * k, z = cz + dz * rz * k; const r = Math.hypot(x, z);
    if (r > 1.75) { x *= 1.75 / r; z *= 1.75 / r; }
    v.set(x, y, z); nn.set(dx / rx, dy / ry, dz / rz).normalize();
    return (0.66 + 0.34 * Math.min(1, Math.max(0, y / 2.2))) * (0.92 + 0.16 * q);
  });
}
function trunk(P, col, rt, rb, h, w = 8, rings = 3) {       // a thick round trunk standing on the floor, its rings pushed in and out a little
  addPart(P, new THREE.CylinderGeometry(rt, rb, h, w, rings, true), col, (v, nn) => {
    const k = 1 + (hash3(Math.round(v.y * 50), Math.round(Math.atan2(v.z, v.x) * 20), rt) - 0.5) * 0.16; v.set(v.x * k, v.y + h / 2, v.z * k);
    return 0.85 + 0.3 * hash3(Math.round(v.y * 9), Math.round(Math.atan2(v.z, v.x) * 4), rb);
  });
}
const wallGeoCache = new Map();
function roundGeo(kind, gain, make) {
  let g = wallGeoCache.get(kind);
  if (!g) {
    const P = { pos: [], nor: [], col: [], uv: [], idx: [], gain }; make(P);
    g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(P.pos, 3)); g.setAttribute('normal', new THREE.Float32BufferAttribute(P.nor, 3));
    g.setAttribute('color', new THREE.Float32BufferAttribute(P.col, 3)); g.setAttribute('uv', new THREE.Float32BufferAttribute(P.uv, 2)); g.setIndex(P.idx);
    g.userData.shared = true; wallGeoCache.set(kind, g);
  }
  return g;
}
const WALL_GEO = {
  box: () => new THREE.BoxGeometry(TILE, WALL_H, TILE),
  shrub: () => roundGeo('shrub', 2.0, P => {          // a hedge tile: three overlapping domes of dark leaves
    leafBlob(P, 0x24502a, -0.35, 0, -0.3, 1.35, 2.7, 1.35, 0.10, 'up', 9, 4); leafBlob(P, 0x2d6232, 0.55, 0, 0.2, 1.2, 2.4, 1.2, 0.10, 'up', 9, 4); leafBlob(P, 0x1c4122, -0.1, 0, 0.65, 1.1, 2.1, 1.1, 0.10, 'up', 9, 4);
  }),
  appletree: () => roundGeo('appletree', 1.5, P => {  // an apple tree: a thick flared trunk, a root swell and a round crown of lumpy leaf balls
    trunk(P, 0x4a3422, 0.6, 0.9, 3.2); leafBlob(P, 0x4a3422, 0, 0, 0, 1.15, 0.7, 1.15, 0.12, 'up', 8, 3);
    leafBlob(P, 0x2f5a34, 0, 3.5, 0, 1.5, 1.1, 1.5, 0.12, 'full', 8, 5); leafBlob(P, 0x386a3a, 0.55, 3.2, 0.3, 1.2, 0.9, 1.2, 0.12, 'full', 7, 4); leafBlob(P, 0x27502e, -0.5, 3.3, -0.35, 1.2, 0.9, 1.2, 0.12, 'full', 7, 4); leafBlob(P, 0x3a7040, 0.1, 4.0, -0.2, 1.0, 0.8, 1.0, 0.12, 'full', 7, 4);
  }),
  tree: () => roundGeo('tree', 1.1, P => {            // a jungle tile: a thick trunk in a mound of leaves, a heavy crown, and a dark leaf curtain at the foot
    trunk(P, 0x3a2e20, 0.65, 1.0, 4.2, 8, 2); leafBlob(P, 0x2a5a24, 0.1, 0, 0.1, 1.7, 1.9, 1.7, 0.2, 'up', 8, 3); leafBlob(P, 0x356a2a, -0.5, 0, 0.6, 1.2, 1.5, 1.2, 0.2, 'up', 7, 3);
    leafBlob(P, 0x2f6226, 0, 3.7, 0, 1.6, 1.0, 1.6, 0.18, 'full', 8, 4); leafBlob(P, 0x3d7430, 0.6, 3.1, -0.4, 1.2, 0.9, 1.2, 0.18, 'full', 6, 3); leafBlob(P, 0x23501c, -0.7, 3.2, 0.4, 1.1, 0.9, 1.1, 0.18, 'full', 6, 3);
  }),
  rock: () => roundGeo('rock', 1.7, P => {            // cave rock: a boulder standing on the floor, one hanging from the ceiling, a lumpy waist between them
    leafBlob(P, 0x6a665e, -0.2, 0, 0.2, 1.6, 2.1, 1.6, 0.22, 'up', 8, 4); leafBlob(P, 0x57534c, 0.2, WALL_H, -0.2, 1.5, 1.8, 1.5, 0.22, 'down', 8, 4); leafBlob(P, 0x77726a, 0.1, 1.8, 0, 1.5, 1.3, 1.5, 0.22, 'full', 8, 4);
  }),
};
// per kind of round wall: y scale range (the Jungle's trees are irregular; shrubs vary a little; rock reaches the ceiling), whether the wall texture is painted on it
// A round wall tile's per-tile look from a hash of its coordinates (never the rng): a = turn, b = height, c = tint (all 0..1), k = width scale.
function tileHash(x, y) {
  const hh = Math.imul(x, 73856093) ^ Math.imul(y, 19349663), a = (hh >>> 0) % 997 / 997;
  return { a, b: (hh >>> 4) % 991 / 991, c: (hh >>> 9) % 983 / 983, k: 0.95 + a * 0.1 };
}
const ROUND_WALL = { shrub: { y0: 0.85, y1: 1.1, map: true }, appletree: { y0: 0.9, y1: 1.1, map: false }, tree: { y0: 0.75, y1: 1.1, map: false }, rock: { y0: 1, y1: 1, map: true } };
// What kind of wall each wall tile got this floor (tile index -> 'box' | 'shrub' | 'appletree' | 'tree' | 'rock'), filled by wallMesh.
let wallKinds = new Map();
const _rcast = new THREE.Raycaster(), _rmesh = new THREE.Mesh(undefined, new THREE.MeshBasicMaterial({ side: THREE.DoubleSide })), _rO = new THREE.Vector3(), _rD = new THREE.Vector3(), _rq = new THREE.Quaternion(), _rY = new THREE.Vector3(0, 1, 0), _rS = new THREE.Vector3();
// How far from the centre of wall tile (tx, ty) its real surface is, looking toward the open neighbour (dx, dy) (a unit step) at height y, in metres; null when nothing is there at that height.
// A box is flush at half a tile. A round wall is hit with a horizontal ray against its actual (turned, scaled) blob geometry: deterministic, no rng.
function wallSurface(tx, ty, dx, dy, y) {
  const kind = wallKinds.get(ty * floor.w + tx); if (!kind) return null;
  if (kind === 'box') return TILE / 2;
  const R = ROUND_WALL[kind], th = tileHash(tx, ty), cx = (tx + 0.5) * TILE, cz = (ty + 0.5) * TILE;
  _rmesh.geometry = WALL_GEO[kind](); _rmesh.position.set(cx, 0, cz); _rmesh.quaternion.setFromAxisAngle(_rY, th.a * 6.283); _rmesh.scale.set(th.k, R.y0 + th.b * (R.y1 - R.y0), th.k); _rmesh.updateMatrixWorld(true);
  _rcast.set(_rO.set(cx + dx * TILE, y, cz + dy * TILE), _rD.set(-dx, 0, -dy)); _rcast.far = TILE * 1.2;
  const hit = _rcast.intersectObject(_rmesh, false);
  return hit.length ? TILE - hit[0].distance : null;
}
// Door open animations by the theme's doors.openAnim: t runs 0 to 1. slide: up out of the way. roll (cave mouth): the curtain and boulders roll up to the lintel. sink (ice seal): the slab drops through the floor.
const DOOR_ANIM = {
  slide: (o, t) => { o.mesh.position.y = t * WALL_H; },
  roll: (o, t) => { const s = 1 - 0.95 * t; o.mesh.scale.y = s; o.mesh.position.y = (1 - s) * WALL_H + t * 0.5; },   // (the last 0.5 m lifts the rolled-up sliver above the ceiling plane, so a culling pass that shows the mesh again cannot reveal it)
  sink: (o, t) => { o.mesh.position.y = -t * (WALL_H + 0.2); },
  wither: (o, t) => { o.mesh.scale.y = Math.max(0.03, 1 - t); },                                                  // spore seal: the fungus mound shrinks away
  barred: (o, t) => { o.mesh.position.y = t * WALL_H; o.mesh.rotation.z = Math.sin(t * 24) * 0.04 * (1 - t); },                // tavern hatch: the barred door shudders as it heaves up
  fold: (o, t) => { if (o.leaf) o.leaf.scale.x = Math.max(0.05, 1 - t); },                                                    // garden gate: the iron leaf folds back to its hinge post
  shutter: (o, t) => { const q = Math.floor(t * 12) / 12, s = 1 - 0.95 * q; o.mesh.scale.y = s; o.mesh.position.y = (1 - s) * WALL_H + q * 0.5; },   // shuttered stall: the slatted shutter rolls up in jerky steps (twelve of them)
  gate: (o, t) => { o.mesh.position.y = t * WALL_H; if (o.cogs) { o.cogs[0].rotation.z = t * 14; o.cogs[1].rotation.z = -t * 17; } },   // clockwork gate: slides up while its cogs spin
};

// Free one object's GPU memory. Anything flagged userData.shared (the per-theme textures, creature part geometries, shared merged
// materials, icons) outlives the floor and is never disposed here.
function freeObject(o) {
  if (o.isInstancedMesh && o.dispose) o.dispose();   // (floor drops: the per-instance buffers; geometry and materials are shared)
  if (o.geometry && !o.geometry.userData.shared) o.geometry.dispose();
  const ms = o.material; if (!ms) return;
  if (Array.isArray(ms)) { for (const m of ms) freeMaterial(m); } else freeMaterial(ms);
}
function freeMaterial(m) { if (m.userData.shared) return; if (m.map && !(m.map.userData && m.map.userData.shared)) m.map.dispose(); m.dispose(); }
// Floor, wall and ceiling textures are painted once per theme and shared by every floor of it. A theme's are freed when no cached
// floor of it is left (pruneThemeTextures, after a stage change).
// The wall, floor and ceiling materials are shared the same way (a floor that is rebuilt would otherwise free the shader programs
// and compile them again on its first frame).
const themeTex = new Map(); let pinTheme = null;
function themeTexture(kind, make) {
  const key = theme.name + '|' + kind;
  let t = themeTex.get(key); if (!t) { t = make(); t.userData = { shared: true }; themeTex.set(key, t); }
  return t;
}
const sharedLams = new Map();   // plain lit materials of the stairs, shared by every floor
function sharedLam(c) { let m = sharedLams.get(c); if (!m) { m = new THREE.MeshLambertMaterial({ color: c }); m.userData.shared = true; sharedLams.set(c, m); } return m; }
function pruneThemeTextures() {
  const live = new Set([theme.name]); if (pinTheme) live.add(pinTheme);   // pinTheme: the next stage's theme, its textures built ahead on the boss floor
  for (const k of Object.keys(stageCaches)) if (Object.keys(stageCaches[k]).length) live.add((+k === FINAL_STAGE ? FINAL_THEME : stageThemes[k - 1]).name);
  for (const [key, t] of themeTex) if (!live.has(key.split('|')[0])) { t.dispose(); themeTex.delete(key); }   // (a material's map is its own entry, so disposing both is fine)
}

// The three big canvas textures of the current theme (the slow part of a theme's first floor); warmTheme builds them ahead in idle time.
const themeWallTex = () => themeTexture('wall', () => TEX_GENERATORS.wall[theme.tex.wall](theme.pal.wall));
const themeFloorTex = () => themeTexture('floor', () => { const t = TEX_GENERATORS.floor[theme.tex.floor](theme.pal.floor); t.repeat.set(1 / TILE, 1 / TILE); return t; });
const themeCeilTex = () => themeTexture('ceil', () => TEX_GENERATORS.ceil[theme.tex.ceil](theme.pal.ceil));
function applyFog() { if (scene.fog) scene.fog.density = theme.fog.density * (PERF.floorBoss ? 1 : quality.fogK); }   // (a boss arena always draws out to PERF.arena m, so its fog stays as it is)   // a shorter draw distance (js/perf.js quality level) gets denser fog, so the cut is not seen
function buildFloor() {
  PERF.floorBoss = !!floor.boss;
  wallKinds = new Map();
  knock.m = 0; player.dashS.on = false; bossLanesClear(); bossPuddlesClear(); bossFlamesClear();   // no knockback, ice lane, ale puddle or flame patch carries over a floor change or restart
  if (group) {   // free the old floor's GPU memory: geometry, materials and their textures
    scene.remove(group);
    group.traverse(freeObject); bakeFree(group.userData.bake);
  }
  group = new THREE.Group();
  const { w, h, tiles } = floor;
  const movers = floor.movers || [];
  for (const m of movers) { if (m.sliding) { m.k ^= 1; m.t = 0; m.sliding = false; } for (let i = 0; i < 4; i++) tiles[moverTile(m, i)] = T_FLOOR; }   // Library shelves: all 4 strip tiles open while the static walls are found (a floor left mid-slide has finished it)
  const solid = (x, y) => x < 0 || y < 0 || x >= w || y >= h || tiles[y * w + x] === T_WALL;

  // walls: only tiles that touch an open tile (8-neighbourhood) get a box
  const wallPos = [];
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    if (tiles[y * w + x] !== T_WALL) continue;
    let touches = false;
    for (let dy = -1; dy <= 1 && !touches; dy++) for (let dx = -1; dx <= 1; dx++) if (!solid(x + dx, y + dy)) { touches = true; break; }
    if (touches) wallPos.push([x, y]);
  }
  const wallTex = themeWallTex();
  const round = theme.wallStyle !== 'box' && WALL_GEO[theme.wallStyle] ? theme.wallStyle : null;   // 'shrub' | 'tree' | 'rock': lumpy blobs, no boxes
  const m = new THREE.Matrix4(), wp = new THREE.Vector3(), wq = new THREE.Quaternion(), ws = new THREE.Vector3(), yAxis = new THREE.Vector3(0, 1, 0), tint = new THREE.Color();
  const wallMesh = (list, mat, kind, extra = 0) => {     // one InstancedMesh per wall material: at most 2 (plus the safe room's) draws. extra: spare instances at the end (the Library's sliding shelves)
    const im = new THREE.InstancedMesh((WALL_GEO[kind] || WALL_GEO.box)(), mat, list.length + extra), R = ROUND_WALL[kind];
    list.forEach(([x, y], i) => {
      wallKinds.set(y * floor.w + x, kind || 'box');
      if (R) {                                      // a hash of the tile (never the rng): turn, size, height and tint, so the wall does not look stamped
        const { a, b, c, k } = tileHash(x, y);
        wq.setFromAxisAngle(yAxis, a * 6.283); m.compose(wp.set((x + 0.5) * TILE, 0, (y + 0.5) * TILE), wq, ws.set(k, R.y0 + b * (R.y1 - R.y0), k)); im.setColorAt(i, tint.setRGB(0.86 + c * 0.2, 0.86 + b * 0.2, 0.86 + a * 0.16));
      } else m.setPosition((x + 0.5) * TILE, WALL_H / 2, (y + 0.5) * TILE);
      im.setMatrixAt(i, m);
    });
    im.frustumCulled = false;                      // an instanced mesh is culled by its first box only, so never cull it
    group.add(im); return im;
  };
  const roundMat = (key, map, kind) => themeTexture(key, () => new THREE.MeshPhongMaterial({ map: ROUND_WALL[kind].map ? map() : null, vertexColors: true, shininess: 4, specular: 0x101010 }));
  let caveList = null;                             // the Jungle's locked rooms are dark caves: their walls (and a dark patch on the floor) use cave rock
  if (theme.doors.style === 'cave' && floor.rooms.some(r => r.locked)) {
    const mask = new Uint8Array(w * h); caveList = [];
    for (const r of floor.rooms) if (r.locked) for (let y = r.y - 1; y <= r.y + r.h; y++) for (let x = r.x - 1; x <= r.x + r.w; x++) if (x >= 0 && y >= 0 && x < w && y < h) mask[y * w + x] = 1;
    for (let i = wallPos.length - 1; i >= 0; i--) if (mask[wallPos[i][1] * w + wallPos[i][0]]) caveList.push(wallPos.splice(i, 1)[0]);
  }
  let pillarList = null;                           // the Orchard's lone trunks (a wall tile with no wall around it) are apple trees, the hedge tiles are shrubs
  if (round === 'shrub') { pillarList = []; for (let i = wallPos.length - 1; i >= 0; i--) { const [x, y] = wallPos[i]; let lone = true; for (let dy = -1; dy <= 1 && lone; dy++) for (let dx = -1; dx <= 1; dx++) if ((dx || dy) && solid(x + dx, y + dy)) { lone = false; break; } if (lone) pillarList.push(wallPos.splice(i, 1)[0]); } }
  const walls = wallMesh(wallPos, round ? roundMat('wallmat', () => wallTex, round) : themeTexture('wallmat', () => new THREE.MeshPhongMaterial({ map: wallTex, shininess: 5, specular: 0x151515 })), round || 'box', movers.length * 2);   // per-pixel lighting: torch light pools smoothly across big faces
  floor.moverMesh = null;
  if (movers.length) {                              // the shelves are extra instances of the wall mesh (same texture, a little lower and slimmer): no extra draw call; updateMovers slides them
    floor.moverMesh = walls; floor.moverBase = wallPos.length;
    movers.forEach((mv, j) => {
      for (let i = 0; i < 2; i++) walls.setMatrixAt(wallPos.length + j * 2 + i, m.compose(wp.set(0, WALL_H * 0.43, 0), wq.set(0, 0, 0, 1), mv.dx ? ws.set(0.98, 0.86, 0.86) : ws.set(0.86, 0.86, 0.98)));
      for (let i = 2 * mv.k; i < 2 * mv.k + 2; i++) tiles[moverTile(mv, i)] = T_WALL;
      posMover(mv, j, 0);
    });
    walls.instanceMatrix.needsUpdate = true;
  }
  if (pillarList && pillarList.length) wallMesh(pillarList, roundMat('treemat', null, 'appletree'), 'appletree');
  if (caveList && caveList.length) {
    const cavekind = round ? 'rock' : 'box', caveTex = () => themeTexture('cavewall', () => TEX_GENERATORS.wall.cave('#3a3830'));
    wallMesh(caveList, round ? roundMat('cavemat', caveTex, 'rock') : themeTexture('cavemat', () => new THREE.MeshPhongMaterial({ map: caveTex(), shininess: 2, specular: 0x050505 })), cavekind);
    const dark = themeTexture('cavedark', () => new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.45, depthWrite: false }));
    for (const r of floor.rooms) if (r.locked) { const p = new THREE.Mesh(new THREE.PlaneGeometry(r.w * TILE, r.h * TILE), dark); p.rotation.x = -Math.PI / 2; p.position.set((r.x + r.w / 2) * TILE, 0.02, (r.y + r.h / 2) * TILE); p.renderOrder = 1; group.add(p); }
  }

  // floor is a shape with a rectangular hole where the stairwell goes down
  const sx = (floor.stairs.x + 0.5) * TILE, sz = (floor.stairs.y + 0.5) * TILE;
  stairBox = { x0: sx - STAIR_HALF_W, x1: sx + STAIR_HALF_W, z0: sz - STAIR_HALF_L, z1: sz + STAIR_HALF_L };
  const floorShape = new THREE.Shape();
  floorShape.moveTo(0, 0); floorShape.lineTo(w * TILE, 0); floorShape.lineTo(w * TILE, -h * TILE); floorShape.lineTo(0, -h * TILE);
  const hole = new THREE.Path();           // shape y maps to world -z after rotation
  hole.moveTo(stairBox.x0, -stairBox.z0); hole.lineTo(stairBox.x0, -stairBox.z1);
  hole.lineTo(stairBox.x1, -stairBox.z1); hole.lineTo(stairBox.x1, -stairBox.z0);
  floorShape.holes.push(hole);
  const floorTex = themeFloorTex();
  const fl = new THREE.Mesh(new THREE.ShapeGeometry(floorShape), themeTexture('floormat', () => new THREE.MeshPhongMaterial({ map: floorTex, shininess: 12, specular: 0x222222 })));
  fl.rotation.x = -Math.PI / 2;
  const ceilMat = () => themeTexture('ceilmat', () => new THREE.MeshPhongMaterial({ map: themeCeilTex(), shininess: 2, specular: 0x050505 }));
  group.add(fl);
  if (theme.sky) {   // open air: no ceiling plane, one unlit sky dome that follows the camera (frame loop; shared geometry, material and texture, never disposed per floor)
    const sky = new THREE.Mesh(themeTexture('skygeo', () => new THREE.SphereGeometry(60, 16, 8, 0, Math.PI * 2, 0, Math.PI / 2)),
      themeTexture('skymat', () => new THREE.MeshBasicMaterial({ map: themeTexture('sky', () => skyTexture(theme.pal.ceil, theme.sky)), side: THREE.BackSide, fog: false, depthWrite: false, depthTest: false })));
    sky.renderOrder = -10; sky.frustumCulled = false; sky.userData.sky = true; group.userData.sky = sky; group.add(sky);
  } else {
    const planeGeo = new THREE.PlaneGeometry(w * TILE, h * TILE), uv = planeGeo.attributes.uv; for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * w, uv.getY(i) * h);   // one repeat per tile: the plane's UVs carry the size, so the texture is shared by every floor
    const ce = new THREE.Mesh(planeGeo, ceilMat());
    ce.rotation.x = Math.PI / 2; ce.position.set(w * TILE / 2, WALL_H, h * TILE / 2);
    group.add(ce);
  }

  // stairwell: steps descending along +z into the hole, with side and end walls. (Its steps, walls and the flight up are merged into a few meshes below, like the furniture.)
  const stairRoots = [], stairFrom = group.children.length;
  const asRoot = (from, x, z) => { const r = new THREE.Group(); r.position.set(x, 0, z); r.updateMatrixWorld(true); for (const m of group.children.slice(from)) if (m.isMesh) r.attach(m); return r; };   // the meshes added since `from`, re-parented under a root at the stairs (mergeStatic chunks and culls by the root's position)
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
  stairRoots.push(asRoot(stairFrom, sx, sz));
  stairsLight = { x: sx, y: 0.6, z: sz, color: 0xffe0a0, i: 0.35, d: 12, swing: 0.08 };   // the glow at the way down (baked into the floor's light grid)

  // the stairs back up (floors 2 and deeper): a flight of steps on the start tile, rising from the open side
  upBox = null; upLight = null; floor.up = null;
  if (floorNum > 1 || stage > 1) {                         // (floor 1 of stage 2 and later leads back to the previous stage's safe room)
    const st = floor.start, open = (x, y) => floor.tiles[y * w + x] === T_FLOOR || floor.tiles[y * w + x] === T_START;
    const dir = open(st.x, st.y + 1) && !floor.blocked[(st.y + 1) * w + st.x] ? 1 : -1;      // which side you step on from
    const ux = (st.x + 0.5) * TILE, uz = (st.y + 0.5) * TILE;
    const upFrom = group.children.length;
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
    stairRoots.push(asRoot(upFrom, ux, uz));
    upLight = { x: ux, y: 1.8, z: uz, color: 0xa8c8ff, i: 0.3, d: 9, swing: 0 };                                          // a cool light from above
  }

  propObjs = floor.props.map(p => { const o = makeProp(p, !!p.mimic); if (p.mimic) { o.mats.forEach(m => m.dispose()); o.mats = []; o.mesh = new THREE.Group(); } return o; });   // a mimic's chest is drawn by its enemy (below), so its prop is only the thing you search
  propObjs.forEach(o => { group.add(o.mesh); if (o.p.opened && !o.p.mimic) markOpened(o); });   // (a searched-out prop looks searched out when its floor is built again)
  floor.solids = [{ x: sx, z: sz, r: 1.5 }, ...propObjs.filter(o => !o.p.mimic).map(o => ({ x: o.x, z: o.z, r: o.r }))];   // what guards cannot walk through (a mimic is a body of its own): stairwell, props, furniture
  if (floor.up) floor.solids.push({ x: (floor.up.x + 0.5) * TILE, z: (floor.up.y + 0.5) * TILE, r: 1.5 });   // and the stairs up
  for (const d of floor.decor) d.shrine = !!(d.kind === 'altar' && floor.quest && floor.quest.type === 'shrine' && floor.quest.altar.x === d.x && floor.quest.altar.y === d.y);   // the shrine's altar looks different (violet orb) from a plain one
  decorObjs = floor.decor.map(makeDecor);
  for (const o of decorObjs) {
    group.add(o.mesh);
    if (o.r > 0) { propObjs.push(o); if (o.r > 0.3) floor.solids.push({ x: o.x, z: o.z, r: o.r }); }   // small floor clutter (candles) never traps a guard   // rugs, bones and banners are flat or hung: no collision
  }
  for (const dr of floor.doors) { const o = makeDoor(dr); group.add(o.mesh); propObjs.push(o); }
  if (floor.shop) buildShop();
  if (floor.safe) buildSafeRoom(walls.material, ceilMat());
  // thousands of tiny meshes become a few merged ones per 12 m chunk (tripwire bells stay separate: they hide when rung)
  cullChunks = mergeStatic(decorObjs.filter(o => o.kind !== 'bell' && o.kind !== 'runes').map(o => o.mesh).concat(stairRoots), group);   // (the rune circle and its mist stay separate: their shared materials pulse)
  const rune = decorObjs.find(o => o.kind === 'runes'); floor.runes = rune ? { x: rune.x, z: rune.z } : null; group.userData.fxY = rune ? 0.2 : 0;   // the Final Chamber's rune circle (centre in metres)
  buildTorches();
  cullChunks.push(...mergeStatic(torchGroups, group));
  group.userData.bake = bakeFloorLights(); bakeUse(group.userData.bake);   // the light grid every lit material reads
  enemies = floor.enemies.map(s => new Enemy(s, floor));
  for (const o of propObjs) if (o.p.mimic) {                                           // each flagged chest is really a dormant mimic, standing exactly where the chest would
    const p = o.p, e = new Enemy({ x: p.x, y: p.y, route: [{ x: p.x, y: p.y }, { x: p.x, y: p.y }], seed: p.seed, type: 'mimic', tier: p.tier }, floor);
    e.x = o.x; e.z = o.z; e.route = [{ x: o.x, z: o.z }, { x: o.x, z: o.z }]; e.yaw = p.yaw + Math.PI; e.propObj = o; o.mimic = e;
    enemies.push(e);
  }
  Enemy.all = enemies;
  linkHandlers(enemies);
  enemies.forEach(e => { e.cone.visible = dev.on; group.add(e.mesh); });
  for (const b of enemies) if (b.boss) { nameTag(b, b.def.name, b.def.color); if (b.bm) b.tag.position.y = b.bm.tagY; }                // every boss has its name over its head
  decorObjs.forEach((o, i) => { o.src = floor.decor[i]; });
  for (const o of decorObjs) if (o.kind === 'altar' && !o.src.shrine) propObjs.push({ p: { kind: 'prayer', x: o.src.x, y: o.src.y, opened: !!o.src.prayed, src: o.src }, mesh: new THREE.Group(), x: o.x, z: o.z, r: 0, lid: null, mats: [] });   // a plain altar: hold E to pray once (pray)
  questBuild(floor, { enemies, propObjs, decorObjs });                                  // the mini-boss's name tag, the shrine's altar spot, the wanted guard's tag and quest-giver, the sack thief

  floor.prints = theme.mechanic.prints && !floor.boss ? buildPrints() : null;
  scene.add(group);
  scene.background = new THREE.Color(theme.pal.fog);
  scene.fog = new THREE.FogExp2(theme.pal.fog, theme.fog.density);
  applyFog();
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
// ---- Clockwork Library sliding shelves (floor.movers, laid out in js/gen.js: a strip of 4 tiles along (dx, dy) from (x, y); a 2 tile shelf sits on half of it, k = 0 or 1, and slides to the other half).
// Each cycle (TUNE.shelfEvery s) it rests, then slides for TUNE.shelfSlide s: the whole strip is wall while it moves (it blocks sight, movement and guards' paths: they all read floor.tiles), a grinding noise
// (TUNE.shelfRing m) goes out, and anyone standing where it is heading is shoved clear (TUNE.shelfPush m past the shelf's edge). The shelf is two extra instances of the wall mesh: no extra draw, nothing allocated per frame. ----
const moverTile = (m, i) => (m.y + m.dy * i) * floor.w + m.x + m.dx * i;
function posMover(m, j, e) {                     // e: 0 to 1, how far the shelf is from its state k toward the other half
  const a = floor.moverMesh.instanceMatrix.array, sg = m.k === 0 ? 1 : -1;
  for (let i = 0; i < 2; i++) { const o = (floor.moverBase + j * 2 + i) * 16, t = 2 * m.k + i + sg * 2 * e; a[o + 12] = (m.x + m.dx * t + 0.5) * TILE; a[o + 14] = (m.y + m.dy * t + 0.5) * TILE; }
}
function shoveOut(o, r, m) {                     // move something whose collider circle touches the half the shelf is heading for (not just its centre tile) clear of it: to the side, else past an end. Returns 0 (not touching), 1 (moved) or -1 (nowhere free)
  const push = theme.mechanic.TUNE.shelfPush;
  let inside = false;
  for (let i = 2 * (1 - m.k); i < 2 * (1 - m.k) + 2 && !inside; i++) {
    const tx = m.x + m.dx * i, ty = m.y + m.dy * i, qx = Math.max(tx * TILE, Math.min(o.x, (tx + 1) * TILE)), qz = Math.max(ty * TILE, Math.min(o.z, (ty + 1) * TILE));
    inside = (o.x - qx) ** 2 + (o.z - qz) ** 2 < r * r;
  }
  if (!inside) return 0;
  const cx = (m.x + 0.5) * TILE, cz = (m.y + 0.5) * TILE, px = m.dy, pz = m.dx, u = (o.x - cx) * px + (o.z - cz) * pz, v = (o.x - cx) * m.dx + (o.z - cz) * m.dy, side = u >= 0 ? 1 : -1;
  for (let c = 0; c < 4; c++) {                  // the near side, the far side, then the strip's two ends
    const d = c < 2 ? (c ? -side : side) * (TILE / 2 + r + push) - u : 0, e = c < 2 ? 0 : (c === 2 ? -(TILE / 2 + r + push) : 3 * TILE + TILE / 2 + r + push) - v;
    const nx = o.x + px * d + m.dx * e, nz = o.z + pz * d + m.dy * e;
    if (!Player.wallHit(floor, nx, nz, r)) { o.x = nx; o.z = nz; return 1; }   // (wallHit sees every other wall too: never pushed into one)
  }
  return -1;
}
function updateMovers(dt) {
  const ms = floor.movers; if (!ms || !floor.moverMesh) return;
  const T = theme.mechanic.TUNE, every = T.shelfEvery, slide = T.shelfSlide;
  let moved = false;
  for (let j = 0; j < ms.length; j++) {
    const m = ms[j]; m.t += dt;
    if (!m.sliding) {
      if (m.t < every - slide) continue;
      for (let i = 0; i < 4; i++) floor.tiles[moverTile(m, i)] = T_WALL;   // the strip turns solid; the shelf grinds
      let stuck = false;
      const sp = shoveOut(player, player.radius, m); if (sp === 1) { player.vx = player.vz = 0; flash('A shelf shoves you aside.'); } else if (sp < 0) stuck = true;
      for (const e of enemies) if (!e.dead && shoveOut(e, 0.4, m) < 0) stuck = true;
      const al = Enemy.ally; if (al && !al.dead && al.floor === floor && shoveOut(al, 0.4, m) < 0) stuck = true;
      if (stuck) { for (let i = 2 * (1 - m.k); i < 2 * (1 - m.k) + 2; i++) floor.tiles[moverTile(m, i)] = T_FLOOR; continue; }   // someone cannot be moved clear: the shelf waits a tick and tries again
      m.sliding = true;
      pending.push({ x: (m.x + m.dx * 1.5 + 0.5) * TILE, z: (m.y + m.dy * 1.5 + 0.5) * TILE, r: T.shelfRing, src: null });
      if (discover('item:shelf', 'Moving shelves')) flash('Stone grinds on stone: a whole shelf is moving.');
    }
    const q = Math.min(1, (m.t - (every - slide)) / slide);
    posMover(m, j, q * q * (3 - 2 * q)); moved = true;
    if (q >= 1) {                                // arrived: the half it left opens again
      for (let i = 2 * m.k; i < 2 * m.k + 2; i++) floor.tiles[moverTile(m, i)] = T_FLOOR;
      m.k ^= 1; m.sliding = false; m.t = Math.max(0, m.t - every);
    }
  }
  if (moved) { const im = floor.moverMesh.instanceMatrix; im.updateRange.offset = floor.moverBase * 16; im.updateRange.count = ms.length * 32; im.needsUpdate = true; }   // upload only the shelves' own matrices
}
// ---- Mushroom Cellar spore clouds: a small pool of translucent spheres (no lights). The puffer's death cloud and the spore seal's puff are clouds; every 0.5 s whoever stands in one is dazed (enemies always,
// the player only for the seal). Nothing runs unless a cloud is up. ----
const clouds = []; let cloudsOn = 0;
function spawnCloud(x, z, r, dur, daze, hitPlayer) {
  let c = null; for (let i = 0; i < clouds.length; i++) if (!clouds[i].on) { c = clouds[i]; break; }
  if (!c) {
    if (clouds.length >= 6) c = clouds[0];
    else { const m = new THREE.Mesh(new THREE.SphereGeometry(1, 12, 8), new THREE.MeshBasicMaterial({ color: 0xa88ae0, transparent: true, opacity: 0, depthWrite: false, side: THREE.DoubleSide })); scene.add(m); clouds.push(c = { m, on: false }); }
  }
  if (!c.on) cloudsOn++;
  c.on = true; c.t = 0; c.tick = 0; c.r = r; c.dur = dur; c.daze = daze; c.hitPlayer = hitPlayer; c.x = x; c.z = z;
  c.m.position.set(x, 0.6, z); c.m.visible = true;
}
function clearClouds() { for (const c of clouds) { c.on = false; c.m.visible = false; } cloudsOn = 0; }
function updateClouds(dt) {
  if (!cloudsOn) return;
  for (let i = 0; i < clouds.length; i++) {
    const c = clouds[i]; if (!c.on) continue;
    c.t += dt;
    if (c.t >= c.dur) { c.on = false; c.m.visible = false; cloudsOn--; continue; }
    const k = c.t / c.dur;
    c.m.scale.setScalar(c.r * (0.4 + 0.6 * Math.min(1, c.t / 0.4))); c.m.material.opacity = 0.3 * (k < 0.7 ? 1 : (1 - k) / 0.3);
    if ((c.tick -= dt) > 0) continue;
    c.tick = 0.5;
    const r2 = c.r * c.r;
    if (c.hitPlayer && !inSafe && (player.x - c.x) ** 2 + (player.z - c.z) ** 2 < r2 && pst.apply('daze', c.daze)) discover('status:daze', 'Daze');
    for (let j = 0; j < enemies.length; j++) { const e = enemies[j]; if (!e.dead && !e.boss && (e.x - c.x) ** 2 + (e.z - c.z) ** 2 < r2) e.addStatus('daze', c.daze); }
    const al = Enemy.ally; if (al && !al.dead && al.floor === floor && (al.x - c.x) ** 2 + (al.z - c.z) ** 2 < r2) al.addStatus('daze', c.daze);
  }
}
// Jungle: an enemy standing in brush is drawn faint (its body material goes see-through) and is left off the dev minimap. Every third frame, only on brush floors.
function updateBrush() {
  const fade = theme.mechanic.TUNE.fade;
  for (let i = 0; i < enemies.length; i++) {
    const e = enemies[i], mt = e.mats[0];
    if (!mt) continue;
    const inB = !e.dead && floor.patches.get(((e.z / TILE) | 0) * floor.w + ((e.x / TILE) | 0)) === 'brush';   // (a body is never faint: it resets to solid)
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
// Emissive meshes everywhere; their light is baked per floor (bakeFloorLights), the lantern is the only real light. ----
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
const TORCH_STICK = new THREE.CylinderGeometry(0.04, 0.05, 0.4, 6).translate(0, 0.2, 0), TORCH_FLAME = new THREE.LatheGeometry([[0, -0.15], [0.095, -0.04], [0, 0.26]].map(([r, y]) => new THREE.Vector2(r, y)), 6), TORCH_CORE = new THREE.ConeGeometry(0.05, 0.2, 5, 1, true).translate(0, -0.02, 0);   // a teardrop flame and a smaller hot core (both merged into the torch chunk: same shared unlit material, colour in the vertices)
const TORCH_PLATE = new THREE.CylinderGeometry(0.1, 0.1, 0.06, 8).rotateX(Math.PI / 2), TORCH_ARM = new THREE.CylinderGeometry(0.025, 0.025, 0.22, 5).rotateX(Math.PI / 2);   // wall bracket: a plate on the surface and an arm out to the torch
const TORCH_POST = new THREE.CylinderGeometry(0.04, 0.06, 1.5, 6).translate(0, 0.75, 0), TORCH_FOOT = new THREE.CylinderGeometry(0.2, 0.22, 0.08, 8).translate(0, 0.04, 0), TORCH_BOWL = new THREE.CylinderGeometry(0.1, 0.06, 0.12, 6).translate(0, 1.56, 0);
const TORCH = { lean: 0.5, embed: 0.05, heights: [0, -0.4, -0.8, -1.2], minSurf: 0.2, postOut: 1.1, tall: new Set(['banner', 'hearth', 'statue', 'rpillar', 'awning', 'counter', 'crowd']) };   // lean: rad the flame tilts out from the wall; heights: tried below the usual mount height when nothing is there
// A torch spot is dropped when tall decor stands at its wall or a door is beside it.
function torchBlocked(t) {
  const x = (t.x + 0.5) * TILE + t.dx * 1.0, z = (t.y + 0.5) * TILE + t.dy * 1.0;
  for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) if (floor.tiles[(t.y + dy) * floor.w + t.x + dx] === T_DOOR) return true;
  for (const o of decorObjs) if (TORCH.tall.has(o.kind) && Math.hypot(o.x - x, o.z - z) < 1.0) return true;
  return false;
}
// Each torch hangs on the real surface of its wall (a box face, or a hedge, trunk or boulder found by wallSurface) with a plate and arm, the flame leaning out from it; where no surface is within reach at any
// height it stands on a post from the floor. floor.torchMounts lists what was built ({ kind, x, y, z, nx, nz, surf }) for the tests.
function buildTorches() {
  const iron = new THREE.MeshLambertMaterial({ color: 0x2a2420 });
  const fire = new THREE.MeshBasicMaterial({ color: 0xffa828 }), core = new THREE.MeshBasicMaterial({ color: 0xfff0a0 });
  torchGroups = []; torchPts = []; floor.torchMounts = [];
  for (const t of floor.torches) {
    if (torchBlocked(t)) continue;
    const base = floor.boss && !t.low ? 3.6 : 2.0, ox = -t.dx, oz = -t.dy, wcx = (t.x + t.dx + 0.5) * TILE, wcz = (t.y + t.dy + 0.5) * TILE;   // (ox, oz): out of the wall
    let surf = null, y = base;
    for (const dh of TORCH.heights) { const v = wallSurface(t.x + t.dx, t.y + t.dy, ox, oz, base + dh); if (v !== null && v >= TORCH.minSurf) { surf = v; y = base + dh; break; } }
    const g = new THREE.Group(), flame = new THREE.Mesh(TORCH_FLAME, fire), hot = new THREE.Mesh(TORCH_CORE, core);
    let lx, lz, ly;
    if (surf !== null) {
      const d = surf - TORCH.embed, x = wcx + ox * d, z = wcz + oz * d;
      g.position.set(x, y, z); g.rotation.y = Math.atan2(ox, oz);                                                     // local +z points out of the wall
      const plate = new THREE.Mesh(TORCH_PLATE, iron); plate.position.set(0, -0.2, 0.05);
      const arm = new THREE.Mesh(TORCH_ARM, iron); arm.position.set(0, -0.2, 0.16);
      const head = new THREE.Group(); head.position.set(0, -0.2, 0.27); head.rotation.x = TORCH.lean;                    // tilts about the axis along the wall, so the flame leans out
      const stick = new THREE.Mesh(TORCH_STICK, iron); flame.position.y = hot.position.y = 0.55; head.add(stick, flame, hot);
      g.add(plate, arm, head);
      lx = x + ox * 0.7; lz = z + oz * 0.7; ly = y + 0.2;
      floor.torchMounts.push({ kind: 'wall', x, y, z, nx: ox, nz: oz, surf, wx: wcx, wz: wcz });
    } else {
      const x = (t.x + 0.5) * TILE + t.dx * TORCH.postOut, z = (t.y + 0.5) * TILE + t.dy * TORCH.postOut;
      g.position.set(x, 0, z);
      flame.position.y = hot.position.y = 1.78; g.add(new THREE.Mesh(TORCH_POST, iron), new THREE.Mesh(TORCH_FOOT, iron), new THREE.Mesh(TORCH_BOWL, iron), flame, hot);
      lx = x; lz = z; ly = 1.9;
      floor.torchMounts.push({ kind: 'post', x, y: 0, z, nx: ox, nz: oz, surf: null, wx: wcx, wz: wcz });
    }
    group.add(g); torchGroups.push(g);
    torchPts.push({ lx, lz, y: ly, color: theme.pal.light, str: 1 });
  }
  for (const o of decorObjs) {
    const l = DECOR_LIGHT[o.kind];
    if (l) torchPts.push({ lx: o.x + Math.sin(o.yaw) * 0.6, lz: o.z + Math.cos(o.yaw) * 0.6, y: o.ly ?? l.y, color: l.color, str: l.str * (o.ls || 1) });
  }
}
// The floor's static light (torches, hearths, candles, the stair glows) is baked into one light grid when the floor is built (js/light.js): no real light for any of it, nothing pops.
function bakeFloorLights() {
  const L = torchPts.slice();                                            // (copy: the cached list stays as built)
  for (const s of [stairsLight, upLight]) if (s) L.push({ lx: s.x, lz: s.z, y: s.y, color: s.color, str: s.i, R: s.d, decay: 1 });
  return bakeLights(floor, L);
}
const dropTell = o => { if (o.tell && o.tell.parent) o.tell.parent.remove(o.tell); };   // a padlock or tripwire goes when its job is done (they are not part of any merged chunk)
function markOpened(o) {
  o.p.opened = true; dropTell(o);
  if (o.lid) o.lid.rotation.x = -1.15;
  else o.mats.forEach(m => m.color.multiplyScalar(0.45));
}

// ---- searching: hold E on the prop you are looking at ----
const inv = new Inventory();
const prog = new Progress(), PD = derive(prog, TUNE, {});   // XP, levels, stats and skills (js/progress.js); PD = what they add up to, recomputed only when a point is spent
let propObjs = [], decorObjs = [], enemies = [], search = null;

// ---- dev mode: 5x speed, god mode, vision cones, enemy dots, N skips a floor, M reveals the map ----
const dev = { on: false };
function setDev(on) {
  dev.on = on; Enemy.devCones = on;
  enemies.forEach(e => { e.cone.visible = on && !e.dead; });
  el('dev').style.display = on ? 'block' : 'none';
  if (typeof tunePanel !== 'undefined') tunePanel.show(on);
  if (on) inv.hp = inv.maxHp;
}

// ---- combat: stamina, melee attacks, block and parry (numbers live in combat.js) ----
const cb = { limpMsg: 0, draw: null, bashCd: 0, bash: 0, bashSlow: false, rageCd: 0, zap: null, dashCd: 0, dashReq: false, dash: { n: PD.dashMax, t: 0 }, iframe: 0, exhT: 0, stamina: STAMINA_MAX, delay: 0, atk: null, press: false, want: false, block: false, blockT: 0, canSprint: true };
let pulse = 0;                                   // noise made by combat this frame, in metres
const loud = r => { pulse = Math.max(pulse, r); };
Sfx.alertFn = () => { let n = 0; for (let i = 0; i < enemies.length; i++) { const e = enemies[i]; if (e.state === 'alerted' && !e.dead && !e.dormant && !(e.T && e.T.fleer)) n++; } return n; };   // enemies hunting you: drives the battle music (js/audio.js, 4 times a second)
const pending = [], rings = [];                  // noises guards made, and expanding rings for the dev minimap
const spend = n => { cb.stamina = Math.max(0, cb.stamina - n); cb.delay = PD.stamDelay; };
const wstats = () => weaponStats(inv.equip.weapon);   // equipped weapon, tier applied
let markTimer = 0;
function mark(text, color = '#fff') {
  Sfx.mark(text);
  const m = document.getElementById('hitmark');
  m.textContent = text; m.style.color = color; m.style.opacity = 1; markTimer = 0.8;
  addLog(/KILL/.test(text) ? text : 'Hit: ' + text.toLowerCase(), color);
}

// Exhaustion: with less stamina than an action costs you can still do it, only slowly (TUNE.exhaustedAtkMul of the normal speed, so x2.5 the time).
// The action takes what is left (stamina never goes below 0) and the regen delay still starts. The stamina bar flashes red and 'EXHAUSTED' shows.
const tiredFor = cost => !dev.on && cb.stamina < cost;
function exhaustedHint() {
  cb.exhT = 0.7;
  const m = document.getElementById('hitmark'); m.textContent = 'EXHAUSTED'; m.style.color = '#ff6a4a'; m.style.opacity = 1; markTimer = 0.6;
}

function startAttack() {
  if (cb.eat) { cb.eat = null; flash('Stopped eating'); return; }
  const w = wstats();
  if (w.ranged) return startDraw(w);
  if (cb.block && shield()) return bash();            // a shield bash: attack while blocking
  if (isLimp(inv.equip.weapon)) { if (!cb.atk && cb.limpMsg <= 0) { flash("Ian's Hog has gone limp. It needs a Recharge Wand."); cb.limpMsg = 1.2; } return; }
  if (cb.atk || cb.block || cb.zap || inv.swapT > 0 || pst.has('stun')) return;
  const tired = tiredFor(w.stam);
  spend(w.stam); hunger.fight = 3;                    // (spend stops at 0)
  cb.atk = { t: 0, hit: false, slow: tired }; Sfx.play('swing');
  if (tired) exhaustedHint();
}

function playerHit() {
  const w = wstats();
  const t = findMeleeTarget(player, eyeY(), enemies, floor, w.reach);
  if (!t) { if (!smashChest(w) && !cutBell(w)) loud(2); return; }   // swung at nothing (or at a locked chest)
  if (!t.zone) { loud(2); return; }   // (no on-screen 'aim off' text)
  dealHit(t.e, t.zone, w.dmg, w, w.noise);
}

// Damage the player deals with a melee swing or an arrow. base: the weapon's damage (already scaled by tier and
// draw). noise: metres heard at once (a bow's noise is made when it is loosed and when the arrow lands instead).
function dealHit(e, zone, base, w, noise) {
  const sneak = !e.boss && e.state !== 'alerted' && !e.seen; // unaware and not looking at you (or smelling you); the boss cannot be sneak-killed
  const guarded = !sneak && e.stun <= 0 && e.T.blockFront < 1 && e.facesPlayer(player);        // a raised shield or guard takes hits from the front
  const dmg = base * Math.min(TUNE.damageCap, ZONE_MUL[zone]) * (sneak ? Math.min(w.sneak, e.T.sneakCap) : 1) * (guarded ? e.T.blockFront : 1)
    * (inv.buffs.might > 0 ? 1.4 : 1) * PD.dmgMul * (e.resist[zone] || 1) * (e.bs ? bossTakeMul(e, zone) : 1);
  const killed = e.hurt(dmg, player); Sfx.play('hit'); Sfx.play(killed ? 'edie' : 'ehurt');
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
// Low guard: a plain block with the head tipped down (pitch is negative looking down) covers the legs instead of the head and body.
const LOWGUARD = { pitch: -0.44 };   // rad, about 25 degrees down
function blockStats() {
  const w = wstats(), sh = shield();
  if (!sh) return { parryWin: w.parryWin, cost: w.blockCost, legs: false, low: player.pitch <= LOWGUARD.pitch };
  return { parryWin: Math.max(w.parryWin, SHIELD.parryWin), cost: SHIELD.cost / TIERS[sh.tier].mul, legs: true };
}
function bash() {
  if (cb.bashCd > 0 || cb.eat) return;
  const tired = tiredFor(SHIELD.bashStam);
  spend(SHIELD.bashStam); cb.bashCd = SHIELD.bashCd / (tired ? TUNE.exhaustedAtkMul : 1); cb.bash = 0.25; cb.bashSlow = tired; loud(SHIELD.noise);   // a tired bash lands as hard but recovers slowly
  if (tired) exhaustedHint();
  const t = findMeleeTarget(player, eyeY(), enemies, floor, SHIELD.bashReach);
  if (!t) return;
  const e = t.e, sh = inv.equip.offhand;
  const killed = e.hurt(SHIELD.bashDmg * TIERS[sh.tier].mul * (e.bs ? bossTakeMul(e, 'body') : 1), player);   // (a boss's open window counts for a bash and a wand too)
  if (killed) { if (e.boss) bossDefeated(e); else makeCorpse(e, false); mark('KILLED', '#ffd23a'); return; }
  const stunned = e.addStatus('stun', SHIELD.bashStun);
  if (stunned) discover('status:stun', 'Stun');
  const dx = e.x - player.x, dz = e.z - player.z, d = Math.hypot(dx, dz) || 1;       // shove it back if there is room
  if (!e.boss && !e.st.has('stuck') && !Player.wallHit(floor, e.x + dx / d * SHIELD.bashPush, e.z + dz / d * SHIELD.bashPush, e.r, true)) { e.x += dx / d * SHIELD.bashPush; e.z += dz / d * SHIELD.bashPush; }
  mark(stunned ? 'BASH +STUN' : 'BASH', '#7fe8ff');
}

// ---- wands: a consumable zapped from its quickslot (the weapon in hand stays). The bolt flies at the crosshair, ignores armor and hit zones; a charge per zap, and the wand breaks at 0 ----
function zapWand(it) {
  if (!inv.find(it.id)) return;
  if (inSafe) { if (performance.now() - safeMsgT > 4000) { safeMsgT = performance.now(); flash('No one fights in the safe room.'); } return; }
  if (cb.eat) { cb.eat = null; flash('Stopped eating'); return; }
  if (cb.zap || cb.draw || pst.has('stun')) return;
  if (it.charges <= 0) { flash(`The ${WANDS[it.kind].name} is empty. A Recharge Wand would fill it.`); return; }
  const tired = tiredFor(WAND.stam);
  spend(WAND.stam); hunger.fight = 3; cb.atk = null; cb.block = false;
  cb.zap = { t: 0, dur: WAND.cd, slow: tired, kind: it.kind };           // the off-hand zap animation and recovery (updateViewmodel)
  if (tired) exhaustedHint();
  castWand(it);
}
function castWand(it) {
  const W = WANDS[it.kind];
  const cp = Math.cos(player.pitch), dx = -Math.sin(player.yaw) * cp, dy = Math.sin(player.pitch), dz = -Math.cos(player.yaw) * cp;
  const m = wandFxBolt(group, it.kind);                                    // a pooled bolt, turned to face its flight direction once
  const a = { x: player.x + dx * 0.5, y: eyeY() - 0.1, z: player.z + dz * 0.5, vx: dx * WAND.speed, vy: dy * WAND.speed, vz: dz * WAND.speed, gravity: 0, life: WAND.range / WAND.speed, owner: 'player', kind: 'wand', wand: it.kind, stuck: false, wfx: true, mesh: m };
  m.position.set(a.x, a.y, a.z); m.lookAt(a.x + dx, a.y + dy, a.z + dz);
  arrows.push(a);
  loud(W.noise); Sfx.play('wand_' + it.kind);
  discover('wand:' + it.kind, W.name);
  if (--it.charges <= 0) breakWand(it);
  else if (it.charges === 1) flash(`The ${W.name} is nearly spent (1 charge).`);
}
function breakWand(w) {
  inv.remove(w);                                                            // gone from the pack and its quickslot; the weapon in hand was never touched
  flash(`The ${WANDS[w.kind].name} crumbles to dust.`);
}
function hurtByWand(e, dmg) {                                                 // wand damage ignores armor
  const killed = e.hurt(dmg * PD.dmgMul * (e.bs ? bossTakeMul(e, 'body') : 1), player); Sfx.play(killed ? 'edie' : 'ehurt');
  if (killed) { if (e.boss) bossDefeated(e); else makeCorpse(e, false); }
  return killed;
}
function applyWand(kind, e) {
  const W = WANDS[kind], tag = s => { discover('status:' + s, STATUS[s].name); };
  const cy = Math.max(0.3, Math.min(1.5, (e.T.height || 1.7) * 0.6 * (e.scaleK || 1))) + (e.alt || 0);   // about its chest
  wandImpact(group, kind, e.x, cy, e.z);                                      // (a flash on the target; lightning adds one on the arc below)
  if (kind === 'fire') { const dead = hurtByWand(e, W.dmg), burn = !dead && gameRng() < WAND.burnChance && e.addStatus('burn'); if (burn) tag('burn'); mark(burn ? `FIRE ${W.dmg} +BURN` : `FIRE ${W.dmg}`, '#ff9a3a'); }
  else if (kind === 'frost') { let fz = false; if (!hurtByWand(e, W.dmg)) { if (e.addStatus('slow', W.slow)) tag('slow'); if (gameRng() < WAND.freezeChance && e.addStatus('freeze')) { fz = true; tag('freeze'); } } mark(fz ? (e.boss ? 'FROST +SLOW' : 'FROZEN SOLID') : 'FROST +SLOW', '#7fd8ff'); }
  else if (kind === 'lightning') {
    if (!hurtByWand(e, W.dmg) && e.addStatus('stun', W.stun)) tag('stun');
    const o = nearestOther(e, enemies, W.chain);
    if (o) wandImpact(group, 'lightning', o.x, Math.max(0.3, Math.min(1.5, (o.T.height || 1.7) * 0.6 * (o.scaleK || 1))) + (o.alt || 0), o.z, 0.7);
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
    wandRing(group, 'force', e.x, e.z, hitWall ? 2.6 : 1.8, 0.35);                  // a shock ring where it lands
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
  cb.rageCd = RAGE.cd; loud(RAGE.noise); wandRing(group, 'rage', player.x, player.z, RAGE.radius, 0.7);   // the shout rolls out as a red ring
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
  const mt = theme.mechanic.TUNE; if (mt && mt.cloudDur) spawnCloud(e.x, e.z, mt.cloudR, mt.cloudDur, mt.cloudDaze, false);   // the Cellar: the cloud stays and dazes enemies standing in it
};

// ---- enemy shots: an archer's arrows and a shaman's hexes fly at you. Arrows can be blocked, hexes cannot ----
function spawnEnemyShot(s) {
  const bk = BOSS_SHOT[s.kind], pm = bk ? bossFxAcquire(s.kind) : null;              // a boss's shot flies in a pooled mesh (js/boss.js); none free: no shot
  if (bk && !pm) return false;
  const gravity = bk ? bk.g : s.kind === 'arrow' ? 4 : 0, tx = s.tx !== undefined ? s.tx : player.x, ty = s.time ? 0.05 : eyeY() - 0.3, tz = s.tz !== undefined ? s.tz : player.z;   // (a lobbed fireball: its own landing spot on the floor, s.time s from now)
  const dx = tx - s.x, dy = ty - s.y, dz = tz - s.z, dist = Math.hypot(dx, dz) || 1, t = s.time || Math.max(0.05, Math.hypot(dx, dy, dz) / s.speed);
  const jitter = s.time ? () => 0 : () => (gameRng() - 0.5) * 0.05 * dist / t;   // a little inaccuracy (none for a fireball: its ring on the floor is exact)
  const a = { x: s.x, y: s.y, z: s.z, vx: dx / t + jitter(), vy: (dy + 0.5 * gravity * t * t) / t, vz: dz / t + jitter(), gravity, life: 4, owner: 'enemy', kind: s.kind, from: s.from, stuck: false, pool: !!pm, ring: s.ring === undefined ? -1 : s.ring, dmg: s.dmg || 1, mv: s.mv || null, mesh: pm || (s.kind === 'arrow' ? makeArrowMesh() : makeBoltMesh({ hex: '#b060ff', thorn: '#4ac84a', curse: '#9adaff', dart: '#7aff5a' }[s.kind])) };
  if (s.fan) { const c = Math.cos(s.fan), n = Math.sin(s.fan), vx = a.vx; a.vx = vx * c - a.vz * n; a.vz = vx * n + a.vz * c; }   // a fan of shots: turn the velocity about the vertical axis
  a.mesh.position.set(a.x, a.y, a.z); if (!pm) group.add(a.mesh); arrows.push(a);
  return true;
}
// A fireball landing (the Cinder Wyrm's volley): the ground burns there a moment, and anyone within the ring is hit like by any ground move (a block still hurts, knockback).
function fireBurst(a) {
  const mv = a.mv; bossFlameAdd(a.x, a.z, mv.r * 0.6, 1.5);
  if (!a.from.dead && Math.hypot(a.x - player.x, a.z - player.z) <= mv.r + player.radius) resolveEnemyAttack(a.from, 'body', false, mv, a.dmg);
}
// Standing in a flame patch: bleed, refreshed while you stay.
function flameBurn() { if (!pst.has('bleed')) { discover('status:bleed', STATUS.bleed.name); addLog('Burning: Bleed!', STATUS.bleed.color); } pst.apply('bleed', 3); }
// An enemy shot (arrow, hex, thorn, curse, dart) that reached the player's ally first: arrows hurt by zone, the others apply their status.
function allyShotHit(a, ev) {
  const al = ev.e, k = a.kind;
  if (k === 'thorn') al.addStatus('bleed', 4); else if (k === 'dart') al.addStatus('bleed', 5); else if (k === 'curse') al.addStatus('slow', 5); else if (k === 'hex') al.addStatus(gameRng() < 0.5 ? 'slow' : 'daze', 4);
  else { al.cause = 'was shot'; al.hurt(TUNE.enemyDmg * a.from.dmgMul * ZONE_MUL[ev.zone] * (al.resist[ev.zone] || 1), a.from); }
}
// A bottle that reached the floor: it leaves an ale puddle, and anyone within its splash radius is hit like by a thrown bottle (blockable).
function bottleLand(a) {
  const mv = a.mv; bossPuddleAdd(a.x, a.z, mv);
  if (Math.hypot(a.x - player.x, a.z - player.z) <= mv.splash + player.radius) resolveEnemyAttack(a.from, 'body', true, mv, a.dmg);
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
  resolveEnemyAttack(a.from, zone, true, a.mv, a.dmg);                               // a boss's shot: the move's damage, blockable like an arrow (passed in, the boss's own move state is untouched)
}

// ---- bow: hold attack to draw, release to fire. One arrow per shot, found arrows can be picked up again ----
const arrows = [];          // flying and stuck arrows
function startDraw(w) {
  if (cb.draw || inv.swapT > 0 || pst.has('stun') || cb.eat) return;
  if (inv.arrows <= 0 && !dev.on) { flash('No arrows'); return; }
  const tired = tiredFor(w.stam);
  spend(w.stam); hunger.fight = 3;
  cb.draw = { t: 0, slow: tired };                    // a tired draw takes x2.5 as long
  if (tired) exhaustedHint();
}
function fireArrow(frac) {
  if (inSafe) return;
  const w = wstats();
  const cp = Math.cos(player.pitch), dx = -Math.sin(player.yaw) * cp, dy = Math.sin(player.pitch), dz = -Math.cos(player.yaw) * cp;
  const sp = BOW.speedMin + (BOW.speedMax - BOW.speedMin) * frac;
  const a = { x: player.x + dx * 0.5, y: eyeY() - 0.1, z: player.z + dz * 0.5, vx: dx * sp, vy: dy * sp, vz: dz * sp, dmg: w.dmg * (0.4 + 0.6 * frac), owner: 'player', stuck: false, w, mesh: makeArrowMesh() };
  a.mesh.position.set(a.x, a.y, a.z); a.mesh.lookAt(a.x + dx, a.y + dy, a.z + dz);
  group.add(a.mesh); arrows.push(a);
  if (!dev.on) inv.arrows--; Sfx.play('bow');
  loud(w.noise);
}
function stickArrow(a, hitEnemy) {
  a.stuck = true; a.vx = a.vy = a.vz = 0;
  const keep = gameRng() < (hitEnemy ? BOW.recoverHit : BOW.recoverWorld) && arrows.filter(q => q.stuck).length <= BOW.maxStuck;
  if (!keep) { group.remove(a.mesh); arrows.splice(arrows.indexOf(a), 1); return; }
  if (!hitEnemy && a.px !== undefined) { a.x = a.px; a.z = a.pz; }                     // lie in front of the wall, not inside it
  a.y = 0.05; a.mesh.position.set(a.x, 0.05, a.z); a.mesh.rotation.set(0, Math.atan2(a.dirx || 0, a.dirz || 1), 0);
}
const dropArrowMesh = a => { if (a.pool) bossFxRelease(a.mesh); else if (a.wfx) wandFxRelease(a.mesh); else group.remove(a.mesh); };   // a boss shot's mesh goes back to its pool
function updateArrows(dt) {
  wandFxUpdate(group, dt);                                                          // impact flashes and the shock ring fade out
  for (let i = arrows.length - 1; i >= 0; i--) {
    const a = arrows[i];
    if (a.stuck) {
      if (a.kind !== 'wand' && Math.hypot(a.x - player.x, a.z - player.z) < 1.0 && inv.arrows < QUIVER_MAX) { inv.arrows++; group.remove(a.mesh); arrows.splice(i, 1); addLog('Picked up an arrow.', '#cfc'); }
      continue;
    }
    if (a.owner === 'enemy') {
      const ev = stepArrow(a, dt, floor, enemies, player, Enemy.ally && Enemy.ally.floor === floor ? Enemy.ally : null);
      a.life -= dt; a.mesh.position.set(a.x, a.y, a.z);
      if (a.kind === 'arrow' || a.pool) { a.mesh.lookAt(a.x + a.vx, a.y + a.vy, a.z + a.vz); if (a.pool && BOSS_SHOT[a.kind].spin) a.mesh.rotateX(a.life * 14); }   // cleavers and bottles tumble
      if (a.ring >= 0) { if (ev || a.life <= 0) { bossTeleOff(a.ring); if (ev && (ev.type === 'ground' || ev.type === 'player')) fireBurst(a); } }   // a fireball: its ring goes out, and the burst hits whoever is in it
      else if (ev && ev.type === 'player') { enemyShotHit(a); if (a.mv && a.mv.puddle) bossPuddleAdd(a.x, a.z, a.mv); }
      else if (ev && ev.type === 'ally') allyShotHit(a, ev);
      else if (ev && ev.type === 'ground' && a.mv && a.mv.puddle) bottleLand(a);
      if (ev || a.life <= 0) { dropArrowMesh(a); arrows.splice(i, 1); }
      continue;
    }
    if (a.kind === 'wand') {                                                       // a wand bolt: no drop, no recovery, hits anything alive
      const ev = stepArrow(a, dt, floor, enemies, player);
      a.life -= dt; a.mesh.position.set(a.x, a.y, a.z); wandBoltAnim(a.mesh, gameT);
      if (ev && ev.type === 'hit') applyWand(a.wand, ev.e);
      else if (ev) wandImpact(group, a.wand, a.px === undefined ? a.x : a.px, a.y, a.pz === undefined ? a.z : a.pz, 0.6);   // it fizzles against a wall or the floor
      if (ev || a.life <= 0) { wandFxRelease(a.mesh); arrows.splice(i, 1); }
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
  e.corpseDone = true; awardKill(e, false);
  const rng = makeRng((e.seed ^ 0xb055) >>> 0);
  bossDead[stage] = true;
  const epic = rollEquipment(effFloor(), rng, {});
  epic.tier = rng() < TUNE.bossLegendary ? 4 : 3;
  const uniq = epic.tier === 4 ? rollUniqueGear(rng, rng() < 0.5) : null, bust = rollBust(rng, 0.12);    // a Legendary body may hold a one-of-a-kind piece
  const extra = rollEquipment(effFloor(), rng, { boost: 1, minTier: 2 });
  const left = [uniq || epic, extra, { type: 'gold', n: rng.int(120, 200) }, ...(rng() < 0.25 ? [{ type: 'rage' }] : []), ...(bust ? [bust] : [])];
  dropAll(left, e, true);                                                            // its hoard lies scattered round the body
  if (e.final) { flash('The Cinder Wyrm falls! The chamber goes quiet.'); clearTimeout(winTimer); winTimer = setTimeout(() => { if (state === 'play') finishRun(); }, 2500); return; }   // the run ends
  flash('The boss falls! Its loot lies on the floor. A rumble shakes the arena: a hidden door in the north wall grinds open.');
  openSafeDoor();
}

// A dead enemy drops what it carried on the floor (same roll and seed as before: the sneak-kill bonus, the lockpick share, the quest key and sack are unchanged).
// Its body (the dead mesh) despawns DROPS.bodyT s after death (main loop, goneBodies); the items stay until picked up.
function makeCorpse(e, sneak) {
  e.corpseDone = true; awardKill(e, sneak);
  if (e.minion) return;   // a boss's summons leave no body or loot (no farming the howl / rally / last call)
  if (e.T.mimic) return mimicCorpse(e);
  const list = rollLoot('corpse', effFloor(), makeRng(e.seed), sneak ? 0.15 : 0, e.gear, e.type);
  if (e.loot) list.push({ type: 'gold', n: e.loot });                              // stolen gold
  if (e.spec.carry) list.push(e.spec.carry);                                       // the cell key a prisoner quest guard carries
  dropAll(list, e, e.type === 'sackthief' || !!e.spec.mini || !!e.spec.qguard);
}

// A dead mimic pays out like a chest one grade better, with gear guaranteed.
function mimicCorpse(e) {
  const rng = makeRng((e.seed ^ 0x31c1c) >>> 0), t = Math.min(4, (e.spec.tier | 0) + 1);
  const left = rollLoot('chest', effFloor(), rng, 0, [], undefined, t);
  if (!left.some(d => d.type === 'weapon' || d.type === 'armor' || d.type === 'shield')) left.push(rollEquipment(effFloor(), rng, { boost: t >= 3 ? 1 : 0, minTier: t >= 2 ? t - 1 : 0 }));
  dropAll(left, e, true);
}

// ---- floor drops: each item is one instance of a shared gem (colour = the item's colour, shape = its kind) over a shared additive halo, so a floor costs 2 draw calls
// whatever it holds. Per floor (floor.items = { list, gem, halo }, made on the first drop, freed with the floor's group). At most DROPS.cap live; past that the oldest
// non-quest item goes first (a key, the thief's sack, a mini-boss, boss and mimic hoard are never evicted). Items have no timer: they wait for you. ----
const DROPS = { cap: 60, max: 80, pick: 1.5, retry: 0.5, bodyT: 30, y: 0.26 };   // metres, seconds
const DROP_SHAPE = { gold: [0.14, 0.05, 0.14], potion: [0.09, 0.17, 0.09], key: [0.06, 0.2, 0.06], weapon: [0.1, 0.22, 0.1], armor: [0.17, 0.15, 0.17], shield: [0.18, 0.18, 0.06] };
let dropGeo = null, dropMat = null, haloGeo = null, haloMat = null;
const _dc = new THREE.Color(), _dm = new THREE.Matrix4(), _dq = new THREE.Quaternion(), _dp = new THREE.Vector3(), _ds = new THREE.Vector3(), _dy = new THREE.Vector3(0, 1, 0);
function dropColor(d) {
  if (d.type === 'gold') return '#ffd23a';
  if (d.type === 'arrows') return '#c8b070';
  if (d.type === 'rage') return '#ff5a30';
  if (d.type === 'bust') return '#e8e0b0';
  try { return itemColor(d) || '#ffffff'; } catch (err) { return '#ffffff'; }
}
function dropStore() {
  if (floor.items) return floor.items;
  if (!dropGeo) {
    dropGeo = new THREE.OctahedronGeometry(1, 0); dropGeo.userData = { shared: true };
    haloGeo = new THREE.PlaneGeometry(1, 1); haloGeo.rotateX(-Math.PI / 2); haloGeo.userData = { shared: true };
    dropMat = new THREE.MeshBasicMaterial({ color: 0xffffff }); dropMat.userData = { shared: true };
    haloMat = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.45, blending: THREE.AdditiveBlending, depthWrite: false }); haloMat.userData = { shared: true };
  }
  const gem = new THREE.InstancedMesh(dropGeo, dropMat, DROPS.max), halo = new THREE.InstancedMesh(haloGeo, haloMat, DROPS.max);
  gem.count = halo.count = 0; gem.frustumCulled = halo.frustumCulled = false; halo.renderOrder = 2;
  group.add(gem, halo);
  return (floor.items = { list: [], gem, halo });
}
function dropSet(S, i) {                                                           // write instance i (matrix + colour) from its item; only on spawn / removal, never per frame
  const it = S.list[i];
  _dc.set(it.col); _dq.setFromAxisAngle(_dy, it.yaw); _dp.set(it.x, DROPS.y, it.z); _ds.set(it.sx, it.sy, it.sz);
  _dm.compose(_dp, _dq, _ds); S.gem.setMatrixAt(i, _dm); S.gem.setColorAt(i, _dc);
  _dp.y = 0.03; _ds.set(0.9, 1, 0.9); _dq.identity(); _dm.compose(_dp, _dq, _ds); S.halo.setMatrixAt(i, _dm); S.halo.setColorAt(i, _dc);
  S.gem.instanceMatrix.needsUpdate = S.halo.instanceMatrix.needsUpdate = S.gem.instanceColor.needsUpdate = S.halo.instanceColor.needsUpdate = true;
}
function dropRemove(S, i) {                                                        // swap-remove: the last item takes slot i
  const L = S.list, last = L.length - 1;
  if (i !== last) { L[i] = L[last]; dropSet(S, i); }
  L.pop(); S.gem.count = S.halo.count = L.length;
  S.gem.instanceMatrix.needsUpdate = S.halo.instanceMatrix.needsUpdate = true;
}
function dropClear() { const S = floor.items; if (S) { S.list.length = 0; S.gem.count = S.halo.count = 0; } }
function dropSpawn(d, x, z, quest, rng) {
  const S = dropStore(), L = S.list;
  if (L.length >= DROPS.cap) { let k = L.findIndex(q => !q.q); if (k < 0 && L.length >= DROPS.max) k = 0; if (k >= 0) dropRemove(S, k); }   // (the oldest non-quest item goes; swap-remove, so the order is only roughly oldest-first)
  let px = x, pz = z;
  for (let k = 0; k < 4; k++) {                                                    // scatter a little, onto open floor
    const a = rng() * 6.2832, r = 0.25 + rng() * 0.55, tx = x + Math.cos(a) * r, tz = z + Math.sin(a) * r, ti = Math.floor(tz / TILE) * floor.w + Math.floor(tx / TILE);
    if (floor.tiles[ti] === T_FLOOR && !floor.blocked[ti]) { px = tx; pz = tz; break; }
  }
  const sh = DROP_SHAPE[d.type] || [0.12, 0.12, 0.12];
  L.push({ d, x: px, z: pz, q: quest || d.type === 'key', col: dropColor(d), yaw: rng() * 6.2832, sx: sh[0], sy: sh[1], sz: sh[2], fail: false, cd: 0 });
  const i = L.length - 1; S.gem.count = S.halo.count = L.length; dropSet(S, i);
}
function dropAll(list, e, quest) {
  const rng = makeRng((e.seed ^ 0xd209) >>> 0);
  for (const d of list) dropSpawn(d, e.x, e.z, quest, rng);
}
// Walk within DROPS.pick m of an item to take it. A full bag leaves it (one message; holding interact tries again every DROPS.retry s). One pass over <= 80 items, no allocations.
function updateDrops(dt) {
  const S = floor.items; if (!S || !S.list.length) return;
  haloMat.opacity = 0.4 + 0.15 * Math.sin(gameT * 3);                             // the glow breathes (one shared material)
  const L = S.list, px = player.x, pz = player.z, R2 = DROPS.pick * DROPS.pick;
  for (let i = L.length - 1; i >= 0; i--) {
    const it = L[i], dx = it.x - px, dz = it.z - pz;
    if (dx * dx + dz * dz > R2) { it.fail = false; continue; }
    if (it.fail) { if (!player.keys[KEYS.interact] || (it.cd -= dt) > 0) continue; it.cd = DROPS.retry; }
    const text = inv.add(it.d);
    if (text) { flash('Found ' + text); dropRemove(S, i); }
    else { if (!it.fail || player.keys[KEYS.interact]) flash(it.d.type === 'arrows' ? 'Quiver full' : 'Pack full: it stays on the floor'); it.fail = true; it.cd = DROPS.retry; }
  }
}
// Dead bodies despawn DROPS.bodyT s after death (deadT counts while this floor is the live one): out of the scene and the update list, their own geometry and
// materials freed (disposeGroup skips the shared ones). A body is only counted once its loot has dropped (corpseDone).
function goneBodies() {
  for (let i = enemies.length - 1; i >= 0; i--) {
    const e = enemies[i];
    if (!e.dead || !e.corpseDone || e.deadT < DROPS.bodyT || e.isAlly) continue;
    if (e.mesh.parent) e.mesh.parent.remove(e.mesh);
    disposeGroup(e.mesh); enemies.splice(i, 1);
  }
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
function clearBombs() { clearClouds(); gasFx.on = false; gasFx.m.visible = false; for (const b of bombs) { b.on = false; b.g.visible = false; } for (const f of blastFx) { f.on = false; f.m.visible = false; } }
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
// Swinging at a tripwire bell cuts it: it never rings and the swing makes no noise.
function cutBell(w) {
  const fx = -Math.sin(player.yaw), fz = -Math.cos(player.yaw), reach = w.reach + 0.5;
  for (const o of decorObjs) {
    if (o.kind !== "bell" || floor.patches.get(o.p.y * floor.w + o.p.x) !== "bell") continue;
    const bx = (o.p.x + 0.5) * TILE, bz = (o.p.y + 0.5) * TILE, dx = bx - player.x, dz = bz - player.z, d = Math.hypot(dx, dz);
    if (d > reach || (dx * fx + dz * fz) / (d || 1) < 0.6 || !hasLOS(floor, player.x, player.z, bx, bz)) continue;
    floor.patches.delete(o.p.y * floor.w + o.p.x); o.mesh.visible = false;
    discover("item:bell", "Tripwire bells"); flash("You cut the tripwire. No sound.");
    return true;
  }
  return false;
}
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

function resolveEnemyAttack(e, zone, ranged = false, shotMv = null, shotDmg = 1) {   // shotMv/shotDmg: a boss's projectile brings its own move and damage, so a shot landing mid-telegraph never touches the boss's live e.mv / e.hitMul
  const w = wstats();
  const fx = -Math.sin(player.yaw), fz = -Math.cos(player.yaw);
  const dx = e.x - player.x, dz = e.z - player.z, d = Math.hypot(dx, dz) || 1;
  const facing = (dx * fx + dz * fz) / d > 0.2;
  const full = TUNE.enemyDmg * e.dmgMul * (shotMv ? shotDmg : e.hitMul || 1) * ZONE_MUL[zone] * (1 - inv.armorRed(zone));
  if (!shotMv) e.hitMul = 1;   // armor in that zone's slot cuts it
  const mv = shotMv || e.mv;                                                                  // a boss's move in play (js/boss.js)
  if (mv && mv.ground && !ranged) { groundHit(e, mv, zone, full, facing, w, -dx / d, -dz / d); return; }   // circles, floor lines, shockwaves: a block only softens them
  const bs = blockStats();
  if (cb.block && facing && !w.ranged) {
    const lowG = bs.low && !ranged;                                          // low guard: covers legs only
    if (lowG && zone !== 'legs') mark('HIGH HIT: guard is low', '#ff6a4a');
    else if (!lowG && zone === 'legs' && !bs.legs) mark('LEG SWEEP: look down to guard low', '#ff6a4a');   // goes under a high guard
    else if (zone === 'legs' && bs.legs) {                                              // a shield covers most of a low sweep
      const c = bs.cost * SHIELD.legsCost;
      if (cb.stamina >= c || dev.on) { spend(c); mark('LOW BLOCK', '#cfe'); loud(5); cb.atk = null; damage(full * SHIELD.legsTake); return; }
      cb.stamina = 0; mark('GUARD BROKEN', '#ff6a4a'); damage(full * 0.5); hitStatuses(e, zone); return;
    }
    else if (cb.blockT <= bs.parryWin && !(mv && mv.parry === false)) {   // (a boss move with parry: false is only blocked)
      if (!ranged) { e.stun = 1.0; e.winding = false; e.atkCd = 0.6; }            // parrying a blow staggers the attacker, an arrow just stops
      cb.stamina = Math.min(STAMINA_MAX, cb.stamina + TUNE.parryRestore);   // a parry gives stamina back
      mark(ranged ? 'ARROW BLOCKED' : 'PARRY', '#7fe8ff'); loud(5); return;
    } else if (bs.cost > 0) {
      if (cb.stamina >= bs.cost || dev.on) { spend(bs.cost); cb.stamina = Math.min(STAMINA_MAX, cb.stamina + bs.cost * TUNE.blockRefund); mark(ranged ? 'ARROW BLOCKED' : 'BLOCKED', '#cfe'); loud(5); return; }
      cb.stamina = 0; mark('GUARD BROKEN', '#ff6a4a'); damage(full * 0.5); hitStatuses(e, zone); return;
    }
  }
  cb.atk = null;
  damage(full);
  hitStatuses(e, zone);
  if (mv && mv.status) moveStatus(mv);
  if (mv && mv.knock && !ranged) applyKnock(-dx, -dz, mv.knock);
}
// A boss's ground move (red telegraph) landing on you. No parry, no stagger. Blocking (facing it, stamina paid as a normal block) lets only mv.blockTake of the damage
// through (0.5; a shield takes less: x SHIELD.legsTake) and skips the status; the knockback (mv.knock metres, away from the boss) happens either way.
function groundHit(e, mv, zone, full, facing, w, nx, nz) {
  const bs = blockStats();
  let take = 1, broke = false;
  // Same cover rule as a normal hit: a low guard only covers a legs-zone move, a high guard covers head/body ones (a leg sweep goes under it), a shield covers both.
  const covers = bs.legs || (bs.low ? zone === 'legs' : zone !== 'legs');
  if (cb.block && facing && !w.ranged && !covers) mark(zone === 'legs' ? 'LEG SWEEP: look down to guard low' : 'HIGH HIT: guard is low', '#ff6a4a');
  if (cb.block && facing && !w.ranged && bs.cost > 0 && covers) {
    if (cb.stamina >= bs.cost || dev.on) { spend(bs.cost); cb.stamina = Math.min(STAMINA_MAX, cb.stamina + bs.cost * TUNE.blockRefund); take = (mv.blockTake === undefined ? 0.5 : mv.blockTake) * (bs.legs ? SHIELD.legsTake : 1); mark('BRACED: it still hurts', '#cfe'); loud(5); }
    else { cb.stamina = 0; mark('GUARD BROKEN', '#ff6a4a'); take = 0.5; broke = true; }   // a broken guard: half damage and the statuses, like the normal path
  }
  if (take === 1) cb.atk = null;
  damage(full * take);
  if (take === 1 || broke) { hitStatuses(e, zone); if (mv.status) moveStatus(mv); }
  if (mv.knock) applyKnock(nx, nz, mv.knock);
}
function moveStatus(mv) { if (pst.apply(mv.status, mv.statusDur)) { discover('status:' + mv.status, STATUS[mv.status].name); addLog(STATUS[mv.status].name + '!', STATUS[mv.status].color); } }
// Dash: a short stamina-costing slide (TUNE.dashDist metres in TUNE.dashTime seconds) along your movement keys, forward when standing, to close on archers and casters.
// player.startDash does the sliding through the player's own wall and prop collision (never through a wall, door, prop or guard). No i-frames: it is fair, not a dodge.
// Refused while stunned, dazed, crippled to a crawl, eating, drawing a bow, mid-knockback or already dashing, and on cooldown. Allowed in the safe room and in dev mode. It is loud.
function tryDash() {
  if (state !== 'play' || cb.dashCd > 0 || (cb.dash.n < 1 && !dev.on) || cb.eat || cb.draw || knock.m > 0 || player.dashS.on || pst.has('stun') || pst.has('daze') || pst.moveMul() < 0.3) return false;
  if (!dev.on && cb.stamina < TUNE.dashStam) { cb.exhT = 0.5; return false; }          // too tired: the bar flashes
  spend(TUNE.dashStam); cb.dashCd = TUNE.dashCd; if (cb.dash.n > 0) cb.dash.n--; cb.iframe = PD.dashIframe;
  player.startDash(PD.dashDist, TUNE.dashTime);
  loud(TUNE.dashNoise); Sfx.play('dash');
  return true;
}
// Knockback: a short eased slide (about a quarter second) of `metres` along (dx, dz), stepped through the player's own collision (walls and props), so it never carries you
// through a wall: a blocked step slides along the wall or ends the push. One shared state, no allocation.
const knock = { dx: 0, dz: 0, m: 0, t: 0, dur: 0.25, done: 0 };
function applyKnock(dx, dz, metres) {
  let d = Math.hypot(dx, dz); if (!(metres > 0) || inSafe) return;
  if (d < 1e-6) { dx = Math.sin(player.yaw); dz = Math.cos(player.yaw); d = 1; }   // dead centre of the blast (a dragon landing on you): back the way you face
  player.dashS.on = false;                                                           // a shove ends a dash
  knock.dx = dx / d; knock.dz = dz / d; knock.m = metres; knock.t = 0; knock.done = 0; knock.dur = 0.2 + 0.03 * metres;
}
function stepKnock(dt) {
  if (knock.m <= 0) return;
  knock.t = Math.min(knock.dur, knock.t + dt);
  const u = knock.t / knock.dur;
  let rem = knock.m * (1 - (1 - u) * (1 - u)) - knock.done;                          // ease out
  while (rem > 1e-4) {
    const s = Math.min(rem, 0.2), mx = knock.dx * s, mz = knock.dz * s;
    let moved = false;
    if (!player.blocked(floor, player.x + mx, player.z)) { player.x += mx; moved = true; }
    if (!player.blocked(floor, player.x, player.z + mz)) { player.z += mz; moved = true; }
    if (!moved) { knock.m = 0; return; }
    knock.done += s; rem -= s;
  }
  if (u >= 1) knock.m = 0;
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
  stepKnock(dt);
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
  if (!dev.on && bleed <= 0) { const cap = inv.maxHp * hunger.healCap(inv.hp / inv.maxHp); if (inv.hp < cap) inv.hp = Math.min(cap, inv.hp + hunger.hpRegen() * dt); }   // passive healing (also in the safe room) up to a tier ceiling (50 / 75 / 90%), slower the hungrier you are, none while bleeding
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
  if (mech && mech.slow && mt) player.speedMul *= mt.slow;                      // wading through the Tavern's water
  if (BOSS_PUD.n) player.speedMul *= bossPuddleMul(player.x, player.z);                   // wading through the Innkeeper's ale
  if (BOSS_FLAME.n && bossFlameAt(player.x, player.z)) flameBurn();                       // the Cinder Wyrm's flames: stand in them and you bleed
  if (BOSS_LANE.n && bossLaneAt(player.x, player.z)) player.slipT = Math.max(player.slipT, mt && mt.carry || 0.6);   // the Frost Giant's ice lane: slide like on the Chapel's ice
  player.slippery = player.slipT > 0; if (mt && mt.slip) player.slipRate = mt.slip;
  if (floor.prints) updatePrints(dt);
  let seenMul = 1;
  if (mech) { if (mech.seen) seenMul = mech.seen(); discover(mech.disc[0], mech.disc[1]); }
  if (floor.runes) { const k = updateRunes(); if (k > 1) { seenMul *= k; if (discover('item:runes', 'Rune circle')) flash('The runes flare: they show you up!'); } }   // the Final Chamber: inside a flaring circle guards see you farther
  const hidden = hatUpdate(dt);
  player.stealthMul = hidden ? 0 : (inv.buffs.shadow > 0 ? 0.5 : 1) * seenMul; player.senseMul = PD.senseMul;
  if (inv.refillStamina) { cb.stamina = STAMINA_MAX; inv.refillStamina = false; }

  if (player.sprinting) spend(TUNE.sprintDrain * dt);
  else if (cb.delay > 0) cb.delay -= dt;
  else cb.stamina = Math.min(STAMINA_MAX, cb.stamina + TUNE.staminaRegen * (inv.buffs.vigor > 0 ? 2 : 1) * (inv.buffs.hearty > 0 ? 1.5 : 1) * (1 + inv.stamBonus) * PD.regenMul * hunger.regenMul() * dt);
  cb.stamina = Math.min(cb.stamina, STAMINA_MAX * hunger.maxStaminaMul());   // Weak: max stamina is cut
  if (dev.on) cb.stamina = STAMINA_MAX;
  if (cb.stamina <= 1) cb.canSprint = false; else if (cb.stamina > 25) cb.canSprint = true;
  player.canSprint = cb.canSprint && hunger.canSprint() && !cb.eat;

  if (cb.bashCd > 0) cb.bashCd -= dt;
  if (cb.rageCd > 0) cb.rageCd -= dt;
  if (cb.limpMsg > 0) cb.limpMsg -= dt;
  if (cb.dashCd > 0) cb.dashCd -= dt;
  if (cb.iframe > 0) cb.iframe -= dt;
  if (cb.dash.n < PD.dashMax) chargeTick(cb.dash, dt, PD.dashMax, PD.dashRecharge); else cb.dash.t = 0;
  if (xpT > 0 && (xpT -= dt) <= 0) el('xpgain').style.display = 'none';
  if (cb.exhT > 0) cb.exhT -= dt;
  if (cb.dashReq) { cb.dashReq = false; tryDash(); }
  if (inv.rageReq) { playRage(inv.rageReq); inv.rageReq = null; }
  if (inv.zapReq) { const z = inv.zapReq; inv.zapReq = null; zapWand(z); }
  if (cb.zap && (cb.zap.t += dt * (cb.zap.slow ? TUNE.exhaustedAtkMul : 1)) >= cb.zap.dur) cb.zap = null;
  if (cb.bash > 0) cb.bash -= dt * (cb.bashSlow ? TUNE.exhaustedAtkMul : 1);
  if (cb.press) {
    cb.press = false;
    if (!inSafe || cb.eat) startAttack();                                                    // in the safe room an attack does nothing (but still stops a meal)
    else if (performance.now() - safeMsgT > 4000) { safeMsgT = performance.now(); flash('No one fights in the safe room.'); }
  }
  if (cb.draw) {                                    // drawing the bow: slow, release to fire, block cancels
    const w = wstats();
    cb.draw.t += dt * (cb.draw.slow ? TUNE.exhaustedAtkMul : 1); player.speedMul *= 0.4;
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
    cb.atk.t += dt * (cb.atk.slow ? TUNE.exhaustedAtkMul : 1);
    if (!cb.atk.hit && cb.atk.t >= w.dur * w.hitAt) { cb.atk.hit = true; playerHit(); }
    if (cb.atk.t >= w.dur) cb.atk = null;
  }
  const canBlock = cb.want && !cb.atk && inv.swapT <= 0 && !pst.has('stun') && !cb.eat && !cb.zap && !wstats().ranged && (cb.stamina > 0 || dev.on);
  if (canBlock) { if (!cb.block) { cb.block = true; cb.blockT = 0; } else cb.blockT += dt; } else cb.block = false;

  if (markTimer > 0) { markTimer -= dt; if (markTimer <= 0) document.getElementById('hitmark').style.opacity = 0; }
}

// Free distance in front of the camera before a wall or solid prop, checked left, centre and right of the blade (max 2 m).
const FA_OFF = [-0.4, 0, 0.45], faNear = [];   // the three probe lines, and the solids within reach of the probes (reused: no per-frame arrays or closures)
function freeAhead() {
  const fx = -Math.sin(player.yaw), fz = -Math.cos(player.yaw), rx = Math.cos(player.yaw), rz = -Math.sin(player.yaw), sol = floor.solids;
  let n = 0;                                                       // only the props that can be within 2.5 m of the player matter: the probes then test a handful, not every solid on the floor
  for (let i = 0; i < sol.length; i++) { const s = sol[i]; if (s.r > 0.3) { const dx = s.x - player.x, dz = s.z - player.z, m = 2.5 + s.r; if (dx * dx + dz * dz < m * m) faNear[n++] = s; } }
  let free = 2;
  for (let k = 0; k < 3; k++) for (let d = 0.1; d < free; d += 0.1) {
    const off = FA_OFF[k], px = player.x + fx * d + rx * off, pz = player.z + fz * d + rz * off;
    let hit = wallAt(floor, Math.floor(px / TILE), Math.floor(pz / TILE));
    for (let i = 0; !hit && i < n; i++) { const s = faNear[i]; hit = (px - s.x) ** 2 + (pz - s.z) ** 2 < s.r * s.r; }
    if (hit) { free = d; break; }
  }
  return free;
}

// first-person weapon: rest, swing, block and swap poses
const vm = { id: null, tier: -1, group: new THREE.Group(), model: null, shield: new THREE.Group(), shieldId: null, wand: new THREE.Group(), wandKind: null };
camera.add(vm.group); camera.add(vm.shield); camera.add(vm.wand); vm.wand.visible = false; vm.shield.scale.setScalar(0.82);   // (the shield is held a little smaller so it is not a screen-filling disc)
function buildShieldModel(it) { return buildShieldMesh(it.tier | 0); }   // shared round-shield geometry, tier-coloured face (js/combat.js)
function updateViewmodel(dt) {
  const wkey = inv.weapon + (isLimp(inv.equip.weapon) ? ':limp' : '');                // a limp Ian's Hog is a different model
  const wtier = (inv.equip.weapon && inv.equip.weapon.tier) | 0;
  if (vm.id !== wkey || vm.tier !== wtier) {                                          // (models share their geometry and materials: dropping the old one frees nothing and leaks nothing)
    if (vm.model) vm.group.remove(vm.model);
    vm.model = buildWeaponModel(wkey, wtier); vm.group.add(vm.model); vm.id = wkey; vm.tier = wtier;
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
    const bashK = cb.bash > 0 ? Math.sin((1 - cb.bash / 0.25) * Math.PI) : 0;   // (a tired bash plays slower: cb.bash counts down at the exhausted speed)
    const tx = cb.block ? -0.1 : -0.42, ty = cb.block ? -0.2 : -0.4, tz = (cb.block ? -0.62 : -0.68) - 0.3 * bashK;
    const k2 = 1 - Math.exp(-16 * dt), sp = vm.shield.position;
    sp.x += (tx - sp.x) * k2; sp.y += (ty - sp.y) * k2; sp.z += (tz - sp.z) * k2;
    vm.shield.rotation.y += ((cb.block ? 0.05 : 0.4) - vm.shield.rotation.y) * k2;
  }
  // the zap: the wand comes up in the off hand (left), jabs forward at the crosshair and lowers again over WAND.cd; the weapon dips a little meanwhile
  const zp = cb.zap && !inv.swapT ? Math.min(1, cb.zap.t / cb.zap.dur) : -1;
  if (zp >= 0) {
    if (vm.wandKind !== cb.zap.kind) { while (vm.wand.children.length) vm.wand.remove(vm.wand.children[0]); vm.wand.add(buildWeaponModel('wand:' + cb.zap.kind, 0)); vm.wandKind = cb.zap.kind; }
    const up = Math.sin(Math.min(1, zp * 1.6) * Math.PI * 0.5) * (1 - Math.max(0, (zp - 0.6) / 0.4) ** 2), jab = Math.sin(Math.min(1, zp / 0.45) * Math.PI);   // up fast, down at the end
    vm.wand.visible = true;
    vm.wand.position.set(-0.3 + 0.2 * up, -0.75 + 0.4 * up, -0.55 - 0.3 * jab);
    vm.wand.rotation.set(-0.3 - 0.95 * up, 0, 0.1 * (1 - up));
  } else if (vm.wand.visible) vm.wand.visible = false;
  let x = 0.38, y = -0.5, z = -0.7, rx = -0.15, rz = 0.15;
  if (zp >= 0) y -= 0.12 * Math.sin(zp * Math.PI);
  if (inv.weapon === 'dagger') { y = -0.4; rx = -0.32; }   // a short blade is held higher and tipped up so it reads on screen
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
  if (limp && vm.model.userData.joints) { limpStep(dt, player.yaw, player.pitch, player.vx, player.vz, camera.position.y); limpApply(vm.model); }   // it flops: a soft chain driven by how you move and turn
  const g = vm.group;
  g.position.x += (x - g.position.x) * k; g.position.y += (y - g.position.y) * k; g.position.z += (z - g.position.z) * k;
  g.rotation.x += (rx - g.rotation.x) * k; g.rotation.z += (rz - g.rotation.z) * k;
}

// ---- XP and levels (js/progress.js) ----
let xpT = 0;                                       // seconds the XP popup stays up
function xpPopup(text, color) { const x = el('xpgain'); x.textContent = text; x.style.color = color; x.style.display = 'block'; xpT = 2.2; }
// XP for a kill, called once per dead enemy from makeCorpse / bossDefeated. Summons give none; a respawned guard a share; a clean sneak kill a bonus; bosses and quest targets ignore the floor budget.
function awardKill(e, sneak) {
  if (e.minion || e.type === 'ally') return;
  const exempt = !!(e.boss || e.spec.mini);
  let base = e.boss ? (e.final ? PROG.xpFinalBoss : PROG.xpStageBoss * stageFactor(stage, TUNE)) : killXp(e.T, stage, floorNum, TUNE);
  if (!e.boss) { if (e.resp) base *= TUNE.xpRespawn; if (sneak) base *= 1 + TUNE.xpSneak; }
  gainXp(base, exempt);
}
function gainXp(base, exempt) {
  const r = prog.award(base, floorKey(stage, floorNum), xpBudget(stage, floorNum, TUNE), exempt, TUNE);
  if (r.up) { Sfx.play('levelup'); flash(`Level ${prog.level}! ${prog.pts ? prog.pts + ' stat point' + (prog.pts > 1 ? 's' : '') : ''}${prog.skp ? ' and ' + prog.skp + ' skill point' + (prog.skp > 1 ? 's' : '') : ''} to spend (Tab)`); xpPopup('LEVEL ' + prog.level, '#7fffd4'); }
  else if (r.capped) xpPopup(r.xp ? `no more XP here (+${r.xp})` : 'no more XP here', '#9a9a9a');
  else if (r.xp) xpPopup(`+${r.xp} XP`, '#9ad4ff');
}
const questXp = () => gainXp(PROG.xpQuest * stageFactor(stage, TUNE), true);   // a quest finished (the reward handed over)
// Spend a point ('stat' or 'skill'), instantly and for good. Returns true if it was spent.
function spendPoint(kind, id) {
  if (!(kind === 'stat' ? prog.spendStat(id) : prog.spendSkill(id))) return false;
  derive(prog, TUNE, PD);
  if (id === 'vig') { inv.maxHp += TUNE.lvVigorHp; inv.hp += TUNE.lvVigorHp; }               // (a shrine's max HP price is already in inv.maxHp)
  else if (id === 'end') { STAMINA_MAX = PD.stamMax; cb.stamina += TUNE.lvEndStam; }
  else if (id === 'dashCh') cb.dash.n++;                                                       // the new charge is ready
  return true;
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
  if (inSafe || cb.iframe > 0) return;             // the safe room, or the dash's invulnerable moment: nothing can hurt you
  hitReaction(n); Sfx.play('phurt', Math.min(1.5, 0.5 + n / 20));
  hunger.fight = 3;
  if (cb.eat) { cb.eat = null; flash('Interrupted!'); }
  if (dev.on) return;
  inv.hp = Math.max(0, inv.hp - n);
  if (inv.hp <= 0) {
    state = 'dead'; knock.m = 0; player.dashS.on = false;
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
    const vx = o.x - player.x, vz = o.z - player.z, d2 = vx * vx + vz * vz;
    if (d2 > 5.76) continue;                                  // (2.4 m, squared: most props are far, so no square root for them)
    const d = Math.sqrt(d2);
    if ((vx * dx + vz * dz) / d < 0.8) continue;
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

let promptFor = null, promptLocked = false, promptTxt = '';
const promptNode = document.getElementById('promptText'), barNode = document.getElementById('barFill');
function updateSearch(dt) {
  const target = lookTarget();
  const info = target && targetInfo(target);
  if (target && !info.locked && player.keys[KEYS.interact]) {
    if (!search || search.o !== target) search = { o: target, t: 0 };
    search.t += dt;
    if (search.t >= info.time) { finishSearch(target); search = null; }
  } else search = null;

  const prompt = el('prompt');                                  // (other code shows this prompt too, eating and drawing the bow, so it is not cached)
  if (target) {
    if (prompt.style.display !== 'block') prompt.style.display = 'block';
    if (promptFor !== info.label || promptLocked !== !!info.locked || promptNode.textContent !== promptTxt) { promptFor = info.label; promptLocked = !!info.locked; promptTxt = promptLocked ? promptFor : `Hold E: ${promptFor}`; promptNode.textContent = promptTxt; }   // (the text is rebuilt only when the label changes)
    const w = (search && info.time ? Math.min(1, search.t / info.time) * 100 : 0) + '%'; if (barNode.style.width !== w) barNode.style.width = w;
  } else if (prompt.style.display !== 'none') prompt.style.display = 'none';
}

// The Final Chamber's rune circle (floor.runes = its centre): it swells for flareWarn s, then flares for flareLen s, once every flareEvery s (a phase of gameT). Pulses the shared rune and mist materials.
// Returns the multiplier on how far guards see you: flareSeen while you stand within flareR m of the centre during a flare, else 1.
function updateRunes() {
  const T = theme.mechanic.TUNE, ph = gameT % T.flareEvery, on = ph >= T.flareEvery - T.flareLen, t0 = T.flareEvery - T.flareLen - T.flareWarn;
  RUNE_MAT.opacity = on ? 1 : ph >= t0 ? 0.55 + 0.4 * (ph - t0) / T.flareWarn : 0.5 + 0.08 * Math.sin(gameT * 1.4);
  MIST_MAT.opacity = 0.5 + 0.2 * Math.sin(gameT * 0.6);
  return on && Math.hypot(player.x - floor.runes.x, player.z - floor.runes.z) < T.flareR ? T.flareSeen : 1;
}
// Goblin Market: a guard that sees you rifle a chest or barrel (within watchR, in sight, not already hunting) is put on notice and goes to look where you were.
function watchedSearch() {
  const T = theme.mechanic.TUNE; let n = 0;
  for (const e of enemies) {
    if (e.dead || e.dormant || e.state === 'alerted' || e.sleepT > 0 || Math.hypot(e.x - player.x, e.z - player.z) > T.watchR || !hasLOS(floor, e.x, e.z, player.x, player.z)) continue;
    e.aware = Math.max(e.aware, T.watchAware); e.last = { x: player.x, z: player.z }; n++;
  }
  if (n) { flash('A stallkeeper saw that!'); addLog('A stallkeeper saw you rifle that and is coming to look.', '#ffa040'); discover('item:crowd', 'Market crowd'); }
}
const SEARCH_NOISE = { chest: 3, vaultchest: 3, barrel: 4, rubble: 4, pantry: 3, door: 5 };   // metres, heard when the search finishes
// An ordinary altar: one prayer heals a little. Unhurt, the blessing is kept for later (nothing is used up).
const PRAYER = { heal: 12 };   // HP
function pray(o) {
  discover('item:altar', 'Altars');
  if (inv.hp >= inv.maxHp) { flash("The altar's warmth finds nothing to mend. Come back when you are hurt."); return; }
  inv.hp = Math.min(inv.maxHp, inv.hp + PRAYER.heal); o.p.opened = true; if (o.p.src) o.p.src.prayed = true;
  flash('You kneel and pray. A warm light closes your wounds.'); addLog('You prayed at an altar: +' + PRAYER.heal + ' HP.', '#ffd070');
}
function finishSearch(o, smashed) {
  if (o.p.kind === 'merchant') { shopUI.open(); return; }
  if (o.p.kind === 'altar') { dealUI.open(o); return; }
  if (o.p.kind === 'prayer') { pray(o); return; }
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
  if (chest) { discover('item:chest', 'Chests'); Sfx.play('chest'); }
  if (theme.mechanic.kind === 'crowd' && o.p.kind !== 'door' && SEARCH_NOISE[o.p.kind]) watchedSearch();
  if (o.p.kind === 'door') {
    inv.remove(inv.pack.find(i => i.type === 'key' && i.lock === o.p.lock));
    openDoor(o);
    if (theme.doors.noise) loud(theme.doors.noise);                         // an ice seal shatters loudly, a gate grinds
    if (theme.doors.style === 'spore') { const T = theme.mechanic.TUNE; spawnCloud(o.x, o.z, T.puffR, T.puffDur, T.puffDaze, true); flash('The spore seal bursts: a cloud of spores!'); }
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
  if (got.length) Sfx.play('pickup'); let msg = got.length ? 'Found ' + got.join(', ') : left.length ? '' : 'Nothing useful';
  if (notes.length) msg += (msg ? ' ' : '') + `(${notes.join(', ')})`;
  flash(msg);
}

// Doors slide up out of the way once unlocked.
function openDoor(o) {
  floor.tiles[o.p.y * floor.w + o.p.x] = T_FLOOR;
  o.p.opened = true; o.anim = 0; Sfx.play('door');
}
function updateDoors(dt) {
  const anim = DOOR_ANIM[theme.doors.openAnim] || DOOR_ANIM.slide;
  for (const o of propObjs) {
    if (o.p.kind !== 'door' || o.anim === undefined || o.anim >= 1) continue;
    o.anim = Math.min(1, o.anim + dt);
    anim(o, o.anim);
    if (o.anim >= 1) { o.mesh.visible = false; if (theme.sky && theme.doors.openAnim !== 'fold') o.gone = true; }   // (an open-sky theme has no ceiling plane to hide a lifted door: the culling pass must not show it again)
  }
}

let hudKey = '';
const HUNGER_COLOR = { fed: '#d9a441', hungry: '#e08a2a', weak: '#d4562a', starving: '#b01e1e' };
const styleSeen = {};   // id -> { prop: last value written }, so an unchanged value costs no DOM write (and no key string is built)
function setStyle(id, prop, v) { const m = styleSeen[id] || (styleSeen[id] = {}); if (m[prop] === v) return; m[prop] = v; el(id).style[prop] = v; }
function setPct(id, pct) { const q = Math.round(pct * 10) / 10, m = styleSeen[id] || (styleSeen[id] = {}); if (m.w === q) return; m.w = q; el(id).style.width = q + '%'; }   // a bar's width: the string is built only when the value (to 0.1%) changed
let hudBossDef = null;
function bossHud(def) {                                 // the boss bar's name and one notch per phase (rebuilt only when the boss's def changes)
  hudBossDef = def; const bar = el('bossBar');
  el('boss').firstElementChild.textContent = def.name;
  while (bar.children.length > 1) bar.lastElementChild.remove();
  for (const p of def.phases) { const n = document.createElement('div'); n.className = 'bnotch'; n.style.left = p.at * 100 + '%'; bar.appendChild(n); }
}
let pipKey = -1, lvKey = -1;
function updateHud() {
  let boss = null; for (let i = 0; i < enemies.length; i++) if (enemies[i].boss) { boss = enemies[i]; break; }
  if (boss && boss.def && boss.def !== hudBossDef) bossHud(boss.def);
  if (boss && boss.justWoke) { boss.justWoke = false; flash('The boss wakes!'); }
  setStyle('boss', 'display', boss && !boss.dormant && !boss.dead ? 'block' : 'none');
  if (boss) setPct('bossFill', Math.max(0, boss.hp / boss.maxHp * 100));
  setPct('hpFill', inv.hp / inv.maxHp * 100);
  setPct('stamFill', cb.stamina / STAMINA_MAX * 100);
  setStyle('stamFill', 'background', cb.exhT > 0 && ((cb.exhT * 8) | 0) % 2 === 0 ? '#e0453a' : cb.stamina < 25 && !dev.on ? '#d7822a' : cb.canSprint ? '#4cc36a' : '#c9a23a');   // flashes red when you try something tired; orange while exhausted (an action there is slow)
  setPct('dashFill', cb.dash.n >= PD.dashMax ? 100 : cb.dash.t / PD.dashRecharge * 100);   // the next dash charge coming back, under the stamina bar
  setStyle('dashFill', 'background', cb.dash.n < 1 && !dev.on ? '#6a7a8a' : cb.dashCd > 0 ? '#6a7a8a' : cb.stamina >= TUNE.dashStam || dev.on ? '#7fd8ff' : '#8a5a4a');
  const pk = cb.dash.n * 100 + PD.dashMax; if (pk !== pipKey) { pipKey = pk; el('dpips').textContent = '\u25CF'.repeat(cb.dash.n) + '\u25CB'.repeat(Math.max(0, PD.dashMax - cb.dash.n)); }   // charge pips, written only when they change
  setPct('xpFill', prog.need ? prog.xp / prog.need * 100 : 100);
  const lk = prog.level * 10000 + prog.pts * 100 + prog.skp; if (lk !== lvKey) { lvKey = lk; el('lvhint').textContent = 'Lv ' + prog.level + (prog.pts || prog.skp ? ` \u00B7 ${prog.pts ? prog.pts + ' stat' : ''}${prog.pts && prog.skp ? ' + ' : ''}${prog.skp ? prog.skp + ' skill' : ''} point${prog.pts + prog.skp > 1 ? 's' : ''} (Tab)` : ''); }
  setPct('hungerFill', hunger.v);
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
  const line = `<span style="color:${itemColor(w)}">${itemName(w)}${w.base === 'spear' ? (isLimp(w) ? ' (LIMP)' : ` (${w.charges} kills left)`) : ''}</span>${inv.equip.offhand ? ` + <span style="color:${itemColor(inv.equip.offhand)}">${itemName(inv.equip.offhand)}</span>${wstats().ranged ? ' (stowed)' : ''}` : ''}${inv.swapT > 0 ? ' (swapping)' : ''} &middot; Armor ${arm}% &middot; Arrows ${inv.arrows}/${QUIVER_MAX} &middot; Gold ${inv.gold} &middot; Pack ${inv.pack.length}/${PACK_MAX}${hunger.stage === 'fed' ? '' : ` &middot; <span style="color:#e08a2a">${hunger.stage[0].toUpperCase() + hunger.stage.slice(1)}</span>`}${buffs ? '<br>' + buffs : ''}`;
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
let respawnQ = [], baseGuards = 0;   // respawnQ: seconds left on each pending replacement (one per kill), per floor

function disposeGroup(g) { g.traverse(freeObject); bakeFree(g.userData.bake); }   // free a floor's GPU memory: geometry, materials and their textures
// Keep the floor you are on so you can come back to it exactly as you left it.
function saveFloor() {
  clearBombs();
  arrows.forEach(dropArrowMesh); arrows.length = 0; wandFxClear(group); bossTeleHide(); bossLanesClear(); bossPuddlesClear(); bossFlamesClear();
  floorCache[floorNum] = { floor, group, stairBox, upBox, stairsLight, upLight, propObjs, decorObjs, enemies, torchPts, cullChunks, explored, WALL_H, baseGuards, respawnQ };
  scene.remove(group);
}
function loadFloor(n, c) {
  floorNum = n; delete floorCache[n];
  ({ floor, group, stairBox, upBox, stairsLight, upLight, propObjs, decorObjs, enemies, torchPts, cullChunks, explored, WALL_H, baseGuards, respawnQ } = c);
  scene.add(group); bakeUse(group.userData.bake);
  enemies.forEach(e => { e.cone.visible = dev.on; });
  Enemy.all = enemies; player.props = propObjs; player.mobs = enemies;
  PERF.floorBoss = !!floor.boss; applyFog(); qualitySettle();
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
  delete prog.floorXp[floorKey(stage, n)];                // a brand new floor (dev jump, tests) has its XP budget back; changeFloor never does this
  allyReset();                                          // a fresh floor 1 (or a dev jump) starts without an ally
  if (floorCache[n]) { disposeGroup(floorCache[n].group); delete floorCache[n]; }
  generateAndEnter(n, n > 1 ? 'down' : null);
  const locked = floor.doors.map(d => d.room).join(', ');
  if (floor.boss) flash(bossMsg());
  else flash(`${n === 1 ? '' : `Floor ${n}. `}Find the stairs.${locked ? ` Locked: ${locked}. Keys hide in chests.` : ''}`);
}
const bossMsg = () => stage === FINAL_STAGE ? 'The final chamber, open to the night sky. Something huge sleeps on the dais. One healing potion hides along the walls.' : 'The boss arena. Something huge sleeps in the middle. One healing potion hides along the walls.';
// Staged floor build, the safe part: in idle time while you play floor n, floor n + 1's tile layout is generated (generateFloor is deterministic from the seed
// and these options, and touches no shared state but its own, so when it runs changes nothing) and the next stage's big textures are built one per idle slice.
// The result is used once, only if its key still matches, and dropped on any stage or floor jump. The gameplay rng is seeded on entry exactly as before.
let pregen = null, idleGen = 0;
const floorGenArgs = n => { const final = stage === FINAL_STAGE; return [stageSeed, final ? MAX_FLOOR : n, { armory: !final && n === armoryFloor, boss: bossFloorAt(n), shop: !final && n === shopFloor, quest: final ? undefined : questPlan[n], themeName: theme.name, layoutStyle: theme.layout.style, depth: effFloor(0) }]; };
const genKey = a => a[0] + '|' + a[1] + '|' + JSON.stringify(a[2]);
const busyNow = () => { if (perfStats.dt > 0.02) return true; for (let i = 0; i < enemies.length; i++) if (!enemies[i].dead && enemies[i].state === 'alerted') return true; return false; };   // a slow frame or a fight: not the moment to generate
const idle = (fn, g, tries = 0) => {
  const run = d => { if (g !== idleGen) return; if (tries < 3 && busyNow() && !(d && d.didTimeout)) return idle(fn, g, tries + 1); fn(); };   // (three tries, then the safety timeout: it runs anyway)
  if (window.requestIdleCallback) requestIdleCallback(run, { timeout: tries ? 1500 : 4000 }); else setTimeout(run, 150);
};
function takeFloor(n) {                                  // the pre-generated layout if there is one for exactly this floor, else generated now
  const a = floorGenArgs(n), p = pregen; pregen = null;
  return p && p.key === genKey(a) ? p.floor : generateFloor(a[0], a[1], a[2]);
}
function prefetchNext(n) {
  const g = ++idleGen; pregen = null; pinTheme = null;                    // a new floor: whatever was pending is stale
  if (stage === FINAL_STAGE) return;
  if (n < MAX_FLOOR) idle(() => { const a = floorGenArgs(n + 1), t0 = performance.now(); pregen = { key: genKey(a), floor: generateFloor(a[0], a[1], a[2]) }; perfStats.pregenMs = performance.now() - t0; }, g);
  else {                                                 // the boss floor: build the next stage's textures ahead, one per idle slice
    const nt = stage + 1 === FINAL_STAGE ? FINAL_THEME : stageThemes[stage]; pinTheme = nt.name;
    for (const mk of [themeWallTex, themeFloorTex, themeCeilTex]) idle(() => { const keep = theme; theme = nt; try { mk(); } finally { theme = keep; } }, g);
  }
}
function generateAndEnter(n, arrive) {
  clearBombs();
  gameRng = makeRng(((stageSeed ^ 0x6a09e667) >>> 0) + n * 69069);   // gameplay RNG for this floor (guard zones, procs, respawns)
  floorNum = n;
  const final = stage === FINAL_STAGE, gn = final ? MAX_FLOOR : n;   // the final stage's one floor is generated as a floor 5 arena
  floor = takeFloor(n);
  assignEnemyTypes(floor, stageSeed, gn, theme.name);       // natives, rat packs, wolves and their handlers (js/enemytypes.js)
  spreadEnemies(floor, stageSeed, gn);                      // then spread them over their rooms (per-room cap, spaced spawns and patrol ends)
  questSpawn(floor);                                        // then the floor's mini-boss, if any (js/quests.js), so the type pass never touches it
  if (floor.boss) { const b = floor.enemies.find(e => e.boss), tb = final ? null : THEME_BOSS[theme.name]; if (b) { if (tb) { b.dress = tb.dress; b.skin = tb.skin; } b.final = final; b.bossId = final ? 'final' : theme.id; } }   // each theme's boss has its own look (the final arena's is the dragon: js/bossmodels.js)
  floor.waterSlow = theme.mechanic.kind === 'puddle' ? theme.mechanic.TUNE.enemySlow : 0;   // the Tavern's flooded patches slow guards too (js/enemy.js goTo)
  floor.patches = new Map(floor.decor.filter(d => PATCH_KINDS.includes(d.kind)).map(d => [d.y * floor.w + d.x, d.kind]));   // the theme's floor gimmick, by tile
  WALL_H = floor.boss ? BOSS_WALL_H : 3.6;
  explored = new Uint8Array(floor.w * floor.h);
  buildFloor();
  if (floor.boss && !final && bossDead[stage]) {            // a stage arena rebuilt after its boss fell (the cache was trimmed): no boss, the safe room door already open
    const bi = enemies.findIndex(e => e.boss); if (bi >= 0) { group.remove(enemies[bi].mesh); enemies.splice(bi, 1); }
    const s = floor.safe; s.open = true; floor.tiles[s.door.y * floor.w + s.door.x] = T_SAFEDOOR; s.o.anim = 1; s.o.mesh.position.y = WALL_H; s.o.mesh.visible = false; s.o.gone = true;
  }
  player.props = propObjs;
  player.mobs = enemies;
  search = null;
  arrows.length = 0;                                  // the old floor's group (and its arrows) is gone
  cb.draw = null;
  if (arrive) arriveBy(arrive); else player.place(floor);
  warmGpu();                                          // upload the whole floor now, under the loading hitch, not a chunk at a time as you walk into view
  updateCulling(player, cullChunks, propObjs, enemies);
  baseGuards = floor.enemies.length;
  respawnQ = [];                                      // replacements for killed guards (updateRespawn)
  floorBanner(n);
  qualitySettle();
  // no background pre-generation: the next floor is built only after you take the stairs (it caused hitches during play)
}

// Three.js uploads a mesh's buffers (and compiles its program) the first time it is drawn, and skips what is outside the view or hidden. Left alone, every new room
// walked into cost a 7 to 20 ms frame, and the first sight of a boss or an effect pool more. So a new floor is drawn once with everything on and uncullable (the frame the stairs
// already spend building), and renderer.compile covers the hidden pooled effects. updateCulling then puts the visibility back. Not done in ?norender=1 (no drawing at all).
const warmList = [];
function warmGpu() {
  if (params.has('norender')) return;
  warmList.length = 0;
  group.traverse(o => { if (o.isMesh && o.frustumCulled) { o.frustumCulled = false; warmList.push(o); } });
  for (const c of cullChunks) c.group.visible = true;
  for (const o of propObjs) if (o.mesh && !o.gone) o.mesh.visible = true;
  for (const e of enemies) e.mesh.visible = true;
  camera.position.set(player.x, eyeY(), player.z); camera.rotation.set(player.pitch, player.yaw, 0);
  renderer.compile(scene, camera); renderer.render(scene, camera);
  for (let i = 0; i < warmList.length; i++) warmList[i].frustumCulled = true;
  warmList.length = 0;
}

// Take the stairs. The floor you leave is kept; the one you arrive on is restored if you have been there, else built.
// dir: 'down' (you go to floor n and arrive by its stairs up) or 'up' (you arrive by its stairs down).
function changeFloor(n, dir) {
  if (dir === 'up' && !floorCache[n]) { sealedUp(); return; }   // never rebuild a floor you already left
  Sfx.play('stairs'); allyDepart();                   // a following ally within a few metres comes too (js/quests.js)
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

// Respawns, on every floor but the boss arena: each kill of an ordinary guard (a native, pack rat, wolf; not a mimic, summon, quest target or escaped thief)
// queues a timer of respawnMin + rnd * respawnSpan seconds (respawnQ, kept per floor). A due timer spawns one replacement walking a normal unaware patrol,
// only while fewer than baseGuards enemies live, in a room that takes spawns (js/enemytypes.js spawnRoom), is not the player's, is under its cap, is out of line of
// sight and respawnMinDist metres away, and not within 6 m of another enemy. No room fits: retry in 8 s. (This replaces the old floor 3+ trickle.)
function updateRespawn(dt) {
  if (floor.boss) return;
  for (let i = 0; i < enemies.length; i++) {
    const e = enemies[i];
    if (!e.dead || e.rq) continue;
    e.rq = true;                                      // counted once, whatever happens to the body
    if (!e.boss && !e.T.mimic && !e.minion && !e.escaped && !e.spec.mini && !e.spec.qguard && e.type !== 'sackthief') respawnQ.push(TUNE.respawnMin + gameRng() * TUNE.respawnSpan);
  }
  for (let i = respawnQ.length - 1; i >= 0; i--) {
    respawnQ[i] -= dt;
    if (respawnQ[i] > 0) continue;
    if (trySpawnGuard()) respawnQ.splice(i, 1); else respawnQ[i] = 8;
  }
}
function trySpawnGuard() {
  let alive = 0; for (let i = 0; i < enemies.length; i++) { const e = enemies[i]; if (!e.dead && !e.T.mimic && !e.minion) alive++; }
  if (alive >= baseGuards) return false;
  const pRoom = roomOf(floor, player.tileX, player.tileY), minD2 = TUNE.respawnMinDist ** 2, w = floor.w;
  const ok = floor.rooms.filter((r, i) => spawnRoom(r, i) && r !== pRoom && roomTiles(floor, r).length);
  for (let n = ok.length; n > 0;) {                   // rooms in random order
    const j = Math.floor(gameRng() * n), r = ok[j]; ok[j] = ok[--n]; ok[n] = r;
    let held = 0; for (let i = 0; i < enemies.length; i++) { const e = enemies[i]; if (!e.dead && e.x >= r.x * TILE && e.x < (r.x + r.w) * TILE && e.z >= r.y * TILE && e.z < (r.y + r.h) * TILE) held++; }
    const tiles = roomTiles(floor, r);
    if (held >= roomCap(r) || !tiles.length) continue;
    for (let t = 0; t < 10; t++) {
      const c = tiles[Math.floor(gameRng() * tiles.length)], x = (c.x + 0.5) * TILE, z = (c.y + 0.5) * TILE;
      if (floor.tiles[c.y * w + c.x] !== T_FLOOR || floor.blocked[c.y * w + c.x]) continue;
      if ((x - player.x) ** 2 + (z - player.z) ** 2 <= minD2 || hasLOS(floor, player.x, player.z, x, z)) continue;
      let near = false;
      for (let i = 0; i < enemies.length && !near; i++) { const e = enemies[i]; near = !e.dead && (e.x - x) ** 2 + (e.z - z) ** 2 < 36; }
      if (near) continue;
      const others = ok.length > 1 ? ok.filter(q => q !== r) : [r], bt = roomTiles(floor, others[Math.floor(gameRng() * others.length)]), b = bt.length ? bt[Math.floor(gameRng() * bt.length)] : c;   // patrol on to a random spot in one of the other eligible rooms
      const e = new Enemy({ x: c.x, y: c.y, route: [{ x: c.x, y: c.y }, { x: b.x, y: b.y }], seed: (gameRng() * 4294967296) >>> 0, type: respawnType(theme.name, floorNum, gameRng) }, floor);
      e.cone.visible = dev.on; e.resp = true; group.add(e.mesh); enemies.push(e);   // resp: pays only xpRespawn of its XP
      return true;
    }
  }
  return false;
}

// A boss's summon (js/boss.js bossSummon): one enemy of `type` beside the boss, already alerted. false when there is no open spot.
Enemy.summon = (boss, type) => {
  for (let k = 0; k < 6; k++) {
    const a = gameRng() * Math.PI * 2, x = boss.x + Math.cos(a) * 2.4, z = boss.z + Math.sin(a) * 2.4;
    if (Player.wallHit(floor, x, z, 0.5) || Player.prototype.blocked.call({ radius: 0.5, props: floor.solids, mob: true }, floor, x, z)) continue;   // not inside a wall, a prop or the stairwell
    const tx = Math.floor(x / TILE), ty = Math.floor(z / TILE);
    const e = new Enemy({ x: tx, y: ty, route: [{ x: tx, y: ty }, { x: tx, y: ty }], seed: (gameRng() * 4294967296) >>> 0, type }, floor);
    e.x = x; e.z = z; e.minion = boss; e.last = { x: player.x, z: player.z }; e.set('alerted');
    e.cone.visible = dev.on; group.add(e.mesh); enemies.push(e); e.sync(0);
    return true;
  }
  return false;
};

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

// The map's tiles (explored ones only) are drawn into a layer of their own, and only when a tile's colour code changed (a reveal, a door, a sliding shelf, a new floor): a pass over the
// tiles to compare codes costs microseconds, thousands of fillRects every few frames did not. The frame then copies the layer and draws the moving things on top.
const miniLayer = document.createElement('canvas'), lctx = miniLayer.getContext('2d');
miniLayer.width = hud.mini.width; miniLayer.height = hud.mini.height;
const MINI_COL = ['#000', '#2a2a33', '#ffd24a', '#5aa0ff', '#c0702a', '#6a6a78'];   // by code: unexplored, wall (or a safe-room door), the way down (gold), the way back up (blue), door, floor
let miniSig = new Uint8Array(0), miniFloor = null;
function miniLayerUpdate() {
  const n = floor.w * floor.h, tiles = floor.tiles, safe = floor.safe, up = floor.up;
  let diff = miniFloor !== floor || miniSig.length !== n;
  if (miniSig.length !== n) miniSig = new Uint8Array(n);
  miniFloor = floor;
  for (let i = 0; i < n; i++) {
    let c = 0;
    if (explored[i]) { const t = tiles[i]; c = t === T_WALL || (t === T_DOOR && safe) ? 1 : t === T_STAIRS ? 2 : t === T_START && up ? 3 : t === T_DOOR ? 4 : 5; }
    if (miniSig[i] !== c) { miniSig[i] = c; diff = true; }
  }
  if (!diff) return;
  const S = miniLayer.width / floor.w;
  lctx.fillStyle = '#000'; lctx.fillRect(0, 0, miniLayer.width, miniLayer.height);
  let cur = 0;
  for (let y = 0, i = 0; y < floor.h; y++) for (let x = 0; x < floor.w; x++, i++) {
    const c = miniSig[i]; if (!c) continue;
    if (c !== cur) { lctx.fillStyle = MINI_COL[cur = c]; }
    lctx.fillRect(x * S, y * S, S + 0.5, S + 0.5);
  }
}
function drawMinimap(step = 1) {
  const S = hud.mini.width / floor.w;
  miniLayerUpdate(); mctx.drawImage(miniLayer, 0, 0);
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
  theme = s === FINAL_STAGE ? FINAL_THEME : stageThemes[s - 1]; Sfx.setTheme(theme.id);
  HUSH = theme.mechanic.hush || 1;
  if (s < FINAL_STAGE) planStage(s); else { stageSeed = stageSeedOf(s); questPlan = {}; }
  prisonerRun = prisonerRuns[s] || null;
  torch.color.setHex(theme.pal.light);
  scene.background = new THREE.Color(theme.pal.fog); scene.fog = new THREE.FogExp2(theme.pal.fog, theme.fog.density); applyFog();
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
  Sfx.play('stairs'); allyDepart();
  saveFloor();                                         // into the old stage's cache
  search = null; cb.draw = null; cb.eat = null;
  useStage(s); trimCaches(s, dir);
  const n = dir === 'up' ? MAX_FLOOR : 1, c = floorCache[n];
  if (c) { loadFloor(n, c); arriveBy(dir); floorBanner(n); }
  else { group = null; generateAndEnter(n, dir); }
  flash(s === FINAL_STAGE ? 'The final stage. Something ancient sleeps under the open sky.' : dir === 'up' ? `You climb back up to stage ${s}: ${theme.name}, the safe room.` : `Stage ${s} of ${STAGES}: ${theme.name}. ${floor.boss ? '' : 'Find the stairs.'}`);
  allyArrive();
  hunger.fight = 0;
  pinTheme = null; pruneThemeTextures();               // free the textures of themes with no floor left (the pinned next theme is the current one now)
}
// The stairs in the safe room lead to the next stage; after the last stage (the final boss) the run is over.
function enterNextStage() { if (stage < FINAL_STAGE) changeStage(stage + 1, 'down'); else finishRun(); }
// Dev and tests: a fresh stage s (all caches thrown away, no ally, no prisoner).
function startStage(s) {
  clearTimeout(winTimer);
  s = Math.max(1, Math.min(FINAL_STAGE, s | 0));
  for (const k of Object.keys(stageCaches)) { disposeCache(stageCaches[k]); delete stageCaches[k]; }
  prog.floorXp = {}; allyReset(); prisonerRun = null; prisonerWalk = null; for (const k of Object.keys(prisonerRuns)) delete prisonerRuns[k]; for (const k of Object.keys(bossDead)) delete bossDead[k];
  useStage(s); pinTheme = null; startFloor(1); pruneThemeTextures();
}
function finishRun() {
  state = 'won';
  document.exitPointerLock();
  hud.overlayText.innerHTML = `<h1>Run complete</h1><p>The Cinder Wyrm is dead. You made it through all ${STAGES} stages and the final chamber.</p><p><button type="button" style="font:inherit;padding:6px 18px;cursor:pointer">Start a new run</button></p>`;
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
  if (code === KEYS.dash) cb.dashReq = true;
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
// ---- noise symbol (all modes) and the Easy-mode hearing ring ----
// The HUD symbol lights 0 to 3 arcs from how far your sound carries right now (steps, sprinting, fights, pulses); a level holds 0.4 s so a one-frame clang stays visible.
const noiseEl = el('noise'); let noiseLvl = 0, noiseHold = 0;
function updateNoiseHud(r, dt) {
  const l = r < 3 ? 0 : r < 9 ? 1 : r < 16 ? 2 : 3;   // crouch-creeping (1.5 m) counts as silent; walking 6 m, sprinting 13 m
  noiseHold -= dt;
  if (l >= noiseLvl || noiseHold <= 0) { if (l >= noiseLvl) noiseHold = 0.4; noiseLvl = l; }
  if (noiseEl.dataset.l !== '' + noiseLvl) noiseEl.dataset.l = noiseLvl;
}
// One flat ring on the floor round you: how far a normal walking step (not crouched) is heard. Shown only in Easy with the toggle on.
const hearRing = (() => {
  const g = new THREE.RingGeometry(0.97, 1, 64); g.rotateX(-Math.PI / 2); g.userData.shared = true;
  const m = new THREE.MeshBasicMaterial({ color: 0x4ac0ff, transparent: true, opacity: 0.55, side: THREE.DoubleSide, depthWrite: false }); m.userData.shared = true;
  const r = new THREE.Mesh(g, m); r.visible = false; r.frustumCulled = false; r.renderOrder = 5; r.position.y = 0.07; scene.add(r); return r;
})();
let hearR = 0;
function updateAssist(under, mt) {
  if (!assist.showHearing) { if (hearRing.visible) hearRing.visible = false; return; }
  hearR = (6 + player.noiseBonus + (under === 'brush' ? mt.rustle : 0)) * HUSH * (under === 'dark' ? mt.darkFoot : 1) * (under === 'crowd' ? mt.din : 1);   // the same maths as the walking noise event below, minus the crouch wind
  if (!hearRing.visible) hearRing.visible = true;
  hearRing.position.x = player.x; hearRing.position.z = player.z;
  if (hearRing.scale.x !== hearR) hearRing.scale.set(hearR, 1, hearR);
}

function qualityApply(r) { applyFog(); if (renderer.getPixelRatio() !== r) { renderer.setPixelRatio(r); resize(); } }
let last = performance.now(), frameNo = 0, dazeOn = false, frameCount = 0;
const BASE_FOV = 75; let fovNow = BASE_FOV;
const noiseCtx = { events: [], emit: (x, z, r, src) => pending.push({ x, z, r, src }), shoot: spawnEnemyShot, steal: stealGold, prints: null, pt: null, t: 0 };   // what every creature's update gets: built once, its fields set each frame
const perfStats = { logic: 0, dt: 0 };   // average milliseconds of game logic per frame (everything but drawing), for the tests
function frame(now) {
  const dt = (now - last) / 1000; last = now; perfStats.dt = dt; const tl0 = performance.now();
  if (state === 'play') {
    player.update(dt, floor); Sfx.walk(dt, Math.hypot(player.vx, player.vz), player.sprinting, player.crouching);
    inv.update(dt);
    updateSearch(dt); updateDrops(dt);
    updateCombat(dt);
    gameT += dt;
    updateRespawn(dt);
    updateArrows(dt);
    updateDoors(dt); updateMovers(dt);
    if (prisonerWalk) prisonerStep(Math.min(dt, 0.05));                                // a freed prisoner on its way to the stairs (js/quests.js): only while one is walking
    const events = noiseCtx.events; events.length = 0; for (let i = 0; i < pending.length; i++) events.push(pending[i]); pending.length = 0;   // noises guards made last frame (the same two arrays every frame)
    for (const n of events) rings.push({ x: n.x, z: n.z, r: n.r, t: 0 });
    const under = floor.patches.get(player.tileY * floor.w + player.tileX), mt = theme.mechanic.TUNE;
    const hush = HUSH * PD.noiseMul * (player.crouching && mt && mt.wind ? mt.wind : 1);          // the Frozen Chapel's wind muffles a crouching player
    if (pulse > 0) { events.push({ x: player.x, z: player.z, r: pulse * hush }); rings.push({ x: player.x, z: player.z, r: pulse * hush, t: 0 }); }
    if (player.noiseRadius > 0) events.push({ x: player.x, z: player.z, r: (player.noiseRadius + (under === 'brush' ? mt.rustle : 0)) * hush * (player.crouching ? PD.crouchNoise : 1) * (under === 'dark' ? mt.darkFoot : 1) * (under === 'crowd' ? mt.din : 1) });   // brush rustles: +3 m while you move in it; the Market din muffles your steps on a crowd patch
    if (under === 'bell') {                                                                                          // a tripwire bell: one loud alarm, then it is spent
      floor.patches.delete(player.tileY * floor.w + player.tileX);
      const bo = decorObjs.find(o => o.kind === 'bell' && o.p.x === player.tileX && o.p.y === player.tileY); if (bo) bo.mesh.visible = false;
      events.push({ x: player.x, z: player.z, r: 14 }); rings.push({ x: player.x, z: player.z, r: 14, t: 0 });
      discover('item:bell', 'Tripwire bells'); flash('DING! A tripwire bell rings.');
    }
    if (player.noiseRadius > 0 && under === 'puddle' && !player.crouching) {   // shallow water: a walking step splashes, a sprinting one more; creeping through is silent
      const r = player.sprinting ? mt.splashRun : mt.splash;
      events.push({ x: player.x, z: player.z, r }); rings.push({ x: player.x, z: player.z, r, t: 0 });
      if (discover('item:puddle', 'Shallow water')) flash('Splash! Shallow water carries sound.');
    }
    updateNoiseHud(Math.max(player.noiseRadius, pulse) * hush, dt); updateAssist(under, mt);
    pulse = 0;
    const noise = noiseCtx; noise.prints = floor.prints; noise.pt = mt; noise.t = gameT;
    for (const e of enemies) { const zone = e.update(Math.min(dt, 0.05), player, noise); if (zone) resolveEnemyAttack(e, zone); }
    if (allyRun) allyStep(Math.min(dt, 0.05), noise);                                  // the recruited ally (js/quests.js): returns at once unless one is alive on this floor
    separateBodies(enemies, player, floor);
    updateBombs(dt); updateGas(dt); updateClouds(dt); bossLanesUpdate(dt); bossPuddlesUpdate(dt); bossFlamesUpdate(dt);
    for (const e of enemies) if (e.dead && !e.corpseDone) { if (e.boss) bossDefeated(e); else makeCorpse(e, false); addLog(e.spec.mini ? `${e.spec.mini.name} ${e.cause}.` : `The ${e.T.name.toLowerCase()} ${e.cause}.`, '#ff6a6a'); }
    goneBodies();
    reveal();
    if ((frameNo = (frameNo + 1) % 15) === 0) discoverEnemiesInView();
    checkStairs();
    checkShopSight();
    if (msgTimer > 0) { msgTimer -= dt; if (msgTimer <= 0) hud.msg.style.opacity = 0; }
  }
  const fk = player.dashS.on ? 1 : 0, fovT = BASE_FOV + TUNE.dashFov * fk;               // a short FOV kick while dashing, eased in and out
  if (fovNow !== fovT) { fovNow += (fovT - fovNow) * (1 - Math.exp(-(fk ? 30 : 10) * dt)); if (Math.abs(fovT - fovNow) < 0.02) fovNow = fovT; camera.fov = fovNow; camera.updateProjectionMatrix(); }
  camera.position.set(player.x, eyeY(), player.z);
  camera.rotation.set(player.pitch, player.yaw, 0);
  if (group && group.userData.sky) group.userData.sky.position.copy(camera.position);   // the sky dome rides along with the camera
  if (shake.t > 0) {                               // decaying jolt: a sharp kick that settles over 0.3 s
    shake.t = Math.max(0, shake.t - dt);
    const s = shake.mag * (shake.t / shake.dur) ** 1.5;
    camera.rotation.x += (Math.random() - 0.5) * 2 * s; camera.rotation.y += (Math.random() - 0.5) * 2 * s; camera.rotation.z += (Math.random() - 0.5) * 3 * s;
    camera.position.y -= s * 2;
  }
  const dazed = pst.has('daze');
  if (dazed !== dazeOn) { dazeOn = dazed; canvas.style.filter = dazed ? 'blur(2.5px)' : ''; }
  if (dazed) camera.rotation.z += Math.sin(now / 180) * 0.035;
  Sfx.update(dt); bakeFlicker(now); if (torch.visible !== (quality.lamp > 0)) torch.visible = quality.lamp > 0;   // (level 2 drops the lantern: the one change of light count, and the one shader recompile)
  updateViewmodel(dt);
  frameCount++;
  if (frameCount % 3 === 0) updateCulling(player, cullChunks, propObjs, enemies);
  if (frameCount % quality.mini === 0) { if (state === 'play' && theme.mechanic.kind === 'brush') updateBrush(); drawMinimap(quality.mini); }                      // and the minimap three times a second per 9 frames, not every frame
  updateHud();
  perfStats.logic = perfStats.logic * 0.95 + (performance.now() - tl0) * 0.05;
  if (hearRing.visible && state !== 'play') hearRing.visible = false;
  if (!params.has('norender')) { renderer.render(scene, camera); if (state === 'play') adaptQuality(dt, qualityApply); }   // ?norender=1: tests skip the (software) drawing and keep all the game logic
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);

// Debug hook for testing from the console.
window.game = {
  get group() { return group; }, get noiseLevel() { return noiseLvl; }, get hearRing() { return hearRing; }, get hearRadius() { return hearR; }, assist, player, startFloor, startStage, changeStage, inv, cb, pst, hunger, arrows, perfStats, get floorCache() { return floorCache; }, get stageCaches() { return stageCaches; }, get stage() { return stage; }, get shopFloor() { return shopFloor; }, get stageThemes() { return stageThemes; }, quality, qualityApply, setQualityMode: m => setQualityMode(m, qualityApply), adaptQuality, renderInfo() { camera.position.set(player.x, eyeY(), player.z); camera.rotation.set(player.pitch, player.yaw, 0); updateCulling(player, cullChunks, propObjs, enemies); renderer.render(scene, camera); return { calls: renderer.info.render.calls, tris: renderer.info.render.triangles, geos: renderer.info.memory.geometries, tex: renderer.info.memory.textures }; }, get shopUI() { return shopUI; }, get rings() { return rings; }, get floor() { return floor; }, get enemies() { return enemies; }, get respawnQ() { return respawnQ; }, get baseGuards() { return baseGuards; }, updateRespawn, get state() { return state; }, prog, PD, spendPoint, gainXp, awardKill, get xpBudgetHere() { return xpBudget(stage, floorNum, TUNE); },
  draw() {
    camera.position.set(player.x, eyeY(), player.z);
    camera.rotation.set(player.pitch, player.yaw, 0);
    updateViewmodel(1); updateCulling(player, cullChunks, propObjs, enemies); bakeFlicker(performance.now()); drawMinimap(); renderer.render(scene, camera);
  },
};
