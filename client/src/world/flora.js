// Stylised low-poly flora. The Blueprint's `flora` names (free text from Gemini) pick 2-3 of the shapes below.
// One InstancedMesh per shape. Plants sway with the mids and the glowing ones pulse on beats (see reactive.js).

import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { RADIUS } from './terrain.js';
import { fbm, makeRng } from './noise.js';

const UP = new THREE.Vector3(0, 1, 0);

// ---------- Building blocks ----------
// One coloured piece of a plant. glow: 0 = normal, 1 = lights up (and pulses on beats).
function part(geometry, colour, glow, { x = 0, y = 0, z = 0, rx = 0, rz = 0, sx = 1, sy = 1, sz = 1 } = {}) {
  const g = geometry.index ? geometry.toNonIndexed() : geometry.clone();
  g.deleteAttribute('uv');
  g.applyMatrix4(new THREE.Matrix4().compose(
    new THREE.Vector3(x, y, z),
    new THREE.Quaternion().setFromEuler(new THREE.Euler(rx, 0, rz)),
    new THREE.Vector3(sx, sy, sz)
  ));
  const n = g.attributes.position.count;
  const colours = new Float32Array(n * 3), glows = new Float32Array(n).fill(glow);
  for (let i = 0; i < n; i++) colours.set([colour.r, colour.g, colour.b], i * 3);
  g.setAttribute('color', new THREE.BufferAttribute(colours, 3));
  g.setAttribute('aGlow', new THREE.BufferAttribute(glows, 1));
  return g;
}

// ---------- Shapes (base at the origin, +Y up, about 2-3 units tall) ----------
const SHAPES = {
  pine: {
    match: /pine|fir|spruce|conifer|cedar|evergreen/,
    heights: [0.6, 8], scale: [0.7, 1.4],
    build: (pal) => mergeGeometries([
      part(new THREE.CylinderGeometry(0.1, 0.16, 0.7, 5), pal.trunk, 0, { y: 0.35 }),
      part(new THREE.ConeGeometry(0.8, 1.1, 6), pal.foliage, 0, { y: 1.1 }),
      part(new THREE.ConeGeometry(0.62, 1.0, 6), pal.foliage.clone().offsetHSL(0, 0, 0.04), 0, { y: 1.7 }),
      part(new THREE.ConeGeometry(0.42, 0.9, 6), pal.foliage.clone().offsetHSL(0, 0, 0.08), 0, { y: 2.3 }),
    ]),
  },
  blossom: {
    match: /blossom|bloom|flower|rose|cherry|sakura|bush|petal|magnolia/,
    heights: [0.5, 5.5], scale: [0.7, 1.3],
    build: (pal) => mergeGeometries([
      part(new THREE.CylinderGeometry(0.09, 0.15, 1.2, 5), pal.trunk, 0, { y: 0.6, rz: 0.08 }),
      part(new THREE.IcosahedronGeometry(0.8, 0), pal.blossom, 0.12, { y: 1.75, sy: 0.85 }),
      part(new THREE.IcosahedronGeometry(0.55, 0), pal.blossom.clone().offsetHSL(0.02, 0, 0.07), 0.12, { x: 0.55, y: 1.45, z: 0.2 }),
      part(new THREE.IcosahedronGeometry(0.5, 0), pal.blossom.clone().offsetHSL(-0.02, 0, -0.05), 0.12, { x: -0.45, y: 1.4, z: -0.3 }),
    ]),
  },
  palm: {
    match: /palm|frond|coconut|fern/,
    heights: [0.3, 3], scale: [0.8, 1.4],
    build: (pal) => {
      const leaf = pal.foliage.clone().lerp(pal.peaks, 0.35);
      const parts = [
        part(new THREE.CylinderGeometry(0.08, 0.13, 1.3, 5), pal.trunk, 0, { y: 0.65, rz: 0.1 }),
        part(new THREE.CylinderGeometry(0.06, 0.08, 1.2, 5), pal.trunk, 0, { x: -0.19, y: 1.85, rz: 0.2 }),
      ];
      for (let i = 0; i < 6; i++) { // fronds: flat cones drooping outwards from the top
        const a = (i / 6) * Math.PI * 2;
        const frond = part(new THREE.ConeGeometry(0.22, 1.5, 4), i % 2 ? leaf : leaf.clone().offsetHSL(0, 0, 0.06), 0, { y: 0.75, sz: 0.25 });
        frond.applyMatrix4(new THREE.Matrix4().makeRotationZ(-1.95));        // tip out and down
        frond.applyMatrix4(new THREE.Matrix4().makeRotationY(a));
        frond.applyMatrix4(new THREE.Matrix4().makeTranslation(-0.31, 2.4, 0));
        parts.push(frond);
      }
      return mergeGeometries(parts);
    },
  },
  crystal: {
    match: /crystal|shard|spire|gem|glass|quartz|prism|neon/,
    heights: [0.8, 12], scale: [0.6, 1.6],
    build: (pal) => mergeGeometries([
      part(new THREE.OctahedronGeometry(1, 0), pal.peaks, 1, { y: 1.3, sx: 0.32, sy: 1.5, sz: 0.32 }),
      part(new THREE.OctahedronGeometry(1, 0), pal.peaks.clone().offsetHSL(0.05, 0, -0.05), 1, { x: 0.4, y: 0.7, rz: -0.45, sx: 0.22, sy: 0.9, sz: 0.22 }),
      part(new THREE.OctahedronGeometry(1, 0), pal.peaks.clone().offsetHSL(-0.06, 0, 0.05), 1, { x: -0.3, y: 0.55, z: 0.2, rz: 0.5, rx: 0.3, sx: 0.18, sy: 0.7, sz: 0.18 }),
    ]),
  },
  mushroom: {
    match: /mushroom|fung|shroom|toadstool|spore|lantern|bulb/,
    heights: [0.3, 4.5], scale: [0.6, 1.5],
    build: (pal, colours) => {
      const cap = colours.atmosphere.clone().lerp(pal.peaks, 0.3);
      return mergeGeometries([
        part(new THREE.CylinderGeometry(0.1, 0.16, 1.2, 6), pal.sand, 0.15, { y: 0.6 }),
        part(new THREE.ConeGeometry(0.75, 0.55, 7), cap, 1, { y: 1.4 }),
        part(new THREE.CylinderGeometry(0.75, 0.6, 0.12, 7), cap.clone().offsetHSL(0, 0, 0.12), 1, { y: 1.08 }),
      ]);
    },
  },
  reed: {
    match: /reed|grass|cane|bamboo|stalk|wheat|rush|sax/,
    heights: [0.25, 3.5], scale: [0.7, 1.5],
    build: (pal) => {
      const stalk = pal.peaks.clone().lerp(pal.ground, 0.35), head = pal.peaks.clone().offsetHSL(0, 0.1, 0.05);
      const parts = [];
      [[0, 0, 2.0, 0], [0.22, 0.1, 1.5, -0.14], [-0.18, 0.15, 1.7, 0.12], [0.05, -0.22, 1.3, 0.05]].forEach(([x, z, h, lean]) => {
        parts.push(part(new THREE.CylinderGeometry(0.035, 0.05, h, 4), stalk, 0, { x, z, y: h / 2, rz: lean }));
        parts.push(part(new THREE.OctahedronGeometry(0.13, 0), head, 0.5, { x: x - Math.sin(lean) * h, z, y: h, sy: 2.2 }));
      });
      return mergeGeometries(parts);
    },
  },
};
const FALLBACK = ['pine', 'blossom', 'reed'];
const SHARE = [0.45, 0.33, 0.22]; // first flora name gets the most plants

// Blueprint flora names -> up to 3 different shapes
export function pickShapes(floraNames = []) {
  const picked = [];
  for (const name of floraNames) {
    const key = Object.keys(SHAPES).find((k) => SHAPES[k].match.test(String(name).toLowerCase()));
    if (key && !picked.includes(key)) picked.push(key);
  }
  for (const key of FALLBACK) if (picked.length < 2 && !picked.includes(key)) picked.push(key);
  return picked.slice(0, 3);
}

export function createFlora(terrain, blueprint, pal, colours, reactive, total = 950) {
  const group = new THREE.Group();
  const kinds = pickShapes(blueprint.flora);
  const material = reactive.patch(new THREE.MeshStandardMaterial({ vertexColors: true, flatShading: true, roughness: 0.85 }), 'flora');

  const m = new THREE.Matrix4(), q = new THREE.Quaternion(), spin = new THREE.Quaternion(), s = new THREE.Vector3();
  const dir = new THREE.Vector3(), near = new THREE.Vector3(), p = new THREE.Vector3();
  const placedLog = [];

  kinds.forEach((kind, index) => {
    const shape = SHAPES[kind];
    const count = Math.round(total * SHARE[index] / SHARE.slice(0, kinds.length).reduce((a, b) => a + b, 0));
    const rng = makeRng(terrain.seed + 99 + index * 1013);
    const mesh = new THREE.InstancedMesh(shape.build(pal, colours), material, count);
    let placed = 0, tries = 0;

    while (placed < count && tries < count * 40) {
      tries++;
      dir.set(rng() * 2 - 1, rng() * 2 - 1, rng() * 2 - 1);
      if (dir.lengthSq() > 1 || dir.lengthSq() < 0.01) continue; // uniform directions
      dir.normalize();
      // Groves: each shape grows in its own patches (low-frequency noise), not evenly everywhere
      if (fbm(dir.x * 2.6, dir.y * 2.6, dir.z * 2.6, 2, terrain.seed + 300 + index * 57) < -0.04 && rng() > 0.12) continue;
      const h = terrain.getHeight(dir);
      const above = h - terrain.seaLevel;
      if (above < shape.heights[0] || above > shape.heights[1]) continue;
      // Not on steep ground: compare with the height a short step away
      near.copy(dir).addScaledVector(UP, 0.012).normalize();
      const stepUp = Math.abs(terrain.getHeight(near) - h);
      near.set(dir.x + dir.z * 0.012, dir.y, dir.z - dir.x * 0.012).normalize();
      if (stepUp > 0.42 || Math.abs(terrain.getHeight(near) - h) > 0.42) continue;

      p.copy(dir).multiplyScalar(RADIUS + h - 0.12); // slightly sunk, so no gaps on slopes
      q.setFromUnitVectors(UP, dir).multiply(spin.setFromAxisAngle(UP, rng() * Math.PI * 2));
      const k = shape.scale[0] + rng() * (shape.scale[1] - shape.scale[0]);
      s.set(k, k * (0.85 + rng() * 0.3), k);
      m.compose(p, q, s);
      mesh.setMatrixAt(placed++, m);
    }
    mesh.count = placed;
    mesh.instanceMatrix.needsUpdate = true;
    mesh.frustumCulled = false; // instances are all around the planet
    group.add(mesh);
    placedLog.push(`${placed} ${kind}`);
  });

  console.log('[flora]', (blueprint.flora ?? []).join(', ') || '(no names)', '->', placedLog.join(', '));
  return { group, kinds };
}
