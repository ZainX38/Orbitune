// Places landmark markers + flora. Returns landmark positions for Role 4's narration triggers.
// Agree this return shape with Role 4: [{ name, lore, kind, section, position: THREE.Vector3 }]

import * as THREE from 'three';
import { RADIUS } from './terrain.js';
import { makeRng } from './noise.js';

const UP = new THREE.Vector3(0, 1, 0);

export function placeLandmarks(group, terrain, blueprint) {
  const out = [];
  for (const spot of terrain.landmarkSpots) {
    const lm = (blueprint.landmarks ?? []).find((l) => l.section === spot.type) ?? { name: spot.type, lore: '', kind: spot.type };
    const dir = spot.dir.clone();
    const h = terrain.getHeight(dir);

    // Glowing crystal floating above the landmark so players can spot it on the horizon
    const crystal = new THREE.Mesh(
      new THREE.OctahedronGeometry(1.6, 0),
      new THREE.MeshStandardMaterial({
        color: blueprint.palette.peaks, emissive: blueprint.palette.peaks, emissiveIntensity: 0.7, flatShading: true,
      })
    );
    crystal.position.copy(dir).multiplyScalar(RADIUS + h + 3);
    crystal.quaternion.setFromUnitVectors(UP, dir);
    crystal.userData.landmark = lm.name;
    group.add(crystal);

    out.push({ name: lm.name, lore: lm.lore, kind: lm.kind, section: spot.type, position: dir.clone().multiplyScalar(RADIUS + h), marker: crystal });
  }
  console.log('[landmarks]', out.map((l) => l.name));
  return out;
}

// Low-poly trees scattered on land (not in the sea, not on peaks)
export function scatterFlora(group, terrain, palette, count = 700) {
  const rng = makeRng(terrain.seed + 99);
  const geo = new THREE.ConeGeometry(0.5, 2, 5);
  geo.translate(0, 1, 0); // base at origin
  const mat = new THREE.MeshStandardMaterial({ color: new THREE.Color(palette.ground).offsetHSL(0.08, 0.1, -0.12), flatShading: true });
  const mesh = new THREE.InstancedMesh(geo, mat, count);

  const m = new THREE.Matrix4(), q = new THREE.Quaternion(), s = new THREE.Vector3(), dir = new THREE.Vector3(), p = new THREE.Vector3();
  let placed = 0, tries = 0;
  while (placed < count && tries < count * 15) {
    tries++;
    dir.set(rng() * 2 - 1, rng() * 2 - 1, rng() * 2 - 1);
    if (dir.lengthSq() > 1 || dir.lengthSq() < 0.01) continue; // uniform-ish directions
    dir.normalize();
    const h = terrain.getHeight(dir);
    if (h < 0.5 || h > 5) continue;
    p.copy(dir).multiplyScalar(RADIUS + h - 0.1);
    q.setFromUnitVectors(UP, dir);
    const k = 0.6 + rng() * 0.9;
    s.set(k, k, k);
    m.compose(p, q, s);
    mesh.setMatrixAt(placed++, m);
  }
  mesh.count = placed;
  group.add(mesh);
  console.log('[flora] placed', placed, 'trees');
  return mesh;
}
