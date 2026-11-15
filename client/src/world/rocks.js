// Boulders and stones scattered over the land: smooth, lumpy, half sunk into the ground.
// Three different shapes, one InstancedMesh each. More of them on slopes and high ground than on the plains.

import * as THREE from 'three';
import { RADIUS } from './terrain.js';
import { makeRng } from './noise.js';
import { blob, part } from './shapes.js';

const UP = new THREE.Vector3(0, 1, 0);
const VARIANTS = [
  { detail: 2, lumps: 0.2, sy: 0.74 },   // big rounded boulder
  { detail: 2, lumps: 0.27, sy: 0.6 },   // rougher stone
  { detail: 1, lumps: 0.16, sy: 0.42 },  // flat slab (small ones only need few triangles)
];

export function createRocks(terrain, pal, reactive, total = 420) {
  const group = new THREE.Group();
  const material = reactive.patch(new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.95, metalness: 0.02 }), 'rock');
  const colour = pal.rock.clone().lerp(pal.ground, 0.18); // rock that belongs to this planet's ground

  const m = new THREE.Matrix4(), q = new THREE.Quaternion(), tilt = new THREE.Quaternion(), spin = new THREE.Quaternion(), s = new THREE.Vector3();
  const dir = new THREE.Vector3(), near = new THREE.Vector3(), p = new THREE.Vector3(), axis = new THREE.Vector3(), tint = new THREE.Color();
  let placedTotal = 0;

  VARIANTS.forEach((variant, index) => {
    const count = Math.round(total / VARIANTS.length);
    const rng = makeRng(terrain.seed + 4000 + index * 733);
    // shade: the foot is darker than the top, like the damp, shadowed foot of a real boulder
    const geometry = part(blob(1, variant.detail, variant.lumps, 20 + index), colour, 0, { sy: variant.sy, shade: 0.36 });
    const mesh = new THREE.InstancedMesh(geometry, material, count);
    let placed = 0, tries = 0;

    while (placed < count && tries < count * 40) {
      tries++;
      dir.set(rng() * 2 - 1, rng() * 2 - 1, rng() * 2 - 1);
      if (dir.lengthSq() > 1 || dir.lengthSq() < 0.01) continue; // uniform directions
      dir.normalize();
      const h = terrain.getHeight(dir);
      const above = h - terrain.seaLevel;
      if (above > -0.3 && above < 0.12) continue; // not in the water or on the waterline (canyon floors are fine)
      // How steep is it here? (height change over a short step north and east)
      near.copy(dir).addScaledVector(UP, 0.012).normalize();
      const stepNorth = Math.abs(terrain.getHeight(near) - h);
      near.set(dir.x + dir.z * 0.012, dir.y, dir.z - dir.x * 0.012).normalize();
      const steep = Math.max(stepNorth, Math.abs(terrain.getHeight(near) - h));
      if (steep > 0.75) continue; // a cliff: it would hang in the air
      // Plains get few rocks, slopes and high ground get many
      const likely = 0.22 + Math.min(1, steep / 0.3) * 0.5 + Math.min(1, Math.max(0, above) / (terrain.levels.peak || 8)) * 0.4;
      if (rng() > likely) continue;

      // Mostly small stones, now and then a boulder
      const k = 0.16 + 0.75 * rng() ** 2.2 + (rng() < 0.06 ? 0.7 : 0);
      s.set(k * (0.8 + rng() * 0.5), k * (0.8 + rng() * 0.4), k * (0.8 + rng() * 0.5));
      // The middle of the rock sits just below the ground, deeper on steeper ground, so its foot is always buried
      p.copy(dir).multiplyScalar(RADIUS + h + s.y * variant.sy * 0.18 - steep * k * 0.9);
      tilt.setFromAxisAngle(axis.set(rng() - 0.5, 0, rng() - 0.5).normalize(), (rng() - 0.5) * 0.7);
      q.setFromUnitVectors(UP, dir).multiply(tilt).multiply(spin.setFromAxisAngle(UP, rng() * Math.PI * 2));
      m.compose(p, q, s);
      mesh.setMatrixAt(placed, m);
      const light = 0.78 + rng() * 0.4, warm = (rng() - 0.5) * 0.08;
      mesh.setColorAt(placed, tint.setRGB(light * (1 + warm), light, light * (1 - warm)));
      placed++;
    }
    mesh.count = mesh.userData.placed = placed; // userData.placed: the full number (QUALITY draws a share of it)
    mesh.instanceMatrix.needsUpdate = true;
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    mesh.frustumCulled = false; // instances are all around the planet
    group.add(mesh);
    placedTotal += placed;
  });

  console.log('[rocks]', placedTotal, 'placed');
  return { group };
}
