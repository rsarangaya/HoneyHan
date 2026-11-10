// Hunger (DESIGN.md section 18). A 0 to 100 meter that drains while you play, with four stages. Pure
// logic with no DOM so it can be tested in plain Node (tests/hunger.test.js). Starving never kills.
const HUNGER = {
  drainPerSec: 100 / 660,                 // 100 to 0 in 11 minutes of normal play
  sprintMul: 2, fightMul: 1.6, idleMul: 0.6,   // faster when sprinting or fighting, slower standing still or crouched
  hungryAt: 50, weakAt: 25,
  regenHungry: 0.8, regenWeak: 0.6,       // stamina regen multipliers
  maxStamWeak: 0.85,                      // Weak: max stamina cut by 15%
  growlHungry: 2, growlWeak: 4,           // stomach growl noise radius in metres
  growlEvery: 20,                         // average seconds between growls
  starveEvery: 4,                         // Starving: lose 1 HP this often, never below 1
};

class Hunger {
  constructor() { this.v = 100; this.growlT = 10; this.starveT = 0; this.fight = 0; this.last = 'fed'; }
  get stage() { return this.v <= 0 ? 'starving' : this.v < HUNGER.weakAt ? 'weak' : this.v < HUNGER.hungryAt ? 'hungry' : 'fed'; }
  feed(n) { this.v = Math.min(100, this.v + n); }
  regenMul() { return { fed: 1, hungry: HUNGER.regenHungry, weak: HUNGER.regenWeak, starving: HUNGER.regenWeak }[this.stage]; }
  maxStaminaMul() { return this.stage === 'weak' || this.stage === 'starving' ? HUNGER.maxStamWeak : 1; }
  canSprint() { return this.stage !== 'starving'; }
  // act: { sprinting, still, crouching }. rnd: random source for the growl timing.
  // Returns { growl: noise radius or 0, hp: HP to lose, stage: the new stage if it changed, else null }.
  update(dt, act, rnd = Math.random) {
    if (this.fight > 0) this.fight -= dt;
    const mul = act.sprinting ? HUNGER.sprintMul : this.fight > 0 ? HUNGER.fightMul : act.still || act.crouching ? HUNGER.idleMul : 1;
    this.v = Math.max(0, this.v - HUNGER.drainPerSec * mul * dt);
    const out = { growl: 0, hp: 0, stage: null };
    const st = this.stage;
    if (st !== this.last) { out.stage = st; this.last = st; }
    if (st === 'hungry' || st === 'weak' || st === 'starving') {
      this.growlT -= dt;
      if (this.growlT <= 0) { this.growlT = HUNGER.growlEvery * (0.6 + rnd() * 0.8); out.growl = st === 'hungry' ? HUNGER.growlHungry : HUNGER.growlWeak; }
    }
    if (st === 'starving') { this.starveT += dt; if (this.starveT >= HUNGER.starveEvery) { this.starveT -= HUNGER.starveEvery; out.hp = 1; } } else this.starveT = 0;
    return out;
  }
}
const hunger = new Hunger();
