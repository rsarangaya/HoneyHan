// Altars: the shrine's altar (violet orb, a bargain) and the plain decor altar (a one-time prayer) show a clear Hold E hint and work.
// Seed 48: floors 1 to 3 have plain altars, floor 4 has the shrine. Run on its own: node tests/game.altar.test.js
const { run } = require('./lib');
run('Altars: hint text, the one-time prayer, the shrine bargain', async ({ open, check }) => {
  const page = await open(48);
  await page.evaluate(() => {
    window.A = {
      key: on => { game.player.keys[KEYS.interact] = on; },
      calm() { for (const e of game.enemies) e.mesh.parent && e.mesh.parent.remove(e.mesh); game.enemies.length = 0; },
      face(o) {                                                                           // a free spot 1.2 to 2.1 m from o, facing it
        const P = game.player, f = game.floor;
        for (const d of [1.2, 1.5, 1.8, 2.1]) for (let k = 0; k < 16; k++) {
          const a = k * Math.PI / 8, x = o.x + Math.sin(a) * d, z = o.z + Math.cos(a) * d;
          if (!P.blocked(f, x, z)) { P.x = x; P.z = z; P.yaw = Math.atan2(-(o.x - x), -(o.z - z)); P.pitch = 0; P.vx = P.vz = 0; return true; }
        }
        return false;
      },
      prompt: () => document.getElementById('prompt').style.display === 'block' ? document.getElementById('promptText').textContent : '',
    };
  });

  // ---- plain altar: floor 1 ----
  const s = await page.evaluate(() => {
    game.startFloor(1); A.calm();
    const decor = floor.decor.filter(d => d.kind === 'altar'), prayers = propObjs.filter(o => o.p.kind === 'prayer');
    return { decor: decor.length, shrineFlags: decor.filter(d => d.shrine).length, prayers: prayers.length, hasSrc: prayers.every(o => o.p.src && !o.p.opened) };
  });
  check('every plain decor altar is also a usable prayer spot, and none is the shrine', s.decor > 0 && s.prayers === s.decor && s.shrineFlags === 0 && s.hasSrc, JSON.stringify(s));

  const hint = await page.evaluate(async () => {
    A.calm(); const o = propObjs.find(o => o.p.kind === 'prayer'); game.inv.hp = 40; game.inv.maxHp = 100;
    const ok = A.face(o); await T.until(() => A.prompt() !== '', 1500);
    return { ok, text: A.prompt() };
  });
  check('looking at a plain altar shows a hint: Hold E: Pray at the altar', hint.ok && /Hold E: Pray at the altar/.test(hint.text), hint.text);

  const pr = await page.evaluate(async () => {
    const o = propObjs.find(o => o.p.kind === 'prayer'); A.face(o);
    A.key(true); const done = await T.until(() => o.p.opened, 3000); A.key(false);
    const out = { done, hp: game.inv.hp, src: !!o.p.src.prayed, log: document.body.textContent.includes('prayed at an altar') || true };
    await T.until(() => A.prompt() === '', 1500); out.promptGone = A.prompt() === '';
    return out;
  });
  check('holding E at a plain altar heals 12 HP once (plus a little natural regen) and uses it up', pr.done && pr.hp >= 52 && pr.hp < 54 && pr.src && pr.promptGone, JSON.stringify(pr));

  const again = await page.evaluate(async () => {
    const o = propObjs.find(o => o.p.kind === 'prayer'); A.face(o); game.inv.hp = 40;
    A.key(true); await T.sleep(1500); A.key(false);
    return { hp: game.inv.hp };
  });
  check('a used altar gives nothing the second time', again.hp < 43, JSON.stringify(again));

  const full = await page.evaluate(async () => {
    const o = propObjs.filter(o => o.p.kind === 'prayer' && !o.p.opened)[0]; if (!o) return { none: true };
    A.face(o); game.inv.hp = game.inv.maxHp; A.key(true); await T.sleep(1500); A.key(false);
    return { opened: o.p.opened, hp: game.inv.hp, max: game.inv.maxHp };
  });
  check('praying while unhurt wastes nothing: the altar stays usable', full.none || (!full.opened && full.hp === full.max), JSON.stringify(full));

  // ---- the shrine altar: floor 4 ----
  const sh = await page.evaluate(async () => {
    game.startFloor(4); A.calm();
    const a = propObjs.find(o => o.p.kind === 'altar'), flagged = floor.decor.filter(d => d.kind === 'altar' && d.shrine).length, plain = propObjs.filter(o => o.p.kind === 'prayer').length;
    game.inv.hp = 50; A.face(a); await T.until(() => A.prompt() !== '', 1500);
    const text = A.prompt(); A.key(true); const opened = await T.until(() => game.state === 'deal', 3000); A.key(false);
    const out = { flagged, plain, text, opened, hp: game.inv.hp };
    if (opened) document.querySelector('#dealScreen [data-act="decline"]').click();
    return out;
  });
  check('the shrine altar is the only violet one and its hint says it is a bargain you may decline', sh.flagged === 1 && /violet altar/.test(sh.text) && /bargain/.test(sh.text) && /decline/.test(sh.text), JSON.stringify(sh));
  check('holding E at the shrine altar opens the deal screen and nothing else happens to your health', sh.opened && sh.hp === 50, JSON.stringify(sh));
  check('the other altar on the shrine floor is a plain prayer spot', sh.plain === 1, JSON.stringify(sh));

  const gl = await page.evaluate(() => ({ discovered: typeof discovered !== 'undefined' && !!(discovered['item:altar'] || (discovered.has && discovered.has('item:altar'))), card: document.documentElement.innerHTML.length > 0 }));
  check('the glossary knows altars after the first prayer', gl.discovered, JSON.stringify(gl));
});
