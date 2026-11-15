// MVP page: a planet made from a song, that reacts to the music, where your position controls the playback.
//   orbit view -> click the planet to land -> walk (the music follows your longitude) -> Esc back to orbit
// Demo songs are analysed in the browser; selected songs use the saved server analysis and blueprint.
// Run `npm run dev` and open http://localhost:5173/mvp.html
// Add ?nolock to the URL to test without capturing the mouse (drag to look, click the ground to walk).
// Keys: F3 = debug overlay, Q = quality low / medium / high (also ?quality=low in the URL).

import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { createPlanet } from '../world/planet.js';
import { QUALITY, QUALITY_LEVELS, DEFAULT_QUALITY, nextQuality, applyRendererQuality, createAutoQuality } from '../world/quality.js';
import { createPlayer, PLAYER_SCALE } from '../experience/player.js';
import { createSongPosition, activeSources } from '../experience/songPosition.js';
import { getPlanetJourney } from '../experience/planetJourney.js';
import { getPlanet } from '../api/planets.js';
import { createFpsMeter, createDebugOverlay } from './debugOverlay.js';
import { analyseSong } from './tempAnalysis.js';
import { DEMO_SONGS, makeBlueprint, demoPaletteAdjust } from './demoBlueprints.js';
import { withSpectrumPalette } from '../world/spectrumPalette.js';
import { validatePlanetData } from './planetData.js';

// ---------- Settings ----------
const LAND_TIME = 1.5;      // seconds, orbit -> surface
const TAKEOFF_TIME = 1.2;   // seconds, surface -> orbit
const ORBIT_DISTANCE = 150; // camera distance from the planet centre
const LANDMARK_RANGE = 12 * PLAYER_SCALE; // come this close to a landmark to trigger it (scales with the player, see player.js)
const APPROACH_RADIUS = LANDMARK_RANGE * 3;
const NARRATION_COOLDOWN = 1.5;
const DUCK_LEVEL = 0.2;
const DUCK_IN_SECONDS = 0.6;
const DUCK_OUT_SECONDS = 1.2;
const WALK_AWAY_FADE_SECONDS = 0.5;
// Surface fog. From eyes 0.6 above a planet of radius 50 the bare horizon is only ~8 units away and the furthest
// mountain tops and clouds you can see at all are ~55 away, so the fog has to work inside that range: it starts
// just before the horizon and is almost solid where the furthest things appear. That haze is what makes hills
// read as far away. (The old 20..140 ended beyond anything visible, so it did close to nothing.)
const FOG_NEAR = 5, FOG_FAR = 75;
const FOG_OFF_NEAR = 600, FOG_OFF_FAR = 1800; // orbit: further than the camera can ever be from the planet = no fog
// Near plane: a fixed share of the camera's height above the ground. Close to the ground it must be tiny (the eye is
// 0.6 up, slopes and trees come closer still). From orbit it must be big, or the depth buffer runs out of precision
// and far surfaces flicker. One rule for both, so nothing jumps on the way down.
const NEAR_PER_HEIGHT = 0.06, NEAR_MIN = 0.05 * PLAYER_SCALE, NEAR_MAX = 1;
const CLICK_SLOP = 5;       // px the mouse may move and still count as a click
const HINTS = {
  loading: 'Listening to the song…',
  start: 'Click anywhere to start the music',
  orbit: 'Click the planet to land',
  surface: 'WASD to walk · Shift to run · the beam of light is where the song is · Esc to take off',
  surfaceNoLock: 'WASD or click the ground to walk · Shift to run · drag to look · the beam of light is where the song is · Esc to take off',
};

// ---------- Renderer, scene, camera ----------
const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setSize(innerWidth, innerHeight);
renderer.toneMapping = THREE.ACESFilmicToneMapping; // believable light: bright areas roll off instead of clipping
renderer.toneMappingExposure = 1.0;
// Pixel ratio and shadow maps: from the quality level (world/quality.js). It can change while running, see setQuality below.
const params = new URLSearchParams(location.search);
let quality = QUALITY_LEVELS.includes(params.get('quality')) ? params.get('quality') : DEFAULT_QUALITY;
applyRendererQuality(renderer, quality);
document.body.prepend(renderer.domElement);

const SPACE = new THREE.Color('#05060d');
const scene = new THREE.Scene();
scene.background = SPACE;
// The fog object always exists (in orbit it is just too far away to do anything). Adding and removing it would make
// three.js rebuild every shader at the moment you click to land: a visible hitch.
scene.fog = new THREE.Fog(SPACE, FOG_OFF_NEAR, FOG_OFF_FAR);
const camera = new THREE.PerspectiveCamera(55, innerWidth / innerHeight, NEAR_MAX, 3000);
camera.position.set(0, 45, ORBIT_DISTANCE).setLength(ORBIT_DISTANCE);
// No lights here: the planet brings its own sun and sky light.

const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true;
controls.enablePan = false;
controls.minDistance = 80;
controls.maxDistance = 420;

// Stars (only in orbit: they fade out as the sky fades in)
const stars = (() => {
  const count = 1800, positions = new Float32Array(count * 3), v = new THREE.Vector3();
  for (let i = 0; i < count; i++) { v.randomDirection().multiplyScalar(1500); positions.set([v.x, v.y, v.z], i * 3); }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  const points = new THREE.Points(geo, new THREE.PointsMaterial({ color: '#cfd8ff', size: 1.6, sizeAttenuation: false, transparent: true, fog: false, depthWrite: false }));
  points.frustumCulled = false;
  scene.add(points);
  return points;
})();

// ---------- State ----------
const audioContext = new AudioContext(); // stays suspended until the first click or key press
const useLock = !params.has('nolock');
const analysed = new Map(); // song id -> { features, audioBuffer } (so switching back is instant)

let mode = 'loading'; // 'loading' | 'orbit' | 'landing' | 'surface' | 'takeoff'
let move = null;      // the camera move running during 'landing' / 'takeoff'
let song = null, planet = null, player = null, music = null, marker = null;
let narratorStyle = '';
let songTime = 0;
let facing = Math.atan2(camera.position.z, camera.position.x); // world direction the playing longitude turns towards
let look = 0;         // 0 = orbit look (space), 1 = surface look (sky + fog)
let loadId = 0;

const listener = new THREE.Vector3(1, 0, 0); // where the music is "heard from", planet space
const toLocal = new THREE.Matrix4();
const local = new THREE.Vector3();
const background = new THREE.Color();
const UP = new THREE.Vector3(0, 1, 0);

function setMode(next) {
  if (next === mode) return;
  console.log(`[mvp] mode: ${mode} -> ${next}`);
  mode = next;
}

function planetInverse() {
  planet.group.updateWorldMatrix(true, false);
  return toLocal.copy(planet.group.matrixWorld).invert();
}

// ---------- HUD ----------
const ui = {
  planet: document.getElementById('planet-name'),
  song: document.getElementById('song-name'),
  time: document.getElementById('song-time'),
  progress: document.querySelector('#progress > div'),
  hint: document.getElementById('hint'),
  back: document.getElementById('back'),
  landmarkLabel: document.getElementById('landmark-label'),
  captions: document.getElementById('captions'),
  toast: document.getElementById('narration-toast'),
  narrationEnabled: document.getElementById('narration-enabled'),
  musicVolume: document.getElementById('music-volume'),
  musicMute: document.getElementById('music-mute'),
  buttons: DEMO_SONGS.map((s, i) => {
    const button = document.createElement('button');
    button.textContent = s.title;
    button.title = `${s.title} by ${s.artist}`;
    button.dataset.songId = s.id;
    button.addEventListener('click', () => { button.blur(); loadSong(s); });
    document.getElementById('songs').append(button);
    return button;
  }),
};
let hintText = null, timeText = null, loadError = null;

// Back to the start page. A full navigation (not history.back) so it also works after a direct link or a refresh.
// Stop the music and free the planet first, so no sound keeps playing while the page unloads.
for (const type of ['pointerdown', 'pointerup']) ui.back.addEventListener(type, (e) => e.stopPropagation());
ui.back.addEventListener('click', (e) => {
  e.stopPropagation();
  loadId++; // cancel any load still running
  teardown();
  location.assign('/');
});
const clockText = (t) => `${Math.floor(t / 60)}:${String(Math.floor(t % 60)).padStart(2, '0')}`;

function updateHud() {
  let hint = loadError ?? HINTS[mode] ?? '';
  if (mode === 'orbit' && !music?.playing) hint = HINTS.start;
  if (mode === 'surface' && !player.locked) hint = HINTS.surfaceNoLock;
  if (hint !== hintText) ui.hint.textContent = hintText = hint;
  const hideBack = !planet || mode === 'loading';
  if (ui.back.hidden !== hideBack) ui.back.hidden = hideBack;

  if (!music) return;
  const text = `${clockText(songTime)} / ${clockText(music.duration)}`;
  if (text !== timeText) ui.time.textContent = timeText = text;
  ui.progress.style.width = `${(songTime / music.duration) * 100}%`;
}

// ---------- Orbit <-> surface look ----------
// k = 0: space, stars, no fog. k = 1: sky + fog (both follow the music, see planet.colours). Between: a smooth blend.
function applyLook() {
  const { space, sky, fog } = planet.colours;
  stars.material.opacity = 1 - look;
  stars.visible = look < 1;
  scene.background = look <= 0 ? space : look >= 1 ? sky : background.copy(space).lerp(sky, look);
  scene.fog.color.copy(fog); // live: the planet re-tints it every frame
  scene.fog.near = THREE.MathUtils.lerp(FOG_OFF_NEAR, FOG_NEAR, look); // far away at first, so nothing pops
  scene.fog.far = THREE.MathUtils.lerp(FOG_OFF_FAR, FOG_FAR, look);
}

// The view with no planet (while a song loads): plain space seen from orbit distance.
// Without this, switching songs on the surface left the old sky colour and a first-person camera on screen
// until the new planet appeared, and then everything jumped.
function resetView() {
  look = 0;
  scene.background = SPACE;
  scene.fog.near = FOG_OFF_NEAR; scene.fog.far = FOG_OFF_FAR;
  stars.material.opacity = 1; stars.visible = true;
  camera.position.setLength(Math.max(camera.position.length(), ORBIT_DISTANCE));
  setNear(NEAR_MAX);
  controls.update(); // turns the camera back to face the centre
}

function setNear(near) {
  if (Math.abs(near - camera.near) < 1e-4) return;
  camera.near = near;
  camera.updateProjectionMatrix();
}

function updateNearPlane() {
  local.copy(camera.position).applyMatrix4(planetInverse());
  const r = local.length();
  const height = r - planet.radius - planet.getHeight(local.divideScalar(r));
  setNear(THREE.MathUtils.clamp(height * NEAR_PER_HEIGHT, NEAR_MIN, NEAR_MAX));
}

// ---------- Playhead marker: a ring on the ground where the song is now (orbit and surface) ----------
const MARKER_BEAM = 16;           // height of the surface light beam
const MARKER_SURFACE_SIZE = 0.4;  // ring size on the surface, relative to its orbit size
function createMarker() {
  const group = new THREE.Group();
  const material = new THREE.MeshBasicMaterial({ color: '#ffffff', transparent: true, opacity: 0.9, fog: false, depthWrite: false, blending: THREE.AdditiveBlending });
  const ring = new THREE.Mesh(new THREE.TorusGeometry(2.2, 0.14, 6, 40), material);
  ring.rotation.x = Math.PI / 2; // lie flat on the ground
  const pin = new THREE.Mesh(new THREE.ConeGeometry(0.55, 2.4, 4), material);
  pin.rotation.x = Math.PI;      // point down at the ground
  pin.position.y = 3.4;
  // Surface only: a tall beam of light, so the playhead can be seen coming from beyond the (very close) horizon
  const beam = new THREE.Mesh(
    new THREE.CylinderGeometry(0.05, 0.3, MARKER_BEAM, 10, 1, true).translate(0, MARKER_BEAM / 2, 0),
    new THREE.MeshBasicMaterial({ color: '#ffffff', transparent: true, opacity: 0, fog: false, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide }));
  group.add(ring, pin, beam);
  Object.assign(group.userData, { ring, pin, beam });
  return group;
}

// In orbit the marker sits on the equator. On the surface it is drawn at the music's longitude but at the PLAYER'S
// latitude, so it always comes past the player: once per lap of the song.
function updateMarker() {
  const dir = planet.directionAt(songTime, local);
  const k = look * look * (3 - 2 * look); // 0 = orbit ... 1 = surface
  if (k > 0) {
    const y = THREE.MathUtils.clamp(player.getDirection().y, -0.98, 0.98) * k;
    dir.multiplyScalar(Math.sqrt(1 - y * y)).setY(y);
  }
  marker.quaternion.setFromUnitVectors(UP, dir);
  marker.position.copy(dir).multiplyScalar(planet.radius + planet.getHeight(dir) + THREE.MathUtils.lerp(0.5, 0.12, k));
  const { ring, pin, beam } = marker.userData;
  const size = THREE.MathUtils.lerp(1, MARKER_SURFACE_SIZE, k) * (1 + 0.25 * beatPulse);
  ring.scale.setScalar(size);
  pin.visible = k < 0.5;
  beam.visible = k > 0;
  beam.material.opacity = k * (0.22 + 0.3 * beatPulse);
}

// ---------- Songs ----------
let beatPulse = 0;
function onBeat() {
  beatPulse = 1;
  planet?.onBeat(1);
}

function teardown() {
  if (!planet) return;
  if (player.enabled) player.disable();
  music.dispose();
  planet.dispose();
  planet = player = music = marker = null;
}

async function loadSong(next, journey = null) {
  if (song?.id === next.id) return;
  loadError = null;
  stopNarration({ immediate: true, abortPrefetch: true });
  const id = ++loadId;
  ui.buttons.forEach((button) => {
    button.setAttribute('aria-pressed', button.dataset.songId === next.id);
    button.disabled = true;
  });
  console.log(`[mvp] loading "${next.title}"`);

  teardown(); // the old world goes first
  move = null;
  resetView();
  setMode('loading');
  updateHud();

  try {
    if (journey) {
      const { audio, world } = validatePlanetData(journey);
      if (!(journey.blob instanceof Blob)) throw new Error('Saved song audio is missing');
      const audioBuffer = await audioContext.decodeAudioData(await journey.blob.arrayBuffer());
      analysed.set(next.id, { features: audio, audioBuffer, blueprint: world });
    } else if (!analysed.has(next.id)) {
      const response = await fetch(next.url);
      if (!response.ok) throw new Error(`${next.url}: ${response.status}`);
      const result = await analyseSong(await response.arrayBuffer(), audioContext);
      // Demo planets use the same spectrum palette as every other song, with a small artistic adjustment
      analysed.set(next.id, { ...result, features: withSpectrumPalette(result.features, demoPaletteAdjust(next.id)) });
    }
    if (id !== loadId) return; // another song was picked meanwhile
    const { features, audioBuffer, blueprint: savedBlueprint } = analysed.get(next.id);
    const blueprint = savedBlueprint ?? makeBlueprint(next.id, features);
    narratorStyle = blueprint.narratorStyle ?? '';

    song = next;
    planet = createPlanet(features, blueprint, { quality });
    resetLandmarkStates();
    scene.add(planet.group);
    marker = createMarker();
    planet.group.add(marker);
    renderer.compile(scene, camera); // build the shaders now, during "loading", not in the first visible frame
    player = createPlayer({
      camera, domElement: renderer.domElement, planet,
      pointerLock: useLock,
      onUnlock: () => { if (mode === 'surface') takeOff(); }, // leaving pointer lock (Esc) = take off
    });
    music = createSongPosition({ audioContext, audioBuffer, features, planet, onBeat });
    music.setVolume(Number(ui.musicVolume.value));
    if (audioContext.state === 'running') music.start();

    ui.planet.textContent = planet.name;
    ui.song.textContent = `${song.title} · ${song.artist} · ${features.bpm} bpm`;

    // Back to a clean orbit view
    songTime = 0;
    controls.enabled = true;
    facing = Math.atan2(camera.position.z, camera.position.x);
    planet.group.rotation.y = -facing;
    setMode('orbit');
    fpsMeter.reset(); autoQuality.hold(); // the build and the new shaders say nothing about the frame rate
  } catch (error) {
    console.error('[mvp] could not load the song', error);
    loadError = `Could not load "${next.title}" (see the console)`;
  } finally {
    if (id === loadId) ui.buttons.forEach((button) => { button.disabled = false; });
  }
}

function addJourneyButton(journey) {
  const next = {
    id: 'latest-journey',
    title: journey.title || 'Your song',
    artist: journey.artist || '',
  };
  const button = document.createElement('button');
  button.textContent = next.title;
  button.title = next.artist ? `${next.title} by ${next.artist}` : next.title;
  button.dataset.songId = next.id;
  button.addEventListener('click', () => { button.blur(); loadSong(next, journey); });
  ui.buttons.unshift(button);
  document.getElementById('songs').prepend(button);
  return next;
}

// A silent 16-bit mono WAV, so a planet with no stored audio still loads.
function silentWav(seconds) {
  const rate = 8000;
  const samples = Math.max(1, Math.round((seconds || 1) * rate));
  const view = new DataView(new ArrayBuffer(44 + samples * 2));
  const text = (offset, s) => [...s].forEach((c, i) => view.setUint8(offset + i, c.charCodeAt(0)));
  text(0, 'RIFF'); view.setUint32(4, 36 + samples * 2, true); text(8, 'WAVE');
  text(12, 'fmt '); view.setUint32(16, 16, true); view.setUint16(20, 1, true); view.setUint16(22, 1, true);
  view.setUint32(24, rate, true); view.setUint32(28, rate * 2, true); view.setUint16(32, 2, true); view.setUint16(34, 16, true);
  text(36, 'data'); view.setUint32(40, samples * 2, true);
  return new Blob([view], { type: 'audio/wav' });
}

async function openSavedPlanet(id) {
  const { song = {}, features, blueprint } = await getPlanet(id);
  let blob = null;
  if (song.deezerId) {
    const res = await fetch(`/audio/${encodeURIComponent(song.deezerId)}`);
    if (res.ok) blob = await res.blob();
  }
  const journey = { audio: features, world: blueprint, title: song.title, artist: song.artist, blob: blob ?? silentWav(features?.duration) };
  const next = addJourneyButton(journey);
  await loadSong(next, journey);
}

async function startExperience() {
  if (params.get('planet')) {
    try {
      await openSavedPlanet(params.get('planet'));
    } catch (error) {
      console.error('[mvp] could not open the saved planet', error);
      loadError = 'Could not load that planet. Please return and try again.';
    }
    return;
  }
  if (params.get('journey') !== 'latest') {
    await loadSong(DEMO_SONGS[0]);
    return;
  }

  try {
    const journey = await getPlanetJourney();
    if (!journey) throw new Error('No saved song journey was found');
    const next = addJourneyButton(journey);
    await loadSong(next, journey);
  } catch (error) {
    console.error('[mvp] could not open the saved planet', error);
    loadError = 'Could not load your planet. Please return and try again.';
  }
}

// Browsers only allow sound after a click or key press
function unlockAudio() {
  if (audioContext.state !== 'running') audioContext.resume().then(() => music?.start()).catch((error) => {
    console.warn('Could not resume audio:', error);
  });
  else music?.start();
}
addEventListener('pointerdown', unlockAudio);
addEventListener('keydown', unlockAudio);

// ---------- Landing and take-off ----------
// localDirection: the point to land on, as a direction in the planet's own space
function land(localDirection) {
  if (mode !== 'orbit') return;
  setMode('landing');
  controls.enabled = false;

  const fromPos = camera.position.clone(), fromQuat = camera.quaternion.clone();
  // Whatever is "up" on screen now becomes "straight ahead" on the ground
  const ahead = new THREE.Vector3(0, 1, 0).applyQuaternion(camera.quaternion).transformDirection(planetInverse());
  player.place(localDirection, ahead); // writes the final first-person camera, which we read back...
  const toPos = camera.position.clone(), toQuat = camera.quaternion.clone();
  camera.position.copy(fromPos); camera.quaternion.copy(fromQuat); // ...and then start from where we were

  music.setFree(false); // the song carries on untouched. It only follows the player once they walk away from here
  console.log(`[mvp] landing at longitude ${(planet.timeAt(localDirection) / planet.duration).toFixed(3)} = song time ${planet.timeAt(localDirection).toFixed(2)}s`);

  move = {
    t: 0, duration: LAND_TIME, fromPos, toPos, fromQuat, toQuat, lookFrom: 0, lookTo: 1,
    done() {
      setMode('surface');
      player.enable(); // keeps the spot set by place()
      stopNarration();
      heightTimer = 0;
    },
  };
}

function takeOff() {
  if (mode !== 'surface') return;
  stopNarration({ abortPrefetch: true });
  setMode('takeoff');
  player.disable();
  music.setFree(true);

  const fromPos = camera.position.clone(), fromQuat = camera.quaternion.clone();
  planet.group.updateWorldMatrix(true, false);
  const toPos = player.getDirection().clone().multiplyScalar(ORBIT_DISTANCE).applyMatrix4(planet.group.matrixWorld);
  toPos.y += ORBIT_DISTANCE * 0.25; // a little above, so the equator is not edge-on
  toPos.setLength(ORBIT_DISTANCE);
  // Same orientation OrbitControls will produce (look at the centre, world Y up), so there is no snap at the end
  const toQuat = new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().lookAt(toPos, controls.target, camera.up));

  move = {
    t: 0, duration: TAKEOFF_TIME, fromPos, toPos, fromQuat, toQuat, lookFrom: 1, lookTo: 0,
    done() {
      // Keep the planet as it is now: the playing longitude turns towards where the camera ended up
      facing = Math.atan2(camera.position.z, camera.position.x);
      setMode('orbit');
      controls.enabled = true;
      controls.update();
    },
  };
}

function updateMove(dt) {
  move.t = Math.min(1, move.t + dt / move.duration);
  const e = move.t * move.t * (3 - 2 * move.t); // ease in and out
  camera.position.lerpVectors(move.fromPos, move.toPos, e);
  camera.quaternion.slerpQuaternions(move.fromQuat, move.toQuat, e);

  // Never let the camera cut through a hill on the way: keep it above the ground (getHeight only)
  local.copy(camera.position).applyMatrix4(planetInverse());
  const r = local.length();
  const minR = planet.radius + planet.getHeight(local.divideScalar(r)) + player.eyeHeight;
  if (r < minR) camera.position.copy(local.multiplyScalar(minR)).applyMatrix4(planet.group.matrixWorld);

  look = THREE.MathUtils.lerp(move.lookFrom, move.lookTo, e);
  if (move.t >= 1) { const finished = move; move = null; finished.done(); }
}

// ---------- Input: click the planet to land, Esc to take off ----------
const raycaster = new THREE.Raycaster();
const pointer = new THREE.Vector2();
let downX = 0, downY = 0;

renderer.domElement.addEventListener('pointerdown', (e) => { downX = e.clientX; downY = e.clientY; });
renderer.domElement.addEventListener('pointerup', (e) => {
  if (mode !== 'orbit' || e.button !== 0) return;
  if (Math.hypot(e.clientX - downX, e.clientY - downY) > CLICK_SLOP) return; // that was an orbit drag
  pointer.set((e.clientX / innerWidth) * 2 - 1, -(e.clientY / innerHeight) * 2 + 1);
  raycaster.setFromCamera(pointer, camera);
  // Picking only: this finds WHERE on the planet was clicked. Ground height always comes from getHeight.
  const ground = planet.group.getObjectByName('ground');
  const hit = raycaster.intersectObject(ground, false)[0];
  if (hit) land(planet.group.worldToLocal(hit.point.clone()).normalize());
});

addEventListener('keydown', (e) => {
  if (e.code === 'Escape' && mode === 'surface') takeOff(); // without pointer lock, Esc arrives here
});

addEventListener('resize', () => {
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(innerWidth, innerHeight);
});

// ---------- Landmark approach, narration, and audio ducking ----------
const narrationCache = new Map();
const landmarkStates = new Map();
const reducedMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;
let activeNarration = null;
let pendingNarration = null;
let narrationEnabled = ui.narrationEnabled.checked;
let lastMusicVolume = Number(ui.musicVolume.value) || 0.9;
let toastTimer;

function resetLandmarkStates() {
  landmarkStates.clear();
  for (const landmark of planet?.landmarks ?? []) {
    landmarkStates.set(landmark.id, {
      phase: 'idle', controller: null, prefetch: null, prefetchError: null,
      starting: false, failed: false, cooldownUntil: 0,
    });
  }
  ui.landmarkLabel.style.opacity = '0';
  ui.captions.hidden = true;
  ui.captions.textContent = '';
}

function cacheSegment(value) {
  return String(value ?? '').normalize('NFKD').replace(/[\u0300-\u036f]/g, '')
    .toLowerCase().replace(/[^a-z0-9_-]+/g, '-').replace(/^-|-$/g, '') || 'unknown';
}

function loreHash(text) {
  let hash = 2166136261;
  for (let i = 0; i < text.length; i++) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(16);
}

function setMusicDuck(value, duration) {
  if (!music) return;
  const gain = music.musicGain.gain;
  const now = audioContext.currentTime;
  gain.cancelScheduledValues(now);
  gain.setValueAtTime(gain.value, now);
  gain.linearRampToValueAtTime(value, now + duration);
}

function showNarrationToast() {
  ui.toast.textContent = 'Narration unavailable';
  ui.toast.dataset.visible = 'true';
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { ui.toast.dataset.visible = 'false'; }, 2600);
}

function prefetchNarration(landmark, state) {
  if (
    !narrationEnabled || document.hidden || Number(ui.musicVolume.value) === 0
    || !landmark.lore?.trim() || state.prefetch || state.failed
  ) return;
  const key = `${landmark.id}:${loreHash(landmark.lore)}`;
  if (narrationCache.has(key)) {
    state.prefetch = Promise.resolve(narrationCache.get(key));
    return;
  }

  const controller = new AbortController();
  state.controller = controller;
  const songId = cacheSegment(song?.id);
  const landmarkId = cacheSegment(landmark.id);
  state.prefetch = (async () => {
    let response = await fetch(`/cache/${songId}/narration_${landmarkId}.mp3`, { signal: controller.signal });
    if (!response.ok || !response.headers.get('content-type')?.includes('audio')) {
      response = await fetch('/narrate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: `${landmark.name}. ${landmark.lore}`, style: narratorStyle }),
        signal: controller.signal,
      });
    }
    if (!response.ok) throw new Error(`Narration request returned ${response.status}`);

    const blob = await response.blob();
    const audioBuffer = await audioContext.decodeAudioData(await blob.arrayBuffer());
    if (controller.signal.aborted) return null;
    const entry = { blob, audioBuffer };
    narrationCache.set(key, entry);
    return entry;
  })().catch((error) => {
    if (!controller.signal.aborted) {
      state.prefetchError = error;
    }
    return null;
  }).finally(() => {
    if (state.controller === controller) state.controller = null;
  });
}

function finishNarration(current, { fadeSeconds = 0, natural = false, restoreImmediately = false } = {}) {
  if (!current || activeNarration !== current) return;
  activeNarration = null;
  const now = audioContext.currentTime;
  const gain = current.gain.gain;
  gain.cancelScheduledValues(now);
  gain.setValueAtTime(gain.value, now);
  if (!natural) {
    gain.linearRampToValueAtTime(0, now + fadeSeconds);
    current.source.onended = null;
    current.source.stop(now + fadeSeconds + 0.03);
  }
  const state = landmarkStates.get(current.landmark.id);
  if (state) {
    state.phase = 'visited';
    state.cooldownUntil = performance.now() + NARRATION_COOLDOWN * 1000;
  }
  ui.captions.hidden = true;
  ui.captions.textContent = '';
  setMusicDuck(1, restoreImmediately ? 0 : DUCK_OUT_SECONDS);
  if (fadeSeconds) {
    setTimeout(() => {
      current.source.disconnect();
      current.gain.disconnect();
    }, fadeSeconds * 1000 + 80);
  } else {
    current.source.disconnect();
    current.gain.disconnect();
  }
}

function stopNarration({ immediate = false, abortPrefetch = false } = {}) {
  finishNarration(activeNarration, { restoreImmediately: immediate });
  if (abortPrefetch) {
    for (const state of landmarkStates.values()) {
      state.controller?.abort();
      state.controller = null;
      state.prefetch = null;
      state.prefetchError = null;
      state.starting = false;
      state.failed = false;
      if (state.phase === 'approaching') state.phase = 'idle';
    }
    pendingNarration = null;
  }
}

function startNarration(landmark, state) {
  if (
    !narrationEnabled || document.hidden || Number(ui.musicVolume.value) === 0 || activeNarration || pendingNarration
    || state.starting || state.failed || !landmark.lore?.trim()
  ) return;
  prefetchNarration(landmark, state);
  if (!state.prefetch) return;

  const attempt = {};
  state.starting = true;
  pendingNarration = attempt;
  let current = null;
  void (async () => {
    try {
      const entry = await state.prefetch;
      if (!entry) throw state.prefetchError ?? new Error('Narration audio was not available');
      if (
        state.phase !== 'approaching' || !narrationEnabled || document.hidden
        || activeNarration || player.position.distanceTo(landmark.position) > LANDMARK_RANGE
      ) return;

      await audioContext.resume();
      if (state.phase !== 'approaching' || !narrationEnabled || document.hidden || activeNarration) return;

      const source = audioContext.createBufferSource();
      source.buffer = entry.audioBuffer;
      const gain = audioContext.createGain();
      gain.gain.value = 1;
      source.connect(gain).connect(audioContext.destination);
      current = { landmark, source, gain };
      activeNarration = current;
      state.phase = 'narrating';
      ui.captions.textContent = landmark.lore;
      ui.captions.hidden = false;
      source.onended = () => finishNarration(current, { natural: true });
      setMusicDuck(DUCK_LEVEL, DUCK_IN_SECONDS);
      source.start(audioContext.currentTime + 0.3);
    } catch (error) {
      if (state.phase === 'approaching' && state.prefetch && narrationEnabled && !document.hidden) {
        state.failed = true;
        console.warn(`Narration unavailable for landmark ${landmark.id}:`, error);
        showNarrationToast();
      }
      finishNarration(current, { restoreImmediately: true });
    } finally {
      state.starting = false;
      if (pendingNarration === attempt) pendingNarration = null;
    }
  })();
}

function updateLandmarkLabel(landmark, opacity) {
  if (!landmark || opacity <= 0) {
    ui.landmarkLabel.style.opacity = '0';
    return;
  }
  ui.landmarkLabel.textContent = landmark.name;
  ui.landmarkLabel.style.opacity = String(opacity);
}

function checkLandmarks() {
  let labelLandmark = null;
  let labelDistance = Infinity;
  let labelOpacity = 0;
  const now = performance.now();

  for (const landmark of planet.landmarks) {
    const state = landmarkStates.get(landmark.id);
    const distance = player.position.distanceTo(landmark.position);
    if (state.phase === 'idle' && distance <= APPROACH_RADIUS) {
      state.phase = 'approaching';
      state.failed = false;
      state.prefetchError = null;
      prefetchNarration(landmark, state);
    }

    if (state.phase === 'approaching') {
      if (distance > APPROACH_RADIUS) {
        state.controller?.abort();
        state.controller = null;
        state.prefetch = null;
        state.prefetchError = null;
        state.phase = 'idle';
        state.failed = false;
      } else {
        if (!state.prefetch && !state.failed) prefetchNarration(landmark, state);
        if (distance <= LANDMARK_RANGE) {
          if (landmark.lore?.trim() && !state.failed) startNarration(landmark, state);
        }
      }
    } else if (state.phase === 'narrating' && distance > APPROACH_RADIUS) {
      if (activeNarration?.landmark.id === landmark.id) {
        finishNarration(activeNarration, { fadeSeconds: WALK_AWAY_FADE_SECONDS });
      }
    } else if (state.phase === 'visited' && distance > APPROACH_RADIUS && now >= state.cooldownUntil) {
      state.phase = 'idle';
    }

    const isActive = state.phase === 'approaching' || state.phase === 'narrating';
    const progress = isActive ? THREE.MathUtils.clamp(1 - distance / APPROACH_RADIUS, 0, 1) : 0;
    const pulse = reducedMotion ? 1 : 0.88 + 0.12 * Math.sin(now * 0.004);
    landmark.marker.material.emissiveIntensity = 0.35 + progress * (1.3 + 0.5 * pulse);
    landmark.beam.material.opacity = 0.3 + progress * 0.55 * pulse;
    const beamHeight = landmark.baseBeamHeight * (1 + progress * 0.7);
    landmark.beam.scale.y = beamHeight / landmark.baseBeamHeight;
    landmark.beam.position.copy(landmark.position)
      .addScaledVector(landmark.direction, landmark.beamBaseOffset + beamHeight / 2);

    if (isActive && distance < labelDistance) {
      labelLandmark = landmark;
      labelDistance = distance;
      labelOpacity = progress;
    }
  }
  updateLandmarkLabel(labelLandmark, labelOpacity);
}

ui.narrationEnabled.addEventListener('change', () => {
  narrationEnabled = ui.narrationEnabled.checked;
  if (!narrationEnabled) {
    stopNarration({ abortPrefetch: true });
  } else {
    for (const landmark of planet?.landmarks ?? []) {
      const state = landmarkStates.get(landmark.id);
      if (state?.phase === 'approaching') prefetchNarration(landmark, state);
    }
  }
});

ui.musicVolume.addEventListener('input', () => {
  const volume = Number(ui.musicVolume.value);
  music?.setVolume(volume);
  if (volume > 0) lastMusicVolume = volume;
  if (volume === 0) stopNarration({ abortPrefetch: true });
  ui.musicMute.setAttribute('aria-pressed', String(volume === 0));
  ui.musicMute.textContent = volume === 0 ? 'Unmute' : 'Mute';
});

ui.musicMute.addEventListener('click', () => {
  const muted = ui.musicVolume.value !== '0';
  if (muted) lastMusicVolume = Number(ui.musicVolume.value) || lastMusicVolume;
  ui.musicVolume.value = muted ? '0' : String(lastMusicVolume);
  music?.setVolume(Number(ui.musicVolume.value));
  if (muted) stopNarration({ abortPrefetch: true });
  ui.musicMute.setAttribute('aria-pressed', String(muted));
  ui.musicMute.textContent = muted ? 'Unmute' : 'Mute';
});

document.addEventListener('visibilitychange', () => {
  if (document.hidden) stopNarration({ immediate: true, abortPrefetch: true });
});
addEventListener('pagehide', () => stopNarration({ immediate: true, abortPrefetch: true }));
addEventListener('beforeunload', () => stopNarration({ immediate: true, abortPrefetch: true }));

// ---------- Debug: height above the ground, measured from the real camera position ----------
function heightAboveGround() {
  local.copy(camera.position).applyMatrix4(planetInverse());
  const r = local.length();
  return r - planet.radius - planet.getHeight(local.divideScalar(r));
}

let heightTimer = 0;
function logHeight(dt) {
  heightTimer += dt;
  if (heightTimer < 2) return;
  heightTimer = 0;
  console.log(`[mvp] height above ground: ${heightAboveGround().toFixed(3)} (eye height ${player.eyeHeight})`);
}

// ---------- Debug overlay (F3): everything needed to test by hand ----------
const fpsMeter = createFpsMeter();
const overlay = createDebugOverlay();
const num = (x, digits = 2) => x.toFixed(digits);
function overlayLines() {
  const info = renderer.info.render;
  const lines = [
    `fps        ${num(fpsMeter.fps, 0)}   (worst frame ${num(fpsMeter.worst, 0)} ms)`,
    `triangles  ${info.triangles.toLocaleString('en')}   draw calls ${info.calls}`,
    `mode       ${mode}`,
    `quality    ${quality}   pixel ratio ${num(renderer.getPixelRatio(), 2)}   auto ${autoQuality.enabled ? 'on' : `off (${autoQuality.note})`}`,
  ];
  if (!planet || !music) return lines;
  const at = planet.timeAt(listener);
  const since = music.sinceSync;
  lines.push(
    `song       ${num(songTime)} / ${num(music.duration)} s   longitude ${num(songTime / music.duration, 3)}`,
    `listener   longitude ${num(at / planet.duration, 3)} = ${num(at)} s   (${music.free ? 'the playhead' : 'you'})`,
    `last sync  ${since === null ? 'none yet' : `${num(since, 1)} s ago`}   syncs ${music.syncs}`,
    `sources    ${activeSources()}   ${music.playing ? 'playing' : 'not playing'}`,
    `height     ${num(heightAboveGround(), 3)} above ground   (eye height ${num(player.eyeHeight, 3)})`,
  );
  return lines;
}

// ---------- Quality: Q cycles low / medium / high. It also drops by itself when the frame rate stays low ----------
function setQuality(name) {
  if (!QUALITY[name] || name === quality) return;
  console.log(`[mvp] quality: ${quality} -> ${name}`);
  quality = name;
  applyRendererQuality(renderer, quality); // pixel ratio, shadow maps
  planet?.setQuality(quality);             // ground detail, shadows, how many plants, rocks and clouds
  fpsMeter.reset();
  autoQuality.hold();
}
const autoQuality = createAutoQuality({ get: () => quality, set: setQuality, log: (text) => console.log(`[mvp] ${text}`) });

addEventListener('keydown', (e) => {
  if (e.code !== 'KeyQ' || e.repeat || e.ctrlKey || e.metaKey || e.altKey) return;
  autoQuality.off('you chose with Q'); // a level picked by hand stays
  setQuality(nextQuality(quality));
});

// ---------- Frame loop ----------
// In orbit the planet turns so that the longitude that is playing faces the camera's side (`facing`)
function turnPlanetToPlayhead(dt) {
  const target = (songTime / planet.duration) * Math.PI * 2 - facing;
  const current = planet.group.rotation.y;
  const delta = Math.atan2(Math.sin(target - current), Math.cos(target - current)); // shortest way round
  planet.group.rotation.y = current + delta * (1 - Math.exp(-dt * 6));
}

let last = performance.now();
renderer.setAnimationLoop((now) => {
  const dt = Math.min((now - last) / 1000, 0.1);
  last = now;
  fpsMeter.tick(now);
  autoQuality.update(dt, fpsMeter.fps, !!planet && mode !== 'loading' && !document.hidden && fpsMeter.full);
  beatPulse *= Math.exp(-dt * 6);

  if (planet && mode !== 'loading') {
    // 1. Who is listening, and from where?
    if (mode === 'orbit') {
      controls.update();
    } else if (move) {
      updateMove(dt);
    } else if (mode === 'surface') {
      player.update(dt);
      checkLandmarks();
      logHeight(dt);
    }

    // 2. The music: on the surface the player's position decides what plays. In orbit it just plays.
    songTime = music.update(dt, player.getDirection());
    if (music.free) planet.directionAt(songTime, listener); else listener.copy(player.getDirection());
    if (mode === 'orbit') turnPlanetToPlayhead(dt);

    // 3. The world reacts
    planet.update(dt, songTime, listener);
    updateNearPlane();
    applyLook();
    updateMarker();
  }

  updateHud();
  renderer.render(scene, camera);
  overlay.update(now, overlayLines); // after the render, so the triangle count is this frame's
});

startExperience();

// Handy in the browser console while testing
window.mvp = {
  camera, scene, renderer, land, takeOff, loadSong, overlay, fpsMeter, activeSources, setQuality, autoQuality,
  get quality() { return quality; },
  get planet() { return planet; }, get player() { return player; }, get music() { return music; },
  get mode() { return mode; }, get songTime() { return songTime; },
};
