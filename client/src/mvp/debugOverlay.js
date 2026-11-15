// Testing tools for the MVP page: a real frame-rate meter and a small text overlay (F3 shows and hides it).
//
//   const fps = createFpsMeter();
//   const overlay = createDebugOverlay();
//   // every frame, with the timestamp requestAnimationFrame gives:
//   fps.tick(now);
//   overlay.update(now, () => ['line 1', 'line 2']);   // the lines are only asked for when the overlay is showing

const WINDOW = 1000; // ms: the frame rate is measured over the last second

// Counts the frames that really reached the screen loop in the last second.
export function createFpsMeter() {
  const stamps = [];
  let fps = 0, worst = 0;

  function tick(now) {
    stamps.push(now);
    while (stamps.length > 2 && now - stamps[0] > WINDOW) stamps.shift();
    const span = now - stamps[0];
    fps = span > 0 ? ((stamps.length - 1) * 1000) / span : 0;
    worst = 0;
    for (let i = 1; i < stamps.length; i++) worst = Math.max(worst, stamps[i] - stamps[i - 1]);
  }

  // Forget everything (after a pause, a song load or a quality change: those frames say nothing about the speed)
  const reset = () => { stamps.length = 0; fps = 0; worst = 0; };

  return {
    tick, reset,
    get fps() { return fps; },           // frames per second over the last second
    get worst() { return worst; },       // longest single frame in that second, ms
    get full() { return stamps.length > 2 && stamps[stamps.length - 1] - stamps[0] > WINDOW * 0.9; }, // a whole second measured
  };
}

export function createDebugOverlay({ key = 'F3', interval = 250 } = {}) {
  const el = document.createElement('pre');
  Object.assign(el.style, {
    position: 'fixed', left: '12px', bottom: '12px', margin: '0', padding: '10px 14px', zIndex: '10',
    font: '12px/1.5 ui-monospace, Consolas, "Cascadia Mono", monospace', color: '#e8f6ea',
    background: 'rgba(6, 8, 14, 0.78)', border: '1px solid rgba(255, 255, 255, 0.18)', borderRadius: '8px',
    pointerEvents: 'none', userSelect: 'none', whiteSpace: 'pre', display: 'none',
  });
  el.id = 'debug-overlay';
  document.body.append(el);

  let visible = false, lastUpdate = -Infinity;

  function setVisible(value) {
    visible = value;
    el.style.display = visible ? 'block' : 'none';
    lastUpdate = -Infinity; // fill it in on the very next frame
  }

  addEventListener('keydown', (e) => {
    if (e.code !== key || e.repeat) return;
    e.preventDefault(); // F3 is "find next" in the browser
    setVisible(!visible);
  });

  // getLines: () => string[]. Only called while the overlay is showing, a few times per second.
  function update(now, getLines) {
    if (!visible || now - lastUpdate < interval) return;
    lastUpdate = now;
    el.textContent = getLines().join('\n');
  }

  return {
    update, setVisible,
    get visible() { return visible; },
    get text() { return el.textContent; },
  };
}
