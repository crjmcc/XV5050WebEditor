# Roland XV-5050 Web Synthesizer Editor — User Manual & Reference Guide

Welcome to the comprehensive user manual and reference guide for the **Roland XV-5050 Web Synthesizer Editor**. This application is a zero-install, professional-grade sound editor, patch librarian, and synthesis lab for the Roland XV-5050 64-voice synthesizer module, running entirely in modern web browsers via the Web MIDI API.

---

## Table of Contents

1. [Hardware Setup & MIDI Architecture](#1-hardware-setup--midi-architecture)
   - [Physical Connection](#physical-connection)
   - [Google Chrome Flag Settings](#google-chrome-flag-settings)
   - [Windows WinMM Driver & DAW Integration](#windows-winmm-driver--daw-integration)
   - [Device ID Auto-Detection & Diagnostics](#device-id-auto-detection--diagnostics)
2. [Synthesizer Architecture & Signal Flow](#2-synthesizer-architecture--signal-flow)
   - [Performance Mode vs Single Patch Mode](#performance-mode-vs-single-patch-mode)
   - [The 4-Tone Synthesis Engine](#the-4-tone-synthesis-engine)
3. [Performance Mode & 16-Part Mixer](#3-performance-mode--16-part-mixer)
   - [16-Part Channel Strip](#16-part-channel-strip)
   - [Instrument & Sound Assignment](#instrument--sound-assignment)
   - [Preset Browsing & Hardware Writing](#preset-browsing--hardware-writing)
4. [Deep Patch & Tone Sound Designer](#4-deep-patch--tone-sound-designer)
   - [Tone Selection: Individual vs ALL Master Link](#tone-selection-individual-vs-all-master-link)
   - [Pre-Filter Drive & Overdrive (Structures & Booster)](#pre-filter-drive--overdrive-structures--booster)
   - [Interactive Draggable Envelopes](#interactive-draggable-envelopes)
   - [Precision Vector Rotary Encoders](#precision-vector-rotary-encoders)
   - [TVF Filter & Dynamic Scopes](#tvf-filter--dynamic-scopes)
   - [TVA Amplifier & Stereo Panning](#tva-amplifier--stereo-panning)
   - [Dual LFO Generators](#dual-lfo-generators)
   - [Modulation Matrix](#modulation-matrix)
   - [Tone Mix Table (TMT) Velocity & Keyboard Splits](#tone-mix-table-tmt-velocity--keyboard-splits)
5. [Modern Synth Lab & Genetic Mutator](#5-modern-synth-lab--genetic-mutator)
   - [4-Tone 2D Vector Morphing Pad](#4-tone-2d-vector-morphing-pad)
   - [Dynamic Harmonic Spectrum Analyzer](#dynamic-harmonic-spectrum-analyzer)
   - [Intelligent Patch Mutator & Sound Breeder](#intelligent-patch-mutator--sound-breeder)
6. [Modern VST Preset Transpiler](#6-modern-vst-preset-transpiler)
   - [Importing Vital, Serum & FXP Presets](#importing-vital-serum--fxp-presets)
   - [Timbral Matching & Logarithmic Envelope Translation](#timbral-matching--logarithmic-envelope-translation)
7. [Rhythm Drum Kit Editor](#7-rhythm-drum-kit-editor)
   - [Scrollable Octave Pad Grid](#scrollable-octave-pad-grid)
   - [Per-Key Sound Designer](#per-key-sound-designer)
8. [Multi-Effects Engine (3-MFX, Chorus, Reverb, EQ)](#8-multi-effects-engine-3-mfx-chorus-reverb-eq)
   - [3-MFX Processor Slots (MFX-A, MFX-B, MFX-C)](#3-mfx-processor-slots-mfx-a-mfx-b-mfx-c)
   - [90-Algorithm Roland COSM Catalog](#90-algorithm-roland-cosm-catalog)
   - [System Master EQ & Microtonal Scale Tuning](#system-master-eq--microtonal-scale-tuning)
9. [Full Hardware Synchronization & SysEx Librarian](#9-full-hardware-synchronization--sysex-librarian)
   - [6-Stage Master Unit Sync](#6-stage-master-unit-sync)
   - [SysEx File Export & Import (.syx)](#sysex-file-export--import-syx)
   - [Real-Time SysEx Monitor](#real-time-sysex-monitor)

---

## 1. Hardware Setup & MIDI Architecture

### Physical Connection
Connect the Roland XV-5050 to your computer via:
1. **USB Port:** Using a standard USB A-to-B cable with the Roland XV-5050 vendor driver installed on Windows/macOS.
2. **Standard 5-Pin MIDI:** Using any class-compliant USB-MIDI interface connected to the MIDI IN and MIDI OUT jacks of the XV-5050.

### Google Chrome Flag Settings
To ensure glitch-free Web MIDI performance on Windows:
1. **WinRT MIDI API — Set to Default (Do NOT enable):**
   - Address: `chrome://flags/#use-winrt-midi-api`
   - Value: **Default** or **Disabled**
   - *Reason:* The Roland vendor driver (`rdv1017.sys`) operates through Windows WinMM. Microsoft's WinRT MIDI API only discovers class-compliant devices and hides legacy driver units.
2. **Native Window Occlusion — Set to Disabled:**
   - Address: `chrome://flags/#calculate-native-win-occlusion`
   - Value: **Disabled**
   - *Reason:* Prevents Chrome from lowering its background priority when switching focus between your DAW and the editor, avoiding audio or SysEx timing stutters.

### Windows WinMM Driver & DAW Integration
Because Windows WinMM grants exclusive access to the first application that opens a MIDI port, running a DAW (Renoise, Ableton, Reaper) simultaneously with Chrome requires a routing solution:

#### Option A: DAW Thru via loopMIDI Virtual Cable (Recommended)
1. Install [loopMIDI](https://www.tobias-erichsen.de/software/loopmidi.html) and create a virtual port named `loopMIDI Port 1`.
2. In your DAW, route MIDI note/CC tracks to **`loopMIDI Port 1`**.
3. In the Web Editor's top **System Drawer**:
   - Set **MIDI Input** to `XV-5050`.
   - Set **MIDI Output** to `XV-5050`.
   - Set **DAW Thru Input** to **`loopMIDI Port 1 (Virtual Cable)`**.
   - Click **Connect**.
4. Play tracks in your DAW. The editor transparently forwards notes with `<0.5ms` latency while maintaining active SysEx control.

#### Option B: Auto-Release Driver on Blur (Fallback)
If you do not use a virtual loopback cable, check **Auto-Release Driver on Blur** in the System Drawer. Whenever you switch focus to your DAW, the editor closes the port handle after 1.5 seconds. Clicking back into Chrome re-acquires the device automatically.

### Device ID Auto-Detection & Diagnostics
- Click **🔍 Detect ID** in the System Drawer to automatically poll Roland device IDs (`0x10` through `0x1F`).
- Click **⚡ USB Diagnostics** to run a non-destructive 6-step test measuring packet latency, loopback integrity, and checksum validation.

---

## 2. Synthesizer Architecture & Signal Flow

### Performance Mode vs Single Patch Mode
- **PERFORM Mode (⬡):** 16-part multi-timbral mode. Up to 16 distinct sounds can be played simultaneously across MIDI channels 1–16, with 3 dedicated MFX processors, chorus, and reverb.
- **PATCH Mode (♦):** Dedicated single-sound editing mode focusing the full synthesis engine on one sound across all 4 tones.

Switching between modes can be done from the header mode pill toggle: `[⬡ PERFORM]` or `[♦ PATCH]`. The hardware displays `PERFORM` or `PATCH` accordingly.

### The 4-Tone Synthesis Engine
A Roland XV-5050 patch is composed of up to **4 independent Tones**. Each tone is a complete synthesizer voice consisting of:
- **PCM Wave Generator:** Internal 1,083 waveforms, or SRX Slot A/B expansion boards, with FXM cross modulation and wave gain.
- **TVF (Time Variant Filter):** 4-pole multi-mode filter with dedicated 5-point ADSR envelope.
- **TVA (Time Variant Amplifier):** Amplitude stage with 5-point envelope, level, and stereo panning.
- **Pitch Envelope:** Bipolar semitone pitch modulation with 4 time stages.
- **Dual LFOs:** Two independent multi-waveform low frequency oscillators.

---

## 3. Performance Mode & 16-Part Mixer

### 16-Part Channel Strip
The Performance tab features a 16-channel console mixer:
- **Volume & Pan:** High-precision vector rotary encoders with real-time numeric readouts.
- **Effects Sends:** Dedicated rotary dials for Chorus Send, Reverb Send, and Dry Level.
- **Output Routing:** Route individual parts to Output A, Output B, or MFX slots (MFX-A, MFX-B, MFX-C).
- **MIDI Channel Assignment & Mute/Solo:** Set individual receive channels (1–16) and isolate parts with Solo Part Select.

### Instrument & Sound Assignment
Each channel row features an **Assigned Sound** selector with quick stepper buttons (`‹` and `›`). Sounds can be chosen from:
- **Hardware User Patches (1–128)**
- **Roland Factory Preset Banks:** PR-A, PR-B, PR-C, PR-D, PR-E, and GM2.
- **Rhythm Drum Kits:** User Drum Kits (1–4) and Preset Drum Kits (1–8).
- **SRX Expansion Boards:** Full patch lists for installed SRX boards in Slot A and Slot B.

Clicking the **🎛️ Tweak** button on any part immediately switches to the Patch & Tones tab and focuses the editor on that exact part's patch buffer.

### Preset Browsing & Hardware Writing
- **Preset Selector:** Located on the left side of the Performance header, displaying all 64 User Performances.
- **Quick Steppers:** Use `<` and `>` to cycle through performances instantly.
- **Load Entire Performance:** Pulls the full multi-part setup, 3-MFX settings, and 16 tone buffers from hardware.
- **⬆ Write to Slot...:** Saves the current performance into any of the 64 hardware user memory locations.

---

## 4. Deep Patch & Tone Sound Designer

### Tone Selection: Individual vs ALL Master Link
At the top of the Deep Tone Generator Engine:
- **Tone Toggle Switches (`TONE 1` – `TONE 4`):** Turn tone voice generation ON or OFF in the sound engine.
- **Tone Target Radios (`Tone 1` | `Tone 2` | `Tone 3` | `Tone 4`):** Selects which specific tone is currently displayed and manipulated in the module cards below.
- **ALL Master Tone Switch:** When active, modifying any filter cutoff, resonance, envelope time, level, or tuning control automatically updates **all active tones simultaneously**. This operates seamlessly across both Single Patch mode and any Performance Part (Parts 1–16) by dynamically recalculating Roland hardware temporary patch buffer base addresses (`11 00 00 00` through `11 E0 00 00`), allowing instant unified tone filtering across complex multi-timbral layers.
- **Proportional Envelope Visualization:** TVF, TVA, Pitch, and LFO cards feature compact, proportional 320px scopes that preserve clean envelope aspect ratios without horizontal stretching.

### Pre-Filter Drive & Overdrive (Structures & Booster)
While Roland TVF filters do not have an analog drive pot, the XV-5050 provides authentic pre-filter saturation through built-in engine structures:
1. **Structure Booster (Pre-Filter Drive):**
   - Structures 1 and 2 operate in parallel/cascade.
   - **Structures 3, 4, 7, and 8** insert a hardware **Booster** between Tone 1 and Tone 2.
   - The Booster acts as a dedicated pre-filter distortion/saturation stage, driven by Tone 1's output level. Boost amounts range from `0 dB (Clean)` up to `+18 dB (Heavy Saturation)`.
2. **Digital Wave Gain (Pre-Drive):**
   - Boosts raw PCM sample amplitude prior to entering the TVF stage (`-6 dB`, `0 dB`, `+6 dB`, `+12 dB`). Setting this to `+12 dB` pushes high-resonance filters into rich harmonic saturation.
3. **Peaking Filter (PKG) Overdrive:**
   - Setting Filter Type to `PKG` converts the filter into a resonant boost band, saturating upper harmonics without phase distortion.

### Interactive Draggable Envelopes
The TVF Filter, TVA Amplifier, and Pitch cards feature real-time interactive SVG envelopes:
- **Interactive Control Points:** Click and drag points directly on the envelope visualizer.
  - Dragging horizontally adjusts time parameters (Attack T1, Hold T2, Decay T3, Release T4).
  - Dragging vertically adjusts levels (Sustain L3, Pitch Depth, TVA Level).
- **Instant Hardware Reflection:** As you drag, SysEx parameter updates stream directly to the XV-5050, and corresponding rotary knob encoders reflect the new values in real time.

### Precision Vector Rotary Encoders
Horizontal faders have been replaced with compact vector rotary dials:
- **Unipolar Encoders (0 to 127):** The neon orange arc starts at the 7:30 position (value 0) and sweeps clockwise up to 4:30 (value 127).
- **Bipolar Encoders (-64 to +63):** The arc originates at 12:00 (zero/center) and sweeps left for negative values or right for positive values.
- **Interaction:** Click and drag vertically to smoothly dial in values with high precision.

### TVF Filter & Dynamic Scopes
- **Filter Types:** LPF (Low Pass), BPF (Band Pass), HPF (High Pass), PKG (Peaking).
- **Dual Visual Scopes:**
  - *Response Scope:* Real-time frequency response curve showing filter slope and resonance peak.
  - *Envelope Scope:* 5-point ADSR modulation curve with draggable handles.
- **Parameters:** Cutoff (0–127), Resonance (0–127), Envelope Depth (-63 to +63), Cutoff Keyfollow, and Velocity Sensitivity.

### TVA Amplifier & Stereo Panning
- **Parameters:** Tone Level (0–127), Stereo Pan (L64 to R63), Pan Keyfollow, Random Pan, and Alternate Pan.
- **Envelope Stages:** Time 1 (Attack), Time 2 (Hold), Time 3 (Decay), Time 4 (Release), and Level 3 (Sustain).

### Dual LFO Generators
Each tone features two independent LFOs (LFO 1 and LFO 2):
- **10 Waveforms:** Triangle, Sine, Saw-Up, Saw-Down, Square, Trapezoid, Sample & Hold, Random, Step 1, Step 2.
- **Modulation Depths:** Pitch Depth, TVF Filter Depth, TVA Amplitude Depth, and Pan Depth.
- **Tempo Sync:** Synchronize LFO rate to internal clock or external MIDI clock with musical divisions (1/16, 1/8, 1/4, 1/2, 1/1).

### Modulation Matrix
A dedicated 4-slot matrix maps hardware controllers to sound destinations:
- **Sources:** Mod Wheel (CC01), Breath (CC02), Foot (CC04), Aftertouch, Expression (CC11), Pitch Bend, LFO 1, LFO 2, TVF/TVA Envelopes.
- **Destinations:** Pitch, Cutoff, Resonance, Level, Pan, LFO 1/2 Rates, LFO 1/2 Depths.
- **Scaling:** Bipolar sensitivity (-63 to +63).

### Tone Mix Table (TMT) Velocity & Keyboard Splits
Configure how tones respond across your keyboard:
- **Key Range:** Lower Limit (C-1 to G9) and Upper Limit (C-1 to G9).
- **Velocity Range:** Velocity Low (1–127) and Velocity High (1–127).
- **Fade Curves:** Velocity Crossfade and Keyfade for smooth acoustic instrument layering.

---

## 5. Modern Synth Lab & Genetic Mutator

### 4-Tone 2D Vector Morphing Pad
- Located inside the collapsible *Modern Synth Lab* panel.
- Drag the glowing puck across the 2D Cartesian plane to smoothly morph voice levels between Tone 1 (Top-Left), Tone 2 (Top-Right), Tone 3 (Bottom-Left), and Tone 4 (Bottom-Right).

### Dynamic Harmonic Spectrum Analyzer
- Simulates real-time harmonic content based on the active tone's PCM waveform, shaped by TVF filter cutoff slope, resonance peak emphasis, and amplifier dynamics.

### Intelligent Patch Mutator & Sound Breeder
Breed entirely new sounds algorithmically from existing presets:
- **6 Musical Seeds:**
  1. *Musical Drift (Subtle Organic Variation):* Gentle acoustic-style micro-tuning and filter drift.
  2. *Warm Vintage Drift:* Analog-style envelope imperfections and warm filter saturation.
  3. *Modern EDM Edge:* Aggressive resonance, bright envelopes, and sharp transients.
  4. *Ambient Space:* Extended attack/release times and ethereal modulation depths.
  5. *Aggressive Chaos:* Experimental randomized soundscapes.
  6. *Random PCM Waves:* Swaps internal waveforms while preserving envelope and filter shapes.
- **Mutation Intensity:** Slider scaling effect from 5% (subtle flavor) to 100% (complete transformation).
- **Component Protection Locks:** Check to protect specific components during mutation:
  - `☑ Waves` — Preserves PCM waveforms.
  - `☑ Filters` — Keeps current filter cutoff and resonance.
  - `☑ Envelopes` — Keeps ADSR contours intact.
  - `☑ Tuning` — Locks coarse/fine pitch.
  - `☑ Multi-Effects` — Leaves MFX routing untouched.
- **Undo / Redo & A/B Compare:** Instantly compare mutated sounds against the original patch.

---

## 6. Modern VST Preset Transpiler

### Importing Vital, Serum & FXP Presets
Convert modern software synthesizer sounds into authentic Roland XV-5050 hardware patches:
1. Drag and drop any `.vital` preset file, Steinberg `.fxp` preset chunk, or JSON dump into the Transpiler drop zone.
2. The transpiler analyzes wavetables, filter curves, ADSR envelopes, and modulation routings.

### Timbral Matching & Logarithmic Envelope Translation
- **Waveform Analysis:** Matches basic oscillators (Sine, Triangle, Saw, Square, Pulse, Noise) and complex wavetables to the closest corresponding Roland PCM sample among the 1,083 internal catalog waves.
- **Envelope Curve Fitting:** Translates analog time-in-seconds (e.g. 0.05s attack, 1.2s release) into Roland's proprietary 7-bit logarithmic time curve values (0–127).
- **One-Click Hardware Send:** Click **Send Transpiled Patch to Unit** to audition the sound immediately or save it into user memory.

---

## 7. Rhythm Drum Kit Editor

### Scrollable Octave Pad Grid
Switch to the **🥁 Drum Kit Editor** tab to access the full 61-key GM drum layout (B1 through D7):
- **5 Octave Banks:**
  - *Octave 1 (B1–B2):* Kicks, Snares, Rimshots, and Claps.
  - *Octave 2 (C3–B3):* Hi-Hats, Toms, and Crash/Ride Cymbals.
  - *Octave 3 (C4–B4):* Latin Percussion, Tambourines, Cowbells, and Vibraslaps.
  - *Octave 4 (C5–B5):* Bongos, Congas, Timbales, and Agogos.
  - *Octave 5 (C6–D7):* Cabasa, Maracas, Whistles, Guiros, and Cuicas.
- **Interactive Audition Pads:** Click any pad to trigger an audition hit with visual velocity feedback.

### Per-Key Sound Designer
Every drum key has its own dedicated synthesizer voice parameters:
- **Pitch & Level:** Output Level, Stereo Pan, Coarse Tuning (±48 semitones), Fine Tuning (±50 cents).
- **TVA Dynamics:** TVA Attack Time and Decay Time.
- **TVF Filtering:** Filter Type (LPF, HPF, BPF, PKG), Cutoff Frequency, and Resonance.
- **Performance Parameters:** Velocity Sensitivity and Mute Group (1–31) to configure open/closed hi-hat exclusivity.
- **Waveform Replacement:** Swap any drum hit with any sample from the internal 1,083 PCM wave library.

---

## 8. Multi-Effects Engine (3-MFX, Chorus, Reverb, EQ)

### 3-MFX Processor Slots (MFX-A, MFX-B, MFX-C)
In Performance mode, the XV-5050 provides three independent multi-effects processors:
- **Routing Topologies:** Configure MFX in parallel or cascade (A → B → C).
- **Controller Matrix:** 4 real-time controller modulation inputs per MFX slot with bipolar sensitivity.

### 90-Algorithm Roland COSM Catalog
All 90 Roland XV-5050 algorithms are fully supported, dynamically adapting parameter names, ranges, and units:
- **Dynamics & EQ:** Stereo EQ, Compressor, Limiter, Gate, Isolator.
- **Overdrive & Distortion:** COSM Guitar Amp, Classic Overdrive, Distortion, Fuzz.
- **Modulation:** Chorus, Flanger, Phaser, Step Phaser, Rotary, Auto Wah, Pitch Shifter, Tremolo.
- **Delays:** Stereo Delay, Modulation Delay, Triple Tap Delay, Time Control Delay.
- **Combination Algorithms:** Overdrive → Flanger, Compressor → Delay, Enhancer → Chorus → Delay.

### System Master EQ & Microtonal Scale Tuning
- **System EQ:** 2-band master shelving equalizer (Low Freq, Low Gain, High Freq, High Gain).
- **Microtonal Scale Tuning:** Apply historical and experimental temperaments to any part:
  - Equal Temperament (12-TET)
  - Just Intonation (Major C / Minor C)
  - Pythagorean Scale
  - Meantone (1/4 Comma)
  - Werckmeister III & Kirnberger III
  - Arabic Quarter-Tone (Rast & Bayati)

---

## 9. Full Hardware Synchronization & SysEx Librarian

### 6-Stage Master Unit Sync
Click **⇄ Sync Unit** in the top header to initiate a full hardware dump (~25–30 seconds):
1. **Stage 1 — Setup & System:** Master tuning, bank registers, and System EQ.
2. **Stage 2 — Active Performance:** 3-MFX settings, chorus/reverb parameters, and all 16 part mixer strips.
3. **Stage 3 — Active Patches & Tones:** Full 4-tone synthesis parameters and PCM wave assignments across all parts.
4. **Stage 4 — 64 User Performances:** Headers and names for all user performances.
5. **Stage 5 — 128 User Patches:** Headers, categories, and names for all user patches.
6. **Stage 6 — 4 User Rhythm Sets:** Complete user drum kit structures.

### SysEx File Export & Import (.syx)
- **Export Patch:** Save the current sound as a standard Roland `.syx` patch file.
- **Export Full Unit Backup:** Generate a complete multi-packet `.syx` archive of all hardware user memory.
- **Import .syx:** Drag and drop `.syx` files into the Librarian to inspect, audition, or upload them to hardware.

### Real-Time SysEx Monitor
Switch to the **☷ SysEx Monitor** tab to view bi-directional MIDI traffic:
- **Packet Inspection:** Color-coded RQ1 (read request) and DT1 (data set) hex dumps.
- **Zero-Lag Architecture:** High-throughput in-memory buffer ensuring no UI degradation during rapid parameter tweaking or heavy SysEx bulk dumps.

---

*Roland and XV-5050 are registered trademarks of Roland Corporation. This project is an independent open-source tool developed for musicians and sound designers.*

