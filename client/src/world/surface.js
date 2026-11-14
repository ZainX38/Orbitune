// The exact height of the ground MESH in any direction.
//
// Why: the analytic height function (terrain.js) is only sampled at the mesh vertices. Between them the mesh is
// flat triangles about 1 unit wide, and the function has detail finer than that (ridge crests, the shoreline kink),
// so the two disagreed by up to 0.8 units. Anything placed with the function then floated above or sank into the
// ground that is actually drawn: trees, and above all the player, whose eyes are only ~0.6 above it.
// This lookup answers "where is the drawn ground?" instead, so what stands on it touches it everywhere.
//
//   const surface = createSurface(geometry.attributes.position, RADIUS);
//   surface.getHeight(direction)   // direction: unit THREE.Vector3, planet space -> height above RADIUS
//
// How: the triangles are sorted into a grid on the 6 faces of a cube around the planet. A query looks only at the
// few triangles in its grid cell, finds the one the direction passes through, and intersects it.

const GRID = 48;    // cells per cube face edge: about 10 triangles per cell at ~52k triangles
const REACH = 0.3;  // a triangle is filed under a cube face if all its corners are at least this far "in front" of it

// The 6 cube faces: [major axis, sign, the two other axes]
const FACES = [[0, 1, 1, 2], [0, -1, 1, 2], [1, 1, 0, 2], [1, -1, 0, 2], [2, 1, 0, 1], [2, -1, 0, 1]];
const cellOf = (t) => Math.max(0, Math.min(GRID - 1, Math.floor((t * 0.5 + 0.5) * GRID)));

export function createSurface(position, radius) {
  const p = position.array; // non-indexed: 9 numbers per triangle
  const triangles = p.length / 9;
  const cells = Array.from({ length: 6 * GRID * GRID }, () => []);

  // ---------- Build: file every triangle under each cell it may cover ----------
  for (let t = 0; t < triangles; t++) {
    const o = t * 9;
    for (let f = 0; f < 6; f++) {
      const [axis, sign, ua, va] = FACES[f];
      let minU = Infinity, maxU = -Infinity, minV = Infinity, maxV = -Infinity, front = true;
      for (let k = 0; k < 3; k++) {
        const x = p[o + k * 3], y = p[o + k * 3 + 1], z = p[o + k * 3 + 2];
        const major = p[o + k * 3 + axis] * sign;
        if (major < REACH * Math.hypot(x, y, z)) { front = false; break; }
        const u = p[o + k * 3 + ua] / major, v = p[o + k * 3 + va] / major;
        minU = Math.min(minU, u); maxU = Math.max(maxU, u); minV = Math.min(minV, v); maxV = Math.max(maxV, v);
      }
      if (!front || minU > 1 || maxU < -1 || minV > 1 || maxV < -1) continue;
      for (let i = cellOf(minU); i <= cellOf(maxU); i++) {
        for (let j = cellOf(minV); j <= cellOf(maxV); j++) cells[(f * GRID + i) * GRID + j].push(o);
      }
    }
  }

  // ---------- Query ----------
  function getHeight(dir) {
    const d = [dir.x, dir.y, dir.z];
    const ax = Math.abs(d[0]), ay = Math.abs(d[1]), az = Math.abs(d[2]);
    const axis = ax >= ay && ax >= az ? 0 : ay >= az ? 1 : 2;
    const f = axis * 2 + (d[axis] < 0 ? 1 : 0);
    const [, , ua, va] = FACES[f];
    const major = Math.abs(d[axis]);
    const cell = cells[(f * GRID + cellOf(d[ua] / major)) * GRID + cellOf(d[va] / major)];

    // The triangle whose 3 edge planes (through the planet's centre) all have `dir` on the inside.
    // Exactly on an edge the numbers can come out a hair negative for both neighbours: then the least-outside one wins.
    let best = -1, bestInside = -Infinity;
    for (let n = 0; n < cell.length; n++) {
      const o = cell[n];
      const x0 = p[o], y0 = p[o + 1], z0 = p[o + 2], x1 = p[o + 3], y1 = p[o + 4], z1 = p[o + 5], x2 = p[o + 6], y2 = p[o + 7], z2 = p[o + 8];
      const e0 = d[0] * (y0 * z1 - z0 * y1) + d[1] * (z0 * x1 - x0 * z1) + d[2] * (x0 * y1 - y0 * x1);
      const e1 = d[0] * (y1 * z2 - z1 * y2) + d[1] * (z1 * x2 - x1 * z2) + d[2] * (x1 * y2 - y1 * x2);
      const e2 = d[0] * (y2 * z0 - z2 * y0) + d[1] * (z2 * x0 - x2 * z0) + d[2] * (x2 * y0 - y2 * x0);
      const inside = Math.min(e0, e1, e2);
      if (inside > bestInside) { bestInside = inside; best = o; if (inside >= 0) break; }
    }
    if (best < 0) return 0; // cannot happen on a closed mesh

    // Where the ray from the centre along `dir` crosses that triangle's plane
    const x0 = p[best], y0 = p[best + 1], z0 = p[best + 2];
    const ux = p[best + 3] - x0, uy = p[best + 4] - y0, uz = p[best + 5] - z0;
    const vx = p[best + 6] - x0, vy = p[best + 7] - y0, vz = p[best + 8] - z0;
    const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
    return (nx * x0 + ny * y0 + nz * z0) / (nx * d[0] + ny * d[1] + nz * d[2]) - radius;
  }

  return { getHeight };
}
