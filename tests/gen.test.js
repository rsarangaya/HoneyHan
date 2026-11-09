// Floor generator checks. Plain Node, no browser and no packages needed:
//   node tests/gen.test.js [floorsPerKind]
// Loads js/gen.js and js/loot.js as the page does (shared globals) and checks, over many seeds:
// stairs reachable from the start without keys, every prop and guard waypoint reachable,
// every locked door has exactly one key in a chest outside the locked rooms, locked rooms
// are reachable only through their door, and the boss arena has one boss and one healing potion.
const fs = require('fs'), path = require('path'), vm = require('vm');
const root = path.join(__dirname, '..');
const ctx = vm.createContext({ console, Math, TILE: 3 });   // TILE lives in js/player.js, which needs the page
for (const f of ['js/gen.js', 'js/loot.js', 'js/wands.js']) vm.runInContext(fs.readFileSync(path.join(root, f), 'utf8'), ctx, { filename: f });
const G = vm.runInContext('({ generateFloor, T_WALL, T_DOOR, T_STAIRS })', ctx);

const N = parseInt(process.argv[2], 10) || 300;
let fails = 0, checked = 0;
const supply = [0, 0, 0, 0, 0], floorsBy = [0, 0, 0, 0, 0];   // hunger points of food lying in props, per floor number
const fail = (where, msg) => { if (++fails <= 25) console.log(`FAIL ${where}: ${msg}`); };

// Flood fill over walkable tiles. withDoors: locked doors count as open (the player has the key).
// guards: furniture tiles count as solid (guards path tile by tile). The player is not stopped by
// them: a tile is 3 m wide and furniture is a small circle inside it, so the player walks round it.
function flood(f, withDoors, guards) {
  const { w, h, tiles, blocked } = f, seen = new Uint8Array(w * h);
  const ok = (x, y) => x >= 0 && y >= 0 && x < w && y < h && tiles[y * w + x] !== G.T_WALL
    && (withDoors || tiles[y * w + x] !== G.T_DOOR) && !(guards && blocked[y * w + x]);
  const q = [f.start.y * w + f.start.x]; seen[q[0]] = 1;
  for (let qi = 0; qi < q.length; qi++) {
    const i = q[qi], x = i % w, y = (i / w) | 0;
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const nx = x + dx, ny = y + dy;
      if (ok(nx, ny) && !seen[ny * w + nx]) { seen[ny * w + nx] = 1; q.push(ny * w + nx); }
    }
  }
  return seen;
}
// A blocking object is usable if you can stand on it or on a tile beside it.
const touchable = (f, seen, x, y) => [[0, 0], [1, 0], [-1, 0], [0, 1], [0, -1]].some(([dx, dy]) => seen[(y + dy) * f.w + x + dx]);
const inRoom = (r, x, y) => x >= r.x && x < r.x + r.w && y >= r.y && y < r.y + r.h;

for (let s = 1; s <= N; s++) {
  const seed = (s * 2654435761) >>> 0;
  for (let n = 1; n <= 5; n++) {
    const boss = n === 5, armory = n === 1 + (s % 4);
    const where = `seed ${seed} floor ${n}`;
    const f = G.generateFloor(seed, n, { armory, boss });
    checked++;
    const closed = flood(f, false), open = flood(f, true), guardOpen = flood(f, true, true), at = (x, y) => y * f.w + x;
    if (!touchable(f, closed, f.stairs.x, f.stairs.y)) fail(where, 'stairs not reachable without keys');
    if (armory && !f.rooms.some(r => r.theme === 'armory')) fail(where, 'armory missing');
    for (const p of f.props) if (!touchable(f, open, p.x, p.y)) fail(where, `${p.kind} at ${p.x},${p.y} unreachable`);
    for (const e of f.enemies) for (const p of [{ x: e.x, y: e.y }, ...e.route])
      if (!guardOpen[at(p.x, p.y)]) fail(where, `guard waypoint ${p.x},${p.y} not on reachable open floor`);
    for (const d of f.doors) {
      const holders = f.props.filter(p => (p.extra || []).some(it => it.type === 'key' && it.lock === d.lock));
      if (holders.length !== 1) { fail(where, `door ${d.room} has ${holders.length} keys`); continue; }
      if (!touchable(f, closed, holders[0].x, holders[0].y)) fail(where, `key for ${d.room} is behind a locked door`);
    }
    for (const r of f.rooms.filter(r => r.locked))
      for (let y = r.y; y < r.y + r.h; y++) for (let x = r.x; x < r.x + r.w; x++)
        if (closed[at(x, y)]) { fail(where, `locked ${r.theme} reachable without its key`); y = 1e9; break; }
    if (!f.boss || true) {   // hunger supply: every food item a floor's props would give, in hunger points
      const L = vm.runInContext('({ rollLoot, makeRng })', ctx), F = vm.runInContext('FOOD', ctx);
      for (const p of f.props) for (const d of p.fixed ? [] : L.rollLoot(p.kind, n, L.makeRng(p.seed), 0, [])) if (d.type === 'food') supply[n - 1] += F[d.kind].feed * (d.n || 1);
      floorsBy[n - 1]++;
    }
    if (f.props.some(p => p.kind === 'pantry') === false && f.rooms.some(r => r.theme === 'messhall')) fail(where, 'a mess hall without a food shelf');
    if (!boss && s % 2 === 0) {                                              // the same floor with a shop in it
      const g = G.generateFloor(seed, n, { armory, boss: false, shop: true }), wh = where + ' (shop)';
      const gc = flood(g, false), go = flood(g, true, true), gp = flood(g, true), at2 = (x, y) => y * g.w + x;
      if (!g.shop) fail(wh, 'no shop was made');
      else {
        const r = g.shop.room, inR = p => p.x >= r.x && p.x < r.x + r.w && p.y >= r.y && p.y < r.y + r.h;
        if (!touchable(g, gc, g.stairs.x, g.stairs.y)) fail(wh, 'stairs unreachable');
        if (g.rooms.filter(q => q.theme === 'shop').length !== 1 || g.rooms.find(q => q.theme === 'shop').locked) fail(wh, 'the shop room must be one unlocked room');
        if (!g.decor.some(d => d.kind === 'counter' && d.x === g.shop.counter.x && d.y === g.shop.counter.y)) fail(wh, 'no counter decor');
        if (!g.blocked[at2(g.shop.counter.x, g.shop.counter.y)] || !g.blocked[at2(g.shop.merchant.x, g.shop.merchant.y)]) fail(wh, 'counter and merchant tiles must be blocked');
        if (Math.abs(g.shop.counter.x - g.shop.merchant.x) + Math.abs(g.shop.counter.y - g.shop.merchant.y) !== 1) fail(wh, 'the merchant must stand beside the counter');
        const customer = [[0, 1], [0, -1], [1, 0], [-1, 0]].filter(([dx, dy]) => (g.shop.counter.x + dx !== g.shop.merchant.x || g.shop.counter.y + dy !== g.shop.merchant.y) && go[at2(g.shop.counter.x + dx, g.shop.counter.y + dy)]);
        if (!customer.length) fail(wh, 'nobody can reach the counter');
        for (const p of g.props) if (!touchable(g, gp, p.x, p.y)) fail(wh, `${p.kind} unreachable`);
        for (const e of g.enemies) if (inR(e) || e.route.some(inR)) fail(wh, 'a guard spawns or patrols in the shop');
        if (g.rooms.some(q => q.theme === 'armory') !== armory) fail(wh, 'armory presence changed');
      }
    }
    if (boss) {
      if (f.enemies.filter(e => e.boss).length !== 1) fail(where, 'boss arena needs exactly one boss');
      if (f.props.filter(p => p.fixed === 'heal').length !== 1) fail(where, 'boss arena needs exactly one healing potion');
    }
  }
}
const per = supply.map((v, i) => Math.round(v / floorsBy[i]));
console.log(`food in props per floor (hunger points, floors 1 to 5): ${per.join(', ')}`);
// Drain is 100 per 15 minutes. A floor takes roughly 3 to 6 minutes, so 20 to 40 points. Supply should beat that by about 2 to 4 times (cooks drop food too), but not drown it.
for (let i = 0; i < 4; i++) if (per[i] < 40 || per[i] > 110) fail(`floor ${i + 1}`, `food supply ${per[i]} is outside 40 to 110 per floor`);
console.log(`${checked} floors checked, ${fails} failures`);
process.exit(fails ? 1 : 0);
