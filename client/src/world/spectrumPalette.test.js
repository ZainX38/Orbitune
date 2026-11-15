import assert from 'node:assert/strict';
import test from 'node:test';
import {
  describeSpectrum, spectrumPalette, legacySpectrumPalette, resolvePalette, withSpectrumPalette,
  hexToHsl, isPalette, PALETTE_KEYS,
} from './spectrumPalette.js';

const HZ_PER_BIN = 44100 / 4096;
const BINS = 2048;

// A synthetic average power spectrum: a few notes (with harmonics) over a tilted noise floor.
//   notes: [{ hz, gain }], tilt: dB per octave above 100 Hz (negative = dark), bass: extra low end (0..)
function synth({ notes, tilt = -4, bass = 0, floor = 0.002 }) {
  const power = new Float64Array(BINS);
  for (let i = 1; i < BINS; i++) {
    const hz = i * HZ_PER_BIN;
    power[i] = floor * 10 ** ((tilt * Math.log2(hz / 100)) / 10) + (hz < 120 ? bass : 0);
  }
  for (const { hz, gain } of notes) {
    for (let h = 1; h <= 6; h++) {
      const bin = Math.round((hz * h) / HZ_PER_BIN);
      if (bin < BINS) power[bin] += gain / h ** 2;
    }
  }
  return power;
}

const note = (name, octave) => 440 * 2 ** (('C C#D D#E F F#G G#A A#B '.indexOf(name.padEnd(2)) / 2 - 9) / 12 + (octave - 4));
const song = (spec, energy) => {
  const spectrum = describeSpectrum(synth(spec), HZ_PER_BIN);
  return { spectrum: { ...spectrum, energy }, loudness: [energy] };
};

// Five song types the palette must tell apart
const SONGS = {
  bassHeavy: song({ notes: [note('F', 2), note('F', 3), note('G#', 3), note('C', 4)].map((hz) => ({ hz, gain: 1 })), tilt: -7, bass: 0.6 }, 0.75),
  acoustic: song({ notes: [note('G', 3), note('B', 3), note('D', 4), note('G', 4)].map((hz) => ({ hz, gain: 1 })), tilt: -4.5 }, 0.35),
  brightPop: song({ notes: [note('D', 4), note('F#', 4), note('A', 4), note('D', 5)].map((hz) => ({ hz, gain: 1 })), tilt: -1.5 }, 0.8),
  darkElectronic: song({ notes: [note('C#', 2), note('C#', 3), note('E', 3), note('G#', 3)].map((hz) => ({ hz, gain: 1 })), tilt: -8, bass: 0.4 }, 0.6),
  vocalLed: song({ notes: [note('A#', 3), note('D', 4), note('F', 4)].map((hz) => ({ hz, gain: 1.5 })), tilt: -3.5 }, 0.5),
};

const luminance = (hex) => {
  const n = parseInt(hex.slice(1), 16);
  const lin = (v) => { v /= 255; return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; };
  return 0.2126 * lin(n >> 16) + 0.7152 * lin((n >> 8) & 255) + 0.0722 * lin(n & 255);
};
const rgbDistance = (a, b) => {
  const x = parseInt(a.slice(1), 16), y = parseInt(b.slice(1), 16);
  return Math.hypot((x >> 16) - (y >> 16), ((x >> 8) & 255) - ((y >> 8) & 255), (x & 255) - (y & 255));
};

test('describeSpectrum finds the pitch class and band balance', () => {
  const a = describeSpectrum(synth({ notes: [{ hz: 440, gain: 1 }], floor: 1e-6 }), HZ_PER_BIN);
  assert.equal(a.chroma.indexOf(1), 9); // A
  const { bass, mid, treble } = a.bands;
  assert.ok(Math.abs(bass + mid + treble - 1) < 0.01);
  assert.equal(a.curve.length, 24);
  assert.ok(a.curve.every((v) => v >= 0 && v <= 1));
});

test('palettes are complete hex colours', () => {
  for (const features of Object.values(SONGS)) assert.ok(isPalette(spectrumPalette(features)));
});

test('the same spectrum always gives the same palette', () => {
  for (const features of Object.values(SONGS)) {
    assert.deepEqual(spectrumPalette(structuredClone(features)), spectrumPalette(features));
  }
});

test('different songs give visibly different palettes', () => {
  const entries = Object.entries(SONGS).map(([name, f]) => [name, spectrumPalette(f)]);
  for (let i = 0; i < entries.length; i++) {
    for (let j = i + 1; j < entries.length; j++) {
      const [na, a] = entries[i], [nb, b] = entries[j];
      const difference = PALETTE_KEYS.reduce((sum, k) => sum + rgbDistance(a[k], b[k]), 0) / PALETTE_KEYS.length;
      assert.ok(difference > 40, `${na} and ${nb} are too alike (${difference.toFixed(1)}): ${JSON.stringify(a)} ${JSON.stringify(b)}`);
    }
  }
});

test('dark, bass-heavy music makes a night planet and bright music a day planet', () => {
  const night = spectrumPalette(SONGS.darkElectronic), day = spectrumPalette(SONGS.brightPop);
  assert.ok(luminance(night.sky) < 0.08, `night sky ${night.sky}`); // biome.js: sky luminance < 0.08 = night
  assert.ok(luminance(day.sky) > 0.2, `day sky ${day.sky}`);
});

test('roles keep their brightness order, so terrain, sky and fog read coherently', () => {
  for (const [name, features] of Object.entries(SONGS)) {
    const p = spectrumPalette(features);
    const l = Object.fromEntries(PALETTE_KEYS.map((k) => [k, hexToHsl(p[k]).l]));
    assert.ok(l.peaks > l.ground, `${name}: peaks brighter than ground`);
    assert.ok(l.fog > l.sky, `${name}: fog lighter than sky`);
    assert.ok(hexToHsl(p.atmosphere).s >= hexToHsl(p.sky).s - 0.05, `${name}: atmosphere the most saturated`);
  }
});

test('more bass gives a deeper ground than the same song with less', () => {
  const light = spectrumPalette({ ...SONGS.acoustic, spectrum: { ...SONGS.acoustic.spectrum, bands: { bass: 0.4, mid: 0.4, treble: 0.2 } } });
  const heavy = spectrumPalette({ ...SONGS.acoustic, spectrum: { ...SONGS.acoustic.spectrum, bands: { bass: 0.72, mid: 0.2, treble: 0.08 } } });
  assert.ok(hexToHsl(heavy.ground).l < hexToHsl(light.ground).l);
});

test('withSpectrumPalette stores the palette, and leaves features without a spectrum alone', () => {
  assert.deepEqual(withSpectrumPalette(SONGS.vocalLed).spectrumPalette, spectrumPalette(SONGS.vocalLed));
  const old = { atmosphere: '#123456' };
  assert.equal(withSpectrumPalette(old), old);
});

test('resolvePalette: stored, then spectrum, then derived, then legacy', () => {
  const stored = { ground: '#111111', peaks: '#222222', sky: '#333333', fog: '#444444', atmosphere: '#555555' };
  const legacy = { ground: '#6b7f8e', peaks: '#e8eef2', sky: '#2a3550', fog: '#9fb0c0' };
  const old = { atmosphere: '#4a7fd1', bass: [0.5, 0.6], mid: [0.4], treble: [0.3], loudness: [0.5] };

  assert.deepEqual(resolvePalette({ ...SONGS.acoustic, spectrumPalette: stored }, { palette: legacy }), { palette: stored, source: 'stored' });
  assert.equal(resolvePalette(SONGS.acoustic, { palette: legacy }).source, 'spectrum');

  const derived = resolvePalette(old, { palette: legacy });
  assert.equal(derived.source, 'derived');
  assert.deepEqual(derived.palette, legacySpectrumPalette(old));
  assert.ok(Math.abs(hexToHsl(derived.palette.atmosphere).h - hexToHsl(old.atmosphere).h) < 40, 'keeps the old hue');

  assert.deepEqual(resolvePalette({}, { palette: legacy }), { palette: { ...legacy, atmosphere: legacy.sky }, source: 'legacy' });
  assert.equal(resolvePalette({}, {}).source, 'default');
});

test('a demo adjustment shifts the look but keeps it deterministic', () => {
  const base = spectrumPalette(SONGS.acoustic), shifted = spectrumPalette(SONGS.acoustic, { hue: -50 });
  assert.notDeepEqual(base, shifted);
  assert.deepEqual(shifted, spectrumPalette(SONGS.acoustic, { hue: -50 }));
  const darker = spectrumPalette(SONGS.acoustic, { lightness: -0.3 });
  assert.ok(luminance(darker.sky) < 0.08, 'a lightness adjustment can turn a day planet into a night one');
});
