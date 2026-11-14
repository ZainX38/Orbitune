// Colours from the Blueprint palette (Gemini) + the atmosphere colour (Role 2's absorption spectrum).

import * as THREE from 'three';

// Returns a function: (height, out: THREE.Color, jitter 0..1) -> out
export function makeColourer(palette, seaLevel) {
  const ground = new THREE.Color(palette.ground);
  const peaks = new THREE.Color(palette.peaks);
  const water = new THREE.Color(palette.sky).lerp(new THREE.Color('#0b1a2e'), 0.5);
  const shore = ground.clone().lerp(new THREE.Color('#e8d9b0'), 0.4);

  return (h, out, jitter = 0.5) => {
    if (h <= seaLevel + 0.01) out.copy(water);
    else if (h < 0.4) out.copy(shore);
    else if (h < 7) out.copy(ground).lerp(peaks, Math.min(1, (h - 0.4) / 8));
    else out.copy(peaks);
    out.offsetHSL(0, 0, (jitter - 0.5) * 0.05); // tiny per-face variation = low-poly look
    return out;
  };
}

// Colours Role 4 needs for orbit vs surface view
export function skyColours(blueprint, features) {
  const atmosphere = new THREE.Color(features.atmosphere ?? blueprint.palette.sky);
  return {
    space: new THREE.Color('#05060d'),                                   // orbit background
    sky: atmosphere.clone().lerp(new THREE.Color(blueprint.palette.sky), 0.3), // surface background
    fog: new THREE.Color(blueprint.palette.fog).lerp(atmosphere, 0.4),   // surface fog
    atmosphere,
  };
}