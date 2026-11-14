// Main entry for the World builder (Role 3).
// Usage: const planet = createPlanet(features, blueprint); scene.add(planet.group);
// Exposes: group, getHeight (Contract 3), radius, landmarks, colours, onBeat(), update(dt)

import * as THREE from 'three';
import { createTerrain, RADIUS } from './terrain.js';
import { makeColourer, skyColours } from './biome.js';
import { createAtmosphere } from './atmosphere.js';
import { placeLandmarks, scatterFlora } from './landmarks.js';
import { makeRng } from './noise.js';

const DETAIL = 40; // icosphere subdivisions: 20 * (DETAIL+1)^2 faces (~34k). Lower if slow.

export function createPlanet(features, blueprint) {
  console.time('[planet] build');
  const terrain = createTerrain(features, blueprint);

  // IcosahedronGeometry is non-indexed: every face has its own 3 vertices -> crisp flat shading
  const geo = new THREE.IcosahedronGeometry(RADIUS, DETAIL);
  const pos = geo.attributes.position;
  const colours = new Float32Array(pos.count * 3);
  const colourFor = makeColourer(blueprint.palette, terrain.seaLevel);
  const rng = makeRng(terrain.seed);
  const v = new THREE.Vector3(), c = new THREE.Color();
  const heights = new Float32Array(3);

  for (let i = 0; i < pos.count; i += 3) {
    // Displace the 3 vertices of this face
    for (let k = 0; k < 3; k++) {
      v.fromBufferAttribute(pos, i + k).normalize();
      const h = terrain.getHeight(v);
      heights[k] = h;
      v.multiplyScalar(RADIUS + h);
      pos.setXYZ(i + k, v.x, v.y, v.z);
    }
    // One colour per face, from its average height
    colourFor((heights[0] + heights[1] + heights[2]) / 3, c, rng());
    for (let k = 0; k < 3; k++) colours.set([c.r, c.g, c.b], (i + k) * 3);
  }

  geo.setAttribute('color', new THREE.BufferAttribute(colours, 3));
  geo.computeVertexNormals();

  const mesh = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ vertexColors: true, flatShading: true, roughness: 0.9 }));
  const group = new THREE.Group();
  group.add(mesh);

  const colours3 = skyColours(blueprint, features);
  const atmosphere = createAtmosphere(RADIUS, colours3.atmosphere);
  group.add(atmosphere);

  const landmarks = placeLandmarks(group, terrain, blueprint);
  scatterFlora(group, terrain, blueprint.palette);

  // Beat pulse: glow only, never move the ground (the player stands on it)
  let pulse = 0;
  const onBeat = (strength = 1) => { pulse = Math.min(1.5, pulse + 0.6 * strength); };
  const update = (dt) => {
    pulse *= Math.exp(-dt * 5);
    atmosphere.material.uniforms.intensity.value = 1 + pulse;
    for (const l of landmarks) {
      l.marker.material.emissiveIntensity = 0.7 + pulse * 0.8;
      l.marker.rotateY(dt * 0.8);
    }
  };

  console.timeEnd('[planet] build');
  console.log('[planet]', blueprint.planetName, '| faces:', pos.count / 3);

  return { group, getHeight: terrain.getHeight, radius: RADIUS, landmarks, colours: colours3, onBeat, update, name: blueprint.planetName };
}
