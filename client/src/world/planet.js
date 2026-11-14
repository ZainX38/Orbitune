// Main entry for the World builder (Role 3).
// Usage:
//   const planet = createPlanet(features, blueprint);
//   scene.add(planet.group);                              // the planet brings its own sun (no extra lights needed)
//   planet.update(dt, songTime, listenerDirection);       // every frame
//   planet.onBeat();                                      // on every beat
//   planet.dispose();                                     // before building another planet
// Exposes: group, getHeight (Contract 3), radius, landmarks, colours, onBeat(), update(), name
//   + new: dispose(), timeAt(dir), directionAt(time), duration, seaLevel, sun. See README.md in this folder.

import * as THREE from 'three';
import { createTerrain, RADIUS, longitudeOf, directionOfLongitude } from './terrain.js';
import { derivePalette, makeColourer, waterColour, skyColours } from './biome.js';
import { createAtmosphere } from './atmosphere.js';
import { createReactive } from './reactive.js';
import { createClouds } from './clouds.js';
import { createFlora } from './flora.js';
import { placeLandmarks } from './landmarks.js';
import { createSurface } from './surface.js';
import { createIcosphere } from './sphere.js';
import { fbm } from './noise.js';

const DETAIL = 64; // icosphere subdivisions: 20 * (DETAIL+1)^2 faces (~85k). Lower if slow (50 = ~52k, 40 = ~34k).
const SUN_FOLLOWS_LISTENER = true; // the sun stays ahead (east) of the listener, so where you are is always lit

export function createPlanet(features, blueprint) {
  console.time('[planet] build');
  const terrain = createTerrain(features, blueprint);
  const pal = derivePalette(blueprint.palette);
  const colours = skyColours(blueprint, features);
  const reactive = createReactive(features, pal, colours);
  const group = new THREE.Group();

  // ---------- Ground + sea (one mesh, never moves) ----------
  // Neighbouring triangles share their vertices (sphere.js), so normals and colours are per VERTEX and the GPU
  // blends them across each triangle: smooth shading, soft colour bands. The triangles themselves are still flat.
  const { directions, index } = createIcosphere(DETAIL);
  const count = directions.length / 3;
  const positions = new Float32Array(count * 3);
  const heights = new Float32Array(count);
  const dir = new THREE.Vector3(), e1 = new THREE.Vector3();

  // 1. Displace every vertex along its direction by the height function
  for (let i = 0; i < count; i++) {
    dir.fromArray(directions, i * 3);
    heights[i] = terrain.getHeight(dir);
    dir.multiplyScalar(RADIUS + heights[i]).toArray(positions, i * 3);
  }
  const geo = new THREE.BufferGeometry();
  geo.setIndex(new THREE.BufferAttribute(index, 1));
  geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geo.computeVertexNormals(); // each vertex: the average of the triangles around it
  geo.computeBoundingSphere();

  // 2. Colour every vertex from its height, the slope of its (smooth) normal and two soft noises
  const normals = geo.attributes.normal.array;
  const colourData = new Float32Array(count * 3);
  const waterData = new Float32Array(count); // 0 = land. 0.5..1 = water, deeper = higher (see reactive.js)
  const colourFor = makeColourer(pal, terrain.seaLevel, terrain.levels);
  const c = new THREE.Color();
  let waterVertices = 0;

  for (let i = 0; i < count; i++) {
    dir.fromArray(directions, i * 3);
    const depth = terrain.getDepth(dir);
    if (depth > 0 && Math.abs(heights[i] - terrain.seaLevel) < 0.01) {
      // Water: colour from the depth of the sea bed, so it blends smoothly from shore to deep
      waterVertices++;
      waterColour(pal, depth, c);
      waterData[i] = 0.5 + 0.5 * Math.min(1, depth / 3);
    } else {
      const slope = 1 - Math.abs(normals[i * 3] * dir.x + normals[i * 3 + 1] * dir.y + normals[i * 3 + 2] * dir.z);
      const patch = 0.5 + fbm(dir.x * 2.2, dir.y * 2.2, dir.z * 2.2, 3, terrain.seed + 77);
      const mottle = 0.5 + 0.5 * fbm(dir.x * 19, dir.y * 19, dir.z * 19, 2, terrain.seed + 123); // subtle, not per face
      colourFor(heights[i], slope, patch, mottle, c);
    }
    c.toArray(colourData, i * 3);
  }
  geo.setAttribute('color', new THREE.BufferAttribute(colourData, 3));
  geo.setAttribute('aWater', new THREE.BufferAttribute(waterData, 1));

  const ground = new THREE.Mesh(geo, reactive.patch(
    new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.9, metalness: 0 }), 'terrain'));
  ground.name = 'ground';
  group.add(ground);

  // CONTRACT 3 is answered from the finished mesh, not from the height function: the function is only sampled at
  // the vertices, and between them the flat triangles differ from it (see surface.js). Smooth shading changes how
  // the triangles are LIT, not where they are, so this is still exactly the ground that is drawn.
  // Everything that stands on the ground (flora, landmarks, the player) uses this, so it touches what is drawn.
  const triangles = new Float32Array(index.length * 3); // the same triangles, 9 numbers each
  for (let i = 0; i < index.length; i++) triangles.set(positions.subarray(index[i] * 3, index[i] * 3 + 3), i * 3);
  const { getHeight } = createSurface({ array: triangles }, RADIUS);
  const land = { ...terrain, getHeight };

  // ---------- Everything on and around it ----------
  // The song's own colour (Role 2), pulled towards the palette so the glow always suits the planet
  const glowColour = colours.atmosphere.clone().lerp(pal.night ? pal.peaks : pal.sky, 0.45);
  const atmosphere = createAtmosphere(RADIUS, glowColour, colours.fog, colours.sky);
  group.add(atmosphere.group);

  const clouds = createClouds(RADIUS, terrain.seed, pal.cloud, reactive);
  group.add(clouds.group);

  const flora = createFlora(land, blueprint, pal, colours, reactive);
  group.add(flora.group);

  const landmarks = placeLandmarks(group, land, blueprint, pal.peaks);

  // ---------- Sun (lives in the planet's group, so it turns with the planet) ----------
  const sun = new THREE.DirectionalLight(pal.sun, pal.sunIntensity);
  const sunDirection = new THREE.Vector3(1, 0.6, 0.8).normalize();
  const sunTarget = sunDirection.clone();
  const east = new THREE.Vector3();
  sun.position.copy(sunDirection).multiplyScalar(RADIUS * 6);
  group.add(sun, sun.target); // target stays at the planet's centre

  // ---------- Live reactions (light and colour only: the ground never moves) ----------
  const baseGlow = glowColour.clone(), hotGlow = glowColour.clone().lerp(pal.peaks, 0.6);

  const onBeat = (strength = 1) => reactive.onBeat(strength);

  // songTime: seconds into the song that is playing now. listenerDirection: unit vector from the planet's centre
  // to the listener (the player, or the playhead in orbit), in the planet's own space. Both optional.
  const update = (dt, songTime, listenerDirection) => {
    reactive.update(dt, songTime, listenerDirection);
    const { beat, loud, treble } = reactive.now;

    clouds.update(dt);

    if (SUN_FOLLOWS_LISTENER && listenerDirection) {
      const l = reactive.listener;
      east.set(-l.z, 0, l.x); // direction of increasing longitude = later in the song
      if (east.lengthSq() > 1e-4) {
        sunTarget.copy(l).multiplyScalar(0.55).addScaledVector(east.normalize(), 0.62).add(e1.set(0, 0.5, 0)).normalize();
      }
      sunDirection.lerp(sunTarget, 1 - Math.exp(-dt * 1.2)).normalize();
      sun.position.copy(sunDirection).multiplyScalar(RADIUS * 6);
    }

    const glow = atmosphere.glow.material.uniforms;
    glow.intensity.value = 0.3 + 0.22 * loud + 0.3 * beat;
    glow.glowColor.value.copy(baseGlow).lerp(hotGlow, Math.min(1, 0.5 * treble + 0.4 * beat));
    glow.sunDirection.value.copy(sunDirection);
    atmosphere.sky.material.uniforms.hazeColor.value.copy(colours.fog);
    atmosphere.sky.material.uniforms.skyColor.value.copy(colours.sky);

    for (const l of landmarks) {
      l.marker.material.emissiveIntensity = 0.8 + beat * 1.6 + loud * 0.5;
      l.marker.rotateY(dt * 0.8);
      l.beam.material.opacity = 0.14 + 0.1 * loud + 0.25 * beat;
    }
  };

  // Free the GPU memory. Call before building another planet (e.g. when the song changes).
  const dispose = () => {
    group.removeFromParent();
    group.traverse((o) => {
      o.geometry?.dispose();
      if (o.material) for (const mat of [].concat(o.material)) mat.dispose();
      if (o.isInstancedMesh) o.dispose();
    });
  };

  // Longitude = song time (the song runs once around the equator, eastwards)
  const timeAt = (dir) => longitudeOf(dir) * features.duration;
  const directionAt = (time, out) => directionOfLongitude((((time / features.duration) % 1) + 1) % 1, out);

  console.timeEnd('[planet] build');
  console.log('[planet]', blueprint.planetName, '| faces:', index.length / 3, '| vertices:', count, `| ${Math.round((waterVertices / count) * 100)}% water`,
    '| flora:', flora.kinds.join(' + '), pal.night ? '| night planet' : '| day planet');

  return {
    group, getHeight, radius: RADIUS, landmarks, colours, onBeat, update, name: blueprint.planetName,
    dispose, timeAt, directionAt, duration: features.duration, seaLevel: terrain.seaLevel, sun,
  };
}
