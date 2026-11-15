# Improvements

Ideas for adding more value to Orbitune: less generic, more novel, and inclusive for everyone regardless of age.

## Where the novelty is

The most novel thing already in the project is in `client/src/experience/songPosition.js`: **your position plays the song**. "AI turns a song into a planet" is the generic part; lots of visualisers and AI demos do a version of it. The value should be built around the walking-through-the-song mechanic, not around more generated content.

## Directions (strongest first)

### 1. The planet as a place for memories

Everyone has a song that means something, whatever their age, so make the planet personal.

- **Pins:** at any spot (which is a moment in the song) you can leave a short voice note or line of text: "this was our wedding song", "Dad played this in the car".
- **Family solar system:** share the planet with a link; others walk it, hear your notes where you left them, and add their own.
- **Why it's novel:** the gallery becomes a family's or friend group's shared collection, with a grandparent's 1960s song orbiting next to a child's favourite. A generator can't produce that, and it gives people a reason to come back.

### 2. The planet as an instrument

Walking already scrubs the song in time with the beat, so push it further.

- **Layers by latitude:** split the song into layers (percussive and harmonic is easy with `librosa`), so north is melody, south is rhythm, and the equator is the full mix.
- **Your path is a remix:** record the walk and replay or share it as a glowing trail.
- **Why it works for all ages:** a five-year-old wandering randomly still makes something that sounds good, and a musician can play it deliberately.

### 3. The world explains the music

Add a "why does my planet look like this?" lens: stand on a mountain range and it tells you this is the chorus, and that the continents come from the bass. People learn song structure by walking it, without any reading or theory.

## Inclusive baseline

Whichever direction is chosen, these should be built in as the default.

- **No-skill controls:** a one-button "take me on the tour" mode that auto-walks landmark to landmark. Click-to-walk already exists, so this is a small step, and WASD plus mouse-look excludes young kids and many older people.
- **Hearing:** captions for all narration and vibration on beats (phones and gamepads support it). The planet is already a visual translation of the song; say so explicitly.
- **Sight:** all lore narrated, with a sound beacon that gets louder as you face a landmark, so the surface is navigable by ear.
- **Comfort:** a calm mode that softens beat flashes and slows the camera, for photosensitivity and motion sickness. It should switch on automatically when the device asks for reduced motion.
- **Content:** tell Gemini to keep lore suitable for all ages regardless of the song's lyrics.

## Recommendation

Direction 1 as the identity: "every song is a world, and you can leave your memories in it", with the tour mode and captions from the baseline.

- It is the most emotionally distinct and the cheapest to build: pins are just a position plus a recording, saved alongside the cached planet.
- Direction 2 is the better "wow" in a live demo but needs more audio work.

**Open decision:** which direction is the core: memories, instrument, or a mix?
