import unittest
from unittest.mock import patch, MagicMock, call
import numpy as np
import time

# ============================================================
# TEST 1 (TDD) — BPM Validation
# Requirement: The metronome must reject invalid BPM values
# (zero, negative, out of range) and accept valid ones.
# ============================================================

from metronome import start_metronome, metronome_loop

class TestBPMValidation(unittest.TestCase):

    @patch("metronome.worker", None)
    @patch("metronome.stop_event")
    @patch("metronome.status_label")
    @patch("metronome.bpm_entry")
    def test_zero_bpm_rejected(self, mock_entry, mock_status, mock_stop):
        """Cycle 1: BPM of 0 should be rejected."""
        mock_entry.get.return_value = "0"
        start_metronome()
        mock_status.config.assert_called()
        args, kwargs = mock_status.config.call_args
        self.assertIn("valid", kwargs.get("text", "").lower())

    @patch("metronome.worker", None)
    @patch("metronome.stop_event")
    @patch("metronome.status_label")
    @patch("metronome.bpm_entry")
    def test_negative_bpm_rejected(self, mock_entry, mock_status, mock_stop):
        """Cycle 2: Negative BPM should be rejected."""
        mock_entry.get.return_value = "-50"
        start_metronome()
        args, kwargs = mock_status.config.call_args
        self.assertIn("valid", kwargs.get("text", "").lower())

    @patch("metronome.worker", None)
    @patch("metronome.stop_event")
    @patch("metronome.status_label")
    @patch("metronome.bpm_entry")
    def test_out_of_range_bpm_rejected(self, mock_entry, mock_status, mock_stop):
        """Cycle 3: BPM above 300 should be rejected."""
        mock_entry.get.return_value = "301"
        start_metronome()
        args, kwargs = mock_status.config.call_args
        self.assertIn("valid", kwargs.get("text", "").lower())

    @patch("metronome.worker", None)
    @patch("metronome.stop_event")
    @patch("metronome.status_label")
    @patch("metronome.bpm_entry")
    def test_string_bpm_rejected(self, mock_entry, mock_status, mock_stop):
        """Cycle 4: Non-numeric BPM input should be rejected."""
        mock_entry.get.return_value = "abc"
        start_metronome()
        args, kwargs = mock_status.config.call_args
        self.assertIn("valid", kwargs.get("text", "").lower())

    @patch("metronome.threading")
    @patch("metronome.worker", None)
    @patch("metronome.stop_event")
    @patch("metronome.status_label")
    @patch("metronome.bpm_entry")
    def test_valid_bpm_accepted(self, mock_entry, mock_status, mock_stop, mock_threading):
        """Cycle 5: A valid BPM (120) should start the metronome."""
        mock_entry.get.return_value = "120"
        start_metronome()
        args, kwargs = mock_status.config.call_args
        self.assertIn("120", kwargs.get("text", ""))


# ============================================================
# TEST 2 (TDD) — Beat Timing Accuracy
# Requirement: The metronome loop must calculate and sleep for
# the correct interval between beats based on the given BPM.
# ============================================================

class TestBeatTiming(unittest.TestCase):

    @patch("metronome.stop_event")
    @patch("metronome.click")
    @patch("time.sleep")
    @patch("time.perf_counter")
    def test_timing_at_60_bpm(self, mock_perf, mock_sleep, mock_click, mock_stop):
        """Cycle 1: At 60 BPM, sleep interval should be ~1.0 second."""
        mock_perf.return_value = 0.0
        mock_stop.is_set.side_effect = [False, True]
        metronome_loop(60)
        args, _ = mock_sleep.call_args
        self.assertAlmostEqual(args[0], 1.0, places=2)

    @patch("metronome.stop_event")
    @patch("metronome.click")
    @patch("time.sleep")
    @patch("time.perf_counter")
    def test_timing_at_120_bpm(self, mock_perf, mock_sleep, mock_click, mock_stop):
        """Cycle 2: At 120 BPM, sleep interval should be ~0.5 seconds."""
        mock_perf.return_value = 0.0
        mock_stop.is_set.side_effect = [False, True]
        metronome_loop(120)
        args, _ = mock_sleep.call_args
        self.assertAlmostEqual(args[0], 0.5, places=2)

    @patch("metronome.stop_event")
    @patch("metronome.click")
    @patch("time.sleep")
    @patch("time.perf_counter")
    def test_timing_at_180_bpm(self, mock_perf, mock_sleep, mock_click, mock_stop):
        """Cycle 3: At 180 BPM, sleep interval should be ~0.333 seconds."""
        mock_perf.return_value = 0.0
        mock_stop.is_set.side_effect = [False, True]
        metronome_loop(180)
        args, _ = mock_sleep.call_args
        self.assertAlmostEqual(args[0], 0.333, places=2)


# ============================================================
# TEST 3 (Automated) — Hit Detection Logic
# Requirement: audio_callback should detect a hit when volume
# exceeds THRESHOLD and respect the COOLDOWN window.
# ============================================================

from listener import audio_callback, THRESHOLD, COOLDOWN
import listener

class TestHitDetection(unittest.TestCase):

    def setUp(self):
        """Reset last_hit_time before each test."""
        listener.last_hit_time = 0.0

    def _make_audio_data(self, volume):
        """Helper: create a mock numpy audio block at a given volume."""
        return np.full((1024, 1), volume, dtype=np.float32)

    def test_hit_detected_above_threshold(self):
        """A volume above THRESHOLD should register a hit."""
        data = self._make_audio_data(THRESHOLD + 0.1)
        with patch("builtins.print") as mock_print:
            audio_callback(data, 1024, {}, None)
            mock_print.assert_called()
            output = mock_print.call_args[0][0]
            self.assertIn("Hit detected", output)

    def test_no_hit_below_threshold(self):
        """A volume below THRESHOLD should not register a hit."""
        data = self._make_audio_data(THRESHOLD - 0.1)
        with patch("builtins.print") as mock_print:
            audio_callback(data, 1024, {}, None)
            mock_print.assert_not_called()

    def test_cooldown_prevents_double_hit(self):
        """A second hit within the COOLDOWN window should be ignored."""
        data = self._make_audio_data(THRESHOLD + 0.1)
        listener.last_hit_time = time.perf_counter()
        with patch("builtins.print") as mock_print:
            audio_callback(data, 1024, {}, None)
            mock_print.assert_not_called()

    def test_hit_allowed_after_cooldown(self):
        """A hit after the COOLDOWN window has passed should be detected."""
        data = self._make_audio_data(THRESHOLD + 0.1)
        listener.last_hit_time = time.perf_counter() - (COOLDOWN + 0.1)
        with patch("builtins.print") as mock_print:
            audio_callback(data, 1024, {}, None)
            mock_print.assert_called()


# ============================================================
# TEST 4 (Manual) — Start/Stop UI Behavior
#
# Steps:
#   1. Run metronome.py
#   2. Enter a valid BPM (e.g., 120) and click Start
#   3. Verify: status label shows "120 BPM", Start button is
#      grayed out, beat indicator flashes
#   4. Click Stop
#   5. Verify: status label shows "Stopped", Stop button is
#      grayed out, beat indicator stops flashing
#
# Expected result: UI state updates correctly on start and stop.
# Document with screenshots for your submission.
# ============================================================


# ============================================================
# TEST 5 (Manual) — Microphone Hit Detection End-to-End
#
# Steps:
#   1. Run listener.py
#   2. Tap on your desk or drum pad near the microphone
#   3. Verify: "Hit detected at Xs | volume=Y" prints in terminal
#   4. Tap rapidly (faster than COOLDOWN of 0.15s)
#   5. Verify: rapid taps do not produce duplicate hits
#   6. Press Ctrl+C to stop
#
# Expected result: Hits are detected and printed; cooldown
# prevents double-triggering on rapid input.
# Document with terminal screenshots for your submission.
# ============================================================


if __name__ == "__main__":
    unittest.main(verbosity=2)