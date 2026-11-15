import assert from 'node:assert/strict';
import test from 'node:test';
import { validatePlanetData } from './planetData.js';

const audio = {
  duration: 30,
  bpm: 120,
  frames: 2,
  bass: [0.2, 0.4],
  mid: [0.3, 0.5],
  treble: [0.4, 0.6],
  loudness: [0.5, 1],
  beats: [0, 0.5],
  peaks: [{ hz: 440, strength: 1 }],
  atmosphere: '#123456',
};

const makeWorld = (sections) => ({
  planetName: 'Test',
  mood: 'calm',
  biome: 'misty',
  palette: { ground: '#123456', peaks: '#234567', sky: '#345678', fog: '#456789' },
  flora: [],
  sections,
  landmarks: [],
  ambiencePrompts: [],
  narratorStyle: '',
});

test('drops zero-duration sections from older generated planets', () => {
  const world = makeWorld([
    { type: 'intro', start: 0, end: 0 },
    { type: 'verse', start: 0, end: 12 },
  ]);

  const result = validatePlanetData({ audio, world });

  assert.deepEqual(result.world.sections, [{ type: 'verse', start: 0, end: 12 }]);
  assert.equal(world.sections.length, 2);
});

test('rejects reversed section ranges', () => {
  const world = makeWorld([{ type: 'intro', start: 1, end: 0 }]);

  assert.throws(() => validatePlanetData({ audio, world }), /invalid sections/);
});



test('accepts a world without a palette now that colours come from the spectrum', () => {
  const { palette, ...world } = makeWorld([{ type: 'verse', start: 0, end: 12 }]);
  const spectrum = { chroma: new Array(12).fill(0.5), bands: { bass: 0.5, mid: 0.4, treble: 0.1 }, curve: [], energy: 0.5 };
  const spectrumPalette = { ground: '#123456', peaks: '#234567', sky: '#345678', fog: '#456789', atmosphere: '#56789a' };
  const result = validatePlanetData({ audio: { ...audio, spectrum, spectrumPalette }, world });
  assert.equal(result.world.palette, undefined);
});

test('rejects an invalid spectrum palette or spectrum', () => {
  const world = makeWorld([{ type: 'verse', start: 0, end: 12 }]);
  assert.throws(() => validatePlanetData({ audio: { ...audio, spectrumPalette: { ground: 'red' } }, world }), /spectrum palette/);
  assert.throws(() => validatePlanetData({ audio: { ...audio, spectrum: { chroma: [1] } }, world }), /spectrum/);
});
