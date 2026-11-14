// Position controls the music: the listener's LONGITUDE on the planet decides which part of the song plays.
// (Longitude = song time: the song runs once around the equator, eastwards. planet.timeAt(direction) does the maths.)
//
//   const song = createSongPosition({ audioContext, audioBuffer, features, planet, onBeat });
//   song.start();                                  // after a click or key press (browsers block audio before that)
//   const songTime = song.update(dt, direction);   // every frame. direction = player.getDirection()
//   song.setFree(true);                            // orbit view: just play the song, ignore the position
//   song.dispose();
//
// How it behaves on the surface (free = false):
//   The music always plays at normal speed. The listener's position is the centre of a window ONE BAR long.
//   When the music runs out of that window it jumps back by a whole number of bars, so it stays in time:
//     - standing still      -> the bar around you loops
//     - walking east at the song's speed -> the window moves with the music: it just plays forward
//     - walking east slower -> plays forward, repeating a bar now and then. Walking west -> steps back bar by bar
//     - landing somewhere else -> jumps to that part of the song (to the nearest bar, still on the beat)
//   Every jump is a short crossfade between two players, so there are no clicks or pops.

const FADE = 0.06;          // seconds, crossfade length
const MIN_JUMP_GAP = 0.25;  // seconds between two jumps
const DEBUG = true;

const mod = (a, n) => ((a % n) + n) % n;

export function createSongPosition({ audioContext, audioBuffer, features, planet, onBeat, volume = 0.9 }) {
  const ctx = audioContext;
  const duration = audioBuffer.duration;
  const beats = features.beats ?? [];
  const bar = Math.min(duration / 4, (4 * 60) / (features.bpm || 120)); // 4 beats
  const log = (...a) => DEBUG && console.log('[song]', ...a);

  const master = ctx.createGain();
  master.gain.value = volume;
  master.connect(ctx.destination);

  let voice = null;      // what is playing now: { source, gain, startedAt (context time), offset (song time) }
  let pausedAt = 0;      // song time to start from
  let free = true;
  let lastJump = -1;
  let lastTime = 0;      // song time at the previous update (for firing beats)
  let logTimer = 0;
  let listenerTime = 0;

  // Song time at a given context time
  const timeAt = (when) => (voice ? mod(voice.offset + (when - voice.startedAt), duration) : pausedAt);

  // Start a new player at `offset` and fade the old one out underneath it
  function play(offset) {
    const when = ctx.currentTime;
    const source = ctx.createBufferSource();
    source.buffer = audioBuffer;
    source.loop = true; // the end of the clip meets its start, like the equator
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0, when);
    gain.gain.linearRampToValueAtTime(1, when + FADE);
    source.connect(gain).connect(master);
    source.start(when, mod(offset, duration));

    if (voice) {
      const old = voice;
      old.gain.gain.cancelScheduledValues(when);
      old.gain.gain.setValueAtTime(old.gain.gain.value, when);
      old.gain.gain.linearRampToValueAtTime(0, when + FADE);
      old.source.stop(when + FADE + 0.02);
      old.source.onended = () => { old.source.disconnect(); old.gain.disconnect(); };
    }
    voice = { source, gain, startedAt: when, offset: mod(offset, duration) };
    lastJump = when;
  }

  function start() {
    if (ctx.state === 'suspended') ctx.resume();
    if (!voice) { play(pausedAt); log(`playing from ${pausedAt.toFixed(2)}s | one bar = ${bar.toFixed(2)}s | ${features.bpm} bpm`); }
  }

  // Jump straight to a song time (crossfaded)
  function seek(time) {
    if (voice) play(time); else pausedAt = mod(time, duration);
    lastTime = mod(time, duration);
  }

  function setFree(value) {
    if (free !== value) log(value ? 'free play (orbit)' : 'position controls the music (surface)');
    free = value;
  }

  // Fire onBeat for every beat between the previous update and now (not across jumps)
  function fireBeats(time) {
    const step = time - lastTime;
    const wrapped = step < 0 && step + duration < 0.5; // ran over the end of the clip
    if (onBeat && ((step > 0 && step < 0.5) || wrapped)) {
      for (const b of beats) {
        if (wrapped ? b > lastTime || b <= time : b > lastTime && b <= time) {
          onBeat(b);
          if (DEBUG) console.log(`[song] beat at ${b.toFixed(2)}s`);
        }
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
      if (voice && ctx.currentTime - lastJump > MIN_JUMP_GAP) {
        const ahead = mod(listenerTime - time + duration / 2, duration) - duration / 2; // listener minus music, shortest way round
        if (Math.abs(ahead) > bar / 2) {
          const bars = Math.round(ahead / bar);
          const target = mod(time + bars * bar, duration);
          log(`jump ${bars > 0 ? '+' : ''}${bars} bar(s): ${time.toFixed(2)}s -> ${target.toFixed(2)}s (listener at ${listenerTime.toFixed(2)}s)`);
          play(target);
          lastTime = time = target;
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
    if (voice) {
      const when = ctx.currentTime;
      voice.gain.gain.cancelScheduledValues(when);
      voice.gain.gain.setValueAtTime(voice.gain.gain.value, when);
      voice.gain.gain.linearRampToValueAtTime(0, when + FADE);
      voice.source.stop(when + FADE + 0.02);
      voice = null;
    }
    setTimeout(() => master.disconnect(), 300);
  }

  return {
    start, seek, setFree, update, dispose,
    get time() { return timeAt(ctx.currentTime); },
    get playing() { return !!voice && ctx.state === 'running'; },
    get free() { return free; },
    duration, bar,
  };
}
