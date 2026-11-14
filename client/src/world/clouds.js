// Soft low-poly clouds drifting slowly around the planet.
// One InstancedMesh: each cloud is a small cluster of squashed blobs.

import * as THREE from 'three';
import { makeRng } from './noise.js';

const UP = new THREE.Vector3(0, 1, 0);

export function createClouds(radius, seed, colour, reactive, { clusters = 34 } = {}) {
  const rng = makeRng(seed + 7);
  const geo = new THREE.IcosahedronGeometry(1, 1);
  const mat = reactive.patch(new THREE.MeshStandardMaterial({ color: colour, flatShading: true, roughness: 1 }), 'cloud');
  const mesh = new THREE.InstancedMesh(geo, mat, clusters * 6);

  const m = new THREE.Matrix4(), q = new THREE.Quaternion(), spin = new THREE.Quaternion(), s = new THREE.Vector3();
  const centre = new THREE.Vector3(), dir = new THREE.Vector3(), east = new THREE.Vector3(), north = new THREE.Vector3(), p = new THREE.Vector3();
  let count = 0;

  for (let c = 0; c < clusters; c++) {
    // Random direction, a bit more likely near the equator (where the song and the player are)
    do { centre.set(rng() * 2 - 1, (rng() * 2 - 1) * 0.8, rng() * 2 - 1); } while (centre.lengthSq() > 1 || centre.lengthSq() < 0.05);
    centre.normalize();
    east.crossVectors(centre, UP).normalize();
    north.crossVectors(east, centre);
    const altitude = radius + 15 + rng() * 5;
    const size = 1.6 + rng() * 2.2;
    const puffs = 3 + Math.floor(rng() * 4);

    for (let i = 0; i < puffs; i++) {
      // Puffs lined up along "east" with a little scatter: long, flat clouds
      const along = (i - (puffs - 1) / 2) * size * 0.85 + (rng() - 0.5) * size * 0.4;
      const across = (rng() - 0.5) * size * 0.9;
      p.copy(centre).multiplyScalar(altitude).addScaledVector(east, along).addScaledVector(north, across);
      dir.copy(p).normalize();
      p.copy(dir).multiplyScalar(altitude + (rng() - 0.5) * 0.6);
      const k = size * (0.7 + rng() * 0.6) * (1 - Math.abs(i - (puffs - 1) / 2) / puffs * 0.7); // biggest in the middle
      s.set(k * 1.25, k * 0.5, k);
      q.setFromUnitVectors(UP, dir).multiply(spin.setFromAxisAngle(UP, rng() * Math.PI * 2));
      m.compose(p, q, s);
      mesh.setMatrixAt(count++, m);
    }
  }
  mesh.count = count;
  mesh.instanceMatrix.needsUpdate = true;
  mesh.frustumCulled = false; // instances are all around the planet

  const group = new THREE.Group();
  group.rotation.z = 0.12; // drift on a slightly tilted axis
  group.add(mesh);
  const update = (dt) => { group.rotation.y += dt * 0.012; };

  return { group, update };
}
