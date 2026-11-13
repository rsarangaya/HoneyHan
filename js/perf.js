// Performance helpers. The game used to draw 1,000 to 1,400 meshes a frame (every plank, book and candle was its own
// mesh), which is what made it lag. Now:
//   mergeStatic: a floor's furniture and torches are merged into a few meshes per 24 m chunk and material.
//   bakeMeshes: a creature's parts are merged inside each animated group (legs, arms, torso and head), so it still animates.
//   updateCulling: chunks, props and creatures beyond the fog (nothing is visible past about 35 m) are not drawn.
//   adaptive resolution: if the frame rate drops, the render resolution does, and recovers when it can.
const PERF = { chunk: 24, cull: 38 };


// Merge items [{ g, cnt, mat4, color }] (cnt = vertices after un-indexing) into one geometry with position, normal and vertex colour,
// transformed by each item's matrix. Reads the source geometries directly: no per-part clones (this runs for every prop and
// creature of a floor, so it is most of the floor-build time).
const _bm = new THREE.Matrix4(), _bn = new THREE.Matrix3(), _bi = new THREE.Matrix4();
function mergeItems(items, n) {
  const pos = new Float32Array(n * 3), nor = new Float32Array(n * 3), col = new Float32Array(n * 3);
  let o = 0;
  for (const it of items) {
    _bm.copy(it.mat4); _bn.getNormalMatrix(_bm);
    const g = it.g, ix = g.index ? g.index.array : null, pa = g.attributes.position.array, na = g.attributes.normal.array, c = it.color;
    const m = _bm.elements, q = _bn.elements, cr = c.r, cg = c.g, cb = c.b;
    for (let k = 0; k < it.cnt; k++, o++) {
      const vi = (ix ? ix[k] : k) * 3, x = pa[vi], y = pa[vi + 1], z = pa[vi + 2], o3 = o * 3;
      pos[o3] = m[0] * x + m[4] * y + m[8] * z + m[12]; pos[o3 + 1] = m[1] * x + m[5] * y + m[9] * z + m[13]; pos[o3 + 2] = m[2] * x + m[6] * y + m[10] * z + m[14];
      const nx = na[vi], ny = na[vi + 1], nz = na[vi + 2];
      const tx = q[0] * nx + q[3] * ny + q[6] * nz, ty = q[1] * nx + q[4] * ny + q[7] * nz, tz = q[2] * nx + q[5] * ny + q[8] * nz, il = 1 / (Math.sqrt(tx * tx + ty * ty + tz * tz) || 1);
      nor[o3] = tx * il; nor[o3 + 1] = ty * il; nor[o3 + 2] = tz * il;
      col[o3] = cr; col[o3 + 1] = cg; col[o3 + 2] = cb;
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3)); geo.setAttribute('normal', new THREE.BufferAttribute(nor, 3)); geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
  geo.computeBoundingSphere();
  return geo;
}
// Add mesh o (placed by matrix `mat`) to a bucket { items, n }.
function addItem(b, o, mat) {
  const g = o.geometry; if (!g.attributes.normal) g.computeVertexNormals();
  const cnt = g.index ? g.index.count : g.attributes.position.count;
  b.items.push({ g, cnt, mat4: new THREE.Matrix4().copy(mat), color: o.material.color }); b.n += cnt;
}

// One shared material per kind of surface (lit, glowing, emissive trim, see-through): the colour moves into the vertices,
// so a chunk needs 3 or 4 meshes instead of one per colour.
const MERGED_MATS = new Map();
function mergedMaterial(m) {
  const key = [m.type, m.emissive ? m.emissive.getHex() : 0, m.transparent ? m.opacity : 1, m.side, m.depthWrite].join('|');
  let mm = MERGED_MATS.get(key);
  if (!mm) {
    const params = { vertexColors: true, transparent: m.transparent, opacity: m.opacity, side: m.side, depthWrite: m.depthWrite };
    if (m.emissive) params.emissive = m.emissive.clone();
    mm = new m.constructor(params); mm.userData.shared = true; MERGED_MATS.set(key, mm);   // shared by every floor and creature: never disposed with a floor
  }
  return mm;
}

// Merge the meshes under each root into one mesh per (24 m chunk, kind of surface), added to `parent`; the roots are
// detached. Returns the chunks as [{ group, x, z }] (x, z = the chunk centre) for culling.
function mergeStatic(roots, parent, chunkSize = PERF.chunk) {
  const chunks = new Map();
  for (const root of roots) {
    root.updateMatrixWorld(true);
    const cx = Math.floor(root.position.x / chunkSize), cz = Math.floor(root.position.z / chunkSize), ck = cx + ',' + cz;
    let chunk = chunks.get(ck); if (!chunk) chunks.set(ck, chunk = { cx, cz, buckets: new Map() });
    root.traverse(o => {
      if (!o.isMesh || o.isInstancedMesh || Array.isArray(o.material) || o.material.map) return;
      const mm = mergedMaterial(o.material);
      let b = chunk.buckets.get(mm); if (!b) chunk.buckets.set(mm, b = { material: mm, items: [], n: 0 });
      addItem(b, o, o.matrixWorld);
    });
    if (root.parent) root.parent.remove(root);
  }
  const out = [];
  for (const chunk of chunks.values()) {
    const grp = new THREE.Group();
    for (const b of chunk.buckets.values()) grp.add(new THREE.Mesh(mergeItems(b.items, b.n), b.material));
    parent.add(grp);
    out.push({ group: grp, x: (chunk.cx + 0.5) * chunkSize, z: (chunk.cz + 0.5) * chunkSize });
  }
  return out;
}

// Merge the meshes inside one animated group (not those in `skip`, which animate on their own), in that group's own space.
// Colours go into the vertices, so a group is one mesh per kind of surface instead of one per colour. Plain lit opaque parts all
// share ctx.flash, a material owned by this one creature (made on first use): the creature flashes on a hit by setting its emissive.
// ctx: one per creature, { flash: null }. Geometries are read straight into the merged buffers (no clones).
const _bm2 = new THREE.Matrix4();
function bakeMeshes(root, skip, ctx) {
  root.updateMatrixWorld(true);
  _bi.copy(root.matrixWorld).invert();
  const buckets = new Map(), dead = [];
  const walk = o => {
    if (skip.has(o)) return;
    if (o.isMesh && o !== root && !Array.isArray(o.material)) {
      const m = o.material;
      const mat = m.isMeshLambertMaterial && !m.transparent && m.side === THREE.FrontSide && m.emissive.getHex() === 0 ? (ctx.flash || (ctx.flash = new THREE.MeshLambertMaterial({ vertexColors: true }))) : mergedMaterial(m);
      let b = buckets.get(mat); if (!b) buckets.set(mat, b = { material: mat, items: [], n: 0 });
      addItem(b, o, _bm2.multiplyMatrices(_bi, o.matrixWorld));
      dead.push(o);
      return;
    }
    for (const c of o.children) walk(c);
  };
  for (const c of root.children) walk(c);
  for (const o of dead) if (o.parent) o.parent.remove(o);
  for (const b of buckets.values()) root.add(new THREE.Mesh(mergeItems(b.items, b.n), b.material));
}

// Hide what is past the fog. chunks: from mergeStatic. Called every few frames and on arrival.
function updateCulling(player, chunks, props, enemies) {
  const px = player.x, pz = player.z, R = PERF.cull, R2 = R * R, RC = (R + PERF.chunk * 0.71) ** 2;
  for (const c of chunks) { const dx = c.x - px, dz = c.z - pz; c.group.visible = dx * dx + dz * dz < RC; }
  for (const o of props) { if (o.mesh && !o.gone) { const dx = o.x - px, dz = o.z - pz; o.mesh.visible = dx * dx + dz * dz < R2; } }
  for (const e of enemies) { const dx = e.x - px, dz = e.z - pz; e.mesh.visible = dx * dx + dz * dz < R2; }
}

// Adaptive resolution: watch the average frame time and trade pixels for frame rate.
const quality = { max: Math.min(window.devicePixelRatio || 1, 1.5), cur: Math.min(window.devicePixelRatio || 1, 1.5), acc: 0, n: 0 };
function adaptQuality(dt, apply) {
  if (dt > 0.25) return;                                   // a hiccup (a tab switch, a floor change) is not the frame rate
  quality.acc += dt; quality.n++;
  if (quality.n < 90) return;
  const avg = quality.acc / quality.n * 1000; quality.acc = 0; quality.n = 0;
  if (avg > 26 && quality.cur > 0.6) { quality.cur = Math.max(0.6, quality.cur - 0.2); apply(quality.cur); }
  else if (avg < 15 && quality.cur < quality.max) { quality.cur = Math.min(quality.max, quality.cur + 0.2); apply(quality.cur); }
}
