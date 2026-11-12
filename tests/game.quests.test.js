// Encounters (js/quests.js): the locked mini-boss room and the shrine bargain, in the running game. Run on its own:
// node tests/game.quests.test.js. The layouts and the roll are checked in plain Node by tests/gen.test.js.
// Seeds (found with generateFloor and rollQuests, themes included): seed 3 has the mini-boss on floor 2 (the lair key is on a
// reachable chest); seed 2 has the shrine on floor 4 and no encounter on floor 1.
const { run } = require('./lib');
const MINI_SEED = 3, MINI_FLOOR = 2, SHRINE_SEED = 2;   // the shrine is on seed 2, floor 4

// Page-side helpers: hold or release E, face a prop (1.1 m off), open and close the inventory with Tab / Escape.
const QH = () => {
  window.Qs = {
    key: on => { game.player.keys[KEYS.interact] = on; },
    // A free spot 1.2 to 2.1 m from o, facing it (the altar's own collision keeps 1.1 m out).
    face(o) {
      const P = game.player, f = game.floor;
      for (const d of [1.2, 1.5, 1.8, 2.1]) for (let k = 0; k < 16; k++) {
        const a = k * Math.PI / 8, x = o.x + Math.sin(a) * d, z = o.z + Math.cos(a) * d;
        if (!P.blocked(f, x, z)) { P.x = x; P.z = z; P.yaw = Math.atan2(-(o.x - x), -(o.z - z)); P.pitch = 0; P.vx = P.vz = 0; return true; }
      }
      return false;
    },
    altar: () => propObjs.find(o => o.p.kind === 'altar'),
    press: code => window.dispatchEvent(new KeyboardEvent('keydown', { code, bubbles: true, cancelable: true })),
    invText: () => { const r = document.getElementById('invScreen'); return r && r.style.display !== 'none' ? r.textContent : null; },
    // a clean pack, full health, a deal for this altar, and no leftovers from the last scenario
    fresh(deal) {
      game.inv.maxHp = 100; game.inv.hp = 100; game.inv.stamBonus = 0; game.inv.pack = []; game.inv.equip.helmet = null;
      game.cb.stamina = 100; game.cb.delay = 0;
      if (deal) game.floor.quest.deal = deal;
    },
  };
};

run('Encounters: the mini-boss room and the shrine bargain', async ({ open, check }) => {
  // ---- The locked mini-boss room (seed 3, floor 2) ----
  const mini = await open(MINI_SEED);
  await mini.evaluate(QH);
  const m = await mini.evaluate(async n => {
    game.startFloor(n);
    const f = game.floor, q = f.quest, boss = q && q.boss, out = {};
    out.type = q && q.type;
    out.lair = f.doors.some(d => d.room === 'lair' && d.lock === q.lock);
    out.bossFound = !!boss;
    if (!boss) return out;
    const guard = new Enemy({ x: boss.spec.x, y: boss.spec.y, route: [{ x: boss.spec.x, y: boss.spec.y }], seed: 1, type: 'goblin' }, f);
    out.hpRatio = boss.maxHp / guard.maxHp;
    out.dmgMul = boss.T.dmgMul; out.elite = boss.elite; out.noStagger = !!boss.T.noStagger;
    out.sneakCap = boss.T.sneakCap; out.daggerSneak = WSTATS.dagger.sneak;
    out.tag = !!(boss.tag && boss.tag.parent === boss.mesh); out.name = q.name; out.bossName = boss.spec.mini && boss.spec.mini.name;
    out.line = questLine(f);
    return out;
  }, MINI_FLOOR);
  check('the lair door is on the floor and the mini-boss is the quest', m.type === 'miniboss' && m.lair && m.bossFound, JSON.stringify(m));
  check('the mini-boss has about three times a guard\'s health and 1.5 times its damage', Math.abs(m.hpRatio - 3) < 0.01 && m.dmgMul === 1.5, `hp x${m.hpRatio}, dmg x${m.dmgMul}`);
  check('the mini-boss is an elite: no stagger, and a sneak attack is capped below a dagger instakill', m.elite && m.noStagger && m.sneakCap < m.daggerSneak, `sneakCap ${m.sneakCap}, dagger ${m.daggerSneak}`);
  check('the mini-boss has its name over its head and the line names it', m.tag && m.bossName === m.name && m.line.includes(m.name), m.line);

  // The inventory says so, and only while the mini-boss lives.
  await mini.evaluate(() => Qs.press('Tab'));
  const invOpen = await mini.evaluate(() => T.until(() => Qs.invText() !== null, 3000));
  const invTxt = await mini.evaluate(() => Qs.invText() || '');
  await mini.evaluate(() => Qs.press('Tab'));                       // Tab closes it (Escape would also open the pause menu, see the report)
  check('the inventory shows the "Optional:" line while the mini-boss lives', invOpen && /Optional:/.test(invTxt) && invTxt.includes(m.name), invTxt.slice(0, 80));

  // Killing it: a corpse with its loot, the tag goes, and the line goes.
  const kill = await mini.evaluate(async () => {
    const boss = floor.quest.boss;
    boss.hurt(1e9, game.player);
    const done = await T.until(() => boss.corpseDone, 5000);
    const corpse = propObjs.find(o => o.p.kind === 'corpse' && o.p.type === 'miniboss');
    return { done, corpse: !!corpse, tagHidden: !!boss.tag && !boss.tag.visible, line: questLine(floor), log: document.getElementById('log').textContent };
  });
  check('killing the mini-boss leaves a corpse with its loot, hides its tag and clears the line', kill.done && kill.corpse && kill.tagHidden && kill.line === '', JSON.stringify({ ...kill, log: undefined }));
  check('the kill is logged with the mini-boss\'s name', kill.log.includes(m.name), '');
  await mini.close();

  // A floor with no encounter has no line.
  const plain = await open(SHRINE_SEED);
  await plain.evaluate(QH);
  const none = await plain.evaluate(() => { game.startFloor(1); Qs.press('Tab'); return { line: questLine(floor), txt: Qs.invText() }; });
  await plain.evaluate(() => Qs.press('Tab'));
  check('a floor with no encounter shows no "Optional:" line', none.line === '' && none.txt !== null && !/Optional:/.test(none.txt), none.line);

  // ---- The shrine bargain (seed 2, floor 4) ----
  const shrineOn = () => plain.evaluate(() => { game.startFloor(4); return !!(floor.quest && floor.quest.type === 'shrine' && Qs.altar()); });
  check('the shrine floor has an altar where the quest says', await shrineOn());
  const cant = await plain.evaluate(async () => {
    game.startFloor(4); const a = Qs.altar(); Qs.face(a); game.inv.hp = 100;
    playerHit();                                   // swing at the altar
    await T.sleep(50);
    return { state: game.state, opened: !!a.p.opened, used: !!floor.quest.used, hp: game.inv.hp };
  });
  check('an altar cannot be attacked: a swing does nothing and the deal screen stays shut', cant.state === 'play' && !cant.opened && !cant.used, JSON.stringify(cant));
  const inline = await plain.evaluate(() => questLine(floor));
  check('the shrine line is shown until the altar is used', /altar/.test(inline), inline);

  // Hold E: the deal screen opens (the game pauses, the screen is shown).
  const holdE = async () => {
    await plain.evaluate(() => { Qs.face(Qs.altar()); Qs.key(true); });
    const ok = await plain.evaluate(() => T.until(() => game.state === 'deal', 15000));
    await plain.evaluate(() => Qs.key(false));
    return ok;
  };
  const screenShown = () => plain.evaluate(() => { const e = document.getElementById('dealScreen'); return !!e && getComputedStyle(e).display === 'flex'; });
  // Decline: nothing changes, and the altar is still there to use.
  await plain.evaluate(() => Qs.fresh({ price: 'maxhp', slot0: 0, boon: 'stamina' }));
  const opened1 = await holdE();
  const shown1 = await screenShown();
  await plain.evaluate(() => document.querySelector('#dealScreen [data-act="decline"]').click());
  const afterDecline = await plain.evaluate(() => ({ state: game.state, used: !!floor.quest.used, maxHp: game.inv.maxHp, stam: game.inv.stamBonus }));
  check('holding E at the altar opens the deal screen', opened1 && shown1, '');
  check('declining closes the screen with nothing paid or given, and the altar is still usable', afterDecline.state === 'play' && !afterDecline.used && afterDecline.maxHp === 100 && afterDecline.stam === 0, JSON.stringify(afterDecline));
  const opened2 = await holdE();
  await plain.evaluate(() => Qs.press('Escape'));
  const afterEsc = await plain.evaluate(() => game.state);
  check('the altar opens again after a decline, and Escape walks away too', opened2 && afterEsc === 'play', afterEsc);

  // Accept, max HP price + stamina boon: 15 max HP gone (health capped and the HUD follows), +25% stamina regen, altar used up.
  await plain.evaluate(() => Qs.fresh({ price: 'maxhp', slot0: 0, boon: 'stamina' }));
  await holdE();
  await plain.evaluate(() => document.querySelector('#dealScreen [data-act="accept"]').click());
  await plain.evaluate(() => T.until(() => document.getElementById('hpFill').style.width === '85%', 2000));
  const maxhpRes = await plain.evaluate(() => ({ maxHp: game.inv.maxHp, hp: game.inv.hp, bar: document.getElementById('hpFill').style.width, stam: game.inv.stamBonus, used: !!floor.quest.used, opened: !!Qs.altar().p.opened, state: game.state, shown: (document.getElementById('dealScreen') && getComputedStyle(document.getElementById('dealScreen')).display) || 'none' }));
  check('max HP price: max HP drops by 15, health and the HUD follow, +25% stamina regen, the altar is used up', maxhpRes.maxHp === 85 && maxhpRes.hp === 85 && maxhpRes.bar === '100%' && maxhpRes.stam === 0.25 && maxhpRes.used && maxhpRes.opened && maxhpRes.state === 'play' && maxhpRes.shown === 'none', JSON.stringify(maxhpRes));
  const usedAgain = await plain.evaluate(async () => { Qs.face(Qs.altar()); Qs.key(true); const ok = await T.until(() => game.state === 'deal', 1500); Qs.key(false); return { ok, state: game.state }; });
  check('a used altar does not open the deal screen again', !usedAgain.ok && usedAgain.state === 'play', JSON.stringify(usedAgain));
  const lineAfter = await plain.evaluate(() => questLine(floor));
  check('a used shrine drops out of the "Optional:" line', lineAfter === '', lineAfter);

  // Refused below 40 max HP: the accept button is disabled and nothing changes.
  await plain.evaluate(() => { game.startFloor(4); Qs.fresh({ price: 'maxhp', slot0: 0, boon: 'stamina' }); game.inv.maxHp = 50; game.inv.hp = 50; });
  await holdE();
  const low = await plain.evaluate(() => ({ disabled: document.querySelector('#dealScreen [data-act="accept"]').disabled, maxHp: game.inv.maxHp, text: document.querySelector('#dealScreen .note').textContent }));
  check('max HP below 40: the bargain is refused and the accept button is disabled', low.disabled && low.maxHp === 50 && /max HP/.test(low.text), JSON.stringify(low));
  await plain.evaluate(() => Qs.press('Escape'));

  // Accept, gear price + weapon boon: the equipped helmet is gone, a Rare-Epic weapon comes to the pack.
  const gearOut = await plain.evaluate(() => {
    game.startFloor(4); Qs.fresh({ price: 'gear', slot0: 0, boon: 'weapon' });
    game.inv.equip.helmet = makeItem({ type: 'armor', slot: 'helmet', cls: Object.keys(ARMOR_NAMES.helmet)[0], tier: 0 });
    game.floor.quest.deal = { price: 'gear', slot0: 0, boon: 'weapon' };
    return { ok: true };
  });
  await holdE();
  await plain.evaluate(() => document.querySelector('#dealScreen [data-act="accept"]').click());
  const gearRes = await plain.evaluate(() => ({ helmet: game.inv.equip.helmet, weapons: game.inv.pack.filter(i => i.type === 'weapon').map(i => i.tier), used: !!floor.quest.used }));
  check('gear price: the equipped helmet is given up and a Rare or Epic weapon is received', gearOut.ok && gearRes.helmet === null && gearRes.weapons.some(t => t === 2 || t === 3) && gearRes.used, JSON.stringify(gearRes));

  // Accept, potion price + treasure boon: the biggest potion stack goes, an unknown treasure comes.
  const potOut = await plain.evaluate(() => {
    game.startFloor(4); Qs.fresh({ price: 'potions', slot0: 0, boon: 'treasure' });
    game.inv.add({ type: 'potion', kind: Object.keys(POTIONS)[0], n: 3 });
    game.floor.quest.deal = { price: 'potions', slot0: 0, boon: 'treasure' };
    return { stackId: game.inv.pack[0].id, gold: game.inv.gold, arrows: game.inv.arrows };
  });
  await holdE();
  await plain.evaluate(() => document.querySelector('#dealScreen [data-act="accept"]').click());
  const potRes = await plain.evaluate(id => ({ stackGone: !game.inv.pack.some(i => i.id === id), packNow: game.inv.pack.length, gold: game.inv.gold, arrows: game.inv.arrows, used: !!floor.quest.used }), potOut.stackId);
  check('potion price: the whole potion stack goes and the treasure is received', potRes.stackGone && (potRes.packNow > 0 || potRes.gold > potOut.gold || potRes.arrows > potOut.arrows) && potRes.used, JSON.stringify({ potRes, potOut }));
  await plain.close();
});
