# XV-5050 Web Editor — Stage 2 Gap Analysis & Implementation Roadmap

This document outlines the gaps between the Stage 1 baseline implementation and the complete Stage 2 specifications defined in the project plan and the official XV-5050 MIDI Implementation manual.

---

## 1. Patch Common & Modulation Matrix

### A. Modulation Matrix (Matrix Control 1–4)
- **Manual Spec**: Address `00 2B` to `00 4E` (36 bytes total).
- **Matrix 1–4 Structure**:
  - **Source** (0–109): `OFF`, `CC01–CC31`, `CC33–CC95`, `BEND`, `AFT`, `SYS1–SYS4`, `VELOCITY`, `KEYFOLLOW`, `TEMPO`, `LFO1`, `LFO2`, `PIT-ENV`, `TVF-ENV`, `TVA-ENV`.
  - **Destination 1–4** (0–33): `OFF`, `PCH`, `CUT`, `RES`, `LEV`, `PAN`, `DRY`, `CHO`, `REV`, `PIT-LFO1`, `PIT-LFO2`, `TVF-LFO1`, `TVF-LFO2`, `TVA-LFO1`, `TVA-LFO2`, `PAN-LFO1`, `PAN-LFO2`, `LFO1-RATE`, `LFO2-RATE`, `PIT-ATK`, `PIT-DCY`, `PIT-REL`, `TVF-ATK`, `TVF-DCY`, `TVF-REL`, `TVA-ATK`, `TVA-DCY`, `TVA-REL`, `TMT`, `FXM`, `MFX-CTRL1`, `MFX-CTRL2`, `MFX-CTRL3`, `MFX-CTRL4`.
  - **Sens 1–4** (1–127): Displayed as -63 to +63 (`64 = 0`).

### B. Extended Portamento & Tone Types
- **Portamento Mode**: `0 = NORMAL`, `1 = LEGATO` (`Offset 00 1A`).
- **Portamento Type**: `0 = RATE`, `1 = TIME` (`Offset 00 1B`).
- **Portamento Start**: `0 = PITCH`, `1 = NOTE` (`Offset 00 1C`).
- **Tone Type**: `0 = 4TONES`, `1 = MULTI-PARTIAL` (`Offset 00 0D`).
- **Stretch Tune Depth**: `0 = OFF`, `1–3` (`Offset 00 14`).
- **Analog Feel**: `0–127` (`Offset 00 15`).
- **Patch Clock Source**: `0 = PATCH`, `1 = SYSTEM` (`Offset 00 1E`).
- **Patch Tempo**: `20–250 BPM` (`Offset 00 1F – 00 20`, nibble split).

### C. Patch Parameter Offsets
- **Cutoff Offset**: `1–127` (-63 to +63, `Offset 00 22`).
- **Resonance Offset**: `1–127` (-63 to +63, `Offset 00 23`).
- **Attack Time Offset**: `1–127` (-63 to +63, `Offset 00 24`).
- **Release Time Offset**: `1–127` (-63 to +63, `Offset 00 25`).
- **Velocity Sens Offset**: `1–127` (-63 to +63, `Offset 00 26`).

---

## 2. Tone Mix Table (TMT) Key & Velocity Zones (`Offset 00 10 00`, Size: `0x29`)

- **TMT Velocity Control**: `0 = OFF`, `1 = ON`, `2 = RANDOM` (`Offset 00 04`).
- **Per Tone (Tones 1–4)**:
  - **Keyboard Range Lower**: `0–127` (C-1 to UPPER).
  - **Keyboard Range Upper**: `0–127` (LOWER to G9).
  - **Keyboard Fade Width Lower**: `0–127`.
  - **Keyboard Fade Width Upper**: `0–127`.
  - **Velocity Range Lower**: `1–127` (1 to UPPER).
  - **Velocity Range Upper**: `1–127` (LOWER to 127).
  - **Velocity Fade Width Lower**: `0–127`.
  - **Velocity Fade Width Upper**: `0–127`.

---

## 3. Deep Tone Parameters (`Offset 00 20 00` – `00 26 00`, Size: `0x0109` per Tone)

### A. Wave Engine
- **Wave Group Type**: `0 = INT`, `1 = SR-JV80`, `2 = SRX`, `3 = SAMPLE` (`Offset 00 27`).
- **Wave Group ID**: 4-nibble word (`Offset 00 28 – 00 2B`).
- **Wave Number L (Mono)**: 4-nibble word (`Offset 00 2C – 00 2F`).
- **Wave Number R**: 4-nibble word (`Offset 00 30 – 00 33`).
- **Wave Gain**: `0 = -6 dB`, `1 = 0 dB`, `2 = +6 dB`, `3 = +12 dB` (`Offset 00 34`).
- **FXM Switch**: `0 = OFF`, `1 = ON` (`Offset 00 35`).
- **FXM Color**: `0–3` (1–4) (`Offset 00 36`).
- **FXM Depth**: `0–16` (`Offset 00 37`).
- **Wave Tempo Sync**: `0 = OFF`, `1 = ON` (`Offset 00 38`).
- **Wave Pitch Keyfollow**: `44–84` (-200% to +200%) (`Offset 00 39`).

### B. Pitch Envelope
- **Depth**: `52–76` (-12 to +12 semitones, `Offset 00 3A`).
- **Velocity Sens**: `1–127` (-63 to +63, `Offset 00 3B`).
- **Time 1 Velocity Sens**: `1–127` (-63 to +63, `Offset 00 3C`).
- **Time 4 Velocity Sens**: `1–127` (-63 to +63, `Offset 00 3D`).
- **Time Keyfollow**: `54–74` (-100 to +100, `Offset 00 3E`).
- **Times T1–T4**: `0–127` (`Offsets 00 3F, 00 40, 00 41, 00 42`).
- **Levels L0–L4**: `1–127` (-63 to +63, `Offsets 00 43, 00 44, 00 45, 00 46, 00 47`).

### C. TVF (Filter & Filter Envelope)
- **Filter Type**: `0 = OFF`, `1 = LPF`, `2 = BPF`, `3 = HPF`, `4 = PKG`, `5 = LPF2`, `6 = LPF3` (`Offset 00 48`).
- **Cutoff**: `0–127` (`Offset 00 49`).
- **Cutoff Keyfollow**: `44–84` (-200% to +200%) (`Offset 00 4A`).
- **Cutoff Velocity Curve**: `0 = FIXED`, `1–7` (`Offset 00 4B`).
- **Cutoff Velocity Sens**: `1–127` (-63 to +63) (`Offset 00 4C`).
- **Resonance**: `0–127` (`Offset 00 4D`).
- **Resonance Velocity Sens**: `1–127` (-63 to +63) (`Offset 00 4E`).
- **TVF Envelope Depth**: `1–127` (-63 to +63) (`Offset 00 4F`).
- **TVF Env Velocity Curve**: `0–6` (1–7) (`Offset 00 50`).
- **TVF Env Velocity Sens**: `1–127` (-63 to +63) (`Offset 00 51`).
- **TVF Env Time 1 / Time 4 Velocity Sens**: `1–127` (`Offsets 00 52, 00 53`).
- **TVF Env Time Keyfollow**: `54–74` (`Offset 00 54`).
- **TVF Env Times T1–T4**: `0–127` (`Offsets 00 55, 00 56, 00 57, 00 58`).
- **TVF Env Levels L1–L4**: `0–127` (`Offsets 00 59, 00 5A, 00 5B, 00 5C`).

### D. TVA (Amplifier, Panning & Amp Envelope)
- **TVA Level**: `0–127` (`Offset 00 6E`).
- **TVA Level Velocity Curve**: `0–6` (1–7) (`Offset 00 6F`).
- **TVA Level Velocity Sens**: `1–127` (-63 to +63) (`Offset 00 70`).
- **TVA Env Time 1 / Time 4 Velocity Sens**: `1–127` (`Offsets 00 71, 00 72`).
- **TVA Env Time Keyfollow**: `54–74` (`Offset 00 73`).
- **TVA Env Times T1–T4**: `0–127` (`Offsets 00 74, 00 75, 00 76, 00 77`).
- **TVA Env Levels L1–L3**: `0–127` (`Offsets 00 78, 00 79, 00 7A`).
- **Pan Modulation**: Pan Keyfollow `54–74` (`Offset 00 05`), Random Pan Depth `0–63` (`Offset 00 06`), Alternate Pan Depth `1–127` (`Offset 00 07`).

### E. Dual LFOs (LFO 1 & LFO 2)
- **Waveforms**: `TRI`, `SIN`, `SAW-UP`, `SAW-DN`, `SQR`, `TRP`, `S&H`, `RND`, `STEP1`, `STEP2` (`Offsets 00 8A, 00 FA`).
- **Rate**: `0–127` or Note values (`Offsets 00 8B, 00 FB`).
- **Tempo Sync**: `0 = OFF`, `1 = ON` (`Offsets 00 8D, 00 FD`).
- **Fade Mode**: `0 = ON-IN`, `1 = ON-OUT`, `2 = OFF-IN`, `3 = OFF-OUT` (`Offsets 00 8E, 00 FE`).
- **Delay Time & Fade Time**: `0–127` (`Offsets 00 8F–90, 00 FF–01 00`).
- **Key Trigger**: `0 = OFF`, `1 = ON` (`Offsets 00 93, 01 04`).
- **Pitch Depth**: `1–127` (-63 to +63) (`Offsets 00 94, 01 05`).
- **TVF Depth**: `1–127` (-63 to +63) (`Offsets 00 95, 01 06`).
- **TVA Depth**: `1–127` (-63 to +63) (`Offsets 00 96, 01 07`).
- **Pan Depth**: `1–127` (-63 to +63) (`Offsets 00 97, 01 08`).

---

## 4. Patch Effects (MFX, Chorus, Reverb)
- **Patch MFX** (`Offset 00 02 00`, Size `0x0111` / 273 bytes): Type selector, MFX Dry/Chorus/Reverb sends, multi-parameter editing.
- **Patch Chorus** (`Offset 00 04 00`, Size `0x34` / 52 bytes): Type, Level, Output Assign, Output Select, Parameters 1–12.
- **Patch Reverb** (`Offset 00 06 00`, Size `0x53` / 83 bytes): Type, Level, Output Assign, Parameters 1–12.

---

## 5. Librarian & SysEx File Management
- **In-Browser Storage**: IndexedDB patch library for saving and recalling user patches and performances.
- **`.syx` Import & Export**: File drag-and-drop parser for standard MIDI System Exclusive files.
- **Bulk Memory Dump Support**: User Performance (1–64) and User Patch (1–128) address ranges.

---

## 6. Visual Envelope & Curve Displays
- **Interactive SVG ADSR / Time-Level Curves**: Dynamic response for Pitch, TVF, and TVA envelopes.
- **Filter Curve Display**: Frequency cutoff slope and resonance peak visualizer.
- **LFO Waveform Preview**: Real-time shape, rate, and offset visualization.
