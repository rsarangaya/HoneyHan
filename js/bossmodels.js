// Boss models (BOSS2 to BOSS5 fill this in): BOSS_MODELS[id] = { build(e, m, lam), pose(e, dt), tagY, iconY, shadow } for the non-biped bosses.
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
