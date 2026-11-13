// Procedural models for lootable props, furniture and locked doors (stand-ins until real art).
// Local frame: the model's +z faces into the room and its back is at -z, so objects on a room's
// edge tile are pushed toward the wall and face the interior.
const PROP_R = { chest: 0.6, barrel: 0.45, rubble: 0.5, rack: 0.7, potions: 0.7, pantry: 0.7, vaultchest: 0.65 };
const DECOR_R = { bed: 0.85, bookshelf: 0.8, weaponrack: 0.55, barrels: 0.8, crates: 0.8, table: 0.9, hearth: 0.9, bench: 0.55, cauldron: 0.75,
  sacks: 0.45, altar: 0.85, statue: 0.45, candles: 0.2, urn: 0.28, counter: 0.95, puddle: 0, moon: 0, shade: 0, fruit: 0, fireflies: 0, lantern: 0, keg: 0.7, longtable: 1.1, appletree: 0.55, hedge: 0.8, well: 0.85, glowcap: 0, bell: 0, ice: 0, brush: 0, fern: 0, glowmoss: 0, vines: 0, hammock: 0, log: 0.9, idol: 0.5, pew: 0.8, brokenaltar: 0.8, candlestand: 0.2, icicles: 0, snowdrift: 0, shaft: 0, winerack: 0.8, mushroom: 0.6, stalactites: 0, dark: 0, orrery: 0.7, clock: 0.45, scrolltable: 0.9, globe: 0.5, ladder: 0, rug: 0, bones: 0, banner: 0, chandelier: 0, beam: 0, stall: 0.9, awning: 0, festoon: 0, crowd: 0, rpillar: 0.7, dais: 0, runes: 0 };
// How far toward the wall each kind sits when it is on an edge tile (a tile is 3 m, so the wall is 1.5 m out).
const EDGE_SHIFT = { chest: 0.85, barrel: 0.8, rubble: 0.6, rack: 1.05, potions: 1.1, pantry: 1.1, vaultchest: 0.85,
  bed: 0.85, bookshelf: 1.2, weaponrack: 1.3, barrels: 0.7, crates: 0.6, hearth: 1.05, bench: 1.15, cauldron: 0.6, sacks: 0.8, statue: 0.8, banner: 1.46, candles: 0.9, urn: 1.0, hammock: 1.2, shaft: 1.45, candlestand: 1.1, winerack: 1.2, clock: 1.2, ladder: 1.35, awning: 1.4, stall: 0.55 };
// Decor that glows: the light pool borrows these.
const DECOR_LIGHT = { hearth: { color: 0xff8a30, y: 0.9, str: 1.15 }, cauldron: { color: 0x50ff80, y: 1.0, str: 0.8 },
  candles: { color: 0xffcc70, y: 0.5, str: 0.45 }, altar: { color: 0xffd070, y: 1.3, str: 0.6 },
  chandelier: { color: 0xffc060, y: 2.4, str: 1.0 } };   // main.js uses the decor's own ly / ls for scaled (boss arena) ones

const lam = (c, emissive) => new THREE.MeshLambertMaterial(emissive === undefined ? { color: c } : { color: c, emissive });
const glow = c => new THREE.MeshBasicMaterial({ color: c });
const FLAME_MAT = new THREE.MeshBasicMaterial({ color: 0xffb040 });
// The Final Chamber's rune circle and its mist rings: additive vertex-coloured meshes (no textures, so the texture count stays flat), one shared material each whose opacity js/main.js pulses.
const RUNE_MAT = new THREE.MeshBasicMaterial({ vertexColors: true, transparent: true, opacity: 0.55, depthWrite: false, blending: THREE.AdditiveBlending, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 });
const MIST_MAT = new THREE.MeshBasicMaterial({ vertexColors: true, transparent: true, opacity: 0.6, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide });
RUNE_MAT.userData.shared = true; MIST_MAT.userData.shared = true;
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
  const wood = new THREE.Color(theme.pal.wall).multiplyScalar(0.8).getHex();
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
    if (p.locked) {                                                                                                             // a brass padlock hangs from the lock plate (a tell that goes when it is opened)
      const brass = mat(0xd8b030, 0x403008), tell = new THREE.Group(); o.tell = tell;
      const body = new THREE.Mesh(cached('padbody', () => new THREE.BoxGeometry(0.13, 0.11, 0.05)), brass); body.position.set(0, 0.4 * s, 0.4 * s); tell.add(body);
      const shackle = new THREE.Mesh(cached('padshackle', () => new THREE.TorusGeometry(0.04, 0.014, 5, 10, Math.PI)), brass); shackle.position.set(0, 0.4 * s + 0.055, 0.4 * s); tell.add(shackle);
      inner.add(tell);
    } else if (p.trap) {                                                                                                        // a trap's tell: a hair-thin wire across the chest's foot, glinting, between two tiny pegs
      const wire = new THREE.MeshBasicMaterial({ color: 0xaab4c0 }), peg = mat(0x2a2218), tell = new THREE.Group(); o.mats.push(wire); o.tell = tell;
      const w = new THREE.Mesh(cached('trapwire', () => new THREE.BoxGeometry(1.1, 0.012, 0.012)), wire); w.position.set(0, 0.06, 0.58); tell.add(w);
      for (const x of [-0.55, 0.55]) { const g = new THREE.Mesh(cached('trappeg', () => new THREE.CylinderGeometry(0.012, 0.016, 0.12, 5)), peg); g.position.set(x, 0.06, 0.58); tell.add(g); }
      inner.add(tell);
    }
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
// Door looks by dr.style (set from the theme's doors.style in gen.js). Each builder fills `inner`, a doorway 3 m wide, local z across the wall. New styles add an entry; unknown styles fall back to 'plank'.
const DOOR_BUILDERS = {
  // Cave mouth (Jungle): a dark hole filling the doorway, a cluster of boulders heaped in front and a vine curtain over all of it. Opens by rolling up (DOOR_ANIM.roll).
  cave(inner, dr) {
    const rg = makeRng(dr.x * 131 + dr.y), dh = WALL_H - 0.1, rock = [lam(0x5a5a50), lam(0x4a4a42), lam(0x6a6a5c)], vine = [lam(0x2f6a22), lam(0x3f7a2a), lam(0x24561c)];
    B(inner, 3.0, dh, 0.3, new THREE.MeshBasicMaterial({ color: 0x030504 }), 0, dh / 2, 0);                                  // the dark hole
    RB(inner, 3.2, 0.5, 0.5, rock[1], 0, dh - 0.1, 0.05);                                                                   // a rough lintel
    for (const [n, y, r] of [[5, 0.5, 0.5], [4, 1.25, 0.46], [3, 1.9, 0.4]]) for (let i = 0; i < n; i++) {                  // three rows of boulders, tighter toward the top
      const x = (i - (n - 1) / 2) * (2.7 / n) + (rg() - 0.5) * 0.15, k = r * (0.9 + rg() * 0.3);
      SP(inner, k * 2, k * 1.7, k * 1.9, rock[Math.floor(rg() * 3)], x, y, 0.3 + rg() * 0.15, rg() * 3);
    }
    for (let i = 0; i < 8; i++) {                                                                                           // the vine curtain: strands from the lintel to just above the floor, with leaves
      const x = -1.3 + i * 0.37 + (rg() - 0.5) * 0.12, len = dh - 0.5 - rg() * 0.6, m = vine[i % 3];
      C(inner, 0.03, 0.04, len, m, x, dh - 0.3 - len / 2, 0.62 + rg() * 0.05, 5);
      for (let k = 0; k < 3; k++) B(inner, 0.22, 0.06, 0.12, m, x + (rg() - 0.5) * 0.15, dh - 0.5 - rg() * (len - 0.2), 0.66, rg() * 3);
    }
    B(inner, 0.3, 0.2, 0.3, glow(0x6aff90), 0.9, 0.12, 0.78);                                                               // a glowing moss tuft by the foot (the lock: the Cave Key)
  },
  // Ice seal (Frozen Chapel): a glassy slab fills the doorway in an iron-blue frame, with cracks and a frozen rune over the lock. Opens by sinking through the floor (DOOR_ANIM.sink), 8 m of noise.
  ice(inner, dr) {
    const rg = makeRng(dr.x * 131 + dr.y), dh = WALL_H - 0.1, frame = lam(0x3a4a60), glass = new THREE.MeshLambertMaterial({ color: 0xaee4ff, transparent: true, opacity: 0.55, emissive: 0x1a3a50, depthWrite: false });
    B(inner, 2.8, dh, 0.3, glass, 0, dh / 2, 0);                                                                            // the slab (see-through, so the room behind shows as a blue haze)
    B(inner, 3.0, 0.2, 0.4, frame, 0, 0.1, 0); B(inner, 3.0, 0.2, 0.4, frame, 0, dh - 0.1, 0);                              // sill and head
    for (const x of [-1.4, 1.4]) B(inner, 0.2, dh, 0.4, frame, x, dh / 2, 0);                                               // posts
    const white = glow(0xf0faff);
    for (let i = 0; i < 6; i++) B(inner, 0.03, 0.4 + rg() * 0.9, 0.34, white, (rg() - 0.5) * 2.4, 0.6 + rg() * (dh - 1.4), 0, 0, (rg() - 0.5) * 1.2);   // cracks
    SP(inner, 0.4, 0.4, 0.1, glow(0x7ad8ff), 0, 1.4, 0.2);                                                                  // a frozen rune over the lock
    for (const x of [-0.6, -0.2, 0.3, 0.7]) { const ic = new THREE.Mesh(cached('dicicle', () => new THREE.ConeGeometry(0.07, 0.4, 5)), glass); ic.rotation.x = Math.PI; ic.position.set(x, dh - 0.4, 0.2); ic.scale.y = 0.7 + rg() * 0.8; inner.add(ic); }
  },
  // Spore seal (Mushroom Cellar): a lumpy purple fungus mound heaped in the doorway, spotted with glowing teal, small caps at its foot and a glowing sac over the lock. Opens by shrinking away (DOOR_ANIM.wither) and bursts into spores.
  spore(inner, dr) {
    const rg = makeRng(dr.x * 131 + dr.y), dh = WALL_H - 0.1, fung = [lam(0x5a3a7a), lam(0x6a4a8a), lam(0x4a3a6a)], pale = lam(0xd8d0f0);
    B(inner, 3.0, dh, 0.3, lam(0x1a1226), 0, dh / 2, 0);                                                                    // the dark core fills the doorway
    for (let c = 0; c < 5; c++) for (let r = 0; r < 4; r++) { const k = 0.8 + rg() * 0.5; SP(inner, 0.95 * k, 1.0 * k, 0.8 * k, fung[(c + r) % 3], (c - 2) * 0.62 + (rg() - 0.5) * 0.2, 0.5 + r * 0.9 + (rg() - 0.5) * 0.2, 0.15 + rg() * 0.15, rg() * 3); }   // the mound, in lumps
    for (let i = 0; i < 10; i++) SP(inner, 0.14, 0.12, 0.1, glow(0x6affd0), (rg() - 0.5) * 2.4, 0.4 + rg() * (dh - 0.8), 0.5 + rg() * 0.12, 0);   // glowing spots
    for (let i = 0; i < 5; i++) { const x = (rg() - 0.5) * 2.6, z = 0.5 + rg() * 0.25; C(inner, 0.04, 0.05, 0.3, pale, x, 0.15, z, 6); SP(inner, 0.3, 0.14, 0.3, lam(0x8a5ab0), x, 0.34, z, 0); }   // caps at its foot
    SP(inner, 0.38, 0.38, 0.3, glow(0x8affd8), 0.9, 1.3, 0.6);                                                              // the lock: a glowing spore sac (the Spore Key)
  },
  // Clockwork gate (Library): brass bars in a dark frame (you can see through them), a lock plate, and two cogs on the head (made in makeDoor so they can spin). Slides up (DOOR_ANIM.gate).
  gate(inner, dr) {
    const dh = WALL_H - 0.1, brass = lam(0xb8923a, 0x2a2008), dark = lam(0x2a2018);
    B(inner, 3.0, 0.2, 0.4, dark, 0, 0.1, 0); B(inner, 3.0, 0.2, 0.4, dark, 0, dh - 0.1, 0);                                // sill and head
    for (const x of [-1.45, 1.45]) B(inner, 0.2, dh, 0.4, brass, x, dh / 2, 0);                                             // posts
    for (let i = 0; i < 11; i++) B(inner, 0.07, dh - 0.3, 0.07, brass, -1.25 + i * 0.25, dh / 2, 0);                         // bars
    for (const y of [0.7, 1.5, 2.3]) B(inner, 2.7, 0.08, 0.1, dark, 0, y, 0);                                                // rails
    B(inner, 0.4, 0.5, 0.12, brass, 0.9, 1.3, 0.1); B(inner, 0.07, 0.14, 0.1, dark, 0.9, 1.3, 0.17);                         // lock plate and keyhole (the Gear Key)
  },
  // Barred hatch (Sunken Tavern): a cellar door of barrel staves in iron hoops, a heavy crossbar in brackets and a brass padlock. Heaves up with a shudder (DOOR_ANIM.barred). The Cask Key.
  hatch(inner, dr) {
    const rg = makeRng(dr.x * 131 + dr.y), dh = WALL_H - 0.1, iron = lam(0x2a2a30);
    for (let i = 0; i < 8; i++) { const c = new THREE.Color(0x4a3220).multiplyScalar(0.8 + rg() * 0.4); B(inner, 0.38, dh, 0.28, lam(c.getHex()), -1.31 + i * 0.375, dh / 2, 0); }
    for (const y of [0.45, 1.3, 2.15, dh - 0.25]) B(inner, 3.0, 0.16, 0.34, iron, 0, y, 0);                                  // hoops
    B(inner, 3.3, 0.22, 0.16, lam(0x2a1c10), 0, 1.0, 0.25); for (const x of [-1.4, 1.4]) B(inner, 0.2, 0.5, 0.24, iron, x, 1.0, 0.2);   // crossbar and brackets
    C(inner, 0.1, 0.1, 0.16, lam(0xc9a23a, 0x2a2008), 0.5, 1.45, 0.32, 10); B(inner, 0.2, 0.2, 0.1, lam(0xc9a23a, 0x2a2008), 0.5, 1.3, 0.32);   // padlock
    SP(inner, 0.9, 0.12, 0.3, lam(0x1a3a4a), 0, 0.06, 0.4);                                                                  // a damp stain at the foot
  },
  // Garden gate (Moonlit Orchard): a wrought iron leaf hung from the left post, wound with vines and a few night blooms (the Garden Key). The leaf is a group of its own (inner.userData.leaf, hinge at its origin): it folds back to the post (DOOR_ANIM.fold).
  garden(inner, dr) {
    const rg = makeRng(dr.x * 131 + dr.y), dh = WALL_H - 0.1, iron = lam(0x20262c), vine = [lam(0x2f6a22), lam(0x3f7a2a)], leaf = new THREE.Group();
    inner.userData.leaf = leaf; leaf.position.x = -1.45; inner.add(leaf);
    for (const x of [-1.45, 1.45]) B(inner, 0.2, dh, 0.4, lam(0x3a4034), x, dh / 2, 0);                                     // stone posts
    B(inner, 3.0, 0.2, 0.4, lam(0x3a4034), 0, dh - 0.1, 0);
    for (let i = 0; i < 12; i++) B(leaf, 0.05, dh - 0.4, 0.05, iron, 0.2 + i * 0.22, dh / 2 - 0.1, 0);                         // bars
    for (const y of [0.5, 1.6, dh - 0.5]) B(leaf, 2.7, 0.07, 0.08, iron, 1.45, y, 0);                                        // rails
    for (let i = 0; i < 6; i++) { const x = 0.3 + i * 0.5, s = Math.PI * 2 * rg(); SP(leaf, 0.12, 0.3 + rg() * 0.5, 0.1, vine[i % 2], x, 0.5 + rg() * 2.2, 0.06, s); }   // vine tangles
    for (let i = 0; i < 5; i++) SP(leaf, 0.11, 0.11, 0.08, glow(0xdce8ff), 0.4 + rg() * 2.3, 0.6 + rg() * 2.2, 0.1, 0);    // moon blooms
    B(leaf, 0.3, 0.4, 0.1, iron, 2.5, 1.3, 0.08); B(leaf, 0.06, 0.12, 0.08, lam(0x6a6a50), 2.5, 1.3, 0.14);                  // lock plate and keyhole
  },
  // Shuttered stall (Goblin Market): a slatted rolling shutter between timber posts under a striped awning, a hasp and padlock (the Stall Key), a price tag and a lantern. Rolls up in steps (DOOR_ANIM.shutter).
  shutter(inner, dr) {
    const dh = WALL_H - 0.1, post = lam(0x4a3220), tin = [lam(0x9a9488), lam(0x8a8478)], cl = [lam(0xa83a2a), lam(0xe8dcc0)], n = 12, sh = (dh - 0.5) / n;
    for (const x of [-1.45, 1.45]) B(inner, 0.2, dh, 0.4, post, x, dh / 2, 0);                                              // posts
    B(inner, 3.0, 0.25, 0.4, post, 0, dh - 0.12, 0); B(inner, 3.0, 0.14, 0.4, post, 0, 0.07, 0);                            // head beam and sill
    for (let i = 0; i < n; i++) B(inner, 2.7, sh * 0.86, 0.1, tin[i % 2], 0, 0.2 + sh * (i + 0.5), 0);                       // the slats
    B(inner, 0.35, 0.5, 0.12, lam(0x2a2a30), 0.9, 1.1, 0.1); C(inner, 0.1, 0.1, 0.14, lam(0xc9a23a, 0x2a2008), 0.9, 0.78, 0.14, 10);   // hasp and padlock
    B(inner, 0.5, 0.34, 0.04, lam(0x6a4a2a), -0.9, 1.5, 0.08); SP(inner, 0.16, 0.16, 0.05, glow(0xe8c860), -0.9, 1.5, 0.12);   // a price tag with a coin
    for (let i = 0; i < 6; i++) { const m = B(inner, 0.5, 0.04, 1.0, cl[i % 2], -1.25 + i * 0.5, dh - 0.55, 0.45); m.rotation.x = 0.5; }   // the awning
    for (let i = 0; i < 6; i++) B(inner, 0.5, 0.2, 0.03, cl[i % 2], -1.25 + i * 0.5, dh - 0.95, 0.88);                       // its scalloped edge
    C(inner, 0.01, 0.01, 0.4, lam(0x2a2a30), -1.2, dh - 0.9, 0.5, 4); B(inner, 0.16, 0.22, 0.16, glow(0xffb050), -1.2, dh - 1.2, 0.5);   // a little lantern
  },
  plank(inner, dr) {
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
  },
};
function makeDoor(dr) {
  const inner = new THREE.Group();
  (DOOR_BUILDERS[dr.style] || DOOR_BUILDERS.plank)(inner, dr);
  let leaf = null;
  if (dr.style === 'garden') { leaf = inner.userData.leaf; bakeMeshes(inner, new Set([leaf]), { flash: null }); bakeMeshes(leaf, NO_SKIP, { flash: null }); }   // the gate's leaf is its own group, so it can fold
  else if (dr.style === 'cave' || dr.style === 'ice' || dr.style === 'spore' || dr.style === 'gate' || dr.style === 'hatch' || dr.style === 'shutter') bakeMeshes(inner, NO_SKIP, { flash: null });   // the many small parts merge into 2 or 3 meshes (js/perf.js)
  const mesh = new THREE.Group();
  const x = (dr.x + 0.5) * TILE, z = (dr.y + 0.5) * TILE;
  mesh.add(inner); mesh.position.set(x, 0, z); mesh.rotation.y = dr.axis === 'x' ? Math.PI / 2 : 0;
  let cogs = null;
  if (dr.style === 'gate') {                                       // two meshing cogs on the head: each is one baked mesh in its own group, turned by DOOR_ANIM.gate
    const brass = lam(0xb8923a, 0x2a2008);
    cogs = [[-0.55, 0.5, 12], [0.3, 0.38, 10]].map(([cx, r, n]) => {
      const g = new THREE.Group(), disc = C(g, r, r, 0.08, brass, 0, 0, 0, 16); disc.rotation.x = Math.PI / 2;
      for (let i = 0; i < n; i++) { const a = i * 2 * Math.PI / n; B(g, 0.13, 0.13, 0.08, brass, Math.cos(a) * (r + 0.04), Math.sin(a) * (r + 0.04), 0, 0, a); }
      bakeMeshes(g, NO_SKIP, { flash: null }); g.position.set(cx, WALL_H - 0.9, 0.24); mesh.add(g); return g;
    });
  }
  return { p: { kind: 'door', opened: false, x: dr.x, y: dr.y, lock: dr.lock, room: dr.room, keyLabel: dr.keyLabel }, mesh, x, z, r: 0, lid: null, mats: [], cogs, leaf };
}

// ---- furniture and decals: lived-in details for the guards' home ----
function makeDecor(d) {
  const inner = new THREE.Group();
  const rg = makeRng(d.seed);
  const T = c => new THREE.Color(theme.pal[c]);
  const wood = lam(T('wall').multiplyScalar(0.8).getHex());
  const wood2 = lam(T('floor').multiplyScalar(1.5).getHex());
  const stone = lam(0x75726c), dstone = lam(0x4a4844), iron = lam(0x2a2a30), straw = lam(0xb89a58), bone = lam(0xe6e0c8);
  const cloths = [0x8a2a2a, 0x2a3a7a, 0x2a6a4a, 0x7a5a1a, 0x5a2a6a];
  const cloth = () => lam(cloths[Math.floor(rg() * cloths.length)]);
  const flame = (parent, x, y, z, s = 1) => { const f = new THREE.Mesh(cached('flame', () => new THREE.ConeGeometry(0.04, 0.13, 6)), FLAME_MAT); f.position.set(x, y, z); f.scale.setScalar(s); parent.add(f); return f; };

  switch (d.kind) {
    // ---- Jungle ----
    case 'brush': {                                                // a 3 m thicket of broad leaves and bushes: the Jungle's cover (a player stealth bonus; it rustles)
      const gm = [lam(0x2f6a22), lam(0x3f7a2a), lam(0x24561c)];
      for (let i = 0; i < 30; i++) { const h = 0.9 + rg() * 0.7; B(inner, 0.14, h, 0.03, gm[i % 3], (rg() - 0.5) * 2.5, h / 2, (rg() - 0.5) * 2.5, rg() * 3, (rg() - 0.5) * 0.35); }
      for (let i = 0; i < 4; i++) B(inner, 0.6, 0.4, 0.6, gm[i % 3], (rg() - 0.5) * 2, 0.2, (rg() - 0.5) * 2, rg() * 3);
      break;
    }
    case 'fern': {                                                 // a fern: leaves fanning out and drooping
      const fm = [lam(0x3f8a30), lam(0x2f7424)];
      for (let i = 0; i < 9; i++) { const a = i * 0.7 + rg() * 0.3, b = B(inner, 0.1, 0.55, 0.02, fm[i % 2], Math.sin(a) * 0.25, 0.25, Math.cos(a) * 0.25, a, 0.9); b.rotation.order = 'YZX'; }
      break;
    }
    case 'vines': {                                                // hanging vines from the canopy
      const top = WALL_H, vm = [lam(0x2f6a22), lam(0x3f7a2a)];
      for (let i = 0; i < 5; i++) { const len = 1.2 + rg() * 1.8, x = (rg() - 0.5) * 2.2, z = (rg() - 0.5) * 2.2; C(inner, 0.025, 0.03, len, vm[i % 2], x, top - len / 2, z, 5); for (let k = 0; k < 3; k++) B(inner, 0.2, 0.05, 0.1, vm[(i + k) % 2], x + 0.06, top - rg() * len, z, rg() * 3); }
      break;
    }
    case 'glowmoss': {                                             // glowing moss on the floor: emissive, not a light
      const gm = glow(0x3ad868);
      for (let i = 0; i < 3; i++) { const c = new THREE.Mesh(cached('mossdisc', () => new THREE.CircleGeometry(0.4, 8)), gm); c.rotation.x = -Math.PI / 2; c.scale.setScalar(0.5 + rg() * 0.8); c.position.set((rg() - 0.5) * 1.6, 0.016 + i * 0.001, (rg() - 0.5) * 1.6); inner.add(c); }
      for (let i = 0; i < 4; i++) { const x = (rg() - 0.5) * 1.6, z = (rg() - 0.5) * 1.6; C(inner, 0.02, 0.03, 0.12, lam(0xd8f0d0), x, 0.06, z, 5); B(inner, 0.12, 0.05, 0.12, glow(0x7affa0), x, 0.14, z); }
      break;
    }
    case 'hammock': {                                              // two posts and a sagging cloth (an old camp)
      for (const s of [-1, 1]) C(inner, 0.05, 0.06, 1.5, lam(0x5a3e24), s * 0.85, 0.75, 0, 6);
      SP(inner, 1.6, 0.12, 0.5, lam(0x8a6a3a), 0, 0.75, 0); SP(inner, 0.4, 0.1, 0.34, lam(0xc8b890), -0.45, 0.82, 0);
      for (const s of [-1, 1]) C(inner, 0.01, 0.01, 0.4, lam(0x3a2a18), s * 0.75, 0.95, 0, 4).rotation.z = s * 0.5;
      break;
    }
    case 'log': {                                                  // a fallen log with moss on top (blocks the way)
      const lg = C(inner, 0.38, 0.42, 2.3, lam(0x5a3e24), 0, 0.4, 0, 10); lg.rotation.z = Math.PI / 2;
      SP(inner, 1.6, 0.2, 0.5, lam(0x3f7a2a), 0, 0.78, 0);
      for (const s of [-1, 1]) { const e = C(inner, 0.3, 0.3, 0.05, lam(0x7a5a38), s * 1.15, 0.4, 0, 10); e.rotation.z = Math.PI / 2; }
      for (let i = 0; i < 3; i++) SP(inner, 0.3, 0.15, 0.3, lam(0xb8a070), (rg() - 0.5) * 1.4, 0.8, 0.3);
      break;
    }
    case 'idol': {                                                 // a mossy stone idol with glowing eyes
      const st = lam(0x6a6a5c), mo = lam(0x3f7a2a);
      LA(inner, [[0, 0], [0.42, 0], [0.38, 0.1], [0.34, 0.3], [0.0, 0.3]], st, 0, 0, 0, 10);
      RB(inner, 0.6, 0.8, 0.5, st, 0, 0.7, 0); RB(inner, 0.7, 0.55, 0.55, st, 0, 1.38, 0);
      for (const s of [-1, 1]) { SP(inner, 0.1, 0.08, 0.06, glow(0x7aff60), s * 0.16, 1.45, 0.29); RB(inner, 0.14, 0.4, 0.1, st, s * 0.38, 0.75, 0.1); }
      RB(inner, 0.3, 0.06, 0.08, lam(0x1a1a16), 0, 1.25, 0.29); SP(inner, 0.5, 0.15, 0.4, mo, 0, 1.68, 0); SP(inner, 0.2, 0.3, 0.1, mo, 0.25, 0.7, 0.28);
      break;
    }
    // ---- Frozen Chapel ----
    case 'pew': {                                                  // a plank pew, frosted
      const pw = lam(0x5a5e6c), fr = lam(0xdce8f4);
      RB(inner, 1.7, 0.08, 0.45, pw, 0, 0.45, 0.1); RB(inner, 1.7, 0.55, 0.07, pw, 0, 0.8, -0.1);
      for (const s of [-1, 1]) RB(inner, 0.08, 0.95, 0.55, pw, s * 0.85, 0.47, 0);
      RB(inner, 1.7, 0.03, 0.4, fr, 0, 0.5, 0.1); RB(inner, 1.6, 0.03, 0.07, fr, 0, 1.09, -0.1);
      break;
    }
    case 'brokenaltar': {                                          // a cracked altar, the top slab fallen
      const st = lam(0x8a929e), fr = lam(0xdce8f4);
      RB(inner, 1.5, 0.85, 0.8, st, 0, 0.43, 0); RB(inner, 1.0, 0.1, 0.9, st, -0.3, 0.9, 0, 0, 0.18); RB(inner, 0.7, 0.1, 0.9, st, 0.55, 0.15, 0.7, 0.6);
      for (let i = 0; i < 4; i++) SP(inner, 0.25 + rg() * 0.2, 0.15, 0.25, st, (rg() - 0.5) * 1.8, 0.07, 0.6 + rg() * 0.4);
      SP(inner, 1.2, 0.12, 0.7, fr, 0, 0.9, 0); SP(inner, 0.12, 0.3, 0.12, glow(0xaee4ff), 0.2, 1.1, 0);
      break;
    }
    case 'candlestand': {                                          // a tall iron stand with three candles
      C(inner, 0.03, 0.05, 1.4, iron, 0, 0.7, 0, 6); LA(inner, [[0, 0], [0.22, 0], [0.12, 0.08], [0.03, 0.14], [0.0, 0.14]], iron, 0, 0, 0, 8); TR(inner, 0.17, 0.02, iron, 0, 1.4, 0);
      for (let i = 0; i < 3; i++) { const a = i * 2.1, x = Math.sin(a) * 0.14, z = Math.cos(a) * 0.14; C(inner, 0.035, 0.04, 0.2, bone, x, 1.52, z, 6); flame(inner, x, 1.68, z, 0.8); }
      break;
    }
    case 'icicles': {                                              // icicles hanging from the vault
      const top = WALL_H / (d.scale || 1), im = new THREE.MeshLambertMaterial({ color: 0xcfeaff, transparent: true, opacity: 0.75, emissive: 0x1a3a50, depthWrite: false });
      for (let i = 0; i < 7; i++) { const len = 0.4 + rg() * 0.9, c = new THREE.Mesh(cached('icicle', () => new THREE.ConeGeometry(0.07, 1, 5)), im); c.rotation.x = Math.PI; c.scale.set(0.6 + rg() * 0.8, len, 0.6 + rg() * 0.8); c.position.set((rg() - 0.5) * 2.4, top - len / 2, (rg() - 0.5) * 2.4); inner.add(c); }
      break;
    }
    case 'snowdrift': {                                            // a drift of snow
      const sn = lam(0xe8f0f8);
      for (let i = 0; i < 3; i++) SP(inner, 1.0 + rg() * 0.8, 0.22 + rg() * 0.15, 0.8 + rg() * 0.6, sn, (rg() - 0.5) * 1.2, 0.04, (rg() - 0.5) * 1.2, rg() * 3);
      break;
    }
    case 'shaft': {                                                // a tall pale window in the wall, with a faint slanting shaft of light (decor, not a light)
      B(inner, 1.0, 1.9, 0.06, glow(0xdff0ff), 0, 1.9, 0.02); for (const x of [-0.55, 0.55]) B(inner, 0.1, 2.1, 0.1, iron, x, 1.9, 0.03); B(inner, 1.2, 0.1, 0.1, iron, 0, 2.9, 0.03); B(inner, 1.2, 0.1, 0.1, iron, 0, 0.95, 0.03); B(inner, 0.06, 1.9, 0.08, iron, 0, 1.9, 0.03);
      const b = B(inner, 0.9, 3.0, 1.4, new THREE.MeshBasicMaterial({ color: 0xcfe8ff, transparent: true, opacity: 0.08, depthWrite: false }), 0, 1.5, 0.8); b.rotation.x = -0.45;
      break;
    }
    // ---- Mushroom Cellar ----
    case 'winerack': {                                             // a dark rack of bottle butts in a wooden lattice
      const fr = lam(0x4a3220), gl = [lam(0x2a4a3a), lam(0x3a2a5a), lam(0x2a3a4a), lam(0x4a2a3a)];
      RB(inner, 1.9, 2.1, 0.5, lam(0x1c1210), 0, 1.05, 0);
      for (let i = 0; i <= 5; i++) B(inner, 0.05, 2.1, 0.52, fr, -0.85 + i * 0.34, 1.05, 0);
      for (let j = 0; j <= 4; j++) B(inner, 1.9, 0.05, 0.52, fr, 0, 0.1 + j * 0.5, 0);
      for (let j = 0; j < 4; j++) for (let i = 0; i < 5; i++) if (rg() > 0.15) C(inner, 0.1, 0.1, 0.1, gl[(i + j) % 4], -0.68 + i * 0.34, 0.35 + j * 0.5, 0.26, 8).rotation.x = Math.PI / 2;   // a bottle's base in each cell
      break;
    }
    case 'mushroom': {                                             // a giant mushroom: a pale stem, a broad purple cap with teal spots (blocks the way)
      const cap = [lam(0x7a4a9a), lam(0x5a3a8a)], stem = lam(0xd8d0f0);
      C(inner, 0.28, 0.4, 1.8, stem, 0, 0.9, 0, 10); SP(inner, 2.3, 0.9, 2.3, cap[0], 0, 2.1, 0); SP(inner, 1.9, 0.5, 1.9, cap[1], 0, 1.8, 0);
      for (let i = 0; i < 7; i++) { const a = i * 0.9 + rg(), r = 0.5 + rg() * 0.5; SP(inner, 0.22, 0.1, 0.22, glow(0x6affd0), Math.cos(a) * r, 2.45 - r * 0.12, Math.sin(a) * r, 0); }
      for (let i = 0; i < 3; i++) { const x = (rg() - 0.5) * 1.4, z = 0.5 + rg() * 0.4; C(inner, 0.03, 0.04, 0.2, stem, x, 0.1, z, 6); SP(inner, 0.2, 0.1, 0.2, cap[i % 2], x, 0.22, z, 0); }
      break;
    }
    case 'stalactites': {                                          // rock teeth hanging from the ceiling
      const top = WALL_H / (d.scale || 1), rm = lam(0x5a5468);
      for (let i = 0; i < 8; i++) { const len = 0.5 + rg() * 1.2, c = new THREE.Mesh(cached('stalac', () => new THREE.ConeGeometry(0.12, 1, 6)), rm); c.rotation.x = Math.PI; c.scale.set(0.6 + rg() * 0.9, len, 0.6 + rg() * 0.9); c.position.set((rg() - 0.5) * 2.4, top - len / 2, (rg() - 0.5) * 2.4); inner.add(c); }
      break;
    }
    case 'dark': {                                                 // a dark pocket: a soft black disc on the floor (the Cellar's mechanic: it hides you and muffles your steps)
      const dk = new THREE.Mesh(cached('darkdisc', () => new THREE.CircleGeometry(1.5, 16)), new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.5, depthWrite: false }));
      dk.rotation.x = -Math.PI / 2; dk.position.y = 0.018; inner.add(dk);
      break;
    }
    // ---- Clockwork Library ----
    case 'ladder': {                                               // a library ladder leaning on the shelves (a wall decal)
      const wd = lam(0x6a4a2a), lg = new THREE.Group();
      for (const sx of [-1, 1]) B(lg, 0.07, 3.1, 0.07, wd, sx * 0.32, 1.55, 0);
      for (let i = 0; i < 9; i++) B(lg, 0.64, 0.05, 0.05, wd, 0, 0.3 + i * 0.31, 0);
      B(lg, 0.8, 0.04, 0.06, lam(0xb8923a, 0x2a2008), 0, 3.05, 0.04);                                                       // a brass rail on the top
      lg.position.z = 0.45; lg.rotation.x = -0.18; inner.add(lg);
      break;
    }
    case 'orrery': {                                               // brass rings and planets round a glowing sun, on a pedestal
      const br = lam(0xb8923a, 0x2a2008);
      LA(inner, [[0, 0], [0.55, 0], [0.45, 0.1], [0.2, 0.2], [0.12, 0.9], [0.0, 0.9]], lam(0x3a2a1c), 0, 0, 0, 14);
      SP(inner, 0.3, 0.3, 0.3, glow(0xffd070), 0, 1.35, 0);
      for (const [R, tilt, c] of [[0.5, 0.2, 0xc8c8d0], [0.8, -0.35, 0xb8923a], [1.1, 0.5, 0x6a9ac8]]) {
        const ring = new THREE.Mesh(cached(`orr${R}`, () => new THREE.TorusGeometry(R, 0.015, 5, 24)), br); ring.rotation.set(Math.PI / 2 + tilt, 0, tilt); ring.position.y = 1.35; inner.add(ring);
        const a = rg() * 6.28; SP(inner, 0.13, 0.13, 0.13, lam(c), Math.cos(a) * R, 1.35 + Math.sin(a) * R * Math.sin(tilt), Math.sin(a) * R * Math.cos(tilt), 0);
      }
      break;
    }
    case 'clock': {                                                // a tall case clock: a dark trunk, a window onto a brass pendulum, a cream face
      const wd = lam(0x3a2418), br = lam(0xb8923a, 0x2a2008);
      RB(inner, 0.7, 0.3, 0.5, wd, 0, 0.15, 0); RB(inner, 0.5, 1.5, 0.4, wd, 0, 1.05, 0); RB(inner, 0.7, 0.6, 0.5, wd, 0, 2.1, 0); RB(inner, 0.6, 0.1, 0.55, wd, 0, 2.5, 0);
      const face = C(inner, 0.22, 0.22, 0.03, lam(0xe6dcc0), 0, 2.1, 0.26, 20); face.rotation.x = Math.PI / 2;
      B(inner, 0.03, 0.18, 0.02, lam(0x1a1410), 0, 2.18, 0.285); B(inner, 0.12, 0.03, 0.02, lam(0x1a1410), 0.05, 2.1, 0.285);
      B(inner, 0.3, 1.0, 0.02, lam(0x1a1410), 0, 1.1, 0.205); C(inner, 0.012, 0.012, 0.9, br, 0, 1.2, 0.215, 5); C(inner, 0.09, 0.09, 0.02, br, 0, 0.75, 0.22, 12).rotation.x = Math.PI / 2;
      break;
    }
    case 'scrolltable': {                                          // a worktable strewn with scrolls, a map and an inkpot
      RB(inner, 1.7, 0.1, 0.95, wood, 0, 0.85, 0);
      for (const sx of [-0.75, 0.75]) for (const sz of [-0.35, 0.35]) LA(inner, [[0, 0], [0.06, 0], [0.045, 0.2], [0.055, 0.8], [0.0, 0.8]], wood2, sx, 0, sz, 8);
      B(inner, 0.7, 0.01, 0.5, lam(0xd8c898), 0.25, 0.91, 0.05, rg() * 0.6);
      for (let i = 0; i < 4; i++) { const sc = C(inner, 0.05, 0.05, 0.45 + rg() * 0.3, lam(0xe6dcb8), -0.6 + i * 0.12 + (rg() - 0.5) * 0.1, 0.96, -0.15 + (rg() - 0.5) * 0.3, 8); sc.rotation.z = Math.PI / 2; sc.rotation.y = rg() * 3; }
      LA(inner, [[0, 0], [0.05, 0], [0.065, 0.13], [0.06, 0.13], [0.0, 0.12]], lam(0x1a1a22), -0.3, 0.9, 0.3, 8);
      break;
    }
    case 'globe': {                                                // a globe in a brass meridian on a turned stand
      const br = lam(0xb8923a, 0x2a2008);
      LA(inner, [[0, 0], [0.3, 0], [0.2, 0.1], [0.08, 0.2], [0.08, 0.8], [0.0, 0.8]], lam(0x3a2418), 0, 0, 0, 12);
      SP(inner, 0.7, 0.7, 0.7, lam(0x2a5a8a), 0, 1.15, 0);
      for (let i = 0; i < 4; i++) { const a = rg() * 6.28, b = (rg() - 0.5) * 1.6; SP(inner, 0.22, 0.14, 0.22, lam(0x4a8a4a), Math.cos(a) * Math.cos(b) * 0.33, 1.15 + Math.sin(b) * 0.33, Math.sin(a) * Math.cos(b) * 0.33, 0); }
      const ring = new THREE.Mesh(cached('globering', () => new THREE.TorusGeometry(0.42, 0.02, 5, 24)), br); ring.position.y = 1.15; ring.rotation.z = 0.4; inner.add(ring);
      C(inner, 0.015, 0.015, 0.95, br, -0.08, 1.15, 0, 5).rotation.z = 0.4;
      break;
    }
    // ---- Goblin Market ----
    case 'stall': {                                                // a market stall (blocks the way): four posts, a striped canopy, a counter heaped with fruit, a sack and a lantern
      const wd = lam(0x6a4a2a), cl = [lam(0xa83a2a), lam(0xe8dcc0)], fr = [lam(0xc84a2a), lam(0xd8a030), lam(0x6a9a3a)];
      for (const sx of [-1, 1]) for (const sz of [-1, 1]) C(inner, 0.04, 0.05, 2.3, wd, sx * 0.9, 1.15, sz * 0.45, 6);
      RB(inner, 1.9, 0.08, 0.95, wd, 0, 0.85, 0.05); RB(inner, 1.9, 0.5, 0.06, lam(0x8a6a3a), 0, 0.58, 0.5);
      for (let i = 0; i < 6; i++) { const m = B(inner, 0.34, 0.04, 1.3, cl[i % 2], -0.85 + i * 0.34, 2.4, 0); m.rotation.x = 0.2; B(inner, 0.34, 0.2, 0.03, cl[i % 2], -0.85 + i * 0.34, 2.2, 0.64); }   // canopy and valance
      for (let i = 0; i < 9; i++) SP(inner, 0.2, 0.18, 0.2, fr[i % 3], -0.7 + (i % 5) * 0.2 + (i > 4 ? 0.1 : 0), i > 4 ? 1.1 : 0.97, 0.05 + (i % 2) * 0.12, 0);   // fruit in two rows
      SP(inner, 0.5, 0.5, 0.4, lam(0xa08a5a), -0.55, 0.28, 0.75); B(inner, 0.14, 0.2, 0.14, glow(0xffb050), 0.8, 2.05, 0.1);   // a sack on the ground, a lantern under the canopy
      break;
    }
    case 'awning': {                                               // a striped cloth awning hung from a wall, sloping down into the room (a wall decal)
      const cl = [lam(0xa83a2a), lam(0xe8dcc0)];
      for (let i = 0; i < 5; i++) { const m = B(inner, 0.5, 0.04, 1.15, cl[i % 2], -1 + i * 0.5, 2.5, 0.5); m.rotation.x = 0.5; B(inner, 0.5, 0.2, 0.03, cl[i % 2], -1 + i * 0.5, 2.12, 1.0); }
      break;
    }
    case 'festoon': {                                              // a string of pennants and lantern bulbs across the ceiling (emissive, not lights)
      const top = WALL_H / (d.scale || 1), cl = [lam(0xa83a2a), lam(0xe8dcc0), lam(0x2a6a4a), lam(0xc8a030)];
      C(inner, 0.01, 0.01, 3.0, iron, 0, top - 0.6, 0, 4).rotation.z = Math.PI / 2;
      for (let i = 0; i < 8; i++) { const x = -1.3 + i * 0.37, sag = 0.12 * Math.sin((x + 1.5) / 3 * Math.PI); B(inner, 0.2, 0.26, 0.02, cl[i % 4], x, top - 0.8 - sag, 0, 0, 0.1); if (i % 3 === 1) B(inner, 0.1, 0.12, 0.1, glow(0xffc060), x + 0.18, top - 0.72 - sag, 0); }
      break;
    }
    case 'crowd': {                                                // a busy patch: trampled straw, scuffed footprints and dropped coins (the Market's mechanic: the din masks your steps)
      const sm = lam(0xb89a58), fp = lam(0x3a2c1c), co = glow(0xe8c860);
      const st = new THREE.Mesh(cached('disc1', () => new THREE.CircleGeometry(1, 16)), sm); st.rotation.x = -Math.PI / 2; st.scale.set(1.35, 1.35, 1); st.position.y = 0.014; inner.add(st);
      for (let i = 0; i < 14; i++) SP(inner, 0.12, 0.02, 0.2, fp, (rg() - 0.5) * 2.2, 0.03, (rg() - 0.5) * 2.2, rg() * 3);
      for (let i = 0; i < 3; i++) SP(inner, 0.07, 0.02, 0.07, co, (rg() - 0.5) * 1.6, 0.035, (rg() - 0.5) * 1.6, 0);
      break;
    }
    // ---- Final Chamber ----
    case 'rpillar': {                                              // a rune pillar from the floor to the ceiling void: dark stone, glowing bands and rune strips (blocks the way)
      const H = WALL_H, stn = lam(0x3a2e4c), dk = lam(0x2a2038), gl = glow(0xa060ff);
      RB(inner, 1.5, 0.45, 1.5, stn, 0, 0.225, 0); RB(inner, 1.25, 0.2, 1.25, dk, 0, 0.55, 0);
      C(inner, 0.5, 0.58, H - 1.5, dk, 0, 0.65 + (H - 1.5) / 2, 0, 14);
      for (const y of [1.5, 3.4, H * 0.55]) C(inner, 0.62, 0.62, 0.12, gl, 0, y, 0, 14);
      for (let i = 0; i < 4; i++) { const a = i * Math.PI / 2 + 0.4; B(inner, 0.07, 2.4, 0.05, gl, Math.sin(a) * 0.56, 2.5, Math.cos(a) * 0.56, a); }
      RB(inner, 1.5, 0.4, 1.5, stn, 0, H - 0.2, 0);
      break;
    }
    case 'dais': {                                                 // a stepped dais under the boss: three low tiers of dark stone with glowing trim
      C(inner, 6.9, 7.0, 0.06, lam(0x2a2036), 0, 0.03, 0, 48); C(inner, 6.0, 6.1, 0.12, lam(0x352844), 0, 0.06, 0, 48); C(inner, 5.0, 5.1, 0.18, lam(0x1e1630), 0, 0.09, 0, 48);
      for (const [r0, r1, y] of [[5.9, 6.2, 0.125], [4.9, 5.1, 0.185]]) { const rm = new THREE.Mesh(cached(`dring${r0}`, () => new THREE.RingGeometry(r0, r1, 64)), glow(0xb070ff)); rm.rotation.x = -Math.PI / 2; rm.position.y = y; inner.add(rm); }
      break;
    }
    case 'runes': {                                                // the rune circle: rings, 12 spokes, a ring of glyph ticks and a six-pointed star, merged into ONE additive mesh (RUNE_MAT, pulsed by main.js), and two mist rings
      const tmp = new THREE.Group(), mats = {}, mat = c => mats[c] || (mats[c] = new THREE.MeshBasicMaterial({ color: c })), flat = (g, c, y = 0.02) => { const m = new THREE.Mesh(g, mat(c)); m.rotation.x = -Math.PI / 2; m.position.y = y; tmp.add(m); return m; };
      for (const [r0, r1, c] of [[20.4, 21.0, 0x9a5aff], [18.6, 18.9, 0x6a3ab8], [12.0, 12.3, 0x9a5aff], [9.0, 9.15, 0x6a3ab8]]) flat(cached(`rr${r0}`, () => new THREE.RingGeometry(r0, r1, 96)), c);
      const bar = (len, wid, c, a, rad, rot) => { const m = new THREE.Mesh(cached(`rune${len}|${wid}`, () => new THREE.PlaneGeometry(len, wid)), mat(c)); m.rotation.x = -Math.PI / 2; m.rotation.z = rot; m.position.set(Math.cos(a) * rad, 0.021, Math.sin(a) * rad); tmp.add(m); };
      for (let i = 0; i < 12; i++) { const a = i * Math.PI / 6; bar(9.2, 0.2, 0x6a3ab8, a, 13.8, -a); }                    // spokes between the 9 m and 18.4 m rings
      for (let i = 0; i < 48; i++) { const a = i * Math.PI / 24 + 0.03; bar(i % 2 ? 0.9 : 0.4, 0.12, 0xd8b0ff, a, 19.7, -a); }   // glyph ticks between the outer rings
      for (let k = 0; k < 2; k++) for (let i = 0; i < 3; i++) { const a = (i * 120 + k * 60) * Math.PI / 180; bar(27.7, 0.22, 0xb070ff, a, 8, -(a + Math.PI / 2)); }   // two triangles inscribed in a 16 m circle
      tmp.updateMatrixWorld(true);
      const b = { items: [], n: 0 }; tmp.traverse(o => { if (o.isMesh) { addItem(b, o, o.matrixWorld); } });
      inner.add(new THREE.Mesh(mergeItems(b.items, b.n), RUNE_MAT));
      for (const [r0, r1, y] of [[12, 22, 0.35], [5, 14, 0.9]]) {  // mist: a soft ring (black at the edges, violet in the middle, so additive blending fades it out)
        const g = new THREE.RingGeometry(r0, r1, 72, 2), col = new Float32Array(g.attributes.position.count * 3), per = 73;
        for (let v = 0; v < g.attributes.position.count; v++) if (Math.floor(v / per) === 1) { col[v * 3] = 0.3; col[v * 3 + 1] = 0.12; col[v * 3 + 2] = 0.5; }
        g.setAttribute('color', new THREE.BufferAttribute(col, 3)); g.rotateX(-Math.PI / 2);
        const m = new THREE.Mesh(g, MIST_MAT); m.position.y = y; inner.add(m);
      }
      break;
    }
    case 'bed': {
      RB(inner, 2.0, 0.3, 1.1, wood, 0, 0.17, 0);                                                    // frame
      RB(inner, 1.88, 0.14, 0.98, straw, 0, 0.4, 0);                                                 // straw tick
      RB(inner, 1.2, 0.09, 1.02, cloth(), 0.35, 0.5, 0);                                             // blanket
      SP(inner, 0.52, 0.16, 0.72, lam(0xd8d0b8), -0.7, 0.58, 0);                                     // a plump pillow
      RB(inner, 0.1, 0.75, 1.12, wood, -1.0, 0.45, 0);                                               // headboard
      for (const z of [0.5, -0.5]) LA(inner, [[0.0, 0], [0.05, 0], [0.04, 0.3], [0.06, 0.5], [0.0, 0.5]], wood, 1.0, 0, z, 8);   // turned foot posts
      if (rg() < 0.5) SP(inner, 0.4, 0.15, 0.5, leatherMat(), 1.35, 0.08, 0.3);                       // boots left by the bed
      break;
    }
    case 'puddle': {                                               // flooded floor (the Tavern): dark water filling most of the tile, with pale ripple rings
      const pm = new THREE.MeshBasicMaterial({ color: 0x24465e, transparent: true, opacity: 0.62, depthWrite: false }), rm = new THREE.MeshBasicMaterial({ color: 0x8ac0e0, transparent: true, opacity: 0.3, depthWrite: false });
      for (let i = 0; i < 3; i++) { const d = new THREE.Mesh(cached('disc1', () => new THREE.CircleGeometry(1, 16)), pm), r = 0.9 + rg() * 0.5; d.rotation.x = -Math.PI / 2; d.scale.set(r, r, 1); d.position.set((rg() - 0.5) * 0.9, 0.012 + i * 0.001, (rg() - 0.5) * 0.9); inner.add(d); }
      for (let i = 0; i < 2; i++) { const d = new THREE.Mesh(cached('ripple', () => new THREE.RingGeometry(0.55, 0.62, 20)), rm), r = 0.8 + i * 0.5; d.rotation.x = -Math.PI / 2; d.scale.set(r, r, 1); d.position.set((rg() - 0.5) * 0.6, 0.02, (rg() - 0.5) * 0.6); inner.add(d); }
      break;
    }
    case 'keg': {                                                  // an ale keg standing and another on its side, with a tap
      const kw = lam(0x6a4426);
      LA(inner, BARREL.map(([r, h]) => [r * 1.15, h * 1.2]), kw, -0.45, 0, -0.1, 12); for (const [y, r] of [[0.25, 0.4], [0.9, 0.42]]) TR(inner, r, 0.025, iron, -0.45, y, -0.1);
      const lk = C(inner, 0.4, 0.4, 0.95, kw, 0.5, 0.42, 0.1, 12); lk.rotation.x = Math.PI / 2; lk.rotation.z = 0.2;
      for (const z of [-0.25, 0.45]) { const h = C(inner, 0.415, 0.415, 0.05, iron, 0.5, 0.42, 0.1 + z * 0.9, 12); h.rotation.x = Math.PI / 2; }
      C(inner, 0.03, 0.03, 0.2, lam(0xc9a23a), 0.5, 0.35, 0.65, 6).rotation.x = Math.PI / 2;
      break;
    }
    case 'longtable': {                                            // a long plank table with a bench on each side, tankards and a spilled puddle
      RB(inner, 2.6, 0.1, 0.9, wood, 0, 0.85, 0); for (const sx of [-1.1, 1.1]) for (const sz of [-0.3, 0.3]) LA(inner, [[0, 0], [0.06, 0], [0.045, 0.2], [0.055, 0.8], [0.0, 0.8]], wood2, sx, 0, sz, 8);
      for (const z of [-0.75, 0.75]) { RB(inner, 2.4, 0.07, 0.3, wood2, 0, 0.46, z); for (const sx of [-1, 1]) B(inner, 0.07, 0.44, 0.24, wood2, sx, 0.22, z); }
      for (const x of [-0.8, -0.1, 0.6, 0.95]) { C(inner, 0.06, 0.05, 0.12, lam(0x9a8a6a), x, 0.96, (rg() - 0.5) * 0.5, 8); }
      SP(inner, 0.5, 0.02, 0.3, lam(0x3a2a14), 0.2, 0.905, 0.1, 0.3);
      break;
    }
    case 'lantern': {                                              // a lantern on a chain from the beams (emissive, not a light)
      const top = WALL_H / (d.scale || 1);
      C(inner, 0.012, 0.012, 0.9, iron, 0, top - 0.45, 0, 5); B(inner, 0.26, 0.04, 0.26, iron, 0, top - 0.95, 0); B(inner, 0.2, 0.3, 0.2, glow(0xffb050), 0, top - 1.12, 0); B(inner, 0.28, 0.04, 0.28, iron, 0, top - 1.3, 0);
      break;
    }
    case 'appletree': {                                            // a trunk and a round, dark canopy hung with apples
      const bark = lam(0x4a3422), lf = [lam(0x2f5a34), lam(0x386a3a), lam(0x27502e)];
      C(inner, 0.17, 0.26, 1.9, bark, 0, 0.95, 0, 8);
      for (const [x, y, z, s] of [[0, 2.5, 0, 2.3], [0.55, 2.3, 0.2, 1.5], [-0.5, 2.35, -0.3, 1.6], [0.1, 2.9, -0.2, 1.4]]) SP(inner, s, s * 0.8, s, lf[Math.floor(rg() * 3)], x, y, z, rg() * 3);
      for (let i = 0; i < 7; i++) { const a = rg() * 6.28; SP(inner, 0.14, 0.14, 0.14, lam(0xb02a2a), Math.cos(a) * 1.0, 2.0 + rg() * 0.5, Math.sin(a) * 1.0, 0); }
      break;
    }
    case 'hedge': {                                                // a clipped hedgerow along a wall
      const hm = [lam(0x2f5a2e), lam(0x386a36)];
      RB(inner, 2.4, 1.1, 0.8, hm[0], 0, 0.55, 0); for (let i = 0; i < 4; i++) SP(inner, 0.8, 0.5, 0.7, hm[i % 2], -0.9 + i * 0.6, 1.1, (rg() - 0.5) * 0.1);
      break;
    }
    case 'well': {                                                 // a stone well with a little roof on two posts and a bucket
      LA(inner, [[0.45, 0], [0.75, 0], [0.75, 0.8], [0.6, 0.8], [0.6, 0.2], [0.45, 0.2]], stone, 0, 0, 0, 14);
      const wm = new THREE.Mesh(cached('discw', () => new THREE.CircleGeometry(0.6, 14)), glow(0x1a3a52)); wm.rotation.x = -Math.PI / 2; wm.position.y = 0.6; inner.add(wm);
      for (const s of [-1, 1]) B(inner, 0.1, 1.7, 0.1, wood, s * 0.65, 1.5, 0); B(inner, 1.6, 0.1, 0.5, lam(0x4a3220), 0, 2.4, 0, 0, 0.12); B(inner, 1.6, 0.1, 0.5, lam(0x4a3220), 0, 2.4, 0, 0, -0.12);
      C(inner, 0.12, 0.1, 0.2, wood2, 0.2, 1.1, 0, 8);
      break;
    }
    case 'fruit': {                                                // windfalls: a few apples in the grass
      for (let i = 0; i < 5; i++) SP(inner, 0.15, 0.13, 0.15, lam(i % 2 ? 0xb02a2a : 0xc8b030), (rg() - 0.5) * 2.2, 0.07, (rg() - 0.5) * 2.2, 0);
      break;
    }
    case 'fireflies': {                                            // a drift of fireflies: tiny emissive specks (not lights)
      const fm = glow(0xd8ff70);
      for (let i = 0; i < 7; i++) B(inner, 0.05, 0.05, 0.05, fm, (rg() - 0.5) * 2.4, 0.5 + rg() * 1.6, (rg() - 0.5) * 2.4);
      break;
    }
    case 'moon': {                                                 // a pool of moonlight: pale blue discs on the grass (the Orchard's mechanic: it shows you up)
      const mm = new THREE.MeshBasicMaterial({ color: 0xb4c8ff, transparent: true, opacity: 0.22, depthWrite: false });
      for (let i = 0; i < 2; i++) { const m = new THREE.Mesh(cached('disc1', () => new THREE.CircleGeometry(1, 16)), mm), r = 1.5 - i * 0.6; m.rotation.x = -Math.PI / 2; m.scale.set(r, r, 1); m.position.y = 0.016 + i * 0.001; inner.add(m); }
      break;
    }
    case 'shade': {                                                // the shade under a tree: a soft dark disc (the Orchard's mechanic: it hides you)
      const sm = new THREE.Mesh(cached('darkdisc', () => new THREE.CircleGeometry(1.5, 16)), new THREE.MeshBasicMaterial({ color: 0x02060a, transparent: true, opacity: 0.5, depthWrite: false }));
      sm.rotation.x = -Math.PI / 2; sm.position.y = 0.018; inner.add(sm);
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
      break;
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
      break;
    }
    case 'weaponrack': {
      RB(inner, 1.4, 1.5, 0.08, wood, 0, 0.9, 0);
      RB(inner, 1.4, 0.07, 0.2, wood2, 0, 0.55, 0.1);
      for (let i = 0; i < 4; i++) RB(inner, 0.06, 0.9 + rg() * 0.5, 0.03, lam(0x9a9ea6), -0.5 + i * 0.33, 1.0, 0.12, 0, (rg() - 0.5) * 0.2);
      const sh = C(inner, 0.22, 0.22, 0.05, wood2, 0.45, 1.35, 0.12, 16); sh.rotation.x = Math.PI / 2;      // a round shield on the board
      SP(inner, 0.1, 0.1, 0.06, lam(0x9a9ea6), 0.45, 1.35, 0.17);                                       // its boss
      break;
    }
    case 'barrels': {
      const spots = [[-0.5, -0.2], [0.35, -0.3], [0.0, 0.35]];
      for (const [x, z] of spots) {
        LA(inner, BARREL.map(([r, h]) => [r * 0.88, h * 0.9]), wood, x, 0, z, 12);
        for (const [y, r] of [[0.18, 0.32], [0.62, 0.34]]) TR(inner, r, 0.02, iron, x, y, z);
      }
      RB(inner, 0.5, 0.05, 0.5, lam(0x3a2a18), 0.35, 0.87, -0.3, 0.4);                               // a board across one barrel
      break;
    }
    case 'crates': {
      RB(inner, 1.0, 1.0, 1.0, wood, -0.25, 0.5, 0);
      RB(inner, 0.8, 0.8, 0.8, wood, 0.5, 0.4, 0.15, 0.3);
      RB(inner, 0.7, 0.7, 0.7, wood, -0.15, 1.35, 0.05, 0.5);
      for (const [x, y, z] of [[-0.25, 0.5, 0.52], [0.5, 0.4, 0.58]]) { RB(inner, 0.9, 0.08, 0.03, wood2, x, y + 0.2, z); RB(inner, 0.9, 0.08, 0.03, wood2, x, y - 0.2, z); }   // slats
      SP(inner, 0.34, 0.2, 0.34, straw, 0.5, 0.85, 0.15);                                             // straw poking out
      break;
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
      break;
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
      break;
    }
    case 'bench': {                                                // a plain plank bench along a wall (the safe room)
      RB(inner, 1.6, 0.08, 0.4, wood2, 0, 0.45, 0);
      for (const x of [-0.65, 0.65]) RB(inner, 0.08, 0.43, 0.34, wood, x, 0.215, 0);
      break;
    }
    case 'cauldron': {
      for (const a of [0, 2.1, 4.2]) C(inner, 0.03, 0.05, 0.35, iron, Math.sin(a) * 0.4, 0.17, Math.cos(a) * 0.4, 6);
      LA(inner, [[0, 0.3], [0.3, 0.3], [0.5, 0.5], [0.58, 0.75], [0.52, 0.95], [0.46, 0.97], [0.0, 0.9]], iron, 0, 0, 0, 16);   // a pot-bellied cauldron
      TR(inner, 0.52, 0.045, iron, 0, 0.96, 0);                                                      // rim
      C(inner, 0.46, 0.46, 0.03, glow(0x40ff70), 0, 0.94, 0, 16);                                    // glowing brew
      for (let i = 0; i < 4; i++) SP(inner, 0.12, 0.06, 0.12, glow(0x8affaa), (rg() - 0.5) * 0.7, 0.96, (rg() - 0.5) * 0.7);   // bubbles
      C(inner, 0.025, 0.025, 0.95, wood2, 0.3, 1.2, 0.1, 6).rotation.z = 0.4;                         // stirring spoon
      for (let i = 0; i < 3; i++) C(inner, 0.05, 0.05, 0.25, lam(0x4a3018), 0.75 + i * 0.01, 0.07 + i * 0.1, 0.4 - i * 0.1, 6).rotation.z = Math.PI / 2;   // firewood
      break;
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
      break;
    }
    case 'sacks': {
      for (let i = 0; i < 2; i++) {
        const x = (i - 0.5) * 0.55, bag = lam(0xa08a5a);
        SP(inner, 0.52, 0.6, 0.44, bag, x, 0.3, (rg() - 0.5) * 0.2, rg() * 0.8);                       // a lumpy sack
        LA(inner, [[0.0, 0], [0.1, 0], [0.07, 0.08], [0.12, 0.16], [0.0, 0.16]], bag, x, 0.54, 0, 8);   // its gathered neck
        TR(inner, 0.085, 0.015, lam(0x6a5230), x, 0.56, 0);                                            // tie
      }
      break;
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
      break;
    }
    case 'urn': {
      const clay = lam(0x8a5a3a);
      LA(inner, [[0, 0], [0.16, 0], [0.26, 0.12], [0.29, 0.3], [0.22, 0.5], [0.12, 0.62], [0.15, 0.72], [0.17, 0.74], [0.0, 0.74]], clay, 0, 0, 0, 12);   // a belly and a flared neck
      TR(inner, 0.28, 0.02, lam(0x2a2a30), 0, 0.3, 0);                                                 // iron band
      for (const s of [-1, 1]) { const h = new THREE.Mesh(cached('urnh', () => new THREE.TorusGeometry(0.07, 0.015, 5, 10)), clay); h.position.set(s * 0.17, 0.55, 0); h.rotation.y = Math.PI / 2; inner.add(h); }   // handles
      break;
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
      break;
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
