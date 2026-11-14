// The starting point of the website. index.html loads this file, and this file
// starts everything else.
import './style.css';
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
  onSongChosen(song) {
    console.log('Song chosen:', song);

    // An <audio> element needs a URL, but the song is a Blob in memory.
    // createObjectURL makes a temporary URL that points at the Blob.
    // revokeObjectURL frees the previous song, so memory does not fill up
    // as the user tries song after song.
    URL.revokeObjectURL(player.src);
    player.src = URL.createObjectURL(song.blob);
    player.play();
  },
});