const HEX = /^#[0-9a-f]{6}$/i;
const SECTION_TYPES = new Set(['intro', 'verse', 'chorus', 'drop', 'bridge', 'outro']);

const isFiniteNumber = (value) => typeof value === 'number' && Number.isFinite(value);

const isUnitArray = (value, frames) => (
  Array.isArray(value)
  && value.length === frames
  && value.every((entry) => isFiniteNumber(entry) && entry >= 0 && entry <= 1)
);

export function validatePlanetData(data) {
  const { audio, world } = data ?? {};

  if (!audio || !world) {
    throw new Error('Analysis response must include audio and world JSON');
  }

  const { duration, bpm, frames, bass, mid, treble, loudness, beats, peaks, atmosphere } = audio;

  if (
    !isFiniteNumber(duration) || duration <= 0
    || !isFiniteNumber(bpm) || bpm <= 0
    || !Number.isInteger(frames) || frames <= 0
  ) {
    throw new Error('Audio JSON has invalid timing data');
  }

  for (const [name, values] of Object.entries({ bass, mid, treble, loudness })) {
    if (!isUnitArray(values, frames)) {
      throw new Error(`Audio JSON has an invalid ${name} array`);
    }
  }

  if (!Array.isArray(beats) || !beats.every((beat) => (
    isFiniteNumber(beat) && beat >= 0 && beat <= duration
  ))) {
    throw new Error('Audio JSON has invalid beats');
  }

  if (!Array.isArray(peaks) || !peaks.every((peak) => (
    isFiniteNumber(peak?.hz) && peak.hz > 0
    && isFiniteNumber(peak.strength) && peak.strength >= 0 && peak.strength <= 1
  ))) {
    throw new Error('Audio JSON has invalid frequency peaks');
  }

  if (typeof atmosphere !== 'string' || !HEX.test(atmosphere)) {
    throw new Error('Audio JSON has an invalid atmosphere colour');
  }

  const { planetName, mood, biome, palette, flora, sections, landmarks, ambiencePrompts, narratorStyle } = world;

  if (
    typeof planetName !== 'string' || !planetName
    || !palette
    || !['ground', 'peaks', 'sky', 'fog'].every((key) => HEX.test(palette[key] ?? ''))
  ) {
    throw new Error('World JSON has an invalid name or palette');
  }

  if (
    typeof mood !== 'string'
    || typeof biome !== 'string'
    || !Array.isArray(flora) || !flora.every((plant) => typeof plant === 'string')
    || !Array.isArray(ambiencePrompts) || !ambiencePrompts.every((prompt) => typeof prompt === 'string')
    || typeof narratorStyle !== 'string'
  ) {
    throw new Error('World JSON has invalid descriptive fields');
  }

  if (!Array.isArray(sections) || !sections.every((section) => (
    SECTION_TYPES.has(section?.type)
    && isFiniteNumber(section.start)
    && isFiniteNumber(section.end)
    && section.start >= 0
    && section.end >= section.start
    && section.end <= duration
  ))) {
    throw new Error('World JSON has invalid sections');
  }

  if (!Array.isArray(landmarks) || !landmarks.every((landmark) => (
    typeof landmark?.name === 'string'
    && SECTION_TYPES.has(landmark.section)
    && typeof landmark.kind === 'string'
    && typeof landmark.lore === 'string'
  ))) {
    throw new Error('World JSON has invalid landmarks');
  }

  const nonEmptySections = sections.filter((section) => section.end > section.start);
  return {
    audio,
    world: nonEmptySections.length === sections.length ? world : { ...world, sections: nonEmptySections },
  };
}