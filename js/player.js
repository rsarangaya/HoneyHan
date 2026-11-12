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
    this.slippery = false;   // on ice (set each frame by main.js)
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
    for (const p of this.props) if (p.r > 0 && (x - p.x) ** 2 + (z - p.z) ** 2 < (r + p.r) ** 2) return true;
    return false;
  }

  * solidsAround() {
    yield* this.props;
    for (const e of this.mobs) if (!e.dead) yield e;
  }

  // Props are circles. Walking into one pushes you out along its surface instead of stopping you dead,
  // so you slide round barrels, urns and statues rather than catching on them. Tiny clutter (candles) is ignored.
  slideOffProps(floor) {
    for (let pass = 0; pass < 2; pass++) for (const p of this.solidsAround()) {
      if (p.r <= SMALL_PROP) continue;
      const dx = this.x - p.x, dz = this.z - p.z, min = this.radius + p.r, d2 = dx * dx + dz * dz;
      if (d2 >= min * min || d2 < 1e-8) continue;
      const d = Math.sqrt(d2), nx = dx / d, nz = dz / d;
      const px = p.x + nx * min, pz = p.z + nz * min;
      if (!Player.wallHit(floor, px, pz, this.radius)) { this.x = px; this.z = pz; }
      const into = this.vx * nx + this.vz * nz;                 // drop the part of the velocity that pushes into it
      if (into < 0) { this.vx -= into * nx; this.vz -= into * nz; }
    }
  }

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

    // ease velocity toward the target so starts and stops feel weighty
    const a = 1 - Math.exp(-(this.slippery ? 2.2 : 14) * STEP);       // on ice you barely steer or stop
    this.vx += (wx - this.vx) * a;
    this.vz += (wz - this.vz) * a;

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
