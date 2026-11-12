// Stairs: floors are kept when you leave them, and you can climb back up. Run on its own: node tests/game.stairs.test.js
const { run } = require('./lib');
run('Stairs down and back up', async ({ open, check }) => {
  let page = await open(7);

  // 1. Floor 1 has no stairs up, deeper floors do (on the start tile, rising from the open side).
  const layout = await page.evaluate(async () => {
    const out = {};
    game.startFloor(1); await T.sleep(100); out.up1 = !!game.floor.up;
    for (const n of [2, 3, 5]) { game.startFloor(n); await T.sleep(100); out[n] = { up: !!game.floor.up, atStart: game.floor.up && game.floor.up.x === game.floor.start.x && game.floor.up.y === game.floor.start.y, box: !!upBox }; }
    return out;
  });
  check('floor 1 has no stairs up', !layout.up1);
  check('floors 2, 3 and the boss floor have stairs up on the start tile', [2, 3, 5].every(n => layout[n].up && layout[n].atStart && layout[n].box), JSON.stringify(layout));

  // 2. Coming down, you appear beside the stairs up, outside them; the eye rises on the steps.
  const arrive = await page.evaluate(async () => {
    game.startFloor(1); await T.sleep(100);
    const f = game.floor, P = game.player;
    P.x = (f.stairs.x + 0.5) * TILE; P.z = (f.stairs.y + 0.5) * TILE + 1.1;                   // walk into the stairwell
    await T.until(() => document.getElementById('floor').textContent.includes('Floor 2 /'), 4000); await T.sleep(300);
    const u = game.floor.up, ux = (u.x + 0.5) * TILE, uz = (u.y + 0.5) * TILE;
    const out = { floor: document.getElementById('floor').textContent, dist: Math.hypot(P.x - ux, P.z - uz), outside: upProgress() === 0, stillTwo: floorNum === 2 };
    // on the steps the eye rises
    const lowEye = eyeY(); P.x = ux; P.z = upBox.dir > 0 ? upBox.z1 - 0.3 : upBox.z0 + 0.3; const midEye = eyeY(); P.z = upBox.dir > 0 ? upBox.z0 + 0.2 : upBox.z1 - 0.2; const topEye = eyeY();
    out.eyes = [lowEye, midEye, topEye];
    P.x = ux + 4; P.z = uz;                                                                   // step off before the next test
    return out;
  });
  check('going down puts you on floor 2, beside the stairs up and not on them', /Floor 2 \//.test(arrive.floor) && arrive.stillTwo && arrive.outside && arrive.dist > 1.5 && arrive.dist < 4.5, `${arrive.floor}, ${arrive.dist.toFixed(1)} m away`);
  check('your eye rises as you climb the steps', arrive.eyes[1] > arrive.eyes[0] + 0.1 && arrive.eyes[2] > arrive.eyes[1] && arrive.eyes[2] < 3.5, arrive.eyes.map(v => v.toFixed(2)).join(' < '));

  // 3. Floor 1 is kept exactly as you left it, and climbing back puts you by its stairs down, not on them.
  const keep = await page.evaluate(async () => {
    game.startFloor(1); await T.sleep(100);
    const f1 = game.floor, en1 = game.enemies, P = game.player;
    const victim = en1.find(e => !e.boss); victim.die(); victim.corpseDone = true; const vx = victim.x, vz = victim.z;
    const alive = en1.filter(e => !e.dead).map(e => [e.x, e.z]);
    const chest = propObjs.find(o => ['chest', 'barrel', 'rubble'].includes(o.p.kind)); markOpened(chest);
    explored.fill(1); const exploredSum = explored.reduce((a, b) => a + b, 0);
    P.x = (f1.stairs.x + 0.5) * TILE; P.z = (f1.stairs.y + 0.5) * TILE + 1.1;
    await T.until(() => floorNum === 2, 4000); await T.sleep(200);
    const f2 = game.floor;
    // now climb back up
    const u = upBox; P.x = (u.x0 + u.x1) / 2; P.z = u.dir > 0 ? u.z0 + 0.1 : u.z1 - 0.1;
    await T.until(() => floorNum === 1, 4000); await T.sleep(500);
    const sx = (f1.stairs.x + 0.5) * TILE, sz = (f1.stairs.y + 0.5) * TILE;
    return {
      back: floorNum === 1, sameFloor: game.floor === f1, sameEnemies: game.enemies === en1, deadStays: victim.dead && game.enemies.includes(victim),
      chestOpen: chest.p.opened, explored: explored.reduce((a, b) => a + b, 0) === exploredSum,
      dist: Math.hypot(P.x - sx, P.z - sz), stillOne: floorNum === 1, text: document.getElementById('floor').textContent, msg: document.getElementById('log').textContent,
      f2: f2, same2: null,
    };
  });
  check('climbing the stairs up returns you to floor 1', keep.back && keep.stillOne && /Floor 1 \//.test(keep.text), keep.text);
  check('floor 1 is the very same floor you left', keep.sameFloor && keep.sameEnemies);
  check('guards killed, chests opened and the explored map are all kept', keep.deadStays && keep.chestOpen && keep.explored);
  check('you arrive beside the stairs down, not in them (no instant descent)', keep.dist > 1.5 && keep.dist < 4.5 && keep.stillOne, `${keep.dist.toFixed(1)} m from the stairwell`);
  check('a message tells you that you climbed', /climb back up/i.test(keep.msg));

  // 4. Going down again returns to the kept floor 2 (not a new one), and floor 2 can be left and re-entered repeatedly.
  const again = await page.evaluate(async () => {
    const P = game.player, f1 = game.floor;
    P.x = (f1.stairs.x + 0.5) * TILE; P.z = (f1.stairs.y + 0.5) * TILE + 1.1; await T.until(() => floorNum === 2, 4000); await T.sleep(200);
    const f2a = game.floor, en2 = game.enemies;
    const u = upBox; P.x = (u.x0 + u.x1) / 2; P.z = u.dir > 0 ? u.z0 + 0.1 : u.z1 - 0.1; await T.until(() => floorNum === 1, 4000); await T.sleep(200);
    P.x = (f1.stairs.x + 0.5) * TILE; P.z = (f1.stairs.y + 0.5) * TILE + 1.1; await T.until(() => floorNum === 2, 4000); await T.sleep(200);
    return { same: game.floor === f2a && game.enemies === en2, cacheKeeps1: !!game.floorCache[1] };
  });
  check('floor 2 is also kept: going down again returns to the same floor 2', again.same && again.cacheKeeps1);

  // 5. Guards never path through the stairs up.
  const path = await page.evaluate(() => {
    const f = game.floor, u = f.up; const L = { x: u.x - 1, y: u.y }, R = { x: u.x + 1, y: u.y };
    const open = (p) => f.tiles[p.y * f.w + p.x] === T_FLOOR && !f.blocked[p.y * f.w + p.x];
    if (!open(L) || !open(R)) return { skipped: true };
    const p = findPath(f, L.x, L.y, R.x, R.y);
    return { through: p.some(t => t.x === u.x && t.y === u.y), len: p.length };
  });
  check('guards path around the stairs up, never over them', path.skipped || (path.len > 0 && !path.through), JSON.stringify(path));

  // 6. The boss floor: you can climb up from it, and its sealed stairs down still hold.
  // Walk the real stairs down from floor 1 to the boss arena, so floor 4 is cached (the way back is only open into cached floors).
  const boss = await page.evaluate(async () => {
    game.startFloor(1); await T.sleep(100);
    const P = game.player;
    for (let n = 1; n <= 4; n++) {
      const f = game.floor; P.x = (f.stairs.x + 0.5) * TILE; P.z = (f.stairs.y + 0.5) * TILE + 1.1;
      await T.until(() => floorNum === n + 1, 5000); await T.sleep(200);
    }
    const out = { up: !!game.floor.up, atBoss: floorNum === 5 && !!game.floor.boss };
    const u = upBox; P.x = (u.x0 + u.x1) / 2; P.z = u.dir > 0 ? u.z0 + 0.1 : u.z1 - 0.1;
    await T.until(() => floorNum === 4, 5000); await T.sleep(200); out.climbed = floorNum === 4;
    return out;
  });
  check('you can climb up out of the boss arena (floor 4 is cached from the real walk down)', boss.up && boss.atBoss && boss.climbed);

  // A dev jump straight to the boss arena has no cached floor 4: the way back is sealed, you stay in the arena.
  const sealed = await page.evaluate(async () => {
    game.startStage(1); game.startFloor(5); await T.sleep(200);            // startStage empties every cache, so floor 4 is not there
    const P = game.player, u = upBox; P.x = (u.x0 + u.x1) / 2; P.z = u.dir > 0 ? u.z0 + 0.1 : u.z1 - 0.1;
    await T.sleep(600);
    return { stayed: floorNum === 5, msg: document.getElementById('msg').textContent + ' ' + document.getElementById('log').textContent };
  });
  check('a dev-jump arena with no cached floor 4 refuses the climb ("The way back is sealed.")', sealed.stayed && /way back is sealed/i.test(sealed.msg), sealed.msg.slice(0, 80));

  // 7. startFloor still means a brand new floor (the dev keys and tests rely on it).
  const fresh = await page.evaluate(async () => { game.startFloor(1); const a = game.floor; game.startFloor(1); return a !== game.floor; });
  check('startFloor builds a fresh floor each time', fresh);
  await page.close();
});
