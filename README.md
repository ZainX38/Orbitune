# Orbitune

Pick a song and Orbitune turns it into a planet you can orbit. The project has
two parts:

- `client/` – the website (Vite + Three.js)
- `server/` – the API (Express on Node), which searches songs on Deezer, runs
  the Python audio analyser, stores planets in MongoDB and asks ElevenLabs for
  landmark narration

## Requirements

- **Node.js 22** (20.12 or newer works; the server uses `process.loadEnvFile`)
- **Python 3** with `pip` (on Windows the server calls `py`, elsewhere
  `python3`)
- **ffmpeg** on your `PATH`, so librosa can decode MP3s
- A **MongoDB** database (local or Atlas) for saved planets
- API keys for **Gemini** and, for narration, **ElevenLabs**

## 1. Configure the server

Create `server\.env`:

```ini
GEMINI_API_KEY=your-gemini-key
MONGODB_URI=mongodb://localhost:27017
MONGODB_DB=orbitune            # optional, defaults to "orbitune"
ELEVENLABS_API_KEY=your-elevenlabs-key
ELEVENLABS_VOICE_ID=your-voice-id
# PORT=3000                    # optional
# ORBITUNE_PYTHON=C:\path\to\python.exe   # optional, overrides py/python3
```

Both the Node server and `analyse.py` read this file. Without the ElevenLabs
values everything works except `/narrate`.

## 2. Run in development

In one terminal, install and start the API server (port 3000):

```powershell
cd server
npm install
py -m pip install -r requirements.txt --target Lib\site-packages
npm start
```

The `--target Lib\site-packages` install keeps the Python libraries inside the
project; the server adds that folder to `PYTHONPATH` automatically. A normal
`pip install -r requirements.txt` (or a virtualenv plus `ORBITUNE_PYTHON`)
also works. If the Python libraries are missing, `/analyse` returns a 502.

In a second terminal, start the frontend (port 5173):

```powershell
cd client
npm install
npm run dev
```

Open the URL Vite prints (usually `http://localhost:5173`). Vite proxies
`/search`, `/audio`, `/analyse`, `/narrate` and `/planets` to the server, so
add new server routes to `client\vite.config.js` too.

Other pages:

- `/` – song picker and galaxy
- `/mvp.html` – demo planet viewer
- `/home.html` and `/world-test.html` – extra pages for development

## 3. Run the tests

```powershell
cd client
npm test
```

## Run as a single production server

Build the client, then let Express serve it from `client\dist`:

```powershell
cd client
npm run build
cd ..\server
npm start
```

Open `http://localhost:3000`.

### With Docker

The `Dockerfile` installs Python, ffmpeg and both Node apps, builds the client
and starts the server:

```powershell
docker build -t orbitune .
docker run -p 3000:3000 --env-file server\.env orbitune
```

`.env` is not copied into the image, so pass it with `--env-file`.

## Pre-bake landmark narration

With the API server running and the ElevenLabs settings configured, save
narration files into Vite's public cache:

```powershell
node scripts\prebake-narration.js path\to\world.json alors-on-danse
```

The world JSON must contain a `landmarks` array and may include
`narratorStyle`. Pass an optional third argument to use a different API server
URL. The generated `client\public\cache\<songId>` files are served directly,
so the MVP can play them without calling `/narrate`.
