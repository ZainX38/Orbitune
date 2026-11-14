import express from 'express';
import { search, getAudio } from './deezer.js';

const app = express();

app.get('/search', async (req, res) => {
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
  if (!/^\d+$/.test(id)) return res.status(400).json({ error: 'Bad track id' });
  try {
    res.type('audio/mpeg').send(await getAudio(id));
  } catch (err) {
    console.error(err);
    res.status(502).json({ error: 'Could not load audio' });
  }
});

app.listen(3000, () => console.log('Server running on http://localhost:3000'));