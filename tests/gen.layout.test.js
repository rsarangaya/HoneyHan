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
const names = ev(OLD, 'THEMES.map(t => t.name)'), CHAP = 'The Frozen Chapel';   // the legacy six (the Jungle is new, the Chapel is reworked on purpose: halls, ice seals, Frost Seal keys; its 'rooms' layout must still match)

// views
if (JSON.stringify(ev(NEW, 'THEMES.map(t => t.name)').slice(0, names.length)) !== JSON.stringify(names)) fail('views', 'THEMES names differ');
for (const k of ['THEME_GIMMICK', 'THEME_NATIVES', 'THEME_BOSS']) {
  checked++; if (JSON.stringify(names.map(n => ev(NEW, k)[n])) !== JSON.stringify(names.map(n => ev(OLD, k)[n]))) fail('views', k + ' differs from the legacy table');
}
for (const n of names) {   // the schema carries the old colours and the old fixed fog density (not the reworked Chapel)
  if (n === CHAP) { const c = ev(NEW, `THEME_BY_NAME[${JSON.stringify(n)}]`); checked++; if (c.layout.style !== 'halls' || c.doors.style !== 'ice' || c.doors.keyNames.vault !== 'Frost Seal' || c.fog.density !== 0.07) fail(n, 'not the reworked Chapel'); continue; }
  const o = ev(OLD, `THEMES.find(t => t.name === ${JSON.stringify(n)})`), s = ev(NEW, `THEME_BY_NAME[${JSON.stringify(n)}]`);
  checked++;
  if (!s || s.pal.wall !== o.wall || s.pal.floor !== o.floor || s.pal.ceil !== o.ceil || s.pal.fog !== o.fog || s.pal.light !== o.light) fail(n, 'palette differs');
  if (s.fog.density !== 0.085 || s.wallStyle !== 'box' || s.layout.style !== 'rooms' || s.doors.style !== 'plank') fail(n, 'schema defaults differ');
  if (JSON.stringify(s.doors.keyNames) !== JSON.stringify({ armory: 'Armory Key', vault: 'Vault Key', brewery: 'Brewery Key', lair: 'Lair Key', cell: 'Cell Key' })) fail(n, 'key names changed');
}

// layouts
const runs = 'generateFloor';
const strip = (f, chap) => JSON.stringify(f, (k, v) => (k === 'style' && v === 'plank') || (chap && (k === 'style' || k === 'keyLabel' || k === 'label')) ? undefined : v);   // (the Chapel's doors and keys are renamed on purpose)
for (let s = 1; s <= N; s++) {
  const seed = (s * 2654435761) >>> 0;
  for (const themeName of [...names, undefined]) for (let fl = 1; fl <= 5; fl++) {
    const flags = [{}, { armory: true }, { shop: true }, { quest: ['miniboss', 'prisoner', 'wanted', 'thief', 'shrine'][(s + fl) % 5] }, { boss: true }][(s + fl) % 5];
    const opts = { ...flags, themeName, depth: fl > 2 ? 1 : 0 };
    OLD.floorNum = NEW.floorNum = fl; OLD.runSeed = NEW.runSeed = seed;
    OLD.__o = opts; NEW.__o = { ...opts, layoutStyle: 'rooms' };
    const chap = themeName === CHAP, a = strip(JSON.parse(JSON.stringify(vm.runInContext(`${runs}(${seed}, ${fl}, __o)`, OLD))), chap), b = strip(JSON.parse(JSON.stringify(vm.runInContext(`${runs}(${seed}, ${fl}, __o)`, NEW))), chap);
    checked++;
    if (a !== b) fail(`seed ${seed} ${themeName} floor ${fl}`, 'floor differs from the legacy generator');
  }
}
console.log(`gen.layout: ${checked} checks, ${fails} failures`);
process.exit(fails ? 1 : 0);
