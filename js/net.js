// Co-op networking (2 players, WebRTC, copy-paste signaling: no server). Pure helpers (codes, packets, interpolation, rules) plus the Link
// (RTCPeerConnection + two data channels). Loaded before main.js; `coop` is the one flag the game checks, so solo play costs a boolean.
// STUN only (stun.l.google.com), no TURN: two players behind strict (symmetric) NATs may not be able to connect.
const coop = { on: false, host: false, guest: false, down: false };

const Net = (() => {
  const STUN = [{ urls: 'stun:stun.l.google.com:19302' }];
  const STATES = ['unaware', 'suspicious', 'alerted', 'searching'];
  const F = { CROUCH: 1, SPRINT: 2, ATTACK: 4, DOWN: 8, BLOCK: 16 };                         // player flag bits
  const E = { DEAD: 4, STUN: 8, WIND: 16, SEEN: 32, DORM: 64, SLEEP: 128 };                  // enemy flag bits (low 2 bits: state index)
  const BOSS_ST = ['idle', 'chase', 'telegraph', 'attack', 'recover', 'phase', 'chain', 'spin', 'sweep', 'special', 'stagger'], BOSS_LEN = 33, T_BOSS = 3;
  const SNAP_MAX = 60, T_PLAYER = 1, T_SNAP = 2, HB_TIMEOUT = 12000;   // ms of silence before the partner counts as gone
  const TAU = Math.PI * 2;

  // ---- invite / answer codes: a compact JSON of the few SDP fields that matter, deflated when the browser can, base64url ----
  const b64 = bytes => { let s = ''; for (let i = 0; i < bytes.length; i += 8192) s += String.fromCharCode.apply(null, bytes.subarray(i, i + 8192)); return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, ''); };
  const unb64 = str => { const s = atob(str.replace(/-/g, '+').replace(/_/g, '/')), u = new Uint8Array(s.length); for (let i = 0; i < s.length; i++) u[i] = s.charCodeAt(i); return u; };
  const MAX_CODE = 4000, MAX_JSON = 8192;                                                  // a real code is a few hundred characters: anything bigger is refused
  async function pipe(bytes, Ctor, kind, max = MAX_JSON) {                                 // stops reading past max bytes, so a "zip bomb" code cannot fill memory
    const rd = new Blob([bytes]).stream().pipeThrough(new Ctor(kind)).getReader(), parts = [];
    let n = 0;
    for (;;) {
      const { done, value } = await rd.read();
      if (done) break;
      if ((n += value.length) > max) { rd.cancel().catch(() => {}); throw new Error('The code is too large.'); }
      parts.push(value);
    }
    const out = new Uint8Array(n); let o = 0; for (const p of parts) { out.set(p, o); o += p.length; }
    return out;
  }
  const canZip = typeof CompressionStream !== 'undefined' && typeof DecompressionStream !== 'undefined' && typeof Response !== 'undefined' && typeof Blob !== 'undefined';

  // SDP -> { u: ice ufrag, p: pwd, f: fingerprint hex, s: setup, c: candidates } and back. Only data-channel sessions are ever described.
  function compactSdp(sdp) {
    const o = { c: [] };
    for (const raw of sdp.split(/\r?\n/)) {
      const l = raw.trim();
      if (l.startsWith('a=ice-ufrag:')) o.u = l.slice(12);
      else if (l.startsWith('a=ice-pwd:')) o.p = l.slice(10);
      else if (l.startsWith('a=fingerprint:sha-256 ')) o.f = l.slice(22).replace(/:/g, '');
      else if (l.startsWith('a=setup:')) o.s = l.slice(8)[0];                                   // a(ctpass) | a(ctive) | p(assive)
      else if (l.startsWith('a=candidate:') && o.c.length < 8) o.c.push(l.slice(12));
    }
    return o;
  }
  function expandSdp(o, type) {
    const fp = o.f.toUpperCase().match(/../g).join(':'), setup = o.s === 'p' ? 'passive' : o.s === 'c' ? 'active' : 'actpass';
    const lines = ['v=0', 'o=- 4611731400430051336 2 IN IP4 127.0.0.1', 's=-', 't=0 0', 'a=group:BUNDLE 0', 'a=msid-semantic: WMS',
      'm=application 9 UDP/DTLS/SCTP webrtc-datachannel', 'c=IN IP4 0.0.0.0', 'a=ice-ufrag:' + o.u, 'a=ice-pwd:' + o.p, 'a=fingerprint:sha-256 ' + fp,
      'a=setup:' + (type === 'offer' ? 'actpass' : setup === 'actpass' ? 'active' : setup), 'a=mid:0', 'a=sctp-port:5000', 'a=max-message-size:262144'];
    for (const c of o.c) lines.push('a=candidate:' + c);
    lines.push('a=end-of-candidates');
    return lines.join('\r\n') + '\r\n';
  }
  // every field goes into an SDP line, so none may carry a line break or anything unexpected
  const ICE = /^[A-Za-z0-9+/=_-]{1,256}$/;
  const sdpOk = o => !!o && typeof o.u === 'string' && ICE.test(o.u) && typeof o.p === 'string' && ICE.test(o.p) && typeof o.f === 'string' && /^[0-9A-Fa-f]{64}$/.test(o.f)
    && Array.isArray(o.c) && o.c.length <= 8 && o.c.every(c => typeof c === 'string' && c.length <= 300 && /^[ -~]+$/.test(c));
  // type: 'offer' | 'answer'. The code starts with HH1, then o/a (kind) and z/p (deflated or plain).
  async function encodeCode(sdp, type) {
    const json = new TextEncoder().encode(JSON.stringify(compactSdp(sdp)));
    let z = 'p', bytes = json;
    if (canZip) { try { bytes = await pipe(json, CompressionStream, 'deflate-raw'); z = 'z'; } catch (e) { bytes = json; z = 'p'; } }
    return 'HH1' + (type === 'offer' ? 'o' : 'a') + z + b64(bytes);
  }
  async function decodeCode(code) {                                                          // -> { type, sdp }; throws on a bad code
    code = String(code);
    if (code.length > MAX_CODE * 2) throw new Error('The code is too large.');
    code = code.replace(/\s+/g, '');
    if (code.length > MAX_CODE) throw new Error('The code is too large.');
    if (!/^HH1[oa][zp][A-Za-z0-9_-]+$/.test(code)) throw new Error('That is not a HoneyHan co-op code.');
    let bytes = unb64(code.slice(5));
    if (code[4] === 'z') { if (!canZip) throw new Error('This browser cannot read compressed codes.'); bytes = await pipe(bytes, DecompressionStream, 'deflate-raw'); }
    if (bytes.length > MAX_JSON) throw new Error('The code is too large.');
    const o = JSON.parse(new TextDecoder().decode(bytes));
    if (!sdpOk(o)) throw new Error('The code is damaged. Copy it again.');
    const type = code[3] === 'o' ? 'offer' : 'answer';
    return { type, sdp: expandSdp(o, type) };
  }

  // ---- binary packets (reused buffer, no allocation per packet beyond the send view) ----
  const buf = new ArrayBuffer(640), dv = new DataView(buf), u8 = new Uint8Array(buf);
  const q16 = (v, scale) => { v = Math.round(v * scale); return v < 0 ? 0 : v > 65535 ? 65535 : v; };
  const wrapYaw = y => { y %= TAU; return y < 0 ? y + TAU : y; };
  // Player state (19 bytes): type, x f32, z f32, yaw u16, pitch i8, flags, hp u8 (0..255), floor u8, seq u16, noise u8 (x8 m), speed u8 (x20 m/s)
  function packPlayer(s) {
    dv.setUint8(0, T_PLAYER); dv.setFloat32(1, s.x); dv.setFloat32(5, s.z);
    dv.setUint16(9, Math.round(wrapYaw(s.yaw) / TAU * 65535)); dv.setInt8(11, Math.max(-127, Math.min(127, Math.round(s.pitch * 80))));
    dv.setUint8(12, s.flags); dv.setUint8(13, Math.max(0, Math.min(255, Math.round(s.hp * 255)))); dv.setUint8(14, s.floor); dv.setUint16(15, s.seq & 65535);
    dv.setUint8(17, Math.max(0, Math.min(255, Math.round(s.noise * 8)))); dv.setUint8(18, Math.max(0, Math.min(255, Math.round(s.speed * 20))));
    return 19;
  }
  function unpackPlayer(d, o) {
    o.x = d.getFloat32(1); o.z = d.getFloat32(5); o.yaw = d.getUint16(9) / 65535 * TAU; o.pitch = d.getInt8(11) / 80;
    o.flags = d.getUint8(12); o.hp = d.getUint8(13) / 255; o.floor = d.getUint8(14); o.seq = d.getUint16(15); o.noise = d.getUint8(17) / 8; o.speed = d.getUint8(18) / 20;
    return o;
  }
  // Enemy snapshot: 5-byte header (type, floor, seq u16, count) then 9 bytes each: nid u16, x u16 (cm), z u16 (cm), yaw u8, flags u8, hp u8.
  let snapN = 0;
  function snapBegin(floorKey, seq) { dv.setUint8(0, T_SNAP); dv.setUint8(1, floorKey); dv.setUint16(2, seq & 65535); dv.setUint8(4, 0); snapN = 0; }
  function snapAdd(nid, x, z, yaw, flags, hpFrac) {
    if (snapN >= SNAP_MAX) return false;
    const o = 5 + snapN * 9;
    dv.setUint16(o, nid); dv.setUint16(o + 2, q16(x, 100)); dv.setUint16(o + 4, q16(z, 100)); dv.setUint8(o + 6, Math.round(wrapYaw(yaw) / TAU * 255) & 255);
    dv.setUint8(o + 7, flags); dv.setUint8(o + 8, Math.max(0, Math.min(255, Math.ceil(hpFrac * 255))));
    dv.setUint8(4, ++snapN);
    return true;
  }
  const snapEnd = () => 5 + snapN * 9;
  const sendView = n => u8.subarray(0, n);
  const snapHead = (d, o) => { o.floor = d.getUint8(1); o.seq = d.getUint16(2); o.n = d.getUint8(4); return o; };
  function snapAt(d, i, o) {
    const p = 5 + i * 9;
    o.nid = d.getUint16(p); o.x = d.getUint16(p + 2) / 100; o.z = d.getUint16(p + 4) / 100; o.yaw = d.getUint8(p + 6) / 255 * TAU; o.flags = d.getUint8(p + 7); o.hp = d.getUint8(p + 8) / 255;
    return o;
  }
  // Boss detail (33 bytes), sent with each snapshot: what the guest needs to pose it, fly it, draw its floor marks and know its weak-point windows.
  // type, floor, seq u16, nid u16, alt u16 (cm), state, move index (255 none), zone, flags (1 air, 2 expose-all), windT u16 (ms), tx tz ox oz u16 (cm),
  // dx dz i8, dl u16 (cm), exp u16 (ms), expMul u8 (x50), lowT u8 (x50 s), phase, stun u8 (x50 s)
  function packBoss(o) {
    dv.setUint8(0, T_BOSS); dv.setUint8(1, o.floor); dv.setUint16(2, o.seq & 65535); dv.setUint16(4, o.nid); dv.setUint16(6, q16(o.alt, 100));
    dv.setUint8(8, o.st); dv.setUint8(9, o.mv); dv.setUint8(10, o.zone); dv.setUint8(11, (o.air ? 1 : 0) | (o.expAll ? 2 : 0) | (o.cw < 0 ? 4 : 0));
    dv.setUint16(12, q16(o.windT, 1000)); dv.setUint16(14, q16(o.tx, 100)); dv.setUint16(16, q16(o.tz, 100)); dv.setUint16(18, q16(o.ox, 100)); dv.setUint16(20, q16(o.oz, 100));
    dv.setInt8(22, Math.round(Math.max(-1, Math.min(1, o.dx)) * 127)); dv.setInt8(23, Math.round(Math.max(-1, Math.min(1, o.dz)) * 127)); dv.setUint16(24, q16(o.dl, 100)); dv.setUint16(26, q16(o.exp, 1000));
    const b = v => Math.max(0, Math.min(255, Math.round(v * 50)));
    dv.setUint8(28, b(o.expMul)); dv.setUint8(29, b(o.lowT)); dv.setUint8(30, o.phase); dv.setUint8(31, b(o.stun)); dv.setUint8(32, 0);
    return BOSS_LEN;
  }
  function unpackBoss(d, o) {
    o.floor = d.getUint8(1); o.seq = d.getUint16(2); o.nid = d.getUint16(4); o.alt = d.getUint16(6) / 100; o.st = d.getUint8(8); o.mv = d.getUint8(9); o.zone = d.getUint8(10);
    const f = d.getUint8(11); o.air = !!(f & 1); o.expAll = !!(f & 2); o.cw = f & 4 ? -1 : 1;
    o.windT = d.getUint16(12) / 1000; o.tx = d.getUint16(14) / 100; o.tz = d.getUint16(16) / 100; o.ox = d.getUint16(18) / 100; o.oz = d.getUint16(20) / 100;
    o.dx = d.getInt8(22) / 127; o.dz = d.getInt8(23) / 127; o.dl = d.getUint16(24) / 100; o.exp = d.getUint16(26) / 1000; o.expMul = d.getUint8(28) / 50; o.lowT = d.getUint8(29) / 50; o.phase = d.getUint8(30); o.stun = d.getUint8(31) / 50;
    return o;
  }
  const kindOf = d => d.byteLength ? d.getUint8(0) : 0;

  // ---- interpolation: two samples per thing, drawn 100 ms in the past. No arrays, no allocation per snapshot. ----
  const angDiff = (a, b) => { let d = (b - a) % TAU; if (d > Math.PI) d -= TAU; else if (d < -Math.PI) d += TAU; return d; };
  class Track {
    constructor() { this.t0 = 0; this.x0 = 0; this.z0 = 0; this.y0 = 0; this.t1 = 0; this.x1 = 0; this.z1 = 0; this.y1 = 0; this.n = 0; this.x = 0; this.z = 0; this.yaw = 0; this.speed = 0; }
    push(t, x, z, yaw) {
      if (this.n === 0) { this.t1 = t; this.x1 = x; this.z1 = z; this.y1 = yaw; this.n = 1; }
      else {
        this.t0 = this.t1; this.x0 = this.x1; this.z0 = this.z1; this.y0 = this.y1;
        this.t1 = t; this.x1 = x; this.z1 = z; this.y1 = yaw;
        this.n = 2;
        if (Math.abs(this.x1 - this.x0) + Math.abs(this.z1 - this.z0) > 8) { this.x0 = x; this.z0 = z; this.y0 = yaw; this.t0 = t - 1; }   // a jump (teleport, new floor): do not slide across the map
      }
    }
    at(t) {                                                                                  // fills this.x / z / yaw / speed for time t (ms)
      if (this.n < 2) { this.x = this.x1; this.z = this.z1; this.yaw = this.y1; this.speed = 0; return this; }
      const span = this.t1 - this.t0 || 1;
      let k = (t - this.t0) / span; k = k < 0 ? 0 : k > 1.25 ? 1.25 : k;                      // a little extrapolation when a packet is late
      this.x = this.x0 + (this.x1 - this.x0) * k; this.z = this.z0 + (this.z1 - this.z0) * k;
      this.yaw = this.y0 + angDiff(this.y0, this.y1) * k;
      this.speed = Math.hypot(this.x1 - this.x0, this.z1 - this.z0) / (span / 1000);
      return this;
    }
  }

  // ---- rules (pure, so they can be tested without a browser) ----
  const ffDamage = (dmg, mult) => dmg * mult;                                                // friendly fire: the TUNE.coopFF share of the normal damage
  const xpInRange = (dx, dz, range) => dx * dx + dz * dz <= range * range;                   // a kill gives XP to a player this close
  const meleeOk = (dist, reach) => dist <= reach + 4;                                        // the host's loose range check on a guest's melee claim
  class ClaimBook {                                                                          // floor drops: the first claim on an id wins, the host decides
    constructor() { this.taken = new Map(); }
    claim(id, who) { if (this.taken.has(id)) return false; this.taken.set(id, who); return true; }
    release(id) { this.taken.delete(id); }
    reset() { this.taken.clear(); }
  }
  class Revive {                                                                             // hold interact beside a downed partner for `secs`
    constructor(secs) { this.secs = secs; this.t = 0; }
    step(dt, holding) { if (holding) this.t += dt; else this.t = Math.max(0, this.t - dt * 2); if (this.t >= this.secs) { this.t = 0; return true; } return false; }
    get frac() { return Math.min(1, this.t / this.secs); }
  }
  class StairGate {                                                                          // both at the stairs, or the other is pulled along after `wait` s
    constructor(wait) { this.wait = wait; this.t = 0; }
    step(dt, aAt, bAt, aActive = true, bActive = true) {                                      // a downed (inactive) player does not hold the other back
      if (!aAt && !bAt) { this.t = 0; return false; }
      this.t += dt;
      if (((aAt || !aActive) && (bAt || !bActive)) || this.t >= this.wait) { this.t = 0; return true; }
      return false;
    }
  }

  // ---- everything a peer sends is untrusted: rebuild it from known fields and tables, or drop it (null) ----
  const own = (o, k) => typeof k === 'string' && Object.prototype.hasOwnProperty.call(o, k);
  const num = (v, lo, hi) => typeof v === 'number' && Number.isFinite(v) ? (v < lo ? lo : v > hi ? hi : v) : null;   // finite and clamped, else null
  const int = (v, lo, hi) => Number.isInteger(v) && v >= lo && v <= hi ? v : null;
  const ZONES = ['head', 'body', 'legs'], SHOTS = ['arrow', 'hex', 'thorn', 'curse', 'dart'];
  const str = v => typeof v === 'string' && v.length > 0 && v.length <= 32;                // a move id: only ever used to look one up in the boss's own table
  // A floor-drop descriptor. T: { WEAPON_NAMES, ARMOR_NAMES, POTIONS, FOOD, WANDS, spearKills, rageCharges, doors }. No peer string survives:
  // kinds must be own keys of the game's tables, and a key's label comes from this floor's own door.
  function cleanDrop(d, T) {
    if (!d || typeof d !== 'object') return null;
    const tier = int(d.tier, 0, 4), count = max => d.n === undefined ? 1 : int(d.n, 1, max);
    switch (d.type) {
      case 'gold': case 'arrows': { const n = int(d.n, 1, 100000); return n === null ? null : { type: d.type, n }; }
      case 'weapon': {
        if (!own(T.WEAPON_NAMES, d.base) || tier === null) return null;
        const o = { type: 'weapon', base: d.base, tier };
        if (d.base === 'spear' && d.charges !== undefined) { const c = int(d.charges, 0, T.spearKills); if (c === null) return null; o.charges = c; }
        return o;
      }
      case 'armor': {
        const cls = int(d.cls, 0, 2);
        if (!own(T.ARMOR_NAMES, d.slot) || cls === null || tier === null) return null;
        const o = { type: 'armor', slot: d.slot, cls, tier };
        if (d.unique === 'dunce' && d.slot === 'helmet') o.unique = 'dunce';
        return o;
      }
      case 'shield': return tier === null ? null : { type: 'shield', tier };
      case 'potion': case 'food': { const n = count(99); return n === null || !own(d.type === 'potion' ? T.POTIONS : T.FOOD, d.kind) ? null : { type: d.type, kind: d.kind, n }; }
      case 'lockpick': { const n = count(99); return n === null ? null : { type: 'lockpick', n }; }
      case 'wand': case 'rage': {
        if (d.type === 'wand' && !own(T.WANDS, d.kind)) return null;
        const o = d.type === 'wand' ? { type: 'wand', kind: d.kind } : { type: 'rage' };
        if (d.charges !== undefined) { const c = int(d.charges, 0, d.type === 'wand' ? T.WANDS[d.kind].charges : T.rageCharges); if (c === null) return null; o.charges = c; }
        return o;
      }
      case 'rechargewand': return { type: 'rechargewand', full: !!d.full };
      case 'key': { const door = (T.doors || []).find(q => q.lock === d.lock); return door ? { type: 'key', lock: door.lock, label: door.keyLabel } : null; }
    }
    return null;
  }
  // A reliable message -> a fresh object holding only checked fields, or null. role: who SENT it. A message the sender's role may not send is dropped.
  const FROM = {
    host: ['hello', 'eh', 'sp', 'ln', 'fl', 'cl', 'sm', 'ff', 'ed', 'xp', 'bd', 'dr', 'dy', 'dg', 'op', 'sg', 'bl', 'go', 'dn', 'rv', 'end'],
    guest: ['ready', 'hit', 'pa', 'wz', 'rg', 'ff', 'dc', 'du', 'op', 'se', 'sr', 'mw', 'sa', 'dn', 'rv', 'end'],
  };
  function cleanMsg(m, role, T) {
    if (!m || typeof m !== 'object' || !FROM[role].includes(m.k)) return null;
    const o = { k: m.k };
    const put = (key, v) => { if (v === null) return false; o[key] = v; return true; };
    const nid = () => put('n', int(m.n, 0, 65535)), id = () => put('id', int(m.id, 1, 1e9)), fk = () => put('fk', int(m.fk, 0, 255)), idx = () => put('i', int(m.i, 0, 100000)), zone = () => put('z', ZONES.includes(m.z) ? m.z : null);
    const pos = () => put('x', num(m.x, 0, 655)) && put('z', num(m.z, 0, 655));
    switch (m.k) {
      case 'hello': return put('seed', int(m.seed, 0, 4294967295)) && put('stage', int(m.stage, 1, 5)) && put('floor', int(m.floor, 1, 5)) ? o : null;
      case 'hit': {
        if (!(nid() && put('z', ZONES.includes(m.z) ? m.z : null) && put('d', num(m.d, 0, 5000)))) return null;
        o.sn = m.sn ? 1 : 0; o.m = m.m ? 1 : 0;
        const pd = num(m.pd, 0, 10);
        if (own(T.STATUS, m.ps) && pd !== null) { o.ps = m.ps; o.pd = pd; }
        return o;
      }
      case 'wz': if (!nid() || !own(T.WANDS, m.w)) return null; o.w = m.w; return o;
      case 'eh': if (!(nid() && zone())) return null; o.hm = num(m.hm, 0, 20) || 1; if (str(m.mv)) o.mv = m.mv; return o;
      case 'pa': return nid() ? o : null;
      case 'sp': {                                                                        // a guard's or boss's shot, flown on the guest too
        if (!(nid() && fk() && pos() && put('y', num(m.y, 0, 40)) && put('vx', num(m.vx, -80, 80)) && put('vy', num(m.vy, -80, 80)) && put('vz', num(m.vz, -80, 80)) && put('dmg', num(m.dmg, 0, 20)) && put('ring', int(m.ring, -1, 7)))) return null;
        if (!SHOTS.includes(m.kind) && !own(T.BOSS_SHOT, m.kind)) return null;
        o.kind = m.kind;
        if (str(m.mv)) o.mv = m.mv;
        if (o.ring >= 0 && !(put('tx', num(m.tx, 0, 655)) && put('tz', num(m.tz, 0, 655)))) return null;
        return o;
      }
      case 'ln': return nid() && fk() && pos() && str(m.mv) && put('yaw', num(m.yaw, -1000, 1000)) ? (o.mv = m.mv, o) : null;
      case 'fl': return fk() && pos() && put('r', num(m.r, 0, 10)) && put('dur', num(m.dur, 0, 30)) ? o : null;
      case 'cl': return fk() && pos() && put('r', num(m.r, 0, 10)) && put('dur', num(m.dur, 0, 30)) && put('daze', num(m.daze, 0, 10)) ? o : null;
      case 'sm': return nid() && fk() && pos() && own(T.ENEMY_TYPES, m.type) && put('bn', int(m.bn, 0, 65535)) && put('seed', int(m.seed, 0, 4294967295)) ? (o.type = m.type, o) : null;
      case 'ff': return zone() && put('d', num(m.d, 0, 500)) ? o : null;
      case 'ed': return nid() ? o : null;
      case 'bl': return nid() && pos() ? o : null;
      case 'xp': if (!put('b', num(m.b, 0, 5000))) return null; o.ex = m.ex ? 1 : 0; return o;
      case 'bd': o.f = m.f ? 1 : 0; return o;
      case 'dr': if (!(id() && fk() && pos() && put('d', cleanDrop(m.d, T)))) return null; o.q = m.q ? 1 : 0; o.f = m.f ? 1 : 0; return o;
      case 'dy': return id() && put('d', cleanDrop(m.d, T)) ? o : null;
      case 'dc': return id() && fk() ? o : null;
      case 'du': return id() ? o : null;
      case 'dg': if (!id()) return null; o.no = m.no ? 1 : 0; return o;
      case 'op': if (!(fk() && idx())) return null; o.d = m.d ? 1 : 0; return o;
      case 'se': if (!(fk() && idx())) return null; o.u = m.u ? 1 : 0; o.s = m.s ? 1 : 0; o.t = m.t ? 1 : 0; return o;
      case 'sg': {
        if (!(fk() && idx())) return null;
        if (m.no) { o.no = 1; return o; }
        if (!Array.isArray(m.d) || m.d.length > 40) return null;
        o.d = m.d.map(d => cleanDrop(d, T));                                              // an item that fails stays in place as null (the reply lists indices)
        return o;
      }
      case 'sr': if (!(fk() && idx() && Array.isArray(m.left) && m.left.length <= 40)) return null; o.left = m.left.filter((v, i, a) => int(v, 0, 39) !== null && a.indexOf(v) === i); return o;
      case 'mw': return fk() && idx() ? o : null;
      case 'go': return fk() ? o : null;
      case 'sa': o.v = m.v ? 1 : 0; return o;
      default: return o;                                                                   // ready, rg, dn, rv, end: no fields
    }
  }
  // An unreliable packet: long enough for what it claims, and (player) finite, on-the-map coordinates.
  function packetOk(d) {
    if (d.byteLength >= 19 && d.getUint8(0) === T_PLAYER) { const x = d.getFloat32(1), z = d.getFloat32(5); return x >= 0 && x <= 655 && z >= 0 && z <= 655; }   // (NaN fails every comparison)
    if (d.byteLength >= BOSS_LEN && d.getUint8(0) === T_BOSS) return d.getUint8(8) < BOSS_ST.length && d.getUint8(10) < 3;
    if (d.byteLength >= 5 && d.getUint8(0) === T_SNAP) { const n = d.getUint8(4); return n <= SNAP_MAX && d.byteLength >= 5 + n * 9; }
    return false;
  }

  // ---- the connection ----
  class Link {
    constructor(h) {                                                                         // h: { onRel(obj), onState(DataView), onStatus(text), onOpen(), onClose(why) }
      this.h = h; this.early = []; this.pc = null; this.rel = null; this.unrel = null; this.open = false; this.lastRx = 0; this.hbT = 0; this.timer = 0; this.closed = false;
    }
    _make() {
      const pc = this.pc = new RTCPeerConnection({ iceServers: STUN });
      pc.onconnectionstatechange = () => { const s = pc.connectionState; if (s === 'failed' || s === 'closed') this._lost('Connection lost.'); };   // 'disconnected' is often brief: it gets until the heartbeat time-out
      return pc;
    }
    _wire(ch, reliable) {
      ch.binaryType = 'arraybuffer';
      ch.onmessage = ev => {
        this.lastRx = performance.now();
        if (!reliable) { if (ev.data instanceof ArrayBuffer && ev.data.byteLength <= 1024) this.h.onState(new DataView(ev.data)); return; }
        let o;
        try { if (typeof ev.data !== 'string' || ev.data.length > 16384) return; o = JSON.parse(ev.data); } catch (e) { return; }
        if (!o || o.k === 'pg') return;
        if (this.open) this.h.onRel(o); else if (this.early.length < 8) this.early.push(o);   // arrived before the second channel opened: kept for then
      };
      ch.onclose = () => this._lost('Your partner left.');
      if (reliable) this.rel = ch; else this.unrel = ch;
      if (ch.readyState === 'open') this._chOpen(); else ch.onopen = () => this._chOpen();
    }
    _chOpen() {
      if (this.open || !this.rel || !this.unrel || this.rel.readyState !== 'open' || this.unrel.readyState !== 'open') return;
      this.open = true; this.lastRx = performance.now(); this.hbT = 0;
      this.timer = setInterval(() => { if (!this.open) return; if (performance.now() - this.lastRx > HB_TIMEOUT) this._lost('Your partner stopped responding.'); else if ((this.hbT += 1) % 2 === 0) this.send({ k: 'pg' }); }, 1000);
      this.h.onStatus('Connected.'); this.h.onOpen();
      for (const o of this.early.splice(0)) this.h.onRel(o);
    }
    _gathered(pc) {                                                                          // non-trickle: wait for every candidate (max ~4 s)
      return new Promise(res => {
        if (pc.iceGatheringState === 'complete') return res();
        const done = () => { clearTimeout(to); pc.removeEventListener('icegatheringstatechange', ch); res(); };
        const ch = () => { if (pc.iceGatheringState === 'complete') done(); };
        const to = setTimeout(done, 4000);
        pc.addEventListener('icegatheringstatechange', ch);
      });
    }
    async createInvite() {                                                                   // host: -> code to give the guest
      this.h.onStatus('Gathering connection info...');
      const pc = this._make();
      this._wire(pc.createDataChannel('rel', { ordered: true }), true);
      this._wire(pc.createDataChannel('state', { ordered: false, maxRetransmits: 0 }), false);
      await pc.setLocalDescription(await pc.createOffer());
      await this._gathered(pc);
      this.h.onStatus('Send the invite code to your partner, then paste their answer code.');
      return encodeCode(pc.localDescription.sdp, 'offer');
    }
    async acceptAnswer(code) {                                                               // host: the guest's answer code
      const d = await decodeCode(code);
      if (d.type !== 'answer') throw new Error('That is an invite code. Paste the ANSWER code your partner sends back.');
      this.h.onStatus('Connecting...');
      await this.pc.setRemoteDescription({ type: 'answer', sdp: d.sdp });
    }
    async join(code) {                                                                       // guest: the host's invite code -> answer code to send back
      const d = await decodeCode(code);
      if (d.type !== 'offer') throw new Error('That is an answer code. Paste the INVITE code from the host.');
      this.h.onStatus('Gathering connection info...');
      const pc = this._make();
      pc.ondatachannel = ev => this._wire(ev.channel, ev.channel.label === 'rel');
      await pc.setRemoteDescription({ type: 'offer', sdp: d.sdp });
      await pc.setLocalDescription(await pc.createAnswer());
      await this._gathered(pc);
      this.h.onStatus('Send the answer code back to the host. Connecting...');
      return encodeCode(pc.localDescription.sdp, 'answer');
    }
    send(o) { if (this.open && this.rel.readyState === 'open') this.rel.send(JSON.stringify(o)); }
    sendState(view) { if (this.open && this.unrel.readyState === 'open') this.unrel.send(view); }
    _lost(why) { if (this.closed) return; this.close(); this.h.onClose(why); }
    close() {
      this.closed = true; this.open = false; clearInterval(this.timer);
      for (const ch of [this.rel, this.unrel]) if (ch) { ch.onmessage = ch.onclose = ch.onopen = null; try { ch.close(); } catch (e) { /* already closed */ } }
      if (this.pc) { this.pc.onconnectionstatechange = null; try { this.pc.close(); } catch (e) { /* already closed */ } }
    }
  }

  return { Link, STUN, STATES, F, E, SNAP_MAX, T_PLAYER, T_SNAP, compactSdp, expandSdp, encodeCode, decodeCode, packPlayer, unpackPlayer, snapBegin, snapAdd, snapEnd, snapHead, snapAt, sendView, kindOf, Track, angDiff, ffDamage, xpInRange, meleeOk, ClaimBook, Revive, StairGate, cleanDrop, cleanMsg, packetOk, sdpOk, BOSS_ST, BOSS_LEN, T_BOSS, ZONES, packBoss, unpackBoss };
})();
if (typeof module !== 'undefined') module.exports = { Net, coop };
