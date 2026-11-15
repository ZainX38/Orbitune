// The starting point of the website. index.html loads this file, and this file
// starts everything else. (The page's styles are loaded by index.html.)
import { createSongPicker } from './experience/ui/songPicker.js';

// TEMPORARY: a basic audio player, only here to check that the song picker
// hands over working audio. Remove it once the real experience plays the song.
const player = document.createElement('audio');
player.controls = true; // show the play button and the time bar
player.style.cssText = 'display: block; margin: 0 auto;';
document.body.append(player);

// Put the song picker inside the <div id="app"> from index.html.
createSongPicker(document.querySelector('#app'), {
  // Runs when the user has chosen a song.
  // Later this is where the song gets handed to the audio analysis and /analyse.
  async onSongChosen(song) {
    console.log('Song chosen:', song);

    // An <audio> element needs a URL, but the song is a Blob in memory.
    // createObjectURL makes a temporary URL that points at the Blob.
    // revokeObjectURL frees the previous song, so memory does not fill up
    // as the user tries song after song.
    URL.revokeObjectURL(player.src);
    player.src = URL.createObjectURL(song.blob);
    player.play();

    // Send the song to the server to be analysed. FormData is how a browser
    // sends a file. The name 'audio' must match upload.single('audio') in
    // server/index.js. The file name only matters for its ending, which tells
    // the server whether this is an MP3 (Deezer) or a WAV (upload).
    const form = new FormData();
    const filename = song.blob.type === 'audio/wav' ? 'song.wav' : 'song.mp3';
    form.append('audio', song.blob, filename);

    try {
      const res = await fetch('/analyse', { method: 'POST', body: form });
      if (!res.ok) throw new Error(`Analysis failed with status ${res.status}`);

      // result.audio is the AudioFeatures data (bass, mid, treble, beats...).
      // result.world is the Blueprint from Gemini, or null if Gemini failed,
      // in which case result.worldError says why.
      const result = await res.json();
      console.log('Analysis result:', result);
    } catch (err) {
      console.error(err);
    }
  },
});