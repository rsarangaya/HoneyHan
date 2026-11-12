// Dev tuning panel: edit combat numbers live, spawn guards to practise on, copy the values out.
// Shown while dev mode is on. Press Esc to free the mouse, then click the panel (the game pauses).
const tunePanel = (() => {
  const KEY = 'prototype-test-tune-16';   // bumped so old saved values don't override the new defaults (last: encounter numbers)
  const WEAPON_FIELDS = [['dmg', 1], ['spd', 0.05], ['dur', 0.05], ['hitAt', 0.05], ['reach', 0.1], ['stam', 1], ['sneak', 0.5], ['parryWin', 0.05], ['blockCost', 1]];
  const sections = [
    ['Enemy', TUNE, [['enemyHp', 1], ['enemyDmg', 1], ['floorHpScale', 0.01], ['floorDmgScale', 0.01], ['windup', 0.05], ['enemyCooldown', 0.1], ['enemyAtkSpd', 0.1], ['enemyReach', 0.1], ['chaseSpeed', 0.2]]],
    ['Boss', TUNE, [['bossHp', 5], ['bossDmgMul', 0.1], ['bossWake', 1], ['bossSpeed', 0.2], ['bossWindMul', 0.05], ['bossReachMul', 0.05], ['bossAtkSpd', 0.05], ['bossWeaponTier', 1], ['bossLegendary', 0.01]]],
    ['Player', TUNE, [['playerAtkSpd', 0.1], ['walkSpeed', 0.2], ['sprintSpeed', 0.2], ['crouchSpeed', 0.2]]],
    ['Zones', ZONE_MUL, [['head', 0.05], ['body', 0.05], ['legs', 0.05]]],
    ['Global', TUNE, [['damageCap', 0.1], ['staminaRegen', 1], ['staminaDelay', 0.1], ['sprintDrain', 1]]],
    ...['cook', 'bandit', 'rat', 'wolf', 'bouncer', 'archer', 'shaman', 'brute', 'scarecrow', 'warden', 'book', 'scholar', 'golem', 'librarian', 'skeleton', 'puffer', 'fungbrute', 'mguard', 'boar', 'thief', 'captain', 'cultist', 'wisp', 'iceknight', 'mimic', 'bomber', 'miniboss'].map(k => [k, ENEMY_TYPES[k], [['hpMul', 0.05], ['dmgMul', 0.05], ['speed', 0.05], ['reach', 0.05], ['windMul', 0.05], ['cdMul', 0.05], ['vis', 0.05], ['hear', 0.05], ['smell', 0.5]]]),
    ['hunger', HUNGER, [['drainPerSec', 0.005], ['sprintMul', 0.1], ['fightMul', 0.1], ['idleMul', 0.1], ['hungryAt', 1], ['weakAt', 1], ['regenHungry', 0.05], ['regenWeak', 0.05], ['maxStamWeak', 0.05], ['growlHungry', 0.5], ['growlWeak', 0.5], ['growlEvery', 1], ['starveEvery', 0.5]]],
    ['bomb', BOMB, [['fuse', 0.1], ['warn', 0.1], ['trigger', 0.1], ['radius', 0.1], ['dmg', 1], ['falloff', 0.05], ['noise', 1], ['dropDelay', 0.1], ['chain', 0.1], ['fx', 0.05]]],
    ['lockpick', LOCKPICK, [['time', 0.5], ['noise', 1], ['breakChance', 0.05], ['drop', 0.01], ['corpseDrop', 0.05]]],
    ['locked chest', LOCKED, [['hits', 1], ['maceHits', 1], ['noise', 1], ['potionBreak', 0.05], ['gradeUp', 1]]],
    ['trapped chest', TRAP, [['dart', 1], ['bleed', 0.5], ['gasRadius', 0.5], ['gasDaze', 0.5], ['gasSlow', 0.5], ['alarmNoise', 1], ['disarmMul', 0.5], ['fx', 0.1]]],
    ['quest rolls', QUESTS.roll, [['none', 1], ['one', 1], ['two', 1], ['floorMin', 1], ['floorMax', 1]]],
    ['mini-boss reward', QUESTS.miniboss, [['minTier', 1], ['goldMin', 1], ['goldMax', 1], ['goldPerFloor', 1], ['potion', 0.05]]],
    ['shrine bargain', QUESTS.shrine, [['priceHp', 0.5], ['priceGear', 0.5], ['pricePotions', 0.5], ['boonWeapon', 0.5], ['boonStamina', 0.5], ['boonTreasure', 0.5], ['hpLoss', 1], ['minMaxHp', 5], ['stamBonus', 0.05], ['weaponMinTier', 1], ['weaponMaxTier', 1]]],
    ['mimic', MIMIC, [['springWind', 0.05], ['springReach', 0.1]]],
    ['archer shots', ENEMY_TYPES.archer.ranged, [['min', 0.5], ['max', 0.5], ['wind', 0.05], ['cd', 0.1], ['speed', 1]]],
    ['shaman', ENEMY_TYPES.shaman.ranged, [['min', 0.5], ['max', 0.5], ['wind', 0.05], ['cd', 0.1], ['speed', 1], ['healAt', 0.05], ['healAmt', 1], ['healCd', 0.5]]],
    ['slow', STATUS.slow, [['dur', 0.5], ['move', 0.05]]],
    ['cripple', STATUS.cripple, [['dur', 0.5], ['move', 0.05], ['bleed', 0.5], ['immune', 0.5]]],
    ['bleed', STATUS.bleed, [['dur', 0.5], ['dps', 0.5]]],
    ['stun', STATUS.stun, [['dur', 0.1], ['immune', 0.5]]],
    ['daze', STATUS.daze, [['dur', 0.5], ['drain', 1]]],
    ...['sword', 'dagger', 'mace'].map(w => [w, WSTATS[w], WEAPON_FIELDS]),
    ['wands', WAND, [['stam', 1], ['cd', 0.1], ['speed', 1], ['range', 1], ['rechargeGain', 1], ['rechargeFull', 0.05]]],
    ['rage', RAGE, [['charges', 1], ['radius', 1], ['dur', 1], ['noise', 1], ['cd', 0.5]]],
    ['bow', WSTATS.bow, [['dmg', 1], ['draw', 0.05], ['stam', 1], ['noise', 1], ['sneak', 0.5]]],
    ['arrows', BOW, [['speedMin', 1], ['speedMax', 1], ['gravity', 0.5], ['minDraw', 0.05], ['recoverWorld', 0.05], ['recoverHit', 0.05], ['impactNoise', 1]]],
    ['shield', SHIELD, [['cost', 1], ['parryWin', 0.05], ['legsTake', 0.05], ['legsCost', 0.05], ['bashStam', 1], ['bashCd', 0.1], ['bashStun', 0.1], ['bashDmg', 1], ['bashReach', 0.1], ['bashPush', 0.1]]],
  ];
  const defaults = JSON.stringify(sections.map(s => ({ ...s[1] })));

  const read = () => sections.map(s => ({ ...s[1] }));
  const apply = saved => saved.forEach((vals, i) => Object.assign(sections[i][1], vals));
  try { const s = JSON.parse(localStorage.getItem(KEY)); if (s && s.length === sections.length) apply(s); } catch (e) {}
  const save = () => { try { localStorage.setItem(KEY, JSON.stringify(read())); } catch (e) {} };

  const root = document.createElement('div');
  root.style.cssText = 'position:fixed;left:10px;top:110px;width:236px;max-height:68vh;overflow:auto;z-index:20;background:#000c;border:1px solid #e8c860;color:#eee;font:11px system-ui,sans-serif;display:none';
  document.body.appendChild(root);

  function build() {
    root.innerHTML = '';
    const head = document.createElement('div');
    head.textContent = 'Combat tuning (live)';
    head.style.cssText = 'padding:5px 8px;font-weight:700;background:#e8c860;color:#111;position:sticky;top:0';
    root.appendChild(head);
    const btns = document.createElement('div');
    btns.style.cssText = 'padding:6px 8px;display:flex;flex-wrap:wrap;gap:4px';
    const mk = (label, fn) => {
      const b = document.createElement('button'); b.textContent = label;
      b.style.cssText = 'font:11px system-ui;padding:3px 6px;cursor:pointer';
      b.onclick = fn; btns.appendChild(b);
    };
    mk('Guard: back turned', () => spawnGuard('back'));
    mk('Guard: facing you', () => spawnGuard('front'));
    mk('Guard: alerted', () => spawnGuard('alerted'));
    mk('Hunger: empty', () => { hunger.v = 0; });
    mk('Hunger: half', () => { hunger.v = 45; });
    mk('Hunger: full', () => { hunger.v = 100; });
    mk('Clear guards', clearGuards);
    mk('Refill', () => { inv.hp = inv.maxHp; cb.stamina = STAMINA_MAX; });
    mk('Give gear', () => { const r = makeRng((Math.random() * 4294967296) >>> 0); flash('Got ' + (inv.add(rollEquipment(floorNum, r, { boost: 1 })) || 'nothing (pack full)')); });
    mk('Give arrows', () => { inv.arrows = QUIVER_MAX; });
    mk('Give potions', () => { Object.keys(POTIONS).forEach(k => inv.add({ type: 'potion', kind: k, n: 1 })); });
    mk('Give keys', () => { floor.doors.forEach(d => { if (!inv.has('key', d.lock)) inv.add({ type: 'key', lock: d.lock, label: d.keyLabel }); }); });
    mk('Spawn guard now', () => { respawnT = 0; });
    mk('Floor down', () => { if (floorNum < MAX_FLOOR) startFloor(floorNum + 1); else flash('Already on the last floor'); });
    mk('Floor up', () => { if (floorNum > 1) startFloor(floorNum - 1); else flash('Already on floor 1'); });
    mk('Test hit', () => damage(10));
    mk('Copy values', copyValues);
    mk('Reset', () => { apply(JSON.parse(defaults)); save(); build(); });
    root.appendChild(btns);
    root.appendChild(spawnBox());
    for (const [name, obj, fields] of sections) {
      const h = document.createElement('div');
      h.textContent = name; h.style.cssText = 'padding:3px 8px;background:#fff2;font-weight:700';
      root.appendChild(h);
      for (const [key, step] of fields) {
        const row = document.createElement('label');
        row.style.cssText = 'display:flex;justify-content:space-between;align-items:center;padding:2px 8px';
        row.append(key);
        const inp = document.createElement('input');
        inp.type = 'number'; inp.step = step; inp.value = obj[key]; inp.style.cssText = 'width:64px;font:11px system-ui';
        inp.oninput = () => { const v = parseFloat(inp.value); if (!isNaN(v)) { obj[key] = v; save(); } };
        inp.onkeydown = inp.onkeyup = e => e.stopPropagation();   // typing must not fire game keys
        row.appendChild(inp); root.appendChild(row);
      }
    }
  }

  // Item spawner: pick any weapon, armor piece or potion, a tier, a count, and drop it in the pack.
  function spawnBox() {
    const opts = [];   // [label, descriptor builder taking (tier)]
    for (const b of ['dagger', 'sword', 'mace', 'bow']) opts.push([WEAPON_NAMES[b], t => ({ type: 'weapon', base: b, tier: t })]);
    opts.push(['Shield', t => ({ type: 'shield', tier: t })], ["Ian's Hog (Legendary)", () => ({ type: 'weapon', base: 'spear', tier: 4 })], ["AK's Dumbass (Legendary)", () => ({ type: 'armor', slot: 'helmet', cls: 0, tier: 4, unique: 'dunce' })]);
    for (const k of Object.keys(WANDS)) opts.push([WANDS[k].name, () => ({ type: 'wand', kind: k })]);
    opts.push(['Lockpick', () => ({ type: 'lockpick' })], ['Recharge Wand', () => ({ type: 'rechargewand' })], ['Grand Recharge Wand', () => ({ type: 'rechargewand', full: true })], ["Hanahan's Rage", () => ({ type: 'rage' })]);
    for (const s of ARMOR_SLOTS) ARMOR_NAMES[s].forEach((n, cls) => opts.push([n, t => ({ type: 'armor', slot: s, cls, tier: t })]));
    for (const k of Object.keys(POTIONS)) opts.push([POTIONS[k].name, () => ({ type: 'potion', kind: k })]);
    for (const k of Object.keys(FOOD)) opts.push([FOOD[k].name, () => ({ type: 'food', kind: k })]);
    const box = document.createElement('div');
    box.style.cssText = 'padding:6px 8px;display:flex;flex-direction:column;gap:4px;border-top:1px solid #fff3';
    const mkSel = (items) => {
      const s = document.createElement('select'); s.style.cssText = 'font:11px system-ui';
      items.forEach((t, i) => s.add(new Option(t, i)));
      s.onkeydown = s.onkeyup = e => e.stopPropagation(); return s;
    };
    const item = mkSel(opts.map(o => o[0])), tier = mkSel(TIERS.map(t => t.name));
    const qty = document.createElement('input'); qty.type = 'number'; qty.min = 1; qty.value = 1;
    qty.style.cssText = 'width:48px;font:11px system-ui'; qty.onkeydown = qty.onkeyup = e => e.stopPropagation();
    const go = document.createElement('button'); go.textContent = 'Spawn into pack'; go.style.cssText = 'font:11px system-ui;padding:3px 6px;cursor:pointer';
    go.onclick = () => {
      const [label, build] = opts[item.value], got = [];
      for (let i = Math.max(1, parseInt(qty.value) || 1); i > 0; i--) { const t = inv.add(build(+tier.value)); if (!t) { got.push('(pack full)'); break; } got.push(t); }
      flash('Spawned ' + got.join(', '));
    };
    const row = document.createElement('div'); row.style.cssText = 'display:flex;gap:4px;align-items:center';
    row.append(tier, 'x', qty);
    box.append('Spawn item', item, row, go);
    return box;
  }

  function copyValues() {
    const lines = sections.map(([name, obj]) => `${name}: ${JSON.stringify(obj)}`).join('\n');
    (navigator.clipboard ? navigator.clipboard.writeText(lines) : Promise.reject()).then(
      () => flash('Tuning values copied'), () => { prompt('Copy these values:', lines); });
  }

  function clearGuards() {
    enemies.forEach(e => group.remove(e.mesh));
    for (let i = propObjs.length - 1; i >= 0; i--) if (propObjs[i].p.kind === 'corpse') propObjs.splice(i, 1);
    enemies.length = 0;
  }

  // Place a guard 3 to 6 m ahead on open floor. 'back' faces away from you (sneak practice),
  // 'front' faces you (detection and parry practice), 'alerted' starts the fight at once.
  function spawnGuard(mode) {
    const dx = -Math.sin(player.yaw), dz = -Math.cos(player.yaw);
    for (let d = 6; d >= 2.5; d -= 0.5) {
      const px = player.x + dx * d, pz = player.z + dz * d;
      if (player.blocked(floor, px, pz) || !hasLOS(floor, player.x, player.z, px, pz)) continue;
      const tx = Math.floor(px / TILE), ty = Math.floor(pz / TILE);
      if (tx === floor.stairs.x && ty === floor.stairs.y) continue;
      const e = new Enemy({ x: tx, y: ty, route: [{ x: tx, y: ty }, { x: tx, y: ty }], seed: (Math.random() * 4294967296) >>> 0 }, floor);
      e.x = px; e.z = pz; e.wait = 1e9;
      e.yaw = mode === 'back' ? player.yaw : Math.atan2(-(player.x - px), -(player.z - pz));
      e.cone.visible = dev.on;
      if (mode === 'alerted') { e.last = { x: player.x, z: player.z }; e.set('alerted'); }
      group.add(e.mesh); enemies.push(e); e.sync(0);
      return;
    }
    flash('No open floor ahead to spawn a guard');
  }

  build();
  return { show(on) { root.style.display = on ? 'block' : 'none'; } };
})();
tunePanel.show(dev.on);
