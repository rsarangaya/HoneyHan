// Enemy type table and spawn rules, plain Node: node tests/enemytypes.test.js [seeds]
// Over many seeds and floors: native share and variety limits, rat packs, wolf handlers, the elite, determinism.
const fs = require('fs'), path = require('path'), vm = require('vm');
const root = path.join(__dirname, '..');
const ctx = vm.createContext({ console, Math, TILE: 3 });
for (const f of ['js/gen.js', 'js/loot.js', 'js/wands.js', 'js/enemytypes.js']) vm.runInContext(fs.readFileSync(path.join(root, f), 'utf8'), ctx, { filename: f });
const L = vm.runInContext('({ generateFloor, assignEnemyTypes, ENEMY_TYPES, THEME_NATIVES, rollLoot, makeRng, respawnType })', ctx);
let fails = 0, n = 0;
const fail = (w, m) => { if (++fails <= 20) console.log(`FAIL ${w}: ${m}`); };
const N = parseInt(process.argv[2], 10) || 150;
const THEMES = Object.keys(L.THEME_NATIVES), TAVERN = 'The Sunken Tavern';
const GENERIC = ['archer', 'shaman', 'brute', 'wolf'];
const shareBy = [0, 0, 0, 0, 0], guardsBy = [0, 0, 0, 0, 0];

for (let s = 1; s <= N; s++) {
  const seed = (s * 2654435761) >>> 0;
  for (const theme of THEMES) {
    const R = L.THEME_NATIVES[theme], rosterTypes = new Set([...R.commons, R.signature, R.elite].filter(Boolean));
    for (let fl = 1; fl <= 5; fl++) {
      const w = `${theme} seed ${seed} floor ${fl}`;
      const mk = () => L.assignEnemyTypes(L.generateFloor(seed, fl, { armory: false, boss: fl === 5, themeName: theme }), seed, fl, theme);
      const f = mk(); n++;
      if (theme === TAVERN && s <= 30) { if (JSON.stringify(f.enemies) !== JSON.stringify(mk().enemies)) fail(w, 'not deterministic'); }
      const E = f.enemies, type = e => e.type || 'goblin';
      const count = t => E.filter(e => e.type === t).length;
      const bonusW = R.bonus ? R.bonus.wolf || 0 : 0, bonusA = R.bonus ? R.bonus.archer || 0 : 0;
      const wantA = (fl >= 4 ? 2 : fl >= 2 ? 1 : 0) + (fl >= 2 && fl < 5 ? bonusA : 0), wantS = fl >= 3 ? 1 : 0, wantB = fl === 4 || fl === 5 ? 1 : 0;
      const slack = fl === 5 ? 2 : 1;
      if (count('archer') > wantA || count('archer') < wantA - slack) fail(w, `archers ${count('archer')}, want ${wantA}`);
      if (count('shaman') > wantS || count('shaman') < wantS - (fl === 5 ? 1 : 0)) fail(w, `shamans ${count('shaman')}, want ${wantS}`);
      if (count('brute') > wantB || count('brute') < wantB - (fl === 5 ? 1 : 0)) fail(w, `brutes ${count('brute')}, want ${wantB}`);
      const types = new Set(E.map(type));
      for (const t of types) if (t !== 'goblin' && !rosterTypes.has(t) && !GENERIC.includes(t)) fail(w, `${t} does not belong in this theme`);
      const natives = [...types].filter(t => rosterTypes.has(t));
      if (natives.length > 3) fail(w, `${natives.length} native types on one floor: ${natives}`);
      if (!E.some(e => type(e) === 'goblin')) fail(w, 'no plain goblins left');
      if (E.filter(e => e.boss).length !== (fl === 5 ? 1 : 0)) fail(w, 'boss count');
      if (count(R.elite) !== (fl === 3 || fl === 4 ? 1 : 0)) fail(w, `${R.elite}: ${count(R.elite)}`);
      if (R.signature) { const c = count(R.signature), want = fl === 1 ? 0 : fl >= 4 ? 2 : 1; if (c > want || c < want - (fl === 5 ? 2 : 1)) fail(w, `${R.signature} x${c}, want ${want}`); }
      else if (fl === 1 && false) fail(w, '');
      for (const pt of R.commons.filter(t => L.ENEMY_TYPES[t].pack)) { const c = count(pt); if (c % L.ENEMY_TYPES[pt].pack) fail(w, `${pt} count ${c} is not whole packs`); }
      for (const e of E.filter(e => e.type === 'wolf')) {
        const h = E[e.handler];
        if (!h || h.boss || type(h) !== 'goblin') fail(w, 'wolf handler is not a plain goblin');
        else if (JSON.stringify(h.route) !== JSON.stringify(e.route)) fail(w, 'wolf does not share its handler\'s route');
      }
      const wolves = count('wolf'), wantW = fl === 1 ? 0 : (fl === 5 ? 2 : Math.min(3, fl - 1) + bonusW);
      if (wolves !== wantW) fail(w, `wolves ${wolves}, want ${wantW}`);
      if (new Set(E.filter(e => e.handler !== undefined).map(e => e.handler)).size !== wolves) fail(w, 'two wolves share a handler');
      if (theme === TAVERN) {
        const solo = E.filter(e => !e.boss && type(e) !== 'rat' && type(e) !== 'wolf');
        shareBy[fl - 1] += solo.filter(e => ['cook', 'bandit', 'bouncer'].includes(type(e))).length; guardsBy[fl - 1] += solo.length;
      }
    }
  }
}
const pct = shareBy.map((v, i) => Math.round(100 * v / guardsBy[i]));
console.log(`Tavern native share of guards by floor: ${pct.join('%, ')}%  (targets 30, 45, 60, then lower on floors 4 and 5, where archers, a shaman, a brute and wolf handlers take guards)`);
pct.forEach((p, i) => { const want = [30, 45, 60, 45, 25][i]; if (Math.abs(p - want) > 14 + (i === 2 || i === 3 ? 8 : 0)) fail(`floor ${i + 1}`, `native share ${p}% is far from ${want}%`); });

// every theme has a boss, every type a name and (for the new ones) glossary text
for (const t of THEMES) { n++; if (!vm.runInContext(`THEME_BOSS[${JSON.stringify(t)}]`, ctx)) fail(t, 'no boss'); }
for (const [k, v] of Object.entries(L.ENEMY_TYPES)) { n++; if (!v.name) fail(k, 'no name'); if (!['goblin', 'cook', 'bandit', 'rat', 'wolf', 'archer', 'shaman', 'brute', 'bouncer'].includes(k) && !(v.info && v.info.length)) fail(k, 'no glossary text'); }

// loot per type
const rng = seed => L.makeRng(seed);
let archerArrows = 0, bruteGear = 0, cookFood = 0, ratDrops = 0, banditGold = 0, wolfDrops = 0, bouncerItems = 0;
for (let i = 1; i <= 400; i++) {
  if (L.rollLoot('corpse', 2, rng(i), 0, [], 'rat').length) ratDrops++;
  if (L.rollLoot('corpse', 2, rng(i), 0, [], 'bandit').some(d => d.type === 'gold')) banditGold++;
  if (L.rollLoot('corpse', 2, rng(i), 0, [], 'cook').some(d => d.type === 'food')) cookFood++;
  if (L.rollLoot('corpse', 2, rng(i), 0, [], 'archer').some(d => d.type === 'arrows')) archerArrows++;
  if (L.rollLoot('corpse', 4, rng(i), 0, [], 'brute').some(d => ['weapon', 'armor', 'shield'].includes(d.type))) bruteGear++;
  wolfDrops += L.rollLoot('corpse', 2, rng(i), 0, [], 'wolf').length;
  const b = L.rollLoot('corpse', 3, rng(i), 0, [], 'bouncer'); if (b.some(d => ['weapon', 'armor', 'shield'].includes(d.type)) && b.some(d => d.type === 'gold')) bouncerItems++;
}
n++;
if (ratDrops > 160) fail('rat loot', `${ratDrops}/400 rats dropped something`);
if (banditGold < 300) fail('bandit loot', `${banditGold}/400 bandits had gold`);
if (cookFood < 270) fail('cook loot', `${cookFood}/400 cooks carried food`);
if (archerArrows < 240) fail('archer loot', `${archerArrows}/400 archers carried arrows`);
if (bruteGear < 160 || bruteGear > 320) fail('brute loot', `${bruteGear}/400 brutes dropped gear`);
if (wolfDrops) fail('wolf loot', 'wolves should drop nothing');
if (bouncerItems !== 400) fail('bouncer loot', `${bouncerItems}/400 had equipment and gold`);
console.log(`${n} checks, ${fails} failures`);
process.exit(fails ? 1 : 0);
