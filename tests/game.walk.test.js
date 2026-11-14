// Guard walking: path smoothing (diagonals instead of tile-centre staircases), never clipping walls, and the faster turn rates.
// Run on its own: node tests/game.walk.test.js
const { run } = require('./lib');
run('Guard walking and turning', async ({ open, check }) => {
  const page = await open(12345);
  // 1. Open floor: a corner-to-corner walk is a diagonal, much shorter than the 4-way staircase length.
  const diag = await page.evaluate(() => {
    T.reset();
    const f = game.floor, N = 4;
    const free = (x, y) => !pathBlocked(f, x, y) && !f.solids.some(p => p.r > 0 && Math.abs(p.x / TILE - x - 0.5) < 0.9 && Math.abs(p.z / TILE - y - 0.5) < 0.9);
    let spot = null;
    for (const r of f.rooms) { if (spot) break; for (let y = r.y; y + N < r.y + r.h && !spot; y++) for (let x = r.x; x + N < r.x + r.w && !spot; x++) { let ok = true; for (let j = 0; j <= N && ok; j++) for (let i = 0; i <= N && ok; i++) if (!free(x + i, y + j)) ok = false; if (ok) spot = { x, y }; } if (spot) break; }
    if (!spot) return { none: true };
    const e = new Enemy({ x: spot.x, y: spot.y, route: [{ x: spot.x, y: spot.y }, { x: spot.x, y: spot.y }], seed: 5 }, f);
    e.x = (spot.x + 0.5) * TILE; e.z = (spot.y + 0.5) * TILE;
    const gx = (spot.x + N + 0.5) * TILE, gz = (spot.y + N + 0.5) * TILE, x0 = e.x, z0 = e.z;
    let len = 0, t = 0, px = e.x, pz = e.z;
    while (Math.hypot(gx - e.x, gz - e.z) > 0.8 && t < 30) { e.goTo(gx, gz, 3, 1 / 60); len += Math.hypot(e.x - px, e.z - pz); px = e.x; pz = e.z; t += 1 / 60; }
    return { len, manhattan: Math.abs(gx - x0) + Math.abs(gz - z0), reached: Math.hypot(gx - e.x, gz - e.z) <= 0.8 };
  });
  check('an open-floor walk takes a diagonal (under 0.9 of the 4-way length)', !diag.none && diag.reached && diag.len < diag.manhattan * 0.9, JSON.stringify(diag));
  // 2. Many routes across floors: goals are reached and a guard is never inside a wall tile.
  let routes = 0, reached = 0, inWall = 0, worst = '';
  for (const seed of [12345, 777, 31337]) {
    const pg = await open(seed);
    const r = await pg.evaluate(() => {
      const out = { routes: 0, reached: 0, inWall: 0 };
      for (let fl = 1; fl <= 4; fl++) {
        game.startFloor(fl); const f = game.floor, rs = f.rooms.filter(r => !r.locked);
        for (let i = 0; i + 1 < rs.length && i < 6; i++) {
          const a = rs[i], b = rs[(i * 3 + 1) % rs.length]; if (a === b) continue;
          const e = new Enemy({ x: a.cx, y: a.cy, route: [{ x: a.cx, y: a.cy }, { x: a.cx, y: a.cy }], seed: 9 + i }, f);
          e.x = (a.cx + 0.5) * TILE; e.z = (a.cy + 0.5) * TILE;
          const gx = (b.cx + 0.5) * TILE, gz = (b.cy + 0.5) * TILE;
          if (pathBlocked(f, a.cx, a.cy)) continue;
          if (f.solids.some(p => p.r > 0 && Math.hypot(p.x - (a.cx + 0.5) * TILE, p.z - (a.cy + 0.5) * TILE) < 1.2)) continue;   // starting inside furniture
          if (!findPath(f, a.cx, a.cy, b.cx, b.cy).length) continue;                      // a room behind a door: not a walking route
          let t = 0; out.routes++;
          while (Math.hypot(gx - e.x, gz - e.z) > 3.2 && t < 90) {
            e.goTo(gx, gz, 3, 1 / 30); t += 1 / 30;
            const tt = f.tiles[Math.floor(e.z / TILE) * f.w + Math.floor(e.x / TILE)];
            if (tt === T_WALL || tt === T_DOOR || tt === T_SAFEDOOR || Player.wallHit(f, e.x, e.z, 0.3, true)) { out.inWall++; break; }
          }
          if (Math.hypot(gx - e.x, gz - e.z) <= 3.2) out.reached++;;
        }
      }
      return out;
    });
    routes += r.routes; reached += r.reached; inWall += r.inWall; worst += `${seed}:${r.reached}/${r.routes} `;
    await pg.close();
  }
  check('guards never clip into a wall on routes across floors', inWall === 0 && routes > 20, `${inWall} clips in ${routes} routes`);
  check('guards still reach their goals around corners (90% or better)', reached >= routes * 0.9, worst);
  // 3. Turning: normal rates are fast, the wind-up and charge telegraphs keep their slow rates.
  const turn = await page.evaluate(() => {
    T.reset(); const e = T.guard(4, 'away', false);
    e.yaw = 0; e.wait = 0;
    const tx = e.x - 10, tz = e.z;                                                   // target to the side
    for (let i = 0; i < 12; i++) e.goTo(tx, tz, 1, 1 / 60);                         // 0.2 s
    const want = Math.atan2(-(tx - e.x), -(tz - e.z));
    const n = e.path[0], aim = n ? Math.atan2(-((n.x + 0.5) * TILE - e.x), -((n.y + 0.5) * TILE - e.z)) : want;
    return { err: Math.abs(Math.atan2(Math.sin(aim - e.yaw), Math.cos(aim - e.yaw))), turn: TUNE.enemyTurn, alert: TUNE.enemyTurnAlert };
  });
  check('a guard faces its walking direction within 0.2 s of a 90 degree change', turn.turn === 12 && turn.alert === 9 && turn.err < 0.1, JSON.stringify(turn));
});
