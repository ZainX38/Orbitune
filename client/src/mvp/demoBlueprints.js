// Hand-written Blueprints (Contract 1) for the two demo songs, used until Role 2's /analyse (Gemini) works.
// Only `sections` is computed: it comes from the analysed audio, so the landmark times match the real 30 s clip.
//
//   const blueprint = makeBlueprint('alors-on-danse', features);

export const DEMO_SONGS = [
  { id: 'alors-on-danse', title: 'Alors on danse', artist: 'Stromae', url: '/demo/alors-on-danse.mp3' },
  { id: 'careless-whisper', title: 'Careless Whisper', artist: 'George Michael', url: '/demo/careless-whisper.mp3' },
];

const BLUEPRINTS = {
  // Dark, hypnotic, electronic, night-time, neon accents
  'alors-on-danse': {
    planetName: 'Nuit Sans Fin',
    mood: 'hypnotic',
    biome: 'neon night basalt',
    palette: { ground: '#3b2f8f', peaks: '#ff4fd8', sky: '#170b3a', fog: '#3a1f78' },
    flora: ['neon crystal spires', 'glow mushrooms', 'night pines'],
    landmarks: [
      {
        name: 'The Endless Dancefloor', section: 'chorus', kind: 'mountain range',
        lore: 'The ridge was raised by a crowd that never stopped moving. Stand still here and the ground still counts the beat for you.',
      },
      {
        name: 'The Monday Rift', section: 'drop', kind: 'canyon',
        lore: 'Every worry of the week rolled downhill and gathered in this canyon. At night the bass shakes them loose, and they rise as light.',
      },
    ],
    ambiencePrompts: ['low club bass heard through a wall', 'night wind over neon signs', 'distant crowd murmur'],
    narratorStyle: 'low, dry, hypnotic, a little tired',
  },

  // Warm, romantic, sunset, saxophone, golden and pink tones
  'careless-whisper': {
    planetName: 'Golden Reverie',
    mood: 'romantic',
    biome: 'sunset rose savanna',
    palette: { ground: '#cf6a4e', peaks: '#ffe0a3', sky: '#ff9d7a', fog: '#ffc4a3' },
    flora: ['rose blossom trees', 'golden palms', 'sax reeds'],
    landmarks: [
      {
        name: 'The Saxophone Heights', section: 'chorus', kind: 'mountain range',
        lore: 'When the evening wind crosses these golden peaks it plays one long, aching note. Lovers climb here to hear it, and never agree on what it said.',
      },
      {
        name: 'The Whispering Hollow', section: 'drop', kind: 'canyon',
        lore: 'A secret was whispered into this valley once, and the echo has not stopped. Dance here, and your feet will remember the rhythm they lost.',
      },
    ],
    ambiencePrompts: ['warm evening breeze through tall grass', 'far-away saxophone across water', 'slow waves on a beach at dusk'],
    narratorStyle: 'warm, slow, intimate, late-night radio host',
  },
};

// ---------- Sections from the analysis ----------
const CHORUS_SECONDS = 6, DROP_SECONDS = 4, JUMP_SECONDS = 2, MIN_GAP_SECONDS = 6;

// Running sums, so the average of any stretch is one subtraction
function prefix(arr) {
  const sums = new Float64Array(arr.length + 1);
  for (let i = 0; i < arr.length; i++) sums[i + 1] = sums[i] + arr[i];
  return (from, to) => (sums[to] - sums[from]) / Math.max(1, to - from);
}

// chorus = the loudest stretch. drop = the biggest jump in bass (quiet before, heavy after).
export function deriveSections(features) {
  const { frames, duration } = features;
  const toFrames = (seconds) => Math.max(1, Math.round((seconds / duration) * frames));
  const toSeconds = (frame) => +((frame / frames) * duration).toFixed(2);
  const loud = prefix(features.loudness), bass = prefix(features.bass);

  const chorusLen = toFrames(CHORUS_SECONDS);
  let chorusStart = 0, best = -Infinity;
  for (let i = 0; i + chorusLen <= frames; i++) {
    const v = loud(i, i + chorusLen);
    if (v > best) { best = v; chorusStart = i; }
  }
  const chorusCentre = chorusStart + chorusLen / 2;

  // The drop must sit away from the chorus (also across the loop point), or the mountain would fill the canyon
  const jump = toFrames(JUMP_SECONDS), dropLen = toFrames(DROP_SECONDS), gap = toFrames(MIN_GAP_SECONDS);
  let dropStart = jump;
  best = -Infinity;
  for (let i = jump; i + dropLen <= frames; i++) {
    const apart = Math.abs(i + dropLen / 2 - chorusCentre);
    if (Math.min(apart, frames - apart) < gap) continue;
    const v = bass(i, i + jump) - bass(i - jump, i);
    if (v > best) { best = v; dropStart = i; }
  }

  const chorus = { type: 'chorus', start: toSeconds(chorusStart), end: toSeconds(chorusStart + chorusLen) };
  const drop = { type: 'drop', start: toSeconds(dropStart), end: toSeconds(dropStart + dropLen) };

  // Everything else is "verse", so the list covers the whole clip in order
  const marked = [chorus, drop].sort((a, b) => a.start - b.start);
  const sections = [];
  let cursor = 0;
  for (const s of marked) {
    if (s.start - cursor > 0.5) sections.push({ type: 'verse', start: +cursor.toFixed(2), end: s.start });
    sections.push(s);
    cursor = Math.max(cursor, s.end);
  }
  if (duration - cursor > 0.5) sections.push({ type: 'verse', start: +cursor.toFixed(2), end: +duration.toFixed(2) });
  return sections;
}

export function makeBlueprint(songId, features) {
  const base = BLUEPRINTS[songId];
  if (!base) throw new Error(`No demo blueprint for "${songId}"`);
  const blueprint = { ...structuredClone(base), sections: deriveSections(features) };
  const { planetName, mood, biome, palette, flora, sections, landmarks, ambiencePrompts, narratorStyle } = blueprint;
  console.log('[blueprint]', planetName, '| sections', sections.map((s) => `${s.type} ${s.start}-${s.end}s`).join(', '));
  return { planetName, mood, biome, palette, flora, sections, landmarks, ambiencePrompts, narratorStyle }; // Contract 1 key order
}
