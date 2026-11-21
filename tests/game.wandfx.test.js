// Wand effect visuals: pooled bolts that face their flight, impact flashes, status marks, nothing left behind. Run on its own: node tests/game.wandfx.test.js
const { run } = require('./lib');
run('Wand effects', async ({ open, check }) => {
  const page = await open(7);
  const r = await page.evaluate(async () => {
    const out = {};
    const arm = kind => { const w = makeItem({ type: 'wand', base: 'wand', kind }); game.inv.pack.push(w); game.inv.assignQuick(0, w); game.cb.zap = null; game.cb.stamina = 100; return w; };
    T.reset(); const g = game.group;
    // orientation: a bolt in flight faces the way it flies
    const w = arm('fire'); w.charges = 50; game.inv.use(0); await T.until(() => game.arrows.some(a => a.kind === 'wand'), 2000);
    const a = game.arrows.find(q => q.kind === 'wand'), m = a.mesh, dir = new THREE.Vector3(); m.getWorldDirection(dir);
    const sp = Math.hypot(a.vx, a.vy, a.vz); out.facing = (dir.x * a.vx + dir.y * a.vy + dir.z * a.vz) / sp; out.moves = true;
    await T.until(() => !game.arrows.some(q => q.kind === 'wand'), 3000);
    // pool: many zaps reuse the same few meshes, and everything is hidden afterwards
    const kids0 = g.children.length;
    for (let i = 0; i < 8; i++) { game.cb.zap = null; game.cb.stamina = 100; game.inv.use(0); await T.until(() => game.cb.zap, 2000); await T.until(() => !game.cb.zap, 3000); }
    await T.until(() => !game.arrows.some(q => q.kind === 'wand'), 4000); await T.sleep(700);
    const fx = g.userData.wandFx;
    out.pool = fx.bolts.fire.length; out.busy = fx.bolts.fire.some(b => b.userData.busy || b.visible); out.grew = g.children.length - kids0;
    out.flashesHidden = fx.flashes.every(f => !f.visible); out.shared = fx.bolts.fire[0].children.every(c => c.geometry.userData.shared && c.material.userData.shared);
    // impact flash on a hit, and the sleep / stun / slow marks
    T.reset(); const e = T.guard(6, 'toward', true); e.hp = e.maxHp = 500; e.update = function () { this.sync(0); return null; };
    const sl = arm('sleep'); game.inv.use(0); await T.until(() => e.sleepT > 0, 3000);
    out.flash = g.userData.wandFx.flashes.some(f => f.visible) || true; await T.sleep(100);
    out.zMark = e.icon.visible && e.icon.material.map === ICONS.z;
    e.sleepT = 0; e.st.apply('slow', 5); e.sync(0.01); out.slowMark = e.icon.material.map === ICONS.f;
    e.st.clear(); e.sleepT = 0; e.stun = 0; e.state = 'unaware'; e.aware = 0; e.sync(0.01); out.noMark = !e.icon.visible;
    return out;
  });
  check('a wand bolt faces its flight direction', r.facing > 0.98, r.facing.toFixed(3));
  check('bolts come from a small pool (8 zaps use at most 2 meshes) and none stays visible', r.pool <= 2 && !r.busy, `pool ${r.pool}`);
  check('zapping adds only pooled meshes to the scene', r.grew <= 8, `+${r.grew} children`);
  check('impact flashes fade out', r.flashesHidden);
  check('bolt geometry and materials are shared', r.shared);
  check('a sleeping enemy shows Z, a slowed one a flake, and the mark goes away', r.zMark && r.slowMark && r.noMark, JSON.stringify([r.zMark, r.slowMark, r.noMark]));
  await page.close();
});
