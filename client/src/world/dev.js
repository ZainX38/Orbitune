// Standalone test page for the World builder, so you can work before anyone else is done.
// Then run `npm run dev` and open http://localhost:5173/world-test.html

import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { createPlanet } from './planet.js';
import { DEFAULT_QUALITY, nextQuality, applyRendererQuality } from './quality.js';

// ---------- Mock data (swap for real mocks/*.json, then real data) ----------
function fakeFeatures(frames = 512) {
  const f = (fn) => Array.from({ length: frames }, (_, i) => fn(i / frames));
  return {
    duration: 30, bpm: 96, frames,
    bass: f((t) => 0.5 + 0.4 * Math.sin(t * Math.PI * 4)),
    mid: f((t) => 0.5 + 0.3 * Math.sin(t * Math.PI * 10 + 1)),
    treble: f((t) => 0.3 + 0.3 * Math.abs(Math.sin(t * Math.PI * 30))),
    loudness: f((t) => (t > 0.6 && t < 0.75 ? 0.95 : 0.4 + 0.2 * Math.sin(t * Math.PI * 2))),
    beats: Array.from({ length: 48 }, (_, i) => i * 0.625),
    peaks: [{ hz: 110, strength: 0.9 }, { hz: 880, strength: 0.6 }],
    atmosphere: '#4a7fd1',
  };
}

const mockBlueprint = {
  planetName: 'Velmora', mood: 'melancholic', biome: 'misty tundra',
  palette: { ground: '#6b7f8e', peaks: '#e8eef2', sky: '#2a3550', fog: '#9fb0c0' },
  flora: ['crystal pines'],
  sections: [{ type: 'verse', start: 0, end: 8 }, { type: 'chorus', start: 8, end: 14 }, { type: 'drop', start: 20, end: 24 }],
  landmarks: [
    { name: 'The Hollow Choir', section: 'chorus', kind: 'mountain range', lore: 'Test lore.' },
    { name: 'The Falling Rift', section: 'drop', kind: 'canyon', lore: 'Test lore.' },
  ],
  ambiencePrompts: [], narratorStyle: 'calm',
};

// ---------- Scene ----------
const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setSize(innerWidth, innerHeight);
renderer.toneMapping = THREE.ACESFilmicToneMapping; // the planet's colours are tuned for this
let quality = DEFAULT_QUALITY;
applyRendererQuality(renderer, quality);            // pixel ratio + the sun's soft shadows, from the quality level
document.body.appendChild(renderer.domElement);

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(55, innerWidth / innerHeight, 0.1, 2000);
camera.position.set(0, 40, 150);
const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true;

// No lights needed: the planet brings its own sun and sky light.

const features = fakeFeatures();
const planet = createPlanet(features, mockBlueprint, { quality });
scene.background = planet.colours.space;
scene.add(planet.group);

// Fake beats so you can see the pulse
setInterval(() => planet.onBeat(1), 625);

// Press H to sanity-check getHeight: logs heights at the landmarks. Press Q to change the quality level.
addEventListener('keydown', (e) => {
  if (e.code === 'KeyQ' && !e.repeat) {
    quality = nextQuality(quality);
    applyRendererQuality(renderer, quality);
    planet.setQuality(quality);
    console.log('[dev] quality:', quality, '| drawn ground vs getHeight:', planet.groundError());
  }
  if (e.key === 'h') for (const l of planet.landmarks) console.log(l.name, planet.getHeight(l.position.clone().normalize()).toFixed(2));
});

addEventListener('resize', () => {
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(innerWidth, innerHeight);
});

// Fake playback: the song loops and the "listener" stands where the song is, so every reaction can be seen
let last = performance.now(), songTime = 0;
renderer.setAnimationLoop((now) => {
  const dt = Math.min((now - last) / 1000, 0.1);
  last = now;
  songTime = (songTime + dt) % features.duration;
  planet.group.rotation.y += dt * 0.05;
  planet.update(dt, songTime, planet.directionAt(songTime));
  controls.update();
  renderer.render(scene, camera);
});