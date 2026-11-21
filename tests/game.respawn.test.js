// Respawn after kills (js/main.js updateRespawn): a kill queues a timer (60-120 s), one replacement appears out of sight in a room that takes spawns,
// the queue is kept per floor, the boss arena never respawns, and the floor never holds more than its original enemy count.
// Everything runs inside synchronous page.evaluate blocks (no frames in between), so the seeded runs repeat exactly.
// Run on its own: node tests/game.respawn.test.js
const { run } = require('./lib');

run('Respawn after kills', async ({ open, check }) => {
  const page = await open(7);
  const r = await page.evaluate(() => {
    const out = {};
    const alive = () => game.enemies.filter(e => !e.dead && !e.T.mimic && !e.minion).length;
    const rule = (e, kills) => {          // does the replacement obey the room rules?
      const f = game.floor, P = game.player, tx = Math.floor(e.x / TILE), ty = Math.floor(e.z / TILE);
      const room = roomOf(f, tx, ty), idx = f.rooms.indexOf(room), pr = roomOf(f, P.tileX, P.tileY);
      const near = game.enemies.filter(o => o !== e && !o.dead && Math.hypot(o.x - e.x, o.z - e.z) < 6).length;
      return { room: !!room && spawnRoom(room, idx), notPlayers: room !== pr, far: Math.hypot(e.x - P.x, e.z - P.z) > TUNE.respawnMinDist, los: !hasLOS(f, P.x, P.z, e.x, e.z), spaced: near === 0, tile: f.tiles[ty * f.w + tx] === T_FLOOR && !f.blocked[ty * f.w + tx] };
    };
    // 1. timing on floor 1
    game.startFloor(1);
    const base = game.baseGuards, before = game.enemies.length;
    const victim = game.enemies.find(e => !e.boss && !e.T.mimic); victim.die();
    game.updateRespawn(0);
    out.queued = game.respawnQ.length; out.timer = game.respawnQ[0];
    out.base = base;
    let early = 0; for (let t = 0; t < 59; t++) { game.updateRespawn(1); if (game.enemies.length !== before) early++; }
    out.early = early; out.queueAt59 = game.respawnQ.length;
    for (let t = 0; t < 62; t++) game.updateRespawn(1);
    out.added = game.enemies.length - before; out.queueAfter = game.respawnQ.length; out.aliveAfter = alive();
    const e1 = game.enemies[game.enemies.length - 1]; out.rules = rule(e1); out.spot1 = [e1.x, e1.z, e1.spec.type || 'goblin'];
    out.state = e1.state;
    // same seed, same spot
    game.startFloor(1);
    game.enemies.find(e => !e.boss && !e.T.mimic).die();
    for (let t = 0; t < 200 && game.respawnQ.length + 0 >= 0; t++) { game.updateRespawn(1); if (game.enemies.length > before) break; }
    const e2 = game.enemies[game.enemies.length - 1]; out.spot2 = [e2.x, e2.z, e2.spec.type || 'goblin'];
    // 2. never more than the original count, even after many kills
    game.startFloor(1);
    const live = game.enemies.filter(e => !e.dead && !e.T.mimic);
    for (let i = 0; i < 4; i++) live[i].die();
    let maxAlive = 0, minRoom = 1; for (let t = 0; t < 500; t++) { game.updateRespawn(1); maxAlive = Math.max(maxAlive, alive()); }
    out.maxAlive = maxAlive; out.base2 = game.baseGuards; out.aliveEnd = alive(); out.queueEnd = game.respawnQ.length;
    // 3. the queue survives leaving and re-entering the floor, and a new floor has its own
    game.startFloor(3);
    game.enemies.find(e => !e.boss && !e.T.mimic && !e.dead).die(); game.updateRespawn(10);
    const q3 = game.respawnQ.slice(); const cnt3 = game.enemies.length;
    changeFloor(4, 'down'); out.q4 = game.respawnQ.length;
    for (let t = 0; t < 30; t++) game.updateRespawn(1);
    changeFloor(3, 'up');
    out.q3before = q3; out.q3after = game.respawnQ.slice(); out.cnt3 = [cnt3, game.enemies.length];
    // 4. the boss arena never respawns
    game.startFloor(5);
    const g = game.enemies.find(e => !e.boss && !e.T.mimic); if (g) g.die();
    const nb = game.enemies.length; for (let t = 0; t < 300; t++) game.updateRespawn(1);
    out.bossQ = game.respawnQ.length; out.bossAdded = game.enemies.length - nb;
    return out;
  });
  check('a kill queues exactly one timer of 60 to 120 s', r.queued === 1 && r.timer >= 60 && r.timer <= 120, `queued ${r.queued}, timer ${r.timer}`);
  check('nothing respawns before 60 s', r.early === 0 && r.queueAt59 === 1, `early ${r.early}`);
  check('exactly one replacement by 121 s, queue empty, alive count back to the original', r.added === 1 && r.queueAfter === 0 && r.aliveAfter === r.base, JSON.stringify([r.added, r.queueAfter, r.aliveAfter, r.base]));
  check('replacement obeys the room rules (spawn room, not the player\'s, over 24 m, no line of sight, 6 m from others, open tile)', Object.values(r.rules).every(Boolean), JSON.stringify(r.rules));
  check('replacement walks an unaware patrol', r.state === 'unaware', r.state);
  check('same seed gives the same respawn spot and type', JSON.stringify(r.spot1) === JSON.stringify(r.spot2), JSON.stringify([r.spot1, r.spot2]));
  check('alive count never exceeds the original after 4 kills; all replaced', r.maxAlive <= r.base2 && r.aliveEnd === r.base2 && r.queueEnd === 0, JSON.stringify([r.maxAlive, r.base2, r.aliveEnd, r.queueEnd]));
  check('the queue persists across leaving and re-entering a floor (no ticking away, no double count)', r.q4 === 0 && r.q3after.length === 1 && Math.abs(r.q3after[0] - r.q3before[0]) < 1e-9 && r.cnt3[0] === r.cnt3[1], JSON.stringify([r.q4, r.q3before, r.q3after, r.cnt3]));
  check('the boss arena never respawns', r.bossQ === 0 && r.bossAdded === 0, JSON.stringify([r.bossQ, r.bossAdded]));
});
