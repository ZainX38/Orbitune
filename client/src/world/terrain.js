// Turns AudioFeatures (+ Blueprint sections) into a height function.
// getHeight(direction) is CONTRACT 3: Role 4 uses it to stand the player on the ground.
// The mesh in planet.js is built from this exact function, so they always match.

import * as THREE from 'three';
import { fbm, noise3 } from './noise.js';

export const RADIUS = 50;
const SEA_LEVEL = -1.5;
const DEBUG = true;

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

export function createTerrain(features, blueprint) {
  const bass = sampler(smooth(features.bass, 16));
  const mid = sampler(smooth(features.mid, 8));
  const treble = sampler(smooth(features.treble, 4));
  const loud = sampler(smooth(features.loudness, 12));

  // Seed from the song itself, so the same song always makes the same planet
  const seed = Math.floor(features.bass.reduce((a, b) => a + b, 0) * 1000) % 100000;

  // Chorus -> mountain range, drop -> canyon, placed on the equator at that moment in the song.
  // NOTE: send Gemini the SAME audio you analyse (e.g. the 30 s preview), or the times won't line up.
  const bumps = (blueprint?.sections ?? [])
    .filter((s) => (s.type === 'chorus' || s.type === 'drop') && s.start < features.duration)
    .map((s) => {
      const centre = (s.start + Math.min(s.end, features.duration)) / 2;
      const u = centre / features.duration;
      const angle = u * Math.PI * 2;
      return { type: s.type, u, dir: new THREE.Vector3(Math.cos(angle), 0, Math.sin(angle)) };
    });

  if (DEBUG) console.log('[terrain] seed', seed, 'landmark bumps', bumps.map((b) => `${b.type}@${b.u.toFixed(2)}`));

  function getHeight(dir) {
    const { x, y, z } = dir;
    // Longitude = song time. atan2(z, x) matches the bump directions above.
    const u = (Math.atan2(z, x) / (Math.PI * 2) + 1) % 1;
    const lat = Math.asin(Math.max(-1, Math.min(1, y)));
    const band = Math.cos(lat); // 1 at the equator, 0 at the poles: the song is strongest along the equator

    const continents = fbm(x * 1.2, y * 1.2, z * 1.2, 4, seed) * (0.6 + bass(u)) * 7; // bass -> landmasses
    const hills = fbm(x * 3.5, y * 3.5, z * 3.5, 3, seed + 10) * mid(u) * 3 * band;   // mids -> hills
    const detail = noise3(x * 12, y * 12, z * 12, seed + 20) * treble(u) * 0.8;        // treble -> fine detail
    const ridge = loud(u) * 3 * band ** 3;                                              // loudness -> equator ridge

    let h = Math.max(continents + hills + detail + ridge, SEA_LEVEL); // flat oceans

    // Landmarks added AFTER the sea clamp, so the canyon stays dry
    for (const b of bumps) {
      const d = lonDist(u, b.u);
      const g = Math.exp(-(d * d) / (2 * 0.03 * 0.03)) * band ** 6;
      h += b.type === 'drop' ? -6 * g : 8 * g;
    }
    return h;
  }

  return { getHeight, radius: RADIUS, seaLevel: SEA_LEVEL, landmarkSpots: bumps, seed };
}
