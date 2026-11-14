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
import { fbm, makeRng } from './noise.js';

const DETAIL = 50; // icosphere subdivisions: 20 * (DETAIL+1)^2 faces (~52k). Lower if slow (40 = ~34k).
const SUN_FOLLOWS_LISTENER = true; // the sun stays ahead (east) of the listener, so where you are is always lit

export function createPlanet(features, blueprint) {
  console.time('[planet] build');
  const terrain = createTerrain(features, blueprint);
  const pal = derivePalette(blueprint.palette);
  const colours = skyColours(blueprint, features);
  const reactive = createReactive(features, pal, colours);
  const group = new THREE.Group();

  // ---------- Ground + sea (one mesh, never moves) ----------
  // IcosahedronGeometry is non-indexed: every face has its own 3 vertices -> crisp flat shading
  const geo = new THREE.IcosahedronGeometry(RADIUS, DETAIL);
  const pos = geo.attributes.position;
  const colourData = new Float32Array(pos.count * 3);
  const waterData = new Float32Array(pos.count); // 0 = land. 0.5..1 = water, deeper = higher (see reactive.js)
  const colourFor = makeColourer(pal, terrain.seaLevel, terrain.levels);
  const rng = makeRng(terrain.seed);
  const c = new THREE.Color();
  const dirs = [new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3()];
  const pts = [new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3()];
  const heights = [0, 0, 0];
  const e1 = new THREE.Vector3(), e2 = new THREE.Vector3(), normal = new THREE.Vector3(), centre = new THREE.Vector3();
  let waterFaces = 0;

  for (let i = 0; i < pos.count; i += 3) {
    // Displace the 3 vertices of this face
    for (let k = 0; k < 3; k++) {
      dirs[k].fromBufferAttribute(pos, i + k).normalize();
      heights[k] = terrain.getHeight(dirs[k]);
      pts[k].copy(dirs[k]).multiplyScalar(RADIUS + heights[k]);
      pos.setXYZ(i + k, pts[k].x, pts[k].y, pts[k].z);
    }
    const isWater = heights.every((h) => Math.abs(h - terrain.seaLevel) < 0.01);

    if (isWater) {
      // Water: colour per vertex from the depth of the sea bed, so it blends smoothly from shore to deep
      waterFaces++;
      for (let k = 0; k < 3; k++) {
        const depth = terrain.getDepth(dirs[k]);
        waterColour(pal, depth, c);
        colourData.set([c.r, c.g, c.b], (i + k) * 3);
        waterData[i + k] = 0.5 + 0.5 * Math.min(1, depth / 3);
      }
    } else {
      // Land: one colour per face from its height, its slope and a patchy noise
      normal.crossVectors(e1.subVectors(pts[1], pts[0]), e2.subVectors(pts[2], pts[0])).normalize();
      centre.addVectors(dirs[0], dirs[1]).add(dirs[2]).normalize();
      const slope = 1 - Math.abs(normal.dot(centre));
      const patch = 0.5 + fbm(centre.x * 2.2, centre.y * 2.2, centre.z * 2.2, 3, terrain.seed + 77);
      colourFor((heights[0] + heights[1] + heights[2]) / 3, slope, patch, rng(), c);
      for (let k = 0; k < 3; k++) colourData.set([c.r, c.g, c.b], (i + k) * 3);
    }
  }

  geo.setAttribute('color', new THREE.BufferAttribute(colourData, 3));
  geo.setAttribute('aWater', new THREE.BufferAttribute(waterData, 1));
  geo.computeVertexNormals();
  geo.computeBoundingSphere();

  const ground = new THREE.Mesh(geo, reactive.patch(
    new THREE.MeshStandardMaterial({ vertexColors: true, flatShading: true, roughness: 0.92, metalness: 0 }), 'terrain'));
  ground.name = 'ground';
  group.add(ground);

  // CONTRACT 3 is answered from the finished mesh, not from the height function: the function is only sampled at
  // the vertices, and between them the flat triangles differ from it by up to 0.8 units (see surface.js).
  // Everything that stands on the ground (flora, landmarks, the player) uses this, so it touches what is drawn.
  const { getHeight } = createSurface(pos, RADIUS);
  const land = { ...terrain, getHeight };

  // ---------- Everything on and around it ----------
  // The song's own colour (Role 2), pulled towards the palette so the glow always suits the planet
  const glowColour = colours.atmosphere.clone().lerp(pal.night ? pal.peaks : pal.sky, 0.45);
  const atmosphere = createAtmosphere(RADIUS, glowColour, colours.fog);
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
  console.log('[planet]', blueprint.planetName, '| faces:', pos.count / 3, `| ${Math.round((waterFaces / (pos.count / 3)) * 100)}% water`,
    '| flora:', flora.kinds.join(' + '), pal.night ? '| night planet' : '| day planet');

  return {
    group, getHeight, radius: RADIUS, landmarks, colours, onBeat, update, name: blueprint.planetName,
    dispose, timeAt, directionAt, duration: features.duration, seaLevel: terrain.seaLevel, sun,
  };
}
