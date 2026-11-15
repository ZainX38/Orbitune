# world/ (Role 3: World builder)

Builds the planet from `AudioFeatures` (Contract 2) and a `Blueprint` (Contract 1).
Contracts 1 to 3 in `docs/PROMPT.md` are unchanged. This file lists what changed in the
**module interface** of `createPlanet`, so the team can update their code.

## Quick use

```js
import { createPlanet } from './world/planet.js';

const planet = createPlanet(features, blueprint);
scene.add(planet.group);                 // brings its own sun and sky light: add NO lights for it
renderer.toneMapping = THREE.ACESFilmicToneMapping; // the colours are tuned for this
renderer.shadowMap.enabled = true;                  // the sun casts soft shadows (switch: SHADOWS in planet.js)
renderer.shadowMap.type = THREE.PCFShadowMap;

// every frame
planet.update(dt, songTime, listenerDirection);
// on every beat of the song
planet.onBeat();
// before building another planet
planet.dispose();
```

Test page: `npm run dev`, then `http://localhost:5173/world-test.html` (fake data) or `/mvp.html` (real demo songs).

## What createPlanet returns

| Field | Status | What it is |
| --- | --- | --- |
| `group` | same | `THREE.Group` with everything. Now also contains the sun (a `DirectionalLight`). |
| `getHeight(direction)` | same call (Contract 3), **more exact** | Height above `radius` for a normalised direction in the planet's own space. It returns the height of the **drawn mesh** (the flat triangles), not the height function the mesh was sampled from: between vertices those two differ, so trees floated and a low camera could end up under the ground. The ground is now smooth-SHADED, but that only changes its lighting: the triangles are where they were, and this is still exact. Never changes after the build. About 0.6 µs per call. |
| `radius` | same | 50 |
| `landmarks` | **extended** | `[{ name, lore, kind, section, position, marker, time, beam, core }]`. `time`: seconds in the song where the landmark sits. `beam`: the light beam mesh. `marker`: the crystal cluster, now standing on the ground at `position` (it no longer floats or spins). New: `core`, the glowing heart inside it. |
| `colours` | **changed behaviour** | `{ space, sky, fog, atmosphere }` as before, but `sky` and `fog` are now **live**: `update()` re-tints these same `THREE.Color` objects every frame. See "Sky and fog" below. |
| `onBeat(strength = 1)` | same call, more effect | Pulse on atmosphere + landmarks (as before), plus a ripple of light that starts under the listener and glowing flora. |
| `update(dt, songTime, listenerDirection)` | **CHANGED: 2 new parameters** | See below. `update(dt)` alone still works (the planet idles). |
| `name` | same | `blueprint.planetName` |
| `dispose()` | **new** | Removes the group from the scene and frees geometries and materials. Call it when switching songs. |
| `timeAt(direction)` | **new** | Song time (seconds) at a direction: longitude 0..1 times the duration. |
| `directionAt(time, out?)` | **new** | The point on the equator for a song time (unit `Vector3`). |
| `duration` | **new** | `features.duration` |
| `seaLevel` | **new** | Height of the water surface (a `getHeight` value). It is now different per song. |
| `sun` | **new** | The planet's `DirectionalLight`, if you need its colour or direction. |

### update(dt, songTime, listenerDirection)

- `dt`: seconds since the last frame (as before).
- `songTime`: seconds into the song that is **sounding right now** (number). Drives glow and colour from the
  current loudness, flora sway from the mids, and the sky tint.
- `listenerDirection`: unit `THREE.Vector3` from the planet's centre to the listener, in the planet's own
  space. On the surface this is `player.getDirection()`. In orbit use `planet.directionAt(songTime)`.
  Beat ripples start here, and the sun stays ahead (east) of this point so the listener's side is always lit.

Both new parameters are optional. Without them nothing breaks: the planet just does not follow the music.

Order per frame: move the player, update the music (get `songTime`), then `planet.update(...)`, then render.

### Sky and fog (for whoever sets scene.background and scene.fog: Role 4)

```js
scene.background = planet.colours.sky;                     // keeps following the music by itself (same object)
scene.fog = new THREE.Fog(planet.colours.fog, 5, 75);      // Fog COPIES the colour, so also do this every frame:
scene.fog.color.copy(planet.colours.fog);
```

The planet also draws its own sky dome when the camera is inside the atmosphere (sky colour overhead, fog colour
at the horizon, tone-mapped like the ground), so the horizon meets the fog without a seam. `scene.background` only
shows through while the camera is on its way down.

Fog 5..75 fits a player with eyes 0.6 above the ground (`PLAYER_SCALE` in `experience/player.js`): the horizon is
about 8 units away and nothing further than about 55 is ever visible. Keep the fog object alive in orbit too (push
near/far out of range instead of setting `scene.fog = null`), or three.js recompiles every shader on landing.

In orbit: `scene.background = planet.colours.space`, `scene.fog = null` (unchanged).

### The ground never moves

Everything reactive is light and colour in the shaders. The only vertices that move are the tops of the
plants (sway). `getHeight` and the ground mesh are fixed from the moment the planet is built.

## What in the song makes what in the world

| From | Becomes | File |
| --- | --- | --- |
| bass / mid / treble / loudness over time | continents / hills / fine detail / equator ridge along the longitude (as before) | `terrain.js` |
| bpm + brightness of the whole song | the planet's **character**: fast, bright songs are jagged with broken coasts, slow warm songs have broad rolling land. Also how much sea there is. | `terrain.js` (`character`) |
| Blueprint `sections` | chorus = mountain range, drop = canyon, on the equator at that song time (as before) | `terrain.js`, `landmarks.js` |
| the song spectrum palette (`ground`, `peaks`, `sky`, `fog`, `atmosphere`) | every colour in the world: sand, lowland patches, rock on steep slopes, peaks, water, clouds, sun and sky light. A dark `sky` colour makes a night planet (dimmer light, stronger glows). Computed from `features.spectrum` (pitch -> hue round the circle of fifths; bass/mid/treble balance, loudness and major/minor -> brightness, saturation, contrast, day or night). Order: `features.spectrumPalette`, then computed from `features.spectrum`, then a limited palette from the old `features.atmosphere` + bands, then the Blueprint's legacy `palette`. | `spectrumPalette.js`, `biome.js` |
| Blueprint `flora` (free text) | 2 to 3 of these shapes, chosen by keywords: pine, blossom, palm, crystal, mushroom, reed. Unknown names fall back to pine + blossom. Every plant has its own size, turn, lean and colour tint. | `flora.js` |
| the terrain itself | boulders and stones, more of them on slopes and high ground | `rocks.js` |
| palette `atmosphere` | rim glow colour (blended with the sky) and a light tint on sky and fog | `biome.js`, `planet.js` |
| live: beats | light ripples from the listener, atmosphere + landmark pulse, glowing flora flash | `reactive.js` |
| live: loudness / mids / treble at `songTime` | overall glow and saturation / flora sway / sky and glow tint | `reactive.js`, `planet.js` |

## Files

- `planet.js`: entry point. Builds the ground mesh (smooth-shaded, colour per vertex from height + slope), puts everything together, sun and shadows, `update`.
- `terrain.js`: the height function the mesh is built from, sea level, song character, longitude <-> time helpers.
- `sphere.js`: the icosphere the ground is made of, with vertices shared between neighbouring triangles.
- `surface.js`: `getHeight` (Contract 3): the exact height of the built mesh in any direction.
- `shapes.js`: building blocks for objects: rounded blobs, lathe shapes, crystal shards, colour baked per vertex.
- `spectrumPalette.js`: the song spectrum palette: the spectrum descriptor (`describeSpectrum`, mirrored in `server/analyse.py`), the palette itself, and `resolvePalette` (which palette a planet is drawn with). No three.js, tested with `npm test`.
- `biome.js`: all colours, derived from the 4 base colours of the resolved palette.
- `reactive.js`: the shared shader uniforms and shader patches: water waves, hemisphere light, beat ripples, sway.
- `atmosphere.js`: rim glow seen from orbit + the sky dome seen from the surface.
- `clouds.js`: drifting clouds, soft clusters of rounded puffs.
- `flora.js`: the plant shapes and where they grow.
- `rocks.js`: boulders and stones.
- `landmarks.js`: landmark crystal clusters (glassy shell + glowing core) and beams, returns the landmark list.
- `noise.js`: value noise, fbm, seeded random.
- `dev.js`: test page with fake data (`world-test.html`).

## Tuning knobs

- Too slow: first set `SHADOWS = false` in `planet.js` (shadows draw the world a second time). Then lower `DETAIL` in `planet.js` (64 = about 85k triangles, 50 = about 52k, 40 = about 34k), `total` in `createFlora` and `createRocks`, `clusters` in `createClouds`.
- Terrain too soft or too rough: the treble `detail` layer, the ridge rounding and `BUMP_WIDTH` in `terrain.js`. Change the shape only there: the mesh and `getHeight` both come from it.
- Sun should not follow the listener: set `SUN_FOLLOWS_LISTENER = false` in `planet.js`.
- Ripple speed, life, width and fade-in: top of `reactive.js`.
