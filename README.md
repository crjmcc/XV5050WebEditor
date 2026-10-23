# Roland XV-5050 Web Synthesizer Editor & Librarian

A modern, responsive Web MIDI sound editor, effects programmer, and patch librarian for the **Roland XV-5050** synthesizer module. Runs entirely in your browser using the Web MIDI API with full bi-directional System Exclusive (SysEx) communication — no installations, plugins, or backend servers required.

---

## Highlights & Features

### 🎛️ Modern Synth Dashboard & Visual Scopes
- **Compact Modular Synth Layout:** Inspired by contemporary synthesizers and DAWs (Serum, Vital, Pigments), all essential sound sculpting controls are organized into a high-density, ergonomic dashboard.
- **Real-Time Visual Curves:**
  - **TVF Filter Response Scopes:** Dynamic frequency curve visualization for all filter modes (LPF, HPF, BPF, PKG) responsive to cutoff and resonance adjustments.
  - **Multi-Stage Envelopes:** Interactive ADSR curves for Pitch, TVF Filter, and TVA Amplifier envelopes.
  - **LFO Oscilloscopes:** Real-time waveform preview showing cycle speed and shape (Triangle, Sine, Sawtooth, Square, Sample & Hold, Random, Step).

### ⚡ 3-MFX Multi-Effects Engine & System EQ
- **Full 3-MFX Architecture (MFX-A, MFX-B, MFX-C):** Independent routing and real-time editing for all three multi-effects processor slots in Performance mode.
- **Complete 90-Algorithm Catalog:** Exhaustive database of all 90 Roland XV-5050 effects algorithms categorized by sound family (Equalizers, Dynamics, Distortions, Phasers, Flangers, Delays, Rotary, Pitch Shifters, Isolators, 3D Sound, and Multi-Combos).
- **Dynamic 12-Parameter Control:** Algorithm parameter controls dynamically adjust their labels, ranges, bipolar scaling, and display units based on the selected effect algorithm.
- **MFX Controller Matrix:** 4 hardware controller routing inputs per MFX slot with sensitivity (-63 to +63) and 101 assignable MIDI sources (CCs, Aftertouch, Pitch Bend, System Controls).
- **Dedicated Chorus & Reverb Processors:** Independent Chorus (Chorus, Delay, GM2 Chorus) and Reverb (Room, Hall, Plate, SRV Room, SRV Hall, SRV Plate, GM2 Reverb) processors with level, send, pre-delay, and HF damp.
- **System 2-Band Master EQ:** Master Low (200Hz / 400Hz) and High (2kHz / 4kHz) shelving EQ with gain controls (-15 dB to +15 dB).

### 🎨 8 Curated Synth Color Themes
- **XV-5050 Native Silver (Default):** Authentically styled after the physical XV-5050 hardware front panel: brushed silver chassis with high-contrast amber/orange dot-matrix backlit displays and orange glowing vector scopes.
- **Instant Theme Cycling:** Click the theme button in the top rack bar to cycle between 8 handcrafted visual schemes:
  1. `🎛️ XV-5050 Native` — Brushed silver rack faceplate with glowing amber LCD
  2. `⚡ Cyber Cyan` — Deep space dark theme with vibrant electric cyan accents
  3. `🎹 Roland JD Classic` — Charcoal vintage rack styling with orange and blue accents
  4. `🌑 OLED Obsidian` — Ultra-high contrast monochrome pitch-black theme
  5. `📟 Emerald Matrix` — Retro phosphor-green CRT and green dot-matrix screen
  6. `☀️ Solar Amber` — Warm analog tube valve glow and copper accents
  7. `🔮 Midnight UV` — Synthwave deep violet and neon electric magenta
  8. `🎚️ Studio Slate` — Modern neutral titanium and slate gray DAW look
- **Persistent Preferences:** Your selected theme is automatically saved in browser storage and restored whenever you open the editor.

### ⚡ Live Parameter Reflection & Mode Switching
- **Real-Time Hardware Response:** Move any slider to hear the sound alter immediately on your physical synthesizer. Edits are transmitted via smooth, throttled SysEx packets that never choke the MIDI buffer.
- **Hardware Mode Switching:** Seamlessly toggle the physical XV-5050 between **Single Patch Mode** and **16-Part Performance Mode** with one click on the top rack bar.
- **Serialized SysEx Wire Queue:** Built-in sequential FIFO queue with automatic 25ms settling delays between transactions to guarantee flawless hardware stability and prevent MIDI collision errors.
- **Audition Note & Emergency Panic:** Play test notes directly from the toolbar, or trigger an instant All-Notes-Off / All-Sound-Off reset across all 16 channels.
- **Collapsible System Drawer:** A clean roll-up / roll-down header keeps connection settings, Device IDs, and MIDI ports organized without crowding your workspace.

### 🔬 Deep Sound Architecture & Tone Generators
- **4 Tone Engine:** Independently configure Wave, TVF Filter, TVA Amplifier, Envelopes, and dual LFOs for all 4 Tones in a Patch.
- **1,083 Waveform Catalog:** Full browsable database of Roland's 1,083 internal PCM waveforms, cleanly organized by instrument family and name (Acoustic Pianos, Electric Pianos, Strings, Guitars, Synths, Brass, Percussion).
- **Tone Mix Table (TMT):** Structure types 1–10 (independent routing for Tones 1 & 2 and Tones 3 & 4), ring modulators, booster levels (+0 dB to +18 dB), and key/velocity split zones.
- **4-Slot Modulation Matrix:** Easily route physical controllers (Mod Wheel, Aftertouch, Velocity, Pitch Bend, LFOs, Envelopes) to sound destinations (Cutoff, Resonance, Pitch, Level, Pan, Effects) with human-readable musical labels.

### 🎹 Performance Channel Instrument Mapping & Part Tweaking
- **16-Part Channel Instrument Mapping Matrix:**
  - Full channel-by-channel sound assignment in the Performance Mixer table.
  - Inline **Assigned Sound** selectors on every part row, populated with:
    - **Current Performance Sounds:** All 16 channels with live patch names from hardware.
    - **Hardware User Patches (1-128):** Real user patch names when synced, with full 128-patch direct bank selection.
    - **Rhythm Drum Kits:** User Drum Kits (1-4) and Preset Drum Kits (1-8).
    - **Roland Factory Preset Banks:** Direct access to PR-A, PR-B, PR-C, PR-D, PR-E, and GM2.
  - **Inline 🎛️ Tweak Buttons:** One-click navigation from any mixer channel directly into the Sound & Tone Editor for that part.
  - **16-Part Quick Navigation Strip:** Interactive pill buttons (`[1]` through `[16]`) with drum kit badges (🥁) and active part glow for effortless sound switching.
  - **Back to Mixer:** Seamless `[⬡ Back to Mixer]` button to jump instantly between sound sculpting and performance mixing.
  - **Persistent Browser Cache:** Full offline and reload persistence via browser `localStorage` (`xv5050_synced_unit_db`), so your instrument mappings and synced sounds are never lost when refreshing.

### 📚 Full Hardware Unit Synchronization & Librarian
- **Complete 6-Stage Master Unit Sync:** Deep hardware dump reading your entire synthesizer in ~25–30 seconds:
  1. **Setup & System Parameters:** Synthesizer mode, bank MSB/LSB, master tuning, system common, and 2-band EQ.
  2. **Active Performance & 16 Parts:** Performance common, 3-MFX processors, Chorus, Reverb, and all 16 part assignments.
  3. **Active Part Patches & Waveforms:** Common, TMT structures, and all 4 Tones with waveform mappings across all 16 parts, with intelligent Rhythm Kit detection (avoiding unmapped drum part errors).
  4. **All 64 User Performances:** Reads all 64 user performance headers and automatically populates the quick-selection dropdown.
  5. **All 128 User Patches:** Reads all 128 user patch headers and populates the patch selection dropdown and librarian inventory.
  6. **All 4 User Rhythm Sets:** Reads user drum kit structures.
- **Interactive Dropdown Switching:** Instant hardware switching from User Performance and User Patch selectors, updating the editor and synthesizer in real time.
- **Sysex Export & Import:** Export individual sounds or complete backup archives as standard `.syx` files for safekeeping and sharing.
- **Live SysEx Monitor:** Built-in diagnostic traffic monitor displaying incoming and outgoing MIDI packets in real time.

---

## Quick Start Guide

### Requirements
- A **Roland XV-5050** synthesizer connected to your computer via USB (using our open-source USB driver) or via a standard MIDI interface.
- A modern web browser with Web MIDI support: **Google Chrome**, **Microsoft Edge**, **Opera**, or **Brave**.

### Getting Started in 3 Steps
1. Open [`index.html`](index.html) in your browser (or double-click the file locally).
2. When prompted by your browser, grant permission for **MIDI devices** and **System Exclusive (SysEx)** access.
3. In the top System Drawer:
   - Select your MIDI **Input** and **Output** ports (e.g. `XV-5050`).
   - Click **Connect**.
4. That's it! Tweak parameters, program multi-effects, or click **⇄ Sync Unit** to synchronize your entire hardware unit into the editor.

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
│   ├── librarian.js       # Binary .syx file export, import, and memory snapshot manager
│   ├── mfx_data.js        # Roland 90-algorithm MFX catalog and dynamic parameter definitions
│   ├── midi.js            # Web MIDI connection manager with serialized queue and retry resilience
│   ├── parameters.js      # Parameter metadata, human-readable labels, and formatters
│   ├── patch.js           # Patch Common, Effects, TMT, Modulation Matrix, and Tone data engines
│   ├── performance.js     # Performance Common, 3-MFX, Chorus, Reverb, and 16-Part mixer engines
│   ├── state.js           # Central reactive state store
│   ├── sysex.js           # Roland SysEx checksum calculation and packet builders/parsers
│   ├── unit_sync.js       # Multi-stage full unit synchronization and SysEx dump engine
│   ├── usb_hardware.js    # Hardware auto-detection, resilience, and diagnostic test suite
│   ├── visuals.js         # Real-time SVG path generators for envelopes, filters, and LFOs
│   └── waveforms.js       # Complete 1,083 internal PCM waveform catalog
├── tests/                 # Automated test suite (112 unit tests + Playwright E2E hardware verification)
├── index.html             # Application entry point
├── package.json           # Development scripts and test runner
└── README.md              # Documentation
```

---

## Development & Testing

This project runs 100% client-side with no mandatory build steps required for end users. For developers working on the source:

```bash
# Install development tooling (esbuild, playwright)
npm install

# Build the client-side bundle
npm run build

# Run the 112 automated unit test suites
npm test

# Run the end-to-end browser test against attached physical XV-5050 hardware
npm run test:e2e
```

---

## License

This project is open-source software released under the [MIT License](LICENSE).
Roland and XV-5050 are trademarks of Roland Corporation. This project is an independent, community-driven tool and is not affiliated with or endorsed by Roland Corporation.
