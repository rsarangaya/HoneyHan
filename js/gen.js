// Seeded RNG, themes, and the room-and-corridor floor generator.
const T_WALL = 0, T_FLOOR = 1, T_STAIRS = 2, T_START = 3, T_DOOR = 4, T_SAFEDOOR = 5;   // T_DOOR: a locked door, solid until unlocked. T_SAFEDOOR: the opened safe room door, open to the player and a wall to every enemy (arrows and sight too)

function makeRng(seed) {
  let s = seed >>> 0;
  const next = () => {            // mulberry32
    s = (s + 0x6D2B79F5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  next.int = (a, b) => a + Math.floor(next() * (b - a + 1));   // inclusive
  next.pick = arr => arr[Math.floor(next() * arr.length)];
  next.shuffle = arr => { for (let i = arr.length - 1; i > 0; i--) { const j = Math.floor(next() * (i + 1)); [arr[i], arr[j]] = [arr[j], arr[i]]; } return arr; };
  return next;
}

// Placeholder look per theme. Props, enemies and gimmicks come in later stages.
const THEMES = [
  { name: 'The Sunken Tavern',     wall: '#6b4a2f', floor: '#4a3524', ceil: '#2b1f16', fog: 0x120c08, light: 0xffb060 },
  { name: 'The Moonlit Orchard',   wall: '#3d5a3a', floor: '#2f4a2a', ceil: '#0e1626', fog: 0x070b14, light: 0xa8c0ff },
  { name: 'The Clockwork Library', wall: '#5a4636', floor: '#3a2d28', ceil: '#241c1a', fog: 0x0e0a08, light: 0xffd890 },
  { name: 'The Mushroom Cellar',   wall: '#4a4458', floor: '#2f2a3c', ceil: '#1a1624', fog: 0x0a0812, light: 0x9affc8 },
  { name: 'The Goblin Market',     wall: '#7a5a3a', floor: '#54402a', ceil: '#3a2418', fog: 0x140c06, light: 0xffa040 },
  { name: 'The Frozen Chapel',     wall: '#6c7e90', floor: '#4a5868', ceil: '#202a36', fog: 0x0a1018, light: 0xc8e4ff },
];

const MAP_W = 45, MAP_H = 45;               // the boss arena's size
const SAFE_PAD = 12;                        // rock added north of the arena (the map grows to 57 x 57) for the safe room behind the boss's hidden door
// Ordinary floors start small and grow a little: floor 1 is a compact 32 x 32 so the first minutes are not a long walk.
const mapSizeFor = floorNum => [32, 36, 40, 44][Math.min(floorNum, 4) - 1];
const weightedPick = (rng, w) => { let r = rng() * w.reduce((a, b) => a + b, 0); for (let i = 0; i < w.length; i++) { r -= w[i]; if (r < 0) return i; } return 0; };   // a seeded weighted choice by index
// Chest grade by depth: wooden mostly early, Silver and Ornate more often deeper, Golden rare (and never on floor 1 early).
const chestTierWeights = floorNum => [Math.max(22, 62 - 8 * floorNum), 26 + 2 * floorNum, 8 + 3 * floorNum, 1.5 + 1.4 * floorNum, 0.1 + 0.3 * floorNum];
const CHEST_ODDS = { locked: 0.12, trap: 0.10 };   // share of ordinary chests that are locked (floor 1 on) or trapped (floor 2 on); never both, never a mimic, same exclusions as mimics
const MIMIC_CHANCE = 0.08;   // share of ordinary chests (floor 2 on) that are mimics; never vault chests, key holders, locked rooms, the shop or the arena
const roomTargetFor = floorNum => [8, 9, 10, 11][Math.min(floorNum, 4) - 1];

// What each theme does to the floor. kind: the decal that marks it. n: how many per floor.
//   puddle: moving steps splash (8 m, 4 m crouched).  grass: a crouched player is half as visible.  glowcap: spore light, you are seen 40% farther.
//   bell: a tripwire that rings a 14 m alarm once.  ice: you slide.  The Library has no decal: all noise carries 40% farther.
const THEME_GIMMICK = {
  'The Sunken Tavern':   { kind: 'puddle',  n: [4, 7] },
  'The Moonlit Orchard': { kind: 'grass',   n: [9, 13] },
  'The Mushroom Cellar': { kind: 'glowcap', n: [5, 8] },
  'The Goblin Market':   { kind: 'bell',    n: [3, 5] },
  'The Frozen Chapel':   { kind: 'ice',     n: [5, 8] },
};

// What each room type is furnished with: [kind, min, max] per group.
//   edge: against a wall. inner: in the room's interior. floor: flat or small decals.
//   special: lootable props that define the room (always placed).
//   props: [min, max] ordinary loot props (chest, barrel, rubble).
const ROOM_THEMES = {
  generic:   { edge: [['crates', 0, 2], ['barrels', 0, 2], ['table', 0, 1], ['sacks', 0, 1], ['urn', 0, 2]], inner: [], floor: [['bones', 0, 2], ['rug', 0, 1], ['candles', 0, 1]], props: [1, 3] },
  barracks:  { edge: [['bed', 3, 5], ['weaponrack', 1, 1], ['barrels', 0, 1], ['banner', 1, 2]], inner: [['table', 0, 1]], floor: [['bones', 0, 1], ['rug', 0, 1], ['candles', 0, 1]], props: [1, 2] },
  messhall:  { edge: [['hearth', 1, 1], ['barrels', 1, 2], ['sacks', 1, 2], ['urn', 0, 2]], inner: [['table', 2, 3]], floor: [['bones', 1, 3], ['candles', 1, 2]], props: [1, 2], special: [['pantry', 1, 1]] },
  brewery:   { edge: [['cauldron', 1, 1], ['bookshelf', 1, 2], ['barrels', 1, 1]], inner: [], floor: [['rug', 0, 1], ['candles', 1, 2], ['bones', 0, 1]], props: [0, 0], special: [['potions', 1, 2]] },
  library:   { edge: [['bookshelf', 4, 7], ['banner', 0, 1], ['urn', 1, 2]], inner: [['table', 1, 2]], floor: [['rug', 1, 1], ['candles', 1, 2]], props: [1, 2] },
  storeroom: { edge: [['crates', 2, 4], ['barrels', 2, 3], ['sacks', 1, 2], ['urn', 1, 3]], inner: [['crates', 0, 1]], floor: [['bones', 0, 1]], props: [2, 3], special: [['pantry', 0, 1]] },
  shrine:    { edge: [['statue', 1, 3], ['banner', 2, 4], ['urn', 1, 3]], inner: [['altar', 1, 1]], floor: [['rug', 1, 1], ['candles', 2, 4]], props: [1, 2] },
  // the shop room (DESIGN.md section 14): shelves, a rug and lanterns. The counter and merchant are placed after furnishing.
  shop:      { edge: [['bookshelf', 2, 3], ['barrels', 0, 1], ['urn', 0, 1]], inner: [], floor: [['rug', 1, 1], ['candles', 2, 3]], props: [0, 0] },
  // locked rooms, opened with a key found elsewhere on the floor
  armory:    { edge: [['banner', 2, 3], ['weaponrack', 1, 1]], inner: [['table', 1, 1]], floor: [['candles', 1, 2], ['rug', 0, 1]], props: [0, 0], special: [['rack', 1, 3]] },
  vault:     { edge: [['banner', 1, 2], ['statue', 1, 2]], inner: [], floor: [['rug', 1, 1], ['candles', 1, 2]], props: [0, 0], special: [['vaultchest', 2, 3]] },
  lockedbrew:{ edge: [['cauldron', 1, 1], ['bookshelf', 1, 2], ['barrels', 1, 1]], inner: [], floor: [['rug', 1, 1], ['candles', 1, 2]], props: [0, 0], special: [['potions', 1, 2]] },
};
const BLOCKING_DECOR = new Set(['bed', 'bookshelf', 'barrels', 'crates', 'table', 'hearth', 'cauldron', 'altar', 'sacks', 'statue']);   // guards path around these: anything with a collision circle bigger than candles
const DECALS = new Set(['rug', 'bones', 'candles', 'banner']);                                                     // never fill a tile alone
const LOCKED_ROOMS = {
  armory:     { w: 7, h: 6, theme: 'armory',     name: 'armory',  key: 'Armory Key' },
  vault:      { w: 5, h: 5, theme: 'vault',      name: 'vault',   key: 'Vault Key' },
  brewery:    { w: 6, h: 5, theme: 'lockedbrew', name: 'brewery', key: 'Brewery Key' },
  lair:       { w: 6, h: 5, theme: 'lair',       name: 'lair',    key: 'Lair Key' },       // the mini-boss room (opts.quest = 'miniboss'), never rolled as a plain locked room
  cell:       { w: 4, h: 4, theme: 'cell',       name: 'cell',    key: 'Cell Key' },       // the prisoner's cell (opts.quest = 'prisoner'), likewise
};
const NEIGH8 = [[-1, -1], [1, -1], [-1, 1], [1, 1], [0, -1], [0, 1], [-1, 0], [1, 0]];

// A free tile next to a room's centre, used for guard spawns and patrol waypoints. k picks which one.
function roomPoint(f, r, k) {
  for (let j = 0; j < 8; j++) {
    const [dx, dy] = NEIGH8[(k + j) % 8], i = (r.cy + dy) * f.w + r.cx + dx;
    if (f.tiles[i] === T_FLOOR && !f.blocked[i]) return { x: r.cx + dx, y: r.cy + dy };
  }
  return { x: r.cx, y: r.cy - 1 };
}

// opts.armory: this floor must contain the armory (retries with new layouts until it fits). opts.quest: an encounter
// type from js/quests.js ('miniboss', 'shrine', 'wanted', 'thief' or 'prisoner'); the layout is retried until it fits, and floor.quest describes it.
function generateFloor(seed, floorNum, opts = {}) {
  if (opts.boss) return layoutBoss(seed, floorNum);
  let f;
  for (let attempt = 0; attempt < 24; attempt++) {
    f = layoutFloor(seed + attempt * 7777, floorNum, opts);
    if ((!opts.armory || f.rooms.some(r => r.theme === 'armory')) && (!opts.shop || f.shop) && (!opts.quest || f.quest)) break;
  }
  return f;
}

// Boss floor: no rooms, one big lumpy cave arena. The boss waits in the middle, guards patrol the rim,
// loot and statues sit along the walls and you start at the south end. At the north end a hidden door (opened when the boss dies)
// leads through the rock to the safe room, which holds the stairs down (floor.safe).
// Every blocking object is placed so the open floor stays connected (pillars never touch each other
// or the walls, props are checked with a flood fill).
function layoutBoss(seed, floorNum) {
  const rng = makeRng(seed * 7919 + floorNum * 104729);
  const w = MAP_W + SAFE_PAD, h = MAP_H + SAFE_PAD, cx = w >> 1, cy = (MAP_H >> 1) + SAFE_PAD;
  const tiles = new Uint8Array(w * h), blocked = new Uint8Array(w * h);
  const at = (x, y) => tiles[y * w + x];
  const wallAt = (x, y) => x < 0 || y < 0 || x >= w || y >= h || at(x, y) === T_WALL;
  const dist = (x, y, px, py) => Math.hypot(x - px, y - py);
  const seedOf = () => (rng() * 4294967296) >>> 0;
  const ph = [rng() * 6.28, rng() * 6.28, rng() * 6.28];
  const edgeR = a => 16.5 + 1.6 * Math.sin(3 * a + ph[0]) + 1.2 * Math.sin(5 * a + ph[1]) + 0.8 * Math.sin(8 * a + ph[2]);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++)
    if (dist(x, y, cx, cy) <= edgeR(Math.atan2(y - cy, x - cx))) tiles[y * w + x] = T_FLOOR;

  let sy = cy + Math.floor(edgeR(Math.PI / 2)) - 2; while (at(cx, sy) !== T_FLOOR) sy--;
  // the safe room: 9 x 7 tiles carved into the rock north of the arena, joined to the arena's north tip by a short passage whose
  // first tile is the hidden door. Planned here, carved after the props are placed (so the flood fills below never see it).
  let topY = 0; while (at(cx, topY) !== T_FLOOR) topY++;                       // the arena's northmost floor tile on the centre column
  let minY = topY;
  for (let x = cx - 5; x <= cx + 5; x++) { let y = 0; while (y < minY && at(x, y) !== T_FLOOR) y++; if (y < minY) minY = y; }
  const rB = minY - 3, rT = rB - 6, rX0 = cx - 4, rX1 = cx + 4;                // two wall rows between the arena and the room
  const gate = { x: cx, y: topY }, door = { x: cx, y: topY - 1 };             // the arena tile in front of the door, and the door tile
  const start = { x: cx, y: sy }, stairs = { x: cx, y: rT + 2 };               // the stairs sit two rows in from the north wall, so you can walk round to their open north side
  tiles[start.y * w + start.x] = T_START;

  // rock pillars scattered over the arena (cover); none beside another pillar, a wall, the boss, the start or the stairs
  const open8 = (x, y) => { for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) if (wallAt(x + dx, y + dy)) return false; return true; };
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    if (at(x, y) !== T_FLOOR || dist(x, y, cx, cy) < 7 || dist(x, y, start.x, start.y) < 5 || dist(x, y, gate.x, gate.y) < 4.5) continue;
    if (open8(x, y) && rng() < 0.1) tiles[y * w + x] = T_WALL;
  }

  const bq = new Int32Array(w * h);
  const reachCount = () => {
    const seen = new Uint8Array(w * h);
    let n = 0, qe = 0;
    bq[qe++] = start.y * w + start.x; seen[bq[0]] = 1;
    while (n < qe) {
      const i = bq[n++], x = i % w, y = (i / w) | 0;
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const nx = x + dx, ny = y + dy, ni = ny * w + nx;
        if (wallAt(nx, ny) || seen[ni] || blocked[ni] || (nx === stairs.x && ny === stairs.y)) continue;
        seen[ni] = 1; bq[qe++] = ni;
      }
    }
    return qe;
  };
  let reach = reachCount();
  const used = new Set(), props = [], decor = [];
  const wallDir = (x, y) => [[1, 0], [-1, 0], [0, 1], [0, -1]].find(([dx, dy]) => wallAt(x + dx, y + dy)) || [0, 1];
  const edge = [];                                         // open tiles touching a wall: where loot and statues go
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    if (at(x, y) !== T_FLOOR || dist(x, y, start.x, start.y) < 6 || dist(x, y, cx, cy) < 8 || dist(x, y, gate.x, gate.y) < 4) continue;   // keep the door's front clear
    if ([[1, 0], [-1, 0], [0, 1], [0, -1]].some(([dx, dy]) => wallAt(x + dx, y + dy))) edge.push({ x, y });
  }
  rng.shuffle(edge);
  const claim = c => {                                     // a blocking object: never beside another, never cuts the floor
    const i = c.y * w + c.x;
    if (used.has(i)) return false;
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) if (blocked[(c.y + dy) * w + c.x + dx]) return false;
    blocked[i] = 1;
    if (reachCount() !== reach - 1) { blocked[i] = 0; return false; }
    reach--; used.add(i); return true;
  };
  const take = (list) => { for (let k = list.length - 1; k >= 0; k--) { const c = list[k]; if (claim(c)) { list.splice(k, 1); return c; } } return null; };
  const addProp = (kind, extra = {}, list = edge) => {
    const c = take(list); if (!c) return;
    const [dx, dy] = wallDir(c.x, c.y);
    props.push({ kind, x: c.x, y: c.y, opened: false, seed: seedOf(), yaw: Math.atan2(-dx, -dy), ...(kind === 'chest' ? { tier: weightedPick(rng, chestTierWeights(floorNum + 1)) } : {}), ...extra });
  };
  addProp('potions', { fixed: 'heal' }, edge.filter(c => dist(c.x, c.y, start.x, start.y) >= 14));   // the one guaranteed healing potion, far from the start
  for (const kind of ['chest', 'chest', 'chest', 'barrel', 'barrel', 'rubble', 'rubble']) addProp(kind);
  for (let i = 0; i < 4; i++) { const c = take(edge); if (!c) break; const [dx, dy] = wallDir(c.x, c.y); decor.push({ kind: 'statue', x: c.x, y: c.y, seed: seedOf(), edge: true, yaw: Math.atan2(-dx, -dy), scale: 2 }); }
  for (let i = 0; i < 8 && edge.length; i++) {             // banners hang on the walls and share their tile
    const c = edge[rng.int(0, edge.length - 1)], [dx, dy] = wallDir(c.x, c.y);
    decor.push({ kind: 'banner', x: c.x, y: c.y, seed: seedOf(), edge: true, yaw: Math.atan2(-dx, -dy), scale: 2.4 });
  }
  // huge iron chandeliers on long chains: one over the boss, a ring around it, and a few toward the start and the stairs
  const hang = (x, y) => decor.push({ kind: 'chandelier', x, y, seed: seedOf(), edge: false, yaw: 0, scale: 3 });
  hang(cx, cy);
  for (let i = 0; i < 6; i++) { const a = i * Math.PI / 3; hang(Math.round(cx + Math.cos(a) * 11), Math.round(cy + Math.sin(a) * 11)); }
  hang(cx, Math.round((cy + sy) / 2 + 3)); hang(cx, Math.round((cy + topY + 2) / 2 - 1));
  for (let i = 0; i < 6; i++) { const a = i * Math.PI / 3 + 0.3; decor.push({ kind: 'candles', x: Math.round(cx + Math.cos(a) * 5), y: Math.round(cy + Math.sin(a) * 5), seed: seedOf(), edge: false, yaw: rng() * 6.28 }); }
  for (let i = 0; i < 14; i++) {
    const x = rng.int(cx - 14, cx + 14), y = rng.int(cy - 14, cy + 14);
    if (at(x, y) === T_FLOOR && dist(x, y, start.x, start.y) > 4) decor.push({ kind: 'bones', x, y, seed: seedOf(), edge: false, yaw: rng() * 6.28 });
  }

  // wall torches around the rim and on the pillars (none on the hidden door)
  const spots = [];
  for (let y = 1; y < h - 1; y++) for (let x = 1; x < w - 1; x++) {
    if (wallAt(x, y) || at(x, y) === T_STAIRS) continue;
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) if (wallAt(x + dx, y + dy) && !(x + dx === door.x && y + dy === door.y)) spots.push({ x, y, dx, dy });
  }
  rng.shuffle(spots);
  const torches = [];
  for (const s of spots) { if (torches.length >= 60) break; if (torches.every(t => Math.hypot(t.x - s.x, t.y - s.y) >= 3)) torches.push(s); }

  // carve the safe room and its passage; the door stays T_DOOR (solid) until the boss dies. Furnished for a rest: a hearth, a bench,
  // candles, a rug and banners, plus two low wall torches (the light pool only ever lights the nearest four sources).
  for (let y = rT; y <= rB; y++) for (let x = rX0; x <= rX1; x++) tiles[y * w + x] = T_FLOOR;
  for (let y = rB + 1; y < door.y; y++) tiles[y * w + cx] = T_FLOOR;
  tiles[door.y * w + door.x] = T_DOOR; tiles[stairs.y * w + stairs.x] = T_STAIRS;
  const cosy = (kind, x, y, dx, dy, extra = {}) => decor.push({ kind, x, y, seed: seedOf(), edge: dx !== 0 || dy !== 0, yaw: dx || dy ? Math.atan2(-dx, -dy) : rng() * 6.28, ...extra });   // (dx, dy) = the wall it stands against
  cosy('hearth', cx - 2, rT, 0, -1); cosy('banner', cx + 2, rT, 0, -1); cosy('banner', cx - 3, rT, 0, -1);
  cosy('bench', rX1, rT + 4, 1, 0); cosy('banner', rX0, rT + 4, -1, 0);
  cosy('rug', cx, rB - 1, 0, 0, { yaw: 0 });
  for (const [x, y] of [[cx - 3, rT + 1], [cx + 3, rT + 1], [rX1 - 1, rT + 4], [cx + 2, rB]]) cosy('candles', x, y, 0, 0);
  torches.push({ x: rX0, y: rT + 2, dx: -1, dy: 0, low: true }, { x: rX1, y: rT + 2, dx: 1, dy: 0, low: true });
  const safe = { door, gate, open: false, rect: { x0: rX0, x1: rX1, y0: rT, y1: rB } };

  // the boss in the middle (asleep until you get close) and guards patrolling the rim
  const nearestOpen = (x, y) => {
    for (let r = 0; r <= 4; r++) for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) {
      const px = x + dx, py = y + dy;
      if (!wallAt(px, py) && !blocked[py * w + px] && at(px, py) === T_FLOOR) return { x: px, y: py };
    }
    return { x, y };
  };
  const rim = a => nearestOpen(Math.round(cx + Math.cos(a) * (edgeR(a) - 5)), Math.round(cy + Math.sin(a) * (edgeR(a) - 5)));
  const enemies = [{ x: cx, y: cy, route: [{ x: cx, y: cy }, { x: cx, y: cy }], seed: seedOf(), boss: true }];
  const a0 = rng() * 6.28;
  for (let i = 0; i < 7; i++) {
    const a = a0 + i * 2 * Math.PI / 7, A = rim(a), B = rim(a + 0.7);
    if (dist(A.x, A.y, start.x, start.y) < 10) continue;
    enemies.push({ x: A.x, y: A.y, route: [A, B], seed: seedOf() });
  }

  const room = { x: cx - 19, y: cy - 19, w: 39, h: 39, cx, cy, theme: 'arena', locked: false };
  return { w, h, tiles, blocked, rooms: [room], start, stairs, props, decor, doors: [], torches, enemies, boss: { x: cx, y: cy }, safe, steps: 0 };
}

function layoutFloor(seed, floorNum, opts) {
  const rng = makeRng(seed * 7919 + floorNum * 104729);
  const w = mapSizeFor(floorNum), h = w;
  const tiles = new Uint8Array(w * h);
  const blocked = new Uint8Array(w * h);        // furniture and prop tiles that guards must path around
  const at = (x, y) => tiles[y * w + x];
  const set = (x, y, v) => { tiles[y * w + x] = v; };
  const wallAt = (x, y) => x < 0 || y < 0 || x >= w || y >= h || at(x, y) === T_WALL;
  const pickWeighted = (items, weights) => { let r = rng() * weights.reduce((a, b) => a + b, 0); for (let i = 0; i < items.length; i++) { r -= weights[i]; if (r < 0) return items[i]; } return items[items.length - 1]; };

  // ---- rooms: separate rectangles with a 2 tile margin, some with an overlapping extension ----
  const rooms = [];
  const mk = (x, y, rw, rh) => ({ x, y, w: rw, h: rh, cx: x + (rw >> 1), cy: y + (rh >> 1), theme: 'generic', locked: false });
  const clash = (a, b) => a.x < b.x + b.w + 2 && a.x + a.w + 2 > b.x && a.y < b.y + b.h + 2 && a.y + a.h + 2 > b.y;
  const fits = r => r.x >= 2 && r.y >= 2 && r.x + r.w <= w - 2 && r.y + r.h <= h - 2 && !rooms.some(o => clash(r, o));
  const target = roomTargetFor(floorNum) + rng.int(0, 1);
  for (let tries = 0, made = 0; tries < 900 && made < target; tries++) {
    const r = mk(rng.int(2, w - 11), rng.int(2, h - 11), rng.int(4, 8), rng.int(4, 8));
    if (!fits(r)) continue;
    const group = [r];
    if (rng() < 0.3) {                           // L or T shape
      const ew = rng.int(4, 6), eh = rng.int(4, 6);
      const e = mk(rng() < 0.5 ? r.x + r.w - 2 : r.x - ew + 2, r.y + rng.int(-2, r.h - 2), ew, eh);
      if (fits(e)) group.push(e);
    }
    rooms.push(...group); made++;
  }
  for (const r of rooms)
    for (let y = r.y; y < r.y + r.h; y++) for (let x = r.x; x < r.x + r.w; x++) set(x, y, T_FLOOR);

  // ---- corridors: each room links to the next (one connected map), plus extra loops.
  // About a third are two tiles wide.
  const carve = (a, b) => {
    const wide = rng() < 0.3;
    let x = a.cx, y = a.cy;
    const open = (px, py) => { if (px > 0 && py > 0 && px < w - 1 && py < h - 1 && at(px, py) === T_WALL) set(px, py, T_FLOOR); };
    const hLine = tx => { while (x !== tx) { x += Math.sign(tx - x); open(x, y); if (wide) open(x, y + 1); } };
    const vLine = ty => { while (y !== ty) { y += Math.sign(ty - y); open(x, y); if (wide) open(x + 1, y); } };
    if (rng() < 0.5) { hLine(b.cx); vLine(b.cy); } else { vLine(b.cy); hLine(b.cx); }
  };
  // Rooms are linked by a minimum spanning tree over their centres (every room joins its nearest neighbour, so corridors are
  // short and do not criss-cross the map), then one or two short loops so there is more than one way round.
  const gap = (p, q) => Math.abs(p.cx - q.cx) + Math.abs(p.cy - q.cy);
  const joined = [rooms[0]], rest = rooms.slice(1), edges = new Set();
  while (rest.length) {
    let best = null;
    for (const t of joined) for (const r of rest) { const d = gap(t, r); if (!best || d < best.d) best = { t, r, d }; }
    carve(best.t, best.r); edges.add(rooms.indexOf(best.t) + ',' + rooms.indexOf(best.r));
    joined.push(best.r); rest.splice(rest.indexOf(best.r), 1);
  }
  const loops = [];
  for (let i = 0; i < rooms.length; i++) for (let k = i + 1; k < rooms.length; k++) if (!edges.has(i + ',' + k) && !edges.has(k + ',' + i)) loops.push({ a: rooms[i], b: rooms[k], d: gap(rooms[i], rooms[k]) });
  loops.sort((p, q) => p.d - q.d);
  for (const l of loops.slice(0, floorNum >= 2 ? 2 : 1)) if (l.d <= 16) carve(l.a, l.b);

  // ---- start in room 0, stairs in the room farthest from it by walking distance ----
  const start = { x: rooms[0].cx, y: rooms[0].cy };
  const dist = new Int32Array(w * h).fill(-1);
  const queue = [start.y * w + start.x];
  dist[queue[0]] = 0;
  for (let qi = 0; qi < queue.length; qi++) {
    const i = queue[qi], x = i % w, y = (i / w) | 0;
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const nx = x + dx, ny = y + dy, ni = ny * w + nx;
      if (wallAt(nx, ny) || dist[ni] >= 0) continue;
      dist[ni] = dist[i] + 1;
      queue.push(ni);
    }
  }
  let far = rooms[0];
  for (const r of rooms) if (dist[r.cy * w + r.cx] > dist[far.cy * w + far.cx]) far = r;
  const stairs = { x: far.cx, y: far.cy };
  set(start.x, start.y, T_START);
  set(stairs.x, stairs.y, T_STAIRS);

  // ---- room types for the ordinary rooms (big rooms suit halls and barracks) ----
  rooms.forEach((r, i) => {
    if (i === 0) { r.theme = 'generic'; return; }
    const big = r.w * r.h >= 36;
    const names = ['generic', 'barracks', 'messhall', 'brewery', 'library', 'storeroom', 'shrine'];
    r.theme = pickWeighted(names, big ? [2, 3, 3, 1.5, 2, 1.5, 1] : [3, 1, 0.3, 2, 2, 2, 1.5]);
  });

  // ---- the shop: a mid-size ordinary room that is neither the start nor the stairs room (opts.shop) ----
  let shopRoom = null;
  if (opts.shop) {
    const cands = rooms.filter((r, i) => i > 0 && r !== far && r.w * r.h >= 16 && r.w * r.h <= 60);
    if (cands.length) { shopRoom = rng.pick(cands); shopRoom.theme = 'shop'; }
  }

  // ---- pillars: in big rooms, every other tile, never beside a room centre (start, stairs and
  // guard waypoints live there) and only where all 8 neighbours are open, so they can never
  // block a path. They block movement and sight, which makes cover.
  const nearCentre = (x, y) => rooms.some(r => Math.abs(x - r.cx) <= 1 && Math.abs(y - r.cy) <= 1);
  const open8 = (x, y) => { for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) if (wallAt(x + dx, y + dy)) return false; return true; };
  for (const r of rooms) {
    if (r.w < 7 || r.h < 7) continue;
    for (let y = r.y + 2; y <= r.y + r.h - 3; y += 2) for (let x = r.x + 2; x <= r.x + r.w - 3; x += 2)
      if (!nearCentre(x, y) && open8(x, y) && rng() < 0.75) set(x, y, T_WALL);
  }

  // ---- locked rooms: carved into solid rock, joined to the map by a short corridor with a locked
  // door at the vault end. Nothing else connects to them, so the key is the only way in.
  const doors = [];
  const placeLocked = (type, lock, maxTries = 700, avoid = null) => {
    const spec = LOCKED_ROOMS[type];
    for (let tries = 0; tries < maxTries; tries++) {
      const rw = spec.w, rh = spec.h;
      const x = rng.int(3, w - rw - 4), y = rng.int(3, h - rh - 4);
      let clear = true;                                   // the room plus a 1 tile ring must be solid rock
      for (let yy = y - 1; yy <= y + rh && clear; yy++) for (let xx = x - 1; xx <= x + rw; xx++) if (!wallAt(xx, yy)) { clear = false; break; }
      if (!clear) continue;
      const sides = rng.shuffle([
        { dx: -1, dy: 0, ex: x, ey: y + rng.int(1, rh - 2) }, { dx: 1, dy: 0, ex: x + rw - 1, ey: y + rng.int(1, rh - 2) },
        { dx: 0, dy: -1, ex: x + rng.int(1, rw - 2), ey: y }, { dx: 0, dy: 1, ex: x + rng.int(1, rw - 2), ey: y + rh - 1 },
      ]);
      for (const s of sides) {
        // walk outward from the room edge through rock until we meet existing floor
        let k = 1;
        while (k <= 12 && wallAt(s.ex + s.dx * k, s.ey + s.dy * k) && s.ex + s.dx * k > 1 && s.ex + s.dx * k < w - 2 && s.ey + s.dy * k > 1 && s.ey + s.dy * k < h - 2) k++;
        if (k < 2 || k > 12 || wallAt(s.ex + s.dx * k, s.ey + s.dy * k) || at(s.ex + s.dx * k, s.ey + s.dy * k) === T_DOOR) continue;
        const hx = s.ex + s.dx * k, hy = s.ey + s.dy * k;   // never join one locked room to another
        if (rooms.some(o => o.locked && hx >= o.x && hx < o.x + o.w && hy >= o.y && hy < o.y + o.h)) continue;
        if (avoid && avoid(hx, hy)) continue;             // the join tile must be open, reachable floor (late placement: furniture is already down)
        let clean = true;                                 // keep the corridor from touching other floor beside it
        for (let i = 2; i < k && clean; i++) {
          const cx = s.ex + s.dx * i, cy = s.ey + s.dy * i;
          if (!wallAt(cx + s.dy, cy + s.dx) || !wallAt(cx - s.dy, cy - s.dx)) clean = false;
        }
        if (!clean) continue;
        for (let yy = y; yy < y + rh; yy++) for (let xx = x; xx < x + rw; xx++) set(xx, yy, T_FLOOR);
        for (let i = 2; i < k; i++) set(s.ex + s.dx * i, s.ey + s.dy * i, T_FLOOR);
        const dx = s.ex + s.dx, dy = s.ey + s.dy;
        set(dx, dy, T_DOOR);
        const room = mk(x, y, rw, rh);
        room.theme = spec.theme; room.locked = true; room.lock = lock; room.entry = { x: s.ex, y: s.ey }; room.join = { x: hx, y: hy };   // join: the open floor tile outside the corridor
        rooms.push(room);
        doors.push({ x: dx, y: dy, axis: s.dx !== 0 ? 'x' : 'z', lock, room: spec.name, keyLabel: spec.key });
        return room;
      }
    }
    return null;
  };
  const wanted = [];
  const other = () => rng() < 0.5 ? 'vault' : 'brewery';
  if (opts.armory) { wanted.push('armory'); if (rng() < 0.5) wanted.push(other()); }
  else { const a = other(); wanted.push(a); if (rng() < 0.35) wanted.push(a === 'vault' ? 'brewery' : 'vault'); }
  wanted.forEach((type, i) => placeLocked(type, i + 1));

  // ---- furnish: loot props, themed furniture and decals. Every blocking object must leave the rest
  // of the floor connected (guards path around them and cannot cross the stairwell or a locked door),
  // so a table can never plug a corridor that runs along a wall.
  const open4 = (x, y) => [[1, 0], [-1, 0], [0, 1], [0, -1]].filter(([dx, dy]) => !wallAt(x + dx, y + dy)).length;
  const bq = new Int32Array(w * h);
  const reachCount = () => {
    const seen = new Uint8Array(w * h);
    let n = 0, qe = 0;
    bq[qe++] = start.y * w + start.x; seen[bq[0]] = 1;
    while (n < qe) {
      const i = bq[n++], x = i % w, y = (i / w) | 0;
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const nx = x + dx, ny = y + dy, ni = ny * w + nx;
        if (wallAt(nx, ny) || seen[ni] || blocked[ni] || at(nx, ny) === T_DOOR || (nx === stairs.x && ny === stairs.y)) continue;
        seen[ni] = 1; bq[qe++] = ni;
      }
    }
    return qe;
  };
  let reach = reachCount();
  const props = [], decor = [], used = new Set(), decalUsed = new Set();
  const wallDir = (x, y) => [[1, 0], [-1, 0], [0, 1], [0, -1]].find(([dx, dy]) => wallAt(x + dx, y + dy)) || [0, 1];
  const seedOf = () => (rng() * 4294967296) >>> 0;

  const furnish = r => {
    const spec = ROOM_THEMES[r.theme];
    const isStart = r === rooms[0];                       // the start room gets furniture but no loot
    const checked = !r.locked;                            // locked rooms are not reachable from the start, so no check
    if (r.entry) used.add(r.entry.y * w + r.entry.x);     // keep the doorway clear
    const edge = [], inner = [], any = [];
    for (let y = r.y; y < r.y + r.h; y++) for (let x = r.x; x < r.x + r.w; x++) {
      const i = y * w + x;
      if (at(x, y) !== T_FLOOR) continue;
      any.push({ x, y });
      if (used.has(i) || nearCentre(x, y)) continue;
      const onEdge = x === r.x || y === r.y || x === r.x + r.w - 1 || y === r.y + r.h - 1;
      if (onEdge && open4(x, y) <= 3) edge.push({ x, y }); else if (!onEdge) inner.push({ x, y });
    }
    rng.shuffle(edge); rng.shuffle(inner); rng.shuffle(any);
    // claim a tile: blocking things must keep the floor connected
    const claim = (c, blocks) => {
      const i = c.y * w + c.x;
      if (used.has(i)) return false;
      if (blocks) {
        blocked[i] = 1;
        if (checked) { if (reachCount() !== reach - 1) { blocked[i] = 0; return false; } reach--; }
      }
      used.add(i); return true;
    };
    const take = (list, blocks) => { while (list.length) { const c = list.pop(); if (claim(c, blocks)) return c; } return null; };
    const addProp = (kind, extra = {}) => {
      const c = take(edge.length ? edge : inner, true); if (!c) return;
      const [dx, dy] = wallDir(c.x, c.y);
      props.push({ kind, x: c.x, y: c.y, opened: false, seed: seedOf(), yaw: Math.atan2(-dx, -dy), ...(kind === 'chest' ? { tier: pickWeighted([0, 1, 2, 3, 4], chestTierWeights(floorNum)) } : {}), ...extra });
    };
    const addDecor = (kind, list) => {
      if (DECALS.has(kind)) {
        let c = null;
        if (kind === 'banner') c = [...edge].reverse().find(t => !decalUsed.has(t.y * w + t.x)) || null;   // wall decal: shares an edge tile
        else { while (any.length && !c) { const t = any.pop(); if (!decalUsed.has(t.y * w + t.x)) c = t; } }
        if (!c) return;
        decalUsed.add(c.y * w + c.x);
        const [dx, dy] = wallDir(c.x, c.y);
        decor.push({ kind, x: c.x, y: c.y, seed: seedOf(), edge: kind === 'banner', yaw: kind === 'banner' ? Math.atan2(-dx, -dy) : rng() * 6.28 });
        return;
      }
      const c = take(list, BLOCKING_DECOR.has(kind)); if (!c) return;
      const [dx, dy] = list === edge ? wallDir(c.x, c.y) : [0, 0];
      decor.push({ kind, x: c.x, y: c.y, seed: seedOf(), edge: list === edge, yaw: list === edge ? Math.atan2(-dx, -dy) : rng.int(0, 3) * Math.PI / 2 });
    };
    if (!isStart) for (const [kind, lo, hi] of spec.special || []) for (let i = rng.int(lo, hi); i > 0; i--) addProp(kind);
    for (let i = rng.int(spec.props[0], spec.props[1]); i > 0 && !isStart; i--) {
      const roll = rng();
      addProp(roll < 0.35 ? 'chest' : roll < 0.7 ? 'barrel' : 'rubble');
    }
    for (const [kind, lo, hi] of spec.inner) for (let i = rng.int(lo, hi); i > 0; i--) addDecor(kind, inner);
    for (const [kind, lo, hi] of spec.edge) for (let i = rng.int(lo, hi); i > 0; i--) addDecor(kind, edge);
    for (const [kind, lo, hi] of spec.floor) for (let i = rng.int(lo, hi); i > 0; i--) addDecor(kind, inner);
  };
  rooms.forEach(furnish);

  // ---- the shop's counter near the middle of its room, with the merchant standing behind it ----
  let shop = null;
  if (shopRoom) {
    const r = shopRoom, cand = [];
    for (let y = r.y + 1; y < r.y + r.h - 1; y++) for (let x = r.x + 1; x < r.x + r.w - 1; x++) cand.push({ x, y });
    cand.sort((a, b) => (Math.abs(a.x - r.cx) + Math.abs(a.y - r.cy)) - (Math.abs(b.x - r.cx) + Math.abs(b.y - r.cy)));
    for (const c of cand) {
      const i = c.y * w + c.x;
      if (at(c.x, c.y) !== T_FLOOR || blocked[i] || used.has(i)) continue;
      const nb = [[0, -1], [0, 1], [-1, 0], [1, 0]].map(([dx, dy]) => ({ x: c.x + dx, y: c.y + dy, dx, dy }))
        .find(n => at(n.x, n.y) === T_FLOOR && !blocked[n.y * w + n.x] && !used.has(n.y * w + n.x));
      if (!nb) continue;
      const j = nb.y * w + nb.x;
      blocked[i] = 1; blocked[j] = 1;
      if (reachCount() !== reach - 2) { blocked[i] = 0; blocked[j] = 0; continue; }   // never cut the floor in two
      reach -= 2; used.add(i); used.add(j);
      decor.push({ kind: 'counter', x: c.x, y: c.y, seed: seedOf(), edge: false, yaw: Math.atan2(-nb.dx, -nb.dy) });
      shop = { room: { x: r.x, y: r.y, w: r.w, h: r.h }, counter: { x: c.x, y: c.y }, merchant: { x: nb.x, y: nb.y, yaw: Math.atan2(nb.dx, nb.dy) }, seed: seedOf() };
      break;
    }
  }

  // ---- each theme's gimmick, as flat floor decals with no collision (the Library's hush is a rule, not a decal) ----
  const gim = THEME_GIMMICK[opts.themeName];
  if (gim) {
    const where = rooms.filter(r => !r.locked && r.theme !== 'shop'), taken = new Set();
    for (let i = rng.int(gim.n[0], gim.n[1]), tries = 0; i > 0 && tries < 120; tries++) {
      const r = rng.pick(where), x = rng.int(r.x, r.x + r.w - 1), y = rng.int(r.y, r.y + r.h - 1), k = y * w + x;
      if (at(x, y) !== T_FLOOR || blocked[k] || taken.has(k) || (x === start.x && y === start.y)) continue;
      taken.add(k); i--;
      decor.push({ kind: gim.kind, x, y, seed: seedOf(), edge: false, yaw: rng() * 6.28 });
    }
  }

  // ---- ceiling decor (no collision): a chandelier over the centre of most rooms (always in halls, libraries,
  // shrines and rich locked rooms), a couple more in big rooms, and wooden beams across rooms of 6+ tiles ----
  const always = new Set(['barracks', 'messhall', 'library', 'shrine', 'armory', 'vault', 'shop']);
  for (const r of rooms) {
    if (r.w * r.h < 20) continue;
    if (always.has(r.theme) || rng() < 0.5) decor.push({ kind: 'chandelier', x: r.cx, y: r.cy, seed: seedOf(), edge: false, yaw: 0 });
    if (r.w * r.h >= 64) for (const [ox, oy] of [[-3, 0], [3, 0], [0, -3], [0, 3]])
      if (rng() < 0.4 && at(r.cx + ox, r.cy + oy) === T_FLOOR && r.cx + ox >= r.x && r.cx + ox < r.x + r.w && r.cy + oy >= r.y && r.cy + oy < r.y + r.h)
        decor.push({ kind: 'chandelier', x: r.cx + ox, y: r.cy + oy, seed: seedOf(), edge: false, yaw: 0 });
    if (r.w >= 6 && r.theme !== 'vault') for (let k = 1; k <= Math.floor(r.h / 3); k++)
      decor.push({ kind: 'beam', x: r.cx, y: r.y + k * 3 - 1, seed: seedOf(), edge: false, yaw: 0, len: (r.w - 0.3) * TILE });
  }

  // ---- each locked room's key sits in a chest elsewhere on the floor (a chest is made from a
  // barrel if the floor has too few) ----
  const keyHolders = props.filter(p => {
    const r = rooms.find(r => p.x >= r.x && p.x < r.x + r.w && p.y >= r.y && p.y < r.y + r.h && !r.locked);
    return r && !r.locked && p.kind !== 'rack' && p.kind !== 'vaultchest' && p.kind !== 'potions' && p.kind !== 'pantry';
  });
  rng.shuffle(keyHolders);
  keyHolders.sort((a, b) => (a.kind === 'chest' ? 0 : 1) - (b.kind === 'chest' ? 0 : 1));
  for (const d of doors) {
    const holder = keyHolders.shift();
    if (!holder) break;
    holder.kind = 'chest'; if (holder.tier === undefined) holder.tier = pickWeighted([0, 1, 2], chestTierWeights(floorNum).slice(0, 3));
    holder.extra = [{ type: 'key', lock: d.lock, label: d.keyLabel }];
    holder.holdsKey = true;
  }

  // ---- wall torches: spaced out, on wall faces next to open floor ----
  const spots = [];
  for (let y = 1; y < h - 1; y++) for (let x = 1; x < w - 1; x++) {
    if (wallAt(x, y) || at(x, y) === T_STAIRS || at(x, y) === T_DOOR) continue;
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) if (wallAt(x + dx, y + dy)) spots.push({ x, y, dx, dy });
  }
  rng.shuffle(spots);
  const torches = [];
  for (const s of spots) {
    if (torches.length >= 60) break;
    if (torches.every(t => Math.hypot(t.x - s.x, t.y - s.y) >= 2.5)) torches.push(s);
  }
  for (const r of rooms) {   // locked rooms are always well lit, so the loot reads from the doorway
    if (!r.locked) continue;
    let n = torches.filter(t => t.x >= r.x && t.x < r.x + r.w && t.y >= r.y && t.y < r.y + r.h).length;
    for (const s of spots) {
      if (n >= 3) break;
      if (s.x < r.x || s.x >= r.x + r.w || s.y < r.y || s.y >= r.y + r.h) continue;
      if (torches.every(t => Math.hypot(t.x - s.x, t.y - s.y) >= 3)) { torches.push(s); n++; }
    }
  }

  // ---- guards: 6 + 2 per floor, spread over the unlocked rooms (barracks hold more). Each patrols
  // between two room waypoints beside room centres, so none sit on the stairwell.
  const f = { w, h, tiles, blocked };
  const pool = rooms.filter((r, i) => i > 0 && !r.locked && r.theme !== 'shop');   // no guards live in the shop
  const enemies = [], perRoom = new Map();
  const inShop = p => !!shopRoom && p.x >= shopRoom.x && p.x < shopRoom.x + shopRoom.w && p.y >= shopRoom.y && p.y < shopRoom.y + shopRoom.h;
  for (let i = 0; i < 6 + 2 * floorNum; i++) {
    let a, b;
    for (let tries = 0; tries < 12; tries++) {                    // re-pick when a waypoint falls inside the shop (rooms can overlap)
      const home = pickWeighted(pool, pool.map(r => r.theme === 'barracks' ? 2.5 : 1));
      const k = perRoom.get(home) || 0; perRoom.set(home, k + 1);
      let dest = rng.pick(rooms.filter(r => !r.locked && r.theme !== 'shop'));        // and none patrol into it
      if (dest === home) dest = rooms[0];
      a = roomPoint(f, home, k); b = roomPoint(f, dest, k + 3);
      if (!inShop(a) && !inShop(b)) break;
    }
    enemies.push({ x: a.x, y: a.y, route: [a, b], seed: seedOf() });
  }

  // ---- mimics: drawn last so nothing else on the floor shifts. A flagged chest is built as a mimic enemy in main.js ----
  if (floorNum >= 2) for (const p of props) {
    if (p.kind !== 'chest' || p.holdsKey || inShop(p)) continue;
    const r = rooms.find(r => p.x >= r.x && p.x < r.x + r.w && p.y >= r.y && p.y < r.y + r.h);
    if (r && !r.locked && rng() < MIMIC_CHANCE) p.mimic = true;
  }
  // ---- locked and trapped chests: one more roll per eligible chest, after the mimic pass so nothing earlier shifts (the roll is
  // always drawn, even for a mimic, so each chest costs the same). The trap kind comes from the chest's own seed. ----
  for (const p of props) {
    if (p.kind !== 'chest' || p.holdsKey || inShop(p)) continue;
    const r = rooms.find(r => p.x >= r.x && p.x < r.x + r.w && p.y >= r.y && p.y < r.y + r.h);
    const roll = rng();
    if (!r || r.locked || p.mimic) continue;
    if (roll < CHEST_ODDS.locked) p.locked = true;
    else if (floorNum >= 2 && roll < CHEST_ODDS.locked + CHEST_ODDS.trap) p.trap = ['dart', 'gas', 'alarm'][Math.floor(makeRng((p.seed ^ 0x7a9) >>> 0)() * 3)];
  }

  // ---- encounters (js/quests.js picks the floor and the type): drawn last, so floors without one are identical to before.
  // miniboss: one more locked room (the lair) whose key goes into an ordinary chest. shrine: one of the shrine rooms' altars. ----
  let quest = null;
  // late placement of a locked room (lair, cell): the join tile must be open floor reachable from the start without keys, with nothing on it
  const lateAvoid = () => {
    const seen = new Uint8Array(w * h), fq = [start.y * w + start.x];   // floor reachable from the start without keys
    seen[fq[0]] = 1;
    for (let n = 0; n < fq.length; n++) for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const nx = fq[n] % w + dx, ny = ((fq[n] / w) | 0) + dy, ni = ny * w + nx;
      if (!wallAt(nx, ny) && !seen[ni] && !blocked[ni] && at(nx, ny) !== T_DOOR && !(nx === stairs.x && ny === stairs.y)) { seen[ni] = 1; fq.push(ni); }
    }
    return (x, y) => at(x, y) !== T_FLOOR || !seen[y * w + x] || blocked[y * w + x] || used.has(y * w + x) || props.some(p => p.x === x && p.y === y);
  };
  if (opts.quest === 'miniboss') {
    const holder = rng.shuffle(props.filter(p => (p.kind === 'chest' || p.kind === 'barrel' || p.kind === 'rubble') && !p.holdsKey && !p.mimic && !p.locked && !p.trap && !inShop(p) && !rooms.some(r => r.locked && p.x >= r.x && p.x < r.x + r.w && p.y >= r.y && p.y < r.y + r.h)))
      .sort((p, q) => (p.kind === 'chest' ? 0 : 1) - (q.kind === 'chest' ? 0 : 1))[0];   // a chest, or a barrel or rubble pile turned into one
    const avoid = lateAvoid();
    const room = holder && placeLocked('lair', wanted.length + 1, 6000, avoid);   // lock ids 1..wanted.length are taken by the planned locked rooms, even ones that failed to place
    if (room) {
      holder.kind = 'chest'; if (holder.tier === undefined) holder.tier = pickWeighted([0, 1, 2], chestTierWeights(floorNum).slice(0, 3));
      holder.extra = [...(holder.extra || []), { type: 'key', lock: room.lock, label: LOCKED_ROOMS.lair.key }]; holder.holdsKey = true;
      const lit = [];
      for (let y = room.y; y < room.y + room.h; y++) for (let x = room.x; x < room.x + room.w; x++)
        for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) if (wallAt(x + dx, y + dy)) lit.push({ x, y, dx, dy });
      rng.shuffle(lit);
      for (let n = 0, i = 0; n < 3 && i < lit.length; i++) if (torches.every(t => Math.hypot(t.x - lit[i].x, t.y - lit[i].y) >= 3)) { torches.push(lit[i]); n++; }
      decor.push({ kind: 'rug', x: room.cx, y: room.cy, seed: seedOf(), edge: false, yaw: 0 });
      for (const [x, y] of [[room.x + 1, room.y + 1], [room.x + room.w - 2, room.y + room.h - 2]]) decor.push({ kind: 'bones', x, y, seed: seedOf(), edge: false, yaw: rng() * 6.28 });
      quest = { type: 'miniboss', lock: room.lock, route: [{ x: room.cx - 2, y: room.cy }, { x: room.cx + 2, y: room.cy }], seed: seedOf() };
    }
  } else if (opts.quest === 'shrine') {
    let altar = rng.shuffle(decor.filter(d => d.kind === 'altar'))[0];
    if (!altar) {                                         // no shrine room on this floor: set an altar in the biggest ordinary room that has a spare inner tile (the floor must stay connected)
      for (const r of rooms.filter((r, i) => i > 0 && !r.locked && r.theme !== 'shop' && r.w * r.h >= 20).sort((a, b) => b.w * b.h - a.w * a.h)) {
        const spots = [];
        for (let y = r.y + 1; y < r.y + r.h - 1; y++) for (let x = r.x + 1; x < r.x + r.w - 1; x++) if (at(x, y) === T_FLOOR && !blocked[y * w + x] && !used.has(y * w + x) && !nearCentre(x, y)) spots.push({ x, y });
        for (const c of rng.shuffle(spots)) {
          blocked[c.y * w + c.x] = 1;
          if (reachCount() !== reach - 1) { blocked[c.y * w + c.x] = 0; continue; }
          reach--; used.add(c.y * w + c.x);
          altar = { kind: 'altar', x: c.x, y: c.y, seed: seedOf(), edge: false, yaw: rng.int(0, 3) * Math.PI / 2 };
          decor.push(altar); break;
        }
        if (altar) break;
      }
    }
    if (altar) quest = { type: 'shrine', altar: { x: altar.x, y: altar.y }, seed: seedOf() };
  } else if (opts.quest === 'wanted') {
    // the quest-giver stands on an inner tile of the start room (a blocked tile, so the floor must stay connected); the target patrols another ordinary room
    const homes = rooms.filter((r, i) => i > 0 && !r.locked && r.theme !== 'shop' && r.theme !== 'lair'), home = homes.length ? rng.pick(homes) : null;
    const r0 = rooms[0], inner = [], edge = [];
    for (let y = r0.y; y < r0.y + r0.h; y++) for (let x = r0.x; x < r0.x + r0.w; x++) {
      if (at(x, y) !== T_FLOOR || blocked[y * w + x] || used.has(y * w + x) || nearCentre(x, y) || Math.hypot(x - start.x, y - start.y) < 2) continue;
      (x > r0.x && y > r0.y && x < r0.x + r0.w - 1 && y < r0.y + r0.h - 1 ? inner : edge).push({ x, y });
    }
    let npc = null;
    for (const c of [...rng.shuffle(inner), ...rng.shuffle(edge)]) {
      blocked[c.y * w + c.x] = 1;
      if (reachCount() !== reach - 1) { blocked[c.y * w + c.x] = 0; continue; }
      reach--; used.add(c.y * w + c.x); npc = c; break;
    }
    if (home && npc) quest = { type: 'wanted', npc, route: [roomPoint(f, home, 1), roomPoint(f, home, 5)], room: home.theme, seed: seedOf() };
    else if (npc) { blocked[npc.y * w + npc.x] = 0; used.delete(npc.y * w + npc.x); }   // no room for the target: leave the floor as it was
  } else if (opts.quest === 'thief') {
    // a sack thief that wanders between two ordinary rooms
    const homes = rooms.filter((r, i) => i > 0 && !r.locked && r.theme !== 'shop' && r.theme !== 'lair');
    if (homes.length >= 2) {
      const a = rng.pick(homes), b = rng.pick(homes.filter(r => r !== a));
      quest = { type: 'thief', route: [roomPoint(f, a, 2), roomPoint(f, b, 6)], seed: seedOf() };
    }
  } else if (opts.quest === 'prisoner') {
    // a small locked cell (placed last, like the lair) holding the captive, on the tile farthest from its door. One extra guard patrols
    // between the cell's approach and the nearest ordinary room. quest.holder: a chest that takes the cell key if no other guard can carry it (quests.js).
    const holder = rng.shuffle(props.filter(p => p.kind === 'chest' && !p.holdsKey && !p.mimic && !p.locked && !p.trap && !inShop(p) && !rooms.some(r => r.locked && p.x >= r.x && p.x < r.x + r.w && p.y >= r.y && p.y < r.y + r.h)))[0];
    const room = placeLocked('cell', wanted.length + 1, 6000, lateAvoid());
    if (room) {
      const e = room.entry, door = doors[doors.length - 1], jn = room.join;
      let npc = { x: room.cx, y: room.cy }, far = -1;
      for (let y = room.y; y < room.y + room.h; y++) for (let x = room.x; x < room.x + room.w; x++) { const d = Math.hypot(x - e.x, y - e.y); if (d > far) { far = d; npc = { x, y }; } }
      const lit = [];
      for (let y = room.y; y < room.y + room.h; y++) for (let x = room.x; x < room.x + room.w; x++)
        for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) if (wallAt(x + dx, y + dy) && at(x + dx, y + dy) !== T_DOOR) lit.push({ x, y, dx, dy });
      rng.shuffle(lit);
      for (let i = 0; i < lit.length; i++) if (torches.every(t => Math.hypot(t.x - lit[i].x, t.y - lit[i].y) >= 3)) { torches.push(lit[i]); break; }   // one wall torch (the light pool is unchanged)
      for (const [x, y] of [[room.x, room.y], [room.x + room.w - 1, room.y + room.h - 1]]) if (x !== npc.x || y !== npc.y) decor.push({ kind: 'bones', x, y, seed: seedOf(), edge: false, yaw: rng() * 6.28 });
      const near = rooms.filter(r => !r.locked && r.theme !== 'shop').sort((a, b) => Math.hypot(a.cx - jn.x, a.cy - jn.y) - Math.hypot(b.cx - jn.x, b.cy - jn.y))[0];
      enemies.push({ x: jn.x, y: jn.y, route: [jn, roomPoint(f, near, 3)], seed: seedOf(), qguard: true });
      quest = { type: 'prisoner', lock: room.lock, npc, door: { x: door.x, y: door.y }, holder: holder ? { x: holder.x, y: holder.y } : null, seed: seedOf() };
    }
  }

  return { w, h, tiles, blocked, rooms, start, stairs, props, decor, doors, torches, enemies, shop, quest, steps: dist[stairs.y * w + stairs.x] };
}
