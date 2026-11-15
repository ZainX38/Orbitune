import './songPicker.css';
import { trimToMiddle } from './trimAudio.js';

// Builds the song picker inside `container`.
// `onSongChosen` is a function the rest of the app passes in. The picker will
// call it once the user has picked or uploaded a song
export function createSongPicker(container, { onSongChosen }) {
  container.innerHTML = `
    <section class="song-picker">
      <h2 class="song-picker__heading">Choose a song</h2>
      <input class="song-picker__input" type="search" autocomplete="off"
             placeholder="Search for a song or artist" aria-label="Search for a song" />
      <p class="song-picker__status" role="status">Type at least 2 characters to search.</p>
      <ul class="song-picker__results"></ul>
      <p class="song-picker__divider">or</p>
      <button class="song-picker__upload" type="button">Upload a song from your device</button>
      <input class="song-picker__file" type="file" accept="audio/*" hidden />
    </section>
  `;

  // Grab the elements we need to read from or change later.
  const input = container.querySelector('.song-picker__input');
  const status = container.querySelector('.song-picker__status');
  const results = container.querySelector('.song-picker__results');
  const uploadButton = container.querySelector('.song-picker__upload'); 
  const fileInput = container.querySelector('.song-picker__file');      

  // Clears the results list and draws one row per song.
  // Song titles come from Deezer, so we set them with textContent, never
  // innerHTML. textContent always treats them as plain text, so a title that
  // happened to contain HTML or a script could not run on our page.
  function renderResults(songs) {
    results.replaceChildren(); // called with nothing, this empties the list

    for (const song of songs) {
      const cover = document.createElement('img');
      cover.className = 'song-picker__cover';
      cover.alt = ''; // the cover is decoration, so screen readers should skip it
      if (song.cover) cover.src = song.cover;

      const title = document.createElement('span');
      title.className = 'song-picker__title';
      title.textContent = song.title;

      const artist = document.createElement('span');
      artist.className = 'song-picker__artist';
      artist.textContent = song.artist;

      const text = document.createElement('span');
      text.className = 'song-picker__text';
      text.append(title, artist);

      // Each row is a real <button>, so it can be reached with the Tab key
      // and pressed with Enter without us writing any extra code.
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'song-picker__row';
      button.append(cover, text);
      button.addEventListener('click', () => chooseSong(song));

      const item = document.createElement('li');
      item.append(button);
      results.append(item);
    }
  }

  // Sets the message under the search box and redraws the list.
  // Leaving out `songs` clears the list.
  function show(message, songs = []) {
    status.textContent = message;
    renderResults(songs);
  }

  function showSongs(songs) {
    if (songs.length) show('', songs);
    else show('No songs found.');
  }

  // ---- Picking a search result ----

  // True while a song is downloading, so a double click does not fetch it twice.
  let loadingSong = false;

  // Downloads the song's 30-second MP3 from server and hands it to the app.
  async function chooseSong(song) {
    if (loadingSong) return;
    loadingSong = true;
    status.textContent = `Loading "${song.title}"…`;

    try {
      const res = await fetch(`/audio/${song.id}`);
      if (!res.ok) throw new Error(`Audio failed with status ${res.status}`);

      // A Blob is a chunk of raw file data held in the browser's memory.
      // Here it is the MP3 itself.
      const blob = await res.blob();

      status.textContent = `Selected: ${song.title} by ${song.artist}`;

      onSongChosen({
        source: 'deezer',
        title: song.title,
        artist: song.artist,
        cover: song.cover,
        deezerId: song.id,
        blob,
      });
    } catch {
      status.textContent = 'Could not load that song. Try another one.';
    } finally {
      // `finally` runs whether the download worked or failed, so the picker
      // never gets stuck refusing clicks.
      loadingSong = false;
    }
  }

  // ---- Live search ----
  // Sending a request on every key press would be wasteful and could hit
  // Deezer's rate limit. So we "debounce": wait until the user has stopped
  // typing for a quarter of a second, then search once.

  let timer;      // the countdown that is waiting for the user to pause
  let controller; // lets us cancel a request that has already been sent

  // Searches we have already done, stored as text → songs. When the user
  // deletes a character we can show the earlier results without a new request.
  const cache = new Map();

  // The 'input' event fires on every change to the box: typing, deleting, pasting.
  input.addEventListener('input', () => {
    const q = input.value.trim().toLowerCase();

    // The text changed, so anything still in progress is for old text. Stop
    // the countdown and cancel the request. Without the cancel, a slow reply
    // for "daf" could arrive late and replace the results for "daft punk".
    // (`?.` means "only do this if controller exists", as it is empty at first.)
    clearTimeout(timer);
    controller?.abort();

    if (q.length < 2) return show('Type at least 2 characters to search.');
    if (cache.has(q)) return showSongs(cache.get(q));

    // Only the message changes here. The old results stay on screen until the
    // new ones arrive, so the list does not flicker while the user types.
    status.textContent = 'Searching…';

    timer = setTimeout(async () => {
      controller = new AbortController();
      try {
        // encodeURIComponent makes the text safe to put in a URL
        // (for example, a space becomes %20 and & becomes %26).
        const res = await fetch(`/search?q=${encodeURIComponent(q)}`, { signal: controller.signal });

        // fetch only fails by itself when the network is down. A reply like
        // "502 error" still counts as a reply, so we have to check for it.
        if (!res.ok) throw new Error(`Search failed with status ${res.status}`);

        const songs = await res.json();
        cache.set(q, songs);
        showSongs(songs);
      } catch (err) {
        // Cancelling a request makes fetch throw an 'AbortError'. We caused
        // that on purpose, so it is not a real failure and we ignore it.
        if (err.name === 'AbortError') return;
        show('Search failed. Check your connection and try again.');
      }
    }, 250);
  });

  // ---- Uploading a song ----

  const MAX_UPLOAD_BYTES = 15 * 1024 * 1024; // 15 MB

  // The real file input is hidden because browsers style it badly and it
  // cannot be restyled much. Our own button opens it instead.
  uploadButton.addEventListener('click', () => fileInput.click());

  // 'change' fires once the user has picked a file in the dialog.
  fileInput.addEventListener('change', async () => {
    const file = fileInput.files[0];

    // Clear the input, otherwise picking the same file twice in a row would
    // not fire 'change' the second time. `file` is still usable after this.
    fileInput.value = '';

    if (!file) return; // the user closed the dialog without choosing

    // The dialog only suggests audio files. The user can still switch it to
    // "All files", so we have to check for ourselves.
    if (!file.type.startsWith('audio/')) {
      status.textContent = 'That is not an audio file. Choose an MP3 or similar.';
      return;
    }
    if (file.size > MAX_UPLOAD_BYTES) {
      status.textContent = 'That file is too big. The limit is 15 MB.';
      return;
    }

    // "My Song.mp3" becomes "My Song".
    const title = file.name.replace(/\.[^.]+$/, '');
    status.textContent = `Preparing "${title}"…`;

    try {
      // Keep only the middle 30 seconds, so an upload is the same length as
      // a Deezer preview.
      const blob = await trimToMiddle(file);
      status.textContent = `Selected: ${title}`;

      // An upload has no artist or cover art.
      onSongChosen({ source: 'upload', title, artist: '', cover: null, blob });
    } catch {
      // Decoding fails if the file is damaged or in a format the browser
      // cannot play.
      status.textContent = 'Could not read that audio file. Try a different one.';
    }
  });
}
