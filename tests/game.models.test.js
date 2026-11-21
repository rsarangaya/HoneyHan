// Weapon models, Ian's Hog floppy mode, chest lids and the potion shelf (js/combat.js, js/props.js). Run on its own: node tests/game.models.test.js
const { run } = require('./lib');
run('Weapon models, floppy spear, chest lids, potion shelf', async ({ open, check }) => {
  const page = await open(8);

  // ---- weapon models: every id builds, small, merged, cached and shared ----
  const w = await page.evaluate(() => {
    const ids = ['sword', 'dagger', 'mace', 'bow', 'spear', 'spear:limp', ...Object.keys(WANDS).map(k => 'wand:' + k)], out = { ids: {}, bad: [] };
    const count = m => { let tris = 0, meshes = 0; m.traverse(o => { if (o.isMesh) { meshes++; const g = o.geometry; tris += (g.index ? g.index.count : g.attributes.position.count) / 3; } }); return { tris, meshes }; };
    for (const id of ids) {
      const a = buildWeaponModel(id, 2), b = buildWeaponModel(id, 2), ma = [], mb = [];
      a.traverse(o => o.isMesh && ma.push(o)); b.traverse(o => o.isMesh && mb.push(o));
      out.ids[id] = count(a);
      if (!ma.length || ma.some((m, i) => m.geometry !== mb[i].geometry || m.material !== mb[i].material)) out.bad.push('not cached ' + id);
      if (ma.some(m => !m.geometry.userData.shared || !m.material.userData.shared)) out.bad.push('not flagged shared ' + id);
    }
    const geos = Object.keys(WM_GEOS).length, mats = Object.keys(WM_MATS).length;
    for (let i = 0; i < 60; i++) for (const id of ids) buildWeaponModel(id, i % 5);          // swapping many times
    out.growth = [Object.keys(WM_GEOS).length - geos, Object.keys(WM_MATS).length - mats];  // only the tier accent materials may be new
    out.tierDiffers = WM.accent(0) !== WM.accent(4) && WM.accent(0).color.getHex() !== WM.accent(4).color.getHex();
    const sh = buildShieldMesh(3), sh2 = buildShieldMesh(3); out.shield = count(sh); out.shieldShared = sh.children[0].geometry === sh2.children[0].geometry;
    return out;
  });
  check('every weapon, wand and the limp spear builds', Object.keys(w.ids).length === 6 + 6, Object.keys(w.ids).join());
  check('each model is a few hundred triangles at most and a handful of meshes', Object.values(w.ids).every(v => v.tris <= 700 && v.meshes <= 12), JSON.stringify(w.ids));
  check('the sword, dagger, mace and bow are merged into at most 7 meshes each', ['sword', 'dagger', 'mace', 'bow'].every(k => w.ids[k].meshes <= 7), '');
  check('geometry and materials are cached and flagged shared (swapping leaks nothing)', w.bad.length === 0, w.bad.join());
  check('rebuilding weapons many times creates no new geometry and only the tier accent materials', w.growth[0] === 0 && w.growth[1] <= 5, JSON.stringify(w.growth));
  check('the tier accent colour follows TIERS', w.tierDiffers, '');
  check('the shield is small and shares its geometry', w.shield.tris <= 700 && w.shieldShared, JSON.stringify(w.shield));

  // the viewmodel swaps cleanly in the running game
  const sw = await page.evaluate(async () => {
    T.reset(); const out = [];
    for (const [base, tier] of [['mace', 2], ['dagger', 0], ['bow', 3], ['sword', 4], ['mace', 4]]) { game.inv.equip.weapon = makeItem({ type: 'weapon', base, tier }); await T.until(() => vm.id === base && vm.tier === tier, 1500); out.push(vm.id + vm.tier); }
    return out.join();
  });
  check('equipping each weapon swaps the first-person model (and re-tints on a tier change)', sw === 'mace2,dagger0,bow3,sword4,mace4', sw);

  // ---- floppy mode: a damped spring chain, stable at any dt, restores when recharged ----
  const f = await page.evaluate(() => {
    const out = {}, fin = () => [LIMP.ax, LIMP.wx, LIMP.az, LIMP.wz].every(a => Array.from(a).every(v => Number.isFinite(v)));
    const amp = () => Math.max(...Array.from(LIMP.ax).map(v => Math.abs(v - LIMP_PHYS.bend)), ...Array.from(LIMP.az).map(Math.abs)), azMax = () => Math.max(...Array.from(LIMP.az).map(Math.abs));
    limpReset();
    let yaw = 0; const y = 1.6;
    for (let i = 0; i < 300; i++) limpStep(1 / 60, yaw, 0, 0, 0, y);                                    // 5 s standing still
    out.rest = amp(); out.restFinite = fin();
    // turning whips it sideways
    let peakTurn = 0; for (let i = 0; i < 40; i++) { yaw += 0.06; limpStep(1 / 60, yaw, 0, 0, 0, y); peakTurn = Math.max(peakTurn, azMax()); }
    out.turnPeak = peakTurn;
    for (let i = 0; i < 400; i++) limpStep(1 / 60, yaw, 0, 0, 0, y);
    out.settled = amp();
    // walking and sprinting sway it more than standing
    const walk = (speed, secs) => { let m = 0; for (let i = 0; i < secs * 60; i++) { limpStep(1 / 60, yaw, 0, -Math.sin(yaw) * speed, -Math.cos(yaw) * speed, y); m = Math.max(m, amp()); } return m; };
    out.walk = walk(4, 3); out.sprint = walk(7, 3);
    for (let i = 0; i < 400; i++) limpStep(1 / 60, yaw, 0, 0, 0, y);
    let side = 0; for (let i = 0; i < 40; i++) { const v = 5 * Math.min(1, i / 8); limpStep(1 / 60, yaw, 0, Math.cos(yaw) * v, -Math.sin(yaw) * v, y); side = Math.max(side, azMax()); }
    out.strafe = side;
    // dt spikes and wild inputs stay finite and bounded
    let wild = true, bound = 0; const dts = [0.5, 5, 1e-6, 0.033, 100, 0.0001, 2, 0.016];
    for (let r = 0; r < 200; r++) { limpStep(dts[r % dts.length], r * 13.7, (r % 7) - 3, (r % 5) * 40, -(r % 3) * 50, 1.6 + (r % 4)); if (!fin()) wild = false; bound = Math.max(bound, amp()); }
    out.wildFinite = wild; out.wildAmp = bound;
    limpStep(NaN, 1, 1, 1, 1, 1); limpStep(-1, 1, 1, 1, 1, 1); out.nanSafe = fin();
    // model joints follow the state; the stiff spear has none
    limpReset(); const m = buildWeaponModel('spear:limp'); out.joints = m.userData.joints.length;
    LIMP.ax[2] = -0.9; LIMP.az[2] = 0.3; limpApply(m); out.applied = Math.abs(m.userData.joints[2].rotation.x + 0.9) < 1e-6 && Math.abs(m.userData.joints[2].rotation.z - 0.3) < 1e-6;
    const stiff = buildWeaponModel('spear'); let rot = 0; stiff.traverse(o => { if (o.isGroup && o !== stiff) rot += Math.abs(o.rotation.x) + Math.abs(o.rotation.z); }); out.stiffJoints = stiff.userData.joints ? stiff.userData.joints.length : 0; out.stiffRot = rot;
    out.max = LIMP_PHYS.maxAng;
    return out;
  });
  check('floppy: standing still it hangs under gravity with only a small idle wobble', f.rest < 0.2 && f.restFinite, `${f.rest}`);
  check('floppy: a quick turn whips it sideways', f.turnPeak > 0.15, `${f.turnPeak}`);
  check('floppy: it settles back after the turn', f.settled < 0.2, `${f.settled}`);
  check('floppy: walking sways it and sprinting more than walking', f.walk > f.rest + 0.05 && f.sprint > f.walk, `rest ${f.rest} walk ${f.walk} sprint ${f.sprint}`);
  check('floppy: strafing swings it', f.strafe > 0.1, `${f.strafe}`);
  check('floppy: stays finite and bounded under dt spikes and wild input', f.wildFinite && f.wildAmp <= f.max + 1e-4 && f.nanSafe, `${f.wildAmp}`);
  check('floppy: the limp model has 5 joints that follow the chain; the stiff spear is rigid with none', f.joints === 5 && f.applied && f.stiffJoints === 0 && f.stiffRot === 0, JSON.stringify([f.joints, f.applied, f.stiffJoints, f.stiffRot]));

  // in the game: limp spear flops while equipped, and goes rigid when recharged
  const g = await page.evaluate(async () => {
    T.reset(); const it = makeItem({ type: 'weapon', base: 'spear', tier: 4, charges: 0 }); game.inv.equip.weapon = it;
    await T.until(() => vm.id === 'spear:limp', 1500);
    const P = game.player; let peak = 0; const t0 = performance.now();
    while (performance.now() - t0 < 900) { P.yaw += 0.08; await T.until(() => false, 40); peak = Math.max(peak, ...Array.from(LIMP.az).map(Math.abs)); }
    const out = { limp: vm.id, joints: !!vm.model.userData.joints, peak };
    it.charges = WSTATS.spear.kills; await T.until(() => vm.id === 'spear', 1500); out.after = vm.id; out.rigid = !vm.model.userData.joints;
    return out;
  });
  check("in the game a limp Ian's Hog flops with your turning, and recharging makes it a rigid spear", g.limp === 'spear:limp' && g.joints && g.peak > 0.05 && g.after === 'spear' && g.rigid, JSON.stringify(g));

  // ---- chest lids: a closed solid from every angle ----
  const c = await page.evaluate(() => {
    const out = { bad: [], n: 0 };
    const lidOk = (lid, label) => {
      let dome = 0, plate = 0;
      lid.children.forEach(m => { if (!m.isMesh) return; const t = m.geometry.type; if (t === 'CylinderGeometry' && m.geometry.parameters.thetaLength < 4) { dome++; if (m.material.side !== THREE.DoubleSide) out.bad.push(label + ' dome single sided'); } if (t === 'BoxGeometry' && m.geometry.parameters.width > 1) plate++; });
      out.n++; if (!dome || !plate) out.bad.push(label + ` dome ${dome} plate ${plate}`);
    };
    for (const kind of ['chest', 'vaultchest']) for (let t = 0; t < 5; t++) for (const locked of [false, true]) { const o = makeProp({ kind, tier: t, seed: 4 + t, x: 1, y: 1, locked, yaw: 0 }, true); lidOk(o.lid, `${kind}${t}${locked ? 'L' : ''}`); }
    const e = new Enemy({ x: 3, y: 3, route: [{ x: 3, y: 3 }, { x: 3, y: 3 }], seed: 1, type: 'mimic', tier: 3 }, game.floor); lidOk(e.lid, 'mimic');
    const o = makeProp({ kind: 'chest', tier: 2, seed: 9, x: 1, y: 1, yaw: 0 }, true); out.bands = o.lid.children.filter(m => m.isMesh && m.geometry.type === 'CylinderGeometry').every(m => m.material.side === THREE.DoubleSide);
    return out;
  });
  check('every chest tier, vault chest, locked chest and the mimic have a double-sided dome and a flat underside plate on the lid', c.bad.length === 0 && c.n === 21, c.bad.slice(0, 4).join(' | ') + ' n=' + c.n);
  check('the trim bands on the lid are double sided', c.bands, '');

  // ---- potion shelf: one merged mesh of real bottles ----
  const p = await page.evaluate(() => {
    const o = makeProp({ kind: 'potions', seed: 5, x: 1, y: 1, yaw: 0 }), meshes = []; o.mesh.traverse(m => m.isMesh && meshes.push(m));
    const g = meshes[0].geometry, tris = g.attributes.position.count / 3, before = o.mats[0].color.getHex();
    markOpened(o);
    return { meshes: meshes.length, tris, color: !!g.attributes.color, darker: o.mats[0].color.getHex() < before, vc: o.mats[0].vertexColors, r: o.r, time: PROP_INFO.potions.time };
  });
  check('the potion shelf is ONE mesh (one draw call) with vertex colours', p.meshes === 1 && p.color && p.vc, JSON.stringify(p));
  check('it holds lots of bottles (round flasks, vials, corks) but stays cheap', p.tris > 1200 && p.tris < 5000, `${p.tris} triangles`);
  check('emptying it still darkens it, and the search time and reach are unchanged', p.darker && p.r === 0.7 && p.time === 1.0, JSON.stringify(p));
});
