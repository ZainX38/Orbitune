// Makes the planet react LIVE to the music WITHOUT moving any geometry (the player stands on the ground).
// Everything here is light and colour, done in the shaders through a few shared uniforms:
//   - beat ripples: rings of light that spread over the ground from the listener
//   - loudness: the whole world glows and saturates a little with the current loudness
//   - mids: flora sways more (a vertex wobble of the TREES only, never the ground)
//   - water: moving waves, sparkle and shore foam
//   - hemisphere light: sky colour from above, ground colour from below, relative to the planet's own "up"
//
// planet.js calls: reactive.patch(material, kind), reactive.onBeat(strength), reactive.update(dt, songTime, listenerDirection)

import * as THREE from 'three';
import { RADIUS } from './terrain.js';
import { tintLike } from './biome.js';

const MAX_RIPPLES = 4;
const RIPPLE_SPEED = 26; // units per second along the ground
const RIPPLE_LIFE = 1.9; // seconds
const RIPPLE_WIDTH = 1.1;

const VERTEX_PARS = /* glsl */ `
  varying vec3 vPlanetPos;
  varying vec3 vUpView;
  #ifdef ORB_TERRAIN
    attribute float aWater;
    varying float vWater;
  #endif
  #ifdef ORB_FLORA
    attribute float aGlow;
    varying float vGlow;
    uniform float uTime;
    uniform float uSway;
  #endif
`;

const VERTEX_MAIN = /* glsl */ `
  #ifdef ORB_FLORA
    vGlow = aGlow;
    #ifdef USE_INSTANCING
      // Sway: bend the top of each plant (geometry Y is the plant's own "up"). Each plant has its own phase.
      float orbPhase = dot(instanceMatrix[3].xyz, vec3(0.37, 0.51, 0.43));
      float orbBend = transformed.y * transformed.y * 0.03 * uSway;
      transformed.x += sin(uTime * 1.7 + orbPhase) * orbBend;
      transformed.z += cos(uTime * 1.3 + orbPhase * 1.3) * orbBend;
    #endif
  #endif
  #ifdef USE_INSTANCING
    vPlanetPos = (instanceMatrix * vec4(transformed, 1.0)).xyz;
  #else
    vPlanetPos = transformed;
  #endif
  vUpView = normalMatrix * normalize(vPlanetPos);
  #ifdef ORB_TERRAIN
    vWater = aWater;
  #endif
`;

const FRAGMENT_PARS = /* glsl */ `
  varying vec3 vPlanetPos;
  varying vec3 vUpView;
  uniform float uTime;
  uniform float uBeat;
  uniform float uLoud;
  uniform vec4 uRipples[${MAX_RIPPLES}];
  uniform vec3 uRippleColor;
  uniform vec3 uHemiSky;
  uniform vec3 uHemiGround;
  #ifdef ORB_TERRAIN
    varying float vWater;
  #endif
  #ifdef ORB_FLORA
    varying float vGlow;
  #endif
`;

// After <color_fragment>: animated water (colour only)
const FRAGMENT_COLOUR = /* glsl */ `
  vec3 orbDir = normalize(vPlanetPos);
  vec3 orbUp = normalize(vUpView);
  #ifdef ORB_TERRAIN
    vec3 orbQ = orbDir * 42.0;
    float orbWave = 0.0;
    if (vWater > 0.25) {
      orbWave = (sin(orbQ.x * 1.3 + orbQ.y * 0.7 + uTime * 0.9)
               + sin(orbQ.z * 1.7 - orbQ.x * 0.6 + uTime * 1.2)
               + sin((orbQ.y + orbQ.z) * 2.3 + uTime * 0.7)) / 3.0;
      float orbDepth = clamp((vWater - 0.5) * 2.0, 0.0, 1.0);
      diffuseColor.rgb *= 1.0 + 0.12 * orbWave + 0.1 * uLoud;
      float orbFoam = smoothstep(0.16, 0.02, orbDepth + orbWave * 0.05);   // foam line along the shore
      diffuseColor.rgb = mix(diffuseColor.rgb, vec3(1.0), orbFoam * 0.55);
    }
  #endif
`;

// After <roughnessmap_fragment>: water is shiny
const FRAGMENT_ROUGHNESS = /* glsl */ `
  #ifdef ORB_TERRAIN
    if (vWater > 0.25) roughnessFactor = 0.2;
  #endif
`;

// After <normal_fragment_begin>: water gets a smooth, wobbling normal instead of flat facets -> moving highlights
const FRAGMENT_NORMAL = /* glsl */ `
  #ifdef ORB_TERRAIN
    if (vWater > 0.25) {
      vec3 orbWobble = vec3(
        cos(orbQ.x * 2.1 + orbQ.z * 1.3 + uTime * 1.1),
        cos(orbQ.y * 2.6 - orbQ.x * 1.1 + uTime * 0.8),
        cos(orbQ.z * 1.9 + orbQ.y * 1.7 - uTime * 1.3));
      normal = normalize(orbUp + 0.09 * orbWobble);
    }
  #endif
`;

// After <emissivemap_fragment>: hemisphere light, beat ripples, loudness glow, glowing flora
const FRAGMENT_LIGHT = /* glsl */ `
  float orbHemi = 0.5 + 0.5 * dot(normal, orbUp);
  totalEmissiveRadiance += diffuseColor.rgb * mix(uHemiGround, uHemiSky, orbHemi) * (1.0 + 0.5 * uLoud);
  #ifdef ORB_CLOUD
    totalEmissiveRadiance += diffuseColor.rgb * (uHemiSky * 0.9 + 0.12); // soft, bright undersides
  #endif
  #ifndef ORB_CLOUD
    for (int i = 0; i < ${MAX_RIPPLES}; i++) {
      float orbAge = uRipples[i].w;
      if (orbAge >= 0.0) {
        float orbDist = acos(clamp(dot(orbDir, uRipples[i].xyz), -1.0, 1.0)) * ${RADIUS.toFixed(1)};
        float orbX = (orbDist - orbAge * ${RIPPLE_SPEED.toFixed(1)}) / ${RIPPLE_WIDTH.toFixed(1)};
        float orbFade = max(0.0, 1.0 - orbAge / ${RIPPLE_LIFE.toFixed(1)});
        totalEmissiveRadiance += uRippleColor * exp(-orbX * orbX) * orbFade * orbFade;
      }
    }
  #endif
  #ifdef ORB_FLORA
    totalEmissiveRadiance += diffuseColor.rgb * vGlow * (0.7 + 1.8 * uBeat + 0.7 * uLoud);
  #endif
`;

const smoothTo = (from, to, rate, dt) => from + (to - from) * (1 - Math.exp(-rate * dt));

export function createReactive(features, pal, colours) {
  const uniforms = {
    uTime: { value: 0 },
    uBeat: { value: 0 },   // 1 on a beat, fades out
    uLoud: { value: 0.4 }, // 0..1, loudness now
    uSway: { value: 0.3 }, // flora sway amount, from the mids
    uRipples: { value: Array.from({ length: MAX_RIPPLES }, () => new THREE.Vector4(1, 0, 0, -1)) }, // xyz = origin, w = age (-1 = off)
    uRippleColor: { value: pal.peaks.clone().lerp(colours.atmosphere, 0.25).multiplyScalar(pal.night ? 1.0 : 0.5) },
    uHemiSky: { value: pal.hemiSky.clone() },
    uHemiGround: { value: pal.hemiGround.clone() },
  };

  // What the music is doing now (smoothed), for planet.js to use on the atmosphere, landmarks and sky
  const now = { beat: 0, loud: 0.4, bass: 0.4, mid: 0.4, treble: 0.4 };
  const listener = new THREE.Vector3(1, 0, 0);
  let nextRipple = 0;

  const baseSky = colours.sky.clone(), baseFog = colours.fog.clone();
  // What loud moments pull the sky and fog towards: the music's colour, at most 3x as bright as the sky or fog itself.
  // (Unscaled, this bright colour turned dark night skies grey: see tintLike.)
  const tint = pal.peaks.clone().lerp(colours.atmosphere, 0.5);
  const skyTint = tintLike(baseSky, tint, 3), fogTint = tintLike(baseFog, tint, 3);

  // Feature value at a song time, interpolated between frames
  function sample(arr, songTime) {
    const x = (((songTime / features.duration) % 1) + 1) % 1 * arr.length;
    const i = Math.floor(x) % arr.length, j = (i + 1) % arr.length, f = x - Math.floor(x);
    return arr[i] * (1 - f) + arr[j] * f;
  }

  // Adds our shader pieces to a MeshStandardMaterial. kind: 'terrain' | 'flora' | 'cloud'
  function patch(material, kind) {
    material.defines = { ...material.defines, [`ORB_${kind.toUpperCase()}`]: '' };
    material.onBeforeCompile = (shader) => {
      Object.assign(shader.uniforms, uniforms);
      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', `#include <common>\n${VERTEX_PARS}`)
        .replace('#include <begin_vertex>', `#include <begin_vertex>\n${VERTEX_MAIN}`);
      shader.fragmentShader = shader.fragmentShader
        .replace('#include <common>', `#include <common>\n${FRAGMENT_PARS}`)
        .replace('#include <color_fragment>', `#include <color_fragment>\n${FRAGMENT_COLOUR}`)
        .replace('#include <roughnessmap_fragment>', `#include <roughnessmap_fragment>\n${FRAGMENT_ROUGHNESS}`)
        .replace('#include <normal_fragment_begin>', `#include <normal_fragment_begin>\n${FRAGMENT_NORMAL}`)
        .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>\n${FRAGMENT_LIGHT}`);
    };
    material.customProgramCacheKey = () => `orbitune-${kind}`;
    return material;
  }

  // A beat: pulse + a new ripple starting under the listener
  function onBeat(strength = 1) {
    now.beat = Math.min(1.5, now.beat + 0.7 * strength);
    uniforms.uRipples.value[nextRipple].set(listener.x, listener.y, listener.z, 0);
    nextRipple = (nextRipple + 1) % MAX_RIPPLES;
  }

  // songTime (seconds) and listenerDirection (unit vector, planet space) are optional: without them the planet idles.
  function update(dt, songTime, listenerDirection) {
    uniforms.uTime.value += dt;
    if (listenerDirection) listener.copy(listenerDirection).normalize();

    const has = typeof songTime === 'number';
    now.beat *= Math.exp(-dt * 5);
    now.loud = smoothTo(now.loud, has ? sample(features.loudness, songTime) : 0.4, 9, dt);
    now.bass = smoothTo(now.bass, has ? sample(features.bass, songTime) : 0.4, 9, dt);
    now.mid = smoothTo(now.mid, has ? sample(features.mid, songTime) : 0.4, 5, dt);
    now.treble = smoothTo(now.treble, has ? sample(features.treble, songTime) : 0.4, 9, dt);

    uniforms.uBeat.value = now.beat;
    uniforms.uLoud.value = now.loud;
    uniforms.uSway.value = 0.15 + 1.1 * now.mid;

    for (const r of uniforms.uRipples.value) {
      if (r.w >= 0) r.w += dt;
      if (r.w > RIPPLE_LIFE) r.w = -1;
    }

    // Sky and fog follow the moment: brighter and more tinted when the song is loud, a flash on each beat
    const k = Math.min(0.5, 0.16 * now.loud + 0.1 * now.beat + 0.08 * now.treble) * 0.7;
    colours.sky.copy(baseSky).lerp(skyTint, k);
    colours.fog.copy(baseFog).lerp(fogTint, k * 0.7);
  }

  return { uniforms, patch, onBeat, update, now, listener };
}
