// Progress: XP, levels, stat points and skills (DESIGN.md "Progression"). Pure: no DOM, no THREE, no randomness, so plain Node can test it.
// main.js owns the one instance (`prog`) and the derived numbers (`PD`, recomputed only when a point is spent). The per-point stat numbers live in TUNE (js/combat.js).
const PROG = {
  maxLevel: 20, xpBase: 60, xpGrow: 1.35,        // need(l) = round(xpBase x xpGrow^(l-1)) xp to go from level l to l+1
  statPts: 3, skillEvery: 3,                     // stat points per level; a skill point on every 3rd level (3, 6, 9...)
  xpStageBoss: 100, xpFinalBoss: 500, xpQuest: 50,   // flat XP (a stage boss is scaled by the stage factor); exempt from the floor cap
};
const STATS = [                                  // the five stats, each point +1
  { id: 'vig', name: 'Vigor', desc: '+8 max HP per point' },
  { id: 'str', name: 'Strength', desc: '+4% weapon damage per point (melee, bow, wands)' },
  { id: 'end', name: 'Endurance', desc: '+6 max stamina and +4% stamina regeneration per point' },
  { id: 'agi', name: 'Agility', desc: '+3% attack speed and -4% dash recharge per point' },
  { id: 'ste', name: 'Stealth', desc: '-4% noise and -3% enemy sight and awareness per point (never below 60%)' },
];
// Skills: one skill point per rank. `per` is the effect of one rank (read by derive).
const SKILLS = [
  { id: 'dashCh', name: 'Dash charges', max: 3, per: 1, desc: '+1 dash charge per rank' },
  { id: 'dashRe', name: 'Quick recharge', max: 3, per: 0.15, desc: '-15% dash recharge time per rank' },
  { id: 'dashDi', name: 'Long dash', max: 2, per: 1, iframe: 0.12, desc: '+1 m dash distance and 0.12 s of invulnerability per rank' },
  { id: 'silent', name: 'Silent step', max: 2, per: 0.25, desc: '-25% noise while crouch walking per rank' },
  { id: 'wind', name: 'Second wind', max: 2, per: 0.2, desc: 'Stamina regeneration starts 0.2 s sooner per rank' },
];

const xpNeed = l => Math.round(PROG.xpBase * Math.pow(PROG.xpGrow, l - 1));          // xp from level l to l + 1
const stageFactor = (stage, T) => 1 + T.xpStage * (stage - 1);
// How much one kill is worth before any cap. Tougher types (hp x damage multipliers, elites most) give more; T is TUNE.
function killXp(et, stage, floorNum, T) {
  const w = Math.max(0.3, Math.sqrt((et.hpMul || 1) * (et.dmgMul || 1)));           // a rat 0.3, a guard 1, a brute about 2.4
  return T.xpKill * (1 + T.xpFloor * floorNum) * stageFactor(stage, T) * w;
}
// The most ordinary XP a floor pays (kills, respawns); bosses and quests are exempt. About 1.3 to 1.5 x what a full clear pays (measured 63 to 85%).
const xpBudget = (stage, floorNum, T) => Math.round(T.xpBudget * (1 + T.xpFloor * floorNum) * (1 + T.xpBudStage * (stage - 1)) * (1 + T.xpBudFloor * (floorNum - 1)));
const floorKey = (stage, floorNum) => stage * 100 + floorNum;

class Progress {
  constructor() {
    this.level = 1; this.xp = 0; this.total = 0;
    this.pts = 0; this.skp = 0;                                                     // unspent stat and skill points
    this.stat = { vig: 0, str: 0, end: 0, agi: 0, ste: 0 };
    this.skill = { dashCh: 0, dashRe: 0, dashDi: 0, silent: 0, wind: 0 };
    this.floorXp = {};                                                               // floorKey -> ordinary XP earned there (kept for the whole run, so revisiting cannot reset it)
  }
  get need() { return this.level >= PROG.maxLevel ? 0 : xpNeed(this.level); }
  // Add xp; returns the number of levels gained. Each level: +3 stat points, and a skill point on every 3rd level.
  addXp(n) {
    if (!(n > 0)) return 0;
    this.total += n; let up = 0;
    if (this.level >= PROG.maxLevel) return 0;
    this.xp += n;
    while (this.level < PROG.maxLevel && this.xp >= xpNeed(this.level)) {
      this.xp -= xpNeed(this.level); this.level++; up++;
      this.pts += PROG.statPts; if (this.level % PROG.skillEvery === 0) this.skp++;
    }
    if (this.level >= PROG.maxLevel) this.xp = 0;
    return up;
  }
  // XP for a kill on a floor: applies the floor budget. Returns { xp, capped } (xp is what was granted, whole numbers); levels in .up.
  // exempt (bosses, quests) ignores and does not count toward the budget.
  award(base, key, budget, exempt, T) {
    let gain = Math.round(base), capped = false;
    if (!exempt) {
      const got = this.floorXp[key] || 0;
      if (got >= budget) { gain = Math.round(base * T.xpOverCap); capped = true; }       // the floor is spent: a trickle
      else this.floorXp[key] = got + gain;
    }
    const up = this.addXp(gain);
    return { xp: gain, capped, up };
  }
  spendStat(id) { if (this.pts < 1 || !(id in this.stat)) return false; this.stat[id]++; this.pts--; return true; }
  spendSkill(id) {
    const s = SKILLS.find(k => k.id === id);
    if (!s || this.skp < 1 || this.skill[id] >= s.max) return false;
    this.skill[id]++; this.skp--; return true;
  }
}

// Everything the game reads, from the points spent. Fills `o` (no allocation): call it when a point is spent, never per frame. T is TUNE.
function derive(p, T, o) {
  const st = p.stat, sk = p.skill, S = id => SKILLS.find(k => k.id === id);
  o.hpBonus = st.vig * T.lvVigorHp;
  o.dmgMul = 1 + st.str * T.lvStrDmg;
  o.stamMax = 100 + st.end * T.lvEndStam;
  o.regenMul = 1 + st.end * T.lvEndRegen;
  o.atkSpd = 1 + st.agi * T.lvAgiAtk;
  o.noiseMul = Math.max(T.lvStealthMin, 1 - st.ste * T.lvStealthNoise);
  o.senseMul = Math.max(T.lvStealthMin, 1 - st.ste * T.lvStealthSense);
  o.crouchNoise = Math.max(0, 1 - sk.silent * S('silent').per);
  o.stamDelay = Math.max(0.1, T.staminaDelay - sk.wind * S('wind').per);
  o.dashMax = T.dashCharges + sk.dashCh * S('dashCh').per;
  o.dashRecharge = Math.max(0.5, T.dashRecharge * (1 - st.agi * T.lvAgiDash) * (1 - sk.dashRe * S('dashRe').per));   // seconds per charge
  o.dashDist = T.dashDist + sk.dashDi * S('dashDi').per;
  o.dashIframe = sk.dashDi * S('dashDi').iframe;
  return o;
}

// Dash charges: ch = { n, t }. One charge comes back at a time, every `time` seconds, up to `max`. Pure.
function chargeTick(ch, dt, max, time) {
  if (ch.n >= max) { ch.n = max; ch.t = 0; return; }
  ch.t += dt;
  while (ch.t >= time && ch.n < max) { ch.t -= time; ch.n++; }
  if (ch.n >= max) ch.t = 0;
}
