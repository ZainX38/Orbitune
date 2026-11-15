# Orbitune

## Run locally

In one terminal, install and start the API server:

```powershell
cd server
npm install
py -m pip install -r requirements.txt --target Lib\site-packages
npm start
```

In a second terminal, start the frontend:

```powershell
cd client
npm install
npm run dev
```

Open the URL printed by Vite. The analyzer runs in Python, so install the
requirements before choosing a song; otherwise `/analyse` returns a 502.
Set `GEMINI_API_KEY`, `ELEVENLABS_API_KEY`, and `ELEVENLABS_VOICE_ID` in
`server\.env` for planet generation and landmark narration.

The root URL opens the Song Planets MVP. The original song picker remains
available at `http://localhost:5173/home.html`.

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
