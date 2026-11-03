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
    out.push(card('item:gold', 'Gold', '#e8c860', ['Money. There is no shop yet, so gold is useless for now.']));
    out.push(card('item:arrows', 'Arrows', '#c8c8c8', ['Ammo for the bow. There is no bow yet, so arrows are useless for now.']));
    out.push(card('item:key', 'Keys', '#e8c860', ['Open a locked room (armory, vault or brewery) on the same floor. Each key hides in a chest. Hold the interact key at the door.']));
    for (const k of Object.keys(POTIONS)) out.push(card('potion:' + k, POTIONS[k].name, POTIONS[k].color, [POTIONS[k].desc, 'Found on potion shelves, in chests and barrels, and on monsters.']));
    return out;
  }
  function equipCards() {
    const weapons = ['dagger', 'sword', 'mace'].map(b => card('weapon:' + b, WEAPON_NAMES[b], '#c8c8c8', itemLines({ type: 'weapon', base: b, tier: 0 }).concat('Stats shown at Common tier.')));
    const armor = [];
    for (const s of ARMOR_SLOTS) ARMOR_NAMES[s].forEach((n, cls) => armor.push(card(`armor:${s}:${cls}`, n, '#c8c8c8', itemLines({ type: 'armor', slot: s, cls, tier: 0 }).concat('Stats shown at Common tier.'))));
    const tiers = TIERS.map((t, i) => card('tier:' + i, `${t.name} tier`, t.color, [`Multiplies weapon damage and armor protection by x${t.mul}.`, i === 4 ? 'Legendary weapons have their own names.' : 'Higher tiers drop deeper in the dungeon, from vaults and armories, and from bosses.']));
    return { weapons, armor, tiers };
  }
  function enemyCards() {
    return [
      card('enemy:goblin', 'Goblin Guard', '#8fbf5a', [
        `${TUNE.enemyHp} HP. Patrols between rooms and carries a random weapon (dagger, sword or mace) and sometimes armor.`,
        'Sees in a cone ahead of it (shorter if you crouch, longer if you sprint) and hears footsteps, fights and chests.',
        'Unaware, suspicious, alerted or searching: the icon over its head shows which.',
        'Its swing shows where it will hit (overhead is the head, sideways is the body, low is the legs). Block head and body hits. Leg sweeps go under a block.',
        'Hit it from behind while it has not noticed you for a sneak attack. A dagger kills it outright.',
        'Has a chance to drop one item when it dies.']),
      card('enemy:boss', 'Cave Warlord', '#c0503a', [
        `Boss of floor 5. ${TUNE.bossHp} HP in heavy plate, and it hits much harder than a guard.`,
        'Sleeps in the middle of the arena until you get close. Cannot be sneak-killed and is not staggered by normal hits.',
        'A parry still staggers it, and a sprinting player can outrun it.',
        'Drops an Epic piece of equipment (with a small chance of Legendary), more equipment and gold. The stairs stay sealed until it falls.']),
    ];
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
    const sections = { items: 'Items', equipment: 'Equipment', enemies: 'Enemies' };
    const tabs = Object.entries(sections).map(([k, v]) => `<button data-g="${k}" class="${gtab === k ? 'on' : ''}">${v}</button>`).join(' ');
    let body, total, got;
    if (gtab === 'items') { const c = itemCards(); body = `<div class="cards">${c.join('')}</div>`; total = c.length; got = c.filter(x => !x.includes('card locked')).length; }
    else if (gtab === 'equipment') {
      const e = equipCards(), all = [...e.weapons, ...e.armor, ...e.tiers];
      body = `<h3>Weapons</h3><div class="cards">${e.weapons.join('')}</div><h3>Armor</h3><div class="cards">${e.armor.join('')}</div><h3>Tiers</h3><div class="cards">${e.tiers.join('')}</div>`;
      total = all.length; got = all.filter(x => !x.includes('card locked')).length;
    } else { const c = enemyCards(); body = `<div class="cards">${c.join('')}</div>`; total = c.length; got = c.filter(x => !x.includes('card locked')).length; }
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
