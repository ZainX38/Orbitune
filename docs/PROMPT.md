# Orbitune: Project Context

I am Role ?: <your name>. Currently working on: <e.g. "terrain displacement from AudioFeatures in world/terrain.js">`

## Instructions for the AI assistant reading this
 
You're helping one member of a 4-person hackathon team build **Polyphonia**. Read the edited line above first. Then:
 
1. Guide them on **their role and current task only**. Stay inside their folder unless they ask otherwise.
2. **Never change the shared contracts** (Blueprint, AudioFeatures, getHeight) on your own. If a change is needed, tell them to agree it with the team first.
3. Prefer simple, demo-safe solutions. This is a 24-hour hackathon, so working beats perfect.
4. Plain JavaScript (ES modules), no TypeScript, no React unless the person asks for it.
5. Keep API keys in `.env` on the server only. Never put them in client code.
6. If they're behind the timeline, suggest what to cut (see "Cut order").
---
 
## The project
 
**Polyphonia turns any song into a low-poly planet you can explore in first person.** The terrain is shaped by the music's frequencies. The atmosphere's colour comes from the song's spectrum, treated like a planet's absorption spectrum. The biome, landmarks and lore come from Gemini listening to the song. An ElevenLabs narrator tells each landmark's story.
 
- **Tagline:** Every song is a world. Go explore it.
- **Target challenge:** Marshall Wace, "New Worlds" (build something that opens a door to the unexplored).
- **Main hackathon theme:** "Composition". The name works in both senses: polyphony means many musical voices composed together, and the worlds are built from polygons.
- **Bonus prizes to try:** MLH Best Use of Gemini API, ElevenLabs prize (if offered this year).
- **No** finance and **no** Arduino/hardware.
### Demo flow (what judges see)
1. **Pick a song:** search the Deezer library (30-second previews), upload an MP3, or pick one of 3 pre-cached demo songs.
2. **Watch it form:** a loading screen shows Gemini's reading of the song ("melancholic, big drop at 2:10") while the planet forms.
3. **Orbit view:** the planet spins in space, its atmosphere coloured by the song's spectrum.
4. **Land:** click the planet, the camera dives to the surface and switches to first person (WASD and mouse, or click to walk). Esc returns to orbit.
5. **Explore:** the song plays and the terrain pulses to the beat. Walking near a landmark (chorus = mountain range, drop = canyon) plays the narrator reading its lore, positioned in 3D, over that biome's ambient sound.
6. **Gallery:** a small solar system of every planet created so far.
7. **Stretch goal, Planet Fusion:** crash two planets together. ElevenLabs Music composes a hybrid song and a new world is born.
---
 
## Architecture
 
```
BROWSER (Vite + Three.js)
  Upload + UI ──► Audio analysis ──► World builder ──► Experience
  (Deezer search,  (Web Audio API:     (Three.js icosphere: (orbit view, first-person
   upload, loading,  bands, loudness,    terrain, biome,      walk, 3D narration,
   gallery)          beats, peaks,       landmarks;           ambience)
                     atmosphere colour)  exports getHeight)
      │  ▲                                    ▲                    ▲
      ▼  │ search + MP3          Blueprint JSON│     voice + ambience│
SERVER (Express on Node)
  GET /search, /audio/:id   Disk cache       POST /analyse        POST /narrate, /ambience
      │                     (by song hash,       │                     │
      ▼                      demo runs offline)  ▼                     ▼
  Deezer API                                Gemini API            ElevenLabs API
```
 
### Folder structure
```
polyphonia/
  server/              ← Role 1
    index.js           Express app, routes
    gemini.js          /analyse → Blueprint
    elevenlabs.js      /narrate, /ambience (+ music for Fusion)
    deezer.js          /search, /audio/:id
    cache/             cached JSON + audio, keyed by song hash / track id
  client/              Vite app
    src/audio/         ← Role 2 (analysis.js, spectrum.js, beats.js)
    src/world/         ← Role 3 (planet.js, terrain.js, biome.js, landmarks.js)
    src/experience/    ← Role 4 (orbit.js, player.js, triggers.js, sound.js, ui/)
    src/main.js        wires everything together
  mocks/
    blueprint.json     use until /analyse works
    features.json      use until audio analysis works
  .env                 GEMINI_API_KEY, ELEVENLABS_API_KEY (never commit)
```
 
### Tech stack
| Part | Tech |
| --- | --- |
| Client | Vite, Three.js, Web Audio API (or the Meyda library) |
| Server | Node + Express, `@google/genai` SDK, ElevenLabs SDK |
| AI | Gemini (audio in → structured JSON out), ElevenLabs text-to-speech + sound effects (+ Music for Fusion) |
| Songs | Deezer API (free, no key, 30-second MP3 previews, about 50 requests per 5 seconds) through the server. Uploads for full songs |
| Dev proxy | `vite.config.js` forwards `/analyse`, `/narrate`, `/ambience`, `/search`, `/audio` to Express |
 
---
 
## Shared contracts (DO NOT change without telling the team)
 
### Contract 1: Blueprint (server → client)
Gemini must return exactly this shape (use structured JSON output).
```json
{
  "planetName": "Velmora",
  "mood": "melancholic",
  "biome": "misty tundra",
  "palette": { "ground": "#6b7f8e", "peaks": "#e8eef2", "sky": "#2a3550", "fog": "#9fb0c0" },
  "flora": ["crystal pines", "glow moss"],
  "sections": [
    { "type": "verse", "start": 0, "end": 42 },
    { "type": "chorus", "start": 42, "end": 70 },
    { "type": "drop", "start": 130, "end": 150 }
  ],
  "landmarks": [
    { "name": "The Hollow Choir", "section": "chorus", "kind": "mountain range", "lore": "Two short sentences the narrator reads." }
  ],
  "ambiencePrompts": ["cold wind over ice", "distant glass chimes"],
  "narratorStyle": "calm, low, older storyteller"
}
```
 
### Contract 2: AudioFeatures (audio analysis → world builder)
All arrays have length `frames` and are normalised from 0 to 1.
```json
{
  "duration": 30.0,
  "bpm": 96,
  "frames": 512,
  "bass": [0.12, 0.15, 0.31],
  "mid": [0.40, 0.38, 0.52],
  "treble": [0.05, 0.09, 0.11],
  "loudness": [0.22, 0.25, 0.47],
  "beats": [0.62, 1.25, 1.88],
  "peaks": [{ "hz": 110, "strength": 0.9 }, { "hz": 880, "strength": 0.6 }, { "hz": 3520, "strength": 0.4 }],
  "atmosphere": "#4a7fd1"
}
```
 
### Contract 3: getHeight (world builder → experience)
```js
// direction: THREE.Vector3 (normalised). Returns terrain height above base radius.
export function getHeight(direction) { ... }
```
It must be the **same function** used to build the terrain mesh, so the player stands exactly on the ground.
 
### Server routes
| Route | In | Out |
| --- | --- | --- |
| `POST /analyse` | audio file | Blueprint JSON |
| `POST /narrate` | `{ text, style }` | MP3 URL |
| `POST /ambience` | `{ prompt }` | looping MP3 URL |
| `GET /search?q=` | query | `[{ id, title, artist, cover, preview }]` |
| `GET /audio/:id` | Deezer track id | MP3 bytes (re-fetch the track first, because preview links expire) |
 
---
 
## How song → world works
 
| Song property | Becomes | File | Owner |
| --- | --- | --- | --- |
| Song time | Longitude (time runs around the equator) | `world/terrain.js` | Role 3 |
| Bass band | Continents / big landmasses | `world/terrain.js` | Role 3 |
| Mid band | Hills and ridges | `world/terrain.js` | Role 3 |
| Treble band | Fine surface detail | `world/terrain.js` | Role 3 |
| Loudness | Overall height along the equator | `world/terrain.js` | Role 3 |
| Top frequency peaks → wavelengths | Atmosphere colour (sky, rim glow, fog) | `audio/spectrum.js` | Role 2 |
| Beats (live) | Terrain pulsing | `audio/beats.js` → `world/` | Roles 2 + 3 |
| Gemini mood + sections | Biome, ground palette, landmarks at chorus/drop | `world/biome.js`, `world/landmarks.js` | Role 3 |
 
### Absorption-spectrum colour (Role 2)
Real planets get their colour from what their atmosphere absorbs: methane absorbs red, so Neptune looks blue. We do the same with the song.
1. Take the 2–4 strongest frequency peaks. Use narrow bands only: absorbing everything gives muddy grey.
2. Map log(frequency) over 20 Hz–20 kHz onto 380–750 nm, giving each peak a narrow absorption band.
3. Start with white light, subtract the bands, convert to RGB with the CIE 1931 colour matching table (hard-coded, 10 nm steps), then boost saturation slightly.
4. Output the hex string as `AudioFeatures.atmosphere`.
**Fallback (30 min):** map the strongest peak directly to a hue.
**Pitch line:** "Astronomers turn a planet's spectrum into knowledge. We run it backwards."
### First person on a sphere (Role 4)
1. `up = position.clone().normalize()`.
2. Turn WASD into movement along the ground's flat direction at that point, then snap back: `position = dir × (radius + getHeight(dir) + eyeHeight)`.
3. **Rebuild the camera orientation every frame** from `up` and the forward direction flattened onto the ground. Never keep rotating the old orientation, or the camera drifts and tilts.
4. Turning spins around `up`. Looking up and down tilts only the camera. Use `PointerLockControls` for mouse look.
5. Use `PositionalAudio` so narration and ambience come from the landmarks.
6. Add click to walk / auto-walk to the next landmark for judges who don't use WASD. Slow, smooth movement, no head bob.
---
 
## Roles
 
| Role | Folder | Owns |
| --- | --- | --- |
| **1. AI pipeline** | `server/` | Express server, Gemini `/analyse`, ElevenLabs `/narrate` + `/ambience`, Deezer `/search` + `/audio/:id`, caching. Fusion stretch goal |
| **2. Audio analysis** | `client/src/audio/` | Bands, loudness, beats, peaks, live beat events, absorption-spectrum atmosphere colour |
| **3. World builder** | `client/src/world/` | Icosphere planet, terrain from AudioFeatures, biome/palette/landmarks from Blueprint, low-poly look, `getHeight` |
| **4. Experience** | `client/src/experience/` | Orbit view, first person, landmark triggers, 3D audio, UI (Deezer search, upload, loading, gallery), demo script, Devpost write-up |
 
---
 
## Timeline (assumes submission around 12:00 Sunday, so adjust to the real deadline)
 
| Phase | Time | Goal |
| --- | --- | --- |
| Set up | Sat 16:30–18:00 | Repo, Vite + Express running, mocks committed, API keys work, 3 demo songs chosen |
| Core build | 18:00–00:00 | Each role builds against the mocks. Merge at midnight |
| Integrate | Sun 00:00–04:00 | Real song → real planet end to end. **This is the gate that matters.** First person starts |
| Polish | 04:00–09:00 | Absorption colour, Deezer search, narration, ambience, low-poly look, gallery. Sleep in shifts |
| Demo prep | 09:00–12:00 | **Code freeze 09:00.** Bug fixes, demo script, backup video, rehearse 3× |
 
### Rules
- One branch per role (`ai`, `audio`, `world`, `experience`). Merge into `main` at midnight, 04:00 and 09:00.
- Only edit files in your own folder. Announce contract changes to everyone.
- Cache every API result for the 3 demo songs. **The demo must run offline.**
### Cut order (if behind)
1. Planet Fusion → 2. walk-through-the-song scrubbing → 3. gallery → 4. ambient sound → 5. full absorption maths (use the hue fallback).
**Never cut:** song → planet, the narrator, first person/landing (fallback: orbit plus click-to-fly).
### Stretch goal: walk through the song
The player's longitude controls where the song is playing: walk east and the music plays forward. With a 30-second preview, one lap is the whole clip.
 