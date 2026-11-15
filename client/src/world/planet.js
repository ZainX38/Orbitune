// Main entry for the World builder (Role 3). Full interface: README.md in this folder.
// Usage:
//   const planet = createPlanet(features, blueprint, { quality: 'medium' });   // quality: see quality.js
//   scene.add(planet.group);                              // the planet brings its own sun (no extra lights needed)
//   planet.update(dt, songTime, listenerDirection);       // every frame
//   planet.onBeat();                                      // on every beat
//   planet.setQuality('low');                             // lighter or heavier drawing, in place
//   planet.dispose();                                     // before building another planet
// Returns: group, getHeight (Contract 3), radius, landmarks, colours, palette, paletteSource, onBeat(), update(), name,
//   dispose(), timeAt(dir), directionAt(time), duration, seaLevel, sun, quality, setQuality(name), groundError().

import * as THREE from 'three';
import { createTerrain, RADIUS, longitudeOf, directionOfLongitude } from './terrain.js';
import { derivePalette, makeColourer, waterColour, skyColours } from './biome.js';
import { resolvePalette } from './spectrumPalette.js';
import { createAtmosphere } from './atmosphere.js';
import { createReactive } from './reactive.js';
import { createClouds } from './clouds.js';
import { createFlora } from './flora.js';
import { createRocks } from './rocks.js';
import { placeLandmarks } from './landmarks.js';
import { createSurface } from './surface.js';
import { createIcosphere } from './sphere.js';
import { fbm } from './noise.js';
import { QUALITY, DEFAULT_QUALITY, REFERENCE_DETAIL, setDensity } from './quality.js';

// How detailed the ground is, shadow map size and how many plants are drawn: QUALITY in quality.js.
const SHADOWS = true;    // master switch for sun shadows. false = never, whatever the quality level says
const SUN_FOLLOWS_LISTENER = true; // the sun stays ahead (east) of the listener, so where you are is always lit

export function createPlanet(features, blueprint, { quality: startQuality = DEFAULT_QUALITY } = {}) {
  console.time('[planet] build');
  const terrain = createTerrain(features, blueprint);
  // The song spectrum palette is the source of truth. blueprint.palette (Gemini) is only a legacy fallback
  const { palette, source: paletteSource } = resolvePalette(features, blueprint);
  console.log('[planet] palette from', paletteSource, JSON.stringify(palette));
  const pal = derivePalette(palette);
  const colours = skyColours(palette);
  const reactive = createReactive(features, pal, colours);
  const group = new THREE.Group();
  let quality = QUALITY[startQuality] ? startQuality : DEFAULT_QUALITY;

  // ---------- Ground + sea (one mesh, never moves) ----------
  // Neighbouring triangles share their vertices (sphere.js), so normals and colours are per VERTEX and the GPU
  // blends them across each triangle: smooth shading, soft colour bands. The triangles themselves are still flat.
  const colourFor = makeColourer(pal, terrain.seaLevel, terrain.levels);
  const dir = new THREE.Vector3(), e1 = new THREE.Vector3(), c = new THREE.Color();

  // The ground at one level of detail: { geometry, triangles (9 numbers each), faces, vertices, water (share) }
  function buildGround(detail) {
    const { directions, index } = createIcosphere(detail);
    const count = directions.length / 3;
    const positions = new Float32Array(count * 3);
    const heights = new Float32Array(count);

    // 1. Displace every vertex along its direction by the height function
    for (let i = 0; i < count; i++) {
      dir.fromArray(directions, i * 3);
      heights[i] = terrain.getHeight(dir);
      dir.multiplyScalar(RADIUS + heights[i]).toArray(positions, i * 3);
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setIndex(new THREE.BufferAttribute(index, 1));
    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geometry.computeVertexNormals(); // each vertex: the average of the triangles around it
    geometry.computeBoundingSphere();

    // 2. Colour every vertex from its height, the slope of its (smooth) normal and two soft noises
    const normals = geometry.attributes.normal.array;
    const colourData = new Float32Array(count * 3);
    const waterData = new Float32Array(count); // 0 = land. 0.5..1 = water, deeper = higher (see reactive.js)
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
    geometry.setAttribute('color', new THREE.BufferAttribute(colourData, 3));
    geometry.setAttribute('aWater', new THREE.BufferAttribute(waterData, 1));

    const triangles = new Float32Array(index.length * 3);
    for (let i = 0; i < index.length; i++) triangles.set(positions.subarray(index[i] * 3, index[i] * 3 + 3), i * 3);
    return { geometry, triangles, faces: index.length / 3, vertices: count, water: waterVertices / count };
  }

  // CONTRACT 3 is answered from a finished mesh, not from the height function: the function is only sampled at
  // the vertices, and between them the flat triangles differ from it (see surface.js).
  // It is ALWAYS the mesh at REFERENCE_DETAIL, whatever quality level is drawn, so getHeight never depends on the
  // quality. On medium and high that is exactly the ground on screen. On low the drawn ground has fewer triangles
  // and differs a little between vertices: groundError() below measures by how much.
  // Everything that stands on the ground (flora, rocks, landmarks, the player) uses this.
  const grounds = new Map(); // detail -> ground, built when first needed
  const groundFor = (detail) => {
    if (!grounds.has(detail)) grounds.set(detail, buildGround(detail));
    return grounds.get(detail);
  };
  const reference = groundFor(REFERENCE_DETAIL);
  const { getHeight } = createSurface({ array: reference.triangles }, RADIUS);
  const land = { ...terrain, getHeight };

  const ground = new THREE.Mesh(groundFor(QUALITY[quality].detail).geometry, reactive.patch(
    new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.9, metalness: 0 }), 'terrain'));
  ground.name = 'ground';
  group.add(ground);

  // ---------- Everything on and around it ----------
  // The palette's atmosphere colour, pulled towards the sky (or peaks at night) so the glow always suits the planet
  const glowColour = colours.atmosphere.clone().lerp(pal.night ? pal.peaks : pal.sky, 0.45);
  const atmosphere = createAtmosphere(RADIUS, glowColour, colours.fog, colours.sky);
  group.add(atmosphere.group);

  const clouds = createClouds(RADIUS, terrain.seed, pal.cloud, reactive);
  group.add(clouds.group);

  const flora = createFlora(land, blueprint, pal, colours, reactive);
  group.add(flora.group);

  const rocks = createRocks(land, pal, reactive);
  group.add(rocks.group);

  const landmarks = placeLandmarks(group, land, blueprint, pal.peaks);

  // ---------- Sun (lives in the planet's group, so it turns with the planet) ----------
  const sun = new THREE.DirectionalLight(pal.sun, pal.sunIntensity);
  const sunDirection = new THREE.Vector3(1, 0.6, 0.8).normalize();
  const sunTarget = sunDirection.clone();
  const east = new THREE.Vector3();
  sun.position.copy(sunDirection).multiplyScalar(RADIUS * 6);
  group.add(sun, sun.target); // target stays at the planet's centre

  // ---------- Soft shadows from the sun (needs renderer.shadowMap.enabled: applyRendererQuality in quality.js) ----------
  // One shadow map over the whole sunlit side of the planet. Hills, trees, rocks and clouds cast onto the ground.
  // Whether they are on, and the map size, comes from the quality level (setQuality below).
  if (SHADOWS) {
    const reach = RADIUS + 22; // the planet plus its clouds
    Object.assign(sun.shadow.camera, { left: -reach, right: reach, top: reach, bottom: -reach, near: RADIUS * 6 - reach, far: RADIUS * 6 + reach });
    sun.shadow.camera.updateProjectionMatrix();
    sun.shadow.radius = 2.5;      // blur
    sun.shadow.bias = -0.0004;
    sun.shadow.normalBias = 0.12; // stops smooth slopes that face away from the sun from shadowing themselves in stripes
    ground.castShadow = ground.receiveShadow = true;
    for (const mesh of [...flora.group.children, ...rocks.group.children]) mesh.castShadow = mesh.receiveShadow = true;
    for (const mesh of clouds.group.children) mesh.castShadow = true;
    for (const l of landmarks) l.marker.castShadow = true;
  }

  // ---------- Quality: what is drawn, never where the ground is ----------
  // Switches in place: the group, getHeight, the landmarks and every reference to this planet stay valid.
  function setQuality(name) {
    const q = QUALITY[name];
    if (!q) return quality;
    quality = name;

    ground.geometry = groundFor(q.detail).geometry;
    setDensity(flora.group, q.flora);
    setDensity(rocks.group, q.rocks);
    setDensity(clouds.group, q.clouds);

    const shadows = SHADOWS && q.shadows;
    if (shadows && sun.shadow.mapSize.x !== q.shadowMap) {
      sun.shadow.mapSize.set(q.shadowMap, q.shadowMap);
      sun.shadow.map?.dispose(); // three.js makes a new one at the new size on the next frame
      sun.shadow.map = null;
    }
    sun.castShadow = shadows;
    return quality;
  }
  setQuality(quality);

  // How far is the DRAWN ground from getHeight? 0 on medium and high (same triangles). For checking a low level:
  // returns { mean, p99, max } of the absolute difference, in world units, over `samples` random directions.
  function groundError(samples = 20000) {
    const drawn = createSurface({ array: groundFor(QUALITY[quality].detail).triangles }, RADIUS);
    const errors = new Float32Array(samples);
    const d = new THREE.Vector3();
    let sum = 0;
    for (let i = 0; i < samples; i++) {
      d.randomDirection();
      errors[i] = Math.abs(drawn.getHeight(d) - getHeight(d));
      sum += errors[i];
    }
    errors.sort();
    return { mean: sum / samples, p99: errors[Math.floor(samples * 0.99)], max: errors[samples - 1] };
  }

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
      // The crystal is rooted in the ground, so it does not spin: its glow does the moving
      l.marker.material.emissiveIntensity = 0.3 + beat * 0.9 + loud * 0.3;
      l.core.material.color.copy(l.core.userData.base).multiplyScalar(0.7 + beat * 1.1 + loud * 0.4);
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
    for (const g of grounds.values()) g.geometry.dispose(); // the levels of detail that are not on the mesh right now
    sun.shadow.map?.dispose();
  };

  // Longitude = song time (the song runs once around the equator, eastwards)
  const timeAt = (dir) => longitudeOf(dir) * features.duration;
  const directionAt = (time, out) => directionOfLongitude((((time / features.duration) % 1) + 1) % 1, out);

  console.timeEnd('[planet] build');
  console.log('[planet]', blueprint.planetName, '| quality:', quality, '| faces:', groundFor(QUALITY[quality].detail).faces,
    `| ${Math.round(reference.water * 100)}% water`, '| flora:', flora.kinds.join(' + '), pal.night ? '| night planet' : '| day planet');

  return {
    group, getHeight, radius: RADIUS, landmarks, colours, palette, paletteSource, onBeat, update, name: blueprint.planetName,
    dispose, timeAt, directionAt, duration: features.duration, seaLevel: terrain.seaLevel, sun,
    setQuality, groundError, get quality() { return quality; },
  };
}
