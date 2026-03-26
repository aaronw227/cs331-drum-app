# beat_track.py
# This script analyzes an audio file to detect its tempo and beat positions using the librosa library.

import librosa
file_input = input("Enter the path to the audio file: ")
filename = file_input.strip()
y, sr = librosa.load(filename)
tempo, beats = librosa.beat.beat_track(y=y, sr=sr)

print(f'Tempo: {tempo} BPM')
print(f'Beats: {beats}')