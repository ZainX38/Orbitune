// Cuts an audio file down to the 30 seconds in the middle of the song.
// The middle usually has the chorus, so songs are easier to tell apart than
// they would be from their intros.

const CLIP_SECONDS = 30;

// Takes any audio file the browser can play and returns a 30-second WAV Blob.
// Songs shorter than 30 seconds are returned whole (still as a WAV).
export async function trimToMiddle(blob) {
  // An AudioContext is the browser's audio engine. We only need it to decode.
  const context = new AudioContext();
  try {
    // Decoding turns the compressed file (MP3 etc.) into raw samples:
    // one number per channel for every tiny slice of time.
    const audio = await context.decodeAudioData(await blob.arrayBuffer());

    // sampleRate is how many samples make up one second (usually 44100 or 48000).
    const clipLength = Math.min(audio.length, CLIP_SECONDS * audio.sampleRate);
    const start = Math.floor((audio.length - clipLength) / 2);

    // Copy the same middle section out of each channel (left and right).
    const channels = [];
    for (let c = 0; c < Math.min(audio.numberOfChannels, 2); c++) {
      channels.push(audio.getChannelData(c).subarray(start, start + clipLength));
    }
    return encodeWav(channels, audio.sampleRate);
  } finally {
    context.close();
  }
}

// Browsers can decode MP3 but cannot create one, so the clip is saved as WAV.
// A WAV file is a 44-byte header describing the audio, followed by the samples.
function encodeWav(channels, sampleRate) {
  const numChannels = channels.length;
  const numFrames = channels[0].length;
  const dataSize = numFrames * numChannels * 2; // 2 bytes per sample
  const buffer = new ArrayBuffer(44 + dataSize);
  const view = new DataView(buffer);

  const writeText = (offset, text) => {
    for (let i = 0; i < text.length; i++) view.setUint8(offset + i, text.charCodeAt(i));
  };

  // The header. The layout is fixed by the WAV format.
  writeText(0, 'RIFF');
  view.setUint32(4, 36 + dataSize, true);
  writeText(8, 'WAVE');
  writeText(12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);                            // 1 = uncompressed
  view.setUint16(22, numChannels, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * numChannels * 2, true); // bytes per second
  view.setUint16(32, numChannels * 2, true);              // bytes per time step
  view.setUint16(34, 16, true);                           // bits per sample
  writeText(36, 'data');
  view.setUint32(40, dataSize, true);

  // The samples. The browser stores each one as a decimal from -1 to 1, and
  // WAV wants whole numbers from -32768 to 32767, so we scale them up.
  let offset = 44;
  for (let i = 0; i < numFrames; i++) {
    for (let c = 0; c < numChannels; c++) {
      const sample = Math.max(-1, Math.min(1, channels[c][i]));
      view.setInt16(offset, sample < 0 ? sample * 0x8000 : sample * 0x7fff, true);
      offset += 2;
    }
  }
  return new Blob([buffer], { type: 'audio/wav' });
}
