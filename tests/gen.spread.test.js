// Spawn spread (js/enemytypes.js spreadEnemies), plain Node: node tests/gen.spread.test.js [seeds]
// Over many seeds x floors x themes: per-room cap, spawn spacing, no patrol into the start room, counts and types unchanged, valid tiles, determinism,
// and a before/after clustering number (most enemies within 6 m of one guard at floor start).
const fs = require('fs'), path = require('path'), vm = require('vm');
const root = path.join(__dirname, '..');
const ctx = vm.createContext({ console, Math, TILE: 3 });
for (const f of ['js/gen.js', 'js/loot.js', 'js/wands.js', 'js/enemytypes.js']) vm.runInContext(fs.readFileSync(path.join(root, f), 'utf8'), ctx, { filename: f });
const L = vm.runInContext('({ generateFloor, assignEnemyTypes, spreadEnemies, spawnRoom, roomCap, roomOf, THEME_NATIVES, T_FLOOR })', ctx);
let fails = 0, n = 0;
const fail = (w, m) => { if (++fails <= 20) console.log(`FAIL ${w}: ${m}`); };
const N = parseInt(process.argv[2], 10) || 60;
const THEMES = Object.keys(L.THEME_NATIVES);
const cluster = E => { let best = 0; for (const a of E) { let c = 0; for (const b of E) if (Math.hypot(a.x - b.x, a.y - b.y) <= 2) c++; best = Math.max(best, c); } return best; };   // within 2 tiles = 6 m
let maxB = 0, maxA = 0, tight = 0, before = 0, after = 0, floors = 0, spaceBad = 0, spaceAll = 0, capBad = 0, units = 0;
const mix = E => E.map(e => `${e.type || 'goblin'}${e.carry ? '+' : ''}`).sort().join(',');

for (let s = 1; s <= N; s++) {
  const seed = (s * 2654435761) >>> 0;
  for (const theme of THEMES) for (let fl = 1; fl <= 5; fl++) {
    const w = `${theme} seed ${seed} floor ${fl}`;
    const mk = spread => { const f = L.assignEnemyTypes(L.generateFloor(seed, fl, { armory: false, boss: fl === 5, themeName: theme }), seed, fl, theme); return spread ? L.spreadEnemies(f, seed, fl) : f; };
    const f0 = mk(false), f = mk(true), g = mk(true); n++;
    if (JSON.stringify(f.enemies) !== JSON.stringify(g.enemies)) fail(w, 'not deterministic');
    if (mix(f0.enemies) !== mix(f.enemies) || f0.enemies.length !== f.enemies.length) fail(w, 'enemy mix changed');
    if (f.boss) continue;
    floors++; const cb = cluster(f0.enemies), ca = cluster(f.enemies); before += cb; after += ca; maxB = Math.max(maxB, cb); maxA = Math.max(maxA, ca);
    const rooms = f.rooms, held = new Map(), spawns = [];
    const seenGrp = new Set();
    f.enemies.forEach((e, i) => {
      const r = L.roomOf(f, e.x, e.y), idx = rooms.indexOf(r);
      const ti = e.y * f.w + e.x;
      if (f.tiles[ti] !== L.T_FLOOR || f.blocked[ti]) fail(w, `enemy ${i} on an invalid tile`);
      if (e.route.length !== 2 || e.route.some(p => f.tiles[p.y * f.w + p.x] !== L.T_FLOOR || f.blocked[p.y * f.w + p.x])) fail(w, `enemy ${i} bad route`);
      if (e.qguard || e.handler !== undefined) return;
      if (!L.spawnRoom(r, idx)) fail(w, `enemy ${i} in a room that takes no spawns (${r && r.theme})`);
      if (L.roomOf(f, e.route[1].x, e.route[1].y) === rooms[0]) fail(w, `enemy ${i} patrols into the start room`);
      const wt = e.grp !== undefined ? (seenGrp.has(e.grp) ? 0 : (seenGrp.add(e.grp), 2)) : f.enemies.some(x => x.handler === i) ? 2 : 1;
      held.set(r, (held.get(r) || 0) + wt);
      spawns.push(e);
    });
    const need = [...held.values()].reduce((a, b) => a + b, 0), room = rooms.filter((r, i) => L.spawnRoom(r, i)).reduce((a, r) => a + L.roomCap(r), 0);
    if (need > room) { tight++; continue; }                        // a floor with less room than enemies cannot honour the cap: it spreads as evenly as it can
    for (const [r, c] of held) { units++; if (c > L.roomCap(r)) { capBad++; fail(w, `room ${r.theme} holds ${c} > cap ${L.roomCap(r)}`); } }
    for (let i = 0; i < spawns.length; i++) for (let j = i + 1; j < spawns.length; j++) {
      spaceAll++; if (Math.hypot(spawns[i].x - spawns[j].x, spawns[i].y - spawns[j].y) < 2) spaceBad++;
    }
  }
}
// spacing is best effort (a crowded small room may relax it): allow a tiny share of close pairs
const share = spaceBad / Math.max(1, spaceAll);
if (share > 0.005) fail('spacing', `${spaceBad} of ${spaceAll} spawn pairs closer than 2 tiles`);
console.log(`gen.spread: ${n} floors, ${fails} failures; capped rooms checked ${units}, over cap ${capBad}; floors too tight for the cap ${tight}; close spawn pairs ${spaceBad}/${spaceAll}`);
console.log(`most enemies within 6 m of one enemy at floor start (average over ${floors} floors): before ${(before / floors).toFixed(2)}, after ${(after / floors).toFixed(2)}; worst floor: before ${maxB}, after ${maxA}`);
process.exit(fails ? 1 : 0);
