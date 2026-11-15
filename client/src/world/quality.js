// QUALITY: the one place that decides how heavy the world is to draw.
// The demo may run on a weak laptop or a projector, so there are three levels. Default: medium.
//
//   createPlanet(features, blueprint, { quality: 'medium' });   // build at a level
//   planet.setQuality('low');                                   // switch later, in place (nothing is rebuilt)
//   applyRendererQuality(renderer, 'low');                      // the renderer's share: pixel ratio, shadow maps
//
// What a level changes is only what is DRAWN. planet.getHeight() is the same on every level (see planet.js),
// so the player, the flora and the landmarks stand in exactly the same place whatever the level.

import * as THREE from 'three';

export const QUALITY = {
  //        ground mesh   sun shadows + map size in px     share of plants / rocks / cloud puffs drawn    max device pixel ratio
  low:    { detail: 64, shadows: false, shadowMap: 1024, flora: 0.4, rocks: 0.5, clouds: 0.6, pixelRatio: 1 },
  medium: { detail: 64, shadows: true,  shadowMap: 2048, flora: 0.7, rocks: 0.7, clouds: 1,   pixelRatio: 1.5 },
  high:   { detail: 64, shadows: true,  shadowMap: 4096, flora: 1,   rocks: 1,   clouds: 1,   pixelRatio: 2 },
};
export const QUALITY_LEVELS = ['low', 'medium', 'high']; // lightest first
// Why `detail` is 64 on low too: getHeight() always describes the detail-64 ground, and a coarser DRAWN ground
// strays too far from it where the terrain is sharp (ridges, canyon rims, the shore). Measured over 20 000 directions
// with planet.groundError(), in world units (the player's eyes are 0.595 above the ground):
//   detail 56: mean 0.015, 99% under 0.13, worst 0.51      detail 40: mean 0.032, 99% under 0.24, worst 0.67
//   detail 48: mean 0.021, 99% under 0.16, worst 0.46      detail 32: mean 0.052, 99% under 0.35, worst 0.74
// A worst case of half a body height means a camera inside a hillside, or trees hanging in the air. The ground is
// only ~85k of the triangles, so low saves through shadows (the whole world drawn twice), plants and pixels instead.
// Lowering it still works (the mesh is swapped, getHeight stays): try it, then press Q on world-test.html to see the error.
export const DEFAULT_QUALITY = 'medium';

// The ground mesh getHeight() is answered from, on EVERY level. detail = icosphere subdivisions:
// 20 * (detail + 1)^2 triangles (64 = ~85k, 48 = ~48k, 40 = ~34k).
export const REFERENCE_DETAIL = 64;

export const nextQuality = (name) => QUALITY_LEVELS[(QUALITY_LEVELS.indexOf(name) + 1) % QUALITY_LEVELS.length];
export const lowerQuality = (name) => QUALITY_LEVELS[QUALITY_LEVELS.indexOf(name) - 1] ?? null; // null = already the lightest

// Everything the planet needs from the renderer. Call once at start-up and again whenever the level changes.
export function applyRendererQuality(renderer, name = DEFAULT_QUALITY) {
  const q = QUALITY[name] ?? QUALITY[DEFAULT_QUALITY];
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, q.pixelRatio));
  renderer.shadowMap.enabled = q.shadows;
  renderer.shadowMap.type = THREE.PCFShadowMap;
  return q;
}

// Draw only a share of the instances of every InstancedMesh in a group (flora, rocks, clouds). They were placed in
// random order, so the first 70% is an even 70% of the planet.
export function setDensity(group, share) {
  for (const mesh of group.children) {
    if (mesh.isInstancedMesh && mesh.userData.placed !== undefined) mesh.count = Math.round(mesh.userData.placed * share);
  }
}

// Drops one level by itself when the frame rate stays low.
//   const auto = createAutoQuality({ get: () => level, set: (name) => { ... } });
//   auto.update(dt, fps, ok);   // every frame. fps: measured over the last second. ok: false while loading or hidden
//
// - fps under `minFps` for `seconds` in a row -> one level down.
// - Nothing is counted for `settle` seconds after any change (new shaders compile, the measurement is not full yet).
// - After a drop it checks that the drop HELPED. If the frame rate did not rise by at least 10%, the level was not
//   the reason (a 30 Hz projector, a throttled battery laptop): it goes back up and stops trying.
export function createAutoQuality({ get, set, minFps = 45, seconds = 3, settle = 2, log = () => {} }) {
  let enabled = true, low = 0, wait = settle, trial = null, note = '';

  function update(dt, fps, ok = true) {
    if (!enabled) return;
    if (!ok) { low = 0; wait = Math.max(wait, settle); return; }
    if (wait > 0) { wait -= dt; low = 0; return; }

    if (trial) {
      trial.time += dt;
      if (trial.time < seconds) return;
      const helped = fps >= trial.fps * 1.1;
      if (!helped) {
        note = `${Math.round(fps)} fps on ${get()} as on ${trial.from}: not a quality problem`;
        log(`auto quality: ${note}. Back to ${trial.from}, auto off`);
        enabled = false;
        set(trial.from);
      }
      trial = null;
      return;
    }

    low = fps < minFps ? low + dt : 0;
    if (low < seconds) return;
    low = 0;
    const from = get(), to = lowerQuality(from);
    if (!to) return; // already the lightest
    log(`auto quality: ${Math.round(fps)} fps for ${seconds} s on ${from} -> ${to}`);
    trial = { from, fps, time: 0 };
    wait = settle;
    set(to);
  }

  return {
    update,
    hold(time = settle) { wait = Math.max(wait, time); low = 0; }, // call after a song load or a manual change
    off(why = 'manual') { enabled = false; trial = null; note = why; },
    get enabled() { return enabled; },
    get note() { return note; },
  };
}
