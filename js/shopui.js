// The shop screen (DESIGN.md section 14). Hold E at the merchant's counter to open it. The game pauses, like the
// inventory. Left: the stock to buy. Right: your pack, to sell. All the rules live in js/shop.js.
const shopUI = (() => {
  const css = document.createElement('style');
  css.textContent = `
    #shopScreen { position: fixed; inset: 0; z-index: 30; display: none; align-items: center; justify-content: center; background: #000b; font: 13px system-ui, sans-serif; color: #eee; }
    #shopScreen .win { width: min(900px, 96vw); max-height: 92vh; overflow: auto; background: #15130f; border: 1px solid #e8c860; padding: 12px 14px; }
    #shopScreen .head { display: flex; justify-content: space-between; align-items: center; margin-bottom: 8px; }
    #shopScreen .head b { font-size: 18px; color: #e8c860; }
    #shopScreen .cols { display: grid; grid-template-columns: 1fr 1fr; gap: 14px; }
    #shopScreen h3 { margin: 0 0 6px; font-size: 12px; letter-spacing: .08em; text-transform: uppercase; opacity: .7; }
    #shopScreen .row { display: flex; justify-content: space-between; align-items: center; gap: 8px; padding: 5px 7px; border: 1px solid #fff3; background: #0007; margin-bottom: 4px; }
    #shopScreen .row small { display: block; opacity: .6; font-size: 11px; }
    #shopScreen .row.gone { opacity: .35; }
    #shopScreen button { font: 12px system-ui; padding: 4px 10px; cursor: pointer; white-space: nowrap; }
    #shopScreen button[disabled] { opacity: .4; cursor: default; }
    #shopScreen .gold { color: #e8c860; font-weight: 700; }
    #shopScreen .note { min-height: 18px; margin: 6px 0; color: #e8c860; }
    #shopScreen .dim { opacity: .55; }
  `;
  document.head.appendChild(css);
  const root = document.createElement('div');
  root.id = 'shopScreen';
  document.body.appendChild(root);
  let note = '';

  const nameHtml = it => `<span style="color:${it.type === 'arrows' ? '#c8c8c8' : itemColor(it)}">${it.type === 'arrows' ? 'Arrows (pack of 5)' : itemName(it)}</span>`;
  const subText = it => it.type === 'arrows' ? 'Ammo for the bow' : it.type === 'weapon' || it.type === 'armor' || it.type === 'shield' ? tierName(it) + (it.type === 'armor' ? ' ' + ARMOR_LABEL[it.slot].toLowerCase() : it.type === 'shield' ? ' shield' : '')
    : it.type === 'potion' ? 'Potion' : it.type === 'food' ? 'Food' : it.type === 'wand' ? `Wand · ${it.charges === undefined ? WANDS[it.kind].charges : it.charges} charges` : it.type === 'rechargewand' ? 'Recharge wand' : '';
  const tip = it => it.type === 'arrows' ? '' : itemLines(it).join(' · ').replace(/"/g, '&quot;');

  function render() {
    const stock = floor.shopStock || [];
    const buy = stock.map((s, i) => `<div class="row${s.qty <= 0 ? ' gone' : ''}" title="${tip(s.item)}">
        <div>${nameHtml(s.item)}${s.featured ? ' <span class="gold">★ featured</span>' : ''}${s.qty > 1 ? ` <span class="dim">x${s.qty}</span>` : ''}<small>${subText(s.item)}</small></div>
        <button data-buy="${i}" ${s.qty <= 0 || inv.gold < s.price ? 'disabled' : ''}>${s.qty <= 0 ? 'Sold out' : 'Buy ' + s.price + 'g'}</button></div>`).join('');
    const sell = inv.pack.length ? inv.pack.map(it => {
      const v = sellValue(it);
      return `<div class="row${v ? '' : ' gone'}" title="${tip(it)}"><div>${nameHtml(it)}${it.n > 1 ? ` <span class="dim">x${it.n}</span>` : ''}<small>${subText(it) || 'Key'}</small></div>
        <button data-sell="${it.id}" ${v ? '' : 'disabled'}>${v ? 'Sell ' + v + 'g' : 'Not bought'}</button></div>`;
    }).join('') : '<div class="dim">Your pack is empty.</div>';
    root.innerHTML = `<div class="win">
      <div class="head"><b>The Merchant</b><span>Your gold: <span class="gold">${inv.gold}</span> · Arrows ${inv.arrows}/${QUIVER_MAX} · Pack ${inv.pack.length}/${PACK_MAX}</span><button data-close="1">Close (Esc)</button></div>
      <div class="note">${note || '"Gold talks, stranger. Everything is for sale, and I pay 35% for whatever you carry."'}</div>
      <div class="cols"><div><h3>For sale</h3>${buy}</div><div><h3>Your pack (sell)</h3>${sell}<p class="dim">Equipped gear cannot be sold: unequip it first. Keys, gold and arrows are not bought.</p></div></div>
    </div>`;
  }

  root.addEventListener('click', e => {
    const t = e.target.closest('[data-buy],[data-sell],[data-close]');
    if (!t || t.disabled) return;
    if (t.dataset.close) return close();
    if (t.dataset.buy !== undefined) note = buyFromStock(inv, floor.shopStock, +t.dataset.buy).msg;
    else if (t.dataset.sell !== undefined) { const it = inv.find(+t.dataset.sell); if (it) note = sellToMerchant(inv, it).msg; }
    render();
  });
  function open() {
    if (state !== 'play' || !floor.shop) return;
    state = 'shop';
    document.exitPointerLock();
    cb.want = false; cb.press = false; cb.draw = null;
    discover('item:shop', 'The Merchant');
    note = ''; render();
    root.style.display = 'flex';
  }
  function close() {
    root.style.display = 'none';
    state = 'play';
    try { canvas.requestPointerLock(); } catch (e) {}
  }
  addEventListener('keydown', e => { if (e.code === 'Escape' && state === 'shop') { e.preventDefault(); e.stopImmediatePropagation(); close(); } });   // stop the pause menu opening on the same key
  return { open, close, render };
})();
