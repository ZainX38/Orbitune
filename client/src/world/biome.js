// Colours from the Blueprint palette (Gemini) + the atmosphere colour (Role 2's absorption spectrum).
// The palette only has 4 colours (ground, peaks, sky, fog). Everything else (sand, rock, lush patches,
// water, light colours) is derived from them here, so any palette gives a complete, matching world.

import * as THREE from 'three';

const smoothstep = (a, b, x) => { const t = Math.max(0, Math.min(1, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
export const luminance = (c) => 0.2126 * c.r + 0.7152 * c.g + 0.0722 * c.b;

// `tint` at (about) the brightness of `base`, for tinting base's HUE without changing how bright it is.
// Colours mix as light: mixing even 1% of a bright colour into a dark one mostly adds brightness, and when the two
// are opposite hues (a green song colour into a violet night sky) what comes out is grey. gain > 1 = a brighter tint.
export function tintLike(base, tint, gain = 1) {
  return tint.clone().multiplyScalar(Math.min(1, (gain * luminance(base)) / Math.max(luminance(tint), 1e-4)));
}

// All the colours the world needs, derived from the 4 palette colours
export function derivePalette(palette) {
  const ground = new THREE.Color(palette.ground);
  const peaks = new THREE.Color(palette.peaks);
  const sky = new THREE.Color(palette.sky);
  const fog = new THREE.Color(palette.fog);
  const night = luminance(sky) < 0.08; // dark sky = night planet: dimmer, cooler light and stronger glows

  return {
    ground, peaks, sky, fog, night,
    lush: ground.clone().offsetHSL(0.06, 0.1, 0.07),                                   // lowland patches
    highland: ground.clone().lerp(peaks, 0.4),
    sand: ground.clone().lerp(new THREE.Color('#f2dfb8'), night ? 0.3 : 0.55),
    rock: ground.clone().lerp(new THREE.Color('#57525c'), 0.6).offsetHSL(0, -0.04, -0.05), // steep slopes
    canyon: ground.clone().lerp(new THREE.Color('#1c1420'), 0.55),
    // Water: the sky mixed with sea blue (it reflects the sky), lighter and a little peak-tinted near the shore
    waterShallow: sky.clone().lerp(new THREE.Color('#2a8fc4'), 0.5).lerp(peaks, 0.18).offsetHSL(0, 0.08, night ? 0.1 : 0.04),
    waterDeep: sky.clone().lerp(new THREE.Color('#123a66'), 0.6).offsetHSL(0, 0.08, night ? 0.02 : -0.1),
    foliage: ground.clone().offsetHSL(0.09, 0.12, -0.1),
    blossom: peaks.clone().lerp(new THREE.Color('#ff7fae'), 0.6),
    trunk: ground.clone().lerp(new THREE.Color('#3b2a22'), 0.7),
    cloud: new THREE.Color('#ffffff').lerp(fog, night ? 0.55 : 0.25),
    // Light: a warm sun by day, tinted moonlight at night
    sun: new THREE.Color('#fff0d8').lerp(peaks, night ? 0.35 : 0.2),
    sunIntensity: night ? 2.6 : 2.5,
    hemiSky: sky.clone().lerp(new THREE.Color('#ffffff'), night ? 0.35 : 0.4).multiplyScalar(night ? 0.85 : 0.27),
    hemiGround: ground.clone().multiplyScalar(night ? 0.5 : 0.14),
  };
}

// Returns a function: (height, slope, patch, jitter, out) -> out
//   height: getHeight() value. slope: 0 = flat ... 1 = vertical. patch: 0..1 low-frequency noise. jitter: 0..1 random.
//   levels: { high, peak } heights above the water where highland and peak colours start (from terrain.js)
export function makeColourer(pal, seaLevel, levels = { high: 4, peak: 8 }) {
  const low = new THREE.Color();
  return (h, slope, patch, jitter, out) => {
    const a = h - seaLevel; // height above the water
    if (a < -0.3) {
      out.copy(pal.rock).lerp(pal.canyon, smoothstep(-0.3, -4, a)); // dry canyon floor
    } else {
      low.copy(pal.lush).lerp(pal.ground, smoothstep(0.3, 0.7, patch));
      out.copy(pal.sand).lerp(low, smoothstep(0.15, 1.4, a));           // beach -> lowland
      out.lerp(pal.highland, smoothstep(levels.high * 0.6, levels.peak, a)); // -> highland
      const top = smoothstep(levels.peak * 0.9, levels.peak * 1.4 + 0.5, a);
      out.lerp(pal.peaks, top);                                         // -> peaks
      // Rock on steep slopes. The slope is that of a smooth (averaged) normal, so it is gentler than a single face's
      out.lerp(pal.rock, smoothstep(0.03, 0.2, slope) * (1 - 0.65 * top) * 0.85);
    }
    out.offsetHSL(0, 0, (jitter - 0.5) * 0.05); // subtle mottling, so large areas are not one flat colour
    return out;
  };
}

// Water colour from depth (0 at the shore)
export function waterColour(pal, depth, out) {
  return out.copy(pal.waterShallow).lerp(pal.waterDeep, smoothstep(0, 3.2, depth));
}

// Colours Role 4 needs for orbit vs surface view.
// sky and fog are LIVE: planet.update() re-tints them every frame to follow the music.
export function skyColours(blueprint, features) {
  const sky = new THREE.Color(blueprint.palette.sky);
  const atmosphere = new THREE.Color(features.atmosphere ?? blueprint.palette.sky);
  const fog = new THREE.Color(blueprint.palette.fog);
  const tint = 0.1; // a touch of the song's hue. tintLike keeps the palette's own brightness, so dark skies stay dark and saturated
  return {
    space: new THREE.Color('#05060d').lerp(sky, 0.003),                      // orbit background
    sky: sky.clone().lerp(tintLike(sky, atmosphere), tint),                  // surface background
    fog: fog.clone().lerp(tintLike(fog, atmosphere), tint),                  // surface fog
    atmosphere,                                                              // the song's own colour (Role 2)
  };
}
