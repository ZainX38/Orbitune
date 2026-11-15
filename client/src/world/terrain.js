// Turns AudioFeatures (+ Blueprint sections) into a height function.
// getHeight(direction) is CONTRACT 3: Role 4 uses it to stand the player on the ground.
// The mesh in planet.js is built from this exact function, so they always match.
// The height NEVER changes after the planet is built (beats only change light and colour).

import * as THREE from 'three';
import { fbm, noise3, makeRng } from './noise.js';

export const RADIUS = 50;
const DEBUG = true;

// ---------- Longitude <-> song time (the song runs once around the equator, eastwards) ----------
// 0..1 around the planet. Same maths as the landmark placement below.
export const longitudeOf = (dir) => (Math.atan2(dir.z, dir.x) / (Math.PI * 2) + 1) % 1;
export const directionOfLongitude = (u, out = new THREE.Vector3()) => out.set(Math.cos(u * Math.PI * 2), 0, Math.sin(u * Math.PI * 2));

// Moving average with wrap-around (the equator loops, so the end of the song meets the start)
function smooth(arr, window) {
  const n = arr.length, out = new Array(n);
  for (let i = 0; i < n; i++) {
    let sum = 0;
    for (let k = -window; k <= window; k++) sum += arr[(i + k + n) % n];
    out[i] = sum / (2 * window + 1);
  }
  return out;
}

// u in 0..1 (song progress) -> interpolated value
function sampler(arr) {
  const n = arr.length;
  return (u) => {
    const x = (((u % 1) + 1) % 1) * n;
    const i = Math.floor(x) % n, j = (i + 1) % n, f = x - Math.floor(x);
    return arr[i] * (1 - f) + arr[j] * f;
  };
}

// Shortest distance between two longitudes in 0..1 space
const lonDist = (a, b) => { const d = Math.abs(a - b) % 1; return Math.min(d, 1 - d); };
const mean = (arr) => arr.reduce((a, b) => a + b, 0) / arr.length;
const clamp01 = (v) => Math.max(0, Math.min(1, v));

// The overall SHAPE of the world comes from the song as a whole, so two songs never look alike:
// fast, bright songs -> many sharp ridges and broken coasts. Slow, warm songs -> broad rolling continents.
function character(features) {
  const tempo = clamp01(((features.bpm || 100) - 70) / 70);
  const bass = mean(features.bass), treble = mean(features.treble);
  const brightness = treble / (treble + bass + 1e-6);
  const sharp = clamp01(0.75 * tempo + 0.5 * (brightness - 0.4));
  return {
    sharp,                               // 0 = soft and rolling, 1 = jagged
    continentScale: 1.0 + 0.8 * sharp,   // higher = more, smaller landmasses
    continentHeight: 13 + 6 * sharp,
    hillHeight: 2.6 + 2.2 * sharp,
    seaShare: 0.46 - 0.12 * sharp,       // how much of the planet is under water
  };
}

export function createTerrain(features, blueprint) {
  const bass = sampler(smooth(features.bass, 16));
  const mid = sampler(smooth(features.mid, 8));
  const treble = sampler(smooth(features.treble, 4));
  const loud = sampler(smooth(features.loudness, 12));
  const shape = character(features);

  // Seed from the song itself, so the same song always makes the same planet
  const seed = Math.floor(features.bass.reduce((a, b) => a + b, 0) * 1000) % 100000;

  // Chorus -> mountain range, drop -> canyon, placed on the equator at that moment in the song.
  // NOTE: send Gemini the SAME audio you analyse (e.g. the 30 s preview), or the times won't line up.
  const bumps = (blueprint?.sections ?? [])
    .filter((s) => (s.type === 'chorus' || s.type === 'drop') && s.start < features.duration)
    .map((s) => {
      const centre = (s.start + Math.min(s.end, features.duration)) / 2;
      const u = centre / features.duration;
      return { type: s.type, u, time: centre, dir: directionOfLongitude(u) };
    });

  // Sea level: chosen so that a fixed share of this planet is under water, whatever the song's numbers are
  const rng = makeRng(seed + 5), probe = new THREE.Vector3(), samples = [];
  for (let i = 0; i < 3000; i++) {
    do { probe.set(rng() * 2 - 1, rng() * 2 - 1, rng() * 2 - 1); } while (probe.lengthSq() > 1 || probe.lengthSq() < 0.01);
    probe.normalize();
    samples.push(rawHeight(probe.x, probe.y, probe.z, longitudeOf(probe), Math.sqrt(1 - probe.y * probe.y)));
  }
  samples.sort((a, b) => a - b);
  const SEA_LEVEL = samples[Math.floor(samples.length * shape.seaShare)];
  // Typical land heights above the water on THIS planet, so the colour bands fit any song
  const land = samples.filter((h) => h > SEA_LEVEL).map((h) => h - SEA_LEVEL);
  const levels = { high: land[Math.floor(land.length * 0.6)], peak: land[Math.floor(land.length * 0.93)], top: land[land.length - 1] };

  if (DEBUG) {
    console.log('[terrain] seed', seed, '| sharpness', shape.sharp.toFixed(2), '| sea level', SEA_LEVEL.toFixed(2),
      '| landmark bumps', bumps.map((b) => `${b.type}@${b.u.toFixed(2)}`));
  }

  // Height before the sea flattens it. Below SEA_LEVEL = sea bed (only used for water depth and colour).
  function rawHeight(x, y, z, u, band) {
    const s = shape.continentScale;
    // Bend the coordinates a little first, so coasts and ridges curve instead of following the noise grid
    const wx = x + 0.3 * noise3(x * 1.7 + 9.1, y * 1.7, z * 1.7, seed + 60);
    const wy = y + 0.3 * noise3(x * 1.7, y * 1.7 + 4.3, z * 1.7, seed + 61);
    const wz = z + 0.3 * noise3(x * 1.7, y * 1.7, z * 1.7 + 7.7, seed + 62);
    x = wx; y = wy; z = wz;
    const soft = fbm(x * s, y * s, z * s, 4, seed);
    // Ridged noise: crests where the noise crosses zero (slightly rounded, so the mesh can follow them)
    const r = fbm(x * s * 1.6, y * s * 1.6, z * s * 1.6, 3, seed + 40);
    const ridged = 0.42 - 2.3 * Math.sqrt(r * r + 0.004);
    const continents = (soft + (ridged - soft) * shape.sharp * 0.75) * (0.6 + bass(u)) * shape.continentHeight; // bass -> landmasses
    const hills = fbm(x * 3.5, y * 3.5, z * 3.5, 3, seed + 10) * mid(u) * shape.hillHeight * band;              // mids -> hills
    const detail = noise3(x * 12, y * 12, z * 12, seed + 20) * treble(u) * 0.8;                                  // treble -> fine detail
    const ridge = loud(u) * 3 * band ** 3;                                                                       // loudness -> equator ridge
    return continents + hills + detail + ridge;
  }

  function bumpHeight(u, band) {
    let h = 0;
    for (const b of bumps) {
      const d = lonDist(u, b.u);
      const g = Math.exp(-(d * d) / (2 * 0.03 * 0.03)) * band ** 6;
      h += b.type === 'drop' ? -6 * g : 8 * g;
    }
    return h;
  }

  // CONTRACT 3. dir: normalised THREE.Vector3 in the planet's own space -> height above RADIUS.
  function getHeight(dir) {
    const { x, y, z } = dir;
    // Longitude = song time. atan2(z, x) matches the bump directions above.
    const u = (Math.atan2(z, x) / (Math.PI * 2) + 1) % 1;
    const lat = Math.asin(Math.max(-1, Math.min(1, y)));
    const band = Math.cos(lat); // 1 at the equator, 0 at the poles: the song is strongest along the equator
    // Flat oceans. Landmarks are added AFTER the sea clamp, so the canyon stays dry.
    return Math.max(rawHeight(x, y, z, u, band), SEA_LEVEL) + bumpHeight(u, band);
  }

  // How deep the sea bed is under the (flat) water at dir. 0 on land. Only for colouring the water.
  function getDepth(dir) {
    const { x, y, z } = dir;
    const u = (Math.atan2(z, x) / (Math.PI * 2) + 1) % 1;
    const band = Math.cos(Math.asin(Math.max(-1, Math.min(1, y))));
    return Math.max(0, SEA_LEVEL - rawHeight(x, y, z, u, band));
  }

  return { getHeight, getDepth, radius: RADIUS, seaLevel: SEA_LEVEL, levels, landmarkSpots: bumps, seed, shape };
}
