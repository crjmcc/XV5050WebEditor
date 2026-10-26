# Roland XV-5050 Web Synthesizer Editor & Librarian

A modern, responsive Web MIDI sound editor, effects programmer, patch transpiler, and multi-part librarian for the **Roland XV-5050** synthesizer module. Runs entirely in your browser using the Web MIDI API with full bi-directional System Exclusive (SysEx) communication — no installations, plugins, or backend servers required.

---

## Highlights & Features

### 🎛️ Compact Modular Patch & Tone Editor
- **Compact Ergonomic Dashboard:** Essential sound sculpting parameters organized into a high-density, modular rack inspired by modern synthesizers (Serum, Vital, Pigments), eliminating dead space with sleek vector rotary encoders.
- **Interactive Draggable Envelopes:** Drag control points directly on the TVF Filter, TVA Amplitude, and Pitch envelope SVG graphs to adjust Attack/Decay/Release times and Sustain/Depth levels intuitively with real-time numeric readouts.
- **Tone Editing & Master Link Switch:**
  - Individual **Tone 1**, **Tone 2**, **Tone 3**, **Tone 4** editing targets with clear distinction from tone generation toggle switches.
  - **ALL Master Tone Switch:** Link and synchronize envelope, filter, tuning, and level parameters across all 4 active tones simultaneously.
- **Pre-Filter Drive & Overdrive (Booster):**
  - Synthesizer **Structure 1–10** selection with built-in **Booster** stages (Structures 3, 4, 7, 8) providing +6 dB to +18 dB pre-filter saturation.
  - Independent **Wave Gain** (-6 dB to +12 dB) for aggressive pre-filter crunch.
  - Peaking (**PKG**) filter mode with resonance drive.
- **Precision Vector Rotary Encoders:**
  - Scalable vector dials with glowing circular track arcs that fill clockwise from 0 (7:30 position) on unipolar controls, and from 12:00 on bipolar controls.
  - Fine vertical drag sensitivity and numeric readout boxes.
- **Symmetrical 2x2 Rack Layout:**
  - **Row 1:** TVF Filter & Envelope (left) + Dual LFO Generators (right).
  - **Row 2:** TVA Amp & Envelope (left) + Pitch Envelope (right) aligned side-by-side with matched heights and 6-knob parameter strips.
- **PCM Waveform & SRX Expansion Engine:**
  - Select between **INT (Internal 1,083 PCM Waves)**, **SRX Slot A**, and **SRX Slot B** expansion boards.
  - Full patch catalogs for Roland **SRX-01 through SRX-12** expansion boards.
  - Independent Left / Mono and Right / Stereo waveform assignment with real-time waveform names.
  - Digital Wave Gain (-6 dB to +12 dB), Wave Tempo Sync, and Frequency Cross Modulation (FXM Color 1–4 & Depth 0–16).
- **Quick Stepper Navigation (`‹` and `›`):** Single-click stepper buttons on all key dropdowns (waveforms, sound presets, drum kits, filter types, and MFX algorithms) for instant browsing without opening long menus.
- **Musician-Friendly Tooltips:** Hovering over any parameter reveals clear descriptions explaining its musical and synthesis function.
- **4-Slot Modulation Matrix Grid:**
  - High-density grid with MIDI Controller Sources along rows and sound destinations along columns.
  - Direct routing of Mod Wheel, Aftertouch, Velocity, Pitch Bend, LFOs, and Envelopes with intuitive bipolar depth encoders.

### 🧬 Deep Studio & Patch Genetics Mutator
- **Roll-Up Integration:** Access the complete sound breeding lab directly inside the Patch Editor via an expandable roll-up panel or standalone tab.
- **4-Tone 2D Vector Morphing Pad:** Real-time geometric morphing between all 4 active tones with mouse or touch control.
- **Dynamic Harmonic Spectrum Analyzer:** Live SVG harmonic curve simulating real-time Roland PCM harmonics shaped by TVF Cutoff, Resonance boost, and TVA dynamics.
- **Intelligent Patch Mutator & Sound Breeder:**
  - 6 Musical Archetype Seeds: *Musical Drift (Subtle Organic Variation)*, *Warm Vintage Drift*, *Modern EDM Edge*, *Ambient Space*, *Aggressive Chaos*, and *Random PCM Waves*.
  - Variable Mutation Intensity (5% to 100%).
  - Component Protection Locks: Lock Waveforms, Lock Filters, Lock Envelopes, Lock Pitch/Tuning, or Lock Multi-Effects.
  - Full Undo / Redo history and instant A/B Patch Compare.

### 🥁 Rhythm Drum Kit Editor
- **Scrollable Octave Pad Grid:** 5 octave banks (Octave 1: Kicks & Snares through Octave 5: Bells & FX) covering the full Roland GM drum layout (B1–D7).
- **Per-Key Sound Designer:** 10 precision rotary knobs per drum key:
  - Output Level, Stereo Pan, Coarse Tuning, Fine Tuning
  - TVA Attack Time, Decay Time
  - TVF Filter Type, Cutoff Frequency, Resonance
  - Velocity Sens & Mute Group (1–31)
- **Pad Renaming & Drum Hit Replacement:** Rename individual drum pads and replace hits directly from the built-in drum sample library.
- **Audition Drum Pad:** Audition individual drum hits with visual trigger pads and velocity response.

### 🔄 Modern VST Patch Transpiler (Drag & Drop)
- **Serum / Vital / Massive to XV-5050 Transpiler:** Drag and drop modern VST preset files (`.vital`, Steinberg FXP chunks, or JSON dumps) directly into the Librarian.
- **Intelligent Timbral Wave Matching:** Matches wavetables and saw/square/sine/noise oscillators to the closest authentic Roland PCM waveforms.
- **Logarithmic Envelope Conversion:** Maps analog-style VST ADSR seconds to Roland's 7-bit logarithmic time curves (T1–T4 / L1–L4).
- **Filter & Modulation Translation:** Automatically translates filter cutoff frequencies (Hz), resonance, and modulation depth into XV-5050 SysEx parameters.
- **Instant Audition & Hardware Write:** Transpiled patches can be previewed immediately, loaded into the Patch Editor, or written directly into Roland hardware user memory.

### ⚡ 3-MFX Multi-Effects Engine & Master EQ
- **Triple MFX Architecture (MFX-A, MFX-B, MFX-C):** Independent routing and real-time editing for all three multi-effects processor slots in Performance mode.
- **Complete 90-Algorithm Catalog:** Exhaustive database of all 90 Roland XV-5050 effects algorithms categorized by sound family (Equalizers, Dynamics, Distortions, Phasers, Flangers, Delays, Rotary, Pitch Shifters, Isolators, 3D Sound, and Multi-Combos).
- **Dynamic 12-Parameter Control:** Algorithm parameter controls dynamically adjust their labels, ranges, bipolar scaling, and display units based on the selected effect algorithm.
- **Real-Time Modulation Matrix:** 4 hardware controller routing inputs per MFX slot with sensitivity (-63 to +63) and 101 assignable MIDI sources.
- **Dedicated Chorus & Reverb Processors:** Independent Chorus (Chorus, Delay, GM2 Chorus) and Reverb (Room, Hall, Plate, SRV Room, SRV Hall, SRV Plate, GM2 Reverb) processors.
- **System 2-Band Master EQ & Scale Tune:** Master Low and High shelving EQ plus 12-note microtonal Scale Tune temperaments (Just Major/Minor, Meantone, Pythagorean, Werckmeister, Arabic 1/4 Tone).

### 🎹 16-Part Performance Mixer & Instrument Mapping
- **16-Part Channel Instrument Mapping Matrix:**
  - Full channel-by-channel sound assignment in the Performance Mixer table.
  - Inline **Assigned Sound** selectors on every part row, populated with:
    - **Current Performance Sounds:** All 16 channels with live patch names from hardware.
    - **Hardware User Patches (1–128):** Real user patch names when synced.
    - **Rhythm Drum Kits:** User Drum Kits (1–4) and Preset Drum Kits (1–8).
    - **Roland Factory Preset Banks:** Direct access to PR-A, PR-B, PR-C, PR-D, PR-E, and GM2.
    - **SRX Expansion Patches:** Direct selection of expansion board patches for Slot A and Slot B.
  - **Inline 🎛️ Tweak Buttons:** One-click navigation from any mixer channel directly into the Sound & Tone Editor for that part.
  - **16-Part Quick Navigation Strip:** Interactive pill buttons (`[1]` through `[16]`) with drum kit badges (🥁) and active part glow for effortless sound switching.
  - **Back to Mixer:** Seamless `[⬡ Back to Mixer]` button to jump instantly between sound sculpting and performance mixing.

### 📚 Full Hardware Unit Synchronization & Librarian
- **Complete 6-Stage Master Unit Sync:** Deep hardware dump reading your entire synthesizer in ~25–30 seconds:
  1. **Setup & System Parameters:** Synthesizer mode, bank MSB/LSB, master tuning, system common, and 2-band EQ.
  2. **Active Performance & 16 Parts:** Performance common, 3-MFX processors, Chorus, Reverb, and all 16 part assignments.
  3. **Active Part Patches & Waveforms:** Common, TMT structures, and all 4 Tones with waveform mappings across all 16 parts, with intelligent Rhythm Kit detection.
  4. **All 64 User Performances:** Reads all 64 user performance headers and automatically populates the quick-selection dropdown.
  5. **All 128 User Patches:** Reads all 128 user patch headers and populates the patch selection dropdown and librarian inventory.
  6. **All 4 User Rhythm Sets:** Reads user drum kit structures.
- **Interactive Dropdown Switching:** Instant hardware switching from User Performance and User Patch selectors, updating the editor and synthesizer in real time.
- **SysEx Export & Import:** Export individual sounds or complete backup archives as standard `.syx` files for safekeeping and sharing.
- **Live SysEx Monitor:** High-performance in-memory diagnostic monitor capturing live SysEx packets (RQ1, DT1, handshake) with zero DOM lag during performance.

---

## DAW Integration & Multi-Client Workarounds (Renoise, Ableton, Reaper)

### The Windows WinMM Multi-Client Limitation
On Windows, the Roland XV-5050 uses a legacy vendor driver (`rdv1017.sys`) built on the **WinMM** (`winmm.dll`) audio subsystem. WinMM grants **exclusive lock access** to whichever application opens the MIDI port first. If Renoise, Ableton, or Reaper has the XV-5050 port open, the Web Editor will fail to connect. Conversely, if the Web Editor is connected, your DAW cannot open the hardware port.

We provide two solutions built directly into the editor:

---

### Solution 1: DAW Thru via Virtual Loopback Cable (Recommended)

This allows your DAW to send live notes, clock, CCs, and automation to the XV-5050 **simultaneously** while the Web Editor edits sounds and multi-effects in real time.

```
┌─────────────────┐       MIDI Notes / CC        ┌─────────────────────────┐
│   DAW (Renoise) │ ───────────────────────────> │ loopMIDI Virtual Cable  │
└─────────────────┘                              └────────────┬────────────┘
                                                              │
                                                     DAW Thru │
                                                              ▼
                                                 ┌─────────────────────────┐
                                                 │   XV-5050 Web Editor    │
                                                 └────────────┬────────────┘
                                                              │
                                            USB SysEx + Notes │ (<0.5ms)
                                                              ▼
                                                 ┌─────────────────────────┐
                                                 │ Roland XV-5050 Hardware │
                                                 └─────────────────────────┘
```

#### Step-by-Step Setup:
1. **Install loopMIDI:**
   - Download and install the free, lightweight [loopMIDI utility by Tobias Erichsen](https://www.tobias-erichsen.de/software/loopmidi.html).
   - Create a virtual port named `loopMIDI Port 1` (or similar).
2. **Configure your DAW (e.g. Renoise):**
   - In Renoise MIDI Preferences / Instrument Output, set the MIDI Output to **`loopMIDI Port 1`** instead of the physical XV-5050.
3. **Configure the XV-5050 Web Editor:**
   - In the top **System Drawer**:
     - **MIDI Input:** Select `XV-5050`.
     - **MIDI Output:** Select `XV-5050`.
     - **DAW Thru Input:** Select **`loopMIDI Port 1 (Virtual Cable)`**.
     - Click **Connect**.
4. **Play!**
   - Play notes or run tracks in Renoise. The Web Editor intercepts the virtual loopback stream and passes notes straight to the physical XV-5050 with under 0.5ms latency while keeping the SysEx channel fully open for live sound design.

---

### Solution 2: Auto-Release Driver on Blur (Fallback)

If you prefer not to install loopMIDI:
1. In the Web Editor top System Drawer, check **☑ Auto-Release Driver on Blur (Switch to Renoise)**.
2. Whenever you switch focus away from Chrome to Renoise, the editor automatically closes the OS driver handle after a 1.5-second debounce.
3. When you click back into the Web Editor, it automatically re-acquires the XV-5050 driver seamlessly without interrupting note playback.

---

## Essential Google Chrome Flag Settings

Because the Roland XV-5050 uses a specialized USB driver, two Google Chrome settings ensure glitch-free operation:

### 1. WinRT MIDI API: Keep at "Default" (Do NOT Enable)
- **Flag:** `chrome://flags/#use-winrt-midi-api`
- **Recommended Setting:** **Default** (or **Disabled**)
- **Why:** The Roland XV-5050 driver (`rdv1017.sys`) registers with Windows WinMM. Microsoft's WinRT MIDI API only detects class-compliant USB devices and completely hides legacy vendor-driver devices like the XV-5050. If enabled, your XV-5050 will disappear from Chrome.

### 2. Window Occlusion: Set to "Disabled" (Prevents Audio Hiccups)
- **Flag:** `chrome://flags/#calculate-native-win-occlusion`
- **Recommended Setting:** **Disabled**
- **Why:** When Chrome runs in the background behind your DAW, Windows occlusion tracking lowers Chrome's thread priority and sleeps its MIDI timer loops. Clicking back into Chrome causes a sudden CPU priority surge that can cause playing notes to stutter or hiccup. Disabling native window occlusion keeps Chrome's MIDI event loop running with smooth, continuous priority.

---

## Quick Start Guide

### Requirements
- A **Roland XV-5050** synthesizer connected to your computer via USB or a standard MIDI interface.
- A modern web browser with Web MIDI support: **Google Chrome**, **Microsoft Edge**, **Opera**, or **Brave**.

### Getting Started in 3 Steps
1. Open [`index.html`](index.html) in your browser (or double-click the file locally).
2. When prompted by your browser, grant permission for **MIDI devices** and **System Exclusive (SysEx)** access.
3. In the top System Drawer:
   - Select your MIDI **Input** and **Output** ports (`XV-5050`).
   - (Optional) Select your **DAW Thru Input** (`loopMIDI Port 1`).
   - Click **Connect**.
4. Tweak parameters, morph patches, transpile VST sounds, or click **⇄ Sync Unit** to synchronize your entire hardware unit into the editor.

---

## Directory Overview

```
├── css/
│   └── style.css          # Design system, 8 color themes, and responsive modular rack styles
├── dist/
│   └── editor.js          # Fast bundled application bundle for zero-configuration browser use
├── src/
│   ├── addresses.js       # Complete parameter address map conforming to the XV-5050 MIDI specification
│   ├── app.js             # Main application controller, UI event wiring, and theme manager
│   ├── deep_patch.js      # Deep patch parameter parsing and Sysex serialization
│   ├── interactive_envelope.js # Interactive SVG draggable envelope points engine
│   ├── librarian.js       # Binary .syx file export, import, and memory snapshot manager
│   ├── mfx_data.js        # Roland 90-algorithm MFX catalog and dynamic parameter definitions
│   ├── midi.js            # Web MIDI connection manager with DAW Thru, serialized queue, and retry resilience
│   ├── mutator.js         # Sound breeding and patch genetics engine
│   ├── parameters.js      # Parameter metadata, human-readable labels, and formatters
│   ├── patch.js           # Patch Common, Effects, TMT, Modulation Matrix, and Tone data engines
│   ├── performance.js     # Performance Common, 3-MFX, Chorus, Reverb, and 16-Part mixer engines
│   ├── preset_patches.js  # Factory and user preset bank catalog mappings
│   ├── rhythm.js          # Rhythm Drum Kit engine, 5-octave pad map, and per-key sound designer
│   ├── rotary_knob.js     # High-precision vector rotary knobs with SVG arc geometry
│   ├── scale_tune.js      # Microtonal scale tuning engine and historical temperaments
│   ├── srx_data.js        # Roland SRX-01 through SRX-12 expansion board patch catalogs
│   ├── state.js           # Central reactive state store
│   ├── sysex.js           # Roland SysEx checksum calculation and packet builders/parsers
│   ├── unit_sync.js       # Multi-stage full unit synchronization and SysEx dump engine
│   ├── usb_hardware.js    # Hardware auto-detection, resilience, and diagnostic test suite
│   ├── visuals.js         # Real-time SVG path generators for envelopes, filters, and LFOs
│   ├── vst_transpiler.js  # Modern VST (Serum/Vital/Massive) to Roland SysEx patch transpiler
│   └── waveforms.js       # Complete 1,083 internal PCM waveform catalog
├── tests/                 # Automated test suite (159 unit tests + Playwright E2E verification)
├── index.html             # Application entry point
├── package.json           # Development scripts and test runner
├── MANUAL.md              # Complete Musician & Programmer Reference Manual
└── README.md              # Project Overview & Quick Start
```

---

## 📖 User Manual & Reference Guide

For an exhaustive, parameter-by-parameter guide covering synthesis architecture, Structure booster drive stages, interactive envelope manipulation, 3-MFX multi-effects algorithms, microtonal scale tuning, and full unit synchronization, see **[MANUAL.md](MANUAL.md)**.

---

## Development & Testing

This project runs 100% client-side with no mandatory build steps required for end users. For developers working on the source:

```bash
# Install development tooling (esbuild, playwright)
npm install

# Build the client-side bundle
npm run build

# Run the 159 automated unit test suites
npm test

# Run interactive browser verification
node tests/verify_ui_features.js
```

---

## License

This project is open-source software released under the [MIT License](LICENSE).
Roland and XV-5050 are trademarks of Roland Corporation. This project is an independent, community-driven tool and is not affiliated with or endorsed by Roland Corporation.
