// Soft clouds drifting slowly around the planet.
// One InstancedMesh: each cloud is a cluster of overlapping rounded puffs with a flattish base and a heaped top.

import * as THREE from 'three';
import { makeRng } from './noise.js';
import { blob } from './shapes.js';

const UP = new THREE.Vector3(0, 1, 0);
const MAX_PUFFS = 9;

export function createClouds(radius, seed, colour, reactive, { clusters = 34 } = {}) {
  const rng = makeRng(seed + 7);
  // A smooth, slightly lumpy ball with a flattened underside (the lower half is squashed)
  const geo = blob(1, 2, 0.1, 40);
  const pos = geo.attributes.position;
  for (let i = 0; i < pos.count; i++) if (pos.getY(i) < 0) pos.setY(i, pos.getY(i) * 0.45);
  geo.computeVertexNormals();
  const mat = reactive.patch(new THREE.MeshStandardMaterial({ color: colour, roughness: 1, metalness: 0 }), 'cloud');
  const mesh = new THREE.InstancedMesh(geo, mat, clusters * MAX_PUFFS);

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
    const size = 1.5 + rng() * 2.0;
    const puffs = 5 + Math.floor(rng() * (MAX_PUFFS - 4)); // 5..9

    for (let i = 0; i < puffs; i++) {
      // Puffs along "east", close enough to melt into each other. The middle ones are the biggest and sit highest.
      const t = puffs > 1 ? i / (puffs - 1) : 0.5;       // 0..1 along the cloud
      const middle = 1 - Math.abs(t - 0.5) * 2;           // 0 at the ends, 1 in the middle
      const k = size * (0.5 + 0.55 * middle + rng() * 0.2);
      const along = (t - 0.5) * puffs * size * 0.52 + (rng() - 0.5) * size * 0.25;
      const across = (rng() - 0.5) * size * 0.8;
      p.copy(centre).multiplyScalar(altitude).addScaledVector(east, along).addScaledVector(north, across);
      dir.copy(p).normalize();
      // All the flat bases at about the same height, so the cloud has one level underside
      p.copy(dir).multiplyScalar(altitude + (rng() - 0.5) * 0.3);
      s.set(k * 1.15, k * (0.62 + 0.3 * middle), k);
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
