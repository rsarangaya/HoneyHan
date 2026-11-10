// Procedural models for lootable props, furniture and locked doors (stand-ins until real art).
// Local frame: the model's +z faces into the room and its back is at -z, so objects on a room's
// edge tile are pushed toward the wall and face the interior.
const PROP_R = { chest: 0.6, barrel: 0.45, rubble: 0.5, rack: 0.7, potions: 0.7, pantry: 0.7, vaultchest: 0.65 };
const DECOR_R = { bed: 0.85, bookshelf: 0.8, weaponrack: 0.55, barrels: 0.8, crates: 0.8, table: 0.9, hearth: 0.9, cauldron: 0.75,
  sacks: 0.45, altar: 0.85, statue: 0.45, candles: 0.2, urn: 0.28, counter: 0.95, puddle: 0, grass: 0, glowcap: 0, bell: 0, ice: 0, rug: 0, bones: 0, banner: 0, chandelier: 0, beam: 0 };
// How far toward the wall each kind sits when it is on an edge tile (a tile is 3 m, so the wall is 1.5 m out).
const EDGE_SHIFT = { chest: 0.85, barrel: 0.8, rubble: 0.6, rack: 1.05, potions: 1.1, pantry: 1.1, vaultchest: 0.85,
  bed: 0.85, bookshelf: 1.2, weaponrack: 1.3, barrels: 0.7, crates: 0.6, hearth: 1.05, cauldron: 0.6, sacks: 0.8, statue: 0.8, banner: 1.46, candles: 0.9, urn: 1.0 };
// Decor that glows: the light pool borrows these.
const DECOR_LIGHT = { hearth: { color: 0xff8a30, y: 0.9, str: 1.15 }, cauldron: { color: 0x50ff80, y: 1.0, str: 0.8 },
  candles: { color: 0xffcc70, y: 0.5, str: 0.45 }, altar: { color: 0xffd070, y: 1.3, str: 0.6 },
  chandelier: { color: 0xffc060, y: 2.4, str: 1.0 } };   // main.js uses the decor's own ly / ls for scaled (boss arena) ones

const lam = (c, emissive) => new THREE.MeshLambertMaterial(emissive === undefined ? { color: c } : { color: c, emissive });
const glow = c => new THREE.MeshBasicMaterial({ color: c });
const FLAME_MAT = new THREE.MeshBasicMaterial({ color: 0xffb040 });
function B(parent, w, h, d, mat, x, y, z, ry = 0, rz = 0) {
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
  m.position.set(x, y, z); m.rotation.y = ry; m.rotation.z = rz; parent.add(m); return m;
}
function C(parent, rt, rb, h, mat, x, y, z, seg = 10) {
  const m = new THREE.Mesh(new THREE.CylinderGeometry(rt, rb, h, seg), mat);
  m.position.set(x, y, z); parent.add(m); return m;
}

// ---- rounded building blocks (everything used to be a plain box). Geometry is cached by shape, so a hundred barrels
// share one set of vertices, and the whole floor's furniture is merged into a few meshes afterwards (js/perf.js). ----
const GEO = {};
const cached = (key, make) => GEO[key] || (GEO[key] = make());
// A box with softly rounded edges (a bevelled extrusion).
function RB(parent, w, h, d, mat, x, y, z, ry = 0, rz = 0) {
  const b = Math.min(0.04, w / 5, h / 5, d / 5);
  const g = cached(`rb${w}|${h}|${d}`, () => {
    const hw = w / 2 - b, hh = h / 2 - b, sh = new THREE.Shape();
    sh.moveTo(-hw, -hh); sh.lineTo(hw, -hh); sh.lineTo(hw, hh); sh.lineTo(-hw, hh); sh.closePath();
    const ge = new THREE.ExtrudeGeometry(sh, { depth: Math.max(0.002, d - 2 * b), bevelEnabled: true, bevelThickness: b, bevelSize: b, bevelSegments: 1, curveSegments: 1 });
    ge.translate(0, 0, -(d - 2 * b) / 2); return ge;
  });
  const m = new THREE.Mesh(g, mat); m.position.set(x, y, z); m.rotation.y = ry; m.rotation.z = rz; parent.add(m); return m;
}
// A lathe: spin a profile [[radius, height], ...] round the y axis (barrels, urns, pots, plinths).
function LA(parent, pts, mat, x, y, z, seg = 14) {
  const g = cached(`la${seg}${JSON.stringify(pts)}`, () => new THREE.LatheGeometry(pts.map(([r, h]) => new THREE.Vector2(r, h)), seg));
  const m = new THREE.Mesh(g, mat); m.position.set(x, y, z); parent.add(m); return m;
}
// An ellipsoid (sacks, pillows, heads, loaves).
function SP(parent, w, h, d, mat, x, y, z, ry = 0) {
  const g = cached('sp', () => new THREE.SphereGeometry(0.5, 12, 8));
  const m = new THREE.Mesh(g, mat); m.scale.set(w, h, d); m.position.set(x, y, z); m.rotation.y = ry; parent.add(m); return m;
}
// A torus lying flat (hoops, rims, rings).
function TR(parent, R, r, mat, x, y, z) {
  const g = cached(`tr${R}|${r}`, () => new THREE.TorusGeometry(R, r, 5, 18));
  const m = new THREE.Mesh(g, mat); m.rotation.x = Math.PI / 2; m.position.set(x, y, z); parent.add(m); return m;
}
const BOOK_COLORS = [0x6a2a2a, 0x2a4a6a, 0x3a6a3a, 0x6a5a2a, 0x5a2a6a, 0x4a3a2a, 0x7a4a2a, 0x2a5a5a];
const BARREL = [[0.0, 0], [0.3, 0], [0.35, 0.12], [0.4, 0.4], [0.4, 0.55], [0.35, 0.83], [0.3, 0.95], [0.0, 0.95]];   // a bulged barrel

// Wraps a model in a group placed on its tile, turned to face the room and shifted toward the wall if it is on an edge.
function placeOnTile(inner, tx, ty, yaw, shift) {
  const mesh = new THREE.Group();
  const x0 = (tx + 0.5) * TILE, z0 = (ty + 0.5) * TILE;
  inner.position.z = -shift;
  mesh.add(inner);
  mesh.position.set(x0, 0, z0); mesh.rotation.y = yaw;
  return { mesh, x: x0 - Math.sin(yaw) * shift, z: z0 - Math.cos(yaw) * shift };
}

const CHEST_LOOK = [
  { body: 0x6a4422, lid: 0x7a4e28, trim: 0x4a3018 },                                    // wooden
  { body: 0x5a4030, lid: 0x6a4a34, trim: 0x3a3d44 },                                    // iron-bound
  { body: 0x2a3a5c, lid: 0x34486e, trim: 0xc8d0e0 },                                    // silver
  { body: 0x4a2a6a, lid: 0x5a3480, trim: 0xe0b040, gem: 0xff4a8a },                     // ornate: purple and gold
  { body: 0xc89a28, lid: 0xd8aa38, trim: 0xfff0a0, gem: 0xffffff, glow: 0x806010 },     // golden, glowing
];

// ---- lootable props ----
function makeProp(p) {
  const inner = new THREE.Group();
  const o = { p, mesh: null, x: 0, z: 0, r: PROP_R[p.kind], lid: null, mats: [] };
  const mat = (c, em) => { const m = lam(c, em); o.mats.push(m); return m; };
  const rg = makeRng(p.seed);
  const wood = new THREE.Color(theme.wall).multiplyScalar(0.8).getHex();
  if (p.kind === 'chest' || p.kind === 'vaultchest') {
    // five grades (js/loot.js CHEST_NAMES): plain wood, iron bands, silver trim, purple and gold, a glowing golden hoard
    const vault = p.kind === 'vaultchest', t = vault ? 2 : p.tier | 0, L = vault ? { body: 0x3a3a4a, lid: 0x4a4a5c, trim: 0xc9a23a } : CHEST_LOOK[t], s = vault ? 1.18 : 1;
    const bodyM = mat(L.body), lidM = mat(L.lid), trim = new THREE.MeshLambertMaterial({ color: L.trim, emissive: L.glow || 0x2a2008 }); o.mats.push(trim);
    RB(inner, 1.0 * s, 0.5 * s, 0.65 * s, bodyM, 0, 0.25 * s, 0);
    for (const x of [-0.3, 0.3]) RB(inner, (t === 1 ? 0.16 : 0.1) * s, 0.53 * s, 0.69 * s, trim, x * s, 0.26 * s, 0);          // bands round the body
    const pivot = new THREE.Group(); pivot.position.set(0, 0.5 * s, -0.325 * s);                                              // the lid hinges on the back edge
    const lid = new THREE.Mesh(cached('chestlid', () => new THREE.CylinderGeometry(0.34, 0.34, 1.04, 16, 1, false, 0, Math.PI)), lidM);
    lid.rotation.z = Math.PI / 2; lid.scale.set(0.62 * s, 1 * s, 1 * s); lid.position.set(0, 0, 0.325 * s); pivot.add(lid);   // a half cylinder: a domed lid
    for (const x of [-0.3, 0.3]) { const band = new THREE.Mesh(cached('chestlidband', () => new THREE.CylinderGeometry(0.352, 0.352, 0.1, 16, 1, false, 0, Math.PI)), trim); band.rotation.z = Math.PI / 2; band.scale.set(0.62 * s, 1 * s, 1 * s); band.position.set(x * s, 0, 0.325 * s); pivot.add(band); }
    if (t >= 1) for (const x of [-0.4, -0.2, 0.2, 0.4]) SP(inner, 0.06, 0.06, 0.06, trim, x * s, 0.34 * s, 0.335 * s);        // studs along the front
    RB(inner, 0.14 * s, 0.17 * s, 0.05, trim, 0, 0.45 * s, 0.34 * s);                                                          // lock plate
    if (L.gem) SP(inner, 0.1, 0.1, 0.06, glow(L.gem), 0, 0.6 * s, 0.34 * s);                                                   // a gem on the lid
    if (t === 4) {                                                                                                              // a golden hoard glows
      const aura = new THREE.Mesh(new THREE.ConeGeometry(0.55, 1.3, 14, 1, true), new THREE.MeshBasicMaterial({ color: 0xffd060, transparent: true, opacity: 0.16, depthWrite: false, side: THREE.DoubleSide })); aura.position.y = 0.95; inner.add(aura);
      for (let i = 0; i < 6; i++) SP(inner, 0.07, 0.04, 0.07, trim, (rg() - 0.5) * 0.4, 0.52 * s, (rg() - 0.3) * 0.3);       // coins on the lid
    }
    if (p.holdsKey) SP(inner, 0.07, 0.07, 0.07, glow(0xffe060), 0, 0.5 * s + 0.14, 0.34 * s);                                  // a faint spark on the chest that holds a key
    inner.add(pivot); o.lid = pivot;
  } else if (p.kind === 'barrel') {
    LA(inner, BARREL, mat(wood), 0, 0, 0, 14);
    for (const [y, r] of [[0.2, 0.362], [0.74, 0.382]]) TR(inner, r, 0.022, lam(0x3a3a3a), 0, y, 0);                        // iron hoops
    C(inner, 0.3, 0.3, 0.02, mat(0x2a1a10), 0, 0.955, 0, 14);                                                              // lid
  } else if (p.kind === 'rack') {
    // armory: a weapon rack or an armor stand, chosen by seed
    const steel = mat(0xb8bcc4, 0x18181c);
    if (rg() < 0.5) {
      B(inner, 1.5, 0.08, 0.1, mat(wood), 0, 1.5, -0.2); B(inner, 1.5, 0.08, 0.1, mat(wood), 0, 0.55, -0.2);
      B(inner, 0.08, 1.6, 0.1, mat(wood), -0.75, 0.8, -0.2); B(inner, 0.08, 1.6, 0.1, mat(wood), 0.75, 0.8, -0.2);
      for (let i = 0; i < 4; i++) {
        const sx = -0.55 + i * 0.37, tall = i % 2;
        B(inner, 0.07, tall ? 1.25 : 0.95, 0.025, steel, sx, 0.95, -0.12, 0, (rg() - 0.5) * 0.12);
        B(inner, 0.2, 0.05, 0.05, mat(0xc9a23a), sx, tall ? 0.45 : 0.55, -0.12);
      }
    } else {
      C(inner, 0.05, 0.05, 1.6, mat(wood), 0, 0.8, -0.1, 6);
      SP(inner, 0.52, 0.62, 0.3, mat(0x6a6e78, 0x101014), 0, 1.2, -0.1);                            // a rounded breastplate
      SP(inner, 0.3, 0.14, 0.26, steel, -0.32, 1.45, -0.1); SP(inner, 0.3, 0.14, 0.26, steel, 0.32, 1.45, -0.1);   // pauldrons
      SP(inner, 0.32, 0.34, 0.32, steel, 0, 1.72, -0.1);                                            // helm
      LA(inner, [[0, 0.7], [0.3, 0.7], [0.24, 0.95], [0.0, 0.95]], mat(0x4a4e58), 0, 0, -0.1, 10);   // tassets
      B(inner, 0.6, 0.08, 0.6, mat(wood), 0, 0.04, -0.1);
    }
  } else if (p.kind === 'potions') {
    // brewery shelf crowded with bottles in every potion colour
    B(inner, 1.7, 1.7, 0.45, mat(wood), 0, 0.85, -0.15);
    const cols = Object.values(POTIONS).map(q => q.color);
    for (let row = 0; row < 3; row++) {
      B(inner, 1.6, 0.05, 0.5, mat(0x2a1c10), 0, 0.35 + row * 0.5, -0.1);
      for (let i = 0; i < 6; i++) {
        const c = new THREE.Color(cols[Math.floor(rg() * cols.length)]);
        const b = new THREE.MeshLambertMaterial({ color: c, emissive: c.clone().multiplyScalar(0.35) }); o.mats.push(b);
        C(inner, 0.065, 0.08, 0.2 + rg() * 0.08, b, -0.65 + i * 0.26, 0.48 + row * 0.5, 0.0, 8);
        C(inner, 0.025, 0.025, 0.07, mat(0x8a7a5a), -0.65 + i * 0.26, 0.62 + row * 0.5, 0.0, 6);
      }
    }
  } else if (p.kind === 'pantry') {
    // food shelf: bread, cheese, apples and hanging sausages
    B(inner, 1.7, 1.7, 0.45, mat(wood), 0, 0.85, -0.15);
    for (let row = 0; row < 3; row++) {
      B(inner, 1.6, 0.05, 0.5, mat(0x2a1c10), 0, 0.35 + row * 0.5, -0.1);
      for (let i = 0; i < 5; i++) {
        const pick = Math.floor(rg() * 4), x = -0.6 + i * 0.3, y = 0.46 + row * 0.5;
        if (pick === 0) SP(inner, 0.27, 0.14, 0.17, mat(0xc79a58), x, y, 0, (rg() - 0.5) * 0.4);                // loaf
        else if (pick === 1) { const ch = C(inner, 0.1, 0.1, 0.12, mat(0xf0d060), x, y, 0, 10); ch.rotation.y = (rg() - 0.5) * 0.4; }   // a round of cheese
        else if (pick === 2) { const a = new THREE.Mesh(new THREE.SphereGeometry(0.075, 6, 5), mat(0xc8493a)); a.position.set(x, y + 0.02, 0); inner.add(a); }   // apple
        else C(inner, 0.03, 0.03, 0.22, mat(0x8a4030), x, y + 0.05, 0.05, 6);                                    // sausage
      }
    }
  } else if (p.kind === 'rubble') {
    const g = new THREE.DodecahedronGeometry(0.5, 0);
    for (let i = 0; i < 4; i++) {
      const s = new THREE.Mesh(g, mat(0x77726a));
      s.position.set((i % 2 - 0.5) * 0.5, 0.2, (i >> 1) * 0.4 - 0.2);
      s.scale.set(0.8 - i * 0.08, 0.5 + (i % 2) * 0.2, 0.8);
      s.rotation.set(i, i * 2, 0); inner.add(s);
    }
  }
  const pl = placeOnTile(inner, p.x, p.y, p.yaw !== undefined ? p.yaw : (p.seed % 4) * Math.PI / 2, p.kind === 'rubble' ? 0.3 : EDGE_SHIFT[p.kind] || 0);
  o.mesh = pl.mesh; o.x = pl.x; o.z = pl.z;
  return o;
}

// ---- locked doors ----
function makeDoor(dr) {
  const inner = new THREE.Group();
  const rg = makeRng(dr.x * 131 + dr.y);
  const dh = WALL_H - 0.1;                                                                           // planks fill the doorway up to the ceiling
  for (let i = 0; i < 5; i++) {
    const c = new THREE.Color(0x5a3c20).multiplyScalar(0.85 + rg() * 0.3);
    B(inner, 0.6, dh, 0.3, lam(c.getHex()), -1.2 + i * 0.6, dh / 2, 0);
  }
  const iron = lam(0x2a2a30);
  for (const y of [0.5, 1.4, 2.3, dh - 0.3]) B(inner, 3.0, 0.14, 0.34, iron, 0, y, 0);
  B(inner, 0.4, 0.5, 0.12, lam(0xc9a23a, 0x2a2008), 0, 1.3, 0.2);                                  // lock plate
  B(inner, 0.07, 0.14, 0.1, lam(0x120c08), 0, 1.3, 0.28);                                           // keyhole
  const ring = new THREE.Mesh(new THREE.TorusGeometry(0.16, 0.03, 6, 12), iron); ring.position.set(0.9, 1.1, 0.2); inner.add(ring);
  const mesh = new THREE.Group();
  const x = (dr.x + 0.5) * TILE, z = (dr.y + 0.5) * TILE;
  mesh.add(inner); mesh.position.set(x, 0, z); mesh.rotation.y = dr.axis === 'x' ? Math.PI / 2 : 0;
  return { p: { kind: 'door', opened: false, x: dr.x, y: dr.y, lock: dr.lock, room: dr.room, keyLabel: dr.keyLabel }, mesh, x, z, r: 0, lid: null, mats: [] };
}

// ---- furniture and decals: lived-in details for the guards' home ----
function makeDecor(d) {
  const inner = new THREE.Group();
  const rg = makeRng(d.seed);
  const T = c => new THREE.Color(theme[c]);
  const wood = lam(T('wall').multiplyScalar(0.8).getHex());
  const wood2 = lam(T('floor').multiplyScalar(1.5).getHex());
  const stone = lam(0x75726c), dstone = lam(0x4a4844), iron = lam(0x2a2a30), straw = lam(0xb89a58), bone = lam(0xe6e0c8);
  const cloths = [0x8a2a2a, 0x2a3a7a, 0x2a6a4a, 0x7a5a1a, 0x5a2a6a];
  const cloth = () => lam(cloths[Math.floor(rg() * cloths.length)]);
  const flame = (parent, x, y, z, s = 1) => { const f = new THREE.Mesh(cached('flame', () => new THREE.ConeGeometry(0.04, 0.13, 6)), FLAME_MAT); f.position.set(x, y, z); f.scale.setScalar(s); parent.add(f); return f; };

  switch (d.kind) {
    case 'bed': {
      RB(inner, 2.0, 0.3, 1.1, wood, 0, 0.17, 0);                                                    // frame
      RB(inner, 1.88, 0.14, 0.98, straw, 0, 0.4, 0);                                                 // straw tick
      RB(inner, 1.2, 0.09, 1.02, cloth(), 0.35, 0.5, 0);                                             // blanket
      SP(inner, 0.52, 0.16, 0.72, lam(0xd8d0b8), -0.7, 0.58, 0);                                     // a plump pillow
      RB(inner, 0.1, 0.75, 1.12, wood, -1.0, 0.45, 0);                                               // headboard
      for (const z of [0.5, -0.5]) LA(inner, [[0.0, 0], [0.05, 0], [0.04, 0.3], [0.06, 0.5], [0.0, 0.5]], wood, 1.0, 0, z, 8);   // turned foot posts
      if (rg() < 0.5) SP(inner, 0.4, 0.15, 0.5, leatherMat(), 1.35, 0.08, 0.3);                       // boots left by the bed
    }
    case 'puddle': {                                               // a flat, glossy patch of shallow water
      const pm = new THREE.MeshBasicMaterial({ color: 0x3a6a9a, transparent: true, opacity: 0.55 });
      for (let i = 0; i < 3; i++) { const d = new THREE.Mesh(new THREE.CircleGeometry(0.5 + rg() * 0.5, 14), pm); d.rotation.x = -Math.PI / 2; d.position.set((rg() - 0.5) * 0.9, 0.012 + i * 0.001, (rg() - 0.5) * 0.9); inner.add(d); }
      break;
    }
    case 'grass': {                                                // a tuft of tall grass: crouch in it and you nearly vanish
      const gm = [lam(0x4a7a2a), lam(0x5a8a32), lam(0x3a6a22)];
      for (let i = 0; i < 26; i++) { const h = 0.7 + rg() * 0.6, b = B(inner, 0.05, h, 0.03, gm[i % 3], (rg() - 0.5) * 2.3, h / 2, (rg() - 0.5) * 2.3, rg() * 3, (rg() - 0.5) * 0.3); }
      break;
    }
    case 'glowcap': {                                              // glowing mushrooms: their light shows you up
      for (let i = 0; i < 5; i++) {
        const x = (rg() - 0.5) * 2, z = (rg() - 0.5) * 2, h = 0.25 + rg() * 0.35;
        C(inner, 0.04, 0.05, h, lam(0xd8d0f0), x, h / 2, z, 6);
        C(inner, 0.02, 0.2 + rg() * 0.1, 0.1, glow(0x6affc0), x, h + 0.04, z, 8);
      }
      break;
    }
    case 'bell': {                                                 // a tripwire with a little bell on it
      B(inner, 2.2, 0.012, 0.012, lam(0x777777), 0, 0.14, 0); B(inner, 0.05, 0.16, 0.05, lam(0x4a3a22), -1.1, 0.08, 0); B(inner, 0.05, 0.16, 0.05, lam(0x4a3a22), 1.1, 0.08, 0);
      C(inner, 0.02, 0.09, 0.14, lam(0xd8a030), 0, 0.07, 0, 10);
      break;
    }
    case 'ice': {                                                  // a slick of ice
      const im = new THREE.MeshBasicMaterial({ color: 0xbfe6ff, transparent: true, opacity: 0.6 });
      for (let i = 0; i < 3; i++) { const d = new THREE.Mesh(new THREE.CircleGeometry(0.6 + rg() * 0.6, 10), im); d.rotation.x = -Math.PI / 2; d.position.set((rg() - 0.5) * 1.2, 0.014 + i * 0.001, (rg() - 0.5) * 1.2); inner.add(d); }
      break;
    }
    case 'counter': {
      RB(inner, 2.0, 0.95, 0.75, wood, 0, 0.475, 0);
      RB(inner, 2.1, 0.08, 0.85, wood2, 0, 0.99, 0);
      RB(inner, 1.9, 0.05, 0.05, lam(0x2a1c10), 0, 0.2, 0.38);
      for (let i = 0; i < 4; i++) C(inner, 0.07, 0.07, 0.025 + i * 0.012, lam(0xe8c860), -0.7 + (i % 2) * 0.12, 1.05 + i * 0.01, 0.18 - (i >> 1) * 0.1, 10);    // coin stacks
      RB(inner, 0.5, 0.03, 0.05, iron, 0.25, 1.35, 0.1); C(inner, 0.012, 0.012, 0.3, iron, 0.25, 1.2, 0.1, 5);                                            // scales
      C(inner, 0.17, 0.17, 0.02, lam(0xb8bcc4), 0.02, 1.07, 0.12, 14); C(inner, 0.17, 0.17, 0.02, lam(0xb8bcc4), 0.5, 1.07, 0.12, 14);
      for (const x of [-0.1, 0.75]) RB(inner, 0.22, 0.2, 0.22, lam(0x6a4a2a), x, 1.13, -0.15);                                                             // goods crates
      flame(inner, -0.95, 1.2, -0.25); C(inner, 0.02, 0.02, 0.18, iron, -0.95, 1.1, -0.25, 6);
    }
    case 'bookshelf': {
      RB(inner, 1.8, 2.3, 0.45, wood, 0, 1.15, 0);
      for (let row = 0; row < 4; row++) {
        const y = 0.35 + row * 0.55;
        RB(inner, 1.7, 0.05, 0.42, wood2, 0, y, 0.02);
        for (let i = 0, x = -0.75; i < 8 && x < 0.8; i++) {
          const wd = 0.1 + rg() * 0.1;
          if (rg() < 0.12) { x += 0.2; continue; }                                                   // a gap
          const bc = BOOK_COLORS[Math.floor(rg() * BOOK_COLORS.length)];                              // a small palette, so the books share materials and merge
          RB(inner, wd, 0.36 + rg() * 0.08, 0.28, lam(bc), x + wd / 2, y + 0.22, 0.05, 0, rg() < 0.1 ? 0.3 : 0);
          x += wd + 0.02;
        }
      }
      LA(inner, [[0, 0], [0.07, 0], [0.05, 0.1], [0.09, 0.2], [0.0, 0.22]], lam(0xc9a23a, 0x2a2008), 0.6, 2.3, 0.05, 8);   // a vase on top
    }
    case 'weaponrack': {
      RB(inner, 1.4, 1.5, 0.08, wood, 0, 0.9, 0);
      RB(inner, 1.4, 0.07, 0.2, wood2, 0, 0.55, 0.1);
      for (let i = 0; i < 4; i++) RB(inner, 0.06, 0.9 + rg() * 0.5, 0.03, lam(0x9a9ea6), -0.5 + i * 0.33, 1.0, 0.12, 0, (rg() - 0.5) * 0.2);
      const sh = C(inner, 0.22, 0.22, 0.05, wood2, 0.45, 1.35, 0.12, 16); sh.rotation.x = Math.PI / 2;      // a round shield on the board
      SP(inner, 0.1, 0.1, 0.06, lam(0x9a9ea6), 0.45, 1.35, 0.17);                                       // its boss
    }
    case 'barrels': {
      const spots = [[-0.5, -0.2], [0.35, -0.3], [0.0, 0.35]];
      for (const [x, z] of spots) {
        LA(inner, BARREL.map(([r, h]) => [r * 0.88, h * 0.9]), wood, x, 0, z, 12);
        for (const [y, r] of [[0.18, 0.32], [0.62, 0.34]]) TR(inner, r, 0.02, iron, x, y, z);
      }
      RB(inner, 0.5, 0.05, 0.5, lam(0x3a2a18), 0.35, 0.87, -0.3, 0.4);                               // a board across one barrel
    }
    case 'crates': {
      RB(inner, 1.0, 1.0, 1.0, wood, -0.25, 0.5, 0);
      RB(inner, 0.8, 0.8, 0.8, wood, 0.5, 0.4, 0.15, 0.3);
      RB(inner, 0.7, 0.7, 0.7, wood, -0.15, 1.35, 0.05, 0.5);
      for (const [x, y, z] of [[-0.25, 0.5, 0.52], [0.5, 0.4, 0.58]]) { RB(inner, 0.9, 0.08, 0.03, wood2, x, y + 0.2, z); RB(inner, 0.9, 0.08, 0.03, wood2, x, y - 0.2, z); }   // slats
      SP(inner, 0.34, 0.2, 0.34, straw, 0.5, 0.85, 0.15);                                             // straw poking out
    }
    case 'table': {
      if (d.seed % 3 === 0) { C(inner, 0.85, 0.85, 0.09, wood, 0, 0.85, 0, 24); LA(inner, [[0, 0], [0.32, 0], [0.12, 0.1], [0.1, 0.7], [0.2, 0.8], [0.0, 0.8]], wood2, 0, 0, 0, 12); }   // a round table on a turned pedestal
      else { RB(inner, 1.7, 0.1, 0.95, wood, 0, 0.85, 0); for (const sx of [-0.75, 0.75]) for (const sz of [-0.35, 0.35]) LA(inner, [[0, 0], [0.06, 0], [0.045, 0.2], [0.055, 0.8], [0.0, 0.8]], wood2, sx, 0, sz, 8); }
      for (const x of [-0.45, 0.35]) { C(inner, 0.13, 0.13, 0.02, lam(0xb0a890), x, 0.91, 0.18, 12); SP(inner, 0.14, 0.07, 0.11, lam(0x9a6a3a), x + 0.04, 0.96, 0.18); }   // plates and crusts
      LA(inner, [[0, 0], [0.05, 0], [0.065, 0.13], [0.06, 0.13], [0.0, 0.12]], lam(0x8a7a5a), -0.1, 0.9, -0.2, 8); LA(inner, [[0, 0], [0.05, 0], [0.065, 0.13], [0.06, 0.13], [0.0, 0.12]], lam(0x8a7a5a), 0.55, 0.9, -0.25, 8);   // mugs
      C(inner, 0.03, 0.03, 0.16, bone, 0.1, 0.98, 0.0, 6); flame(inner, 0.1, 1.1, 0.0);              // a candle stub
      for (const [x, z, ry] of [[-0.5, 0.85, 0.15], [0.55, 0.9, -0.3], [0.1, -0.9, 3.2]]) {          // round stools pushed back
        C(inner, 0.22, 0.22, 0.06, wood2, x, 0.46, z, 14);
        for (const [lx, lz] of [[-0.12, -0.12], [0.12, -0.12], [-0.12, 0.12], [0.12, 0.12]]) C(inner, 0.025, 0.035, 0.43, wood2, x + lx, 0.22, z + lz, 6);
      }
    }
    case 'hearth': {
      RB(inner, 1.9, 1.5, 0.7, stone, 0, 0.75, 0);
      for (let i = 0; i < 9; i++) SP(inner, 0.4 + rg() * 0.15, 0.3 + rg() * 0.1, 0.12, stone, -0.8 + (i % 5) * 0.4, 0.2 + Math.floor(i / 5) * 0.55 + (rg() - 0.5) * 0.1, 0.34);   // rounded fieldstones in the face
      RB(inner, 1.1, 0.75, 0.4, lam(0x0a0806), 0, 0.5, 0.18);                                        // firebox
      RB(inner, 2.1, 0.12, 0.85, dstone, 0, 1.55, 0.02);                                             // mantel
      SP(inner, 0.7, 0.2, 0.2, glow(0xff6a20), 0, 0.2, 0.3);                                         // embers
      const f1 = flame(inner, 0, 0.5, 0.28, 4); f1.scale.set(3.2, 4.2, 3.2); const f2 = flame(inner, 0.2, 0.42, 0.28, 3); f2.scale.set(2.4, 3.2, 2.4);
      C(inner, 0.05, 0.05, 0.7, lam(0x4a3018), 0, 0.12, 0.3, 6).rotation.z = Math.PI / 2 + 0.2; C(inner, 0.045, 0.045, 0.6, lam(0x3a2410), 0.05, 0.22, 0.28, 6).rotation.z = Math.PI / 2 - 0.3;   // logs
      C(inner, 0.07, 0.07, 0.25, bone, -0.7, 1.7, 0.1, 6);                                           // candle stub on the mantel
    }
    case 'cauldron': {
      for (const a of [0, 2.1, 4.2]) C(inner, 0.03, 0.05, 0.35, iron, Math.sin(a) * 0.4, 0.17, Math.cos(a) * 0.4, 6);
      LA(inner, [[0, 0.3], [0.3, 0.3], [0.5, 0.5], [0.58, 0.75], [0.52, 0.95], [0.46, 0.97], [0.0, 0.9]], iron, 0, 0, 0, 16);   // a pot-bellied cauldron
      TR(inner, 0.52, 0.045, iron, 0, 0.96, 0);                                                      // rim
      C(inner, 0.46, 0.46, 0.03, glow(0x40ff70), 0, 0.94, 0, 16);                                    // glowing brew
      for (let i = 0; i < 4; i++) SP(inner, 0.12, 0.06, 0.12, glow(0x8affaa), (rg() - 0.5) * 0.7, 0.96, (rg() - 0.5) * 0.7);   // bubbles
      C(inner, 0.025, 0.025, 0.95, wood2, 0.3, 1.2, 0.1, 6).rotation.z = 0.4;                         // stirring spoon
      for (let i = 0; i < 3; i++) C(inner, 0.05, 0.05, 0.25, lam(0x4a3018), 0.75 + i * 0.01, 0.07 + i * 0.1, 0.4 - i * 0.1, 6).rotation.z = Math.PI / 2;   // firewood
    }
    case 'rug': {
      const c = cloths[Math.floor(rg() * cloths.length)];
      const m = new THREE.Mesh(new THREE.PlaneGeometry(2.2, 1.5), lam(c)); m.rotation.x = -Math.PI / 2; m.position.y = 0.025; inner.add(m);
      const m2 = new THREE.Mesh(new THREE.PlaneGeometry(1.8, 1.1), lam(new THREE.Color(c).multiplyScalar(0.6).getHex())); m2.rotation.x = -Math.PI / 2; m2.position.y = 0.03; inner.add(m2);
      const m3 = new THREE.Mesh(new THREE.PlaneGeometry(1.0, 0.5), lam(0xc9a23a)); m3.rotation.x = -Math.PI / 2; m3.position.y = 0.035; inner.add(m3);
      break;
    }
    case 'bones': {
      for (let i = 0; i < 4 + rg() * 3; i++) { const b = C(inner, 0.025 + rg() * 0.02, 0.025, 0.2 + rg() * 0.25, bone, (rg() - 0.5) * 1.2, 0.03, (rg() - 0.5) * 1.2, 5); b.rotation.z = Math.PI / 2; b.rotation.y = rg() * 3; }
      if (rg() < 0.7) {
        SP(inner, 0.2, 0.18, 0.22, bone, (rg() - 0.5) * 0.6, 0.1, (rg() - 0.5) * 0.6, rg() * 3);       // skull
        SP(inner, 0.05, 0.05, 0.03, lam(0x120c08), 0.0, 0.12, 0.0);
      }
    }
    case 'sacks': {
      for (let i = 0; i < 2; i++) {
        const x = (i - 0.5) * 0.55, bag = lam(0xa08a5a);
        SP(inner, 0.52, 0.6, 0.44, bag, x, 0.3, (rg() - 0.5) * 0.2, rg() * 0.8);                       // a lumpy sack
        LA(inner, [[0.0, 0], [0.1, 0], [0.07, 0.08], [0.12, 0.16], [0.0, 0.16]], bag, x, 0.54, 0, 8);   // its gathered neck
        TR(inner, 0.085, 0.015, lam(0x6a5230), x, 0.56, 0);                                            // tie
      }
    }
    case 'candles': {
      for (let i = 0; i < 3; i++) {
        const x = (i - 1) * 0.22 + (rg() - 0.5) * 0.1, z = (rg() - 0.5) * 0.25, h = 0.14 + rg() * 0.2;
        C(inner, 0.035, 0.04, h, bone, x, h / 2, z, 6); flame(inner, x, h + 0.06, z, 0.7);
        C(inner, 0.07, 0.07, 0.015, lam(0xe6d9a8), x, 0.01, z, 8);                                    // wax pool
      }
      break;
    }
    case 'chandelier': {   // hangs from the ceiling on a chain: an iron ring and cross with a ring of candles
      const top = WALL_H / (d.scale || 1), y = top - 1.1;
      C(inner, 0.015, 0.015, 1.1, iron, 0, top - 0.55, 0, 6);
      const ring = new THREE.Mesh(new THREE.TorusGeometry(0.55, 0.035, 6, 20), iron); ring.rotation.x = Math.PI / 2; ring.position.y = y; inner.add(ring);
      B(inner, 1.1, 0.03, 0.03, iron, 0, y, 0); B(inner, 1.1, 0.03, 0.03, iron, 0, y, 0, Math.PI / 2);
      B(inner, 0.12, 0.12, 0.12, lam(0xc9a23a, 0x2a2008), 0, y, 0);
      for (let i = 0; i < 8; i++) {
        const a = i * Math.PI / 4, x = Math.cos(a) * 0.55, z = Math.sin(a) * 0.55;
        C(inner, 0.035, 0.04, 0.16, bone, x, y + 0.1, z, 6); flame(inner, x, y + 0.22, z, 0.8);
      }
      break;
    }
    case 'beam': {
      RB(inner, d.len, 0.28, 0.3, wood, 0, WALL_H - 0.14, 0, d.alongZ ? Math.PI / 2 : 0);
    }
    case 'urn': {
      const clay = lam(0x8a5a3a);
      LA(inner, [[0, 0], [0.16, 0], [0.26, 0.12], [0.29, 0.3], [0.22, 0.5], [0.12, 0.62], [0.15, 0.72], [0.17, 0.74], [0.0, 0.74]], clay, 0, 0, 0, 12);   // a belly and a flared neck
      TR(inner, 0.28, 0.02, lam(0x2a2a30), 0, 0.3, 0);                                                 // iron band
      for (const s of [-1, 1]) { const h = new THREE.Mesh(cached('urnh', () => new THREE.TorusGeometry(0.07, 0.015, 5, 10)), clay); h.position.set(s * 0.17, 0.55, 0); h.rotation.y = Math.PI / 2; inner.add(h); }   // handles
    }
    case 'banner': {
      C(inner, 0.025, 0.025, 1.1, iron, 0, 2.35, 0, 6).rotation.z = Math.PI / 2;
      const c = cloth();
      B(inner, 0.9, 1.4, 0.03, c, 0, 1.6, 0.02);
      B(inner, 0.28, 0.28, 0.04, lam(0xc9a23a, 0x2a2008), 0, 1.75, 0.04, 0.78);                       // emblem
      B(inner, 0.9, 0.08, 0.04, lam(0xc9a23a), 0, 0.92, 0.03);                                         // hem
      break;
    }
    case 'altar': {
      RB(inner, 1.5, 0.85, 0.8, stone, 0, 0.43, 0);
      RB(inner, 1.7, 0.1, 0.95, dstone, 0, 0.9, 0);
      RB(inner, 0.5, 0.02, 0.95, lam(0x8a2a2a), 0, 0.96, 0);                                           // runner
      for (const x of [-0.6, 0.6]) { C(inner, 0.04, 0.045, 0.3, bone, x, 1.12, 0, 6); flame(inner, x, 1.3, 0); }
      LA(inner, [[0, 0], [0.06, 0], [0.025, 0.07], [0.03, 0.14], [0.07, 0.2], [0.0, 0.2]], lam(0xc9a23a, 0x2a2008), 0, 0.95, 0.1, 10);   // goblet
      SP(inner, 0.18, 0.3, 0.18, lam(0xc9a23a, 0x2a2008), 0, 1.12, -0.2);                              // small idol
    }
    case 'statue': {
      LA(inner, [[0, 0], [0.42, 0], [0.38, 0.08], [0.32, 0.45], [0.36, 0.5], [0.0, 0.5]], dstone, 0, 0, 0, 14);   // a moulded plinth
      C(inner, 0.17, 0.22, 1.0, stone, 0, 1.0, 0, 10);                                                 // robed body
      SP(inner, 0.3, 0.32, 0.3, stone, 0, 1.68, 0);                                                    // head
      for (const s of [-1, 1]) { const arm = C(inner, 0.05, 0.06, 0.6, stone, s * 0.27, 1.15, 0.1, 8); arm.rotation.z = -s * 0.3; }
      C(inner, 0.025, 0.02, 0.8, lam(0x9a9ea6), 0.3, 1.0, 0.25, 6).rotation.z = 0.1;                    // a sword in one hand
    }
  }
  const sc = d.scale || 1;                                         // the boss arena scales banners and statues up to fit the tall walls
  if (sc !== 1) inner.scale.setScalar(sc);
  const edgeShift = d.edge ? (EDGE_SHIFT[d.kind] || 0) : 0;
  const yaw = d.yaw + (d.edge ? 0 : (d.seed % 7 - 3) * 0.03);
  const pl = placeOnTile(inner, d.x, d.y, yaw, edgeShift);
  const light = d.kind === 'chandelier';
  return { p: { kind: 'decor', opened: true, x: d.x, y: d.y }, kind: d.kind, yaw: light ? 0 : yaw, mesh: pl.mesh, x: pl.x, z: pl.z, r: (DECOR_R[d.kind] || 0) * sc, lid: null, mats: [],
    ly: light ? WALL_H - 1.4 * sc : undefined, ls: light ? 0.7 + 0.4 * sc : 1 };
}
const leatherMat = () => lam(0x3a2616);
