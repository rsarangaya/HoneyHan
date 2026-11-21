// Staged floor build and the floor cache: a pre-generated next floor changes nothing, and a floor you come back to is exactly as you left it.
// Run on its own: node tests/game.cache.test.js
const { run } = require('./lib');
run('Pre-generated floors and the floor cache', async ({ open, check }) => {
  const page = await open(7);

  // 1. Idle pre-generation of floor n + 1: it appears, equals a fresh generation, and entering with it gives the same floor and the same gameplay rng as entering without it.
  const pg = await page.evaluate(async () => {
    game.startFloor(1);
    const ready = await T.until(() => pregen !== null, 8000);
    const key = ready ? pregen.key : null, same = ready && JSON.stringify(pregen.floor) === JSON.stringify(generateFloor(...floorGenArgs(2)));
    const enter = pre => {                                   // enter floor 2 with or without the pre-generated layout, then read what the run would see
      game.startFloor(1); if (!pre) { pregen = null; } else pregen = { key: genKey(floorGenArgs(2)), floor: generateFloor(...floorGenArgs(2)) };
      changeFloor(2, 'down');
      return JSON.stringify({ tiles: Array.from(game.floor.tiles), props: game.floor.props.map(p => [p.kind, p.x, p.y, p.tier, p.seed, p.opened]), foes: game.enemies.map(e => [e.type, +e.x.toFixed(2), +e.z.toFixed(2), e.seed]), rng: [gameRng(), gameRng(), gameRng()] });
    };
    const a = enter(false), b = enter(true);
    const stale = (() => { game.startFloor(1); pregen = { key: 'wrong', floor: generateFloor(7, 9, {}) }; changeFloor(2, 'down'); return game.floor.w > 0 && pregen === null; })();
    return { ready, key, same, identical: a === b, stale };
  });
  check('floor n + 1 is generated in idle time while you play floor n', pg.ready, pg.key);
  check('the pre-generated layout equals a fresh generation of the same floor', pg.same);
  check('entering with a pre-generated floor gives the same floor, enemies and gameplay rng as generating on entry', pg.identical);
  check('a stale pre-generated floor (key mismatch) is dropped and a fresh one used', pg.stale);

  // 2. Going down and back up: the floor you left is as you left it (opened chests, dead guards, picked loot, explored map, respawn queue).
  const rv = await page.evaluate(async () => {
    game.startFloor(1); await T.sleep(60);
    const chest = propObjs.find(o => o.p.kind === 'chest' && !o.p.mimic); markOpened(chest);
    const victim = game.enemies.find(e => !e.boss && !e.T.mimic); victim.hp = 0; victim.cause = 'was killed'; victim.die(); victim.rq = true;
    game.respawnQ.push(12.5);
    const ex = game.floor, exploredBefore = Array.from(explored.fill(1, 10, 60));
    const lootBefore = game.floor.props.map(p => p.opened);
    changeFloor(2, 'down'); await T.sleep(60);
    changeFloor(1, 'up'); await T.sleep(60);
    const again = propObjs.find(o => o.p === chest.p);
    return {
      chestKept: !!again && again.p.opened === true, deadKept: game.enemies.includes(victim) && victim.dead,
      exploredKept: exploredBefore.every((v, i) => !v || explored[i] === 1), rqKept: game.respawnQ.length >= 1 && game.respawnQ.some(q => q <= 12.5 && q > 11),
      opened: game.floor.props.map(p => p.opened).join() === lootBefore.join(), sameFloorObj: game.floor === ex,
    };
  });
  check('an opened chest stays opened after leaving and returning', rv.chestKept);
  check('a killed guard stays dead', rv.deadKept);
  check('the explored map stays', rv.exploredKept);
  check('the respawn queue and the floor itself are kept', rv.rqKept && rv.sameFloorObj && rv.opened);

  // 3. At most 6 floors stay cached however deep you go (this is the memory bound; the graphics memory of dropped floors is freed).
  const mem = await page.evaluate(async () => {
    game.startStage(1); await T.sleep(60);
    for (let s = 1; s <= 3; s++) { for (let n = 2; n <= 5; n++) { changeFloor(n, 'down'); await T.sleep(30); } if (s < 3) { changeStage(s + 1, 'down'); await T.sleep(30); } }
    return Object.values(game.stageCaches).reduce((a, c) => a + Object.keys(c).length, 0);
  });
  check('no more than 6 floors are cached', mem <= 6, mem + ' cached');

  // 4. Pre-generation waits out a busy moment (a slow frame or a fight) but its safety timeout still lets it run.
  const busy = await page.evaluate(async () => {
    game.startFloor(1); pregen = null; await T.sleep(10);
    const e = new Enemy({ x: 5, y: 5, route: [{ x: 5, y: 5 }, { x: 5, y: 5 }], seed: 3, type: 'goblin' }, game.floor); e.set('alerted'); game.enemies.push(e);
    const out = { busy: busyNow() };
    e.dead = true; out.calm = !busyNow(); e.dead = false;
    game.enemies.splice(game.enemies.indexOf(e), 1); e.mesh.parent && e.mesh.parent.remove(e.mesh);
    game.perfStats.dt = 0.05; out.slow = busyNow(); game.perfStats.dt = 0.016;
    out.later = await T.until(() => pregen !== null, 9000);
    return out;
  });
  check('a fight or a slow frame counts as busy, a calm moment does not', busy.busy && busy.calm && busy.slow);
  check('pre-generation still happens (safety timeout)', busy.later);

  // 5. The next stage's textures, built ahead on the boss floor, survive a prune until the stage starts.
  const pin = await page.evaluate(async () => {
    game.startStage(1); game.startFloor(5);
    const nt = game.stageThemes[1].name;
    const built = await T.until(() => themeTex.has(nt + '|wall') && themeTex.has(nt + '|floor') && themeTex.has(nt + '|ceil'), 9000);
    pruneThemeTextures();
    const kept = themeTex.has(nt + '|wall') && themeTex.has(nt + '|floor') && themeTex.has(nt + '|ceil');
    game.changeStage(2, 'down'); await T.sleep(50);
    return { built, kept, after: themeTex.has(nt + '|wall') && theme.name === nt };
  });
  check('next stage textures are built ahead on the boss floor', pin.built);
  check('and survive pruneThemeTextures until the stage changes', pin.kept && pin.after);
  await page.close();
});
