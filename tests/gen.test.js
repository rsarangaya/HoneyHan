// Floor generator checks. Plain Node, no browser and no packages needed:
//   node tests/gen.test.js [floorsPerKind]
// Loads js/gen.js and js/loot.js as the page does (shared globals) and checks, over many seeds:
// stairs reachable from the start without keys, every prop and guard waypoint reachable,
// every locked door has exactly one key in a chest outside the locked rooms, locked rooms
// are reachable only through their door, and the boss arena has one boss and one healing potion.
// Also: mimic, locked and trapped chest placement (shares, exclusions, same seed, rest of floor unchanged) and lockpick drop rates.
// Encounters: the five types roll about equally; the wanted guard (defector in the start room, target on a patrol route) and the
// sack thief (two rooms of its own) lay out over many seeds, the floor stays as it was apart from the encounter; the sack, the
// wanted reward and the encounter lines are checked with stub globals.
const fs = require('fs'), path = require('path'), vm = require('vm');
const root = path.join(__dirname, '..');
const ctx = vm.createContext({ console, Math, TILE: 3 });   // TILE lives in js/player.js, which needs the page
for (const f of ['js/gen.js', 'js/loot.js', 'js/wands.js', 'js/enemytypes.js', 'js/quests.js']) vm.runInContext(fs.readFileSync(path.join(root, f), 'utf8'), ctx, { filename: f });
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
    if (!touchable(f, f.safe ? open : closed, f.stairs.x, f.stairs.y)) fail(where, 'stairs not reachable without keys');   // the boss floor's stairs are behind the hidden door until the boss dies
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
// Locked and trapped chests (gen.js CHEST_ODDS): locked from floor 1 (about 12% of eligible chests), trapped from floor 2 (about 10%).
// Eligible is the mimic rule: an ordinary chest in an unlocked room, outside the shop and not holding a key. Never both, never a mimic.
// Each eligible chest costs one roll, so with the odds at 0 the rest of the floor must come out exactly the same.
{
  const inR = (r, p) => p.x >= r.x && p.x < r.x + r.w && p.y >= r.y && p.y < r.y + r.h;
  const eligible = (f, p) => { const shopRoom = f.shop && f.shop.room, r = f.rooms.find(q => inR(q, p)); return !!(p.kind === 'chest' && !p.holdsKey && !(shopRoom && inR(shopRoom, p)) && r && !r.locked); };
  const floorFor = (s, n) => G.generateFloor((s * 2654435761 + 4219) >>> 0, n, { armory: false, boss: false, shop: n >= 2 && n <= 4 && s % 2 === 0, themeName: THEME_NAMES[(s + n) % THEME_NAMES.length] });
  const odds = vm.runInContext('CHEST_ODDS', ctx), saved = { ...odds };
  const kinds = { dart: 0, gas: 0, alarm: 0 };
  let el1 = 0, lock1 = 0, elT = 0, trapT = 0, lockT = 0, trapOn1 = 0;
  // Floor 1 runs over more seeds (chests cluster within a seed, so 300 seeds leave the share too noisy to hold to 12%).
  for (let s = 1; s <= Math.max(N, 1000); s++) for (let n = 1; n <= (s <= N ? 4 : 1); n++) {
    const f = floorFor(s, n), where = `locked/trap seed ${s} floor ${n}`;
    for (const p of f.props) {
      const isEl = eligible(f, p), locked = !!p.locked, trapped = !!p.trap;
      if (locked && trapped) fail(where, 'a chest is both locked and trapped');
      if ((locked || trapped) && !isEl) fail(where, `a ${p.kind} is locked or trapped but is not an ordinary chest in an unlocked room outside the shop`);
      if ((locked || trapped) && p.mimic) fail(where, 'a mimic chest is also locked or trapped');
      if (trapped && kinds[p.trap] === undefined) fail(where, `trap kind ${p.trap}`);
      if (trapped) kinds[p.trap]++;
      if (n === 1 && isEl) { el1++; if (locked) lock1++; }
      if (n === 1 && trapped) trapOn1++;
      if (n >= 2 && isEl && !p.mimic) { elT++; if (trapped) trapT++; if (locked) lockT++; }
    }
  }
  const share1 = lock1 / Math.max(1, el1), shareT = trapT / Math.max(1, elT);
  console.log(`locked chests: ${(share1 * 100).toFixed(1)}% of eligible chests on floor 1; floors 2 to 4: trapped ${(shareT * 100).toFixed(1)}%, locked ${(100 * lockT / Math.max(1, elT)).toFixed(1)}% (of non-mimic eligible); trap kinds ${JSON.stringify(kinds)}`);
  if (share1 < 0.09 || share1 > 0.15) fail('locked', `${(share1 * 100).toFixed(1)}% of eligible floor 1 chests, want about 12%`);
  if (shareT < 0.07 || shareT > 0.13) fail('trapped', `${(shareT * 100).toFixed(1)}% of eligible floor 2 to 4 chests, want about 10%`);
  if (trapOn1) fail('trapped', `${trapOn1} trapped chests on floor 1`);
  for (const k of Object.keys(kinds)) if (kinds[k] < 0.2 * Math.max(1, trapT)) fail('trapped', `${k} is only ${kinds[k]} of ${trapT} traps`);

  // Same seed, same placement.
  for (let s = 1; s <= Math.min(N, 60); s++) for (let n = 1; n <= 4; n++) {
    const flags = () => JSON.stringify(floorFor(s, n).props.map(p => [p.locked, p.trap, p.mimic]));
    if (flags() !== flags()) fail(`locked/trap seed ${s} floor ${n}`, 'placement changed between two runs of the same seed');
  }

  // The rest of the floor is unchanged: generate each floor with the odds at 0 (every roll still drawn) and compare everything else.
  const strip = f => JSON.stringify({ ...f, props: f.props.map(p => ({ ...p, locked: undefined, trap: undefined })) });
  let compared = 0;
  for (let s = 1; s <= Math.min(N, 100); s++) for (let n = 1; n <= 4; n++) {
    const where = `locked/trap seed ${s} floor ${n}`, withPass = floorFor(s, n);
    odds.locked = 0; odds.trap = 0;
    const without = floorFor(s, n);
    Object.assign(odds, saved);
    if (without.props.some(p => p.locked || p.trap)) fail(where, 'chests still locked or trapped with the odds at 0');
    compared++;
    if (strip(withPass) !== strip(without)) fail(where, 'the locked and trapped pass changed something else on the floor');
  }
  console.log(`locked/trapped pass: ${compared} floors compared with the odds at 0`);
}

// Lockpicks in loot (loot.js LOCKPICK): about 6% of barrels and rubble, about 25% of bandit and thief bodies, none from anything else.
// The lockpick roll is last in rollLoot, so the rest of each table matches rollLootBase (the table before that roll).
{
  const L = vm.runInContext('({ rollLoot, rollLootBase, makeRng })', ctx);
  const tries = 20000;
  const rate = (kind, type) => {
    let hits = 0;
    for (let i = 0; i < tries; i++) {
      const d = L.rollLoot(kind, 1 + (i % 4), L.makeRng((i * 2654435761 + 31) >>> 0), 0, [], type, 0);
      const lp = d.filter(x => x.type === 'lockpick');
      if (lp.length) { hits++; if (lp.length !== 1 || lp[0].n !== 1) fail(`lockpick ${kind}`, 'a drop should be one lockpick'); }
    }
    return hits / tries;
  };
  const want = [['barrel', 'goblin', 0.06], ['rubble', 'goblin', 0.06], ['corpse', 'bandit', 0.25], ['corpse', 'thief', 0.25]];
  const got = want.map(([kind, type]) => rate(kind, type));
  want.forEach(([kind, type, p], i) => { if (Math.abs(got[i] - p) > 0.015) fail(`lockpick ${kind} ${type}`, `${(got[i] * 100).toFixed(1)}%, want about ${p * 100}%`); });
  console.log(`lockpick drops: barrel ${(got[0] * 100).toFixed(1)}%, rubble ${(got[1] * 100).toFixed(1)}%, bandit body ${(got[2] * 100).toFixed(1)}%, thief body ${(got[3] * 100).toFixed(1)}%`);
  for (const [kind, type] of [['corpse', 'goblin'], ['chest', 'goblin'], ['pantry', 'goblin'], ['corpse', 'rat']]) if (rate(kind, type) !== 0) fail(`lockpick ${kind} ${type}`, 'should never drop a lockpick');
  let mismatch = 0;
  for (let i = 0; i < 2000; i++) for (const [kind, type] of [['barrel', 'goblin'], ['rubble', 'goblin'], ['corpse', 'bandit'], ['chest', 'goblin']]) {
    const seed = (i * 7919 + 5) >>> 0;
    const a = L.rollLoot(kind, 2, L.makeRng(seed), 0, [], type, 1).filter(d => d.type !== 'lockpick');
    const b = L.rollLootBase(kind, 2, L.makeRng(seed), 0, [], type, 1);
    if (JSON.stringify(a) !== JSON.stringify(b)) mismatch++;
  }
  if (mismatch) fail('lockpick', `${mismatch} loot tables changed apart from the lockpick`);
}

// Encounters (js/quests.js rollQuests; gen.js opts.quest 'miniboss' lays out the lair). Plain Node, no browser.
{
  const Q = vm.runInContext('({ rollQuests, QUESTS, makeRng, rollLoot, MINIBOSS_NAMES })', ctx);
  const seen = { 0: 0, 1: 0, 2: 0 }, types = {}, qbad = [];
  const RS = 20000;
  for (let s = 1; s <= RS; s++) {
    const seed = (s * 2654435761) >>> 0, shop = Q.makeRng((seed ^ 0x51ed270b) >>> 0).int(1, 4);
    const plan = Q.rollQuests(seed, 5, shop), floors = Object.keys(plan).map(Number);
    seen[floors.length]++;
    for (const n of floors) { if (n < 2 || n > 4) qbad.push(`floor ${n} outside 2 to 4`); if (n === shop) qbad.push(`encounter on the shop floor ${n}`); types[plan[n]] = (types[plan[n]] || 0) + 1; }
    if (s <= 2000 && JSON.stringify(Q.rollQuests(seed, 5, shop)) !== JSON.stringify(plan)) qbad.push('roll changed between two calls');
  }
  const pct = k => 100 * seen[k] / RS, want = { 0: 25, 1: 45, 2: 30 };
  console.log(`encounters per stage: none ${pct(0).toFixed(1)}%, one ${pct(1).toFixed(1)}%, two ${pct(2).toFixed(1)}%; types ${JSON.stringify(types)}`);
  for (const k of [0, 1, 2]) if (Math.abs(pct(k) - want[k]) > 1.5) fail('roll', `${k} encounters ${pct(k).toFixed(1)}%, want about ${want[k]}%`);
  for (const m of qbad.slice(0, 3)) fail('roll', m);
  if (!types.miniboss || !types.shrine) fail('roll', 'both encounter types should be rolled');
  // Five types, weight 1 each: each should be about a fifth of the encounters rolled.
  const totalTypes = Object.values(types).reduce((a, b) => a + b, 0);
  for (const t of ['miniboss', 'shrine', 'wanted', 'thief', 'prisoner']) { const sh = (types[t] || 0) / totalTypes; if (Math.abs(sh - 0.2) > 0.02) fail('roll', `${t} is ${(sh * 100).toFixed(1)}% of encounters, want about 20%`); }
  if (Object.keys(types).length !== 5) fail('roll', `unexpected encounter types: ${Object.keys(types).join(', ')}`);
  console.log(`encounter types: ${Object.entries(types).map(([t, c]) => t + ' ' + (100 * c / totalTypes).toFixed(1) + '%').join(', ')}`);

  // Lair layout: 300 seeds, floors 2 to 4, mini-boss forced. The door is reachable from the start with no key; the lair interior is
  // reachable only through the door; the key sits on a reachable chest; the mini-boss waits inside on its route.
  let lairs = 0, noFit = 0;
  const lairFails = [];
  for (let s = 1; s <= 300; s++) for (let n = 2; n <= 4; n++) {
    const seed = (s * 2654435761 + 1213) >>> 0, where = `lair seed ${seed} floor ${n}`;
    const f = G.generateFloor(seed, n, { armory: false, boss: false, shop: false, quest: 'miniboss' });
    if (f.quest) vm.runInContext('questSpawn', ctx)(f);                   // as main.js does after the layout
    const lair = f.rooms.find(r => r.theme === 'lair');
    if (!f.quest) {                                                       // the layout never fit: no half-built lair anywhere
      noFit++;
      if (lair || f.doors.some(d => d.room === 'lair') || f.enemies.some(e => e.type === 'miniboss')) fail(where, 'no encounter, but lair pieces are left on the floor');
      continue;
    }
    lairs++;
    const door = f.doors.find(d => d.room === 'lair');
    if (!lair || !door || f.quest.type !== 'miniboss') { fail(where, 'quest miniboss without a lair room and door'); continue; }
    const closed = flood(f, false), open = flood(f, true);
    if (!touchable(f, closed, door.x, door.y)) lairFails.push(`${where}: lair door not reachable from the start without a key`);
    const interior = [];
    for (let y = lair.y; y < lair.y + lair.h; y++) for (let x = lair.x; x < lair.x + lair.w; x++) interior.push(y * f.w + x);
    if (interior.some(i => closed[i])) lairFails.push(`${where}: lair interior reachable without the door`);
    if (!interior.some(i => open[i])) lairFails.push(`${where}: lair interior unreachable even through the door`);
    const holders = f.props.filter(p => (p.extra || []).some(it => it.type === 'key' && it.lock === f.quest.lock));
    if (holders.length !== 1 || holders[0].kind !== 'chest' || !touchable(f, closed, holders[0].x, holders[0].y)) lairFails.push(`${where}: lair key is not on one reachable chest`);
    if (holders.length === 1 && lair && inRoom(lair, holders[0].x, holders[0].y)) lairFails.push(`${where}: lair key inside the lair`);
    const boss = f.enemies.filter(e => e.type === 'miniboss');
    if (boss.length !== 1 || !boss[0].mini || !Q.MINIBOSS_NAMES.includes(boss[0].mini.name)) lairFails.push(`${where}: want exactly one named mini-boss`);
    if (boss.length === 1 && !(f.quest.route.every(p => inRoom(lair, p.x, p.y)) && boss[0].x === f.quest.route[0].x && boss[0].y === f.quest.route[0].y)) lairFails.push(`${where}: mini-boss not on its lair route`);
  }
  for (const m of lairFails.slice(0, 5)) fail('lair', m);
  if (lairFails.length) fail('lair', `${lairFails.length} lair checks failed in total`);
  console.log(`lair layouts: ${lairs} floors with the lair, ${noFit} floors where it did not fit (no encounter, nothing left behind)`);

  // Mini-boss drop (QUESTS.miniboss): Rare or better gear, gold 30 to 50 plus 10 a floor, a potion about half the time.
  const q = Q.QUESTS.miniboss, N = 4000;
  for (const n of [2, 4]) {
    let gearOk = 0, goldOk = 0, pots = 0;
    for (let i = 0; i < N; i++) {
      const d = Q.rollLoot('corpse', n, Q.makeRng((i * 7919 + n) >>> 0), 0, [], 'miniboss', 0);
      const gear = d.filter(x => x.type === 'weapon' || x.type === 'armor' || x.type === 'shield');
      const gold = d.filter(x => x.type === 'gold').reduce((a, x) => a + x.n, 0);
      if (gear.length === 1 && gear[0].tier >= q.minTier) gearOk++;
      if (gold >= q.goldMin + q.goldPerFloor * n && gold <= q.goldMax + q.goldPerFloor * n) goldOk++;
      if (d.some(x => x.type === 'potion')) pots++;
    }
    if (gearOk !== N) fail(`miniboss drop floor ${n}`, `${N - gearOk} drops without exactly one Rare+ gear piece`);
    if (goldOk !== N) fail(`miniboss drop floor ${n}`, `${N - goldOk} drops with gold outside ${q.goldMin + q.goldPerFloor * n} to ${q.goldMax + q.goldPerFloor * n}`);
    const share = pots / N;
    if (Math.abs(share - q.potion) > 0.03) fail(`miniboss drop floor ${n}`, `potion share ${(share * 100).toFixed(1)}%, want about ${q.potion * 100}%`);
  }
}

// Wanted guard and sack thief (js/quests.js; gen.js opts.quest 'wanted' and 'thief'). The layouts are checked over many seeds;
// the reward, the lines and the sack are checked by calling the quest code in the same vm context with stub globals.
{
  const QX = vm.runInContext('({ QUEST_TYPES, QUESTS, MINIBOSS_NAMES, makeRng, rollLoot })', ctx);
  const QT = QX.QUEST_TYPES, ordinary = (f, r) => r !== f.rooms[0] && !r.locked && r.theme !== 'shop' && r.theme !== 'lair';   // rooms overlap on most floors
  const roomsAt = (f, p) => f.rooms.filter(r => inRoom(r, p.x, p.y));
  const atI = (f, p) => p.y * f.w + p.x;
  // The layout generateFloor settles on for a quest (the same retry loop), so the plain floor can be rebuilt from the same attempt.
  const LF = vm.runInContext('layoutFloor', ctx);
  const settle = (seed, n, quest) => {
    for (let a = 0; a < 24; a++) {
      const sd = (seed + a * 7777) >>> 0, f = LF(sd, n, { armory: false, boss: false, shop: false, quest });
      if (f.quest) return { f, sd };
    }
    return { f: null };
  };
  // The floor with the quest must equal the plain floor from the same attempt, except for the quest and the extra blocked tiles.
  const sameExceptQuest = (f, sd, n, extraBlocked) => {
    const base = vm.runInContext('layoutFloor', ctx)(sd, n, { armory: false, boss: false, shop: false });
    const strip = g => JSON.stringify({ ...g, quest: undefined, blocked: undefined });
    if (strip(f) !== strip(base)) return 'the floor changed apart from the encounter';
    let diff = 0; for (let i = 0; i < f.blocked.length; i++) if (!!f.blocked[i] !== !!base.blocked[i]) diff++;
    return diff !== extraBlocked ? `${diff} blocked tiles differ (want ${extraBlocked})` : '';
  };

  // ---- wanted guard layout (300 seeds, floors 2 to 4) ----
  let wFit = 0, wNo = 0; const wBad = [];
  for (let s = 1; s <= 300; s++) for (let n = 2; n <= 4; n++) {
    const seed = (s * 2654435761 + 555) >>> 0, where = `wanted seed ${seed} floor ${n}`;
    const { f, sd } = settle(seed, n, 'wanted');
    if (!f) { wNo++; continue; }
    wFit++;
    const q = f.quest, r0 = f.rooms[0], npc = q.npc, home = f.rooms.find(r => ordinary(f, r) && r.theme === q.room && q.route.every(p => inRoom(r, p.x, p.y)));
    if (q.type !== 'wanted') { wBad.push(`${where}: type ${q.type}`); continue; }
    if (!inRoom(r0, npc.x, npc.y)) wBad.push(`${where}: defector outside the start room`);
    if (!f.blocked[atI(f, npc)] || f.tiles[atI(f, npc)] === G.T_WALL) wBad.push(`${where}: defector tile is not a blocked open tile`);
    if (Math.hypot(npc.x - f.start.x, npc.y - f.start.y) < 2) wBad.push(`${where}: defector next to the start`);
    if (!home) wBad.push(`${where}: target's route is not inside an ordinary ${q.room} room other than the start`);
    if (q.route[0].x === q.route[1].x && q.route[0].y === q.route[1].y) wBad.push(`${where}: route has one point`);
    const guardOpen = flood(f, true, true), closed = flood(f, false);
    if (!touchable(f, closed, f.stairs.x, f.stairs.y)) wBad.push(`${where}: stairs unreachable`);
    if (!q.route.every(p => guardOpen[atI(f, p)])) wBad.push(`${where}: route not reachable`);
    const cutOff = g => { const s = flood(g, true, true); let c = 0; for (let i = 0; i < g.w * g.h; i++) if (g.tiles[i] !== G.T_WALL && !g.blocked[i] && !s[i]) c++; return c; };
    if (cutOff(f) > cutOff(LF(sd, n, { armory: false, boss: false, shop: false }))) wBad.push(`${where}: the defector cuts off ${cutOff(f)} tiles`);
    const dm = sameExceptQuest(f, sd, n, 1); if (dm) wBad.push(`${where}: ${dm}`);
    const snap = JSON.stringify(q);
    vm.runInContext('questSpawn', ctx)(f);
    const tg = f.enemies.filter(e => e.type === 'wanted');
    if (tg.length !== 1 || !tg[0].mini || !QX.MINIBOSS_NAMES.includes(tg[0].mini.name) || tg[0].x !== q.route[0].x || tg[0].y !== q.route[0].y) wBad.push(`${where}: want one named target on its route`);
    if (f.enemies.some(e => e.x === npc.x && e.y === npc.y)) wBad.push(`${where}: an enemy stands on the defector's tile`);
    if (s <= 40 && JSON.stringify(settle(seed, n, 'wanted').f.quest) !== snap) wBad.push(`${where}: placement changed between two runs`);
  }
  console.log(`wanted layouts: ${wFit} floors with the defector, ${wNo} where it did not fit (no encounter)`);
  for (const m of wBad.slice(0, 5)) fail('wanted layout', m);
  if (wBad.length) fail('wanted layout', `${wBad.length} wanted layout checks failed in total`);
  if (wFit < 300) fail('wanted layout', `only ${wFit} of 900 floors fit the defector`);

  // ---- sack thief layout (300 seeds, floors 2 to 4) ----
  let tFit = 0, tNo = 0; const tBad = [];
  for (let s = 1; s <= 300; s++) for (let n = 2; n <= 4; n++) {
    const seed = (s * 2654435761 + 777) >>> 0, where = `thief seed ${seed} floor ${n}`;
    const { f, sd } = settle(seed, n, 'thief');
    if (!f) { tNo++; continue; }
    tFit++;
    const q = f.quest, guardOpen = flood(f, true, true);
    if (q.type !== 'thief') { tBad.push(`${where}: type ${q.type}`); continue; }
    const A = roomsAt(f, q.route[0]).filter(r => ordinary(f, r)), B = roomsAt(f, q.route[1]).filter(r => ordinary(f, r));
    if (!A.length || !B.length) tBad.push(`${where}: a route point is in no ordinary room`);
    else if (A.length === 1 && B.length === 1 && A[0] === B[0]) tBad.push(`${where}: both route points are in one room`);
    if (!q.route.every(p => guardOpen[atI(f, p)])) tBad.push(`${where}: route not reachable`);
    const dm = sameExceptQuest(f, sd, n, 0); if (dm) tBad.push(`${where}: ${dm}`);
    vm.runInContext('questSpawn', ctx)(f);
    const th = f.enemies.filter(e => e.type === 'sackthief');
    if (th.length !== 1 || th[0].x !== q.route[0].x || th[0].y !== q.route[0].y || th[0].route.length !== 2) tBad.push(`${where}: want one thief on its route`);
  }
  // Plain floors never get a thief or a defector.
  for (let s = 1; s <= 100; s++) {
    const f = G.generateFloor((s * 2654435761 + 9) >>> 0, 3, { armory: false, boss: false, shop: false });
    vm.runInContext('questSpawn', ctx)(f);
    if (f.enemies.some(e => e.type === 'sackthief' || e.type === 'wanted')) tBad.push(`seed ${s}: encounter enemy on a plain floor`);
  }
  console.log(`thief layouts: ${tFit} floors with the thief, ${tNo} where it did not fit (no encounter)`);
  for (const m of tBad.slice(0, 5)) fail('thief layout', m);
  if (tBad.length) fail('thief layout', `${tBad.length} thief layout checks failed in total`);
  if (tFit < 300) fail('thief layout', `only ${tFit} of 900 floors fit the thief`);

  // ---- the sack: gold 40 to 80 plus 15 a floor, and one Uncommon or better item, on floors 1 to 4 ----
  const TQ = QX.QUESTS.thief;
  for (let n = 1; n <= 4; n++) {
    let gOk = 0, itemOk = 0, extra = 0; const N = 2000;
    for (let i = 0; i < N; i++) {
      const d = QX.rollLoot('corpse', n, QX.makeRng((i * 6151 + n * 17) >>> 0), 0, [], 'sackthief', 0);
      const gold = d.filter(x => x.type === 'gold').reduce((a, x) => a + x.n, 0), gear = d.filter(x => ['weapon', 'armor', 'shield'].includes(x.type));
      if (gold >= TQ.goldMin + TQ.goldPerFloor * n && gold <= TQ.goldMax + TQ.goldPerFloor * n) gOk++;
      if (gear.length === 1 && gear[0].tier >= TQ.minTier) itemOk++;
      if (d.length !== gear.length + (gold ? 1 : 0)) extra++;
    }
    if (gOk !== N || itemOk !== N || extra) fail(`thief sack floor ${n}`, `gold ok ${gOk}/${N}, Uncommon+ item ok ${itemOk}/${N}, other drops ${extra}`);
  }

  // ---- the wanted reward (QUEST_TYPES.wanted.talk) with stub inventory and messages ----
  const stub = { got: [], msgs: [], full: false };
  ctx.inv = { add: d => { if (stub.full) return null; stub.got.push(d); return 'an item'; } };
  ctx.flash = m => stub.msgs.push(m); ctx.discover = () => {};
  const W = QT.wanted, WS = QX.QUESTS.wanted, dead = { dead: true };
  const talk = (quest, fl) => { ctx.floorNum = fl; stub.got = []; W.talk({ quest }); return stub.got; };
  const tierMean = {};
  for (const fl of [2, 3, 4]) {
    let pots = 0, bad = 0, tierSum = 0, gearN = 0; const kinds = new Set(), N = 3000;
    for (let i = 0; i < N; i++) {
      const got = talk({ seed: (i * 2246822519 + fl) >>> 0, name: 'Old Gnash', room: 'generic', boss: dead }, fl);
      if (got.length !== 1) { bad++; continue; }
      const d = got[0];
      if (d.type === 'potion') { pots++; kinds.add(d.kind); if (d.n !== WS.potionN || !WS.potionKinds.includes(d.kind)) bad++; }
      else { gearN++; tierSum += d.tier; if (!['weapon', 'armor', 'shield'].includes(d.type) || d.tier < WS.gearMinTier) bad++; }
    }
    const share = pots / N;
    if (bad) fail(`wanted reward floor ${fl}`, `${bad} rewards not a potion of the list or gear of Rare or better`);
    if (Math.abs(share - WS.potionShare) > 0.03) fail(`wanted reward floor ${fl}`, `potion share ${(share * 100).toFixed(1)}%, want about ${WS.potionShare * 100}%`);
    if (kinds.size !== WS.potionKinds.length) fail(`wanted reward floor ${fl}`, `potion kinds seen: ${[...kinds].join(', ')}`);
    tierMean[fl] = tierSum / gearN;
  }
  console.log(`wanted reward: mean gear tier floor 2 ${tierMean[2].toFixed(2)}, floor 3 ${tierMean[3].toFixed(2)}, floor 4 ${tierMean[4].toFixed(2)}`);
  if (!(tierMean[3] > tierMean[2] + 0.1)) fail('wanted reward', 'gear should be a tier better from floor 3 on');

  // Claimed once; claimable without a talk first; a full pack keeps the reward for the next talk.
  stub.msgs = [];
  const q1 = { seed: 99, name: 'Big Dreg', room: 'barracks', boss: dead };
  const first = talk(q1, 2).length;
  const second = talk(q1, 2).length;
  const thanks = stub.msgs[stub.msgs.length - 1] || '';
  if (first !== 1 || second !== 0 || !/Thank you/.test(thanks) || q1.done !== true) fail('wanted reward once', `${first} then ${second} rewards, last message "${thanks}"`);
  const q2 = { seed: 5, name: 'Old Gnash', room: 'generic', boss: dead };
  stub.full = true; const fullGot = talk(q2, 2).length, fullDone = !!q2.done, fullMsg = stub.msgs[stub.msgs.length - 1] || '';
  stub.full = false; const reward1 = JSON.stringify(q2.reward); const later = talk(q2, 2).length;
  if (fullGot !== 0 || fullDone || !/Make room/.test(fullMsg) || later !== 1 || JSON.stringify(stub.got[0]) !== reward1) fail('wanted reward full pack', `full pack gave ${fullGot}, done ${fullDone}, then ${later}; "${fullMsg}"`);

  // The line and the prompt at each stage of the wanted guard
  const wf = quest => ({ quest: { type: 'wanted', name: 'Old Gnash', room: 'library', boss: { dead: false }, talked: false, seed: 1, ...quest } });
  const stages = [wf({}), wf({ talked: true }), wf({ boss: { dead: true } }), wf({ done: true })];
  const lines = stages.map(f => QT.wanted.line(f)), prompts = stages.map(f => QT.wanted.prompt(f.quest));
  if (!/Talk to it \(hold E\)/.test(lines[0]) || !/Hunt Old Gnash, who patrols the library/.test(lines[1]) || !/Old Gnash is dead\. Return to the defector/.test(lines[2]) || lines[3] !== '') fail('wanted line', JSON.stringify(lines));
  if (prompts.join(' | ') !== 'Talk to the hooded stranger | Talk to the defector | Claim your reward | Talk to the defector') fail('wanted prompt', prompts.join(' | '));
  // The thief line: shown only while the thief lives on the floor
  const tl = quest => QT.thief.line({ quest });
  if (!/loot sack/.test(tl({ thief: { dead: false } })) || tl({ thief: { dead: true } }) !== '' || tl({ thief: { dead: false }, gone: true }) !== '' || tl({ thief: null }) !== '') fail('thief line', 'the line should show only while the thief is alive and on the floor');
}

// Safe room behind the boss arena (layoutBoss: floor.safe). 300 seeds of the boss floor: the map is 57 x 57; the hidden door is a closed door
// tile at the head of a passage; the room and its stairs are reachable only through the door; the arena (start, boss, guard routes, the
// healing potion) stays reachable without it. main.js floor.safe.inside (the tiles where you are safe) must be exactly the room and its passage.
{
  const safeFloor = (seed) => G.generateFloor(seed, 5, { boss: true });
  for (let s = 1; s <= N; s++) {
    const seed = (s * 2654435761) >>> 0, where = `safe room, seed ${seed}`, f = safeFloor(seed), at = (x, y) => f.tiles[y * f.w + x];
    const sf = f.safe;
    if (!sf) { fail(where, 'boss floor has no safe room'); continue; }
    const { door, rect: r } = sf;
    if (f.w !== 57 || f.h !== 57) fail(where, `boss map is ${f.w}x${f.h}, want 57x57`);
    if (at(door.x, door.y) !== G.T_DOOR) fail(where, 'the hidden door is not a closed door tile');
    if (at(f.stairs.x, f.stairs.y) !== G.T_STAIRS || f.stairs.x < r.x0 || f.stairs.x > r.x1 || f.stairs.y < r.y0 || f.stairs.y > r.y1) fail(where, 'the stairs are not inside the safe room');
    let rock = false;
    for (let y = r.y0; y <= r.y1; y++) for (let x = r.x0; x <= r.x1; x++) if (at(x, y) === G.T_WALL) rock = true;
    for (let y = r.y1 + 1; y < door.y; y++) if (at(door.x, y) === G.T_WALL) rock = true;
    if (rock) fail(where, 'the safe room or its passage has rock in it');
    const closed = flood(f, false), open = flood(f, true), idx = (x, y) => y * f.w + x;
    let roomReached = false;
    for (let y = r.y0; y <= r.y1; y++) for (let x = r.x0; x <= r.x1; x++) if (closed[idx(x, y)]) roomReached = true;
    if (roomReached || touchable(f, closed, f.stairs.x, f.stairs.y)) fail(where, 'the safe room or its stairs are reachable before the boss dies');
    let roomOpen = true;
    for (let y = r.y0; y <= r.y1; y++) for (let x = r.x0; x <= r.x1; x++) if (!open[idx(x, y)]) roomOpen = false;
    if (!roomOpen || !touchable(f, open, f.stairs.x, f.stairs.y)) fail(where, 'the safe room or its stairs are unreachable once the door is open');
    if (!touchable(f, closed, f.boss.x, f.boss.y)) fail(where, 'the boss is not reachable without the safe room door');
    for (const e of f.enemies) if (!e.boss) for (const p of e.route) if (!touchable(f, closed, p.x, p.y)) { fail(where, 'a guard route is not reachable'); break; }
    for (const p of f.props) if (p.fixed === 'heal' && !touchable(f, closed, p.x, p.y)) fail(where, 'the healing potion is not reachable');
    // The tiles where you are safe (main.js builds floor.safe.inside by this same rule): the room and its passage, never the door, never the arena.
    const inside = new Uint8Array(f.w * f.h);
    for (let y = r.y0; y <= r.y1; y++) for (let x = r.x0; x <= r.x1; x++) inside[idx(x, y)] = 1;
    for (let y = r.y1 + 1; y < door.y; y++) inside[idx(door.x, y)] = 1;
    let count = 0, arena = 0;
    for (let i = 0; i < inside.length; i++) if (inside[i]) { count++; if (closed[i]) arena++; }
    if (count !== (r.x1 - r.x0 + 1) * (r.y1 - r.y0 + 1) + (door.y - r.y1 - 1)) fail(where, 'the safe-room mask is not exactly the room and its passage');
    if (inside[idx(door.x, door.y)]) fail(where, 'the door tile is inside the safe-room mask');
    if (arena) fail(where, `the safe-room mask covers ${arena} arena tiles`);
  }
  // The same seed gives the same floor (door, room, stairs, boss, props and the tile grid).
  const sig = f => JSON.stringify([Array.from(f.tiles), f.safe, f.stairs, f.boss, f.props, f.decor.length]);
  for (let s = 1; s <= 20; s++) { const seed = (s * 2654435761) >>> 0; if (sig(safeFloor(seed)) !== sig(safeFloor(seed))) fail(`safe room, seed ${seed}`, 'a repeat of the same seed gave a different floor'); }
}

// Prisoner rescue (js/quests.js 'prisoner', gen.js opts.quest 'prisoner'): one prisoner a run, the cell layout over 300 seeds
// (floors 2 to 4), the cell key's carrier and its obtainability, and the reward (stub inventory). Plain Node.
{
  const PX = vm.runInContext('({ rollQuests, makeRng, QUESTS, prisonerTalk })', ctx);
  const deadCarriers = vm.runInContext('[...CARRY_NO]', ctx);
  // One prisoner a run at most: over 20000 seeds, and at least one prisoner plan turns up (so the check is not vacuous).
  let twoPrisoners = 0, prisonerPlans = 0;
  for (let s = 1; s <= 20000; s++) {
    const seed = (s * 2654435761) >>> 0, shop = PX.makeRng((seed ^ 0x51ed270b) >>> 0).int(1, 4);
    const plan = PX.rollQuests(seed, 5, shop), n = Object.values(plan).filter(t => t === 'prisoner').length;
    if (n) prisonerPlans++;
    if (n > 1) twoPrisoners++;
  }
  if (twoPrisoners) fail('prisoner per run', `${twoPrisoners} of 20000 runs have two prisoner floors`);
  if (prisonerPlans < 500) fail('prisoner per run', `only ${prisonerPlans} runs have a prisoner (check is vacuous)`);
  console.log(`prisoner plans: ${prisonerPlans} of 20000 runs, ${twoPrisoners} with two prisoners`);

  // Cell layouts: 300 seeds, floors 2 to 4, quest forced. A key is obtainable if its holder can be reached from the start through
  // the chain of doors (a chest counts if reachable, a guard if one of its waypoints is).
  const touch = (f, seen, x, y) => [[0, 0], [1, 0], [-1, 0], [0, 1], [0, -1]].some(([dx, dy]) => seen[(y + dy) * f.w + x + dx]);
  const floodSet = (f, openDoors) => {
    const { w, h, tiles } = f, seen = new Uint8Array(w * h), q = [f.start.y * w + f.start.x]; seen[q[0]] = 1;
    const ok = (x, y) => x >= 0 && y >= 0 && x < w && y < h && tiles[y * w + x] !== G.T_WALL && (tiles[y * w + x] !== G.T_DOOR || openDoors.has(y * w + x));
    for (let qi = 0; qi < q.length; qi++) {
      const i = q[qi], x = i % w, y = (i / w) | 0;
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) { const nx = x + dx, ny = y + dy; if (ok(nx, ny) && !seen[ny * w + nx]) { seen[ny * w + nx] = 1; q.push(ny * w + nx); } }
    }
    return seen;
  };
  const obtainable = f => {                                  // doors that can be unlocked from the start, and the tiles reached
    const open = new Set(); let seen = floodSet(f, open), grew = true;
    while (grew) {
      grew = false;
      for (const d of f.doors) {
        const di = d.y * f.w + d.x; if (open.has(di)) continue;
        const chest = f.props.find(p => (p.extra || []).some(it => it.type === 'key' && it.lock === d.lock));
        const guard = f.enemies.find(e => e.carry && e.carry.lock === d.lock);
        const reached = chest ? touch(f, seen, chest.x, chest.y) : guard ? [{ x: guard.x, y: guard.y }, ...guard.route].some(p => seen[p.y * f.w + p.x]) : false;
        if (reached) { open.add(di); seen = floodSet(f, open); grew = true; }
      }
    }
    return { open, seen };
  };
  let cFit = 0, cNo = 0, plainCells = 0; const holderKinds = { guard: 0, chest: 0, patrol: 0 }, carrierTypes = {}, cBad = [], dists = [];
  for (let s = 1; s <= 300; s++) for (let n = 2; n <= 4; n++) {
    const seed = (s * 2654435761 + 4321) >>> 0, where = `cell seed ${seed} floor ${n}`;
    const f = G.generateFloor(seed, n, { armory: false, boss: false, shop: false, quest: 'prisoner' });
    if (f.quest) { vm.runInContext('assignEnemyTypes', ctx)(f, seed, n, THEME_NAMES[(s + n) % THEME_NAMES.length]); vm.runInContext('questSpawn', ctx)(f); }   // the game runs the type pass first
    if (!f.quest) { cNo++; if (f.rooms.some(r => r.theme === 'cell') || f.enemies.some(e => e.qguard)) cBad.push(`${where}: no encounter, but cell pieces are left behind`); continue; }
    cFit++;
    const q = f.quest, cell = f.rooms.find(r => r.theme === 'cell');
    if (q.type !== 'prisoner' || !cell || !cell.locked) { cBad.push(`${where}: no locked cell room`); continue; }
    const door = f.doors.find(d => d.room === 'cell');
    if (!door || door.lock !== q.lock || f.tiles[door.y * f.w + door.x] !== G.T_DOOR) { cBad.push(`${where}: cell door missing or wrong lock`); continue; }
    const closed = flood(f, false), open = flood(f, true), at = (x, y) => y * f.w + x;
    if (!touchable(f, closed, door.x, door.y)) cBad.push(`${where}: cell door not reachable from the start without a key`);
    let inside = 0, leak = 0;
    for (let y = cell.y; y < cell.y + cell.h; y++) for (let x = cell.x; x < cell.x + cell.w; x++) { if (closed[at(x, y)]) leak++; if (open[at(x, y)]) inside++; }
    if (leak) cBad.push(`${where}: cell interior reachable without the door`);
    if (!inside) cBad.push(`${where}: cell interior unreachable even through the door`);
    if (!inRoom(cell, q.npc.x, q.npc.y) || (f.tiles[at(q.npc.x, q.npc.y)] === G.T_WALL || f.tiles[at(q.npc.x, q.npc.y)] === G.T_DOOR)) cBad.push(`${where}: prisoner not on open floor in the cell`);
    const qg = f.enemies.filter(e => e.qguard);
    if (qg.length !== 1) cBad.push(`${where}: ${qg.length} patrol guards`);
    else {
      const g = qg[0], j = g.route[0], d = Math.max(Math.abs(j.x - door.x), Math.abs(j.y - door.y));
      dists.push(d);
      if (!closed[at(j.x, j.y)]) cBad.push(`${where}: patrol approach not reachable without a key`);
      if (!g.route.every(p => open[at(p.x, p.y)])) cBad.push(`${where}: patrol route not reachable`);
      if (!g.route.some(p => f.rooms.some(r => !r.locked && r.theme !== 'shop' && inRoom(r, p.x, p.y)))) cBad.push(`${where}: patrol has no ordinary room on its route`);
      if (d > 12) cBad.push(`${where}: patrol approach ${d} tiles from the cell door`);
    }
    const carriers = f.enemies.filter(e => e.carry && e.carry.lock === q.lock), chests = f.props.filter(p => (p.extra || []).some(it => it.type === 'key' && it.lock === q.lock));
    if (carriers.length + chests.length !== 1) cBad.push(`${where}: ${carriers.length} carriers and ${chests.length} chests hold the cell key`);
    for (const c of carriers) {
      carrierTypes[c.type] = (carrierTypes[c.type] || 0) + 1;
      if (deadCarriers.includes(c.type)) cBad.push(`${where}: key carried by a ${c.type}`);
      if (c.qguard) holderKinds.patrol++; else holderKinds.guard++;
    }
    holderKinds.chest += chests.length;
    if (q.keyOn !== (carriers.length ? 'guard' : 'chest')) cBad.push(`${where}: keyOn ${q.keyOn} does not match the holder`);
    if (!obtainable(f).open.has(at(door.x, door.y))) cBad.push(`${where}: the cell key cannot be reached from the start`);
    if (s <= 20) {
      const sig = JSON.stringify([f.quest, f.enemies.filter(e => e.qguard)]);
      const f2 = G.generateFloor(seed, n, { armory: false, boss: false, shop: false, quest: 'prisoner' }); vm.runInContext('assignEnemyTypes', ctx)(f2, seed, n, THEME_NAMES[(s + n) % THEME_NAMES.length]); vm.runInContext('questSpawn', ctx)(f2);
      if (sig !== JSON.stringify([f2.quest, f2.enemies.filter(e => e.qguard)])) cBad.push(`${where}: placement changed between two runs`);
    }
  }
  // The chest fallback (no other guard can carry the key): the same floors with only the patrol left, so the key goes in the chest.
  let fallbacks = 0;
  for (let s = 1; s <= 300; s++) for (let n = 2; n <= 4; n++) {
    const seed = (s * 2654435761 + 4321) >>> 0, f = G.generateFloor(seed, n, { armory: false, boss: false, shop: false, quest: 'prisoner' });
    if (!f.quest || !f.quest.holder) continue;
    vm.runInContext('assignEnemyTypes', ctx)(f, seed, n, THEME_NAMES[(s + n) % THEME_NAMES.length]);
    f.enemies = f.enemies.filter(e => e.qguard); vm.runInContext('questSpawn', ctx)(f);
    const chest = f.props.find(p => p.x === f.quest.holder.x && p.y === f.quest.holder.y);
    fallbacks++;
    if (f.quest.keyOn !== 'chest' || !(chest.extra || []).some(it => it.type === 'key' && it.lock === f.quest.lock) || f.enemies.some(e => e.carry)) fail(`cell fallback seed ${seed} floor ${n}`, `keyOn ${f.quest.keyOn}, the key did not go in the chest`);
    else if (!obtainable(f).open.has(f.doors.find(d => d.room === 'cell').y * f.w + f.doors.find(d => d.room === 'cell').x)) fail(`cell fallback seed ${seed} floor ${n}`, 'the chest key cannot be reached');
  }
  console.log(`prisoner key chest fallback: ${fallbacks} floors with a chest holder and no other guard`);
  for (let s = 1; s <= 100; s++) { const f = G.generateFloor((s * 2654435761 + 11) >>> 0, 3, { armory: false, boss: false, shop: false }); if (f.rooms.some(r => r.theme === 'cell') || f.enemies.some(e => e.qguard)) plainCells++; }
  if (plainCells) cBad.push(`${plainCells} plain floors have a cell`);
  for (const m of cBad.slice(0, 6)) fail('prisoner cell', m);
  if (cBad.length) fail('prisoner cell', `${cBad.length} prisoner cell checks failed in total`);
  if (cFit < 250) fail('prisoner cell', `only ${cFit} of 900 floors fit the cell`);
  console.log(`prisoner cells: ${cFit} floors fit, ${cNo} did not; key holders ${JSON.stringify(holderKinds)}; carriers ${JSON.stringify(carrierTypes)}; patrol approach at most ${dists.length ? Math.max(...dists) : 0} tiles from the door`);

  // Reward (prisonerTalk) with a stub inventory: gear, potion or gold by weight; gear Rare+ and a tier better from floor 3;
  // gold 60 to 120 plus 20 a floor; potion kinds and count; paid once; a full pack keeps the reward for the next talk.
  const stub = { got: [], msgs: [], full: false };
  ctx.inv = { add: d => { if (stub.full) return null; stub.got.push(d); return 'an item'; }, has: () => false };
  ctx.flash = m => stub.msgs.push(m); ctx.discover = () => {}; ctx.addLog = () => {};
  const P = vm.runInContext('QUESTS', ctx).prisoner, rbad = [];
  const tierSum = { 2: 0, 3: 0 }, tierN = { 2: 0, 3: 0 }, kinds = { gear: 0, potion: 0, gold: 0 }, NR = 3000;
  for (const fl of [2, 3]) for (let i = 0; i < NR; i++) {
    ctx.runSeed = (i * 2246822519 + fl * 31) >>> 0; stub.got = [];
    vm.runInContext(`prisonerRun = { floor: ${fl}, paid: false, reward: null }`, ctx);
    PX.prisonerTalk({ p: {} });
    const d = stub.got[0];
    if (!d) { rbad.push('no reward'); continue; }
    if (d.type === 'potion') { kinds.potion++; if (d.n !== P.potionN || !P.potionKinds.includes(d.kind)) rbad.push('potion off the list'); }
    else if (d.type === 'gold') { kinds.gold++; if (d.n < P.goldMin + P.goldPerFloor * fl || d.n > P.goldMax + P.goldPerFloor * fl) rbad.push(`gold ${d.n} on floor ${fl}`); }
    else { kinds.gear++; if (!['weapon', 'armor', 'shield'].includes(d.type) || d.tier < P.gearMinTier) rbad.push('gear below Rare'); tierSum[fl] += d.tier; tierN[fl]++; }
  }
  for (const k of Object.keys(kinds)) if (Math.abs(kinds[k] / (2 * NR) - 1 / 3) > 0.03) fail('prisoner reward', `${k} is ${(100 * kinds[k] / (2 * NR)).toFixed(1)}%, want about 33%`);
  const mean2 = tierSum[2] / tierN[2], mean3 = tierSum[3] / tierN[3];
  if (!(mean3 > mean2 + 0.1)) fail('prisoner reward', `gear tier floor 3 ${mean3.toFixed(2)} should beat floor 2 ${mean2.toFixed(2)}`);
  if (rbad.length) fail('prisoner reward', `${rbad.length} bad rewards, e.g. ${rbad[0]}`);
  console.log(`prisoner reward: gear ${kinds.gear}, potion ${kinds.potion}, gold ${kinds.gold}; mean gear tier floor 2 ${mean2.toFixed(2)}, floor 3 ${mean3.toFixed(2)}`);
  // Paid once; a full pack keeps the reward for the next talk.
  vm.runInContext('prisonerRun = { floor: 2, paid: false, reward: null }', ctx);
  stub.got = []; PX.prisonerTalk({ p: {} }); const first = stub.got.length;
  PX.prisonerTalk({ p: {} }); const second = stub.got.length;
  if (first !== 1 || second !== 1) fail('prisoner paid once', `${first} then ${second} rewards`);
  vm.runInContext('prisonerRun = { floor: 2, paid: false, reward: null }', ctx);
  stub.full = true; stub.got = []; PX.prisonerTalk({ p: {} });
  const heldPaid = vm.runInContext('prisonerRun.paid', ctx), fullMsg = stub.msgs[stub.msgs.length - 1] || '';
  stub.full = false; PX.prisonerTalk({ p: {} });
  if (heldPaid || !/Make room/.test(fullMsg) || stub.got.length !== 1) fail('prisoner full pack', `paid ${heldPaid}, message "${fullMsg}", rewards ${stub.got.length}`);
  // Lines: before the key, with the key, freed (unpaid), chest holder, and after the reward.
  const L = vm.runInContext('QUEST_TYPES', ctx).prisoner.line;
  vm.runInContext('prisonerRun = { floor: 2, paid: false, reward: null }', ctx);
  const q0 = { type: 'prisoner', lock: 3, keyOn: 'guard', freed: false };
  const l0 = L({ quest: q0 }); ctx.inv.has = () => true; const l1 = L({ quest: q0 }); ctx.inv.has = () => false;
  const l2 = L({ quest: { ...q0, freed: true } }), lc = L({ quest: { ...q0, keyOn: 'chest' } });
  vm.runInContext('prisonerRun.paid = true', ctx); const l3 = L({ quest: { ...q0, freed: true } });
  if (!/a guard carries it/.test(l0) || !/You have the cell key/.test(l1) || !/Meet them in the safe room/.test(l2) || !/it is in a chest/.test(lc) || l3 !== '') fail('prisoner line', JSON.stringify([l0, l1, l2, lc, l3]));
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
