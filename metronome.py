#metronome.py
# This script creates a simple metronome with a GUI using tkinter and uses pygame for sound playback.

import tkinter as tk
import threading, time
import pygame

pygame.mixer.init()
click = pygame.mixer.Sound("Perc_MetronomeQuartz_lo.wav")

stop_event = threading.Event()
worker = None

def metronome_loop(bpm: int):
    beat = 60.0 / bpm
    next_time = time.perf_counter()
    while not stop_event.is_set():
        click.play()
        next_time += beat
        sleep_for = next_time - time.perf_counter()
        if sleep_for > 0:
            time.sleep(sleep_for)

def start_metronome():
    global worker
    bpm_text = bpm_entry.get().strip()
    try:
        bpm = int(bpm_text)
        if bpm <= 0: raise ValueError
    except ValueError:
        status.config(text="Enter a valid BPM (e.g., 120)")
        return

    if worker and worker.is_alive():
        return

    stop_event.clear()
    status.config(text=f"Running at {bpm} BPM")
    worker = threading.Thread(target=metronome_loop, args=(bpm,), daemon=True)
    worker.start()

def stop_metronome():
    stop_event.set()
    status.config(text="Stopped")

def on_close():
    stop_event.set()
    root.destroy()

root = tk.Tk()
root.title("Metronome")
root.protocol("WM_DELETE_WINDOW", on_close)

tk.Label(root, text="Metronome", font=("Helvetica", 16)).pack(pady=10)
frame = tk.Frame(root); frame.pack(padx=10, pady=5)

tk.Label(frame, text="Enter BPM:").grid(row=0, column=0, sticky="e")
bpm_entry = tk.Entry(frame, width=10); bpm_entry.grid(row=0, column=1, padx=5)

tk.Button(frame, text="Start", command=start_metronome).grid(row=1, column=0, pady=5)
tk.Button(frame, text="Stop", command=stop_metronome).grid(row=1, column=1, pady=5)

status = tk.Label(root, text="Stopped"); status.pack(pady=5)
root.mainloop()
