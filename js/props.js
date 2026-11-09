// Procedural models for lootable props, furniture and locked doors (stand-ins until real art).
// Local frame: the model's +z faces into the room and its back is at -z, so objects on a room's
// edge tile are pushed toward the wall and face the interior.
const PROP_R = { chest: 0.6, barrel: 0.45, rubble: 0.5, rack: 0.7, potions: 0.7, pantry: 0.7, vaultchest: 0.65 };
const DECOR_R = { bed: 0.85, bookshelf: 0.8, weaponrack: 0.55, barrels: 0.8, crates: 0.8, table: 0.9, hearth: 0.9, cauldron: 0.75,
  sacks: 0.45, altar: 0.85, statue: 0.45, candles: 0.2, urn: 0.28, counter: 0.95, puddle: 0, rug: 0, bones: 0, banner: 0, chandelier: 0, beam: 0 };
// How far toward the wall each kind sits when it is on an edge tile (a tile is 3 m, so the wall is 1.5 m out).
const EDGE_SHIFT = { chest: 0.85, barrel: 0.8, rubble: 0.6, rack: 1.05, potions: 1.1, pantry: 1.1, vaultchest: 0.85,
  bed: 0.85, bookshelf: 1.2, weaponrack: 1.3, barrels: 0.7, crates: 0.6, hearth: 1.05, cauldron: 0.6, sacks: 0.8, statue: 0.8, banner: 1.46, candles: 0.9, urn: 1.0 };
// Decor that glows: the light pool borrows these.
const DECOR_LIGHT = { hearth: { color: 0xff8a30, y: 0.9, str: 1.15 }, cauldron: { color: 0x50ff80, y: 1.0, str: 0.8 },
  candles: { color: 0xffcc70, y: 0.5, str: 0.45 }, altar: { color: 0xffd070, y: 1.3, str: 0.6 },
  chandelier: { color: 0xffc060, y: 2.4, str: 1.0 } };   // main.js uses the decor's own ly / ls for scaled (boss arena) ones

const lam = (c, emissive) => new THREE.MeshLambertMaterial(emissive === undefined ? { color: c } : { color: c, emissive });
const glow = c => new THREE.MeshBasicMaterial({ color: c });
function B(parent, w, h, d, mat, x, y, z, ry = 0, rz = 0) {
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
  m.position.set(x, y, z); m.rotation.y = ry; m.rotation.z = rz; parent.add(m); return m;
}
function C(parent, rt, rb, h, mat, x, y, z, seg = 10) {
  const m = new THREE.Mesh(new THREE.CylinderGeometry(rt, rb, h, seg), mat);
  m.position.set(x, y, z); parent.add(m); return m;
}

// Wraps a model in a group placed on its tile, turned to face the room and shifted toward the wall if it is on an edge.
function placeOnTile(inner, tx, ty, yaw, shift) {
  const mesh = new THREE.Group();
  const x0 = (tx + 0.5) * TILE, z0 = (ty + 0.5) * TILE;
  inner.position.z = -shift;
  mesh.add(inner);
  mesh.position.set(x0, 0, z0); mesh.rotation.y = yaw;
  return { mesh, x: x0 - Math.sin(yaw) * shift, z: z0 - Math.cos(yaw) * shift };
}

// ---- lootable props ----
function makeProp(p) {
  const inner = new THREE.Group();
  const o = { p, mesh: null, x: 0, z: 0, r: PROP_R[p.kind], lid: null, mats: [] };
  const mat = (c, em) => { const m = lam(c, em); o.mats.push(m); return m; };
  const rg = makeRng(p.seed);
  const wood = new THREE.Color(theme.wall).multiplyScalar(0.8).getHex();
  if (p.kind === 'chest' || p.kind === 'vaultchest') {
    const vault = p.kind === 'vaultchest';
    const s = vault ? 1.18 : 1;
    const base = B(inner, 1.0 * s, 0.5 * s, 0.65 * s, mat(vault ? 0x3a3a4a : 0x6a4422), 0, 0.25 * s, 0);
    const pivot = new THREE.Group(); pivot.position.set(0, 0.5 * s, -0.325 * s);                // lid hinges on the back edge
    B(pivot, 1.04 * s, 0.18 * s, 0.69 * s, mat(vault ? 0x4a4a5c : 0x8a5a2c), 0, 0.09 * s, 0.325 * s);
    const trim = new THREE.MeshLambertMaterial({ color: 0xc9a23a, emissive: 0x2a2008 });
    B(inner, 0.12 * s, 0.62 * s, 0.7 * s, trim, -0.3 * s, 0.3 * s, 0); B(inner, 0.12 * s, 0.62 * s, 0.7 * s, trim, 0.3 * s, 0.3 * s, 0);
    B(inner, 0.14, 0.14, 0.05, trim, 0, 0.5 * s, 0.34 * s);                                       // lock plate
    if (p.holdsKey) B(inner, 0.05, 0.05, 0.05, glow(0xffe060), 0, 0.5 * s + 0.12, 0.34 * s);        // a faint spark on the chest that holds a key
    inner.add(pivot); o.lid = pivot;
  } else if (p.kind === 'barrel') {
    C(inner, 0.4, 0.34, 0.95, mat(wood), 0, 0.475, 0, 12);
    for (const y of [0.2, 0.7]) C(inner, 0.42, 0.42, 0.06, lam(0x3a3a3a), 0, y, 0, 12);
    C(inner, 0.36, 0.36, 0.03, mat(0x2a1a10), 0, 0.96, 0, 12);                                    // lid
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
      B(inner, 0.5, 0.6, 0.28, mat(0x6a6e78, 0x101014), 0, 1.2, -0.1);                              // breastplate
      B(inner, 0.7, 0.12, 0.28, steel, 0, 1.45, -0.1);                                              // pauldrons
      B(inner, 0.3, 0.3, 0.3, steel, 0, 1.72, -0.1);                                                // helm
      B(inner, 0.52, 0.26, 0.26, mat(0x4a4e58), 0, 0.82, -0.1);                                     // tassets
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
        if (pick === 0) B(inner, 0.26, 0.13, 0.16, mat(0xc79a58), x, y, 0, (rg() - 0.5) * 0.4);                 // loaf
        else if (pick === 1) B(inner, 0.2, 0.12, 0.18, mat(0xf0d060), x, y, 0, (rg() - 0.5) * 0.4);             // cheese
        else if (pick === 2) { const a = new THREE.Mesh(new THREE.SphereGeometry(0.075, 6, 5), mat(0xc8493a)); a.position.set(x, y + 0.02, 0); inner.add(a); }   // apple
        else B(inner, 0.05, 0.22, 0.05, mat(0x8a4030), x, y + 0.05, 0.05);                                      // sausage
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
  const flame = (parent, x, y, z, s = 1) => B(parent, 0.07 * s, 0.11 * s, 0.07 * s, glow(0xffb040), x, y, z);

  switch (d.kind) {
    case 'bed': {
      B(inner, 2.0, 0.35, 1.1, wood, 0, 0.18, 0);                                                    // frame
      B(inner, 1.9, 0.16, 1.0, straw, 0, 0.43, 0);                                                   // straw tick
      B(inner, 1.25, 0.07, 1.04, cloth(), 0.35, 0.55, 0);                                            // blanket
      B(inner, 0.5, 0.13, 0.7, lam(0xd8d0b8), -0.7, 0.58, 0);                                        // pillow
      B(inner, 0.1, 0.75, 1.1, wood, -1.0, 0.45, 0);                                                 // headboard
      B(inner, 0.08, 0.5, 0.08, wood, 1.0, 0.25, 0.5); B(inner, 0.08, 0.5, 0.08, wood, 1.0, 0.25, -0.5);
      if (rg() < 0.5) B(inner, 0.4, 0.15, 0.5, leatherMat(), 1.35, 0.08, 0.3);                       // boots left by the bed
      break;
    }
    case 'puddle': {                                               // a flat, glossy patch of shallow water
      const pm = new THREE.MeshBasicMaterial({ color: 0x3a6a9a, transparent: true, opacity: 0.55 });
      for (let i = 0; i < 3; i++) { const d = new THREE.Mesh(new THREE.CircleGeometry(0.5 + rg() * 0.5, 14), pm); d.rotation.x = -Math.PI / 2; d.position.set((rg() - 0.5) * 0.9, 0.012 + i * 0.001, (rg() - 0.5) * 0.9); inner.add(d); }
      break;
    }
    case 'counter': {                                              // the merchant's counter: planks, coins, scales and a lantern
      B(inner, 2.0, 0.95, 0.75, wood, 0, 0.475, 0);
      B(inner, 2.1, 0.08, 0.85, wood2, 0, 0.99, 0);
      B(inner, 1.9, 0.05, 0.05, lam(0x2a1c10), 0, 0.2, 0.38);
      for (let i = 0; i < 4; i++) C(inner, 0.07, 0.07, 0.025 + i * 0.012, lam(0xe8c860), -0.7 + (i % 2) * 0.12, 1.05 + i * 0.01, 0.18 - (i >> 1) * 0.1, 8);    // coin stacks
      B(inner, 0.5, 0.03, 0.05, iron, 0.25, 1.35, 0.1); B(inner, 0.02, 0.3, 0.02, iron, 0.25, 1.2, 0.1);                                                  // scales
      C(inner, 0.17, 0.17, 0.02, lam(0xb8bcc4), 0.02, 1.07, 0.12, 12); C(inner, 0.17, 0.17, 0.02, lam(0xb8bcc4), 0.5, 1.07, 0.12, 12);
      for (const x of [-0.1, 0.75]) B(inner, 0.22, 0.2, 0.22, lam(0x6a4a2a), x, 1.13, -0.15);                                                              // goods crates
      flame(inner, -0.95, 1.2, -0.25); C(inner, 0.02, 0.02, 0.18, iron, -0.95, 1.1, -0.25, 6);
      break;
    }
    case 'bookshelf': {
      B(inner, 1.8, 2.3, 0.45, wood, 0, 1.15, 0);
      for (let row = 0; row < 4; row++) {
        const y = 0.35 + row * 0.55;
        B(inner, 1.7, 0.05, 0.42, wood2, 0, y, 0.02);
        for (let i = 0, x = -0.75; i < 8 && x < 0.8; i++) {
          const wd = 0.1 + rg() * 0.1;
          if (rg() < 0.12) { x += 0.2; continue; }                                                   // a gap
          const c = new THREE.Color().setHSL(rg(), 0.45, 0.28 + rg() * 0.15);
          B(inner, wd, 0.36 + rg() * 0.08, 0.28, lam(c.getHex()), x + wd / 2, y + 0.22, 0.05, 0, rg() < 0.1 ? 0.3 : 0);
          x += wd + 0.02;
        }
      }
      break;
    }
    case 'weaponrack': {
      B(inner, 1.4, 1.5, 0.08, wood, 0, 0.9, 0);
      B(inner, 1.4, 0.07, 0.2, wood2, 0, 0.55, 0.1);
      for (let i = 0; i < 4; i++) B(inner, 0.06, 0.9 + rg() * 0.5, 0.03, lam(0x9a9ea6), -0.5 + i * 0.33, 1.0, 0.12, 0, (rg() - 0.5) * 0.2);
      B(inner, 0.42, 0.42, 0.04, wood2, 0.45, 1.35, 0.1);                                           // a round shield on the board
      break;
    }
    case 'barrels': {
      const spots = [[-0.5, -0.2], [0.35, -0.3], [0.0, 0.35]];
      for (const [x, z] of spots) {
        C(inner, 0.35, 0.3, 0.85, wood, x, 0.425, z, 10);
        for (const y of [0.18, 0.65]) C(inner, 0.37, 0.37, 0.05, iron, x, y, z, 10);
      }
      B(inner, 0.5, 0.05, 0.5, lam(0x3a2a18), 0.35, 0.87, -0.3, 0.4);                                // a board across one barrel
      break;
    }
    case 'crates': {
      B(inner, 1.0, 1.0, 1.0, wood, -0.25, 0.5, 0);
      B(inner, 0.8, 0.8, 0.8, wood, 0.5, 0.4, 0.15, 0.3);
      B(inner, 0.7, 0.7, 0.7, wood, -0.15, 1.35, 0.05, 0.5);
      for (const [x, y, z] of [[-0.25, 0.5, 0.505], [0.5, 0.4, 0.57]]) B(inner, 0.9, 0.08, 0.02, wood2, x, y, z);   // slats
      B(inner, 0.3, 0.2, 0.3, straw, 0.5, 0.85, 0.15);                                                // straw poking out
      break;
    }
    case 'table': {
      B(inner, 1.7, 0.1, 0.95, wood, 0, 0.85, 0);
      for (const sx of [-0.75, 0.75]) for (const sz of [-0.35, 0.35]) B(inner, 0.1, 0.85, 0.1, wood2, sx, 0.425, sz);
      for (const x of [-0.45, 0.35]) { C(inner, 0.13, 0.13, 0.02, lam(0xb0a890), x, 0.91, 0.18, 10); B(inner, 0.12, 0.06, 0.1, lam(0x9a6a3a), x + 0.04, 0.95, 0.18); }   // plates and crusts
      C(inner, 0.06, 0.05, 0.13, lam(0x8a7a5a), -0.1, 0.96, -0.2, 8); C(inner, 0.06, 0.05, 0.13, lam(0x8a7a5a), 0.55, 0.96, -0.25, 8);   // mugs
      C(inner, 0.03, 0.03, 0.16, bone, 0.1, 0.98, 0.0, 6); flame(inner, 0.1, 1.1, 0.0);              // a candle stub
      for (const [x, z, ry] of [[-0.5, 0.85, 0.15], [0.55, 0.9, -0.3], [0.1, -0.9, 3.2]]) {          // stools pushed back
        B(inner, 0.4, 0.06, 0.4, wood2, x, 0.46, z, ry);
        for (const [lx, lz] of [[-0.15, -0.15], [0.15, -0.15], [-0.15, 0.15], [0.15, 0.15]]) B(inner, 0.05, 0.43, 0.05, wood2, x + lx, 0.22, z + lz, ry);
      }
      break;
    }
    case 'hearth': {
      B(inner, 1.9, 1.5, 0.7, stone, 0, 0.75, 0);
      B(inner, 1.1, 0.75, 0.4, lam(0x0a0806), 0, 0.5, 0.18);                                         // firebox
      B(inner, 2.1, 0.12, 0.85, dstone, 0, 1.55, 0.02);                                              // mantel
      B(inner, 0.7, 0.4, 0.04, glow(0xff6a20), 0, 0.42, 0.3);                                        // embers
      B(inner, 0.5, 0.55, 0.25, glow(0xffa040), 0, 0.5, 0.25); B(inner, 0.3, 0.35, 0.2, glow(0xffe080), 0, 0.45, 0.28);
      B(inner, 0.7, 0.09, 0.09, lam(0x4a3018), 0, 0.1, 0.3, 0.2); B(inner, 0.6, 0.09, 0.09, lam(0x3a2410), 0, 0.2, 0.28, -0.3);
      C(inner, 0.07, 0.07, 0.25, bone, -0.7, 1.7, 0.1, 6);                                           // candle stub on the mantel
      break;
    }
    case 'cauldron': {
      for (const a of [0, 2.1, 4.2]) B(inner, 0.08, 0.35, 0.08, iron, Math.sin(a) * 0.4, 0.17, Math.cos(a) * 0.4);
      C(inner, 0.55, 0.45, 0.7, iron, 0, 0.62, 0, 14);
      C(inner, 0.6, 0.6, 0.07, iron, 0, 0.98, 0, 14);
      C(inner, 0.5, 0.5, 0.03, glow(0x40ff70), 0, 0.97, 0, 14);                                      // glowing brew
      for (let i = 0; i < 4; i++) C(inner, 0.05 + rg() * 0.04, 0.05, 0.03, glow(0x8affaa), (rg() - 0.5) * 0.7, 0.99, (rg() - 0.5) * 0.7, 6);   // bubbles
      B(inner, 0.05, 0.9, 0.05, wood2, 0.3, 1.2, 0.1, 0, -0.4);                                       // stirring spoon
      for (let i = 0; i < 3; i++) B(inner, 0.12, 0.08, 0.1, lam(0x4a3018), 0.75 + i * 0.01, 0.05 + i * 0.07, 0.4 - i * 0.1);   // firewood
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
      for (let i = 0; i < 4 + rg() * 3; i++) B(inner, 0.04 + rg() * 0.04, 0.03, 0.2 + rg() * 0.25, bone, (rg() - 0.5) * 1.2, 0.03, (rg() - 0.5) * 1.2, rg() * 3);
      if (rg() < 0.7) {
        B(inner, 0.2, 0.18, 0.22, bone, (rg() - 0.5) * 0.6, 0.1, (rg() - 0.5) * 0.6, rg() * 3);       // skull
        B(inner, 0.05, 0.05, 0.02, lam(0x120c08), 0.0, 0.12, 0.0);
      }
      break;
    }
    case 'sacks': {
      for (let i = 0; i < 2; i++) {
        const x = (i - 0.5) * 0.55, bag = lam(0xa08a5a);
        B(inner, 0.5, 0.55, 0.4, bag, x, 0.28, (rg() - 0.5) * 0.2, rg() * 0.8);
        B(inner, 0.22, 0.12, 0.2, bag, x, 0.6, 0);
        B(inner, 0.24, 0.04, 0.22, lam(0x6a5230), x, 0.54, 0);                                        // tie
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
    case 'beam': {         // a wooden ceiling beam across a room, d.len metres long, d.alongZ turns it
      B(inner, d.len, 0.28, 0.3, wood, 0, WALL_H - 0.14, 0, d.alongZ ? Math.PI / 2 : 0);
      break;
    }
    case 'urn': {
      const clay = lam(0x8a5a3a);
      C(inner, 0.28, 0.2, 0.55, clay, 0, 0.28, 0, 10); C(inner, 0.14, 0.26, 0.16, clay, 0, 0.62, 0, 10);
      C(inner, 0.17, 0.15, 0.05, lam(0x5a3a24), 0, 0.72, 0, 10);
      B(inner, 0.4, 0.04, 0.4, lam(0x2a2a30), 0, 0.3, 0, 0.4);                                         // iron band
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
      B(inner, 1.5, 0.85, 0.8, stone, 0, 0.43, 0);
      B(inner, 1.7, 0.1, 0.95, dstone, 0, 0.9, 0);
      B(inner, 0.5, 0.02, 0.95, lam(0x8a2a2a), 0, 0.96, 0);                                           // runner
      for (const x of [-0.6, 0.6]) { C(inner, 0.04, 0.045, 0.3, bone, x, 1.12, 0, 6); flame(inner, x, 1.3, 0); }
      C(inner, 0.07, 0.05, 0.18, lam(0xc9a23a, 0x2a2008), 0, 1.05, 0.1, 8);                          // goblet
      B(inner, 0.18, 0.3, 0.18, lam(0xc9a23a, 0x2a2008), 0, 1.12, -0.2);                              // small idol
      break;
    }
    case 'statue': {
      B(inner, 0.7, 0.5, 0.7, dstone, 0, 0.25, 0);
      B(inner, 0.38, 1.0, 0.28, stone, 0, 1.0, 0);
      B(inner, 0.28, 0.3, 0.28, stone, 0, 1.65, 0);
      B(inner, 0.12, 0.6, 0.12, stone, -0.28, 1.1, 0.1, 0, 0.3); B(inner, 0.12, 0.6, 0.12, stone, 0.28, 1.1, 0.1, 0, -0.3);
      B(inner, 0.06, 0.8, 0.06, lam(0x9a9ea6), 0.3, 1.0, 0.25, 0, -0.1);                              // a sword in one hand
      break;
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
