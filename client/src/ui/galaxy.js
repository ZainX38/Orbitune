// A slowly turning galaxy of saved planets, drawn behind the start page.
// Hover a planet to see what it is; click it to open it in the planet viewer.
import * as THREE from 'three';
import { listPlanets } from '../api/planets.js';

const escapeHtml = (s) =>
  String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

const toColor = (c, fallback) => {
  try { return new THREE.Color(c || fallback); } catch { return new THREE.Color(fallback); }
};

// A soft round dot, used as the glow behind each planet.
function glowTexture() {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = 64;
  const ctx = canvas.getContext('2d');
  const g = ctx.createRadialGradient(32, 32, 0, 32, 32, 32);
  g.addColorStop(0, 'rgba(255,255,255,1)');
  g.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 64, 64);
  return new THREE.CanvasTexture(canvas);
}

export function createGalaxy() {
  const canvas = document.createElement('canvas');
  canvas.className = 'galaxy';
  canvas.setAttribute('aria-hidden', 'true');
  document.body.prepend(canvas);

  const tooltip = document.createElement('div');
  tooltip.className = 'galaxy__tooltip';
  tooltip.hidden = true;
  document.body.append(tooltip);

  const renderer = new THREE.WebGLRenderer({ canvas, alpha: true, antialias: true });
  renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(50, 1, 0.1, 500);
  camera.position.set(0, 30, 55);
  camera.lookAt(0, 0, 0);
  scene.add(new THREE.AmbientLight(0xffffff, 1.2));
  const sun = new THREE.DirectionalLight(0xffffff, 2);
  sun.position.set(20, 40, 30);
  scene.add(sun);

  const galaxy = new THREE.Group();
  scene.add(galaxy);

  // Starfield
  const starPositions = new Float32Array(1500 * 3);
  for (let i = 0; i < starPositions.length; i++) starPositions[i] = (Math.random() - 0.5) * 300;
  const starGeometry = new THREE.BufferGeometry();
  starGeometry.setAttribute('position', new THREE.BufferAttribute(starPositions, 3));
  galaxy.add(new THREE.Points(starGeometry, new THREE.PointsMaterial({ color: 0x1f2227, size: 0.35, transparent: true, opacity: 0.6 })));

  // Planets
  const sphere = new THREE.IcosahedronGeometry(1, 1); // low-poly
  const glow = glowTexture();
  const meshes = [];
  listPlanets()
    .then((planets) => {
      planets.forEach((p, i) => {
        const mesh = new THREE.Mesh(sphere, new THREE.MeshStandardMaterial({
          color: toColor(p.palette?.ground, '#98bd94'), flatShading: true,
        }));
        const halo = new THREE.Sprite(new THREE.SpriteMaterial({
          map: glow, color: toColor(p.atmosphere?.color ?? p.palette?.atmosphere ?? p.atmosphere, '#8cbfd9'),
          transparent: true, opacity: 0.55, depthWrite: false,
        }));
        halo.scale.setScalar(3.2);
        mesh.add(halo);
        // Spiral: two arms, spreading outwards
        const angle = i * 0.9 + (i % 2) * Math.PI;
        const radius = 6 + i * 1.4;
        mesh.position.set(Math.cos(angle) * radius, (Math.random() - 0.5) * 3, Math.sin(angle) * radius);
        mesh.userData.planet = p;
        galaxy.add(mesh);
        meshes.push(mesh);
      });
    })
    .catch((err) => console.warn('Could not load saved planets:', err));

  // The page content sits on top of the canvas, so listen on the window and
  // ignore events aimed at the page's own controls.
  const raycaster = new THREE.Raycaster();
  const pointer = new THREE.Vector2();
  let hovered = null;
  const overControls = (e) => e.target.closest?.('button, a, input, summary, details, audio, .song-picker');

  function pick(e) {
    pointer.set((e.clientX / innerWidth) * 2 - 1, -(e.clientY / innerHeight) * 2 + 1);
    raycaster.setFromCamera(pointer, camera);
    return raycaster.intersectObjects(meshes, false)[0]?.object ?? null;
  }

  addEventListener('pointermove', (e) => {
    const hit = overControls(e) ? null : pick(e);
    if (hit !== hovered) {
      hovered = hit;
      document.body.style.cursor = hit ? 'pointer' : '';
      if (hit) {
        const p = hit.userData.planet;
        tooltip.innerHTML = `<strong>${escapeHtml(p.name)}</strong>
          <span>${escapeHtml(p.song?.title)}${p.song?.artist ? ' · ' + escapeHtml(p.song.artist) : ''}</span>
          <p>${escapeHtml(p.description)}</p>`;
      }
      tooltip.hidden = !hit;
    }
    if (hit) tooltip.style.transform = `translate(${e.clientX + 14}px, ${e.clientY + 14}px)`;
  });

  addEventListener('click', (e) => {
    if (overControls(e)) return;
    const hit = pick(e);
    const id = hit?.userData.planet.id ?? hit?.userData.planet._id;
    if (id) location.href = `/mvp.html?planet=${encodeURIComponent(id)}`;
  });

  function resize() {
    renderer.setSize(innerWidth, innerHeight, false);
    camera.aspect = innerWidth / innerHeight;
    camera.updateProjectionMatrix();
  }
  addEventListener('resize', resize);
  resize();

  renderer.setAnimationLoop(() => {
    galaxy.rotation.y += 0.0008;
    for (const m of meshes) {
      const target = m === hovered ? 1.8 : 1;
      m.scale.setScalar(m.scale.x + (target - m.scale.x) * 0.15);
    }
    renderer.render(scene, camera);
  });
}
