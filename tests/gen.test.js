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
const G = vm.runInContext('({ generateFloor, T_WALL, T_DOOR, T_STAIRS, THEMES, THEME_GIMMICK })', ctx);
const THEME_NAMES = G.THEMES.map(t => t.name);

const N = parseInt(process.argv[2], 10) || 300;
let fails = 0, checked = 0;
const mapStats = [0, 1, 2, 3].map(() => ({ open: 0, corr: 0, n: 0 })), tierCounts = [0, 1, 2, 3].map(() => [0, 0, 0, 0, 0]);
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
    const themeName = s % 7 === 6 ? undefined : THEME_NAMES[(s + n) % THEME_NAMES.length], gim = G.THEME_GIMMICK[themeName], f = G.generateFloor(seed, n, { armory, boss, themeName });
    checked++;
    const closed = flood(f, false), open = flood(f, true), guardOpen = flood(f, true, true), at = (x, y) => y * f.w + x;
    if (!touchable(f, closed, f.stairs.x, f.stairs.y)) fail(where, 'stairs not reachable without keys');
    if (!boss) {                                                             // map size, corridor share and chest grades
      const size = [32, 36, 40, 44][n - 1];
      if (f.w !== size || f.h !== size) fail(where, `map is ${f.w}x${f.h}, want ${size}`);
      const inRoom = new Uint8Array(f.w * f.h);
      for (const r of f.rooms) for (let y = r.y; y < r.y + r.h; y++) for (let x = r.x; x < r.x + r.w; x++) inRoom[y * f.w + x] = 1;
      let open = 0, inR = 0; for (let i = 0; i < f.w * f.h; i++) if (f.tiles[i] !== G.T_WALL) { open++; if (inRoom[i]) inR++; }
      mapStats[n - 1].open += open; mapStats[n - 1].corr += open - inR; mapStats[n - 1].n++;
      for (const pr of f.props) if (pr.kind === 'chest') { if (!Number.isInteger(pr.tier) || pr.tier < 0 || pr.tier > 4) fail(where, `chest tier ${pr.tier}`); else tierCounts[n - 1][pr.tier]++; }
    }
    const patches = f.decor.filter(d => ['puddle', 'grass', 'glowcap', 'bell', 'ice'].includes(d.kind));
    if (gim && !boss && (patches.length < gim.n[0] - 2 || patches.length > gim.n[1] || patches.some(d => d.kind !== gim.kind))) fail(where, `${patches.length} ${gim.kind} patches on a ${themeName} floor`);
    if (!gim && patches.length) fail(where, 'floor patches in a theme without a gimmick');
    for (const d of patches) if (f.tiles[d.y * f.w + d.x] === G.T_WALL || f.blocked[d.y * f.w + d.x] || (d.x === f.start.x && d.y === f.start.y)) fail(where, `a ${d.kind} patch on a wall, furniture or the start tile`);
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
      const g = G.generateFloor(seed, n, { armory, boss: false, shop: true, themeName }), wh = where + ' (shop)';
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
// Mimic chests (gen.js MIMIC_CHANCE): none on floor 1; from floor 2 about 8% of eligible chests. Eligible means an
// ordinary chest in an unlocked room, outside the shop and not holding a key. Vault chests, key holders, locked rooms,
// the shop and the boss arena never get one.
{
  let eligible = 0, mimics = 0;
  const inR = (r, p) => p.x >= r.x && p.x < r.x + r.w && p.y >= r.y && p.y < r.y + r.h;
  for (let s = 1; s <= N; s++) {
    const seed = (s * 2654435761 + 977) >>> 0;
    for (let n = 1; n <= 5; n++) {
      const shop = n >= 2 && n <= 4 && s % 2 === 0;
      const f = G.generateFloor(seed, n, { armory: false, boss: n === 5, shop, themeName: THEME_NAMES[(s + n) % THEME_NAMES.length] });
      const where = `mimic seed ${seed} floor ${n}`, shopRoom = f.shop && f.shop.room;
      for (const p of f.props) {
        const r = f.rooms.find(q => inR(q, p));
        const ok = !!(p.kind === 'chest' && !p.holdsKey && !(shopRoom && inR(shopRoom, p)) && r && !r.locked);
        if (n >= 2 && n <= 4 && ok) eligible++;
        if (!p.mimic) continue;
        if (n >= 2 && n <= 4) mimics++;
        if (n === 1) fail(where, 'a mimic on floor 1');
        if (!ok) fail(where, `a ${p.kind} is a mimic but is not an ordinary chest in an unlocked room outside the shop`);
      }
    }
  }
  const share = mimics / Math.max(1, eligible);
  console.log(`mimic chests on floors 2 to 4: ${mimics} of ${eligible} eligible chests (${(share * 100).toFixed(1)}%)`);
  if (share < 0.06 || share > 0.10) fail('mimics', `share ${(share * 100).toFixed(1)}% is outside 6% to 10% (want about 8%)`);
}
const avgOpen = mapStats.map(m => m.open / m.n), corrShare = mapStats.map(m => m.corr / m.open);
console.log(`open tiles per floor (floors 1 to 4): ${avgOpen.map(v => Math.round(v)).join(', ')}; corridor share ${corrShare.map(v => Math.round(v * 100) + '%').join(', ')}`);
if (avgOpen[0] < 230 || avgOpen[0] > 420) fail('floor 1', `floor 1 averages ${Math.round(avgOpen[0])} open tiles, want 230 to 420 (it was 725)`);
if (avgOpen[3] > 680) fail('floor 4', `floor 4 averages ${Math.round(avgOpen[3])} open tiles`);
if (!(avgOpen[0] < avgOpen[1] && avgOpen[1] < avgOpen[2] && avgOpen[2] < avgOpen[3])) fail('maps', 'floors should grow with depth');
corrShare.forEach((v, i) => { if (v > 0.22) fail(`floor ${i + 1}`, `corridors are ${Math.round(v * 100)}% of the map, want 22% or less`); });
const tierShare = (i, from) => tierCounts[i].slice(from).reduce((a, b) => a + b, 0) / Math.max(1, tierCounts[i].reduce((a, b) => a + b, 0));
console.log(`chests: wooden share by floor ${[0, 1, 2, 3].map(i => Math.round(100 * tierShare(i, 0) - 100 * tierShare(i, 1)) + '%').join(', ')}; silver or better ${[0, 1, 2, 3].map(i => Math.round(100 * tierShare(i, 2)) + '%').join(', ')}`);
if (tierShare(0, 1) > 0.6) fail('chests', 'floor 1 should be mostly wooden chests');
if (tierShare(0, 4) > 0.05) fail('chests', 'golden chests should be very rare on floor 1');
if (!(tierShare(3, 2) > tierShare(0, 2) * 1.4)) fail('chests', 'deeper floors should have more silver or better chests');
const per = supply.map((v, i) => Math.round(v / floorsBy[i]));
console.log(`food in props per floor (hunger points, floors 1 to 5): ${per.join(', ')}`);
// Drain is 100 per 11 minutes (round 2 retune). A floor takes roughly 3 to 6 minutes, so 27 to 55 points. Supply should beat that by about 1.2 to 1.5 times (cooks drop food too), but not drown it.
for (let i = 0; i < 4; i++) if (per[i] < 25 || per[i] > 110) fail(`floor ${i + 1}`, `food supply ${per[i]} is outside 25 to 110 per floor`);
console.log(`${checked} floors checked, ${fails} failures`);
process.exit(fails ? 1 : 0);
