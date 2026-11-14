import './songPicker.css';

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

  const input = container.querySelector('.song-picker__input');
  const status = container.querySelector('.song-picker__status');
  const results = container.querySelector('.song-picker__results');
  const uploadButton = container.querySelector('.song-picker__upload');
  const fileInput = container.querySelector('.song-picker__file');

  // Draws one row per song. Uses textContent so song titles can never run as HTML.
  function renderResults(songs) {
    results.replaceChildren();
    for (const song of songs) {
      const cover = document.createElement('img');
      cover.className = 'song-picker__cover';
      cover.alt = '';
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

      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'song-picker__row';
      button.append(cover, text);

      const item = document.createElement('li');
      item.append(button);
      results.append(item);
    }
  }

  // TEMPORARY: fake songs to see what the UI looks like. Remove this when you implement the search feature.
  renderResults([
    { id: 1, title: 'Example Song', artist: 'Example Artist', cover: '' },
    { id: 2, title: 'Another Song With A Much Longer Title', artist: 'Someone Else', cover: '' },
  ]);

}