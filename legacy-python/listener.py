# listener.py
# This script listens to the microphone input and detects hits based on volume threshold.

import time
import numpy as np
import sounddevice as sd

THRESHOLD = 0.15      # Raise this if it detects too much noise
COOLDOWN = 0.15       # Seconds to wait before allowing another hit
SAMPLERATE = 44100
BLOCKSIZE = 1024

# Global variable to track the last time a hit was detected
last_hit_time = 0.0

def audio_callback(indata, frames, time_info, status):
    global last_hit_time

    if status:
        print(status)

    # indata is a NumPy array from the microphone input stream
    volume = np.max(np.abs(indata))

    now = time.perf_counter()

    if volume > THRESHOLD and (now - last_hit_time) > COOLDOWN:
        print(f"Hit detected at {now:.3f}s | volume={volume:.3f}")
        last_hit_time = now

if __name__ == "main":
    print("Listening... Tap on your desk or pad. Press Ctrl+C to stop.")

    try:
        with sd.InputStream(
            callback=audio_callback,
            channels=1,
            samplerate=SAMPLERATE,
            blocksize=BLOCKSIZE
        ):
            while True:
                time.sleep(0.1)
    except KeyboardInterrupt:
        print("\nStopped.")