// Co-op networking, plain Node: node tests/net.test.js
// Codes, packets, quantization, interpolation and the authority rules (js/net.js). The browser side is tests/game.coop.test.js.
const { Net } = require('../js/net.js');
let fails = 0;
const check = (name, ok, detail = '') => { console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${detail ? '  (' + detail + ')' : ''}`); if (!ok) fails++; };
const near = (a, b, e = 0.01) => Math.abs(a - b) < e;

const FP = Array.from({ length: 32 }, (_, i) => (i * 7 % 256).toString(16).padStart(2, '0').toUpperCase()).join(':');
const SDP = ['v=0', 'o=- 123 2 IN IP4 127.0.0.1', 's=-', 't=0 0', 'a=group:BUNDLE 0', 'a=extmap-allow-mixed', 'a=msid-semantic: WMS', 'm=application 9 UDP/DTLS/SCTP webrtc-datachannel', 'c=IN IP4 0.0.0.0',
  'a=candidate:1 1 udp 2113937151 192.168.1.20 54321 typ host generation 0', 'a=candidate:2 1 udp 1677729535 203.0.113.9 40000 typ srflx raddr 192.168.1.20 rport 54321 generation 0',
  'a=ice-ufrag:AbCd', 'a=ice-pwd:0123456789abcdefghijklmn', 'a=ice-options:trickle', 'a=fingerprint:sha-256 ' + FP,
  'a=setup:actpass', 'a=mid:0', 'a=sctp-port:5000', 'a=max-message-size:262144', ''].join('\r\n');

(async () => {
  // ---- codes ----
  const code = await Net.encodeCode(SDP, 'offer');
  check('invite code is one short token (HH1 prefix, base64url only)', /^HH1o[zp][A-Za-z0-9_-]+$/.test(code), code.length + ' chars');
  check('code is much shorter than the SDP', code.length < SDP.length * 0.7, `${code.length} vs ${SDP.length}`);
  const dec = await Net.decodeCode(code);
  const a = Net.compactSdp(SDP), b = Net.compactSdp(dec.sdp);
  check('encode/decode round trip keeps ufrag, pwd, fingerprint and candidates', dec.type === 'offer' && a.u === b.u && a.p === b.p && a.f === b.f && JSON.stringify(a.c) === JSON.stringify(b.c));
  check('decoded SDP is a data-channel session with the candidates', /m=application 9 UDP\/DTLS\/SCTP webrtc-datachannel/.test(dec.sdp) && /a=candidate:1 1 udp/.test(dec.sdp) && /a=setup:actpass/.test(dec.sdp));
  const ans = await Net.encodeCode(SDP.replace('actpass', 'active'), 'answer'), dA = await Net.decodeCode(ans);
  check('an answer code decodes as an answer and sets up as active', dA.type === 'answer' && /a=setup:active/.test(dA.sdp));
  check('whitespace and line breaks in a pasted code are tolerated', (await Net.decodeCode(code.replace(/(.{20})/g, '$1\n  '))).type === 'offer');
  let threw = 0; for (const bad of ['', 'hello', 'HH1oz!!!', 'HH1xpAAAA']) { try { await Net.decodeCode(bad); } catch (e) { threw++; } }
  check('bad codes are rejected with an error', threw === 4, threw + '/4');
  check('a corrupt compressed body is rejected', await Net.decodeCode(code.slice(0, 8) + 'AAAA' + code.slice(12)).then(() => false, () => true));

  // ---- player packet ----
  const dv = n => { const v = Net.sendView(n); return new DataView(v.buffer.slice(v.byteOffset, v.byteOffset + v.length)); };
  const p = { x: 123.456, z: 7.89, yaw: -1.2, pitch: 0.4, flags: Net.F.SPRINT | Net.F.ATTACK, hp: 0.5, floor: 7, seq: 70000, noise: 6.5, speed: 4.6 };
  const n = Net.packPlayer(p), o = Net.unpackPlayer(dv(n), {});
  check('player packet is 19 bytes', n === 19);
  check('player packet round trip', near(o.x, p.x, 0.001) && near(o.z, p.z, 0.001) && near(o.yaw, (p.yaw + 2 * Math.PI) % (2 * Math.PI), 0.001) && near(o.pitch, 0.4, 0.02) && o.flags === p.flags && near(o.hp, 0.5, 0.01) && o.floor === 7 && o.seq === 70000 % 65536 && near(o.noise, 6.5, 0.1) && near(o.speed, 4.6, 0.05));
  check('packet kind is readable', Net.kindOf(dv(n)) === Net.T_PLAYER);

  // ---- snapshot ----
  Net.snapBegin(3, 65537);
  for (let i = 0; i < 10; i++) Net.snapAdd(i * 100, 10.004 + i, 99.999, i * 0.5, i, i / 10);
  const len = Net.snapEnd(), sd = dv(len), h = Net.snapHead(sd, {}), e3 = Net.snapAt(sd, 3, {});
  check('snapshot header', h.floor === 3 && h.seq === 1 && h.n === 10 && Net.kindOf(sd) === Net.T_SNAP);
  check('snapshot is 9 bytes per enemy', len === 5 + 90);
  check('position quantized to 1 cm', e3.nid === 300 && near(e3.x, 13.004, 0.006) && near(e3.z, 99.999, 0.006), `${e3.x} ${e3.z}`);
  check('yaw quantized (about 1.4 degrees) and hp rounds up (a live enemy is never 0)', near(e3.yaw, 1.5, 0.03) && e3.flags === 3 && near(e3.hp, 0.3, 0.005));
  Net.snapBegin(0, 0); Net.snapAdd(1, 1, 1, 0, 0, 0.001); check('1% hp is not rounded to dead', Net.snapAt(dv(Net.snapEnd()), 0, {}).hp > 0);
  Net.snapBegin(0, 0); let added = 0; for (let i = 0; i < 100; i++) if (Net.snapAdd(i, 1, 1, 0, 0, 1)) added++;
  check('snapshot is capped, under 600 bytes', added === Net.SNAP_MAX && Net.snapEnd() < 600, Net.snapEnd() + ' bytes');
  Net.snapBegin(0, 0); Net.snapAdd(1, 700, -5, 0, 0, 1); const cl = Net.snapAt(dv(Net.snapEnd()), 0, {}); check('out-of-range coordinates clamp, not wrap', near(cl.x, 655.35, 0.01) && cl.z === 0);

  // ---- interpolation ----
  const t = new Net.Track();
  t.push(1000, 0, 0, 0); check('one sample: stands at it', t.at(1100).x === 0);
  t.push(1100, 6, 0, 0);
  check('halfway between two samples', near(t.at(1050).x, 3) && near(t.speed, 60));
  check('before the first sample it holds there', near(t.at(900).x, 0));
  check('a late packet extrapolates only a little (max 1.25 of the span)', near(t.at(5000).x, 7.5));
  const ty = new Net.Track(); ty.push(0, 0, 0, 6.2); ty.push(100, 0, 0, 0.2);
  check('yaw takes the short way round 2 pi', near(ty.at(50).yaw, 6.2 + Net.angDiff(6.2, 0.2) * 0.5, 0.01) && Math.abs(Net.angDiff(6.2, 0.2)) < 0.3);
  const tj = new Net.Track(); tj.push(0, 0, 0, 0); tj.push(100, 50, 0, 0);
  check('a teleport (new floor, > 8 m) does not slide across the map', near(tj.at(100).x, 50) && near(tj.at(1).x, 50));

  // ---- authority rules ----
  check('friendly fire multiplier', near(Net.ffDamage(20, 0.5), 10) && near(Net.ffDamage(20, 0), 0));
  const cb = new Net.ClaimBook();
  check('pickup claim conflict: the first claim wins, the second loses', cb.claim(5, 0) === true && cb.claim(5, 1) === false && cb.claim(6, 1) === true);
  cb.release(5); check('a released claim (pack full) can be taken again', cb.claim(5, 1) === true);
  cb.reset(); check('claims reset on a new floor', cb.claim(5, 0) === true);
  check('XP range: 20 m', Net.xpInRange(14, 14, 20) && !Net.xpInRange(15, 15, 20) && Net.xpInRange(0, 20, 20));
  check('melee range check is loose', Net.meleeOk(8, 6.9) && !Net.meleeOk(40, 6.9));
  const rv = new Net.Revive(3);
  let done = false; for (let i = 0; i < 29; i++) done = rv.step(0.1, true) || done;
  check('revive: not done at 2.9 s', !done && near(rv.frac, 0.97, 0.01));
  check('revive: done at 3 s', rv.step(0.1, true) === true && rv.t === 0);
  const rv2 = new Net.Revive(3); rv2.step(1.5, true); rv2.step(0.5, false);
  check('revive: letting go loses progress', near(rv2.t, 0.5));
  const g = new Net.StairGate(8);
  check('stairs: nobody there, nothing', g.step(1, false, false) === false);
  check('stairs: one waits, the other is not there yet', g.step(1, true, false) === false && g.step(5, true, false) === false);
  check('stairs: the other arrives, both go', g.step(0.1, true, true) === true && g.t === 0);
  check('stairs: after the wait the other is pulled along', (() => { g.step(7, true, false); return g.step(1.5, true, false); })() === true);
  check('stairs: a downed partner does not hold the other back', g.step(0.1, true, false, true, false) === true);
  check('stairs: the waiter being down does not matter either', g.step(0.1, false, true, false, true) === true);

  // ---- untrusted input ----
  const T = { WEAPON_NAMES: { sword: 1, spear: 1 }, ARMOR_NAMES: { helmet: 1 }, POTIONS: { heal: 1 }, FOOD: { bread: 1 }, WANDS: { fire: { charges: 5 } }, STATUS: { stun: 1 }, spearKills: 10, rageCharges: 3, doors: [{ lock: 2, keyLabel: 'Armory Key' }] };
  const XSS = '<img src=x onerror=alert(1)>', cd = d => Net.cleanDrop(d, T);
  check('a key takes its label from this floor\'s door, never from the peer', cd({ type: 'key', lock: 2, label: XSS }).label === 'Armory Key' && cd({ type: 'key', lock: 9, label: XSS }) === null);
  check('strings where numbers belong are refused', cd({ type: 'potion', kind: 'heal', n: XSS }) === null && cd({ type: 'wand', kind: 'fire', charges: XSS }) === null && cd({ type: 'rage', charges: XSS }) === null && cd({ type: 'gold', n: NaN }) === null);
  check('unknown types and prototype keys are refused', [{ type: '__proto__' }, { type: 'potion', kind: 'constructor' }, { type: 'wand', kind: 'toString' }, { type: 'weapon', base: '__proto__', tier: 0 }, { type: 'armor', slot: 'hasOwnProperty', cls: 0, tier: 0 }, { type: XSS }, null, 5].every(d => cd(d) === null));
  check('extra fields are not carried over', JSON.stringify(cd({ type: 'weapon', base: 'sword', tier: 1, label: XSS, id: XSS })) === '{"type":"weapon","base":"sword","tier":1}');
  const cm = (m, role) => Net.cleanMsg(m, role, T);
  check('NaN, infinite or missing values drop the message', [{ k: 'ff', d: NaN, z: 'body' }, { k: 'ff', d: 1e999, z: 'body' }, { k: 'ff', d: '9', z: 'body' }, { k: 'ff', d: 5, z: 'toe' }, { k: 'xp', b: NaN }, { k: 'dr', id: 1, fk: 0, x: NaN, z: 1, d: { type: 'gold', n: 1 } }].every(m => cm(m, 'host') === null));
  check('values are clamped', cm({ k: 'ff', d: 1e9, z: 'body' }, 'host').d === 500 && cm({ k: 'xp', b: -5 }, 'host').b === 0 && cm({ k: 'hit', n: 1, z: 'body', d: 1e12, ps: 'constructor', pd: 1 }, 'guest').ps === undefined);
  check('a message the sender may not send is dropped (a guest cannot give XP or items; junk is ignored)', cm({ k: 'xp', b: 5 }, 'guest') === null && cm({ k: 'dy', id: 1, d: { type: 'gold', n: 1 } }, 'guest') === null && cm({ k: 'hit', n: 1, z: 'body', d: 1 }, 'host') === null && [null, 7, 'x', {}, { k: '__proto__' }].every(m => cm(m, 'guest') === null));
  const bad = (x, z) => { const v = Net.sendView(Net.packPlayer({ ...p, x, z })); return Net.packetOk(new DataView(v.buffer.slice(0, v.length))); };
  check('packets with NaN or off-map positions, or short ones, are refused', !bad(NaN, 1) && !bad(1, Infinity) && !bad(-5, 1) && bad(10, 10) && !Net.packetOk(new DataView(new ArrayBuffer(3))) && !Net.packetOk(new DataView(new Uint8Array([2, 0, 0, 0, 50]).buffer)));
  const zip = async bytes => Buffer.from(await new Response(new Blob([bytes]).stream().pipeThrough(new CompressionStream('deflate-raw'))).arrayBuffer()).toString('base64url');
  const rejected = c => Net.decodeCode(c).then(() => false, () => true);
  check('an oversized code is refused', await rejected('HH1op' + 'A'.repeat(20000)));
  check('a code that inflates past the limit is refused', await rejected('HH1oz' + await zip(new Uint8Array(1000000))));
  check('a code cannot inject SDP lines', await rejected('HH1op' + Buffer.from(JSON.stringify({ u: 'ab\r\na=x', p: 'pw', f: '0'.repeat(64), c: [] })).toString('base64url')));

  // ---- boss detail and boss events ----
  const bo = { floor: 4, seq: 7, nid: 3, alt: 6.4, st: Net.BOSS_ST.indexOf('sweep'), mv: 2, zone: 1, air: true, expAll: true, cw: -1, windT: 0.85, tx: 10, tz: 20, ox: 30, oz: 40, dx: -0.6, dz: 0.8, dl: 14, exp: 1.5, expMul: 1.3, lowT: 0.6, phase: 2, stun: 1 };
  const bn = Net.packBoss(bo), bv = dv(bn), br = Net.unpackBoss(bv, {});
  check('boss detail packet round trip (33 bytes)', bn === 33 && Net.packetOk(bv) && br.air && br.expAll && br.cw === -1 && br.st === bo.st && br.mv === 2 && br.phase === 2 && near(br.alt, 6.4) && near(br.windT, 0.85) && near(br.dx, -0.6) && near(br.dz, 0.8) && near(br.expMul, 1.3, 0.02) && near(br.lowT, 0.6, 0.02) && near(br.dl, 14));
  const TB = { ...T, BOSS_SHOT: { fire: 1 }, ENEMY_TYPES: { wolf: 1 } };
  const sp = { k: 'sp', n: 1, fk: 0, x: 1, y: 2, z: 3, vx: 1, vy: 0, vz: 1, dmg: 1, ring: -1, kind: 'fire' };
  check('boss shots and summons are checked: kinds from the tables, finite numbers, the right sender', !!Net.cleanMsg(sp, 'host', TB) && Net.cleanMsg({ ...sp, kind: 'constructor' }, 'host', TB) === null && Net.cleanMsg({ ...sp, vx: NaN }, 'host', TB) === null && Net.cleanMsg(sp, 'guest', TB) === null
    && !!Net.cleanMsg({ k: 'sm', n: 1001, fk: 0, x: 1, z: 1, bn: 0, seed: 5, type: 'wolf' }, 'host', TB) && Net.cleanMsg({ k: 'sm', n: 1001, fk: 0, x: 1, z: 1, bn: 0, seed: 5, type: '__proto__' }, 'host', TB) === null);

  // ---- the messages that let a player see the other ----
  const see = { k: 'pr', fk: 0, x: 1, y: 1, z: 1, vx: 1, vy: 0, vz: 1 };
  check('shots, effects, looks and statuses are checked, from either side where both send them', !!cm(see, 'host') && !!cm(see, 'guest') && cm({ ...see, vx: NaN }, 'host') === null && cm({ ...see, w: '__proto__' }, 'guest') === null
    && cm({ k: 'fx', fk: 0, t: 0, w: '<img>', x: 1, y: 1, z: 1, r: 1 }, 'guest') === null && cm({ k: 'es', fk: 0, n: 1, m: 5 }, 'guest') === null && !!cm({ k: 'es', fk: 0, n: 1, m: 5 }, 'host') && cm({ k: 'start' }, 'guest') === null && !!cm({ k: 'start' }, 'host'));
  const al = Net.packAlly(3, 10.5, 20.25, 1, 2), av = dv(al), ar = Net.unpackAlly(av, {});
  check('ally packet round trip (9 bytes)', al === 9 && Net.packetOk(av) && ar.floor === 3 && near(ar.x, 10.5, 0.02) && near(ar.z, 20.25, 0.02) && ar.flags === 2);

  console.log(fails ? `${fails} failed` : 'all passed');
  process.exit(fails ? 1 : 0);
})();
