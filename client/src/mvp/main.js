// MVP page: a planet made from a song, that reacts to the music, where your position controls the playback.
//   orbit view -> click the planet to land -> walk (the music follows your longitude) -> Esc back to orbit
// No server needed: the two demo songs are in public/demo/, analysed in the browser (tempAnalysis.js).
// Run `npm run dev` and open http://localhost:5173/mvp.html
// Add ?nolock to the URL to test without capturing the mouse (drag to look, click the ground to walk).

import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { createPlanet } from '../world/planet.js';
import { createPlayer, PLAYER_SCALE } from '../experience/player.js';
import { createSongPosition } from '../experience/songPosition.js';
import { analyseSong } from './tempAnalysis.js';
import { DEMO_SONGS, makeBlueprint } from './demoBlueprints.js';

// ---------- Settings ----------
const LAND_TIME = 1.5;      // seconds, orbit -> surface
const TAKEOFF_TIME = 1.2;   // seconds, surface -> orbit
const ORBIT_DISTANCE = 150; // camera distance from the planet centre
const LANDMARK_RANGE = 12 * PLAYER_SCALE; // come this close to a landmark to trigger it (scales with the player, see player.js)
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
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.toneMapping = THREE.ACESFilmicToneMapping; // believable light: bright areas roll off instead of clipping
renderer.toneMappingExposure = 1.0;
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
const useLock = !new URLSearchParams(location.search).has('nolock');
const analysed = new Map(); // song id -> { features, audioBuffer } (so switching back is instant)

let mode = 'loading'; // 'loading' | 'orbit' | 'landing' | 'surface' | 'takeoff'
let move = null;      // the camera move running during 'landing' / 'takeoff'
let song = null, planet = null, player = null, music = null, marker = null;
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
  buttons: DEMO_SONGS.map((s, i) => {
    const button = document.createElement('button');
    button.textContent = s.title;
    button.title = `${s.title} by ${s.artist}`;
    button.addEventListener('click', () => { button.blur(); loadSong(i); });
    document.getElementById('songs').append(button);
    return button;
  }),
};
let hintText = null, timeText = null;
const clockText = (t) => `${Math.floor(t / 60)}:${String(Math.floor(t % 60)).padStart(2, '0')}`;

function updateHud() {
  let hint = HINTS[mode] ?? '';
  if (mode === 'orbit' && !music?.playing) hint = HINTS.start;
  if (mode === 'surface' && !player.locked) hint = HINTS.surfaceNoLock;
  if (hint !== hintText) ui.hint.textContent = hintText = hint;

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

async function loadSong(index) {
  const next = DEMO_SONGS[index];
  if (song === next) return;
  const id = ++loadId;
  ui.buttons.forEach((b, i) => { b.setAttribute('aria-pressed', i === index); b.disabled = true; });
  console.log(`[mvp] loading "${next.title}"`);

  // Tear down the old world first
  if (planet) {
    if (player.enabled) player.disable();
    music.dispose();
    planet.dispose();
    planet = player = music = marker = null;
  }
  move = null;
  resetView();
  setMode('loading');
  updateHud();

  try {
    if (!analysed.has(next.id)) {
      const response = await fetch(next.url);
      if (!response.ok) throw new Error(`${next.url}: ${response.status}`);
      analysed.set(next.id, await analyseSong(await response.arrayBuffer(), audioContext));
    }
    if (id !== loadId) return; // another song was picked meanwhile
    const { features, audioBuffer } = analysed.get(next.id);
    const blueprint = makeBlueprint(next.id, features);

    song = next;
    planet = createPlanet(features, blueprint);
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
    if (audioContext.state === 'running') music.start();

    ui.planet.textContent = planet.name;
    ui.song.textContent = `${song.title} · ${song.artist} · ${features.bpm} bpm`;

    // Back to a clean orbit view
    songTime = 0;
    controls.enabled = true;
    facing = Math.atan2(camera.position.z, camera.position.x);
    planet.group.rotation.y = -facing;
    setMode('orbit');
  } catch (error) {
    console.error('[mvp] could not load the song', error);
    ui.hint.textContent = hintText = `Could not load "${next.title}" (see the console)`;
  } finally {
    if (id === loadId) ui.buttons.forEach((b) => { b.disabled = false; });
  }
}

// Browsers only allow sound after a click or key press
function unlockAudio() {
  if (audioContext.state !== 'running') audioContext.resume().then(() => music?.start());
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
      nearby.clear();
      heightTimer = 0;
    },
  };
}

function takeOff() {
  if (mode !== 'surface') return;
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

// ---------- Landmarks: log once when the player comes near (Role 4: replace the log with narration) ----------
const nearby = new Set();
function checkLandmarks() {
  planet.landmarks.forEach((landmark, i) => {
    const distance = player.position.distanceTo(landmark.position); // both in the planet's own space
    if (distance < LANDMARK_RANGE && !nearby.has(i)) {
      nearby.add(i);
      console.log(`[landmark] ${landmark.name} (${landmark.kind}): ${landmark.lore}`);
    } else if (distance > LANDMARK_RANGE * 1.25 && nearby.has(i)) {
      nearby.delete(i); // left: it can trigger again on the next visit
    }
  });
}

// ---------- Debug: height above the ground every 2 s, measured from the real camera position ----------
let heightTimer = 0;
function logHeight(dt) {
  heightTimer += dt;
  if (heightTimer < 2) return;
  heightTimer = 0;
  local.copy(camera.position).applyMatrix4(planetInverse());
  const r = local.length();
  const above = r - planet.radius - planet.getHeight(local.divideScalar(r));
  console.log(`[mvp] height above ground: ${above.toFixed(3)} (eye height ${player.eyeHeight})`);
}

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
});

loadSong(0);

// Handy in the browser console while testing
window.mvp = {
  camera, scene, renderer, land, takeOff, loadSong,
  get planet() { return planet; }, get player() { return player; }, get music() { return music; },
  get mode() { return mode; }, get songTime() { return songTime; },
};
