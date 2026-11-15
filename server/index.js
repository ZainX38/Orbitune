// The Express server. Each `app.get(...)` below is one address ("route") that
// the website can call. `req` is the request coming in, `res` is our reply.
import express from 'express';
import { search, getAudio } from './deezer.js';
import multer from 'multer';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { analyseAudio } from './analyse.js';
import { planetsRouter } from './planets.js';

const app = express();
const envFile = path.join(path.dirname(fileURLToPath(import.meta.url)), '.env');
if (existsSync(envFile)) process.loadEnvFile(envFile);

app.use('/planets', planetsRouter);

// GET /search?q=daft punk  →  a list of matching songs.
app.get('/search', async (req, res) => {
  // req.query holds everything after the `?` in the address.
  // `?? ''` means "use an empty string if q is missing".
  const q = String(req.query.q ?? '').trim();
  if (!q) return res.json([]);

  try {
    res.json(await search(q));
  } catch (err) {
    console.error(err);
    res.status(502).json({ error: 'Search failed' });
  }
});


app.get('/audio/:id', async (req, res) => {
  const { id } = req.params;

  // Only accept ids made of digits. The id is used to build a file name and a
  // Deezer URL, so this stops anyone sending something like "../../secret".
  if (!/^\d+$/.test(id)) return res.status(400).json({ error: 'Bad track id' });

  try {
    // `type` tells the browser that the bytes we are sending are an MP3.
    res.type('audio/mpeg').send(await getAudio(id));
  } catch (err) {
    console.error(err);
    res.status(502).json({ error: 'Could not load audio' });
  }
});

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 15 * 1024 * 1024 } });

// POST /analyse  →  runs analyse.py on the uploaded song and returns its JSON.
app.post('/analyse', upload.single('audio'), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No audio file sent' });

  const extension = path.extname(req.file.originalname).toLowerCase();
  if (!['.mp3', '.wav'].includes(extension)) {
    return res.status(400).json({ error: 'Unsupported audio format' });
  }

  try {
    res.json(await analyseAudio(req.file.buffer, extension));
  } catch (err) {
    console.error(err);
    res.status(502).json({ error: 'Could not analyse this audio' });
  }
});


const narrationCache = new Map();
const voiceSettings = (style) => {
  const value = typeof style === 'string' ? style.toLowerCase() : '';
  if (/\b(calm|mystical|serene|gentle)\b/.test(value)) {
    return { stability: 0.78, similarity_boost: 0.75, style: 0.25 };
  }
  if (/\b(epic|dramatic|intense|powerful)\b/.test(value)) {
    return { stability: 0.35, similarity_boost: 0.75, style: 0.8 };
  }
  return { stability: 0.55, similarity_boost: 0.75, style: 0.4 };
};

app.post('/narrate', express.json({ limit: '16kb' }), async (req, res) => {
  const text = typeof req.body?.text === 'string' ? req.body.text.trim() : '';
  const style = req.body?.style;

  if (!text || text.length > 1000 || (style !== undefined && (typeof style !== 'string' || style.length > 200))) {
    return res.status(400).json({ error: 'Send non-empty text up to 1000 characters and an optional short style.' });
  }

  const { ELEVENLABS_API_KEY, ELEVENLABS_VOICE_ID } = process.env;
  if (!ELEVENLABS_API_KEY || !ELEVENLABS_VOICE_ID) {
    return res.status(503).json({ error: 'Narration credentials are missing.' });
  }

  const settings = voiceSettings(style);
  const cacheKey = createHash('sha256')
    .update(JSON.stringify([text, ELEVENLABS_VOICE_ID, style ?? '', settings]))
    .digest('hex');
  if (narrationCache.has(cacheKey)) {
    return res.type('audio/mpeg').send(narrationCache.get(cacheKey));
  }

  let generation = narrationCache.get(`pending:${cacheKey}`);
  if (!generation) {
    generation = (async () => {
      const response = await fetch(
        `https://api.elevenlabs.io/v1/text-to-speech/${encodeURIComponent(ELEVENLABS_VOICE_ID)}`,
        {
          method: 'POST',
          headers: {
            'xi-api-key': ELEVENLABS_API_KEY,
            'Content-Type': 'application/json',
            Accept: 'audio/mpeg',
          },
          body: JSON.stringify({ text, model_id: 'eleven_multilingual_v2', voice_settings: settings }),
        },
      );

      if (!response.ok) {
        const body = await response.text();
        console.error('ElevenLabs narration request failed:', response.status, body.split(ELEVENLABS_API_KEY).join('[redacted]'));
        throw new Error('ElevenLabs could not generate narration.');
      }

      return Buffer.from(await response.arrayBuffer());
    })();
    narrationCache.set(`pending:${cacheKey}`, generation);
  }

  try {
    const audio = await generation;
    narrationCache.set(cacheKey, audio);
    res.type('audio/mpeg').send(audio);
  } catch (error) {
    console.error('Narration generation failed:', error.message);
    res.status(502).json({ error: 'ElevenLabs could not generate narration.' });
  } finally {
    narrationCache.delete(`pending:${cacheKey}`);
  }
});

app.use((error, req, res, next) => {
  if (req.path === '/narrate' && (error.status === 400 || error.status === 413)) {
    return res.status(400).json({ error: 'Invalid narration request.' });
  }
  next(error);
});

const port = Number(process.env.PORT) || 3000;
app.listen(port, () => console.log(`Server running on http://localhost:${port}`));
