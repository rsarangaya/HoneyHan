// The three one-of-a-kind Legendaries: Ian's Hog (spear), Aj's Bust (wand) and AK's Dumbass (helmet).
// Run on its own: node tests/game.legend.test.js
const { run } = require('./lib');
run("Ian's Hog, Aj's Bust and AK's Dumbass", async ({ open, check }) => {
  const page = await open(7);

  // 1. Ian's Hog: stats, reach, kills and limp.
  const hog = await page.evaluate(async () => {
    const out = {};
    const frozen = e => { e.hp = e.maxHp = 500; e.update = function () { this.sync(0); return null; }; return e; };
    const it = makeItem({ type: 'weapon', base: 'spear', tier: 4 });
    const sword = weaponStats(makeItem({ type: 'weapon', base: 'sword', tier: 4 })), st = weaponStats(it);
    out.name = itemName(it); out.tierName = tierName(it); out.charges = it.charges;
    out.reachRatio = st.reach / WSTATS.sword.reach; out.dmgSame = Math.abs(st.dmg - sword.dmg) < 1e-9; out.dmg = st.dmg;
    out.lines = itemLines(it).join(' | ');
    // reach: a guard 6.3 m ahead is hit (a sword reaches 2.3 m)
    T.reset(); game.inv.equip.weapon = it; game.cb.stamina = 100;
    let e = frozen(T.guard(6.3, 'toward', true));
    game.cb.press = true; out.hitAtRange = await T.until(() => e.hp < 500, 4000);
    out.rangeDamage = 500 - e.hp; game.cb.press = false;
    out.chargesAfterHit = it.charges;                                    // a hit that does not kill costs nothing
    // three kills: each guard has 1 HP
    const kill = async d => { T.reset(); game.inv.equip.weapon = it; game.cb.stamina = 100; const g = T.guard(d, 'toward', true); g.hp = g.maxHp = 1; g.update = function () { this.sync(0); return null; }; game.cb.press = true; const ok = await T.until(() => g.dead, 4000); game.cb.press = false; await T.until(() => !game.cb.atk, 2000); return ok; };
    out.kills = [];
    for (let i = 0; i < 3; i++) { out.kills.push(await kill(5)); out.afterKill = out.afterKill || []; out.afterKill.push(it.charges); }
    out.limp = isLimp(it);
    // limp: swinging does nothing and says so
    T.reset(); game.inv.equip.weapon = it; game.cb.stamina = 100; e = frozen(T.guard(4, 'toward', true));
    game.cb.press = true; await T.sleep(900); game.cb.press = false;
    out.limpDamage = 500 - e.hp; out.limpStamina = game.cb.stamina;
    out.limpModel = vm.id; out.limpLabel = itemLines(it)[0];
    // recharge: a recharge wand stiffens it again (3 kills)
    const rw = makeItem({ type: 'rechargewand' }); game.inv.pack.push(rw);
    out.rechargeMsg = game.inv.recharge(rw); out.chargesBack = it.charges; out.wandGone = !game.inv.pack.includes(rw);
    out.limpAfter = isLimp(it);
    await T.until(() => vm.id === 'spear', 2000); out.readyModel = vm.id;
    return out;
  });
  check("Ian's Hog is a Legendary named Ian's Hog", hog.name === "Ian's Hog" && hog.tierName === 'Legendary', hog.name);
  check('it is exactly three times as long as the sword', Math.abs(hog.reachRatio - 3) < 1e-9, hog.reachRatio);
  check("it does as much damage as a Legendary sword", hog.dmgSame && Math.abs(hog.dmg - 35) < 1e-9, hog.dmg);
  check('it starts with 3 kills', hog.charges === 3);
  check('it hits from far away (6.3 m)', hog.hitAtRange && hog.rangeDamage > 25, `damage ${hog.rangeDamage}`);
  check('a hit that does not kill uses no charge', hog.chargesAfterHit === 3);
  check('each kill uses one charge', hog.kills.every(Boolean) && hog.afterKill.join() === '2,1,0', hog.afterKill.join());
  check('after 3 kills it is limp', hog.limp);
  check('a limp Hog cannot attack and costs no stamina', hog.limpDamage === 0 && hog.limpStamina >= 99, `damage ${hog.limpDamage}, stamina ${hog.limpStamina}`);
  check('the limp Hog is drawn as a different (sagging) model', hog.limpModel === 'spear:limp', hog.limpModel);
  check('its text says it is limp', /LIMP/.test(hog.limpLabel), hog.limpLabel);
  check('a recharge wand stiffens it to 3 kills and is used up', /stiffens/.test(hog.rechargeMsg) && hog.chargesBack === 3 && hog.wandGone && !hog.limpAfter, hog.rechargeMsg);
  check('the ready model comes back', hog.readyModel === 'spear');

  // 2. Aj's Bust: one target, stuck until it dies, not on elites or bosses.
  const bust = await page.evaluate(async () => {
    const out = {};
    const wand = makeItem({ type: 'wand', kind: 'bust' });
    out.name = itemName(wand); out.charges = wand.charges; out.legendary = WANDS.bust.legendary;
    out.inOrdinaryRolls = (() => { const r = makeRng(5), seen = new Set(); for (let i = 0; i < 400; i++) seen.add(rollWandKind(r)); return seen.has('bust'); })();
    const setup = type => { T.reset(); game.inv.equip.weapon = wand; game.cb.stamina = 100; const e = T.guard(7, 'toward', true, type); e.hp = e.maxHp = 500; return e; };
    const fire = async until => { game.cb.press = true; const ok = await T.until(until, 5000); game.cb.press = false; await T.until(() => !game.cb.atk, 2000); await T.sleep(450); return ok; };
    // a goblin: stuck at once, even while alerted and hunting you, and it stays put
    let e = setup();
    out.stuck = await fire(() => e.st.has('stuck')); out.chargesLeft = wand.charges;
    const x0 = e.x, z0 = e.z;                                            // measured from the moment it is glued
    await T.sleep(1800);
    out.moved = Math.hypot(e.x - x0, e.z - z0); out.speedMul = e.st.moveMul();
    out.goo = !!e.goo && e.mesh.children.includes(e.goo);
    // it can be killed, and it stays stuck until then
    out.stillStuck = e.st.has('stuck') && !e.dead;
    // a second bust on it does nothing new but still costs a charge
    const before = wand.charges; await fire(() => wand.charges < before); out.second = wand.charges;
    // nothing pushes it: the force wand does not move a stuck enemy
    const fw = makeItem({ type: 'wand', kind: 'force' }); game.inv.equip.weapon = fw; const px = e.x, pz = e.z;
    await fire(() => fw.charges < 5);
    out.forceMoved = Math.hypot(e.x - px, e.z - pz);
    // a dagger sneak kill still works on it, and a corpse is left
    game.inv.equip.weapon = makeItem({ type: 'weapon', base: 'sword', tier: 4 }); e.hp = 1; e.x = game.player.x - Math.sin(game.player.yaw) * 1.5; e.z = game.player.z - Math.cos(game.player.yaw) * 1.5;
    game.cb.press = true; out.killed = await T.until(() => e.dead, 4000); game.cb.press = false;
    // an elite and the boss shrug it off
    for (const type of ['bouncer', 'brute']) {
      game.inv.equip.weapon = wand; wand.charges = 3; const b = setup(type); game.inv.equip.weapon = wand;
      await fire(() => wand.charges < 3); out['elite_' + type] = b.st.has('stuck');
    }
    { const b = setup(); b.boss = true; game.inv.equip.weapon = wand; wand.charges = 3; await fire(() => wand.charges < 3); out.boss = b.st.has('stuck'); }
    // an archer glued in place still shoots (it just cannot move)
    out.eliteFlags = ['bouncer', 'brute', 'warden', 'librarian', 'fungbrute', 'captain', 'iceknight'].every(t => ENEMY_TYPES[t].elite) && !ENEMY_TYPES.goblin.elite;
    // single target: a neighbour is not glued
    { game.inv.equip.weapon = wand; wand.charges = 3; const a = setup(), n = T.guard(7.6, 'toward', true); n.hp = n.maxHp = 500; await fire(() => wand.charges < 3); out.neighbour = n.st.has('stuck'); out.target = a.st.has('stuck') || n.st.has('stuck'); }
    // recharge works on it
    wand.charges = 0; const rw = makeItem({ type: 'rechargewand' }); game.inv.pack.push(rw); game.inv.recharge(rw, wand); out.recharged = wand.charges;
    return out;
  });
  check("Aj's Bust is a Legendary wand with 3 charges", bust.name === "Aj's Bust" && bust.legendary && bust.charges === 3);
  check('it never turns up in the ordinary wand roll', !bust.inOrdinaryRolls);
  check('a bolt glues the enemy and uses a charge', bust.stuck && bust.chargesLeft === 2);
  check('a stuck enemy cannot move even while hunting you', bust.moved < 0.05 && bust.speedMul === 0, `moved ${bust.moved.toFixed(2)} m`);
  check('it is covered in white goo', bust.goo);
  check('it stays stuck until it dies', bust.stillStuck);
  check('a stuck enemy is not thrown by the force wand', bust.forceMoved < 0.05, bust.forceMoved.toFixed(2));
  check('it can still be killed', bust.killed);
  check('elites are immune', !bust.elite_bouncer && !bust.elite_brute && bust.eliteFlags);
  check('the boss is immune', !bust.boss);
  check('it is single target', bust.target && !bust.neighbour);
  check('a recharge wand refills it', bust.recharged === 3);

  // 3. AK's Dumbass: the Legendary dunce hat.
  const hat = await page.evaluate(() => {
    const out = {};
    const it = makeItem({ type: 'armor', slot: 'helmet', cls: 0, tier: 4, unique: 'dunce' });
    out.name = itemName(it); out.tier = tierName(it); out.red = armorStats(it).red; out.noise = armorStats(it).noise;
    out.lines = itemLines(it).join(' | ');
    T.reset(); game.inv.pack.push(it); game.inv.equipItem(it);
    out.headCut = game.inv.armorRed('head'); out.bodyCut = game.inv.armorRed('body');
    out.worn = game.inv.equip.helmet === it;
    // the inventory draws it
    invUI.open(); document.querySelector('[data-equip="helmet"]').click();
    out.icon = /<svg class="icon"/.test(document.getElementById('invScreen').innerHTML) && /D<\/text>/.test(document.getElementById('invScreen').innerHTML);
    invUI.close();
    return out;
  });
  check("AK's Dumbass is a Legendary helmet", hat.name === "AK's Dumbass" && hat.tier === 'Legendary');
  check('it cuts 17.5% of head damage and is silent', Math.abs(hat.red - 0.175) < 1e-9 && hat.noise === 0 && Math.abs(hat.headCut - 0.175) < 1e-9 && hat.bodyCut === 0, hat.headCut);
  check('it goes on the head slot', hat.worn);
  check('the inventory shows the dunce hat picture', hat.icon);

  // 4. One of each per run: Legendary rolls give at most one Hog, one Dumbass and one Bust.
  const uniq = await page.evaluate(() => {
    resetUniques();
    const rng = makeRng(99), got = { spear: 0, dunce: 0 };
    for (let i = 0; i < 3000; i++) {
      const d = rollEquipment(9, rng, { minTier: 4, boost: 4 });
      if (d.base === 'spear') got.spear++;
      if (d.unique === 'dunce') got.dunce++;
    }
    const firstSpear = got.spear, afterAll = { ...UNIQUES };
    // the boss body and chests can add the Bust, once
    resetUniques(); let busts = 0;
    for (let i = 0; i < 4000; i++) busts += rollLoot('vaultchest', 3, makeRng(1000 + i)).filter(d => d.kind === 'bust').length;
    const dry = (() => { resetUniques(); const r = []; for (let i = 0; i < 4000; i++) r.push(...dryRoll(() => rollLoot('vaultchest', 3, makeRng(1000 + i)))); return { busts: r.filter(d => d.kind === 'bust').length, flag: UNIQUES.bust }; })();
    resetUniques();
    return { got, afterAll, busts, dry };
  });
  check('only one Hog and one Dumbass come out of thousands of Legendary rolls', uniq.got.spear === 1 && uniq.got.dunce === 1, JSON.stringify(uniq.got));
  check('only one Aj\'s Bust comes out of thousands of vault chests', uniq.busts === 1, uniq.busts);
  check('a dry run (is the body empty?) does not use the unique up', uniq.dry.busts === 0 && uniq.dry.flag === false, JSON.stringify(uniq.dry));
});
