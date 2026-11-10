// Status effects (DESIGN.md section 6): slow, cripple, bleed, stun, daze. One Statuses object per
// creature (the player has the global `pst`, every enemy has `e.st`). Pure timers, no DOM, so the
// rules can be tested in plain Node (tests/status.test.js). Numbers are editable in the tuning panel.
const STATUS = {
  slow:    { name: 'Slow',    color: '#5aa8ff', dur: 6,   move: 0.7,  desc: 'Moves 30% slower for about 6 seconds, then speed returns at once. Leg hits cause it.' },
  cripple: { name: 'Cripple', color: '#ff9a3a', dur: 2.5, move: 0.25, bleed: 1.5, immune: 4, desc: 'Almost cannot move for a couple of seconds, then recovers gradually. Bleeds lightly while it lasts. Cannot be chained: a short immunity follows.' },
  bleed:   { name: 'Bleed',   color: '#ff4a4a', dur: 4,   dps: 3,    desc: 'Loses health over time. It never kills a player on its own (stops at 1 HP). A Healing Potion stops it.' },
  stun:    { name: 'Stun',    color: '#ffe14a', dur: 1,    immune: 3, desc: 'Locked out: cannot attack, block or move properly. A short immunity follows so it cannot be chained.' },
  stuck:   { name: 'Stuck',   color: '#f4f4ee', dur: 1e9, move: 0, desc: "Glued in place by Aj's Bust. It cannot move at all until it dies, though it can still swing at anything within reach (and archers still shoot). Does not wear off." },
  daze:    { name: 'Daze',    color: '#c58aff', dur: 2.5, drain: 10, desc: 'Blurred, swaying vision and drained stamina. Head hits cause it.' },
};

class Statuses {
  constructor() { this.t = {}; this.max = {}; this.cool = {}; }
  has(n) { return (this.t[n] || 0) > 0; }
  // Starts a status (or refreshes it to the longer of the two durations: stacks never add).
  // Returns false when it is on cooldown (immunity) or unknown.
  apply(n, dur) {
    const d = STATUS[n];
    if (!d || (this.cool[n] || 0) > 0) return false;
    dur = dur || d.dur;
    if (!this.has(n) || dur > this.t[n]) { this.t[n] = dur; this.max[n] = dur; }
    return true;
  }
  clear(n) {
    if (n) { delete this.t[n]; delete this.max[n]; return; }
    this.t = {}; this.max = {}; this.cool = {};
  }
  // Advance the timers. Returns the damage-over-time to deal this tick (bleed, and cripple's light bleed).
  update(dt) {
    let dmg = 0;
    if (this.has('bleed')) dmg += STATUS.bleed.dps * dt;
    if (this.has('cripple')) dmg += STATUS.cripple.bleed * dt;
    for (const k of Object.keys(this.t)) {
      if ((this.t[k] -= dt) > 0) continue;
      delete this.t[k]; delete this.max[k];
      if (STATUS[k].immune) this.cool[k] = STATUS[k].immune;
    }
    for (const k of Object.keys(this.cool)) if ((this.cool[k] -= dt) <= 0) delete this.cool[k];
    return dmg;
  }
  // Movement multiplier: the strongest effect wins, they never multiply. Cripple recovers gradually over its last half.
  moveMul() {
    let m = 1;
    if (this.has('slow')) m = Math.min(m, STATUS.slow.move);
    if (this.has('cripple')) {
      const half = this.max.cripple * 0.5, f = this.t.cripple > half ? 0 : 1 - this.t.cripple / half;
      m = Math.min(m, STATUS.cripple.move + (1 - STATUS.cripple.move) * f);
    }
    if (this.has('stun')) m = Math.min(m, 0.15);
    if (this.has('stuck')) m = 0;
    return m;
  }
  list() { return Object.keys(this.t).map(n => [n, this.t[n]]); }
  // Colour for tinting an enemy model, or 0 for none.
  tint() { return this.has('stuck') ? 0x42423c : this.has('stun') ? 0x555500 : this.has('cripple') ? 0x5a3008 : this.has('bleed') ? 0x3a0606 : this.has('slow') ? 0x0a2a5a : 0; }
}

const pst = new Statuses();   // the player's statuses
