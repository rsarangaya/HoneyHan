// Theme framework identity check, plain Node: node tests/gen.layout.test.js [seeds]
// The six themes now run through the schema (THEME_DEFS in js/gen.js). Their floors must be exactly what the generator made before:
// tests/fixtures/legacy/ holds js/gen.js and js/enemytypes.js as they were before the framework. For many seeds x floors x themes
// x flags the whole generated floor (tiles, rooms, doors, props, decor, enemies, keys) must be byte-identical. The only allowed
// difference is the new `style` field on doors. Also checks the views (THEMES, THEME_GIMMICK, THEME_NATIVES, THEME_BOSS) and key names.
const fs = require('fs'), path = require('path'), vm = require('vm');
const root = path.join(__dirname, '..');
const load = files => {
  const ctx = vm.createContext({ console, Math, TILE: 3 });
  Object.defineProperty(ctx, 'stageSeed', { get: () => ctx.runSeed });
  ctx.effFloor = n => n === undefined ? ctx.floorNum : n;
  for (const f of files) vm.runInContext(fs.readFileSync(path.join(root, f), 'utf8'), ctx, { filename: f });
  return ctx;
};
const OLD = load(['tests/fixtures/legacy/gen.js', 'js/loot.js', 'js/wands.js', 'tests/fixtures/legacy/enemytypes.js', 'js/quests.js']);
const NEW = load(['js/gen.js', 'js/loot.js', 'js/wands.js', 'js/enemytypes.js', 'js/quests.js']);
const N = parseInt(process.argv[2], 10) || 40;
let fails = 0, checked = 0;
const fail = (w, m) => { if (++fails <= 20) console.log(`FAIL ${w}: ${m}`); };
const ev = (ctx, code) => vm.runInContext(code, ctx);
const names = ev(OLD, 'THEMES.map(t => t.name)'), CHAP = 'The Frozen Chapel', REWORKED = [CHAP, 'The Mushroom Cellar', 'The Clockwork Library', 'The Sunken Tavern', 'The Moonlit Orchard', 'The Goblin Market'], NOW = { 'The Mushroom Cellar': ['caves', 'spore'], 'The Clockwork Library': ['aisles', 'gate'], 'The Sunken Tavern': ['warren', 'hatch'], 'The Moonlit Orchard': ['orchard', 'garden'], 'The Goblin Market': ['bazaar', 'shutter'] };   // the legacy six (the Jungle is new, the Chapel is reworked on purpose: halls, ice seals, Frost Seal keys; its 'rooms' layout must still match)

// The Mushroom Cellar (caves, spore seals, Spore Key, dark pockets) and the Clockwork Library (aisles, clockwork gates, Gear Key) are reworked on purpose like the Chapel: their own door styles, key names, fog and
// textures change what a floor holds, and with layoutStyle 'rooms' only those must still match (no extra rng calls, the same rooms and furniture).
// views
if (JSON.stringify(ev(NEW, 'THEMES.map(t => t.name)').slice(0, names.length)) !== JSON.stringify(names)) fail('views', 'THEMES names differ');
for (const k of ['THEME_GIMMICK', 'THEME_NATIVES', 'THEME_BOSS']) {
  const nn = k === 'THEME_GIMMICK' ? names.filter(n => n !== 'The Sunken Tavern' && n !== 'The Moonlit Orchard' && n !== 'The Goblin Market') : k === 'THEME_NATIVES' ? names.filter(n => n !== 'The Goblin Market') : names;   // (their mechanics were reworked on purpose; the Market's roster gained bonus.thief)
  checked++; if (JSON.stringify(nn.map(n => ev(NEW, k)[n])) !== JSON.stringify(nn.map(n => ev(OLD, k)[n]))) fail('views', k + ' differs from the legacy table');
}
for (const n of names) {   // the schema carries the old colours and the old fixed fog density (not the reworked Chapel)
  if (REWORKED.includes(n)) { if (n !== CHAP) { const c = ev(NEW, `THEME_BY_NAME[${JSON.stringify(n)}]`); checked++; if (c.layout.style !== NOW[n][0] || c.doors.style !== NOW[n][1]) fail(n, 'not the reworked theme'); continue; } const c = ev(NEW, `THEME_BY_NAME[${JSON.stringify(n)}]`); checked++; if (c.layout.style !== 'halls' || c.doors.style !== 'ice' || c.doors.keyNames.vault !== 'Frost Seal' || c.fog.density !== 0.07) fail(n, 'not the reworked Chapel'); continue; }
  const o = ev(OLD, `THEMES.find(t => t.name === ${JSON.stringify(n)})`), s = ev(NEW, `THEME_BY_NAME[${JSON.stringify(n)}]`);
  checked++;
  if (!s || s.pal.wall !== o.wall || s.pal.floor !== o.floor || s.pal.ceil !== o.ceil || s.pal.fog !== o.fog || s.pal.light !== o.light) fail(n, 'palette differs');
  if (s.fog.density !== 0.085 || s.wallStyle !== 'box' || s.layout.style !== 'rooms' || s.doors.style !== 'plank') fail(n, 'schema defaults differ');
  if (JSON.stringify(s.doors.keyNames) !== JSON.stringify({ armory: 'Armory Key', vault: 'Vault Key', brewery: 'Brewery Key', lair: 'Lair Key', cell: 'Cell Key' })) fail(n, 'key names changed');
}

// The Sunken Tavern (warren, barred hatches, Cask Key, flooded patches) and the Moonlit Orchard (orchard, garden gates, Garden Key, moonlight) are reworked on purpose too; with layoutStyle 'rooms' their floors still match
// the legacy generator apart from the door style and key name (the gimmick decal kinds changed with the mechanic: the Orchard's grass is moon and shade now, and the Tavern has more flooded patches (n 8 to 12, was 4 to 7), so their floors change even on the 'rooms' path: their gimmick decals draw
// different numbers from the rng. They are exempt from the legacy floor comparison below (EXEMPT), the schema checks above still pin their new styles; every other theme is compared byte for byte).
// layouts
const runs = 'generateFloor';
// The Goblin Market (bazaar, shuttered stalls, Stall Key, crowd patches) is the last theme reworked: its crowd patches (14 to 20, was 3 to 5 tripwire bells; the bells are a second kind now) draw different numbers from the rng, so it is exempt on the 'rooms'
// path as well. The Final Chamber is the boss arena (layoutBoss) under FINAL_THEME: with no theme the arena is generated exactly as before (nothing draws from the rng for it), and the unthemed floors below keep the whole legacy comparison alive for every flag.
const EXEMPT = ['The Sunken Tavern', 'The Moonlit Orchard', 'The Goblin Market'];
const strip = (f, chap) => JSON.stringify(f, (k, v) => (k === 'style' && v === 'plank') || (chap && (k === 'style' || k === 'keyLabel' || k === 'label')) ? undefined : v);   // (the Chapel's doors and keys are renamed on purpose)
for (let s = 1; s <= N; s++) {
  const seed = (s * 2654435761) >>> 0;
  for (const themeName of [...names.filter(n => !EXEMPT.includes(n)), undefined]) for (let fl = 1; fl <= 5; fl++) {
    const flags = [{}, { armory: true }, { shop: true }, { quest: ['miniboss', 'prisoner', 'wanted', 'thief', 'shrine'][(s + fl) % 5] }, { boss: true }][(s + fl) % 5];
    const opts = { ...flags, themeName, depth: fl > 2 ? 1 : 0 };
    OLD.floorNum = NEW.floorNum = fl; OLD.runSeed = NEW.runSeed = seed;
    OLD.__o = opts; NEW.__o = { ...opts, layoutStyle: 'rooms' };
    const chap = REWORKED.includes(themeName), a = strip(JSON.parse(JSON.stringify(vm.runInContext(`${runs}(${seed}, ${fl}, __o)`, OLD))), chap), b = strip(JSON.parse(JSON.stringify(vm.runInContext(`${runs}(${seed}, ${fl}, __o)`, NEW))), chap);
    checked++;
    if (a !== b) fail(`seed ${seed} ${themeName} floor ${fl}`, 'floor differs from the legacy generator');
  }
}
console.log(`gen.layout: ${checked} checks, ${fails} failures`);
process.exit(fails ? 1 : 0);
