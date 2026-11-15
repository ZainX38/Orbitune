// A slowly drifting starfield behind the start page: three tiled layers of
// stars, far ones small and slow, near ones brighter and faster. The drift is a
// CSS animation (see .starfield in style.css), so it costs almost nothing and
// stops by itself for people who ask for less motion.

const LAYERS = [
  // tile size px, stars per tile, biggest radius, brightness, seconds per tile
  { tile: 256, stars: 70, size: 0.8, alpha: 0.55, drift: 260 },
  { tile: 384, stars: 45, size: 1.1, alpha: 0.75, drift: 180 },
  { tile: 512, stars: 22, size: 1.6, alpha: 0.95, drift: 120 },
];

// A few stars are tinted with the accents, the rest are white.
const TINTS = ['255,255,255', '255,255,255', '255,255,255', '196,181,253', '165,243,252'];

function starTile({ tile, stars, size, alpha }) {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = tile;
  const ctx = canvas.getContext('2d');
  for (let i = 0; i < stars; i++) {
    const r = 0.3 + Math.random() * size;
    const a = alpha * (0.4 + Math.random() * 0.6);
    ctx.fillStyle = `rgba(${TINTS[(Math.random() * TINTS.length) | 0]},${a})`;
    ctx.beginPath();
    ctx.arc(Math.random() * tile, Math.random() * tile, r, 0, Math.PI * 2);
    ctx.fill();
  }
  return canvas.toDataURL();
}

export function createStarfield(parent = document.body) {
  const root = document.createElement('div');
  root.className = 'starfield';
  root.setAttribute('aria-hidden', 'true');
  for (const layer of LAYERS) {
    const el = document.createElement('div');
    el.className = 'starfield__layer';
    el.style.setProperty('--tile', `${layer.tile}px`);
    el.style.setProperty('--drift', `${layer.drift}s`);
    el.style.backgroundImage = `url(${starTile(layer)})`;
    root.append(el);
  }
  parent.prepend(root);
  return { dispose: () => root.remove() };
}
