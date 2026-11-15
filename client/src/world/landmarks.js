// Places the landmark crystals. Returns landmark positions for Role 4's narration triggers.
// Return shape (agreed with Role 4): [{ name, lore, kind, section, time, position: THREE.Vector3, marker, beam, core }]
//   marker: the crystal cluster (a Mesh with an emissive material). core: the glowing heart inside it.
// (Flora moved to flora.js.)

import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { RADIUS } from './terrain.js';
import { shard, part } from './shapes.js';

const UP = new THREE.Vector3(0, 1, 0);
const WHITE = new THREE.Color(1, 1, 1);
const BEAM_HEIGHT = 16;
const TALLEST = 5.2; // height of the main shard: tall enough to stand out on the horizon

// A cluster of hexagonal shards growing out of one spot: [radius, height, x, z, lean (rz), lean (rx), turn]
const SHARDS = [
  [0.62, TALLEST, 0, 0, 0.04, -0.03, 0],
  [0.42, 3.4, 0.62, 0.12, -0.34, 0.06, 0.5],
  [0.36, 2.8, -0.5, 0.3, 0.38, 0.14, 1.1],
  [0.3, 2.2, 0.1, -0.6, 0.05, -0.42, 0.3],
  [0.26, 1.7, -0.3, -0.42, 0.3, -0.3, 0.9],
  [0.22, 1.3, 0.48, -0.36, -0.46, -0.24, 1.6],
  [0.2, 1.1, 0.02, 0.62, 0.02, 0.5, 0.2],
];
// thin < 1: the same cluster with slimmer, shorter shards, to sit inside the outer one as its glowing heart
const cluster = (thin, shade) => mergeGeometries(SHARDS.map(([r, h, x, z, rz, rx, ry]) =>
  part(shard(r * thin, h * (0.55 + 0.45 * thin), 0.26), WHITE, 0, { x, z, rz, rx, ry, facet: true, shade })));

export function placeLandmarks(group, terrain, blueprint, colour = blueprint.palette.peaks) {
  const out = [];
  const tint = new THREE.Color(colour);
  const shellGeometry = cluster(1, 0.5), coreGeometry = cluster(0.5, 0);

  for (const spot of terrain.landmarkSpots) {
    const lm = (blueprint.landmarks ?? []).find((l) => l.section === spot.type) ?? { name: spot.type, lore: '', kind: spot.type };
    const dir = spot.dir.clone();
    const h = terrain.getHeight(dir);

    // Outer crystal: glassy and slightly see-through, rooted in the ground (its foot is sunk, so no gap on a slope)
    const crystal = new THREE.Mesh(shellGeometry, new THREE.MeshStandardMaterial({
      color: tint, vertexColors: true, emissive: tint, emissiveIntensity: 0.35,
      roughness: 0.22, metalness: 0.15, transparent: true, opacity: 0.72,
    }));
    crystal.position.copy(dir).multiplyScalar(RADIUS + h - 0.35);
    crystal.quaternion.setFromUnitVectors(UP, dir);
    crystal.userData.landmark = lm.name;
    crystal.renderOrder = 1; // after its own core, so the core shows through
    group.add(crystal);

    // Inner glow: a slimmer copy of the cluster inside it, bright and unlit. This is what pulses on the beat.
    const core = new THREE.Mesh(coreGeometry, new THREE.MeshBasicMaterial({ color: tint.clone().lerp(WHITE, 0.45) }));
    core.userData.base = core.material.color.clone();
    crystal.add(core);

    // A thin beam of light into the sky from the tip: visible from orbit and from far away on the ground
    const beam = new THREE.Mesh(
      new THREE.CylinderGeometry(0.08, 0.5, BEAM_HEIGHT, 8, 1, true),
      new THREE.MeshBasicMaterial({
        color: colour, transparent: true, opacity: 0.3, blending: THREE.AdditiveBlending,
        depthWrite: false, side: THREE.DoubleSide, fog: false,
      })
    );
    beam.position.copy(dir).multiplyScalar(RADIUS + h + TALLEST * 0.8 + BEAM_HEIGHT / 2);
    beam.quaternion.setFromUnitVectors(UP, dir);
    group.add(beam);

    out.push({
      name: lm.name, lore: lm.lore, kind: lm.kind, section: spot.type, time: spot.time,
      position: dir.clone().multiplyScalar(RADIUS + h), marker: crystal, beam, core,
    });
  }
  console.log('[landmarks]', out.map((l) => `${l.name} @ ${l.time.toFixed(1)}s`));
  return out;
}
