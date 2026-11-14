// An icosphere whose neighbouring triangles SHARE their vertices.
//
// three's IcosahedronGeometry gives every triangle 3 vertices of its own. That is what flat shading wants, but for
// smooth shading the triangles around a point must use the same vertex, so its normal (and colour) is the average
// of all of them. BufferGeometryUtils.mergeVertices does this by rounding positions, which misses the odd pair
// that falls on two sides of a rounding step and leaves a visible crease there. This weld also looks in the
// neighbouring cell when a point is close to a step, so every copy is found.
//
//   const { directions, index } = createIcosphere(detail);
//   directions: Float32Array, 3 numbers per vertex, unit length.  index: Uint32Array, 3 vertices per triangle.

import * as THREE from 'three';

const CELL = 1e-3;  // far smaller than the gap between two vertices (0.016 at detail 64), far bigger than float error
const EDGE = 0.05;  // share of a cell that counts as "close to its edge"

export function createIcosphere(detail) {
  const src = new THREE.IcosahedronGeometry(1, detail).attributes.position;
  const cells = new Map();
  const directions = [];
  const index = new Uint32Array(src.count);
  const key = (i, j, k) => (i + 2048) + (j + 2048) * 4096 + (k + 2048) * 16777216;
  const v = new THREE.Vector3();
  const near = [[0], [0], [0]];

  for (let n = 0; n < src.count; n++) {
    v.fromBufferAttribute(src, n).normalize();
    const f = [v.x / CELL, v.y / CELL, v.z / CELL], base = f.map(Math.floor);
    for (let a = 0; a < 3; a++) {
      const frac = f[a] - base[a];
      near[a] = frac < EDGE ? [0, -1] : frac > 1 - EDGE ? [0, 1] : [0];
    }
    let found;
    for (const i of near[0]) for (const j of near[1]) for (const k of near[2]) {
      found ??= cells.get(key(base[0] + i, base[1] + j, base[2] + k));
    }
    if (found === undefined) {
      found = directions.length / 3;
      directions.push(v.x, v.y, v.z);
      cells.set(key(base[0], base[1], base[2]), found);
    }
    index[n] = found;
  }

  const expected = 10 * (detail + 1) ** 2 + 2;
  if (directions.length / 3 !== expected) console.warn(`[sphere] welded ${directions.length / 3} vertices, expected ${expected}`);
  return { directions: new Float32Array(directions), index };
}
