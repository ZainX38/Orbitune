// ============================================================================================
// TEMPORARY audio analyser for the MVP page. TO BE REPLACED by Role 2's client/src/audio/ module.
// ============================================================================================
// Output is AudioFeatures exactly as in Contract 2 of docs/PROMPT.md:
//   { duration, bpm, frames, bass[], mid[], treble[], loudness[], beats[], peaks[], atmosphere }
// Everything runs in the browser: decodeAudioData + a small FFT. No npm packages.
//
//   const { features, audioBuffer } = await analyseSong(arrayBuffer, audioContext);
//
// analyseSamples(samples, sampleRate) is the same thing without the browser (used for tests in Node).

const FRAMES = 512;
const FFT_SIZE = 4096;                 // for the bands: ~11 Hz per bin at 44.1 kHz
const BANDS = { bass: [30, 250], mid: [250, 2000], treble: [2000, 10000] }; // Hz
const ONSET_SIZE = 1024, ONSET_HOP = 512; // for beat tracking: ~12 ms steps
const DEBUG = true;

// ---------- FFT (in place, radix 2) ----------
function makeFft(n) {
  const rev = new Uint32Array(n), cos = new Float32Array(n / 2), sin = new Float32Array(n / 2);
  const bits = Math.log2(n);
  for (let i = 0; i < n; i++) {
    let r = 0;
    for (let b = 0; b < bits; b++) r |= ((i >> b) & 1) << (bits - 1 - b);
    rev[i] = r;
  }
  for (let i = 0; i < n / 2; i++) { cos[i] = Math.cos((2 * Math.PI * i) / n); sin[i] = Math.sin((2 * Math.PI * i) / n); }
  const hann = new Float32Array(n);
  for (let i = 0; i < n; i++) hann[i] = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (n - 1));
  const re = new Float32Array(n), im = new Float32Array(n), power = new Float32Array(n / 2);

  // Windowed power spectrum of `n` samples starting at `start` (zero outside the clip)
  return function powerSpectrum(samples, start) {
    for (let i = 0; i < n; i++) {
      const s = start + i;
      re[rev[i]] = s >= 0 && s < samples.length ? samples[s] * hann[i] : 0;
      im[i] = 0;
    }
    for (let size = 2; size <= n; size *= 2) {
      const half = size / 2, stride = n / size;
      for (let i = 0; i < n; i += size) {
        for (let j = 0; j < half; j++) {
          const c = cos[j * stride], s = sin[j * stride];
          const a = i + j, b = a + half;
          const tr = re[b] * c + im[b] * s, ti = im[b] * c - re[b] * s;
          re[b] = re[a] - tr; im[b] = im[a] - ti;
          re[a] += tr; im[a] += ti;
        }
      }
    }
    for (let i = 0; i < n / 2; i++) power[i] = re[i] * re[i] + im[i] * im[i];
    return power;
  };
}

// ---------- Helpers ----------
// 0..1: divide by the 99th percentile (one loud click must not squash everything else)
function normalise(arr) {
  const sorted = Float32Array.from(arr).sort();
  const top = sorted[Math.floor(sorted.length * 0.99)] || 1;
  return Array.from(arr, (v) => +Math.min(1, v / top).toFixed(4));
}

function hslToHex(h, s, l) {
  const f = (n) => {
    const k = (n + h / 30) % 12;
    const c = l - s * Math.min(l, 1 - l) * Math.max(-1, Math.min(k - 3, 9 - k, 1));
    return Math.round(c * 255).toString(16).padStart(2, '0');
  };
  return `#${f(0)}${f(8)}${f(4)}`;
}

// ---------- Bands + loudness + peaks ----------
function analyseBands(samples, sampleRate) {
  const fft = makeFft(FFT_SIZE);
  const hzPerBin = sampleRate / FFT_SIZE;
  const range = ([lo, hi]) => [Math.max(1, Math.round(lo / hzPerBin)), Math.min(FFT_SIZE / 2 - 1, Math.round(hi / hzPerBin))];
  const bins = { bass: range(BANDS.bass), mid: range(BANDS.mid), treble: range(BANDS.treble) };
  const out = { bass: new Float32Array(FRAMES), mid: new Float32Array(FRAMES), treble: new Float32Array(FRAMES), loudness: new Float32Array(FRAMES) };
  const average = new Float64Array(FFT_SIZE / 2);

  for (let f = 0; f < FRAMES; f++) {
    const centre = Math.floor(((f + 0.5) / FRAMES) * samples.length);
    const power = fft(samples, centre - FFT_SIZE / 2);
    for (const band of ['bass', 'mid', 'treble']) {
      let sum = 0;
      for (let i = bins[band][0]; i <= bins[band][1]; i++) sum += power[i];
      out[band][f] = Math.sqrt(sum); // amplitude, not power: closer to how loud it sounds
    }
    let total = 0;
    for (let i = 1; i < FFT_SIZE / 2; i++) { total += power[i]; average[i] += power[i]; }
    out.loudness[f] = Math.sqrt(total);
  }
  return { ...out, average, hzPerBin };
}

// The strongest peaks of the average spectrum, at least a third of an octave apart
function findPeaks(average, hzPerBin, count = 3) {
  const candidates = [];
  const lo = Math.ceil(40 / hzPerBin), hi = Math.floor(8000 / hzPerBin);
  for (let i = lo; i < hi; i++) {
    if (average[i] > average[i - 1] && average[i] >= average[i + 1]) candidates.push({ hz: i * hzPerBin, power: average[i] });
  }
  candidates.sort((a, b) => b.power - a.power);
  const picked = [];
  for (const c of candidates) {
    if (picked.every((p) => Math.abs(Math.log2(p.hz / c.hz)) > 1 / 3)) picked.push(c);
    if (picked.length === count) break;
  }
  const top = picked[0]?.power || 1;
  return picked.map((p) => ({ hz: Math.round(p.hz), strength: +Math.sqrt(p.power / top).toFixed(2) }));
}

// Simple fallback from PROMPT.md: the strongest peak decides the hue.
// We use the NOTE of that peak on the colour wheel (C = red, one semitone = 30 degrees), because nearly every
// pop song's strongest peak is bass: mapping raw frequency to hue would paint every planet the same colour.
function atmosphereColour(peaks) {
  if (!peaks.length) return '#4a7fd1';
  const semitonesFromC = 12 * Math.log2(peaks[0].hz / 261.63);
  const hue = (((semitonesFromC % 12) + 12) % 12) * 30;
  return hslToHex(hue, 0.62, 0.6);
}

// ---------- Beats ----------
function analyseBeats(samples, sampleRate, duration) {
  // 1. Onset strength: how much the spectrum grows from one step to the next
  const fft = makeFft(ONSET_SIZE);
  const steps = Math.floor(samples.length / ONSET_HOP);
  const rate = sampleRate / ONSET_HOP; // onset steps per second
  const flux = new Float32Array(steps);
  let previous = new Float32Array(ONSET_SIZE / 2);
  for (let s = 0; s < steps; s++) {
    const power = fft(samples, s * ONSET_HOP - ONSET_SIZE / 2);
    const current = new Float32Array(ONSET_SIZE / 2);
    let sum = 0;
    for (let i = 1; i < ONSET_SIZE / 2; i++) {
      current[i] = Math.log1p(Math.sqrt(power[i]) * 50);
      if (current[i] > previous[i]) sum += current[i] - previous[i];
    }
    flux[s] = sum;
    previous = current;
  }
  // Keep only what sticks out above the local average
  const onset = new Float32Array(steps), win = Math.round(rate * 0.4);
  let running = 0;
  for (let s = 0; s < steps; s++) {
    running += flux[Math.min(steps - 1, s + win)] - (s - win - 1 >= 0 ? flux[s - win - 1] : 0);
    if (s === 0) { running = 0; for (let k = 0; k <= win; k++) running += flux[k]; }
    const count = Math.min(steps - 1, s + win) - Math.max(0, s - win) + 1;
    onset[s] = Math.max(0, flux[s] - running / count);
  }
  const at = (t) => { // onset strength at time t (seconds), interpolated
    const x = t * rate, i = Math.floor(x);
    if (i < 0 || i + 1 >= steps) return 0;
    return onset[i] + (onset[i + 1] - onset[i]) * (x - i);
  };

  // 2. Tempo: which beat spacing lines the onsets up with themselves best? (65-140 bpm, gently preferring ~110)
  let coarse = 120, best = -Infinity;
  for (let bpm = 65; bpm <= 140; bpm += 0.5) {
    const lag = (60 / bpm) * rate;
    let score = 0;
    for (let s = 0; s + 2 * lag < steps; s++) {
      const a = s + lag, b = s + 2 * lag, ia = Math.floor(a), ib = Math.floor(b);
      score += onset[s] * (onset[ia] + (onset[Math.min(steps - 1, ia + 1)] - onset[ia]) * (a - ia))
        + 0.5 * onset[s] * (onset[ib] + (onset[Math.min(steps - 1, ib + 1)] - onset[ib]) * (b - ib));
    }
    score *= Math.exp(-0.5 * (Math.log2(bpm / 110) / 0.8) ** 2);
    if (score > best) { best = score; coarse = bpm; }
  }

  // 3. Exact tempo + where the first beat falls: slide a beat grid over the whole clip
  let bpm = coarse, phase = 0;
  best = -Infinity;
  for (let candidate = coarse * 0.97; candidate <= coarse * 1.03; candidate += 0.02) {
    const period = 60 / candidate;
    for (let p = 0; p < period; p += 0.01) {
      let score = 0;
      for (let t = p; t < duration; t += period) score += at(t);
      if (score > best) { best = score; bpm = candidate; phase = p; }
    }
  }
  const period = 60 / bpm, beats = [];
  for (let t = phase; t < duration; t += period) beats.push(+t.toFixed(3));
  return { bpm: +bpm.toFixed(1), beats };
}

// ---------- Public ----------
// samples: Float32Array, mono
export function analyseSamples(samples, sampleRate) {
  const duration = samples.length / sampleRate;
  const bands = analyseBands(samples, sampleRate);
  const { bpm, beats } = analyseBeats(samples, sampleRate, duration);
  const peaks = findPeaks(bands.average, bands.hzPerBin);
  const features = {
    duration: +duration.toFixed(3),
    bpm,
    frames: FRAMES,
    bass: normalise(bands.bass),
    mid: normalise(bands.mid),
    treble: normalise(bands.treble),
    loudness: normalise(bands.loudness),
    beats,
    peaks,
    atmosphere: atmosphereColour(peaks),
  };
  if (DEBUG) console.log('[tempAnalysis]', `${features.duration}s, ${bpm} bpm, ${beats.length} beats, first beat ${beats[0]}s, peaks`, peaks.map((p) => `${p.hz}Hz`).join(' '), 'atmosphere', features.atmosphere);
  return features;
}

// arrayBuffer: the MP3 bytes. audioContext: any AudioContext (it may still be suspended).
export async function analyseSong(arrayBuffer, audioContext) {
  const audioBuffer = await audioContext.decodeAudioData(arrayBuffer);
  const mono = new Float32Array(audioBuffer.length);
  for (let c = 0; c < audioBuffer.numberOfChannels; c++) {
    const data = audioBuffer.getChannelData(c);
    for (let i = 0; i < mono.length; i++) mono[i] += data[i] / audioBuffer.numberOfChannels;
  }
  console.time('[tempAnalysis] analyse');
  const features = analyseSamples(mono, audioBuffer.sampleRate);
  console.timeEnd('[tempAnalysis] analyse');
  return { features, audioBuffer };
}
