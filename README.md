# Roland XV-5050 Web Synthesizer Editor & Librarian

A modern, responsive Web MIDI sound editor and patch librarian for the **Roland XV-5050** synthesizer module. Runs entirely in your browser using the Web MIDI API with full bi-directional System Exclusive (SysEx) communication — no installations, plugins, or backend servers required.

---

## Highlights & Features

### 🎛️ Modern Synth Dashboard & Visual Scopes
- **Compact Modular Synth Layout:** Inspired by contemporary synthesizers and DAWs (Serum, Vital, Pigments), all essential sound sculpting controls are organized into a high-density, ergonomic dashboard.
- **Real-Time Visual Curves:**
  - **TVF Filter Response Scopes:** Dynamic frequency curve visualization for all filter modes (LPF, HPF, BPF, PKG) responsive to cutoff and resonance adjustments.
  - **Multi-Stage Envelopes:** Interactive ADSR curves for Pitch, TVF Filter, and TVA Amplifier envelopes.
  - **LFO Oscilloscopes:** Real-time waveform preview showing cycle speed and shape (Triangle, Sine, Sawtooth, Square, Sample & Hold, Random, Step).

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

### ⚡ Live Parameter Reflection & Auditioning
- **Real-Time Hardware Response:** Move any slider to hear the sound alter immediately on your physical synthesizer. Edits are transmitted via smooth, throttled SysEx packets that never choke the MIDI buffer.
- **Hardware Mode Switching:** Seamlessly toggle the physical XV-5050 between **Single Patch Mode** and **16-Part Performance Mode** with one click on the top rack bar.
- **Audition Note & Emergency Panic:** Play test notes directly from the toolbar, or trigger an instant All-Notes-Off / All-Sound-Off reset across all 16 channels.
- **Collapsible System Drawer:** A clean roll-up / roll-down header keeps connection settings, Device IDs, and MIDI ports organized without crowding your workspace.

### 🔬 Deep Sound Architecture & Tone Generators
- **4 Tone Engine:** Independently configure Wave, TVF Filter, TVA Amplifier, Envelopes, and dual LFOs for all 4 Tones in a Patch.
- **1,083 Waveform Catalog:** Full browsable database of Roland's 1,083 internal PCM waveforms, cleanly organized by instrument family and name (Acoustic Pianos, Electric Pianos, Strings, Guitars, Synths, Brass, Percussion).
- **Tone Mix Table (TMT):** Structure types 1–10 (independent routing for Tones 1 & 2 and Tones 3 & 4), ring modulators, booster levels (+0 dB to +18 dB), and key/velocity split zones.
- **4-Slot Modulation Matrix:** Easily route physical controllers (Mod Wheel, Aftertouch, Velocity, Pitch Bend, LFOs, Envelopes) to sound destinations (Cutoff, Resonance, Pitch, Level, Pan, Effects) with human-readable musical labels.

### 📚 Patch Librarian & Sysex Tools
- **Unit Master Sync:** Read all User Performances and Patches from your hardware into a searchable database in seconds.
- **Bank & Preset Management:** Jump directly between User and Preset sounds or write edited patches directly into any hardware user memory slot.
- **Sysex Export & Import:** Export individual sounds or complete banks as standard `.syx` files for safekeeping and sharing.
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
4. That's it! Tweak parameters, switch modes, or click **⇄ Sync Unit** to pull your entire synth library into the editor.

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
│   ├── midi.js            # Web MIDI connection manager with retry resilience and traffic monitor
│   ├── parameters.js      # Parameter metadata, human-readable labels, and formatters
│   ├── patch.js           # Patch Common, TMT, Modulation Matrix, and Tone data engines
│   ├── performance.js     # Performance Common, Effects, and 16-Part mixer engines
│   ├── state.js           # Central reactive state store
│   ├── sysex.js           # Roland SysEx checksum calculation and packet builders/parsers
│   ├── visuals.js         # Real-time SVG path generators for envelopes, filters, and LFOs
│   └── waveforms.js       # Complete 1,083 internal PCM waveform catalog
├── tests/                 # Automated test suite (104 tests validating SysEx and sound engine)
├── index.html             # Application entry point
├── package.json           # Development scripts and test runner
└── README.md              # Documentation
```

---

## Development & Testing

This project runs 100% client-side with no mandatory build steps required for end users. For developers working on the source:

```bash
# Install development tooling (esbuild)
npm install

# Build the client-side bundle
npm run build

# Run the 104 automated test suites
npm test
```

---

## License

This project is open-source software released under the [MIT License](LICENSE).
Roland and XV-5050 are trademarks of Roland Corporation. This project is an independent, community-driven tool and is not affiliated with or endorsed by Roland Corporation.
