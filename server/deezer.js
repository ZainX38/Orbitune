// Everything that talks to Deezer lives here.
// The website cannot call Deezer directly because Deezer blocks requests that
// come from other sites' pages, so the server makes the calls for it.
// Deezer's API is free and needs no key.
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

const API = 'https://api.deezer.com';

// The folder where downloaded MP3s are saved: server/cache.
// import.meta.dirname is the folder this file is in.
const CACHE_DIR = path.join(import.meta.dirname, 'cache');

// Searches already done, stored as text → songs. Every visitor's search goes
// to Deezer from this one server, and Deezer allows about 50 requests per
// 5 seconds, so repeated searches are answered from here instead.
// It lives in memory, so it is emptied whenever the server restarts.
const searchCache = new Map();

// Returns up to 10 songs matching the text the user typed.
export async function search(q) {
  const key = q.toLowerCase(); // so "Adele" and "adele" share one cache entry
  if (searchCache.has(key)) return searchCache.get(key);

  // encodeURIComponent makes the text safe to put in a URL.
  const res = await fetch(`${API}/search?q=${encodeURIComponent(q)}&limit=10`);
  const body = await res.json();

  // When something goes wrong (for example, too many requests), Deezer still
  // replies "200 OK" but sends { error: ... } with no `data` list.
  if (!body.data) throw new Error('Deezer search failed');

  // Deezer sends dozens of fields per track. Keep only the five the website
  // needs, and drop tracks with no preview clip, since those cannot be played.
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

// Returns the 30-second MP3 for one track, as raw bytes.
// Each MP3 is saved to disk the first time, so afterwards it loads without
// the internet. That is what lets the demo songs work offline.
export async function getAudio(id) {
  const file = path.join(CACHE_DIR, `${id}.mp3`);

  try {
    return await readFile(file);
  } catch {
  }

  // Preview links stop working after about 15 minutes, so the link from an
  // earlier search may be dead. Ask Deezer for the track again to get a fresh one.
  const track = await (await fetch(`${API}/track/${id}`)).json();
  if (!track.preview) throw new Error('No preview for this track');

  const mp3 = await fetch(track.preview);
  if (!mp3.ok) throw new Error('Preview download failed');

  const bytes = Buffer.from(await mp3.arrayBuffer());

  // `recursive: true` creates the cache folder if it is missing and does
  // nothing if it already exists.
  await mkdir(CACHE_DIR, { recursive: true });
  await writeFile(file, bytes);
  return bytes;
}
