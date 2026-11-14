// Easy mode assists (vision fans, hearing ring) and the HUD noise symbol (all modes).
// Run on its own: node tests/game.assist.test.js
const { run } = require('./lib');
run('Easy assists and the noise symbol', async ({ open, check }) => {
  const pg = await open(8);
  check('Easy is off by default', await pg.evaluate(() => game.assist.easy === false && !game.assist.showVision && !game.assist.showHearing));
  const a = await pg.evaluate(async () => {
    T.reset();
    const near = T.guard(5, 'toward', false), far = T.guard(40, 'toward', false), dead = T.guard(6, 'toward', false);
    dead.hp = 0; dead.cause = 'test'; dead.die(); dead.sync(0.01);
    const out = {}, step = async () => { for (const e of game.enemies) e.sync(0.01); game.draw(); await T.sleep(20); };
    await step(); out.offNear = near.cone.visible; out.ringOff = game.hearRing.visible;
    game.assist.easy = true; await step();
    out.onNear = near.cone.visible; out.onFar = far.cone.visible; out.onDead = dead.cone.visible;
    const calls = game.renderInfo().calls;
    game.assist.vision = false; await step(); out.visOff = near.cone.visible;
    game.assist.vision = true; game.assist.easy = false; await step(); out.backOff = near.cone.visible;
    game.assist.easy = true; await step();
    // cone size matches the real range: 10 m x stealth x type vis (x 0.5 dazed) / mesh scale
    const k = near.cone.scale.x * near.scaleK; out.k = k; near.st.t.daze = 5; await step(); out.kDaze = near.cone.scale.x * near.scaleK; near.st.t.daze = 0;
    near.set('alerted'); await step(); out.col = near.cone.material.color.getHex();
    // hearing ring
    await T.sleep(60); const P = game.player;
    out.ring = game.hearRing.visible; out.rad = game.hearRing.scale.x; out.exp = (6 + P.noiseBonus) * HUSH; out.px = game.hearRing.position.x === P.x;
    game.assist.hearing = false; await T.sleep(60); out.ringToggle = game.hearRing.visible;
    game.assist.hearing = true; P.crouching = true; await T.sleep(60); out.ringCrouch = game.hearRing.scale.x; game.assist.easy = false; await T.sleep(60); out.ringEasyOff = game.hearRing.visible;
    return out;
  });
  check('fan hidden when Easy is off', a.offNear === false && a.ringOff === false);
  check('fan shown for a nearby living enemy only', a.onNear === true && a.onFar === false && a.onDead === false, JSON.stringify([a.onNear, a.onFar, a.onDead]));
  check('vision toggle and Easy off both hide it', a.visOff === false && a.backOff === false);
  check('fan matches the real range (x1 normal, x0.5 dazed)', Math.abs(a.k - 1) < 0.01 && Math.abs(a.kDaze - 0.5) < 0.01, a.k + ' ' + a.kDaze);
  check('alerted fan is red', a.col === 0xff4030, a.col.toString(16));
  check('hearing ring shows and equals the walking radius', a.ring && Math.abs(a.rad - a.exp) < 0.01 && a.px, a.rad + ' vs ' + a.exp);
  check('hearing toggle hides it; Easy off hides it', a.ringToggle === false && a.ringEasyOff === false);
  check('ring ignores crouching (walking radius)', Math.abs(a.ringCrouch - a.exp) < 0.01, a.ringCrouch + '');

  // noise symbol levels: still 0, crouch-creeping 0, walking >= 1, sprinting higher
  const n = await pg.evaluate(async () => {
    T.reset(); const P = game.player, out = {}; const lvl = async ms => { await T.sleep(ms); return game.noiseLevel; };
    out.still = await lvl(700);
    P.keys = { [KEYS.forward]: true }; out.walk = await lvl(500); out.walkDom = document.getElementById('noise').dataset.l;
    P.keys = { [KEYS.forward]: true, [KEYS.sprint]: true }; out.sprint = await lvl(500);
    P.keys = { [KEYS.forward]: true, [KEYS.crouch]: true }; out.crouch = await lvl(900);
    P.keys = {}; out.stop = await lvl(900);
    return out;
  });
  check('noise level 0 when still', n.still === 0, JSON.stringify(n));
  check('noise level >= 1 when walking, DOM follows', n.walk >= 1 && n.walkDom === '' + n.walk, JSON.stringify(n));
  check('sprinting is louder than walking', n.sprint > n.walk, JSON.stringify(n));
  check('crouch-creeping and stopping go quiet again', n.crouch === 0 && n.stop === 0, JSON.stringify(n));

  // persistence and ?easy=1 (a fresh page of the same browser shares localStorage)
  await pg.evaluate(() => { game.assist.easy = true; game.assist.vision = false; game.assist.save(); });
  const url = pg.url(); await pg.goto(url.replace('?seed', '?easy=0&seed')); await pg.waitForFunction(() => window.game && game.floor);
  check('?easy=0 overrides the saved choice', await pg.evaluate(() => game.assist.easy === false));
  await pg.goto(url); await pg.waitForFunction(() => window.game && game.floor);
  check('saved Easy and toggles are remembered', await pg.evaluate(() => game.assist.easy === true && game.assist.vision === false && game.assist.hearing === true));
  await pg.evaluate(() => { game.assist.easy = false; game.assist.vision = true; game.assist.save(); });
  await pg.goto(url.replace('?seed', '?easy=1&seed')); await pg.waitForFunction(() => window.game && game.floor);
  check('?easy=1 turns Easy on with both toggles on', await pg.evaluate(() => game.assist.easy === true && game.assist.showVision && game.assist.showHearing));

  // draw calls: the ring adds at most one
  await pg.click('#overlay', { position: { x: 5, y: 5 } }); await pg.waitForFunction(() => game.state === 'play');
  const c = await pg.evaluate(async () => { const T = { sleep: ms => new Promise(r => setTimeout(r, ms)) }; game.startFloor(1); await T.sleep(40); game.assist.easy = false; await T.sleep(60); const a = game.renderInfo().calls; game.assist.easy = true; await T.sleep(60); const b = game.renderInfo().calls; return [a, b]; });
  check('hearing ring costs at most 1 draw call', c[1] - c[0] <= 1, c.join(' -> '));
  await pg.close();
});
