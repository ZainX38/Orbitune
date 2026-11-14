import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

const API = 'https://api.deezer.com';
const CACHE_DIR = path.join(import.meta.dirname, 'cache');
const searchCache = new Map();

// Find songs matching the text the user typed.
export async function search(q) {
  const key = q.toLowerCase();
  if (searchCache.has(key)) return searchCache.get(key);

  const res = await fetch(`${API}/search?q=${encodeURIComponent(q)}&limit=10`);
  const body = await res.json();
  if (!body.data) throw new Error('Deezer search failed');

  const songs = body.data.filter((t) => t.preview).map((t) => ({
    id: t.id,
    title: t.title,
    artist: t.artist.name,
    cover: t.album.cover_medium,
    preview: t.preview,
  }));
  searchCache.set(key, songs);
  return songs;
}

// Get the 30-second MP3 for one track, from disk if we already have it.
export async function getAudio(id) {
  const file = path.join(CACHE_DIR, `${id}.mp3`);
  try {
    return await readFile(file);
  } catch {
    
  }

  const track = await (await fetch(`${API}/track/${id}`)).json();
  if (!track.preview) throw new Error('No preview for this track');

  const mp3 = await fetch(track.preview);
  if (!mp3.ok) throw new Error('Preview download failed');

  const bytes = Buffer.from(await mp3.arrayBuffer());
  await mkdir(CACHE_DIR, { recursive: true });
  await writeFile(file, bytes);
  return bytes;
}
