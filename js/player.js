// First-person player: fixed 120 Hz movement with circle-vs-grid collision.
const TILE = 3;            // metres per tile
let WALL_H = 3.6;          // ceiling height: set per floor in startFloor (the boss arena is much taller)
const STEP = 1 / 120;
const SMALL_PROP = 0.25;   // props with a collision circle this small or smaller (candles) never block the player

class Player {
  constructor() {
    this.x = 0; this.z = 0;
    this.yaw = 0; this.pitch = 0;
    this.radius = 0.35;
    this.vx = 0; this.vz = 0;
    this.eye = 1.6;
    this.crouching = false;
    this.sprinting = false;
    this.keys = {};
    this.props = [];         // solid circles { x, z, r } set per floor
    this.mobs = [];          // the floor's guards: living ones are solid circles too (radius e.r)
    this.speedMul = 1;       // dev mode sets this to 5
    this.canSprint = true;   // false when out of stamina
    this.noiseBonus = 0;     // extra noise metres from armor
    this.stealthMul = 1;     // 0.5 with a shadow potion: guards see half as far
    this.acc = 0;
    this.dashS = { on: false, t: 0, dur: 0.18, dist: 6, dx: 0, dz: 1 };   // the dash in progress (one shared object, no allocation): see startDash
    this.slippery = false;   // on ice (set each frame by main.js)
    this.slipT = 0; this.slipRate = 2.2;   // seconds of slide left after leaving the ice, and how little you steer on it (14 on normal floor)
  }

  place(floor) {
    this.x = (floor.start.x + 0.5) * TILE;
    this.z = (floor.start.y + 0.5) * TILE;
    this.vx = this.vz = 0;
    // face the first corridor/room direction: toward the nearest other room centre
    const r = floor.rooms[1] || floor.rooms[0];
    this.yaw = Math.atan2(-(r.cx + 0.5) * TILE + this.x, -(r.cy + 0.5) * TILE + this.z);
    this.pitch = 0;
  }

  look(dx, dy) {
    this.yaw -= dx * 0.0022;
    this.pitch = Math.max(-1.45, Math.min(1.45, this.pitch - dy * 0.0022));
  }

  // Circle against wall tiles (guards borrow this through Player.prototype.blocked, so it takes the radius).
  static wallHit(floor, x, z, r, mob) {   // mob: a guard's collider, for which the safe room's open door is solid too
    const x0 = Math.floor((x - r) / TILE), x1 = Math.floor((x + r) / TILE);
    const z0 = Math.floor((z - r) / TILE), z1 = Math.floor((z + r) / TILE);
    for (let ty = z0; ty <= z1; ty++) for (let tx = x0; tx <= x1; tx++) {
      let wall = tx < 0 || ty < 0 || tx >= floor.w || ty >= floor.h;
      if (!wall) { const t = floor.tiles[ty * floor.w + tx]; wall = t === T_WALL || t === T_DOOR || (mob === true && t === T_SAFEDOOR); }
      if (!wall) continue;
      const cx = Math.max(tx * TILE, Math.min(x, (tx + 1) * TILE));
      const cz = Math.max(ty * TILE, Math.min(z, (ty + 1) * TILE));
      if ((x - cx) ** 2 + (z - cz) ** 2 < r * r) return true;
    }
    return false;
  }

  blocked(floor, x, z) {
    const r = this.radius;
    if (Player.wallHit(floor, x, z, r, this.mob)) return true;
    const props = this.props;
    for (let i = 0; i < props.length; i++) { const p = props[i]; if (p.r > 0 && (x - p.x) ** 2 + (z - p.z) ** 2 < (r + p.r) ** 2) return true; }
    return false;
  }

  // Props are circles. Walking into one pushes you out along its surface instead of stopping you dead,
  // so you slide round barrels, urns and statues rather than catching on them. Tiny clutter (candles) is ignored.
  // Runs 120 times a second: plain loops over props then living mobs, no generator or array allocations.
  slideOffProps(floor) {
    const props = this.props, mobs = this.mobs;
    for (let pass = 0; pass < 2; pass++) {
      for (let i = 0; i < props.length; i++) this.slideOff(floor, props[i]);
      for (let i = 0; i < mobs.length; i++) if (!mobs[i].dead) this.slideOff(floor, mobs[i]);
    }
  }
  slideOff(floor, p) {
    if (p.r <= SMALL_PROP) return;
    const dx = this.x - p.x, dz = this.z - p.z, min = this.radius + p.r, d2 = dx * dx + dz * dz;
    if (d2 >= min * min || d2 < 1e-8) return;
    const d = Math.sqrt(d2), nx = dx / d, nz = dz / d;
    const px = p.x + nx * min, pz = p.z + nz * min;
    if (!Player.wallHit(floor, px, pz, this.radius)) { this.x = px; this.z = pz; }
    const into = this.vx * nx + this.vz * nz;                 // drop the part of the velocity that pushes into it
    if (into < 0) { this.vx -= into * nx; this.vz -= into * nz; }
  }

  // Dash: a short eased slide of `dist` metres in `dur` seconds along the movement keys (forward when none are held). It sets the velocity each
  // step (fast at the start, easing out) and then goes through the same wall test and prop push-out as walking, so it can never pass a wall,
  // door, prop or guard. Whoever calls it checks the rules (stamina, cooldown, status): main.js tryDash.
  startDash(dist, dur) {
    const k = this.keys;
    let fx = (k[KEYS.forward] ? 1 : 0) - (k[KEYS.back] ? 1 : 0), sx = (k[KEYS.right] ? 1 : 0) - (k[KEYS.left] ? 1 : 0);
    if (!fx && !sx) fx = 1;
    const len = Math.hypot(fx, sx); fx /= len; sx /= len;
    const sin = Math.sin(this.yaw), cos = Math.cos(this.yaw), d = this.dashS;
    d.dx = -sin * fx + cos * sx; d.dz = -cos * fx - sin * sx; d.dist = dist; d.dur = dur; d.t = 0; d.on = true;
  }
  get dashing() { return this.dashS.on; }

  // Advance by real elapsed seconds, in fixed steps so movement is frame-rate independent.
  update(dt, floor) {
    this.acc = Math.min(this.acc + dt, 0.1);
    while (this.acc >= STEP) { this.acc -= STEP; this.step(floor); }
  }

  step(floor) {
    const k = this.keys;
    let fx = (k[KEYS.forward] ? 1 : 0) - (k[KEYS.back] ? 1 : 0);
    let sx = (k[KEYS.right] ? 1 : 0) - (k[KEYS.left] ? 1 : 0);
    const len = Math.hypot(fx, sx) || 1;
    fx /= len; sx /= len;

    this.crouching = !!k[KEYS.crouch];   // C by default, not Ctrl: Ctrl+W (crouch + forward) closes the browser tab and cannot be blocked
    this.sprinting = !!k[KEYS.sprint] && !this.crouching && fx > 0 && this.canSprint;
    const speed = (this.crouching ? TUNE.crouchSpeed : this.sprinting ? TUNE.sprintSpeed : TUNE.walkSpeed) * this.speedMul;

    const sin = Math.sin(this.yaw), cos = Math.cos(this.yaw);
    const wx = (-sin * fx + cos * sx) * speed;
    const wz = (-cos * fx - sin * sx) * speed;

    const ds = this.dashS;
    if (ds.on) {                                          // a dash overrides walking: speed 2 x dist / dur at the start, easing to 0 (the area under it is dist)
      ds.t += STEP;
      const u = (ds.t - STEP * 0.5) / ds.dur;
      if (u >= 1) ds.on = false; else { const v = ds.dist / ds.dur * 2 * (1 - u); this.vx = ds.dx * v; this.vz = ds.dz * v; }
    }
    if (!ds.on) {
      // ease velocity toward the target so starts and stops feel weighty
      const a = 1 - Math.exp(-(this.slippery ? this.slipRate : 14) * STEP);       // on ice you barely steer or stop
      this.vx += (wx - this.vx) * a;
      this.vz += (wz - this.vz) * a;
    }

    const nx = this.x + this.vx * STEP;
    if (!Player.wallHit(floor, nx, this.z, this.radius)) this.x = nx; else this.vx = 0;
    const nz = this.z + this.vz * STEP;
    if (!Player.wallHit(floor, this.x, nz, this.radius)) this.z = nz; else this.vz = 0;
    this.slideOffProps(floor);

    const targetEye = this.crouching ? 1.0 : 1.6;
    this.eye += (targetEye - this.eye) * (1 - Math.exp(-12 * STEP));
  }

  // How far the player's current movement carries, in metres (0 when standing still).
  get noiseRadius() {
    if (Math.hypot(this.vx, this.vz) < 0.6 * this.speedMul) return 0;
    const base = this.crouching ? 1.5 : this.sprinting ? 13 : 6;
    return base + this.noiseBonus * (this.crouching ? 0.3 : 1);       // heavy armor is loud
  }

  get tileX() { return Math.floor(this.x / TILE); }
  get tileY() { return Math.floor(this.z / TILE); }
}
