import { execFile as execFileCallback } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

const execFile = promisify(execFileCallback);
const here = path.dirname(fileURLToPath(import.meta.url));
const analyser = path.join(here, 'analyse.py');
const python = process.env.ORBITUNE_PYTHON || (process.platform === 'win32' ? 'py' : 'python3');
const pythonEnv = {
  ...process.env,
  PYTHONPATH: [path.join(here, 'Lib', 'site-packages'), process.env.PYTHONPATH]
    .filter(Boolean)
    .join(path.delimiter),
};

export async function analyseAudio(bytes, extension = '.mp3') {
  if (!Buffer.isBuffer(bytes) || bytes.length === 0) {
    throw new Error('No audio was supplied');
  }
  if (!['.mp3', '.wav'].includes(extension)) {
    throw new Error('Unsupported audio format');
  }

  const directory = await mkdtemp(path.join(tmpdir(), 'orbitune-'));
  const audioPath = path.join(directory, `song${extension}`);

  try {
    await writeFile(audioPath, bytes);

    const { stdout } = await execFile(
      python,
      [analyser, '--json', audioPath],
      { maxBuffer: 2 * 1024 * 1024, timeout: 300000, env: pythonEnv },
    );

    return JSON.parse(stdout);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}