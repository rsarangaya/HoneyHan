// Performance helpers. The game used to draw 1,000 to 1,400 meshes a frame (every plank, book and candle was its own
// mesh), which is what made it lag. Now:
//   mergeStatic: a floor's furniture and torches are merged into a few meshes per 24 m chunk and material.
//   bakeMeshes: a creature's parts are merged inside each animated group (legs, arms, torso and head), so it still animates.
//   updateCulling: chunks, props and creatures beyond the fog (nothing is visible past about 35 m) are not drawn.
//   adaptive resolution: if the frame rate drops, the render resolution does, and recovers when it can.
const PERF = { chunk: 24, cull: 38 };

// Materials that look the same are merged into one mesh.
const matKey = m => [m.type, m.color ? m.color.getHex() : 0, m.emissive ? m.emissive.getHex() : 0, m.transparent ? m.opacity : 1, m.side, m.shininess || 0, m.depthWrite].join('|');

// Concatenate geometries (position and normal, plus an optional colour per geometry baked in as vertex colours).
function mergeGeos(list, colors) {
  let n = 0; for (const g of list) n += g.attributes.position.count;
  const pos = new Float32Array(n * 3), nor = new Float32Array(n * 3), col = colors ? new Float32Array(n * 3) : null;
  let o = 0;
  list.forEach((g, gi) => {
    if (!g.attributes.normal) g.computeVertexNormals();
    pos.set(g.attributes.position.array, o * 3); nor.set(g.attributes.normal.array, o * 3);
    if (col) { const c = colors[gi]; for (let v = 0; v < g.attributes.position.count; v++) { col[(o + v) * 3] = c.r; col[(o + v) * 3 + 1] = c.g; col[(o + v) * 3 + 2] = c.b; } }
    o += g.attributes.position.count;
  });
  const m = new THREE.BufferGeometry();
  m.setAttribute('position', new THREE.BufferAttribute(pos, 3)); m.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
  if (col) m.setAttribute('color', new THREE.BufferAttribute(col, 3));
  m.computeBoundingSphere();
  return m;
}
const flat = g => (g.index ? g.toNonIndexed() : g.clone());

// One shared material per kind of surface (lit, glowing, emissive trim, see-through): the colour moves into the vertices,
// so a chunk needs 3 or 4 meshes instead of one per colour.
const MERGED_MATS = new Map();
function mergedMaterial(m) {
  const key = [m.type, m.emissive ? m.emissive.getHex() : 0, m.transparent ? m.opacity : 1, m.side, m.depthWrite].join('|');
  let mm = MERGED_MATS.get(key);
  if (!mm) {
    const params = { vertexColors: true, transparent: m.transparent, opacity: m.opacity, side: m.side, depthWrite: m.depthWrite };
    if (m.emissive) params.emissive = m.emissive.clone();
    mm = new m.constructor(params); MERGED_MATS.set(key, mm);
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
      let b = chunk.buckets.get(mm); if (!b) chunk.buckets.set(mm, b = { material: mm, geos: [], colors: [] });
      const g = flat(o.geometry); g.applyMatrix4(o.matrixWorld); b.geos.push(g); b.colors.push(o.material.color);
    });
    if (root.parent) root.parent.remove(root);
  }
  const out = [];
  for (const chunk of chunks.values()) {
    const grp = new THREE.Group();
    for (const b of chunk.buckets.values()) grp.add(new THREE.Mesh(mergeGeos(b.geos, b.colors), b.material));
    parent.add(grp);
    out.push({ group: grp, x: (chunk.cx + 0.5) * chunkSize, z: (chunk.cz + 0.5) * chunkSize });
  }
  return out;
}

// Merge the meshes inside one animated group (not those in `skip`, which animate on their own), in that group's own space.
// preferMats: materials the creature flashes on a hit; if a bucket contains one, it is the one the merged mesh uses.
function bakeMeshes(root, skip, preferMats) {
  root.updateMatrixWorld(true);
  const inv = new THREE.Matrix4().copy(root.matrixWorld).invert(), rel = new THREE.Matrix4();
  const buckets = new Map(), dead = [];
  const walk = o => {
    if (skip.has(o)) return;
    if (o.isMesh && o !== root && !Array.isArray(o.material)) {
      const key = matKey(o.material);
      let b = buckets.get(key);
      if (!b) buckets.set(key, b = { material: o.material, geos: [] });
      if (preferMats.includes(o.material)) b.material = o.material;
      const g = flat(o.geometry); g.applyMatrix4(rel.multiplyMatrices(inv, o.matrixWorld)); b.geos.push(g);
      dead.push(o);
      return;
    }
    for (const c of o.children) walk(c);
  };
  for (const c of root.children) walk(c);
  for (const o of dead) if (o.parent) o.parent.remove(o);
  for (const b of buckets.values()) root.add(new THREE.Mesh(mergeGeos(b.geos), b.material));
}

// Hide what is past the fog. chunks: from mergeStatic. Called every few frames and on arrival.
function updateCulling(player, chunks, props, enemies) {
  const px = player.x, pz = player.z, R = PERF.cull, R2 = R * R, RC = (R + PERF.chunk * 0.71) ** 2;
  for (const c of chunks) { const dx = c.x - px, dz = c.z - pz; c.group.visible = dx * dx + dz * dz < RC; }
  for (const o of props) { if (o.mesh) { const dx = o.x - px, dz = o.z - pz; o.mesh.visible = dx * dx + dz * dz < R2; } }
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
