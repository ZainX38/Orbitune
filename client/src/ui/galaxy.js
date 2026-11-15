// The saved planets, floating around the edges of the start page.
// Each one is the REAL planet (world/planet.js) built from its saved features and blueprint at the lowest quality,
// scaled down. Hover one to see what it is; click it to fly to it and open it in the planet viewer.
//
//   const galaxy = createGalaxy();
//   galaxy.addPlanet({ id, name, song, description, features, blueprint }); // a planet that was just saved
import * as THREE from 'three';
import { createPlanet } from '../world/planet.js';
import { QUALITY_LEVELS, applyRendererQuality } from '../world/quality.js';
import { listFullPlanets } from '../api/planets.js';

const MAX_PLANETS = 8;
const BUILD_GAP_MS = 250;
const whenIdle = (fn) => (window.requestIdleCallback ? requestIdleCallback(fn, { timeout: 1000 }) : setTimeout(fn, 50));
const LOWEST = QUALITY_LEVELS[0];
const FOV = 35;
const WORLD_RADIUS = 50; // createPlanet's radius before we scale it
const SUN_DIRECTION = new THREE.Vector3(0.7, 0.45, 1).normalize(); // world space: lit from the front, up and right

// Where planets go, newest first. x, y: centre on screen (-1..1, past 1 is partly off-screen).
// size: diameter as a share of the screen's shorter side. depth: distance from the camera (world units).
const SLOTS_WIDE = [
  { x: -0.78, y: 0.6, size: 0.34, depth: 420 },
  { x: 0.8, y: -0.55, size: 0.4, depth: 380 },
  { x: 0.82, y: 0.68, size: 0.17, depth: 640 },
  { x: -0.84, y: -0.62, size: 0.22, depth: 520 },
  { x: -1.02, y: 0.02, size: 0.24, depth: 560 },
  { x: 1.0, y: 0.1, size: 0.15, depth: 760 },
  { x: -0.36, y: -0.98, size: 0.13, depth: 860 },
  { x: 0.4, y: 0.97, size: 0.12, depth: 900 },
];
const SLOTS_TALL = [
  { x: -0.72, y: 0.86, size: 0.44, depth: 420 },
  { x: 0.82, y: -0.86, size: 0.5, depth: 380 },
  { x: 0.88, y: 0.74, size: 0.22, depth: 640 },
  { x: -0.88, y: -0.78, size: 0.28, depth: 520 },
  { x: 0.12, y: 1.0, size: 0.17, depth: 820 },
  { x: -0.18, y: -1.0, size: 0.18, depth: 760 },
  { x: -1.06, y: 0.18, size: 0.22, depth: 600 },
  { x: 1.06, y: -0.28, size: 0.2, depth: 700 },
];
// The middle of the page (title + song picker) that planets stay out of, in px from the centre.
const CLEAR_HALF_WIDTH = 250;
const CLEAR_HALF_HEIGHT_SHARE = { wide: 0.4, tall: 0.28 }; // tall: the picker fills the width, so give the planets the top and bottom

const escapeHtml = (s) =>
  String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const songLine = (song = {}) => [song.title, song.artist].filter(Boolean).join(' — ');
const planetUrl = (id) => `/mvp.html?planet=${encodeURIComponent(id)}`;
const easeOut = (t) => 1 - Math.pow(1 - Math.min(Math.max(t, 0), 1), 3);

export function createGalaxy() {
  const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)');

  // ---------- DOM: canvas, tooltip, "Your planets" list ----------
  const canvas = document.createElement('canvas');
  canvas.className = 'galaxy';
  canvas.setAttribute('aria-hidden', 'true');
  document.body.prepend(canvas);

  const tooltip = document.createElement('div');
  tooltip.className = 'galaxy__tooltip';
  tooltip.hidden = true;
  document.body.append(tooltip);

  const list = document.createElement('details');
  list.className = 'planet-list';
  list.hidden = true;
  const listTitle = document.createElement('summary');
  const listItems = document.createElement('ul');
  list.append(listTitle, listItems);
  document.body.append(list);

  // ---------- Three.js ----------
  const renderer = new THREE.WebGLRenderer({ canvas, alpha: true, antialias: true, powerPreference: 'high-performance' });
  renderer.toneMapping = THREE.ACESFilmicToneMapping; // as in the planet view, so the colours match
  renderer.setClearColor(0x000000, 0);
  renderer.autoClear = false;
  applyRendererQuality(renderer, LOWEST);
  const scene = new THREE.Scene(); // no lights: every planet brings its own sun
  const camera = new THREE.PerspectiveCamera(FOV, 1, 10, 3000);

  const entries = []; // newest first: { data, planet, holder, hit, slot, born, ... }
  const queue = []; // planets waiting to be built, one per frame
  const hitGeometry = new THREE.SphereGeometry(WORLD_RADIUS * 1.08, 16, 12);
  const hitMaterial = new THREE.MeshBasicMaterial({ visible: false });

  // ---------- Placement ----------
  const tmp = new THREE.Vector3();
  function layout(snap = false) {
    const w = innerWidth, h = innerHeight;
    const wide = w >= h;
    const slots = wide ? SLOTS_WIDE : SLOTS_TALL;
    const tanHalf = Math.tan(THREE.MathUtils.degToRad(FOV / 2));
    entries.forEach((e, i) => {
      const s = slots[i];
      const px = (s.x * w) / 2, py = (s.y * h) / 2; // px from the centre
      // Shrink a planet that would reach into the middle of the page, but never below 45% of its size.
      const wanted = (s.size * Math.min(w, h)) / 2;
      const dx = Math.max(Math.abs(px) - CLEAR_HALF_WIDTH, 0);
      const dy = Math.max(Math.abs(py) - h * CLEAR_HALF_HEIGHT_SHARE[wide ? 'wide' : 'tall'], 0);
      const radiusPx = Math.min(wanted, Math.max(Math.hypot(dx, dy), wanted * 0.45));
      const halfHeight = s.depth * tanHalf; // world units from the centre to the top of the screen at that depth
      e.target.set(s.x * halfHeight * camera.aspect, s.y * halfHeight, -s.depth);
      e.targetScale = ((radiusPx / (h / 2)) * halfHeight) / WORLD_RADIUS;
      if (snap || !e.placed) {
        e.base.copy(e.target);
        e.scale = e.targetScale;
        e.placed = true;
      }
    });
  }

  function resize() {
    renderer.setSize(innerWidth, innerHeight, false);
    camera.aspect = innerWidth / innerHeight;
    camera.updateProjectionMatrix();
    layout(true);
  }

  // ---------- Planets ----------
  function build(data) {
    let planet;
    try {
      planet = createPlanet(data.features, data.blueprint, { quality: LOWEST });
    } catch (err) {
      console.warn('[galaxy] could not build planet', data.id, err);
      return;
    }
    const holder = new THREE.Group(); // position, scale, float, hover
    const hit = new THREE.Mesh(hitGeometry, hitMaterial); // cheap stand-in for hover/click picking
    holder.add(planet.group, hit);
    planet.group.rotation.y = Math.random() * Math.PI * 2;
    scene.add(holder);
    const entry = {
      data, planet, holder, hit,
      base: new THREE.Vector3(), target: new THREE.Vector3(), scale: 1, targetScale: 1, placed: false,
      born: performance.now(), grow: 1, hoverScale: 1, phase: Math.random() * Math.PI * 2, spin: 0.04 + Math.random() * 0.04,
    };
    hit.userData.entry = entry;
    // Keep the newest first, whatever order they finished building in.
    const at = entries.findIndex((e) => (e.data.order ?? 0) > (data.order ?? 0));
    entries.splice(at < 0 ? entries.length : at, 0, entry);
    while (entries.length > MAX_PLANETS) remove(entries[entries.length - 1]);
    layout();
  }

  function remove(entry) {
    entries.splice(entries.indexOf(entry), 1);
    entry.planet.dispose();
    entry.holder.removeFromParent();
    if (hovered === entry) setHovered(null);
  }

  let newer = 0, older = 0; // order: smaller = newer
  function enqueue(data, newest = false) {
    if (!data?.id || !data.features || !data.blueprint) return;
    if (entries.some((e) => e.data.id === data.id) || queue.some((d) => d.id === data.id)) return;
    data.order = newest ? --newer : ++older;
    if (newest) queue.unshift(data); else queue.push(data);
    renderList();
  }

  // ---------- "Your planets" list (keyboard and screen readers) ----------
  function renderList() {
    const all = [...queue, ...entries.map((e) => e.data)]
      .sort((a, b) => a.order - b.order)
      .slice(0, MAX_PLANETS);
    list.hidden = all.length === 0;
    listTitle.textContent = `Your planets (${all.length})`;
    listItems.replaceChildren(...all.map((d) => {
      const li = document.createElement('li');
      const a = document.createElement('a');
      a.href = planetUrl(d.id);
      const name = document.createElement('strong');
      name.textContent = d.name;
      const song = document.createElement('span');
      song.textContent = songLine(d.song);
      const desc = document.createElement('span');
      desc.textContent = d.description;
      a.append(name, song, desc);
      li.append(a);
      return li;
    }));
  }

  // ---------- Hover and click ----------
  // The page sits on top of the canvas, so listen on the window and ignore events over the page's own controls.
  const raycaster = new THREE.Raycaster();
  const pointer = new THREE.Vector2(9, 9);
  let hovered = null;
  let leaving = null; // { from, to, start } while flying to a planet
  const overControls = (e) => e.target.closest?.('button, a, input, summary, details, audio, label, .sheet__picker, .planet-list');

  function pick(e) {
    pointer.set((e.clientX / innerWidth) * 2 - 1, -(e.clientY / innerHeight) * 2 + 1);
    raycaster.setFromCamera(pointer, camera);
    return raycaster.intersectObjects(entries.map((x) => x.hit), false)[0]?.object.userData.entry ?? null;
  }

  function setHovered(entry) {
    if (entry === hovered) return;
    hovered = entry;
    document.body.style.cursor = entry ? 'pointer' : '';
    tooltip.hidden = !entry;
    if (!entry) return;
    const d = entry.data;
    tooltip.innerHTML = `<strong>${escapeHtml(d.name)}</strong>
      <span>${escapeHtml(songLine(d.song))}</span>
      <p>${escapeHtml(d.description)}</p>`;
  }

  function onPointerMove(e) {
    if (leaving) return;
    setHovered(overControls(e) ? null : pick(e));
    if (hovered) {
      const x = Math.min(e.clientX + 16, innerWidth - tooltip.offsetWidth - 8);
      const y = e.clientY + 16 + tooltip.offsetHeight > innerHeight ? e.clientY - tooltip.offsetHeight - 12 : e.clientY + 16;
      tooltip.style.transform = `translate(${Math.max(8, x)}px, ${y}px)`;
    }
  }

  function onClick(e) {
    if (leaving || overControls(e)) return;
    const entry = pick(e);
    if (!entry) return;
    if (reducedMotion.matches) return location.assign(planetUrl(entry.data.id));
    setHovered(null);
    entry.holder.getWorldPosition(tmp);
    // The camera sits at the origin. Fly 65% of the way, stopping at least 2.2 planet radii out
    // (the planet's glow is made to fade out when the camera gets close).
    const keep = Math.max(0.35, (WORLD_RADIUS * entry.scale * 2.2) / tmp.length());
    leaving = { from: camera.position.clone(), to: tmp.clone().multiplyScalar(1 - keep), start: performance.now() };
    setTimeout(() => location.assign(planetUrl(entry.data.id)), 650);
  }

  function onKeyDown(e) {
    if (e.key === 'Escape') setHovered(null);
  }

  // ---------- Frame loop ----------
  const clock = new THREE.Clock();
  let building = false, lastBuild = 0, disposed = false;
  const sunLocal = new THREE.Vector3(), inv = new THREE.Quaternion();
  function frame() {
    const dt = Math.min(clock.getDelta(), 0.1);
    const t = clock.elapsedTime;
    const still = reducedMotion.matches;

    // At most one planet built per frame, so loading eight does not freeze the page in one go. A build takes
    // 0.5-2 s on a laptop, so wait for an idle moment and leave a gap between builds for typing and clicks.
    if (queue.length && !building && performance.now() - lastBuild > BUILD_GAP_MS) {
      building = true;
      whenIdle(() => {
        if (queue.length && !disposed) build(queue.shift());
        lastBuild = performance.now();
        building = false;
      });
    }

    for (const e of entries) {
      e.base.lerp(e.target, still ? 1 : 1 - Math.exp(-dt * 3));
      e.scale += (e.targetScale - e.scale) * (still ? 1 : 1 - Math.exp(-dt * 3));
      e.grow = still ? 1 : easeOut((performance.now() - e.born) / 900); // scale in when it appears
      const hover = e === hovered ? 1.12 : 1;
      e.hoverScale = still ? hover : e.hoverScale + (hover - e.hoverScale) * (1 - Math.exp(-dt * 10));
      e.holder.scale.setScalar(e.scale * e.grow * e.hoverScale);
      e.holder.position.copy(e.base);
      if (!still) {
        e.holder.position.y += Math.sin(t * 0.5 + e.phase) * WORLD_RADIUS * e.scale * 0.08;
        e.planet.group.rotation.y += dt * e.spin;
      }
      // The sun turns with the planet; turn it back so the side facing us stays lit.
      inv.copy(e.planet.group.quaternion).invert();
      sunLocal.copy(SUN_DIRECTION).applyQuaternion(inv).multiplyScalar(WORLD_RADIUS * 6);
      e.planet.sun.position.copy(sunLocal);
      e.planet.update(dt);
    }

    if (leaving) {
      const k = easeOut((performance.now() - leaving.start) / 600);
      camera.position.lerpVectors(leaving.from, leaving.to, k);
    }

    // Each planet is drawn in its own pass with only its own sun: in one pass every sun would light every planet.
    renderer.clear();
    for (const e of entries) {
      for (const o of entries) o.holder.visible = o === e;
      renderer.render(scene, camera);
    }
    for (const o of entries) o.holder.visible = true;
  }

  // ---------- Start, and clean up when the page is left ----------
  addEventListener('resize', resize);
  addEventListener('pointermove', onPointerMove);
  addEventListener('click', onClick);
  addEventListener('keydown', onKeyDown);
  resize();
  renderer.setAnimationLoop(frame);

  listFullPlanets(MAX_PLANETS)
    .then((planets) => planets.forEach((p) => enqueue(p)))
    .catch((err) => console.warn('[galaxy] could not load saved planets:', err));

  function dispose() {
    disposed = true;
    renderer.setAnimationLoop(null);
    removeEventListener('resize', resize);
    removeEventListener('pointermove', onPointerMove);
    removeEventListener('click', onClick);
    removeEventListener('keydown', onKeyDown);
    for (const e of [...entries]) remove(e);
    queue.length = 0;
    hitGeometry.dispose();
    hitMaterial.dispose();
    renderer.dispose();
  }
  addEventListener('pagehide', dispose, { once: true });
  // Coming back with the Back button can restore this page from memory, after it was cleaned up: start fresh.
  addEventListener('pageshow', (e) => { if (e.persisted) location.reload(); });

  return {
    addPlanet: (data) => enqueue(data, true),
    dispose,
  };
}
