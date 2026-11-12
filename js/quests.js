// Optional encounters (DESIGN.md section 16): a stage rolls 0 to 2 of them on floors 2 to 4, at most one a floor, never on the
// shop floor or the boss floor. Today: the locked mini-boss room ('miniboss') and the shrine bargain ('shrine').
// Skipping or declining costs nothing. Everything is seeded, so a seeded run repeats.
//   js/gen.js lays the encounter out (opts.quest -> floor.quest). This file rolls which floor gets which type, adds the mini-boss
//   after assignEnemyTypes, builds the runtime bits (name tag, altar spot), and runs the shrine's deal screen.
// A new type (wanted guard, thief chase, prisoner, ally) plugs in by adding a row to QUEST_TYPES and a layout branch in gen.js.
// No per-frame work: everything here runs at floor build, on a search finishing, or when the inventory or deal screen opens.
const QUESTS = {
  roll: { none: 25, one: 45, two: 30, floorMin: 2, floorMax: 4 },                        // odds (weights) of 0, 1 or 2 encounters per stage; floors they may land on
  // mini-boss: its body numbers are the 'miniboss' row of ENEMY_TYPES. Reward: Rare+ gear (minTier), gold goldMin..goldMax + goldPerFloor x floor, maybe a potion
  miniboss: { minTier: 2, goldMin: 30, goldMax: 50, goldPerFloor: 10, potion: 0.5 },
  // shrine: price weights, boon weights, the max HP price, the lowest max HP it will take you to, regen bonus, weapon boon tier range
  shrine: { priceHp: 1, priceGear: 1, pricePotions: 1, boonWeapon: 1, boonStamina: 1, boonTreasure: 1, hpLoss: 15, minMaxHp: 40, stamBonus: 0.25, weaponMinTier: 2, weaponMaxTier: 3 },
};
const MINIBOSS_NAMES = ['Grub the Butcher', 'Old Gnash', 'Mogra Bonecrusher', 'Skarn the Unwashed', 'Big Dreg', 'Hobb Ironjaw', 'Madam Cleaver', 'Rotgut Brannoch', 'Snaggle the Tall', 'Urkul Two-Pots'];
const SHRINE_GEAR_SLOTS = ['helmet', 'chest', 'boots', 'offhand'];                       // the equipped pieces a bargain may take (never the weapon)

// ---- the table of encounter types. weight: how often it is rolled. spawn(f): extra enemies, after assignEnemyTypes.
// build(f, ctx): runtime pieces once the floor's meshes exist. line(f): the one short line for the inventory screen ('' when done). ----
const QUEST_TYPES = {
  miniboss: {
    weight: 1,
    spawn(f) {
      const q = f.quest; q.name = makeRng(q.seed).pick(MINIBOSS_NAMES);
      f.enemies.push({ x: q.route[0].x, y: q.route[0].y, route: q.route, seed: q.seed, type: 'miniboss', mini: { name: q.name } });
    },
    build(f, ctx) {
      const e = ctx.enemies.find(en => en.spec.mini); if (!e) return;
      f.quest.boss = e;
      const c = document.createElement('canvas'); c.width = 320; c.height = 56;               // one canvas and one sprite, made once
      const g = c.getContext('2d'); g.font = 'bold 30px system-ui, sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle';
      g.lineWidth = 6; g.strokeStyle = '#000c'; g.strokeText(f.quest.name, 160, 29); g.fillStyle = '#ff9a6a'; g.fillText(f.quest.name, 160, 29);
      const tag = new THREE.Sprite(new THREE.SpriteMaterial({ map: new THREE.CanvasTexture(c), transparent: true, depthWrite: false }));
      tag.scale.set(2.6, 0.455, 1); tag.position.y = 2.55; tag.renderOrder = 9;
      e.mesh.add(tag); e.tag = tag;
    },
    line(f) {
      const q = f.quest; if (q.boss && q.boss.dead) return '';
      return `${q.name} waits in a locked room on this floor (${inv.has('key', q.lock) ? 'you have its key' : 'its key is in a chest'}).`;
    },
  },
  shrine: {
    weight: 1,
    spawn() {},
    build(f, ctx) {
      const a = f.quest.altar, o = ctx.decorObjs.find(d => d.kind === 'altar' && d.p.x === a.x && d.p.y === a.y); if (!o) return;
      f.quest.prop = { p: { kind: 'altar', x: a.x, y: a.y, opened: !!f.quest.used }, mesh: new THREE.Group(), x: o.x, z: o.z, r: 0, lid: null, mats: [] };   // the altar's mesh is plain merged decor; this is just the spot you use
      ctx.propObjs.push(f.quest.prop);
    },
    line(f) { return f.quest.used ? '' : 'A shrine on this floor offers a bargain. Hold E at its altar; you may decline.'; },
  },
};

// Which floor gets which type for this run: { floorNumber: type }. Seeded; at most one per floor.
function rollQuests(seed, maxFloor, shopFloor) {
  const rng = makeRng((seed ^ 0x2c1b3c6d) >>> 0), R = QUESTS.roll, out = {};
  const n = weightedIndex(rng, [R.none, R.one, R.two]), floors = [];
  for (let f = R.floorMin; f <= Math.min(R.floorMax, maxFloor - 1); f++) if (f !== shopFloor) floors.push(f);
  rng.shuffle(floors);
  const types = Object.keys(QUEST_TYPES), w = types.map(t => QUEST_TYPES[t].weight);
  for (const f of floors.slice(0, n)) out[f] = types[weightedIndex(rng, w)];
  return out;
}

const questSpawn = f => { if (f.quest) QUEST_TYPES[f.quest.type].spawn(f); };               // after assignEnemyTypes
const questBuild = (f, ctx) => { if (f.quest) QUEST_TYPES[f.quest.type].build(f, ctx); };   // after the floor's meshes and enemies exist
const questLine = f => f.quest ? QUEST_TYPES[f.quest.type].line(f) : '';                    // the inventory screen's line
function questDoorOpened(o) {                                                               // the lair's door was unlocked
  if (o.p.room !== 'lair' || !floor.quest) return;
  discover('quest:lair', 'Locked mini-boss room');
  addLog(`${floor.quest.name} is in there.`, '#ff9a6a');
}

// ---- the shrine's deal: ONE seeded deal per altar (a price and a boon). All the rules are plain functions of the inventory. ----
function rollDeal(seed) {
  const rng = makeRng((seed ^ 0x5b17e) >>> 0), S = QUESTS.shrine;
  return { price: ['maxhp', 'gear', 'potions'][weightedIndex(rng, [S.priceHp, S.priceGear, S.pricePotions])], slot0: rng.int(0, 3),
    boon: ['weapon', 'stamina', 'treasure'][weightedIndex(rng, [S.boonWeapon, S.boonStamina, S.boonTreasure])] };
}
// What the price is for this pack right now. A price that cannot be paid (no gear worn, no potions) becomes the max HP price.
function resolvePrice(deal, inv) {
  const S = QUESTS.shrine;
  if (deal.price === 'gear') for (let i = 0; i < 4; i++) { const slot = SHRINE_GEAR_SLOTS[(deal.slot0 + i) % 4], it = inv.equip[slot]; if (it) return { kind: 'gear', slot, text: `Give up your equipped ${slot === 'offhand' ? 'off-hand' : slot}: <b style="color:${itemColor(it)};font-size:inherit">${itemName(it)}</b> (${tierName(it)}${it.unique ? ', one of a kind' : ''}) for good` }; }
  if (deal.price === 'potions') { const st = inv.pack.filter(i => i.type === 'potion').sort((a, b) => b.n - a.n)[0]; if (st) return { kind: 'potions', stack: st, text: `Hand over all your ${itemName(st)} (x${st.n})` }; }
  return { kind: 'maxhp', text: `Lose ${S.hpLoss} max HP for the rest of the run (${inv.maxHp} to ${inv.maxHp - S.hpLoss})`, bad: inv.maxHp - S.hpLoss < S.minMaxHp && `Your max HP is too low to pay this.` };
}
const BOON_TEXT = { weapon: () => `A ${TIERS[QUESTS.shrine.weaponMinTier].name} or better weapon`, stamina: () => `+${Math.round(QUESTS.shrine.stamBonus * 100)}% stamina regeneration for the rest of the run`, treasure: () => 'An unknown treasure' };
// The boon as drop descriptors (seeded by the altar, so it never changes between looks).
function boonItems(deal, seed, floorNum) {
  const rng = makeRng((seed ^ 0xb00f) >>> 0), S = QUESTS.shrine;
  if (deal.boon === 'weapon') return [{ type: 'weapon', base: rng.pick(['dagger', 'sword', 'mace', 'bow']), tier: Math.max(S.weaponMinTier, Math.min(S.weaponMaxTier, rollTier(floorNum, rng, 1))) }];
  if (deal.boon === 'treasure') return rollLoot('vaultchest', floorNum, rng);
  return [];
}
// Pays the price and hands over the boon. Returns { ok, msg }; nothing changes when ok is false.
function applyDeal(inv, deal, seed, floorNum) {
  const price = resolvePrice(deal, inv), items = boonItems(deal, seed, floorNum);
  if (price.bad) return { ok: false, msg: price.bad };
  const need = items.filter(d => d.type !== 'gold' && d.type !== 'arrows').length, room = PACK_MAX - inv.pack.length + (price.kind === 'potions' ? 1 : 0);
  if (need > room) return { ok: false, msg: 'Make room in your pack first.' };
  if (price.kind === 'maxhp') { inv.maxHp -= QUESTS.shrine.hpLoss; inv.hp = Math.min(inv.hp, inv.maxHp); }
  else if (price.kind === 'gear') inv.equip[price.slot] = null;
  else inv.remove(price.stack);
  const got = items.map(d => inv.add(d)).filter(Boolean);
  if (deal.boon === 'stamina') { inv.stamBonus += QUESTS.shrine.stamBonus; got.push(`+${Math.round(QUESTS.shrine.stamBonus * 100)}% stamina regeneration`); }
  return { ok: true, msg: `The shrine takes its price. You receive: ${got.join(', ') || 'nothing'}.` };
}

// ---- the deal screen: DOM built the first time it opens, drawn only on open and on a click (no per-frame writes) ----
const dealUI = (() => {
  let root = null, altar = null, deal = null, note = '';
  function make() {
    const css = document.createElement('style');
    css.textContent = `
      #dealScreen { position: fixed; inset: 0; z-index: 30; display: none; align-items: center; justify-content: center; background: #000b; font: 13px system-ui, sans-serif; color: #eee; }
      #dealScreen .win { width: min(520px, 94vw); background: #15130f; border: 1px solid #c8a0ff; padding: 14px 16px; }
      #dealScreen b { font-size: 18px; color: #c8a0ff; }
      #dealScreen .row { margin: 10px 0; padding: 8px 10px; border: 1px solid #fff3; background: #0007; }
      #dealScreen .row small { display: block; opacity: .6; font-size: 11px; margin-bottom: 3px; text-transform: uppercase; letter-spacing: .08em; }
      #dealScreen button { font: 13px system-ui; padding: 5px 14px; margin-right: 8px; cursor: pointer; }
      #dealScreen button[disabled] { opacity: .4; cursor: default; }
      #dealScreen .note { min-height: 18px; color: #e8c860; margin: 6px 0; }
    `;
    document.head.appendChild(css);
    root = document.createElement('div'); root.id = 'dealScreen';
    document.body.appendChild(root);
    root.addEventListener('click', e => {
      const t = e.target.closest('[data-act]'); if (!t || t.disabled) return;
      if (t.dataset.act === 'accept') {
        const r = applyDeal(inv, deal, floor.quest.seed, floorNum);
        if (!r.ok) { note = r.msg; render(); return; }
        floor.quest.used = true; altar.p.opened = true;
        flash(r.msg); addLog(r.msg, '#c8a0ff');
      }
      close();
    });
    addEventListener('keydown', e => { if (e.code === 'Escape' && state === 'deal') { e.preventDefault(); e.stopImmediatePropagation(); close(); } });   // stop the pause menu opening on the same key
  }
  function render() {
    const price = resolvePrice(deal, inv), bad = price.bad;
    root.innerHTML = `<div class="win"><b>The Shrine Bargain</b>
      <div class="row"><small>The shrine asks</small>${price.text}</div>
      <div class="row"><small>In return</small>${BOON_TEXT[deal.boon]()}</div>
      <div class="note">${note || bad || 'The altar waits. You may walk away: it costs nothing.'}</div>
      <button data-act="accept" ${bad ? 'disabled' : ''}>Accept</button><button data-act="decline">Decline (Esc)</button></div>`;
  }
  function open(o) {
    if (state !== 'play' || !floor.quest || floor.quest.used) return;
    if (!root) make();
    altar = o; deal = floor.quest.deal || (floor.quest.deal = rollDeal(floor.quest.seed)); note = '';
    state = 'deal';
    document.exitPointerLock();
    cb.want = false; cb.press = false; cb.draw = null;
    el('prompt').style.display = 'none';                                                   // the Hold E prompt would otherwise sit under the overlay
    discover('quest:shrine', 'Shrine bargain');
    render();
    root.style.display = 'flex';
  }
  function close() {
    root.style.display = 'none';
    state = 'play';
    player.keys[KEYS.interact] = false;                                                   // do not reopen at once if E is still held
    try { canvas.requestPointerLock(); } catch (e) {}
  }
  return { open, close, render };
})();
