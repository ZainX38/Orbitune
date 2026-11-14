// Building blocks for the things that stand on the planet (flora, rocks, landmark crystals, clouds).
// Stylised, not realistic: few triangles, but rounded and smooth-shaded, with colour baked into the vertices.

import * as THREE from 'three';
import { mergeVertices } from 'three/addons/utils/BufferGeometryUtils.js';
import { fbm } from './noise.js';

// A rounded, slightly lumpy blob (canopies, boulders, cloud puffs). Smooth normals.
//   detail: 1 = 80 triangles, 2 = 320.  lumps: 0 = a sphere ... 0.3 = clearly lumpy.  seed: a different blob per seed.
export function blob(radius = 1, detail = 1, lumps = 0.12, seed = 0) {
  let g = new THREE.IcosahedronGeometry(1, detail);
  g.deleteAttribute('uv');
  g.deleteAttribute('normal');
  g = mergeVertices(g, 1e-3); // neighbouring triangles share their vertices -> smooth normals
  const pos = g.attributes.position, v = new THREE.Vector3();
  for (let i = 0; i < pos.count; i++) {
    v.fromBufferAttribute(pos, i).normalize();
    const k = radius * (1 + lumps * 2 * fbm(v.x * 1.6 + seed * 3.1, v.y * 1.6 - seed * 1.7, v.z * 1.6 + seed, 2, 500 + seed));
    pos.setXYZ(i, v.x * k, v.y * k, v.z * k);
  }
  g.computeVertexNormals();
  return g;
}

// A shape turned on a lathe around +Y. profile: [[radius, y], ...] from the bottom up. sides: 6 = a hexagonal crystal.
export function lathe(profile, sides = 10) {
  const g = new THREE.LatheGeometry(profile.map(([r, y]) => new THREE.Vector2(Math.max(r, 1e-4), y)), sides);
  g.deleteAttribute('uv');
  return g;
}

// A pointed crystal shard standing on the origin: a hexagonal column with a slanted tip and a narrower foot.
export const shard = (radius, height, tip = 0.3) =>
  lathe([[0, 0], [radius * 0.72, 0], [radius, height * 0.18], [radius * 0.86, height * (1 - tip)], [0, height]], 6);

// One coloured piece of an object, ready for mergeGeometries.
//   glow: 0 = normal, 1 = lights up (and pulses on beats, see reactive.js).
//   shade: how much darker the bottom of the piece is than its top (a cheap, soft shadow that grounds it).
//   facet: true = flat faces (crystals). false = keep the smooth normals.
export function part(geometry, colour, glow = 0, { x = 0, y = 0, z = 0, rx = 0, ry = 0, rz = 0, sx = 1, sy = 1, sz = 1, shade = 0.3, facet = false } = {}) {
  const g = geometry.index ? geometry.toNonIndexed() : geometry.clone();
  g.deleteAttribute('uv');
  g.applyMatrix4(new THREE.Matrix4().compose(
    new THREE.Vector3(x, y, z),
    new THREE.Quaternion().setFromEuler(new THREE.Euler(rx, ry, rz)),
    new THREE.Vector3(sx, sy, sz)
  ));
  if (facet) g.computeVertexNormals(); // on separate triangles this gives one normal per face
  else g.normalizeNormals();

  const pos = g.attributes.position, n = pos.count;
  g.computeBoundingBox();
  const y0 = g.boundingBox.min.y, span = Math.max(g.boundingBox.max.y - y0, 1e-6);
  const colours = new Float32Array(n * 3), glows = new Float32Array(n).fill(glow);
  for (let i = 0; i < n; i++) {
    const k = 1 - shade + shade * 1.25 * ((pos.getY(i) - y0) / span); // bottom: 1 - shade. top: a little brighter than the colour
    colours.set([colour.r * k, colour.g * k, colour.b * k], i * 3);
  }
  g.setAttribute('color', new THREE.BufferAttribute(colours, 3));
  g.setAttribute('aGlow', new THREE.BufferAttribute(glows, 1));
  return g;
}
