import './style.css';
import { createSongPicker } from './experience/ui/songPicker.js';

createSongPicker(document.querySelector('#app'), {
  onSongChosen(song) {
    console.log('Song chosen:', song);
  },
});