// Boss models (the scarecrow, mushroom, lich, giant, werewolf and dragon are here): BOSS_MODELS[id] = { build(e, m, lam), pose(e, dt), tagY, iconY, shadow } for the non-biped bosses.
// build adds the parts to the boss's mesh group m inside animated groups and sets e.bd = { groups, skip, g }: bakeMeshes merges each group on its own (skipping the other
// animated groups nested in it), so a model is a handful of baked meshes however many parts it has. pose eases its channels each frame (e.bp, no allocation).
// A def points at its entry with `model: id`. Units are local (the mesh is scaled by def.scale); the front is -z. The current cave boss is a dressed biped (Enemy.build).
const BOSS_MODELS = {};
const BM_GLOW = new Map();
const bmGlow = c => { let m = BM_GLOW.get(c); if (!m) BM_GLOW.set(c, m = new THREE.MeshBasicMaterial({ color: c })); return m; };   // eyes: unlit, merged as a glow mesh
const bmBox = (w, h, d, mat, x, y, z, parent, rx = 0, ry = 0, rz = 0) => { const p = new THREE.Mesh(boxGeo(w, h, d), mat); p.position.set(x, y, z); if (rx || ry || rz) p.rotation.set(rx, ry, rz); parent.add(p); return p; };
const bmGroup = (parent, x, y, z) => { const g = new THREE.Group(); g.position.set(x, y, z); parent.add(g); return g; };
// where the wind-up is: BM_PH 0 none / 1 winding up (BM_K eases 0..1) / 2 the strike (BM_K 0..1)
let BM_PH = 0, BM_K = 0;
function bmPhase(e) {
  if (!e.winding || !e.mv) { BM_PH = 0; BM_K = 0; return; }
  const w = e.windT_;
  if (e.windT < w) { BM_PH = 1; BM_K = easeInOut(Math.min(1, e.windT / (w * 0.8))); }
  else { BM_PH = 2; const s = Math.min(1, (e.windT - w) / STRIKE_T); BM_K = 1 - (1 - s) * (1 - s); }
}
const bmLerp = (a, b, k) => a + (b - a) * k;

// ---- Harvest King: a scarecrow on a pole. Channels: 0 lean x, 1 twist y, 2 right arm x, 3 right arm z, 4 left arm x, 5 left arm z, 6 pitchfork tilt, 7 head tilt, 8 pitchfork roll ----
const SC_T = [0, 0, 0, 0, 0, 0, 0, 0, 0];
const scPut = (a, b, c, d, f, g, h, i, j) => { const T = SC_T; T[0] = a; T[1] = b; T[2] = c; T[3] = d; T[4] = f; T[5] = g; T[6] = h; T[7] = i; T[8] = j; };
BOSS_MODELS.scarecrow = {
  tagY: 2.45, iconY: 2.15,
  build(e, m, lam) {
    const burlap = lam(0xb8975a), straw = lam(0xe0c050), strawD = lam(0xa88a2a), coat = lam(0x4a3a52), coatD = lam(0x2e2536), patch = lam(0x7a4a3a), wood = lam(0x5a3c22), iron = lam(0x8a8e96), black = lam(0x120c08), eye = bmGlow(0xff9a20);
    const low = bmGroup(m, 0, 0, 0), up = bmGroup(m, 0, 0.95, 0), head = bmGroup(up, 0, 0.72, 0), aL = bmGroup(up, -0.62, 0.5, 0), aR = bmGroup(up, 0.62, 0.5, 0), fork = bmGroup(aR, 0, -0.88, 0);
    cylPart(0.06, 0.075, 1.0, wood, 0, 0.5, 0, low);                                                  // the pole it is nailed to
    cylPart(0.26, 0.4, 0.3, straw, 0, 0.15, 0, low);                                                  // straw heaped round its foot
    for (const [x, z, r] of [[-0.3, -0.1, 0.5], [0.28, 0.12, -0.5], [0.05, -0.32, 0.2]]) bmBox(0.06, 0.3, 0.06, strawD, x, 0.38, z, low, 0, 0, r);
    torsoPart(0.5, 0.7, 0.3, coat, 0, 0.25, 0, up);                                                   // tattered coat
    bmBox(1.7, 0.07, 0.07, wood, 0, 0.5, 0.02, up);                                                   // the crossbar its arms hang from
    for (const [x, h, r] of [[-0.2, 0.34, 0.08], [0, 0.42, -0.05], [0.2, 0.3, 0.1]]) bmBox(0.15, h, 0.05, coatD, x, -0.12 - h / 2 + 0.1, -0.02, up, 0, 0, r);   // ragged hem strips
    bmBox(0.18, 0.18, 0.02, patch, 0.1, 0.3, -0.16, up, 0, 0, 0.2);                                   // a patch on the chest
    for (const [x, y, r] of [[-0.14, 0.62, 0.5], [0.14, 0.62, -0.5], [0, 0.66, 0]]) bmBox(0.05, 0.22, 0.05, straw, x, y, -0.02, up, 0, 0, r);   // straw bursting out of the collar
    ellPart(0.44, 0.48, 0.42, burlap, 0, 0.2, 0, head);                                               // the burlap sack head
    for (const s of [-1, 1]) { bmBox(0.08, 0.06, 0.03, eye, s * 0.1, 0.25, -0.2, head, 0, 0, -s * 0.3); bmBox(0.12, 0.03, 0.03, black, s * 0.1, 0.31, -0.2, head, 0, 0, -s * 0.3); }   // glowing eyes under angry brows
    for (let i = 0; i < 5; i++) { const x = (i - 2) * 0.065; bmBox(0.03, 0.04, 0.02, black, x, 0.1 - 0.012 * (2 - Math.abs(i - 2)) * -1, -0.205, head, 0, 0, (i - 2) * 0.2); }   // the stitched grin
    for (let i = 0; i < 4; i++) bmBox(0.012, 0.05, 0.012, black, (i - 1.5) * 0.065 + 0.0, 0.1, -0.21, head);   // stitches across the mouth
    cylPart(0.2, 0.23, 0.08, strawD, 0, 0.4, 0, head);                                                // a crown of straw: a band and spikes
    for (let i = 0; i < 6; i++) { const a = i / 6 * Math.PI * 2; bmBox(0.05, 0.24, 0.05, straw, Math.sin(a) * 0.17, 0.52, Math.cos(a) * 0.17, head, Math.cos(a) * 0.4, 0, -Math.sin(a) * 0.4); }
    for (const [g, s] of [[aL, -1], [aR, 1]]) {
      cylPart(0.075, 0.06, 0.9, coat, 0, -0.45, 0, g);                                                // a long sleeve
      ellPart(0.15, 0.15, 0.15, strawD, 0, -0.93, 0, g);                                              // a stuffed glove
      for (const x of [-0.05, 0, 0.05]) bmBox(0.025, 0.16, 0.025, straw, x + s * 0.0, -1.03, 0, g, 0, 0, x * 5);   // straw fingers
    }
    cylPart(0.022, 0.022, 2.0, wood, 0, 0.5, 0, fork);                                                // the pitchfork: a long haft, a crossbar and three tines
    bmBox(0.34, 0.045, 0.045, iron, 0, 1.45, 0, fork);
    for (const x of [-0.15, 0, 0.15]) bmBox(0.035, x ? 0.34 : 0.42, 0.035, iron, x, 1.65, 0, fork);
    e.bd = { groups: [low, up, head, aL, aR, fork], skip: new Set([low, up, head, aL, aR, fork]), g: { low, up, head, aL, aR, fork } };
    e.bp = [0.05, 0, 0.5, 0.18, 0, -0.18, -0.5, 0, 0];
  },
  pose(e, dt) {
    const g = e.bd.g, p = e.bp, t = performance.now() * 0.001 + e.seed % 7, sw = Math.sin(e.walkT), id = e.mv ? e.mv.id : '';
    bmPhase(e);
    const sn = Math.sin(t * 1.1), s2 = Math.sin(t * 1.7 + 1);
    let snap = false;
    if (e.dormant) scPut(0.12, 0, 0.5, 0.3, 0.1, -0.3, -0.5, 0.45, 0);                              // slumped on its pole
    else scPut(0.05 + 0.04 * sn + 0.05 * Math.abs(sw), 0.06 * s2, 0.5 + 0.2 * sw, 0.18 + 0.05 * sn, -0.25 * sw, -0.18 - 0.05 * s2, -0.5 - 0.2 * sw, 0.05 * sn, 0);   // idle: sways, arms swing as it walks
    if (e.stun > 0) scPut(0.45, 0, 0.2, 0.6, 0.2, -0.6, 0, 0.5, 0);
    else if (BM_PH) {
      const k = BM_K, T = SC_T, a = BM_PH === 1 ? 0 : 1;
      if (id === 'jab') {                                                                              // cock the fork back over the shoulder, then thrust it forward
        if (a === 0) scPut(bmLerp(T[0], -0.3, k), 0.2 * k, bmLerp(T[2], 2.4, k), 0.25, bmLerp(T[4], 0.8, k), -0.3, bmLerp(T[6], -1.5, k), -0.2 * k, 0);
        else { scPut(bmLerp(-0.3, 0.4, k), bmLerp(0.2, -0.2, k), bmLerp(2.4, 1.35, k), 0.2, 0.5, -0.3, bmLerp(-1.5, -2.85, k), 0.1, 0); snap = true; }
      } else if (id === 'sweep' || id === 'toss' || id === 'toss2' || id === 'toss3') {               // both arms and the fork overhead, then slammed down
        if (a === 0) scPut(bmLerp(T[0], -0.35, k), 0, bmLerp(T[2], 2.7, k), 0.2, bmLerp(T[4], 2.5, k), -0.2, bmLerp(T[6], -2.7, k), -0.3 * k, 0);
        else { scPut(bmLerp(-0.35, 0.55, k), 0, bmLerp(2.7, 1.1, k), 0.2, bmLerp(2.5, 0.9, k), -0.2, bmLerp(-2.7, -2.5, k), 0.2, 0); snap = true; }
      } else {                                                                                         // crows: arms thrown up and out, the head back, then a flap
        const up = a === 0 ? k : 1 - 0.2 * k;
        scPut(-0.12 * up, 0, bmLerp(T[2], 0.1, up), bmLerp(T[3], 2.7, up), bmLerp(T[4], 0.1, up), bmLerp(T[5], -2.7, up), bmLerp(T[6], 0.3, up), -0.4 * up, -0.1);
        if (a === 1) snap = true;
      }
    }
    const k = snap ? 1 : 1 - Math.exp(-12 * dt), T = SC_T;
    for (let i = 0; i < 9; i++) p[i] += (T[i] - p[i]) * k;
    g.up.rotation.x = p[0]; g.up.rotation.y = p[1]; g.up.position.y = 0.95 + 0.05 * Math.abs(sw);
    g.aR.rotation.x = p[2]; g.aR.rotation.z = p[3]; g.aL.rotation.x = p[4]; g.aL.rotation.z = p[5];
    g.fork.rotation.x = p[6]; g.fork.rotation.z = -p[3] * 0.9; g.head.rotation.x = p[7];
  },
};

// ---- Fungal Warden: an evil mushroom. Channels: 0 lean x, 1 lean z, 2 right arm x, 3 left arm x, 4 cap width, 5 cap height, 6 cap lift, 7 body stretch ----
const MU_T = [0, 0, 0, 0, 1, 1, 0, 1];
const muPut = (a, b, c, d, f, g, h, i) => { const T = MU_T; T[0] = a; T[1] = b; T[2] = c; T[3] = d; T[4] = f; T[5] = g; T[6] = h; T[7] = i; };
BOSS_MODELS.mushroom = {
  tagY: 2.3, iconY: 2.0, shadow: 1.1,
  build(e, m, lam) {
    const stalk = lam(0xe0c8a0), stalkD = lam(0xa88860), cap = lam(0x7a3ea8), capD = lam(0x4e2a78), gill = lam(0xe6c8f0), gillD = lam(0x9a6ab8), spot = lam(0xf0e2c8), sac = lam(0xc8e070), tooth = lam(0xf4ecd8), black = lam(0x140a18), eye = bmGlow(0xe8ff30);
    const base = bmGroup(m, 0, 0, 0), body = bmGroup(m, 0, 0.5, 0), capG = bmGroup(body, 0, 0.82, 0), aL = bmGroup(body, -0.43, 0.42, -0.05), aR = bmGroup(body, 0.43, 0.42, -0.05);
    ellPart(1.0, 0.5, 1.0, stalkD, 0, 0.12, 0, base);                                                // a swollen foot
    for (let i = 0; i < 5; i++) { const a = i / 5 * Math.PI * 2 + 0.3; bmBox(0.1, 0.07, 0.55, stalkD, Math.sin(a) * 0.5, 0.05, Math.cos(a) * 0.5, base, 0.25, a, 0); }   // roots creeping out across the floor
    cylPart(0.4, 0.44, 1.2, stalk, 0, 0.25, 0, body);                                                 // the stalk (body-local: the base of the body is y 0, 0.5 above the floor)
    cylPart(0.46, 0.4, 0.12, stalkD, 0, 0.78, 0, body);                                               // a ring of skin where the cap joins
    for (const s of [-1, 1]) {                                                                       // a scowling face on the stalk
      bmBox(0.2, 0.13, 0.05, eye, s * 0.16, 0.58, -0.39, body, 0, 0, -s * 0.3);
      bmBox(0.26, 0.06, 0.05, black, s * 0.16, 0.69, -0.39, body, 0, 0, -s * 0.42);
    }
    bmBox(0.5, 0.18, 0.05, black, 0, 0.3, -0.395, body);                                            // a wide mouth with jagged teeth
    for (let i = 0; i < 5; i++) { const x = (i - 2) * 0.095; bmBox(0.065, 0.11, 0.04, tooth, x, i % 2 ? 0.35 : 0.25, -0.41, body, 0, 0, (i % 2 ? 0.25 : -0.25) * (i - 2 ? 1 : 0)); }
    for (const [x, y, z, r] of [[-0.36, 0.1, -0.16, 0.12], [0.34, 0.2, -0.2, 0.1], [0.3, -0.05, 0.22, 0.14], [-0.28, 0.3, 0.28, 0.1]]) ellPart(r * 2, r * 2, r * 2, sac, x, y, z, body);   // swollen spore sacs
    for (const s of [aL, aR]) { cylPart(0.1, 0.14, 0.42, stalk, 0, -0.2, 0, s); ellPart(0.26, 0.22, 0.24, stalkD, 0, -0.46, 0, s); }   // stubby arms ending in fists
    ellPart(1.64, 0.7, 1.64, cap, 0, 0.2, 0, capG);                                                  // the cap
    cylPart(0.8, 0.8, 0.07, gill, 0, -0.1, 0, capG);                                                 // its gills underneath
    for (let i = 0; i < 6; i++) bmBox(0.035, 0.03, 1.5, gillD, 0, -0.14, 0, capG, 0, i / 6 * Math.PI, 0);
    cylPart(0.76, 0.82, 0.12, capD, 0, -0.02, 0, capG);                                              // a darker rim
    for (const [x, z, r] of [[0.0, 0.0, 0.34], [0.42, -0.2, 0.2], [-0.4, -0.25, 0.22], [-0.15, 0.45, 0.18], [0.3, 0.38, 0.16]]) { const h = 0.2 + 0.35 * Math.sqrt(Math.max(0, 1 - (x * x + z * z) / (0.82 * 0.82))); ellPart(r, 0.06, r, spot, x, h + 0.01, z, capG); }   // pale spots
    e.bd = { groups: [base, body, capG, aL, aR], skip: new Set([base, body, capG, aL, aR]), g: { base, body, cap: capG, aL, aR } };
    e.bp = [0, 0, 0, 0, 1, 1, 0, 1];
  },
  pose(e, dt) {
    const g = e.bd.g, p = e.bp, t = performance.now() * 0.001 + e.seed % 7, sw = Math.sin(e.walkT * 0.6), id = e.mv ? e.mv.id : '', bs = e.bs;
    bmPhase(e);
    const sn = Math.sin(t * 1.3);
    let snap = false;
    if (e.dormant) muPut(0.1, 0, 0.2, 0.2, 0.98, 0.9, -0.03, 0.96);
    else muPut(0.02, 0.05 * sn + 0.06 * sw, 0.15 + 0.15 * sw, 0.15 - 0.15 * sw, 1 + 0.02 * sn, 1 - 0.02 * sn + 0.03 * Math.abs(sw), 0.02 * sn, 1);   // idle: sways, the cap breathes, a waddle as it walks
    if (bs.exp > 0) { const k = Math.min(1, bs.exp * 3, (1.5 - bs.exp) * 6 + 0.2); muPut(0.2, 0, 0.5, 0.5, bmLerp(1, 1.1, k), bmLerp(1, 0.55, k), bmLerp(0, -0.16, k), bmLerp(1, 0.94, k)); }   // after a Spore Burst: the cap hangs deflated
    if (e.stun > 0) muPut(-0.35, 0, 0.3, 0.3, 1.05, 0.7, -0.1, 1);
    else if (BM_PH) {
      const k = BM_K, a = BM_PH === 1 ? 0 : 1, T = MU_T;
      if (id === 'burst') {                                                                            // the cap swells and quivers, then it bursts
        if (a === 0) { const q = 1 + 0.03 * Math.sin(t * 40) * k; muPut(-0.1 * k, 0, bmLerp(T[2], 1.2, k), bmLerp(T[3], 1.2, k), bmLerp(1, 1.3, k) * q, bmLerp(1, 1.3, k) * q, bmLerp(0, 0.12, k), bmLerp(1, 1.1, k)); }
        else { muPut(0.1, 0, 0.4, 0.4, bmLerp(1.3, 1.0, k), bmLerp(1.3, 0.8, k), bmLerp(0.12, 0, k), bmLerp(1.1, 0.95, k)); snap = true; }
      } else if (id === 'roots') {                                                                     // squats and presses its fists into the floor
        if (a === 0) muPut(bmLerp(T[0], 0.2, k), 0, bmLerp(T[2], 1.0, k), bmLerp(T[3], 1.0, k), 1.02, bmLerp(1, 0.9, k), bmLerp(0, -0.05, k), bmLerp(1, 0.9, k));
        else { muPut(0.35, 0, 0.3, 0.3, 1.04, 0.92, -0.06, 0.88); snap = true; }
      } else {                                                                                         // slam and lob: rear up, cap lifted, then crash down
        if (a === 0) muPut(bmLerp(T[0], -0.3, k), 0, bmLerp(T[2], 2.7, k), bmLerp(T[3], 2.7, k), 1, bmLerp(1, 1.12, k), bmLerp(0, 0.14, k), bmLerp(1, 1.08, k));
        else { muPut(bmLerp(-0.3, 0.5, k), 0, bmLerp(2.7, 0.3, k), bmLerp(2.7, 0.3, k), bmLerp(1, 1.08, k), bmLerp(1.12, 0.85, k), bmLerp(0.14, -0.08, k), bmLerp(1.08, 0.9, k)); snap = true; }
      }
    }
    const k = snap ? 1 : 1 - Math.exp(-12 * dt), T = MU_T;
    for (let i = 0; i < 8; i++) p[i] += (T[i] - p[i]) * k;
    g.body.rotation.x = p[0]; g.body.rotation.z = p[1]; g.body.scale.y = p[7];
    g.aR.rotation.x = p[2]; g.aL.rotation.x = p[3];
    g.cap.scale.set(p[4], p[5], p[4]); g.cap.position.y = 0.82 + p[6];
  },
};

// A four-sided spike (a pyramid: base radius r, length h) centred on (x, y, z) with its tip along (dx, dy, dz): the shards of the Frost Giant.
const BM_UP = new THREE.Vector3(0, 1, 0), BM_DIR = new THREE.Vector3();
const bmSpike = (parent, mat, r, h, x, y, z, dx, dy, dz) => { const p = new THREE.Mesh(cachedGeo('spike' + r + ',' + h, () => { const g = new THREE.CylinderGeometry(0, r, h, 4, 1); g.rotateY(Math.PI / 4); return g; }), mat); p.position.set(x, y, z); p.quaternion.setFromUnitVectors(BM_UP, BM_DIR.set(dx, dy, dz).normalize()); parent.add(p); return p; };

// ---- Librarian Lich: a robed skeleton with a floating tome. Channels: 0 lean x, 1 twist y, 2 left arm x, 3 left arm z, 4 right arm x, 5 right arm z, 6 head x, 7 hover, 8 tome tilt ----
const LI_T = [0, 0, 0, 0, 0, 0, 0, 0, 0];
const liPut = (a, b, c, d, f, g, h, i, j) => { const T = LI_T; T[0] = a; T[1] = b; T[2] = c; T[3] = d; T[4] = f; T[5] = g; T[6] = h; T[7] = i; T[8] = j; };
BOSS_MODELS.lich = {
  tagY: 2.5, iconY: 2.2, shadow: 0.9,
  build(e, m, lam) {
    const bone = lam(0xdad4bc), boneD = lam(0xa49a7c), robe = lam(0x3a2d5c), robeD = lam(0x261e40), trim = lam(0xc8a040), black = lam(0x08060c), cover = lam(0x7a1e2a), page = lam(0xe8dcb4);
    const eye = bmGlow(0x50ffa8), soul = bmGlow(0x70ffc8), rune = bmGlow(0xffd860);
    const low = bmGroup(m, 0, 0, 0), up = bmGroup(m, 0, 0.95, 0), head = bmGroup(up, 0, 0.82, 0), aL = bmGroup(up, -0.4, 0.52, 0), aR = bmGroup(up, 0.4, 0.52, 0), tome = bmGroup(aL, 0, -0.74, -0.3);
    cylPart(0.26, 0.56, 1.0, robe, 0, 0.5, 0, low);                                                   // the long robe, flaring to the floor
    cylPart(0.27, 0.27, 0.07, trim, 0, 0.93, 0, low);                                                 // a gold belt
    for (let i = 0; i < 9; i++) { const a = i / 9 * Math.PI * 2; bmBox(0.17, 0.26 + 0.06 * (i % 3), 0.03, robe, Math.sin(a) * 0.55, 0.1, Math.cos(a) * 0.55, low, 0.12, a, 0); }   // a tattered hem
    bmBox(0.2, 0.7, 0.02, black, 0, 0.45, -0.37, low, 0.1, 0, 0);                                     // the dark slit of the robe
    cylPart(0.035, 0.035, 0.62, boneD, 0, 0.28, 0.06, up);                                            // the spine
    bmBox(0.3, 0.08, 0.1, bone, 0, -0.02, 0, up);                                                     // the pelvis
    for (let i = 0; i < 5; i++) { const y = 0.1 + i * 0.1, hw = 0.15 + 0.06 * Math.sin((i + 0.6) / 5 * Math.PI); bmBox(hw * 2, 0.03, 0.03, bone, 0, y, -0.14, up); for (const s of [-1, 1]) bmBox(0.03, 0.03, 0.22, bone, s * hw, y, -0.03, up); }   // the bone-cage ribs: a bar across the front and one down each side
    bmBox(0.035, 0.48, 0.03, bone, 0, 0.27, -0.145, up);                                              // the breastbone
    ellPart(0.15, 0.15, 0.15, soul, 0, 0.28, -0.02, up);                                              // a soul-light caged in the ribs
    bmBox(0.4, 0.035, 0.05, bone, 0, 0.5, -0.04, up);                                                 // collarbones
    for (const s of [-1, 1]) ellPart(0.2, 0.15, 0.2, robe, s * 0.3, 0.52, 0, up);                     // cloth shoulders
    cylPart(0.28, 0.34, 0.16, robeD, 0, 0.5, 0.04, up);                                               // a ragged collar
    bmBox(0.56, 0.9, 0.05, robeD, 0, 0.05, 0.17, up, 0.08, 0, 0);                                     // a tattered cape down the back
    for (let i = 0; i < 4; i++) bmBox(0.12, 0.3, 0.04, robeD, (i - 1.5) * 0.14, -0.5, 0.2, up, 0.08, 0, (i - 1.5) * 0.1);
    ellPart(0.34, 0.36, 0.34, bone, 0, 0, 0, head);                                                   // the skull
    bmBox(0.2, 0.1, 0.15, bone, 0, -0.11, -0.06, head);                                               // cheekbones and a jaw
    bmBox(0.2, 0.05, 0.16, boneD, 0, -0.18, -0.06, head);
    for (let i = 0; i < 6; i++) bmBox(0.02, 0.04, 0.02, bone, (i - 2.5) * 0.033, -0.14, -0.145, head);   // teeth
    for (const s of [-1, 1]) { bmBox(0.11, 0.12, 0.04, black, s * 0.075, 0.02, -0.155, head, 0, 0, s * 0.15); bmBox(0.055, 0.065, 0.03, eye, s * 0.075, 0.02, -0.17, head); }   // sockets with a green fire in them
    bmBox(0.03, 0.05, 0.03, black, 0, -0.045, -0.165, head);
    for (const [x, t] of [[-0.1, -0.35], [0, 0], [0.1, 0.35]]) bmBox(0.035, 0.18, 0.035, boneD, x, 0.2, -0.02, head, 0, 0, t);   // a crown of bone spikes
    bmBox(0.44, 0.48, 0.08, robeD, 0, 0.0, 0.17, head);                                               // the cowl behind the skull
    for (const s of [-1, 1]) bmBox(0.06, 0.42, 0.3, robeD, s * 0.21, 0.0, 0.01, head, 0, 0, s * 0.1);
    bmBox(0.44, 0.06, 0.36, robeD, 0, 0.21, 0.0, head);
    for (const [g, s] of [[aL, -1], [aR, 1]]) {
      cylPart(0.07, 0.15, 0.42, robe, 0, -0.21, 0, g);                                                // a bell sleeve
      cylPart(0.025, 0.03, 0.34, bone, 0, -0.52, 0, g);                                               // forearm bone
      bmBox(0.08, 0.1, 0.05, bone, 0, -0.72, 0, g);                                                   // the hand
      for (const x of [-0.03, 0, 0.03]) bmBox(0.014, 0.09, 0.014, bone, x, -0.8, s > 0 ? -0.02 : -0.025, g, s > 0 ? -0.5 : 0, 0, 0);   // bony fingers (the right ones claw forward)
    }
    for (const s of [-1, 1]) {                                                                         // the tome, open and facing you: leather boards with cream pages and glowing runes
      bmBox(0.3, 0.4, 0.02, cover, s * 0.16, 0.04, 0.0, tome, 0, s * 0.35, 0);
      bmBox(0.27, 0.36, 0.015, page, s * 0.16, 0.04, -0.017, tome, 0, s * 0.35, 0);
      for (let i = 0; i < 3; i++) bmBox(0.15, 0.018, 0.01, rune, s * 0.16, 0.12 - i * 0.07, -0.03, tome, 0, s * 0.35, 0);
    }
    bmBox(0.035, 0.42, 0.035, cover, 0, 0.04, 0.03, tome);
    e.bd = { groups: [low, up, head, aL, aR, tome], skip: new Set([low, up, head, aL, aR, tome]), g: { low, up, head, aL, aR, tome } };
    e.bp = [0.04, 0, 1.0, -0.15, 0.5, 0.25, 0, 0.08, 0];
  },
  pose(e, dt) {
    const g = e.bd.g, p = e.bp, t = performance.now() * 0.001 + e.seed % 7, sw = Math.sin(e.walkT * 0.7), id = e.mv ? e.mv.id : '', bs = e.bs;
    bmPhase(e);
    const sn = Math.sin(t * 1.4), s2 = Math.sin(t * 2.1 + 1);
    let snap = false;
    if (e.dormant) liPut(0.3, 0, 0.15, -0.1, 0.12, 0.1, 0.55, 0.0, 0.2);                              // slumped, the tome resting
    else liPut(0.04 + 0.03 * sn, 0.05 * s2, 1.0 + 0.06 * sn, -0.15, 0.5 + 0.2 * sw, 0.25, 0.04 * sn, 0.1 + 0.05 * sn, 0.05 * s2);   // idle: hovers and sways, the tome bobbing
    if (e.stun > 0) liPut(-0.5, 0, 0.6, -0.5, 0.4, 0.6, -0.4, 0.1, 0.4);
    else if (BM_PH) {
      const k = BM_K, T = LI_T, a = BM_PH === 1 ? 0 : 1;
      if (id === 'slam' || id === 'bookslam') {                                                        // the tome raised overhead, then brought down hard
        if (a === 0) liPut(bmLerp(T[0], -0.25, k), 0.2 * k, bmLerp(T[2], 2.6, k), -0.2, bmLerp(T[4], 1.2, k), 0.3, bmLerp(T[6], -0.25, k), 0.12, bmLerp(T[8], 0.5, k));
        else { liPut(bmLerp(-0.25, 0.5, k), bmLerp(0.2, -0.15, k), bmLerp(2.6, 0.7, k), -0.2, 1.2, 0.3, bmLerp(-0.25, 0.3, k), 0.05, bmLerp(0.5, -0.3, k)); snap = true; }
      } else if (id === 'pages') {                                                                     // both arms thrust forward and the pages fly
        if (a === 0) liPut(bmLerp(T[0], -0.1, k), 0, bmLerp(T[2], 1.6, k), bmLerp(T[3], -0.3, k), bmLerp(T[4], 1.7, k), bmLerp(T[5], 0.3, k), bmLerp(T[6], -0.15, k), 0.12, 0.1);
        else { liPut(0.2, 0, 1.5, -0.3, 1.5, 0.3, 0.1, 0.1, 0); snap = true; }
      } else if (id === 'bookmark') {                                                                  // the tome held up, a bow: it is about to vanish
        liPut(bmLerp(T[0], 0.25, k), 0, bmLerp(T[2], 1.9, k), -0.15, bmLerp(T[4], 2.2, k), 0.2, bmLerp(T[6], 0.2, k), bmLerp(0.1, 0.0, k), 0);
      } else {                                                                                         // the barrage: arms flung wide, the head back, the tome blazing
        if (a === 0) liPut(bmLerp(T[0], -0.2, k), 0, bmLerp(T[2], 0.8, k), bmLerp(T[3], -1.6, k), bmLerp(T[4], 0.8, k), bmLerp(T[5], 1.6, k), bmLerp(T[6], -0.4, k), bmLerp(0.1, 0.3, k), bmLerp(T[8], 0.3, k));
        else { liPut(0.15, 0, 1.0, -0.8, 1.0, 0.8, 0.1, 0.2, 0); snap = true; }
      }
    }
    const mt = e.mats[0], op = id === 'bookmark' && BM_PH === 1 ? 1 - 0.8 * BM_K : 1;                  // the Bookmark's tell: the body fades out before it blinks
    if (mt && mt.opacity !== op) { mt.transparent = op < 1; mt.opacity = op; }
    const k = snap ? 1 : 1 - Math.exp(-12 * dt), T = LI_T;
    for (let i = 0; i < 9; i++) p[i] += (T[i] - p[i]) * k;
    g.up.rotation.x = p[0]; g.up.rotation.y = p[1]; g.low.position.y = p[7]; g.up.position.y = 0.95 + p[7];
    g.aL.rotation.x = p[2]; g.aL.rotation.z = p[3]; g.aR.rotation.x = p[4]; g.aR.rotation.z = p[5]; g.head.rotation.x = p[6];
    g.tome.rotation.x = -p[2] * 0.85 + p[8] + p[0];
  },
};

// ---- Frost Giant: a hovering mass of ice shards round a glowing core. Channels: 0 lean x, 1 twist y, 2 right arm x, 3 left arm x, 4 right arm z, 5 left arm z, 6 head x, 7 hover, 8 core open ----
const FG_T = [0, 0, 0, 0, 0, 0, 0, 0, 1];
const fgPut = (a, b, c, d, f, g, h, i, j) => { const T = FG_T; T[0] = a; T[1] = b; T[2] = c; T[3] = d; T[4] = f; T[5] = g; T[6] = h; T[7] = i; T[8] = j; };
BOSS_MODELS.giant = {
  tagY: 2.7, iconY: 2.4, shadow: 1.5,
  build(e, m, lam) {
    const ice = lam(0xa4d4f0), iceL = lam(0xe0f6ff), iceD = lam(0x6aa6d6), iceDD = lam(0x3e78ac), dark = lam(0x123656), core = bmGlow(0xc4f6ff), eye = bmGlow(0xffffff);
    const body = bmGroup(m, 0, 0.9, 0), head = bmGroup(m, 0, 1.6, 0), aL = bmGroup(m, -0.95, 1.2, 0), aR = bmGroup(m, 0.95, 1.2, 0), orbit = bmGroup(m, 0, 0.95, 0);
    ellPart(0.85, 0.85, 0.85, core, 0, 0, 0, body);                                                   // the pale glowing core
    const cols = [ice, iceL, iceD];
    for (let i = 0; i < 9; i++) {                                                                      // nine shards round the core, jutting out and up
      const a = i / 9 * Math.PI * 2, s = Math.sin(a), c = Math.cos(a), r = 0.5 + 0.05 * (i % 3);
      bmSpike(body, cols[i % 3], 0.2 + 0.05 * (i % 3), 0.85 + 0.2 * (i % 2), s * r, 0.12 * (i % 3 - 1) + 0.12, c * r, s * 0.85, 0.5 + 0.5 * (i % 2), c * 0.85);
    }
    bmSpike(body, iceL, 0.2, 0.8, 0, -0.1, -0.5, 0, 0.6, -1);                                       // a great chest crystal
    bmSpike(body, iceD, 0.26, 0.9, 0.3, 0.2, 0.3, 0.5, 1, 0.5);                                       // and spines on the back
    bmSpike(body, iceD, 0.26, 0.9, -0.3, 0.2, 0.3, -0.5, 1, 0.5);
    for (let i = 0; i < 5; i++) { const a = i / 5 * Math.PI * 2 + 0.4; bmSpike(body, i % 2 ? ice : iceDD, 0.16, 0.7, Math.sin(a) * 0.3, -0.5, Math.cos(a) * 0.3, Math.sin(a) * 0.35, -1, Math.cos(a) * 0.35); }   // icicles hanging below: its legs
    bmSpike(head, iceL, 0.3, 0.8, 0, 0.32, 0, 0, 1, 0);                                               // the head: a tall crystal
    bmSpike(head, ice, 0.3, 0.55, 0, -0.24, 0, 0, -1, 0);
    for (const s of [-1, 1]) { bmBox(0.2, 0.09, 0.04, dark, s * 0.1, 0.07, -0.2, head, 0, 0, -s * 0.25); bmBox(0.13, 0.045, 0.03, eye, s * 0.1, 0.06, -0.225, head, 0, 0, -s * 0.25); }   // a scowl: dark brows, white eyes
    for (let i = 0; i < 5; i++) { const a = i / 5 * Math.PI * 2; bmSpike(head, i % 2 ? iceL : ice, 0.07, 0.42, Math.sin(a) * 0.26, 0.15, Math.cos(a) * 0.26, Math.sin(a) * 0.7, 1, Math.cos(a) * 0.7); }   // a crown of shards
    for (const [g, s] of [[aL, -1], [aR, 1]]) {
      bmSpike(g, iceL, 0.22, 0.75, s * 0.12, 0.3, 0, s * 0.5, 1, 0);                                  // a shoulder spike
      bmSpike(g, ice, 0.19, 0.85, 0, -0.4, 0, 0, -1, 0);                                              // upper arm
      bmSpike(g, iceD, 0.13, 0.7, s * 0.04, -1.0, -0.08, 0, -1, -0.25);                               // forearm
      for (const x of [-0.09, 0, 0.09]) bmSpike(g, iceL, 0.08, 0.42, x, -1.4, -0.22, 0, -0.3, -1);   // a fist of spikes
      bmSpike(g, iceDD, 0.1, 0.5, s * 0.25, -0.65, 0.1, s * 0.8, -0.6, 0.2);                          // an elbow shard
    }
    for (let i = 0; i < 4; i++) { const a = i / 4 * Math.PI * 2, s = Math.sin(a), c = Math.cos(a); bmSpike(orbit, cols[i % 3], 0.12, 0.6, s * 1.3, 0.3 * (i % 2 ? 1 : -1), c * 1.3, c, 0.2, -s); }   // the four shards that break off and orbit it
    orbit.visible = false;
    e.bd = { groups: [body, head, aL, aR, orbit], skip: new Set([body, head, aL, aR, orbit]), g: { body, head, aL, aR, orbit } };
    e.bp = [0.04, 0, 0.25, 0.25, 0.3, -0.3, 0, 0.1, 1];
  },
  pose(e, dt) {
    const g = e.bd.g, p = e.bp, t = performance.now() * 0.001 + e.seed % 7, sw = Math.sin(e.walkT * 0.6), id = e.mv ? e.mv.id : '', bs = e.bs;
    bmPhase(e);
    const sn = Math.sin(t * 1.2);
    let snap = false;
    if (e.dormant) fgPut(0.15, 0, 0.1, 0.1, 0.15, -0.15, 0.4, -0.2, 0.6);                              // asleep: sunk low, the core dim
    else fgPut(0.04 + 0.03 * sn, 0.1 * Math.sin(t * 0.7), 0.25 + 0.15 * sw, 0.25 - 0.15 * sw, 0.3, -0.3, 0.05 * sn, 0.12 + 0.06 * sn, 1 + 0.08 * sn);   // idle: hovers and bobs, the core pulses
    if (bs.exp > 0) { const k = Math.min(1, bs.exp * 3, (2 - bs.exp) * 6 + 0.2); fgPut(0.25, 0, 0.5, 0.5, 0.9, -0.9, 0.2, bmLerp(0.12, -0.05, k), bmLerp(1, 1.9, k)); }   // after a Shatter Nova: arms hang open, the core blazes
    if (e.stun > 0) fgPut(-0.4, 0, 0.5, 0.5, 0.5, -0.5, -0.3, 0.1, 1.2);
    else if (BM_PH) {
      const k = BM_K, T = FG_T, a = BM_PH === 1 ? 0 : 1;
      if (id === 'fist') {                                                                             // the right fist cocked back, then driven forward
        if (a === 0) fgPut(bmLerp(T[0], -0.3, k), 0.35 * k, bmLerp(T[2], 2.5, k), 0.4, 0.3, -0.3, 0.1, 0.12, 1);
        else { fgPut(bmLerp(-0.3, 0.45, k), bmLerp(0.35, -0.3, k), bmLerp(2.5, 1.4, k), 0.4, 0.3, -0.3, 0.2, 0.1, 1); snap = true; }
      } else if (id === 'icicles') {                                                                   // both arms forward, spikes out
        if (a === 0) fgPut(bmLerp(T[0], -0.1, k), 0, bmLerp(T[2], 1.6, k), bmLerp(T[3], 1.6, k), 0.2, -0.2, bmLerp(T[6], -0.15, k), 0.12, bmLerp(1, 1.25, k));
        else { fgPut(0.2, 0, 1.5, 1.5, 0.2, -0.2, 0.1, 0.1, 1.1); snap = true; }
      } else if (id === 'freeze') {                                                                    // both fists raised high, then slammed into the floor
        if (a === 0) fgPut(bmLerp(T[0], -0.35, k), 0, bmLerp(T[2], 2.7, k), bmLerp(T[3], 2.7, k), 0.25, -0.25, bmLerp(T[6], -0.2, k), bmLerp(T[7], 0.3, k), bmLerp(1, 1.2, k));
        else { fgPut(bmLerp(-0.35, 0.6, k), 0, bmLerp(2.7, 0.4, k), bmLerp(2.7, 0.4, k), 0.25, -0.25, 0.3, bmLerp(0.3, -0.12, k), 1.1); snap = true; }
      } else {                                                                                         // the nova: arms flung wide, the core swelling
        if (a === 0) fgPut(bmLerp(T[0], -0.2, k), 0, bmLerp(T[2], 0.6, k), bmLerp(T[3], 0.6, k), bmLerp(T[4], 1.7, k), bmLerp(T[5], -1.7, k), bmLerp(T[6], -0.35, k), bmLerp(T[7], 0.3, k), bmLerp(1, 2.0, k));
        else { fgPut(0.2, 0, 0.4, 0.4, bmLerp(1.7, 0.6, k), bmLerp(-1.7, -0.6, k), 0.2, bmLerp(0.3, 0.05, k), bmLerp(2.0, 1.4, k)); snap = true; }
      }
    }
    const k = snap ? 1 : 1 - Math.exp(-12 * dt), T = FG_T;
    for (let i = 0; i < 9; i++) p[i] += (T[i] - p[i]) * k;
    g.body.rotation.x = p[0]; g.body.rotation.y = p[1]; g.body.position.y = 0.9 + p[7]; g.body.scale.setScalar(p[8] > 1 ? 1 + (p[8] - 1) * 0.35 : 1);
    g.head.position.y = 1.6 + p[7] * 1.2; g.head.rotation.x = p[6];
    g.aR.rotation.x = p[2]; g.aL.rotation.x = p[3]; g.aR.rotation.z = p[4]; g.aL.rotation.z = p[5]; g.aR.position.y = g.aL.position.y = 1.2 + p[7] * 0.8;
    const sh = bs.phase >= 1 && !e.dormant; if (g.orbit.visible !== sh) g.orbit.visible = sh;
    if (sh) { g.orbit.rotation.y = t * 1.8; g.orbit.position.y = 0.95 + p[7]; }
  },
};

// ---- Moonfang: a hunched werewolf with long forelimbs, a wolf head and a shaggy coat. Channels: 0 lean (body x, negative = forward), 1 twist y, 2 right arm angle x, 3 left arm angle x (both from the vertical, + = forward),
// 4 jaw open, 5 head x (+ = snout up), 6 crouch dip, 7 tail wag y, 8 arms spread z ----
const WW_T = [0, 0, 0, 0, 0, 0, 0, 0, 0];
const wwPut = (a, b, c, d, f, g, h, i, j) => { const T = WW_T; T[0] = a; T[1] = b; T[2] = c; T[3] = d; T[4] = f; T[5] = g; T[6] = h; T[7] = i; T[8] = j; };
BOSS_MODELS.werewolf = {
  tagY: 2.05, iconY: 1.85, shadow: 1.05,
  build(e, m, lam) {
    const fur = lam(0x54402c), furD = lam(0x2c2016), furG = lam(0x6e5a42), furL = lam(0xa88c64), belly = lam(0x8a7452), claw = lam(0xe8e0c8), tooth = lam(0xf6f0dc), mouth = lam(0x5a1620), nose = lam(0x0e0a0a), eye = bmGlow(0xffc830);
    const body = bmGroup(m, 0, 0.7, 0.2), head = bmGroup(body, 0, 0.9, -0.4), jaw = bmGroup(head, 0, -0.14, -0.12), aL = bmGroup(body, -0.52, 0.5, -0.2), aR = bmGroup(body, 0.52, 0.5, -0.2);
    const lL = bmGroup(m, -0.26, 0.7, 0.12), lR = bmGroup(m, 0.26, 0.7, 0.12), tail = bmGroup(body, 0, 0.05, 0.6);
    ellPart(0.78, 0.8, 0.8, fur, 0, 0.35, -0.1, body);                                                // the deep chest
    ellPart(0.5, 0.5, 0.3, belly, 0, 0.3, -0.45, body);                                               // a pale patch of fur on it
    ellPart(0.6, 0.6, 0.8, furD, 0, 0.0, 0.3, body);                                                  // the lean abdomen
    ellPart(0.72, 0.42, 0.55, furD, 0, 0.62, 0.0, body);                                              // the hump of the shoulders
    for (const [y, z] of [[0.82, -0.12], [0.86, 0.08], [0.8, 0.28], [0.66, 0.48], [0.44, 0.62], [0.22, 0.72]]) bmSpike(body, y > 0.7 ? furL : furG, 0.11, 0.32, 0, y, z, 0, 1, 0.8);   // a ridge of shaggy fur down the back
    for (const s of [-1, 1]) {
      for (const [y, z] of [[0.55, -0.1], [0.3, 0.1], [0.05, 0.3]]) bmSpike(body, furL, 0.07, 0.34, s * 0.38, y, z, s, -0.3, 0.5);   // tufts along the flanks
      bmSpike(body, furG, 0.1, 0.4, s * 0.4, 0.72, -0.05, s * 0.8, 0.6, 0.4);                        // and bristling shoulders
    }
    for (const x of [-0.2, 0, 0.2]) bmSpike(body, furL, 0.06, 0.3, x, 0.05, -0.42, 0, -1, -0.4);       // a ragged fringe under the chest
    ellPart(0.46, 0.42, 0.5, fur, 0, 0, 0, head);                                                      // the skull
    ellPart(0.25, 0.2, 0.46, furG, 0, -0.08, -0.36, head);                                             // the long snout
    ellPart(0.13, 0.1, 0.1, nose, 0, -0.01, -0.6, head);                                               // a black nose
    bmBox(0.18, 0.03, 0.4, mouth, 0, -0.17, -0.36, head);                                              // the dark roof of the mouth
    for (const s of [-1, 1]) {
      bmBox(0.2, 0.06, 0.12, furD, s * 0.11, 0.14, -0.2, head, 0, 0, -s * 0.35);                       // heavy angry brows
      bmBox(0.1, 0.055, 0.03, eye, s * 0.13, 0.07, -0.238, head, 0, 0, -s * 0.3);                      // burning eyes
      bmSpike(head, fur, 0.11, 0.38, s * 0.16, 0.27, 0.06, s * 0.3, 1, -0.1);                          // pricked ears
      bmSpike(head, furL, 0.06, 0.22, s * 0.16, 0.25, 0.02, s * 0.3, 1, -0.1);
      bmSpike(head, tooth, 0.035, 0.15, s * 0.09, -0.21, -0.5, 0, -1, 0);                              // bared fangs
      for (const z of [0.0, 0.14]) bmSpike(head, furL, 0.07, 0.3, s * 0.24, -0.05, z, s, -0.1, 0.5);   // cheek ruff
      bmSpike(jaw, tooth, 0.03, 0.12, s * 0.08, 0.04, -0.4, 0, 1, 0);                                  // and lower fangs
    }
    for (let i = 0; i < 6; i++) { const a = i / 6 * Math.PI * 2; bmSpike(head, i % 2 ? furL : furG, 0.09, 0.4, Math.sin(a) * 0.22, 0.02 + Math.cos(a) * 0.2, 0.2, Math.sin(a) * 0.6, Math.cos(a) * 0.6, 0.9); }   // the mane round the neck
    ellPart(0.2, 0.1, 0.42, furD, 0, -0.04, -0.2, jaw); bmBox(0.16, 0.03, 0.38, mouth, 0, 0.02, -0.2, jaw);   // the lower jaw and the inside of the mouth
    for (const [g, s] of [[aL, -1], [aR, 1]]) {
      ellPart(0.32, 0.32, 0.32, fur, 0, 0, 0, g);                                                      // the shoulder
      cylPart(0.13, 0.1, 0.5, fur, 0, -0.25, 0, g); ellPart(0.17, 0.17, 0.17, furD, 0, -0.5, 0, g);        // a long upper arm, the elbow
      cylPart(0.1, 0.07, 0.5, furG, 0, -0.78, -0.03, g);                                              // a long forearm
      ellPart(0.22, 0.18, 0.3, furD, 0, -1.02, -0.08, g);                                              // the paw
      for (const x of [-0.07, 0, 0.07]) bmSpike(g, claw, 0.035, 0.22, x, -1.12, -0.24, 0, -0.4, -1);   // three long claws
      for (const y of [-0.5, -0.8]) bmSpike(g, furL, 0.05, 0.26, s * 0.1, y, 0.02, s, -1, 0.3);         // shaggy tufts on the arm
    }
    for (const l of [lL, lR]) {
      const th = cylPart(0.19, 0.14, 0.4, fur, 0, -0.153, -0.129, l); th.rotation.x = 0.7;             // the thigh angles forward to the knee...
      ellPart(0.2, 0.2, 0.22, furD, 0, -0.306, -0.26, l);
      const sh = cylPart(0.12, 0.07, 0.42, furG, 0, -0.474, -0.132, l); sh.rotation.x = -0.64;         // ...and the shin back to the heel: a digitigrade leg
      ellPart(0.2, 0.1, 0.44, furD, 0, -0.66, -0.12, l);                                               // a long foot
      for (const x of [-0.06, 0.06]) bmSpike(l, claw, 0.03, 0.16, x, -0.67, -0.38, 0, -0.2, -1);
      bmSpike(l, furL, 0.07, 0.3, 0, -0.1, 0.1, 0, 0.3, 1); bmSpike(l, furL, 0.06, 0.22, 0, -0.5, 0.05, 0, -0.3, 1);   // tufts on the haunch and the heel
    }
    ellPart(0.24, 0.24, 0.55, fur, 0, 0, 0.22, tail); ellPart(0.3, 0.3, 0.5, furG, 0, -0.08, 0.62, tail); ellPart(0.22, 0.22, 0.42, furL, 0, -0.2, 0.98, tail);   // a bushy tail
    for (const [y, z] of [[0.12, 0.35], [0.1, 0.7], [-0.05, 1.05]]) bmSpike(tail, furL, 0.07, 0.3, 0, y, z, 0, 1, 0.6);
    e.bd = { groups: [body, head, jaw, aL, aR, lL, lR, tail], skip: new Set([body, head, jaw, aL, aR, lL, lR, tail]), g: { body, head, jaw, aL, aR, lL, lR, tail } };
    e.bp = [-0.55, 0, 0.5, 0.5, 0.05, 0, 0, 0, 0.15];
  },
  pose(e, dt) {
    const g = e.bd.g, p = e.bp, t = performance.now() * 0.001 + e.seed % 7, sw = Math.sin(e.walkT), id = e.mv ? e.mv.id : '', bs = e.bs;
    bmPhase(e);
    const sn = Math.sin(t * 1.5);
    let snap = false;
    if (e.dormant) wwPut(-0.95, 0.1, 0.25, 0.25, 0, -0.5, 0.32, 0.5, 0.25);                            // asleep: curled low, the head on its paws
    else wwPut(-0.55 + 0.03 * sn, 0.05 * sn, 0.5 + 0.6 * sw, 0.5 - 0.6 * sw, 0.08 + 0.05 * sn, 0.05 * sn, 0.04 * Math.abs(sw), 0.4 * Math.sin(t * 2.2), 0.15);   // idle: a loping gait, panting
    if (e.stun > 0) wwPut(-0.1, 0, -0.5, -0.5, 0.7, 0.4, 0, 0.3, 0.6);                                 // reeling back
    else if (bs.st === 'special' && (id === 'pounce' || id === 'pounce2')) wwPut(-0.95, 0, 2.3, 2.3, 0.9, -0.2, 0, 0.1, 0.2);   // in the air: stretched out, claws reaching
    else if (bs.st === 'phase') wwPut(-0.2, 0, 0.7, 0.7, 0.8, 0.95, 0, 0.6, 1.1);                      // the moon rage: it throws its head back and howls
    else if (BM_PH) {
      const k = BM_K, T = WW_T, a = BM_PH === 1 ? 0 : 1;
      if (id === 'rake' || id === 'rake2') {                                                           // one arm up and back, then the claws raked down and across
        const R = id === 'rake', hi = R ? 2 : 3, lo = R ? 3 : 2, tw = R ? 1 : -1;
        if (a === 0) { wwPut(bmLerp(T[0], -0.4, k), -0.5 * tw * k, 0.5, 0.5, 0.2, 0, 0, 0.3, 0.2); WW_T[hi] = bmLerp(T[hi], 2.5, k); WW_T[lo] = 0.5; }
        else { wwPut(bmLerp(-0.4, -0.85, k), bmLerp(-0.5 * tw, 0.5 * tw, k), 0.5, 0.5, 0.3, 0, 0.05, 0.3, 0.2); WW_T[hi] = bmLerp(2.5, 0.0, k); WW_T[lo] = 0.5; snap = true; }
      } else if (id === 'bite') {                                                                      // rears back, jaws wide, then lunges and snaps
        if (a === 0) wwPut(bmLerp(T[0], -0.3, k), 0, bmLerp(T[2], 0.9, k), bmLerp(T[3], 0.9, k), bmLerp(T[4], 1.0, k), bmLerp(T[5], 0.55, k), 0, 0.3, 0.3);
        else { wwPut(bmLerp(-0.3, -0.95, k), 0, 1.0, 1.0, bmLerp(1.0, 0.0, k), bmLerp(0.55, -0.3, k), 0.05, 0.3, 0.3); snap = true; }
      } else if (id === 'pounce' || id === 'pounce2') {                                                // the crouch: low to the ground, coiled, the arms back
        wwPut(bmLerp(T[0], -0.85, k), 0, bmLerp(T[2], 0.1, k), bmLerp(T[3], 0.1, k), 0.35, bmLerp(T[5], -0.15, k), bmLerp(T[6], 0.3, k), bmLerp(T[7], 0.1, k), 0.3);
        if (a === 1) snap = true;
      } else {                                                                                         // the howl: the head thrown back, jaws wide, the chest out
        wwPut(bmLerp(T[0], -0.2, k), 0, bmLerp(T[2], 0.8, k), bmLerp(T[3], 0.8, k), bmLerp(T[4], 0.8, k), bmLerp(T[5], 0.95, k), 0, 0.6, bmLerp(T[8], 1.0, k));
        if (a === 1) snap = true;
      }
    }
    const k = snap ? 1 : 1 - Math.exp(-12 * dt), T = WW_T;
    for (let i = 0; i < 9; i++) p[i] += (T[i] - p[i]) * k;
    const d = p[6], ls = (0.7 - d) / 0.7;
    g.body.rotation.x = p[0]; g.body.rotation.y = p[1]; g.body.position.y = 0.7 - d;
    g.aR.rotation.x = p[2] - p[0]; g.aL.rotation.x = p[3] - p[0]; g.aR.rotation.z = -p[8] * 0.5; g.aL.rotation.z = p[8] * 0.5;
    g.head.rotation.x = p[5] - p[0] * 0.6; g.jaw.rotation.x = p[4];
    g.tail.rotation.y = p[7]; g.tail.rotation.x = 0.5 + p[0] * 0.5;
    const lw = 0.55 * (1 - d * 2); g.lL.rotation.x = sw * lw; g.lR.rotation.x = -sw * lw; g.lL.position.y = g.lR.position.y = 0.7 - d; g.lL.scale.y = g.lR.scale.y = ls;
  },
};

// ---- Cinder Wyrm: a dragon of charcoal and ember (the final boss): a long neck, a horned head with a hinged jaw, bat wings with finger bones and a membrane, a spiked tail, four legs.
// All groups sit in `rig` (the whole dragon pitches and banks; its shadow, tag and icon stay on `m`). Channels (eased, e.bp): 0 pitch (+ = nose up), 1 bank, 2 dip, 3 neck (+ = head back), 4 neck yaw, 5 head (+ = snout up),
// 6 jaw open, 7 wing flap amplitude, 8 wing centre (+ = tips up), 9 wing sweep back, 10 wing fold, 11 tail yaw, 12 tail pitch, 13 leg tuck (+ = tucked up and back, - = reaching forward), 14 front-right claw raise, 15 its sweep,
// then (not eased) 16 the flap clock and 17 the last walk clock. ----
const DG_LAND = [0.03, 0, 0, 0.04, 0, 0, 0.04, 0, 0.9, 0.55, 1, 0, 0, 0, 0, 0];
const DG_AIR = [-0.04, 0, 0, -0.2, 0, 0.05, 0.05, 0.55, 0.12, 0.1, 0, 0, 0, 1, 0, 0];
const DG_SLEEP = [-0.06, 0, 0.3, -1.25, 0.3, -0.3, 0, 0, 0.9, 0.55, 1, 0.9, 0.2, 0, 0, 0];
const DG_T = new Float32Array(16);
// A tapered bone from (x0, y0, z0) to (x1, y1, z1): r0 wide at the start, r1 at the end.
const bmLimb = (parent, mat, r0, r1, x0, y0, z0, x1, y1, z1) => {
  const dx = x1 - x0, dy = y1 - y0, dz = z1 - z0, len = Math.hypot(dx, dy, dz) || 1e-3, q = (r1 / r0).toFixed(2);
  const p = new THREE.Mesh(cachedGeo('limb' + q, () => new THREE.CylinderGeometry(+q, 1, 1, 6)), mat);
  p.scale.set(r0, len, r0); p.position.set((x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2); p.quaternion.setFromUnitVectors(BM_UP, BM_DIR.set(dx, dy, dz).normalize()); parent.add(p); return p;
};
// Wing points (right wing, from the shoulder: x out, y up, z back): shoulder, elbow, wrist, four finger tips and the root of the trailing edge on the hip.
const DG_W = { S: [0, 0, 0], EL: [0.9, 0.25, -0.28], W: [1.7, 0.4, -0.5], F1: [3.4, 0.2, -0.15], F2: [3.15, 0.1, 0.85], F3: [2.45, 0.05, 1.7], F4: [1.5, 0.05, 2.15], R: [0.4, -0.1, 1.55] };
// A membrane panel (triangles of named points, mirrored for the left wing; 'F1~F2' is the notch between two finger tips, pulled in toward the wrist), drawn from both sides so it stays an ordinary front-faced mesh that bakes with the rest.
const dgPanel = (key, s, tris) => cachedGeo(key + s, () => {
  const v = [], P = DG_W, pt = n => { if (P[n]) return P[n]; const [a, b] = n.split('~'), A = P[a], B = P[b]; return [0, 1, 2].map(i => { const c = (A[i] + B[i]) / 2; return c + (P.W[i] - c) * 0.22; }); };
  for (const t of tris) { const a = pt(t[0]), b = pt(t[1]), c = pt(t[2]); for (const q of [[a, b, c], [a, c, b]]) for (const r of q) v.push(r[0] * s, r[1], r[2]); }
  const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(v, 3)); return g;
});
BOSS_MODELS.dragon = {
  tagY: 3.5, iconY: 3.1, shadow: 2.0, flyShadow: true, glow: 0x1a0c06,
  build(e, m, lam) {
    const ch = lam(0x3c3336), chL = lam(0x62504f), chD = lam(0x241d20), red = lam(0xb02e1c), ember = lam(0xf07a24), horn = lam(0xd8c4a0), claw = lam(0xeee2c8), tooth = lam(0xf6eed8), mem = lam(0xb82a22), memD = lam(0x7a1a18), mouthIn = lam(0x7a1818);
    const eye = bmGlow(0xffb020), hot = bmGlow(0xff6a10), throat = bmGlow(0xff8a20);
    const rig = bmGroup(m, 0, 0, 0), body = bmGroup(rig, 0, 1.1, 0.05), neck = bmGroup(rig, 0, 1.25, -1.0), head = bmGroup(neck, 0, 1.55, -0.9), jaw = bmGroup(head, 0, -0.17, -0.15);
    head.scale.setScalar(1.3);                                                                              // a big head on that neck
    const wL = bmGroup(rig, -0.5, 1.7, -0.55), wR = bmGroup(rig, 0.5, 1.7, -0.55), tail = bmGroup(rig, 0, 1.05, 1.1);
    const lFL = bmGroup(rig, -0.62, 0.95, -0.75), lFR = bmGroup(rig, 0.62, 0.95, -0.75), lBL = bmGroup(rig, -0.62, 0.95, 0.85), lBR = bmGroup(rig, 0.62, 0.95, 0.85);
    // body: deep chest, hips, shoulders, an ember belly, a ridge of spikes and glowing cracks down the back
    ellPart(1.15, 1.0, 2.1, ch, 0, 0, 0, body); ellPart(1.2, 1.1, 1.1, ch, 0, 0.05, -0.62, body); ellPart(1.0, 0.9, 1.0, ch, 0, -0.02, 0.72, body);
    for (const s of [-1, 1]) { ellPart(0.55, 0.55, 0.8, chL, s * 0.5, 0.28, -0.55, body); ellPart(0.5, 0.5, 0.7, chL, s * 0.46, 0.2, 0.75, body); }
    ellPart(0.8, 0.5, 2.0, ember, 0, -0.34, -0.05, body); ellPart(0.55, 0.45, 0.25, hot, 0, -0.08, -1.12, body);
    for (let i = 0; i < 8; i++) bmSpike(body, i % 2 ? red : chL, 0.1, 0.45 - Math.abs(i - 3) * 0.04, 0, 0.62, -0.9 + i * 0.28, 0, 1, 0.45);
    for (const [x, z, r] of [[0.22, -0.25, 0.3], [-0.25, 0.1, -0.3], [0.2, 0.5, 0.2], [-0.2, -0.7, -0.2], [0.05, 0.85, 0]]) bmBox(0.05, 0.025, 0.36, hot, x, 0.47 - Math.abs(x) * 0.5, z, body, 0, r, 0);
    // neck: four swelling segments rising and leaning forward, ember plates down the front, spikes down the back
    const NK = [[0, 0, 0, 0.4], [0, 0.42, -0.3, 0.34], [0, 0.88, -0.52, 0.29], [0, 1.3, -0.72, 0.25]];
    NK.forEach(([x, y, z, r], i) => {
      ellPart(r * 2, r * 2, r * 2.3, ch, x, y, z, neck);
      if (i) { const q = NK[i - 1]; bmLimb(neck, ch, q[3] * 0.95, r * 0.95, q[0], q[1], q[2], x, y, z); }
      ellPart(r * 1.1, r * 1.5, r * 0.8, ember, x, y - 0.05, z - r * 0.75, neck);
      bmSpike(neck, i % 2 ? chL : red, 0.07, 0.3, x, y + r * 0.85, z + r * 0.55, 0, 1, 0.8);
    });
    // head: skull and long snout, brow ridges, burning eyes and nostrils, swept-back horns, cheek spikes, teeth and a glowing throat
    ellPart(0.5, 0.42, 0.72, ch, 0, 0, 0, head); ellPart(0.36, 0.26, 0.62, chL, 0, -0.08, -0.58, head); ellPart(0.4, 0.2, 0.3, chL, 0, -0.02, -0.82, head);
    for (const s of [-1, 1]) {
      bmBox(0.2, 0.07, 0.3, chD, s * 0.15, 0.17, -0.2, head, 0, 0, -s * 0.3); bmBox(0.1, 0.06, 0.13, eye, s * 0.2, 0.09, -0.24, head, 0, 0, -s * 0.2); bmBox(0.05, 0.04, 0.05, hot, s * 0.09, -0.02, -0.97, head);
      bmSpike(head, horn, 0.12, 0.95, s * 0.2, 0.34, 0.5, s * 0.35, 0.55, 1.0); bmSpike(head, horn, 0.08, 0.5, s * 0.3, 0.12, 0.2, s, 0.15, 0.7);
      bmSpike(head, horn, 0.07, 0.35, s * 0.27, -0.12, -0.05, s, -0.3, 0.3); bmSpike(head, horn, 0.06, 0.3, s * 0.16, 0.24, -0.35, s * 0.3, 1, -0.2);
      for (let k = 0; k < 4; k++) bmSpike(head, tooth, 0.035, 0.16, s * 0.14, -0.24, -0.3 - k * 0.16, 0, -1, 0);
      for (let k = 0; k < 3; k++) bmSpike(jaw, tooth, 0.03, 0.13, s * 0.1, 0.09, -0.18 - k * 0.17, 0, 1, 0);
    }
    bmBox(0.26, 0.02, 0.62, mouthIn, 0, -0.2, -0.52, head); bmBox(0.18, 0.02, 0.45, throat, 0, -0.19, -0.5, head); bmBox(0.16, 0.12, 0.04, throat, 0, -0.12, -0.2, head);
    ellPart(0.34, 0.14, 0.7, chL, 0, -0.02, -0.38, jaw); bmBox(0.26, 0.02, 0.6, mouthIn, 0, 0.04, -0.38, jaw); bmSpike(jaw, horn, 0.06, 0.22, 0, -0.08, -0.72, 0, -0.5, -1);
    // wings: shoulder joint, arm, four fingers with a claw at the wrist, a dark inner and a lighter outer membrane
    const W = DG_W;
    for (const [g, s] of [[wL, -1], [wR, 1]]) {
      ellPart(0.42, 0.4, 0.5, chL, 0, 0, 0, g);
      bmLimb(g, ch, 0.13, 0.1, 0, 0, 0, s * W.EL[0], W.EL[1], W.EL[2]); bmLimb(g, ch, 0.1, 0.08, s * W.EL[0], W.EL[1], W.EL[2], s * W.W[0], W.W[1], W.W[2]);
      for (const f of ['F1', 'F2', 'F3', 'F4']) bmLimb(g, chL, 0.07, 0.03, s * W.W[0], W.W[1], W.W[2], s * W[f][0], W[f][1], W[f][2]);
      bmSpike(g, claw, 0.07, 0.38, s * W.W[0], W.W[1] + 0.1, W.W[2] - 0.15, s * 0.2, 0.8, -1);
      g.add(new THREE.Mesh(dgPanel('wi', s, [['S', 'W', 'R'], ['W', 'F4', 'R']]), memD));
      g.add(new THREE.Mesh(dgPanel('wo', s, [['W', 'F1', 'F1~F2'], ['W', 'F1~F2', 'F2'], ['W', 'F2', 'F2~F3'], ['W', 'F2~F3', 'F3'], ['W', 'F3', 'F3~F4'], ['W', 'F3~F4', 'F4']]), mem));
    }
    // legs (four groups, they swing): thigh, shin, a big foot and three claws
    for (const [g, big] of [[lFL, 0.9], [lFR, 0.9], [lBL, 1.1], [lBR, 1.1]]) {
      ellPart(0.34 * big, 0.65, 0.42 * big, ch, 0, -0.22, 0, g); bmLimb(g, chL, 0.14 * big, 0.09, 0, -0.5, 0, 0, -0.85, -0.12);
      ellPart(0.3, 0.15, 0.5, chD, 0, -0.93, -0.12, g);
      for (const x of [-0.09, 0, 0.09]) bmSpike(g, claw, 0.04, 0.24, x, -0.97, -0.4, 0, -0.3, -1);
    }
    // tail: six tapering segments with spikes, ending in a horned spade
    const TL = [[0, 0.15, 0.36], [-0.03, 0.75, 0.29], [-0.1, 1.35, 0.23], [-0.14, 1.95, 0.18], [-0.1, 2.5, 0.13], [-0.02, 3.0, 0.09]];
    TL.forEach(([y, z, r], i) => { ellPart(r * 2, r * 1.9, r * 2.2 + 0.2, ch, 0, y, z, tail); bmSpike(tail, i % 2 ? chL : red, r * 0.5, r * 1.8, 0, y + r * 0.9, z, 0, 1, 0.5); });
    bmSpike(tail, horn, 0.2, 0.7, 0, -0.02, 3.35, 0, 0, 1); for (const s of [-1, 1]) bmSpike(tail, horn, 0.1, 0.5, s * 0.22, -0.02, 3.05, s, 0, 0.5);
    const all = [body, neck, head, jaw, wL, wR, tail, lFL, lFR, lBL, lBR];
    e.bd = { groups: all, skip: new Set(all), g: { rig, body, neck, head, jaw, wL, wR, tail, lFL, lFR, lBL, lBR } };
    e.bp = Array.from(DG_SLEEP).concat([0, 0]);
  },
  pose(e, dt) {
    const g = e.bd.g, p = e.bp, T = DG_T, t = performance.now() * 0.001 + e.seed % 7, bs = e.bs, id = e.mv ? e.mv.id : '', air = bs.air && !e.dormant, sn = Math.sin(t * 1.2);
    bmPhase(e);
    let snap = false, rate = 0;
    if (e.dormant) { T.set(DG_SLEEP); T[0] += 0.01 * sn; T[3] += 0.02 * sn; }                               // asleep on the dais: the head on the floor, wings folded, the tail curled
    else if (air) { T.set(DG_AIR); T[1] = -bs.cw * 0.2; T[3] += 0.05 * sn; T[11] = 0.2 * Math.sin(t * 1.4); rate = 1.7; }   // flying: banking into the turn, wings beating
    else { T.set(DG_LAND); T[3] += 0.06 * sn; T[11] = 0.1 * Math.sin(t * 0.9); T[6] += 0.03 * sn; }          // standing: wings folded, tail swaying, the jaw working
    if (e.stun > 0 || bs.st === 'stagger') { T[0] = 0.2; T[3] = 0.9; T[5] = 0.5; T[6] = 0.9; T[10] = 0.4; }   // reeling: the head thrown back
    else if (bs.st === 'phase') { T[0] = 0.2; T[3] = 0.75; T[5] = 0.5; T[6] = 1.2; T[7] = 0.5; T[8] = 0.3; T[9] = 0.1; T[10] = 0; rate = 2; }   // the roar
    else if (bs.st === 'sweep') { T[3] = -0.5; T[5] = -0.15; T[6] = 1.0; T[0] = -0.08; }                  // fire sweep: the head low and forward, jaws wide
    else if (bs.st === 'special' && id === 'strafe') { T[0] = -0.5; T[3] = -0.45; T[5] = -0.2; T[6] = 0.3; T[7] = 0.05; T[8] = 0; T[9] = 0.9; T[10] = 0.4; T[13] = -0.7; rate = 0; }   // the dive: swept back, claws reaching
    else if (BM_PH) {
      const k = BM_K, a = BM_PH === 1 ? 0 : 1;
      if (id === 'bite') {                                                                                   // rears back, jaws wide, then the head drops and snaps shut
        if (a === 0) { T[3] = bmLerp(T[3], 0.55, k); T[5] = 0.3 * k; T[6] = k; T[2] = 0.08 * k; } else { T[3] = bmLerp(0.55, -0.85, k); T[5] = -0.25; T[6] = bmLerp(1, 0, k); snap = true; }
      } else if (id === 'claw') {                                                                            // the front claw cocked up and out, then raked across
        if (a === 0) { T[0] = 0.22 * k; T[14] = 1.5 * k; T[15] = -0.6 * k; T[3] = 0.2 * k; T[4] = 0.3 * k; } else { T[0] = bmLerp(0.22, -0.05, k); T[14] = bmLerp(1.5, 0.3, k); T[15] = bmLerp(-0.6, 1.0, k); T[4] = bmLerp(0.3, -0.5, k); snap = true; }
      } else if (id === 'tail') {                                                                            // the tail cocked to one side, then whipped round
        if (a === 0) { T[11] = 1.2 * k; T[4] = -0.3 * k; T[1] = 0.1 * k; T[10] = 0.6; } else { T[11] = bmLerp(1.2, -1.4, k); T[4] = 0.4; snap = true; }
      } else if (id === 'breath') {                                                                          // the chest swells, the head back and up, then the fire pours out
        if (a === 0) { T[3] = bmLerp(T[3], 0.7, k); T[5] = 0.45 * k; T[6] = 1.1 * k; T[0] = 0.12 * k; } else { T[3] = bmLerp(0.7, -0.2, k); T[5] = bmLerp(0.45, -0.1, k); T[6] = 1.2; snap = true; }
      } else if (id === 'buffet') {                                                                          // crouches and beats the wings open
        rate = 2.6; if (a === 0) { T[2] = 0.3 * k; T[10] = bmLerp(1, 0, k); T[7] = 0.5 * k; T[8] = bmLerp(0.9, 0.5, k); T[9] = bmLerp(0.55, 0.1, k); } else { T[2] = -0.1; T[10] = 0; T[7] = 0.6; T[8] = -0.1; T[9] = 0.1; snap = true; }
      } else if (id === 'strafe') {                                                                          // rears back and tilts down, wings swept for the dive
        T[0] = -0.3 * k; T[3] = bmLerp(T[3], -0.2, k); T[6] = 0.5 * k; T[9] = bmLerp(T[9], 0.35, k); T[7] = 0.15; T[13] = bmLerp(T[13], -0.5, k); rate = 1.2;
      } else if (id === 'volley') {                                                                          // the head back with a fireball in the throat, then thrown forward
        if (a === 0) { T[3] = bmLerp(T[3], 0.55, k); T[5] = 0.35 * k; T[6] = 0.8 * k; } else { T[3] = bmLerp(0.55, -0.4, k); T[5] = -0.1; T[6] = bmLerp(0.8, 0.2, k); snap = true; }
      } else if (id === 'sweep') {                                                                           // draws a breath, the head dropping to aim
        T[3] = bmLerp(T[3], -0.5, k); T[5] = -0.15 * k; T[6] = 0.9 * k;
      } else if (id === 'land') {                                                                            // gliding in: nose up, legs reaching, wings flared and beating hard
        T[0] = 0.35 * k; T[13] = bmLerp(T[13], -0.6, k); T[3] = bmLerp(T[3], 0.3, k); T[7] = bmLerp(0.55, 0.85, k); T[8] = bmLerp(0.12, 0.05, k); rate = bmLerp(1.7, 2.6, k);
      }
    }
    const k = snap ? 1 : 1 - Math.exp(-12 * dt);
    for (let i = 0; i < 16; i++) p[i] += (T[i] - p[i]) * k;
    p[16] += dt * rate * 6.2832;
    const fl = p[8] + p[7] * Math.sin(p[16]), bob = air || id === 'buffet' ? 0.1 * Math.sin(p[16] + 1.3) : 0;
    g.rig.rotation.x = p[0]; g.rig.rotation.z = p[1]; g.rig.position.y = bob - p[2];
    g.neck.rotation.x = p[3]; g.neck.rotation.y = p[4]; g.head.rotation.x = p[5] - p[3] * 0.5; g.jaw.rotation.x = -p[6];
    g.wR.rotation.z = fl; g.wL.rotation.z = -fl; g.wR.rotation.y = -p[9]; g.wL.rotation.y = p[9];
    const fs = 1 - 0.6 * p[10], fz = 1 - 0.5 * p[10]; g.wR.scale.set(fs, 1, fz); g.wL.scale.set(fs, 1, fz);
    g.tail.rotation.y = p[11]; g.tail.rotation.x = p[12];
    const walk = Math.min(1, Math.abs(e.walkT - p[17]) / Math.max(dt, 1e-3) / 12) * (1 - Math.max(0, Math.min(1, p[13]))), sw = Math.sin(e.walkT * 0.28) * 0.45 * walk, lx = -0.9 * p[13]; p[17] = e.walkT;   // a gait only while it moves; tucked legs go back, reaching ones forward
    g.lFL.rotation.x = sw + lx; g.lBR.rotation.x = sw + lx; g.lFR.rotation.x = -sw + lx + p[14]; g.lBL.rotation.x = -sw + lx; g.lFR.rotation.y = p[15];
    const ls = 1 - 0.25 * Math.max(0, p[13]); g.lFL.scale.y = g.lFR.scale.y = g.lBL.scale.y = g.lBR.scale.y = ls;
  },
};
