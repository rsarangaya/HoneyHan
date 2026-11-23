// Baked torch light. Every wall torch, hearth, candle and the stair glows used to be real point lights (the 4 nearest the player, swapped every other frame: they popped, and every light costs
// every lit pixel). Now the static light of a floor is computed ONCE when the floor is built into one small world-space texture (a "light grid": 0.5 m texels, top view, with a tile-grid line of
// sight so walls and closed doors stop it) and every Lambert and Phong material adds it (albedo * grid) in its shader: floors, ceilings, walls, merged furniture, props, creatures and the
// viewmodel all get the same light, per pixel or per vertex, with no light loop. The only real light left is the player's lantern.
// A shader reads the grid at the surface's world x, z (plus 0.35 m along its normal, so a wall face reads the open floor in front of it) and fades it above and below head height.
const BAKE_RES = 0.5, BAKE_DY2 = 1.0, BAKE_NL = 1.0, BAKE_SOFT = 0.12, BAKE_SCALE = 2;   // m per texel; vertical offset squared (m2); stand-in N.L; soft clamp (v / (1 + SOFT v)); texel 255 = SCALE
const BAKE = { map: { value: null }, par: { value: new THREE.Vector4(1, 1, 1, BAKE_SCALE) }, flick: 1 };   // par: 1/width, 1/depth (1/m), flicker, scale. Shared by every material, so switching floors is one assignment
BAKE.map.value = new THREE.DataTexture(new Uint8Array(4), 1, 1, THREE.RGBAFormat);   // no light at all until a floor sets its own
BAKE.map.needsUpdate = true;

// The patch every MeshLambertMaterial and MeshPhongMaterial compiles with (the prototype hook: no material needs to know). Both read `bakeMap` / `bakePar`.
const BAKE_PARS = 'uniform sampler2D bakeMap;\nuniform vec4 bakePar;\n';
const BAKE_VERT = `vec4 bkP = vec4( transformed, 1.0 ); vec3 bkN = objectNormal;
#ifdef USE_INSTANCING
bkP = instanceMatrix * bkP; bkN = mat3( instanceMatrix ) * bkN;
#endif
bkP = modelMatrix * bkP; bkN = normalize( mat3( modelMatrix ) * bkN );
vec2 bkUv = ( bkP.xz + bkN.xz * 0.35 ) * bakePar.xy;
float bkY = ( 1.0 - 0.45 * clamp( abs( bkP.y - 1.8 ) * 0.55, 0.0, 1.0 ) ) * ( 1.0 - clamp( ( bkP.y - 3.0 ) * 0.12, 0.0, 0.7 ) ) * bakePar.z * bakePar.w;
`;
function bakeLambert(shader) {   // per vertex (the material's own lighting is per vertex too): added to the ambient term
  shader.uniforms.bakeMap = BAKE.map; shader.uniforms.bakePar = BAKE.par;
  shader.vertexShader = shader.vertexShader
    .replace('#include <common>', '#include <common>\n' + BAKE_PARS)
    .replace('#include <project_vertex>', '#include <project_vertex>\n' + BAKE_VERT)
    .replace('#include <lights_lambert_vertex>', '#include <lights_lambert_vertex>\nvec3 bk = texture2D( bakeMap, bkUv ).rgb * ( bkY * PI );\nvIndirectFront += bk;\n#ifdef DOUBLE_SIDED\nvIndirectBack += bk;\n#endif');
}
function bakePhong(shader) {     // per pixel: the vertex shader passes the grid position, the fragment shader reads it
  shader.uniforms.bakeMap = BAKE.map; shader.uniforms.bakePar = BAKE.par;
  shader.vertexShader = shader.vertexShader
    .replace('#include <common>', '#include <common>\nuniform vec4 bakePar;\nvarying vec3 vBake;\n')
    .replace('#include <project_vertex>', '#include <project_vertex>\n' + BAKE_VERT + 'vBake = vec3( bkUv, bkY );\n');
  shader.fragmentShader = shader.fragmentShader
    .replace('#include <common>', '#include <common>\n' + BAKE_PARS + 'varying vec3 vBake;\n')
    .replace('#include <lights_fragment_end>', '#include <lights_fragment_end>\nreflectedLight.indirectDiffuse += texture2D( bakeMap, vBake.xy ).rgb * vBake.z * material.diffuseColor;');
}
THREE.MeshLambertMaterial.prototype.onBeforeCompile = bakeLambert;
THREE.MeshPhongMaterial.prototype.onBeforeCompile = bakePhong;

// ---- the bake ----
let bakeBuf = null;                                    // float scratch (r, g, b per texel), grown once and reused by every floor build
// lights: [{ lx, lz, y, color (hex), str, R (reach, m), decay }]. Returns { tex, w, h } for bakeUse; free it with bakeFree.
function bakeLights(fl, lights) {
  const w = fl.w, h = fl.h, tiles = fl.tiles, T = TILE, per = T / BAKE_RES, nx = w * per, ny = h * per, n3 = nx * ny * 3;
  if (!bakeBuf || bakeBuf.length < n3) bakeBuf = new Float32Array(n3); else bakeBuf.fill(0, 0, n3);
  const buf = bakeBuf, solid = new Uint8Array(w * h);                          // what stops light: walls and (closed) doors
  for (let i = 0; i < solid.length; i++) { const t = tiles[i]; solid[i] = t === T_WALL || t === T_DOOR || t === T_SAFEDOOR ? 1 : 0; }
  const blocked = (x, z) => { const tx = Math.floor(x / T), ty = Math.floor(z / T); return tx < 0 || ty < 0 || tx >= w || ty >= h || solid[ty * w + tx] === 1; };
  const los = (ax, az, bx, bz) => {                    // 1 m steps along the segment, the light's own tile and the end tile excluded
    const dx = bx - ax, dz = bz - az, d = Math.hypot(dx, dz), k = Math.ceil(d);
    const t0x = Math.floor(ax / T), t0z = Math.floor(az / T), t1x = Math.floor(bx / T), t1z = Math.floor(bz / T);
    for (let i = 1; i < k; i++) {
      const x = ax + dx * i / k, z = az + dz * i / k, tx = Math.floor(x / T), tz = Math.floor(z / T);
      if ((tx === t0x && tz === t0z) || (tx === t1x && tz === t1z)) continue;
      if (blocked(x, z)) return false;
    }
    return true;
  };
  const OFF = [[0, 0], [-0.35, -0.35], [0.35, -0.35], [-0.35, 0.35], [0.35, 0.35]];
  for (const L of lights) {
    const R = L.R || 14, R2 = R * R, dec = L.decay === undefined ? 1.5 : L.decay, rt = Math.ceil(R / T) + 1;
    const cr = (L.color >> 16 & 255) / 255 * L.str * BAKE_NL, cg = (L.color >> 8 & 255) / 255 * L.str * BAKE_NL, cb = (L.color & 255) / 255 * L.str * BAKE_NL;
    const cx = Math.floor(L.lx / T), cz = Math.floor(L.lz / T);
    for (let ty = Math.max(0, cz - rt); ty <= Math.min(h - 1, cz + rt); ty++) for (let tx = Math.max(0, cx - rt); tx <= Math.min(w - 1, cx + rt); tx++) {
      if (solid[ty * w + tx]) continue;
      const mx = tx * T + T / 2, mz = ty * T + T / 2, ex = Math.max(Math.abs(mx - L.lx) - T / 2, 0), ez = Math.max(Math.abs(mz - L.lz) - T / 2, 0);
      if (ex * ex + ez * ez >= R2) continue;
      let seen = 5;                                     // 5 sight lines per tile: all seen = no per-texel test, none = skip, some = a test per texel (soft doorway edges)
      if (!(tx === cx && ty === cz)) { seen = 0; for (let i = 0; i < 5; i++) if (los(L.lx, L.lz, mx + OFF[i][0] * T, mz + OFF[i][1] * T)) seen++; }
      if (!seen) continue;
      for (let j = 0; j < per; j++) for (let i = 0; i < per; i++) {
        const px = tx * T + (i + 0.5) * BAKE_RES, pz = ty * T + (j + 0.5) * BAKE_RES, dx = px - L.lx, dz = pz - L.lz, d2 = dx * dx + dz * dz + BAKE_DY2;
        if (d2 >= R2) continue;
        if (seen < 5 && !los(L.lx, L.lz, px, pz)) continue;
        const f = 1 - Math.sqrt(d2) / R, v = dec === 1 ? f : dec === 1.5 ? f * Math.sqrt(f) : Math.pow(f, dec), o = ((ty * per + j) * nx + tx * per + i) * 3;
        buf[o] += cr * v; buf[o + 1] += cg * v; buf[o + 2] += cb * v;
      }
    }
  }
  const u8 = new Uint8Array(nx * ny * 4), k = 255 / BAKE_SCALE;
  for (let i = 0, o = 0, p = 0; i < nx * ny; i++, p += 3, o += 4) {
    const r = buf[p], g = buf[p + 1], b = buf[p + 2];
    u8[o] = Math.min(255, r / (1 + BAKE_SOFT * r) * k + 0.5); u8[o + 1] = Math.min(255, g / (1 + BAKE_SOFT * g) * k + 0.5); u8[o + 2] = Math.min(255, b / (1 + BAKE_SOFT * b) * k + 0.5); u8[o + 3] = 255;
  }
  const tex = new THREE.DataTexture(u8, nx, ny, THREE.RGBAFormat);
  tex.magFilter = tex.minFilter = THREE.LinearFilter; tex.generateMipmaps = false; tex.needsUpdate = true;
  return { tex, w, h };
}
function bakeUse(b) { BAKE.map.value = b.tex; BAKE.par.value.x = 1 / (b.w * TILE); BAKE.par.value.y = 1 / (b.h * TILE); }
function bakeFree(b) { if (b) b.tex.dispose(); }
function bakeFlicker(now) { BAKE.par.value.z = 0.96 + Math.sin(now / 110) * 0.03 + Math.sin(now / 37) * 0.015; }   // the torches' flicker: one cheap uniform, no per-vertex work
