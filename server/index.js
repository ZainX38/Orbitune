// The Express server. Each `app.get(...)` below is one address ("route") that
// the website can call. `req` is the request coming in, `res` is our reply.
import express from 'express';
import { search, getAudio } from './deezer.js';

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

app.listen(3000, () => console.log('Server running on http://localhost:3000'));
