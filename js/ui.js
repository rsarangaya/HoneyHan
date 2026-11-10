// Inventory screen. Tab or I opens it and pauses the game. Pickups only ever land in the backpack:
// you decide what to equip, what to drink, and what goes on a quickslot.
const invUI = (() => {
  const css = document.createElement('style');
  css.textContent = `
    #invScreen { position: fixed; inset: 0; z-index: 30; display: none; align-items: center; justify-content: center; background: #000b; font: 13px system-ui, sans-serif; color: #eee; }
    #invScreen .win { width: min(860px, 96vw); max-height: 92vh; overflow: auto; background: #15130f; border: 1px solid #e8c860; padding: 12px 14px; }
    #invScreen .head { display: flex; justify-content: space-between; align-items: center; margin-bottom: 10px; }
    #invScreen .head b { font-size: 18px; }
    #invScreen .cols { display: grid; grid-template-columns: 200px 1fr 260px; gap: 14px; }
    #invScreen h3 { margin: 0 0 6px; font-size: 12px; letter-spacing: .08em; text-transform: uppercase; opacity: .7; }
    #invScreen .box { border: 1px solid #fff4; background: #0007; padding: 5px 7px; min-height: 38px; cursor: pointer; font-size: 12px; line-height: 1.25; }
    #invScreen .box:hover { background: #fff1; }
    #invScreen .box.sel { outline: 2px solid #e8c860; }
    #invScreen .box small { display: block; opacity: .6; font-size: 10px; }
    #invScreen .eq .box { margin-bottom: 6px; }
    #invScreen .grid { display: grid; grid-template-columns: repeat(4, 1fr); gap: 6px; }
    #invScreen .grid .box.empty { opacity: .3; cursor: default; }
    #invScreen .detail { border: 1px solid #fff3; padding: 8px 10px; min-height: 200px; }
    #invScreen .detail .nm { font-size: 15px; font-weight: 700; }
    #invScreen .detail ul { margin: 6px 0; padding-left: 16px; }
    #invScreen .detail .cmp { color: #9ad; font-size: 12px; margin-bottom: 6px; }
    #invScreen button { font: 12px system-ui; padding: 4px 9px; margin: 2px 4px 2px 0; cursor: pointer; }
    #invScreen .quick { display: grid; grid-template-columns: repeat(4, 1fr); gap: 6px; margin-top: 12px; }
    #invScreen .sum { margin-top: 10px; opacity: .8; font-size: 12px; }
    #invScreen .dim { opacity: .5; }
    #invScreen .icon { float: right; margin: 0 0 4px 8px; }
  `;
  document.head.appendChild(css);
  const root = document.createElement('div');
  root.id = 'invScreen';
  document.body.appendChild(root);

  let sel = null;                       // { src: 'pack', id } or { src: 'equip', slot }
  let note = '';

  const selected = () => !sel ? null : sel.src === 'pack' ? inv.find(sel.id) : inv.equip[sel.slot];
  const nameHtml = it => `<span style="color:${itemColor(it)}">${itemName(it)}${it.type === 'potion' || it.type === 'food' ? ' x' + it.n : it.type === 'wand' || it.type === 'rage' ? ' (' + it.charges + ')' : it.base === 'spear' ? (isLimp(it) ? ' (LIMP)' : ' (' + it.charges + ')') : ''}</span>`;
  const sub = it => it.base === 'spear' ? (isLimp(it) ? 'Legendary spear · LIMP' : `Legendary spear · ${it.charges}/${WSTATS.spear.kills} kills left`) : it.type === 'weapon' || it.type === 'armor' || it.type === 'shield' ? tierName(it) + (it.type === 'armor' ? ' ' + ARMOR_LABEL[it.slot].toLowerCase() : it.type === 'shield' ? ' shield' : '') : it.type === 'potion' ? 'Potion' : it.type === 'food' ? 'Food' : it.type === 'wand' ? `${WANDS[it.kind].legendary ? 'Legendary wand' : 'Wand'} · ${it.charges}/${WANDS[it.kind].charges} charges` : it.type === 'rechargewand' ? 'Recharge wand' : it.type === 'rage' ? `Legendary recorder · ${it.charges} plays` : 'Key';
  const slotBox = (slot, label) => {
    const it = inv.equip[slot];
    const on = sel && sel.src === 'equip' && sel.slot === slot ? ' sel' : '';
    return `<div class="box${on}" data-equip="${slot}">${it ? `${nameHtml(it)}<small>${label} · ${sub(it)}</small>` : `<span class="dim">${label}: empty</span>`}</div>`;
  };

  // Little drawn pictures of the three one-of-a-kind pieces. Ian's Hog is drawn standing tall, or limp and sagging.
  function itemIcon(it) {
    const svg = inner => `<svg class="icon" width="74" height="96" viewBox="0 0 74 96">${inner}</svg>`;
    if (it.base === 'spear') {
      if (isLimp(it)) return svg('<path d="M14 90 C 24 50, 36 36, 52 30 C 62 28, 64 40, 60 56" fill="none" stroke="#8a7a72" stroke-width="5" stroke-linecap="round"/><polygon points="55,54 65,54 60,82" fill="#8e8a92"/><rect x="54" y="50" width="12" height="5" fill="#8a8068"/><path d="M60 46 l-3 -8 M60 46 l3 -8" stroke="#8a6068" stroke-width="3"/><text x="4" y="12" fill="#e8908a" font-size="11" font-weight="700">LIMP</text>');
      return svg('<line x1="37" y1="92" x2="37" y2="26" stroke="#7a5530" stroke-width="5" stroke-linecap="round"/><polygon points="37,2 45,26 29,26" fill="#d8dce4" stroke="#fff" stroke-width="1"/><rect x="32" y="26" width="10" height="5" fill="#d9a830"/><path d="M37 34 l-4 12 h8 z" fill="#c02a2a"/>');
    }
    if (it.unique === 'dunce') return svg('<polygon points="37,4 62,84 12,84" fill="#f4f1e4" stroke="#bbb" stroke-width="2"/><ellipse cx="37" cy="86" rx="28" ry="6" fill="#e6e2d0" stroke="#bbb"/><text x="37" y="66" text-anchor="middle" fill="#c02a2a" font-size="30" font-weight="900" font-family="serif">D</text><circle cx="37" cy="5" r="4" fill="#c02a2a"/>');
    if (it.kind === 'bust') return svg('<rect x="33" y="30" width="6" height="60" rx="3" fill="#5a3a20" transform="rotate(12 36 60)"/><circle cx="26" cy="26" r="10" fill="#fff" stroke="#ddd"/><ellipse cx="22" cy="42" rx="4" ry="8" fill="#fff"/><ellipse cx="32" cy="46" rx="3" ry="6" fill="#fff"/><ellipse cx="18" cy="28" rx="3" ry="5" fill="#fff"/>');
    return '';
  }

  // How a pack item compares to what you are wearing or holding.
  function compare(it) {
    if (it.type === 'weapon') {
      const a = weaponStats(it), b = weaponStats(inv.equip.weapon.type === 'wand' ? { type: 'weapon', base: 'dagger', tier: 0 } : inv.equip.weapon);
      if (a.ranged || b.ranged) return a.ranged && b.ranged ? `vs equipped: damage ${a.dmg - b.dmg >= 0 ? '+' : ''}${(a.dmg - b.dmg).toFixed(1)}` : 'A bow is a different style: slow, ranged, uses arrows.';
      const d = a.dmg - b.dmg;
      return `vs equipped: damage ${d >= 0 ? '+' : ''}${d.toFixed(1)}, swing ${a.dur >= b.dur ? '+' : ''}${(a.dur - b.dur).toFixed(2)} s`;
    }
    if (it.type === 'armor') {
      const cur = inv.equip[it.slot];
      const d = armorStats(it).red - (cur ? armorStats(cur).red : 0);
      return `vs equipped: ${d >= 0 ? '+' : ''}${Math.round(d * 100)}% ${ARMOR_ZONE[it.slot]} protection`;
    }
    return '';
  }

  function render() {
    const slots = inv.quick.map((_, i) => {
      const it = inv.quickItem(i);
      return `<div class="box" data-quick="${i}" style="border-color:${it ? itemColor(it) : '#fff4'}"><small>Slot ${i + 1}</small>${it ? nameHtml(it) : '<span class="dim">empty</span>'}</div>`;
    }).join('');
    const grid = Array.from({ length: PACK_MAX }, (_, i) => {
      const it = inv.pack[i];
      if (!it) return '<div class="box empty"></div>';
      const on = sel && sel.src === 'pack' && sel.id === it.id ? ' sel' : '';
      const inQuick = inv.quick.indexOf(it.id);
      return `<div class="box${on}" data-pack="${it.id}" style="border-color:${itemColor(it)}">${nameHtml(it)}<small>${sub(it)}${inQuick >= 0 ? ` · slot ${inQuick + 1}` : ''}</small></div>`;
    }).join('');

    const it = selected();
    let detail = '<span class="dim">Select an item.</span>';
    if (it) {
      const fromPack = sel.src === 'pack';
      const lines = itemLines(it).map(l => `<li>${l}</li>`).join('');
      const btn = (act, label) => `<button data-act="${act}">${label}</button>`;
      let buttons = '';
      if (fromPack) {
        if (it.type === 'weapon' || it.type === 'armor' || it.type === 'shield' || it.type === 'wand') buttons += btn('equip', 'Equip');
        if (it.type === 'rage') buttons += btn('play', 'Play it');
        if (it.type === 'rechargewand') {                                              // pick which wand to recharge
          const wands = [inv.equip.weapon, ...inv.pack].filter(rechargeable);
          buttons += wands.length ? wands.map(wd => btn('rech' + wd.id, `Recharge ${itemName(wd)} (${isLimp(wd) ? 'LIMP' : wd.charges + '/' + chargeMax(wd)})`)).join('') : '<span class="dim">You have no wand or spear to recharge.</span>';
        }
        if (it.type === 'potion') buttons += btn('drink', 'Drink');
        if (it.type === 'food') buttons += btn('eat', 'Eat');
        if (['weapon', 'potion', 'food', 'wand', 'rechargewand', 'rage'].includes(it.type)) buttons += [0, 1, 2, 3].map(i => btn('q' + i, `→ ${i + 1}`)).join('');
        if (it.type !== 'key') buttons += btn('drop', 'Drop');
      } else if (it.type === 'armor' || it.type === 'shield') buttons += btn('unequip', 'Unequip');
      else buttons += '<span class="dim">Equipped. Equip another from the pack to swap.</span>';
      detail = `${itemIcon(it)}<div class="nm">${nameHtml(it)}</div><div class="dim">${sub(it)}${fromPack ? '' : ' · equipped'}</div>
        <ul>${lines}</ul>${fromPack && compare(it) ? `<div class="cmp">${compare(it)}</div>` : ''}${buttons}`;
    }
    const arm = ['head', 'body', 'legs'].map(z => `${z} ${Math.round(inv.armorRed(z) * 100)}%`).join(', ');
    const buffs = Object.entries(inv.buffs).map(([k, t]) => `${k} ${Math.ceil(t)}s`).join(', ');
    root.innerHTML = `<div class="win">
      <div class="head"><b>Inventory</b><span>Gold ${inv.gold} · Food ${Math.round(hunger.v)}% · Arrows ${inv.arrows}/${QUIVER_MAX} · Pack ${inv.pack.length}/${PACK_MAX}</span><button data-act="close">Close (${keyName(KEYS.inventory)})</button></div>
      <div class="cols">
        <div class="eq"><h3>Equipped</h3>${slotBox('weapon', 'Weapon')}${slotBox('offhand', 'Off-hand')}${slotBox('helmet', 'Helmet')}${slotBox('chest', 'Chest')}${slotBox('boots', 'Boots')}</div>
        <div><h3>Backpack</h3><div class="grid">${grid}</div></div>
        <div><h3>Details</h3><div class="detail">${detail}</div></div>
      </div>
      <div class="quick">${slots}</div>
      <div class="sum">Armor cuts damage: ${arm}. Armor noise +${inv.armorNoise()} m.${buffs ? ' Active: ' + buffs + '.' : ''}${note ? '<br><b>' + note + '</b>' : ''}</div>
      <div class="sum dim">Pickups go to the backpack only. Assign weapons and potions to a quickslot with the → buttons, then press ${[1, 2, 3, 4].map(n => keyName(KEYS['slot' + n])).join(', ')} in the game.</div>
    </div>`;
  }

  function act(a) {
    const it = selected();
    note = '';
    if (a === 'close') return close();
    if (!it) return;
    if (a === 'equip') { inv.equipItem(it); sel = { src: 'equip', slot: it.type === 'weapon' || it.type === 'wand' ? 'weapon' : it.slot }; }
    else if (a === 'unequip') { if (inv.unequip(sel.slot)) sel = null; else note = 'Pack is full.'; }
    else if (a === 'drink') { note = inv.drink(it); if (!inv.find(it.id)) sel = null; }
    else if (a === 'play') { inv.rageReq = it; sel = null; return close(); }
    else if (/^rech\d+$/.test(a)) { const tgt = [inv.equip.weapon, ...inv.pack].find(i => i.id === +a.slice(4)); note = inv.recharge(it, tgt); if (!inv.find(it.id)) sel = null; }
    else if (a === 'eat') { inv.eatReq = it; sel = null; return close(); }
    else if (a === 'drop') { inv.remove(it); sel = null; }
    else if (/^q\d$/.test(a)) inv.assignQuick(+a[1], it);
  }

  root.addEventListener('click', e => {
    const t = e.target.closest('[data-act],[data-pack],[data-equip],[data-quick]');
    if (!t) return;
    if (t.dataset.act) act(t.dataset.act);
    else if (t.dataset.pack) sel = { src: 'pack', id: +t.dataset.pack };
    else if (t.dataset.equip) sel = { src: 'equip', slot: t.dataset.equip };
    else if (t.dataset.quick) { const q = inv.quickItem(+t.dataset.quick); if (q) sel = { src: 'pack', id: q.id }; }
    if (root.style.display !== 'none') render();
  });

  function open() {
    if (state !== 'play') return;
    state = 'inv';
    document.exitPointerLock();
    cb.want = false; cb.press = false;
    sel = null; note = '';
    render();
    root.style.display = 'flex';
  }
  function close() {
    root.style.display = 'none';
    state = 'play';
    try { canvas.requestPointerLock(); } catch (e) {}
  }
  addEventListener('keydown', e => {
    if (e.code === KEYS.inventory || e.code === 'Tab') {   // Tab always works so a rebind cannot strand you in the screen
      e.preventDefault();
      if (e.repeat) return;
      if (state === 'play') open(); else if (state === 'inv') close();
    } else if (e.code === 'Escape' && state === 'inv') close();
  });
  return { open, close, render };
})();
