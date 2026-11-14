// Places landmark markers. Returns landmark positions for Role 4's narration triggers.
// Return shape (agreed with Role 4): [{ name, lore, kind, section, time, position: THREE.Vector3, marker, beam }]
// (Flora moved to flora.js.)

import * as THREE from 'three';
import { RADIUS } from './terrain.js';

const UP = new THREE.Vector3(0, 1, 0);
const BEAM_HEIGHT = 16;

export function placeLandmarks(group, terrain, blueprint, colour = blueprint.palette.peaks) {
  const out = [];
  for (const spot of terrain.landmarkSpots) {
    const lm = (blueprint.landmarks ?? []).find((l) => l.section === spot.type) ?? { name: spot.type, lore: '', kind: spot.type };
    const dir = spot.dir.clone();
    const h = terrain.getHeight(dir);

    // Glowing crystal floating above the landmark so players can spot it on the horizon
    const crystal = new THREE.Mesh(
      new THREE.OctahedronGeometry(1.6, 0),
      new THREE.MeshStandardMaterial({ color: colour, emissive: colour, emissiveIntensity: 0.9, flatShading: true })
    );
    crystal.position.copy(dir).multiplyScalar(RADIUS + h + 3.2);
    crystal.quaternion.setFromUnitVectors(UP, dir);
    crystal.scale.set(0.8, 1.5, 0.8);
    crystal.userData.landmark = lm.name;
    group.add(crystal);

    // A thin beam of light into the sky: visible from orbit and from far away on the ground
    const beam = new THREE.Mesh(
      new THREE.CylinderGeometry(0.08, 0.5, BEAM_HEIGHT, 8, 1, true),
      new THREE.MeshBasicMaterial({
        color: colour, transparent: true, opacity: 0.3, blending: THREE.AdditiveBlending,
        depthWrite: false, side: THREE.DoubleSide, fog: false,
      })
    );
    beam.position.copy(dir).multiplyScalar(RADIUS + h + 3 + BEAM_HEIGHT / 2);
    beam.quaternion.setFromUnitVectors(UP, dir);
    group.add(beam);

    out.push({
      name: lm.name, lore: lm.lore, kind: lm.kind, section: spot.type, time: spot.time,
      position: dir.clone().multiplyScalar(RADIUS + h), marker: crystal, beam,
    });
  }
  console.log('[landmarks]', out.map((l) => `${l.name} @ ${l.time.toFixed(1)}s`));
  return out;
}
