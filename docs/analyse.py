import json
from typing import Literal
import colorsys
import librosa
import numpy as np
from dotenv import load_dotenv
from google import genai
from pydantic import BaseModel
from scipy.signal import find_peaks

load_dotenv()
client = genai.Client()

NOTES = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"]


############################## the JSON format your teammate needs

SectionType = Literal["intro", "verse", "chorus", "drop", "bridge", "outro"]

class Palette(BaseModel):
    ground: str
    peaks: str
    sky: str
    fog: str

class Section(BaseModel):
    type: SectionType
    start: int
    end: int

class Landmark(BaseModel):
    name: str
    section: SectionType
    kind: str
    lore: str

class World(BaseModel):
    planetName: str
    mood: str
    biome: str
    palette: Palette
    flora: list[str]
    sections: list[Section]
    landmarks: list[Landmark]
    ambiencePrompts: list[str]
    narratorStyle: str


############################## audio analysis

def find_sections(y, sr, n_sections=6):
    chroma = librosa.feature.chroma_cqt(y=y, sr=sr)
    bounds = librosa.segment.agglomerative(chroma, n_sections)
    times = list(librosa.frames_to_time(bounds, sr=sr)) + [librosa.get_duration(y=y, sr=sr)]
    rms = librosa.feature.rms(y=y)[0]

    sections = []
    for i in range(len(times) - 1):
        a, b = librosa.time_to_frames([times[i], times[i + 1]], sr=sr)
        sections.append({
            "start": round(float(times[i])),
            "end": round(float(times[i + 1])),
            "energy": round(float(rms[a:b].mean()), 4),
        })
    return sections


def analyse_audio(path):
    y, sr = librosa.load(path)
    tempo, _ = librosa.beat.beat_track(y=y, sr=sr)
    chroma = librosa.feature.chroma_stft(y=y, sr=sr).mean(axis=1)

    return {
        "tempo_bpm": round(float(np.atleast_1d(tempo)[0]), 1),
        "energy": round(float(librosa.feature.rms(y=y).mean()), 4),
        "brightness_hz": round(float(librosa.feature.spectral_centroid(y=y, sr=sr).mean())),
        "noisiness": round(float(librosa.feature.zero_crossing_rate(y).mean()), 4),
        "dominant_note": NOTES[int(chroma.argmax())],
        "sections": find_sections(y, sr),
    }

N_FRAMES = 512


def squash(values, n=N_FRAMES):
    """Resample any array to exactly n points, rounded to 2 decimals."""
    old = np.linspace(0, 1, len(values))
    new = np.linspace(0, 1, n)
    return [round(float(v), 2) for v in np.interp(new, old, values)]


def get_audio_data(path):
    y, sr = librosa.load(path)

    # tempo and beat times
    tempo, beat_frames = librosa.beat.beat_track(y=y, sr=sr)
    beats = librosa.frames_to_time(beat_frames, sr=sr)

    # bass / mid / treble over time, each scaled 0 to 1
    mel = librosa.feature.melspectrogram(y=y, sr=sr, n_mels=128)
    mel = (librosa.power_to_db(mel, ref=np.max) + 80) / 80
    freqs = librosa.mel_frequencies(n_mels=128, fmax=sr / 2)
    bass = mel[freqs < 250].mean(axis=0)
    mid = mel[(freqs >= 250) & (freqs < 4000)].mean(axis=0)
    treble = mel[freqs >= 4000].mean(axis=0)

    # loudness over time, 0 to 1
    rms = librosa.feature.rms(y=y)[0]
    loudness = rms / rms.max()

    # the 3 strongest frequencies in the whole song
    spectrum = np.abs(librosa.stft(y)).mean(axis=1)
    fft_freqs = librosa.fft_frequencies(sr=sr)
    idx, _ = find_peaks(spectrum, distance=10)
    idx = [i for i in idx if fft_freqs[i] >= 40]
    top = sorted(idx, key=lambda i: spectrum[i], reverse=True)[:3]
    peaks = [
        {"hz": round(float(fft_freqs[i])),
         "strength": round(float(spectrum[i] / spectrum[top[0]]), 2)}
        for i in top
    ]

    # atmosphere colour: note -> hue, loudness -> saturation, treble -> brightness
    chroma = librosa.feature.chroma_stft(y=y, sr=sr).mean(axis=1)
    hue = int(chroma.argmax()) / 12
    sat = 0.35 + 0.45 * float(loudness.mean())
    val = 0.55 + 0.40 * float(treble.mean())
    r, g, b = colorsys.hsv_to_rgb(hue, sat, val)
    atmosphere = "#{:02x}{:02x}{:02x}".format(int(r * 255), int(g * 255), int(b * 255))

    return {
        "duration": round(float(librosa.get_duration(y=y, sr=sr)), 1),
        "bpm": round(float(np.atleast_1d(tempo)[0])),
        "frames": N_FRAMES,
        "bass": squash(bass),
        "mid": squash(mid),
        "treble": squash(treble),
        "loudness": squash(loudness),
        "beats": [round(float(t), 2) for t in beats],
        "peaks": peaks,
        "atmosphere": atmosphere,
    }
############################## Gemini API

def generate_world(path):
    features = analyse_audio(path)

    prompt = f"""You are designing a planet that represents a song.

Audio analysis:
{features}

Rules:
- sections: use the sections from the analysis. Copy each start and end exactly.
  Choose each type from its energy: the highest energy is "drop" or "chorus",
  lower energy is "verse", "intro", "bridge" or "outro".
- landmarks: one per chorus or drop. "section" must match that section's type.
  "kind" is a terrain feature (mountain range, canyon, crater...).
  "lore" is two short, atmospheric sentences.
- palette: four hex colours like "#2b2f45" that fit the mood. Darker and warmer
  for low brightness, lighter and cooler for high brightness.
- flora: 2 to 3 invented plants. ambiencePrompts: 2 to 3 short sound descriptions.
- narratorStyle: one line describing a storyteller's voice.
Make everything consistent with the music."""

    response = client.models.generate_content(
        model="gemini-3.5-flash",
        contents=prompt,
        config={
            "response_mime_type": "application/json",
            "response_schema": World,
        },
    )
    return response.parsed.model_dump()


############################## test it by running: py analyse.py

if __name__ == "__main__":
    world = generate_world("song.mp3")
    audio = get_audio_data("song.mp3")

    with open("world.json", "w") as f:
        json.dump(world, f, indent=2)
    with open("audio.json", "w") as f:
        json.dump(audio, f, indent=2)

    print(json.dumps(world, indent=2))
    print(json.dumps(audio, indent=2))
    print("Saved world.json and audio.json") 

#new