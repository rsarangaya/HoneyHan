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
  `;
  document.head.appendChild(css);
  const root = document.createElement('div');
  root.id = 'invScreen';
  document.body.appendChild(root);

  let sel = null;                       // { src: 'pack', id } or { src: 'equip', slot }
  let note = '';

  const selected = () => !sel ? null : sel.src === 'pack' ? inv.find(sel.id) : inv.equip[sel.slot];
  const nameHtml = it => `<span style="color:${itemColor(it)}">${itemName(it)}${it.type === 'potion' ? ' x' + it.n : ''}</span>`;
  const sub = it => it.type === 'weapon' || it.type === 'armor' ? tierName(it) + (it.type === 'armor' ? ' ' + ARMOR_LABEL[it.slot].toLowerCase() : '') : it.type === 'potion' ? 'Potion' : 'Key';
  const slotBox = (slot, label) => {
    const it = inv.equip[slot];
    const on = sel && sel.src === 'equip' && sel.slot === slot ? ' sel' : '';
    return `<div class="box${on}" data-equip="${slot}">${it ? `${nameHtml(it)}<small>${label} · ${sub(it)}</small>` : `<span class="dim">${label}: empty</span>`}</div>`;
  };

  // How a pack item compares to what you are wearing or holding.
  function compare(it) {
    if (it.type === 'weapon') {
      const a = weaponStats(it), b = weaponStats(inv.equip.weapon);
      if (a.ranged || b.ranged) return '';
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
        if (it.type === 'weapon' || it.type === 'armor') buttons += btn('equip', 'Equip');
        if (it.type === 'potion') buttons += btn('drink', 'Drink');
        if (it.type === 'weapon' || it.type === 'potion') buttons += [0, 1, 2, 3].map(i => btn('q' + i, `→ ${i + 1}`)).join('');
        if (it.type !== 'key') buttons += btn('drop', 'Drop');
      } else if (it.type === 'armor') buttons += btn('unequip', 'Unequip');
      else buttons += '<span class="dim">Equipped. Equip another from the pack to swap.</span>';
      detail = `<div class="nm">${nameHtml(it)}</div><div class="dim">${sub(it)}${fromPack ? '' : ' · equipped'}</div>
        <ul>${lines}</ul>${fromPack && compare(it) ? `<div class="cmp">${compare(it)}</div>` : ''}${buttons}`;
    }
    const arm = ['head', 'body', 'legs'].map(z => `${z} ${Math.round(inv.armorRed(z) * 100)}%`).join(', ');
    const buffs = Object.entries(inv.buffs).map(([k, t]) => `${k} ${Math.ceil(t)}s`).join(', ');
    root.innerHTML = `<div class="win">
      <div class="head"><b>Inventory</b><span>Gold ${inv.gold} · Arrows ${inv.arrows}/${QUIVER_MAX} · Pack ${inv.pack.length}/${PACK_MAX}</span><button data-act="close">Close (${keyName(KEYS.inventory)})</button></div>
      <div class="cols">
        <div class="eq"><h3>Equipped</h3>${slotBox('weapon', 'Weapon')}${slotBox('helmet', 'Helmet')}${slotBox('chest', 'Chest')}${slotBox('boots', 'Boots')}</div>
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
    if (a === 'equip') { inv.equipItem(it); sel = { src: 'equip', slot: it.type === 'weapon' ? 'weapon' : it.slot }; }
    else if (a === 'unequip') { if (inv.unequip(sel.slot)) sel = null; else note = 'Pack is full.'; }
    else if (a === 'drink') { note = inv.drink(it); if (!inv.find(it.id)) sel = null; }
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
