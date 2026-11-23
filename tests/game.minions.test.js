// A boss's summoned minions leave no body or loot (no farming the howl / rally / last call), and they spawn on open floor.
// Run on its own: node tests/game.minions.test.js
const { run } = require('./lib');

run('Boss minions: no corpse loot, valid spawn spots', async ({ open, check }) => {
  const page = await open(4);   // seed 4: the Jungle (Moonfang, which summons wolves)
  const r = await page.evaluate(() => {
    const out = {};
    game.startFloor(5);
    const b = game.enemies.find(e => e.boss);
    // spawn a handful of minions around the boss
    let made = 0; for (let i = 0; i < 4; i++) if (Enemy.summon(b, 'goblin')) made++;
    const mins = game.enemies.filter(e => e.minion === b);
    out.made = made; out.count = mins.length;
    // every minion stands on open floor, clear of walls and props
    out.badSpots = mins.filter(m => Player.wallHit(game.floor, m.x, m.z, 0.4) || Player.prototype.blocked.call({ radius: 0.4, props: game.floor.solids, mob: true }, game.floor, m.x, m.z)).length;
    // killing minions drops nothing, even when the loot roll would give something
    const cnt = () => game.floor.items ? game.floor.items.list.length : 0, before = cnt();
    for (const m of mins) { m.loot = 50; m.dead = true; makeCorpse(m, false); }
    out.minionCorpses = cnt() - before;
    // control: an ordinary enemy with gold on it still drops it
    const tx = Math.floor(b.x / TILE) + 2, ty = Math.floor(b.z / TILE);
    const c = new Enemy({ x: tx, y: ty, route: [{ x: tx, y: ty }, { x: tx, y: ty }], seed: 12345, type: 'goblin' }, game.floor);
    c.loot = 50; c.dead = true; makeCorpse(c, false);
    out.controlCorpses = cnt() - before;
    return out;
  });
  check('summons succeed (up to 4)', r.made > 0 && r.count === r.made, JSON.stringify(r));
  check('minions spawn on open floor, not inside walls or props', r.badSpots === 0, `${r.badSpots} bad`);
  check('dead minions drop no loot', r.minionCorpses === 0, `${r.minionCorpses} corpses`);
  check('an ordinary enemy carrying gold still drops it', r.controlCorpses >= 1, `${r.controlCorpses}`);
});
