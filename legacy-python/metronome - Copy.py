# metronome.py
# Metronome GUI using customtkinter for a modern dark-mode look.
# Install dependency: pip install customtkinter pygame

import customtkinter as ctk
import threading, time
import pygame

# --- Audio setup ---
pygame.mixer.init()
click = pygame.mixer.Sound("Perc_MetronomeQuartz_lo.wav")

# --- App theme ---
ctk.set_appearance_mode("dark")
ctk.set_default_color_theme("blue")

stop_event = threading.Event()
worker = None

# --- Metronome logic ---
def metronome_loop(bpm: int):
    beat = 60.0 / bpm
    next_time = time.perf_counter()
    while not stop_event.is_set():
        click.play()
        flash_beat()
        next_time += beat
        sleep_for = next_time - time.perf_counter()
        if sleep_for > 0:
            time.sleep(sleep_for)

def flash_beat():
    """Briefly highlight the beat indicator."""
    beat_canvas.configure(fg_color="#4FC3F7")
    root.after(80, lambda: beat_canvas.configure(fg_color="#1e2a38"))

def start_metronome():
    global worker
    bpm_text = bpm_entry.get().strip()
    try:
        bpm = int(bpm_text)
        if not (20 <= bpm <= 300):
            raise ValueError
    except ValueError:
        status_label.configure(text="Enter a BPM between 20 and 300", text_color="#EF9A9A")
        return

    if worker and worker.is_alive():
        return

    stop_event.clear()
    status_label.configure(text=f"♩ {bpm} BPM", text_color="#A5D6A7")
    start_btn.configure(state="disabled", fg_color="#1e2a38")
    stop_btn.configure(state="normal", fg_color="#4FC3F7")

    worker = threading.Thread(target=metronome_loop, args=(bpm,), daemon=True)
    worker.start()

def stop_metronome():
    stop_event.set()
    status_label.configure(text="Stopped", text_color="#90A4AE")
    beat_canvas.configure(fg_color="#1e2a38")
    start_btn.configure(state="normal", fg_color="#4FC3F7")
    stop_btn.configure(state="disabled", fg_color="#1e2a38")

def on_close():
    stop_event.set()
    root.destroy()

def on_slider_move(val):
    bpm_entry.delete(0, "end")
    bpm_entry.insert(0, str(int(val)))

# --- Root window ---
root = ctk.CTk()
root.title("Metronome")
root.geometry("360x480")
root.resizable(False, False)
root.protocol("WM_DELETE_WINDOW", on_close)
root.configure(fg_color="#0f1923")

# --- Title ---
ctk.CTkLabel(
    root, text="METRONOME",
    font=ctk.CTkFont(family="Courier New", size=22, weight="bold"),
    text_color="#4FC3F7"
).pack(pady=(30, 4))

ctk.CTkLabel(
    root, text="tap to the beat",
    font=ctk.CTkFont(size=11),
    text_color="#546E7A"
).pack(pady=(0, 20))

# --- Beat flash indicator ---
beat_canvas = ctk.CTkFrame(root, width=60, height=60, corner_radius=30, fg_color="#1e2a38")
beat_canvas.pack(pady=(0, 20))

# --- BPM entry ---
bpm_frame = ctk.CTkFrame(root, fg_color="transparent")
bpm_frame.pack(pady=5)

ctk.CTkLabel(
    bpm_frame, text="BPM",
    font=ctk.CTkFont(size=12),
    text_color="#546E7A"
).grid(row=0, column=0, padx=(0, 8))

bpm_entry = ctk.CTkEntry(
    bpm_frame, width=80, height=36,
    font=ctk.CTkFont(family="Courier New", size=18, weight="bold"),
    justify="center",
    fg_color="#1e2a38", border_color="#263545", text_color="#E0E0E0"
)
bpm_entry.insert(0, "120")
bpm_entry.grid(row=0, column=1)

# --- BPM slider ---
bpm_slider = ctk.CTkSlider(
    root, from_=20, to=300, number_of_steps=280,
    width=280, height=16,
    fg_color="#1e2a38", progress_color="#4FC3F7", button_color="#4FC3F7",
    command=on_slider_move
)
bpm_slider.set(120)
bpm_slider.pack(pady=16)

# --- Buttons ---
btn_frame = ctk.CTkFrame(root, fg_color="transparent")
btn_frame.pack(pady=10)

start_btn = ctk.CTkButton(
    btn_frame, text="START", width=120, height=40,
    font=ctk.CTkFont(family="Courier New", size=13, weight="bold"),
    fg_color="#4FC3F7", text_color="#0f1923",
    hover_color="#81D4FA", corner_radius=8,
    command=start_metronome
)
start_btn.grid(row=0, column=0, padx=8)

stop_btn = ctk.CTkButton(
    btn_frame, text="STOP", width=120, height=40,
    font=ctk.CTkFont(family="Courier New", size=13, weight="bold"),
    fg_color="#1e2a38", text_color="#4FC3F7",
    hover_color="#263545", corner_radius=8,
    border_width=1, border_color="#4FC3F7",
    state="disabled",
    command=stop_metronome
)
stop_btn.grid(row=0, column=1, padx=8)

# --- Status ---
status_label = ctk.CTkLabel(
    root, text="Stopped",
    font=ctk.CTkFont(family="Courier New", size=13),
    text_color="#90A4AE"
)
status_label.pack(pady=(20, 0))

root.mainloop()
