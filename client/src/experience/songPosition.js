// Position and music: the listener's LONGITUDE on the planet is a place in the song.
// (Longitude = song time: the song runs once around the equator, eastwards. planet.timeAt(direction) does the maths.)
//
//   const song = createSongPosition({ audioContext, audioBuffer, features, planet, onBeat });
//   song.start();                                  // after a click or key press (browsers block audio before that)
//   const songTime = song.update(dt, direction);   // every frame. direction = player.getDirection()
//   song.setFree(true);                            // orbit view: just play the song, ignore the position
//   song.dispose();
//
// How it behaves on the surface (free = false):
//   The music ALWAYS plays forward at normal speed. It never loops a bar and it never jumps by itself.
//     - landing            -> nothing changes: the song carries on. The landing spot becomes the "anchor".
//     - standing still     -> the song keeps playing. (Show planet.directionAt(songTime) to the player: the playhead.)
//     - walking            -> once you are more than RESYNC_AFTER seconds of song away from the anchor, the music
//                             crossfades to where you stand now, and that spot becomes the new anchor.
//   What counts is how far YOU moved, not how far the music has run: the music travels round the planet several
//   times faster than a walk, so "music too far from me" would be true all the time and would bring the loop back.
//   A re-sync moves the music by a whole number of beats, so the rhythm carries on without a stumble.
//
// One sound source plays at a time. Only during a crossfade (FADE seconds) there are two.

const FADE = 0.15;           // seconds, crossfade length
const RESYNC_AFTER = 1.5;    // seconds of song the listener has to move away from the anchor before the music follows
const MIN_RESYNC_GAP = 1.0;  // seconds between two re-syncs (near the poles a few steps cross many longitudes)
const DEBUG = true;

const mod = (a, n) => ((a % n) + n) % n;

// Every source that exists right now, over ALL songs (also one that was disposed a moment ago).
// 1 while playing, 2 only during a crossfade, 0 while a song loads. Anything else is a leak: the debug overlay shows it.
let live = 0;
export const activeSources = () => live;

// Equal-power fade curves: two unrelated parts of the song keep the same loudness through the crossfade
const CURVE_IN = Float32Array.from({ length: 32 }, (_, i) => Math.sin((i / 31) * Math.PI / 2));
const CURVE_OUT = Float32Array.from({ length: 32 }, (_, i) => Math.cos((i / 31) * Math.PI / 2));

export function createSongPosition({ audioContext, audioBuffer, features, planet, onBeat, volume = 0.9 }) {
  const ctx = audioContext;
  const duration = audioBuffer.duration;
  const beats = features.beats ?? [];
  const beat = 60 / (features.bpm || 120); // seconds
  const log = (...a) => DEBUG && console.log('[song]', ...a);
  const around = (d) => mod(d + duration / 2, duration) - duration / 2; // a difference in song time, shortest way round

  const master = ctx.createGain();
  master.gain.value = volume;
  const musicGain = ctx.createGain();
  musicGain.gain.value = 1;
  master.connect(musicGain).connect(ctx.destination);

  const voices = new Set(); // every source that still exists: the one playing + any that are fading out
  let voice = null;         // what is playing now: { source, gain, startedAt (context time), offset (song time) }
  let pausedAt = 0;         // song time to start from
  let free = true;
  let anchor = null;        // the listener's song time at the last sync (null = take it from the next update)
  let lastJump = -1;
  let lastSync = null;      // context time of the last re-sync (null = none yet)
  let syncs = 0;            // how many re-syncs so far
  let lastTime = 0;         // song time at the previous update (for firing beats)
  let logTimer = 0;
  let listenerTime = 0;

  // Song time at a given context time
  const timeAt = (when) => (voice ? mod(voice.offset + (when - voice.startedAt), duration) : pausedAt);

  // Fade a voice out and stop it. Its onended (below) then disconnects it.
  function release(v, when) {
    if (v.stopping) return;
    v.stopping = true;
    const g = v.gain.gain, from = g.value;
    g.cancelScheduledValues(when);
    try {
      g.setValueCurveAtTime(CURVE_OUT.map((x) => x * from), when, FADE);
    } catch { // a fade-in still running at `when`: fall back to a straight ramp
      g.setValueAtTime(from, when);
      g.linearRampToValueAtTime(0, when + FADE);
    }
    v.source.stop(when + FADE + 0.02);
  }

  // A voice is over: take it out of the audio graph. Safe to call twice.
  function retire(v) {
    if (!voices.delete(v)) return;
    live--;
    v.source.onended = null;
    try { v.source.stop(); } catch { /* already stopped */ }
    v.source.disconnect(); v.gain.disconnect();
  }

  // Start a new source at `offset` and fade every other one out underneath it
  function play(offset) {
    const when = ctx.currentTime;
    for (const v of voices) release(v, when);

    const source = ctx.createBufferSource();
    source.buffer = audioBuffer;
    source.loop = true; // the end of the clip meets its start, like the equator
    const gain = ctx.createGain();
    gain.gain.value = 0;
    gain.gain.setValueCurveAtTime(CURVE_IN, when, FADE);
    source.connect(gain).connect(master);
    source.start(when, mod(offset, duration));

    const v = { source, gain, startedAt: when, offset: mod(offset, duration), stopping: false };
    source.onended = () => retire(v);
    voices.add(v);
    live++;
    voice = v;
    lastJump = when;
  }

  function start() {
    if (ctx.state === 'suspended') ctx.resume();
    if (!voice) { play(pausedAt); log(`playing from ${pausedAt.toFixed(2)}s | one beat = ${beat.toFixed(2)}s | ${features.bpm} bpm`); }
  }

  // Jump straight to a song time (crossfaded)
  function seek(time) {
    if (voice) play(time); else pausedAt = mod(time, duration);
    lastTime = mod(time, duration);
    anchor = null;
  }

  // free = true: orbit, the position is ignored. free = false: surface. Switching never touches what is playing.
  function setFree(value) {
    if (free !== value) log(value ? 'free play (orbit)' : 'surface: the song plays on, and follows you when you walk away');
    free = value;
    anchor = null; // wherever the listener is at the next update is the new starting point
  }

  // Fire onBeat for every beat between the previous update and now (not across jumps)
  function fireBeats(time) {
    const step = time - lastTime;
    const wrapped = step < 0 && step + duration < 0.5; // ran over the end of the clip
    if (onBeat && ((step > 0 && step < 0.5) || wrapped)) {
      for (const b of beats) {
        if (wrapped ? b > lastTime || b <= time : b > lastTime && b <= time) onBeat(b);
      }
    }
    lastTime = time;
  }

  // Call every frame. listenerDirection: unit vector from the planet's centre to the listener (planet space).
  // Returns the song time (seconds) that is sounding now.
  function update(dt, listenerDirection) {
    let time = timeAt(ctx.currentTime);

    if (!free && listenerDirection) {
      listenerTime = planet.timeAt(listenerDirection);
      if (anchor === null) anchor = listenerTime;
      const moved = around(listenerTime - anchor);
      if (voice && Math.abs(moved) > RESYNC_AFTER && ctx.currentTime - lastJump > MIN_RESYNC_GAP) {
        // Bring the music to the listener, moving it by whole beats so it stays in time
        const shift = Math.round(around(listenerTime - time) / beat) * beat;
        anchor = listenerTime;
        if (shift !== 0) {
          const target = mod(time + shift, duration);
          log(`re-sync: ${time.toFixed(2)}s -> ${target.toFixed(2)}s (listener at ${listenerTime.toFixed(2)}s)`);
          play(target);
          lastTime = time = target;
          lastSync = ctx.currentTime; syncs++;
        }
      }
    }

    fireBeats(time);

    logTimer += dt;
    if (DEBUG && voice && logTimer >= 2) {
      logTimer = 0;
      const where = free ? 'free play' : `listener at longitude ${(listenerTime / duration).toFixed(3)} = ${listenerTime.toFixed(2)}s`;
      log(`time ${time.toFixed(2)}s <-> longitude ${(time / duration).toFixed(3)} | ${where}`);
    }
    return time;
  }

  function dispose() {
    const when = ctx.currentTime;
    for (const v of voices) release(v, when);
    voice = null;
    // Whatever happens to the sources (a suspended context never fires onended), nothing reaches the speakers after this
    setTimeout(() => {
      for (const v of [...voices]) retire(v);
      master.disconnect();
      musicGain.disconnect();
    }, (FADE + 0.1) * 1000);
  }

  return {
    start, seek, setFree, update, dispose,
    musicGain,
    setVolume(value) {
      master.gain.setTargetAtTime(Math.max(0, Math.min(1, value)), ctx.currentTime, 0.03);
    },
    get volume() { return master.gain.value; },
    get time() { return timeAt(ctx.currentTime); },
    get playing() { return !!voice && ctx.state === 'running'; },
    get free() { return free; },
    get sources() { return voices.size; }, // 1 while playing, 2 only during a crossfade
    get sinceSync() { return lastSync === null ? null : ctx.currentTime - lastSync; }, // seconds since the music last jumped to the listener
    get syncs() { return syncs; },
    duration, beat,
  };
}
