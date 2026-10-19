(() => {
  // src/sysex.js
  var SYSEX_START = 240;
  var SYSEX_END = 247;
  var MANUFACTURER_ID = 65;
  var MODEL_ID = [0, 16];
  var DEFAULT_DEVICE_ID = 16;
  var CMD_RQ1 = 17;
  var CMD_DT1 = 18;
  function calculateChecksum(bytes) {
    if (!Array.isArray(bytes) || bytes.length === 0) {
      throw new Error("Checksum requires a non-empty array of bytes");
    }
    const sum = bytes.reduce((acc, byte) => acc + (byte & 127), 0);
    const checksum = 128 - sum % 128;
    return checksum === 128 ? 0 : checksum;
  }
  function validateChecksum(bytes, checksum) {
    return calculateChecksum(bytes) === checksum;
  }
  function buildDT1(address, data, deviceId = DEFAULT_DEVICE_ID) {
    validateAddress(address);
    validateDeviceId(deviceId);
    if (!Array.isArray(data) || data.length === 0) {
      throw new Error("Data must be a non-empty array");
    }
    const checksumBytes = [...address, ...data];
    const checksum = calculateChecksum(checksumBytes);
    return new Uint8Array([
      SYSEX_START,
      MANUFACTURER_ID,
      deviceId,
      ...MODEL_ID,
      CMD_DT1,
      ...address,
      ...data,
      checksum,
      SYSEX_END
    ]);
  }
  function buildRQ1(address, size, deviceId = DEFAULT_DEVICE_ID) {
    validateAddress(address);
    if (!Array.isArray(size) || size.length !== 4) {
      throw new Error("Size must be a 4-byte array");
    }
    validateDeviceId(deviceId);
    const checksumBytes = [...address, ...size];
    const checksum = calculateChecksum(checksumBytes);
    return new Uint8Array([
      SYSEX_START,
      MANUFACTURER_ID,
      deviceId,
      ...MODEL_ID,
      CMD_RQ1,
      ...address,
      ...size,
      checksum,
      SYSEX_END
    ]);
  }
  function parseSysEx(message) {
    if (!(message instanceof Uint8Array) && !Array.isArray(message)) {
      throw new Error("Message must be a Uint8Array or Array");
    }
    const bytes = Array.from(message);
    if (bytes.length < 13) {
      return { valid: false, error: "Message too short" };
    }
    if (bytes[0] !== SYSEX_START) {
      return { valid: false, error: "Missing SysEx start byte" };
    }
    if (bytes[bytes.length - 1] !== SYSEX_END) {
      return { valid: false, error: "Missing SysEx end byte" };
    }
    if (bytes[1] !== MANUFACTURER_ID) {
      return { valid: false, error: `Wrong manufacturer ID: 0x${bytes[1].toString(16)}` };
    }
    const deviceId = bytes[2];
    if (bytes[3] !== MODEL_ID[0] || bytes[4] !== MODEL_ID[1]) {
      return { valid: false, error: `Wrong model ID: 0x${bytes[3].toString(16)} 0x${bytes[4].toString(16)}` };
    }
    const command = bytes[5];
    if (command !== CMD_DT1 && command !== CMD_RQ1) {
      return { valid: false, error: `Unknown command: 0x${command.toString(16)}` };
    }
    const address = bytes.slice(6, 10);
    const data = bytes.slice(10, bytes.length - 2);
    const receivedChecksum = bytes[bytes.length - 2];
    const checksumBytes = [...address, ...data];
    const valid = validateChecksum(checksumBytes, receivedChecksum);
    return {
      valid,
      command,
      address,
      data,
      deviceId,
      error: valid ? null : "Invalid checksum"
    };
  }
  function formatSysEx(message) {
    return Array.from(message).map((b) => b.toString(16).toUpperCase().padStart(2, "0")).join(" ");
  }
  function validateAddress(address) {
    if (!Array.isArray(address) || address.length !== 4) {
      throw new Error("Address must be a 4-byte array");
    }
    for (const byte of address) {
      if (byte < 0 || byte > 127) {
        throw new Error(`Address byte out of range: 0x${byte.toString(16)}`);
      }
    }
  }
  function validateDeviceId(deviceId) {
    if (deviceId < 0 || deviceId > 31) {
      throw new Error(`Device ID out of range: 0x${deviceId.toString(16)}`);
    }
  }

  // src/midi.js
  var MidiManager = class {
    constructor() {
      this._midiAccess = null;
      this._input = null;
      this._output = null;
      this._onMessage = null;
      this._onStateChange = null;
      this._connected = false;
      this._onTraffic = null;
      this._handleMidiMessage = this._handleMidiMessage.bind(this);
      this._handleStateChange = this._handleStateChange.bind(this);
    }
    /**
     * Subscribe to raw MIDI traffic for monitoring (direction: 'TX' | 'RX', bytes: Uint8Array|number[]).
     * @param {Function} callback - (direction, bytes, timestamp) => void
     */
    onTraffic(callback) {
      this._onTraffic = callback;
    }
    /**
     * Send a SysEx message to the connected output device.
     * 
     * @param {Uint8Array} message - Complete SysEx message bytes
     */
    send(message) {
      if (!this._output) {
        console.error("No MIDI output connected");
        return;
      }
      const arr = Array.from(message);
      if (this._onTraffic) {
        this._onTraffic("TX", arr, Date.now());
      }
      this._output.send(arr);
    }
    /**
     * Send raw MIDI bytes (e.g. Channel Voice messages).
     * @param {number[]} bytes - Raw MIDI message bytes
     */
    sendRaw(bytes) {
      if (!this._output) return;
      if (this._onTraffic) {
        this._onTraffic("TX", bytes, Date.now());
      }
      this._output.send(bytes);
    }
    /**
     * Send Note On to audition a part/channel.
     * @param {number} channel - 0-15
     * @param {number} note - Note number (0-127, e.g. 60 = Middle C)
     * @param {number} [velocity=100] - Velocity (1-127)
     */
    sendNoteOn(channel, note = 60, velocity = 100) {
      this.sendRaw([144 | channel & 15, note & 127, velocity & 127]);
    }
    /**
     * Send Note Off.
     * @param {number} channel - 0-15
     * @param {number} note - Note number (0-127)
     */
    sendNoteOff(channel, note = 60) {
      this.sendRaw([128 | channel & 15, note & 127, 0]);
    }
    /**
     * Send All Notes Off & Reset Controllers (Panic) on all channels or specific channel.
     * @param {number} [channel] - Optional specific channel (0-15)
     */
    sendAllNotesOff(channel) {
      const channels = channel !== void 0 && channel >= 0 && channel <= 15 ? [channel] : Array.from({ length: 16 }, (_, i) => i);
      for (const ch of channels) {
        this.sendRaw([176 | ch, 120, 0]);
        this.sendRaw([176 | ch, 123, 0]);
        this.sendRaw([176 | ch, 121, 0]);
      }
    }
    /**
     * Send a SysEx message and wait for a reply within a timeout.
     * Returns the first valid parsed SysEx response.
     * 
     * @param {Uint8Array} message - SysEx message to send
     * @param {number} [timeout=2000] - Timeout in milliseconds
     * @returns {Promise<object>} Parsed SysEx response
     */
    sendAndReceive(message, timeout = 2e3) {
      return new Promise((resolve, reject) => {
        const previousHandler = this._onMessage;
        const timer = setTimeout(() => {
          this._onMessage = previousHandler;
          reject(new Error("SysEx response timeout"));
        }, timeout);
        this._onMessage = (parsed) => {
          if (parsed.valid) {
            clearTimeout(timer);
            this._onMessage = previousHandler;
            resolve(parsed);
          }
        };
        this.send(message);
      });
    }
    /**
     * Set the callback for incoming SysEx messages.
     * The callback receives a parsed SysEx object.
     * 
     * @param {Function} callback - Function receiving parsed SysEx data
     */
    onSysEx(callback) {
      this._onMessage = callback;
    }
    /**
     * Set the callback for device state changes (connect/disconnect).
     * 
     * @param {Function} callback - Function receiving state change info
     */
    onStateChange(callback) {
      this._onStateChange = callback;
    }
    /** @returns {boolean} True if input and output are connected */
    get isConnected() {
      return this._connected && this._input !== null && this._output !== null;
    }
    /** @returns {string|null} Connected input device name */
    get inputName() {
      return this._input?.name || null;
    }
    /** @returns {string|null} Connected output device name */
    get outputName() {
      return this._output?.name || null;
    }
    // -- Internal handlers --
    _handleMidiMessage(event) {
      const data = event.data;
      if (this._onTraffic) {
        this._onTraffic("RX", Array.from(data), Date.now());
      }
      if (data[0] !== 240) return;
      const parsed = parseSysEx(data);
      if (this._onMessage) {
        this._onMessage(parsed);
      }
    }
    _handleStateChange(event) {
      const port = event.port;
      console.log(`MIDI ${port.type} "${port.name}" ${port.state}`);
      if (port.state === "disconnected") {
        if (this._input && port.id === this._input.id) {
          this._connected = false;
        }
        if (this._output && port.id === this._output.id) {
          this._connected = false;
        }
      }
      if (this._onStateChange) {
        this._onStateChange({
          type: port.type,
          name: port.name,
          state: port.state,
          id: port.id
        });
      }
    }
  };

  // src/state.js
  var Store = class {
    constructor(initialState = {}) {
      this._state = structuredClone(initialState);
      this._listeners = /* @__PURE__ */ new Map();
      this._globalListeners = /* @__PURE__ */ new Set();
    }
    /**
     * Get the current state (read-only copy).
     * @returns {object}
     */
    get state() {
      return this._state;
    }
    /**
     * Get a nested value using dot notation.
     * @param {string} path - Dot-separated path, e.g. 'performance.common.name'
     * @returns {*}
     */
    get(path) {
      return path.split(".").reduce((obj, key) => obj?.[key], this._state);
    }
    /**
     * Set a nested value using dot notation and notify listeners.
     * @param {string} path - Dot-separated path
     * @param {*} value - New value
     */
    set(path, value) {
      const keys = path.split(".");
      let obj = this._state;
      for (let i = 0; i < keys.length - 1; i++) {
        if (obj[keys[i]] === void 0) {
          obj[keys[i]] = {};
        }
        obj = obj[keys[i]];
      }
      const lastKey = keys[keys.length - 1];
      const oldValue = obj[lastKey];
      obj[lastKey] = value;
      this._notify(path, value, oldValue);
    }
    /**
     * Update multiple values at once.
     * @param {object} updates - Object with path:value pairs
     */
    batchUpdate(updates) {
      for (const [path, value] of Object.entries(updates)) {
        this.set(path, value);
      }
    }
    /**
     * Subscribe to changes on a specific state path.
     * @param {string} path - Dot-separated path to watch
     * @param {Function} callback - Called with (newValue, oldValue, path)
     * @returns {Function} Unsubscribe function
     */
    subscribe(path, callback) {
      if (!this._listeners.has(path)) {
        this._listeners.set(path, /* @__PURE__ */ new Set());
      }
      this._listeners.get(path).add(callback);
      return () => {
        this._listeners.get(path)?.delete(callback);
      };
    }
    /**
     * Subscribe to all state changes.
     * @param {Function} callback - Called with (path, newValue, oldValue)
     * @returns {Function} Unsubscribe function
     */
    subscribeAll(callback) {
      this._globalListeners.add(callback);
      return () => {
        this._globalListeners.delete(callback);
      };
    }
    _notify(path, newValue, oldValue) {
      const listeners = this._listeners.get(path);
      if (listeners) {
        for (const cb of listeners) {
          cb(newValue, oldValue, path);
        }
      }
      const parts = path.split(".");
      for (let i = parts.length - 1; i > 0; i--) {
        const parentPath = parts.slice(0, i).join(".");
        const parentListeners = this._listeners.get(parentPath);
        if (parentListeners) {
          for (const cb of parentListeners) {
            cb(this.get(parentPath), void 0, parentPath);
          }
        }
      }
      for (const cb of this._globalListeners) {
        cb(path, newValue, oldValue);
      }
    }
  };
  var DEFAULT_STATE = {
    // MIDI connection
    midi: {
      inputId: null,
      outputId: null,
      connected: false,
      deviceId: 16
      // XV-5050 device ID (0x10-0x1F)
    },
    // Currently loaded performance
    performance: {
      loaded: false,
      common: {
        name: "INITIAL PERF",
        soloPartSelect: 0,
        mfxCtrlChannel: 0,
        mfxCtrlMidi1: 0,
        mfxCtrlMidi2: 0,
        mfxASource: 0,
        chorusSource: 0,
        reverbSource: 0
      },
      chorus: {
        chorusType: 1,
        // CHORUS
        chorusLevel: 64,
        outputAssign: 0,
        outputSelect: 0
      },
      reverb: {
        reverbType: 1,
        // REVERB
        reverbLevel: 64,
        outputAssign: 0
      },
      parts: Array.from({ length: 16 }, (_, i) => ({
        receiveSwitch: 1,
        receiveChannel: i,
        patchBankMSB: 87,
        // Preset A default
        patchBankLSB: 64,
        patchPC: 1,
        partLevel: 100,
        partPan: 64,
        coarseTune: 64,
        fineTune: 64,
        monoPoly: 1,
        legatoSwitch: 0,
        pitchBendRange: 2,
        portamentoSwitch: 0,
        cutoffOffset: 64,
        resonanceOffset: 64,
        attackTimeOffset: 64,
        releaseTimeOffset: 64,
        octaveShift: 64,
        velocitySensOffset: 64,
        keyRangeLower: 0,
        keyRangeUpper: 127,
        muteSwitch: 0,
        drySendLevel: 127,
        chorusSend: 0,
        reverbSend: 40,
        outputAssign: 0,
        outputMfxSelect: 0,
        decayTimeOffset: 64
      }))
    },
    // Currently loaded patch (for selected part or single patch mode)
    patch: {
      loaded: false,
      part: 1,
      // 1-16 for performance part, 0 for single patch mode
      common: {
        name: "INITIAL PATCH",
        patchCategory: 0,
        toneType: 0,
        patchLevel: 127,
        patchPan: 64,
        patchPriority: 0,
        coarseTune: 64,
        fineTune: 64,
        octaveShift: 64,
        stretchTuneDepth: 0,
        analogFeel: 0,
        monoPoly: 1,
        legatoSwitch: 0,
        legatoRetrigger: 0,
        portamentoSwitch: 0,
        portamentoMode: 0,
        portamentoType: 0,
        portamentoTime: 0,
        outputAssign: 0,
        bendRangeUp: 2,
        bendRangeDown: 2
      },
      tmt: {
        structureType12: 0,
        booster12: 0,
        structureType34: 0,
        booster34: 0,
        tone1Switch: 1,
        tone2Switch: 1,
        tone3Switch: 0,
        tone4Switch: 0
      },
      tones: [
        { toneLevel: 127, coarseTune: 64, fineTune: 64, tonePan: 64, waveGroupType: 0, waveGain: 1, tvfFilterType: 1, tvfCutoff: 127, tvfResonance: 0, tvaLevel: 127 },
        { toneLevel: 127, coarseTune: 64, fineTune: 64, tonePan: 64, waveGroupType: 0, waveGain: 1, tvfFilterType: 1, tvfCutoff: 127, tvfResonance: 0, tvaLevel: 127 },
        { toneLevel: 127, coarseTune: 64, fineTune: 64, tonePan: 64, waveGroupType: 0, waveGain: 1, tvfFilterType: 1, tvfCutoff: 127, tvfResonance: 0, tvaLevel: 127 },
        { toneLevel: 127, coarseTune: 64, fineTune: 64, tonePan: 64, waveGroupType: 0, waveGain: 1, tvfFilterType: 1, tvfCutoff: 127, tvfResonance: 0, tvaLevel: 127 }
      ]
    },
    // UI state
    ui: {
      currentTab: "performance",
      // 'performance' | 'patch' | 'sysex'
      selectedPart: 1,
      selectedTone: 1,
      status: "Disconnected",
      logs: []
    }
  };
  function createStore() {
    return new Store(structuredClone(DEFAULT_STATE));
  }

  // src/parameters.js
  var PERF_COMMON_PARAMS = {
    SOLO_PART_SELECT: {
      name: "Solo Part Select",
      min: 0,
      max: 16,
      type: "enum",
      enumValues: ["OFF", "1", "2", "3", "4", "5", "6", "7", "8", "9", "10", "11", "12", "13", "14", "15", "16"]
    },
    MFX_CTRL_CHANNEL: {
      name: "MFX Control Channel",
      min: 0,
      max: 16,
      type: "enum",
      enumValues: ["1", "2", "3", "4", "5", "6", "7", "8", "9", "10", "11", "12", "13", "14", "15", "16", "OFF"]
    },
    MFXA_SOURCE: { name: "MFX-A Source", min: 0, max: 16, type: "enum", enumValues: ["PERFORM", ...Array.from({ length: 16 }, (_, i) => `PART ${i + 1}`)] },
    CHORUS_SOURCE: { name: "Chorus Source", min: 0, max: 16, type: "enum", enumValues: ["PERFORM", ...Array.from({ length: 16 }, (_, i) => `PART ${i + 1}`)] },
    REVERB_SOURCE: { name: "Reverb Source", min: 0, max: 16, type: "enum", enumValues: ["PERFORM", ...Array.from({ length: 16 }, (_, i) => `PART ${i + 1}`)] }
  };
  var PERF_PART_PARAMS = {
    RECEIVE_CHANNEL: {
      name: "MIDI Channel",
      min: 0,
      max: 15,
      type: "enum",
      enumValues: ["1", "2", "3", "4", "5", "6", "7", "8", "9", "10", "11", "12", "13", "14", "15", "16"]
    },
    RECEIVE_SWITCH: { name: "Part Switch", min: 0, max: 1, type: "switch" },
    PATCH_BANK_MSB: { name: "Bank MSB", min: 0, max: 127, type: "number" },
    PATCH_BANK_LSB: { name: "Bank LSB", min: 0, max: 127, type: "number" },
    PATCH_PC: { name: "Program Number", min: 0, max: 127, type: "number" },
    PART_LEVEL: { name: "Level", min: 0, max: 127, type: "number" },
    PART_PAN: { name: "Pan", min: 0, max: 127, type: "pan" },
    COARSE_TUNE: { name: "Coarse Tune", min: 16, max: 112, type: "signed", displayOffset: -64 },
    FINE_TUNE: { name: "Fine Tune", min: 14, max: 114, type: "signed", displayOffset: -64 },
    MONO_POLY: { name: "Mono/Poly", min: 0, max: 2, type: "enum", enumValues: ["MONO", "POLY", "PATCH"] },
    LEGATO_SWITCH: { name: "Legato Switch", min: 0, max: 2, type: "enum", enumValues: ["OFF", "ON", "PATCH"] },
    PITCH_BEND_RANGE: { name: "Bend Range", min: 0, max: 25, type: "enum", enumValues: [...Array.from({ length: 25 }, (_, i) => `${i}`), "PATCH"] },
    PORTAMENTO_SWITCH: { name: "Portamento", min: 0, max: 2, type: "enum", enumValues: ["OFF", "ON", "PATCH"] },
    CUTOFF_OFFSET: { name: "Cutoff Offset", min: 0, max: 127, type: "signed", displayOffset: -64 },
    RESONANCE_OFFSET: { name: "Resonance Offset", min: 0, max: 127, type: "signed", displayOffset: -64 },
    ATTACK_TIME_OFFSET: { name: "Attack Offset", min: 0, max: 127, type: "signed", displayOffset: -64 },
    RELEASE_TIME_OFFSET: { name: "Release Offset", min: 0, max: 127, type: "signed", displayOffset: -64 },
    OCTAVE_SHIFT: { name: "Octave Shift", min: 61, max: 67, type: "signed", displayOffset: -64 },
    VELOCITY_SENS_OFFSET: { name: "Vel Sens Offset", min: 1, max: 127, type: "signed", displayOffset: -64 },
    KEY_RANGE_LOWER: { name: "Key Range Lower", min: 0, max: 127, type: "number" },
    KEY_RANGE_UPPER: { name: "Key Range Upper", min: 0, max: 127, type: "number" },
    MUTE_SWITCH: { name: "Mute", min: 0, max: 1, type: "switch" },
    DRY_SEND_LEVEL: { name: "Dry Level", min: 0, max: 127, type: "number" },
    CHORUS_SEND: { name: "Chorus Send", min: 0, max: 127, type: "number" },
    REVERB_SEND: { name: "Reverb Send", min: 0, max: 127, type: "number" },
    OUTPUT_ASSIGN: {
      name: "Output Assign",
      min: 0,
      max: 13,
      type: "enum",
      enumValues: ["MFX", "A", "B", "C", "D", "1", "2", "3", "4", "5", "6", "7", "8", "PATCH"]
    },
    OUTPUT_MFX_SELECT: { name: "MFX Select", min: 0, max: 2, type: "enum", enumValues: ["MFXA", "MFXB", "MFXC"] }
  };
  var MATRIX_SOURCES = [
    "OFF",
    ...Array.from({ length: 95 }, (_, i) => `CC${String(i + 1).padStart(2, "0")}`),
    "BEND",
    "AFT",
    "SYS1",
    "SYS2",
    "SYS3",
    "SYS4",
    "VELOCITY",
    "KEYFOLLOW",
    "TEMPO",
    "LFO1",
    "LFO2",
    "PIT-ENV",
    "TVF-ENV",
    "TVA-ENV"
  ];
  var MATRIX_DESTINATIONS = [
    "OFF",
    "PCH",
    "CUT",
    "RES",
    "LEV",
    "PAN",
    "DRY",
    "CHO",
    "REV",
    "PIT-LFO1",
    "PIT-LFO2",
    "TVF-LFO1",
    "TVF-LFO2",
    "TVA-LFO1",
    "TVA-LFO2",
    "PAN-LFO1",
    "PAN-LFO2",
    "LFO1-RATE",
    "LFO2-RATE",
    "PIT-ATK",
    "PIT-DCY",
    "PIT-REL",
    "TVF-ATK",
    "TVF-DCY",
    "TVF-REL",
    "TVA-ATK",
    "TVA-DCY",
    "TVA-REL",
    "TMT",
    "FXM",
    "MFX-CTRL1",
    "MFX-CTRL2",
    "MFX-CTRL3",
    "MFX-CTRL4"
  ];
  var LFO_WAVEFORMS = [
    "TRI",
    "SIN",
    "SAW-UP",
    "SAW-DN",
    "SQR",
    "TRP",
    "S&H",
    "RND",
    "STEP1",
    "STEP2"
  ];
  var FILTER_TYPES = [
    "OFF",
    "LPF",
    "BPF",
    "HPF",
    "PKG",
    "LPF2",
    "LPF3"
  ];
  function decodeName(bytes) {
    if (!bytes) return "";
    return bytes.map((b) => String.fromCharCode(b)).join("").trimEnd();
  }
  function encodeName(name) {
    const padded = (name || "").padEnd(12, " ").slice(0, 12);
    return Array.from(padded).map((c) => c.charCodeAt(0));
  }

  // src/addresses.js
  var PERF_TEMP = {
    COMMON: {
      BASE: [16, 0, 0, 0],
      SIZE: [0, 0, 0, 53],
      // 53 bytes
      params: {
        NAME_1: { offset: 0, size: 1 },
        // ASCII 32-127
        NAME_2: { offset: 1, size: 1 },
        NAME_3: { offset: 2, size: 1 },
        NAME_4: { offset: 3, size: 1 },
        NAME_5: { offset: 4, size: 1 },
        NAME_6: { offset: 5, size: 1 },
        NAME_7: { offset: 6, size: 1 },
        NAME_8: { offset: 7, size: 1 },
        NAME_9: { offset: 8, size: 1 },
        NAME_10: { offset: 9, size: 1 },
        NAME_11: { offset: 10, size: 1 },
        NAME_12: { offset: 11, size: 1 },
        SOLO_PART_SELECT: { offset: 12, size: 1 },
        // 0-32 (OFF, 1-16, 17-32)
        MFX_CTRL_CHANNEL: { offset: 13, size: 1 },
        // 0-16 (1-16, OFF)
        MFX_CTRL_MIDI1: { offset: 14, size: 1 },
        // 0-1 (OFF, ON)
        MFX_CTRL_MIDI2: { offset: 15, size: 1 },
        // 0-1 (OFF, ON)
        MFXA_SOURCE: { offset: 48, size: 1 },
        // 0-32 (PERFORM, 1-16, 17-32)
        MFXB_SOURCE: { offset: 49, size: 1 },
        MFXC_SOURCE: { offset: 50, size: 1 },
        CHORUS_SOURCE: { offset: 51, size: 1 },
        REVERB_SOURCE: { offset: 52, size: 1 }
      }
    },
    // Performance Common Chorus (Offset 00 04 00)
    CHORUS: {
      BASE: [16, 0, 4, 0],
      SIZE: [0, 0, 0, 52],
      // 52 bytes
      params: {
        CHORUS_TYPE: { offset: 0, size: 1 },
        // 0-3 (OFF, CHORUS, DELAY, GM2 CHORUS)
        CHORUS_LEVEL: { offset: 1, size: 1 },
        // 0-127
        OUTPUT_ASSIGN: { offset: 2, size: 1 },
        // 0-3 (A, B, C, D)
        OUTPUT_SELECT: { offset: 3, size: 1 }
        // 0-2 (MAIN, REV, MAIN+REV)
      }
    },
    // Performance Common Reverb (Offset 00 06 00)
    REVERB: {
      BASE: [16, 0, 6, 0],
      SIZE: [0, 0, 0, 83],
      // 83 bytes
      params: {
        REVERB_TYPE: { offset: 0, size: 1 },
        // 0-5 (OFF, REVERB, SRV ROOM, SRV HALL, SRV PLATE, GM2 REVERB)
        REVERB_LEVEL: { offset: 1, size: 1 },
        // 0-127
        OUTPUT_ASSIGN: { offset: 2, size: 1 }
        // 0-3 (A, B, C, D)
      }
    }
  };
  function getPartAddress(part) {
    if (part < 1 || part > 16) {
      throw new Error(`Part number must be 1-16, got ${part}`);
    }
    return [16, 0, 32 + (part - 1), 0];
  }
  var PERF_PART = {
    SIZE: [0, 0, 0, 49],
    // 49 bytes
    params: {
      RECEIVE_CHANNEL: { offset: 0, size: 1 },
      // 0-15 (1-16)
      RECEIVE_SWITCH: { offset: 1, size: 1 },
      // 0-1 (OFF, ON)
      RECEIVE_MIDI1: { offset: 2, size: 1 },
      // 0-1 (OFF, ON)
      RECEIVE_MIDI2: { offset: 3, size: 1 },
      // 0-1 (OFF, ON)
      PATCH_BANK_MSB: { offset: 4, size: 1 },
      // 0-127 (CC# 0)
      PATCH_BANK_LSB: { offset: 5, size: 1 },
      // 0-127 (CC# 32)
      PATCH_PC: { offset: 6, size: 1 },
      // 0-127 (PC 1-128)
      PART_LEVEL: { offset: 7, size: 1 },
      // 0-127 (CC# 7)
      PART_PAN: { offset: 8, size: 1 },
      // 0-127 (CC# 10, L64-63R, 64=Center)
      COARSE_TUNE: { offset: 9, size: 1 },
      // 16-112 (-48 to +48, 64=0)
      FINE_TUNE: { offset: 10, size: 1 },
      // 14-114 (-50 to +50, 64=0)
      MONO_POLY: { offset: 11, size: 1 },
      // 0-2 (MONO, POLY, PATCH)
      LEGATO_SWITCH: { offset: 12, size: 1 },
      // 0-2 (OFF, ON, PATCH)
      PITCH_BEND_RANGE: { offset: 13, size: 1 },
      // 0-25 (0-24, PATCH)
      PORTAMENTO_SWITCH: { offset: 14, size: 1 },
      // 0-2 (OFF, ON, PATCH)
      PORTAMENTO_TIME_MSB: { offset: 15, size: 1 },
      // nibble split
      PORTAMENTO_TIME_LSB: { offset: 16, size: 1 },
      // 0-128 (0-127, PATCH)
      CUTOFF_OFFSET: { offset: 17, size: 1 },
      // 0-127 (-64 to +63, 64=0)
      RESONANCE_OFFSET: { offset: 18, size: 1 },
      // 0-127 (-64 to +63, 64=0)
      ATTACK_TIME_OFFSET: { offset: 19, size: 1 },
      // 0-127 (-64 to +63, 64=0)
      RELEASE_TIME_OFFSET: { offset: 20, size: 1 },
      // 0-127 (-64 to +63, 64=0)
      OCTAVE_SHIFT: { offset: 21, size: 1 },
      // 61-67 (-3 to +3, 64=0)
      VELOCITY_SENS_OFFSET: { offset: 22, size: 1 },
      // 1-127 (-63 to +63, 64=0)
      KEY_RANGE_LOWER: { offset: 23, size: 1 },
      // 0-127 (C-1 to UPPER)
      KEY_RANGE_UPPER: { offset: 24, size: 1 },
      // 0-127 (LOWER to G9)
      KEY_FADE_LOWER: { offset: 25, size: 1 },
      // 0-127
      KEY_FADE_UPPER: { offset: 26, size: 1 },
      // 0-127
      MUTE_SWITCH: { offset: 27, size: 1 },
      // 0-1 (OFF, MUTE)
      DRY_SEND_LEVEL: { offset: 28, size: 1 },
      // 0-127
      CHORUS_SEND: { offset: 29, size: 1 },
      // 0-127 (CC# 93)
      REVERB_SEND: { offset: 30, size: 1 },
      // 0-127 (CC# 91)
      OUTPUT_ASSIGN: { offset: 31, size: 1 },
      // 0-13 (MFX, A, B, C, D, 1, 2, 3, 4, 5, 6, 7, 8, PATCH)
      OUTPUT_MFX_SELECT: { offset: 32, size: 1 },
      // 0-2 (MFXA, MFXB, MFXC)
      DECAY_TIME_OFFSET: { offset: 33, size: 1 },
      // 0-127 (-64 to +63)
      VIBRATO_RATE: { offset: 34, size: 1 },
      // 0-127 (-64 to +63)
      VIBRATO_DEPTH: { offset: 35, size: 1 },
      // 0-127 (-64 to +63)
      VIBRATO_DELAY: { offset: 36, size: 1 }
      // 0-127 (-64 to +63)
    }
  };
  function getPatchTempAddress(part) {
    if (part === 0) {
      return [31, 0, 0, 0];
    }
    if (part < 1 || part > 16) {
      throw new Error(`Part number must be 0-16, got ${part}`);
    }
    const idx = part - 1;
    const msb = 17 + Math.floor(idx / 4);
    const mid = idx % 4 * 32;
    return [msb, mid, 0, 0];
  }
  var PATCH_COMMON = {
    SIZE: [0, 0, 0, 79],
    // 79 bytes
    params: {
      NAME_1: { offset: 0, size: 1 },
      // ASCII 32-127
      NAME_2: { offset: 1, size: 1 },
      NAME_3: { offset: 2, size: 1 },
      NAME_4: { offset: 3, size: 1 },
      NAME_5: { offset: 4, size: 1 },
      NAME_6: { offset: 5, size: 1 },
      NAME_7: { offset: 6, size: 1 },
      NAME_8: { offset: 7, size: 1 },
      NAME_9: { offset: 8, size: 1 },
      NAME_10: { offset: 9, size: 1 },
      NAME_11: { offset: 10, size: 1 },
      NAME_12: { offset: 11, size: 1 },
      PATCH_CATEGORY: { offset: 12, size: 1 },
      // 0-127
      TONE_TYPE: { offset: 13, size: 1 },
      // 0-1 (4TONES, MULTI-PARTIAL)
      PATCH_LEVEL: { offset: 14, size: 1 },
      // 0-127
      PATCH_PAN: { offset: 15, size: 1 },
      // 0-127 (L64-63R, 64=Center)
      PATCH_PRIORITY: { offset: 16, size: 1 },
      // 0-1 (LAST, LOUDEST)
      COARSE_TUNE: { offset: 17, size: 1 },
      // 16-112 (-48 to +48, 64=0)
      FINE_TUNE: { offset: 18, size: 1 },
      // 14-114 (-50 to +50, 64=0)
      OCTAVE_SHIFT: { offset: 19, size: 1 },
      // 61-67 (-3 to +3, 64=0)
      STRETCH_TUNE_DEPTH: { offset: 20, size: 1 },
      // 0-3 (OFF, 1-3)
      ANALOG_FEEL: { offset: 21, size: 1 },
      // 0-127
      MONO_POLY: { offset: 22, size: 1 },
      // 0-1 (MONO, POLY)
      LEGATO_SWITCH: { offset: 23, size: 1 },
      // 0-1 (OFF, ON)
      LEGATO_RETRIGGER: { offset: 24, size: 1 },
      // 0-1 (OFF, ON)
      PORTAMENTO_SWITCH: { offset: 25, size: 1 },
      // 0-1 (OFF, ON)
      PORTAMENTO_MODE: { offset: 26, size: 1 },
      // 0-1 (NORMAL, LEGATO)
      PORTAMENTO_TYPE: { offset: 27, size: 1 },
      // 0-1 (RATE, TIME)
      PORTAMENTO_START: { offset: 28, size: 1 },
      // 0-1 (PITCH, NOTE)
      PORTAMENTO_TIME: { offset: 29, size: 1 },
      // 0-127
      PATCH_CLOCK_SOURCE: { offset: 30, size: 1 },
      // 0-1 (PATCH, SYSTEM)
      PATCH_TEMPO_MSB: { offset: 31, size: 1 },
      // 20-250 (nibble split)
      PATCH_TEMPO_LSB: { offset: 32, size: 1 },
      CUTOFF_OFFSET: { offset: 34, size: 1 },
      // 1-127 (-63 to +63)
      RESONANCE_OFFSET: { offset: 35, size: 1 },
      // 1-127 (-63 to +63)
      ATTACK_TIME_OFFSET: { offset: 36, size: 1 },
      // 1-127 (-63 to +63)
      RELEASE_TIME_OFFSET: { offset: 37, size: 1 },
      // 1-127 (-63 to +63)
      VELOCITY_SENS_OFFSET: { offset: 38, size: 1 },
      // 1-127 (-63 to +63)
      OUTPUT_ASSIGN: { offset: 39, size: 1 },
      // 0-13 (MFX, A, B, C, D, 1..8, TONE)
      TMT_CTRL_SWITCH: { offset: 40, size: 1 },
      // 0-1 (OFF, ON)
      BEND_RANGE_UP: { offset: 41, size: 1 },
      // 0-48
      BEND_RANGE_DOWN: { offset: 42, size: 1 },
      // 0-48
      // Matrix Control 1
      MATRIX_CTRL_1_SOURCE: { offset: 43, size: 1 },
      // 0-109
      MATRIX_CTRL_1_DEST_1: { offset: 44, size: 1 },
      // 0-33
      MATRIX_CTRL_1_SENS_1: { offset: 45, size: 1 },
      // 1-127 (-63 to +63)
      MATRIX_CTRL_1_DEST_2: { offset: 46, size: 1 },
      MATRIX_CTRL_1_SENS_2: { offset: 47, size: 1 },
      MATRIX_CTRL_1_DEST_3: { offset: 48, size: 1 },
      MATRIX_CTRL_1_SENS_3: { offset: 49, size: 1 },
      MATRIX_CTRL_1_DEST_4: { offset: 50, size: 1 },
      MATRIX_CTRL_1_SENS_4: { offset: 51, size: 1 },
      // Matrix Control 2
      MATRIX_CTRL_2_SOURCE: { offset: 52, size: 1 },
      MATRIX_CTRL_2_DEST_1: { offset: 53, size: 1 },
      MATRIX_CTRL_2_SENS_1: { offset: 54, size: 1 },
      MATRIX_CTRL_2_DEST_2: { offset: 55, size: 1 },
      MATRIX_CTRL_2_SENS_2: { offset: 56, size: 1 },
      MATRIX_CTRL_2_DEST_3: { offset: 57, size: 1 },
      MATRIX_CTRL_2_SENS_3: { offset: 58, size: 1 },
      MATRIX_CTRL_2_DEST_4: { offset: 59, size: 1 },
      MATRIX_CTRL_2_SENS_4: { offset: 60, size: 1 },
      // Matrix Control 3
      MATRIX_CTRL_3_SOURCE: { offset: 61, size: 1 },
      MATRIX_CTRL_3_DEST_1: { offset: 62, size: 1 },
      MATRIX_CTRL_3_SENS_1: { offset: 63, size: 1 },
      MATRIX_CTRL_3_DEST_2: { offset: 64, size: 1 },
      MATRIX_CTRL_3_SENS_2: { offset: 65, size: 1 },
      MATRIX_CTRL_3_DEST_3: { offset: 66, size: 1 },
      MATRIX_CTRL_3_SENS_3: { offset: 67, size: 1 },
      MATRIX_CTRL_3_DEST_4: { offset: 68, size: 1 },
      MATRIX_CTRL_3_SENS_4: { offset: 69, size: 1 },
      // Matrix Control 4
      MATRIX_CTRL_4_SOURCE: { offset: 70, size: 1 },
      MATRIX_CTRL_4_DEST_1: { offset: 71, size: 1 },
      MATRIX_CTRL_4_SENS_1: { offset: 72, size: 1 },
      MATRIX_CTRL_4_DEST_2: { offset: 73, size: 1 },
      MATRIX_CTRL_4_SENS_2: { offset: 74, size: 1 },
      MATRIX_CTRL_4_DEST_3: { offset: 75, size: 1 },
      MATRIX_CTRL_4_SENS_3: { offset: 76, size: 1 },
      MATRIX_CTRL_4_DEST_4: { offset: 77, size: 1 },
      MATRIX_CTRL_4_SENS_4: { offset: 78, size: 1 }
    }
  };
  var PATCH_TMT = {
    OFFSET: [0, 0, 16, 0],
    SIZE: [0, 0, 0, 41],
    // 41 bytes
    params: {
      STRUCTURE_TYPE_1_2: { offset: 0, size: 1 },
      // 0-9 (Type 1-10)
      BOOSTER_1_2: { offset: 1, size: 1 },
      // 0-3 (0, +6, +12, +18 dB)
      STRUCTURE_TYPE_3_4: { offset: 2, size: 1 },
      // 0-9 (Type 1-10)
      BOOSTER_3_4: { offset: 3, size: 1 },
      // 0-3 (0, +6, +12, +18 dB)
      TMT_VEL_CONTROL: { offset: 4, size: 1 },
      // 0-2 (OFF, ON, RANDOM)
      // Tone 1
      TONE_1_SWITCH: { offset: 5, size: 1 },
      // 0-1 (OFF, ON)
      TONE_1_KEY_LOWER: { offset: 6, size: 1 },
      TONE_1_KEY_UPPER: { offset: 7, size: 1 },
      TONE_1_KEY_FADE_L: { offset: 8, size: 1 },
      TONE_1_KEY_FADE_U: { offset: 9, size: 1 },
      TONE_1_VEL_LOWER: { offset: 10, size: 1 },
      TONE_1_VEL_UPPER: { offset: 11, size: 1 },
      TONE_1_VEL_FADE_L: { offset: 12, size: 1 },
      TONE_1_VEL_FADE_U: { offset: 13, size: 1 },
      // Tone 2
      TONE_2_SWITCH: { offset: 14, size: 1 },
      // 0-1 (OFF, ON)
      TONE_2_KEY_LOWER: { offset: 15, size: 1 },
      TONE_2_KEY_UPPER: { offset: 16, size: 1 },
      TONE_2_KEY_FADE_L: { offset: 17, size: 1 },
      TONE_2_KEY_FADE_U: { offset: 18, size: 1 },
      TONE_2_VEL_LOWER: { offset: 19, size: 1 },
      TONE_2_VEL_UPPER: { offset: 20, size: 1 },
      TONE_2_VEL_FADE_L: { offset: 21, size: 1 },
      TONE_2_VEL_FADE_U: { offset: 22, size: 1 },
      // Tone 3
      TONE_3_SWITCH: { offset: 23, size: 1 },
      // 0-1 (OFF, ON)
      TONE_3_KEY_LOWER: { offset: 24, size: 1 },
      TONE_3_KEY_UPPER: { offset: 25, size: 1 },
      TONE_3_KEY_FADE_L: { offset: 26, size: 1 },
      TONE_3_KEY_FADE_U: { offset: 27, size: 1 },
      TONE_3_VEL_LOWER: { offset: 28, size: 1 },
      TONE_3_VEL_UPPER: { offset: 29, size: 1 },
      TONE_3_VEL_FADE_L: { offset: 30, size: 1 },
      TONE_3_VEL_FADE_U: { offset: 31, size: 1 },
      // Tone 4
      TONE_4_SWITCH: { offset: 32, size: 1 },
      // 0-1 (OFF, ON)
      TONE_4_KEY_LOWER: { offset: 33, size: 1 },
      TONE_4_KEY_UPPER: { offset: 34, size: 1 },
      TONE_4_KEY_FADE_L: { offset: 35, size: 1 },
      TONE_4_KEY_FADE_U: { offset: 36, size: 1 },
      TONE_4_VEL_LOWER: { offset: 37, size: 1 },
      TONE_4_VEL_UPPER: { offset: 38, size: 1 },
      TONE_4_VEL_FADE_L: { offset: 39, size: 1 },
      TONE_4_VEL_FADE_U: { offset: 40, size: 1 }
    }
  };
  function getPatchTMTAddress(patchBase) {
    return [patchBase[0], patchBase[1], patchBase[2] + 16, patchBase[3]];
  }
  function getToneAddress(patchBase, tone) {
    if (tone < 1 || tone > 4) {
      throw new Error(`Tone number must be 1-4, got ${tone}`);
    }
    const toneOffset = 32 + (tone - 1) * 2;
    return [patchBase[0], patchBase[1], patchBase[2] + toneOffset, patchBase[3]];
  }
  var PATCH_TONE = {
    SIZE: [0, 0, 1, 9],
    // 265 bytes
    params: {
      TONE_LEVEL: { offset: 0, size: 1 },
      // 0-127
      COARSE_TUNE: { offset: 1, size: 1 },
      // 16-112 (-48 to +48, 64=0)
      FINE_TUNE: { offset: 2, size: 1 },
      // 14-114 (-50 to +50, 64=0)
      RANDOM_PITCH_DEPTH: { offset: 3, size: 1 },
      // 0-30
      TONE_PAN: { offset: 4, size: 1 },
      // 0-127 (64=Center)
      PAN_KEYFOLLOW: { offset: 5, size: 1 },
      // 54-74 (-100 to +100)
      RANDOM_PAN_DEPTH: { offset: 6, size: 1 },
      // 0-63
      ALT_PAN_DEPTH: { offset: 7, size: 1 },
      // 1-127 (-63 to +63)
      // Wave
      WAVE_GROUP_TYPE: { offset: 39, size: 1 },
      // 0-3 (INT, SR-JV80, SRX, SAMPLE)
      WAVE_GROUP_ID_1: { offset: 40, size: 1 },
      // 4 nibbles
      WAVE_GROUP_ID_2: { offset: 41, size: 1 },
      WAVE_GROUP_ID_3: { offset: 42, size: 1 },
      WAVE_GROUP_ID_4: { offset: 43, size: 1 },
      WAVE_NUMBER_L_1: { offset: 44, size: 1 },
      // 4 nibbles
      WAVE_NUMBER_L_2: { offset: 45, size: 1 },
      WAVE_NUMBER_L_3: { offset: 46, size: 1 },
      WAVE_NUMBER_L_4: { offset: 47, size: 1 },
      WAVE_NUMBER_R_1: { offset: 48, size: 1 },
      // 4 nibbles
      WAVE_NUMBER_R_2: { offset: 49, size: 1 },
      WAVE_NUMBER_R_3: { offset: 50, size: 1 },
      WAVE_NUMBER_R_4: { offset: 51, size: 1 },
      WAVE_GAIN: { offset: 52, size: 1 },
      // 0-3 (-6, 0, +6, +12 dB)
      WAVE_FXM_SWITCH: { offset: 53, size: 1 },
      // 0-1 (OFF, ON)
      WAVE_FXM_COLOR: { offset: 54, size: 1 },
      // 0-3 (1-4)
      WAVE_FXM_DEPTH: { offset: 55, size: 1 },
      // 0-16
      WAVE_TEMPO_SYNC: { offset: 56, size: 1 },
      // 0-1 (OFF, ON)
      WAVE_PITCH_KEYFOLLOW: { offset: 57, size: 1 },
      // 44-84 (-200% to +200%)
      // Pitch Envelope
      PITCH_ENV_DEPTH: { offset: 58, size: 1 },
      // 52-76 (-12 to +12)
      PITCH_ENV_VEL_SENS: { offset: 59, size: 1 },
      // 1-127 (-63 to +63)
      PITCH_ENV_TIME1_VEL: { offset: 60, size: 1 },
      // 1-127 (-63 to +63)
      PITCH_ENV_TIME4_VEL: { offset: 61, size: 1 },
      // 1-127 (-63 to +63)
      PITCH_ENV_TIME_KEY: { offset: 62, size: 1 },
      // 54-74 (-100 to +100)
      PITCH_ENV_T1: { offset: 63, size: 1 },
      // 0-127
      PITCH_ENV_T2: { offset: 64, size: 1 },
      PITCH_ENV_T3: { offset: 65, size: 1 },
      PITCH_ENV_T4: { offset: 66, size: 1 },
      PITCH_ENV_L0: { offset: 67, size: 1 },
      // 1-127 (-63 to +63)
      PITCH_ENV_L1: { offset: 68, size: 1 },
      PITCH_ENV_L2: { offset: 69, size: 1 },
      PITCH_ENV_L3: { offset: 70, size: 1 },
      PITCH_ENV_L4: { offset: 71, size: 1 },
      // TVF
      TVF_FILTER_TYPE: { offset: 72, size: 1 },
      // 0-6 (OFF, LPF, BPF, HPF, PKG, LPF2, LPF3)
      TVF_CUTOFF: { offset: 73, size: 1 },
      // 0-127
      TVF_CUTOFF_KEYFOLLOW: { offset: 74, size: 1 },
      // 44-84 (-200% to +200%)
      TVF_CUTOFF_VEL_CURVE: { offset: 75, size: 1 },
      // 0-7 (FIXED, 1-7)
      TVF_CUTOFF_VEL_SENS: { offset: 76, size: 1 },
      // 1-127 (-63 to +63)
      TVF_RESONANCE: { offset: 77, size: 1 },
      // 0-127
      TVF_RESO_VEL_SENS: { offset: 78, size: 1 },
      // 1-127 (-63 to +63)
      TVF_ENV_DEPTH: { offset: 79, size: 1 },
      // 1-127 (-63 to +63)
      TVF_ENV_VEL_CURVE: { offset: 80, size: 1 },
      // 0-6 (1-7)
      TVF_ENV_VEL_SENS: { offset: 81, size: 1 },
      // 1-127 (-63 to +63)
      TVF_ENV_TIME1_VEL: { offset: 82, size: 1 },
      // 1-127 (-63 to +63)
      TVF_ENV_TIME4_VEL: { offset: 83, size: 1 },
      // 1-127 (-63 to +63)
      TVF_ENV_TIME_KEY: { offset: 84, size: 1 },
      // 54-74 (-100 to +100)
      TVF_ENV_T1: { offset: 85, size: 1 },
      // 0-127
      TVF_ENV_T2: { offset: 86, size: 1 },
      TVF_ENV_T3: { offset: 87, size: 1 },
      TVF_ENV_T4: { offset: 88, size: 1 },
      TVF_ENV_L1: { offset: 89, size: 1 },
      // 0-127
      TVF_ENV_L2: { offset: 90, size: 1 },
      TVF_ENV_L3: { offset: 91, size: 1 },
      TVF_ENV_L4: { offset: 92, size: 1 },
      // TVA
      TVA_LEVEL: { offset: 110, size: 1 },
      // 0-127
      TVA_VEL_CURVE: { offset: 111, size: 1 },
      // 0-6 (1-7)
      TVA_VEL_SENS: { offset: 112, size: 1 },
      // 1-127 (-63 to +63)
      TVA_ENV_TIME1_VEL: { offset: 113, size: 1 },
      // 1-127 (-63 to +63)
      TVA_ENV_TIME4_VEL: { offset: 114, size: 1 },
      // 1-127 (-63 to +63)
      TVA_ENV_TIME_KEY: { offset: 115, size: 1 },
      // 54-74 (-100 to +100)
      TVA_ENV_T1: { offset: 116, size: 1 },
      // 0-127
      TVA_ENV_T2: { offset: 117, size: 1 },
      TVA_ENV_T3: { offset: 118, size: 1 },
      TVA_ENV_T4: { offset: 119, size: 1 },
      TVA_ENV_L1: { offset: 120, size: 1 },
      // 0-127
      TVA_ENV_L2: { offset: 121, size: 1 },
      TVA_ENV_L3: { offset: 122, size: 1 },
      // LFO 1
      LFO1_FORM: { offset: 138, size: 1 },
      // 0-9
      LFO1_RATE: { offset: 139, size: 1 },
      // 0-127
      LFO1_TEMPO_SYNC: { offset: 141, size: 1 },
      // 0-1 (OFF, ON)
      LFO1_FADE_MODE: { offset: 142, size: 1 },
      // 0-3 (ON-IN, ON-OUT, OFF-IN, OFF-OUT)
      LFO1_DELAY_TIME: { offset: 143, size: 1 },
      // 0-127
      LFO1_FADE_TIME: { offset: 144, size: 1 },
      // 0-127
      LFO1_OFFSET: { offset: 145, size: 1 },
      // 0-4 (-100, -50, 0, +50, +100)
      LFO1_KEY_TRIGGER: { offset: 147, size: 1 },
      // 0-1 (OFF, ON)
      LFO1_PITCH_DEPTH: { offset: 148, size: 1 },
      // 1-127 (-63 to +63)
      LFO1_TVF_DEPTH: { offset: 149, size: 1 },
      // 1-127 (-63 to +63)
      LFO1_TVA_DEPTH: { offset: 150, size: 1 },
      // 1-127 (-63 to +63)
      LFO1_PAN_DEPTH: { offset: 151, size: 1 },
      // 1-127 (-63 to +63)
      // LFO 2
      LFO2_FORM: { offset: 250, size: 1 },
      // 0-9
      LFO2_RATE: { offset: 251, size: 1 },
      // 0-127
      LFO2_TEMPO_SYNC: { offset: 253, size: 1 },
      // 0-1 (OFF, ON)
      LFO2_FADE_MODE: { offset: 254, size: 1 },
      // 0-3
      LFO2_DELAY_TIME: { offset: 255, size: 1 },
      // 0-127
      LFO2_FADE_TIME: { offset: 256, size: 1 },
      // 0-127
      LFO2_OFFSET: { offset: 257, size: 1 },
      // 0-4
      LFO2_KEY_TRIGGER: { offset: 260, size: 1 },
      // 0-1
      LFO2_PITCH_DEPTH: { offset: 261, size: 1 },
      // 1-127 (-63 to +63)
      LFO2_TVF_DEPTH: { offset: 262, size: 1 },
      // 1-127 (-63 to +63)
      LFO2_TVA_DEPTH: { offset: 263, size: 1 },
      // 1-127 (-63 to +63)
      LFO2_PAN_DEPTH: { offset: 264, size: 1 }
      // 1-127 (-63 to +63)
    }
  };
  function addOffset(base, offset) {
    const result = [...base];
    let carry = offset;
    for (let i = 3; i >= 0; i--) {
      const sum = result[i] + carry;
      result[i] = sum & 127;
      carry = Math.floor(sum / 128);
    }
    return result;
  }

  // src/performance.js
  async function requestPerformanceCommon(midi2, deviceId) {
    const msg = buildRQ1(
      PERF_TEMP.COMMON.BASE,
      PERF_TEMP.COMMON.SIZE,
      deviceId
    );
    const response = await midi2.sendAndReceive(msg);
    return parsePerformanceCommon(response.data);
  }
  async function requestPerformanceChorus(midi2, deviceId) {
    const msg = buildRQ1(
      PERF_TEMP.CHORUS.BASE,
      PERF_TEMP.CHORUS.SIZE,
      deviceId
    );
    const response = await midi2.sendAndReceive(msg);
    return parsePerformanceChorus(response.data);
  }
  async function requestPerformanceReverb(midi2, deviceId) {
    const msg = buildRQ1(
      PERF_TEMP.REVERB.BASE,
      PERF_TEMP.REVERB.SIZE,
      deviceId
    );
    const response = await midi2.sendAndReceive(msg);
    return parsePerformanceReverb(response.data);
  }
  async function requestPerformancePart(midi2, part, deviceId) {
    const address = getPartAddress(part);
    const msg = buildRQ1(address, PERF_PART.SIZE, deviceId);
    const response = await midi2.sendAndReceive(msg);
    return parsePerformancePart(response.data);
  }
  async function requestAllParts(midi2, deviceId, onProgress) {
    const parts = [];
    for (let i = 1; i <= 16; i++) {
      const partData = await requestPerformancePart(midi2, i, deviceId);
      parts.push(partData);
      if (onProgress) onProgress(i, 16);
      await new Promise((r) => setTimeout(r, 40));
    }
    return parts;
  }
  function sendPerformanceCommonParam(midi2, paramKey, value, deviceId) {
    const param = PERF_TEMP.COMMON.params[paramKey];
    if (!param) {
      throw new Error(`Unknown performance common parameter: ${paramKey}`);
    }
    const address = addOffset(PERF_TEMP.COMMON.BASE, param.offset);
    const msg = buildDT1(address, [value & 127], deviceId);
    midi2.send(msg);
  }
  function sendPerformanceChorusParam(midi2, paramKey, value, deviceId) {
    const param = PERF_TEMP.CHORUS.params[paramKey];
    if (!param) {
      throw new Error(`Unknown performance chorus parameter: ${paramKey}`);
    }
    const address = addOffset(PERF_TEMP.CHORUS.BASE, param.offset);
    const msg = buildDT1(address, [value & 127], deviceId);
    midi2.send(msg);
  }
  function sendPerformanceReverbParam(midi2, paramKey, value, deviceId) {
    const param = PERF_TEMP.REVERB.params[paramKey];
    if (!param) {
      throw new Error(`Unknown performance reverb parameter: ${paramKey}`);
    }
    const address = addOffset(PERF_TEMP.REVERB.BASE, param.offset);
    const msg = buildDT1(address, [value & 127], deviceId);
    midi2.send(msg);
  }
  function sendPerformanceName(midi2, name, deviceId) {
    const nameBytes = encodeName(name);
    const address = PERF_TEMP.COMMON.BASE;
    const msg = buildDT1(address, nameBytes, deviceId);
    midi2.send(msg);
  }
  function sendPartParam(midi2, part, paramKey, value, deviceId) {
    const param = PERF_PART.params[paramKey];
    if (!param) {
      throw new Error(`Unknown part parameter: ${paramKey}`);
    }
    const partBase = getPartAddress(part);
    const address = addOffset(partBase, param.offset);
    const msg = buildDT1(address, [value & 127], deviceId);
    midi2.send(msg);
  }
  function parsePerformanceCommon(data) {
    if (!data || data.length < 12) {
      throw new Error(`Performance common data too short: ${data?.length} bytes`);
    }
    return {
      name: decodeName(data.slice(0, 12)),
      soloPartSelect: data[12] ?? 0,
      mfxCtrlChannel: data[13] ?? 0,
      mfxCtrlMidi1: data[14] ?? 0,
      mfxCtrlMidi2: data[15] ?? 0,
      mfxASource: data[48] ?? 0,
      mfxBSource: data[49] ?? 0,
      mfxCSource: data[50] ?? 0,
      chorusSource: data[51] ?? 0,
      reverbSource: data[52] ?? 0
    };
  }
  function parsePerformanceChorus(data) {
    if (!data || data.length < 4) {
      throw new Error(`Performance chorus data too short: ${data?.length} bytes`);
    }
    return {
      chorusType: data[0],
      chorusLevel: data[1],
      outputAssign: data[2],
      outputSelect: data[3]
    };
  }
  function parsePerformanceReverb(data) {
    if (!data || data.length < 3) {
      throw new Error(`Performance reverb data too short: ${data?.length} bytes`);
    }
    return {
      reverbType: data[0],
      reverbLevel: data[1],
      outputAssign: data[2]
    };
  }
  function parsePerformancePart(data) {
    if (!data || data.length < 33) {
      throw new Error(`Part data too short: ${data?.length} bytes`);
    }
    return {
      receiveChannel: data[0],
      receiveSwitch: data[1],
      receiveMidi1: data[2],
      receiveMidi2: data[3],
      patchBankMSB: data[4],
      patchBankLSB: data[5],
      patchPC: data[6],
      partLevel: data[7],
      partPan: data[8],
      coarseTune: data[9],
      fineTune: data[10],
      monoPoly: data[11],
      legatoSwitch: data[12],
      pitchBendRange: data[13],
      portamentoSwitch: data[14],
      cutoffOffset: data[17],
      resonanceOffset: data[18],
      attackTimeOffset: data[19],
      releaseTimeOffset: data[20],
      octaveShift: data[21],
      velocitySensOffset: data[22],
      keyRangeLower: data[23],
      keyRangeUpper: data[24],
      keyFadeLower: data[25],
      keyFadeUpper: data[26],
      muteSwitch: data[27],
      drySendLevel: data[28],
      chorusSend: data[29],
      reverbSend: data[30],
      outputAssign: data[31],
      outputMfxSelect: data[32],
      decayTimeOffset: data[33] ?? 64
    };
  }

  // src/patch.js
  async function requestPatchCommon(midi2, part, deviceId) {
    const base = getPatchTempAddress(part);
    const msg = buildRQ1(base, PATCH_COMMON.SIZE, deviceId);
    const response = await midi2.sendAndReceive(msg);
    return parsePatchCommon(response.data);
  }
  async function requestPatchTMT(midi2, part, deviceId) {
    const patchBase = getPatchTempAddress(part);
    const tmtAddress = getPatchTMTAddress(patchBase);
    const msg = buildRQ1(tmtAddress, PATCH_TMT.SIZE, deviceId);
    const response = await midi2.sendAndReceive(msg);
    return parsePatchTMT(response.data);
  }
  async function requestPatchTone(midi2, part, tone, deviceId) {
    const patchBase = getPatchTempAddress(part);
    const toneAddress = getToneAddress(patchBase, tone);
    const msg = buildRQ1(toneAddress, PATCH_TONE.SIZE, deviceId);
    const response = await midi2.sendAndReceive(msg);
    return parsePatchTone(response.data);
  }
  function sendPatchCommonParam(midi2, part, paramKey, value, deviceId) {
    const param = PATCH_COMMON.params[paramKey];
    if (!param) {
      throw new Error(`Unknown patch common parameter: ${paramKey}`);
    }
    const base = getPatchTempAddress(part);
    const address = addOffset(base, param.offset);
    const msg = buildDT1(address, [value & 127], deviceId);
    midi2.send(msg);
  }
  function sendPatchTMTParam(midi2, part, paramKey, value, deviceId) {
    const param = PATCH_TMT.params[paramKey];
    if (!param) {
      throw new Error(`Unknown patch TMT parameter: ${paramKey}`);
    }
    const patchBase = getPatchTempAddress(part);
    const tmtBase = getPatchTMTAddress(patchBase);
    const address = addOffset(tmtBase, param.offset);
    const msg = buildDT1(address, [value & 127], deviceId);
    midi2.send(msg);
  }
  function sendPatchToneParam(midi2, part, tone, paramKey, value, deviceId) {
    const param = PATCH_TONE.params[paramKey];
    if (!param) {
      throw new Error(`Unknown tone parameter: ${paramKey}`);
    }
    const patchBase = getPatchTempAddress(part);
    const toneBase = getToneAddress(patchBase, tone);
    const address = addOffset(toneBase, param.offset);
    const msg = buildDT1(address, [value & 127], deviceId);
    midi2.send(msg);
  }
  function sendPatchName(midi2, part, name, deviceId) {
    const nameBytes = encodeName(name);
    const base = getPatchTempAddress(part);
    const msg = buildDT1(base, nameBytes, deviceId);
    midi2.send(msg);
  }
  function sendToneSwitch(midi2, part, tone, enabled, deviceId) {
    const paramKey = `TONE_${tone}_SWITCH`;
    sendPatchTMTParam(midi2, part, paramKey, enabled ? 1 : 0, deviceId);
  }
  function sendMatrixControlParam(midi2, part, matrixNumOrKey, paramKeyOrVal, value, deviceId) {
    let paramKey;
    let val;
    let devId = deviceId;
    if (typeof matrixNumOrKey === "string") {
      paramKey = matrixNumOrKey;
      val = paramKeyOrVal;
    } else {
      const matrixNum = matrixNumOrKey;
      const subParam = String(paramKeyOrVal);
      paramKey = subParam.startsWith("MATRIX_CTRL") ? subParam : `MATRIX_CTRL_${matrixNum}_${subParam}`;
      val = value;
    }
    sendPatchCommonParam(midi2, part, paramKey, val, devId);
  }
  function sendTMTKeyRangeParam(midi2, part, tone, paramType, value, deviceId) {
    const key = paramType.startsWith("TONE_") ? paramType : `TONE_${tone}_${paramType}`;
    sendPatchTMTParam(midi2, part, key, value, deviceId);
  }
  function sendToneLFOParam(midi2, part, tone, lfoNum, param, value, deviceId) {
    const key = param.startsWith("LFO") ? param : `LFO${lfoNum}_${param}`;
    sendPatchToneParam(midi2, part, tone, key, value, deviceId);
  }
  function parsePatchCommon(data) {
    if (!data || data.length < 43) {
      throw new Error(`Patch common data too short: ${data?.length} bytes`);
    }
    return {
      name: decodeName(data.slice(0, 12)),
      patchCategory: data[12] ?? 0,
      toneType: data[13] ?? 0,
      patchLevel: data[14] ?? 127,
      patchPan: data[15] ?? 64,
      patchPriority: data[16] ?? 0,
      coarseTune: data[17] ?? 64,
      fineTune: data[18] ?? 64,
      octaveShift: data[19] ?? 64,
      stretchTuneDepth: data[20] ?? 0,
      analogFeel: data[21] ?? 0,
      monoPoly: data[22] ?? 1,
      legatoSwitch: data[23] ?? 0,
      legatoRetrigger: data[24] ?? 0,
      portamentoSwitch: data[25] ?? 0,
      portamentoMode: data[26] ?? 0,
      portamentoType: data[27] ?? 0,
      portamentoStart: data[28] ?? 0,
      portamentoTime: data[29] ?? 0,
      patchClockSource: data[30] ?? 0,
      cutoffOffset: data[34] ?? 64,
      resonanceOffset: data[35] ?? 64,
      attackTimeOffset: data[36] ?? 64,
      releaseTimeOffset: data[37] ?? 64,
      velocitySensOffset: data[38] ?? 64,
      outputAssign: data[39] ?? 0,
      tmtCtrlSwitch: data[40] ?? 0,
      bendRangeUp: data[41] ?? 2,
      bendRangeDown: data[42] ?? 2,
      // Matrix Control 1
      matrix1Source: data[43] ?? 0,
      matrix1Dest1: data[44] ?? 0,
      matrix1Sens1: data[45] ?? 64,
      matrix1Dest2: data[46] ?? 0,
      matrix1Sens2: data[47] ?? 64,
      matrix1Dest3: data[48] ?? 0,
      matrix1Sens3: data[49] ?? 64,
      matrix1Dest4: data[50] ?? 0,
      matrix1Sens4: data[51] ?? 64,
      // Matrix Control 2
      matrix2Source: data[52] ?? 0,
      matrix2Dest1: data[53] ?? 0,
      matrix2Sens1: data[54] ?? 64,
      matrix2Dest2: data[55] ?? 0,
      matrix2Sens2: data[56] ?? 64,
      matrix2Dest3: data[57] ?? 0,
      matrix2Sens3: data[58] ?? 64,
      matrix2Dest4: data[59] ?? 0,
      matrix2Sens4: data[60] ?? 64,
      // Matrix Control 3
      matrix3Source: data[61] ?? 0,
      matrix3Dest1: data[62] ?? 0,
      matrix3Sens1: data[63] ?? 64,
      matrix3Dest2: data[64] ?? 0,
      matrix3Sens2: data[65] ?? 64,
      matrix3Dest3: data[66] ?? 0,
      matrix3Sens3: data[67] ?? 64,
      matrix3Dest4: data[68] ?? 0,
      matrix3Sens4: data[69] ?? 64,
      // Matrix Control 4
      matrix4Source: data[70] ?? 0,
      matrix4Dest1: data[71] ?? 0,
      matrix4Sens1: data[72] ?? 64,
      matrix4Dest2: data[73] ?? 0,
      matrix4Sens2: data[74] ?? 64,
      matrix4Dest3: data[75] ?? 0,
      matrix4Sens3: data[76] ?? 64,
      matrix4Dest4: data[77] ?? 0,
      matrix4Sens4: data[78] ?? 64
    };
  }
  function parsePatchTMT(data) {
    if (!data || data.length < 33) {
      throw new Error(`Patch TMT data too short: ${data?.length} bytes`);
    }
    return {
      structureType12: data[0] ?? 0,
      booster12: data[1] ?? 0,
      structureType34: data[2] ?? 0,
      booster34: data[3] ?? 0,
      tmtVelControl: data[4] ?? 0,
      // Tone 1
      tone1Switch: data[5] ?? 1,
      tone1KeyLower: data[6] ?? 0,
      tone1KeyUpper: data[7] ?? 127,
      tone1KeyFadeL: data[8] ?? 0,
      tone1KeyFadeU: data[9] ?? 0,
      tone1VelLower: data[10] ?? 1,
      tone1VelUpper: data[11] ?? 127,
      tone1VelFadeL: data[12] ?? 0,
      tone1VelFadeU: data[13] ?? 0,
      // Tone 2
      tone2Switch: data[14] ?? 0,
      tone2KeyLower: data[15] ?? 0,
      tone2KeyUpper: data[16] ?? 127,
      tone2KeyFadeL: data[17] ?? 0,
      tone2KeyFadeU: data[18] ?? 0,
      tone2VelLower: data[19] ?? 1,
      tone2VelUpper: data[20] ?? 127,
      tone2VelFadeL: data[21] ?? 0,
      tone2VelFadeU: data[22] ?? 0,
      // Tone 3
      tone3Switch: data[23] ?? 0,
      tone3KeyLower: data[24] ?? 0,
      tone3KeyUpper: data[25] ?? 127,
      tone3KeyFadeL: data[26] ?? 0,
      tone3KeyFadeU: data[27] ?? 0,
      tone3VelLower: data[28] ?? 1,
      tone3VelUpper: data[29] ?? 127,
      tone3VelFadeL: data[30] ?? 0,
      tone3VelFadeU: data[31] ?? 0,
      // Tone 4
      tone4Switch: data[32] ?? 0,
      tone4KeyLower: data[33] ?? 0,
      tone4KeyUpper: data[34] ?? 127,
      tone4KeyFadeL: data[35] ?? 0,
      tone4KeyFadeU: data[36] ?? 0,
      tone4VelLower: data[37] ?? 1,
      tone4VelUpper: data[38] ?? 127,
      tone4VelFadeL: data[39] ?? 0,
      tone4VelFadeU: data[40] ?? 0
    };
  }
  function parsePatchTone(data) {
    if (!data || data.length < 5) {
      throw new Error(`Patch tone data too short: ${data?.length} bytes`);
    }
    return {
      toneLevel: data[0] ?? 127,
      coarseTune: data[1] ?? 64,
      fineTune: data[2] ?? 64,
      randomPitchDepth: data[3] ?? 0,
      tonePan: data[4] ?? 64,
      panKeyfollow: data[5] ?? 64,
      randomPanDepth: data[6] ?? 0,
      altPanDepth: data[7] ?? 64,
      // Wave
      waveGroupType: data[39] ?? 0,
      waveGain: data[52] ?? 1,
      fxmSwitch: data[53] ?? 0,
      fxmColor: data[54] ?? 0,
      fxmDepth: data[55] ?? 0,
      waveTempoSync: data[56] ?? 0,
      wavePitchKeyfollow: data[57] ?? 64,
      // Pitch Envelope
      pitchEnvDepth: data[58] ?? 64,
      pitchEnvVelSens: data[59] ?? 64,
      pitchEnvTime1Vel: data[60] ?? 64,
      pitchEnvTime4Vel: data[61] ?? 64,
      pitchEnvTimeKey: data[62] ?? 64,
      pitchEnvT1: data[63] ?? 0,
      pitchEnvT2: data[64] ?? 0,
      pitchEnvT3: data[65] ?? 0,
      pitchEnvT4: data[66] ?? 0,
      pitchEnvL0: data[67] ?? 64,
      pitchEnvL1: data[68] ?? 64,
      pitchEnvL2: data[69] ?? 64,
      pitchEnvL3: data[70] ?? 64,
      pitchEnvL4: data[71] ?? 64,
      // TVF
      tvfFilterType: data[72] ?? 0,
      tvfCutoff: data[73] ?? 127,
      tvfCutoffKeyfollow: data[74] ?? 64,
      tvfCutoffVelCurve: data[75] ?? 0,
      tvfCutoffVelSens: data[76] ?? 64,
      tvfResonance: data[77] ?? 0,
      tvfResoVelSens: data[78] ?? 64,
      tvfEnvDepth: data[79] ?? 64,
      tvfEnvVelCurve: data[80] ?? 0,
      tvfEnvVelSens: data[81] ?? 64,
      tvfEnvTime1Vel: data[82] ?? 64,
      tvfEnvTime4Vel: data[83] ?? 64,
      tvfEnvTimeKey: data[84] ?? 64,
      tvfEnvT1: data[85] ?? 0,
      tvfEnvT2: data[86] ?? 0,
      tvfEnvT3: data[87] ?? 0,
      tvfEnvT4: data[88] ?? 0,
      tvfEnvL1: data[89] ?? 0,
      tvfEnvL2: data[90] ?? 0,
      tvfEnvL3: data[91] ?? 0,
      tvfEnvL4: data[92] ?? 0,
      // TVA
      tvaLevel: data[110] ?? 127,
      tvaVelCurve: data[111] ?? 0,
      tvaVelSens: data[112] ?? 64,
      tvaEnvTime1Vel: data[113] ?? 64,
      tvaEnvTime4Vel: data[114] ?? 64,
      tvaEnvTimeKey: data[115] ?? 64,
      tvaEnvT1: data[116] ?? 0,
      tvaEnvT2: data[117] ?? 0,
      tvaEnvT3: data[118] ?? 0,
      tvaEnvT4: data[119] ?? 0,
      tvaEnvL1: data[120] ?? 0,
      tvaEnvL2: data[121] ?? 0,
      tvaEnvL3: data[122] ?? 0,
      // LFO 1
      lfo1Form: data[138] ?? 0,
      lfo1Rate: data[139] ?? 0,
      lfo1TempoSync: data[141] ?? 0,
      lfo1FadeMode: data[142] ?? 0,
      lfo1DelayTime: data[143] ?? 0,
      lfo1FadeTime: data[144] ?? 0,
      lfo1Offset: data[145] ?? 0,
      lfo1KeyTrigger: data[147] ?? 0,
      lfo1PitchDepth: data[148] ?? 64,
      lfo1TvfDepth: data[149] ?? 64,
      lfo1TvaDepth: data[150] ?? 64,
      lfo1PanDepth: data[151] ?? 64,
      // LFO 2
      lfo2Form: data[250] ?? 0,
      lfo2Rate: data[251] ?? 0,
      lfo2TempoSync: data[253] ?? 0,
      lfo2FadeMode: data[254] ?? 0,
      lfo2DelayTime: data[255] ?? 0,
      lfo2FadeTime: data[256] ?? 0,
      lfo2Offset: data[257] ?? 0,
      lfo2KeyTrigger: data[260] ?? 0,
      lfo2PitchDepth: data[261] ?? 64,
      lfo2TvfDepth: data[262] ?? 64,
      lfo2TvaDepth: data[263] ?? 64,
      lfo2PanDepth: data[264] ?? 64
    };
  }

  // src/visuals.js
  function generateEnvelopePath(type, params = {}, width = 300, height = 120) {
    const pad = 10;
    const drawW = width - pad * 2;
    const drawH = height - pad * 2;
    const t1 = Math.max(1, params.t1 ?? 20);
    const t2 = Math.max(1, params.t2 ?? 20);
    const t3 = Math.max(1, params.t3 ?? 40);
    const t4 = Math.max(1, params.t4 ?? 40);
    const totalT = t1 + t2 + t3 + t4;
    const x0 = pad;
    const x1 = pad + t1 / totalT * drawW;
    const x2 = x1 + t2 / totalT * drawW;
    const x3 = x2 + t3 / totalT * drawW;
    const x4 = pad + drawW;
    if (type === "pitch") {
      const midY = pad + drawH / 2;
      const toY2 = (lvl) => {
        const val = (lvl ?? 64) - 64;
        return midY - val / 63 * (drawH / 2);
      };
      const y0 = toY2(params.l0 ?? 64);
      const y12 = toY2(params.l1 ?? 64);
      const y22 = toY2(params.l2 ?? 64);
      const y32 = toY2(params.l3 ?? 64);
      const y42 = toY2(params.l4 ?? 64);
      return `M ${x0.toFixed(1)} ${y0.toFixed(1)} L ${x1.toFixed(1)} ${y12.toFixed(1)} L ${x2.toFixed(1)} ${y22.toFixed(1)} L ${x3.toFixed(1)} ${y32.toFixed(1)} L ${x4.toFixed(1)} ${y42.toFixed(1)}`;
    }
    if (type === "tvf") {
      const baseY2 = pad + drawH;
      const toY2 = (lvl) => baseY2 - (lvl ?? 0) / 127 * drawH;
      const y12 = toY2(params.l1 ?? 127);
      const y22 = toY2(params.l2 ?? 100);
      const y32 = toY2(params.l3 ?? 60);
      const y42 = toY2(params.l4 ?? 0);
      return `M ${x0.toFixed(1)} ${baseY2.toFixed(1)} L ${x1.toFixed(1)} ${y12.toFixed(1)} L ${x2.toFixed(1)} ${y22.toFixed(1)} L ${x3.toFixed(1)} ${y32.toFixed(1)} L ${x4.toFixed(1)} ${y42.toFixed(1)}`;
    }
    const baseY = pad + drawH;
    const toY = (lvl) => baseY - (lvl ?? 0) / 127 * drawH;
    const y1 = toY(params.l1 ?? 127);
    const y2 = toY(params.l2 ?? 90);
    const y3 = toY(params.l3 ?? 70);
    const y4 = baseY;
    return `M ${x0.toFixed(1)} ${baseY.toFixed(1)} L ${x1.toFixed(1)} ${y1.toFixed(1)} L ${x2.toFixed(1)} ${y2.toFixed(1)} L ${x3.toFixed(1)} ${y3.toFixed(1)} L ${x4.toFixed(1)} ${y4.toFixed(1)}`;
  }
  function generateFilterCurvePath(filterType, cutoff = 64, resonance = 0, width = 300, height = 120) {
    const pad = 10;
    const drawW = width - pad * 2;
    const drawH = height - pad * 2;
    const points = [];
    const types = ["OFF", "LPF", "BPF", "HPF", "PKG", "LPF2", "LPF3"];
    const typeStr = typeof filterType === "number" ? types[filterType] || "OFF" : String(filterType).toUpperCase();
    const cNorm = cutoff / 127;
    const rNorm = resonance / 127;
    const steps = 30;
    for (let i = 0; i <= steps; i++) {
      const x = pad + i / steps * drawW;
      const f = i / steps;
      let gain = 1;
      switch (typeStr) {
        case "OFF":
          gain = 0.8;
          break;
        case "LPF":
        case "LPF2":
        case "LPF3": {
          const order = typeStr === "LPF" ? 2 : typeStr === "LPF2" ? 3 : 4;
          const dist = f - cNorm;
          if (dist <= 0) {
            gain = 0.85 + Math.exp(dist * 6) * rNorm * 0.4;
          } else {
            gain = Math.max(0.02, (0.85 + rNorm * 0.4) * Math.exp(-dist * order * 5));
          }
          break;
        }
        case "HPF": {
          const dist = cNorm - f;
          if (dist <= 0) {
            gain = 0.85 + Math.exp(dist * 6) * rNorm * 0.4;
          } else {
            gain = Math.max(0.02, (0.85 + rNorm * 0.4) * Math.exp(-dist * 2 * 5));
          }
          break;
        }
        case "BPF": {
          const diff = Math.abs(f - cNorm);
          const q = 3 + rNorm * 8;
          gain = Math.max(0.02, (0.9 + rNorm * 0.3) / (1 + Math.pow(diff * q, 2)));
          break;
        }
        case "PKG": {
          const diff = Math.abs(f - cNorm);
          gain = 0.5 + 0.5 * rNorm / (1 + Math.pow(diff * 10, 2));
          break;
        }
        default:
          gain = 0.8;
      }
      const clampedGain = Math.min(1.2, Math.max(0, gain));
      const y = pad + drawH - clampedGain * (drawH * 0.8);
      points.push(`${i === 0 ? "M" : "L"} ${x.toFixed(1)} ${y.toFixed(1)}`);
    }
    return points.join(" ");
  }
  function generateLFOWavePath(waveform, rate = 64, width = 300, height = 100) {
    const pad = 10;
    const drawW = width - pad * 2;
    const drawH = height - pad * 2;
    const midY = pad + drawH / 2;
    const amp = drawH / 2 * 0.85;
    const names = ["TRI", "SIN", "SAW-UP", "SAW-DN", "SQR", "TRP", "S&H", "RND", "STEP1", "STEP2"];
    const waveStr = typeof waveform === "number" ? names[waveform] || "TRI" : String(waveform).toUpperCase();
    const cycles = 2 + Math.floor(rate / 127 * 3);
    const steps = 60;
    const points = [];
    for (let i = 0; i <= steps; i++) {
      const x = pad + i / steps * drawW;
      const phase = i / steps * cycles * 2 * Math.PI;
      const frac = phase / (2 * Math.PI) % 1;
      let val = 0;
      switch (waveStr) {
        case "SIN":
          val = Math.sin(phase);
          break;
        case "TRI":
          val = frac < 0.5 ? 4 * frac - 1 : 3 - 4 * frac;
          break;
        case "SAW-UP":
          val = 2 * frac - 1;
          break;
        case "SAW-DN":
          val = 1 - 2 * frac;
          break;
        case "SQR":
          val = frac < 0.5 ? 1 : -1;
          break;
        case "TRP":
          if (frac < 0.25) val = frac * 4;
          else if (frac < 0.5) val = 1;
          else if (frac < 0.75) val = 1 - (frac - 0.5) * 4;
          else val = -1;
          break;
        case "S&H":
        case "RND":
        case "STEP1":
        case "STEP2": {
          const stepNum = Math.floor(frac * 4);
          val = stepNum * 47 % 7 / 3.5 - 1;
          break;
        }
        default:
          val = Math.sin(phase);
      }
      const y = midY - val * amp;
      points.push(`${i === 0 ? "M" : "L"} ${x.toFixed(1)} ${y.toFixed(1)}`);
    }
    return points.join(" ");
  }

  // src/librarian.js
  function exportToSyx(packets) {
    if (!Array.isArray(packets)) {
      throw new Error("Packets must be an array");
    }
    const totalLength = packets.reduce((acc, p) => acc + p.length, 0);
    const result = new Uint8Array(totalLength);
    let offset = 0;
    for (const p of packets) {
      result.set(p instanceof Uint8Array ? p : new Uint8Array(p), offset);
      offset += p.length;
    }
    return result;
  }
  function parseSyxFile(fileData) {
    const bytes = fileData instanceof Uint8Array ? fileData : new Uint8Array(fileData);
    const packets = [];
    let startIdx = -1;
    for (let i = 0; i < bytes.length; i++) {
      if (bytes[i] === SYSEX_START) {
        startIdx = i;
      } else if (bytes[i] === SYSEX_END && startIdx !== -1) {
        const packetBytes = bytes.slice(startIdx, i + 1);
        const parsed = parseSysEx(packetBytes);
        packets.push(parsed);
        startIdx = -1;
      }
    }
    return packets;
  }
  function createPatchSyxDump(part, commonData, tmtData, deviceId = 16) {
    const patchBase = getPatchTempAddress(part);
    const tmtBase = getPatchTMTAddress(patchBase);
    const packet1 = buildDT1(patchBase, commonData, deviceId);
    const packet2 = buildDT1(tmtBase, tmtData, deviceId);
    return [packet1, packet2];
  }
  function createPerformanceSyxDump(commonData, chorusData, reverbData, partsData, deviceId = 16) {
    const packets = [];
    packets.push(buildDT1([16, 0, 0, 0], commonData, deviceId));
    if (chorusData) {
      packets.push(buildDT1([16, 0, 4, 0], chorusData, deviceId));
    }
    if (reverbData) {
      packets.push(buildDT1([16, 0, 6, 0], reverbData, deviceId));
    }
    if (Array.isArray(partsData)) {
      for (let p = 0; p < partsData.length; p++) {
        const partAddr = [16, 0, 32 + p, 0];
        packets.push(buildDT1(partAddr, partsData[p], deviceId));
      }
    }
    return packets;
  }

  // src/app.js
  var midi = new MidiManager();
  var store = createStore();
  var $ = (id) => document.getElementById(id);
  var currentToneIndex = 1;
  var activeAuditionTimeout = null;
  function setStatus(message) {
    const el = $("statusMessage");
    if (el) el.textContent = message;
  }
  function setConnectionStatus(connected, label) {
    const dot = $("statusDot");
    const text = $("statusText");
    if (dot) dot.classList.toggle("connected", connected);
    if (text) text.textContent = label || (connected ? "Connected" : "Disconnected");
  }
  function panDisplay(value) {
    if (value === 64) return "C";
    return value < 64 ? `L${64 - value}` : `R${value - 64}`;
  }
  function getDeviceId() {
    const el = $("deviceId");
    return el ? parseInt(el.value, 10) : 16;
  }
  function getSelectedPart() {
    const el = $("patchPartSelect");
    return el ? parseInt(el.value, 10) : 1;
  }
  async function initMidi() {
    const hasAccess = await midi.requestAccess();
    if (!hasAccess) {
      setStatus("Web MIDI not available \u2014 use Chrome, Edge, or Opera with MIDI devices");
      return;
    }
    refreshDeviceList();
    setStatus("MIDI access granted \u2014 select device and connect");
    midi.onTraffic(handleTraffic);
  }
  function refreshDeviceList() {
    const inputSelect = $("midiInput");
    const outputSelect = $("midiOutput");
    if (!inputSelect || !outputSelect) return;
    inputSelect.innerHTML = '<option value="">\u2014 Select MIDI Input \u2014</option>';
    outputSelect.innerHTML = '<option value="">\u2014 Select MIDI Output \u2014</option>';
    const inputs = midi.getInputs();
    const outputs = midi.getOutputs();
    for (const dev of inputs) {
      const opt = document.createElement("option");
      opt.value = dev.id;
      opt.textContent = dev.name;
      inputSelect.appendChild(opt);
    }
    for (const dev of outputs) {
      const opt = document.createElement("option");
      opt.value = dev.id;
      opt.textContent = dev.name;
      outputSelect.appendChild(opt);
    }
    setStatus(`Found ${inputs.length} input(s), ${outputs.length} output(s)`);
  }
  function connectMidi() {
    const inputId = $("midiInput").value;
    const outputId = $("midiOutput").value;
    if (!inputId || !outputId) {
      setStatus("Please select both input and output ports");
      return;
    }
    if (midi.isConnected) {
      midi.disconnect();
      setConnectionStatus(false);
      $("connectBtn").textContent = "Connect";
      $("statusDeviceInfo").textContent = "";
      setStatus("Disconnected");
      return;
    }
    const success = midi.connect(inputId, outputId);
    if (success) {
      setConnectionStatus(true, `${midi.inputName}`);
      $("connectBtn").textContent = "Disconnect";
      $("statusDeviceInfo").textContent = `${midi.inputName} \u2194 ${midi.outputName}`;
      setStatus("Connected \u2014 ready to communicate");
      midi.onSysEx(handleIncomingSysEx);
    } else {
      setStatus("Connection failed \u2014 verify device selection");
    }
  }
  function handlePanic() {
    if (!midi.isConnected) return;
    midi.sendAllNotesOff();
    setStatus("Sent All Notes Off & Reset Controllers on all channels");
  }
  function handleAudition() {
    if (!midi.isConnected) {
      setStatus("Connect MIDI first to audition");
      return;
    }
    const part = getSelectedPart();
    const channel = part >= 1 && part <= 16 ? part - 1 : 0;
    if (activeAuditionTimeout) clearTimeout(activeAuditionTimeout);
    midi.sendNoteOn(channel, 60, 100);
    setStatus(`Audition Note On: C4 (Part ${part}, Ch ${channel + 1})`);
    activeAuditionTimeout = setTimeout(() => {
      midi.sendNoteOff(channel, 60);
      activeAuditionTimeout = null;
    }, 400);
  }
  function handleTraffic(direction, bytes, timestamp) {
    const tbody = $("trafficLogBody");
    if (!tbody) return;
    const date = new Date(timestamp);
    const timeStr = date.toTimeString().split(" ")[0] + "." + String(date.getMilliseconds()).padStart(3, "0");
    const isSysEx = bytes[0] === 240;
    let cmd = isSysEx ? "SysEx" : "MIDI";
    let addrStr = "\u2014";
    let sizeStr = `${bytes.length}`;
    if (isSysEx && bytes.length >= 10) {
      const cmdByte = bytes[5];
      if (cmdByte === 17) cmd = "RQ1 (Read)";
      else if (cmdByte === 18) cmd = "DT1 (Set)";
      addrStr = bytes.slice(6, 10).map((b) => b.toString(16).toUpperCase().padStart(2, "0")).join(" ");
    } else if (!isSysEx) {
      const status = bytes[0] & 240;
      if (status === 144) cmd = "Note On";
      else if (status === 128) cmd = "Note Off";
      else if (status === 176) cmd = "CC";
    }
    const tr = document.createElement("tr");
    tr.innerHTML = `
    <td>${timeStr}</td>
    <td><span class="log-badge ${direction.toLowerCase()}">${direction}</span></td>
    <td>${cmd}</td>
    <td style="font-family:var(--font-mono);">${addrStr}</td>
    <td>${sizeStr}</td>
    <td class="log-raw">${formatSysEx(bytes)}</td>
  `;
    tbody.insertBefore(tr, tbody.firstChild);
    while (tbody.children.length > 150) {
      tbody.removeChild(tbody.lastChild);
    }
  }
  function clearLog() {
    const tbody = $("trafficLogBody");
    if (tbody) tbody.innerHTML = "";
  }
  function handleIncomingSysEx(parsed) {
    if (!parsed.valid) {
      setStatus(`Received invalid SysEx: ${parsed.error}`);
      return;
    }
    const addr = parsed.address;
    if (addr[0] === 16 && addr[1] === 0 && addr[2] === 0 && addr[3] === 0) {
      const perfData = parsePerformanceCommon(parsed.data);
      updatePerformanceCommonUI(perfData);
      setStatus("Performance Common loaded");
      return;
    }
    if (addr[0] === 16 && addr[1] === 0 && addr[2] === 4 && addr[3] === 0) {
      const choData = parsePerformanceChorus(parsed.data);
      updatePerformanceChorusUI(choData);
      setStatus("Performance Chorus loaded");
      return;
    }
    if (addr[0] === 16 && addr[1] === 0 && addr[2] === 6 && addr[3] === 0) {
      const revData = parsePerformanceReverb(parsed.data);
      updatePerformanceReverbUI(revData);
      setStatus("Performance Reverb loaded");
      return;
    }
    if (addr[0] === 16 && addr[1] === 0 && addr[2] >= 32 && addr[2] <= 47 && addr[3] === 0) {
      const partNum = addr[2] - 32 + 1;
      const partData = parsePerformancePart(parsed.data);
      updatePartRow(partNum, partData);
      setStatus(`Part ${partNum} loaded`);
      return;
    }
    if (addr[2] === 0 && addr[3] === 0 && parsed.data.length >= 43) {
      const patchData = parsePatchCommon(parsed.data);
      updatePatchCommonUI(patchData);
      setStatus(`Patch Common loaded: ${patchData.name}`);
      return;
    }
    if (addr[2] === 16 && addr[3] === 0 && parsed.data.length >= 33) {
      const tmtData = parsePatchTMT(parsed.data);
      updatePatchTMTUI(tmtData);
      setStatus("Patch TMT & Tone Switches loaded");
      return;
    }
    if (addr[2] >= 32 && addr[2] <= 38 && addr[3] === 0) {
      const toneNum = Math.floor((addr[2] - 32) / 2) + 1;
      const toneData = parsePatchTone(parsed.data);
      store.set(`patch.tones.${toneNum - 1}`, toneData);
      if (currentToneIndex === toneNum) {
        updateToneUI(toneData);
      }
      setStatus(`Tone ${toneNum} loaded`);
      return;
    }
  }
  function updatePerformanceCommonUI(data) {
    $("perfName").value = data.name || "";
    $("perfSoloPart").value = data.soloPartSelect ?? 0;
    $("perfMfxCtrlCh").value = data.mfxCtrlChannel ?? 0;
    $("perfMfxASource").value = data.mfxASource ?? 0;
    $("perfChorusSource").value = data.chorusSource ?? 0;
    $("perfReverbSource").value = data.reverbSource ?? 0;
  }
  function updatePerformanceChorusUI(data) {
    $("perfChorusType").value = data.chorusType ?? 1;
    $("perfChorusLevel").value = data.chorusLevel ?? 64;
    $("perfChorusLevelVal").textContent = data.chorusLevel ?? 64;
    $("perfChorusOutputAssign").value = data.outputAssign ?? 0;
  }
  function updatePerformanceReverbUI(data) {
    $("perfReverbType").value = data.reverbType ?? 1;
    $("perfReverbLevel").value = data.reverbLevel ?? 64;
    $("perfReverbLevelVal").textContent = data.reverbLevel ?? 64;
    $("perfReverbOutputAssign").value = data.outputAssign ?? 0;
  }
  function bindPerformanceCommonControls() {
    $("perfName").addEventListener("change", () => {
      if (!midi.isConnected) return;
      sendPerformanceName(midi, $("perfName").value, getDeviceId());
      setStatus("Sent performance name");
    });
    const selectBindings = [
      { el: "perfSoloPart", param: "SOLO_PART_SELECT" },
      { el: "perfMfxCtrlCh", param: "MFX_CTRL_CHANNEL" },
      { el: "perfMfxASource", param: "MFXA_SOURCE" },
      { el: "perfChorusSource", param: "CHORUS_SOURCE" },
      { el: "perfReverbSource", param: "REVERB_SOURCE" }
    ];
    for (const b of selectBindings) {
      $(b.el).addEventListener("change", () => {
        if (!midi.isConnected) return;
        sendPerformanceCommonParam(midi, b.param, parseInt($(b.el).value, 10), getDeviceId());
      });
    }
    $("perfChorusType").addEventListener("change", () => {
      if (!midi.isConnected) return;
      sendPerformanceChorusParam(midi, "CHORUS_TYPE", parseInt($("perfChorusType").value, 10), getDeviceId());
    });
    $("perfChorusLevel").addEventListener("input", () => {
      const val = parseInt($("perfChorusLevel").value, 10);
      $("perfChorusLevelVal").textContent = val;
      if (!midi.isConnected) return;
      sendPerformanceChorusParam(midi, "CHORUS_LEVEL", val, getDeviceId());
    });
    $("perfChorusOutputAssign").addEventListener("change", () => {
      if (!midi.isConnected) return;
      sendPerformanceChorusParam(midi, "OUTPUT_ASSIGN", parseInt($("perfChorusOutputAssign").value, 10), getDeviceId());
    });
    $("perfReverbType").addEventListener("change", () => {
      if (!midi.isConnected) return;
      sendPerformanceReverbParam(midi, "REVERB_TYPE", parseInt($("perfReverbType").value, 10), getDeviceId());
    });
    $("perfReverbLevel").addEventListener("input", () => {
      const val = parseInt($("perfReverbLevel").value, 10);
      $("perfReverbLevelVal").textContent = val;
      if (!midi.isConnected) return;
      sendPerformanceReverbParam(midi, "REVERB_LEVEL", val, getDeviceId());
    });
    $("perfReverbOutputAssign").addEventListener("change", () => {
      if (!midi.isConnected) return;
      sendPerformanceReverbParam(midi, "OUTPUT_ASSIGN", parseInt($("perfReverbOutputAssign").value, 10), getDeviceId());
    });
  }
  function buildPartsTable() {
    const tbody = $("partsTableBody");
    if (!tbody) return;
    tbody.innerHTML = "";
    for (let i = 1; i <= 16; i++) {
      const tr = document.createElement("tr");
      tr.id = `partRow${i}`;
      tr.dataset.part = i;
      tr.innerHTML = `
      <td style="font-weight:600; color:var(--text-accent);">${i}</td>
      <td>
        <label class="toggle">
          <input type="checkbox" id="partSwitch${i}" checked>
          <span class="toggle-slider"></span>
        </label>
      </td>
      <td>
        <select id="partChannel${i}" style="min-width:55px;">
          ${Array.from(
        { length: 16 },
        (_, ch) => `<option value="${ch}"${ch === i - 1 ? " selected" : ""}>${ch + 1}</option>`
      ).join("")}
        </select>
      </td>
      <td><input type="number" id="partBankMSB${i}" min="0" max="127" value="87" style="width:48px;"></td>
      <td><input type="number" id="partBankLSB${i}" min="0" max="127" value="64" style="width:48px;"></td>
      <td><input type="number" id="partPC${i}" min="0" max="127" value="1" style="width:48px;"></td>
      <td>
        <div style="display:flex; align-items:center; gap:4px;">
          <input type="range" id="partLevel${i}" min="0" max="127" value="100" style="width:70px;">
          <span class="param-value" id="partLevelVal${i}" style="min-width:24px;">100</span>
        </div>
      </td>
      <td>
        <div style="display:flex; align-items:center; gap:4px;">
          <input type="range" id="partPan${i}" min="0" max="127" value="64" style="width:70px;">
          <span class="param-value" id="partPanVal${i}" style="min-width:24px;">C</span>
        </div>
      </td>
      <td>
        <div style="display:flex; align-items:center; gap:2px;">
          <input type="range" id="partCoarse${i}" min="16" max="112" value="64" style="width:60px;">
          <span class="param-value" id="partCoarseVal${i}" style="min-width:22px;">0</span>
        </div>
      </td>
      <td>
        <div style="display:flex; align-items:center; gap:2px;">
          <input type="range" id="partFine${i}" min="14" max="114" value="64" style="width:60px;">
          <span class="param-value" id="partFineVal${i}" style="min-width:22px;">0</span>
        </div>
      </td>
      <td><input type="number" id="partChorus${i}" min="0" max="127" value="0" style="width:45px;"></td>
      <td><input type="number" id="partReverb${i}" min="0" max="127" value="40" style="width:45px;"></td>
      <td>
        <select id="partAssign${i}" style="width:65px;">
          <option value="0">MFX</option><option value="1">A</option><option value="2">B</option>
          <option value="5">1</option><option value="6">2</option><option value="13">PAT</option>
        </select>
      </td>
      <td>
        <label class="toggle">
          <input type="checkbox" id="partMute${i}">
          <span class="toggle-slider"></span>
        </label>
      </td>
      <td style="white-space:nowrap;">
        <button class="btn btn-sm" id="partLoad${i}" title="Read Part ${i} from device">\u2193</button>
        <button class="btn btn-sm" id="partEditPatch${i}" title="Edit Patch for Part ${i}">\u270E</button>
      </td>
    `;
      tbody.appendChild(tr);
      bindPartControls(i);
    }
  }
  function bindPartControls(part) {
    $(`partSwitch${part}`).addEventListener("change", () => {
      if (!midi.isConnected) return;
      sendPartParam(midi, part, "RECEIVE_SWITCH", $(`partSwitch${part}`).checked ? 1 : 0, getDeviceId());
    });
    $(`partChannel${part}`).addEventListener("change", () => {
      if (!midi.isConnected) return;
      sendPartParam(midi, part, "RECEIVE_CHANNEL", parseInt($(`partChannel${part}`).value, 10), getDeviceId());
    });
    for (const [elSuffix, paramKey] of [["BankMSB", "PATCH_BANK_MSB"], ["BankLSB", "PATCH_BANK_LSB"], ["PC", "PATCH_PC"]]) {
      $(`part${elSuffix}${part}`).addEventListener("change", () => {
        if (!midi.isConnected) return;
        sendPartParam(midi, part, paramKey, parseInt($(`part${elSuffix}${part}`).value, 10), getDeviceId());
      });
    }
    $(`partLevel${part}`).addEventListener("input", () => {
      const val = parseInt($(`partLevel${part}`).value, 10);
      $(`partLevelVal${part}`).textContent = val;
      if (!midi.isConnected) return;
      sendPartParam(midi, part, "PART_LEVEL", val, getDeviceId());
    });
    $(`partPan${part}`).addEventListener("input", () => {
      const val = parseInt($(`partPan${part}`).value, 10);
      $(`partPanVal${part}`).textContent = panDisplay(val);
      if (!midi.isConnected) return;
      sendPartParam(midi, part, "PART_PAN", val, getDeviceId());
    });
    $(`partCoarse${part}`).addEventListener("input", () => {
      const val = parseInt($(`partCoarse${part}`).value, 10);
      $(`partCoarseVal${part}`).textContent = val - 64;
      if (!midi.isConnected) return;
      sendPartParam(midi, part, "COARSE_TUNE", val, getDeviceId());
    });
    $(`partFine${part}`).addEventListener("input", () => {
      const val = parseInt($(`partFine${part}`).value, 10);
      $(`partFineVal${part}`).textContent = val - 64;
      if (!midi.isConnected) return;
      sendPartParam(midi, part, "FINE_TUNE", val, getDeviceId());
    });
    $(`partChorus${part}`).addEventListener("change", () => {
      if (!midi.isConnected) return;
      sendPartParam(midi, part, "CHORUS_SEND", parseInt($(`partChorus${part}`).value, 10), getDeviceId());
    });
    $(`partReverb${part}`).addEventListener("change", () => {
      if (!midi.isConnected) return;
      sendPartParam(midi, part, "REVERB_SEND", parseInt($(`partReverb${part}`).value, 10), getDeviceId());
    });
    $(`partAssign${part}`).addEventListener("change", () => {
      if (!midi.isConnected) return;
      sendPartParam(midi, part, "OUTPUT_ASSIGN", parseInt($(`partAssign${part}`).value, 10), getDeviceId());
    });
    $(`partMute${part}`).addEventListener("change", () => {
      const muted = $(`partMute${part}`).checked;
      $(`partRow${part}`).classList.toggle("part-muted", muted);
      if (!midi.isConnected) return;
      sendPartParam(midi, part, "MUTE_SWITCH", muted ? 1 : 0, getDeviceId());
    });
    $(`partLoad${part}`).addEventListener("click", async () => {
      if (!midi.isConnected) {
        setStatus("Not connected");
        return;
      }
      setStatus(`Loading Part ${part}...`);
      try {
        const data = await requestPerformancePart(midi, part, getDeviceId());
        updatePartRow(part, data);
        setStatus(`Part ${part} loaded`);
      } catch (e) {
        setStatus(`Failed to load Part ${part}: ${e.message}`);
      }
    });
    $(`partEditPatch${part}`).addEventListener("click", () => {
      $("patchPartSelect").value = part;
      switchToTab("patch");
      $("loadPatchBtn").click();
    });
  }
  function updatePartRow(part, data) {
    $(`partSwitch${part}`).checked = !!data.receiveSwitch;
    $(`partChannel${part}`).value = data.receiveChannel ?? part - 1;
    $(`partBankMSB${part}`).value = data.patchBankMSB ?? 87;
    $(`partBankLSB${part}`).value = data.patchBankLSB ?? 64;
    $(`partPC${part}`).value = data.patchPC ?? 1;
    $(`partLevel${part}`).value = data.partLevel ?? 100;
    $(`partLevelVal${part}`).textContent = data.partLevel ?? 100;
    $(`partPan${part}`).value = data.partPan ?? 64;
    $(`partPanVal${part}`).textContent = panDisplay(data.partPan ?? 64);
    $(`partCoarse${part}`).value = data.coarseTune ?? 64;
    $(`partCoarseVal${part}`).textContent = (data.coarseTune ?? 64) - 64;
    $(`partFine${part}`).value = data.fineTune ?? 64;
    $(`partFineVal${part}`).textContent = (data.fineTune ?? 64) - 64;
    $(`partChorus${part}`).value = data.chorusSend ?? 0;
    $(`partReverb${part}`).value = data.reverbSend ?? 40;
    $(`partAssign${part}`).value = data.outputAssign ?? 0;
    $(`partMute${part}`).checked = !!data.muteSwitch;
    $(`partRow${part}`).classList.toggle("part-muted", !!data.muteSwitch);
  }
  var currentMatrixIndex = 1;
  var currentLfoIndex = 1;
  var currentPatchCommonData = null;
  var currentPatchTMTData = null;
  var currentToneCache = [null, null, null, null];
  function updatePatchCommonUI(data) {
    currentPatchCommonData = data;
    $("patchName").value = data.name || "";
    $("patchLevel").value = data.patchLevel ?? 127;
    $("patchLevelVal").textContent = data.patchLevel ?? 127;
    $("patchPan").value = data.patchPan ?? 64;
    $("patchPanVal").textContent = panDisplay(data.patchPan ?? 64);
    $("patchCoarseTune").value = data.coarseTune ?? 64;
    $("patchCoarseTuneVal").textContent = (data.coarseTune ?? 64) - 64;
    $("patchFineTune").value = data.fineTune ?? 64;
    $("patchFineTuneVal").textContent = (data.fineTune ?? 64) - 64;
    $("patchOctaveShift").value = data.octaveShift ?? 64;
    $("patchOctaveShiftVal").textContent = (data.octaveShift ?? 64) - 64;
    $("patchMonoPoly").value = data.monoPoly ?? 1;
    $("patchLegato").checked = !!data.legatoSwitch;
    $("patchPortamento").checked = !!data.portamentoSwitch;
    $("patchPortaTime").value = data.portamentoTime ?? 0;
    $("patchPortaTimeVal").textContent = data.portamentoTime ?? 0;
    $("patchBendUp").value = data.bendRangeUp ?? 2;
    $("patchBendDown").value = data.bendRangeDown ?? 2;
    $("patchOutputAssign").value = data.outputAssign ?? 0;
    updateMatrixUI(currentMatrixIndex);
  }
  function updateMatrixUI(mIdx) {
    if (!currentPatchCommonData) return;
    const data = currentPatchCommonData;
    const src = data[`matrix${mIdx}Source`] ?? 0;
    const sEl = $("matrixSource");
    if (sEl) sEl.value = src;
    for (let d = 1; d <= 4; d++) {
      const dest = data[`matrix${mIdx}Dest${d}`] ?? 0;
      const sens = data[`matrix${mIdx}Sens${d}`] ?? 64;
      const dEl = $(`matrixDest${d}`);
      const sensEl = $(`matrixSens${d}`);
      const sensValEl = $(`matrixSens${d}Val`);
      if (dEl) dEl.value = dest;
      if (sensEl) sensEl.value = sens;
      if (sensValEl) sensValEl.textContent = sens - 64;
    }
  }
  function updatePatchTMTUI(data) {
    currentPatchTMTData = data;
    $("struct12").value = data.structureType12 ?? 0;
    $("booster12").value = data.booster12 ?? 0;
    $("struct34").value = data.structureType34 ?? 0;
    $("booster34").value = data.booster34 ?? 0;
    $("tmtVelCtrl").value = data.tmtVelControl ?? 0;
    for (let t = 1; t <= 4; t++) {
      const sw = $(`tone${t}Switch`);
      const on = !!data[`tone${t}Switch`];
      sw.checked = on;
      sw.closest(".tone-switch").classList.toggle("active", on);
    }
    updateTMTZoneUI(currentToneIndex);
  }
  function updateTMTZoneUI(tone) {
    if (!currentPatchTMTData) return;
    const data = currentPatchTMTData;
    $("currentZoneToneLabel").textContent = `${tone}`;
    const kLow = data[`tone${tone}KeyLower`] ?? 0;
    const kUp = data[`tone${tone}KeyUpper`] ?? 127;
    const vLow = data[`tone${tone}VelLower`] ?? 1;
    const vUp = data[`tone${tone}VelUpper`] ?? 127;
    $("tmtKeyLower").value = kLow;
    $("tmtKeyLowerVal").textContent = formatKeyNote(kLow);
    $("tmtKeyUpper").value = kUp;
    $("tmtKeyUpperVal").textContent = formatKeyNote(kUp);
    $("tmtVelLower").value = vLow;
    $("tmtVelLowerVal").textContent = vLow;
    $("tmtVelUpper").value = vUp;
    $("tmtVelUpperVal").textContent = vUp;
  }
  function formatKeyNote(midiNote) {
    const notes = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];
    const oct = Math.floor(midiNote / 12) - 1;
    return `${notes[midiNote % 12]}${oct}`;
  }
  function updateToneUI(data) {
    if (!data) return;
    currentToneCache[currentToneIndex - 1] = data;
    $("toneLevel").value = data.toneLevel ?? 127;
    $("toneLevelVal").textContent = data.toneLevel ?? 127;
    $("tonePan").value = data.tonePan ?? 64;
    $("tonePanVal").textContent = panDisplay(data.tonePan ?? 64);
    $("toneCoarseTune").value = data.coarseTune ?? 64;
    $("toneCoarseTuneVal").textContent = (data.coarseTune ?? 64) - 64;
    $("toneFineTune").value = data.fineTune ?? 64;
    $("toneFineTuneVal").textContent = (data.fineTune ?? 64) - 64;
    $("waveGroup").value = data.waveGroupType ?? 0;
    $("waveGain").value = data.waveGain ?? 1;
    $("waveFxmSwitch").checked = !!data.fxmSwitch;
    $("waveFxmDepth").value = data.fxmDepth ?? 0;
    $("waveFxmDepthVal").textContent = data.fxmDepth ?? 0;
    const pDepth = data.pitchEnvDepth ?? 64;
    $("pitchEnvDepth").value = pDepth;
    $("pitchEnvDepthVal").textContent = pDepth - 64;
    $("pitchEnvT1").value = data.pitchEnvT1 ?? 20;
    $("pitchEnvT1Val").textContent = data.pitchEnvT1 ?? 20;
    $("pitchEnvT2").value = data.pitchEnvT2 ?? 20;
    $("pitchEnvT2Val").textContent = data.pitchEnvT2 ?? 20;
    $("pitchEnvT3").value = data.pitchEnvT3 ?? 40;
    $("pitchEnvT3Val").textContent = data.pitchEnvT3 ?? 40;
    $("pitchEnvT4").value = data.pitchEnvT4 ?? 40;
    $("pitchEnvT4Val").textContent = data.pitchEnvT4 ?? 40;
    $("pitchEnvL1").value = data.pitchEnvL1 ?? 64;
    $("pitchEnvL1Val").textContent = (data.pitchEnvL1 ?? 64) - 64;
    $("toneFilterType").value = data.tvfFilterType ?? 0;
    $("toneCutoff").value = data.tvfCutoff ?? 127;
    $("toneCutoffVal").textContent = data.tvfCutoff ?? 127;
    $("toneResonance").value = data.tvfResonance ?? 0;
    $("toneResonanceVal").textContent = data.tvfResonance ?? 0;
    const tvfDepth = data.tvfEnvDepth ?? 64;
    $("tvfEnvDepth").value = tvfDepth;
    $("tvfEnvDepthVal").textContent = tvfDepth - 64;
    $("tvfEnvT1").value = data.tvfEnvT1 ?? 15;
    $("tvfEnvT1Val").textContent = data.tvfEnvT1 ?? 15;
    $("tvfEnvT4").value = data.tvfEnvT4 ?? 40;
    $("tvfEnvT4Val").textContent = data.tvfEnvT4 ?? 40;
    $("toneTvaLevel").value = data.tvaLevel ?? 127;
    $("toneTvaLevelVal").textContent = data.tvaLevel ?? 127;
    $("tvaEnvT1").value = data.tvaEnvT1 ?? 10;
    $("tvaEnvT1Val").textContent = data.tvaEnvT1 ?? 10;
    $("tvaEnvT2").value = data.tvaEnvT2 ?? 20;
    $("tvaEnvT2Val").textContent = data.tvaEnvT2 ?? 20;
    $("tvaEnvT3").value = data.tvaEnvT3 ?? 40;
    $("tvaEnvT3Val").textContent = data.tvaEnvT3 ?? 40;
    $("tvaEnvT4").value = data.tvaEnvT4 ?? 30;
    $("tvaEnvT4Val").textContent = data.tvaEnvT4 ?? 30;
    $("tvaEnvL3").value = data.tvaEnvL3 ?? 70;
    $("tvaEnvL3Val").textContent = data.tvaEnvL3 ?? 70;
    updateToneLFOUI(currentLfoIndex);
    redrawAllCurves();
  }
  function updateToneLFOUI(lfoNum) {
    const data = currentToneCache[currentToneIndex - 1];
    if (!data) return;
    const form = data[`lfo${lfoNum}Form`] ?? 0;
    const rate = data[`lfo${lfoNum}Rate`] ?? 64;
    const pDepth = data[`lfo${lfoNum}PitchDepth`] ?? 64;
    const fDepth = data[`lfo${lfoNum}TvfDepth`] ?? 64;
    const aDepth = data[`lfo${lfoNum}TvaDepth`] ?? 64;
    const panDepth = data[`lfo${lfoNum}PanDepth`] ?? 64;
    $("lfoForm").value = form;
    $("lfoRate").value = rate;
    $("lfoRateVal").textContent = rate;
    $("lfoPitchDepth").value = pDepth;
    $("lfoPitchDepthVal").textContent = pDepth - 64;
    $("lfoTvfDepth").value = fDepth;
    $("lfoTvfDepthVal").textContent = fDepth - 64;
    $("lfoTvaDepth").value = aDepth;
    $("lfoTvaDepthVal").textContent = aDepth - 64;
    $("lfoPanDepth").value = panDepth;
    $("lfoPanDepthVal").textContent = panDepth - 64;
    redrawLFOCurve();
  }
  function redrawAllCurves() {
    redrawPitchEnvCurve();
    redrawFilterCurves();
    redrawTVAEnvCurve();
    redrawLFOCurve();
  }
  function redrawPitchEnvCurve() {
    const t1 = parseInt($("pitchEnvT1").value, 10);
    const t2 = parseInt($("pitchEnvT2").value, 10);
    const t3 = parseInt($("pitchEnvT3").value, 10);
    const t4 = parseInt($("pitchEnvT4").value, 10);
    const l1 = parseInt($("pitchEnvL1").value, 10);
    const depth = parseInt($("pitchEnvDepth").value, 10) - 64;
    const d = generateEnvelopePath("pitch", { t1, t2, t3, t4, l0: 64, l1, l2: 64, l3: 64, l4: 64 });
    $("pitchEnvPath").setAttribute("d", d);
    $("pitchEnvBadge").textContent = `Depth: ${depth >= 0 ? "+" : ""}${depth} semi`;
  }
  function redrawFilterCurves() {
    const fType = parseInt($("toneFilterType").value, 10);
    const cutoff = parseInt($("toneCutoff").value, 10);
    const resonance = parseInt($("toneResonance").value, 10);
    const t1 = parseInt($("tvfEnvT1").value, 10);
    const t4 = parseInt($("tvfEnvT4").value, 10);
    const filterD = generateFilterCurvePath(fType, cutoff, resonance);
    $("filterRespPath").setAttribute("d", filterD);
    $("filterRespBadge").textContent = FILTER_TYPES[fType] || "LPF";
    const envD = generateEnvelopePath("tvf", { t1, t2: 25, t3: 40, t4, l1: 127, l2: 90, l3: 60, l4: 0 });
    $("tvfEnvPath").setAttribute("d", envD);
  }
  function redrawTVAEnvCurve() {
    const t1 = parseInt($("tvaEnvT1").value, 10);
    const t2 = parseInt($("tvaEnvT2").value, 10);
    const t3 = parseInt($("tvaEnvT3").value, 10);
    const t4 = parseInt($("tvaEnvT4").value, 10);
    const l3 = parseInt($("tvaEnvL3").value, 10);
    const level = parseInt($("toneTvaLevel").value, 10);
    const envD = generateEnvelopePath("tva", { t1, t2, t3, t4, l1: level, l2: Math.floor(level * 0.8), l3 });
    $("tvaEnvPath").setAttribute("d", envD);
    $("tvaEnvBadge").textContent = `Level: ${level}`;
  }
  function redrawLFOCurve() {
    const form = parseInt($("lfoForm").value, 10);
    const rate = parseInt($("lfoRate").value, 10);
    const waveD = generateLFOWavePath(form, rate);
    $("lfoWavePath").setAttribute("d", waveD);
    $("lfoWaveBadge").textContent = `${LFO_WAVEFORMS[form] || "TRI"} @ Rate ${rate}`;
  }
  function populateMatrixDropdowns() {
    const srcSelect = $("matrixSource");
    if (srcSelect && srcSelect.children.length === 0) {
      MATRIX_SOURCES.forEach((name, idx) => {
        const opt = document.createElement("option");
        opt.value = idx;
        opt.textContent = `${idx}: ${name}`;
        srcSelect.appendChild(opt);
      });
    }
    for (let d = 1; d <= 4; d++) {
      const destSelect = $(`matrixDest${d}`);
      if (destSelect && destSelect.children.length === 0) {
        MATRIX_DESTINATIONS.forEach((name, idx) => {
          const opt = document.createElement("option");
          opt.value = idx;
          opt.textContent = `${idx}: ${name}`;
          destSelect.appendChild(opt);
        });
      }
    }
  }
  function bindPatchControls() {
    const currentPart = () => getSelectedPart();
    populateMatrixDropdowns();
    $("patchName").addEventListener("change", () => {
      if (!midi.isConnected) return;
      sendPatchName(midi, currentPart(), $("patchName").value, getDeviceId());
      setStatus("Sent patch name");
    });
    const sliders = [
      { el: "patchLevel", valEl: "patchLevelVal", param: "PATCH_LEVEL", format: (v) => v },
      { el: "patchPan", valEl: "patchPanVal", param: "PATCH_PAN", format: panDisplay },
      { el: "patchCoarseTune", valEl: "patchCoarseTuneVal", param: "COARSE_TUNE", format: (v) => v - 64 },
      { el: "patchFineTune", valEl: "patchFineTuneVal", param: "FINE_TUNE", format: (v) => v - 64 },
      { el: "patchOctaveShift", valEl: "patchOctaveShiftVal", param: "OCTAVE_SHIFT", format: (v) => v - 64 },
      { el: "patchPortaTime", valEl: "patchPortaTimeVal", param: "PORTAMENTO_TIME", format: (v) => v }
    ];
    for (const s of sliders) {
      $(s.el).addEventListener("input", () => {
        const val = parseInt($(s.el).value, 10);
        $(s.valEl).textContent = s.format(val);
        if (!midi.isConnected) return;
        sendPatchCommonParam(midi, currentPart(), s.param, val, getDeviceId());
      });
    }
    $("patchLegato").addEventListener("change", () => {
      if (!midi.isConnected) return;
      sendPatchCommonParam(midi, currentPart(), "LEGATO_SWITCH", $("patchLegato").checked ? 1 : 0, getDeviceId());
    });
    $("patchPortamento").addEventListener("change", () => {
      if (!midi.isConnected) return;
      sendPatchCommonParam(midi, currentPart(), "PORTAMENTO_SWITCH", $("patchPortamento").checked ? 1 : 0, getDeviceId());
    });
    $("patchMonoPoly").addEventListener("change", () => {
      if (!midi.isConnected) return;
      sendPatchCommonParam(midi, currentPart(), "MONO_POLY", parseInt($("patchMonoPoly").value, 10), getDeviceId());
    });
    $("patchOutputAssign").addEventListener("change", () => {
      if (!midi.isConnected) return;
      sendPatchCommonParam(midi, currentPart(), "OUTPUT_ASSIGN", parseInt($("patchOutputAssign").value, 10), getDeviceId());
    });
    $("patchBendUp").addEventListener("change", () => {
      if (!midi.isConnected) return;
      sendPatchCommonParam(midi, currentPart(), "BEND_RANGE_UP", parseInt($("patchBendUp").value, 10), getDeviceId());
    });
    $("patchBendDown").addEventListener("change", () => {
      if (!midi.isConnected) return;
      sendPatchCommonParam(midi, currentPart(), "BEND_RANGE_DOWN", parseInt($("patchBendDown").value, 10), getDeviceId());
    });
    for (let m = 1; m <= 4; m++) {
      $(`btnMatrix${m}`).addEventListener("click", () => {
        for (let i = 1; i <= 4; i++) {
          $(`btnMatrix${i}`).classList.toggle("active", i === m);
        }
        currentMatrixIndex = m;
        updateMatrixUI(m);
      });
    }
    $("matrixSource").addEventListener("change", () => {
      const val = parseInt($("matrixSource").value, 10);
      if (currentPatchCommonData) currentPatchCommonData[`matrix${currentMatrixIndex}Source`] = val;
      if (!midi.isConnected) return;
      sendMatrixControlParam(midi, currentPart(), currentMatrixIndex, "SOURCE", val, getDeviceId());
    });
    for (let d = 1; d <= 4; d++) {
      $(`matrixDest${d}`).addEventListener("change", () => {
        const val = parseInt($(`matrixDest${d}`).value, 10);
        if (currentPatchCommonData) currentPatchCommonData[`matrix${currentMatrixIndex}Dest${d}`] = val;
        if (!midi.isConnected) return;
        sendMatrixControlParam(midi, currentPart(), currentMatrixIndex, `DEST_${d}`, val, getDeviceId());
      });
      $(`matrixSens${d}`).addEventListener("input", () => {
        const val = parseInt($(`matrixSens${d}`).value, 10);
        $(`matrixSens${d}Val`).textContent = val - 64;
        if (currentPatchCommonData) currentPatchCommonData[`matrix${currentMatrixIndex}Sens${d}`] = val;
        if (!midi.isConnected) return;
        sendMatrixControlParam(midi, currentPart(), currentMatrixIndex, `SENS_${d}`, val, getDeviceId());
      });
    }
    $("struct12").addEventListener("change", () => {
      if (!midi.isConnected) return;
      sendPatchTMTParam(midi, currentPart(), "STRUCTURE_TYPE_1_2", parseInt($("struct12").value, 10), getDeviceId());
    });
    $("booster12").addEventListener("change", () => {
      if (!midi.isConnected) return;
      sendPatchTMTParam(midi, currentPart(), "BOOSTER_1_2", parseInt($("booster12").value, 10), getDeviceId());
    });
    $("struct34").addEventListener("change", () => {
      if (!midi.isConnected) return;
      sendPatchTMTParam(midi, currentPart(), "STRUCTURE_TYPE_3_4", parseInt($("struct34").value, 10), getDeviceId());
    });
    $("booster34").addEventListener("change", () => {
      if (!midi.isConnected) return;
      sendPatchTMTParam(midi, currentPart(), "BOOSTER_3_4", parseInt($("booster34").value, 10), getDeviceId());
    });
    $("tmtVelCtrl").addEventListener("change", () => {
      if (!midi.isConnected) return;
      sendPatchTMTParam(midi, currentPart(), "TMT_VEL_CONTROL", parseInt($("tmtVelCtrl").value, 10), getDeviceId());
    });
    $("tmtKeyLower").addEventListener("input", () => {
      const val = parseInt($("tmtKeyLower").value, 10);
      $("tmtKeyLowerVal").textContent = formatKeyNote(val);
      if (!midi.isConnected) return;
      sendTMTKeyRangeParam(midi, currentPart(), currentToneIndex, "KEY_LOWER", val, getDeviceId());
    });
    $("tmtKeyUpper").addEventListener("input", () => {
      const val = parseInt($("tmtKeyUpper").value, 10);
      $("tmtKeyUpperVal").textContent = formatKeyNote(val);
      if (!midi.isConnected) return;
      sendTMTKeyRangeParam(midi, currentPart(), currentToneIndex, "KEY_UPPER", val, getDeviceId());
    });
    $("tmtVelLower").addEventListener("input", () => {
      const val = parseInt($("tmtVelLower").value, 10);
      $("tmtVelLowerVal").textContent = val;
      if (!midi.isConnected) return;
      sendTMTKeyRangeParam(midi, currentPart(), currentToneIndex, "VEL_LOWER", val, getDeviceId());
    });
    $("tmtVelUpper").addEventListener("input", () => {
      const val = parseInt($("tmtVelUpper").value, 10);
      $("tmtVelUpperVal").textContent = val;
      if (!midi.isConnected) return;
      sendTMTKeyRangeParam(midi, currentPart(), currentToneIndex, "VEL_UPPER", val, getDeviceId());
    });
    for (let t = 1; t <= 4; t++) {
      $(`tone${t}Switch`).addEventListener("change", () => {
        const on = $(`tone${t}Switch`).checked;
        $(`tone${t}Switch`).closest(".tone-switch").classList.toggle("active", on);
        if (!midi.isConnected) return;
        sendToneSwitch(midi, currentPart(), t, on, getDeviceId());
        setStatus(`Tone ${t} ${on ? "ON" : "OFF"}`);
      });
    }
    for (let t = 1; t <= 4; t++) {
      $(`btnSelectTone${t}`).addEventListener("click", () => {
        for (let i = 1; i <= 4; i++) {
          $(`btnSelectTone${i}`).classList.toggle("active", i === t);
        }
        currentToneIndex = t;
        updateTMTZoneUI(t);
        const cached = currentToneCache[t - 1] || store.get(`patch.tones.${t - 1}`);
        if (cached) {
          updateToneUI(cached);
        }
      });
    }
    const toneSliders = [
      { el: "toneLevel", valEl: "toneLevelVal", param: "TONE_LEVEL", format: (v) => v },
      { el: "tonePan", valEl: "tonePanVal", param: "TONE_PAN", format: panDisplay },
      { el: "toneCoarseTune", valEl: "toneCoarseTuneVal", param: "COARSE_TUNE", format: (v) => v - 64 },
      { el: "toneFineTune", valEl: "toneFineTuneVal", param: "FINE_TUNE", format: (v) => v - 64 },
      { el: "waveFxmDepth", valEl: "waveFxmDepthVal", param: "WAVE_FXM_DEPTH", format: (v) => v },
      { el: "toneCutoff", valEl: "toneCutoffVal", param: "TVF_CUTOFF", format: (v) => v, onUpdate: redrawFilterCurves },
      { el: "toneResonance", valEl: "toneResonanceVal", param: "TVF_RESONANCE", format: (v) => v, onUpdate: redrawFilterCurves },
      { el: "toneTvaLevel", valEl: "toneTvaLevelVal", param: "TVA_LEVEL", format: (v) => v, onUpdate: redrawTVAEnvCurve }
    ];
    for (const s of toneSliders) {
      $(s.el).addEventListener("input", () => {
        const val = parseInt($(s.el).value, 10);
        $(s.valEl).textContent = s.format(val);
        if (s.onUpdate) s.onUpdate();
        if (!midi.isConnected) return;
        sendPatchToneParam(midi, currentPart(), currentToneIndex, s.param, val, getDeviceId());
      });
    }
    $("waveGroup").addEventListener("change", () => {
      if (!midi.isConnected) return;
      sendPatchToneParam(midi, currentPart(), currentToneIndex, "WAVE_GROUP_TYPE", parseInt($("waveGroup").value, 10), getDeviceId());
    });
    $("waveGain").addEventListener("change", () => {
      if (!midi.isConnected) return;
      sendPatchToneParam(midi, currentPart(), currentToneIndex, "WAVE_GAIN", parseInt($("waveGain").value, 10), getDeviceId());
    });
    $("waveFxmSwitch").addEventListener("change", () => {
      if (!midi.isConnected) return;
      sendPatchToneParam(midi, currentPart(), currentToneIndex, "WAVE_FXM_SWITCH", $("waveFxmSwitch").checked ? 1 : 0, getDeviceId());
    });
    const pitchEnvInputs = [
      { el: "pitchEnvDepth", valEl: "pitchEnvDepthVal", param: "PITCH_ENV_DEPTH", format: (v) => v - 64 },
      { el: "pitchEnvT1", valEl: "pitchEnvT1Val", param: "PITCH_ENV_T1", format: (v) => v },
      { el: "pitchEnvT2", valEl: "pitchEnvT2Val", param: "PITCH_ENV_T2", format: (v) => v },
      { el: "pitchEnvT3", valEl: "pitchEnvT3Val", param: "PITCH_ENV_T3", format: (v) => v },
      { el: "pitchEnvT4", valEl: "pitchEnvT4Val", param: "PITCH_ENV_T4", format: (v) => v },
      { el: "pitchEnvL1", valEl: "pitchEnvL1Val", param: "PITCH_ENV_L1", format: (v) => v - 64 }
    ];
    for (const p of pitchEnvInputs) {
      $(p.el).addEventListener("input", () => {
        const val = parseInt($(p.el).value, 10);
        $(p.valEl).textContent = p.format(val);
        redrawPitchEnvCurve();
        if (!midi.isConnected) return;
        sendPatchToneParam(midi, currentPart(), currentToneIndex, p.param, val, getDeviceId());
      });
    }
    $("toneFilterType").addEventListener("change", () => {
      redrawFilterCurves();
      if (!midi.isConnected) return;
      sendPatchToneParam(midi, currentPart(), currentToneIndex, "TVF_FILTER_TYPE", parseInt($("toneFilterType").value, 10), getDeviceId());
    });
    $("tvfEnvDepth").addEventListener("input", () => {
      const val = parseInt($("tvfEnvDepth").value, 10);
      $("tvfEnvDepthVal").textContent = val - 64;
      redrawFilterCurves();
      if (!midi.isConnected) return;
      sendPatchToneParam(midi, currentPart(), currentToneIndex, "TVF_ENV_DEPTH", val, getDeviceId());
    });
    $("tvfEnvT1").addEventListener("input", () => {
      const val = parseInt($("tvfEnvT1").value, 10);
      $("tvfEnvT1Val").textContent = val;
      redrawFilterCurves();
      if (!midi.isConnected) return;
      sendPatchToneParam(midi, currentPart(), currentToneIndex, "TVF_ENV_T1", val, getDeviceId());
    });
    $("tvfEnvT4").addEventListener("input", () => {
      const val = parseInt($("tvfEnvT4").value, 10);
      $("tvfEnvT4Val").textContent = val;
      redrawFilterCurves();
      if (!midi.isConnected) return;
      sendPatchToneParam(midi, currentPart(), currentToneIndex, "TVF_ENV_T4", val, getDeviceId());
    });
    const tvaInputs = [
      { el: "tvaEnvT1", valEl: "tvaEnvT1Val", param: "TVA_ENV_T1" },
      { el: "tvaEnvT2", valEl: "tvaEnvT2Val", param: "TVA_ENV_T2" },
      { el: "tvaEnvT3", valEl: "tvaEnvT3Val", param: "TVA_ENV_T3" },
      { el: "tvaEnvT4", valEl: "tvaEnvT4Val", param: "TVA_ENV_T4" },
      { el: "tvaEnvL3", valEl: "tvaEnvL3Val", param: "TVA_ENV_L3" }
    ];
    for (const t of tvaInputs) {
      $(t.el).addEventListener("input", () => {
        const val = parseInt($(t.el).value, 10);
        $(t.valEl).textContent = val;
        redrawTVAEnvCurve();
        if (!midi.isConnected) return;
        sendPatchToneParam(midi, currentPart(), currentToneIndex, t.param, val, getDeviceId());
      });
    }
    $("btnLfo1").addEventListener("click", () => {
      $("btnLfo1").classList.add("active");
      $("btnLfo2").classList.remove("active");
      currentLfoIndex = 1;
      updateToneLFOUI(1);
    });
    $("btnLfo2").addEventListener("click", () => {
      $("btnLfo2").classList.add("active");
      $("btnLfo1").classList.remove("active");
      currentLfoIndex = 2;
      updateToneLFOUI(2);
    });
    $("lfoForm").addEventListener("change", () => {
      const val = parseInt($("lfoForm").value, 10);
      redrawLFOCurve();
      if (!midi.isConnected) return;
      sendToneLFOParam(midi, currentPart(), currentToneIndex, currentLfoIndex, "FORM", val, getDeviceId());
    });
    $("lfoRate").addEventListener("input", () => {
      const val = parseInt($("lfoRate").value, 10);
      $("lfoRateVal").textContent = val;
      redrawLFOCurve();
      if (!midi.isConnected) return;
      sendToneLFOParam(midi, currentPart(), currentToneIndex, currentLfoIndex, "RATE", val, getDeviceId());
    });
    const lfoDepths = [
      { el: "lfoPitchDepth", valEl: "lfoPitchDepthVal", param: "PITCH_DEPTH" },
      { el: "lfoTvfDepth", valEl: "lfoTvfDepthVal", param: "TVF_DEPTH" },
      { el: "lfoTvaDepth", valEl: "lfoTvaDepthVal", param: "TVA_DEPTH" },
      { el: "lfoPanDepth", valEl: "lfoPanDepthVal", param: "PAN_DEPTH" }
    ];
    for (const d of lfoDepths) {
      $(d.el).addEventListener("input", () => {
        const val = parseInt($(d.el).value, 10);
        $(d.valEl).textContent = val - 64;
        if (!midi.isConnected) return;
        sendToneLFOParam(midi, currentPart(), currentToneIndex, currentLfoIndex, d.param, val, getDeviceId());
      });
    }
    $("loadPatchBtn").addEventListener("click", async () => {
      if (!midi.isConnected) {
        setStatus("Not connected");
        return;
      }
      const part = currentPart();
      setStatus(`Loading Patch Common & TMT for Part ${part}...`);
      try {
        const common = await requestPatchCommon(midi, part, getDeviceId());
        updatePatchCommonUI(common);
        const tmt = await requestPatchTMT(midi, part, getDeviceId());
        updatePatchTMTUI(tmt);
        setStatus(`Patch loaded: ${common.name}`);
      } catch (e) {
        setStatus(`Failed to load patch: ${e.message}`);
      }
    });
    $("loadTonesBtn").addEventListener("click", async () => {
      if (!midi.isConnected) {
        setStatus("Not connected");
        return;
      }
      const part = currentPart();
      setStatus(`Loading 4 tones for Part ${part}...`);
      try {
        for (let t = 1; t <= 4; t++) {
          const toneData = await requestPatchTone(midi, part, t, getDeviceId());
          store.set(`patch.tones.${t - 1}`, toneData);
          currentToneCache[t - 1] = toneData;
          if (currentToneIndex === t) {
            updateToneUI(toneData);
          }
          await new Promise((r) => setTimeout(r, 40));
        }
        setStatus(`Loaded all 4 tones for Part ${part}`);
      } catch (e) {
        setStatus(`Failed loading tones: ${e.message}`);
      }
    });
  }
  function downloadBinaryBlob(uint8Array, filename) {
    const blob = new Blob([uint8Array], { type: "application/octet-stream" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }
  function initLibrarianControls() {
    renderMemoryBank();
    $("btnExportPatchSyx").addEventListener("click", () => {
      const commonBytes = new Array(79).fill(0);
      const tmtBytes = new Array(41).fill(0);
      const patchName = ($("patchName").value || "USER PATCH").padEnd(12, " ").slice(0, 12);
      for (let i = 0; i < 12; i++) commonBytes[i] = patchName.charCodeAt(i);
      commonBytes[14] = parseInt($("patchLevel").value, 10);
      commonBytes[15] = parseInt($("patchPan").value, 10);
      commonBytes[17] = parseInt($("patchCoarseTune").value, 10);
      commonBytes[18] = parseInt($("patchFineTune").value, 10);
      for (let t = 1; t <= 4; t++) {
        tmtBytes[5 + (t - 1) * 9] = $(`tone${t}Switch`).checked ? 1 : 0;
      }
      const packets = createPatchSyxDump(getSelectedPart(), commonBytes, tmtBytes, getDeviceId());
      const syxFile = exportToSyx(packets);
      const safeName = patchName.trim().replace(/[^a-zA-Z0-9_-]/g, "_") || "patch";
      downloadBinaryBlob(syxFile, `${safeName}.syx`);
      setStatus(`Exported patch to ${safeName}.syx`);
    });
    $("btnExportPerfSyx").addEventListener("click", () => {
      const commonData = new Array(53).fill(0);
      const chorusData = new Array(52).fill(0);
      const reverbData = new Array(83).fill(0);
      const partsData = Array.from({ length: 16 }, () => new Array(49).fill(0));
      const perfName = ($("perfName").value || "PERFORMANCE").padEnd(12, " ").slice(0, 12);
      for (let i = 0; i < 12; i++) commonData[i] = perfName.charCodeAt(i);
      const packets = createPerformanceSyxDump(commonData, chorusData, reverbData, partsData, getDeviceId());
      const syxFile = exportToSyx(packets);
      const safeName = perfName.trim().replace(/[^a-zA-Z0-9_-]/g, "_") || "performance";
      downloadBinaryBlob(syxFile, `${safeName}.syx`);
      setStatus(`Exported performance to ${safeName}.syx`);
    });
    const dropzone = $("syxDropzone");
    const fileInput = $("syxFileInput");
    dropzone.addEventListener("click", () => fileInput.click());
    dropzone.addEventListener("dragover", (e) => {
      e.preventDefault();
      dropzone.classList.add("dragover");
    });
    dropzone.addEventListener("dragleave", () => dropzone.classList.remove("dragover"));
    dropzone.addEventListener("drop", (e) => {
      e.preventDefault();
      dropzone.classList.remove("dragover");
      if (e.dataTransfer.files.length > 0) {
        handleSyxFile(e.dataTransfer.files[0]);
      }
    });
    fileInput.addEventListener("change", () => {
      if (fileInput.files.length > 0) {
        handleSyxFile(fileInput.files[0]);
      }
    });
    $("btnSaveCurrentPatchSlot").addEventListener("click", () => {
      const name = $("patchName").value.trim() || `Patch ${(/* @__PURE__ */ new Date()).toLocaleTimeString()}`;
      const slotData = {
        name,
        timestamp: Date.now(),
        level: parseInt($("patchLevel").value, 10),
        pan: parseInt($("patchPan").value, 10),
        coarse: parseInt($("patchCoarseTune").value, 10),
        fine: parseInt($("patchFineTune").value, 10),
        monoPoly: parseInt($("patchMonoPoly").value, 10)
      };
      const slots = getStoredSlots();
      slots.push(slotData);
      localStorage.setItem("xv5050_user_patches", JSON.stringify(slots));
      renderMemoryBank();
      setStatus(`Saved patch '${name}' to memory bank`);
    });
  }
  function getStoredSlots() {
    try {
      const raw = localStorage.getItem("xv5050_user_patches");
      return raw ? JSON.parse(raw) : [];
    } catch {
      return [];
    }
  }
  function renderMemoryBank() {
    const container = $("bankGridContainer");
    if (!container) return;
    const slots = getStoredSlots();
    if (slots.length === 0) {
      container.innerHTML = '<div style="color:var(--text-muted); font-size:0.85rem; padding:12px;">No stored patches in local memory. Click "Save Active Patch to Slot" above.</div>';
      return;
    }
    container.innerHTML = "";
    slots.forEach((s, idx) => {
      const card = document.createElement("div");
      card.className = "bank-slot-card";
      card.innerHTML = `
      <div>
        <div class="bank-slot-num">SLOT ${String(idx + 1).padStart(2, "0")}</div>
        <div class="bank-slot-name">${s.name}</div>
        <div style="font-size:0.75rem; color:var(--text-secondary); margin-top:4px;">
          Level: ${s.level} | Pan: ${panDisplay(s.pan)}
        </div>
      </div>
      <div class="bank-slot-actions">
        <button class="btn btn-sm btn-primary" id="btnRecallSlot${idx}">Recall</button>
        <button class="btn btn-sm" id="btnDeleteSlot${idx}">\u2715</button>
      </div>
    `;
      container.appendChild(card);
      card.querySelector(`#btnRecallSlot${idx}`).addEventListener("click", () => {
        $("patchName").value = s.name;
        $("patchLevel").value = s.level;
        $("patchLevelVal").textContent = s.level;
        $("patchPan").value = s.pan;
        $("patchPanVal").textContent = panDisplay(s.pan);
        $("patchCoarseTune").value = s.coarse;
        $("patchCoarseTuneVal").textContent = s.coarse - 64;
        $("patchFineTune").value = s.fine;
        $("patchFineTuneVal").textContent = s.fine - 64;
        $("patchMonoPoly").value = s.monoPoly;
        setStatus(`Recalled patch '${s.name}' from slot ${idx + 1}`);
      });
      card.querySelector(`#btnDeleteSlot${idx}`).addEventListener("click", () => {
        const remaining = slots.filter((_, i) => i !== idx);
        localStorage.setItem("xv5050_user_patches", JSON.stringify(remaining));
        renderMemoryBank();
      });
    });
  }
  async function handleSyxFile(file) {
    const statusEl = $("syxImportStatus");
    statusEl.textContent = `Reading ${file.name}...`;
    try {
      const arrayBuffer = await file.arrayBuffer();
      const packets = parseSyxFile(arrayBuffer);
      const validCount = packets.filter((p) => p.valid).length;
      if (validCount === 0) {
        statusEl.textContent = `No valid SysEx packets recognized in ${file.name}`;
        return;
      }
      statusEl.innerHTML = `<span style="color:var(--success);">\u2713 Loaded ${validCount} valid SysEx packets from ${file.name}.</span> <button class="btn btn-sm btn-primary" id="btnTransmitSyxPackets" style="margin-left:8px;">Send ${validCount} Packets to Device</button>`;
      $("btnTransmitSyxPackets").addEventListener("click", async () => {
        if (!midi.isConnected) {
          setStatus("Connect MIDI first");
          return;
        }
        setStatus(`Transmitting ${validCount} SysEx packets...`);
        for (const p of packets) {
          if (p.valid && p.address && p.data) {
            const raw = buildDT1(p.address, p.data, p.deviceId || getDeviceId());
            midi.send(raw);
            await new Promise((r) => setTimeout(r, 25));
          }
        }
        setStatus(`Transmitted ${validCount} SysEx packets to synthesizer`);
      });
    } catch (err) {
      statusEl.textContent = `Error reading SYX file: ${err.message}`;
    }
  }
  async function loadPerformanceCommon() {
    if (!midi.isConnected) {
      setStatus("Not connected");
      return;
    }
    setStatus("Loading Performance Common...");
    try {
      const data = await requestPerformanceCommon(midi, getDeviceId());
      updatePerformanceCommonUI(data);
      setStatus(`Performance Common loaded: ${data.name}`);
    } catch (e) {
      setStatus(`Failed loading performance common: ${e.message}`);
    }
  }
  async function loadPerformanceFx() {
    if (!midi.isConnected) {
      setStatus("Not connected");
      return;
    }
    setStatus("Loading Performance Chorus & Reverb...");
    try {
      const chorus = await requestPerformanceChorus(midi, getDeviceId());
      updatePerformanceChorusUI(chorus);
      const reverb = await requestPerformanceReverb(midi, getDeviceId());
      updatePerformanceReverbUI(reverb);
      setStatus("Performance Chorus & Reverb loaded");
    } catch (e) {
      setStatus(`Failed loading effects: ${e.message}`);
    }
  }
  async function loadAllPartsData() {
    if (!midi.isConnected) {
      setStatus("Not connected");
      return;
    }
    const progEl = $("loadProgress");
    setStatus("Loading all 16 parts...");
    try {
      const parts = await requestAllParts(midi, getDeviceId(), (done, total) => {
        if (progEl) progEl.textContent = `Reading Part ${done}/${total}...`;
      });
      parts.forEach((data, idx) => updatePartRow(idx + 1, data));
      if (progEl) progEl.textContent = "All 16 parts loaded";
      setStatus("Successfully loaded all 16 performance parts");
    } catch (e) {
      if (progEl) progEl.textContent = "";
      setStatus(`Failed loading parts: ${e.message}`);
    }
  }
  function switchToTab(target) {
    document.querySelectorAll(".tab-btn").forEach((b) => {
      b.classList.toggle("active", b.dataset.tab === target);
    });
    document.querySelectorAll(".tab-content").forEach((c) => {
      c.classList.toggle("active", c.id === `${target}Tab`);
    });
  }
  function initTabs() {
    document.querySelectorAll(".tab-btn").forEach((btn) => {
      btn.addEventListener("click", () => switchToTab(btn.dataset.tab));
    });
  }
  function init() {
    buildPartsTable();
    initTabs();
    bindPerformanceCommonControls();
    bindPatchControls();
    initLibrarianControls();
    $("connectBtn").addEventListener("click", connectMidi);
    $("refreshBtn").addEventListener("click", refreshDeviceList);
    $("panicBtn").addEventListener("click", handlePanic);
    $("auditionBtn").addEventListener("click", handleAudition);
    $("clearLogBtn").addEventListener("click", clearLog);
    $("loadPerfBtn").addEventListener("click", loadPerformanceCommon);
    $("loadPerfFxBtn").addEventListener("click", loadPerformanceFx);
    $("loadAllPartsBtn").addEventListener("click", loadAllPartsData);
    midi.onStateChange((info) => {
      if (info.state === "disconnected" && !midi.isConnected) {
        setConnectionStatus(false);
        $("connectBtn").textContent = "Connect";
        setStatus(`Device disconnected: ${info.name}`);
      }
      refreshDeviceList();
    });
    initMidi();
  }
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
