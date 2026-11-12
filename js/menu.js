// Pause menu: a Controls tab (click an action, press a key or mouse button to rebind it) and a Glossary
// tab of everything discovered so far (items, equipment, enemies). Esc opens it in game. The welcome
// screen's Controls and Glossary buttons open it too.
const pauseMenu = (() => {
  const css = document.createElement('style');
  css.textContent = `
    #pauseMenu { position: fixed; inset: 0; z-index: 15; display: none; align-items: center; justify-content: center; background: #000c; font: 13px system-ui, sans-serif; color: #eee; }
    #pauseMenu .win { width: min(820px, 96vw); height: min(620px, 92vh); display: flex; flex-direction: column; background: #15130f; border: 1px solid #e8c860; padding: 12px 14px; box-sizing: border-box; }
    #pauseMenu .head { display: flex; justify-content: space-between; align-items: center; margin-bottom: 8px; }
    #pauseMenu .head b { font-size: 20px; color: #e8c860; }
    #pauseMenu .tabs { display: flex; gap: 6px; margin-bottom: 10px; }
    #pauseMenu button { font: 13px system-ui; padding: 5px 12px; cursor: pointer; }
    #pauseMenu .tabs button.on { background: #e8c860; color: #111; font-weight: 700; }
    #pauseMenu .body { flex: 1; overflow: auto; padding-right: 4px; }
    #pauseMenu .row { display: flex; justify-content: space-between; align-items: center; padding: 4px 6px; border-bottom: 1px solid #fff1; }
    #pauseMenu .row button { min-width: 130px; }
    #pauseMenu .row button.listen { background: #e8c860; color: #111; font-weight: 700; }
    #pauseMenu .note { margin: 8px 0; color: #e8c860; min-height: 18px; }
    #pauseMenu .dim { opacity: .55; }
    #pauseMenu h3 { margin: 14px 0 6px; font-size: 12px; letter-spacing: .08em; text-transform: uppercase; opacity: .7; }
    #pauseMenu .cards { display: grid; grid-template-columns: repeat(auto-fill, minmax(240px, 1fr)); gap: 8px; }
    #pauseMenu .card { border: 1px solid #fff3; background: #0007; padding: 7px 9px; line-height: 1.35; }
    #pauseMenu .card .nm { font-weight: 700; font-size: 14px; }
    #pauseMenu .card ul { margin: 4px 0 0; padding-left: 16px; font-size: 12px; opacity: .85; }
    #pauseMenu .card.locked { opacity: .4; }
    #pauseMenu .foot { display: flex; justify-content: space-between; align-items: center; margin-top: 10px; }
  `;
  document.head.appendChild(css);
  const root = document.createElement('div');
  root.id = 'pauseMenu';
  document.body.appendChild(root);

  let tab = 'controls', gtab = 'items', listening = null, note = '', lastAssign = 0, openedAt = 0;

  // ---- glossary content ----
  const card = (key, name, color, lines) => discovered.has(key)
    ? `<div class="card"><div class="nm" style="color:${color || '#eee'}">${name}</div><ul>${lines.map(l => `<li>${l}</li>`).join('')}</ul></div>`
    : `<div class="card locked"><div class="nm">???</div><ul><li>Not discovered yet.</li></ul></div>`;

  function itemCards() {
    const out = [];
    out.push(card('item:gold', 'Gold', '#e8c860', ['Money. Spend it at the goblin merchant, who sets up shop on one floor from 1 to 4. He also buys your spare gear.']));
    out.push(card('item:arrows', 'Arrows', '#c8c8c8', ['Ammo for the bow. One per shot, up to 25 in the quiver. Arrows that miss often lie where they landed: walk over one to pick it up again.']));
    out.push(card('item:key', 'Keys', '#e8c860', ['Open a locked room (armory, vault or brewery) on the same floor. Each key hides in a chest. Hold the interact key at the door.']));
    out.push(card('item:puddle', 'Shallow water', '#5a8ac8', ['In the Sunken Tavern, puddles of shallow water splash when you step in them: 8 m when walking, 4 m even when crouched. Guards hear it, so go round them or accept the noise.']));
    out.push(card('item:chest', 'Chests', '#e8c860', CHEST_NAMES.map((n, i) => `${n} (${TIERS[i].name} colour on the minimap): ${CHEST_BLURB[i]}`).concat('Deeper floors have better chests more often. Better chests take a little longer to open and are a little louder.')));
    out.push(card('item:lockpick', 'Lockpick', '#c8ccd4', [`Picks a locked chest: hold the interact key for about ${LOCKPICK.time} s. It is quiet (${LOCKPICK.noise} m), but each attempt has a ${Math.round(LOCKPICK.breakChance * 100)}% chance to snap the pick.`, `Found in barrels and rubble (about ${Math.round(LOCKPICK.drop * 100)}%), on bandit and thief bodies (about ${Math.round(LOCKPICK.corpseDrop * 100)}%), and sold by the goblin merchant for ${OTHER_PRICE.lockpick} gold.`]));
    out.push(card('chest:locked', 'Locked chests', '#e8c860', [`A brass padlock hangs on the chest. Its loot is one grade better. Pick it with a lockpick, or smash it: ${LOCKED.hits} weapon hits (a mace needs ${LOCKED.maceHits}), very loud (${LOCKED.noise} m each hit), and each potion inside has a ${Math.round(LOCKED.potionBreak * 100)}% chance to break.`]));
    out.push(card('chest:trap', 'Trapped chests', '#e8c860', ["From floor 2, some chests are trapped. Look for a hair-thin glinting wire at the chest's foot.", `Opening one normally sets it off: a dart (${TRAP.dart} damage and bleed), a gas cloud (${TRAP.gasRadius} m, daze and slow, enemies too) or an alarm bell (${TRAP.alarmNoise} m). Search while crouched to disarm it instead: it takes ${TRAP.disarmMul}x as long and makes no sound.`]));
    out.push(card('item:grass', 'Tall grass', '#5a9a3a', ['In the Moonlit Orchard, tall grass hides you: crouch in it and guards see only about half as far. Standing in it still helps a little.']));
    out.push(card('item:glow', 'Glowing spores', '#6affc0', ['In the Mushroom Cellar, glowing mushrooms light you up: while you stand in their glow, guards see you about 40% farther.']));
    out.push(card('item:bell', 'Tripwire bells', '#d8a030', ['In the Goblin Market, tripwires with little bells ring a loud 14 m alarm when you step on one, once. Look at the floor and step over them.']));
    out.push(card('item:ice', 'Ice', '#bfe6ff', ['In the Frozen Chapel, patches of ice make you slide: you barely steer or stop. Do not slide into an enemy, or off a plan.']));
    out.push(card('item:hush', 'The Library hush', '#c8b080', ['In the Clockwork Library the silence is so deep that every sound you make carries 40% farther. Creep, and keep fights short.']));
    out.push(card('quest:lair', 'Locked mini-boss room', '#ff9a6a', ['On floors 2 to 4 a floor may hold a locked lair with one named mini-boss inside. Its key is in a chest on the same floor (like the armory, vault and brewery keys).', 'Optional, and skipping it costs nothing. The mini-boss has about three times the health of a guard, hits one and a half times as hard, is an elite (not staggered by ordinary hits, no dagger instakill) and carries a floating name.', 'It always drops a Rare or better piece of equipment and a purse of gold, richer on deeper floors.']));
    out.push(card('quest:wanted', 'Wanted guard', '#ffd23a', ['On floors 2 to 4 a hooded goblin defector may stand in the start room. Hold the interact key to talk: it names an elite guard and the room it patrols. Defectors cannot be hurt and guards ignore them.', 'Kill the named guard any way you like (about twice a guard\'s health, 1.3 times its damage, plate armor, no dagger instakill) and talk to the defector again for the reward: a good potion or a Rare or better piece of gear. You can claim it even if you never talked first.', 'Optional. Skipping it costs nothing, but the reward is lost.']));
    out.push(card('quest:thief', 'Sneak thief chase', '#ff9a6a', [`On floors 2 to 4 a thief goblin with a loot sack may wander the floor. The sack holds ${QUESTS.thief.goldMin} to ${QUESTS.thief.goldMax} gold (plus ${QUESTS.thief.goldPerFloor} per floor) and one Uncommon or better item.`, 'It never fights and never steals from you. When it spots you it runs about 20% faster than your sprint, away from you, and cowers if you corner it in a dead end. Stab it unaware (the clean way), shoot it, or run it down: any kill leaves the sack on its body.', 'If it reaches the stairs while running it escapes and the sack is lost.']));
    out.push(card('quest:shrine', 'Shrine bargain', '#c8a0ff', ['On floors 2 to 4 a shrine room may hold an altar that offers one deal: pay a price (lose 15 max HP for the rest of the run, give up one piece of equipped gear, or hand over a whole stack of potions) for a boon shown only by kind (a Rare or better weapon, +25% stamina regeneration for the run, or an unknown treasure).', 'Hold the interact key at the altar. You can decline and walk away for nothing; accepting uses the altar up. Altars cannot be attacked.']));
    out.push(card('item:hunger', 'Hunger', '#e0883a', ['Your food meter drains as you play, faster when you sprint or fight. At half you are Hungry (stamina regenerates 20% slower, and a faint stomach growl guards can hear), at a quarter Weak (40% slower, max stamina -15%, louder growl), and at zero Starving (1 HP lost every 4 seconds, never below 1, and no sprinting).', 'Food only feeds you, it does not heal. Eating takes a moment, slows you, and is interrupted if you are hit or attack. Eating beside a lit hearth feeds 25% more.']));
    for (const k of Object.keys(WANDS)) if (!WANDS[k].legendary) out.push(card('wand:' + k, WANDS[k].name, WANDS[k].color, [WANDS[k].desc, `${WANDS[k].charges} charges, then it breaks. Equip it like a weapon and attack to fire.`, 'Found in chests and vaults.']));
    out.push(card('item:hog', "Ian's Hog", '#ff9a2a', ['Legendary spear, one of a kind. Three times as long as the sword (reach 6.9 m) and as strong as a Legendary sword (35 damage).', "\"Ian's hog is 3 days long, as represented by this spear. Refractory period sucks.\"", 'Every KILL tires it. After 3 kills it goes LIMP: the shaft sags and it cannot attack at all. A Recharge Wand makes it stand tall again, or you can sacrifice other gear to it from the inventory (Common/Uncommon +1 kill, Rare/Epic +2, Legendary full).', 'Very rare: a Legendary roll from golden chests, vaults, armories and the boss.']));
    out.push(card('item:bust', "Aj's Bust", '#ff9a2a', ["\"Aj's coming on that ass.\"", WANDS.bust.desc, 'Very rare: vault chests, ornate and golden chests, and the boss. Only one exists per run.']));
    out.push(card('item:dunce', "AK's Dumbass", '#ff9a2a', ['"You feel yourself becoming stupider."', 'Legendary helmet, one of a kind. A tall paper-white dunce cap with a big red D. 17.5% head protection, no noise.', "Fool's Fortune: 50% more gold. Corner Time: crouch perfectly still for 3 s and unaware guards stop noticing you. Cone of Shame: the first guard on a floor to spot you is stunned for 1 s by laughter.", 'Very rare: a Legendary helmet roll. Only one exists per run.']));
    out.push(card('item:recharge', 'Recharge Wand', '#7fe8d8', [`Restores ${WAND.rechargeGain} charges to a wand (rarely, all of them) and then crumbles. Use it before the wand hits 0, or on an empty one. It is also the only thing that stiffens a limp Ian's Hog.`, 'Rare. Found in chests and vaults.']));
    out.push(card('item:rage', "Hanahan's Rage", '#ff9a2a', ['Legendary. Plays a recording of Hanahan talking mad smack. Enemies get angry and ragebaited into attacking each other.', `Enemies within ${RAGE.radius} m fight each other for ${RAGE.dur} s, then come looking for you. It is very loud. Bosses ignore it. ${RAGE.charges} plays, then the recorder breaks.`, 'Very rare: vault chests and the boss.']));
    for (const k of Object.keys(FOOD)) out.push(card('food:' + k, FOOD[k].name, FOOD[k].color, [FOOD[k].desc, 'Found in chests, barrels and on food shelves in mess halls and storerooms. Cooks carry it. Use it from a quickslot or the Eat button.']));
    for (const k of Object.keys(POTIONS)) out.push(card('potion:' + k, POTIONS[k].name, POTIONS[k].color, [POTIONS[k].desc, 'Found on potion shelves, in chests and barrels, and on monsters.']));
    return out;
  }
  function equipCards() {
    const weapons = ['dagger', 'sword', 'mace', 'bow'].map(b => card('weapon:' + b, WEAPON_NAMES[b], '#c8c8c8', itemLines({ type: 'weapon', base: b, tier: 0 }).concat('Stats shown at Common tier.')));
    weapons.push(card('equip:shield', 'Shield', '#c8c8c8', itemLines({ type: 'shield', tier: 0 }).concat('Stats shown at Common tier.')));
    const armor = [];
    for (const s of ARMOR_SLOTS) ARMOR_NAMES[s].forEach((n, cls) => armor.push(card(`armor:${s}:${cls}`, n, '#c8c8c8', itemLines({ type: 'armor', slot: s, cls, tier: 0 }).concat('Stats shown at Common tier.'))));
    const tiers = TIERS.map((t, i) => card('tier:' + i, `${t.name} tier`, t.color, [`Multiplies weapon damage and armor protection by x${t.mul}.`, i === 4 ? 'Legendary weapons have their own names.' : 'Higher tiers drop deeper in the dungeon, from vaults and armories, and from bosses.']));
    return { weapons, armor, tiers };
  }
  function enemyCards() {
    const base = [
      card('enemy:goblin', 'Goblin Guard', '#8fbf5a', [
        `${TUNE.enemyHp} HP. Patrols between rooms and carries a random weapon (dagger, sword or mace) and sometimes armor.`,
        'Sees in a cone ahead of it (shorter if you crouch, longer if you sprint) and hears footsteps, fights and chests.',
        'Unaware, suspicious, alerted or searching: the icon over its head shows which.',
        'Its swing shows where it will hit (overhead is the head, sideways is the body, low is the legs). Block head and body hits. Leg sweeps go under a block.',
        'Hit it from behind while it has not noticed you for a sneak attack. A dagger kills it outright.',
        'Has a chance to drop one item when it dies.']),
      card('enemy:cook', 'Goblin Cook', '#e6e2d2', ['Works the kitchens and mess halls with a chipped cleaver. No armor.', 'Drops food and the odd potion (food comes with the hunger system).', 'Otherwise fights like a guard.']),
      card('enemy:bandit', 'Drunk Bandit', '#b05a4a', ['Sways, sees poorly and hears worse, so it is an easy sneak kill.', 'Carries a dagger (its body hits make you bleed) and usually some gold.', 'If it spots you or gets hurt it bellows, and that carries about 15 m.']),
      card('enemy:rat', 'Giant Rat', '#9a8a70', ['Small and fast and always in a pack of three, usually in a storeroom. Dies in one hit but bites at your legs (slow).', 'Aim low: it is only as tall as your knee. Drops next to nothing.']),
      card('enemy:wolf', 'Tamed Wolf', '#9aa0aa', ['A goblin keeps it as a pet and it trots after that goblin. Faster than a sprint, bites fast with a short warning, goes for your legs and body.', 'Smells you: crouching and walls do not hide you from it, only standing still does.', 'If its handler is alerted the wolf is let off the leash. Kill the handler quietly and it just waits. A leg hit makes it limp.']),
      card('enemy:archer', 'Goblin Archer', '#8fbf5a', ['Shoots from a distance and backs away if you close in. A green hood and a bow.', 'It draws for a moment with the bow raised: that is your cue to move, block or break line of sight. Arrows can be blocked with a sword or shield (a parry just stops them) and can hit the head, body or legs (a leg hit slows you).', 'Drops arrows. Weak up close, so rush it or shoot it first.']),
      card('enemy:shaman', 'Goblin Shaman', '#b060ff', ['A hooded caster with a glowing staff. Sees poorly and hears well, so a silent kill from behind is best.', 'Hurls a slow bolt that Slows or Dazes you. A block does not stop a hex, but it is slow enough to dodge.', 'Heals a badly hurt goblin in its sight, so kill it first. Sometimes carries a potion or a wand.']),
      card('enemy:brute', 'Brute', '#8a7a5a', ['A huge goblin with 3x health that hits twice as hard, slowly and with a long warning. Ordinary hits do not stagger it and a sneak attack is capped, but a parry still staggers it.', 'Sprinting outpaces it. Usually drops Rare or better equipment.']),
      card('enemy:bouncer', 'Bouncer', '#7d8672', ['Big, slow and hits hard, with a long warning. 2x the health.', 'Ordinary hits do not stagger it and a dagger cannot kill it in one stab (a sneak attack is capped). A parry still staggers it.', 'Always drops a piece of equipment (Uncommon or better) and some gold.']),
      card('enemy:boss', bossNameFor(theme.name), '#c0503a', [
        `Boss of floor 5. ${TUNE.bossHp} HP in heavy plate, and it hits much harder than a guard.`,
        'Sleeps in the middle of the arena until you get close. Cannot be sneak-killed and is not staggered by normal hits.',
        'A parry still staggers it, and a sprinting player can outrun it.',
        'Drops an Epic piece of equipment (with a small chance of Legendary), more equipment and gold. The stairs stay sealed until it falls.']),
    ];
    const extra = Object.entries(ENEMY_TYPES).filter(([k, v]) => v.info).map(([k, v]) => card('enemy:' + k, v.name, '#c8c8c8', v.info));   // the other themes' natives
    return [...base, ...extra];
  }

  function statusCards() {
    const src = { slow: 'Leg hits from guards, and some wands and bows.', cripple: 'Sword leg hits (sometimes) and the boss\'s leg hits.', bleed: 'A dagger\'s body hits.', stun: 'A mace\'s head hits and some wands. The boss cannot be stunned.', daze: 'Head hits from guards.', stuck: "Aj's Bust (a legendary wand). Never on elites or bosses." };
    return Object.keys(STATUS).map(k => card('status:' + k, STATUS[k].name, STATUS[k].color, [STATUS[k].desc, 'Comes from: ' + src[k], 'Works the same on you and on enemies (daze only affects you).']));
  }

  // ---- rendering ----
  function controlsHtml() {
    const rows = CONTROL_LABELS.map(([a, label]) =>
      `<div class="row"><span>${label}</span><button data-bind="${a}" class="${listening === a ? 'listen' : ''}">${listening === a ? 'Press a key or mouse button...' : keyName(KEYS[a])}</button></div>`).join('');
    return `<div class="note">${note || (listening ? 'Esc cancels.' : 'Click an action, then press the key or mouse button you want. A key already in use is swapped.')}</div>${rows}
      <div class="row"><span class="dim">Pause menu</span><span class="dim">Esc</span></div>
      <p><button data-act="reset">Reset all to defaults</button></p>`;
  }
  function glossaryHtml() {
    const sections = { items: 'Items', equipment: 'Equipment', enemies: 'Enemies', statuses: 'Statuses' };
    const tabs = Object.entries(sections).map(([k, v]) => `<button data-g="${k}" class="${gtab === k ? 'on' : ''}">${v}</button>`).join(' ');
    let body, total, got;
    if (gtab === 'items') { const c = itemCards(); body = `<div class="cards">${c.join('')}</div>`; total = c.length; got = c.filter(x => !x.includes('card locked')).length; }
    else if (gtab === 'equipment') {
      const e = equipCards(), all = [...e.weapons, ...e.armor, ...e.tiers];
      body = `<h3>Weapons</h3><div class="cards">${e.weapons.join('')}</div><h3>Armor</h3><div class="cards">${e.armor.join('')}</div><h3>Tiers</h3><div class="cards">${e.tiers.join('')}</div>`;
      total = all.length; got = all.filter(x => !x.includes('card locked')).length;
    } else if (gtab === 'statuses') { const c = statusCards(); body = `<div class="cards">${c.join('')}</div>`; total = c.length; got = c.filter(x => !x.includes('card locked')).length; }
    else { const c = enemyCards(); body = `<div class="cards">${c.join('')}</div>`; total = c.length; got = c.filter(x => !x.includes('card locked')).length; }
    return `<div class="tabs">${tabs}<span class="dim" style="margin-left:auto;align-self:center">Discovered ${got} / ${total}</span></div>${body}`;
  }
  function render() {
    root.innerHTML = `<div class="win">
      <div class="head"><b>${session.started ? 'Paused' : 'HoneyHan'}</b><span class="dim">Work in progress. Feedback welcome!</span></div>
      <div class="tabs"><button data-tab="controls" class="${tab === 'controls' ? 'on' : ''}">Controls</button><button data-tab="glossary" class="${tab === 'glossary' ? 'on' : ''}">Glossary</button></div>
      <div class="body">${tab === 'controls' ? controlsHtml() : glossaryHtml()}</div>
      <div class="foot"><span class="dim">${tab === 'controls' ? 'Changes save automatically.' : 'Entries unlock as you find items and meet enemies, and stay between runs.'}</span><button data-act="resume">${session.started ? 'Resume' : 'Back'}</button></div>
    </div>`;
  }

  // ---- rebinding ----
  function assign(action, code) {
    lastAssign = performance.now();
    if (code === 'Backquote') { note = 'That key is reserved.'; listening = null; render(); return; }
    const old = KEYS[action], other = Object.keys(KEYS).find(a => a !== action && KEYS[a] === code);
    KEYS[action] = code;
    if (other) KEYS[other] = old;                            // swap, so no action is left unbound
    note = code === 'ControlLeft' || code === 'ControlRight' ? 'Careful: Ctrl+W closes the browser tab.' : other ? `Swapped with "${CONTROL_LABELS.find(l => l[0] === other)[1]}".` : '';
    listening = null; saveKeys(); render();
  }
  addEventListener('keydown', e => {                        // capture phase: nothing else sees the key while listening
    if (!listening) return;
    e.preventDefault(); e.stopImmediatePropagation();
    if (e.code === 'Escape') { listening = null; note = ''; render(); return; }
    assign(listening, e.code);
  }, true);
  addEventListener('mousedown', e => {
    if (!listening) return;
    e.preventDefault(); e.stopImmediatePropagation();
    assign(listening, 'Mouse' + e.button);
  }, true);

  root.addEventListener('click', e => {
    if (performance.now() - lastAssign < 200) return;       // the click that finished a mouse rebind
    const t = e.target.closest('[data-tab],[data-g],[data-bind],[data-act]');
    if (!t) return;
    if (t.dataset.tab) { tab = t.dataset.tab; listening = null; note = ''; }
    else if (t.dataset.g) gtab = t.dataset.g;
    else if (t.dataset.bind) { listening = t.dataset.bind; note = ''; }
    else if (t.dataset.act === 'reset') { Object.assign(KEYS, DEFAULT_KEYS); saveKeys(); note = 'Controls reset.'; }
    else if (t.dataset.act === 'resume') return close();
    render();
  });

  // ---- opening and closing ----
  function open(which) {
    if (which) tab = which;
    if (state === 'play') { state = 'menu'; try { document.exitPointerLock(); } catch (e) {} cb.want = false; cb.press = false; player.keys = {}; }
    listening = null; note = ''; openedAt = performance.now();
    render();
    root.style.display = 'flex';
  }
  function close() {
    listening = null;
    root.style.display = 'none';
    if (session.started && state === 'menu') begin();       // back into the game
  }
  addEventListener('keydown', e => {
    if (e.code !== 'Escape' || e.repeat || listening) return;
    if (state === 'play') open('controls');
    else if (state === 'menu' && root.style.display === 'flex' && performance.now() - openedAt > 400) close();   // the Esc that freed the mouse must not close it again
  });

  for (const [id, which] of [['welcomeControls', 'controls'], ['welcomeGlossary', 'glossary']]) {
    const b = document.getElementById(id);
    if (b) b.addEventListener('click', e => { e.stopPropagation(); open(which); });   // do not start the game
  }
  discoverItem(inv.equip.weapon, true);                      // the starting sword is already known
  return { open, close, render };
})();
