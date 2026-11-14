// The starting point of the website. index.html loads this file, and this file
// starts everything else.
import './style.css';
import { createSongPicker } from './experience/ui/songPicker.js';

// Put the song picker inside the <div id="app"> from index.html.
createSongPicker(document.querySelector('#app'), {
  // Runs when the user has chosen a song.
  // Later this is where the song gets handed to the audio analysis and /analyse.
  onSongChosen(song) {
    console.log('Song chosen:', song);
  },
});
