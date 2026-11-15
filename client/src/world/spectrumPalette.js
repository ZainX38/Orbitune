// The song spectrum palette: the planet's five foundational colours, computed from the music itself.
// ONE implementation, used by every entry point:
//   - tempAnalysis.js (demo songs, analysed in the browser) stores it on the features,
//   - main.js stores it on the features of uploaded / searched songs (analysed by server/analyse.py),
//   - planet.js resolves it for every planet it draws, including old saved planets (resolvePalette).
// Gemini still names the planet and writes its biome, landmarks, flora and narration, but no longer picks colours.
//
//   const spectrum = describeSpectrum(meanPower, hzPerBin);   // raw inputs, stored as features.spectrum
//   const palette = spectrumPalette({ ...features, spectrum }); // { ground, peaks, sky, fog, atmosphere } hex strings
//   const { palette, source } = resolvePalette(features, blueprint); // what planet.js draws with
//
// features.spectrum (the raw inputs needed to reproduce the palette, also written by server/analyse.py):
//   chroma: 12 numbers 0..1 (C, C#, ... B), strongest = 1
//   bands:  { bass, mid, treble } shares of the amplitude, summing to 1
//   curve:  SPECTRUM_EDGES.length - 1 numbers 0..1, a compact averaged spectrum (log-spaced bands, strongest = 1).
//           Not used by the Stage 1 heuristic: it is kept for a later, closer absorption-spectrum model.
//   energy: mean loudness 0..1 (optional: the mean of features.loudness is used when it is missing)
//
// No randomness anywhere: the same spectrum always gives the same palette.

// ---------- The spectrum descriptor (server/analyse.py mirrors these numbers exactly) ----------
export const BAND_EDGES = { bass: [30, 250], mid: [250, 2000], treble: [2000, 10000] }; // Hz
// Hz. Below ~400 Hz a semitone spans fewer than 2 FFT bins (~11 Hz each), and which note a bin rounds to then
// depends on the sample rate: the same song decoded at 44.1 and 48 kHz got different hues.
export const CHROMA_RANGE = [400, 5000];
const NOTE_WIDTH = 0.08; // 2 * 0.2 semitones squared: bins between two notes (mostly leakage) count less
const CURVE_BANDS = 24;
export const SPECTRUM_EDGES = Array.from({ length: CURVE_BANDS + 1 }, (_, i) => 40 * (10000 / 40) ** (i / CURVE_BANDS));

const round3 = (v) => Math.round(v * 1000) / 1000;
const clamp01 = (v) => Math.max(0, Math.min(1, v));
const smoothstep = (a, b, x) => { const t = clamp01((x - a) / (b - a)); return t * t * (3 - 2 * t); };
const mean = (arr) => (arr?.length ? arr.reduce((a, b) => a + b, 0) / arr.length : 0);

// meanPower: the song's average POWER spectrum (any scale), bin i at i * hzPerBin Hz
export function describeSpectrum(meanPower, hzPerBin) {
  const chroma = new Array(12).fill(0);
  const bandSum = { bass: 0, mid: 0, treble: 0 };
  const curve = new Array(CURVE_BANDS).fill(0);
  for (let i = 1; i < meanPower.length; i++) {
    const hz = i * hzPerBin, power = meanPower[i];
    if (!(power > 0)) continue;
    if (hz >= CHROMA_RANGE[0] && hz < CHROMA_RANGE[1]) {
      const semitones = 12 * Math.log2(hz / 440), nearest = Math.round(semitones), off = semitones - nearest;
      const pc = ((nearest + 9) % 12 + 12) % 12; // A = 9
      chroma[pc] += Math.sqrt(power) * Math.exp(-(off * off) / NOTE_WIDTH);
    }
    for (const band of ['bass', 'mid', 'treble']) {
      if (hz >= BAND_EDGES[band][0] && hz < BAND_EDGES[band][1]) bandSum[band] += power;
    }
    const k = Math.floor(CURVE_BANDS * Math.log(hz / 40) / Math.log(10000 / 40));
    if (k >= 0 && k < CURVE_BANDS) curve[k] += power;
  }
  const top = Math.max(...chroma) || 1;
  const amp = { bass: Math.sqrt(bandSum.bass), mid: Math.sqrt(bandSum.mid), treble: Math.sqrt(bandSum.treble) };
  const total = amp.bass + amp.mid + amp.treble || 1;
  const curveAmp = curve.map(Math.sqrt);
  const curveTop = Math.max(...curveAmp) || 1;
  return {
    chroma: chroma.map((v) => round3(v / top)),
    bands: { bass: round3(amp.bass / total), mid: round3(amp.mid / total), treble: round3(amp.treble / total) },
    curve: curveAmp.map((v) => round3(v / curveTop)),
  };
}

// ---------- Colour helpers (no three.js, so the analyser can use this file too) ----------
const wrap = (h) => ((h % 360) + 360) % 360;
// Shortest way round the colour wheel from a to b, t of the way
const mixHue = (a, b, t) => wrap(a + ((((b - a) % 360) + 540) % 360 - 180) * t);

export function hslToHex(h, s, l) {
  s = clamp01(s); l = clamp01(l);
  const f = (n) => {
    const k = (n + wrap(h) / 30) % 12;
    const c = l - s * Math.min(l, 1 - l) * Math.max(-1, Math.min(k - 3, 9 - k, 1));
    return Math.round(c * 255).toString(16).padStart(2, '0');
  };
  return `#${f(0)}${f(8)}${f(4)}`;
}

export function hexToHsl(hex) {
  const n = parseInt(hex.slice(1), 16);
  const r = (n >> 16) / 255, g = ((n >> 8) & 255) / 255, b = (n & 255) / 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b), l = (max + min) / 2, d = max - min;
  if (d === 0) return { h: 0, s: 0, l };
  const s = d / (1 - Math.abs(2 * l - 1));
  const h = max === r ? 60 * (((g - b) / d) % 6) : max === g ? 60 * ((b - r) / d + 2) : 60 * ((r - g) / d + 4);
  return { h: wrap(h), s, l };
}

const HEX = /^#[0-9a-f]{6}$/i;
export const PALETTE_KEYS = ['ground', 'peaks', 'sky', 'fog', 'atmosphere'];
export const isPalette = (p, keys = PALETTE_KEYS) => !!p && keys.every((k) => HEX.test(p[k] ?? ''));

// ---------- Music -> mood numbers ----------
// Krumhansl-Kessler key profiles: how strongly each scale degree belongs to a major / minor key
const MAJOR = [6.35, 2.23, 3.48, 2.33, 4.38, 4.09, 2.52, 5.19, 2.39, 3.66, 2.29, 2.88];
const MINOR = [6.33, 2.68, 3.52, 5.38, 2.6, 3.53, 2.54, 4.75, 3.98, 2.69, 3.34, 3.17];

function correlate(a, b) {
  const ma = mean(a), mb = mean(b);
  let num = 0, da = 0, db = 0;
  for (let i = 0; i < a.length; i++) { num += (a[i] - ma) * (b[i] - mb); da += (a[i] - ma) ** 2; db += (b[i] - mb) ** 2; }
  return da && db ? num / Math.sqrt(da * db) : 0;
}

// 0 = clearly major ... 1 = clearly minor (0.5 when the chroma cannot tell)
function minorness(chroma) {
  let major = -1, minor = -1;
  for (let key = 0; key < 12; key++) {
    const rotated = chroma.map((_, i) => chroma[(i + key) % 12]);
    major = Math.max(major, correlate(rotated, MAJOR));
    minor = Math.max(minor, correlate(rotated, MINOR));
  }
  return clamp01(0.5 + (minor - major) * 4);
}

// Hue from the pitch classes, placed round the CIRCLE OF FIFTHS (C red, G orange, D yellow ... F magenta):
// related keys get neighbouring colours. Cubing the chroma lets the dominant note lead, its neighbours nudge it.
// strength 0..1: how much one pitch area stands out (a flat chroma, e.g. noise, has no real colour).
function chromaHue(chroma) {
  // Every note is present a little in a whole song's chroma: subtract that floor, so what stands out is what counts
  const floor = Math.min(...chroma), range = Math.max(...chroma) - floor;
  if (!(range > 0)) return { hue: 210, strength: 0 };
  let x = 0, y = 0, total = 0;
  chroma.forEach((v, pc) => {
    const w = ((v - floor) / range) ** 3, angle = (((pc * 7) % 12) * 30 * Math.PI) / 180;
    x += w * Math.cos(angle); y += w * Math.sin(angle); total += w;
  });
  if (!total) return { hue: 210, strength: 0 };
  return { hue: wrap((Math.atan2(y, x) * 180) / Math.PI), strength: Math.hypot(x, y) / total };
}

// Everything the palette needs, from whatever the features hold
function moodOf(features) {
  const s = features.spectrum ?? {};
  let bands = s.bands;
  if (!bands) { // old features: the 0..1 band arrays are each normalised on their own, so only their balance is usable
    const b = mean(features.bass), m = mean(features.mid), t = mean(features.treble), sum = b + m + t || 1;
    bands = { bass: b / sum, mid: m / sum, treble: t / sum };
  }
  const energy = clamp01(s.energy ?? (features.loudness?.length ? mean(features.loudness) : 0.5));
  // Measured: a dark club track has treble/bass about 0.27, a bright mix about 0.5-1, sub-heavy EDM below 0.1.
  // tilt 0 = dark and heavy ... 1 = bright and airy
  const tilt = clamp01((Math.log2((bands.treble + 0.005) / (bands.bass + 0.005)) + 3.2) / 2.8);
  return { bands, energy, tilt };
}

// ---------- The palette ----------
// hue: 0..360. mood: { bands, energy, tilt }. minor: 0..1. strength: how coloured (0..1).
// adjust (optional, for the demo songs): { hue: degrees, saturation: x, lightness: +/- }
function buildPalette(hue, { bands, energy, tilt }, minor, strength, adjust = {}) {
  // Minor keys lean cool, major keys warm: a small turn of the hue towards blue (220) or amber (40)
  hue = mixHue(hue, minor > 0.5 ? 220 : 40, Math.abs(minor - 0.5) * 0.3);
  hue = wrap(hue + (adjust.hue ?? 0));
  const satGain = adjust.saturation ?? 1, lift = adjust.lightness ?? 0;

  // Day or night: bright, airy, loud, major songs are day planets; heavy, dark, minor ones are night planets
  const daylight = 0.55 * tilt + 0.25 * energy + 0.2 * (1 - minor) + lift;
  const night = daylight < 0.48;
  const colour = (0.35 + 0.65 * strength) * satGain; // a song without a clear pitch gives a muted world
  const loud = 0.55 + 0.45 * energy;                  // loudness -> saturation and contrast

  // Peak accent: close (analogous) for calm songs, towards complementary for loud, treble-rich ones
  const contrast = clamp01(0.6 * energy + 0.6 * tilt - 0.25);
  const peakHue = mixHue(hue, hue + 180, 0.15 + 0.55 * contrast);

  // Mid-heavy songs give warmer, more organic ground (pulled towards olive / ochre)
  const organic = smoothstep(0.25, 0.5, bands.mid);
  const groundHue = mixHue(hue, 45, 0.45 * organic);
  const heavy = smoothstep(0.4, 0.75, bands.bass); // bass-heavy -> deeper, darker ground

  if (night) {
    return {
      ground: hslToHex(groundHue, (0.32 + 0.25 * loud) * colour, 0.2 + 0.1 * tilt - 0.07 * heavy + lift * 0.3),
      peaks: hslToHex(peakHue, (0.7 + 0.3 * loud) * colour, 0.55 + 0.12 * tilt),
      sky: hslToHex(hue, (0.55 + 0.3 * loud) * colour, 0.08 + 0.05 * tilt),
      fog: hslToHex(hue, (0.4 + 0.25 * loud) * colour, 0.2 + 0.08 * tilt),
      atmosphere: hslToHex(hue, (0.75 + 0.25 * loud) * colour, 0.58),
    };
  }
  return {
    ground: hslToHex(groundHue, (0.25 + 0.3 * loud) * colour, 0.42 + 0.1 * tilt - 0.1 * heavy + lift * 0.3),
    peaks: hslToHex(peakHue, (0.35 + 0.4 * loud) * colour, 0.74 + 0.1 * tilt),
    sky: hslToHex(hue, (0.4 + 0.35 * loud) * colour, 0.6 + 0.12 * tilt),
    fog: hslToHex(hue, (0.3 + 0.25 * loud) * colour, 0.74 + 0.1 * tilt),
    atmosphere: hslToHex(hue, (0.7 + 0.3 * loud) * colour, 0.6),
  };
}

// Full palette from features.spectrum (+ features.loudness). null when there is no spectrum to read.
export function spectrumPalette(features, adjust) {
  const chroma = features?.spectrum?.chroma;
  if (!Array.isArray(chroma) || chroma.length !== 12) return null;
  const mood = moodOf(features);
  const { hue: pitchHue, strength } = chromaHue(chroma);
  // A flat chroma has no real pitch colour: lean on the spectral balance instead (dark = violet, bright = cyan)
  const hue = mixHue(260 - 80 * mood.tilt, pitchHue, smoothstep(0.05, 0.35, strength));
  return buildPalette(hue, mood, minorness(chroma), smoothstep(0.1, 0.6, strength), adjust);
}

// Limited palette for planets saved before features.spectrum existed: the hue from their single atmosphere
// colour, everything else from the band and loudness arrays they already have. No mode information.
export function legacySpectrumPalette(features) {
  if (!HEX.test(features?.atmosphere ?? '') || !features.bass?.length) return null;
  const { h, s } = hexToHsl(features.atmosphere);
  return buildPalette(h, moodOf(features), 0.5, clamp01(s / 0.6));
}

// What a planet is drawn with, safest first:
//   1. the palette stored with the features  2. computed from the stored spectrum
//   3. limited palette from the old atmosphere + band data  4. the Blueprint's legacy palette (Gemini)
export function resolvePalette(features, blueprint) {
  if (isPalette(features?.spectrumPalette)) return { palette: features.spectrumPalette, source: 'stored' };
  const computed = spectrumPalette(features);
  if (computed) return { palette: computed, source: 'spectrum' };
  const limited = legacySpectrumPalette(features);
  if (limited) return { palette: limited, source: 'derived' };
  const legacy = blueprint?.palette;
  if (isPalette(legacy, ['ground', 'peaks', 'sky', 'fog'])) {
    return { palette: { ...legacy, atmosphere: HEX.test(features?.atmosphere ?? '') ? features.atmosphere : legacy.sky }, source: 'legacy' };
  }
  return { palette: { ground: '#4a5560', peaks: '#d8dee4', sky: '#2a3550', fog: '#7d8b9a', atmosphere: '#4a7fd1' }, source: 'default' };
}

// features with the palette stored on them (for saving). Leaves features without a spectrum unchanged.
export function withSpectrumPalette(features, adjust) {
  const palette = spectrumPalette(features, adjust);
  return palette ? { ...features, spectrumPalette: palette } : features;
}
