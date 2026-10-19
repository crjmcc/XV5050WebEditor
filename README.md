# XV-5050 Web Synthesizer Editor

A lightweight, high-performance Web MIDI editor for the XV-5050 synthesizer module. Runs 100% client-side in the browser using the Web MIDI API with System Exclusive (SysEx) support — no backend server or installation required.

---

## Features

### Stage 1: Performance & Patch Editing (Current)
- **Web MIDI Connectivity**
  - Automatic input and output device discovery with hotplug detection
  - Configurable Device ID (17–32 / `0x10`–`0x1F`, default `17`)
  - Real-time connection status indicator
  - Audition Note trigger (C4) and Emergency Panic (All Sound Off / All Notes Off / Reset Controllers across all 16 MIDI channels)
- **Performance Editor**
  - Performance Common parameters: Performance Name (12 characters), Solo Part Select, MFX Control Channel, MFX-A Source, Chorus Source, Reverb Source
  - Performance Chorus processor: Type (OFF, CHORUS, DELAY, GM2 CHORUS), Level (0–127), Output Assign, Output Select
  - Performance Reverb processor: Type (OFF, REVERB, SRV ROOM, SRV HALL, SRV PLATE, GM2 REVERB), Level (0–127), Output Assign
  - 16 Performance Parts table:
    - Receive Switch (On/Off)
    - MIDI Channel (1–16)
    - Patch Bank Select MSB (CC#0) & LSB (CC#32)
    - Program Change (PC 1–128)
    - Part Level (0–127) & Pan (L64–Center–R63)
    - Coarse Tune (-48 to +48 semitones) & Fine Tune (-50 to +50 cents)
    - Chorus Send (0–127) & Reverb Send (0–127)
    - Output Assign (MFX, A, B, C, D, 1–8, PATCH)
    - Part Mute toggle
    - Individual part read and instant jump-to-patch editing
  - Batch "Load All 16 Parts" with hardware buffer throttle and progress indicator
- **Patch & Tone Overview**
  - Target Patch Area selector: Parts 1–16 (temporary performance buffers) or Single Patch Mode (`1F 00 00 00`)
  - Patch Common parameters: Patch Name (12 characters), Category, Level, Pan, Coarse Tune, Fine Tune, Octave Shift, Mono/Poly, Legato, Portamento, Pitch Bend Range Up/Down, Output Assign
  - Tone Mix Table (TMT):
    - Structure Types 1–10 (independent for Tones 1 & 2, and Tones 3 & 4)
    - Booster Levels (0 dB, +6 dB, +12 dB, +18 dB)
    - 4 Tone Generator On/Off switches
  - Tone Basic Editor:
    - Level, Pan, Coarse Tune, Fine Tune
    - TVF Filter Type (OFF, LPF, BPF, HPF, PKG, LPF2, LPF3)
    - TVF Cutoff & Resonance
    - TVA Level
- **Real-Time SysEx Monitor**
  - Monospaced traffic log of all outgoing (TX) and incoming (RX) SysEx (RQ1, DT1) and MIDI messages
  - Address, payload length, and formatted hexadecimal dump

---

## Architecture & Technology Stack

- **Pure Client-Side**: Vanilla HTML5, CSS3, and JavaScript (ES Modules). No build step required to run.
- **Web MIDI API**: Uses `navigator.requestMIDIAccess({ sysex: true })` for bi-directional hardware communication.
- **Zero Server Footprint**: Runs completely locally or on any static file host (e.g., GitHub Pages).

### Project Layout
```
├── css/
│   └── style.css          # Dark synth-inspired design system with CSS custom properties
├── src/
│   ├── addresses.js       # Complete 7-bit parameter address map conforming to official specification
│   ├── app.js             # Application controller and UI event wiring
│   ├── midi.js            # Web MIDI connection manager with traffic logging and panic
│   ├── parameters.js      # Parameter metadata, ranges, enum labels, and formatters
│   ├── patch.js           # Patch Common, TMT, and Tone data managers
│   ├── performance.js     # Performance Common, Effects, and Parts data managers
│   ├── state.js           # Central observable store
│   └── sysex.js           # Checksum calculation, DT1/RQ1 builders, and SysEx parser
├── tests/
│   ├── addresses.test.js  # Address layout and 7-bit math tests
│   ├── midi_implementation_deep.test.js # Exhaustive boundary and multi-part stepping tests
│   ├── midi_integration.test.js         # End-to-end simulated hardware request/response flows
│   ├── parameters.test.js # Value formatting and parsing tests
│   └── sysex.test.js      # SysEx message builders, parsers, and checksum tests
├── index.html             # Application entry point
├── package.json           # Project manifest and test runner
└── README.md
```

---

## Running Locally

Because this application uses standard ES Modules, serve the folder with any static web browser or local static server:

```bash
# Python (built-in)
python -m http.server 8000

# or Node.js npx
npx serve .
```

Open `http://localhost:8000` in Google Chrome, Microsoft Edge, or Opera (browsers supporting Web MIDI with SysEx).

---

## Test Suite

The project includes an automated test suite executed with Node's built-in test runner (no dependencies required):

```bash
npm test
```

The test suite validates:
- SysEx checksum calculation and boundary conditions
- Exact DT1 and RQ1 packet construction against specification examples
- 7-bit arithmetic and address carry calculations
- Part base address progression (`10 00 20 00` through `10 00 2F 00`)
- Temporary patch address layouts across all 16 parts (`11 00 00 00` through `14 60 00 00`) and single mode (`1F 00 00 00`)
- Full simulation of hardware RQ1 read requests and DT1 write updates
- Formatting for bipolar pan (`L64`–`C`–`R63`), signed semitones/cents, and enum lookups

---

## License

MIT
