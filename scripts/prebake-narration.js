import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const [worldFile, songIdArg, serverUrlArg] = process.argv.slice(2);
if (!worldFile || !songIdArg) {
  console.error('Usage: node scripts/prebake-narration.js <world.json> <songId> [serverUrl]');
  process.exitCode = 1;
} else {
  const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
  const cacheSegment = (value) => String(value ?? '').normalize('NFKD').replace(/[\u0300-\u036f]/g, '')
    .toLowerCase().replace(/[^a-z0-9_-]+/g, '-').replace(/^-|-$/g, '') || 'unknown';
  const songId = cacheSegment(songIdArg);
  const serverUrl = serverUrlArg ?? 'http://localhost:3000';

  try {
    const parsed = JSON.parse(await readFile(path.resolve(worldFile), 'utf8'));
    const world = parsed.world ?? parsed;
    if (!Array.isArray(world.landmarks)) throw new Error('World JSON must contain a landmarks array');

    const outputDir = path.join(root, 'client', 'public', 'cache', songId);
    await mkdir(outputDir, { recursive: true });

    for (const [index, landmark] of world.landmarks.entries()) {
      const name = typeof landmark.name === 'string' ? landmark.name.trim() : '';
      const lore = typeof landmark.lore === 'string' ? landmark.lore.trim() : '';
      if (!name || !lore) throw new Error(`Landmark ${index} must have a name and non-empty lore`);
      const id = `${landmark.section || 'landmark'}-${cacheSegment(name)}`;
      const response = await fetch(new URL('/narrate', serverUrl), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: `${name}. ${lore}`, style: world.narratorStyle }),
      });
      if (!response.ok) {
        const detail = await response.text();
        throw new Error(`Narration for ${id} failed (${response.status}): ${detail}`);
      }

      const audio = Buffer.from(await response.arrayBuffer());
      await writeFile(path.join(outputDir, `narration_${id}.mp3`), audio);
      console.log(`Saved ${path.join('cache', songId, `narration_${id}.mp3`)}`);
    }
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
