// The starting point of the website. index.html loads this file, and this file
// starts everything else. (The page's styles are loaded by index.html.)
import { createSongPicker } from './experience/ui/songPicker.js';
import { savePlanetJourney } from './experience/planetJourney.js';
import { savePlanet } from './api/planets.js';
import { createGalaxy } from './ui/galaxy.js';
import { createStarfield } from './ui/starfield.js';
import { withSpectrumPalette } from './world/spectrumPalette.js';

createStarfield();
const galaxy = createGalaxy();

// TEMPORARY: a basic audio player, only here to check that the song picker
// hands over working audio. Remove it once the real experience plays the song.
const player = document.createElement('audio');
player.controls = true; // show the play button and the time bar
player.style.cssText = 'display: block; margin: 0 auto;';
document.querySelector('.sheet').append(player);

const app = document.querySelector('#app');
const journeyStatus = document.createElement('p');
journeyStatus.className = 'planet-journey__status';
journeyStatus.setAttribute('role', 'status');
journeyStatus.hidden = true;

const journeyButton = document.createElement('button');
journeyButton.className = 'planet-journey__button';
journeyButton.type = 'button';
journeyButton.textContent = 'Enter your planet';
journeyButton.hidden = true;

let selectedJourney = null;
let analysisId = 0;

journeyButton.addEventListener('click', async () => {
  if (!selectedJourney) return;
  journeyButton.disabled = true;
  journeyStatus.textContent = 'Opening your planet…';

  try {
    await savePlanetJourney(selectedJourney);
    location.assign('/mvp.html?journey=latest');
  } catch (error) {
    console.error('Could not prepare the planet journey:', error);
    journeyStatus.textContent = 'Could not open the planet. Please try again.';
    journeyButton.disabled = false;
  }
});

// Put the song picker inside the <div id="app"> from index.html.
createSongPicker(app, {
  // Analyse the selected song and keep the returned planet data with its audio.
  async onSongChosen(song) {
    const currentAnalysisId = ++analysisId;
    selectedJourney = null;
    journeyButton.hidden = true;
    journeyButton.disabled = false;
    journeyStatus.hidden = false;
    journeyStatus.textContent = `Analysing "${song.title}"…`;

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
      if (currentAnalysisId !== analysisId) return;
      if (!result.audio) throw new Error('The analyser did not return audio features');
      if (!result.world) throw new Error(result.worldError || 'Gemini did not return a world blueprint');
      // The planet's colours come from the song's spectrum, stored with the features so every view draws the same planet
      result.audio = withSpectrumPalette(result.audio);

      selectedJourney = {
        blob: song.blob,
        audio: result.audio,
        world: result.world,
        title: song.title,
        artist: song.artist,
      };
      // Save to MongoDB in the background; a failed save must not block anything.
      savePlanet({ title: song.title, artist: song.artist, cover: song.cover, deezerId: song.deezerId }, result.audio, result.world)
        .then(({ id }) => {
          console.log('Planet saved');
          // Show the new planet in the galaxy behind the page.
          galaxy.addPlanet({
            id,
            name: result.world.planetName,
            song: { title: song.title, artist: song.artist },
            description: [result.world.mood, result.world.biome].filter(Boolean).join(' · '),
            features: result.audio,
            blueprint: result.world,
          });
        })
        .catch((err) => console.error('Could not save the planet:', err));
      journeyStatus.textContent = `Your planet “${result.world.planetName}” is ready.`;
      journeyButton.hidden = false;
      console.log('Analysis result:', result);
    } catch (err) {
      if (currentAnalysisId !== analysisId) return;
      console.error('Could not analyse the selected song:', err);
      journeyStatus.textContent = err.message || 'Analysis failed. Please choose another song.';
    }
  },
});

app.append(journeyStatus, journeyButton);
