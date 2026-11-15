// The Express server. Each `app.get(...)` below is one address ("route") that
// the website can call. `req` is the request coming in, `res` is our reply.
import express from 'express';
import { search, getAudio } from './deezer.js';
import multer from 'multer';
import os from 'node:os';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { unlink } from 'node:fs/promises';

const app = express();

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

// Saves each uploaded song as a temporary file, keeping its .mp3 or .wav ending.
const upload = multer({
  storage: multer.diskStorage({
    destination: os.tmpdir(),
    filename: (req, file, done) =>
      done(null, `orbitune-${Date.now()}${path.extname(file.originalname)}`),
  }),
  limits: { fileSize: 20 * 1024 * 1024 },
});

// POST /analyse  →  runs analyse.py on the uploaded song and returns its JSON.
app.post('/analyse', upload.single('audio'), (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No audio file sent' });

  const script = path.join(import.meta.dirname, 'analyse.py');
  // Give up after 5 minutes. A song normally takes about 25 seconds, but the
  // very first run on a machine can take 2 minutes while Python sets itself up.
  const options = { maxBuffer: 20 * 1024 * 1024, timeout: 300000 };

  // The command that starts Python is "python" on Windows and usually
  // "python3" on Linux. Setting PYTHON in the environment overrides it.
  const python = process.env.PYTHON || 'python';

  // req.file.path is the temp file's location: this is your "input path".
  execFile(python, [script, req.file.path, '--json'], options, (err, stdout, stderr) => {
    unlink(req.file.path).catch(() => {}); // delete the temp file either way

    if (err) {
      console.error(stderr || err);
      return res.status(502).json({ error: 'Analysis failed' });
    }
    try {
      res.json(JSON.parse(stdout));
    } catch {
      console.error('analyse.py did not print JSON:', stdout);
      res.status(502).json({ error: 'Analysis returned an unreadable result' });
    }
  });
});


app.listen(3000, () => console.log('Server running on http://localhost:3000'));
