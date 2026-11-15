// The /planets routes: analysed planets saved in MongoDB.
//
//   POST /planets                  { song, features, blueprint } -> { id }
//   GET  /planets                  newest first, summaries only (no features / blueprint)
//   GET  /planets?full=1&limit=8   newest first, WITH features and blueprint (for drawing the real planets)
//   GET  /planets/:id              { id, song, features, blueprint }
//
// Settings come from server/.env: MONGODB_URI and MONGODB_DB.
import express from 'express';
import { MongoClient, ObjectId } from 'mongodb';

try {
  process.loadEnvFile(new URL('./.env', import.meta.url));
} catch {
  // No .env file: use the environment as it is.
}

let collectionPromise = null;
function planets() {
  if (!collectionPromise) {
    if (!process.env.MONGODB_URI) throw new Error('MONGODB_URI is not set');
    collectionPromise = new MongoClient(process.env.MONGODB_URI)
      .connect()
      .then((client) => client.db(process.env.MONGODB_DB || 'orbitune').collection('planets'))
      .catch((err) => {
        collectionPromise = null; // try again on the next request
        throw err;
      });
  }
  return collectionPromise;
}

// What the start page needs to describe a planet without drawing it.
function summary(doc) {
  const b = doc.blueprint ?? {};
  return {
    id: String(doc._id),
    name: b.planetName ?? 'Unnamed planet',
    song: doc.song ?? {},
    description: [b.mood, b.biome].filter(Boolean).join(' · '),
    // The song spectrum palette (stored with the features) first; Gemini's palette only for older planets
    palette: doc.features?.spectrumPalette ?? b.palette ?? null,
    createdAt: doc.createdAt,
  };
}

const SUMMARY_PROJECTION = Object.fromEntries(
  ['bass', 'mid', 'treble', 'loudness', 'beats', 'peaks', 'spectrum'].map((key) => [`features.${key}`, 0]),
);

export const planetsRouter = express.Router();
planetsRouter.use(express.json({ limit: '20mb' })); // features hold per-frame arrays

planetsRouter.post('/', async (req, res) => {
  const { song, features, blueprint } = req.body ?? {};
  if (!features || !blueprint) return res.status(400).json({ error: 'features and blueprint are required' });
  const s = song ?? {};
  try {
    const { insertedId } = await (await planets()).insertOne({
      song: { title: s.title ?? '', artist: s.artist ?? '', cover: s.cover ?? null, deezerId: s.deezerId ?? null },
      features,
      blueprint,
      createdAt: new Date(),
    });
    res.status(201).json({ id: String(insertedId) });
  } catch (err) {
    console.error(err);
    res.status(502).json({ error: 'Could not save the planet' });
  }
});

planetsRouter.get('/', async (req, res) => {
  const full = req.query.full === '1';
  const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || (full ? 8 : 50), 1), full ? 20 : 200);
  try {
    const docs = await (await planets())
      // Summaries skip the big per-frame arrays but keep features.spectrumPalette
      .find({}, full ? {} : { projection: SUMMARY_PROJECTION })
      .sort({ createdAt: -1, _id: -1 })
      .limit(limit)
      .toArray();
    res.json(docs.map((d) => (full ? { ...summary(d), features: d.features, blueprint: d.blueprint } : summary(d))));
  } catch (err) {
    console.error(err);
    res.status(502).json({ error: 'Could not load planets' });
  }
});

planetsRouter.get('/:id', async (req, res) => {
  if (!ObjectId.isValid(req.params.id)) return res.status(400).json({ error: 'Bad planet id' });
  try {
    const doc = await (await planets()).findOne({ _id: new ObjectId(req.params.id) });
    if (!doc) return res.status(404).json({ error: 'Planet not found' });
    res.json({ id: String(doc._id), song: doc.song, features: doc.features, blueprint: doc.blueprint });
  } catch (err) {
    console.error(err);
    res.status(502).json({ error: 'Could not load the planet' });
  }
});
