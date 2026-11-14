# PLAN: song loop bug, smoother terrain, better objects

Branch `mvp-planet`. Files touched only in `client/src/world/`, `client/src/experience/`, `client/src/mvp/`, plus this plan as `PLAN.md` at the repo root. One commit per step, never pushed.

## Context

Three things are wrong with the MVP planet today:

1. After landing, the music repeats the same couple of seconds forever.
2. The terrain is flat-shaded with one hard colour per triangle, so it looks blocky and spiky.
3. Trees, crystals and clouds are bare primitives (cones, octahedra, detail-1 blobs), also flat-shaded.

Two things to know before you approve:

- **Branch state.** The repo is currently on `main`. `mvp-planet` has the same code in the three folders but is missing main's last two commits (`demo.json`, removal of `client/index.html`, a `package.json` change), and the two branches have different commit hashes for the same messages. I will check out `mvp-planet` and work there as asked, without merging or rebasing anything.
- **Plan mode.** I could not write `PLAN.md` into the repo yet. Step 0 after approval copies this plan there and commits it.

---

## Task 1: the song repeats after landing

### Root cause (from the code, not yet confirmed by a run)

It is not a glitch: it is the designed "one-bar window" in `client/src/experience/songPosition.js`, and on the surface it cannot be escaped.

- `land()` in `mvp/main.js:285` calls `music.setFree(false)`.
- From then on `update()` (`songPosition.js:107-118`) compares the listener's song time with the music's: `ahead = listenerTime - time`. When `|ahead| > bar / 2` it calls `play(time + round(ahead / bar) * bar)`.
- Standing still, `listenerTime` is constant and `time` grows by 1 s per second. After half a bar `ahead < -bar/2`, so it jumps back exactly one bar. That repeats every `bar` seconds (`bar = min(duration / 4, 240 / bpm)`, about 2 s). This is the loop you hear.
- Walking does not get you out. `player.js:29-33` already says it: a 30 s song travels along the equator at about 10.5 units/s, a run is 3.85. Even running east the music outruns you, so it keeps jumping back a bar.

The existing debug log should already show this in your console: a `[song] jump -1 bar(s): ...` line every ~2 s with the same `listener at` value.

### The other suspects, checked

| Suspect | Verdict | Evidence |
| --- | --- | --- |
| Restarting every frame | No | `MIN_JUMP_GAP` 0.25 s, and after a jump `|ahead| <= bar/2`, so it is one jump per bar. |
| Camera moving during the landing animation | No | The music listens to `player.getDirection()`, which `player.place()` sets once at the click. It does not follow the camera. |
| Overlapping sources never stopped | No leak, but fragile | `play()` fades and stops the old source 0.08 s later. Weak points: `dispose()` never disconnects its source, and `seek()` skips the jump gap. |
| `AudioContext.currentTime` vs song offset | No | `timeAt = offset + (now - startedAt) mod duration` is right. |

### Step 1 confirms it before anything is fixed

Add temporary logs in `songPosition.js`: mode (free/surface), listener longitude and song time, target time, actual playback time, live source count, and one line for every source start and stop. Run the page, land, stand still, and read the console. Expected: one stop + one start per bar, target = time minus one bar, listener constant. If the logs show something else, I stop and tell you before fixing.

### New behaviour

Options for standing still:

- **A. Keep playing, playhead marker on the ground (yours, recommended).** Never loops.
- B. Keep the bar loop but only after a few seconds of standing. Still feels broken.
- C. Pause when you stop. Kills the atmosphere.

I recommend A, with one change to your re-sync rule.

**The catch in "re-sync if the difference is more than 1.5 s".** If "difference" means music position minus my position, the loop comes back: the music runs about 6x faster than a walk, so that difference passes 1.5 s roughly every 1.8 s while you walk. Each time it would snap back to you.

**Recommended rule: measure how far YOU have moved, not how far the music has run.**

- The music always plays forward at normal speed. Nothing happens while you stand still.
- An anchor remembers your longitude at the last sync (set at landing).
- When your longitude is more than 1.5 s of song away from the anchor (about 16 units of ground on a 30 s clip), the music crossfades to your position and the anchor moves there.
- Landing does **not** seek. The song carries on through orbit, landing and first person. The landing spot only becomes the anchor.

Alternative if you prefer it: walking nudges the song by the amount you walked (east = skip forward, west = rewind) instead of jumping to your position. Say so and I will build that instead.

Details:

- Crossfade 0.15 s, equal-power, on gain ramps (no clicks).
- The jump target is rounded so it lands on the same beat phase (shift by a whole number of beats), so the rhythm does not stumble.
- At least 1 s between re-syncs. Near the poles a few steps cross many longitudes, so this cap matters there.
- **One source.** All live voices are kept in a set. Starting a voice fades and stops every other one. `onended` disconnects source and gain and removes them from the set. `dispose()` stops and disconnects all. The only time two exist is the 0.15 s crossfade.
- **Playhead marker on the surface** (`mvp/main.js`, `createMarker` / `updateMarker`): today it hides once you land and sits only on the equator. New: it stays visible, sits at the music's longitude at your latitude, and gets a tall soft light beam, because your horizon is only ~8 units away and the playhead passes at ~10 units/s. You see it sweep round and pass you once per lap.

Files: `experience/songPosition.js`, `mvp/main.js`, comment fix in `experience/player.js:29-33`.

Risks: beats fire from song time and already skip across jumps, so ripples keep working. `planet.update()` still gets the player's direction for ripples and sun. The sky tint follows what is sounding, as before.

---

## Task 2: smoother terrain

What I will do in `world/planet.js`, `world/terrain.js`, `world/biome.js`, `world/surface.js`:

- **Shared vertices, smooth normals.** Displace the icosphere as now, then `mergeVertices` (already available: `three/addons/utils/BufferGeometryUtils.js`, used in `flora.js`), `computeVertexNormals()`, and `flatShading: false`.
- **Per-vertex colours.** Colour each vertex from its own height, its smooth-normal slope and the patch noise, using the existing `makeColourer`. The GPU then blends across triangles. Per-face random jitter goes; a faint low-frequency noise tint replaces it. Band edges in `biome.js` get slightly wider smoothsteps.
- **Water.** `aWater` becomes per-vertex too, so the shoreline is a blended edge inside the shore triangles instead of a zigzag of whole faces.
- **More detail.** Raise `DETAIL` from 50 (52k triangles) towards 64 (85k), only if the measured frame rate stays at 60. `GRID` in `surface.js` scales with it.
- **Softer maths, inside `terrain.getHeight`.** Lower the frequency and amplitude of the treble detail layer (`noise3(x*12) * 0.8`), round the ridged-noise crests more (`sqrt(r*r + 0.004)`), widen and lower the chorus/drop bumps (`sigma 0.03`, `+8 / -6`). Sea level and colour bands are derived from the same function, so they re-fit themselves.

**getHeight stays exact.** `planet.getHeight` is answered by `surface.js` from the drawn triangles. Smooth shading changes normals only, not the triangles. `surface.js` reads a non-indexed position array, so I hand it the positions before merging (same triangles) and add a check that the merged mesh matches. The ground still never moves.

Risks:

- Player: none expected, since it only calls `getHeight`. Verified by the existing "height above ground" log staying at eye height.
- Softer terrain changes each planet's shape, so flora, landmarks and sea coverage shift slightly. They are all placed from `getHeight`, so nothing floats.
- Smooth shading can make hills read as mushy. I keep some crispness with the slope-driven rock colour.
- Click-to-land raycasts the ground mesh once per click; 85k triangles is still fine.

---

## Task 3: objects

- **Trees** (`world/flora.js`): each shape gets a tapered trunk and a canopy of 2-4 overlapping rounded blobs (subdivided, slightly noise-displaced icospheres, smooth normals). Pines become stacked rounded tiers instead of sharp cones. Shapes still chosen by `pickShapes(blueprint.flora)`. Per-tree variation: scale, spin, a small lean, and a per-instance colour shift with `setColorAt`. The `aGlow` attribute and sway shader stay as they are.
- **Rocks** (new `world/rocks.js`, wired in `planet.js`): 3 boulder shapes, one `InstancedMesh` each, about 400 in total. Smooth displaced icospheres in the palette's rock colour, non-uniform scale, random spin, sunk slightly into the ground, more of them on slopes and highlands. Material patched with a new `'rock'` kind in `reactive.js` so they get sky light and beat ripples but no sway.
- **Landmark crystals** (`world/landmarks.js`): a rooted cluster of hexagonal shards with pointed tips, standing on the ground instead of one octahedron floating 3.2 above it. Translucent outer shell plus a smaller emissive core that pulses on beats. `landmark.marker` stays a mesh with an emissive material and `landmark.beam` stays, so `planet.update()` and Role 4 keep working. The spin is removed, because a rooted cluster should not rotate.
- **Clouds** (`world/clouds.js`): smooth shading, more subdivided puffs, 5-9 overlapping puffs per cluster with a flat base and rounded tops.
- **Materials**: `MeshStandardMaterial` throughout, roughness tuned per kind (trunk 0.9, foliage 0.8, rock 0.95, crystal 0.25 with a little metalness), bases darkened towards the ground for a grounded look, all colours from `derivePalette`.
- **Soft shadows** (last step, behind a `SHADOWS` flag in `planet.js` and `mvp/main.js`): the sun casts onto terrain, flora and rocks, with the shadow frustum centred on the listener. Note: three 0.187 has removed `PCFSoftShadowMap` (it warns and falls back to `PCFShadowMap`), so I will use `PCFShadowMap` with a blurred radius. Kept only if 60 fps holds; otherwise the flag ships off and I report it.

Everything is placed with `getHeight` and oriented with `setFromUnitVectors(UP, dir)`, as the current flora is.

Risks: shadows roughly double the terrain draw cost and can show acne on smooth slopes (needs `normalBias` tuning). Swaying tree tops are not swayed in the shadow pass, which is barely visible. `world/dev.js` (the test page) calls `createPlanet` and must keep working.

---

## Order of work (one commit each)

| # | Step | Commit message |
| --- | --- | --- |
| 0 | Check out `mvp-planet`, add `PLAN.md`, measure baseline fps and build time | `add plan for song fix, smooth terrain and objects` |
| 1 | Temporary trace logs in `songPosition.js`, run, confirm the cause | `trace song position to find the repeat bug` |
| 2 | New playback: free-running, anchor re-sync, crossfade, one voice | `stop the bar loop: song plays on, resync only after walking` |
| 3 | Surface playhead marker with beam | `show the playhead on the ground while walking` |
| 4 | Remove the temporary logs, update comments | `remove song trace logs` |
| 5 | Merged vertices, smooth normals, per-vertex colours and water | `smooth terrain shading and blended colours` |
| 6 | Softer height function and bumps | `soften terrain detail and landmark bumps` |
| 7 | Raise `DETAIL` if fps allows | `raise planet detail` |
| 8 | Trees | `rounded trees with per-tree variation` |
| 9 | Rocks | `add boulders` |
| 10 | Landmark crystals | `refine landmark crystals with inner glow` |
| 11 | Clouds | `soft rounded clouds` |
| 12 | Shadows behind a flag, decided by fps | `add soft sun shadows` |
| 13 | `world/README.md` and file header comments | `document smooth terrain, rocks and new playback` |

## Verification

I will run `npm run dev` in `client/` and drive `mvp.html?nolock` in Chrome, using `window.mvp` (`land`, `takeOff`, `music`, `player`).

- **Step 1-4 (audio):** read the console. Pass = after landing and 20 s standing still there is no source start/stop line and playback time rises steadily; walking more than 1.5 s of song gives exactly one stop and one start; live source count is 1 outside crossfades; song switch and take-off leave 1 source. **I cannot hear the audio**, so clicks and the feel of the crossfade are yours to check.
- **Step 5-7 (terrain):** screenshots from orbit and on the surface for both demo songs. A script check that `planet.getHeight` equals the mesh at a few thousand random directions, and that the "height above ground" log stays at eye height while walking. Flora base heights compared with `getHeight`.
- **Step 8-12 (objects):** screenshots up close and from orbit; a check that every instance base is at or just below `getHeight`.
- **Frame rate:** a `requestAnimationFrame` counter in orbit and on the surface, before step 1 and after steps 7, 11 and 12, plus the `[planet] build` time. This is measured on this machine in a foreground Chrome tab; your laptop on battery may differ, so I will report the numbers and you should confirm.

## Final report (after implementation)

Root cause and fix, changes per task with files and commit hashes, fps before and after, and the list of what I could not verify (audio by ear, visual taste).
