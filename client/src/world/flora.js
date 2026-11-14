// Stylised flora: rounded, smooth-shaded shapes, halfway between realistic and cartoon.
// The Blueprint's `flora` names (free text from Gemini) pick 2-3 of the shapes below.
// One InstancedMesh per shape. Every plant has its own size, turn, lean and colour tint.
// Plants sway with the mids and the glowing ones pulse on beats (see reactive.js).

import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { RADIUS } from './terrain.js';
import { fbm, makeRng } from './noise.js';
import { blob, lathe, shard, part } from './shapes.js';

const UP = new THREE.Vector3(0, 1, 0);

// ---------- Building blocks ----------
// A trunk that is wider at the foot and flares a little into the ground
const trunk = (radius, height) => lathe([[radius * 1.7, 0], [radius * 1.15, height * 0.12], [radius, height * 0.45], [radius * 0.72, height]], 7);
// One tier of a conifer: a soft cone with a rounded skirt
const tier = (radius, height) => lathe([[radius * 0.35, 0], [radius * 0.9, height * 0.02], [radius, height * 0.14], [radius * 0.78, height * 0.36], [radius * 0.42, height * 0.7], [radius * 0.08, height]], 9);

// ---------- Shapes (base at the origin, +Y up, about 2-3 units tall) ----------
const SHAPES = {
  pine: {
    match: /pine|fir|spruce|conifer|cedar|evergreen/,
    heights: [0.6, 8], scale: [0.7, 1.4],
    build: (pal) => {
      const dark = pal.foliage.clone().offsetHSL(0, 0, -0.03);
      return mergeGeometries([
        part(trunk(0.11, 1.0), pal.trunk, 0, { shade: 0.35 }),
        part(tier(0.86, 1.15), dark, 0, { y: 0.6 }),
        part(tier(0.68, 1.05), pal.foliage, 0, { y: 1.2, ry: 0.6 }),
        part(tier(0.5, 0.95), pal.foliage.clone().offsetHSL(0, 0, 0.04), 0, { y: 1.75, ry: 1.3 }),
        part(tier(0.32, 0.8), pal.foliage.clone().offsetHSL(0, 0, 0.08), 0, { y: 2.25, ry: 2.1 }),
      ]);
    },
  },
  blossom: {
    match: /blossom|bloom|flower|rose|cherry|sakura|bush|petal|magnolia/,
    heights: [0.5, 5.5], scale: [0.7, 1.3],
    build: (pal) => mergeGeometries([
      part(trunk(0.1, 1.35), pal.trunk, 0, { rz: 0.08, shade: 0.35 }),
      part(blob(0.82, 2, 0.14, 1), pal.blossom, 0.1, { y: 1.85, sy: 0.82 }),
      part(blob(0.56, 1, 0.14, 2), pal.blossom.clone().offsetHSL(0.02, 0, 0.06), 0.1, { x: 0.58, y: 1.5, z: 0.22 }),
      part(blob(0.52, 1, 0.14, 3), pal.blossom.clone().offsetHSL(-0.02, 0, -0.05), 0.1, { x: -0.48, y: 1.45, z: -0.3 }),
      part(blob(0.46, 1, 0.14, 4), pal.blossom.clone().offsetHSL(0.01, 0, 0.02), 0.1, { x: -0.05, y: 1.55, z: 0.55 }),
    ]),
  },
  palm: {
    match: /palm|frond|coconut|fern/,
    heights: [0.3, 3], scale: [0.8, 1.4],
    build: (pal) => {
      const leaf = pal.foliage.clone().lerp(pal.peaks, 0.35);
      const parts = [
        part(trunk(0.1, 1.35), pal.trunk, 0, { rz: 0.1, shade: 0.35 }),
        part(lathe([[0.075, 0], [0.07, 0.6], [0.055, 1.2]], 7), pal.trunk, 0, { x: -0.13, y: 1.3, rz: 0.2, shade: 0.1 }),
        part(blob(0.16, 1, 0.05, 5), pal.trunk.clone().offsetHSL(0, 0, -0.04), 0, { x: -0.37, y: 2.5 }),
      ];
      for (let i = 0; i < 7; i++) { // fronds: long flat leaves arching outwards and down from the top
        const a = (i / 7) * Math.PI * 2;
        const frond = part(blob(1, 1, 0.04, 6), i % 2 ? leaf : leaf.clone().offsetHSL(0, 0, 0.06), 0, { x: 0.72, sx: 0.78, sy: 0.07, sz: 0.2, shade: 0 });
        frond.applyMatrix4(new THREE.Matrix4().makeRotationZ(-0.42 - 0.16 * (i % 3))); // droop
        frond.applyMatrix4(new THREE.Matrix4().makeRotationY(a));
        frond.applyMatrix4(new THREE.Matrix4().makeTranslation(-0.37, 2.52, 0));
        parts.push(frond);
      }
      return mergeGeometries(parts);
    },
  },
  crystal: {
    match: /crystal|shard|spire|gem|glass|quartz|prism|neon/,
    heights: [0.8, 12], scale: [0.6, 1.6],
    build: (pal) => mergeGeometries([
      part(shard(0.3, 2.7, 0.24), pal.peaks, 1, { facet: true, shade: 0.45 }),
      part(shard(0.2, 1.7, 0.28), pal.peaks.clone().offsetHSL(0.05, 0, -0.05), 1, { x: 0.3, rz: -0.42, ry: 0.5, facet: true, shade: 0.45 }),
      part(shard(0.17, 1.3, 0.3), pal.peaks.clone().offsetHSL(-0.06, 0, 0.05), 1, { x: -0.24, z: 0.16, rz: 0.48, rx: 0.3, facet: true, shade: 0.45 }),
      part(shard(0.12, 0.8, 0.35), pal.peaks.clone().offsetHSL(0.02, 0, 0.08), 1, { x: 0.05, z: -0.28, rx: -0.5, ry: 1, facet: true, shade: 0.45 }),
    ]),
  },
  mushroom: {
    match: /mushroom|fung|shroom|toadstool|spore|lantern|bulb/,
    heights: [0.3, 4.5], scale: [0.6, 1.5],
    build: (pal, colours) => {
      const cap = colours.atmosphere.clone().lerp(pal.peaks, 0.3);
      return mergeGeometries([
        part(lathe([[0.2, 0], [0.13, 0.25], [0.1, 0.8], [0.14, 1.2]], 8), pal.sand, 0.15, { shade: 0.35 }),
        // Cap: a dome with a rolled rim, and a paler underside
        part(lathe([[0.3, 1.1], [0.78, 1.04], [0.86, 1.14], [0.74, 1.36], [0.46, 1.56], [0.02, 1.64]], 12), cap, 1, { shade: 0.15 }),
        part(lathe([[0.02, 1.16], [0.3, 1.1], [0.78, 1.04]], 12), cap.clone().offsetHSL(0, 0, 0.12), 0.6, { shade: 0 }),
      ]);
    },
  },
  reed: {
    match: /reed|grass|cane|bamboo|stalk|wheat|rush|sax/,
    heights: [0.25, 3.5], scale: [0.7, 1.5],
    build: (pal) => {
      const stalk = pal.peaks.clone().lerp(pal.ground, 0.35), head = pal.peaks.clone().offsetHSL(0, 0.1, 0.05);
      const parts = [];
      [[0, 0, 2.0, 0], [0.22, 0.1, 1.5, -0.14], [-0.18, 0.15, 1.7, 0.12], [0.05, -0.22, 1.3, 0.05], [-0.1, -0.12, 1.1, -0.08]].forEach(([x, z, h, lean], i) => {
        parts.push(part(lathe([[0.055, 0], [0.04, h * 0.5], [0.028, h]], 5), stalk, 0, { x, z, rz: lean, shade: 0.4 }));
        parts.push(part(blob(0.1, 1, 0.08, 7 + i), head, 0.5, { x: x - Math.sin(lean) * h, z, y: h * Math.cos(lean), sy: 2.4, shade: 0.15 }));
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
  const material = reactive.patch(new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.82, metalness: 0 }), 'flora');

  const m = new THREE.Matrix4(), q = new THREE.Quaternion(), spin = new THREE.Quaternion(), lean = new THREE.Quaternion(), s = new THREE.Vector3();
  const dir = new THREE.Vector3(), near = new THREE.Vector3(), p = new THREE.Vector3(), axis = new THREE.Vector3(), tint = new THREE.Color();
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

      const k = shape.scale[0] + rng() * (shape.scale[1] - shape.scale[0]);
      // h is the exact mesh height under the trunk's centre. Sink the base by what its own width can hang over
      // the downhill side of the steepest slope allowed above, so there is never a gap under it.
      p.copy(dir).multiplyScalar(RADIUS + h - 0.14 * k);
      // Local "up" at this spot, then the plant's own turn, then a small lean (up to ~5 degrees) so no two stand alike
      const turn = rng() * Math.PI * 2;
      lean.setFromAxisAngle(axis.set(Math.cos(turn * 3.7), 0, Math.sin(turn * 3.7)), rng() * 0.09);
      q.setFromUnitVectors(UP, dir).multiply(lean).multiply(spin.setFromAxisAngle(UP, turn));
      s.set(k * (0.9 + rng() * 0.2), k * (0.82 + rng() * 0.36), k * (0.9 + rng() * 0.2));
      m.compose(p, q, s);
      mesh.setMatrixAt(placed, m);
      // Colour: each plant a little lighter or darker, and a touch warmer or cooler (multiplies the vertex colours)
      const light = 0.8 + rng() * 0.38, warm = (rng() - 0.5) * 0.14;
      mesh.setColorAt(placed, tint.setRGB(light * (1 + warm), light, light * (1 - warm)));
      placed++;
    }
    mesh.count = placed;
    mesh.instanceMatrix.needsUpdate = true;
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    mesh.frustumCulled = false; // instances are all around the planet
    group.add(mesh);
    placedLog.push(`${placed} ${kind}`);
  });

  console.log('[flora]', (blueprint.flora ?? []).join(', ') || '(no names)', '->', placedLog.join(', '));
  return { group, kinds };
}
