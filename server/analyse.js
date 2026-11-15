// Bridges the Express server to the Python analyser.
// It writes each uploaded audio file to a temporary folder, runs analyse.py,
// reads its combined JSON result, then removes the temporary file.

import { execFile as execFileCallback } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

const execFile = promisify(execFileCallback);

const here = path.dirname(fileURLToPath(import.meta.url));
const analyser = path.join(here, 'analyse.py');

// `py` works on your Windows installation. Override it if needed:
// $env:ORBITUNE_PYTHON = 'C:\path\to\python.exe'
const python = process.env.ORBITUNE_PYTHON || 'py';

export async function analyseAudio(bytes) {
  if (!Buffer.isBuffer(bytes) || bytes.length === 0) {
    throw new Error('No audio was supplied');
  }

  const directory = await mkdtemp(path.join(tmpdir(), 'orbitune-'));
  const audioPath = path.join(directory, 'song.audio');

  try {
    await writeFile(audioPath, bytes);

    const { stdout } = await execFile(
      python,
      [analyser, '--json', audioPath],
      { maxBuffer: 2 * 1024 * 1024 },
    );

    return JSON.parse(stdout);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}