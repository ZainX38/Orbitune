# Orbitune: Project Context

I am Role ?: <your name>. Currently working on: <e.g. "terrain displacement from AudioFeatures in world/terrain.js">`

Instructions for the AI assistant reading this

You're helping one member of a 4-person hackathon team build Orbitune. Read the edited line above first. Then:

Guide them on their role and current task only. Stay inside the folders and files their role owns (see "Roles") unless they ask otherwise.
Never change the shared contracts or module interfaces on your own. If a change is needed, tell them to agree it with the team and with the lead (Zain) first.
Prefer simple, demo-safe solutions. This is a 24-hour hackathon, so working beats perfect.
Plain JavaScript (ES modules), no TypeScript, no React unless the person asks for it.
Keep API keys in .env on the server only. Never put them in client code.
If they're behind the timeline, suggest what to cut (see "Cut order").
The project

Orbitune turns any song into a low-poly planet you can explore in first person. The terrain is shaped by the music's frequencies. The atmosphere's colour comes from the song's spectrum, treated like a planet's absorption spectrum. The biome, landmarks and lore come from Gemini listening to the song. An ElevenLabs narrator tells each landmark's story.

Tagline: Every song is a world. Go explore it.
Target challenge: Marshall Wace, "New Worlds" (build something that opens a door to the unexplored).
Main hackathon theme: "Composition". The name works in both senses: polyphony means many musical voices composed together, and the worlds are built from polygons.
Bonus prizes to try: MLH Best Use of Gemini API, ElevenLabs prize (if offered this year).
No finance and no Arduino/hardware.
Demo flow (what judges see)
Pick a song: search the Deezer library (30-second previews), upload an MP3, or pick one of 3 pre-cached demo songs.
Watch it form: a loading screen shows Gemini's reading of the song ("melancholic, big drop at 0:20") while the planet forms.
Orbit view: the planet spins in space, its atmosphere coloured by the song's spectrum.
Land: click the planet, the camera dives to the surface and switches to first person (WASD and mouse, or click to walk). Esc returns to orbit.
Explore: the song plays and the planet glows to the beat. Walking near a landmark (chorus = mountain range, drop = canyon) plays the narrator reading its lore, positioned in 3D, over that biome's ambient sound.
Gallery: a small solar system of every planet created so far.
Stretch goal, Planet Fusion: crash two planets together. ElevenLabs Music composes a hybrid song and a new world is born.
Roles
Role	Who	Owns (files)	Job
1. Frontend + Deezer		client/src/ui/, server/index.js, server/cache.js, server/deezer.js	Vite + Express setup, start screen, Deezer search with album covers, upload, loading screen, gallery. GET /search, GET /audio/:id. Shared cache helper. Devpost write-up
2. Audio analysis + Gemini		client/src/audio/, server/gemini.js	Frequency bands, loudness, beats, peaks, absorption-spectrum atmosphere colour, all in the browser. POST /analyse sends the song to Gemini and returns the Blueprint. Hands both JSONs to the rest of the app
3. World builder (lead)	Zain	client/src/world/, client/src/main.js	Planet from AudioFeatures + Blueprint: terrain, biome colours, atmosphere, landmarks, flora, getHeight. As lead: owns main.js (wires every part together), merges branches, keeps the timeline, writes the demo script
4. Experience + ElevenLabs		client/src/experience/, server/elevenlabs.js	Orbit view, landing, first-person walking on the sphere, landmark triggers, 3D audio. POST /narrate and POST /ambience with ElevenLabs. Planet Fusion music if time allows
Architecture
BROWSER (Vite + Three.js)                                   main.js (lead) wires these together
  Upload + UI ──► Audio analysis ──► World builder ──► Experience
  (Role 1:        (Role 2: bands,    (Role 3: icosphere,  (Role 4: orbit view,
   Deezer search,  loudness, beats,   terrain, biome,      first-person walk,
   upload, loading, peaks, atmosphere landmarks;           3D narration, ambience)
   gallery)         colour)           exports getHeight)
      │  ▲                                    ▲                    ▲
      ▼  │ search + MP3          Blueprint JSON│     voice + ambience│
SERVER (Express on Node)
  GET /search, /audio/:id   Disk cache       POST /analyse        POST /narrate, /ambience
  (Role 1)                  (Role 1)         (Role 2)             (Role 4)
      │                                           │                     │
      ▼                                           ▼                     ▼
  Deezer API                                 Gemini API            ElevenLabs API
Folder structure
polyphonia/
  server/
    index.js           Express app, mounts all routes            ← Role 1
    cache.js           get/set cached JSON + audio by key         ← Role 1
    deezer.js          /search, /audio/:id                        ← Role 1
    gemini.js          /analyse → Blueprint                       ← Role 2
    elevenlabs.js      /narrate, /ambience (+ music for Fusion)   ← Role 4
    cache/             cached files, keyed by song hash / track id
  client/              Vite app
    mvp.html           the app page (MVP)
    world-test.html    Role 3's test page
    src/main.js        wires everything together                  ← Role 3 (lead)
    src/ui/            search, upload, loading, gallery           ← Role 1
    src/audio/         analysis.js, spectrum.js, beats.js, index.js ← Role 2
    src/world/         planet.js, terrain.js, biome.js, atmosphere.js, landmarks.js, noise.js ← Role 3
    src/experience/    orbit.js, player.js, triggers.js, sound.js ← Role 4
  mocks/
    blueprint.json     use until /analyse works
    features.json      use until audio analysis works
  .env                 GEMINI_API_KEY, ELEVENLABS_API_KEY (never commit)

Each role only edits its own files. server/index.js mounts the other roles' routers (e.g. app.use(require('./gemini'))), so roles 2 and 4 never need to edit it after the first setup.

Tech stack
Part	Tech
Client	Vite (vanilla), Three.js, Web Audio API (or the Meyda library)
Server	Node + Express, @google/genai SDK, ElevenLabs SDK
AI	Gemini (audio in → structured JSON out), ElevenLabs text-to-speech + sound effects (+ Music for Fusion)
Songs	Deezer API (free, no key, 30-second MP3 previews, about 50 requests per 5 seconds) through our server. Uploads for full songs
Dev proxy	vite.config.js forwards /analyse, /narrate, /ambience, /search, /audio to Express
Run it
bash
cd client && npm install && npm run dev      # http://localhost:5173
cd server && npm install && node index.js    # http://localhost:3000
How the program runs (one song, start to finish)
Load (Role 1): main.js creates the renderer, scene, camera and lights and shows the start screen.
Choose (Role 1): search calls GET /search → Deezer → album covers. Clicking calls GET /audio/:id → MP3 bytes (the server fetches it because of CORS). Upload reads the file directly. Result: an ArrayBuffer.
Analyse (Role 2), two paths in parallel:
Browser: decodeAudioData → 512 frames → FFT per frame → bass/mid/treble/loudness, beats, BPM, peaks, atmosphere colour → AudioFeatures.
Server: the same audio goes to POST /analyse → cache check by hash → Gemini with a JSON schema → Blueprint.
Voice (Role 4): as soon as the Blueprint arrives, call /narrate for each landmark's lore and /ambience for each prompt. Don't wait for the planet.
Build (Role 3): createPlanet(features, blueprint) → terrain via getHeight, coloured triangles, atmosphere, landmarks, trees.
Explore (Role 4): orbit view, song plays, beats call planet.onBeat(). Click to land → first person → narration near landmarks → Esc back to orbit → gallery (Role 1).

Every frame (in main.js): experience.update(dt) → planet.update(dt) → renderer.render(scene, camera).

Shared contracts (DO NOT change without telling the team)
Contract 1: Blueprint (Role 2's server → everyone)

Gemini must return exactly this shape (use structured JSON output). Section times are seconds in the audio that was analysed.

json
{
  "planetName": "Velmora",
  "mood": "melancholic",
  "biome": "misty tundra",
  "palette": { "ground": "#6b7f8e", "peaks": "#e8eef2", "sky": "#2a3550", "fog": "#9fb0c0" },
  "flora": ["crystal pines", "glow moss"],
  "sections": [
    { "type": "verse", "start": 0, "end": 8 },
    { "type": "chorus", "start": 8, "end": 14 },
    { "type": "drop", "start": 20, "end": 24 }
  ],
  "landmarks": [
    { "name": "The Hollow Choir", "section": "chorus", "kind": "mountain range", "lore": "Two short sentences the narrator reads." }
  ],
  "ambiencePrompts": ["cold wind over ice", "distant glass chimes"],
  "narratorStyle": "calm, low, older storyteller"
}
Contract 2: AudioFeatures (Role 2's browser analysis → Role 3)

All arrays have length frames and are normalised from 0 to 1.

json
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
Contract 3: getHeight (Role 3 → Role 4)
js
// direction: THREE.Vector3 (normalised). Returns terrain height above the base radius (50).
planet.getHeight(direction)

It is the same function used to build the terrain mesh, so the player stands exactly on the ground. Nothing ever moves the ground (beats change the glow only).

Module interfaces (what main.js calls)
js
// Role 1: ui/
const song = await ui.pickSong();               // → { arrayBuffer, title, artist, cover }
ui.showLoading(stepText);  ui.hideLoading();  ui.addToGallery(planet);

// Role 2: audio/index.js
const { features, blueprint } = await analyseSong(song.arrayBuffer); // runs both paths in parallel
onBeat(callback);                               // live beat events while the song plays

// Role 3: world/planet.js
const planet = createPlanet(features, blueprint);
// → { group, getHeight, radius, landmarks, colours, onBeat, update, name }
// landmarks: [{ name, lore, kind, section, position: THREE.Vector3, marker }]
// colours:   { space, sky, fog, atmosphere } (THREE.Color)

// Role 4: experience/
const experience = createExperience({ scene, camera, renderer, planet, blueprint, audioBuffer });
// → { update(dt), land(), takeOff(), dispose() }  (fetches narration + ambience itself)
Server routes
Route	Owner	In	Out
GET /search?q=	Role 1	query	[{ id, title, artist, cover, preview }]
GET /audio/:id	Role 1	Deezer track id	MP3 bytes (re-fetch the track first, because preview links expire)
POST /analyse	Role 2	audio file	Blueprint JSON
POST /narrate	Role 4	{ text, style }	MP3 URL
POST /ambience	Role 4	{ prompt }	looping MP3 URL
How song → world works
Song property	Becomes	File	Owner
Song time	Longitude (time runs around the equator)	world/terrain.js	Role 3
Bass band	Continents / big landmasses	world/terrain.js	Role 3
Mid band	Hills and ridges	world/terrain.js	Role 3
Treble band	Fine surface detail	world/terrain.js	Role 3
Loudness	Ridge along the equator	world/terrain.js	Role 3
Top frequency peaks → wavelengths	Atmosphere colour (sky, rim glow, fog)	audio/spectrum.js	Role 2
Beats (live)	Glow pulse on atmosphere + landmarks	audio/beats.js → planet.onBeat()	Roles 2 + 3
Gemini mood, palette, sections	Biome colours, landmarks at chorus (mountain) and drop (canyon)	world/biome.js, world/landmarks.js	Role 3
Absorption-spectrum colour (Role 2)

Real planets get their colour from what their atmosphere absorbs: methane absorbs red, so Neptune looks blue. We do the same with the song.

Take the 2–4 strongest frequency peaks. Use narrow bands only: absorbing everything gives muddy grey.
Map log(frequency) over 20 Hz–20 kHz onto 380–750 nm, giving each peak a narrow absorption band.
Start with white light, subtract the bands, convert to RGB with the CIE 1931 colour matching table (hard-coded, 10 nm steps), then boost saturation slightly.
Output the hex string as AudioFeatures.atmosphere.
Fallback (30 min): map the strongest peak directly to a hue.
Pitch line: "Astronomers turn a planet's spectrum into knowledge. We run it backwards."
First person on a sphere (Role 4)
up = position.clone().normalize().
Turn WASD into movement along the ground's flat direction at that point, then snap back: position = dir × (planet.radius + planet.getHeight(dir) + eyeHeight).
Rebuild the camera orientation every frame from up and the forward direction flattened onto the ground. Never keep rotating the old orientation, or the camera drifts and tilts.
Turning spins around up. Looking up and down tilts only the camera. Use PointerLockControls for mouse look.
On landing: scene.background = planet.colours.sky, scene.fog = new THREE.Fog(planet.colours.fog, 20, 140). On take-off: planet.colours.space, no fog.
Use PositionalAudio at each landmark.position so narration and ambience come from the landmarks.
Add click to walk / auto-walk to the next landmark for judges who don't use WASD. Slow, smooth movement, no head bob.
Timeline (assumes submission around 12:00 Sunday, so adjust to the real deadline)
Phase	Time	Role 1 Frontend	Role 2 Audio + Gemini	Role 3 World (lead)	Role 4 Experience + voice
Set up	Sat 16:30–19:30	Vite + Express scaffold, mocks	Mock features, Gemini call works	Planet renders on test page	Orbit camera, ElevenLabs call works
Core build	19:30–00:00	Search UI, /search, /audio	Bands, beats, /analyse live	Terrain + biome from mocks	/narrate, /ambience live
Integrate	Sun 00:00–04:00	Song → pipeline, loading screen	Real JSON into the world	main.js wiring, landmarks	First person, narration triggers
Polish	04:00–09:00	Gallery, cache demo songs	Absorption colour, peaks	Low-poly look, flora, sky	3D audio, walking feel
Demo prep	09:00–12:00	Devpost text, backup video	Bug fixes, rehearse	Demo script, rehearse	Bug fixes, rehearse

Gate that matters: a real song produces a full planet by about 04:00. Code freeze 09:00.

Rules
One branch per role (frontend, audio, world, experience). The lead merges into main at midnight, 04:00 and 09:00.
Only edit your own files. Announce contract or interface changes to everyone.
Cache every API result for the 3 demo songs. The demo must run offline.
Cut order (if behind)
Planet Fusion → 2. walk-through-the-song scrubbing → 3. gallery → 4. ambient sound → 5. full absorption maths (use the hue fallback). Never cut: song → planet, the narrator, first person/landing (fallback: orbit plus click-to-fly).
Stretch goal: walk through the song

The player's longitude controls where the song is playing: walk east and the music plays forward. With a 30-second preview, one lap is the whole clip.
