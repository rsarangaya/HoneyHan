// Seeded RNG, themes, and the room-and-corridor floor generator.
const T_WALL = 0, T_FLOOR = 1, T_STAIRS = 2, T_START = 3, T_DOOR = 4;   // T_DOOR: a locked door, solid until unlocked

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

const MAP_W = 45, MAP_H = 45;

// What each room type is furnished with: [kind, min, max] per group.
//   edge: against a wall. inner: in the room's interior. floor: flat or small decals.
//   special: lootable props that define the room (always placed).
//   props: [min, max] ordinary loot props (chest, barrel, rubble).
const ROOM_THEMES = {
  generic:   { edge: [['crates', 0, 2], ['barrels', 0, 2], ['table', 0, 1], ['sacks', 0, 1]], inner: [], floor: [['bones', 0, 2], ['rug', 0, 1], ['candles', 0, 1]], props: [1, 3] },
  barracks:  { edge: [['bed', 3, 5], ['weaponrack', 1, 1], ['barrels', 0, 1], ['banner', 1, 2]], inner: [['table', 0, 1]], floor: [['bones', 0, 1], ['rug', 0, 1], ['candles', 0, 1]], props: [1, 2] },
  messhall:  { edge: [['hearth', 1, 1], ['barrels', 1, 2], ['sacks', 1, 2]], inner: [['table', 2, 3]], floor: [['bones', 1, 3], ['candles', 1, 2]], props: [1, 2] },
  brewery:   { edge: [['cauldron', 1, 1], ['bookshelf', 1, 2], ['barrels', 1, 1]], inner: [], floor: [['rug', 0, 1], ['candles', 1, 2], ['bones', 0, 1]], props: [0, 0], special: [['potions', 1, 3]] },
  library:   { edge: [['bookshelf', 4, 7], ['banner', 0, 1]], inner: [['table', 1, 2]], floor: [['rug', 1, 1], ['candles', 1, 2]], props: [1, 2] },
  storeroom: { edge: [['crates', 2, 4], ['barrels', 2, 3], ['sacks', 1, 2]], inner: [['crates', 0, 1]], floor: [['bones', 0, 1]], props: [2, 3] },
  shrine:    { edge: [['statue', 1, 3], ['banner', 2, 4]], inner: [['altar', 1, 1]], floor: [['rug', 1, 1], ['candles', 2, 4]], props: [1, 2] },
  // locked rooms, opened with a key found elsewhere on the floor
  armory:    { edge: [['banner', 2, 3], ['weaponrack', 1, 1]], inner: [['table', 1, 1]], floor: [['candles', 1, 2], ['rug', 0, 1]], props: [0, 0], special: [['rack', 1, 3]] },
  vault:     { edge: [['banner', 1, 2], ['statue', 1, 2]], inner: [], floor: [['rug', 1, 1], ['candles', 1, 2]], props: [0, 0], special: [['vaultchest', 2, 3]] },
  lockedbrew:{ edge: [['cauldron', 1, 1], ['bookshelf', 1, 2], ['barrels', 1, 1]], inner: [], floor: [['rug', 1, 1], ['candles', 1, 2]], props: [0, 0], special: [['potions', 1, 3]] },
};
const BLOCKING_DECOR = new Set(['bed', 'bookshelf', 'barrels', 'crates', 'table', 'hearth', 'cauldron', 'altar']);   // guards path around these
const DECALS = new Set(['rug', 'bones', 'candles', 'banner']);                                                     // never fill a tile alone
const LOCKED_ROOMS = {
  armory:     { w: 7, h: 6, theme: 'armory',     name: 'armory',  key: 'Armory Key' },
  vault:      { w: 5, h: 5, theme: 'vault',      name: 'vault',   key: 'Vault Key' },
  brewery:    { w: 6, h: 5, theme: 'lockedbrew', name: 'brewery', key: 'Brewery Key' },
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

// opts.armory: this floor must contain the armory (retries with new layouts until it fits).
function generateFloor(seed, floorNum, opts = {}) {
  let f;
  for (let attempt = 0; attempt < 8; attempt++) {
    f = layoutFloor(seed + attempt * 7777, floorNum, opts);
    if (!opts.armory || f.rooms.some(r => r.theme === 'armory')) break;
  }
  return f;
}

function layoutFloor(seed, floorNum, opts) {
  const rng = makeRng(seed * 7919 + floorNum * 104729);
  const w = MAP_W, h = MAP_H;
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
  const target = rng.int(9, 12);
  for (let tries = 0, made = 0; tries < 900 && made < target; tries++) {
    const r = mk(rng.int(2, w - 12), rng.int(2, h - 12), rng.int(4, 10), rng.int(4, 10));
    if (!fits(r)) continue;
    const group = [r];
    if (rng() < 0.35) {                          // L or T shape
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
  for (let i = 1; i < rooms.length; i++) carve(rooms[i - 1], rooms[i]);
  for (let i = 0; i < 4; i++) {
    const a = rng.pick(rooms), b = rng.pick(rooms);
    if (a !== b) carve(a, b);
  }

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
  const placeLocked = (type, lock) => {
    const spec = LOCKED_ROOMS[type];
    for (let tries = 0; tries < 700; tries++) {
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
        room.theme = spec.theme; room.locked = true; room.lock = lock; room.entry = { x: s.ex, y: s.ey };
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
      props.push({ kind, x: c.x, y: c.y, opened: false, seed: seedOf(), yaw: Math.atan2(-dx, -dy), ...extra });
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

  // ---- each locked room's key sits in a chest elsewhere on the floor (a chest is made from a
  // barrel if the floor has too few) ----
  const keyHolders = props.filter(p => {
    const r = rooms.find(r => p.x >= r.x && p.x < r.x + r.w && p.y >= r.y && p.y < r.y + r.h && !r.locked);
    return r && !r.locked && p.kind !== 'rack' && p.kind !== 'vaultchest' && p.kind !== 'potions';
  });
  rng.shuffle(keyHolders);
  keyHolders.sort((a, b) => (a.kind === 'chest' ? 0 : 1) - (b.kind === 'chest' ? 0 : 1));
  for (const d of doors) {
    const holder = keyHolders.shift();
    if (!holder) break;
    holder.kind = 'chest';
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

  // ---- guards: 1 + 2 per floor, spread over the unlocked rooms (barracks hold more). Each patrols
  // between two room waypoints beside room centres, so none sit on the stairwell.
  const f = { w, h, tiles, blocked };
  const pool = rooms.filter((r, i) => i > 0 && !r.locked);
  const enemies = [], perRoom = new Map();
  for (let i = 0; i < 4 + 2 * floorNum; i++) {
    const home = pickWeighted(pool, pool.map(r => r.theme === 'barracks' ? 2.5 : 1));
    const k = perRoom.get(home) || 0; perRoom.set(home, k + 1);
    let dest = rng.pick(rooms.filter(r => !r.locked));
    if (dest === home) dest = rooms[0];
    const a = roomPoint(f, home, k), b = roomPoint(f, dest, k + 3);
    enemies.push({ x: a.x, y: a.y, route: [a, b], seed: seedOf() });
  }

  return { w, h, tiles, blocked, rooms, start, stairs, props, decor, doors, torches, enemies, steps: dist[stairs.y * w + stairs.x] };
}
