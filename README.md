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
- **Compact Synth Rack Header & Mode Switcher**
  - **Hardware Sound Mode Switching**: Switch physical hardware unit in and out of **Patch Mode** and **Performance Mode** instantly via SysEx DT1 (`01 00 00 00`: `0x01` = Patch, `0x02` = Perform)
  - Automatic sound mode detection from hardware on connect
  - Mode indicator pill with active neon status indicator in the top rack bar
  - **Collapsible System Drawer**: Roll-up / roll-down drawer for MIDI I/O ports, Device ID, and connection status, keeping the interface compact and focused on sound design
  - Quick Audition Note trigger (C4) and Emergency Panic (All Sound Off / All Notes Off / Reset Controllers across all 16 MIDI channels)
  - One-click master unit sync button
- **Real-Time Hardware Parameter Reflection**
  - **Dynamic Buffer Addressing**: Automatically detects current operating mode via `getEffectivePatchPart()`:
    - In **Patch Mode**: Routes parameter edits directly to Patch Temporary Area (`1F 00 00 00`)
    - In **Performance Mode**: Routes parameter edits to the selected Part's Temporary Area (`11 xx 00 00`)
  - **Throttled Live Streaming**: Sliders and controls transmit live SysEx DT1 messages on user drag (`input` event throttled to 25ms) and commit on release (`change` event), providing instant audible feedback on the physical synthesizer without flooding the MIDI buffer
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
├── dist/
│   └── editor.js          # Standalone client-side bundle (allows direct file:/// execution)
├── src/
│   ├── addresses.js       # Complete 7-bit parameter address map conforming to official specification
│   ├── app.js             # Application controller and UI event wiring
│   ├── librarian.js       # Binary .syx export/import & memory snapshot manager
│   ├── midi.js            # Web MIDI connection manager with traffic logging and panic
│   ├── parameters.js      # Parameter metadata, ranges, enum labels, and formatters
│   ├── patch.js           # Patch Common, TMT, Matrix Control & Tone data managers
│   ├── performance.js     # Performance Common, Effects, and Parts data managers
│   ├── state.js           # Central observable store
│   ├── sysex.js           # Checksum calculation, DT1/RQ1 builders, and SysEx parser
│   └── visuals.js         # Real-time dynamic SVG envelope, filter, and LFO curve renderer
├── tests/
│   ├── addresses.test.js  # Address layout and 7-bit math tests
│   ├── librarian.test.js  # .syx file export/import and binary SysEx tests
│   ├── midi_implementation_deep.test.js # Exhaustive boundary and multi-part stepping tests
│   ├── midi_integration.test.js         # End-to-end simulated hardware request/response flows
│   ├── parameters.test.js # Value formatting and parsing tests
│   ├── stage2_features.test.js          # Modulation matrix, TMT zones, envelopes & effects tests
│   ├── sysex.test.js      # SysEx message builders, parsers, and checksum tests
│   └── visuals.test.js    # SVG path math and generator tests
├── index.html             # Application entry point
├── package.json           # Project manifest and test runner
└── README.md
```

---

## 100% Client-Side / Running in Browser

This application is **strictly client-side** with **zero server dependencies**. There is no backend, server process, or local server required.

To use the editor:
1. Open `index.html` directly in your browser (or double-click from your file manager) using any browser supporting the Web MIDI API:
   - Google Chrome
   - Microsoft Edge
   - Opera
2. When prompted, grant MIDI permission with System Exclusive (`sysex: true`) access.
3. Select your MIDI interface Input and Output ports, set your Device ID (default `17` / `0x10`), and click **Connect**.

All SysEx encoding, checksum calculations, tone generation parameters, real-time SVG curve renderings, and `.syx` librarian operations execute 100% client-side within the browser.

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
- Full unit master sync (all 6 stages), hardware diagnostic tests, and patch librarians (104 / 104 tests passing)

---

## Recent Fixes & Improvements

- **Hardware Sound Mode Switching (`01 00 00 00`)**: Added direct mode switching between Single Patch Mode (`0x01`) and 16-Part Performance Mode (`0x02`), updating the front panel of the physical unit in real time.
- **Physical Parameter Reflection in Patch & Performance Modes**: Solved the issue where editing patch parameters did not alter the physical synth's sound when in Patch Mode. Parameter edits now dynamically route to `1F 00 00 00` (Patch Mode) or `11 xx 00 00` (Performance Mode Parts 1–16).
- **Throttled Live Slider SysEx Streaming**: Sliders now broadcast on `input` throttled to 25ms, allowing smooth filter cutoff sweeps, resonance adjustments, envelope shaping, and level balancing directly on the XV-5050 hardware without lag or buffer overruns.
- **Slick Compact Synth Rack UI**: Redesigned header into a 48px hardware rack bar with mode switcher buttons, audition trigger, panic, and a collapsible roll-up/roll-down system drawer for connection settings.
- **Asynchronous Port Open & Buffer Settling**: Added a settling delay after Web MIDI port opening to ensure the Windows MIDI subsystem and driver threads are fully armed before communication begins.
- **SysEx Permission Detection**: Automatically validates `midi.sysexEnabled` and guides the user to grant System Exclusive site permissions in Chrome / Edge.
- **Single-Listener Event Pipeline**: Removed redundant listener bindings preventing duplicate SysEx message dispatch.
- **Clean Stream Reassembly**: SysEx parser resets on incoming `0xF0` and dispatches complete packets cleanly.
- **Adaptive Retry & Backoff**: Hardware queries automatically retry with exponential backoff (`100ms * attempt`) if the synthesizer is busy processing prior operations.

---

## License

MIT
