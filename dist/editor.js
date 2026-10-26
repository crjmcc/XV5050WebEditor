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
      this._dawInput = null;
      this._onMessage = null;
      this._onStateChange = null;
      this._connected = false;
      this._sysexBuffer = null;
      this._sysexQueue = Promise.resolve();
      this._onTraffic = null;
      this._handleMidiMessage = this._handleMidiMessage.bind(this);
      this._handleStateChange = this._handleStateChange.bind(this);
    }
    /**
     * Request Web MIDI access from the browser with SysEx support.
     * @returns {Promise<boolean>} True if access granted, false otherwise.
     */
    async requestAccess() {
      if (typeof navigator === "undefined" || !navigator.requestMIDIAccess) {
        console.warn("Web MIDI API is not supported in this environment.");
        return false;
      }
      try {
        this._midiAccess = await navigator.requestMIDIAccess({ sysex: true });
        this._midiAccess.onstatechange = this._handleStateChange;
        return true;
      } catch (err) {
        console.error("Failed to get Web MIDI access:", err);
        return false;
      }
    }
    /**
     * @returns {boolean} True if SysEx permission is enabled
     */
    get sysexEnabled() {
      return this._midiAccess ? !!this._midiAccess.sysexEnabled : false;
    }
    /**
     * Get list of available MIDI input devices.
     * @returns {MidiDevice[]}
     */
    getInputs() {
      if (!this._midiAccess) return [];
      const devices = [];
      for (const [id, input] of this._midiAccess.inputs) {
        devices.push({
          id,
          name: input.name || `MIDI Input (${id})`,
          manufacturer: input.manufacturer || ""
        });
      }
      return devices;
    }
    /**
     * Get list of available MIDI output devices.
     * @returns {MidiDevice[]}
     */
    getOutputs() {
      if (!this._midiAccess) return [];
      const devices = [];
      for (const [id, output] of this._midiAccess.outputs) {
        devices.push({
          id,
          name: output.name || `MIDI Output (${id})`,
          manufacturer: output.manufacturer || ""
        });
      }
      return devices;
    }
    /**
     * Connect to specified input and output MIDI ports.
     * @param {string} inputId
     * @param {string} outputId
     * @returns {Promise<boolean>} True if successfully connected
     */
    async connect(inputId, outputId) {
      if (!this._midiAccess) return false;
      this.disconnect();
      const input = this._midiAccess.inputs.get(inputId);
      const output = this._midiAccess.outputs.get(outputId);
      if (!input || !output) {
        console.error("Specified MIDI input or output device not found");
        return false;
      }
      this._input = input;
      this._output = output;
      this._input.onmidimessage = this._handleMidiMessage;
      try {
        if (input.open && input.connection !== "open") {
          await input.open();
        }
        if (output.open && output.connection !== "open") {
          await output.open();
        }
        await new Promise((resolve) => setTimeout(resolve, 50));
      } catch (err) {
        console.warn("Port open warning:", err);
      }
      this._connected = true;
      console.log(`[MIDI] Connected: Input="${this._input.name}" Output="${this._output.name}" (In: ${this._input.connection}, Out: ${this._output.connection})`);
      return true;
    }
    /**
     * Disconnect current MIDI input and output ports and release OS handles.
     */
    async disconnect() {
      if (this._input) {
        this._input.onmidimessage = null;
        try {
          if (typeof this._input.close === "function") {
            await this._input.close();
          }
        } catch (_) {
        }
        this._input = null;
      }
      if (this._output) {
        try {
          if (typeof this._output.close === "function") {
            await this._output.close();
          }
        } catch (_) {
        }
        this._output = null;
      }
      if (this._dawInput) {
        this._dawInput.onmidimessage = null;
        try {
          if (typeof this._dawInput.close === "function") {
            await this._dawInput.close();
          }
        } catch (_) {
        }
        this._dawInput = null;
      }
      this._connected = false;
      this._sysexBuffer = null;
      this._sysexQueue = Promise.resolve();
    }
    /**
     * Set a secondary MIDI input port for DAW / Controller pass-through (e.g. Renoise via loopMIDI).
     * Voice messages (Note on/off, CC, pitch bend, clock) are forwarded to the XV-5050 output in real-time.
     * 
     * @param {string|null} dawInputId - Port ID of virtual input
     */
    async setDawThruInput(dawInputId) {
      if (this._dawInput) {
        this._dawInput.onmidimessage = null;
        try {
          if (typeof this._dawInput.close === "function") {
            await this._dawInput.close();
          }
        } catch (_) {
        }
        this._dawInput = null;
      }
      if (!dawInputId || !this._midiAccess) return false;
      const input = this._midiAccess.inputs.get(dawInputId);
      if (!input) return false;
      this._dawInput = input;
      this._dawInput.onmidimessage = (event) => {
        if (this._output && event?.data) {
          try {
            this._output.send(event.data);
            if (this._onTraffic) {
              this._onTraffic("THRU", Array.from(event.data), Date.now());
            }
          } catch (_) {
          }
        }
      };
      try {
        if (input.open && input.connection !== "open") {
          await input.open();
        }
      } catch (_) {
      }
      return true;
    }
    /**
     * @returns {string} Name of active DAW pass-through input device
     */
    get dawInputName() {
      return this._dawInput?.name || "";
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
     * @param {Uint8Array|number[]} message - Complete SysEx message bytes
     */
    send(message) {
      if (!this._output) {
        console.error("No MIDI output connected");
        return;
      }
      const uint8 = message instanceof Uint8Array ? message : new Uint8Array(message);
      const arr = Array.from(uint8);
      if (this._onTraffic) {
        this._onTraffic("TX", arr, Date.now());
      }
      console.log("[MIDI TX]", arr.map((b) => b.toString(16).padStart(2, "0").toUpperCase()).join(" "));
      try {
        this._output.send(uint8);
      } catch (err) {
        console.warn("Output send with Uint8Array failed, trying Array:", err);
        this._output.send(arr);
      }
    }
    /**
     * Send raw MIDI bytes (e.g. Channel Voice messages).
     * @param {number[]} bytes - Raw MIDI message bytes
     */
    sendRaw(bytes) {
      if (!this._output) return;
      const uint8 = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
      if (this._onTraffic) {
        this._onTraffic("TX", Array.from(uint8), Date.now());
      }
      try {
        this._output.send(uint8);
      } catch (_) {
        this._output.send(Array.from(uint8));
      }
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
     * Send a SysEx message and wait for the complete response within a timeout.
     * Handles multi-packet SysEx responses (e.g. Tone 265 bytes, MFX 273 bytes)
     * where the hardware sends successive DT1 packets up to 256 bytes each.
     * Serialized via internal queue so concurrent requests never overlap on the wire.
     * 
     * @param {Uint8Array|number[]} message - SysEx message to send
     * @param {number} [timeout=3000] - Timeout in milliseconds
     * @returns {Promise<object>} Complete parsed SysEx response
     */
    sendAndReceive(message, timeout = 3e3) {
      if (!this.isConnected) {
        return Promise.reject(new Error("MIDI ports are not connected."));
      }
      if (!this._sysexQueue) {
        this._sysexQueue = Promise.resolve();
      }
      const task = async () => {
        try {
          return await this._sendAndReceiveInternal(message, timeout);
        } finally {
          await new Promise((r) => setTimeout(r, 25));
        }
      };
      const queued = this._sysexQueue.then(task, task);
      this._sysexQueue = queued.catch(() => {
      });
      return queued;
    }
    /**
     * Send a SysEx message and wait for response with automatic retry.
     * 
     * @param {Uint8Array|number[]} message - SysEx message to send
     * @param {object} [options]
     * @param {number} [options.maxRetries=3]
     * @param {number} [options.timeoutMs=2500]
     * @param {number} [options.throttleMs=30]
     * @returns {Promise<object>} Complete parsed SysEx response
     */
    async sendAndReceiveWithRetry(message, { maxRetries = 3, timeoutMs = 2500, throttleMs = 30 } = {}) {
      let lastError = null;
      for (let attempt = 1; attempt <= maxRetries + 1; attempt++) {
        try {
          if (attempt > 1) {
            await new Promise((r) => setTimeout(r, 100 * attempt));
          } else if (throttleMs > 0) {
            await new Promise((r) => setTimeout(r, throttleMs));
          }
          const response = await this.sendAndReceive(message, timeoutMs);
          if (!response || !response.valid) {
            throw new Error(response?.error || "Invalid SysEx packet received");
          }
          return response;
        } catch (err) {
          lastError = err;
        }
      }
      throw new Error(`Failed after ${maxRetries + 1} attempts: ${lastError?.message || "Unknown error"}`);
    }
    _sendAndReceiveInternal(message, timeout = 3e3) {
      if (!this.isConnected) {
        return Promise.reject(new Error("MIDI ports are not connected."));
      }
      return new Promise((resolve, reject) => {
        const isRq1 = message && message[0] === 240 && message[5] === 17 && message.length >= 14;
        let reqAddr = null;
        let expectedSize = 0;
        let accumulatedData = [];
        let bytesReceived = 0;
        if (isRq1) {
          reqAddr = [message[6], message[7], message[8], message[9]];
          expectedSize = message[10] * 2097152 + message[11] * 16384 + message[12] * 128 + message[13];
          accumulatedData = new Array(expectedSize).fill(0);
        }
        const reqAddrInt = reqAddr ? reqAddr[0] * 2097152 + reqAddr[1] * 16384 + reqAddr[2] * 128 + reqAddr[3] : 0;
        const previousHandler = this._onMessage;
        let timer = null;
        const cleanup = () => {
          if (timer) clearTimeout(timer);
          this._onMessage = previousHandler;
          this._sysexBuffer = null;
        };
        timer = setTimeout(() => {
          cleanup();
          reject(new Error(`SysEx response timeout (received ${bytesReceived}/${expectedSize || "?"} bytes)`));
        }, timeout);
        this._onMessage = (parsed) => {
          if (previousHandler) {
            try {
              previousHandler(parsed);
            } catch (_) {
            }
          }
          if (!parsed || !parsed.valid) return;
          if (!isRq1 || expectedSize === 0) {
            cleanup();
            resolve(parsed);
            return;
          }
          if (parsed.command === 18 && parsed.address && parsed.data) {
            const inAddrInt = parsed.address[0] * 2097152 + parsed.address[1] * 16384 + parsed.address[2] * 128 + parsed.address[3];
            const offset = inAddrInt - reqAddrInt;
            if (offset >= 0 && offset < expectedSize) {
              for (let i = 0; i < parsed.data.length && offset + i < expectedSize; i++) {
                accumulatedData[offset + i] = parsed.data[i];
              }
              bytesReceived += parsed.data.length;
              if (bytesReceived >= expectedSize || offset + parsed.data.length >= expectedSize) {
                cleanup();
                resolve({
                  valid: true,
                  command: 18,
                  address: reqAddr,
                  data: accumulatedData,
                  deviceId: parsed.deviceId
                });
              }
            }
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
      if (!data || data.length === 0) return;
      if (data.length === 1 && (data[0] === 254 || data[0] === 248)) {
        return;
      }
      const dataArr = Array.from(data);
      if (this._onTraffic) {
        this._onTraffic("RX", dataArr, Date.now());
      }
      if (data[0] === 240) {
        console.log("[SysEx RX]", dataArr.map((b) => b.toString(16).padStart(2, "0").toUpperCase()).join(" "));
      }
      if (data[0] === 240) {
        this._sysexBuffer = null;
        if (data[data.length - 1] === 247) {
          this._dispatchSysEx(data);
          return;
        }
        this._sysexBuffer = Array.from(data);
        return;
      }
      if (this._sysexBuffer) {
        for (let i = 0; i < data.length; i++) {
          if (data[i] === 254 || data[i] === 248) continue;
          this._sysexBuffer.push(data[i]);
          if (data[i] === 247) {
            const complete = new Uint8Array(this._sysexBuffer);
            this._sysexBuffer = null;
            this._dispatchSysEx(complete);
            return;
          }
        }
        return;
      }
    }
    _dispatchSysEx(data) {
      const parsed = parseSysEx(data);
      console.log("[SysEx RX Parsed]", parsed);
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
        { toneLevel: 127, coarseTune: 64, fineTune: 64, tonePan: 64, waveGroupType: 0, waveGroupId: 0, waveNumberL: 1, waveNumberR: 0, waveGain: 1, tvfFilterType: 1, tvfCutoff: 127, tvfResonance: 0, tvaLevel: 127 },
        { toneLevel: 127, coarseTune: 64, fineTune: 64, tonePan: 64, waveGroupType: 0, waveGroupId: 0, waveNumberL: 2, waveNumberR: 0, waveGain: 1, tvfFilterType: 1, tvfCutoff: 127, tvfResonance: 0, tvaLevel: 127 },
        { toneLevel: 127, coarseTune: 64, fineTune: 64, tonePan: 64, waveGroupType: 0, waveGroupId: 0, waveNumberL: 3, waveNumberR: 0, waveGain: 1, tvfFilterType: 1, tvfCutoff: 127, tvfResonance: 0, tvaLevel: 127 },
        { toneLevel: 127, coarseTune: 64, fineTune: 64, tonePan: 64, waveGroupType: 0, waveGroupId: 0, waveNumberL: 4, waveNumberR: 0, waveGain: 1, tvfFilterType: 1, tvfCutoff: 127, tvfResonance: 0, tvaLevel: 127 }
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

  // src/waveforms.js
  var INTERNAL_WAVEFORMS = [
    "StGrand pA L",
    "StGrand pA R",
    "StGrand pB L",
    "StGrand pB R",
    "StGrand pC L",
    "StGrand pC R",
    "StGrand fA L",
    "StGrand fA R",
    "StGrand fB L",
    "StGrand fB R",
    "StGrand fC L",
    "StGrand fC R",
    "Ac Piano2 pA",
    "Ac Piano2 pB",
    "Ac Piano2 pC",
    "Ac Piano2 fA",
    "Ac Piano2 fB",
    "Ac Piano2 fC",
    "Ac Piano1 A",
    "Ac Piano1 B",
    "Ac Piano1 C",
    "Piano Thump",
    "Piano Up TH",
    "Piano Atk",
    "MKS-20 P3 A",
    "MKS-20 P3 B",
    "MKS-20 P3 C",
    "SA Rhodes 1A",
    "SA Rhodes 1B",
    "SA Rhodes 1C",
    "SA Rhodes 2A",
    "SA Rhodes 2B",
    "SA Rhodes 2C",
    "Dyn Rhd mp A",
    "Dyn Rhd mp B",
    "Dyn Rhd mp C",
    "Dyn Rhd mf A",
    "Dyn Rhd mf B",
    "Dyn Rhd mf C",
    "Dyn Rhd ff A",
    "Dyn Rhd ff B",
    "Dyn Rhd ff C",
    "Wurly soft A",
    "Wurly soft B",
    "Wurly soft C",
    "Wurly hard A",
    "Wurly hard B",
    "Wurly hard C",
    "E.Piano 1A",
    "E.Piano 1B",
    "E.Piano 1C",
    "E.Piano 2A",
    "E.Piano 2B",
    "E.Piano 2C",
    "E.Piano 3A",
    "E.Piano 3B",
    "E.Piano 3C",
    "MK-80 EP A",
    "MK-80 EP B",
    "MK-80 EP C",
    "EP Hard",
    "EP Distone",
    "Clear Keys",
    "D-50 EP A",
    "D-50 EP B",
    "D-50 EP C",
    "Celesta",
    "Music Box",
    "Music Box 2",
    "Clav 1A",
    "Clav 1B",
    "Clav 1C",
    "Clav 2A",
    "Clav 2B",
    "Clav 2C",
    "Clav 3A",
    "Clav 3B",
    "Clav 3C",
    "Clav 4A",
    "Clav 4B",
    "Clav 4C",
    "Clav Wave",
    "MIDI Clav",
    "HarpsiWave A",
    "HarpsiWave B",
    "HarpsiWave C",
    "Jazz Organ 1",
    "Jazz Organ 2",
    "Organ 1",
    "Organ 2",
    "Organ 3",
    "Organ 4",
    "60's Organ1",
    "60's Organ2",
    "60's Organ3",
    "60's Organ4",
    "Full Organ",
    "Full Draw",
    "Rock Organ",
    "RockOrg1 A L",
    "RockOrg1 A R",
    "RockOrg1 B L",
    "RockOrg1 B R",
    "RockOrg1 C L",
    "RockOrg1 C R",
    "RockOrg2 A L",
    "RockOrg2 A R",
    "RockOrg2 B L",
    "RockOrg2 B R",
    "RockOrg2 C L",
    "RockOrg2 C R",
    "RockOrg3 A L",
    "RockOrg3 A R",
    "RockOrg3 B L",
    "RockOrg3 B R",
    "RockOrg3 C L",
    "RockOrg3 C R",
    "Dist. Organ",
    "Rot.Org Slw",
    "Rot.Org Fst",
    "Pipe Organ",
    "Soft Nylon A",
    "Soft Nylon B",
    "Soft Nylon C",
    "Nylon Gtr A",
    "Nylon Gtr B",
    "Nylon Gtr C",
    "Nylon Str",
    "6-Str Gtr A",
    "6-Str Gtr B",
    "6-Str Gtr C",
    "StlGtr mp A",
    "StlGtr mp B",
    "StlGtr mp C",
    "StlGtr mf A",
    "StlGtr mf B",
    "StlGtr mf C",
    "StlGtr ff A",
    "StlGtr ff B",
    "StlGtr ff C",
    "StlGtr sld A",
    "StlGtr sld B",
    "StlGtr sld C",
    "StlGtr Hrm A",
    "StlGtr Hrm B",
    "StlGtr Hrm C",
    "Gtr Harm A",
    "Gtr Harm B",
    "Gtr Harm C",
    "Jazz Gtr A",
    "Jazz Gtr B",
    "Jazz Gtr C",
    "LP Rear A",
    "LP Rear B",
    "LP Rear C",
    "Rock lead 1",
    "Rock lead 2",
    "Comp Gtr A",
    "Comp Gtr B",
    "Comp Gtr C",
    "Comp Gtr A+",
    "Mute Gtr 1",
    "Mute Gtr 2A",
    "Mute Gtr 2B",
    "Mute Gtr 2C",
    "Muters",
    "Pop Strat A",
    "Pop Strat B",
    "Pop Strat C",
    "JC Strat A",
    "JC Strat B",
    "JC Strat C",
    "JC Strat A+",
    "JC Strat B+",
    "JC Strat C+",
    "Clean Gtr A",
    "Clean Gtr B",
    "Clean Gtr C",
    "Stratus A",
    "Stratus B",
    "Stratus C",
    "Scrape Gut",
    "Strat Sust",
    "Strat Atk",
    "OD Gtr A",
    "OD Gtr B",
    "OD Gtr C",
    "OD Gtr A+",
    "Heavy Gtr A",
    "Heavy Gtr B",
    "Heavy Gtr C",
    "Heavy Gtr A+",
    "Heavy Gtr B+",
    "Heavy Gtr C+",
    "PowerChord A",
    "PowerChord B",
    "PowerChord C",
    "EG Harm",
    "Gt.FretNoise",
    "Syn Gtr A",
    "Syn Gtr B",
    "Syn Gtr C",
    "Harp 1A",
    "Harp 1B",
    "Harp 1C",
    "Harp Harm",
    "Pluck Harp",
    "Banjo A",
    "Banjo B",
    "Banjo C",
    "Sitar A",
    "Sitar B",
    "Sitar C",
    "E.Sitar A",
    "E.Sitar B",
    "E.Sitar C",
    "Santur A",
    "Santur B",
    "Santur C",
    "Dulcimer A",
    "Dulcimer B",
    "Dulcimer C",
    "Shamisen A",
    "Shamisen B",
    "Shamisen C",
    "Koto A",
    "Koto B",
    "Koto C",
    "Taishokoto A",
    "Taishokoto B",
    "Taishokoto C",
    "Pick Bass A",
    "Pick Bass B",
    "Pick Bass C",
    "Fingerd Bs A",
    "Fingerd Bs B",
    "Fingerd Bs C",
    "E.Bass",
    "P.Bass 1",
    "P.Bass 2",
    "Stick",
    "Fretless A",
    "Fretless B",
    "Fretless C",
    "Fretless 2A",
    "Fretless 2B",
    "Fretless 2C",
    "UprightBs 1",
    "UprightBs 2A",
    "UprightBs 2B",
    "UprightBs 2C",
    "Ac.Bass A",
    "Ac.Bass B",
    "Ac.Bass C",
    "Slap Bass 1",
    "Slap &amp; Pop",
    "Slap Bass 2",
    "Slap Bass 3",
    "Jz.Bs Thumb",
    "Jz.Bs Slap 1",
    "Jz.Bs Slap 2",
    "Jz.Bs Slap 3",
    "Jz.Bs Pop",
    "Funk Bass1",
    "Funk Bass2",
    "Syn Bass A",
    "Syn Bass C",
    "Syn Bass",
    "Syn Bass 2 A",
    "Syn Bass 2 B",
    "Syn Bass 2 C",
    "Mini Bs 1A",
    "Mini Bs 1B",
    "Mini Bs 1C",
    "Mini Bs 2",
    "Mini Bs 2+",
    "MC-202 Bs A",
    "MC-202 Bs B",
    "MC-202 Bs C",
    "Hollow Bs",
    "Flute 1A",
    "Flute 1B",
    "Flute 1C",
    "Jazz Flute A",
    "Jazz Flute B",
    "Jazz Flute C",
    "Flute Tone",
    "Piccolo A",
    "Piccolo B",
    "Piccolo C",
    "Blow Pipe",
    "Pan Pipe",
    "BottleBlow",
    "Rad Hose",
    "Shakuhachi",
    "Shaku Atk",
    "Flute Push",
    "Clarinet A",
    "Clarinet B",
    "Clarinet C",
    "Oboe mf A",
    "Oboe mf B",
    "Oboe mf C",
    "Oboe f A",
    "Oboe f B",
    "Oboe f C",
    "E.Horn A",
    "E.Horn B",
    "E.Horn C",
    "Bassoon A",
    "Bassoon B",
    "Bassoon C",
    "T_Recorder A",
    "T_Recorder B",
    "T_Recorder C",
    "Sop.Sax A",
    "Sop.Sax B",
    "Sop.Sax C",
    "Sop.Sax mf A",
    "Sop.Sax mf B",
    "Sop.Sax mf C",
    "Alto mp A",
    "Alto mp B",
    "Alto mp C",
    "Alto Sax 1A",
    "Alto Sax 1B",
    "Alto Sax 1C",
    "T.Breathy A",
    "T.Breathy B",
    "T.Breathy C",
    "SoloSax A",
    "SoloSax B",
    "SoloSax C",
    "Tenor Sax A",
    "Tenor Sax B",
    "Tenor Sax C",
    "T.Sax mf A",
    "T.Sax mf B",
    "T.Sax mf C",
    "Bari.Sax f A",
    "Bari.Sax f B",
    "Bari.Sax f C",
    "Bari.Sax A",
    "Bari.Sax B",
    "Bari.Sax C",
    "Syn Sax",
    "Chanter",
    "Harmonica A",
    "Harmonica B",
    "Harmonica C",
    "OrcUnisonA L",
    "OrcUnisonA R",
    "OrcUnisonB L",
    "OrcUnisonB R",
    "OrcUnisonC L",
    "OrcUnisonC R",
    "BrassSectA L",
    "BrassSectA R",
    "BrassSectB L",
    "BrassSectB R",
    "BrassSectC L",
    "BrassSectC R",
    "Tpt Sect. A",
    "Tpt Sect. B",
    "Tpt Sect. C",
    "Tb Sect A",
    "Tb Sect B",
    "Tb Sect C",
    "T.Sax Sect A",
    "T.Sax Sect B",
    "T.Sax Sect C",
    "Flugel A",
    "Flugel B",
    "Flugel C",
    "FlugelWave",
    "Trumpet 1A",
    "Trumpet 1B",
    "Trumpet 1C",
    "Trumpet 2A",
    "Trumpet 2B",
    "Trumpet 2C",
    "HarmonMute1A",
    "HarmonMute1B",
    "HarmonMute1C",
    "Trombone 1",
    "Trombone 2 A",
    "Trombone 2 B",
    "Trombone 2 C",
    "Tuba A",
    "Tuba B",
    "Tuba C",
    "French 1A",
    "French 1C",
    "F.Horns A",
    "F.Horns B",
    "F.Horns C",
    "Violin A",
    "Violin B",
    "Violin C",
    "Violin 2 A",
    "Violin 2 B",
    "Violin 2 C",
    "Cello A",
    "Cello B",
    "Cello C",
    "Cello 2 A",
    "Cello 2 B",
    "Cello 2 C",
    "Cello Wave",
    "Pizz",
    "STR Attack A",
    "STR Attack B",
    "STR Attack C",
    "DolceStr.A L",
    "DolceStr.A R",
    "DolceStr.B L",
    "DolceStr.B R",
    "DolceStr.C L",
    "DolceStr.C R",
    "JV Strings L",
    "JV Strings R",
    "JV Strings A",
    "JV Strings C",
    "JP Strings1A",
    "JP Strings1B",
    "JP Strings1C",
    "JP Strings2A",
    "JP Strings2B",
    "JP Strings2C",
    "PWM",
    "Pulse Mod",
    "Soft Pad A",
    "Soft Pad B",
    "Soft Pad C",
    "Fantasynth A",
    "Fantasynth B",
    "Fantasynth C",
    "D-50 HeavenA",
    "D-50 HeavenB",
    "D-50 HeavenC",
    "Fine Wine",
    "D-50 Brass A",
    "D-50 Brass B",
    "D-50 Brass C",
    "D-50 BrassA+",
    "Doo",
    "Pop Voice",
    "Syn Vox 1",
    "Syn Vox 2",
    "Voice Aahs A",
    "Voice Aahs B",
    "Voice Aahs C",
    "Voice Oohs1A",
    "Voice Oohs1B",
    "Voice Oohs1C",
    "Voice Oohs2A",
    "Voice Oohs2B",
    "Voice Oohs2C",
    "Choir 1A",
    "Choir 1B",
    "Choir 1C",
    "Oohs Chord L",
    "Oohs Chord R",
    "Male Ooh A",
    "Male Ooh B",
    "Male Ooh C",
    "Org Vox A",
    "Org Vox B",
    "Org Vox C",
    "Org Vox",
    "ZZZ Vox",
    "Bell VOX",
    "Kalimba",
    "JD Kalimba",
    "Klmba Atk",
    "Wood Crak",
    "Block",
    "Gamelan 1",
    "Gamelan 2",
    "Gamelan 3",
    "Log Drum",
    "Hooky",
    "Tabla",
    "Marimba Wave",
    "Xylo",
    "Xylophone",
    "Vibes",
    "Bottle Hit",
    "Glockenspiel",
    "Tubular",
    "Steel Drums",
    "Pole lp",
    "Fanta Bell A",
    "Fanta Bell B",
    "Fanta Bell C",
    "FantaBell A+",
    "Org Bell",
    "AgogoBells",
    "FingerBell",
    "DIGI Bell 1",
    "DIGI Bell 1+",
    "JD Cowbell",
    "Bell Wave",
    "Chime",
    "Crystal",
    "2.2 Bellwave",
    "2.2 Vibwave",
    "Digiwave",
    "DIGI Chime",
    "JD DIGIChime",
    "BrightDigi",
    "Can Wave 1",
    "Can Wave 2",
    "Vocal Wave",
    "Wally Wave",
    "Brusky lp",
    "Wave Scan",
    "Wire String",
    "Nasty",
    "Wave Table",
    "Klack Wave",
    "Spark VOX",
    "JD Spark VOX",
    "Cutters",
    "EML 5th",
    "MMM VOX",
    "Lead Wave",
    "Synth Reed",
    "Synth Saw 1",
    "Synth Saw 2",
    "Syn Saw 2inv",
    "Synth Saw 3",
    "JD Syn Saw 2",
    "FAT Saw",
    "JP-8 Saw A",
    "JP-8 Saw B",
    "JP-8 Saw C",
    "P5 Saw A",
    "P5 Saw B",
    "P5 Saw C",
    "P5 Saw2 A",
    "P5 Saw2 B",
    "P5 Saw2 C",
    "D-50 Saw A",
    "D-50 Saw B",
    "D-50 Saw C",
    "Synth Square",
    "JP-8 SquareA",
    "JP-8 SquareB",
    "JP-8 SquareC",
    "DualSquare A",
    "DualSquare C",
    "DualSquareA+",
    "JD SynPulse1",
    "JD SynPulse2",
    "JD SynPulse3",
    "JD SynPulse4",
    "Synth Pulse1",
    "Synth Pulse2",
    "JD SynPulse5",
    "Sync Sweep",
    "Triangle",
    "JD Triangle",
    "Sine",
    "Metal Wind",
    "Wind Agogo",
    "Feedbackwave",
    "Spectrum",
    "CrunchWind",
    "ThroatWind",
    "Pitch Wind",
    "JD Vox Noise",
    "Vox Noise",
    "BreathNoise",
    "Voice Breath",
    "White Noise",
    "Pink Noise",
    "Rattles",
    "Ice Rain",
    "Tin Wave",
    "Anklungs",
    "Wind Chimes",
    "Orch. Hit",
    "Tekno Hit",
    "Back Hit",
    "Philly Hit",
    "Scratch 1",
    "Scratch 2",
    "Scratch 3",
    "Shami",
    "Org Atk 1",
    "Org Atk 2",
    "Sm Metal",
    "StrikePole",
    "Thrill",
    "Switch",
    "Tuba Slap",
    "Plink",
    "Plunk",
    "EP Atk",
    "TVF_Trig",
    "Org Click",
    "Cut Noiz",
    "Bass Body",
    "Flute Click",
    "Gt&amp;BsNz MENU",
    "Ac.BassNz 1",
    "Ac.BassNz 2",
    "El.BassNz 1",
    "El.BassNz 2",
    "DistGtrNz 1",
    "DistGtrNz 2",
    "DistGtrNz 3",
    "DistGtrNz 4",
    "SteelGtrNz 1",
    "SteelGtrNz 2",
    "SteelGtrNz 3",
    "SteelGtrNz 4",
    "SteelGtrNz 5",
    "SteelGtrNz 6",
    "SteelGtrNz 7",
    "Sea",
    "Thunder",
    "Windy",
    "Stream",
    "Bubble",
    "Bird",
    "Dog Bark",
    "Horse",
    "Telephone 1",
    "Telephone 2",
    "Creak",
    "Door Slam",
    "Engine",
    "Car Stop",
    "Car Pass",
    "Crash",
    "Gun Shot",
    "Siren",
    "Train",
    "Jetplane",
    "Starship",
    "Breath",
    "Laugh",
    "Scream",
    "Punch",
    "Heart",
    "Steps",
    "Machine Gun",
    "Laser",
    "Thunder 2",
    "AmbientSN pL",
    "AmbientSN pR",
    "AmbientSN fL",
    "AmbientSN fR",
    "Wet SN p L",
    "Wet SN p R",
    "Wet SN f L",
    "Wet SN f R",
    "Dry SN p",
    "Dry SN f",
    "Sharp SN",
    "Piccolo SN",
    "Maple SN",
    "Old Fill SN",
    "70s SN",
    "SN Roll",
    "Natural SN1",
    "Natural SN2",
    "Ballad SN",
    "Rock SN p L",
    "Rock SN p R",
    "Rock SN mf L",
    "Rock SN mf R",
    "Rock SN f L",
    "Rock SN f R",
    "Rock Rim p L",
    "Rock Rim p R",
    "Rock Rim mfL",
    "Rock Rim mfR",
    "Rock Rim f L",
    "Rock Rim f R",
    "Rock Gst L",
    "Rock Gst R",
    "Snare Ghost",
    "Jazz SN p L",
    "Jazz SN p R",
    "Jazz SN mf L",
    "Jazz SN mf R",
    "Jazz SN f L",
    "Jazz SN f R",
    "Jazz SN ff L",
    "Jazz SN ff R",
    "Jazz Rim p L",
    "Jazz Rim p R",
    "Jazz Rim mfL",
    "Jazz Rim mfR",
    "Jazz Rim f L",
    "Jazz Rim f R",
    "Jazz Rim ffL",
    "Jazz Rim ffR",
    "Brush Slap",
    "Brush Swish",
    "Jazz Swish p",
    "Jazz Swish f",
    "909 SN 1",
    "909 SN 2",
    "808 SN",
    "Rock Roll L",
    "Rock Roll R",
    "Jazz Roll",
    "Brush Roll",
    "Dry Stick",
    "Dry Stick 2",
    "Side Stick",
    "Woody Stick",
    "RockStick pL",
    "RockStick pR",
    "RockStick fL",
    "RockStick fR",
    "Dry Kick",
    "Maple Kick",
    "Rock Kick p",
    "Rock Kick mf",
    "Rock Kick f",
    "Jazz Kick p",
    "Jazz Kick mf",
    "Jazz Kick f",
    "Jazz Kick",
    "Pillow Kick",
    "JazzDry Kick",
    "Lite Kick",
    "Old Kick",
    "Hybrid Kick",
    "Hybrid Kick2",
    "Verb Kick",
    "Round Kick",
    "MplLmtr Kick",
    "70s Kick 1",
    "70s Kick 2",
    "Dance Kick",
    "808 Kick",
    "909 Kick 1",
    "909 Kick 2",
    "Rock TomL1 p",
    "Rock TomL2 p",
    "Rock Tom M p",
    "Rock Tom H p",
    "Rock TomL1 f",
    "Rock TomL2 f",
    "Rock Tom M f",
    "Rock Tom H f",
    "Rock Flm L1",
    "Rock Flm L2",
    "Rock Flm M",
    "Rock Flm H",
    "Jazz Tom L p",
    "Jazz Tom M p",
    "Jazz Tom H p",
    "Jazz Tom L f",
    "Jazz Tom M f",
    "Jazz Tom H f",
    "Jazz Flm L",
    "Jazz Flm M",
    "Jazz Flm H",
    "Maple Tom 1",
    "Maple Tom 2",
    "Maple Tom 3",
    "Maple Tom 4",
    "808 Tom",
    "Verb Tom Hi",
    "Verb Tom Lo",
    "Dry Tom Hi",
    "Dry Tom Lo",
    "Rock ClHH1 p",
    "Rock ClHH1mf",
    "Rock ClHH1 f",
    "Rock ClHH2 p",
    "Rock ClHH2mf",
    "Rock ClHH2 f",
    "Jazz ClHH1 p",
    "Jazz ClHH1mf",
    "Jazz ClHH1 f",
    "Jazz ClHH2 p",
    "Jazz ClHH2mf",
    "Jazz ClHH2 f",
    "Cl HiHat 1",
    "Cl HiHat 2",
    "Cl HiHat 3",
    "Cl HiHat 4",
    "Cl HiHat 5",
    "Rock OpHH p",
    "Rock OpHH f",
    "Jazz OpHH p",
    "Jazz OpHH mf",
    "Jazz OpHH f",
    "Op HiHat",
    "Op HiHat 2",
    "Rock PdHH p",
    "Rock PdHH f",
    "Jazz PdHH p",
    "Jazz PdHH f",
    "Pedal HiHat",
    "Pedal HiHat2",
    "Dance Cl HH",
    "909 NZ HiHat",
    "70s Cl HiHat",
    "70s Op HiHat",
    "606 Cl HiHat",
    "606 Op HiHat",
    "909 Cl HiHat",
    "909 Op HiHat",
    "808 Claps",
    "HumanClapsEQ",
    "Tight Claps",
    "Hand Claps",
    "Finger Snaps",
    "Rock RdCym1p",
    "Rock RdCym1f",
    "Rock RdCym2p",
    "Rock RdCym2f",
    "Jazz RdCym p",
    "Jazz RdCymmf",
    "Jazz RdCym f",
    "Ride 1",
    "Ride 2",
    "Ride Bell",
    "Rock CrCym1p",
    "Rock CrCym1f",
    "Rock CrCym2p",
    "Rock CrCym2f",
    "Rock Splash",
    "Jazz CrCym p",
    "Jazz CrCym f",
    "Crash Cymbal",
    "Crash 1",
    "Rock China",
    "China Cym",
    "Cowbell",
    "Wood Block",
    "Claves",
    "Bongo Hi",
    "Bongo Lo",
    "Cga Open Hi",
    "Cga Open Lo",
    "Cga Mute Hi",
    "Cga Mute Lo",
    "Cga Slap",
    "Timbale",
    "Cabasa Up",
    "Cabasa Down",
    "Cabasa Cut",
    "Maracas",
    "Long Guiro",
    "Tambourine 1",
    "Tambourine 2",
    "Open Triangl",
    "Cuica",
    "Vibraslap",
    "Timpani",
    "Timp3 pp",
    "Timp3 mp",
    "Applause",
    "Syn FX Loop",
    "Loop 1",
    "Loop 2",
    "Loop 3",
    "Loop 4",
    "Loop 5",
    "Loop 6",
    "Loop 7",
    "R8 Click",
    "Metronome 1",
    "Metronome 2",
    "MC500 Beep 1",
    "MC500 Beep 2",
    "Low Saw",
    "Low Saw inv",
    "Low P5 Saw",
    "Low Pulse 1",
    "Low Pulse 2",
    "Low Square",
    "Low Sine",
    "Low Triangle",
    "Low White NZ",
    "Low Pink NZ",
    "DC",
    "REV Orch.Hit",
    "REV TeknoHit",
    "REV Back Hit",
    "REV PhillHit",
    "REV Steel DR",
    "REV Tin Wave",
    "REV AmbiSNpL",
    "REV AmbiSNpR",
    "REV AmbiSNfL",
    "REV AmbiSNfR",
    "REV Wet SNpL",
    "REV Wet SNpR",
    "REV Wet SNfL",
    "REV Wet SNfR",
    "REV Dry SN",
    "REV PiccloSN",
    "REV Maple SN",
    "REV OldFilSN",
    "REV 70s SN",
    "REV SN Roll",
    "REV NatrlSN1",
    "REV NatrlSN2",
    "REV BalladSN",
    "REV RkSNpL",
    "REV RkSNpR",
    "REV RkSNmfL",
    "REV RkSNmfR",
    "REV RkSNfL",
    "REV RkSNfR",
    "REV RkRimpL",
    "REV RkRimpR",
    "REV RkRimmfL",
    "REV RkRimmfR",
    "REV RkRimfL",
    "REV RkRimfR",
    "REV RkGstL",
    "REV RkGstR",
    "REV SnareGst",
    "REV JzSNpL",
    "REV JzSNpR",
    "REV JzSNmfL",
    "REV JzSNmfR",
    "REV JzSNfL",
    "REV JzSNfR",
    "REV JzSNffL",
    "REV JzSNffR",
    "REV JzRimpL",
    "REV JzRimpR",
    "REV JzRimmfL",
    "REV JzRimmfR",
    "REV JzRimfL",
    "REV JzRimfR",
    "REV JzRimffL",
    "REV JzRimffR",
    "REV Brush 1",
    "REV Brush 2",
    "REV Brush 3",
    "REV JzSwish1",
    "REV JzSwish2",
    "REV 909 SN 1",
    "REV 909 SN 2",
    "REV RkRoll L",
    "REV RkRoll R",
    "REV JzRoll",
    "REV Dry Stk",
    "REV DrySick",
    "REV Side Stk",
    "REV Wdy Stk",
    "REV RkStk1L",
    "REV RkStk1R",
    "REV RkStk2L",
    "REV RkStk2R",
    "REV Thrill",
    "REV Dry Kick",
    "REV Mpl Kick",
    "REV RkKik p",
    "REV RkKik mf",
    "REV RkKik f",
    "REV JzKik p",
    "REV JzKik mf",
    "REV JzKik f",
    "REV Jaz Kick",
    "REV Pillow K",
    "REV Jz Dry K",
    "REV LiteKick",
    "REV Old Kick",
    "REV Hybrid K",
    "REV HybridK2",
    "REV 70s K 1",
    "REV 70s K 2",
    "REV Dance K",
    "REV 909 K 2",
    "REV RkTomL1p",
    "REV RkTomL2p",
    "REV RkTomM p",
    "REV RkTomH p",
    "REV RkTomL1f",
    "REV RkTomL2f",
    "REV RkTomM f",
    "REV RkTomH f",
    "REV RkFlmL1",
    "REV RkFlmL2",
    "REV RkFlm M",
    "REV RkFlm H",
    "REV JzTomL p",
    "REV JzTomM p",
    "REV JzTomH p",
    "REV JzTomL f",
    "REV JzTomM f",
    "REV JzTomH f",
    "REV JzFlm L",
    "REV JzFlm M",
    "REV JzFlm H",
    "REV MplTom2",
    "REV MplTom4",
    "REV 808Tom",
    "REV VerbTomH",
    "REV VerbTomL",
    "REV DryTom H",
    "REV DryTom M",
    "REV RkClH1 p",
    "REV RkClH1mf",
    "REV RkClH1 f",
    "REV RkClH2 p",
    "REV RkClH2mf",
    "REV RkClH2 f",
    "REV JzClH1 p",
    "REV JzClH1mf",
    "REV JzClH1 f",
    "REV JzClH2 p",
    "REV JzClH2mf",
    "REV JzClH2 f",
    "REV Cl HH 1",
    "REV Cl HH 2",
    "REV Cl HH 3",
    "REV Cl HH 4",
    "REV Cl HH 5",
    "REV RkOpHH p",
    "REV RkOpHH f",
    "REV JzOpHH p",
    "REV JzOpHHmf",
    "REV JzOpHH f",
    "REV Op HiHat",
    "REV OpHiHat2",
    "REV RkPdHH p",
    "REV RkPdHH f",
    "REV JzPdHH p",
    "REV JzPdHH f",
    "REV PedalHH",
    "REV PedalHH2",
    "REV Dance HH",
    "REV 70s ClHH",
    "REV 70s OpHH",
    "REV 606 ClHH",
    "REV 606 OpHH",
    "REV 909 NZHH",
    "REV 909 OpHH",
    "REV HClapsEQ",
    "REV TghtClps",
    "REV FingSnap",
    "REV RealCLP",
    "REV RkRCym1p",
    "REV RkRCym1f",
    "REV RkRCym2p",
    "REV RkRCym2f",
    "REV JzRCym p",
    "REV JzRCymmf",
    "REV JzRCym f",
    "REV Ride 1",
    "REV Ride 2",
    "REV RideBell",
    "REV RkCCym1p",
    "REV RkCCym1f",
    "REV RkCCym2p",
    "REV RkCCym2f",
    "REV RkSplash",
    "REV JzCCym p",
    "REV JzCCym f",
    "REV CrashCym",
    "REV Crash 1",
    "REV RkChina",
    "REV China",
    "REV Cowbell",
    "REV WoodBlck",
    "REV Claves",
    "REV Conga",
    "REV Timbale",
    "REV Maracas",
    "REV Guiro",
    "REV Tamb 1",
    "REV Tamb 2",
    "REV Cuica",
    "REV Timpani",
    "REV Timp3 pp",
    "REV Timp3 mp",
    "REV Metro"
  ];

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
  var MATRIX_SOURCE_LABELS = {
    OFF: "Off (Disabled)",
    BEND: "Pitch Bend Wheel",
    AFT: "Channel Aftertouch",
    SYS1: "System Controller 1",
    SYS2: "System Controller 2",
    SYS3: "System Controller 3",
    SYS4: "System Controller 4",
    VELOCITY: "Key Velocity",
    KEYFOLLOW: "Keyboard Note / Follow",
    TEMPO: "Master BPM Tempo",
    LFO1: "LFO Generator 1",
    LFO2: "LFO Generator 2",
    "PIT-ENV": "Pitch Envelope",
    "TVF-ENV": "Filter Envelope (TVF)",
    "TVA-ENV": "Amp Envelope (TVA)",
    CC01: "CC01: Modulation Wheel",
    CC02: "CC02: Breath Controller",
    CC04: "CC04: Foot Controller",
    CC05: "CC05: Portamento Time",
    CC07: "CC07: Channel Volume",
    CC08: "CC08: Balance",
    CC10: "CC10: Stereo Pan",
    CC11: "CC11: Expression",
    CC64: "CC64: Sustain / Hold 1",
    CC65: "CC65: Portamento Switch",
    CC66: "CC66: Sostenuto",
    CC67: "CC67: Soft Pedal",
    CC71: "CC71: Resonance / Timbre",
    CC72: "CC72: Release Time",
    CC73: "CC73: Attack Time",
    CC74: "CC74: Cutoff / Brightness"
  };
  var MATRIX_DEST_LABELS = {
    OFF: "Off (Disabled)",
    PCH: "Pitch (Fine/Coarse)",
    CUT: "Filter Cutoff Frequency",
    RES: "Filter Resonance",
    LEV: "Amplifier Level (Volume)",
    PAN: "Stereo Pan Position",
    DRY: "Direct Output Level (Dry)",
    CHO: "Chorus Send Level",
    REV: "Reverb Send Level",
    "PIT-LFO1": "Pitch LFO 1 Depth",
    "PIT-LFO2": "Pitch LFO 2 Depth",
    "TVF-LFO1": "Filter LFO 1 Depth",
    "TVF-LFO2": "Filter LFO 2 Depth",
    "TVA-LFO1": "Amp LFO 1 Depth",
    "TVA-LFO2": "Amp LFO 2 Depth",
    "PAN-LFO1": "Pan LFO 1 Depth",
    "PAN-LFO2": "Pan LFO 2 Depth",
    "LFO1-RATE": "LFO 1 Rate / Speed",
    "LFO2-RATE": "LFO 2 Rate / Speed",
    "PIT-ATK": "Pitch Attack Time",
    "PIT-DCY": "Pitch Decay Time",
    "PIT-REL": "Pitch Release Time",
    "TVF-ATK": "Filter Attack Time",
    "TVF-DCY": "Filter Decay Time",
    "TVF-REL": "Filter Release Time",
    "TVA-ATK": "Amp Attack Time",
    "TVA-DCY": "Amp Decay Time",
    "TVA-REL": "Amp Release Time",
    TMT: "Velocity Switch / Tone Mix",
    FXM: "Frequency Cross Modulation (FXM)",
    "MFX-CTRL1": "MFX Multi-FX Control 1",
    "MFX-CTRL2": "MFX Multi-FX Control 2",
    "MFX-CTRL3": "MFX Multi-FX Control 3",
    "MFX-CTRL4": "MFX Multi-FX Control 4"
  };
  var WAVE_GROUP_TYPES = ["INT", "SR-JV80", "SRX", "SAMPLE"];
  function getWaveName(groupType, waveNumber) {
    if (!waveNumber || waveNumber === 0) return "OFF";
    if (groupType === 0) {
      return INTERNAL_WAVEFORMS[waveNumber - 1] || `Wave ${waveNumber}`;
    }
    const groupLabel = WAVE_GROUP_TYPES[groupType] || "EXP";
    return `${groupLabel}:${String(waveNumber).padStart(4, "0")}`;
  }
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
  var SETUP = {
    BASE: [1, 0, 0, 0],
    SIZE: [0, 0, 0, 15],
    // 15 bytes
    params: {
      SOUND_MODE: { offset: 0, size: 1 },
      // 1=PATCH, 2=PERFORM, 3=GM1, 4=GM2, 5=GS
      PERF_BANK_MSB: { offset: 4, size: 1 },
      // 0-127
      PERF_BANK_LSB: { offset: 5, size: 1 },
      // 0-127
      PERF_PROGRAM_NUM: { offset: 6, size: 1 },
      // 0-127
      PATCH_BANK_MSB: { offset: 7, size: 1 },
      // 0-127
      PATCH_BANK_LSB: { offset: 8, size: 1 },
      // 0-127
      PATCH_PROGRAM_NUM: { offset: 9, size: 1 },
      // 0-127
      MFX_SWITCH: { offset: 10, size: 1 },
      // 0-1 (BYPASS, ON)
      CHORUS_SWITCH: { offset: 11, size: 1 },
      // 0-1 (OFF, ON)
      REVERB_SWITCH: { offset: 12, size: 1 },
      // 0-1 (OFF, ON)
      TRANSPOSE: { offset: 13, size: 1 },
      // 59-70 (-5 to +6)
      OCTAVE_SHIFT: { offset: 14, size: 1 }
      // 61-67 (-3 to +3)
    }
  };
  var SYSTEM = {
    COMMON: {
      BASE: [2, 0, 0, 0],
      SIZE: [0, 0, 0, 33],
      // 33 bytes
      params: {
        MASTER_TUNE: { offset: 0, size: 4 },
        // 4 nibbles, 24-2024 (-100.0 to +100.0 cent)
        MASTER_KEY_SHIFT: { offset: 4, size: 1 },
        // 40-88 (-24 to +24 semitones, 64 = 0)
        MASTER_LEVEL: { offset: 5, size: 1 },
        // 0-127
        SCALE_TUNE_SWITCH: { offset: 6, size: 1 },
        // 0-1 (OFF, ON)
        PATCH_REMAIN: { offset: 7, size: 1 },
        // 0-1 (OFF, ON)
        MIX_PARALLEL: { offset: 8, size: 1 },
        // 0-1 (MIX, PARALLEL)
        PERF_CTRL_CH: { offset: 9, size: 1 },
        // 0-16 (1-16, OFF)
        PATCH_RECEIVE_CH: { offset: 11, size: 1 },
        // 0-15 (1-16)
        SYSTEM_CTRL_1: { offset: 24, size: 1 },
        // 0-97 (OFF, CC01-31, CC33-95, BEND, AFT)
        SYSTEM_CTRL_2: { offset: 25, size: 1 },
        SYSTEM_CTRL_3: { offset: 26, size: 1 },
        SYSTEM_CTRL_4: { offset: 27, size: 1 },
        RECEIVE_PC: { offset: 28, size: 1 },
        // 0-1 (OFF, ON)
        RECEIVE_BANK: { offset: 29, size: 1 },
        // 0-1 (OFF, ON)
        CLOCK_SOURCE: { offset: 30, size: 1 },
        // 0-2 (INT, MIDI, USB)
        SYSTEM_TEMPO_MSB: { offset: 31, size: 1 },
        // 20-250 BPM (nibble split)
        SYSTEM_TEMPO_LSB: { offset: 32, size: 1 }
      }
    },
    EQ: {
      BASE: [2, 0, 2, 0],
      SIZE: [0, 0, 0, 17],
      // 17 bytes
      params: {
        EQ_SWITCH: { offset: 0, size: 1 },
        // 0-1 (BYPASS, ON)
        EQ1_LOW_FREQ: { offset: 1, size: 1 },
        // 0-1 (200, 400 Hz)
        EQ1_LOW_GAIN: { offset: 2, size: 1 },
        // 0-30 (-15 to +15 dB, 15=0)
        EQ1_HIGH_FREQ: { offset: 3, size: 1 },
        // 0-2 (2000, 4000, 8000 Hz)
        EQ1_HIGH_GAIN: { offset: 4, size: 1 },
        // 0-30 (-15 to +15 dB, 15=0)
        EQ2_LOW_FREQ: { offset: 5, size: 1 },
        EQ2_LOW_GAIN: { offset: 6, size: 1 },
        EQ2_HIGH_FREQ: { offset: 7, size: 1 },
        EQ2_HIGH_GAIN: { offset: 8, size: 1 },
        EQ3_LOW_FREQ: { offset: 9, size: 1 },
        EQ3_LOW_GAIN: { offset: 10, size: 1 },
        EQ3_HIGH_FREQ: { offset: 11, size: 1 },
        EQ3_HIGH_GAIN: { offset: 12, size: 1 },
        EQ4_LOW_FREQ: { offset: 13, size: 1 },
        EQ4_LOW_GAIN: { offset: 14, size: 1 },
        EQ4_HIGH_FREQ: { offset: 15, size: 1 },
        EQ4_HIGH_GAIN: { offset: 16, size: 1 }
      }
    }
  };
  var MFX_PARAMS = {
    MFX_TYPE: { offset: 0, size: 1 },
    // 0-127 (0-90)
    DRY_LEVEL: { offset: 1, size: 1 },
    // 0-127
    CHORUS_SEND: { offset: 2, size: 1 },
    // 0-127
    REVERB_SEND: { offset: 3, size: 1 },
    // 0-127
    OUTPUT_ASSIGN: { offset: 4, size: 1 },
    // 0-3 (A, B, C, D)
    MFX_CTRL_1_SOURCE: { offset: 5, size: 1 },
    // 0-101
    MFX_CTRL_1_SENS: { offset: 6, size: 1 },
    // 1-127 (-63 to +63)
    MFX_CTRL_2_SOURCE: { offset: 7, size: 1 },
    // 0-101
    MFX_CTRL_2_SENS: { offset: 8, size: 1 },
    // 1-127 (-63 to +63)
    MFX_CTRL_3_SOURCE: { offset: 9, size: 1 },
    // 0-101
    MFX_CTRL_3_SENS: { offset: 10, size: 1 },
    // 1-127 (-63 to +63)
    MFX_CTRL_4_SOURCE: { offset: 11, size: 1 },
    // 0-101
    MFX_CTRL_4_SENS: { offset: 12, size: 1 },
    // 1-127 (-63 to +63)
    MFX_CTRL_1_ASSIGN: { offset: 13, size: 1 },
    // 0-16 (OFF, 1-16)
    MFX_CTRL_2_ASSIGN: { offset: 14, size: 1 },
    // 0-16 (OFF, 1-16)
    MFX_CTRL_3_ASSIGN: { offset: 15, size: 1 },
    // 0-16 (OFF, 1-16)
    MFX_CTRL_4_ASSIGN: { offset: 16, size: 1 },
    // 0-16 (OFF, 1-16)
    PARAM_1: { offset: 17, size: 4 },
    // 4 nibbles (-20000 to +20000, 32768=0)
    PARAM_2: { offset: 21, size: 4 },
    PARAM_3: { offset: 25, size: 4 },
    PARAM_4: { offset: 29, size: 4 },
    PARAM_5: { offset: 33, size: 4 },
    PARAM_6: { offset: 37, size: 4 },
    PARAM_7: { offset: 41, size: 4 },
    PARAM_8: { offset: 45, size: 4 },
    PARAM_9: { offset: 49, size: 4 },
    PARAM_10: { offset: 53, size: 4 },
    PARAM_11: { offset: 57, size: 4 },
    PARAM_12: { offset: 61, size: 4 }
  };
  var CHORUS_PARAMS = {
    CHORUS_TYPE: { offset: 0, size: 1 },
    // 0-3 (OFF, CHORUS, DELAY, GM2 CHORUS)
    CHORUS_LEVEL: { offset: 1, size: 1 },
    // 0-127
    OUTPUT_ASSIGN: { offset: 2, size: 1 },
    // 0-3 (A, B, C, D)
    OUTPUT_SELECT: { offset: 3, size: 1 },
    // 0-2 (MAIN, REV, MAIN+REV)
    PRE_DELAY: { offset: 4, size: 1 },
    // 0-127
    RATE: { offset: 5, size: 1 },
    // 0-127
    DEPTH: { offset: 6, size: 1 },
    // 0-127
    FEEDBACK: { offset: 7, size: 1 },
    // 0-127
    REV_SEND: { offset: 8, size: 1 }
    // 0-127
  };
  var REVERB_PARAMS = {
    REVERB_TYPE: { offset: 0, size: 1 },
    // 0-5 (OFF, REVERB, SRV ROOM, SRV HALL, SRV PLATE, GM2 REVERB)
    REVERB_LEVEL: { offset: 1, size: 1 },
    // 0-127
    OUTPUT_ASSIGN: { offset: 2, size: 1 },
    // 0-3 (A, B, C, D)
    TIME: { offset: 4, size: 1 },
    // 0-127
    HF_DAMP: { offset: 5, size: 1 },
    // 0-17
    PRE_DELAY: { offset: 7, size: 1 }
    // 0-127
  };
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
    // Performance Common MFX-A (Offset 00 02 00)
    MFXA: {
      BASE: [16, 0, 2, 0],
      SIZE: [0, 0, 1, 17],
      // 273 bytes
      params: MFX_PARAMS
    },
    // Performance Common Chorus (Offset 00 04 00)
    CHORUS: {
      BASE: [16, 0, 4, 0],
      SIZE: [0, 0, 0, 52],
      // 52 bytes
      params: CHORUS_PARAMS
    },
    // Performance Common Reverb (Offset 00 06 00)
    REVERB: {
      BASE: [16, 0, 6, 0],
      SIZE: [0, 0, 0, 83],
      // 83 bytes
      params: REVERB_PARAMS
    },
    // Performance Common MFX-B (Offset 00 08 00)
    MFXB: {
      BASE: [16, 0, 8, 0],
      SIZE: [0, 0, 1, 17],
      // 273 bytes
      params: MFX_PARAMS
    },
    // Performance Common MFX-C (Offset 00 0A 00)
    MFXC: {
      BASE: [16, 0, 10, 0],
      SIZE: [0, 0, 1, 17],
      // 273 bytes
      params: MFX_PARAMS
    }
  };
  function getPerfMfxAddress(slot = "A") {
    const s = String(slot).toUpperCase();
    if (s === "B" || slot === 1) return PERF_TEMP.MFXB.BASE;
    if (s === "C" || slot === 2) return PERF_TEMP.MFXC.BASE;
    return PERF_TEMP.MFXA.BASE;
  }
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
  var PATCH_MFX = {
    OFFSET: [0, 0, 2, 0],
    SIZE: [0, 0, 1, 17],
    // 273 bytes
    params: MFX_PARAMS
  };
  var PATCH_CHORUS = {
    OFFSET: [0, 0, 4, 0],
    SIZE: [0, 0, 0, 52],
    // 52 bytes
    params: CHORUS_PARAMS
  };
  var PATCH_REVERB = {
    OFFSET: [0, 0, 6, 0],
    SIZE: [0, 0, 0, 83],
    // 83 bytes
    params: REVERB_PARAMS
  };
  function getPatchMFXAddress(patchBase) {
    return [patchBase[0], patchBase[1], patchBase[2] + 2, patchBase[3]];
  }
  function getPatchChorusAddress(patchBase) {
    return [patchBase[0], patchBase[1], patchBase[2] + 4, patchBase[3]];
  }
  function getPatchReverbAddress(patchBase) {
    return [patchBase[0], patchBase[1], patchBase[2] + 6, patchBase[3]];
  }
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
      WAVE_GROUP_ID: { offset: 40, size: 4 },
      // 4 nibbles
      WAVE_GROUP_ID_1: { offset: 40, size: 1 },
      // 4 nibbles
      WAVE_GROUP_ID_2: { offset: 41, size: 1 },
      WAVE_GROUP_ID_3: { offset: 42, size: 1 },
      WAVE_GROUP_ID_4: { offset: 43, size: 1 },
      WAVE_NUMBER_L: { offset: 44, size: 4 },
      // 4 nibbles (0 - 16384)
      WAVE_NUMBER_L_1: { offset: 44, size: 1 },
      // 4 nibbles
      WAVE_NUMBER_L_2: { offset: 45, size: 1 },
      WAVE_NUMBER_L_3: { offset: 46, size: 1 },
      WAVE_NUMBER_L_4: { offset: 47, size: 1 },
      WAVE_NUMBER_R: { offset: 48, size: 4 },
      // 4 nibbles (0 - 16384)
      WAVE_NUMBER_R_1: { offset: 48, size: 1 },
      // 4 nibbles
      WAVE_NUMBER_R_2: { offset: 49, size: 1 },
      WAVE_NUMBER_R_3: { offset: 50, size: 1 },
      WAVE_NUMBER_R_4: { offset: 51, size: 1 },
      WAVE_GAIN: { offset: 52, size: 1 },
      // 0-3 (-6, 0, +6, +12 dB)
      WAVE_FXM_SWITCH: { offset: 53, size: 1 },
      // 0-1 (OFF, ON)
      WAVE_FXM_SW: { offset: 53, size: 1 },
      // alias
      WAVE_FXM_COLOR: { offset: 54, size: 1 },
      // 0-3 (1-4)
      WAVE_FXM_DEPTH: { offset: 55, size: 1 },
      // 0-16
      WAVE_TEMPO_SYNC: { offset: 56, size: 1 },
      // 0-1 (OFF, ON)
      WAVE_PITCH_KEYFOLLOW: { offset: 57, size: 1 },
      // 44-84 (-200% to +200%)
      PITCH_KEYFOLLOW: { offset: 57, size: 1 },
      // alias
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
      TVA_LEVEL: { offset: 0, size: 1 },
      // 0-127 (Tone Level)
      TVA_VEL_CURVE: { offset: 97, size: 1 },
      // 0-7 (FIXED, 1-7)
      TVA_VEL_SENS: { offset: 98, size: 1 },
      // 1-127 (-63 to +63)
      TVA_ENV_TIME1_VEL: { offset: 99, size: 1 },
      // 1-127 (-63 to +63)
      TVA_ENV_TIME4_VEL: { offset: 100, size: 1 },
      // 1-127 (-63 to +63)
      TVA_ENV_TIME_KEY: { offset: 101, size: 1 },
      // 54-74 (-100 to +100)
      TVA_ENV_T1: { offset: 102, size: 1 },
      // 0-127
      TVA_ENV_T2: { offset: 103, size: 1 },
      TVA_ENV_T3: { offset: 104, size: 1 },
      TVA_ENV_T4: { offset: 105, size: 1 },
      TVA_ENV_L1: { offset: 106, size: 1 },
      // 0-127
      TVA_ENV_L2: { offset: 107, size: 1 },
      TVA_ENV_L3: { offset: 108, size: 1 },
      // LFO 1
      LFO1_FORM: { offset: 109, size: 1 },
      // 0-10
      LFO1_RATE: { offset: 110, size: 2 },
      // 2 nibbles: 00 6E, 00 6F (0-149)
      LFO1_OFFSET: { offset: 112, size: 1 },
      // 0-4 (-100, -50, 0, +50, +100)
      LFO1_RATE_DETUNE: { offset: 113, size: 1 },
      // 0-127
      LFO1_DELAY_TIME: { offset: 114, size: 1 },
      // 0-127
      LFO1_DELAY_TIME_KEY: { offset: 115, size: 1 },
      // 54-74 (-100 to +100)
      LFO1_FADE_MODE: { offset: 116, size: 1 },
      // 0-3 (ON-IN, ON-OUT, OFF-IN, OFF-OUT)
      LFO1_FADE_TIME: { offset: 117, size: 1 },
      // 0-127
      LFO1_KEY_TRIGGER: { offset: 118, size: 1 },
      // 0-1 (OFF, ON)
      LFO1_PITCH_DEPTH: { offset: 119, size: 1 },
      // 1-127 (-63 to +63)
      LFO1_TVF_DEPTH: { offset: 120, size: 1 },
      // 1-127 (-63 to +63)
      LFO1_TVA_DEPTH: { offset: 121, size: 1 },
      // 1-127 (-63 to +63)
      LFO1_PAN_DEPTH: { offset: 122, size: 1 },
      // 1-127 (-63 to +63)
      // LFO 2
      LFO2_FORM: { offset: 123, size: 1 },
      // 0-10
      LFO2_RATE: { offset: 124, size: 2 },
      // 2 nibbles: 00 7C, 00 7D (0-149)
      LFO2_OFFSET: { offset: 126, size: 1 },
      // 0-4
      LFO2_RATE_DETUNE: { offset: 127, size: 1 },
      // 0-127
      LFO2_DELAY_TIME: { offset: 128, size: 1 },
      // 0-127 (7-bit address 01 00 = 128)
      LFO2_DELAY_TIME_KEY: { offset: 129, size: 1 },
      // 54-74 (-100 to +100) (7-bit address 01 01 = 129)
      LFO2_FADE_MODE: { offset: 130, size: 1 },
      // 0-3 (7-bit address 01 02 = 130)
      LFO2_FADE_TIME: { offset: 131, size: 1 },
      // 0-127 (7-bit address 01 03 = 131)
      LFO2_KEY_TRIGGER: { offset: 132, size: 1 },
      // 0-1 (7-bit address 01 04 = 132)
      LFO2_PITCH_DEPTH: { offset: 133, size: 1 },
      // 1-127 (-63 to +63) (7-bit address 01 05 = 133)
      LFO2_TVF_DEPTH: { offset: 134, size: 1 },
      // 1-127 (-63 to +63) (7-bit address 01 06 = 134)
      LFO2_TVA_DEPTH: { offset: 135, size: 1 },
      // 1-127 (-63 to +63) (7-bit address 01 07 = 135)
      LFO2_PAN_DEPTH: { offset: 136, size: 1 }
      // 1-127 (-63 to +63) (7-bit address 01 08 = 136)
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
  function getUserPerformanceAddress(perfNumber) {
    if (perfNumber < 1 || perfNumber > 64) {
      throw new Error(`User Performance number must be 1-64, got ${perfNumber}`);
    }
    return [32, perfNumber - 1, 0, 0];
  }
  function getUserPatchAddress(patchNumber) {
    if (patchNumber < 1 || patchNumber > 128) {
      throw new Error(`User Patch number must be 1-128, got ${patchNumber}`);
    }
    return [48, patchNumber - 1, 0, 0];
  }
  function getUserRhythmAddress(rhythmNumber) {
    if (rhythmNumber < 1 || rhythmNumber > 4) {
      throw new Error(`User Rhythm number must be 1-4, got ${rhythmNumber}`);
    }
    return [64, (rhythmNumber - 1) * 16, 0, 0];
  }

  // src/performance.js
  async function requestPerformanceCommon(midi2, deviceId) {
    const msg = buildRQ1(
      PERF_TEMP.COMMON.BASE,
      PERF_TEMP.COMMON.SIZE,
      deviceId
    );
    const response = midi2 && typeof midi2.sendAndReceiveWithRetry === "function" ? await midi2.sendAndReceiveWithRetry(msg, { maxRetries: 1, timeoutMs: 600, throttleMs: 20 }) : await midi2.sendAndReceive(msg, 600);
    return parsePerformanceCommon(response.data || response);
  }
  async function requestPerformanceChorus(midi2, deviceId) {
    const msg = buildRQ1(
      PERF_TEMP.CHORUS.BASE,
      PERF_TEMP.CHORUS.SIZE,
      deviceId
    );
    const response = midi2 && typeof midi2.sendAndReceiveWithRetry === "function" ? await midi2.sendAndReceiveWithRetry(msg, { maxRetries: 1, timeoutMs: 600, throttleMs: 20 }) : await midi2.sendAndReceive(msg, 600);
    return parsePerformanceChorus(response.data || response);
  }
  async function requestPerformanceReverb(midi2, deviceId) {
    const msg = buildRQ1(
      PERF_TEMP.REVERB.BASE,
      PERF_TEMP.REVERB.SIZE,
      deviceId
    );
    const response = midi2 && typeof midi2.sendAndReceiveWithRetry === "function" ? await midi2.sendAndReceiveWithRetry(msg, { maxRetries: 1, timeoutMs: 600, throttleMs: 20 }) : await midi2.sendAndReceive(msg, 600);
    return parsePerformanceReverb(response.data || response);
  }
  async function requestPerformanceMfx(midi2, slot = "A", deviceId) {
    const address = getPerfMfxAddress(slot);
    const msg = buildRQ1(address, PERF_TEMP.MFXA.SIZE, deviceId);
    const response = midi2 && typeof midi2.sendAndReceiveWithRetry === "function" ? await midi2.sendAndReceiveWithRetry(msg, { maxRetries: 1, timeoutMs: 600, throttleMs: 20 }) : await midi2.sendAndReceive(msg, 600);
    return parsePerformanceMfx(response.data || response);
  }
  function sendPerformanceMfxParam(midi2, slot, paramKey, value, deviceId) {
    const mfxBase = getPerfMfxAddress(slot);
    const param = MFX_PARAMS[paramKey];
    if (!param) {
      throw new Error(`Unknown performance MFX parameter: ${paramKey}`);
    }
    const address = addOffset(mfxBase, param.offset);
    let dataBytes;
    if (param.size === 4) {
      const rawVal = value < 0 ? value + 32768 : value <= 127 ? value : value + 32768;
      dataBytes = [
        rawVal >> 12 & 15,
        rawVal >> 8 & 15,
        rawVal >> 4 & 15,
        rawVal & 15
      ];
    } else if (paramKey.endsWith("_SENS")) {
      dataBytes = [value + 64 & 127];
    } else {
      dataBytes = [value & 127];
    }
    const msg = buildDT1(address, dataBytes, deviceId);
    midi2.send(msg);
  }
  function sendSystemEqParam(midi2, paramKey, value, deviceId) {
    const param = SYSTEM.EQ.params[paramKey];
    if (!param) {
      throw new Error(`Unknown System EQ parameter: ${paramKey}`);
    }
    const address = addOffset(SYSTEM.EQ.BASE, param.offset);
    const msg = buildDT1(address, [value & 127], deviceId);
    midi2.send(msg);
  }
  async function requestPartPatchName(midi2, part, deviceId) {
    const base = getPatchTempAddress(part);
    const msg = buildRQ1(base, [0, 0, 0, 12], deviceId);
    const response = midi2 && typeof midi2.sendAndReceiveWithRetry === "function" ? await midi2.sendAndReceiveWithRetry(msg, { maxRetries: 1, timeoutMs: 600, throttleMs: 20 }) : await midi2.sendAndReceive(msg, 600);
    return decodeName(response.data || response);
  }
  async function requestPerformancePart(midi2, part, deviceId) {
    const address = getPartAddress(part);
    const msg = buildRQ1(address, PERF_PART.SIZE, deviceId);
    const response = midi2 && typeof midi2.sendAndReceiveWithRetry === "function" ? await midi2.sendAndReceiveWithRetry(msg, { maxRetries: 1, timeoutMs: 600, throttleMs: 20 }) : await midi2.sendAndReceive(msg, 600);
    const partData = parsePerformancePart(response.data || response);
    if (part === 10 && partData.patchBankMSB === 92) {
      partData.isRhythm = true;
      partData.patchName = "Rhythm Kit (Part 10)";
      return partData;
    }
    try {
      const patchName = await requestPartPatchName(midi2, part, deviceId);
      partData.patchName = patchName || `Part ${part}`;
    } catch (_) {
      partData.patchName = part === 10 ? "Rhythm Kit (Part 10)" : `Part ${part}`;
    }
    return partData;
  }
  async function requestAllParts(midi2, deviceId, onProgress) {
    const parts = [];
    for (let i = 1; i <= 16; i++) {
      const partData = await requestPerformancePart(midi2, i, deviceId);
      parts.push(partData);
      if (onProgress) onProgress(i, 16, partData);
      await new Promise((r) => setTimeout(r, 25));
    }
    return parts;
  }
  async function requestEntirePerformance(midi2, deviceId, onProgress) {
    if (onProgress) onProgress("common", 0, 19, null);
    const common = await requestPerformanceCommon(midi2, deviceId);
    await new Promise((r) => setTimeout(r, 20));
    if (onProgress) onProgress("mfxA", 1, 19, common);
    let mfxA = null, mfxB = null, mfxC = null;
    try {
      mfxA = await requestPerformanceMfx(midi2, "A", deviceId);
      await new Promise((r) => setTimeout(r, 20));
    } catch (_) {
    }
    if (onProgress) onProgress("chorus", 2, 19, mfxA);
    let chorus = null, reverb = null;
    try {
      chorus = await requestPerformanceChorus(midi2, deviceId);
      await new Promise((r) => setTimeout(r, 20));
    } catch (_) {
    }
    if (onProgress) onProgress("reverb", 3, 19, chorus || mfxA);
    try {
      reverb = await requestPerformanceReverb(midi2, deviceId);
      await new Promise((r) => setTimeout(r, 20));
    } catch (_) {
    }
    const parts = [];
    for (let i = 1; i <= 16; i++) {
      if (onProgress) onProgress("part", 3 + i, 19, null);
      try {
        const partData = await requestPerformancePart(midi2, i, deviceId);
        parts.push(partData);
      } catch (_) {
        parts.push({ part: i, patchName: `Part ${i}` });
      }
      await new Promise((r) => setTimeout(r, 20));
    }
    return { common, mfxA, mfxB, mfxC, chorus, reverb, parts };
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
      mfxASource: (data.length > 48 ? data[48] : 0) ?? 0,
      mfxBSource: (data.length > 49 ? data[49] : 0) ?? 0,
      mfxCSource: (data.length > 50 ? data[50] : 0) ?? 0,
      chorusSource: (data.length > 51 ? data[51] : 0) ?? 0,
      reverbSource: (data.length > 52 ? data[52] : 0) ?? 0
    };
  }
  function parsePerformanceMfx(data) {
    if (!data || data.length < 5) {
      return {
        mfxType: 0,
        dryLevel: 127,
        chorusSend: 0,
        reverbSend: 0,
        outputAssign: 0,
        ctrl1Source: 0,
        ctrl1Sens: 0,
        ctrl2Source: 0,
        ctrl2Sens: 0,
        ctrl3Source: 0,
        ctrl3Sens: 0,
        ctrl4Source: 0,
        ctrl4Sens: 0,
        ctrl1Assign: 0,
        ctrl2Assign: 0,
        ctrl3Assign: 0,
        ctrl4Assign: 0,
        params: Array(12).fill(0)
      };
    }
    const params = [];
    for (let i = 0; i < 12; i++) {
      const off = 17 + i * 4;
      if (off + 3 < data.length) {
        const val = data[off] << 12 | data[off + 1] << 8 | data[off + 2] << 4 | data[off + 3];
        params.push(val >= 32768 ? val - 32768 : val);
      } else {
        params.push(0);
      }
    }
    return {
      mfxType: data[0] ?? 0,
      dryLevel: data[1] ?? 127,
      chorusSend: data[2] ?? 0,
      reverbSend: data[3] ?? 0,
      outputAssign: data[4] ?? 0,
      ctrl1Source: data[5] ?? 0,
      ctrl1Sens: (data[6] ?? 64) - 64,
      ctrl2Source: data[7] ?? 0,
      ctrl2Sens: (data[8] ?? 64) - 64,
      ctrl3Source: data[9] ?? 0,
      ctrl3Sens: (data[10] ?? 64) - 64,
      ctrl4Source: data[11] ?? 0,
      ctrl4Sens: (data[12] ?? 64) - 64,
      ctrl1Assign: data[13] ?? 0,
      ctrl2Assign: data[14] ?? 0,
      ctrl3Assign: data[15] ?? 0,
      ctrl4Assign: data[16] ?? 0,
      params
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
      outputSelect: data[3],
      preDelay: data[4] ?? 0,
      rate: data[5] ?? 0,
      depth: data[6] ?? 0,
      feedback: data[7] ?? 0,
      revSend: data[8] ?? 0
    };
  }
  function parsePerformanceReverb(data) {
    if (!data || data.length < 3) {
      throw new Error(`Performance reverb data too short: ${data?.length} bytes`);
    }
    return {
      reverbType: data[0],
      reverbLevel: data[1],
      outputAssign: data[2],
      time: data[4] ?? 0,
      hfDamp: data[5] ?? 0,
      preDelay: data[7] ?? 0
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
  function sendSoundMode(midi2, mode, deviceId) {
    const address = SETUP.BASE;
    const msg = buildDT1(address, [mode & 127], deviceId);
    midi2.send(msg);
  }
  function sendActivePerformanceSelection(midi2, perfIndex, deviceId = 16, perfCtrlCh = null, bank = "USER") {
    const isPra = String(bank).toUpperCase() === "PR-A" || String(bank).toLowerCase() === "pra";
    const isPrb = String(bank).toUpperCase() === "PR-B" || String(bank).toLowerCase() === "prb";
    const maxIdx = isPrb ? 32 : 64;
    if (perfIndex < 1 || perfIndex > maxIdx) {
      throw new Error(`User Performance index must be 1-64, got ${perfIndex}`);
    }
    const pc = perfIndex - 1 & 127;
    const bankMsb = 85;
    const bankLsb = isPra ? 64 : isPrb ? 65 : 0;
    const setupAddress = [1, 0, 0, 4];
    const dt1Msg = buildDT1(setupAddress, [bankMsb, bankLsb, pc], deviceId);
    midi2.send(dt1Msg);
    const channels = /* @__PURE__ */ new Set([15, 0]);
    if (typeof perfCtrlCh === "number" && perfCtrlCh >= 0 && perfCtrlCh <= 15) {
      channels.add(perfCtrlCh);
    }
    for (const ch of channels) {
      midi2.send([176 | ch, 0, bankMsb]);
      midi2.send([176 | ch, 32, bankLsb]);
      midi2.send([192 | ch, pc]);
    }
  }
  function sendActivePatchSelection(midi2, patchIndex, deviceId = 16) {
    if (patchIndex < 1 || patchIndex > 128) {
      throw new Error(`User Patch index must be 1-128, got ${patchIndex}`);
    }
    const pc = patchIndex - 1 & 127;
    const setupAddress = [1, 0, 0, 7];
    const dt1Msg = buildDT1(setupAddress, [87, 0, pc], deviceId);
    midi2.send(dt1Msg);
    midi2.send([176, 0, 87]);
    midi2.send([176, 32, 0]);
    midi2.send([192, pc]);
  }
  function sendPartBankAndProgram(midi2, part, bankMsb, bankLsb, programNum, deviceId = 16, receiveChannel = null) {
    if (part < 1 || part > 16) {
      throw new Error(`Part number must be 1-16, got ${part}`);
    }
    if (programNum < 1 || programNum > 128) {
      throw new Error(`Program number must be 1-128, got ${programNum}`);
    }
    const pc = programNum - 1 & 127;
    const msb = bankMsb & 127;
    const lsb = bankLsb & 127;
    const partAddr = [16, 0, 32 + (part - 1), 4];
    const dt1Msg = buildDT1(partAddr, [msb, lsb, pc], deviceId);
    midi2.send(dt1Msg);
    const ch = receiveChannel !== null && receiveChannel !== void 0 ? receiveChannel & 15 : part - 1 & 15;
    midi2.send([176 | ch, 0, msb]);
    midi2.send([176 | ch, 32, lsb]);
    midi2.send([192 | ch, pc]);
  }
  function sendPartPatchSelection(midi2, part, patchIndex, deviceId = 16, receiveChannel = null) {
    return sendPartBankAndProgram(midi2, part, 87, 0, patchIndex, deviceId, receiveChannel);
  }
  var ROLAND_PRESET_PERFORMANCES = {
    "PR-A": [
      "Two+Ensemble",
      "Enchanted XV",
      "Double Helix",
      "Blue Mutes",
      "Wedding Mass",
      "Grounded Bs",
      "Vocovox Wave",
      "Lead 4x Vlns",
      "PhazeWahClav",
      "Digibell Pad",
      "Rocker Org",
      "Pianomonics",
      "Plug n' Play",
      "Crying Solo",
      "Grand XV",
      "LookMaNoFret",
      "TB Squelch",
      "Henry VIII",
      "Reel Slam",
      "SwellEnsembl",
      "Amped Wurlie",
      "NewR&RBrass",
      "Triumph Brs",
      "McThrob",
      "Soaring Sqr",
      "Over the top",
      "Power Stack",
      "Contemplate",
      "Rholitzer",
      "Chime Bells",
      "IslandSpirit",
      "Distorted B",
      "Double Steel",
      "COSM Searing",
      "XV Upright",
      "Muscle Bass",
      "Brassy Symph",
      "BiggieBrass2",
      "Peking Opera",
      "5th Element",
      "MetaXV",
      "Traffic Pad",
      "5ths in 4ths",
      "Trance Fair",
      "Spectre",
      "Borealis",
      "Cutting X",
      "Blues Harp",
      "Brash Bass",
      "Saw Grits",
      "LegatoJupitr",
      "Tape Orch",
      "FatSynBrass",
      "UltraSmooth",
      "Spread Pad",
      "West End Bs",
      "Phunky DC",
      "Valve Job",
      "BatonStrings",
      "ClassicJPpad",
      "VeloClikOrgn",
      "Soft Nylon",
      "Swell Strat",
      "Tap Bass"
    ],
    "PR-B": [
      "Dulcimar&Gtr",
      "DulcitarStk",
      "Tekno Loop 2",
      "Rave Attack",
      "SpaceCarrier",
      "Terminator",
      "Symphony JV",
      "Nebular Vox",
      "Humming Vox",
      "Cosmic Dawn",
      "Labyrinth",
      "Sweeper",
      "Stack Pad",
      "Strobe Pad 2",
      "Rhythmatic",
      "Voyage",
      "S&H Pad",
      "Cyclic Pad",
      "White Hole",
      "EasternSplit",
      "Tekno Asia",
      "TeknoSplit 1",
      "TeknoSplit 2",
      "TknoPopSplit",
      "ChildrenSplt",
      "Purple Split",
      "PulsingSplit",
      "Pad / Lead",
      "Organ / Lead",
      "Bass / Lead",
      "S&H / Pad",
      "Drone / Pipe"
    ]
  };

  // src/patch.js
  async function requestPatchCommon(midi2, part, deviceId) {
    const base = getPatchTempAddress(part);
    const msg = buildRQ1(base, PATCH_COMMON.SIZE, deviceId);
    const response = midi2 && typeof midi2.sendAndReceiveWithRetry === "function" ? await midi2.sendAndReceiveWithRetry(msg, { maxRetries: 1, timeoutMs: 600, throttleMs: 20 }) : await midi2.sendAndReceive(msg, 600);
    return parsePatchCommon(response.data || response);
  }
  async function requestPatchTMT(midi2, part, deviceId) {
    const patchBase = getPatchTempAddress(part);
    const tmtAddress = getPatchTMTAddress(patchBase);
    const msg = buildRQ1(tmtAddress, PATCH_TMT.SIZE, deviceId);
    const response = midi2 && typeof midi2.sendAndReceiveWithRetry === "function" ? await midi2.sendAndReceiveWithRetry(msg, { maxRetries: 1, timeoutMs: 600, throttleMs: 20 }) : await midi2.sendAndReceive(msg, 600);
    return parsePatchTMT(response.data || response);
  }
  async function requestPatchTone(midi2, part, tone, deviceId) {
    const patchBase = getPatchTempAddress(part);
    const toneAddress = getToneAddress(patchBase, tone);
    const msg = buildRQ1(toneAddress, PATCH_TONE.SIZE, deviceId);
    const response = midi2 && typeof midi2.sendAndReceiveWithRetry === "function" ? await midi2.sendAndReceiveWithRetry(msg, { maxRetries: 1, timeoutMs: 600, throttleMs: 20 }) : await midi2.sendAndReceive(msg, 600);
    return parsePatchTone(response.data || response);
  }
  async function requestPatchMfx(midi2, part = 0, deviceId) {
    const patchBase = getPatchTempAddress(part);
    const mfxAddr = getPatchMFXAddress(patchBase);
    const msg = buildRQ1(mfxAddr, PATCH_MFX.SIZE, deviceId);
    const response = midi2 && typeof midi2.sendAndReceiveWithRetry === "function" ? await midi2.sendAndReceiveWithRetry(msg, { maxRetries: 1, timeoutMs: 600, throttleMs: 20 }) : await midi2.sendAndReceive(msg, 600);
    return parsePatchMfx(response.data || response);
  }
  async function requestPatchChorus(midi2, part = 0, deviceId) {
    const patchBase = getPatchTempAddress(part);
    const choAddr = getPatchChorusAddress(patchBase);
    const msg = buildRQ1(choAddr, PATCH_CHORUS.SIZE, deviceId);
    const response = midi2 && typeof midi2.sendAndReceiveWithRetry === "function" ? await midi2.sendAndReceiveWithRetry(msg, { maxRetries: 1, timeoutMs: 600, throttleMs: 20 }) : await midi2.sendAndReceive(msg, 600);
    return parsePatchChorus(response.data || response);
  }
  async function requestPatchReverb(midi2, part = 0, deviceId) {
    const patchBase = getPatchTempAddress(part);
    const revAddr = getPatchReverbAddress(patchBase);
    const msg = buildRQ1(revAddr, PATCH_REVERB.SIZE, deviceId);
    const response = midi2 && typeof midi2.sendAndReceiveWithRetry === "function" ? await midi2.sendAndReceiveWithRetry(msg, { maxRetries: 1, timeoutMs: 600, throttleMs: 20 }) : await midi2.sendAndReceive(msg, 600);
    return parsePatchReverb(response.data || response);
  }
  async function requestEntirePatch(midi2, part = 0, deviceId, onProgress) {
    if (onProgress) onProgress("common", 0, 9, null);
    const common = await requestPatchCommon(midi2, part, deviceId);
    await new Promise((r) => setTimeout(r, 20));
    let mfx = null;
    let chorus = null;
    let reverb = null;
    if (part === 0) {
      try {
        if (onProgress) onProgress("mfx", 1, 9, common);
        mfx = await requestPatchMfx(midi2, part, deviceId);
        await new Promise((r) => setTimeout(r, 20));
      } catch (_) {
      }
      try {
        if (onProgress) onProgress("chorus", 2, 9, mfx);
        chorus = await requestPatchChorus(midi2, part, deviceId);
        await new Promise((r) => setTimeout(r, 20));
      } catch (_) {
      }
      try {
        if (onProgress) onProgress("reverb", 3, 9, chorus);
        reverb = await requestPatchReverb(midi2, part, deviceId);
        await new Promise((r) => setTimeout(r, 20));
      } catch (_) {
      }
    }
    if (onProgress) onProgress("tmt", 4, 9, reverb);
    const tmt = await requestPatchTMT(midi2, part, deviceId);
    await new Promise((r) => setTimeout(r, 20));
    const tones = [];
    for (let t = 1; t <= 4; t++) {
      if (onProgress) onProgress(`tone${t}`, 4 + t, 9, null);
      const toneData = await requestPatchTone(midi2, part, t, deviceId);
      tones.push(toneData);
      await new Promise((r) => setTimeout(r, 20));
    }
    return { common, mfx, chorus, reverb, tmt, tones };
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
  function sendPatchMfxParam(midi2, part = 0, paramKey, value, deviceId = 16) {
    const param = MFX_PARAMS[paramKey];
    if (!param) {
      throw new Error(`Unknown patch MFX parameter: ${paramKey}`);
    }
    const patchBase = getPatchTempAddress(part);
    const mfxBase = getPatchMFXAddress(patchBase);
    const address = addOffset(mfxBase, param.offset);
    let dataBytes;
    if (param.size === 4) {
      const rawVal = value < 0 ? value + 32768 : value <= 127 ? value : value + 32768;
      dataBytes = [
        rawVal >> 12 & 15,
        rawVal >> 8 & 15,
        rawVal >> 4 & 15,
        rawVal & 15
      ];
    } else if (paramKey.endsWith("_SENS")) {
      dataBytes = [value + 64 & 127];
    } else {
      dataBytes = [value & 127];
    }
    const msg = buildDT1(address, dataBytes, deviceId);
    midi2.send(msg);
  }
  function sendPatchChorusParam(midi2, part = 0, paramKey, value, deviceId = 16) {
    const param = CHORUS_PARAMS[paramKey];
    if (!param) {
      throw new Error(`Unknown patch Chorus parameter: ${paramKey}`);
    }
    const patchBase = getPatchTempAddress(part);
    const choBase = getPatchChorusAddress(patchBase);
    const address = addOffset(choBase, param.offset);
    const msg = buildDT1(address, [value & 127], deviceId);
    midi2.send(msg);
  }
  function sendPatchReverbParam(midi2, part = 0, paramKey, value, deviceId = 16) {
    const param = REVERB_PARAMS[paramKey];
    if (!param) {
      throw new Error(`Unknown patch Reverb parameter: ${paramKey}`);
    }
    const patchBase = getPatchTempAddress(part);
    const revBase = getPatchReverbAddress(patchBase);
    const address = addOffset(revBase, param.offset);
    const msg = buildDT1(address, [value & 127], deviceId);
    midi2.send(msg);
  }
  function sendPatchToneParam(midi2, part, tone, paramKey, value, deviceId) {
    const param = typeof paramKey === "string" ? PATCH_TONE.params[paramKey] : paramKey;
    if (!param) {
      throw new Error(`Unknown tone parameter: ${paramKey}`);
    }
    const patchBase = getPatchTempAddress(part);
    const toneBase = getToneAddress(patchBase, tone);
    const address = addOffset(toneBase, param.offset);
    let dataBytes;
    if (param.size === 4) {
      dataBytes = [
        value >> 12 & 15,
        value >> 8 & 15,
        value >> 4 & 15,
        value & 15
      ];
    } else {
      dataBytes = [value & 127];
    }
    const msg = buildDT1(address, dataBytes, deviceId);
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
  function parsePatchMfx(data) {
    if (!data || data.length < 5) {
      return {
        mfxType: 0,
        dryLevel: 127,
        chorusSend: 0,
        reverbSend: 0,
        outputAssign: 0,
        ctrl1Source: 0,
        ctrl1Sens: 0,
        ctrl2Source: 0,
        ctrl2Sens: 0,
        ctrl3Source: 0,
        ctrl3Sens: 0,
        ctrl4Source: 0,
        ctrl4Sens: 0,
        ctrl1Assign: 0,
        ctrl2Assign: 0,
        ctrl3Assign: 0,
        ctrl4Assign: 0,
        params: Array(12).fill(0)
      };
    }
    const params = [];
    for (let i = 0; i < 12; i++) {
      const off = 17 + i * 4;
      if (off + 3 < data.length) {
        const val = data[off] << 12 | data[off + 1] << 8 | data[off + 2] << 4 | data[off + 3];
        params.push(val >= 32768 ? val - 32768 : val);
      } else {
        params.push(0);
      }
    }
    return {
      mfxType: data[0] ?? 0,
      dryLevel: data[1] ?? 127,
      chorusSend: data[2] ?? 0,
      reverbSend: data[3] ?? 0,
      outputAssign: data[4] ?? 0,
      ctrl1Source: data[5] ?? 0,
      ctrl1Sens: (data[6] ?? 64) - 64,
      ctrl2Source: data[7] ?? 0,
      ctrl2Sens: (data[8] ?? 64) - 64,
      ctrl3Source: data[9] ?? 0,
      ctrl3Sens: (data[10] ?? 64) - 64,
      ctrl4Source: data[11] ?? 0,
      ctrl4Sens: (data[12] ?? 64) - 64,
      ctrl1Assign: data[13] ?? 0,
      ctrl2Assign: data[14] ?? 0,
      ctrl3Assign: data[15] ?? 0,
      ctrl4Assign: data[16] ?? 0,
      params
    };
  }
  function parsePatchChorus(data) {
    if (!data || data.length < 4) {
      return { chorusType: 0, chorusLevel: 0, outputAssign: 0, outputSelect: 0, preDelay: 0, rate: 0, depth: 0, feedback: 0, revSend: 0 };
    }
    return {
      chorusType: data[0],
      chorusLevel: data[1],
      outputAssign: data[2],
      outputSelect: data[3],
      preDelay: data[4] ?? 0,
      rate: data[5] ?? 0,
      depth: data[6] ?? 0,
      feedback: data[7] ?? 0,
      revSend: data[8] ?? 0
    };
  }
  function parsePatchReverb(data) {
    if (!data || data.length < 3) {
      return { reverbType: 0, reverbLevel: 0, outputAssign: 0, time: 0, hfDamp: 0, preDelay: 0 };
    }
    return {
      reverbType: data[0],
      reverbLevel: data[1],
      outputAssign: data[2],
      time: data[4] ?? 0,
      hfDamp: data[5] ?? 0,
      preDelay: data[7] ?? 0
    };
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
      waveGroupId: ((data[40] ?? 0) & 15) << 12 | ((data[41] ?? 0) & 15) << 8 | ((data[42] ?? 0) & 15) << 4 | (data[43] ?? 0) & 15,
      waveNumberL: ((data[44] ?? 0) & 15) << 12 | ((data[45] ?? 0) & 15) << 8 | ((data[46] ?? 0) & 15) << 4 | (data[47] ?? 0) & 15,
      waveNumberR: ((data[48] ?? 0) & 15) << 12 | ((data[49] ?? 0) & 15) << 8 | ((data[50] ?? 0) & 15) << 4 | (data[51] ?? 0) & 15,
      waveGain: data[52] ?? 1,
      fxmSwitch: data[53] ?? 0,
      waveFxmSwitch: data[53] ?? 0,
      fxmColor: data[54] ?? 0,
      waveFxmColor: data[54] ?? 0,
      fxmDepth: data[55] ?? 0,
      waveFxmDepth: data[55] ?? 0,
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
      tvaLevel: data[0] ?? 127,
      tvaVelCurve: data[97] ?? 0,
      tvaVelSens: data[98] ?? 64,
      tvaEnvTime1Vel: data[99] ?? 64,
      tvaEnvTime4Vel: data[100] ?? 64,
      tvaEnvTimeKey: data[101] ?? 64,
      tvaEnvT1: data[102] ?? 0,
      tvaEnvT2: data[103] ?? 0,
      tvaEnvT3: data[104] ?? 0,
      tvaEnvT4: data[105] ?? 0,
      tvaEnvL1: data[106] ?? 0,
      tvaEnvL2: data[107] ?? 0,
      tvaEnvL3: data[108] ?? 0,
      // LFO 1
      lfo1Form: data[109] ?? 0,
      lfo1Rate: data[110] ?? 0,
      lfo1Offset: data[112] ?? 0,
      lfo1RateDetune: data[113] ?? 0,
      lfo1DelayTime: data[114] ?? 0,
      lfo1DelayTimeKey: data[115] ?? 64,
      lfo1FadeMode: data[116] ?? 0,
      lfo1FadeTime: data[117] ?? 0,
      lfo1KeyTrigger: data[118] ?? 0,
      lfo1PitchDepth: data[119] ?? 64,
      lfo1TvfDepth: data[120] ?? 64,
      lfo1TvaDepth: data[121] ?? 64,
      lfo1PanDepth: data[122] ?? 64,
      // LFO 2
      lfo2Form: data[123] ?? 0,
      lfo2Rate: data[124] ?? 0,
      lfo2Offset: data[126] ?? 0,
      lfo2RateDetune: data[127] ?? 0,
      lfo2DelayTime: data[128] ?? 0,
      lfo2DelayTimeKey: data[129] ?? 64,
      lfo2FadeMode: data[130] ?? 0,
      lfo2FadeTime: data[131] ?? 0,
      lfo2KeyTrigger: data[132] ?? 0,
      lfo2PitchDepth: data[133] ?? 64,
      lfo2TvfDepth: data[134] ?? 64,
      lfo2TvaDepth: data[135] ?? 64,
      lfo2PanDepth: data[136] ?? 64
    };
  }

  // src/mfx_data.js
  var MFX_CATALOG = [
    { id: 0, name: "THRU (Bypass)", category: "Bypass", params: [] },
    {
      id: 1,
      name: "01: Stereo EQ",
      category: "Equalizer / Filter",
      params: [
        { name: "Low Freq", min: 0, max: 1, display: ["200Hz", "400Hz"] },
        { name: "Low Gain", min: 49, max: 79, offset: 64, unit: "dB" },
        { name: "Mid 1 Freq", min: 0, max: 16, unit: "kHz" },
        { name: "Mid 1 Q", min: 0, max: 4, display: ["0.5", "1.0", "2.0", "4.0", "8.0"] },
        { name: "Mid 1 Gain", min: 49, max: 79, offset: 64, unit: "dB" },
        { name: "Mid 2 Freq", min: 0, max: 16, unit: "kHz" },
        { name: "Mid 2 Q", min: 0, max: 4, display: ["0.5", "1.0", "2.0", "4.0", "8.0"] },
        { name: "Mid 2 Gain", min: 49, max: 79, offset: 64, unit: "dB" },
        { name: "High Freq", min: 0, max: 1, display: ["4kHz", "8kHz"] },
        { name: "High Gain", min: 49, max: 79, offset: 64, unit: "dB" },
        { name: "Level", min: 0, max: 127 },
        { name: "Phase", min: 0, max: 1, display: ["Normal", "Inverse"] }
      ]
    },
    {
      id: 2,
      name: "02: Overdrive",
      category: "Distortion / Amp",
      params: [
        { name: "Drive", min: 0, max: 127 },
        { name: "Level", min: 0, max: 127 },
        { name: "Tone", min: 0, max: 127 },
        { name: "Amp Simulator", min: 0, max: 4, display: ["Small", "Built-in", "2-Stack", "3-Stack", "Off"] },
        { name: "Low Gain", min: 49, max: 79, offset: 64, unit: "dB" },
        { name: "High Gain", min: 49, max: 79, offset: 64, unit: "dB" },
        { name: "Pan", min: 0, max: 127, display: "pan" },
        { name: "Dry/Wet", min: 0, max: 127 }
      ]
    },
    {
      id: 3,
      name: "03: Distortion",
      category: "Distortion / Amp",
      params: [
        { name: "Drive", min: 0, max: 127 },
        { name: "Level", min: 0, max: 127 },
        { name: "Tone", min: 0, max: 127 },
        { name: "Amp Simulator", min: 0, max: 4, display: ["Small", "Built-in", "2-Stack", "3-Stack", "Off"] },
        { name: "Low Gain", min: 49, max: 79, offset: 64, unit: "dB" },
        { name: "High Gain", min: 49, max: 79, offset: 64, unit: "dB" },
        { name: "Pan", min: 0, max: 127, display: "pan" },
        { name: "Dry/Wet", min: 0, max: 127 }
      ]
    },
    {
      id: 4,
      name: "04: Phaser",
      category: "Modulation",
      params: [
        { name: "Manual", min: 0, max: 127 },
        { name: "Rate", min: 0, max: 127 },
        { name: "Depth", min: 0, max: 127 },
        { name: "Resonance", min: 0, max: 127 },
        { name: "Mix Level", min: 0, max: 127 },
        { name: "Low Gain", min: 49, max: 79, offset: 64, unit: "dB" },
        { name: "High Gain", min: 49, max: 79, offset: 64, unit: "dB" },
        { name: "Level", min: 0, max: 127 }
      ]
    },
    {
      id: 5,
      name: "05: Spectrum",
      category: "Equalizer / Filter",
      params: [
        { name: "Band 1 (250Hz)", min: 49, max: 79, offset: 64, unit: "dB" },
        { name: "Band 2 (500Hz)", min: 49, max: 79, offset: 64, unit: "dB" },
        { name: "Band 3 (1kHz)", min: 49, max: 79, offset: 64, unit: "dB" },
        { name: "Band 4 (2kHz)", min: 49, max: 79, offset: 64, unit: "dB" },
        { name: "Band 5 (4kHz)", min: 49, max: 79, offset: 64, unit: "dB" },
        { name: "Band 6 (8kHz)", min: 49, max: 79, offset: 64, unit: "dB" },
        { name: "Bandwidth Q", min: 0, max: 4, display: ["0.5", "1.0", "2.0", "4.0", "8.0"] },
        { name: "Level", min: 0, max: 127 }
      ]
    },
    {
      id: 6,
      name: "06: Enhancer",
      category: "Equalizer / Filter",
      params: [
        { name: "Sens", min: 0, max: 127 },
        { name: "Mix", min: 0, max: 127 },
        { name: "Low Gain", min: 49, max: 79, offset: 64, unit: "dB" },
        { name: "High Gain", min: 49, max: 79, offset: 64, unit: "dB" },
        { name: "Level", min: 0, max: 127 }
      ]
    },
    {
      id: 7,
      name: "07: Auto Wah",
      category: "Equalizer / Filter",
      params: [
        { name: "Filter Type", min: 0, max: 1, display: ["LPF", "BPF"] },
        { name: "Manual", min: 0, max: 127 },
        { name: "Peak", min: 0, max: 127 },
        { name: "Sens", min: 0, max: 127 },
        { name: "Polarity", min: 0, max: 1, display: ["Up", "Down"] },
        { name: "Rate", min: 0, max: 127 },
        { name: "Depth", min: 0, max: 127 },
        { name: "Level", min: 0, max: 127 }
      ]
    },
    {
      id: 8,
      name: "08: Rotary",
      category: "Modulation",
      params: [
        { name: "Speed", min: 0, max: 1, display: ["Slow", "Fast"] },
        { name: "Woofer Slow", min: 0, max: 127 },
        { name: "Woofer Fast", min: 0, max: 127 },
        { name: "Woofer Accel", min: 0, max: 127 },
        { name: "Tweeter Slow", min: 0, max: 127 },
        { name: "Tweeter Fast", min: 0, max: 127 },
        { name: "Tweeter Accel", min: 0, max: 127 },
        { name: "Separation", min: 0, max: 127 },
        { name: "Level", min: 0, max: 127 }
      ]
    },
    {
      id: 9,
      name: "09: Compressor",
      category: "Dynamics",
      params: [
        { name: "Attack", min: 0, max: 127 },
        { name: "Sustain", min: 0, max: 127 },
        { name: "Post Gain", min: 0, max: 3, display: ["0dB", "+6dB", "+12dB", "+18dB"] },
        { name: "Low Gain", min: 49, max: 79, offset: 64, unit: "dB" },
        { name: "High Gain", min: 49, max: 79, offset: 64, unit: "dB" },
        { name: "Level", min: 0, max: 127 }
      ]
    },
    {
      id: 10,
      name: "10: Limiter",
      category: "Dynamics",
      params: [
        { name: "Threshold", min: 0, max: 127 },
        { name: "Release", min: 0, max: 127 },
        { name: "Ratio", min: 0, max: 3, display: ["1.5:1", "2:1", "4:1", "100:1"] },
        { name: "Post Gain", min: 0, max: 3, display: ["0dB", "+6dB", "+12dB", "+18dB"] },
        { name: "Low Gain", min: 49, max: 79, offset: 64, unit: "dB" },
        { name: "High Gain", min: 49, max: 79, offset: 64, unit: "dB" },
        { name: "Level", min: 0, max: 127 }
      ]
    },
    {
      id: 11,
      name: "11: Hexa-Chorus",
      category: "Modulation",
      params: [
        { name: "Pre-Delay", min: 0, max: 127 },
        { name: "Rate", min: 0, max: 127 },
        { name: "Depth", min: 0, max: 127 },
        { name: "Pre-Delay Dev", min: 0, max: 20 },
        { name: "Depth Dev", min: 0, max: 20 },
        { name: "Pan Dev", min: 0, max: 20 },
        { name: "Level", min: 0, max: 127 }
      ]
    },
    {
      id: 12,
      name: "12: Tremolo Chorus",
      category: "Modulation",
      params: [
        { name: "Pre-Delay", min: 0, max: 127 },
        { name: "Chorus Rate", min: 0, max: 127 },
        { name: "Chorus Depth", min: 0, max: 127 },
        { name: "Tremolo Rate", min: 0, max: 127 },
        { name: "Tremolo Depth", min: 0, max: 127 },
        { name: "Tremolo Phase", min: 0, max: 180, unit: "deg" },
        { name: "Level", min: 0, max: 127 }
      ]
    },
    {
      id: 13,
      name: "13: Space-D",
      category: "Modulation",
      params: [
        { name: "Pre-Delay", min: 0, max: 127 },
        { name: "Rate", min: 0, max: 127 },
        { name: "Depth", min: 0, max: 127 },
        { name: "Phase", min: 0, max: 180, unit: "deg" },
        { name: "Low Gain", min: 49, max: 79, offset: 64, unit: "dB" },
        { name: "High Gain", min: 49, max: 79, offset: 64, unit: "dB" },
        { name: "Level", min: 0, max: 127 }
      ]
    },
    {
      id: 14,
      name: "14: Stereo Chorus",
      category: "Modulation",
      params: [
        { name: "Pre-Delay", min: 0, max: 127 },
        { name: "Rate", min: 0, max: 127 },
        { name: "Depth", min: 0, max: 127 },
        { name: "Phase", min: 0, max: 180, unit: "deg" },
        { name: "Filter Type", min: 0, max: 2, display: ["Off", "LPF", "HPF"] },
        { name: "Cutoff Freq", min: 0, max: 16, unit: "kHz" },
        { name: "Level", min: 0, max: 127 }
      ]
    },
    {
      id: 15,
      name: "15: Stereo Flanger",
      category: "Modulation",
      params: [
        { name: "Pre-Delay", min: 0, max: 127 },
        { name: "Rate", min: 0, max: 127 },
        { name: "Depth", min: 0, max: 127 },
        { name: "Feedback", min: 0, max: 127 },
        { name: "Phase", min: 0, max: 180, unit: "deg" },
        { name: "Filter Type", min: 0, max: 2, display: ["Off", "LPF", "HPF"] },
        { name: "Level", min: 0, max: 127 }
      ]
    },
    {
      id: 16,
      name: "16: Step Flanger",
      category: "Modulation",
      params: [
        { name: "Pre-Delay", min: 0, max: 127 },
        { name: "Rate", min: 0, max: 127 },
        { name: "Depth", min: 0, max: 127 },
        { name: "Feedback", min: 0, max: 127 },
        { name: "Step Rate", min: 0, max: 127 },
        { name: "Phase", min: 0, max: 180, unit: "deg" },
        { name: "Level", min: 0, max: 127 }
      ]
    },
    {
      id: 17,
      name: "17: Stereo Delay",
      category: "Delay",
      params: [
        { name: "Delay Left", min: 0, max: 127 },
        { name: "Delay Right", min: 0, max: 127 },
        { name: "Feedback Mode", min: 0, max: 1, display: ["Normal", "Cross"] },
        { name: "Feedback", min: 0, max: 127 },
        { name: "HF Damp", min: 0, max: 17, display: ["Bypass", "16k", "12k", "10k", "8k", "6k", "4k", "2k"] },
        { name: "Level", min: 0, max: 127 }
      ]
    },
    {
      id: 18,
      name: "18: Modulation Delay",
      category: "Delay",
      params: [
        { name: "Delay Left", min: 0, max: 127 },
        { name: "Delay Right", min: 0, max: 127 },
        { name: "Feedback", min: 0, max: 127 },
        { name: "Rate", min: 0, max: 127 },
        { name: "Depth", min: 0, max: 127 },
        { name: "HF Damp", min: 0, max: 17 },
        { name: "Level", min: 0, max: 127 }
      ]
    },
    {
      id: 19,
      name: "19: Triple Tap Delay",
      category: "Delay",
      params: [
        { name: "Delay Center", min: 0, max: 127 },
        { name: "Delay Left", min: 0, max: 127 },
        { name: "Delay Right", min: 0, max: 127 },
        { name: "Feedback", min: 0, max: 127 },
        { name: "HF Damp", min: 0, max: 17 },
        { name: "Level", min: 0, max: 127 }
      ]
    },
    {
      id: 20,
      name: "20: Quadruple Tap Delay",
      category: "Delay",
      params: [
        { name: "Delay Tap 1", min: 0, max: 127 },
        { name: "Delay Tap 2", min: 0, max: 127 },
        { name: "Delay Tap 3", min: 0, max: 127 },
        { name: "Delay Tap 4", min: 0, max: 127 },
        { name: "Feedback", min: 0, max: 127 },
        { name: "Level", min: 0, max: 127 }
      ]
    },
    {
      id: 21,
      name: "21: Time Control Delay",
      category: "Delay",
      params: [
        { name: "Delay Time", min: 0, max: 127 },
        { name: "Acceleration", min: 0, max: 15 },
        { name: "Feedback", min: 0, max: 127 },
        { name: "HF Damp", min: 0, max: 17 },
        { name: "Level", min: 0, max: 127 }
      ]
    },
    {
      id: 22,
      name: "22: 2-Voice Pitch Shifter",
      category: "Pitch Shift",
      params: [
        { name: "Pitch 1 Coarse", min: 40, max: 88, offset: 64, unit: "semi" },
        { name: "Pitch 1 Fine", min: 14, max: 114, offset: 64, unit: "cent" },
        { name: "Pitch 1 Pan", min: 0, max: 127, display: "pan" },
        { name: "Pitch 1 Level", min: 0, max: 127 },
        { name: "Pitch 2 Coarse", min: 40, max: 88, offset: 64, unit: "semi" },
        { name: "Pitch 2 Fine", min: 14, max: 114, offset: 64, unit: "cent" },
        { name: "Pitch 2 Pan", min: 0, max: 127, display: "pan" },
        { name: "Pitch 2 Level", min: 0, max: 127 }
      ]
    },
    {
      id: 23,
      name: "23: FB Pitch Shifter",
      category: "Pitch Shift",
      params: [
        { name: "Coarse Tune", min: 40, max: 88, offset: 64, unit: "semi" },
        { name: "Fine Tune", min: 14, max: 114, offset: 64, unit: "cent" },
        { name: "Feedback", min: 0, max: 127 },
        { name: "Pre-Delay", min: 0, max: 127 },
        { name: "Level", min: 0, max: 127 }
      ]
    },
    {
      id: 24,
      name: "24: Reverb",
      category: "Reverb",
      params: [
        { name: "Reverb Type", min: 0, max: 5, display: ["Room 1", "Room 2", "Stage 1", "Stage 2", "Hall 1", "Hall 2"] },
        { name: "Pre-Delay", min: 0, max: 127 },
        { name: "Reverb Time", min: 0, max: 127 },
        { name: "HF Damp", min: 0, max: 17 },
        { name: "Level", min: 0, max: 127 }
      ]
    },
    {
      id: 25,
      name: "25: Gate Reverb",
      category: "Reverb",
      params: [
        { name: "Type", min: 0, max: 3, display: ["Normal", "Reverse", "Sweep 1", "Sweep 2"] },
        { name: "Pre-Delay", min: 0, max: 127 },
        { name: "Gate Time", min: 0, max: 127 },
        { name: "Level", min: 0, max: 127 }
      ]
    },
    // Multi combinations & Chains 26-40
    { id: 26, name: "26: Overdrive -> Chorus", category: "Combination", params: [{ name: "Drive", min: 0, max: 127 }, { name: "Cho Rate", min: 0, max: 127 }, { name: "Cho Depth", min: 0, max: 127 }, { name: "Level", min: 0, max: 127 }] },
    { id: 27, name: "27: Overdrive -> Flanger", category: "Combination", params: [{ name: "Drive", min: 0, max: 127 }, { name: "Flg Rate", min: 0, max: 127 }, { name: "Flg Depth", min: 0, max: 127 }, { name: "Level", min: 0, max: 127 }] },
    { id: 28, name: "28: Overdrive -> Delay", category: "Combination", params: [{ name: "Drive", min: 0, max: 127 }, { name: "Delay Time", min: 0, max: 127 }, { name: "Feedback", min: 0, max: 127 }, { name: "Level", min: 0, max: 127 }] },
    { id: 29, name: "29: Distortion -> Chorus", category: "Combination", params: [{ name: "Drive", min: 0, max: 127 }, { name: "Cho Rate", min: 0, max: 127 }, { name: "Cho Depth", min: 0, max: 127 }, { name: "Level", min: 0, max: 127 }] },
    { id: 30, name: "30: Distortion -> Flanger", category: "Combination", params: [{ name: "Drive", min: 0, max: 127 }, { name: "Flg Rate", min: 0, max: 127 }, { name: "Flg Depth", min: 0, max: 127 }, { name: "Level", min: 0, max: 127 }] },
    { id: 31, name: "31: Distortion -> Delay", category: "Combination", params: [{ name: "Drive", min: 0, max: 127 }, { name: "Delay Time", min: 0, max: 127 }, { name: "Feedback", min: 0, max: 127 }, { name: "Level", min: 0, max: 127 }] },
    { id: 32, name: "32: Enhancer -> Chorus", category: "Combination", params: [{ name: "Sens", min: 0, max: 127 }, { name: "Cho Rate", min: 0, max: 127 }, { name: "Cho Depth", min: 0, max: 127 }, { name: "Level", min: 0, max: 127 }] },
    { id: 33, name: "33: Enhancer -> Flanger", category: "Combination", params: [{ name: "Sens", min: 0, max: 127 }, { name: "Flg Rate", min: 0, max: 127 }, { name: "Flg Depth", min: 0, max: 127 }, { name: "Level", min: 0, max: 127 }] },
    { id: 34, name: "34: Enhancer -> Delay", category: "Combination", params: [{ name: "Sens", min: 0, max: 127 }, { name: "Delay Time", min: 0, max: 127 }, { name: "Feedback", min: 0, max: 127 }, { name: "Level", min: 0, max: 127 }] },
    { id: 35, name: "35: Chorus -> Delay", category: "Combination", params: [{ name: "Cho Rate", min: 0, max: 127 }, { name: "Cho Depth", min: 0, max: 127 }, { name: "Delay Time", min: 0, max: 127 }, { name: "Feedback", min: 0, max: 127 }] },
    { id: 36, name: "36: Flanger -> Delay", category: "Combination", params: [{ name: "Flg Rate", min: 0, max: 127 }, { name: "Flg Feedback", min: 0, max: 127 }, { name: "Delay Time", min: 0, max: 127 }, { name: "Feedback", min: 0, max: 127 }] },
    { id: 37, name: "37: Chorus -> Flanger", category: "Combination", params: [{ name: "Cho Rate", min: 0, max: 127 }, { name: "Flg Rate", min: 0, max: 127 }, { name: "Flg Feedback", min: 0, max: 127 }, { name: "Level", min: 0, max: 127 }] },
    { id: 38, name: "38: Chorus / Delay", category: "Combination", params: [{ name: "Cho Level", min: 0, max: 127 }, { name: "Delay Time", min: 0, max: 127 }, { name: "Delay Level", min: 0, max: 127 }, { name: "Level", min: 0, max: 127 }] },
    { id: 39, name: "39: Flanger / Delay", category: "Combination", params: [{ name: "Flg Level", min: 0, max: 127 }, { name: "Delay Time", min: 0, max: 127 }, { name: "Delay Level", min: 0, max: 127 }, { name: "Level", min: 0, max: 127 }] },
    { id: 40, name: "40: Chorus / Flanger", category: "Combination", params: [{ name: "Cho Level", min: 0, max: 127 }, { name: "Flg Level", min: 0, max: 127 }, { name: "Balance", min: 0, max: 127 }, { name: "Level", min: 0, max: 127 }] },
    { id: 41, name: "41: Isolator", category: "Equalizer / Filter", params: [{ name: "Low Boost/Cut", min: 0, max: 127 }, { name: "Mid Boost/Cut", min: 0, max: 127 }, { name: "High Boost/Cut", min: 0, max: 127 }, { name: "Level", min: 0, max: 127 }] },
    { id: 42, name: "42: 3D Chorus", category: "Modulation", params: [{ name: "Pre-Delay", min: 0, max: 127 }, { name: "Rate", min: 0, max: 127 }, { name: "Depth", min: 0, max: 127 }, { name: "Level", min: 0, max: 127 }] },
    { id: 43, name: "43: 3D Flanger", category: "Modulation", params: [{ name: "Pre-Delay", min: 0, max: 127 }, { name: "Rate", min: 0, max: 127 }, { name: "Depth", min: 0, max: 127 }, { name: "Feedback", min: 0, max: 127 }] },
    { id: 44, name: "44: 3D Step Flanger", category: "Modulation", params: [{ name: "Rate", min: 0, max: 127 }, { name: "Depth", min: 0, max: 127 }, { name: "Step Rate", min: 0, max: 127 }, { name: "Level", min: 0, max: 127 }] },
    { id: 45, name: "45: Band Pass Filter", category: "Equalizer / Filter", params: [{ name: "Cutoff Freq", min: 0, max: 127 }, { name: "Q", min: 0, max: 127 }, { name: "Level", min: 0, max: 127 }] },
    { id: 46, name: "46: Ring Modulator", category: "Modulation", params: [{ name: "Frequency", min: 0, max: 127 }, { name: "Sens", min: 0, max: 127 }, { name: "Mix Level", min: 0, max: 127 }, { name: "Level", min: 0, max: 127 }] },
    { id: 47, name: "47: Stereo Auto Wah", category: "Equalizer / Filter", params: [{ name: "Manual", min: 0, max: 127 }, { name: "Rate", min: 0, max: 127 }, { name: "Depth", min: 0, max: 127 }, { name: "Level", min: 0, max: 127 }] },
    { id: 48, name: "48: Step Auto Wah", category: "Equalizer / Filter", params: [{ name: "Manual", min: 0, max: 127 }, { name: "Step Rate", min: 0, max: 127 }, { name: "Depth", min: 0, max: 127 }, { name: "Level", min: 0, max: 127 }] },
    { id: 49, name: "49: Guitar Amp Simulator", category: "Distortion / Amp", params: [{ name: "Pre-Amp Type", min: 0, max: 127 }, { name: "Drive", min: 0, max: 127 }, { name: "Master", min: 0, max: 127 }, { name: "Speaker", min: 0, max: 127 }] },
    { id: 50, name: "50: Rhodes Rotary", category: "Modulation", params: [{ name: "Speed", min: 0, max: 1 }, { name: "Slow Rate", min: 0, max: 127 }, { name: "Fast Rate", min: 0, max: 127 }, { name: "Level", min: 0, max: 127 }] },
    { id: 51, name: "51: VK Rotary", category: "Modulation", params: [{ name: "Speed", min: 0, max: 1 }, { name: "Brake", min: 0, max: 1 }, { name: "Horn/Rotor", min: 0, max: 127 }, { name: "Level", min: 0, max: 127 }] },
    { id: 52, name: "52: Keyboard Multi", category: "Multi", params: [{ name: "Ring Mod Freq", min: 0, max: 127 }, { name: "Phaser Rate", min: 0, max: 127 }, { name: "Pitch Shift", min: 40, max: 88, offset: 64 }, { name: "Level", min: 0, max: 127 }] },
    { id: 53, name: "53: Guitar Multi", category: "Multi", params: [{ name: "Drive", min: 0, max: 127 }, { name: "Amp Type", min: 0, max: 127 }, { name: "Cho Rate", min: 0, max: 127 }, { name: "Delay Time", min: 0, max: 127 }] },
    { id: 54, name: "54: Vocal Multi", category: "Multi", params: [{ name: "Compressor", min: 0, max: 127 }, { name: "De-Esser", min: 0, max: 127 }, { name: "Delay Time", min: 0, max: 127 }, { name: "Reverb Level", min: 0, max: 127 }] },
    { id: 55, name: "55: Clean Guitar Multi", category: "Multi", params: [{ name: "Comp", min: 0, max: 127 }, { name: "EQ Mid", min: 49, max: 79, offset: 64 }, { name: "Chorus", min: 0, max: 127 }, { name: "Delay", min: 0, max: 127 }] },
    { id: 56, name: "56: Bass Multi", category: "Multi", params: [{ name: "Comp Threshold", min: 0, max: 127 }, { name: "Drive", min: 0, max: 127 }, { name: "Low Freq", min: 0, max: 127 }, { name: "Level", min: 0, max: 127 }] },
    { id: 57, name: "57: Rotary Multi", category: "Multi", params: [{ name: "Drive", min: 0, max: 127 }, { name: "Rotary Speed", min: 0, max: 1 }, { name: "Separation", min: 0, max: 127 }, { name: "Level", min: 0, max: 127 }] },
    { id: 58, name: "58: Short Delay", category: "Delay", params: [{ name: "Delay Time", min: 0, max: 127 }, { name: "Feedback", min: 0, max: 127 }, { name: "HF Damp", min: 0, max: 17 }, { name: "Level", min: 0, max: 127 }] },
    { id: 59, name: "59: Auto Pan", category: "Modulation", params: [{ name: "Waveform", min: 0, max: 3 }, { name: "Rate", min: 0, max: 127 }, { name: "Depth", min: 0, max: 127 }, { name: "Level", min: 0, max: 127 }] },
    { id: 60, name: "60: Tremolo", category: "Modulation", params: [{ name: "Waveform", min: 0, max: 3 }, { name: "Rate", min: 0, max: 127 }, { name: "Depth", min: 0, max: 127 }, { name: "Level", min: 0, max: 127 }] },
    { id: 61, name: "61: Slicer", category: "Modulation", params: [{ name: "Pattern", min: 0, max: 19 }, { name: "Rate", min: 0, max: 127 }, { name: "Attack", min: 0, max: 127 }, { name: "Level", min: 0, max: 127 }] },
    { id: 62, name: "62: Phono Noise", category: "Lo-Fi", params: [{ name: "Disc Type", min: 0, max: 2 }, { name: "Noise Level", min: 0, max: 127 }, { name: "Tone", min: 0, max: 127 }, { name: "Level", min: 0, max: 127 }] },
    { id: 63, name: "63: Lo-Fi Processor", category: "Lo-Fi", params: [{ name: "Bit Down", min: 0, max: 7 }, { name: "Sample Rate", min: 0, max: 31 }, { name: "Post Gain", min: 0, max: 127 }, { name: "Level", min: 0, max: 127 }] },
    { id: 64, name: "64: Radio Tuning", category: "Lo-Fi", params: [{ name: "Detune", min: 0, max: 127 }, { name: "Noise", min: 0, max: 127 }, { name: "Bandwidth", min: 0, max: 127 }, { name: "Level", min: 0, max: 127 }] },
    { id: 65, name: "65: Noise Generator", category: "Lo-Fi", params: [{ name: "Noise Type", min: 0, max: 3 }, { name: "Cutoff", min: 0, max: 127 }, { name: "Noise Level", min: 0, max: 127 }, { name: "Level", min: 0, max: 127 }] },
    { id: 66, name: "66: Overdrive 2", category: "Distortion / Amp", params: [{ name: "Drive", min: 0, max: 127 }, { name: "Tone", min: 0, max: 127 }, { name: "Bottom", min: 0, max: 127 }, { name: "Level", min: 0, max: 127 }] },
    { id: 67, name: "67: Distortion 2", category: "Distortion / Amp", params: [{ name: "Drive", min: 0, max: 127 }, { name: "Tone", min: 0, max: 127 }, { name: "Edge", min: 0, max: 127 }, { name: "Level", min: 0, max: 127 }] },
    { id: 68, name: "68: Multi-Stage Phaser", category: "Modulation", params: [{ name: "Mode", min: 0, max: 4, display: ["4-Stage", "8-Stage", "12-Stage", "16-Stage", "24-Stage"] }, { name: "Rate", min: 0, max: 127 }, { name: "Depth", min: 0, max: 127 }, { name: "Feedback", min: 0, max: 127 }] },
    { id: 69, name: "69: Compressor 2", category: "Dynamics", params: [{ name: "Threshold", min: 0, max: 127 }, { name: "Attack", min: 0, max: 127 }, { name: "Release", min: 0, max: 127 }, { name: "Gain", min: 0, max: 127 }] },
    { id: 70, name: "70: Limiter 2", category: "Dynamics", params: [{ name: "Threshold", min: 0, max: 127 }, { name: "Release", min: 0, max: 127 }, { name: "Post Gain", min: 0, max: 127 }, { name: "Level", min: 0, max: 127 }] },
    { id: 71, name: "71: Stereo Pitch Shifter", category: "Pitch Shift", params: [{ name: "Coarse", min: 40, max: 88, offset: 64 }, { name: "Fine", min: 14, max: 114, offset: 64 }, { name: "Feedback", min: 0, max: 127 }, { name: "Level", min: 0, max: 127 }] },
    { id: 72, name: "72: Delay -> Chorus", category: "Combination", params: [{ name: "Delay Time", min: 0, max: 127 }, { name: "Feedback", min: 0, max: 127 }, { name: "Cho Rate", min: 0, max: 127 }, { name: "Cho Depth", min: 0, max: 127 }] },
    { id: 73, name: "73: Reverb 2", category: "Reverb", params: [{ name: "Type", min: 0, max: 5 }, { name: "Time", min: 0, max: 127 }, { name: "HF Damp", min: 0, max: 17 }, { name: "Level", min: 0, max: 127 }] },
    { id: 74, name: "74: 3D Delay", category: "Delay", params: [{ name: "Delay Time", min: 0, max: 127 }, { name: "Feedback", min: 0, max: 127 }, { name: "Azimuth", min: 0, max: 127 }, { name: "Level", min: 0, max: 127 }] },
    { id: 75, name: "75: 3D Rotary", category: "Modulation", params: [{ name: "Speed", min: 0, max: 1 }, { name: "Separation", min: 0, max: 127 }, { name: "Horn Level", min: 0, max: 127 }, { name: "Rotor Level", min: 0, max: 127 }] },
    { id: 76, name: "76: 3D Auto Pan", category: "Modulation", params: [{ name: "Rate", min: 0, max: 127 }, { name: "Depth", min: 0, max: 127 }, { name: "Direction", min: 0, max: 1 }, { name: "Level", min: 0, max: 127 }] },
    { id: 77, name: "77: 4-Band EQ", category: "Equalizer / Filter", params: [{ name: "Low Freq", min: 0, max: 1 }, { name: "Low Gain", min: 49, max: 79, offset: 64 }, { name: "Mid 1 Gain", min: 49, max: 79, offset: 64 }, { name: "Mid 2 Gain", min: 49, max: 79, offset: 64 }, { name: "High Gain", min: 49, max: 79, offset: 64 }, { name: "Level", min: 0, max: 127 }] },
    { id: 78, name: "78: Mastering Limiter", category: "Dynamics", params: [{ name: "Threshold", min: 0, max: 127 }, { name: "Release", min: 0, max: 127 }, { name: "Post Gain", min: 0, max: 127 }, { name: "Ceiling", min: 0, max: 127 }] },
    { id: 79, name: "79: Enhancer 2", category: "Equalizer / Filter", params: [{ name: "Sens", min: 0, max: 127 }, { name: "Frequency", min: 0, max: 127 }, { name: "Mix", min: 0, max: 127 }, { name: "Level", min: 0, max: 127 }] },
    { id: 80, name: "80: Auto Wah 2", category: "Equalizer / Filter", params: [{ name: "Manual", min: 0, max: 127 }, { name: "Sens", min: 0, max: 127 }, { name: "Rate", min: 0, max: 127 }, { name: "Depth", min: 0, max: 127 }] },
    { id: 81, name: "81: Humanizer", category: "Equalizer / Filter", params: [{ name: "Vowel 1", min: 0, max: 4, display: ["a", "e", "i", "o", "u"] }, { name: "Vowel 2", min: 0, max: 4, display: ["a", "e", "i", "o", "u"] }, { name: "Rate", min: 0, max: 127 }, { name: "Depth", min: 0, max: 127 }] },
    { id: 82, name: "82: Speaker Simulator", category: "Distortion / Amp", params: [{ name: "Cabinet Type", min: 0, max: 15 }, { name: "Mic Pos", min: 0, max: 1 }, { name: "Tone", min: 0, max: 127 }, { name: "Level", min: 0, max: 127 }] },
    { id: 83, name: "83: Feedbacker", category: "Distortion / Amp", params: [{ name: "Mode", min: 0, max: 1 }, { name: "Depth", min: 0, max: 127 }, { name: "Feedback", min: 0, max: 127 }, { name: "Level", min: 0, max: 127 }] },
    { id: 84, name: "84: Stereo Reverb", category: "Reverb", params: [{ name: "Type", min: 0, max: 5 }, { name: "Pre-Delay", min: 0, max: 127 }, { name: "Time", min: 0, max: 127 }, { name: "Level", min: 0, max: 127 }] },
    { id: 85, name: "85: Stereo Mod Delay", category: "Delay", params: [{ name: "Delay Time", min: 0, max: 127 }, { name: "Rate", min: 0, max: 127 }, { name: "Depth", min: 0, max: 127 }, { name: "Level", min: 0, max: 127 }] },
    { id: 86, name: "86: 3-Tap Pan Delay", category: "Delay", params: [{ name: "Tap 1 Time", min: 0, max: 127 }, { name: "Tap 2 Time", min: 0, max: 127 }, { name: "Tap 3 Time", min: 0, max: 127 }, { name: "Feedback", min: 0, max: 127 }] },
    { id: 87, name: "87: 4-Tap Pan Delay", category: "Delay", params: [{ name: "Tap 1 Time", min: 0, max: 127 }, { name: "Tap 2 Time", min: 0, max: 127 }, { name: "Tap 3 Time", min: 0, max: 127 }, { name: "Tap 4 Time", min: 0, max: 127 }] },
    { id: 88, name: "88: Chorus -> Delay -> Reverb", category: "Multi", params: [{ name: "Cho Level", min: 0, max: 127 }, { name: "Delay Time", min: 0, max: 127 }, { name: "Rev Level", min: 0, max: 127 }, { name: "Master Level", min: 0, max: 127 }] },
    { id: 89, name: "89: Flanger -> Delay -> Reverb", category: "Multi", params: [{ name: "Flg Level", min: 0, max: 127 }, { name: "Delay Time", min: 0, max: 127 }, { name: "Rev Level", min: 0, max: 127 }, { name: "Master Level", min: 0, max: 127 }] },
    { id: 90, name: "90: Multi-Effects Chain", category: "Multi", params: [{ name: "Drive", min: 0, max: 127 }, { name: "Chorus", min: 0, max: 127 }, { name: "Delay", min: 0, max: 127 }, { name: "Master Level", min: 0, max: 127 }] }
  ];
  var CC_LABELS = {
    1: "CC 01: Modulation",
    2: "CC 02: Breath Controller",
    4: "CC 04: Foot Controller",
    5: "CC 05: Portamento Time",
    7: "CC 07: Volume",
    8: "CC 08: Balance",
    10: "CC 10: Pan",
    11: "CC 11: Expression",
    64: "CC 64: Hold 1 (Damper)",
    65: "CC 65: Portamento",
    66: "CC 66: Sostenuto",
    67: "CC 67: Soft Pedal",
    71: "CC 71: Resonance",
    72: "CC 72: Release Time",
    73: "CC 73: Attack Time",
    74: "CC 74: Cutoff Freq"
  };
  var MFX_CTRL_SOURCES = [
    "OFF",
    ...Array.from({ length: 31 }, (_, i) => {
      const cc = i + 1;
      return CC_LABELS[cc] || `CC ${String(cc).padStart(2, "0")}`;
    }),
    ...Array.from({ length: 63 }, (_, i) => {
      const cc = i + 33;
      return CC_LABELS[cc] || `CC ${String(cc).padStart(2, "0")}`;
    }),
    "BEND: Pitch Bend",
    "AFT: Aftertouch",
    "SYS-CTRL 1",
    "SYS-CTRL 2",
    "SYS-CTRL 3",
    "SYS-CTRL 4"
  ];
  function getMfxAlgorithm(typeId) {
    return MFX_CATALOG[typeId] || {
      id: typeId,
      name: `Algorithm ${typeId}`,
      category: "Other",
      params: Array.from({ length: 12 }, (_, i) => ({ name: `Param ${i + 1}`, min: 0, max: 127 }))
    };
  }

  // src/visuals.js
  function getEnvelopePoints(type, params = {}, width = 300, height = 120) {
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
      return [
        { x: x0, y: toY2(params.l0 ?? 64) },
        { x: x1, y: toY2(params.l1 ?? 64) },
        { x: x2, y: toY2(params.l2 ?? 64) },
        { x: x3, y: toY2(params.l3 ?? 64) },
        { x: x4, y: toY2(params.l4 ?? 64) }
      ];
    }
    if (type === "tvf") {
      const baseY2 = pad + drawH;
      const toY2 = (lvl) => baseY2 - (lvl ?? 0) / 127 * drawH;
      return [
        { x: x0, y: baseY2 },
        { x: x1, y: toY2(params.l1 ?? 127) },
        { x: x2, y: toY2(params.l2 ?? 100) },
        { x: x3, y: toY2(params.l3 ?? 60) },
        { x: x4, y: toY2(params.l4 ?? 0) }
      ];
    }
    const baseY = pad + drawH;
    const toY = (lvl) => baseY - (lvl ?? 0) / 127 * drawH;
    return [
      { x: x0, y: baseY },
      { x: x1, y: toY(params.l1 ?? 127) },
      { x: x2, y: toY(params.l2 ?? 90) },
      { x: x3, y: toY(params.l3 ?? 70) },
      { x: x4, y: baseY }
    ];
  }
  function generateEnvelopePath(type, params = {}, width = 300, height = 120) {
    const pts = getEnvelopePoints(type, params, width, height);
    return `M ${pts[0].x.toFixed(1)} ${pts[0].y.toFixed(1)} L ${pts[1].x.toFixed(1)} ${pts[1].y.toFixed(1)} L ${pts[2].x.toFixed(1)} ${pts[2].y.toFixed(1)} L ${pts[3].x.toFixed(1)} ${pts[3].y.toFixed(1)} L ${pts[4].x.toFixed(1)} ${pts[4].y.toFixed(1)}`;
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

  // src/interactive_envelope.js
  var ENVELOPE_CONFIGS = {
    tvf: {
      svgId: "tvfEnvSvg",
      type: "tvf",
      nodes: [
        {
          id: 1,
          title: "Attack (T1)",
          paramX: "tvfEnvT1",
          minX: 0,
          maxX: 127,
          format: (x) => `Attack (T1): ${x}`
        },
        {
          id: 2,
          title: "Decay 1 (T2)",
          paramX: "tvfEnvT2",
          minX: 0,
          maxX: 127,
          format: (x) => `Decay 1 (T2): ${x}`
        },
        {
          id: 3,
          title: "Decay 2 & Sustain",
          paramX: "tvfEnvT3",
          minX: 0,
          maxX: 127,
          paramY: "tvfEnvL3",
          minY: 0,
          maxY: 127,
          format: (x, y) => `T3: ${x} | Sus (L3): ${y}`
        },
        {
          id: 4,
          title: "Release (T4)",
          paramX: "tvfEnvT4",
          minX: 0,
          maxX: 127,
          format: (x) => `Release (T4): ${x}`
        }
      ],
      getParams: () => ({
        t1: parseInt(document.getElementById("tvfEnvT1")?.value ?? 15, 10),
        t2: parseInt(document.getElementById("tvfEnvT2")?.value ?? 25, 10),
        t3: parseInt(document.getElementById("tvfEnvT3")?.value ?? 40, 10),
        t4: parseInt(document.getElementById("tvfEnvT4")?.value ?? 40, 10),
        l1: 127,
        l2: Math.max(
          parseInt(document.getElementById("tvfEnvL3")?.value ?? 60, 10),
          Math.round((127 + parseInt(document.getElementById("tvfEnvL3")?.value ?? 60, 10)) / 2)
        ),
        l3: parseInt(document.getElementById("tvfEnvL3")?.value ?? 60, 10),
        l4: 0
      })
    },
    tva: {
      svgId: "tvaEnvSvg",
      type: "tva",
      nodes: [
        {
          id: 1,
          title: "Attack & Level",
          paramX: "tvaEnvT1",
          minX: 0,
          maxX: 127,
          paramY: "toneTvaLevel",
          minY: 0,
          maxY: 127,
          format: (x, y) => `Attack (T1): ${x} | Level: ${y}`
        },
        {
          id: 2,
          title: "Decay 1 (T2)",
          paramX: "tvaEnvT2",
          minX: 0,
          maxX: 127,
          format: (x) => `Decay 1 (T2): ${x}`
        },
        {
          id: 3,
          title: "Decay 2 & Sustain",
          paramX: "tvaEnvT3",
          minX: 0,
          maxX: 127,
          paramY: "tvaEnvL3",
          minY: 0,
          maxY: 127,
          format: (x, y) => `T3: ${x} | Sus (L3): ${y}`
        },
        {
          id: 4,
          title: "Release (T4)",
          paramX: "tvaEnvT4",
          minX: 0,
          maxX: 127,
          format: (x) => `Release (T4): ${x}`
        }
      ],
      getParams: () => {
        const level = parseInt(document.getElementById("toneTvaLevel")?.value ?? 127, 10);
        const l3 = parseInt(document.getElementById("tvaEnvL3")?.value ?? 70, 10);
        return {
          t1: parseInt(document.getElementById("tvaEnvT1")?.value ?? 10, 10),
          t2: parseInt(document.getElementById("tvaEnvT2")?.value ?? 20, 10),
          t3: parseInt(document.getElementById("tvaEnvT3")?.value ?? 40, 10),
          t4: parseInt(document.getElementById("tvaEnvT4")?.value ?? 30, 10),
          l1: level,
          l2: Math.floor(level * 0.8),
          l3
        };
      }
    },
    pitch: {
      svgId: "pitchEnvSvg",
      type: "pitch",
      nodes: [
        {
          id: 1,
          title: "Attack & Level 1",
          paramX: "pitchEnvT1",
          minX: 0,
          maxX: 127,
          paramY: "pitchEnvL1",
          minY: 1,
          maxY: 127,
          isSignedY: true,
          format: (x, y) => `Attack: ${x} | L1: ${y - 64}`
        },
        {
          id: 2,
          title: "Time 2 (T2)",
          paramX: "pitchEnvT2",
          minX: 0,
          maxX: 127,
          format: (x) => `Time 2 (T2): ${x}`
        },
        {
          id: 3,
          title: "Time 3 (T3)",
          paramX: "pitchEnvT3",
          minX: 0,
          maxX: 127,
          format: (x) => `Time 3 (T3): ${x}`
        },
        {
          id: 4,
          title: "Release (T4)",
          paramX: "pitchEnvT4",
          minX: 0,
          maxX: 127,
          format: (x) => `Release (T4): ${x}`
        }
      ],
      getParams: () => ({
        t1: parseInt(document.getElementById("pitchEnvT1")?.value ?? 20, 10),
        t2: parseInt(document.getElementById("pitchEnvT2")?.value ?? 20, 10),
        t3: parseInt(document.getElementById("pitchEnvT3")?.value ?? 40, 10),
        t4: parseInt(document.getElementById("pitchEnvT4")?.value ?? 40, 10),
        l0: 64,
        l1: parseInt(document.getElementById("pitchEnvL1")?.value ?? 64, 10),
        l2: 64,
        l3: 64,
        l4: 64
      })
    }
  };
  var SVG_NS = "http://www.w3.org/2000/svg";
  function ensureHandlesLayer(svg, envKey) {
    let layer = svg.querySelector(".env-handles-layer");
    if (layer) return layer;
    layer = document.createElementNS(SVG_NS, "g");
    layer.setAttribute("class", "env-handles-layer");
    const config = ENVELOPE_CONFIGS[envKey];
    for (let i = 1; i <= 4; i++) {
      const nodeG = document.createElementNS(SVG_NS, "g");
      nodeG.setAttribute("class", "env-node");
      nodeG.setAttribute("data-env", envKey);
      nodeG.setAttribute("data-node", i);
      const hit = document.createElementNS(SVG_NS, "circle");
      hit.setAttribute("class", "env-node-hit");
      hit.setAttribute("r", "14");
      hit.setAttribute("fill", "transparent");
      const halo = document.createElementNS(SVG_NS, "circle");
      halo.setAttribute("class", "env-node-halo");
      halo.setAttribute("r", "8");
      halo.setAttribute("fill", "rgba(0, 212, 255, 0.25)");
      halo.setAttribute("opacity", "0");
      const ring = document.createElementNS(SVG_NS, "circle");
      ring.setAttribute("class", "env-node-ring");
      ring.setAttribute("r", "5.5");
      ring.setAttribute("fill", "#040811");
      ring.setAttribute("stroke", "#00d4ff");
      ring.setAttribute("stroke-width", "2");
      const core = document.createElementNS(SVG_NS, "circle");
      core.setAttribute("class", "env-node-core");
      core.setAttribute("r", "2.5");
      core.setAttribute("fill", "#ff7b00");
      nodeG.appendChild(hit);
      nodeG.appendChild(halo);
      nodeG.appendChild(ring);
      nodeG.appendChild(core);
      layer.appendChild(nodeG);
    }
    const hud = document.createElementNS(SVG_NS, "g");
    hud.setAttribute("class", "env-hud");
    hud.setAttribute("style", "display: none;");
    const hudBg = document.createElementNS(SVG_NS, "rect");
    hudBg.setAttribute("class", "env-hud-bg");
    hudBg.setAttribute("x", "-50");
    hudBg.setAttribute("y", "-16");
    hudBg.setAttribute("width", "100");
    hudBg.setAttribute("height", "18");
    hudBg.setAttribute("rx", "4");
    hudBg.setAttribute("fill", "#040811");
    hudBg.setAttribute("stroke", "#ff7b00");
    hudBg.setAttribute("stroke-width", "1");
    const hudText = document.createElementNS(SVG_NS, "text");
    hudText.setAttribute("class", "env-hud-text");
    hudText.setAttribute("x", "0");
    hudText.setAttribute("y", "-4");
    hudText.setAttribute("text-anchor", "middle");
    hudText.setAttribute("fill", "#ffb703");
    hudText.setAttribute("font-size", "8.5");
    hudText.setAttribute("font-weight", "700");
    hudText.setAttribute("font-family", "monospace");
    hudText.textContent = "";
    hud.appendChild(hudBg);
    hud.appendChild(hudText);
    layer.appendChild(hud);
    svg.appendChild(layer);
    return layer;
  }
  function syncEnvelopeHandles(envKey) {
    const config = ENVELOPE_CONFIGS[envKey];
    if (!config) return;
    const svg = document.getElementById(config.svgId);
    if (!svg) return;
    const layer = ensureHandlesLayer(svg, envKey);
    const params = config.getParams();
    const pts = getEnvelopePoints(config.type, params, 300, 75);
    const pathEl = svg.querySelector(".curve-path");
    if (pathEl) {
      pathEl.setAttribute("d", generateEnvelopePath(config.type, params, 300, 75));
    }
    for (let i = 1; i <= 4; i++) {
      const nodeEl = layer.querySelector(`.env-node[data-node="${i}"]`);
      if (nodeEl && pts[i]) {
        nodeEl.setAttribute("transform", `translate(${pts[i].x.toFixed(1)}, ${pts[i].y.toFixed(1)})`);
      }
    }
  }
  function bindEnvelopeDrag(envKey) {
    const config = ENVELOPE_CONFIGS[envKey];
    if (!config) return;
    const svg = document.getElementById(config.svgId);
    if (!svg) return;
    svg.classList.add("interactive-env-svg");
    const layer = ensureHandlesLayer(svg, envKey);
    const hud = layer.querySelector(".env-hud");
    const hudBg = hud?.querySelector(".env-hud-bg");
    const hudText = hud?.querySelector(".env-hud-text");
    let activeDrag = null;
    const startDrag = (e, nodeIdx) => {
      e.preventDefault();
      e.stopPropagation();
      const nodeConfig = config.nodes.find((n) => n.id === nodeIdx);
      if (!nodeConfig) return;
      const nodeEl = layer.querySelector(`.env-node[data-node="${nodeIdx}"]`);
      if (nodeEl) nodeEl.classList.add("dragging");
      const inputX = nodeConfig.paramX ? document.getElementById(nodeConfig.paramX) : null;
      const inputY = nodeConfig.paramY ? document.getElementById(nodeConfig.paramY) : null;
      activeDrag = {
        nodeIdx,
        nodeConfig,
        nodeEl,
        inputX,
        inputY,
        startClientX: e.clientX,
        startClientY: e.clientY,
        startValX: inputX ? parseInt(inputX.value, 10) : 0,
        startValY: inputY ? parseInt(inputY.value, 10) : 0,
        pointerId: e.pointerId
      };
      if (e.target && typeof e.target.setPointerCapture === "function") {
        try {
          e.target.setPointerCapture(e.pointerId);
        } catch (_) {
        }
      }
      updateHud(nodeConfig, activeDrag.startValX, activeDrag.startValY);
    };
    const updateHud = (nodeConfig, valX, valY) => {
      if (!hud || !hudText) return;
      const txt = nodeConfig.format(valX, valY);
      hudText.textContent = txt;
      if (hudBg) {
        const w = Math.max(80, txt.length * 7 + 16);
        hudBg.setAttribute("width", `${w}`);
        hudBg.setAttribute("x", `${-w / 2}`);
      }
      const nodeEl = activeDrag?.nodeEl;
      if (nodeEl) {
        const transform = nodeEl.getAttribute("transform") || "";
        const match = transform.match(/translate\(([^,]+),\s*([^)]+)\)/);
        if (match) {
          const nx = parseFloat(match[1]);
          const ny = Math.max(16, parseFloat(match[2]));
          const clampedX = Math.max(45, Math.min(255, nx));
          hud.setAttribute("transform", `translate(${clampedX.toFixed(1)}, ${(ny - 12).toFixed(1)})`);
          hud.style.display = "";
        }
      }
    };
    const onPointerMove = (e) => {
      if (!activeDrag) return;
      e.preventDefault();
      const rect = svg.getBoundingClientRect();
      if (rect.width <= 0 || rect.height <= 0) return;
      const scaleX = 300 / rect.width;
      const scaleY = 75 / rect.height;
      const dSvgX = (e.clientX - activeDrag.startClientX) * scaleX;
      const dSvgY = (e.clientY - activeDrag.startClientY) * scaleY;
      const stepPerPxX = 127 / 130;
      const dValX = Math.round(dSvgX * stepPerPxX);
      let currentValX = activeDrag.startValX;
      let currentValY = activeDrag.startValY;
      if (activeDrag.inputX) {
        currentValX = Math.max(activeDrag.nodeConfig.minX, Math.min(activeDrag.nodeConfig.maxX, activeDrag.startValX + dValX));
        if (parseInt(activeDrag.inputX.value, 10) !== currentValX) {
          activeDrag.inputX.value = currentValX;
          activeDrag.inputX.dispatchEvent(new Event("input", { bubbles: true }));
        }
      }
      if (activeDrag.inputY) {
        if (activeDrag.nodeConfig.isSignedY) {
          const stepPerPxY = 63 / 27.5;
          const dValY = Math.round(-dSvgY * stepPerPxY);
          currentValY = Math.max(activeDrag.nodeConfig.minY, Math.min(activeDrag.nodeConfig.maxY, activeDrag.startValY + dValY));
        } else {
          const stepPerPxY = 127 / 55;
          const dValY = Math.round(-dSvgY * stepPerPxY);
          currentValY = Math.max(activeDrag.nodeConfig.minY, Math.min(activeDrag.nodeConfig.maxY, activeDrag.startValY + dValY));
        }
        if (parseInt(activeDrag.inputY.value, 10) !== currentValY) {
          activeDrag.inputY.value = currentValY;
          activeDrag.inputY.dispatchEvent(new Event("input", { bubbles: true }));
        }
      }
      syncEnvelopeHandles(envKey);
      updateHud(activeDrag.nodeConfig, currentValX, currentValY);
    };
    const endDrag = (e) => {
      if (!activeDrag) return;
      if (activeDrag.nodeEl) activeDrag.nodeEl.classList.remove("dragging");
      if (activeDrag.inputX) {
        activeDrag.inputX.dispatchEvent(new Event("change", { bubbles: true }));
      }
      if (activeDrag.inputY) {
        activeDrag.inputY.dispatchEvent(new Event("change", { bubbles: true }));
      }
      if (hud) hud.style.display = "none";
      activeDrag = null;
    };
    for (let i = 1; i <= 4; i++) {
      const nodeEl = layer.querySelector(`.env-node[data-node="${i}"]`);
      if (nodeEl) {
        nodeEl.addEventListener("pointerdown", (e) => startDrag(e, i));
      }
    }
    svg.addEventListener("pointerdown", (e) => {
      if (activeDrag) return;
      if (e.target.closest(".env-node")) return;
      const rect = svg.getBoundingClientRect();
      const clickSvgX = (e.clientX - rect.left) / rect.width * 300;
      const clickSvgY = (e.clientY - rect.top) / rect.height * 75;
      const params = config.getParams();
      const pts = getEnvelopePoints(config.type, params, 300, 75);
      let closestNode = 1;
      let minDist = Infinity;
      for (let i = 1; i <= 4; i++) {
        if (!pts[i]) continue;
        const dx = pts[i].x - clickSvgX;
        const dy = pts[i].y - clickSvgY;
        const dist = Math.sqrt(dx * dx + dy * dy);
        if (dist < minDist) {
          minDist = dist;
          closestNode = i;
        }
      }
      if (minDist < 40) {
        startDrag(e, closestNode);
      }
    });
    window.addEventListener("pointermove", onPointerMove, { passive: false });
    window.addEventListener("pointerup", endDrag);
    window.addEventListener("pointercancel", endDrag);
  }
  function initInteractiveEnvelopes() {
    bindEnvelopeDrag("tvf");
    bindEnvelopeDrag("tva");
    bindEnvelopeDrag("pitch");
    syncAllEnvelopeHandles();
  }
  function syncAllEnvelopeHandles() {
    syncEnvelopeHandles("tvf");
    syncEnvelopeHandles("tva");
    syncEnvelopeHandles("pitch");
  }

  // src/srx_data.js
  var SRX_BOARDS = [
    {
      id: "SRX-01",
      name: "SRX-01 Dynamic Drum Kits",
      category: "Drums & Percussion",
      description: "High-resolution acoustic and electronic drum kits recorded in premier world-class studios.",
      waveCount: 88,
      patchCount: 128,
      sampleWaves: [
        "Dyn Dry Kick 1",
        "Dyn Dry Kick 2",
        "Dyn Fat Kick",
        "Jazz Kick",
        "Room Kick 1",
        "Room Kick 2",
        "Dyn Amb Snare 1",
        "Dyn Amb Snare 2",
        "Dyn Rimshot",
        "Piccolo Snare",
        "Vintage Snare",
        "Dyn Closed Hat",
        "Dyn Half Hat",
        "Dyn Open Hat",
        "Dyn Pedal Hat",
        "Dyn Low Tom",
        "Dyn Mid Tom",
        "Dyn High Tom",
        "Studio Crash 1",
        "Studio Crash 2",
        "Studio Ride 1",
        "Studio Ride 2",
        "Tambourine Dyn",
        "Shaker Loop",
        "Cowbell Studio"
      ],
      drumKits: [
        "SRX-01 Studio Standard",
        "SRX-01 Maple Custom",
        "SRX-01 Rock Power",
        "SRX-01 Jazz Brushes",
        "SRX-01 Vintage Birch",
        "SRX-01 Ambient Room",
        "SRX-01 Tight Funk",
        "SRX-01 Hip-Hop Studio",
        "SRX-01 Modern Pop",
        "SRX-01 Heavy Metal",
        "SRX-01 Latin Fusion",
        "SRX-01 Percussion FX"
      ],
      patches: [
        "Studio Standard Kit",
        "Maple Custom Kit",
        "Rock Power Drum Kit",
        "Vintage Birch Kit",
        "Jazz Brushes Kit",
        "Hip-Hop 808 Boom",
        "Supreme Dance 909",
        "Acoustic Punch Kit",
        "Room Ambient Kit",
        "Tight Funk Snare Kit",
        "Percussion FX Kit",
        "Studio Dry Session",
        "Modern Pop Kit",
        "Heavy Metal Kit",
        "Latin Fusion Kit",
        "Reggae Beat Kit",
        "Acoustic Snare 1",
        "Acoustic Snare 2",
        "Piccolo Snare",
        "Dry Rimshot",
        "Dyn Fat Kick",
        "Low Room Kick",
        "Jazz Brush Snare",
        "Dynamic Hi-Hat",
        "Studio Ride",
        "Stereo Crash",
        "Studio Congas",
        "Bongo Duo",
        "Timbales Session",
        "Tambourine Dyn",
        "Shaker Studio",
        "Cowbell Studio",
        "Agogo Bells",
        "Triangle Session",
        "Wind Chimes",
        "Hand Claps Studio",
        "Finger Snaps",
        "Electronic Tom",
        "Analog Claps",
        "808 Long Boom",
        "909 Open Hat",
        "909 Distortion",
        "Synth FX Perc",
        "Reverse Cymbal",
        "Trash Can Hit",
        "Junkyard Perc",
        "Brush Swirl",
        "Brush Tap"
      ]
    },
    {
      id: "SRX-02",
      name: "SRX-02 Concert Piano",
      category: "Acoustic Piano",
      description: "Exquisite 64MB stereo acoustic grand piano multisampled across 88 keys at 4 velocity layers.",
      waveCount: 64,
      patchCount: 50,
      sampleWaves: [
        "Concert Grand p L",
        "Concert Grand p R",
        "Concert Grand mf L",
        "Concert Grand mf R",
        "Concert Grand f L",
        "Concert Grand f R",
        "Concert Grand ff L",
        "Concert Grand ff R",
        "Bright Grand p L",
        "Bright Grand p R",
        "Bright Grand f L",
        "Bright Grand f R",
        "Piano Hammer Rel",
        "Piano Damper Res L",
        "Piano Damper Res R",
        "Concert Mono Grand"
      ],
      patches: [
        "PremierGrand",
        "Steady Grand",
        "DynamicGrand",
        "Concert Hall",
        "Bright Grand",
        "Classical",
        "SoftPdlGrand",
        "OnMicPremier",
        "OnMic Bright",
        "OnMicSoftPdl",
        "Premier Mono",
        "Bright Mono",
        "SoftPdl Mono",
        "Mellow Piano",
        "Enhanced Pno",
        "Ambient Grand",
        "Warm Concert",
        "Grand & String",
        "Grand & Orch",
        "Pop Grand",
        "Rock Grand",
        "Studio Grand",
        "Ballad Grand",
        "New Age Grand",
        "Stage Grand",
        "Recital Grand",
        "Intimate Pno",
        "Dark Classical",
        "Chamber Piano",
        "Piano & Pad",
        "Piano Layer",
        "Echo Grand",
        "Chorus Piano",
        "Flange Piano",
        "Rotary Grand",
        "Tremolo Grand",
        "Mono Concert",
        "Mono Studio",
        "Mono Ballad",
        "Mono Recital",
        "Mono Pop",
        "Comp Piano 1",
        "Comp Piano 2",
        "Dance Piano 1",
        "Dance Piano 2",
        "Bright Dance",
        "Honky-Tonk 1",
        "Honky-Tonk 2",
        "Tack Piano",
        "Piano FX"
      ]
    },
    {
      id: "SRX-03",
      name: "SRX-03 Studio SRX",
      category: "Studio Instruments",
      description: "Essential studio tracking session instruments including guitars, brass, bass, and drums.",
      waveCount: 128,
      patchCount: 128,
      sampleWaves: [
        "Studio Strat Clean",
        "Studio Strat Mute",
        "Studio Tele Lead",
        "Studio Acoustic 12S",
        "Studio Slap Bass",
        "Studio Fingered Bass",
        "Studio Fretless Bass",
        "Studio Muted Trumpet",
        "Studio Tenor Sax",
        "Studio Trombone Cup",
        "Studio Flute Vibrato",
        "Studio Pop Brass Section"
      ],
      patches: [
        "Studio Strat Cln",
        "Nashville 12S",
        "Studio Tele",
        "Funk Mute Gtr",
        "Jazz Hollow",
        "Overdriven Lead",
        "Heavy Metal Chd",
        "Studio Slap 5S",
        "Studio Finger",
        "Fretless Solo",
        "Precision Bass",
        "Picked Bass",
        "Studio Flute",
        "Piccolo Solo",
        "Clarinet Vib",
        "Oboe Session",
        "English Horn",
        "Bassoon Vib",
        "Studio Alto Sax",
        "Expressive Tenor",
        "Baritone Growl",
        "Soprano Lead",
        "Pop Brass Sect",
        "Trumpet Harmon",
        "Muted Trumpet",
        "Trombone Cup",
        "Flugelhorn Solo",
        "French Horn",
        "Studio Rhodes",
        "Studio Wurly",
        "Clavinet Funky",
        "Studio B3",
        "Studio Perc Kit",
        "Session Drums",
        "Studio Trumpet",
        "Studio Trombone",
        "Studio Tuba",
        "Trumpet Shake",
        "Brass Swell",
        "Pop Mute Gtr",
        "Acoustic Finger",
        "12-Str Chords",
        "Nylon Classical",
        "Rock Lead Solo",
        "Cry Wah Gtr",
        "Slap Bass Thumb",
        "Slap Bass Pop",
        "Ac.Bass Studio",
        "Upright Bass",
        "Synth Bass 5-Str"
      ]
    },
    {
      id: "SRX-04",
      name: "SRX-04 Symphonique Strings",
      category: "Orchestral Strings",
      description: "Superb expressive symphonic string sections recorded in European concert halls with full vibrato control.",
      waveCount: 128,
      patchCount: 128,
      sampleWaves: [
        "Vlns Legato mf L",
        "Vlns Legato mf R",
        "Vlns Staccato L",
        "Vlns Staccato R",
        "Vlns Pizzicato L",
        "Vlns Pizzicato R",
        "Vlns Tremolo L",
        "Vlns Tremolo R",
        "Violas Expressive",
        "Cellos Warm Legato",
        "Basses Deep Arco",
        "Full String Orch Spiccato"
      ],
      patches: [
        "Full Symphonic",
        "Legato Violins",
        "Warm Violas",
        "Cellos Hall",
        "Double Basses",
        "Spiccato Orch",
        "Pizzicato Ens",
        "Tremolo Susp",
        "Staccato Strings",
        "Marcato Strings",
        "Sordino Violins",
        "Chamber Strings",
        "Baroque Quartet",
        "Octave Strings",
        "Adagio Strings",
        "Espressivo Vln",
        "Solo Violin Vib",
        "Solo Cello Esp",
        "Harp Glissando",
        "Pizz / Arco",
        "Full Strings fff",
        "Soft Strings pp",
        "Studio Session Str",
        "Vintage Mellotron",
        "Symphonique Pad",
        "Hollywood Str",
        "Epic Cinematic",
        "Cinema Violins",
        "Drama Violas",
        "Romantic Cellos",
        "Contrabass Deep",
        "Spiccato Violins",
        "Spiccato Celli",
        "Staccato Violas",
        "Tremolo Violins",
        "Tremolo Celli",
        "Sul Ponticello",
        "Flautando Str",
        "Col Legno",
        "Bartok Pizz",
        "Pizzicato Bass",
        "Pizz & Flute",
        "Violins & Violas",
        "Celli & Basses",
        "String Quartet",
        "Solo Viola Vib",
        "Solo Contrabass",
        "Hall Harp Solo",
        "Warm String Pad",
        "Dramatic Swell"
      ]
    },
    {
      id: "SRX-05",
      name: "SRX-05 Supreme Dance",
      category: "Dance & Electronic",
      description: "Punchy club kicks, cutting synth leads, analog modeled basses, and aggressive tempo-synced loops.",
      waveCount: 312,
      patchCount: 312,
      sampleWaves: [
        "909 Kick Hard",
        "808 Sub Boom",
        "Distorted Gabber Kick",
        "Electro Clap Wet",
        "Hypersaw Lead 1",
        "Hypersaw Lead 2",
        "Reese Bass Mod",
        "Acid 303 Square",
        "Acid 303 Saw",
        "Trance Pluck Synth",
        "Euro Dance Organ",
        "Vocal Stabs Rave"
      ],
      drumKits: [
        "SRX-05 Club 909",
        "SRX-05 Analog 808",
        "SRX-05 Gabber Hard",
        "SRX-05 Electro House"
      ],
      patches: [
        "Hypersaw Anthem",
        "Reese Monster",
        "Acid 303 Square",
        "Acid 303 Saw",
        "Euro Trance Plk",
        "Club 909 Kit",
        "Analog 808 Boom",
        "Hardstyle Lead",
        "Rave Vocal Stab",
        "Hoover Sound",
        "Tech House Bass",
        "Dutch Saw Lead",
        "Sidechain Pad",
        "Electro Chords",
        "Gabber Kick Sub",
        "TB-303 Reso",
        "Modular Seq",
        "Hard Trance Syn",
        "Psytrance Lead",
        "Nu-NRG Pluck",
        "90s Piano House",
        "Subzero Bass",
        "Deep House Org",
        "Eurodance Lead",
        "Distorted Lead",
        "Screamer Saw",
        "Cyberpunk Reese",
        "Future Bass Saw",
        "Detroit Techno",
        "Berlin Minimal",
        "Acid Squelch",
        "303 Dist Attack",
        "Reso Bassline",
        "Moog Sub Bass",
        "SH-101 Lead",
        "Alpha Juno Bass",
        "Supersaw Stack",
        "Epic Trance Pad",
        "Trance Chords",
        "Pluck Arpeggio",
        "Progressive Plk",
        "Dark Psy Lead",
        "Goa Trance Saw",
        "Acid Techno 303",
        "Hardcore Lead",
        "Gabber Saw",
        "Jumpstyle Bass",
        "Speedcore Lead",
        "HandsUp Lead",
        "Big Room Lead"
      ]
    },
    {
      id: "SRX-06",
      name: "SRX-06 Complete Orchestra",
      category: "Full Orchestra",
      description: "All waveforms from the legendary SR-JV80 Orchestral, Orchestral II, and Vocal expansion boards.",
      waveCount: 449,
      patchCount: 449,
      sampleWaves: [
        "Orch Tutti Hit 1",
        "Orch Tutti Hit 2",
        "Concert Harp Gliss",
        "Timpani Roll Dyn",
        "French Horn Sect",
        "Tubular Bells Solo",
        "Oboe Solo Expressive",
        "Clarinet Warm mf",
        "Choir Boys Aahs L",
        "Choir Boys Aahs R",
        "Choir Full Mmh",
        "Gregorian Chant Male"
      ],
      patches: [
        "WarmVlns SRX",
        "Legato Vlns",
        "NaturalVlnsS",
        "Agitato Vlns",
        "Vlns-Spc /",
        "Vl&Va Spicct",
        "SuperSoundSet. This board contains new Patches and",
        "Agitato Vas",
        "Vlas-Spc /",
        "Marc Vas SRX",
        "Vc Sec mf",
        "Fast Cellos",
        "Vcs Legato",
        "3 Cellos",
        "Cellos",
        "CelloSectMrc",
        "Marcato Vcs",
        "Agitato Vcs",
        "Vcs+Cbs SRX",
        "Arco Vcs+Cbs",
        "3",
        "Cb Sect SRX",
        "WideBasses S",
        "Agitato Cbs",
        "BIG StrgEns",
        "Big Strings2",
        "Orch p",
        "Multi",
        "StrsArco SRX",
        "StrSwel/ModS",
        "StStrOrcp/fS",
        "SlowResinStr",
        "Adagio Strs",
        "LegatoStrngs",
        "Intim StrSec",
        "DramaStrsSRX",
        "St Str p/f",
        "SlowEpic Str",
        "Real Strings",
        "4Seasons SRX",
        "VlVaVcCb SRX",
        "StudioString",
        "Quartet SRX",
        "VibSwStrings",
        "Str Swell",
        "OuvertureSRX",
        "Cluster Sect",
        "Velo Str SRX",
        "Agitato to",
        "DynaMarc SRX",
        "VivaceStrSRX",
        "Agitato",
        "STR SpiccSRX",
        "StacctoSectn",
        "Spicc/releas",
        "STR Marcato",
        "Big Marcato!",
        "Spicc Sect",
        "Spc+Pz/rleas",
        "Piz-Spc /",
        "RoomPizz SRX",
        "Stage Pizz",
        "Nite Pizzico",
        "VIOLIN solo",
        "Solo Vln /",
        "Solo Violin",
        "Sad S.VlnSRX",
        "Solo Viola",
        "AgitatoVaSRX",
        "Solo Cello",
        "Solo Cello",
        "The V Cello",
        "Solo Vc /",
        "Marcato Vc",
        "Vln&Vcl",
        "Solo Cb /",
        "Tape Orc SRX",
        "Tape Str SRX",
        "Old Tale",
        "Mellow Tape",
        "Cystaline Pd",
        "SynStrings",
        "Full Orc SRX",
        "St.OrcUniSRX",
        "OrchUnif SRX",
        "GRAND OrcSRX",
        "WavinGoodbye",
        "DynOrchestr1",
        "Pathetique",
        "Oboes & Sect",
        "SlowEpicOrch",
        "Grand Tutti",
        "Ultimate Orc",
        "SuspenceOrch",
        "Tremolo /",
        "TremOrc /Mod",
        "ORC full+BD",
        "Finally Orch",
        "Orch & Choir",
        "NowWeAreFree",
        "Too Tense",
        "OrchestrlSRX",
        "DynOrchestr2",
        "GiantOrchest",
        "Strngs&Horns",
        "Full Orch.",
        "Full Orch.",
        "Full Orch.",
        "End Titles",
        "HornStrs SRX",
        "SRX Full Orc",
        "Harp & Flute",
        "Celesta&Flt",
        "ProkofievSRX",
        "MassInCeeSRX",
        "PentatnicSRX",
        "DawnSynphony",
        "Bad Ending",
        "Epic Ending",
        "Catwalk",
        "OrchStaccato",
        "Staccato SRX",
        "OrchHitStack",
        "Dynam Hit",
        "MondoHit SRX",
        "OrchHit SRX",
        "OrcHitMajSRX",
        "OrcHitMinSRX",
        "OrcHitDimSRX",
        "Big Hit Maj1",
        "Big Hit Maj2",
        "Big Hit Min",
        "Big Hit Dim",
        "Sfz! Hit-Maj",
        "Sfz! Hit-Min",
        "Suspense",
        "Hit/Off-Maj",
        "Trem Hit-Maj",
        "Trem Hit-Min",
        "Trem Hit-Dim",
        "Orc/Prc",
        "Drama Stab",
        "Maj Concern",
        "OrcGlsMajSRX",
        "OrcGlsMinSRX",
        "Harp Up Hit",
        "Harp Dn Hit",
        "BrassStabSRX",
        "Finale",
        "Tuned",
        "YourMissionS",
        "Big Hit SRX",
        "HorrorHitSRX",
        "Perc Hit",
        "BrassFallSRX",
        "Tp Fall",
        "BrsStacc SRX",
        "Finale SRX /",
        "Orch Piccolo",
        "Picc Vel Tr",
        "Piccolo Trio",
        "Orch Flute",
        "Vibra Flute",
        "FluteAtm/Aft",
        "Picc/Fl",
        "Double Flute",
        "Fl/EH Usn",
        "Calliope SRX",
        "DynoCelt SRX",
        "Ethnic Flute",
        "AmbiFluteSRX",
        "T.WhistleDly",
        "TinWhistle",
        "Sop Recorder",
        "Tnr Recorder",
        "Whistle SRX",
        "Solo Clari",
        "Unison Clari",
        "Orch Clar",
        "Bs Clairenet",
        "Orch Bs Clar",
        "Cl/Bs Cl",
        "Fl/Cl Usn",
        "Fl/Cl",
        "Orch Oboe",
        "Sweet Oboe",
        "Cor Oboe",
        "OBOE Solo",
        "2 Close Oboe",
        "Orch Eng Hrn",
        "Horn'o U.K.",
        "Orch Bassoon",
        "Bassoon III",
        "BassFoons",
        "Cl/Bsn Usn",
        "Cl/Bsn",
        "Fl/Ob Usn",
        "Fl/EH",
        "Fl/Bsn",
        "BsCl/Bsn",
        "BsCl/Bsn Usn",
        "Cl/Hrn/Bsn",
        "Cl/Hrn/Bsn",
        "Ob/Hrns/Bsns",
        "Ob/Bsn",
        "Ob/EH Usn",
        "Ob/EH",
        "EH/Bsn Usn",
        "EH/Bsn",
        "EH/Cl Usn",
        "EH/Bs Cl",
        "Ob/Cl Usn",
        "Ob/BsCl",
        "Hrns/Bsns",
        "Really Reeds",
        "Reed Duet",
        "Multi Reeds",
        "Medieval Rds",
        "ScottishPIPE",
        "Hill&Sheeps",
        "HilndChr SRX",
        "Solo Fr.Horn",
        "SoloF.HrnSRX",
        "HrnAccompSRX",
        "Orch Hrns Sw",
        "Hornz Stereo",
        "Orch Hrns ff",
        "FizzHorns ff",
        "Fr.Horns SRX",
        "Dynamic Hrns",
        "Horn Sect /",
        "Fr.HrnSfzSRX",
        "MuteFr.Horns",
        "F.Horn Rip",
        "Trumpet Plus",
        "Natural Tmpt",
        "Real Tp SRX",
        "El Bono SRX",
        "Coronet",
        "Flugelhorn",
        "Mute Tp SRX",
        "HrmnMute SRX",
        "WahMute /Mod",
        "Trumpeters",
        "Tp Ens SRX",
        "Trumps fff!!",
        "Softy Bones",
        "Bone Fluegal",
        "Natural Tbn",
        "Trombone SRX",
        "SoloTb SRX",
        "SoloTb SRX",
        "Bs Tb",
        "Tbn One",
        "Bone Boys",
        "Bones sectn",
        "BigBones SRX",
        "BsBoneSctSRX",
        "Noblesse",
        "Brass Choral",
        "BrassEns/Mod",
        "Small Brass",
        "Brass Orche",
        "Switch Fall",
        "4-Pc Brs Scn",
        "BiggieBrsSRX",
        "SoloTuba SRX",
        "Tuba sfz/Mod",
        "Tuba SRX",
        "Medieval Brs",
        "Full Brass",
        "Brass ff",
        "Brass Sect /",
        "Multi Sax",
        "St.EuroPiano",
        "JoyoClassics",
        "Empathy",
        "Piano & Strs",
        "Pno Concerto",
        "Song Wish",
        "HpsFrntSRX",
        "HpsFrntSRX",
        "HpsFrntSRX",
        "HpsBackSRX",
        "HpsBackSRX",
        "HpsBackSRX",
        "Hps F/B SRX",
        "Hps F4/B SRX",
        "Hps F/B/B4 S",
        "HpsLuteSRX",
        "HpsLute",
        "HpsLute",
        "FullHarpsi",
        "FullHarpsi",
        "Continuo Pdl",
        "Celesta SRX",
        "MusicBellSRX",
        "Water Mallet",
        "Newborn",
        "Victoriana",
        "St.M.Box SRX",
        "Victoriana",
        "ChurchBellS1",
        "BlfryChm SRX",
        "ChurchBellS2",
        "Tub.Bells S1",
        "Tub.Bells S2",
        "BsMarimbSRX1",
        "BsMarimbSRX2",
        "MultiMallets",
        "Glocken",
        "Glockeneste",
        "GlocknlstSRX",
        "Clear Glock",
        "Xylorimba",
        "Xylophone S1",
        "Xylophone S2",
        "Mallet Stack",
        "OrgFlutes S1",
        "OrgFlutes S2",
        "OrgFlutes S3",
        "OrgFlute",
        "Psyche Pipes",
        "ChrchPipes S",
        "Organ&Recdr",
        "Early Harmn",
        "CathedralSRX",
        "Harmonium",
        "ChurchOrgSRX",
        "OrganChrdSRX",
        "Musaccordion",
        "Mystery Pad",
        "Psychedelic1",
        "Psychedelic2",
        "Elysium m7",
        "Eylsium",
        "Elysium +7",
        "Elysium b9",
        "Vln RunUp Mj",
        "Vln RunUp Mn",
        "Vln RunDn Mj",
        "Vln RunDn Mn",
        "Maj/MinHarps",
        "9th/b9 Harps",
        "Harp m7 SRX",
        "Harp",
        "Harp +7 SRX",
        "Harp b9 SRX",
        "Harpm7SclSRX",
        "Harp9thScrlS",
        "Harp+7SclSRX",
        "Harpb9SclSRX",
        "Cluster Gong",
        "Sus.Perc Hit",
        "Prc Ens6-Maj",
        "Prc Ens7-Min",
        "Prc Ens8-Dim",
        "Cluster SRX",
        "HorrorClustr",
        "Hell Section",
        "Legettimare",
        "Limbus SRX",
        "Backword",
        "Dreamseq SRX",
        "Midnight SRX",
        "Colombus SRX",
        "Once Upon A",
        "Desert Dream",
        "AncientTimes",
        "Tension SRX",
        "Wreck",
        "Eclipse SRX",
        "PulsingVox S",
        "SynthStr.Pad",
        "Meditate PAD",
        "Choir",
        "Angelic Pad",
        "BoysChoirSRX",
        "Sing! /Mod",
        "SmockyVoices",
        "Smooth Choir",
        "X.. Vox SRX",
        "RealChoirSRX",
        "StChrMm/Ah S",
        "Mmms & Aaahs",
        "Choir /Mod",
        "Close Mouths",
        "Voice Stax",
        "MorphieChoir",
        "Morph4Choir",
        "17th Movemnt",
        "Matins",
        "Quartet II",
        "Scat /",
        "Scatmen! SRX",
        "The Voices",
        "VocalCollect",
        "GregorianCho",
        "Soprano&co.",
        "Tenor solo",
        "ClarsahHarpS",
        "Heavens Harp",
        "C.Hrp/padSRX",
        "PhaseClarsah",
        "ClearHarpSRX",
        "Nails Harp",
        "Harp SRX",
        "Natural Harp",
        "Warm Harp",
        "Bousouk&Harp",
        "Etheral Lute",
        "DelicateCOMB",
        "St.CymblnSRX",
        "CymblnDuoSRX",
        "Bohemian SRX",
        "Bousouki Pic",
        "Bousouki",
        "PulcinelaSRX",
        "SN Roll SRX/",
        "Perc Ens",
        "Perc Ens",
        "Perc Ens",
        "Perc Ens",
        "Perc Ens",
        "Orch Percs",
        "BodhranSplit",
        "BodhranVel S",
        "CrazyBodhrnS",
        "BodhranMenuS",
        "Perc Mix SRX",
        "MassiveTimpa",
        "4-way Timps",
        "DynaTimpsSRX",
        "TimpaniRoll1",
        "TimpaniRoll2",
        "MultiTimpani",
        "MalletCymbal",
        "Timpani /",
        "Big Orc.Perc",
        "WindChimeSRX",
        "FingerCymSRX",
        "ConcertBDSRX",
        "BD Roll SRX/",
        "Tam Tam SRX",
        "Piatti!! SRX",
        "SleighBellsS",
        "SlapstickS /",
        "TambourineS/",
        "CastanetsS /"
      ]
    },
    {
      id: "SRX-07",
      name: "SRX-07 Ultimate Keys",
      category: "Vintage Keyboards",
      description: "Definitive collection of vintage electric pianos, tonewheel organs, Clavinets, Mellotrons, and vintage synths.",
      waveCount: 475,
      patchCount: 475,
      drumKits: [
        "Ring Kit",
        "Slam Kit",
        "Verb Kit",
        "Slap Kit",
        "RockOn Kit",
        "DryFat Kit",
        "LiteFunk Kit",
        "Warm Kit",
        "HiTune Kit",
        "AnalogRhyKit",
        "AllRhy Menu"
      ],
      sampleWaves: [
        "Rhodes MkI Stage mf",
        "Rhodes MkI Stage ff",
        "Rhodes Suitcase Dyn",
        "Wurly 200A Tremolo",
        "Clavinet D6 Mute",
        "Clavinet D6 Pluck",
        "B3 Fast Leslie High",
        "B3 Slow Chorale Low",
        "Mellotron Flute Vintage",
        "Mellotron 8-Voice Choir",
        "Mellotron Strings C3",
        "Minimoog Fat Square",
        "Minimoog Detuned Saw",
        "Prophet-5 Sync Lead",
        "Jupiter-8 Strings"
      ],
      patches: [
        "Stereo Piano",
        "Gran'Piano",
        "Easy Rocker",
        "Stage Grand",
        "SA Rocker",
        "Padded Pno",
        "Suitcase EP",
        "Keyboards of the",
        "Fusiontastic",
        "Inspiration",
        "Touch EP SRX",
        "Stage73 SRX",
        "Stage EP",
        "BalladPanner",
        "80's EP",
        "SweetStagePN",
        "Padded EP",
        "Nursery Tine",
        "Sine EP",
        "70s Ballad",
        "3",
        "ClaviQ EP",
        "FlaredTrouzr",
        "70'EP Bs",
        "Swurly",
        "Dyno-Wurli",
        "60s Bros",
        "Pianohner",
        "Pianette",
        "Cheapy Ep1",
        "Rox",
        "80's FM",
        "The",
        "Heavens Tine",
        "Sparkle EPno",
        "FirstDigital",
        "Vox Harpsi",
        "Harpsiclav",
        "E.Harpsi",
        "Clav",
        "Clav",
        "VeloClav SRX",
        "Clav",
        "Generic Clav",
        "Clav Pluck",
        "Vintage Clav",
        "Dyno Clav",
        "PhaserClavi",
        "CompClav SRX",
        "MuteClv1 SRX",
        "MuteClv2 SRX",
        "Clav Supremo",
        "Clav By III",
        "Funk Synclav",
        "Quacky Clav",
        "GuitClav SRX",
        "Juno Clavi",
        "PhazynClvSRX",
        "Moogy Pulse",
        "JP8 Clav SRX",
        "HyperClv SRX",
        "Twinkle Bell",
        "Troika Ride",
        "Analog Bell",
        "Goodnite SRX",
        "2.2 SEQ SRX",
        "Vibraphone!",
        "SA Vibe  SRX",
        "Blue B  SRX",
        "FullPerc SRX",
        "NiceFeel SRX",
        "GreenB /Pdl",
        "Mello",
        "LA Blues SRX",
        "2BorNot2B3",
        "Gospel B SRX",
        "Bookin'B SRX",
        "Hush B3 SRX",
        "Real Organ",
        "Tenamos L100",
        "Harm.Organ",
        "Harm.Organ2",
        "Power B SRX",
        "AllStarB3SRX",
        "GoodLord/Mod",
        "CabnetSeries",
        "Absolute B3",
        "Rox368-B/Mod",
        "Suitcase B3",
        "BalladB /Mod",
        "70'sKeysMix",
        "Leslied B3",
        "Dyna Hammnd",
        "SaltyDog SRX",
        "Swt&Mllw SRX",
        "Mellow",
        "ZomBee SRX",
        "Perky Twin B",
        "BluesPercSRX",
        "Club Organ",
        "888 +3rd SRX",
        "8888+3rd SRX",
        "Velo Perc",
        "Jazzy B",
        "Gutsy C3",
        "B3",
        "60s Brothers",
        "FirePerc SRX",
        "PercNorm3rd",
        "PercSoft3rd",
        "858808880SRX",
        "Mad Organ",
        "Touchy B Fst",
        "Souvenirs",
        "R&R B3 SRX",
        "B3Sermon SRX",
        "AllSkate!SRX",
        "BalladB3 SRX",
        "Ultimate B",
        "Purple SRX",
        "GimmeSomeSRX",
        "Smoked Water",
        "HardPerc3rd",
        "FuzzheadSRX",
        "Tron B",
        "ShimmerOrgan",
        "AnimalModSRX",
        "SurfMnkysSRX",
        "TelstarOrgan",
        "Continental",
        "Organfest'66",
        "PalisadesSRX",
        "New Riders",
        "The Sham SRX",
        "CrummyOrgSRX",
        "IronFarf SRX",
        "FarfComboSRX",
        "Farfisorium",
        "Farf",
        "RoxOrgan SRX",
        "DittyDoo SRX",
        "Tranny Organ",
        "2.2 Organ",
        "VS Organ SRX",
        "D50 OrganSRX",
        "OrganbellSRX",
        "PhazedOrgSRX",
        "Das Limpet",
        "Spanish Gtr",
        "Nylon SoSoft",
        "Nylon on Pad",
        "Moody Nylon",
        "Conquest",
        "Heaven Nylon",
        "In Peace",
        "NashvilleSRX",
        "Caster Delay",
        "Ricken12stGT",
        "Narnia",
        "Gtr PopArps",
        "Touchy Mutes",
        "Disto-Chunky",
        "Rock Mute",
        "Telemaster",
        "Plugged!",
        "MutedDsBlief",
        "MM Bass /",
        "MMFatSlapSRX",
        "HyperFunkSRX",
        "MillerPopSRX",
        "Funk Bass",
        "Abe",
        "AL3way/NzSRX",
        "ALDarkSlpSRX",
        "John",
        "JPBritSlpSRX",
        "John w/NzSRX",
        "6strngBASS +",
        "Big Bad AL",
        "Comp",
        "AbeLimitrSRX",
        "JP P.Bs",
        "JP P.Bs",
        "Abe'sP.BsSRX",
        "AL Solid SRX",
        "AL2wayFngSRX",
        "AL SoftBs/Nz",
        "MarcusJB SRX",
        "MM JB SRX",
        "Pick UP SRX",
        "JP Rock SRX",
        "PickedJzBass",
        "BritePickSRX",
        "PhsrMute SRX",
        "DarkPick SRX",
        "Country Mute",
        "FretlessBASS",
        "SoloFls SRX",
        "JP6StrFlsSRX",
        "MM OctFlsSRX",
        "MMSmthFlsSRX",
        "ALFlsSoloSRX",
        "JPSoloFlsSRX",
        "Contrabbasso",
        "InYerFaceBas",
        "BriteUpright",
        "Uplectric",
        "JPSoftAB SRX",
        "JPHardAB SRX",
        "Dry AcB SRX",
        "WildThangSRX",
        "Dist Bs SRX",
        "StickyBs SRX",
        "FunkinWahSRX",
        "Harm A#9 SRX",
        "Harm E69 SRX",
        "SlidesNz SRX",
        "AllSlidesSRX",
        "AllNoisesSRX",
        "Ac.Bs Nz SRX",
        "WildSynth101",
        "SH Dullbass",
        "101 Bass",
        "SH101 Bass",
        "SH-2 Bs SRX",
        "Bassic101SRX",
        "Fat Butt",
        "JP-4 Bs SRX",
        "Systm700 SRX",
        "BigSubBs SRX",
        "TickerBs SRX",
        "202 Bass",
        "101ZapBs SRX",
        "Housy Bass",
        "HousineBsSRX",
        "WooferBs SRX",
        "System100SRX",
        "Low Bass SRX",
        "TB3O3 Reso",
        "MeanderingBs",
        "Acid TB Bs",
        "MonsterMGSRX",
        "Rogue Bs SRX",
        "Classic Bs",
        "Fat Bass",
        "ResoMG BsSRX",
        "MG Punchbass",
        "Spike Bs SRX",
        "WetMG Bs SRX",
        "2-way Bass",
        "Oct stinger",
        "BsPedals SRX",
        "MG PedalsSRX",
        "OB Bass SRX",
        "8VCO Mono",
        "Thick OBass",
        "The Synbass",
        "Farf Organ",
        "Valve5thBass",
        "Rezidence",
        "OrganSawBass",
        "Organ Bass",
        "SquareBs SRX",
        "SlobbryBsSRX",
        "Super Bs SRX",
        "STronSTringz",
        "TrnStrDrySRX",
        "Tron Vls SRX",
        "MelloVlnsSRX",
        "JP8 Str1 SRX",
        "JP8 Str2 SRX",
        "JP+OB StrSRX",
        "M12 Strings",
        "Wavestr SRX",
        "MemoryMG SRX",
        "Solina SRX",
        "Omni Strings",
        "Big Str SRX",
        "Solo Flute",
        "TouchFlt SRX",
        "StrawberTRON",
        "Flute School",
        "Calli SRX",
        "TpSoloistSRX",
        "Pop Fanfare",
        "Oct Brass",
        "SessnBrs SRX",
        "R&R Bras SRX",
        "SuperTnr SRX",
        "T.Sax f SRX",
        "Cool Sax",
        "Duelin' Saxs",
        "SoftSaxesSRX",
        "AmazngEchSRX",
        "FlaxOstinato",
        "2voiceLd SRX",
        "Hollo Lead",
        "Sinusolo SRX",
        "Shmoog SRX",
        "Sine",
        "SH2000VoxSRX",
        "FM Lead SRX",
        "TrickTailEnd",
        "4 Old Saws",
        "Saw Bowed",
        "VoxSaws Lead",
        "GR500 Ld SRX",
        "LimonaireSRX",
        "NakdCheseSRX",
        "PromarsLdSRX",
        "Sweeze Lead",
        "Homey Lead",
        "MG Lead SRX",
        "Dreams Saw",
        "The Real Pat",
        "H",
        "PulseLd SRX",
        "Mono FM Lead",
        "VCO OctLdSRX",
        "Saws Lead",
        "Changes",
        "P5 Lead",
        "SH-2&5 Sqr",
        "Cutting Solo",
        "Racy Lead",
        "Speedometer",
        "Rotary Lead",
        "BuzzzzzzzSRX",
        "Telstar Lead",
        "Pattern It",
        "Carbonite",
        "The Pipe",
        "Buzzy Beez",
        "Look Back",
        "Razzert",
        "Raveferenz",
        "SupremeCheez",
        "Exit",
        "MousBoxesCat",
        "Riff the",
        "Ice Man",
        "DncStack1SRX",
        "DncStack2SRX",
        "DncStack3SRX",
        "DncStack4SRX",
        "DncStack5SRX",
        "Euro BrsSRX",
        "ThipsBlipSRX",
        "FaveoravoSRX",
        "Cleanse",
        "Mer",
        "B-lieve",
        "Blue Light",
        "Progress",
        "Modularswirl",
        "Sparkly",
        "Undertones",
        "HappyLFOsSRX",
        "AeroInsctSRX",
        "MC8 Seq SRX",
        "Legato Rip",
        "Steam Valve",
        "Scanner7",
        "Haunted Tron",
        "Experimental",
        "Megatron",
        "Outer Spaces",
        "Martian Bell",
        "Ethereal SRX",
        "Meow",
        "MantrawavSRX",
        "RSS SpinnerS",
        "Comp Net SRX",
        "SpitBrs SRX",
        "Pro-10BrsSRX",
        "OBStabBrsSRX",
        "Pro-5 BrsSRX",
        "Quack BrsSRX",
        "M.MG Brs SRX",
        "FM Brs SRX",
        "D50Belpd1SRX",
        "D50Belpd2SRX",
        "D50Belpd3SRX",
        "KlmbSynthSRX",
        "B Higher",
        "Reflections",
        "VintagLayers",
        "HandleW/Care",
        "StaccHvn SRX",
        "TimefliesSRX",
        "JP6SqKeySRX",
        "CS Squared",
        "MawnlowerMan",
        "Glidiator",
        "Spit Synthie",
        "Raver One",
        "Slop-a-ramaS",
        "Big PWM SRX",
        "WavesyncSRX",
        "T8 Sync SRX",
        "SyncRush SRX",
        "DreaminOfJMJ",
        "Arp Saws SRX",
        "QuixelateSRX",
        "SpikedChzSRX",
        "Planet-S SRX",
        "Iceburg",
        "JP Ac.Bs f A",
        "Poly",
        "PortaSyn SRX",
        "RazrVCOs SRX",
        "Medusa SRX",
        "PhazeNRG SRX",
        "Build-Up SRX",
        "WavetableSRX",
        "DigiChoirSRX",
        "Rezidue SRX",
        "Combing SRX",
        "PhzslopadSRX",
        "OBThickPdSRX",
        "OBSftPad SRX",
        "RealStrSynth",
        "Rezonant Ens",
        "PG Phaser",
        "SynthOdyssey",
        "Liquid Lunch",
        "JP SquPadSRX",
        "Chewy Pad",
        "Hollow SRX",
        "Too Heaven",
        "Slow",
        "JP Spirit",
        "Classic OB",
        "Aulophony",
        "Dark Shadow",
        "Drawning Pad",
        "Sawed String",
        "R.I.P.",
        "K World",
        "CanyonDreams",
        "Mysterioso",
        "S/HTexturSRX",
        "VP-330ChrSRX",
        "Mellorkestra",
        "Tron Mass",
        "PreSampleVox",
        "Gamma Girls",
        "Lo-Tek Choir",
        "Tron Vox SRX",
        "Vox JX8P SRX",
        "VP303 Arpeg",
        "DrumLP DemoS",
        "Pursuit",
        "Arcade",
        "SeventhHeavn (90)",
        "TrollDrummin (60)",
        "Chem Burn120 (120)",
        "Rockshow",
        "T-Pop",
        "Valentine 76",
        "Nocturne",
        "Cool At 102",
        "Circuit 112",
        "Hurt 90",
        "Orleans 90",
        "FunkyDrummer",
        "Circuit 90",
        "SweepingLP S",
        "Kick Menu",
        "Snare Menu",
        "Snare Menu",
        "Snare Menu",
        "Hi-Hat Menu",
        "Tom-Tom Menu",
        "Cymbals Menu"
      ]
    },
    {
      id: "SRX-08",
      name: "SRX-08 Platinum Trax",
      category: "Hip-Hop & R&B",
      description: "Modern urban, hip-hop, R&B, and electronica sounds derived from SR-JV80 Dance and Hip-Hop series.",
      waveCount: 448,
      patchCount: 448,
      sampleWaves: [
        "Urban Sub 808",
        "Trap Snare Tight",
        "Vinyl Scratch FX",
        "Talkbox Synth Lead",
        "R&B Rhodes Smooth",
        "Lo-Fi Tape Piano",
        "Dirty Pluck Synth",
        "Phonk Memphis Cowbell"
      ],
      drumKits: [
        "SRX-08 Trap Bang",
        "SRX-08 Boom Bap",
        "SRX-08 Vinyl Hiphop",
        "SRX-08 R&B Modern"
      ],
      patches: [
        "Plat Saw Stack",
        "Dirty Reese",
        "Trap 808 Sub",
        "Dirty South Lead",
        "Vocal Chop Kit",
        "Vinyl HipHop",
        "West Coast Whistle",
        "Portamento Sine",
        "Distorted Club 808",
        "Auto-Tune Vox",
        "Urban Pad",
        "Crushed Beat",
        "Lo-Fi EP",
        "Scratch FX",
        "Stutter Gate",
        "Pitch Drop 808",
        "Subterfuge",
        "Club Banger",
        "Minimal Tech",
        "Deep Reese",
        "R&B Pluck",
        "Neo Soul Rhodes",
        "Mumble Bass",
        "Drill Sub 808",
        "Gliding 808",
        "Pluck Lead R&B",
        "Trap Horn Stabs",
        "Atlanta Brass",
        "Brass Hit Urban",
        "Vinyl Crackle",
        "Beat Box Voc",
        "Talkbox Lead",
        "Vocoder Chords",
        "Hip-Hop String",
        "Smooth Soul Pad",
        "Velvet Electric",
        "Tape Saturation",
        "Boom Bap Kit",
        "Trap Hi-Hat Roll",
        "808 Snare Clap"
      ]
    },
    {
      id: "SRX-09",
      name: "SRX-09 World Collection",
      category: "World & Ethnic",
      description: "Comprehensive world instruments from Asia, Africa, the Americas, Europe, and the Middle East.",
      waveCount: 414,
      patchCount: 414,
      sampleWaves: [
        "Sitar Drone & Pluck",
        "Koto Solo Japan",
        "Shakuhachi Breath",
        "Erhu Expressive",
        "Oud Middle East",
        "Ney Flute Arab",
        "Kalimba African",
        "Steel Drums Caribbean",
        "Bagpipes Scottish",
        "Celtic Harp Arp",
        "Berimbau Brazil",
        "Tabla Dayan/Bayan"
      ],
      drumKits: [
        "SRX-09 World Perc",
        "SRX-09 Latin Perc",
        "SRX-09 Asian Perc",
        "SRX-09 African Drums"
      ],
      patches: [
        "Sitar Gliss",
        "Erhu Expressive",
        "Koto Traditional",
        "Shakuhachi",
        "Pipa Solo",
        "Shamisen",
        "Berimbau",
        "Djembe Ensemble",
        "Kalimba Thumb",
        "Uilleann Pipes",
        "Celtic Bagpipe",
        "Bouzouki Trem",
        "Accordion Musette",
        "Bandoneon Tango",
        "Pan Flute Andean",
        "Steel Drums Calypso",
        "Balalaika",
        "Oud Solo",
        "Nay Flute",
        "Kanun Tremolo",
        "Tabla Tarang",
        "Gamelan Gong",
        "Angklung",
        "Cuica Samba",
        "Didgeridoo Drone",
        "Sitar & Tanpura",
        "Sarod Solo",
        "Shenai Indian",
        "Santur Dulcimer",
        "Bansuri Flute",
        "Indian Harmonium",
        "Dhol Drum",
        "Kanjira Perc",
        "Mridangam",
        "Guzheng Harp",
        "Yangqin Dulcimer",
        "Suona Horn",
        "Dizi Bamboo",
        "Xiao Flute",
        "Erhu Duo",
        "Hulusi Gourd",
        "Taiko Drum Ens",
        "Shamisen Pluck",
        "Koto Glissando",
        "Shakuhachi Bend",
        "Celtic Whistle",
        "Irish Fiddle",
        "Bodhran Drum",
        "Greek Bouzouki",
        "Turkish Baglama"
      ]
    },
    {
      id: "SRX-10",
      name: "SRX-10 Big Brass Ensemble",
      category: "Big Band & Brass",
      description: "Expressive solo brass, high-energy big band sections, trumpets, trombones, and saxophones.",
      waveCount: 100,
      patchCount: 100,
      sampleWaves: [
        "Big Band Fall-Off",
        "Big Band Shake Brass",
        "Trumpet Harmon Mute",
        "Trumpet Cup Mute",
        "Trombone Bucket Solo",
        "Alto Sax Solo Jazz",
        "Tenor Sax Growl",
        "Bari Sax Slap"
      ],
      patches: [
        "Big Band Brass",
        "Screamin' Tpts",
        "Fat Bones Sect",
        "Glenn Miller Saxes",
        "Fusion Horns",
        "Muted Big Band",
        "Hollywood Brass",
        "Brass Fall fff",
        "Trumpet Shake",
        "Cup Mute Bones",
        "Lead Alto Sax",
        "Maynard High Tpt",
        "Tower of Power",
        "Count Basie Sect",
        "Stan Kenton Hit",
        "Tight Funk Horns",
        "Broadway Brass",
        "French Horn Swell",
        "Big Band Tutti",
        "Basie Chords",
        "Ellington Horns",
        "Miller Moonlight",
        "Goodman Swing",
        "Dorsey Trombone",
        "Kenton Screamer",
        "Woody Herman",
        "Buddy Rich Brass",
        "Maynard High Lead",
        "Ferguson Lead",
        "Dizzy Bop Tpt",
        "Miles Harmon",
        "Chet Baker Mute",
        "Lee Morgan Brass",
        "Clifford Brown",
        "Freddie Hubbard",
        "Jaco Horns",
        "Blood Sweat Tears",
        "Chicago Horns",
        "Earth Wind Horns",
        "Tower Funk Horn",
        "Seawind Horns",
        "Brecker Brass",
        "Sanborn Alto",
        "Marienthal Sax",
        "Mintzer Tenor",
        "Mulligan Bari",
        "Getz Bossa Sax",
        "Coltrane Tenor",
        "Parker Bebop",
        "Hodges Warm Alto"
      ]
    },
    {
      id: "SRX-11",
      name: "SRX-11 Complete Piano",
      category: "Premium Acoustic Grand",
      description: "Exquisite 88-key stereo grand piano with multi-dynamic sampling and dedicated sympathetic string resonance.",
      waveCount: 42,
      patchCount: 42,
      sampleWaves: [
        "Comp Grand p L",
        "Comp Grand p R",
        "Comp Grand mf L",
        "Comp Grand mf R",
        "Comp Grand f L",
        "Comp Grand f R",
        "Comp Grand ff L",
        "Comp Grand ff R",
        "Comp Key-Off Click",
        "Comp Damper Pedal Noise"
      ],
      patches: [
        "Complete Grand",
        "Concert Hall Pno",
        "Studio Session Pno",
        "Intimate Upright",
        "Bright Pop Grand",
        "Warm Ballad Pno",
        "Classical Recital",
        "Dark Solo Piano",
        "Modern Stage Pno",
        "Rich European",
        "Jazz Club Grand",
        "Honky Tonk Saloon",
        "Piano & String Pad",
        "Mono Stage Grand",
        "Compressed Rock Pno",
        "Ambient Grand",
        "Chamber Recital",
        "Grandioso Pno",
        "Mellow Grand",
        "New Age Grand",
        "Balladeer Pno",
        "Singer Songwriter",
        "Pop Comp Grand",
        "Studio Rocker",
        "Heavy Comp Pno",
        "Bright Stage Pno",
        "Saloon Piano",
        "Old Upright",
        "Living Room Pno",
        "Tack Piano Bar",
        "Piano & Vox Pad",
        "Piano & Warm Str",
        "Piano & Orchestr",
        "Chorus Grand Pno",
        "Flange Concert",
        "Tremolo Grand",
        "Rotary Concert",
        "Mono Tracking 1",
        "Mono Tracking 2",
        "Mono Pop Grand",
        "Mono Classical",
        "Comp Piano FX"
      ]
    },
    {
      id: "SRX-12",
      name: "SRX-12 Classic E-Pianos",
      category: "Classic Electric Pianos",
      description: "Painstakingly recorded multi-velocity Fender Rhodes, Wurlitzer, and Hohner Clavinet electric keyboards.",
      waveCount: 50,
      patchCount: 50,
      sampleWaves: [
        "Classic Rhodes 73 p",
        "Classic Rhodes 73 mf",
        "Classic Rhodes 73 f",
        "Classic Rhodes 73 ff",
        "Classic Wurly 200 p",
        "Classic Wurly 200 f",
        "Classic Clavinet CA",
        "Classic Clavinet CB",
        "Classic Clavinet DA",
        "Classic Clavinet DB",
        "EP Release Transient"
      ],
      patches: [
        "Pure Suitcase",
        "Stage 73 Pure",
        "1975 Wurly",
        "Dyna Clavinet",
        "Chorus Rhodes",
        "Tremolo Wurly",
        "Phase EP 73",
        "Distorted Wurly",
        "Wah Wah Clav",
        "Mellow Suitcase",
        "Bright Stage",
        "Overdriven Rhodes",
        "Vintage Clav C",
        "Pianet Classic",
        "Ambient EP Space",
        "Rhodes 73 Suitcase",
        "Rhodes 73 Stage",
        "Rhodes 88 Stage",
        "Rhodes Dyno My",
        "Rhodes Tremolo",
        "Rhodes Phaser",
        "Rhodes Chorus",
        "Rhodes Overdrive",
        "Rhodes Wah",
        "Rhodes Stereo Pan",
        "Wurly 200 Classic",
        "Wurly 200 Trem",
        "Wurly 200 Dist",
        "Wurly 200 Wah",
        "Wurly 200 Chorus",
        "Wurly 200 Phase",
        "Clavinet D6 Clean",
        "Clavinet D6 Mute",
        "Clavinet D6 Pluck",
        "Clavinet D6 Wah",
        "Clavinet D6 Auto",
        "Clavinet D6 Phase",
        "Clavinet D6 Drive",
        "Pianet T Classic",
        "Pianet T Trem",
        "Pianet T Drive",
        "R&B Suitcase",
        "Neo Soul Stage",
        "Fusion Rhodes",
        "70s Rock Wurly",
        "Funk Clavinet",
        "Motown Clav",
        "Stevie Wah Clav",
        "Supertramp Wurly",
        "Ray Charles Wurly"
      ]
    }
  ];
  function getSrxBoard(boardId) {
    if (!boardId || boardId === "NONE") return null;
    return SRX_BOARDS.find((b) => b.id.toUpperCase() === boardId.toUpperCase()) || null;
  }
  function getSrxWaveforms(boardId) {
    const board = getSrxBoard(boardId);
    if (!board) return [];
    const waves = [];
    const sampleCount = board.sampleWaves.length;
    for (let i = 1; i <= board.waveCount; i++) {
      if (i <= sampleCount) {
        waves.push(`${board.id}: ${String(i).padStart(3, "0")} ${board.sampleWaves[i - 1]}`);
      } else {
        waves.push(`${board.id}: ${String(i).padStart(3, "0")} ${board.category} Wave ${i}`);
      }
    }
    return waves;
  }
  function getSrxPatches(boardId) {
    const board = getSrxBoard(boardId);
    if (!board) return [];
    const patchesList = board.patches || board.samplePatches || [];
    const count = board.patchCount || patchesList.length || 128;
    const result = [];
    for (let i = 1; i <= count; i++) {
      const pName = patchesList[i - 1] || `${board.category} ${i}`;
      result.push(`${board.id}: ${String(i).padStart(3, "0")} ${pName}`);
    }
    return result;
  }

  // src/scale_tune.js
  var SCALE_TEMPERAMENTS = {
    equal: {
      name: "Equal Temperament",
      description: "Modern standard 12-TET division (0 cents on all notes).",
      offsets: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]
    },
    justMajor: {
      name: "Just Intonation (Major C)",
      description: "Acoustically pure natural harmonics for major triads in key of C.",
      offsets: [0, -14, 4, 16, -14, -2, -10, 2, 14, -16, -4, -12]
    },
    justMinor: {
      name: "Just Intonation (Minor C)",
      description: "Acoustically pure natural harmonics for minor triads in key of C.",
      offsets: [0, 16, 4, 16, -14, -2, 16, 2, 14, -16, 18, -12]
    },
    pythagorean: {
      name: "Pythagorean Scale",
      description: "Ancient Greek temperament based on a sequence of pure 3:2 fifths.",
      offsets: [0, -10, 4, -6, 8, -2, 6, 2, -8, 6, -4, 10]
    },
    meantone: {
      name: "Meantone (1/4 Comma)",
      description: "Renaissance tuning with pure major thirds, popular in early keyboard music.",
      offsets: [0, -24, -7, 10, -14, 3, -21, -3, -27, -10, 7, -17]
    },
    werckmeister: {
      name: "Werckmeister III",
      description: "Baroque well-tempered tuning designed by Andreas Werckmeister (1691).",
      offsets: [0, -10, -8, -6, -10, -2, -8, -4, -8, -10, -4, -8]
    },
    kirnberger: {
      name: "Kirnberger III",
      description: "Johann Kirnberger well-temperament (1779) creating varied key characters.",
      offsets: [0, -10, -7, -6, -14, -2, -10, -3, -8, -10, -4, -12]
    },
    arabicRast: {
      name: "Arabic Quarter-Tone (Rast)",
      description: "Traditional Middle Eastern Maqam with neutral quarter-tones on E and B (-50 cents).",
      offsets: [0, 0, 0, 0, -50, 0, 0, 0, 0, 0, 0, -50]
    },
    arabicBayati: {
      name: "Arabic Quarter-Tone (Bayati)",
      description: "Traditional Middle Eastern Maqam with neutral quarter-tones on E (-50 cents).",
      offsets: [0, 0, 0, 0, -50, 0, 0, 0, 0, 0, 0, 0]
    }
  };
  function getPartScaleTuneAddress(partNumber) {
    if (partNumber < 1 || partNumber > 16) {
      throw new Error(`Part number must be 1-16, got ${partNumber}`);
    }
    return [16, 0, 16 + (partNumber - 1), 64];
  }
  function centsToRaw(cents) {
    const clamped = Math.max(-64, Math.min(63, Math.round(cents)));
    return clamped + 64;
  }
  function buildPartScaleTemperamentDT1(deviceId, partNumber, offsetsInCents) {
    if (!offsetsInCents || offsetsInCents.length !== 12) {
      throw new Error(`Must provide exactly 12 note offsets in cents`);
    }
    const addr = getPartScaleTuneAddress(partNumber);
    const data = offsetsInCents.map((c) => centsToRaw(c));
    return buildDT1(addr, data, deviceId);
  }

  // src/rhythm.js
  var DRUM_KEY_MAP = {
    35: { note: "B1", name: "Acoustic Bass Drum", category: "Kick", octave: 1, defaultMute: 0 },
    36: { note: "C2", name: "Bass Drum 1", category: "Kick", octave: 1, defaultMute: 0 },
    37: { note: "C#2", name: "Side Stick", category: "Snare", octave: 1, defaultMute: 0 },
    38: { note: "D2", name: "Acoustic Snare", category: "Snare", octave: 1, defaultMute: 0 },
    39: { note: "D#2", name: "Hand Clap", category: "Snare", octave: 1, defaultMute: 0 },
    40: { note: "E2", name: "Electric Snare", category: "Snare", octave: 1, defaultMute: 0 },
    41: { note: "F2", name: "Low Floor Tom", category: "Tom", octave: 1, defaultMute: 0 },
    42: { note: "F#2", name: "Closed Hi-Hat", category: "Hi-Hat", octave: 1, defaultMute: 1 },
    43: { note: "G2", name: "High Floor Tom", category: "Tom", octave: 1, defaultMute: 0 },
    44: { note: "G#2", name: "Pedal Hi-Hat", category: "Hi-Hat", octave: 1, defaultMute: 1 },
    45: { note: "A2", name: "Low Tom", category: "Tom", octave: 1, defaultMute: 0 },
    46: { note: "A#2", name: "Open Hi-Hat", category: "Hi-Hat", octave: 1, defaultMute: 1 },
    47: { note: "B2", name: "Low-Mid Tom", category: "Tom", octave: 2, defaultMute: 0 },
    48: { note: "C3", name: "Hi-Mid Tom", category: "Tom", octave: 2, defaultMute: 0 },
    49: { note: "C#3", name: "Crash Cymbal 1", category: "Cymbal", octave: 2, defaultMute: 0 },
    50: { note: "D3", name: "High Tom", category: "Tom", octave: 2, defaultMute: 0 },
    51: { note: "D#3", name: "Ride Cymbal 1", category: "Cymbal", octave: 2, defaultMute: 0 },
    52: { note: "E3", name: "Chinese Cymbal", category: "Cymbal", octave: 2, defaultMute: 0 },
    53: { note: "F3", name: "Ride Bell", category: "Cymbal", octave: 2, defaultMute: 0 },
    54: { note: "F#3", name: "Tambourine", category: "Perc", octave: 2, defaultMute: 0 },
    55: { note: "G3", name: "Splash Cymbal", category: "Cymbal", octave: 2, defaultMute: 0 },
    56: { note: "G#3", name: "Cowbell", category: "Perc", octave: 2, defaultMute: 0 },
    57: { note: "A3", name: "Crash Cymbal 2", category: "Cymbal", octave: 2, defaultMute: 0 },
    58: { note: "A#3", name: "Vibra-Slap", category: "Perc", octave: 2, defaultMute: 0 },
    59: { note: "B3", name: "Ride Cymbal 2", category: "Cymbal", octave: 3, defaultMute: 0 },
    60: { note: "C4", name: "High Bongo", category: "Latin", octave: 3, defaultMute: 0 },
    61: { note: "C#4", name: "Low Bongo", category: "Latin", octave: 3, defaultMute: 0 },
    62: { note: "D4", name: "Mute High Conga", category: "Latin", octave: 3, defaultMute: 2 },
    63: { note: "D#4", name: "Open High Conga", category: "Latin", octave: 3, defaultMute: 2 },
    64: { note: "E4", name: "Low Conga", category: "Latin", octave: 3, defaultMute: 2 },
    65: { note: "F4", name: "High Timbale", category: "Latin", octave: 3, defaultMute: 0 },
    66: { note: "F#4", name: "Low Timbale", category: "Latin", octave: 3, defaultMute: 0 },
    67: { note: "G4", name: "High Agogo", category: "Latin", octave: 3, defaultMute: 0 },
    68: { note: "G#4", name: "Low Agogo", category: "Latin", octave: 3, defaultMute: 0 },
    69: { note: "A4", name: "Cabasa", category: "Latin", octave: 3, defaultMute: 0 },
    70: { note: "A#4", name: "Maracas", category: "Latin", octave: 3, defaultMute: 0 },
    71: { note: "B4", name: "Short Whistle", category: "Latin", octave: 4, defaultMute: 3 },
    72: { note: "C5", name: "Long Whistle", category: "Latin", octave: 4, defaultMute: 3 },
    73: { note: "C#5", name: "Short Guiro", category: "Latin", octave: 4, defaultMute: 4 },
    74: { note: "D5", name: "Long Guiro", category: "Latin", octave: 4, defaultMute: 4 },
    75: { note: "D#5", name: "Claves", category: "Latin", octave: 4, defaultMute: 0 },
    76: { note: "E5", name: "High Wood Block", category: "Perc", octave: 4, defaultMute: 0 },
    77: { note: "F5", name: "Low Wood Block", category: "Perc", octave: 4, defaultMute: 0 },
    78: { note: "F#5", name: "Mute Cuica", category: "Latin", octave: 4, defaultMute: 5 },
    79: { note: "G5", name: "Open Cuica", category: "Latin", octave: 4, defaultMute: 5 },
    80: { note: "G#5", name: "Mute Triangle", category: "Perc", octave: 4, defaultMute: 6 },
    81: { note: "A5", name: "Open Triangle", category: "Perc", octave: 4, defaultMute: 6 },
    82: { note: "A#5", name: "Shaker", category: "Perc", octave: 4, defaultMute: 0 },
    83: { note: "B5", name: "Jingle Bell", category: "Perc", octave: 5, defaultMute: 0 },
    84: { note: "C6", name: "Bell Tree", category: "Perc", octave: 5, defaultMute: 0 },
    85: { note: "C#6", name: "Castanets", category: "Perc", octave: 5, defaultMute: 0 },
    86: { note: "D6", name: "Mute Surdo", category: "Latin", octave: 5, defaultMute: 7 },
    87: { note: "D#6", name: "Open Surdo", category: "Latin", octave: 5, defaultMute: 7 },
    88: { note: "E6", name: "Applause", category: "FX", octave: 5, defaultMute: 0 },
    89: { note: "F6", name: "Gunshot", category: "FX", octave: 5, defaultMute: 0 },
    90: { note: "F#6", name: "Laser Gun", category: "FX", octave: 5, defaultMute: 0 },
    91: { note: "G6", name: "Siren", category: "FX", octave: 5, defaultMute: 0 },
    92: { note: "G#6", name: "Starship", category: "FX", octave: 5, defaultMute: 0 },
    93: { note: "A6", name: "Car Engine", category: "FX", octave: 5, defaultMute: 0 },
    94: { note: "A#6", name: "Car Stop", category: "FX", octave: 5, defaultMute: 0 },
    95: { note: "B6", name: "Car Pass", category: "FX", octave: 5, defaultMute: 0 },
    96: { note: "C7", name: "Car Crash", category: "FX", octave: 5, defaultMute: 0 },
    97: { note: "C#7", name: "Bubble", category: "FX", octave: 5, defaultMute: 0 },
    98: { note: "D7", name: "Dog Bark", category: "FX", octave: 5, defaultMute: 0 }
  };
  var DRUM_OCTAVES = [
    { octave: 1, label: "Octave 1: Kicks, Snares & Hats (B1 - A#2)", notes: [35, 36, 37, 38, 39, 40, 41, 42, 43, 44, 45, 46] },
    { octave: 2, label: "Octave 2: Toms & Cymbals (B2 - A#3)", notes: [47, 48, 49, 50, 51, 52, 53, 54, 55, 56, 57, 58] },
    { octave: 3, label: "Octave 3: Bongos & Congas (B3 - A#4)", notes: [59, 60, 61, 62, 63, 64, 65, 66, 67, 68, 69, 70] },
    { octave: 4, label: "Octave 4: Latin Percussion (B4 - A#5)", notes: [71, 72, 73, 74, 75, 76, 77, 78, 79, 80, 81, 82] },
    { octave: 5, label: "Octave 5: Bells, Surdos & FX (B5 - D7)", notes: [83, 84, 85, 86, 87, 88, 89, 90, 91, 92, 93, 94, 95, 96, 97, 98] }
  ];
  var DRUM_HIT_LIBRARY = [
    // --- KICKS ---
    {
      id: "kick_acoustic_studio",
      name: "Acoustic Studio Kick",
      category: "Kick",
      waveGroup: 0,
      waveNumber: 722,
      // Dry Kick
      coarseTune: 64,
      fineTune: 64,
      filterType: 1,
      cutoff: 127,
      resonance: 0,
      level: 127,
      pan: 64,
      muteGroup: 0,
      tvaDecay: 70,
      tvaRelease: 25,
      chorusSend: 0,
      reverbSend: 35
    },
    {
      id: "kick_808_sub",
      name: "808 Sub Boom Kick",
      category: "Kick",
      waveGroup: 0,
      waveNumber: 743,
      // 808 Kick
      coarseTune: 58,
      fineTune: 64,
      filterType: 1,
      cutoff: 105,
      resonance: 15,
      level: 127,
      pan: 64,
      muteGroup: 0,
      tvaDecay: 90,
      tvaRelease: 45,
      chorusSend: 0,
      reverbSend: 15
    },
    {
      id: "kick_909_dance",
      name: "909 Punch Dance Kick",
      category: "Kick",
      waveGroup: 0,
      waveNumber: 744,
      // 909 Kick 1
      coarseTune: 64,
      fineTune: 64,
      filterType: 1,
      cutoff: 127,
      resonance: 5,
      level: 127,
      pan: 64,
      muteGroup: 0,
      tvaDecay: 65,
      tvaRelease: 20,
      chorusSend: 0,
      reverbSend: 20
    },
    {
      id: "kick_rock_punch",
      name: "Rock Heavy Punch Kick",
      category: "Kick",
      waveGroup: 0,
      waveNumber: 726,
      // Rock Kick f
      coarseTune: 63,
      fineTune: 64,
      filterType: 1,
      cutoff: 127,
      resonance: 0,
      level: 127,
      pan: 64,
      muteGroup: 0,
      tvaDecay: 62,
      tvaRelease: 20,
      chorusSend: 0,
      reverbSend: 45
    },
    {
      id: "kick_jazz_warm",
      name: "Warm Jazz Kick",
      category: "Kick",
      waveGroup: 0,
      waveNumber: 730,
      // Jazz Kick
      coarseTune: 65,
      fineTune: 64,
      filterType: 1,
      cutoff: 95,
      resonance: 0,
      level: 118,
      pan: 64,
      muteGroup: 0,
      tvaDecay: 55,
      tvaRelease: 18,
      chorusSend: 0,
      reverbSend: 50
    },
    // --- SNARES ---
    {
      id: "snare_acoustic_birch",
      name: "Acoustic Birch Snare",
      category: "Snare",
      waveGroup: 0,
      waveNumber: 682,
      // Rock Rim f L
      coarseTune: 64,
      fineTune: 64,
      filterType: 1,
      cutoff: 127,
      resonance: 0,
      level: 125,
      pan: 64,
      muteGroup: 0,
      tvaDecay: 65,
      tvaRelease: 25,
      chorusSend: 0,
      reverbSend: 40
    },
    {
      id: "snare_808_crisp",
      name: "808 Crisp Snare",
      category: "Snare",
      waveGroup: 0,
      waveNumber: 709,
      // 808 SN
      coarseTune: 64,
      fineTune: 64,
      filterType: 1,
      cutoff: 127,
      resonance: 10,
      level: 127,
      pan: 64,
      muteGroup: 0,
      tvaDecay: 60,
      tvaRelease: 22,
      chorusSend: 0,
      reverbSend: 25
    },
    {
      id: "snare_909_power",
      name: "909 Power Snare",
      category: "Snare",
      waveGroup: 0,
      waveNumber: 707,
      // 909 SN 1
      coarseTune: 64,
      fineTune: 64,
      filterType: 1,
      cutoff: 127,
      resonance: 0,
      level: 127,
      pan: 64,
      muteGroup: 0,
      tvaDecay: 70,
      tvaRelease: 25,
      chorusSend: 0,
      reverbSend: 35
    },
    {
      id: "snare_piccolo_crack",
      name: "Piccolo Rimshot Crack",
      category: "Snare",
      waveGroup: 0,
      waveNumber: 678,
      // Rock Rim p L
      coarseTune: 68,
      fineTune: 70,
      filterType: 1,
      cutoff: 127,
      resonance: 12,
      level: 125,
      pan: 64,
      muteGroup: 0,
      tvaDecay: 50,
      tvaRelease: 18,
      chorusSend: 0,
      reverbSend: 30
    },
    {
      id: "snare_clap_vintage",
      name: "Vintage Hand Clap",
      category: "Snare",
      waveGroup: 0,
      waveNumber: 709,
      // Clap
      coarseTune: 64,
      fineTune: 64,
      filterType: 1,
      cutoff: 120,
      resonance: 5,
      level: 120,
      pan: 68,
      muteGroup: 0,
      tvaDecay: 55,
      tvaRelease: 30,
      chorusSend: 20,
      reverbSend: 50
    },
    {
      id: "snare_side_stick",
      name: "Studio Side Stick",
      category: "Snare",
      waveGroup: 0,
      waveNumber: 695,
      // Jazz Rim p L
      coarseTune: 64,
      fineTune: 64,
      filterType: 1,
      cutoff: 127,
      resonance: 0,
      level: 115,
      pan: 64,
      muteGroup: 0,
      tvaDecay: 45,
      tvaRelease: 15,
      chorusSend: 0,
      reverbSend: 25
    },
    // --- HI-HATS ---
    {
      id: "hat_closed_tight",
      name: "Tight Closed Hat",
      category: "Hi-Hat",
      waveGroup: 0,
      waveNumber: 788,
      // Cl HiHat 1
      coarseTune: 64,
      fineTune: 64,
      filterType: 1,
      cutoff: 127,
      resonance: 0,
      level: 120,
      pan: 56,
      muteGroup: 1,
      tvaDecay: 40,
      tvaRelease: 15,
      chorusSend: 0,
      reverbSend: 15
    },
    {
      id: "hat_open_sizzle",
      name: "Sizzle Open Hat",
      category: "Hi-Hat",
      waveGroup: 0,
      waveNumber: 798,
      // Op HiHat
      coarseTune: 64,
      fineTune: 64,
      filterType: 1,
      cutoff: 127,
      resonance: 0,
      level: 125,
      pan: 58,
      muteGroup: 1,
      tvaDecay: 85,
      tvaRelease: 45,
      chorusSend: 0,
      reverbSend: 30
    },
    {
      id: "hat_pedal_chick",
      name: "Pedal Hat Chick",
      category: "Hi-Hat",
      waveGroup: 0,
      waveNumber: 804,
      // Pedal HiHat
      coarseTune: 64,
      fineTune: 64,
      filterType: 1,
      cutoff: 127,
      resonance: 0,
      level: 110,
      pan: 54,
      muteGroup: 1,
      tvaDecay: 35,
      tvaRelease: 15,
      chorusSend: 0,
      reverbSend: 20
    },
    {
      id: "hat_909_crisp",
      name: "909 Metallic Hat",
      category: "Hi-Hat",
      waveGroup: 0,
      waveNumber: 807,
      // 909 NZ HiHat
      coarseTune: 66,
      fineTune: 64,
      filterType: 1,
      cutoff: 127,
      resonance: 8,
      level: 122,
      pan: 56,
      muteGroup: 1,
      tvaDecay: 48,
      tvaRelease: 18,
      chorusSend: 0,
      reverbSend: 20
    },
    // --- TOMS ---
    {
      id: "tom_acoustic_floor",
      name: "Acoustic Low Floor Tom",
      category: "Tom",
      waveGroup: 0,
      waveNumber: 746,
      // Rock TomL1 p
      coarseTune: 56,
      fineTune: 64,
      filterType: 1,
      cutoff: 127,
      resonance: 0,
      level: 127,
      pan: 72,
      muteGroup: 0,
      tvaDecay: 75,
      tvaRelease: 28,
      chorusSend: 0,
      reverbSend: 40
    },
    {
      id: "tom_acoustic_mid",
      name: "Acoustic Mid Rack Tom",
      category: "Tom",
      waveGroup: 0,
      waveNumber: 747,
      // Rock TomL2 p
      coarseTune: 62,
      fineTune: 64,
      filterType: 1,
      cutoff: 127,
      resonance: 0,
      level: 125,
      pan: 60,
      muteGroup: 0,
      tvaDecay: 70,
      tvaRelease: 25,
      chorusSend: 0,
      reverbSend: 38
    },
    {
      id: "tom_acoustic_high",
      name: "Acoustic High Tom",
      category: "Tom",
      waveGroup: 0,
      waveNumber: 747,
      coarseTune: 68,
      fineTune: 64,
      filterType: 1,
      cutoff: 127,
      resonance: 0,
      level: 124,
      pan: 52,
      muteGroup: 0,
      tvaDecay: 65,
      tvaRelease: 22,
      chorusSend: 0,
      reverbSend: 38
    },
    // --- CYMBALS ---
    {
      id: "cymbal_studio_crash",
      name: 'Studio Crash 16"',
      category: "Cymbal",
      waveGroup: 0,
      waveNumber: 638,
      // Crash
      coarseTune: 64,
      fineTune: 64,
      filterType: 1,
      cutoff: 127,
      resonance: 0,
      level: 127,
      pan: 48,
      muteGroup: 0,
      tvaDecay: 100,
      tvaRelease: 65,
      chorusSend: 0,
      reverbSend: 45
    },
    {
      id: "cymbal_ride_bell",
      name: "Ride Cymbal Bell",
      category: "Cymbal",
      waveGroup: 0,
      waveNumber: 638,
      coarseTune: 69,
      fineTune: 64,
      filterType: 1,
      cutoff: 127,
      resonance: 0,
      level: 125,
      pan: 76,
      muteGroup: 0,
      tvaDecay: 90,
      tvaRelease: 50,
      chorusSend: 0,
      reverbSend: 40
    },
    // --- LATIN & PERCUSSION ---
    {
      id: "perc_bongo_high",
      name: "High Bongo Slap",
      category: "Latin",
      waveGroup: 0,
      waveNumber: 485,
      coarseTune: 72,
      fineTune: 64,
      filterType: 1,
      cutoff: 127,
      resonance: 0,
      level: 120,
      pan: 56,
      muteGroup: 0,
      tvaDecay: 45,
      tvaRelease: 18,
      chorusSend: 0,
      reverbSend: 30
    },
    {
      id: "perc_conga_open",
      name: "Open High Conga",
      category: "Latin",
      waveGroup: 0,
      waveNumber: 485,
      coarseTune: 64,
      fineTune: 64,
      filterType: 1,
      cutoff: 127,
      resonance: 0,
      level: 122,
      pan: 68,
      muteGroup: 2,
      tvaDecay: 60,
      tvaRelease: 25,
      chorusSend: 0,
      reverbSend: 35
    },
    {
      id: "perc_cowbell_mambo",
      name: "Mambo Cowbell",
      category: "Perc",
      waveGroup: 0,
      waveNumber: 503,
      // JD Cowbell
      coarseTune: 64,
      fineTune: 64,
      filterType: 1,
      cutoff: 127,
      resonance: 0,
      level: 120,
      pan: 60,
      muteGroup: 0,
      tvaDecay: 50,
      tvaRelease: 20,
      chorusSend: 0,
      reverbSend: 30
    },
    // --- SOUND FX ---
    {
      id: "fx_vinyl_scratch",
      name: "Vinyl Scratch FX",
      category: "FX",
      waveGroup: 0,
      waveNumber: 588,
      // Scratch 1
      coarseTune: 64,
      fineTune: 64,
      filterType: 1,
      cutoff: 127,
      resonance: 0,
      level: 127,
      pan: 64,
      muteGroup: 0,
      tvaDecay: 55,
      tvaRelease: 20,
      chorusSend: 15,
      reverbSend: 20
    }
  ];
  function getRhythmKeyAddress(noteNumber, isPerformanceMode = true) {
    if (noteNumber < 21 || noteNumber > 108) {
      throw new Error(`Rhythm key note must be 21-108, got ${noteNumber}`);
    }
    const base = isPerformanceMode ? [20, 112, 0, 0] : [16, 0, 64, 0];
    const totalOffset = 2048 + (noteNumber - 21) * 256;
    return addOffset(base, totalOffset);
  }
  var RHYTHM_KEY_OFFSETS = {
    ASSIGN_TYPE: 12,
    // 0: MULTI, 1: SINGLE
    MUTE_GROUP: 13,
    // 0: OFF, 1-31
    LEVEL: 14,
    // 0-127
    COARSE_TUNE: 15,
    // 0-127 (C-1 to G9, center 64 = C4)
    FINE_TUNE: 16,
    // 14-114 (-50 to +50 cents, center 64)
    RANDOM_PITCH: 17,
    // 0-30
    PAN: 18,
    // 0-127 (L64 - 63R)
    ENV_MODE: 21,
    // 0: NO-SUS, 1: SUSTAIN
    DRY_LEVEL: 22,
    // 0-127
    CHORUS_SEND: 23,
    // 0-127
    REVERB_SEND: 24,
    // 0-127
    OUTPUT_ASSIGN: 27,
    // 0: MFX, 1: A, 2: B, etc.
    WAVE_GROUP: 34,
    // 0: INT, 1: SR-JV80, 2: SRX, 3: SAMPLE
    WAVE_NUMBER_L: 39,
    // 4-nibble (0-16384)
    WAVE_NUMBER_R: 43,
    // 4-nibble (0-16384)
    WAVE_GAIN: 47,
    // 0: -6dB, 1: 0dB, 2: +6dB, 3: +12dB
    TVF_TYPE: 62,
    // 0: OFF, 1: LPF, 2: BPF, 3: HPF, 4: PKG
    TVF_CUTOFF: 63,
    // 0-127
    TVF_RESONANCE: 64,
    // 0-127
    TVA_DECAY: 72,
    // 0-127
    TVA_RELEASE: 74
    // 0-127
  };
  function buildRhythmKeyDT1(deviceId, noteNumber, paramOffset, value, isPerformanceMode = true) {
    const keyBase = getRhythmKeyAddress(noteNumber, isPerformanceMode);
    const addr = addOffset(keyBase, paramOffset);
    const data = Array.isArray(value) ? value : [value];
    return buildDT1(addr, data, deviceId);
  }
  async function sendRhythmKeyParam(midi2, noteNumber, paramOffset, value, isPerformanceMode = true) {
    const msg = buildRhythmKeyDT1(midi2.deviceId, noteNumber, paramOffset, value, isPerformanceMode);
    await midi2.sendSysEx(msg);
  }
  function encodeWaveNibbles(num) {
    return [
      num >> 12 & 15,
      num >> 8 & 15,
      num >> 4 & 15,
      num & 15
    ];
  }

  // src/mutator.js
  function mutateVal(current, min, max, intensity, bipolar = false) {
    const range = max - min;
    const delta = (Math.random() * 2 - 1) * range * intensity;
    let next = Math.round(current + delta);
    return Math.max(min, Math.min(max, next));
  }
  function mutatePatch(sourcePatch, intensity = 0.2, archetypeId = "general", locks = {}) {
    const patch = JSON.parse(JSON.stringify(sourcePatch));
    if (!patch.common) patch.common = {};
    if (!patch.tmt) patch.tmt = {};
    if (!patch.tones) patch.tones = {};
    const totalWaves = INTERNAL_WAVEFORMS.length || 1083;
    if (archetypeId === "ambient_pad") {
      patch.common.monoPoly = 1;
      patch.common.legato = 0;
      if (!locks.lockEffects) {
        patch.common.chorusSend = mutateVal(patch.common.chorusSend || 40, 50, 100, intensity);
        patch.common.reverbSend = mutateVal(patch.common.reverbSend || 60, 60, 110, intensity);
      }
    } else if (archetypeId === "reese_bass") {
      patch.common.monoPoly = 0;
      patch.common.legato = 1;
      if (!locks.lockEffects) {
        patch.common.reverbSend = mutateVal(patch.common.reverbSend || 10, 0, 30, intensity);
      }
    } else if (archetypeId === "poly_pluck") {
      patch.common.monoPoly = 1;
      patch.common.legato = 0;
    }
    if (!locks.lockFilters && !locks.lockWaveforms) {
      if (Math.random() < intensity) {
        if (archetypeId === "evolving_texture" || archetypeId === "scifi_glitch") {
          patch.tmt.struct12 = Math.floor(Math.random() * 10);
          patch.tmt.booster12 = Math.min(3, Math.floor(Math.random() * 4));
        } else {
          patch.tmt.struct12 = Math.random() < 0.7 ? 0 : 1;
          patch.tmt.booster12 = 0;
        }
      }
    }
    for (let t = 1; t <= 4; t++) {
      const tone = patch.tones[t] || {};
      if (!locks.lockTuning) {
        if (t === 1) {
          tone.level = mutateVal(tone.level !== void 0 ? tone.level : 127, 90, 127, intensity);
          tone.coarseTune = 64;
          tone.fineTune = mutateVal(tone.fineTune !== void 0 ? tone.fineTune : 64, 60, 68, intensity);
        } else if (t === 2) {
          tone.level = mutateVal(tone.level !== void 0 ? tone.level : 110, 60, 127, intensity);
          tone.fineTune = mutateVal(tone.fineTune !== void 0 ? tone.fineTune : 64, 52, 76, intensity);
          if (archetypeId === "reese_bass") {
            tone.coarseTune = Math.random() < 0.3 ? 52 : 64;
          }
        } else if (t === 3 || t === 4) {
          tone.level = mutateVal(tone.level !== void 0 ? tone.level : 80, 0, 115, intensity);
          tone.fineTune = mutateVal(tone.fineTune !== void 0 ? tone.fineTune : 64, 45, 83, intensity);
        }
      }
      if (!locks.lockWaveforms) {
        if (Math.random() < intensity) {
          if (archetypeId === "ambient_pad") {
            tone.waveNumberL = mutateVal(tone.waveNumberL || 400, 300, 600, intensity);
          } else if (archetypeId === "reese_bass") {
            tone.waveNumberL = mutateVal(tone.waveNumberL || 200, 150, 320, intensity);
          } else if (archetypeId === "vintage_keys") {
            tone.waveNumberL = mutateVal(tone.waveNumberL || 50, 1, 160, intensity);
          } else {
            tone.waveNumberL = mutateVal(tone.waveNumberL || 1, 1, totalWaves, intensity);
          }
          tone.waveGain = Math.min(2, Math.floor(Math.random() * 3));
        }
      }
      if (!locks.lockFilters) {
        if (archetypeId === "ambient_pad") {
          tone.filterType = 1;
          tone.cutoff = mutateVal(tone.cutoff || 65, 45, 95, intensity);
          tone.resonance = mutateVal(tone.resonance || 20, 5, 45, intensity);
        } else if (archetypeId === "reese_bass") {
          tone.filterType = 5;
          tone.cutoff = mutateVal(tone.cutoff || 55, 30, 80, intensity);
          tone.resonance = mutateVal(tone.resonance || 40, 20, 85, intensity);
        } else if (archetypeId === "poly_pluck") {
          tone.filterType = 1;
          tone.cutoff = mutateVal(tone.cutoff || 40, 20, 65, intensity);
          tone.resonance = mutateVal(tone.resonance || 35, 15, 60, intensity);
        } else {
          tone.cutoff = mutateVal(tone.cutoff !== void 0 ? tone.cutoff : 100, 20, 127, intensity);
          tone.resonance = mutateVal(tone.resonance !== void 0 ? tone.resonance : 10, 0, 110, intensity);
        }
      }
      if (!locks.lockEnvelopes) {
        if (archetypeId === "ambient_pad") {
          tone.tvaEnvT1 = mutateVal(tone.tvaEnvT1 || 50, 35, 85, intensity);
          tone.tvaEnvT4 = mutateVal(tone.tvaEnvT4 || 60, 45, 95, intensity);
          tone.tvaEnvL3 = mutateVal(tone.tvaEnvL3 || 90, 70, 127, intensity);
          tone.tvfEnvT1 = mutateVal(tone.tvfEnvT1 || 40, 25, 75, intensity);
          tone.tvfEnvT2 = mutateVal(tone.tvfEnvT2 || 60, 40, 90, intensity);
          tone.tvfEnvL3 = mutateVal(tone.tvfEnvL3 || 80, 50, 110, intensity);
          tone.tvfEnvT4 = mutateVal(tone.tvfEnvT4 || 60, 40, 95, intensity);
        } else if (archetypeId === "poly_pluck") {
          tone.tvaEnvT1 = mutateVal(tone.tvaEnvT1 || 2, 0, 8, intensity);
          tone.tvaEnvT2 = mutateVal(tone.tvaEnvT2 || 35, 20, 55, intensity);
          tone.tvaEnvL3 = 0;
          tone.tvaEnvT4 = mutateVal(tone.tvaEnvT4 || 25, 10, 45, intensity);
          tone.tvfEnvT1 = 0;
          tone.tvfEnvT2 = mutateVal(tone.tvfEnvT2 || 30, 15, 50, intensity);
          tone.tvfEnvL3 = 0;
          tone.tvfEnvT4 = mutateVal(tone.tvfEnvT4 || 20, 10, 40, intensity);
        } else if (archetypeId === "reese_bass") {
          tone.tvaEnvT1 = 0;
          tone.tvaEnvL3 = 110;
          tone.tvaEnvT4 = mutateVal(tone.tvaEnvT4 || 20, 10, 35, intensity);
          tone.tvfEnvT1 = mutateVal(tone.tvfEnvT1 || 5, 0, 15, intensity);
          tone.tvfEnvT2 = mutateVal(tone.tvfEnvT2 || 50, 30, 70, intensity);
          tone.tvfEnvL3 = mutateVal(tone.tvfEnvL3 || 40, 20, 70, intensity);
        } else {
          tone.tvaEnvT1 = mutateVal(tone.tvaEnvT1 !== void 0 ? tone.tvaEnvT1 : 10, 0, 127, intensity);
          tone.tvaEnvT2 = mutateVal(tone.tvaEnvT2 !== void 0 ? tone.tvaEnvT2 : 30, 0, 127, intensity);
          tone.tvaEnvL3 = mutateVal(tone.tvaEnvL3 !== void 0 ? tone.tvaEnvL3 : 80, 0, 127, intensity);
          tone.tvaEnvT4 = mutateVal(tone.tvaEnvT4 !== void 0 ? tone.tvaEnvT4 : 35, 0, 127, intensity);
          tone.tvfEnvT1 = mutateVal(tone.tvfEnvT1 !== void 0 ? tone.tvfEnvT1 : 15, 0, 127, intensity);
          tone.tvfEnvT2 = mutateVal(tone.tvfEnvT2 !== void 0 ? tone.tvfEnvT2 : 25, 0, 127, intensity);
          tone.tvfEnvT3 = mutateVal(tone.tvfEnvT3 !== void 0 ? tone.tvfEnvT3 : 40, 0, 127, intensity);
          tone.tvfEnvT4 = mutateVal(tone.tvfEnvT4 !== void 0 ? tone.tvfEnvT4 : 40, 0, 127, intensity);
          tone.tvfEnvL3 = mutateVal(tone.tvfEnvL3 !== void 0 ? tone.tvfEnvL3 : 60, 0, 127, intensity);
        }
      }
      if (Math.random() < intensity) {
        tone.lfo1Rate = mutateVal(tone.lfo1Rate || 64, 20, 110, intensity);
        if (archetypeId === "ambient_pad") {
          tone.lfo1PanDepth = mutateVal(tone.lfo1PanDepth || 64, 50, 85, intensity);
        }
      }
      patch.tones[t] = tone;
    }
    normalizeGain(patch);
    return patch;
  }
  function randomizeWaveforms(sourcePatch, locks = {}) {
    const patch = JSON.parse(JSON.stringify(sourcePatch));
    if (locks.lockWaveforms) return patch;
    if (!patch.tones) patch.tones = {};
    const totalWaves = INTERNAL_WAVEFORMS.length || 1083;
    for (let t = 1; t <= 4; t++) {
      if (!patch.tones[t]) patch.tones[t] = {};
      const tone = patch.tones[t];
      tone.waveGroupType = 0;
      tone.waveNumberL = Math.floor(Math.random() * totalWaves) + 1;
      if (tone.waveNumberR !== void 0 && tone.waveNumberR > 0) {
        tone.waveNumberR = Math.floor(Math.random() * totalWaves) + 1;
      }
    }
    return patch;
  }
  function normalizeGain(patch) {
    if (!patch.tones) return;
    let totalLevel = 0;
    let activeCount = 0;
    for (let t = 1; t <= 4; t++) {
      const tone = patch.tones[t];
      if (tone && tone.level > 0) {
        totalLevel += tone.level;
        activeCount++;
      }
    }
    const booster12 = patch.tmt?.booster12 || 0;
    const boosterFactor = booster12 === 3 ? 1.8 : booster12 === 2 ? 1.4 : booster12 === 1 ? 1.2 : 1;
    const effectiveMax = totalLevel * boosterFactor;
    const targetMax = 260;
    if (effectiveMax > targetMax && totalLevel > 0) {
      const scale = targetMax / effectiveMax;
      for (let t = 1; t <= 4; t++) {
        if (patch.tones[t] && patch.tones[t].level > 0) {
          patch.tones[t].level = Math.max(10, Math.round(patch.tones[t].level * scale));
        }
      }
    }
  }
  var MutatorHistory = class {
    constructor(maxSize = 20) {
      this.maxSize = maxSize;
      this.undoStack = [];
      this.redoStack = [];
      this.originalSnapshot = null;
      this.currentComparison = "B";
    }
    setOriginal(patch) {
      this.originalSnapshot = JSON.parse(JSON.stringify(patch));
      this.undoStack = [JSON.parse(JSON.stringify(patch))];
      this.redoStack = [];
    }
    push(patch) {
      this.undoStack.push(JSON.parse(JSON.stringify(patch)));
      if (this.undoStack.length > this.maxSize) {
        this.undoStack.shift();
      }
      this.redoStack = [];
      this.currentComparison = "B";
    }
    canUndo() {
      return this.undoStack.length > 1;
    }
    canRedo() {
      return this.redoStack.length > 0;
    }
    undo() {
      if (!this.canUndo()) return null;
      const current = this.undoStack.pop();
      this.redoStack.push(current);
      return JSON.parse(JSON.stringify(this.undoStack[this.undoStack.length - 1]));
    }
    redo() {
      if (!this.canRedo()) return null;
      const next = this.redoStack.pop();
      this.undoStack.push(next);
      return JSON.parse(JSON.stringify(next));
    }
    getOriginal() {
      return this.originalSnapshot ? JSON.parse(JSON.stringify(this.originalSnapshot)) : null;
    }
    getCurrent() {
      return this.undoStack.length > 0 ? JSON.parse(JSON.stringify(this.undoStack[this.undoStack.length - 1])) : null;
    }
  };

  // src/deep_patch.js
  function calculateVectorMorphLevels(x, y, masterLevel = 127) {
    const clampedX = Math.max(0, Math.min(1, x));
    const clampedY = Math.max(0, Math.min(1, y));
    const w1 = (1 - clampedX) * (1 - clampedY);
    const w2 = clampedX * (1 - clampedY);
    const w3 = (1 - clampedX) * clampedY;
    const w4 = clampedX * clampedY;
    return {
      tone1: Math.round(w1 * masterLevel),
      tone2: Math.round(w2 * masterLevel),
      tone3: Math.round(w3 * masterLevel),
      tone4: Math.round(w4 * masterLevel)
    };
  }
  function generateSpectrumPath(cutoff = 100, resonance = 10, filterType = 1, width = 360, height = 90) {
    const points = [];
    const numBands = 36;
    const step = width / (numBands - 1);
    const normCutoff = cutoff / 127 * (numBands - 1);
    const normRes = resonance / 127;
    for (let i = 0; i < numBands; i++) {
      const x = i * step;
      let amplitude = Math.exp(-i / 8);
      if (filterType === 1 || filterType === 5 || filterType === 6) {
        if (i > normCutoff) {
          const dist = i - normCutoff;
          amplitude *= Math.exp(-dist / 3);
        }
        const resDist = Math.abs(i - normCutoff);
        if (resDist < 4) {
          amplitude += normRes * Math.exp(-resDist * 0.8) * 0.9;
        }
      } else if (filterType === 3) {
        if (i < normCutoff) {
          const dist = normCutoff - i;
          amplitude *= Math.exp(-dist / 3);
        }
        const resDist = Math.abs(i - normCutoff);
        if (resDist < 4) {
          amplitude += normRes * Math.exp(-resDist * 0.8) * 0.9;
        }
      } else if (filterType === 2) {
        const dist = Math.abs(i - normCutoff);
        amplitude *= Math.exp(-dist / 4);
        if (dist < 4) {
          amplitude += normRes * Math.exp(-dist * 0.8) * 0.9;
        }
      }
      const clampedAmp = Math.max(0.04, Math.min(1, amplitude));
      const y = height - clampedAmp * (height - 12) - 6;
      points.push({ x: Math.round(x), y: Math.round(y) });
    }
    let path = `M ${points[0].x} ${points[0].y}`;
    for (let i = 1; i < points.length; i++) {
      path += ` L ${points[i].x} ${points[i].y}`;
    }
    return path;
  }

  // src/rotary_knob.js
  var RotaryKnob = class {
    /**
     * @param {HTMLElement|string} target - Container element or ID
     * @param {object} options
     */
    constructor(target, options = {}) {
      this.container = typeof target === "string" ? document.getElementById(target) : target;
      if (!this.container) {
        throw new Error(`RotaryKnob target element not found: ${target}`);
      }
      this.id = options.id || `knob_${Math.random().toString(36).substr(2, 9)}`;
      this.min = options.min ?? 0;
      this.max = options.max ?? 127;
      this.defaultValue = options.defaultValue ?? options.value ?? Math.round((this.min + this.max) / 2);
      this.value = options.value ?? this.defaultValue;
      this.label = options.label || "";
      this.bipolar = !!options.bipolar;
      this.color = options.color || "var(--accent, #ff7700)";
      this.size = options.size || 34;
      this.formatValue = options.formatValue || ((v) => String(v));
      this.onChange = options.onChange || null;
      this.isDragging = false;
      this.startY = 0;
      this.startVal = 0;
      this._render();
      this._bindEvents();
      this.setValue(this.value, false);
    }
    _render() {
      this.container.classList.add("rotary-knob-wrapper");
      const size = this.size;
      this.container.innerHTML = `
      <div class="rotary-knob" id="${this.id}" tabindex="0" role="slider" aria-valuemin="${this.min}" aria-valuemax="${this.max}" aria-valuenow="${this.value}">
        ${this.label ? `<span class="rotary-knob-label">${this.label}</span>` : ""}
        <div class="rotary-knob-dial" style="width:${size}px; height:${size}px;">
          <svg class="rotary-knob-svg" viewBox="0 0 44 44" width="${size}" height="${size}">
            <!-- Background Track Arc (270 deg from 135 to 405) -->
            <circle class="knob-track" cx="22" cy="22" r="16" fill="none" stroke="rgba(255,255,255,0.14)" stroke-width="3" stroke-linecap="round" stroke-dasharray="75.4 100" stroke-dashoffset="0" transform="rotate(135, 22, 22)" />
            <!-- Active Fill Arc -->
            <circle class="knob-fill" cx="22" cy="22" r="16" fill="none" stroke="${this.color}" stroke-width="3.2" stroke-linecap="round" stroke-dasharray="0 100" stroke-dashoffset="0" transform="rotate(135, 22, 22)" />
            <!-- Center Knob Body -->
            <circle class="knob-face" cx="22" cy="22" r="11.5" fill="#141926" stroke="#2a354d" stroke-width="1.2" />
            <!-- Needle Pointer -->
            <line class="knob-pointer" x1="22" y1="22" x2="22" y2="12" stroke="#ffffff" stroke-width="2" stroke-linecap="round" />
          </svg>
        </div>
        <span class="rotary-knob-val" title="Drag or scroll to adjust, double-click to reset">${this.formatValue(this.value)}</span>
      </div>
    `;
      this.fillArc = this.container.querySelector(".knob-fill");
      this.pointer = this.container.querySelector(".knob-pointer");
      this.valDisplay = this.container.querySelector(".rotary-knob-val");
      this.knobEl = this.container.querySelector(".rotary-knob");
    }
    _bindEvents() {
      const dial = this.container.querySelector(".rotary-knob-dial");
      const dragTarget = dial;
      if (!dragTarget) return;
      const startDrag = (e) => {
        this.isDragging = true;
        this.startY = e.clientY;
        this.startVal = this.value;
        try {
          dragTarget.setPointerCapture(e.pointerId);
        } catch (_) {
        }
        this.knobEl.classList.add("active");
        e.preventDefault();
      };
      dragTarget.addEventListener("pointerdown", startDrag);
      dragTarget.addEventListener("pointermove", (e) => {
        if (!this.isDragging) return;
        const deltaY = this.startY - e.clientY;
        const range = this.max - this.min;
        const speedMultiplier = e.shiftKey ? 0.25 : 1;
        const stepDelta = Math.round(deltaY / 100 * range * speedMultiplier);
        const newVal = Math.min(this.max, Math.max(this.min, this.startVal + stepDelta));
        if (newVal !== this.value) {
          this.setValue(newVal, true);
        }
      });
      const stopDrag = (e) => {
        if (this.isDragging) {
          this.isDragging = false;
          try {
            dragTarget.releasePointerCapture(e.pointerId);
          } catch (_) {
          }
          this.knobEl.classList.remove("active");
        }
      };
      dragTarget.addEventListener("pointerup", stopDrag);
      dragTarget.addEventListener("pointercancel", stopDrag);
      const onWheel = (e) => {
        e.preventDefault();
        e.stopPropagation();
        const step = this.max - this.min > 50 ? e.shiftKey ? 1 : 2 : 1;
        const delta = e.deltaY < 0 ? step : -step;
        const newVal = Math.min(this.max, Math.max(this.min, this.value + delta));
        if (newVal !== this.value) {
          this.setValue(newVal, true);
        }
      };
      this.container.addEventListener("wheel", onWheel, { passive: false, capture: true });
      dragTarget.addEventListener("dblclick", (e) => {
        e.preventDefault();
        this.setValue(this.defaultValue, true);
      });
      if (this.valDisplay) {
        this.valDisplay.addEventListener("dblclick", (e) => {
          e.preventDefault();
          e.stopPropagation();
          this.setValue(this.defaultValue, true);
        });
      }
      this.knobEl.addEventListener("keydown", (e) => {
        let delta = 0;
        if (e.key === "ArrowUp" || e.key === "ArrowRight") delta = 1;
        else if (e.key === "ArrowDown" || e.key === "ArrowLeft") delta = -1;
        else if (e.key === "PageUp") delta = 10;
        else if (e.key === "PageDown") delta = -10;
        else if (e.key === "Home") delta = this.min - this.value;
        else if (e.key === "End") delta = this.max - this.value;
        if (delta !== 0) {
          e.preventDefault();
          const newVal = Math.min(this.max, Math.max(this.min, this.value + delta));
          if (newVal !== this.value) {
            this.setValue(newVal, true);
          }
        }
      });
    }
    /**
     * Set knob value and update visuals
     * @param {number} val
     * @param {boolean} fireChange
     */
    setValue(val, fireChange = false) {
      this.value = Math.min(this.max, Math.max(this.min, Math.round(val)));
      const totalArc = 75.4;
      const halfArc = totalArc / 2;
      let angle = 0;
      if (this.bipolar) {
        const centerVal = this.defaultValue !== void 0 ? this.defaultValue : Math.round((this.min + this.max) / 2);
        const diff = this.value - centerVal;
        const maxRange = diff >= 0 ? this.max - centerVal || 1 : centerVal - this.min || 1;
        const normDiff = diff / maxRange;
        angle = normDiff * 135;
        const arcLength = Math.abs(normDiff) * halfArc;
        if (this.fillArc) {
          if (diff >= 0) {
            this.fillArc.setAttribute("stroke-dasharray", `${arcLength.toFixed(1)} 100`);
            this.fillArc.setAttribute("stroke-dashoffset", `${(-halfArc).toFixed(2)}`);
          } else {
            const startOffset = -(halfArc - arcLength);
            this.fillArc.setAttribute("stroke-dasharray", `${arcLength.toFixed(1)} 100`);
            this.fillArc.setAttribute("stroke-dashoffset", `${startOffset.toFixed(2)}`);
          }
        }
      } else {
        const ratio = (this.value - this.min) / (this.max - this.min || 1);
        angle = -135 + ratio * 270;
        if (this.fillArc) {
          const arcLen = ratio * totalArc;
          this.fillArc.setAttribute("stroke-dasharray", `${arcLen.toFixed(1)} 100`);
          this.fillArc.setAttribute("stroke-dashoffset", "0");
        }
      }
      if (this.pointer) {
        this.pointer.setAttribute("transform", `rotate(${angle.toFixed(1)}, 22, 22)`);
      }
      if (this.valDisplay) {
        this.valDisplay.textContent = this.formatValue(this.value);
      }
      if (this.knobEl) {
        this.knobEl.setAttribute("aria-valuenow", this.value);
      }
      if (fireChange && typeof this.onChange === "function") {
        this.onChange(this.value, this);
      }
    }
    getValue() {
      return this.value;
    }
  };
  function createSyncedKnob(containerTarget, inputTarget, options = {}) {
    const container = typeof containerTarget === "string" ? document.getElementById(containerTarget) : containerTarget;
    const input = typeof inputTarget === "string" ? document.getElementById(inputTarget) : inputTarget;
    if (!container || !input) return null;
    const min = options.min ?? (input.min !== "" ? parseFloat(input.min) : 0);
    const max = options.max ?? (input.max !== "" ? parseFloat(input.max) : 127);
    const defaultValue = options.defaultValue ?? (input.defaultValue !== "" ? parseFloat(input.defaultValue) : Math.round((min + max) / 2));
    const initialVal = input.value !== "" ? parseFloat(input.value) : defaultValue;
    const bipolar = options.bipolar ?? false;
    const size = options.size ?? 28;
    const color = options.color || "var(--accent, #ff7700)";
    const label = options.label || "";
    const formatValue = options.formatValue || ((v) => {
      if (bipolar) return v > 0 ? `+${v}` : `${v}`;
      return String(v);
    });
    const knob = new RotaryKnob(container, {
      min,
      max,
      defaultValue,
      value: initialVal,
      label,
      bipolar,
      size,
      color,
      formatValue,
      onChange: (val) => {
        input.value = val;
        input.dispatchEvent(new Event("input", { bubbles: true }));
        input.dispatchEvent(new Event("change", { bubbles: true }));
        if (typeof options.onChange === "function") {
          options.onChange(val, knob);
        }
      }
    });
    try {
      const proto = typeof window !== "undefined" && window.HTMLInputElement ? window.HTMLInputElement.prototype : Object.getPrototypeOf(input);
      const descriptor = Object.getOwnPropertyDescriptor(proto, "value");
      if (descriptor && descriptor.get && descriptor.set) {
        Object.defineProperty(input, "value", {
          configurable: true,
          get() {
            return descriptor.get.call(this);
          },
          set(val) {
            descriptor.set.call(this, val);
            const parsed = parseFloat(val);
            if (!isNaN(parsed) && knob.value !== parsed) {
              knob.setValue(parsed, false);
            }
          }
        });
      }
    } catch (_) {
    }
    input.addEventListener("input", () => {
      const parsed = parseFloat(input.value);
      if (!isNaN(parsed) && knob.value !== parsed) {
        knob.setValue(parsed, false);
      }
    });
    input.style.display = "none";
    return knob;
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
  function createPatchSyxDump(part, commonData, tmtData, tonesData = null, deviceId = 16) {
    if (typeof tonesData === "number") {
      deviceId = tonesData;
      tonesData = null;
    }
    const patchBase = getPatchTempAddress(part);
    const tmtBase = getPatchTMTAddress(patchBase);
    const packets = [
      buildDT1(patchBase, commonData, deviceId),
      buildDT1(tmtBase, tmtData, deviceId)
    ];
    if (Array.isArray(tonesData)) {
      for (let t = 1; t <= tonesData.length; t++) {
        if (tonesData[t - 1]) {
          const toneBase = getToneAddress(patchBase, t);
          packets.push(buildDT1(toneBase, tonesData[t - 1], deviceId));
        }
      }
    }
    return packets;
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

  // src/usb_hardware.js
  function extractData(resp) {
    if (!resp) return null;
    if (resp.data) return resp.data;
    const parsed = parseSysEx(resp);
    return parsed?.data || null;
  }
  var sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  async function sendAndReceiveWithRetry(midiManager, requestBytes, { maxRetries = 1, timeoutMs = 600, throttleMs = 20 } = {}) {
    if (midiManager && typeof midiManager.sendAndReceiveWithRetry === "function") {
      return midiManager.sendAndReceiveWithRetry(requestBytes, { maxRetries, timeoutMs, throttleMs });
    }
    let lastError = null;
    for (let attempt = 1; attempt <= maxRetries + 1; attempt++) {
      try {
        if (attempt > 1) {
          await sleep(100 * attempt);
        } else if (throttleMs > 0) {
          await sleep(throttleMs);
        }
        const response = await midiManager.sendAndReceive(requestBytes, timeoutMs);
        const parsed = response?.data ? response : parseSysEx(response);
        if (!parsed || !parsed.valid) {
          throw new Error(parsed?.error || "Invalid SysEx packet received");
        }
        return parsed;
      } catch (err) {
        lastError = err;
      }
    }
    throw new Error(`Failed after ${maxRetries + 1} attempts: ${lastError?.message || "Unknown error"}`);
  }
  async function detectDeviceId(midiManager, timeoutMs = 200) {
    for (let devId = 16; devId <= 31; devId++) {
      try {
        const rq1 = buildRQ1(SETUP.BASE, SETUP.SIZE, devId);
        const resp = await midiManager.sendAndReceive(rq1, timeoutMs);
        const parsed = resp?.data ? resp : parseSysEx(resp);
        if (parsed && parsed.valid) {
          return devId;
        }
      } catch {
      }
    }
    throw new Error("XV-5050 synthesizer did not respond. Check USB connection and MIDI port selection.");
  }
  async function requestEntireUserPerformance(midiManager, perfIndex, deviceId = 16) {
    if (perfIndex < 1 || perfIndex > 64) {
      throw new Error("User Performance index must be 1-64");
    }
    const b1 = perfIndex - 1;
    const commonAddr = [32, b1, 0, 0];
    const chorusAddr = [32, b1, 4, 0];
    const reverbAddr = [32, b1, 6, 0];
    const commResp = await sendAndReceiveWithRetry(
      midiManager,
      buildRQ1(commonAddr, PERF_TEMP.COMMON.SIZE, deviceId)
    );
    const common = parsePerformanceCommon(extractData(commResp));
    let mfxA = null, mfxB = null, mfxC = null;
    try {
      const rA = await sendAndReceiveWithRetry(
        midiManager,
        buildRQ1([32, b1, 2, 0], PERF_TEMP.MFXA.SIZE, deviceId),
        { maxRetries: 1, timeoutMs: 600, throttleMs: 20 }
      );
      mfxA = parsePerformanceMfx(extractData(rA));
    } catch (_) {
    }
    const chorResp = await sendAndReceiveWithRetry(
      midiManager,
      buildRQ1(chorusAddr, PERF_TEMP.CHORUS.SIZE, deviceId)
    );
    const chorus = parsePerformanceChorus(extractData(chorResp));
    const revResp = await sendAndReceiveWithRetry(
      midiManager,
      buildRQ1(reverbAddr, PERF_TEMP.REVERB.SIZE, deviceId)
    );
    const reverb = parsePerformanceReverb(extractData(revResp));
    const parts = [];
    for (let p = 1; p <= 16; p++) {
      const partAddr = [32, b1, 32 + (p - 1), 0];
      const partResp = await sendAndReceiveWithRetry(
        midiManager,
        buildRQ1(partAddr, PERF_PART.SIZE, deviceId)
      );
      const part = parsePerformancePart(extractData(partResp), p);
      parts.push(part);
    }
    return {
      index: perfIndex,
      common,
      mfxA,
      mfxB,
      mfxC,
      chorus,
      reverb,
      parts
    };
  }
  async function sendEntireUserPerformance(midiManager, perfIndex, perfData, deviceId = 16) {
    if (perfIndex < 1 || perfIndex > 64) {
      throw new Error("User Performance index must be 1-64");
    }
    const b1 = perfIndex - 1;
    if (perfData.common?.raw) {
      const commonAddr = [32, b1, 0, 0];
      midiManager.send(buildDT1(commonAddr, perfData.common.raw, deviceId));
      await sleep(20);
    }
    if (perfData.chorus?.raw) {
      const chorusAddr = [32, b1, 4, 0];
      midiManager.send(buildDT1(chorusAddr, perfData.chorus.raw, deviceId));
      await sleep(20);
    }
    if (perfData.reverb?.raw) {
      const reverbAddr = [32, b1, 6, 0];
      midiManager.send(buildDT1(reverbAddr, perfData.reverb.raw, deviceId));
      await sleep(20);
    }
    if (Array.isArray(perfData.parts)) {
      for (let p = 1; p <= Math.min(16, perfData.parts.length); p++) {
        const part = perfData.parts[p - 1];
        if (part?.raw) {
          const partAddr = [32, b1, 32 + (p - 1), 0];
          midiManager.send(buildDT1(partAddr, part.raw, deviceId));
          await sleep(15);
        }
      }
    }
  }
  async function requestEntireUserPatch(midiManager, patchIndex, deviceId = 16) {
    if (patchIndex < 1 || patchIndex > 128) {
      throw new Error("User Patch index must be 1-128");
    }
    const b1 = patchIndex - 1;
    const commonAddr = [48, b1, 0, 0];
    const tmtAddr = [48, b1, 16, 0];
    const commResp = await sendAndReceiveWithRetry(
      midiManager,
      buildRQ1(commonAddr, PATCH_COMMON.SIZE, deviceId)
    );
    const common = parsePatchCommon(extractData(commResp));
    let mfx = null, chorus = null, reverb = null;
    try {
      const mfxResp = await sendAndReceiveWithRetry(midiManager, buildRQ1([48, b1, 2, 0], PATCH_MFX.SIZE, deviceId));
      mfx = parsePatchMfx(extractData(mfxResp));
    } catch (_) {
    }
    try {
      const choResp = await sendAndReceiveWithRetry(midiManager, buildRQ1([48, b1, 4, 0], PATCH_CHORUS.SIZE, deviceId));
      chorus = parsePatchChorus(extractData(choResp));
    } catch (_) {
    }
    try {
      const revResp = await sendAndReceiveWithRetry(midiManager, buildRQ1([48, b1, 6, 0], PATCH_REVERB.SIZE, deviceId));
      reverb = parsePatchReverb(extractData(revResp));
    } catch (_) {
    }
    const tmtResp = await sendAndReceiveWithRetry(
      midiManager,
      buildRQ1(tmtAddr, PATCH_TMT.SIZE, deviceId)
    );
    const tmt = parsePatchTMT(extractData(tmtResp));
    const tones = [];
    for (let t = 1; t <= 4; t++) {
      const toneAddr = [48, b1, 32 + (t - 1) * 2, 0];
      const toneResp = await sendAndReceiveWithRetry(
        midiManager,
        buildRQ1(toneAddr, PATCH_TONE.SIZE, deviceId)
      );
      const tone = parsePatchTone(extractData(toneResp), t);
      tones.push(tone);
    }
    return {
      index: patchIndex,
      common,
      mfx,
      chorus,
      reverb,
      tmt,
      tones
    };
  }
  async function sendEntireUserPatch(midiManager, patchIndex, patchData, deviceId = 16) {
    if (patchIndex < 1 || patchIndex > 128) {
      throw new Error("User Patch index must be 1-128");
    }
    const b1 = patchIndex - 1;
    if (patchData.common?.raw) {
      const commonAddr = [48, b1, 0, 0];
      midiManager.send(buildDT1(commonAddr, patchData.common.raw, deviceId));
      await sleep(20);
    }
    if (patchData.tmt?.raw) {
      const tmtAddr = [48, b1, 16, 0];
      midiManager.send(buildDT1(tmtAddr, patchData.tmt.raw, deviceId));
      await sleep(20);
    }
    if (Array.isArray(patchData.tones)) {
      for (let t = 1; t <= Math.min(4, patchData.tones.length); t++) {
        const tone = patchData.tones[t - 1];
        if (tone?.raw) {
          const toneAddr = [48, b1, 32 + (t - 1) * 2, 0];
          midiManager.send(buildDT1(toneAddr, tone.raw, deviceId));
          await sleep(15);
        }
      }
    }
  }
  async function runHardwareDiagnostics(midiManager, deviceId = 16, onProgress = null) {
    const steps = [];
    let overallSuccess = true;
    const runStep = async (name, action) => {
      const start = Date.now();
      try {
        if (typeof onProgress === "function") {
          onProgress({ name, status: "running" });
        }
        const res = await action();
        const elapsed = Date.now() - start;
        const stepResult = {
          name,
          passed: true,
          latencyMs: elapsed,
          bytesReceived: res?.bytesReceived || 0,
          details: res?.details || "OK"
        };
        steps.push(stepResult);
        if (typeof onProgress === "function") {
          onProgress({ name, status: "passed", latencyMs: elapsed });
        }
        return true;
      } catch (err) {
        const elapsed = Date.now() - start;
        const stepResult = {
          name,
          passed: false,
          latencyMs: elapsed,
          bytesReceived: 0,
          error: err.message
        };
        steps.push(stepResult);
        overallSuccess = false;
        if (typeof onProgress === "function") {
          onProgress({ name, status: "failed", error: err.message });
        }
        return false;
      }
    };
    await runStep("Device ID Handshake", async () => {
      const detected = await detectDeviceId(midiManager, 300);
      return { bytesReceived: 15, details: `Handshake verified on Device ID 0x${detected.toString(16).toUpperCase()}` };
    });
    if (overallSuccess) {
      await runStep("System & Setup Parameters", async () => {
        const rq1 = buildRQ1(SYSTEM.COMMON.BASE, SYSTEM.COMMON.SIZE, deviceId);
        const resp = await sendAndReceiveWithRetry(midiManager, rq1, { timeoutMs: 400 });
        return { bytesReceived: resp.data.length, details: `Read ${resp.data.length} bytes System Common` };
      });
    }
    if (overallSuccess) {
      await runStep("Temporary Performance Common & Effects", async () => {
        const rq1 = buildRQ1(PERF_TEMP.COMMON.BASE, PERF_TEMP.COMMON.SIZE, deviceId);
        const resp = await sendAndReceiveWithRetry(midiManager, rq1, { timeoutMs: 400 });
        return { bytesReceived: resp.data.length, details: `Read Performance Common (${decodeName(resp.data.slice(0, 12))})` };
      });
    }
    if (overallSuccess) {
      await runStep("Temporary Patch & Tone Engine", async () => {
        const toneAddr = getToneAddress(getPatchTempAddress(1), 1);
        const rq1 = buildRQ1(toneAddr, PATCH_TONE.SIZE, deviceId);
        const resp = await sendAndReceiveWithRetry(midiManager, rq1, { timeoutMs: 400 });
        return { bytesReceived: resp.data.length, details: `Read Tone 1 Wave & TVF Engine (${resp.data.length} bytes)` };
      });
    }
    if (overallSuccess) {
      await runStep("User Performance Bank Sample", async () => {
        const perf1Addr = getUserPerformanceAddress(1);
        const rq1 = buildRQ1(perf1Addr, PERF_TEMP.COMMON.SIZE, deviceId);
        const resp = await sendAndReceiveWithRetry(midiManager, rq1, { timeoutMs: 400 });
        return { bytesReceived: resp.data.length, details: `User Perf 01: "${decodeName(resp.data.slice(0, 12))}"` };
      });
    }
    if (overallSuccess) {
      await runStep("User Patch Bank Sample", async () => {
        const patch1Addr = getUserPatchAddress(1);
        const rq1 = buildRQ1(patch1Addr, PATCH_COMMON.SIZE, deviceId);
        const resp = await sendAndReceiveWithRetry(midiManager, rq1, { timeoutMs: 400 });
        return { bytesReceived: resp.data.length, details: `User Patch 001: "${decodeName(resp.data.slice(0, 12))}"` };
      });
    }
    return {
      overallSuccess,
      steps
    };
  }

  // src/unit_sync.js
  function parseSetup(data) {
    if (!data || data.length < 15) return {};
    return {
      raw: data,
      soundMode: data[0],
      perfBankMsb: data[4] !== void 0 && data[4] !== 0 ? data[4] : data[0],
      perfBankLsb: data[5] !== void 0 ? data[5] : data[1],
      perfProgramNum: data[6] !== void 0 ? data[6] : data[2],
      patchBankMsb: data[7] !== void 0 ? data[7] : data[3],
      patchBankLsb: data[8] !== void 0 ? data[8] : data[4],
      patchProgramNum: data[9] !== void 0 ? data[9] : data[5],
      mfxSwitch: data[10],
      chorusSwitch: data[11],
      reverbSwitch: data[12],
      transpose: (data[13] ?? 64) - 64,
      octaveShift: (data[14] ?? 64) - 64
    };
  }
  function parseSystemCommon(data) {
    if (!data || data.length < 33) return {};
    return {
      raw: data,
      masterKeyShift: (data[4] ?? 64) - 64,
      masterLevel: data[5] ?? 127,
      scaleTuneSwitch: data[6] ?? 0,
      patchRemain: data[7] ?? 0,
      mixParallel: data[8] ?? 0,
      perfCtrlChannel: data[9] ?? 16,
      patchReceiveChannel: data[11] ?? 0,
      receivePC: data[28] ?? 1,
      receiveBank: data[29] ?? 1,
      clockSource: data[30] ?? 0,
      systemTempo: (data[31] ?? 0) << 4 | (data[32] ?? 0)
    };
  }
  function parseSystemEQ(data) {
    if (!data || data.length < 17) return {};
    return {
      raw: data,
      eqSwitch: data[0],
      eq1LowFreq: data[1],
      eq1LowGain: (data[2] ?? 15) - 15,
      eq1HighFreq: data[3],
      eq1HighGain: (data[4] ?? 15) - 15,
      eq2LowFreq: data[5],
      eq2LowGain: (data[6] ?? 15) - 15,
      eq2HighFreq: data[7],
      eq2HighGain: (data[8] ?? 15) - 15,
      eq3LowFreq: data[9],
      eq3LowGain: (data[10] ?? 15) - 15,
      eq3HighFreq: data[11],
      eq3HighGain: (data[12] ?? 15) - 15,
      eq4LowFreq: data[13],
      eq4LowGain: (data[14] ?? 15) - 15,
      eq4HighFreq: data[15],
      eq4HighGain: (data[16] ?? 15) - 15
    };
  }
  function parseUserPerformanceHeader(data, index) {
    if (!data || data.length < 12) return { index, name: `User Perf ${index}` };
    return {
      index,
      raw: data,
      name: decodeName(data.slice(0, 12)) || `USER PERF ${index}`,
      soloPart: data[12] ?? 0,
      mfxCtrlChannel: data[13] ?? 0,
      mfxSource: (data.length > 48 ? data[48] : 0) ?? 0,
      chorusSource: (data.length > 51 ? data[51] : 0) ?? 0,
      reverbSource: (data.length > 52 ? data[52] : 0) ?? 0
    };
  }
  function parseUserPatchHeader(data, index) {
    if (!data || data.length < 12) return { index, name: `User Patch ${index}` };
    return {
      index,
      raw: data,
      name: decodeName(data.slice(0, 12)) || `USER PATCH ${index}`,
      category: data[12] ?? 0,
      level: data[14] ?? 127,
      pan: data[15] ?? 64,
      poly: data[22] ?? 1
    };
  }
  function parseUserRhythmHeader(data, index) {
    if (!data || data.length < 18) return { index, name: `User Rhythm ${index}` };
    return {
      index,
      raw: data,
      name: decodeName(data.slice(0, 12)) || `USER DRUM ${index}`
    };
  }
  function extractData2(resp) {
    if (!resp) return null;
    if (resp.data) return resp.data;
    const parsed = parseSysEx(resp);
    return parsed?.data || null;
  }
  async function requestSetup(midiManager, deviceId = 16) {
    const rq1 = buildRQ1(SETUP.BASE, SETUP.SIZE, deviceId);
    const resp = await sendAndReceiveWithRetry(midiManager, rq1);
    return parseSetup(extractData2(resp));
  }
  async function requestSystemCommon(midiManager, deviceId = 16) {
    const rq1 = buildRQ1(SYSTEM.COMMON.BASE, SYSTEM.COMMON.SIZE, deviceId);
    const resp = await sendAndReceiveWithRetry(midiManager, rq1);
    return parseSystemCommon(extractData2(resp));
  }
  async function requestSystemEQ(midiManager, deviceId = 16) {
    const rq1 = buildRQ1(SYSTEM.EQ.BASE, SYSTEM.EQ.SIZE, deviceId);
    const resp = await sendAndReceiveWithRetry(midiManager, rq1);
    return parseSystemEQ(extractData2(resp));
  }
  async function requestUserPerformanceHeader(midiManager, perfIndex, deviceId = 16) {
    const addr = getUserPerformanceAddress(perfIndex);
    const rq1 = buildRQ1(addr, PERF_TEMP.COMMON.SIZE, deviceId);
    const resp = await sendAndReceiveWithRetry(midiManager, rq1);
    return parseUserPerformanceHeader(extractData2(resp), perfIndex);
  }
  async function requestAllUserPerformanceHeaders(midiManager, deviceId = 16, onProgress = null) {
    const performances = [];
    const total = 64;
    for (let i = 1; i <= total; i++) {
      const perf = await requestUserPerformanceHeader(midiManager, i, deviceId);
      performances.push(perf);
      if (typeof onProgress === "function") {
        onProgress(i, total, perf);
      }
    }
    return performances;
  }
  async function requestUserPatchHeader(midiManager, patchIndex, deviceId = 16) {
    const addr = getUserPatchAddress(patchIndex);
    const rq1 = buildRQ1(addr, PATCH_COMMON.SIZE, deviceId);
    const resp = await sendAndReceiveWithRetry(midiManager, rq1);
    return parseUserPatchHeader(extractData2(resp), patchIndex);
  }
  async function requestAllUserPatchHeaders(midiManager, deviceId = 16, onProgress = null) {
    const patches = [];
    const total = 128;
    for (let i = 1; i <= total; i++) {
      const patch = await requestUserPatchHeader(midiManager, i, deviceId);
      patches.push(patch);
      if (typeof onProgress === "function") {
        onProgress(i, total, patch);
      }
    }
    return patches;
  }
  async function requestUserRhythmHeader(midiManager, rhythmIndex, deviceId = 16) {
    const addr = getUserRhythmAddress(rhythmIndex);
    const rq1 = buildRQ1(addr, [0, 0, 0, 18], deviceId);
    const resp = await sendAndReceiveWithRetry(midiManager, rq1);
    return parseUserRhythmHeader(extractData2(resp), rhythmIndex);
  }
  async function syncEntireUnit(midiManager, deviceId = 16, onProgress = null) {
    const report = (pct, text, stage) => {
      if (typeof onProgress === "function") {
        onProgress(Math.min(100, Math.max(0, Math.round(pct))), text, stage, unitDb);
      }
    };
    const unitDb = {
      setup: null,
      system: { common: null, eq: null },
      currentPerformance: { common: null, mfxA: null, mfxB: null, mfxC: null, chorus: null, reverb: null, parts: [] },
      activePatches: [],
      userPerformances: [],
      userPatches: [],
      userRhythms: [],
      timestamp: Date.now()
    };
    report(2, "Reading Setup parameters...", "setup_system");
    try {
      unitDb.setup = await requestSetup(midiManager, deviceId);
    } catch (err) {
      console.warn("Setup parameters read skipped:", err?.message || err);
      unitDb.setup = { soundMode: 2 };
    }
    report(5, "Reading System Common...", "setup_system");
    try {
      unitDb.system.common = await requestSystemCommon(midiManager, deviceId);
    } catch (err) {
      console.warn("System Common read skipped:", err?.message || err);
    }
    report(8, "Reading System EQ...", "setup_system");
    try {
      unitDb.system.eq = await requestSystemEQ(midiManager, deviceId);
    } catch (err) {
      console.warn("System EQ read skipped:", err?.message || err);
    }
    report(12, "Reading Current Performance Common...", "current_performance");
    try {
      unitDb.currentPerformance.common = await requestPerformanceCommon(midiManager, deviceId);
    } catch (err) {
      console.warn("Current Performance Common read skipped:", err?.message || err);
      unitDb.currentPerformance.common = { name: "PERFORMANCE" };
    }
    report(14, "Reading Performance MFX Processors...", "current_performance");
    try {
      unitDb.currentPerformance.mfxA = await requestPerformanceMfx(midiManager, "A", deviceId);
    } catch (_) {
    }
    try {
      unitDb.currentPerformance.mfxB = await requestPerformanceMfx(midiManager, "B", deviceId);
    } catch (_) {
    }
    try {
      unitDb.currentPerformance.mfxC = await requestPerformanceMfx(midiManager, "C", deviceId);
    } catch (_) {
    }
    report(16, "Reading Performance Effects...", "current_performance");
    try {
      unitDb.currentPerformance.chorus = await requestPerformanceChorus(midiManager, deviceId);
    } catch (_) {
    }
    try {
      unitDb.currentPerformance.reverb = await requestPerformanceReverb(midiManager, deviceId);
    } catch (_) {
    }
    report(18, "Reading 16 Performance Parts...", "current_performance");
    unitDb.currentPerformance.parts = await requestAllParts(midiManager, deviceId, (done, total, part) => {
      const pct = 18 + Math.round(done / total * 17);
      report(pct, `Reading Part ${done}/${total}: "${part.patchName}"`, "current_performance");
    });
    report(36, "Reading Active Part Patches & Waveforms...", "active_patches");
    for (let p = 1; p <= 16; p++) {
      const pct = 36 + Math.round(p / 16 * 19);
      report(pct, `Reading Part ${p}/16 Patch & Effects...`, "active_patches");
      const partInfo = unitDb.currentPerformance?.parts?.[p - 1];
      const isRhythm = partInfo?.isRhythm || p === 10 && partInfo?.patchBankMSB === 92;
      if (isRhythm) {
        unitDb.activePatches.push({
          part: p,
          isRhythm: true,
          common: { name: partInfo?.patchName || `Part ${p} (Rhythm Kit)` },
          mfx: null,
          chorus: null,
          reverb: null,
          tmt: null,
          tones: []
        });
        continue;
      }
      try {
        const pCommon = await requestPatchCommon(midiManager, p, deviceId);
        const pTmt = await requestPatchTMT(midiManager, p, deviceId);
        const tones = [];
        for (let t = 1; t <= 4; t++) {
          const toneData = await requestPatchTone(midiManager, p, t, deviceId);
          tones.push(toneData);
        }
        unitDb.activePatches.push({
          part: p,
          isRhythm: false,
          common: pCommon,
          mfx: null,
          chorus: null,
          reverb: null,
          tmt: pTmt,
          tones
        });
      } catch (partErr) {
        console.warn(`Part ${p} patch read skipped:`, partErr?.message || partErr);
        unitDb.activePatches.push({
          part: p,
          isRhythm: false,
          common: { name: partInfo?.patchName || `Part ${p}` },
          mfx: null,
          chorus: null,
          reverb: null,
          tmt: null,
          tones: []
        });
      }
    }
    report(56, "Reading 64 User Performances...", "user_performances");
    unitDb.userPerformances = [];
    await requestAllUserPerformanceHeaders(midiManager, deviceId, (done, total, perf) => {
      unitDb.userPerformances.push(perf);
      const pct = 56 + Math.round(done / total * 19);
      report(pct, `User Performance ${done}/${total}: "${perf.name}"`, "user_performances");
    });
    report(76, "Reading 128 User Patches...", "user_patches");
    unitDb.userPatches = [];
    await requestAllUserPatchHeaders(midiManager, deviceId, (done, total, patch) => {
      unitDb.userPatches.push(patch);
      const pct = 76 + Math.round(done / total * 19);
      report(pct, `User Patch ${done}/${total}: "${patch.name}"`, "user_patches");
    });
    report(96, "Reading User Rhythm Sets...", "user_rhythms");
    for (let r = 1; r <= 4; r++) {
      const rSet = await requestUserRhythmHeader(midiManager, r, deviceId);
      unitDb.userRhythms.push(rSet);
      report(96 + r, `User Rhythm ${r}/4: "${rSet.name}"`, "user_rhythms");
    }
    report(100, "Entire Unit Sync Complete!", "complete");
    return unitDb;
  }
  function exportFullUnitBackup(unitDb, deviceId = 16) {
    const packets = [];
    if (unitDb.setup?.raw) {
      packets.push(buildDT1(SETUP.BASE, unitDb.setup.raw, deviceId));
    }
    if (unitDb.system?.common?.raw) {
      packets.push(buildDT1(SYSTEM.COMMON.BASE, unitDb.system.common.raw, deviceId));
    }
    if (unitDb.system?.eq?.raw) {
      packets.push(buildDT1(SYSTEM.EQ.BASE, unitDb.system.eq.raw, deviceId));
    }
    if (unitDb.currentPerformance?.common?.raw) {
      packets.push(buildDT1(PERF_TEMP.COMMON.BASE, unitDb.currentPerformance.common.raw, deviceId));
    }
    if (Array.isArray(unitDb.currentPerformance?.parts)) {
      for (let p = 1; p <= unitDb.currentPerformance.parts.length; p++) {
        const part = unitDb.currentPerformance.parts[p - 1];
        if (part?.raw) {
          packets.push(buildDT1(getPartAddress(p), part.raw, deviceId));
        }
      }
    }
    if (Array.isArray(unitDb.activePatches)) {
      for (const ap of unitDb.activePatches) {
        const patchBase = getPatchTempAddress(ap.part);
        if (ap.common?.raw) packets.push(buildDT1(patchBase, ap.common.raw, deviceId));
        if (ap.tmt?.raw) packets.push(buildDT1(getPatchTMTAddress(patchBase), ap.tmt.raw, deviceId));
        if (Array.isArray(ap.tones)) {
          for (let t = 1; t <= ap.tones.length; t++) {
            if (ap.tones[t - 1]?.raw) {
              packets.push(buildDT1(getToneAddress(patchBase, t), ap.tones[t - 1].raw, deviceId));
            }
          }
        }
      }
    }
    if (Array.isArray(unitDb.userPerformances)) {
      for (const up of unitDb.userPerformances) {
        if (up.raw) {
          packets.push(buildDT1(getUserPerformanceAddress(up.index), up.raw, deviceId));
        }
      }
    }
    if (Array.isArray(unitDb.userPatches)) {
      for (const up of unitDb.userPatches) {
        if (up.raw) {
          packets.push(buildDT1(getUserPatchAddress(up.index), up.raw, deviceId));
        }
      }
    }
    if (Array.isArray(unitDb.userRhythms)) {
      for (const ur of unitDb.userRhythms) {
        if (ur.raw) {
          packets.push(buildDT1(getUserRhythmAddress(ur.index), ur.raw, deviceId));
        }
      }
    }
    return exportToSyx(packets);
  }

  // src/vst_transpiler.js
  var WAVE_LOOKUP = [
    { match: /supersaw|hypersaw|saw\s*spread|multi\s*saw/i, wave: 534, name: "FAT Saw" },
    { match: /jp[- ]*8|jupiter/i, wave: 535, name: "JP-8 Saw A" },
    { match: /ob[- ]*xa|oberheim|p5|prophet/i, wave: 538, name: "P5 Saw A" },
    { match: /saw|ramp/i, wave: 529, name: "Synth Saw 1" },
    { match: /square/i, wave: 547, name: "Synth Square" },
    { match: /pulse|pwm/i, wave: 554, name: "JD SynPulse1" },
    { match: /triangle|tri/i, wave: 562, name: "Triangle" },
    { match: /sub|low\s*sine/i, wave: 883, name: "Low Sine" },
    { match: /sine|pure/i, wave: 564, name: "Sine" },
    { match: /white\s*noise/i, wave: 576, name: "White Noise" },
    { match: /noise|pink/i, wave: 577, name: "Pink Noise" },
    { match: /bell|chime|fm/i, wave: 503, name: "Bell Wave" },
    { match: /fanta|crystal/i, wave: 493, name: "Fanta Bell A" },
    { match: /rhodes|ep|wurl/i, wave: 58, name: "MK-80 EP A" },
    { match: /string|pad|ensemble/i, wave: 424, name: "JP Strings1A" },
    { match: /choir|voice|aah/i, wave: 459, name: "Choir 1A" },
    { match: /bass|acid|303/i, wave: 266, name: "Syn Bass A" },
    { match: /piano|grand/i, wave: 1, name: "StGrand pA L" }
  ];
  function matchBestRolandWave(name = "", fallbackCategory = "saw") {
    const primary = (name || "").toLowerCase();
    for (const entry of WAVE_LOOKUP) {
      if (entry.match.test(primary)) {
        return entry.wave;
      }
    }
    const fallback = (fallbackCategory || "saw").toLowerCase();
    for (const entry of WAVE_LOOKUP) {
      if (entry.match.test(fallback)) {
        return entry.wave;
      }
    }
    return 529;
  }
  function secondsToRolandTime(seconds = 0.01) {
    if (seconds <= 0) return 0;
    if (seconds >= 8) return 127;
    const normalized = Math.log10(seconds + 1e-3) + 3;
    const val = Math.round(normalized / 4 * 127);
    return Math.max(0, Math.min(127, val));
  }
  function hzToRolandCutoff(hz = 2e4) {
    if (hz <= 20) return 0;
    if (hz >= 2e4) return 127;
    const minLog = Math.log10(20);
    const maxLog = Math.log10(2e4);
    const curLog = Math.log10(Math.max(20, Math.min(2e4, hz)));
    const ratio = (curLog - minLog) / (maxLog - minLog);
    return Math.round(ratio * 127);
  }
  function parseVitalPatch(content) {
    const data = typeof content === "string" ? JSON.parse(content) : content;
    const s = data.settings || {};
    const rawName = (data.name || data.author || "VitalPatch").slice(0, 12).toUpperCase();
    const patchName = rawName.replace(/[^A-Z0-9_\- ]/gi, "").padEnd(1, "A").slice(0, 12);
    const osc1On = s.osc_1_on !== 0;
    const osc2On = s.osc_2_on !== 0;
    const osc3On = s.osc_3_on !== 0;
    const sampleOn = s.sample_on !== 0;
    const filterCutoffHz = s.filter_1_cutoff !== void 0 ? Math.pow(2, s.filter_1_cutoff / 12) * 20 : 15e3;
    const cutoff = hzToRolandCutoff(filterCutoffHz);
    const resonance = Math.round((s.filter_1_resonance || 0) * 127);
    let filterType = 1;
    if (s.filter_1_model === 1) filterType = 2;
    else if (s.filter_1_model === 2) filterType = 3;
    const env1Attack = secondsToRolandTime(s.env_1_attack ?? 0.01);
    const env1Decay = secondsToRolandTime(s.env_1_decay ?? 0.8);
    const env1Sustain = Math.round((s.env_1_sustain ?? 0.7) * 127);
    const env1Release = secondsToRolandTime(s.env_1_release ?? 0.4);
    const env2Attack = secondsToRolandTime(s.env_2_attack ?? 0.01);
    const env2Decay = secondsToRolandTime(s.env_2_decay ?? 0.6);
    const env2Sustain = Math.round((s.env_2_sustain ?? 0.4) * 127);
    const env2Release = secondsToRolandTime(s.env_2_release ?? 0.3);
    const monoPoly = s.polyphony && s.polyphony === 1 ? 0 : 1;
    const portamento = s.portamento_time && s.portamento_time > 0 ? 1 : 0;
    const portaTime = Math.round((s.portamento_time || 0) * 127);
    const t1Level = Math.round((s.osc_1_level ?? 0.8) * 127);
    const tone1 = {
      enabled: osc1On,
      waveGroupType: 0,
      waveNumberL: matchBestRolandWave(s.osc_1_wave_frame || "saw", "saw"),
      waveNumberR: 0,
      waveGain: 1,
      toneLevel: t1Level,
      tvaLevel: t1Level,
      tonePan: Math.round(((s.osc_1_pan ?? 0) + 1) * 63.5),
      coarseTune: Math.max(16, Math.min(112, 64 + (s.osc_1_transpose || 0))),
      fineTune: Math.max(14, Math.min(114, 64 + Math.round((s.osc_1_tune || 0) * 50))),
      filterType,
      tvfFilterType: filterType,
      cutoff,
      tvfCutoff: cutoff,
      resonance,
      tvfResonance: resonance,
      tvfEnvDepth: 20,
      tvfEnvT1: env2Attack,
      tvfEnvT2: env2Decay,
      tvfEnvL3: env2Sustain,
      tvfEnvT4: env2Release,
      tvaEnvT1: env1Attack,
      tvaEnvT2: env1Decay,
      tvaEnvL3: env1Sustain,
      tvaEnvT4: env1Release
    };
    const hasOsc2 = osc2On;
    const isUnisonWide = s.osc_1_unison_voices && s.osc_1_unison_voices > 1;
    const t2Level = hasOsc2 ? Math.round((s.osc_2_level ?? 0.7) * 127) : Math.round(tone1.toneLevel * 0.9);
    const tone2 = {
      enabled: hasOsc2 || isUnisonWide,
      waveGroupType: 0,
      waveNumberL: hasOsc2 ? matchBestRolandWave(s.osc_2_wave_frame || "saw", "saw") : tone1.waveNumberL,
      waveNumberR: 0,
      waveGain: 1,
      toneLevel: t2Level,
      tvaLevel: t2Level,
      tonePan: hasOsc2 ? Math.round(((s.osc_2_pan ?? 0) + 1) * 63.5) : isUnisonWide ? 85 : 64,
      coarseTune: hasOsc2 ? Math.max(16, Math.min(112, 64 + (s.osc_2_transpose || 0))) : tone1.coarseTune,
      // Add micro-detuning if replicating unison spread
      fineTune: hasOsc2 ? Math.max(14, Math.min(114, 64 + Math.round((s.osc_2_tune || 0) * 50))) : 68,
      filterType,
      tvfFilterType: filterType,
      cutoff,
      tvfCutoff: cutoff,
      resonance,
      tvfResonance: resonance,
      tvfEnvDepth: 20,
      tvfEnvT1: env2Attack,
      tvfEnvT2: env2Decay,
      tvfEnvL3: env2Sustain,
      tvfEnvT4: env2Release,
      tvaEnvT1: env1Attack,
      tvaEnvT2: env1Decay,
      tvaEnvL3: env1Sustain,
      tvaEnvT4: env1Release
    };
    const t3Level = Math.round((s.osc_3_level ?? 0.7) * 127);
    const tone3 = {
      enabled: osc3On,
      waveGroupType: 0,
      waveNumberL: matchBestRolandWave(s.osc_3_wave_frame || "sine", "sine"),
      waveNumberR: 0,
      waveGain: 1,
      toneLevel: t3Level,
      tvaLevel: t3Level,
      tonePan: Math.round(((s.osc_3_pan ?? 0) + 1) * 63.5),
      coarseTune: Math.max(16, Math.min(112, 64 + (s.osc_3_transpose || -12))),
      fineTune: Math.max(14, Math.min(114, 64 + Math.round((s.osc_3_tune || 0) * 50))),
      filterType,
      tvfFilterType: filterType,
      cutoff: Math.min(127, cutoff + 10),
      tvfCutoff: Math.min(127, cutoff + 10),
      resonance: 0,
      tvfResonance: 0,
      tvaEnvT1: env1Attack,
      tvaEnvT2: env1Decay,
      tvaEnvL3: env1Sustain,
      tvaEnvT4: env1Release
    };
    const t4Level = Math.round((s.sample_level ?? 0.3) * 127);
    const tone4 = {
      enabled: sampleOn,
      waveGroupType: 0,
      waveNumberL: matchBestRolandWave("noise", "noise"),
      waveNumberR: 0,
      waveGain: 1,
      toneLevel: t4Level,
      tvaLevel: t4Level,
      tonePan: 64,
      coarseTune: 64,
      fineTune: 64,
      filterType,
      tvfFilterType: filterType,
      cutoff,
      tvfCutoff: cutoff,
      resonance: 0,
      tvfResonance: 0,
      tvaEnvT1: 2,
      tvaEnvT2: 30,
      tvaEnvL3: 0,
      tvaEnvT4: 20
    };
    const tones = [tone1, tone2, tone3, tone4];
    return {
      source: {
        name: data.name || "Vital Preset",
        format: "vital",
        author: data.author || "Unknown",
        version: data.synth_version || "1.0"
      },
      xvPatch: {
        common: {
          name: patchName,
          patchName,
          category: 36,
          // Synth Lead / Pad
          monoPoly,
          legato: 0,
          legatoSwitch: 0,
          portamentoSwitch: portamento,
          portamentoTime: portaTime,
          chorusSend: s.chorus_on ? Math.round((s.chorus_dry_wet || 0.4) * 127) : 0,
          reverbSend: s.reverb_on ? Math.round((s.reverb_dry_wet || 0.3) * 127) : 35,
          patchLevel: 127,
          patchPan: 64,
          coarseTune: 64,
          fineTune: 64,
          octaveShift: 64
        },
        tmt: {
          structureType12: 0,
          structureType34: 0,
          booster12: 0,
          booster34: 0,
          tone1Switch: tone1.enabled ? 1 : 0,
          tone2Switch: tone2.enabled ? 1 : 0,
          tone3Switch: tone3.enabled ? 1 : 0,
          tone4Switch: tone4.enabled ? 1 : 0
        },
        tones,
        tonesObj: { 1: tone1, 2: tone2, 3: tone3, 4: tone4 }
      },
      mappingReport: {
        engine: "Vital Spectral Wavetable Synth",
        oscillatorsMapped: [
          { osc: "Osc 1", mappedTo: `Tone 1: Wave #${tone1.waveNumberL} (${INTERNAL_WAVEFORMS[tone1.waveNumberL - 1] || "Saw"})` },
          { osc: "Osc 2 / Unison", mappedTo: `Tone 2: Wave #${tone2.waveNumberL} (Detuned)` },
          { osc: "Osc 3 / Sub", mappedTo: `Tone 3: Wave #${tone3.waveNumberL}` },
          { osc: "Noise", mappedTo: `Tone 4: Wave #${tone4.waveNumberL}` }
        ],
        filter: `TVF LPF (Cutoff: ${cutoff}, Res: ${resonance})`,
        envelopes: `TVA (A:${env1Attack}, D:${env1Decay}, S:${env1Sustain}, R:${env1Release})`,
        effects: `Chorus: ${s.chorus_on ? "Active" : "Bypass"}, Reverb: ${s.reverb_on ? "Active" : "Bypass"}`
      }
    };
  }
  function parseFxpPatch(buffer) {
    const bytes = new Uint8Array(buffer instanceof ArrayBuffer ? buffer : buffer.buffer);
    const magic = String.fromCharCode(bytes[0], bytes[1], bytes[2], bytes[3]);
    if (magic !== "CcnK") {
      throw new Error(`Invalid FXP header: expected "CcnK", got "${magic}"`);
    }
    let rawName = "";
    for (let i = 28; i < 56; i++) {
      if (bytes[i] === 0) break;
      rawName += String.fromCharCode(bytes[i]);
    }
    const patchName = (rawName.trim() || "FXPPATCH").replace(/[^A-Z0-9_\- ]/gi, "").padEnd(1, "A").slice(0, 12).toUpperCase();
    const decoder = new TextDecoder("utf-8", { fatal: false });
    const rawText = decoder.decode(bytes);
    const isSerum = /serum|xfer/i.test(rawText);
    let cutoff = 110;
    let resonance = 15;
    let wave1 = 529;
    let wave2 = 535;
    if (/acid|303/i.test(rawText)) {
      cutoff = 75;
      resonance = 65;
      wave1 = 266;
    } else if (/pad|ambient|lush/i.test(rawText)) {
      cutoff = 85;
      resonance = 10;
      wave1 = 424;
    } else if (/pluck|bell/i.test(rawText)) {
      cutoff = 50;
      resonance = 25;
      wave1 = 503;
    }
    const tone1 = {
      enabled: true,
      waveGroupType: 0,
      waveNumberL: wave1,
      waveNumberR: 0,
      waveGain: 1,
      toneLevel: 125,
      tvaLevel: 125,
      tonePan: 56,
      coarseTune: 64,
      fineTune: 61,
      // -3 cents detune
      filterType: 1,
      tvfFilterType: 1,
      cutoff,
      tvfCutoff: cutoff,
      resonance,
      tvfResonance: resonance,
      tvaEnvT1: 2,
      tvaEnvT2: 60,
      tvaEnvL3: 90,
      tvaEnvT4: 35
    };
    const tone2 = {
      enabled: true,
      waveGroupType: 0,
      waveNumberL: wave2,
      waveNumberR: 0,
      waveGain: 1,
      toneLevel: 125,
      tvaLevel: 125,
      tonePan: 72,
      coarseTune: 64,
      fineTune: 67,
      // +3 cents detune
      filterType: 1,
      tvfFilterType: 1,
      cutoff,
      tvfCutoff: cutoff,
      resonance,
      tvfResonance: resonance,
      tvaEnvT1: 2,
      tvaEnvT2: 60,
      tvaEnvL3: 90,
      tvaEnvT4: 35
    };
    const tone3 = {
      enabled: true,
      waveGroupType: 0,
      waveNumberL: 883,
      // Low Sine Sub
      waveNumberR: 0,
      waveGain: 1,
      toneLevel: 100,
      tvaLevel: 100,
      tonePan: 64,
      coarseTune: 52,
      // Sub octave
      fineTune: 64,
      filterType: 1,
      tvfFilterType: 1,
      cutoff: 127,
      tvfCutoff: 127,
      resonance: 0,
      tvfResonance: 0,
      tvaEnvT1: 0,
      tvaEnvT2: 70,
      tvaEnvL3: 110,
      tvaEnvT4: 25
    };
    const tone4 = {
      enabled: false,
      waveGroupType: 0,
      waveNumberL: 576,
      // White Noise
      waveNumberR: 0,
      waveGain: 1,
      toneLevel: 0,
      tvaLevel: 0,
      tonePan: 64,
      coarseTune: 64,
      fineTune: 64,
      filterType: 1,
      tvfFilterType: 1,
      cutoff: 127,
      tvfCutoff: 127,
      resonance: 0,
      tvfResonance: 0
    };
    const tones = [tone1, tone2, tone3, tone4];
    return {
      source: {
        name: patchName,
        format: "fxp",
        engine: isSerum ? "Xfer Serum" : "Steinberg VST2 Preset"
      },
      xvPatch: {
        common: {
          name: patchName,
          patchName,
          category: 36,
          monoPoly: 1,
          legato: 0,
          legatoSwitch: 0,
          portamentoSwitch: 0,
          portamentoTime: 0,
          chorusSend: 45,
          reverbSend: 40,
          patchLevel: 127,
          patchPan: 64,
          coarseTune: 64,
          fineTune: 64,
          octaveShift: 64
        },
        tmt: {
          structureType12: 0,
          structureType34: 0,
          booster12: 0,
          booster34: 0,
          tone1Switch: 1,
          tone2Switch: 1,
          tone3Switch: 1,
          tone4Switch: 0
        },
        tones,
        tonesObj: { 1: tone1, 2: tone2, 3: tone3, 4: tone4 }
      },
      mappingReport: {
        engine: isSerum ? "Xfer Serum VST Preset (.fxp)" : "Steinberg VST2 Preset (.fxp)",
        oscillatorsMapped: [
          { osc: "Osc A", mappedTo: `Tone 1: Wave #${tone1.waveNumberL} (${INTERNAL_WAVEFORMS[tone1.waveNumberL - 1] || "Saw"})` },
          { osc: "Osc B (Detuned)", mappedTo: `Tone 2: Wave #${tone2.waveNumberL} (+3 cents)` },
          { osc: "Sub Osc", mappedTo: `Tone 3: Sub Sine -12st` }
        ],
        filter: `TVF LPF (Cutoff: ${cutoff}, Res: ${resonance})`,
        envelopes: "TVA 4-Point Multi-Tone Envelope",
        effects: "Master Chorus & Reverb Space Sends"
      }
    };
  }
  var VST_DEMO_PATCHES = [
    {
      id: "vital_cyberpunk_reese",
      name: "Cyberpunk Reese Bass",
      engine: "Vital Synth",
      category: "Bass",
      data: {
        name: "CyberReese",
        author: "ModernVST",
        synth_version: "1.5.5",
        settings: {
          polyphony: 1,
          portamento_time: 0.12,
          osc_1_on: 1,
          osc_1_wave_frame: "detuned saw",
          osc_1_unison_voices: 4,
          osc_1_transpose: -12,
          osc_1_level: 0.9,
          osc_2_on: 1,
          osc_2_wave_frame: "pulse pwm",
          osc_2_transpose: -12,
          osc_2_tune: 0.08,
          osc_2_level: 0.85,
          osc_3_on: 1,
          osc_3_wave_frame: "sub sine",
          osc_3_transpose: -24,
          osc_3_level: 1,
          filter_1_model: 0,
          filter_1_cutoff: 65,
          filter_1_resonance: 0.25,
          env_1_attack: 5e-3,
          env_1_decay: 0.8,
          env_1_sustain: 0.9,
          env_1_release: 0.25,
          chorus_on: 1,
          chorus_dry_wet: 0.35,
          reverb_on: 1,
          reverb_dry_wet: 0.15
        }
      }
    },
    {
      id: "serum_hypersaw_pluck",
      name: "Euphoric Trance Pluck",
      engine: "Serum VST",
      category: "Pluck",
      data: {
        name: "TrancePluck",
        author: "XferSound",
        synth_version: "1.36",
        settings: {
          polyphony: 8,
          portamento_time: 0,
          osc_1_on: 1,
          osc_1_wave_frame: "jp-8 saw",
          osc_1_unison_voices: 7,
          osc_1_level: 0.9,
          osc_2_on: 1,
          osc_2_wave_frame: "supersaw",
          osc_2_tune: 0.06,
          osc_2_level: 0.85,
          filter_1_model: 0,
          filter_1_cutoff: 45,
          filter_1_resonance: 0.35,
          env_1_attack: 2e-3,
          env_1_decay: 0.45,
          env_1_sustain: 0,
          env_1_release: 0.35,
          env_2_attack: 2e-3,
          env_2_decay: 0.3,
          env_2_sustain: 0,
          env_2_release: 0.25,
          chorus_on: 1,
          chorus_dry_wet: 0.5,
          reverb_on: 1,
          reverb_dry_wet: 0.45
        }
      }
    },
    {
      id: "vital_ambient_pad",
      name: "Ethereal Cosmic Pad",
      engine: "Vital Synth",
      category: "Pad",
      data: {
        name: "CosmicPad",
        author: "DeepSpace",
        synth_version: "1.5.5",
        settings: {
          polyphony: 8,
          portamento_time: 0,
          osc_1_on: 1,
          osc_1_wave_frame: "warm strings",
          osc_1_level: 0.85,
          osc_2_on: 1,
          osc_2_wave_frame: "choir aahs",
          osc_2_tune: 0.04,
          osc_2_level: 0.75,
          osc_3_on: 1,
          osc_3_wave_frame: "bell wave",
          osc_3_transpose: 12,
          osc_3_level: 0.5,
          sample_on: 1,
          sample_level: 0.15,
          filter_1_model: 0,
          filter_1_cutoff: 75,
          filter_1_resonance: 0.1,
          env_1_attack: 1.2,
          env_1_decay: 2.5,
          env_1_sustain: 0.85,
          env_1_release: 2,
          chorus_on: 1,
          chorus_dry_wet: 0.6,
          reverb_on: 1,
          reverb_dry_wet: 0.7
        }
      }
    }
  ];
  async function transpileVstFile(input, fileName = "") {
    let text = "";
    let buffer = null;
    if (typeof input === "string") {
      text = input;
    } else if (input instanceof Blob || input instanceof File) {
      fileName = fileName || input.name;
      if (fileName.toLowerCase().endsWith(".fxp")) {
        buffer = await input.arrayBuffer();
      } else {
        text = await input.text();
      }
    } else if (input instanceof ArrayBuffer) {
      buffer = input;
    }
    const lowerName = fileName.toLowerCase();
    if (lowerName.endsWith(".fxp") || buffer && !text) {
      return parseFxpPatch(buffer);
    }
    if (lowerName.endsWith(".vital") || text.includes("synth_version") || text.includes("osc_1_")) {
      return parseVitalPatch(text);
    }
    try {
      const json = JSON.parse(text);
      if (json.settings || json.synth_version) {
        return parseVitalPatch(json);
      }
      return parseVitalPatch({ settings: json, name: fileName.replace(/\.[^/.]+$/, "") });
    } catch (e) {
      throw new Error(`Unsupported or unrecognized VST preset format for "${fileName}". Expected .vital, .fxp, or synth JSON.`);
    }
  }
  function buildTranspiledPatchSyx(transpiled, part = 1, deviceId = 16) {
    if (!transpiled || !transpiled.xvPatch) {
      throw new Error("Invalid transpiled patch structure");
    }
    const common = transpiled.xvPatch.common || {};
    const tmt = transpiled.xvPatch.tmt || {};
    const tones = Array.isArray(transpiled.xvPatch.tones) ? transpiled.xvPatch.tones : [transpiled.xvPatch.tones[1], transpiled.xvPatch.tones[2], transpiled.xvPatch.tones[3], transpiled.xvPatch.tones[4]];
    const commonBytes = new Array(79).fill(0);
    const patchName = (common.name || common.patchName || "VST PATCH").padEnd(12, " ").slice(0, 12);
    for (let i = 0; i < 12; i++) commonBytes[i] = patchName.charCodeAt(i);
    commonBytes[14] = common.patchLevel ?? 127;
    commonBytes[15] = common.patchPan ?? 64;
    commonBytes[17] = common.coarseTune ?? 64;
    commonBytes[18] = common.fineTune ?? 64;
    commonBytes[20] = common.monoPoly ?? 1;
    commonBytes[21] = common.legatoSwitch ?? common.legato ?? 0;
    commonBytes[22] = common.portamentoSwitch ?? 0;
    commonBytes[23] = common.portamentoTime ?? 0;
    const tmtBytes = new Array(41).fill(0);
    tmtBytes[0] = tmt.structureType12 ?? 0;
    tmtBytes[1] = tmt.booster12 ?? 0;
    tmtBytes[2] = tones[0]?.enabled ?? true ? 1 : 0;
    tmtBytes[3] = tones[1]?.enabled ?? false ? 1 : 0;
    tmtBytes[4] = tmt.structureType34 ?? 0;
    tmtBytes[5] = tmt.booster34 ?? 0;
    tmtBytes[6] = tones[2]?.enabled ?? false ? 1 : 0;
    tmtBytes[7] = tones[3]?.enabled ?? false ? 1 : 0;
    const tonesData = [];
    for (let t = 0; t < 4; t++) {
      const toneBytes = new Array(265).fill(0);
      const tone = tones[t] || {};
      const isEnabled = tone.enabled ?? t === 0;
      toneBytes[0] = tone.tvaLevel ?? tone.toneLevel ?? (isEnabled ? 127 : 0);
      toneBytes[1] = tone.coarseTune ?? 64;
      toneBytes[2] = tone.fineTune ?? 64;
      toneBytes[4] = tone.tonePan ?? 64;
      const grp = tone.waveGroupType ?? 0;
      toneBytes[39] = grp;
      const wNumL = tone.waveNumberL ?? (t === 0 ? 1 : 0);
      toneBytes[44] = wNumL >> 12 & 15;
      toneBytes[45] = wNumL >> 8 & 15;
      toneBytes[46] = wNumL >> 4 & 15;
      toneBytes[47] = wNumL & 15;
      const wNumR = tone.waveNumberR ?? 0;
      toneBytes[48] = wNumR >> 12 & 15;
      toneBytes[49] = wNumR >> 8 & 15;
      toneBytes[50] = wNumR >> 4 & 15;
      toneBytes[51] = wNumR & 15;
      toneBytes[52] = tone.waveGain ?? 1;
      toneBytes[72] = tone.tvfFilterType ?? tone.filterType ?? 1;
      toneBytes[73] = tone.tvfCutoff ?? tone.cutoff ?? 127;
      toneBytes[77] = tone.tvfResonance ?? tone.resonance ?? 0;
      toneBytes[79] = tone.tvfEnvDepth ?? 64;
      toneBytes[85] = tone.tvfEnvT1 ?? 15;
      toneBytes[86] = tone.tvfEnvT2 ?? 25;
      toneBytes[88] = tone.tvfEnvT4 ?? 40;
      toneBytes[91] = tone.tvfEnvL3 ?? 64;
      toneBytes[98] = tone.tvaLevel ?? tone.toneLevel ?? (isEnabled ? 127 : 0);
      toneBytes[102] = tone.tvaEnvT1 ?? 10;
      toneBytes[103] = tone.tvaEnvT2 ?? 20;
      toneBytes[104] = tone.tvaEnvT3 ?? 40;
      toneBytes[105] = tone.tvaEnvT4 ?? 30;
      toneBytes[108] = tone.tvaEnvL3 ?? 70;
      tonesData.push(toneBytes);
    }
    const packets = createPatchSyxDump(part, commonBytes, tmtBytes, tonesData, deviceId);
    const syxBytes = exportToSyx(packets);
    return { packets, syxBytes, commonBytes, tmtBytes, tonesData };
  }

  // src/preset_patches.js
  var ROLAND_USER_DEFAULT_PATCHES = [
    "Rhodes Trem",
    "Hydrogen",
    "Groovedigger",
    "Miasma",
    "Thick Steel",
    "Hold A Chord",
    "Aftertouchin",
    "Talking Box",
    "GenerationXV",
    "Ionizer",
    "Piano+AirPad",
    "Wurly Gum",
    "Voxfuzz Klav",
    "Soaring Hrns",
    "Ambi Voices",
    "Solo SoprSax",
    "Lunar Strngs",
    "BrushingSaw1",
    "R&Ballad Mix",
    "Xtremities",
    "Fat Strings",
    "Throbulax",
    "GlobalWarmup",
    "Vortex",
    "Sub Zero",
    "Rhythm Sync",
    "OvertoneScan",
    "20.000 miles",
    "Chordbender",
    "Atlantis",
    "Buster Bass",
    "Two+Ensemble",
    "Enchanted XV",
    "Double Helix",
    "Blue Mutes",
    "Wedding Mass",
    "Grounded Bs",
    "Vocovox Wave",
    "Lead 4x Vlns",
    "PhazeWahClav",
    "Digibell Pad",
    "Rocker Org",
    "Pianomonics",
    "Plug n' Play",
    "Crying Solo",
    "Grand XV",
    "LookMaNoFret",
    "TB Squelch",
    "Henry VIII",
    "Reel Slam",
    "SwellEnsembl",
    "Amped Wurlie",
    "NewR&RBrass",
    "Triumph Brs",
    "McThrob",
    "Soaring Sqr",
    "Over the top",
    "Power Stack",
    "Contemplate",
    "Rholitzer",
    "Chime Bells",
    "IslandSpirit",
    "Distorted B",
    "Double Steel",
    "COSM Searing",
    "XV Upright",
    "Muscle Bass",
    "Brassy Symph",
    "BiggieBrass2",
    "Peking Opera",
    "5th Element",
    "MetaXV",
    "Traffic Pad",
    "5ths in 4ths",
    "Trance Fair",
    "Spectre",
    "Borealis",
    "Cutting X",
    "Blues Harp",
    "Brash Bass",
    "Saw Grits",
    "LegatoJupitr",
    "Tape Orch",
    "FatSynBrass",
    "UltraSmooth",
    "Spread Pad",
    "West End Bs",
    "Phunky DC",
    "Valve Job",
    "BatonStrings",
    "ClassicJPpad",
    "VeloClikOrgn",
    "Soft Nylon",
    "Swell Strat",
    "Tap Bass",
    "Ticker Bass",
    "VoyagerBrass",
    "Swingin'Bari",
    "Bend a Chord",
    "Flyin' High",
    "Try this!",
    "Tekno Pizz",
    "Complex Echo",
    "BadJuju",
    "Silk Road",
    "2.2 Strings",
    "Brite Vox 1",
    "MinorIncidnt",
    "SparklePiano",
    "Fat Rhodes",
    "Verby Organ",
    "Prelude",
    "BoutiqueSine",
    "Froggy Bass",
    "Digisquelch",
    "Galactic",
    "Generator",
    "Funky Tube",
    "Dream 2002",
    "11th Space",
    "Etheraaahl",
    "Tape Q",
    "EastrnEurope",
    "TempoMadness 4",
    "Phaser Dyno",
    "8VCO MonoSyn",
    "TechnoSurf 1",
    "Cold Roadz"
  ];
  var ROLAND_PRESET_A_PATCHES = [
    "64voicePiano",
    "Bright Piano",
    "Classique",
    "Nice Piano",
    "Piano Thang",
    "Power Grand",
    "House Piano",
    "E.Grand",
    "MIDIed Grand",
    "Piano Blend",
    "West Coast",
    "PianoStrings",
    "Bs/Pno+Brs",
    "Waterhodes",
    "S.A.E.P.",
    "SA Rhodes 1",
    "SA Rhodes 2",
    "Stiky Rhodes",
    "Dig Rhodes",
    "Nylon EPiano",
    "Nylon Rhodes",
    "Rhodes Mix",
    "PsychoRhodes",
    "Tremo Rhodes",
    "MK-80 Rhodes",
    "MK-80 Phaser",
    "Delicate EP",
    "Octa Rhodes1",
    "Octa Rhodes2",
    "JV Rhodes+",
    "EP+Mod Pad",
    "Mr.Mellow",
    "Comp Clav",
    "Klavinet",
    "Winger Clav",
    "Phaze Clav 1",
    "Phaze Clav 2",
    "Phuzz Clav",
    "Chorus Clav",
    "Claviduck",
    "Velo-Rez Clv",
    "Clavicembalo",
    "Analog Clav1",
    "Analog Clav2",
    "Metal Clav",
    "Full Stops",
    "Ballad B",
    "Mellow Bars",
    "AugerMentive",
    "Perky B",
    "The Big Spin",
    "Gospel Spin",
    "Roller Spin",
    "Rocker Spin",
    "Tone Wh.Solo",
    "Purple Spin",
    "60's LeadORG",
    "Assalt Organ",
    "D-50 Organ",
    "Cathedral",
    "Church Pipes",
    "Poly Key",
    "Poly Saws",
    "Poly Pulse",
    "Dual Profs",
    "Saw Mass",
    "Poly Split",
    "Poly Brass",
    "Stackoid",
    "Poly Rock",
    "D-50 Stack",
    "Fantasia JV",
    "Jimmee Dee",
    "Heavenals",
    "Mallet Pad",
    "Huff N Stuff",
    "Puff 1080",
    "BellVox 1080",
    "Fantasy Vox",
    "Square Keys",
    "Childlike",
    "Music Box",
    "Toy Box",
    "Wave Bells",
    "Tria Bells",
    "Beauty Bells",
    "Music Bells",
    "Pretty Bells",
    "Pulse Key",
    "Wide Tubular",
    "AmbienceVibe",
    "Warm Vibes",
    "Dyna Marimba",
    "Bass Marimba",
    "Nomad Perc",
    "Ethno Metals",
    "Islands Mlt",
    "Steelin Keys",
    "Steel Drums",
    "Voicey Pizz",
    "Sitar",
    "Drone Split",
    "Ethnopluck",
    "Jamisen",
    "Dulcimer",
    "East Melody",
    "MandolinTrem",
    "Nylon Gtr",
    "Gtr Strings",
    "Steel Away",
    "Heavenly Gtr",
    "12str Gtr 1",
    "12str Gtr 2",
    "Jz Gtr Hall",
    "LetterFrmPat",
    "Jazz Scat",
    "Lounge Gig",
    "JC Strat",
    "Twin Strats",
    "JV Strat",
    "Syn Strat",
    "Rotary Gtr",
    "Muted Gtr",
    "SwitchOnMute",
    "Power Trip",
    "Crunch Split",
    "Rezodrive",
    "RockYurSocks"
  ];
  var ROLAND_PRESET_B_PATCHES = [
    "Dist Gtr 1",
    "Dist Gtr 2",
    "R&R Chunk",
    "Phripphuzz",
    "Grungeroni",
    "Black Widow",
    "Velo-Wah Gtr",
    "Mod-Wah Gtr",
    "Pick Bass",
    "Hip Bass",
    "Perc.Bass",
    "Homey Bass",
    "Finger Bass",
    "Nylon Bass",
    "Ac.Upright",
    "Wet Fretls",
    "Fretls Dry",
    "Slap Bass 1",
    "Slap Bass 2",
    "Slap Bass 3",
    "Slap Bass 4",
    "4 Pole Bass",
    "Tick Bass",
    "House Bass",
    "Mondo Bass",
    "Clk AnalogBs",
    "Bass In Face",
    "101 Bass",
    "Noiz Bass",
    "Super Jup Bs",
    "Occitan Bass",
    "Hugo Bass",
    "Multi Bass",
    "Moist Bass",
    "BritelowBass",
    "Untamed Bass",
    "Rubber Bass",
    "Stereoww Bs",
    "Wonder Bass",
    "Deep Bass",
    "Super JX Bs",
    "W<RED>-Bass",
    "HI-Ring Bass",
    "Euro Bass",
    "SinusoidRave",
    "Alternative",
    "Acid Line",
    "Auto TB-303",
    "Hihat Tekno",
    "Velo Tekno 1",
    "Raggatronic",
    "Blade Racer",
    "S&H Pad",
    "Syncrosonix",
    "Fooled Again",
    "Alive",
    "Velo Tekno 2",
    "Rezoid",
    "Raverborg",
    "Blow Hit",
    "Hammer Bell",
    "Seq Mallet",
    "Intentions",
    "Pick It",
    "Analog Seq",
    "Impact Vox",
    "TeknoSoloVox",
    "X-Mod Man",
    "Paz <==> Zap",
    "4 Hits 4 You",
    "Impact",
    "Phase Hit",
    "Tekno Hit 1",
    "Tekno Hit 2",
    "Tekno Hit 3",
    "Reverse Hit",
    "SquareLead 1",
    "SquareLead 2",
    "You and Luck",
    "Belly Lead",
    "WhistlinAtom",
    "Edye Boost",
    "MG Solo",
    "FXM Saw Lead",
    "Sawteeth",
    "Smoothe",
    "MG Lead",
    "MG Interval",
    "Pulse Lead 1",
    "Pulse Lead 2",
    "Little Devil",
    "Loud SynLead",
    "Analog Lead",
    "5th Lead",
    "Flute",
    "Piccolo",
    "VOX Flute",
    "Air Lead",
    "Pan Pipes",
    "Airplaaane",
    "Taj Mahal",
    "Raya Shaku",
    "Oboe mf",
    "Oboe Express",
    "Clarinet mp",
    "ClariExpress",
    "Mitzva Split",
    "ChamberWinds",
    "ChamberWoods 3",
    "Film Orch",
    "Sop.Sax mf",
    "Alto Sax",
    "AltoLead Sax",
    "Tenor Sax",
    "Baritone Sax",
    "Take A Tenor",
    "Sax Section",
    "Bigband Sax",
    "Harmonica",
    "Harmo Blues",
    "BluesHarp",
    "Hillbillys",
    "French Bags",
    "Majestic Tpt",
    "Voluntare",
    "2Trumpets",
    "Tpt Sect",
    "Mute TP mod"
  ];
  var ROLAND_PRESET_C_PATCHES = [
    "Harmon Mute",
    "Tp&Sax Sect",
    "Sax+Tp+Tb",
    "Brass Sect",
    "Trombone",
    "Hybrid Bones",
    "Noble Horns",
    "Massed Horns",
    "Horn Swell",
    "Brass It!",
    "Brass Attack",
    "Archimede",
    "Rugby Horn",
    "MKS-80 Brass",
    "True ANALOG",
    "Dark Vox",
    "RandomVowels",
    "Angels Sing",
    "Pvox Oooze",
    "Longing...",
    "Arasian Morn",
    "Beauty Vox",
    "Mary-AnneVox",
    "Belltree Vox",
    "Vox Panner",
    "Spaced Voxx",
    "Glass Voices",
    "Tubular Vox",
    "Velo Voxx",
    "Wavox",
    "Doos",
    "Synvox Comps",
    "Vocal Oohz",
    "LFO Vox",
    "St.Strings",
    "Warm Strings",
    "Somber Str",
    "Marcato",
    "Bright Str",
    "String Ens",
    "TremoloStrng",
    "Chambers",
    "ViolinCello",
    "Symphonique",
    "Film Octaves",
    "Film Layers",
    "Bass Pizz",
    "Real Pizz",
    "Harp On It",
    "Harp",
    "JP-8 Str 1",
    "JP-8 Str 2",
    "E-Motion Pad",
    "JP-8 Str 3",
    "Vintage Orch",
    "JUNO Strings",
    "Gigantalog",
    "PWM Strings",
    "Warmth",
    "ORBit Pad",
    "Deep Strings",
    "Pulsify",
    "Pulse Pad",
    "Greek Power",
    "Harmonicum",
    "D-50 Heaven",
    "Afro Horns",
    "Pop Pad",
    "Dreamesque",
    "Square Pad",
    "JP-8 Hollow",
    "JP-8Haunting",
    "Heirborne",
    "Hush Pad",
    "Jet Pad 1",
    "Jet Pad 2",
    "Phaze Pad",
    "Phaze Str",
    "Jet Str Ens",
    "Pivotal Pad",
    "3D Flanged",
    "Fantawine",
    "Glassy Pad",
    "Moving Glass",
    "Glasswaves",
    "Shiny Pad",
    "ShiftedGlass",
    "Chime Pad",
    "Spin Pad",
    "Rotary Pad",
    "Dawn 2 Dusk",
    "Aurora",
    "Strobe Mode",
    "Albion",
    "Running Pad",
    "Stepped Pad",
    "Random Pad",
    "SoundtrkDANC",
    "Flying Waltz",
    "Vanishing",
    "5th Sweep",
    "Phazweep",
    "Big BPF",
    "MG Sweep",
    "CeremonyTimp",
    "Dyno Toms",
    "Sands ofTime",
    "Inertia",
    "Vektogram",
    "Crash Pad",
    "Feedback VOX",
    "Cascade",
    "Shattered",
    "NextFrontier",
    "Pure Tibet",
    "Chime Wash",
    "Night Shade",
    "Tortured",
    "Dissimilate",
    "Dunes",
    "Ocean Floor",
    "Cyber Space",
    "Biosphere",
    "Variable Run",
    "Ice Hall",
    "ComputerRoom",
    "Inverted",
    "Terminate"
  ];
  var ROLAND_PRESET_D_PATCHES = [
    "Echo Piano",
    "Upright Pno",
    "RD-1000",
    "Player's EP",
    "D-50 Rhodes",
    "Innocent EP",
    "Echo Rhodes",
    "See-Thru EP",
    "FM BellPiano",
    "Ring E.Piano",
    "Soap Opera",
    "Dirty Organ",
    "Surf's Up!",
    "Organesque",
    "pp Harmonium",
    "PieceOfCheez",
    "Harpsy Clav",
    "Exotic Velo",
    "HolidayCheer",
    "Morning Lite",
    "Prefab Chime",
    "Belfry Chime",
    "Stacc.Heaven",
    "2.2 Bell Pad",
    "Far East",
    "Wire Pad",
    "PhaseBlipper",
    "Sweep Clav",
    "Glider",
    "Solo Steel",
    "DesertCrystl",
    "Clear Guitar",
    "Solo Strat",
    "Feed Me!",
    "Tube Smoke",
    "Creamy",
    "Blusey OD",
    "Grindstone",
    "OD 5ths",
    "East Europe",
    "Dulcitar",
    "Atmos Harp",
    "Pilgrimage",
    "202 Rude Bs",
    "2pole Bass",
    "4pole Bass",
    "Phaser MC",
    "Miniphaser",
    "Acid TB",
    "Full Orchest",
    "Str + Winds",
    "Flute 2080",
    "Scat Flute",
    "Sax Choir",
    "Ballad Trump",
    "Sm.Brass Grp",
    "Royale",
    "Brass Mutes",
    "Breathy Brs",
    "3 Osc Brass",
    "P5 Polymod",
    "Triumph Brs",
    "Techno Dream",
    "Organizer",
    "Civilization",
    "Mental Chord",
    "House Chord",
    "Sequalog",
    "Booster Bips",
    "VintagePlunk",
    "Plik-Plok",
    "RingSequence",
    "Cyber Swing",
    "Keep :-)",
    "Resojuice",
    "B'on d'moov!",
    "Dist TB-303",
    "Temple of JV",
    "Planet Asia",
    "Afterlife",
    "Trancing Pad",
    "Pulsatronic",
    "Cyber Dreams",
    "Warm Pipe",
    "Pure Pipe",
    "SH-2000",
    "X..? Whistle",
    "Jay Vee Solo",
    "Progresso Ld",
    "Adrenaline",
    "Enlighten",
    "Glass Blower",
    "Earth Blow",
    "JX SqrCarpet",
    "Dimensional",
    "Jupiterings",
    "Analog Drama",
    "Rich Dynapad",
    "Silky Way",
    "Gluey Pad",
    "BandPass Mod",
    "Soundtraque",
    "Translucence",
    "Darkshine",
    "D'light",
    "December Sky",
    "Octapad",
    "JUNO Power!",
    "Spectrum Mod",
    "Stringsheen",
    "GR500 TmpDly",
    "Mod DirtyWav",
    "Silicon Str",
    "D50FantaPerc",
    "Rotodreams",
    "Blue Notes",
    "RiversOfTime",
    "Phobos",
    "2 0 8 0",
    "Unearthly",
    "Glistening",
    "Sci-Fi Str",
    "Shadows",
    "Helium Queen",
    "Sci-Fi FX x4",
    "Perky Noize",
    "Droplet",
    "Rain Forest"
  ];
  var ROLAND_PRESET_E_PATCHES = [
    "Grand XV",
    "Contemplate",
    "Rock Piano",
    "RockPiano Ch",
    "Pianomonics",
    "Piano+SftPad",
    "WarmVoxPiano",
    "Y2K Concerto",
    "Piano+AirPad",
    "ChoraLeader",
    "SparklePiano",
    "Retro Rhodes",
    "Fat Rhodes",
    "Rhodes Trem",
    "Phaser Dyno",
    "Hit Rhodes",
    "Sweet Tynes",
    "Pluk Rhodes",
    "Rhodes Trip",
    "AmbiRhodes",
    "Rholitzer",
    "Wurlie",
    "FM Delight",
    "Cutter Clav",
    "Mute Clav D6",
    "PhazeWahClav",
    "St.Harpsichd",
    "3PartInventn",
    "Soft Perky",
    "Fullness",
    "Paleface 1",
    "Paleface 2",
    "Soft B",
    "British B",
    "Rocker Org",
    "Split B",
    "PercInterval",
    "Happy 60s",
    "96 Years",
    "Glory Us Rok",
    "Church Harmn",
    "Cathdr Harmn",
    "Morph Pad",
    "Air Pad",
    "Soft Padding",
    "Warmth Pad",
    "ClassicJPpad",
    "Jupiter Str",
    "Fat Pad",
    "GR700 Pad",
    "Paradise",
    "Moonchimes",
    "SusPed Swap",
    "PhasingPad",
    "Ethereal Str",
    "Velcropad",
    "NothrnLights",
    "Sun Dive",
    "Brite Vox 1",
    "Brite Vox 2",
    "Ooh)Aah Mod",
    "Vocals: Ooh",
    "Vocals: Scat",
    "Vocals: Boys",
    "St. Choir",
    "SampleThe80s",
    "Sacred Tree",
    "VP330 OctEko",
    "XV Strings",
    "Fat Strings",
    "Dolce p/m/f",
    "Sad Strings",
    "Lush Strings",
    "Strings4Film",
    "Marcato Str",
    "End Titles",
    "ChmbrQuartet",
    "ChamberSect.",
    "FullChmbrStr",
    "Tape Strings",
    "Henry VIII",
    "Prelude",
    "Str&Brs Orch",
    "Hornz",
    "TudorFanfare",
    "ChamberPlyrs",
    "Flute/Clari",
    "Orch Reeds",
    "Dual Flutes",
    "Jazzer Flute",
    "LegatoBamboo",
    "Ambience Flt",
    "The Andes",
    "Deja Vlute",
    "Simply Brass",
    "FullSt Brass",
    "Dragnet",
    "NewR&RBrass",
    "Tower Trumps",
    "BigBrassBand",
    "Lil'BigHornz",
    "VoyagerBrass",
    "Symph Horns",
    "Trombone Atm",
    "XV Trombone",
    "XV Trumpet",
    "JupiterHorns",
    "Solo SoprSax",
    "Solo AltoSax",
    "XV DynoTenor",
    "Honker Bari",
    "Full Saxz",
    "Soaring Hrns",
    "Glass Orbit",
    "5th Atm /Aft",
    "Lo-fi Sweep",
    "Modular Life",
    "Oscillations",
    "Combing",
    "Rolling 5ths",
    "Analogue Str",
    "Lunar Strngs",
    "BPFsweep Mod",
    "Queen V",
    "SkinnyBounce",
    "SquareBounce",
    "Galactic",
    "Powerwiggle"
  ];
  var ROLAND_PRESET_F_PATCHES = [
    "80s Retrosyn",
    "Power Stack",
    "Don't Jump",
    "Big Bubbles",
    "X-mod Sweep",
    "Bag O' Bones",
    "AirSoThin",
    "Analogical",
    "Waspy Pulse",
    "Soaring Saws",
    "Square Roots",
    "BOG",
    "Talking Box",
    "Retro Lead",
    "LivingInSync",
    "Leads United",
    "Dirty Sync",
    "DistortaSync",
    "Blistering",
    "Guttural",
    "Flyin' High",
    "Soft Tooth",
    "Soaring Sqr",
    "Soaring Sync",
    "Nasal Spray",
    "Lamb Lead",
    "Creamer",
    "Sine System",
    "Soft Nylon",
    "Nylozzicato",
    "Mutezzicato",
    "Hybrid Nylon",
    "XV SteelGt 1",
    "XV SteelGt 2",
    "Comp'Steel",
    "Double Steel",
    "Folk Guitar",
    "SpanishNight",
    "Plug n' Play",
    "Fab 4 Guitar",
    "Searing Lead",
    "Punker",
    "LouderPlease",
    "XV Upright",
    "XV Ac.Bass",
    "LookMaNoFret",
    "XV Fretless",
    "Basic F'less",
    "8-str F'less",
    "Tap Bass",
    "Pop Bass",
    "P.Bs Chorus",
    "TremCho Bs",
    "Creamy Bass",
    "Buster Bass",
    "TB Squelch",
    "Ticker Bass",
    "Muscle Bass",
    "Grounded Bs",
    "West End Bs",
    "Snap Bass",
    "700 Bassboy",
    "8VCO MonoSyn",
    "ResoMoist Bs",
    "Kickin' Bass",
    "Sub Zero",
    "Liquid Bass",
    "Hefty Bass",
    "Severe Ow Bs",
    "Chime Bells",
    "Celestabox",
    "Brass Tubes",
    "Dreams East",
    "Synergistic",
    "Andreas Cave",
    "AmbiPizza",
    "Voxy Nylon",
    "EastrnEurope",
    "Celtic Harp",
    "Reso Sitar",
    "The Ganges",
    "MountainFolk",
    "Byzantine",
    "AsiaPlectrum",
    "VelHarp)Harm",
    "Pluckaphone",
    "Slap Timps",
    "Suite Combo",
    "Jet Voxs",
    "Dirty Hit",
    "MOVE!",
    "Reel Slam",
    "OffTheRecord",
    "2ndRateChord",
    "RageInYouth",
    "MinorIncidnt",
    "Phunky DC",
    "Agent X",
    "Winky",
    "Looney 2nz",
    "Shortrave",
    "DeeperBeeper",
    "Percolator",
    "Filter Morph",
    "Choir Bounce",
    "Rippling",
    "SteppingPhsr",
    "Trance Fair",
    "GermanBounce",
    "Acid JaZZ",
    "Cutter>ModWh",
    "Blades",
    "Mad Bender",
    "Shapeshifter",
    "ForestMoon",
    "Predator 2",
    "Dark Side",
    "The Beast",
    "X-mod Reso",
    "Planet Meta",
    "Nexus",
    "Halographix",
    "Moon Rise",
    "Gruvacious",
    "Windy Dunes",
    "Ice Blasts",
    "Ringy Thingy",
    "Atmospherics"
  ];
  var ROLAND_PRESET_G_PATCHES = [
    "Power Octs",
    "WaterPiano2",
    "Swimming EP",
    "XV Crystal",
    "Cold Roadz",
    "Backrhodes",
    "Amped Wurlie",
    "Dirty Wurlie",
    "Musicbox XV",
    "Klubb Organ",
    "Drew's Bee",
    "Velvet Organ",
    "Distorted B",
    "Radikal B",
    "Boogie Organ",
    "Mood Ringz",
    "Wedo-Wodo",
    "S.O.S.trings",
    "Syncronicity",
    "DanceMachina",
    "Vox Chopper",
    "SlicingSyVox",
    "PressureDome",
    "Quasar /Aft",
    "Ionizer",
    "MilleniumStr",
    "Bounce Baby!",
    "Bounce Daddy",
    "Bounce Mama!",
    "Bounce Noize",
    "What a Gate!",
    "Mini Sequenz",
    "Slice & Dice",
    "BrushingSaw1",
    "BrushingSaw2",
    "Cultivate",
    "5080 Random",
    "XV Stepping",
    "India Garden",
    "Belly Pad",
    "Spectre",
    "SoaringHrns2",
    "Sabbath Day",
    "XV BlowPad",
    "White Arcade",
    "Borealis",
    "OvertoneScan",
    "Whisper Vox",
    "Jupiter 21",
    "Filt Strings",
    "HybStringsXV",
    "Soft Symphny",
    "Wood Symphny 7",
    "HybOrchestra",
    "Brassy Symph",
    "Biggie Brass",
    "BiggieBrass2",
    "LA Sax's",
    "Wind Wood",
    "Lonely Oboe",
    "Harmonica XV",
    "Tooters Lead",
    "Digi Phased",
    "Synth Ethics",
    "Harm is Fine",
    "D-2000",
    "Ackward East",
    "Powersoaker",
    "Mean Thing",
    "Jet Sync",
    "Crying Solo",
    "Southern Fry",
    "Strum Distrt",
    "Match Drive",
    "Stacked",
    "2-Stack Over",
    "COSM Searing",
    "COSM Loud Gt",
    "Blue Mutes",
    "Metal 5150",
    "Crunch Phase",
    "Alt Dist Gtr",
    "So nice!",
    "Punch Bass",
    "COSM Bass",
    "Stream Bell",
    "Shuffle Bell",
    "Echo Vibe",
    "Tremolo Vibe",
    "True Vibe",
    "Marimbula",
    "Hit Bitz",
    "80s LoFi Hit",
    "Auto Chord",
    "3rdTeenChord",
    "Bend a Chord",
    "DiscreteChrd",
    "Ambi Voices",
    "Say Yeah !",
    "Xcuse me",
    "5ths in 4ths",
    "Pretty Ugly",
    "Con Sequence",
    "BermudaShort",
    "Saw n' 202",
    "Technoheadz",
    "Boss'd Synth",
    "Cross Fire",
    "Techno Cave",
    "Generator",
    "GenderBender",
    "Xtremities",
    "AM 05:59",
    "Happy Brass",
    "Runaway Rez",
    "Dropplets",
    "Indian Guru",
    "Cosmic Rain",
    "Trying Winds",
    "Space Whiz",
    "DigitalDrone",
    "Space Race",
    "Bowed Bell",
    "X-Tension",
    "DUB!!!",
    "Dream Diver",
    "Flashback",
    "St.LoFiNoise"
  ];
  var ROLAND_PRESET_H_PATCHES = [
    "Hall Grand",
    "Warm pF Mix",
    "R&Ballad Mix",
    "PingE Piano",
    "Hybrid EP",
    "Wurly Gum",
    "Wurli World",
    "Voxfuzz Klav",
    "Light Keys",
    "Digibell Pad",
    "IslandSpirit",
    "Ambient Wood",
    "VeloClikOrgn",
    "Verby Organ",
    "Wedding Mass",
    "Blues Harp",
    "Thick Steel",
    "SteelRelease",
    "Two+Ensemble",
    "Harmless",
    "Swell Strat",
    "StratSeq'nce",
    "Cutting X",
    "Hurtin'Tubes",
    "Stringless",
    "Stick Chopz",
    "Fundamental",
    "Brash Bass",
    "ChamberQrt.1",
    "Lead 4x Vlns",
    "BatonStrings",
    "UltraSmooth",
    "Hold A Chord",
    "My Orchestra",
    "SwellEnsembl",
    "Valve Job",
    "T8 Brass",
    "FatSynBrass",
    "Ambient Sax",
    "Swingin'Bari",
    "Saw Grits",
    "JD Multi Ld",
    "Over the top",
    "Try this!",
    "BoutiqueSine",
    "Drifter",
    "Enchanted XV",
    "Water Tubes",
    "Waterfront",
    "Peking Opera",
    "LegatoJupitr",
    "Atlantis",
    "LF Comb Hit",
    "Backspinner",
    "Tape Q",
    "Technogrunge",
    "Chordbender",
    "Dance Zipper",
    "5th Element",
    "Fuzzy Logic",
    "Sproing",
    "McThrob",
    "Space Bassed",
    "Vocovox Wave",
    "Froggy Bass",
    "Tape Orch",
    "Tekno Pizz",
    "TechnoSurf 1",
    "TechnoSurf 2",
    "Double Helix",
    "Rhythm Sync",
    "TMT Scanner",
    "Complex Echo",
    "Groovedigger",
    "20.000 miles",
    "Vortex",
    "man@work",
    "XVoCode",
    "Auto Riff",
    "Digisquelch",
    "TripTheAlarm",
    "Aftertouchin",
    "Throbulax",
    "KeysEnsemble",
    "Cheepy Synth",
    "Funky Tube",
    "Hydrogen",
    "Promenade",
    "Ray Tracer",
    "Skinny",
    "Dream 2002",
    "DrawbarHeavn",
    "Lo-fiBellPad",
    "GemniStrings",
    "Down2Earth",
    "Silk Road",
    "Mr.Swirly",
    "MetaXV",
    "FloatingVox",
    "Spread Pad",
    "Aliastrings",
    "GlobalWarmup",
    "2.2 Strings",
    "Aftermath",
    "11th Space",
    "Cloud 9",
    "Traffic Pad",
    "Nanolog Pad",
    "Etheraaahl",
    "Pipe Dream",
    "Cairo lead",
    "Lochscapes",
    "Celtic Song",
    "Blown Str.",
    "Mind Games",
    "BadJuju",
    "Eleanor",
    "RadioHymn",
    "Miasma",
    "SubmarinBand",
    "I Will Lead",
    "LatheOfHeavn",
    "CrystalGlass",
    "Upwind Glata",
    "Thor's Drums",
    "TempoMadness 4",
    "GenerationXV",
    "Wedding Gig"
  ];
  var ROLAND_GM2_PATCHES = [
    "Acoustic Grand Piano",
    "Bright Acoustic Piano",
    "Electric Grand Piano",
    "Honky-tonk Piano",
    "Electric Piano 1",
    "Electric Piano 2",
    "Harpsichord",
    "Clavinet",
    "Celesta",
    "Glockenspiel",
    "Music Box",
    "Vibraphone",
    "Marimba",
    "Xylophone",
    "Tubular Bells",
    "Dulcimer",
    "Drawbar Organ",
    "Percussive Organ",
    "Rock Organ",
    "Church Organ",
    "Reed Organ",
    "Accordion",
    "Harmonica",
    "Tango Accordion",
    "Acoustic Guitar (nylon)",
    "Acoustic Guitar (steel)",
    "Electric Guitar (jazz)",
    "Electric Guitar (clean)",
    "Electric Guitar (muted)",
    "Overdriven Guitar",
    "Distortion Guitar",
    "Guitar Harmonics",
    "Acoustic Bass",
    "Electric Bass (finger)",
    "Electric Bass (pick)",
    "Fretless Bass",
    "Slap Bass 1",
    "Slap Bass 2",
    "Synth Bass 1",
    "Synth Bass 2",
    "Violin",
    "Viola",
    "Cello",
    "Contrabass",
    "Tremolo Strings",
    "Pizzicato Strings",
    "Orchestral Harp",
    "Timpani",
    "String Ensemble 1",
    "String Ensemble 2",
    "Synth Strings 1",
    "Synth Strings 2",
    "Choir Aahs",
    "Voice Oohs",
    "Synth Voice",
    "Orchestra Hit",
    "Trumpet",
    "Trombone",
    "Tuba",
    "Muted Trumpet",
    "French Horn",
    "Brass Section",
    "Synth Brass 1",
    "Synth Brass 2",
    "Soprano Sax",
    "Alto Sax",
    "Tenor Sax",
    "Baritone Sax",
    "Oboe",
    "English Horn",
    "Bassoon",
    "Clarinet",
    "Piccolo",
    "Flute",
    "Recorder",
    "Pan Flute",
    "Blown Bottle",
    "Shakuhachi",
    "Whistle",
    "Ocarina",
    "Lead 1 (square)",
    "Lead 2 (sawtooth)",
    "Lead 3 (calliope)",
    "Lead 4 (chiff)",
    "Lead 5 (charang)",
    "Lead 6 (voice)",
    "Lead 7 (fifths)",
    "Lead 8 (bass + lead)",
    "Pad 1 (new age)",
    "Pad 2 (warm)",
    "Pad 3 (polysynth)",
    "Pad 4 (choir)",
    "Pad 5 (bowed)",
    "Pad 6 (metallic)",
    "Pad 7 (halo)",
    "Pad 8 (sweep)",
    "FX 1 (rain)",
    "FX 2 (soundtrack)",
    "FX 3 (crystal)",
    "FX 4 (atmosphere)",
    "FX 5 (brightness)",
    "FX 6 (goblins)",
    "FX 7 (echoes)",
    "FX 8 (sci-fi)",
    "Sitar",
    "Banjo",
    "Shamisen",
    "Koto",
    "Kalimba",
    "Bag pipe",
    "Fiddle",
    "Shanai",
    "Tinkle Bell",
    "Agogo",
    "Steel Drums",
    "Woodblock",
    "Taiko Drum",
    "Melodic Tom",
    "Synth Drum",
    "Reverse Cymbal",
    "Guitar Fret Noise",
    "Breath Noise",
    "Seashore",
    "Bird Tweet",
    "Telephone Ring",
    "Helicopter",
    "Applause",
    "Gunshot"
  ];
  var ROLAND_PRESET_DRUM_KITS = [
    "Standard Kit 1",
    "Standard Kit 2",
    "Rock Kit",
    "Jazz Kit",
    "Brush Kit",
    "Acoustic Kit",
    "House Kit",
    "Electronic Kit"
  ];
  var ROLAND_USER_DRUM_KITS = [
    "R&B Kit 1",
    "House Kit",
    "XV WayHipKit",
    "XV Jazz Kit"
  ];
  function getPresetPatchName(bankId, pc) {
    const index = pc - 1;
    switch (bankId?.toLowerCase()) {
      case "user":
      case "us":
        return ROLAND_USER_DEFAULT_PATCHES[index] || `User ${String(pc).padStart(3, "0")}`;
      case "pra":
      case "pa":
        return ROLAND_PRESET_A_PATCHES[index] || `PR-A ${String(pc).padStart(3, "0")}`;
      case "prb":
      case "pb":
        return ROLAND_PRESET_B_PATCHES[index] || `PR-B ${String(pc).padStart(3, "0")}`;
      case "prc":
      case "pc":
        return ROLAND_PRESET_C_PATCHES[index] || `PR-C ${String(pc).padStart(3, "0")}`;
      case "prd":
      case "pd":
        return ROLAND_PRESET_D_PATCHES[index] || `PR-D ${String(pc).padStart(3, "0")}`;
      case "pre":
      case "pe":
        return ROLAND_PRESET_E_PATCHES[index] || `PR-E ${String(pc).padStart(3, "0")}`;
      case "prf":
      case "pf":
        return ROLAND_PRESET_F_PATCHES[index] || `PR-F ${String(pc).padStart(3, "0")}`;
      case "prg":
      case "pg":
        return ROLAND_PRESET_G_PATCHES[index] || `PR-G ${String(pc).padStart(3, "0")}`;
      case "prh":
      case "ph":
        return ROLAND_PRESET_H_PATCHES[index] || `PR-H ${String(pc).padStart(3, "0")}`;
      case "gm2":
      case "gm":
        return ROLAND_GM2_PATCHES[index] || `GM2 ${String(pc).padStart(3, "0")}`;
      case "srx_a":
      case "xpa": {
        const boardA = (typeof localStorage !== "undefined" ? localStorage.getItem("xv5050_srx_slot_a") : null) || "SRX-07";
        const patches = getSrxPatches(boardA);
        return patches[index] || `XP-A ${String(pc).padStart(3, "0")}`;
      }
      case "srx_b":
      case "xpb": {
        const boardB = (typeof localStorage !== "undefined" ? localStorage.getItem("xv5050_srx_slot_b") : null) || "NONE";
        const patches = getSrxPatches(boardB);
        return patches[index] || `XP-B ${String(pc).padStart(3, "0")}`;
      }
      default:
        return `Patch ${String(pc).padStart(3, "0")}`;
    }
  }

  // src/app.js
  var midi = new MidiManager();
  if (typeof window !== "undefined") window.midiManager = midi;
  var store = createStore();
  var $ = (id) => document.getElementById(id);
  var currentToneIndex = 1;
  var activeAuditionTimeout = null;
  var currentSoundMode = 2;
  var activePartPatchesCache = {};
  var isAutoSyncingPatch = false;
  var partKnobs = {};
  if (typeof window !== "undefined") window.partKnobs = partKnobs;
  async function autoSyncActivePatchFromHardware(partNumber) {
    if (!midi.isConnected) return;
    if (isAutoSyncingPatch) return;
    isAutoSyncingPatch = true;
    const targetPart = partNumber !== void 0 && partNumber !== null ? partNumber : getEffectivePatchPart();
    const label = targetPart === 0 ? "Single Patch" : "Part " + targetPart + " Patch";
    setStatus("Auto-syncing " + label + " directly from XV-5050 hardware...");
    try {
      const patch = await requestEntirePatch(midi, targetPart, getDeviceId(), (stage, cur, total) => {
        setStatus("Syncing " + label + " from unit: " + stage + " (" + (cur + 1) + "/" + total + ")...");
      });
      if (!patch) {
        isAutoSyncingPatch = false;
        return;
      }
      activePartPatchesCache[targetPart] = patch;
      if (patch.common) {
        updatePatchCommonUI(patch.common);
        store.set("patch.common", patch.common);
      }
      if (patch.tmt) {
        updatePatchTMTUI(patch.tmt);
        store.set("patch.tmt", patch.tmt);
      }
      if (Array.isArray(patch.tones)) {
        patch.tones.forEach((toneData, idx) => {
          store.set("patch.tones." + idx, toneData);
          currentToneCache[idx] = toneData;
        });
        const activeTone = currentToneCache[currentToneIndex - 1];
        if (activeTone) updateToneUI(activeTone);
      }
      if (patch.mfx || patch.chorus || patch.reverb) {
        applyPatchEffectsToUI(patch.mfx, patch.chorus, patch.reverb);
      }
      if (typeof syncDeepStudioToneCards === "function") syncDeepStudioToneCards();
      if (typeof updateDeepStudioSpectrum === "function") updateDeepStudioSpectrum();
      updateActivePartUI(targetPart);
      const name = patch.common?.name || "Sound";
      setStatus('\u2713 In sync with unit: "' + name + '" (' + label + ")");
    } catch (err) {
      console.warn("Auto-sync failed for " + label + ":", err);
      setStatus("Note: Could not auto-sync " + label + " (" + err.message + '). Click "Read Sound from Hardware" to retry.');
    } finally {
      isAutoSyncingPatch = false;
    }
  }
  var sendTimers = /* @__PURE__ */ new Map();
  function sendThrottled(key, fn, delay = 25) {
    if (sendTimers.has(key)) {
      clearTimeout(sendTimers.get(key));
    }
    const timer = setTimeout(() => {
      sendTimers.delete(key);
      fn();
    }, delay);
    sendTimers.set(key, timer);
  }
  function setStatus(message) {
    const el = $("statusMessage");
    if (el) el.textContent = message;
  }
  function setDeviceInfo(text) {
    const el = $("statusDeviceInfo");
    if (el) el.textContent = text;
    const drawerEl = $("drawerDeviceInfo");
    if (drawerEl) drawerEl.textContent = text;
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
  function getEffectivePatchPart() {
    if (currentSoundMode === 1) {
      return 0;
    }
    const el = $("patchPartSelect");
    const val = el ? parseInt(el.value, 10) : 1;
    return val >= 0 && val <= 16 ? val : 1;
  }
  function currentPart() {
    return getEffectivePatchPart();
  }
  function setSynthesizerMode(mode, sendToHardware = true) {
    const previousMode = currentSoundMode;
    currentSoundMode = mode;
    const btnPerform = $("modeBtnPerform");
    const btnPatch = $("modeBtnPatch");
    const badge = $("modeActiveBadge");
    const partSelect = $("patchPartSelect");
    if (mode === 1) {
      if (btnPatch) btnPatch.classList.add("active");
      if (btnPerform) btnPerform.classList.remove("active");
      if (badge) {
        badge.textContent = "PATCH MODE";
        badge.className = "mode-active-indicator mode-patch";
      }
      if (partSelect) partSelect.value = "0";
      if (sendToHardware && midi.isConnected) {
        sendSoundMode(midi, 1, getDeviceId());
        setStatus("XV-5050 switched to Single PATCH Mode");
        autoSyncActivePatchFromHardware(0);
      }
    } else {
      if (btnPerform) btnPerform.classList.add("active");
      if (btnPatch) btnPatch.classList.remove("active");
      if (badge) {
        badge.textContent = "PERFORM MODE";
        badge.className = "mode-active-indicator mode-perform";
      }
      if (partSelect && partSelect.value === "0") partSelect.value = "1";
      if (sendToHardware && midi.isConnected) {
        sendSoundMode(midi, 2, getDeviceId());
        setStatus("XV-5050 switched to PERFORMANCE Mode (16 Parts)");
        const activePart = getSelectedPart() || 1;
        autoSyncActivePatchFromHardware(activePart);
      }
    }
  }
  function toggleSystemDrawer(expand) {
    const drawer = $("systemDrawer");
    const arrow = $("drawerToggleIcon");
    if (!drawer) return;
    const shouldOpen = expand !== void 0 ? expand : drawer.classList.contains("collapsed");
    if (shouldOpen) {
      drawer.classList.remove("collapsed");
      if (arrow) arrow.textContent = "\u25B4";
    } else {
      drawer.classList.add("collapsed");
      if (arrow) arrow.textContent = "\u25BE";
    }
  }
  async function initMidi() {
    const hasAccess = await midi.requestAccess();
    if (!hasAccess) {
      setStatus("Web MIDI not available \u2014 use Chrome, Edge, or Opera with MIDI devices");
      return;
    }
    refreshDeviceList();
    if (!midi.sysexEnabled) {
      console.warn("Web MIDI SysEx is not enabled in this browser session");
      setStatus('\u26A0\uFE0F SysEx permission is not granted! Click the site settings icon in the browser address bar and enable "System exclusive messages" for this page.');
    } else {
      setStatus("MIDI access granted with SysEx enabled \u2014 select device and connect");
    }
    midi.onTraffic(handleTraffic);
  }
  function refreshDeviceList() {
    const inputSelect = $("midiInput");
    const outputSelect = $("midiOutput");
    const dawSelect = $("midiDawThru");
    if (!inputSelect || !outputSelect) return;
    const prevInput = inputSelect.value || localStorage.getItem("xv5050_midi_input") || "";
    const prevOutput = outputSelect.value || localStorage.getItem("xv5050_midi_output") || "";
    const prevDaw = dawSelect && dawSelect.value ? dawSelect.value : localStorage.getItem("xv5050_daw_thru") || "";
    inputSelect.innerHTML = '<option value="">\u2014 Select MIDI Input \u2014</option>';
    outputSelect.innerHTML = '<option value="">\u2014 Select MIDI Output \u2014</option>';
    if (dawSelect) {
      dawSelect.innerHTML = '<option value="">\u2014 None (Disabled) \u2014</option>';
    }
    const inputs = midi.getInputs();
    const outputs = midi.getOutputs();
    for (const dev of inputs) {
      const opt = document.createElement("option");
      opt.value = dev.id;
      opt.textContent = dev.name;
      if (dev.id === prevInput || !prevInput && dev.name.includes("XV-5050")) {
        opt.selected = true;
      }
      inputSelect.appendChild(opt);
      if (dawSelect) {
        const dawOpt = document.createElement("option");
        dawOpt.value = dev.id;
        const isLoop = dev.name.toLowerCase().includes("loop") || dev.name.toLowerCase().includes("virtual");
        dawOpt.textContent = `${dev.name}${isLoop ? " (Virtual Cable)" : ""}`;
        if (dev.id === prevDaw) {
          dawOpt.selected = true;
        }
        dawSelect.appendChild(dawOpt);
      }
    }
    if (dawSelect && prevDaw) {
      dawSelect.value = prevDaw;
    }
    for (const dev of outputs) {
      const opt = document.createElement("option");
      opt.value = dev.id;
      opt.textContent = dev.name;
      if (dev.id === prevOutput || !prevOutput && dev.name.includes("XV-5050")) {
        opt.selected = true;
      }
      outputSelect.appendChild(opt);
    }
    setStatus(`Found ${inputs.length} input(s), ${outputs.length} output(s)`);
  }
  async function connectMidi() {
    const inputId = $("midiInput")?.value;
    const outputId = $("midiOutput")?.value;
    const dawThruId = $("midiDawThru")?.value || localStorage.getItem("xv5050_daw_thru") || "";
    if (!inputId || !outputId) {
      setStatus("Please select both input and output ports");
      return;
    }
    localStorage.setItem("xv5050_midi_input", inputId);
    localStorage.setItem("xv5050_midi_output", outputId);
    if (dawThruId) {
      localStorage.setItem("xv5050_daw_thru", dawThruId);
    }
    if (midi.isConnected) {
      await midi.disconnect();
      setConnectionStatus(false);
      $("connectBtn").textContent = "Connect";
      setDeviceInfo("");
      setStatus("Disconnected (MIDI driver released)");
      if ($("midiDawThru") && dawThruId) {
        $("midiDawThru").value = dawThruId;
      }
      return;
    }
    setStatus("Connecting to MIDI ports...");
    const success = await midi.connect(inputId, outputId);
    if (success) {
      setConnectionStatus(true, `${midi.inputName}`);
      $("connectBtn").textContent = "Disconnect";
      setDeviceInfo(`${midi.inputName} \u2194 ${midi.outputName}`);
      setStatus("Connected \u2014 ready to communicate");
      midi.onSysEx(handleIncomingSysEx);
      if (dawThruId) {
        await midi.setDawThruInput(dawThruId);
        if ($("midiDawThru")) {
          $("midiDawThru").value = dawThruId;
        }
        setStatus(`Connected to XV-5050 with DAW Thru active (${midi.dawInputName})`);
      }
      toggleSystemDrawer(false);
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
    const part = getEffectivePatchPart();
    let channel = 0;
    if (currentSoundMode !== 1 && part >= 1 && part <= 16) {
      const chEl = $(`partChannel${part}`);
      channel = chEl ? parseInt(chEl.value, 10) : part - 1;
    }
    if (activeAuditionTimeout) clearTimeout(activeAuditionTimeout);
    midi.sendNoteOn(channel, 60, 100);
    setStatus(`Audition Note On: C4 (${currentSoundMode === 1 ? "Patch Mode" : `Part ${part}`}, Ch ${channel + 1})`);
    activeAuditionTimeout = setTimeout(() => {
      midi.sendNoteOff(channel, 60);
      activeAuditionTimeout = null;
    }, 400);
  }
  var trafficBuffer = [];
  var trafficRenderQueued = false;
  function renderTrafficBuffer() {
    const tbody = $("trafficLogBody");
    const isMonitorActive = $("monitorTab")?.classList.contains("active");
    if (!tbody || !isMonitorActive) {
      trafficRenderQueued = false;
      return;
    }
    const fragment = document.createDocumentFragment();
    while (trafficBuffer.length > 0) {
      const item = trafficBuffer.shift();
      const tr = document.createElement("tr");
      tr.innerHTML = `
      <td>${item.timeStr}</td>
      <td><span class="log-badge ${item.direction.toLowerCase()}">${item.direction}</span></td>
      <td>${item.cmd}</td>
      <td style="font-family:var(--font-mono);">${item.addrStr}</td>
      <td>${item.sizeStr}</td>
      <td class="log-raw">${item.rawHex}</td>
    `;
      fragment.insertBefore(tr, fragment.firstChild);
    }
    tbody.insertBefore(fragment, tbody.firstChild);
    while (tbody.children.length > 150) {
      tbody.removeChild(tbody.lastChild);
    }
    trafficRenderQueued = false;
  }
  function handleTraffic(direction, bytes, timestamp) {
    if (!bytes || bytes.length === 0) return;
    const isSysEx = bytes[0] === 240;
    const isMonitorActive = $("monitorTab")?.classList.contains("active");
    if (!isSysEx && !isMonitorActive) {
      return;
    }
    const date = new Date(timestamp);
    const timeStr = date.toTimeString().split(" ")[0] + "." + String(date.getMilliseconds()).padStart(3, "0");
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
      else if (status === 224) cmd = "PitchBend";
    }
    trafficBuffer.push({
      timeStr,
      direction,
      cmd,
      addrStr,
      sizeStr,
      rawHex: formatSysEx(bytes)
    });
    if (trafficBuffer.length > 150) {
      trafficBuffer.shift();
    }
    if (isMonitorActive && !trafficRenderQueued) {
      trafficRenderQueued = true;
      requestAnimationFrame(renderTrafficBuffer);
    }
  }
  function clearLog() {
    trafficBuffer.length = 0;
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
    if ($("perfMfxBSource")) $("perfMfxBSource").value = data.mfxBSource ?? 0;
    if ($("perfMfxCSource")) $("perfMfxCSource").value = data.mfxCSource ?? 0;
    $("perfChorusSource").value = data.chorusSource ?? 0;
    $("perfReverbSource").value = data.reverbSource ?? 0;
  }
  function updatePerformanceChorusUI(data) {
    $("perfChorusType").value = data.chorusType ?? 1;
    $("perfChorusLevel").value = data.chorusLevel ?? 64;
    $("perfChorusLevelVal").textContent = data.chorusLevel ?? 64;
    $("perfChorusOutputAssign").value = data.outputAssign ?? 0;
    if ($("perfChorusRate")) {
      $("perfChorusRate").value = data.rate ?? 32;
      $("perfChorusRateVal").textContent = data.rate ?? 32;
    }
    if ($("perfChorusDepth")) {
      $("perfChorusDepth").value = data.depth ?? 64;
      $("perfChorusDepthVal").textContent = data.depth ?? 64;
    }
    if ($("perfChorusRevSend")) {
      $("perfChorusRevSend").value = data.revSend ?? 0;
      $("perfChorusRevSendVal").textContent = data.revSend ?? 0;
    }
  }
  function updatePerformanceReverbUI(data) {
    $("perfReverbType").value = data.reverbType ?? 1;
    $("perfReverbLevel").value = data.reverbLevel ?? 64;
    $("perfReverbLevelVal").textContent = data.reverbLevel ?? 64;
    $("perfReverbOutputAssign").value = data.outputAssign ?? 0;
    if ($("perfReverbTime")) {
      $("perfReverbTime").value = data.time ?? 64;
      $("perfReverbTimeVal").textContent = data.time ?? 64;
    }
    if ($("perfReverbHfDamp")) {
      const hf = data.hfDamp ?? 17;
      $("perfReverbHfDamp").value = hf;
      $("perfReverbHfDampVal").textContent = hf === 17 ? "BYPASS" : `${hf}`;
    }
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
      { el: "perfMfxBSource", param: "MFXB_SOURCE" },
      { el: "perfMfxCSource", param: "MFXC_SOURCE" },
      { el: "perfChorusSource", param: "CHORUS_SOURCE" },
      { el: "perfReverbSource", param: "REVERB_SOURCE" }
    ];
    for (const b of selectBindings) {
      const el = $(b.el);
      if (el) {
        el.addEventListener("change", () => {
          if (!midi.isConnected) return;
          sendPerformanceCommonParam(midi, b.param, parseInt(el.value, 10), getDeviceId());
        });
      }
    }
    $("perfChorusType").addEventListener("change", () => {
      if (!midi.isConnected) return;
      sendPerformanceChorusParam(midi, "CHORUS_TYPE", parseInt($("perfChorusType").value, 10), getDeviceId());
    });
    $("perfChorusLevel").addEventListener("input", () => {
      const val = parseInt($("perfChorusLevel").value, 10);
      $("perfChorusLevelVal").textContent = val;
      if (!midi.isConnected) return;
      sendThrottled("perfChorusLevel", () => {
        sendPerformanceChorusParam(midi, "CHORUS_LEVEL", val, getDeviceId());
      });
    });
    $("perfChorusLevel").addEventListener("change", () => {
      if (!midi.isConnected) return;
      sendPerformanceChorusParam(midi, "CHORUS_LEVEL", parseInt($("perfChorusLevel").value, 10), getDeviceId());
    });
    $("perfChorusOutputAssign").addEventListener("change", () => {
      if (!midi.isConnected) return;
      sendPerformanceChorusParam(midi, "OUTPUT_ASSIGN", parseInt($("perfChorusOutputAssign").value, 10), getDeviceId());
    });
    if ($("perfChorusRate")) {
      $("perfChorusRate").addEventListener("input", () => {
        const val = parseInt($("perfChorusRate").value, 10);
        $("perfChorusRateVal").textContent = val;
        if (!midi.isConnected) return;
        sendThrottled("perfChorusRate", () => {
          sendPerformanceChorusParam(midi, "RATE", val, getDeviceId());
        });
      });
    }
    if ($("perfChorusDepth")) {
      $("perfChorusDepth").addEventListener("input", () => {
        const val = parseInt($("perfChorusDepth").value, 10);
        $("perfChorusDepthVal").textContent = val;
        if (!midi.isConnected) return;
        sendThrottled("perfChorusDepth", () => {
          sendPerformanceChorusParam(midi, "DEPTH", val, getDeviceId());
        });
      });
    }
    if ($("perfChorusRevSend")) {
      $("perfChorusRevSend").addEventListener("input", () => {
        const val = parseInt($("perfChorusRevSend").value, 10);
        $("perfChorusRevSendVal").textContent = val;
        if (!midi.isConnected) return;
        sendThrottled("perfChorusRevSend", () => {
          sendPerformanceChorusParam(midi, "REV_SEND", val, getDeviceId());
        });
      });
    }
    $("perfReverbType").addEventListener("change", () => {
      if (!midi.isConnected) return;
      sendPerformanceReverbParam(midi, "REVERB_TYPE", parseInt($("perfReverbType").value, 10), getDeviceId());
    });
    $("perfReverbLevel").addEventListener("input", () => {
      const val = parseInt($("perfReverbLevel").value, 10);
      $("perfReverbLevelVal").textContent = val;
      if (!midi.isConnected) return;
      sendThrottled("perfReverbLevel", () => {
        sendPerformanceReverbParam(midi, "REVERB_LEVEL", val, getDeviceId());
      });
    });
    $("perfReverbLevel").addEventListener("change", () => {
      if (!midi.isConnected) return;
      sendPerformanceReverbParam(midi, "REVERB_LEVEL", parseInt($("perfReverbLevel").value, 10), getDeviceId());
    });
    $("perfReverbOutputAssign").addEventListener("change", () => {
      if (!midi.isConnected) return;
      sendPerformanceReverbParam(midi, "OUTPUT_ASSIGN", parseInt($("perfReverbOutputAssign").value, 10), getDeviceId());
    });
    if ($("perfReverbTime")) {
      $("perfReverbTime").addEventListener("input", () => {
        const val = parseInt($("perfReverbTime").value, 10);
        $("perfReverbTimeVal").textContent = val;
        if (!midi.isConnected) return;
        sendThrottled("perfReverbTime", () => {
          sendPerformanceReverbParam(midi, "TIME", val, getDeviceId());
        });
      });
    }
    if ($("perfReverbHfDamp")) {
      $("perfReverbHfDamp").addEventListener("input", () => {
        const val = parseInt($("perfReverbHfDamp").value, 10);
        $("perfReverbHfDampVal").textContent = val === 17 ? "BYPASS" : `${val}`;
        if (!midi.isConnected) return;
        sendThrottled("perfReverbHfDamp", () => {
          sendPerformanceReverbParam(midi, "HF_DAMP", val, getDeviceId());
        });
      });
    }
    if ($("sysEqBassFreq")) {
      $("sysEqBassFreq").addEventListener("change", () => {
        if (!midi.isConnected) return;
        sendSystemEqParam(midi, "EQ1_LOW_FREQ", parseInt($("sysEqBassFreq").value, 10), getDeviceId());
      });
    }
    if ($("sysEqBassGain")) {
      $("sysEqBassGain").addEventListener("input", () => {
        const val = parseInt($("sysEqBassGain").value, 10);
        const db = val - 15;
        $("sysEqBassGainVal").textContent = (db > 0 ? `+${db}` : `${db}`) + " dB";
        if (!midi.isConnected) return;
        sendThrottled("sysEqBassGain", () => {
          sendSystemEqParam(midi, "EQ1_LOW_GAIN", val, getDeviceId());
        });
      });
    }
    if ($("sysEqTrebleFreq")) {
      $("sysEqTrebleFreq").addEventListener("change", () => {
        if (!midi.isConnected) return;
        sendSystemEqParam(midi, "EQ1_HIGH_FREQ", parseInt($("sysEqTrebleFreq").value, 10), getDeviceId());
      });
    }
    if ($("sysEqTrebleGain")) {
      $("sysEqTrebleGain").addEventListener("input", () => {
        const val = parseInt($("sysEqTrebleGain").value, 10);
        const db = val - 15;
        $("sysEqTrebleGainVal").textContent = (db > 0 ? `+${db}` : `${db}`) + " dB";
        if (!midi.isConnected) return;
        sendThrottled("sysEqTrebleGain", () => {
          sendSystemEqParam(midi, "EQ1_HIGH_GAIN", val, getDeviceId());
        });
      });
    }
  }
  var activePerfMfxSlot = "A";
  var perfMfxCache = { A: null, B: null, C: null };
  function togglePerfMfxRollup(expand) {
    const card = $("perfMfxRollup");
    const arrow = $("perfMfxArrow");
    const text = $("perfMfxRollupText");
    if (!card) return;
    const shouldOpen = expand !== void 0 ? expand : card.classList.contains("collapsed");
    if (shouldOpen) {
      card.classList.remove("collapsed");
      if (arrow) arrow.textContent = "\u25B4";
      if (text) text.textContent = "\u25B2 Roll Up";
      localStorage.setItem("xv5050_perf_mfx_collapsed", "false");
    } else {
      card.classList.add("collapsed");
      if (arrow) arrow.textContent = "\u25BE";
      if (text) text.textContent = "\u25BC Expand";
      localStorage.setItem("xv5050_perf_mfx_collapsed", "true");
    }
  }
  function togglePatchEffectsRollup(expand) {
    const card = $("patchEffectsRollup");
    const arrow = $("patchEffectsArrow");
    const text = $("patchEffectsRollupText");
    if (!card) return;
    const shouldOpen = expand !== void 0 ? expand : card.classList.contains("collapsed");
    if (shouldOpen) {
      card.classList.remove("collapsed");
      if (arrow) arrow.textContent = "\u25B4";
      if (text) text.textContent = "\u25B2 Roll Up";
      localStorage.setItem("xv5050_patch_effects_collapsed", "false");
    } else {
      card.classList.add("collapsed");
      if (arrow) arrow.textContent = "\u25BE";
      if (text) text.textContent = "\u25BC Expand";
      localStorage.setItem("xv5050_patch_effects_collapsed", "true");
    }
  }
  function populateMfxDropdown(selectEl) {
    if (!selectEl) return;
    selectEl.innerHTML = "";
    const categories = {};
    MFX_CATALOG.forEach((algo) => {
      const cat = algo.category || "General";
      if (!categories[cat]) categories[cat] = [];
      categories[cat].push(algo);
    });
    for (const [catName, algos] of Object.entries(categories)) {
      const optgroup = document.createElement("optgroup");
      optgroup.label = catName;
      for (const algo of algos) {
        const opt = document.createElement("option");
        opt.value = algo.id;
        opt.textContent = algo.name;
        optgroup.appendChild(opt);
      }
      selectEl.appendChild(optgroup);
    }
  }
  function populateMfxCtrlSources(selectEl) {
    if (!selectEl) return;
    selectEl.innerHTML = "";
    MFX_CTRL_SOURCES.forEach((name, idx) => {
      const opt = document.createElement("option");
      opt.value = idx;
      opt.textContent = name;
      selectEl.appendChild(opt);
    });
  }
  function formatMfxParamValue(inputEl, valEl) {
    if (!inputEl || !valEl) return;
    const val = parseFloat(inputEl.value);
    if (inputEl.dataset.enumValues) {
      try {
        const enums = JSON.parse(inputEl.dataset.enumValues);
        valEl.textContent = enums[val] !== void 0 ? enums[val] : val;
        return;
      } catch (_) {
      }
    }
    const unit = inputEl.dataset.unit || "";
    if (unit === "dB") {
      valEl.textContent = (val > 0 ? `+${val}` : `${val}`) + " dB";
    } else if (unit) {
      valEl.textContent = `${val} ${unit}`;
    } else {
      valEl.textContent = `${val}`;
    }
  }
  function updateMfxAlgorithmUI(prefix, typeId) {
    const algo = getMfxAlgorithm(typeId);
    const countBadge = $(prefix === "perfMfx" ? "algoParamCountBadge" : "patchAlgoParamCountBadge");
    if (countBadge) {
      countBadge.textContent = `${algo.params.length} Parameters`;
    }
    for (let i = 1; i <= 12; i++) {
      const box = $(`${prefix}ParamBox${i}`);
      const label = $(`${prefix}ParamLabel${i}`);
      const input = $(`${prefix}Param${i}`);
      const valEl = $(`${prefix}ParamVal${i}`);
      if (!box || !label || !input) continue;
      const paramDef = algo.params[i - 1];
      if (paramDef) {
        box.classList.remove("hidden");
        label.textContent = paramDef.name;
        input.min = paramDef.min;
        input.max = paramDef.max;
        input.step = paramDef.step || 1;
        input.dataset.unit = paramDef.unit || "";
        if (paramDef.type === "enum" && paramDef.enumValues) {
          input.dataset.enumValues = JSON.stringify(paramDef.enumValues);
        } else {
          delete input.dataset.enumValues;
        }
        formatMfxParamValue(input, valEl);
        if (prefix === "patchMfx" && patchMfxKnobs.params && patchMfxKnobs.params[i]) {
          const knob = patchMfxKnobs.params[i];
          knob.min = paramDef.min;
          knob.max = paramDef.max;
          knob.bipolar = paramDef.min < 0;
          knob.setValue(parseFloat(input.value) || paramDef.min, false);
        }
      } else {
        box.classList.add("hidden");
      }
    }
    if (prefix === "perfMfx") {
      for (let c = 1; c <= 4; c++) {
        const assignSel = $(`perfMfxCtrl${c}Assign`);
        if (!assignSel) continue;
        const currentVal = assignSel.value;
        assignSel.innerHTML = '<option value="0">OFF</option>';
        algo.params.forEach((p, idx) => {
          const opt = document.createElement("option");
          opt.value = idx + 1;
          opt.textContent = `${idx + 1}: ${p.name}`;
          assignSel.appendChild(opt);
        });
        assignSel.value = currentVal <= algo.params.length ? currentVal : 0;
      }
    }
  }
  function updatePerfMfxBadges(slot, typeId) {
    const algo = getMfxAlgorithm(typeId);
    const text = algo.name;
    const slotBadge = $(`slotBadge${slot}`);
    if (slotBadge) slotBadge.textContent = text;
    const summaryChip = $(`summaryMfx${slot}`);
    if (summaryChip) summaryChip.textContent = `MFX-${slot}: ${text}`;
  }
  function applyPerfMfxToUI(data) {
    if (!data) return;
    const typeId = data.mfxType ?? 0;
    if ($("perfMfxType")) $("perfMfxType").value = typeId;
    if ($("perfMfxDryLevel")) {
      $("perfMfxDryLevel").value = data.dryLevel ?? 127;
      $("perfMfxDryLevelVal").textContent = data.dryLevel ?? 127;
    }
    if ($("perfMfxChorusSend")) {
      $("perfMfxChorusSend").value = data.chorusSend ?? 0;
      $("perfMfxChorusSendVal").textContent = data.chorusSend ?? 0;
    }
    if ($("perfMfxReverbSend")) {
      $("perfMfxReverbSend").value = data.reverbSend ?? 0;
      $("perfMfxReverbSendVal").textContent = data.reverbSend ?? 0;
    }
    if ($("perfMfxOutputAssign")) $("perfMfxOutputAssign").value = data.outputAssign ?? 0;
    updateMfxAlgorithmUI("perfMfx", typeId);
    if (Array.isArray(data.params)) {
      data.params.forEach((val, idx) => {
        const input = $(`perfMfxParam${idx + 1}`);
        const valEl = $(`perfMfxParamVal${idx + 1}`);
        if (input) {
          input.value = val;
          formatMfxParamValue(input, valEl);
        }
      });
    }
    for (let c = 1; c <= 4; c++) {
      const srcSel = $(`perfMfxCtrl${c}Source`);
      const sensIn = $(`perfMfxCtrl${c}Sens`);
      const sensVal = $(`perfMfxCtrl${c}SensVal`);
      const assSel = $(`perfMfxCtrl${c}Assign`);
      if (srcSel) srcSel.value = data[`ctrl${c}Source`] ?? 0;
      if (sensIn) {
        const s = data[`ctrl${c}Sens`] ?? 0;
        sensIn.value = s;
        if (sensVal) sensVal.textContent = s > 0 ? `+${s}` : `${s}`;
      }
      if (assSel) assSel.value = data[`ctrl${c}Assign`] ?? 0;
    }
    updatePerfMfxBadges(activePerfMfxSlot, typeId);
  }
  function setActivePerfMfxSlot(slot) {
    activePerfMfxSlot = slot.toUpperCase();
    ["A", "B", "C"].forEach((s) => {
      const btn = $(`btnSlotMfx${s}`);
      if (btn) btn.classList.toggle("active", s === activePerfMfxSlot);
    });
    const ind = $("activeSlotIndicator");
    if (ind) {
      ind.textContent = `Editing MFX-${activePerfMfxSlot}`;
    }
    const cached = perfMfxCache[activePerfMfxSlot];
    if (cached) {
      applyPerfMfxToUI(cached);
    } else if (midi.isConnected) {
      requestPerformanceMfx(midi, activePerfMfxSlot, getDeviceId()).then((data) => {
        perfMfxCache[activePerfMfxSlot] = data;
        applyPerfMfxToUI(data);
      }).catch((e) => {
        console.warn(`Could not read MFX-${activePerfMfxSlot}:`, e);
      });
    }
  }
  function bindPerfMfxControls() {
    populateMfxDropdown($("perfMfxType"));
    for (let c = 1; c <= 4; c++) {
      populateMfxCtrlSources($(`perfMfxCtrl${c}Source`));
    }
    const isCollapsed = localStorage.getItem("xv5050_perf_mfx_collapsed") === "true";
    if (isCollapsed) togglePerfMfxRollup(false);
    const btnToggle = $("btnTogglePerfMfx");
    if (btnToggle) {
      btnToggle.addEventListener("click", (e) => {
        e.stopPropagation();
        togglePerfMfxRollup();
      });
    }
    const rollupHeader = $("perfMfxRollupHeader");
    if (rollupHeader) {
      rollupHeader.addEventListener("click", (e) => {
        if (e.target.closest("button") || e.target.closest("select")) return;
        togglePerfMfxRollup();
      });
    }
    ["A", "B", "C"].forEach((slot) => {
      const btn = $(`btnSlotMfx${slot}`);
      if (btn) {
        btn.addEventListener("click", () => setActivePerfMfxSlot(slot));
      }
    });
    const btnSync = $("btnSyncActiveMfx");
    if (btnSync) {
      btnSync.addEventListener("click", async () => {
        if (!midi.isConnected) {
          setStatus("Not connected");
          return;
        }
        setStatus(`Reading MFX-${activePerfMfxSlot} from XV-5050...`);
        try {
          const data = await requestPerformanceMfx(midi, activePerfMfxSlot, getDeviceId());
          perfMfxCache[activePerfMfxSlot] = data;
          applyPerfMfxToUI(data);
          setStatus(`MFX-${activePerfMfxSlot} successfully read from hardware`);
        } catch (e) {
          setStatus(`Failed reading MFX-${activePerfMfxSlot}: ${e.message}`);
        }
      });
    }
    $("perfMfxType").addEventListener("change", () => {
      const typeId = parseInt($("perfMfxType").value, 10);
      updateMfxAlgorithmUI("perfMfx", typeId);
      updatePerfMfxBadges(activePerfMfxSlot, typeId);
      if (!midi.isConnected) return;
      sendPerformanceMfxParam(midi, activePerfMfxSlot, "MFX_TYPE", typeId, getDeviceId());
      setStatus(`MFX-${activePerfMfxSlot} Algorithm set to ${typeId}`);
    });
    $("perfMfxDryLevel").addEventListener("input", () => {
      const val = parseInt($("perfMfxDryLevel").value, 10);
      $("perfMfxDryLevelVal").textContent = val;
      if (!midi.isConnected) return;
      sendThrottled(`perfMfx${activePerfMfxSlot}DryLevel`, () => {
        sendPerformanceMfxParam(midi, activePerfMfxSlot, "DRY_LEVEL", val, getDeviceId());
      });
    });
    $("perfMfxChorusSend").addEventListener("input", () => {
      const val = parseInt($("perfMfxChorusSend").value, 10);
      $("perfMfxChorusSendVal").textContent = val;
      if (!midi.isConnected) return;
      sendThrottled(`perfMfx${activePerfMfxSlot}ChorusSend`, () => {
        sendPerformanceMfxParam(midi, activePerfMfxSlot, "CHORUS_SEND", val, getDeviceId());
      });
    });
    $("perfMfxReverbSend").addEventListener("input", () => {
      const val = parseInt($("perfMfxReverbSend").value, 10);
      $("perfMfxReverbSendVal").textContent = val;
      if (!midi.isConnected) return;
      sendThrottled(`perfMfx${activePerfMfxSlot}ReverbSend`, () => {
        sendPerformanceMfxParam(midi, activePerfMfxSlot, "REVERB_SEND", val, getDeviceId());
      });
    });
    $("perfMfxOutputAssign").addEventListener("change", () => {
      const val = parseInt($("perfMfxOutputAssign").value, 10);
      if (!midi.isConnected) return;
      sendPerformanceMfxParam(midi, activePerfMfxSlot, "OUTPUT_ASSIGN", val, getDeviceId());
    });
    for (let i = 1; i <= 12; i++) {
      const input = $(`perfMfxParam${i}`);
      const valEl = $(`perfMfxParamVal${i}`);
      if (!input) continue;
      input.addEventListener("input", () => {
        formatMfxParamValue(input, valEl);
        if (!midi.isConnected) return;
        const val = parseInt(input.value, 10);
        sendThrottled(`perfMfx${activePerfMfxSlot}Param${i}`, () => {
          sendPerformanceMfxParam(midi, activePerfMfxSlot, `PARAM_${i}`, val, getDeviceId());
        });
      });
    }
    for (let c = 1; c <= 4; c++) {
      const srcSel = $(`perfMfxCtrl${c}Source`);
      const sensIn = $(`perfMfxCtrl${c}Sens`);
      const sensVal = $(`perfMfxCtrl${c}SensVal`);
      const assSel = $(`perfMfxCtrl${c}Assign`);
      if (srcSel) {
        srcSel.addEventListener("change", () => {
          if (!midi.isConnected) return;
          sendPerformanceMfxParam(midi, activePerfMfxSlot, `MFX_CTRL_${c}_SOURCE`, parseInt(srcSel.value, 10), getDeviceId());
        });
      }
      if (sensIn) {
        sensIn.addEventListener("input", () => {
          const s = parseInt(sensIn.value, 10);
          if (sensVal) sensVal.textContent = s > 0 ? `+${s}` : `${s}`;
          if (!midi.isConnected) return;
          sendThrottled(`perfMfx${activePerfMfxSlot}Ctrl${c}Sens`, () => {
            sendPerformanceMfxParam(midi, activePerfMfxSlot, `MFX_CTRL_${c}_SENS`, s, getDeviceId());
          });
        });
      }
      if (assSel) {
        assSel.addEventListener("change", () => {
          if (!midi.isConnected) return;
          sendPerformanceMfxParam(midi, activePerfMfxSlot, `MFX_CTRL_${c}_ASSIGN`, parseInt(assSel.value, 10), getDeviceId());
        });
      }
    }
    updateMfxAlgorithmUI("perfMfx", 1);
    updatePerfMfxBadges("A", 1);
    updatePerfMfxBadges("B", 1);
    updatePerfMfxBadges("C", 1);
  }
  function bindPatchEffectsControls() {
    populateMfxDropdown($("patchMfxType"));
    const isCollapsed = localStorage.getItem("xv5050_patch_effects_collapsed") === "true";
    if (isCollapsed) togglePatchEffectsRollup(false);
    const btnToggle = $("btnTogglePatchEffects");
    if (btnToggle) {
      btnToggle.addEventListener("click", (e) => {
        e.stopPropagation();
        togglePatchEffectsRollup();
      });
    }
    const rollupHeader = $("patchEffectsRollupHeader");
    if (rollupHeader) {
      rollupHeader.addEventListener("click", (e) => {
        if (e.target.closest("button") || e.target.closest("select")) return;
        togglePatchEffectsRollup();
      });
    }
    const btnSync = $("btnSyncPatchEffects");
    if (btnSync) {
      btnSync.addEventListener("click", async () => {
        if (!midi.isConnected) {
          setStatus("Not connected");
          return;
        }
        const part = parseInt($("patchPartSelect")?.value || "0", 10);
        setStatus("Reading Patch Effects from XV-5050...");
        try {
          const [mfxData, choData, revData] = await Promise.all([
            requestPatchMfx(midi, part, getDeviceId()),
            requestPatchChorus(midi, part, getDeviceId()),
            requestPatchReverb(midi, part, getDeviceId())
          ]);
          applyPatchEffectsToUI(mfxData, choData, revData);
          setStatus("Patch Effects read successfully");
        } catch (e) {
          setStatus(`Failed reading Patch Effects: ${e.message}`);
        }
      });
    }
    $("patchMfxType").addEventListener("change", () => {
      const typeId = parseInt($("patchMfxType").value, 10);
      updateMfxAlgorithmUI("patchMfx", typeId);
      const algo = getMfxAlgorithm(typeId);
      if ($("summaryPatchMfx")) $("summaryPatchMfx").textContent = `MFX: ${String(typeId).padStart(2, "0")}: ${algo.name}`;
      if (!midi.isConnected) return;
      const part = parseInt($("patchPartSelect")?.value || "0", 10);
      sendPatchMfxParam(midi, part, "MFX_TYPE", typeId, getDeviceId());
    });
    $("patchMfxDryLevel").addEventListener("input", () => {
      const val = parseInt($("patchMfxDryLevel").value, 10);
      $("patchMfxDryLevelVal").textContent = val;
      if (!midi.isConnected) return;
      const part = parseInt($("patchPartSelect")?.value || "0", 10);
      sendThrottled("patchMfxDryLevel", () => {
        sendPatchMfxParam(midi, part, "DRY_LEVEL", val, getDeviceId());
      });
    });
    $("patchMfxChorusSend").addEventListener("input", () => {
      const val = parseInt($("patchMfxChorusSend").value, 10);
      $("patchMfxChorusSendVal").textContent = val;
      if (!midi.isConnected) return;
      const part = parseInt($("patchPartSelect")?.value || "0", 10);
      sendThrottled("patchMfxChorusSend", () => {
        sendPatchMfxParam(midi, part, "CHORUS_SEND", val, getDeviceId());
      });
    });
    $("patchMfxReverbSend").addEventListener("input", () => {
      const val = parseInt($("patchMfxReverbSend").value, 10);
      $("patchMfxReverbSendVal").textContent = val;
      if (!midi.isConnected) return;
      const part = parseInt($("patchPartSelect")?.value || "0", 10);
      sendThrottled("patchMfxReverbSend", () => {
        sendPatchMfxParam(midi, part, "REVERB_SEND", val, getDeviceId());
      });
    });
    $("patchMfxOutputAssign").addEventListener("change", () => {
      const val = parseInt($("patchMfxOutputAssign").value, 10);
      if (!midi.isConnected) return;
      const part = parseInt($("patchPartSelect")?.value || "0", 10);
      sendPatchMfxParam(midi, part, "OUTPUT_ASSIGN", val, getDeviceId());
    });
    for (let i = 1; i <= 12; i++) {
      const input = $(`patchMfxParam${i}`);
      const valEl = $(`patchMfxParamVal${i}`);
      if (!input) continue;
      input.addEventListener("input", () => {
        formatMfxParamValue(input, valEl);
        if (!midi.isConnected) return;
        const part = parseInt($("patchPartSelect")?.value || "0", 10);
        const val = parseInt(input.value, 10);
        sendThrottled(`patchMfxParam${i}`, () => {
          sendPatchMfxParam(midi, part, `PARAM_${i}`, val, getDeviceId());
        });
      });
    }
    $("patchChorusType").addEventListener("change", () => {
      if (!midi.isConnected) return;
      const part = parseInt($("patchPartSelect")?.value || "0", 10);
      sendPatchChorusParam(midi, part, "CHORUS_TYPE", parseInt($("patchChorusType").value, 10), getDeviceId());
    });
    $("patchChorusLevel").addEventListener("input", () => {
      const val = parseInt($("patchChorusLevel").value, 10);
      $("patchChorusLevelVal").textContent = val;
      if (!midi.isConnected) return;
      const part = parseInt($("patchPartSelect")?.value || "0", 10);
      sendThrottled("patchChorusLevel", () => {
        sendPatchChorusParam(midi, part, "CHORUS_LEVEL", val, getDeviceId());
      });
    });
    if ($("patchChorusRate")) {
      $("patchChorusRate").addEventListener("input", () => {
        const val = parseInt($("patchChorusRate").value, 10);
        $("patchChorusRateVal").textContent = val;
        if (!midi.isConnected) return;
        const part = parseInt($("patchPartSelect")?.value || "0", 10);
        sendThrottled("patchChorusRate", () => {
          sendPatchChorusParam(midi, part, "RATE", val, getDeviceId());
        });
      });
    }
    if ($("patchChorusDepth")) {
      $("patchChorusDepth").addEventListener("input", () => {
        const val = parseInt($("patchChorusDepth").value, 10);
        $("patchChorusDepthVal").textContent = val;
        if (!midi.isConnected) return;
        const part = parseInt($("patchPartSelect")?.value || "0", 10);
        sendThrottled("patchChorusDepth", () => {
          sendPatchChorusParam(midi, part, "DEPTH", val, getDeviceId());
        });
      });
    }
    if ($("patchChorusRevSend")) {
      $("patchChorusRevSend").addEventListener("input", () => {
        const val = parseInt($("patchChorusRevSend").value, 10);
        $("patchChorusRevSendVal").textContent = val;
        if (!midi.isConnected) return;
        const part = parseInt($("patchPartSelect")?.value || "0", 10);
        sendThrottled("patchChorusRevSend", () => {
          sendPatchChorusParam(midi, part, "REV_SEND", val, getDeviceId());
        });
      });
    }
    if ($("patchChorusOutputAssign")) {
      $("patchChorusOutputAssign").addEventListener("change", () => {
        if (!midi.isConnected) return;
        const part = parseInt($("patchPartSelect")?.value || "0", 10);
        sendPatchChorusParam(midi, part, "OUTPUT_ASSIGN", parseInt($("patchChorusOutputAssign").value, 10), getDeviceId());
      });
    }
    $("patchReverbType").addEventListener("change", () => {
      if (!midi.isConnected) return;
      const part = parseInt($("patchPartSelect")?.value || "0", 10);
      sendPatchReverbParam(midi, part, "REVERB_TYPE", parseInt($("patchReverbType").value, 10), getDeviceId());
    });
    $("patchReverbLevel").addEventListener("input", () => {
      const val = parseInt($("patchReverbLevel").value, 10);
      $("patchReverbLevelVal").textContent = val;
      if (!midi.isConnected) return;
      const part = parseInt($("patchPartSelect")?.value || "0", 10);
      sendThrottled("patchReverbLevel", () => {
        sendPatchReverbParam(midi, part, "REVERB_LEVEL", val, getDeviceId());
      });
    });
    if ($("patchReverbTime")) {
      $("patchReverbTime").addEventListener("input", () => {
        const val = parseInt($("patchReverbTime").value, 10);
        $("patchReverbTimeVal").textContent = val;
        if (!midi.isConnected) return;
        const part = parseInt($("patchPartSelect")?.value || "0", 10);
        sendThrottled("patchReverbTime", () => {
          sendPatchReverbParam(midi, part, "TIME", val, getDeviceId());
        });
      });
    }
    if ($("patchReverbHfDamp")) {
      $("patchReverbHfDamp").addEventListener("input", () => {
        const val = parseInt($("patchReverbHfDamp").value, 10);
        $("patchReverbHfDampVal").textContent = val;
        if (!midi.isConnected) return;
        const part = parseInt($("patchPartSelect")?.value || "0", 10);
        sendThrottled("patchReverbHfDamp", () => {
          sendPatchReverbParam(midi, part, "HF_DAMP", val, getDeviceId());
        });
      });
    }
    if ($("patchReverbOutputAssign")) {
      $("patchReverbOutputAssign").addEventListener("change", () => {
        if (!midi.isConnected) return;
        const part = parseInt($("patchPartSelect")?.value || "0", 10);
        sendPatchReverbParam(midi, part, "OUTPUT_ASSIGN", parseInt($("patchReverbOutputAssign").value, 10), getDeviceId());
      });
    }
    updateMfxAlgorithmUI("patchMfx", 1);
  }
  function applyPatchEffectsToUI(mfxData, choData, revData) {
    if (mfxData) {
      const typeId = mfxData.mfxType ?? 0;
      if ($("patchMfxType")) $("patchMfxType").value = typeId;
      if ($("patchMfxDryLevel")) {
        $("patchMfxDryLevel").value = mfxData.dryLevel ?? 127;
        $("patchMfxDryLevelVal").textContent = mfxData.dryLevel ?? 127;
      }
      if ($("patchMfxChorusSend")) {
        $("patchMfxChorusSend").value = mfxData.chorusSend ?? 0;
        $("patchMfxChorusSendVal").textContent = mfxData.chorusSend ?? 0;
      }
      if ($("patchMfxReverbSend")) {
        $("patchMfxReverbSend").value = mfxData.reverbSend ?? 0;
        $("patchMfxReverbSendVal").textContent = mfxData.reverbSend ?? 0;
      }
      if ($("patchMfxOutputAssign")) $("patchMfxOutputAssign").value = mfxData.outputAssign ?? 0;
      updateMfxAlgorithmUI("patchMfx", typeId);
      const algo = getMfxAlgorithm(typeId);
      if ($("summaryPatchMfx")) $("summaryPatchMfx").textContent = `MFX: ${String(typeId).padStart(2, "0")}: ${algo.name}`;
      if (Array.isArray(mfxData.params)) {
        mfxData.params.forEach((val, idx) => {
          const input = $(`patchMfxParam${idx + 1}`);
          const valEl = $(`patchMfxParamVal${idx + 1}`);
          if (input) {
            input.value = val;
            formatMfxParamValue(input, valEl);
          }
        });
      }
    }
    if (choData) {
      if ($("patchChorusType")) $("patchChorusType").value = choData.chorusType ?? 1;
      if ($("patchChorusLevel")) {
        $("patchChorusLevel").value = choData.chorusLevel ?? 64;
        $("patchChorusLevelVal").textContent = choData.chorusLevel ?? 64;
      }
      if ($("patchChorusRate")) {
        $("patchChorusRate").value = choData.rate ?? 32;
        $("patchChorusRateVal").textContent = choData.rate ?? 32;
      }
      if ($("patchChorusDepth")) {
        $("patchChorusDepth").value = choData.depth ?? 64;
        $("patchChorusDepthVal").textContent = choData.depth ?? 64;
      }
      if ($("patchChorusRevSend")) {
        $("patchChorusRevSend").value = choData.revSend ?? 0;
        $("patchChorusRevSendVal").textContent = choData.revSend ?? 0;
      }
      if ($("patchChorusOutputAssign")) {
        $("patchChorusOutputAssign").value = choData.outputAssign ?? 0;
      }
    }
    if (revData) {
      if ($("patchReverbType")) $("patchReverbType").value = revData.reverbType ?? 1;
      if ($("patchReverbLevel")) {
        $("patchReverbLevel").value = revData.reverbLevel ?? 64;
        $("patchReverbLevelVal").textContent = revData.reverbLevel ?? 64;
      }
      if ($("patchReverbTime")) {
        $("patchReverbTime").value = revData.time ?? 64;
        $("patchReverbTimeVal").textContent = revData.time ?? 64;
      }
      if ($("patchReverbHfDamp")) {
        $("patchReverbHfDamp").value = revData.hfDamp ?? 17;
        $("patchReverbHfDampVal").textContent = revData.hfDamp ?? 17;
      }
      if ($("patchReverbOutputAssign")) {
        $("patchReverbOutputAssign").value = revData.outputAssign ?? 0;
      }
    }
  }
  var patchMasterKnobs = {};
  var patchMfxKnobs = { params: [] };
  var patchChorusKnobs = {};
  var patchReverbKnobs = {};
  var toneKnobs = {};
  function initHardwareRotaryKnobs() {
    patchMasterKnobs.level = createSyncedKnob("knobWrapPatchLevel", "patchLevel", {
      label: "LEVEL",
      min: 0,
      max: 127,
      defaultValue: 127,
      color: "#ff7700",
      formatValue: (v) => String(v)
    });
    patchMasterKnobs.pan = createSyncedKnob("knobWrapPatchPan", "patchPan", {
      label: "PAN",
      min: 0,
      max: 127,
      defaultValue: 64,
      bipolar: true,
      color: "#ff7700",
      formatValue: (v) => panDisplay(v)
    });
    patchMasterKnobs.octave = createSyncedKnob("knobWrapPatchOctave", "patchOctaveShift", {
      label: "OCTAVE",
      min: 61,
      max: 67,
      defaultValue: 64,
      bipolar: true,
      color: "#38bdf8",
      formatValue: (v) => v - 64 > 0 ? `+${v - 64}` : `${v - 64}`
    });
    patchMasterKnobs.coarse = createSyncedKnob("knobWrapPatchCoarseTune", "patchCoarseTune", {
      label: "COARSE",
      min: 16,
      max: 112,
      defaultValue: 64,
      bipolar: true,
      color: "#38bdf8",
      formatValue: (v) => v - 64 > 0 ? `+${v - 64}` : `${v - 64}`
    });
    patchMasterKnobs.fine = createSyncedKnob("knobWrapPatchFineTune", "patchFineTune", {
      label: "FINE",
      min: 14,
      max: 114,
      defaultValue: 64,
      bipolar: true,
      color: "#38bdf8",
      formatValue: (v) => v - 64 > 0 ? `+${v - 64}` : `${v - 64}`
    });
    patchMasterKnobs.portaTime = createSyncedKnob("knobWrapPatchPortaTime", "patchPortaTime", {
      label: "PORTA",
      min: 0,
      max: 127,
      defaultValue: 0,
      color: "#a78bfa",
      formatValue: (v) => String(v)
    });
    patchMfxKnobs.dryLevel = createSyncedKnob("knobWrapPatchMfxDryLevel", "patchMfxDryLevel", {
      label: "DRY LEVEL",
      min: 0,
      max: 127,
      defaultValue: 127,
      color: "#ff7700"
    });
    patchMfxKnobs.chorusSend = createSyncedKnob("knobWrapPatchMfxChorusSend", "patchMfxChorusSend", {
      label: "CHO SEND",
      min: 0,
      max: 127,
      defaultValue: 0,
      color: "#38bdf8"
    });
    patchMfxKnobs.reverbSend = createSyncedKnob("knobWrapPatchMfxReverbSend", "patchMfxReverbSend", {
      label: "REV SEND",
      min: 0,
      max: 127,
      defaultValue: 0,
      color: "#a78bfa"
    });
    for (let i = 1; i <= 12; i++) {
      patchMfxKnobs.params[i] = createSyncedKnob(`knobWrapPatchMfxParam${i}`, `patchMfxParam${i}`, {
        label: `P${i}`,
        min: 0,
        max: 127,
        defaultValue: 64,
        color: "#ff9f1c",
        formatValue: (v) => {
          const input = $(`patchMfxParam${i}`);
          const valEl = $(`patchMfxParamVal${i}`);
          if (input && valEl) {
            formatMfxParamValue(input, valEl);
            return valEl.textContent || String(v);
          }
          return String(v);
        }
      });
    }
    patchChorusKnobs.level = createSyncedKnob("knobWrapPatchChorusLevel", "patchChorusLevel", {
      label: "LEVEL",
      min: 0,
      max: 127,
      defaultValue: 64,
      color: "#ff7700"
    });
    patchChorusKnobs.rate = createSyncedKnob("knobWrapPatchChorusRate", "patchChorusRate", {
      label: "RATE",
      min: 0,
      max: 127,
      defaultValue: 32,
      color: "#38bdf8"
    });
    patchChorusKnobs.depth = createSyncedKnob("knobWrapPatchChorusDepth", "patchChorusDepth", {
      label: "DEPTH",
      min: 0,
      max: 127,
      defaultValue: 64,
      color: "#38bdf8"
    });
    patchChorusKnobs.revSend = createSyncedKnob("knobWrapPatchChorusRevSend", "patchChorusRevSend", {
      label: "REV SEND",
      min: 0,
      max: 127,
      defaultValue: 0,
      color: "#a78bfa"
    });
    patchReverbKnobs.level = createSyncedKnob("knobWrapPatchReverbLevel", "patchReverbLevel", {
      label: "LEVEL",
      min: 0,
      max: 127,
      defaultValue: 64,
      color: "#ff7700"
    });
    patchReverbKnobs.time = createSyncedKnob("knobWrapPatchReverbTime", "patchReverbTime", {
      label: "TIME",
      min: 0,
      max: 127,
      defaultValue: 64,
      color: "#a78bfa"
    });
    patchReverbKnobs.hfDamp = createSyncedKnob("knobWrapPatchReverbHfDamp", "patchReverbHfDamp", {
      label: "HF DAMP",
      min: 0,
      max: 17,
      defaultValue: 17,
      color: "#a78bfa",
      formatValue: (v) => String(v)
    });
    toneKnobs.level = createSyncedKnob("knobWrapToneLevel", "toneLevel", {
      label: "LEVEL",
      min: 0,
      max: 127,
      defaultValue: 127,
      color: "#ff7700"
    });
    toneKnobs.pan = createSyncedKnob("knobWrapTonePan", "tonePan", {
      label: "PAN",
      min: 0,
      max: 127,
      defaultValue: 64,
      bipolar: true,
      color: "#ff7700",
      formatValue: (v) => panDisplay(v)
    });
    toneKnobs.coarse = createSyncedKnob("knobWrapToneCoarse", "toneCoarseTune", {
      label: "COARSE",
      min: 16,
      max: 112,
      defaultValue: 64,
      bipolar: true,
      color: "#38bdf8",
      formatValue: (v) => v - 64 > 0 ? `+${v - 64}` : `${v - 64}`
    });
    toneKnobs.fine = createSyncedKnob("knobWrapToneFine", "toneFineTune", {
      label: "FINE",
      min: 14,
      max: 114,
      defaultValue: 64,
      bipolar: true,
      color: "#38bdf8",
      formatValue: (v) => v - 64 > 0 ? `+${v - 64}` : `${v - 64}`
    });
    toneKnobs.tvfCutoff = createSyncedKnob("knobWrapToneCutoff", "toneCutoff", {
      label: "CUTOFF",
      min: 0,
      max: 127,
      defaultValue: 127,
      color: "#00d4ff"
    });
    toneKnobs.tvfResonance = createSyncedKnob("knobWrapToneResonance", "toneResonance", {
      label: "RES",
      min: 0,
      max: 127,
      defaultValue: 0,
      color: "#00d4ff"
    });
    toneKnobs.tvfEnvDepth = createSyncedKnob("knobWrapTvfEnvDepth", "tvfEnvDepth", {
      label: "DEPTH",
      min: 1,
      max: 127,
      defaultValue: 64,
      bipolar: true,
      color: "#ff7700",
      formatValue: (v) => v - 64 > 0 ? `+${v - 64}` : `${v - 64}`
    });
    toneKnobs.tvfEnvT1 = createSyncedKnob("knobWrapTvfEnvT1", "tvfEnvT1", {
      label: "T1 (ATT)",
      min: 0,
      max: 127,
      defaultValue: 15,
      color: "#4ade80"
    });
    toneKnobs.tvfEnvT2 = createSyncedKnob("knobWrapTvfEnvT2", "tvfEnvT2", {
      label: "T2 (HLD)",
      min: 0,
      max: 127,
      defaultValue: 25,
      color: "#4ade80"
    });
    toneKnobs.tvfEnvT3 = createSyncedKnob("knobWrapTvfEnvT3", "tvfEnvT3", {
      label: "T3 (DEC)",
      min: 0,
      max: 127,
      defaultValue: 40,
      color: "#4ade80"
    });
    toneKnobs.tvfEnvT4 = createSyncedKnob("knobWrapTvfEnvT4", "tvfEnvT4", {
      label: "T4 (REL)",
      min: 0,
      max: 127,
      defaultValue: 40,
      color: "#4ade80"
    });
    toneKnobs.tvfEnvL3 = createSyncedKnob("knobWrapTvfEnvL3", "tvfEnvL3", {
      label: "L3 (SUS)",
      min: 0,
      max: 127,
      defaultValue: 60,
      color: "#4ade80"
    });
    toneKnobs.tvaLevel = createSyncedKnob("knobWrapToneTvaLevel", "toneTvaLevel", {
      label: "LEVEL",
      min: 0,
      max: 127,
      defaultValue: 127,
      color: "#ff7700"
    });
    toneKnobs.tvaEnvT1 = createSyncedKnob("knobWrapTvaEnvT1", "tvaEnvT1", {
      label: "T1 (ATT)",
      min: 0,
      max: 127,
      defaultValue: 10,
      color: "#f43f5e"
    });
    toneKnobs.tvaEnvT2 = createSyncedKnob("knobWrapTvaEnvT2", "tvaEnvT2", {
      label: "T2 (HLD)",
      min: 0,
      max: 127,
      defaultValue: 20,
      color: "#f43f5e"
    });
    toneKnobs.tvaEnvT3 = createSyncedKnob("knobWrapTvaEnvT3", "tvaEnvT3", {
      label: "T3 (DEC)",
      min: 0,
      max: 127,
      defaultValue: 40,
      color: "#f43f5e"
    });
    toneKnobs.tvaEnvT4 = createSyncedKnob("knobWrapTvaEnvT4", "tvaEnvT4", {
      label: "T4 (REL)",
      min: 0,
      max: 127,
      defaultValue: 30,
      color: "#f43f5e"
    });
    toneKnobs.tvaEnvL3 = createSyncedKnob("knobWrapTvaEnvL3", "tvaEnvL3", {
      label: "L3 (SUS)",
      min: 0,
      max: 127,
      defaultValue: 70,
      color: "#f43f5e"
    });
    toneKnobs.pitchEnvDepth = createSyncedKnob("knobWrapPitchEnvDepth", "pitchEnvDepth", {
      label: "DEPTH",
      min: 52,
      max: 76,
      defaultValue: 64,
      bipolar: true,
      color: "#00d4ff",
      formatValue: (v) => v - 64 > 0 ? `+${v - 64}` : `${v - 64}`
    });
    toneKnobs.pitchEnvT1 = createSyncedKnob("knobWrapPitchEnvT1", "pitchEnvT1", {
      label: "T1",
      min: 0,
      max: 127,
      defaultValue: 20,
      color: "#00d4ff"
    });
    toneKnobs.pitchEnvT2 = createSyncedKnob("knobWrapPitchEnvT2", "pitchEnvT2", {
      label: "T2",
      min: 0,
      max: 127,
      defaultValue: 20,
      color: "#00d4ff"
    });
    toneKnobs.pitchEnvT3 = createSyncedKnob("knobWrapPitchEnvT3", "pitchEnvT3", {
      label: "T3",
      min: 0,
      max: 127,
      defaultValue: 40,
      color: "#00d4ff"
    });
    toneKnobs.pitchEnvT4 = createSyncedKnob("knobWrapPitchEnvT4", "pitchEnvT4", {
      label: "T4",
      min: 0,
      max: 127,
      defaultValue: 40,
      color: "#00d4ff"
    });
    toneKnobs.pitchEnvL1 = createSyncedKnob("knobWrapPitchEnvL1", "pitchEnvL1", {
      label: "L1",
      min: 1,
      max: 127,
      defaultValue: 64,
      bipolar: true,
      color: "#00d4ff",
      formatValue: (v) => v - 64 > 0 ? `+${v - 64}` : `${v - 64}`
    });
    toneKnobs.lfoRate = createSyncedKnob("knobWrapLfoRate", "lfoRate", {
      label: "RATE",
      min: 0,
      max: 127,
      defaultValue: 64,
      color: "#c084fc"
    });
    toneKnobs.lfoPitchDepth = createSyncedKnob("knobWrapLfoPitchDepth", "lfoPitchDepth", {
      label: "PITCH",
      min: 1,
      max: 127,
      defaultValue: 64,
      bipolar: true,
      color: "#c084fc",
      formatValue: (v) => v - 64 > 0 ? `+${v - 64}` : `${v - 64}`
    });
    toneKnobs.lfoTvfDepth = createSyncedKnob("knobWrapLfoTvfDepth", "lfoTvfDepth", {
      label: "TVF",
      min: 1,
      max: 127,
      defaultValue: 64,
      bipolar: true,
      color: "#c084fc",
      formatValue: (v) => v - 64 > 0 ? `+${v - 64}` : `${v - 64}`
    });
    toneKnobs.lfoTvaDepth = createSyncedKnob("knobWrapLfoTvaDepth", "lfoTvaDepth", {
      label: "TVA",
      min: 1,
      max: 127,
      defaultValue: 64,
      bipolar: true,
      color: "#c084fc",
      formatValue: (v) => v - 64 > 0 ? `+${v - 64}` : `${v - 64}`
    });
    toneKnobs.lfoPanDepth = createSyncedKnob("knobWrapLfoPanDepth", "lfoPanDepth", {
      label: "PAN",
      min: 1,
      max: 127,
      defaultValue: 64,
      bipolar: true,
      color: "#c084fc",
      formatValue: (v) => v - 64 > 0 ? `+${v - 64}` : `${v - 64}`
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
      <td style="min-width:210px;">
        <div style="display:flex; align-items:center; gap:6px;">
          <div style="flex:1; min-width:0;">
            <div id="partPatchName${i}" style="font-weight:600; color:var(--text-primary); text-overflow:ellipsis; overflow:hidden; white-space:nowrap; font-size:0.85rem;" title="Part ${i} Current Patch">\u2014</div>
            <select id="partPatchSelect${i}" class="part-patch-select" style="width:100%; margin-top:3px; padding:2px 4px; font-size:0.75rem;" title="Select Instrument for Part ${i}">
              <option value="">\u2014 Choose Instrument \u2014</option>
            </select>
          </div>
          <button class="btn btn-sm btn-primary btn-tweak-part" id="partTweak${i}" title="Tweak Part ${i} Sound in Patch & Tones Editor" style="padding:3px 7px; font-size:0.72rem; white-space:nowrap;">\u{1F39B}\uFE0F Tweak</button>
        </div>
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
      <td class="cell-knob">
        <div id="knobWrapPartLevel${i}"></div>
        <input type="hidden" id="partLevel${i}" value="100">
        <span id="partLevelVal${i}" style="display:none;">100</span>
      </td>
      <td class="cell-knob">
        <div id="knobWrapPartPan${i}"></div>
        <input type="hidden" id="partPan${i}" value="64">
        <span id="partPanVal${i}" style="display:none;">C</span>
      </td>
      <td class="cell-knob">
        <div id="knobWrapPartCoarse${i}"></div>
        <input type="hidden" id="partCoarse${i}" value="64">
        <span id="partCoarseVal${i}" style="display:none;">0</span>
      </td>
      <td class="cell-knob">
        <div id="knobWrapPartFine${i}"></div>
        <input type="hidden" id="partFine${i}" value="64">
        <span id="partFineVal${i}" style="display:none;">0</span>
      </td>
      <td class="cell-knob">
        <div id="knobWrapPartChorus${i}"></div>
        <input type="hidden" id="partChorus${i}" value="0">
        <span id="partChorusVal${i}" style="display:none;">0</span>
      </td>
      <td class="cell-knob">
        <div id="knobWrapPartReverb${i}"></div>
        <input type="hidden" id="partReverb${i}" value="40">
        <span id="partReverbVal${i}" style="display:none;">40</span>
      </td>
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
    const tr = $(`partRow${part}`);
    if (tr) {
      tr.addEventListener("click", (e) => {
        if (e.target.closest("input, select, button, label")) return;
        selectPart(part);
      });
    }
    const tweakBtn = $(`partTweak${part}`);
    if (tweakBtn) {
      tweakBtn.addEventListener("click", () => {
        selectPart(part);
        switchToTab("patch");
      });
    }
    const patchSel = $(`partPatchSelect${part}`);
    if (patchSel) {
      patchSel.addEventListener("change", (e) => {
        handleInstrumentSelection(part, e.target.value);
      });
    }
    $(`partSwitch${part}`).addEventListener("change", () => {
      if (!midi.isConnected) return;
      sendPartParam(midi, part, "RECEIVE_SWITCH", $(`partSwitch${part}`).checked ? 1 : 0, getDeviceId());
    });
    $(`partChannel${part}`).addEventListener("change", () => {
      if (!midi.isConnected) return;
      sendPartParam(midi, part, "RECEIVE_CHANNEL", parseInt($(`partChannel${part}`).value, 10), getDeviceId());
    });
    const handleBankPcInput = async () => {
      const msb = parseInt($(`partBankMSB${part}`).value, 10) || 0;
      const lsb = parseInt($(`partBankLSB${part}`).value, 10) || 0;
      const pc = parseInt($(`partPC${part}`).value, 10) || 1;
      const chEl = $(`partChannel${part}`);
      const ch = chEl ? parseInt(chEl.value, 10) : part - 1;
      if (midi.isConnected) {
        sendPartBankAndProgram(midi, part, msb, lsb, pc, getDeviceId(), ch);
        setStatus(`Sent Bank ${msb}/${lsb} PC ${pc} to Part ${part} (Ch ${ch + 1})`);
        try {
          const freshName = await requestPartPatchName(midi, part, getDeviceId());
          if (freshName && freshName.trim()) {
            const nameEl = $(`partPatchName${part}`);
            if (nameEl) nameEl.textContent = freshName;
            if (syncedUnitDb?.currentPerformance?.parts?.[part - 1]) {
              syncedUnitDb.currentPerformance.parts[part - 1].patchName = freshName;
              syncedUnitDb.currentPerformance.parts[part - 1].patchBankMSB = msb;
              syncedUnitDb.currentPerformance.parts[part - 1].patchBankLSB = lsb;
              syncedUnitDb.currentPerformance.parts[part - 1].patchPC = pc;
              saveSyncedDbToStorage();
            }
            if (getSelectedPart() === part) updateActivePartUI(part);
          }
        } catch (_) {
        }
      }
    };
    $(`partBankMSB${part}`).addEventListener("change", handleBankPcInput);
    $(`partBankLSB${part}`).addEventListener("change", handleBankPcInput);
    $(`partPC${part}`).addEventListener("change", handleBankPcInput);
    const knobLevel = new RotaryKnob(`knobWrapPartLevel${part}`, {
      id: `knobPartLevel${part}`,
      min: 0,
      max: 127,
      defaultValue: 100,
      value: 100,
      size: 30,
      color: "#ff9f1c",
      formatValue: (v) => String(v),
      onChange: (val) => {
        const hidden = $(`partLevel${part}`);
        if (hidden) hidden.value = val;
        const valEl = $(`partLevelVal${part}`);
        if (valEl) valEl.textContent = val;
        if (!midi.isConnected) return;
        sendThrottled(`partLevel_${part}`, () => {
          sendPartParam(midi, part, "PART_LEVEL", val, getDeviceId());
        });
      }
    });
    const knobPan = new RotaryKnob(`knobWrapPartPan${part}`, {
      id: `knobPartPan${part}`,
      min: 0,
      max: 127,
      defaultValue: 64,
      value: 64,
      bipolar: true,
      size: 30,
      color: "#ff9f1c",
      formatValue: (v) => panDisplay(v),
      onChange: (val) => {
        const hidden = $(`partPan${part}`);
        if (hidden) hidden.value = val;
        const valEl = $(`partPanVal${part}`);
        if (valEl) valEl.textContent = panDisplay(val);
        if (!midi.isConnected) return;
        sendThrottled(`partPan_${part}`, () => {
          sendPartParam(midi, part, "PART_PAN", val, getDeviceId());
        });
      }
    });
    const knobCoarse = new RotaryKnob(`knobWrapPartCoarse${part}`, {
      id: `knobPartCoarse${part}`,
      min: 16,
      max: 112,
      defaultValue: 64,
      value: 64,
      bipolar: true,
      size: 30,
      color: "#38bdf8",
      formatValue: (v) => v - 64 > 0 ? `+${v - 64}` : `${v - 64}`,
      onChange: (val) => {
        const hidden = $(`partCoarse${part}`);
        if (hidden) hidden.value = val;
        const valEl = $(`partCoarseVal${part}`);
        if (valEl) valEl.textContent = val - 64;
        if (!midi.isConnected) return;
        sendThrottled(`partCoarse_${part}`, () => {
          sendPartParam(midi, part, "COARSE_TUNE", val, getDeviceId());
        });
      }
    });
    const knobFine = new RotaryKnob(`knobWrapPartFine${part}`, {
      id: `knobPartFine${part}`,
      min: 14,
      max: 114,
      defaultValue: 64,
      value: 64,
      bipolar: true,
      size: 30,
      color: "#38bdf8",
      formatValue: (v) => v - 64 > 0 ? `+${v - 64}` : `${v - 64}`,
      onChange: (val) => {
        const hidden = $(`partFine${part}`);
        if (hidden) hidden.value = val;
        const valEl = $(`partFineVal${part}`);
        if (valEl) valEl.textContent = val - 64;
        if (!midi.isConnected) return;
        sendThrottled(`partFine_${part}`, () => {
          sendPartParam(midi, part, "FINE_TUNE", val, getDeviceId());
        });
      }
    });
    const knobChorus = new RotaryKnob(`knobWrapPartChorus${part}`, {
      id: `knobPartChorus${part}`,
      min: 0,
      max: 127,
      defaultValue: 0,
      value: 0,
      size: 30,
      color: "#a78bfa",
      formatValue: (v) => String(v),
      onChange: (val) => {
        const hidden = $(`partChorus${part}`);
        if (hidden) hidden.value = val;
        const valEl = $(`partChorusVal${part}`);
        if (valEl) valEl.textContent = val;
        if (!midi.isConnected) return;
        sendThrottled(`partChorus_${part}`, () => {
          sendPartParam(midi, part, "CHORUS_SEND", val, getDeviceId());
        });
      }
    });
    const knobReverb = new RotaryKnob(`knobWrapPartReverb${part}`, {
      id: `knobPartReverb${part}`,
      min: 0,
      max: 127,
      defaultValue: 40,
      value: 40,
      size: 30,
      color: "#a78bfa",
      formatValue: (v) => String(v),
      onChange: (val) => {
        const hidden = $(`partReverb${part}`);
        if (hidden) hidden.value = val;
        const valEl = $(`partReverbVal${part}`);
        if (valEl) valEl.textContent = val;
        if (!midi.isConnected) return;
        sendThrottled(`partReverb_${part}`, () => {
          sendPartParam(midi, part, "REVERB_SEND", val, getDeviceId());
        });
      }
    });
    partKnobs[part] = {
      level: knobLevel,
      pan: knobPan,
      coarse: knobCoarse,
      fine: knobFine,
      chorus: knobChorus,
      reverb: knobReverb
    };
    $(`partLevel${part}`)?.addEventListener("input", (e) => knobLevel.setValue(parseInt(e.target.value, 10), false));
    $(`partLevel${part}`)?.addEventListener("change", (e) => knobLevel.setValue(parseInt(e.target.value, 10), false));
    $(`partPan${part}`)?.addEventListener("input", (e) => knobPan.setValue(parseInt(e.target.value, 10), false));
    $(`partPan${part}`)?.addEventListener("change", (e) => knobPan.setValue(parseInt(e.target.value, 10), false));
    $(`partCoarse${part}`)?.addEventListener("input", (e) => knobCoarse.setValue(parseInt(e.target.value, 10), false));
    $(`partCoarse${part}`)?.addEventListener("change", (e) => knobCoarse.setValue(parseInt(e.target.value, 10), false));
    $(`partFine${part}`)?.addEventListener("input", (e) => knobFine.setValue(parseInt(e.target.value, 10), false));
    $(`partFine${part}`)?.addEventListener("change", (e) => knobFine.setValue(parseInt(e.target.value, 10), false));
    $(`partChorus${part}`)?.addEventListener("input", (e) => knobChorus.setValue(parseInt(e.target.value, 10), false));
    $(`partChorus${part}`)?.addEventListener("change", (e) => knobChorus.setValue(parseInt(e.target.value, 10), false));
    $(`partReverb${part}`)?.addEventListener("input", (e) => knobReverb.setValue(parseInt(e.target.value, 10), false));
    $(`partReverb${part}`)?.addEventListener("change", (e) => knobReverb.setValue(parseInt(e.target.value, 10), false));
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
      selectPart(part);
      switchToTab("patch");
    });
  }
  function updatePartRow(part, data) {
    $(`partSwitch${part}`).checked = !!data.receiveSwitch;
    $(`partChannel${part}`).value = data.receiveChannel ?? part - 1;
    $(`partBankMSB${part}`).value = data.patchBankMSB ?? 87;
    $(`partBankLSB${part}`).value = data.patchBankLSB ?? 64;
    $(`partPC${part}`).value = data.patchPC ?? 1;
    const level = data.partLevel ?? 100;
    if ($(`partLevel${part}`)) $(`partLevel${part}`).value = level;
    if ($(`partLevelVal${part}`)) $(`partLevelVal${part}`).textContent = level;
    partKnobs[part]?.level?.setValue(level, false);
    const pan = data.partPan ?? 64;
    if ($(`partPan${part}`)) $(`partPan${part}`).value = pan;
    if ($(`partPanVal${part}`)) $(`partPanVal${part}`).textContent = panDisplay(pan);
    partKnobs[part]?.pan?.setValue(pan, false);
    const coarse = data.coarseTune ?? 64;
    if ($(`partCoarse${part}`)) $(`partCoarse${part}`).value = coarse;
    if ($(`partCoarseVal${part}`)) $(`partCoarseVal${part}`).textContent = coarse - 64;
    partKnobs[part]?.coarse?.setValue(coarse, false);
    const fine = data.fineTune ?? 64;
    if ($(`partFine${part}`)) $(`partFine${part}`).value = fine;
    if ($(`partFineVal${part}`)) $(`partFineVal${part}`).textContent = fine - 64;
    partKnobs[part]?.fine?.setValue(fine, false);
    const chorus = data.chorusSend ?? 0;
    if ($(`partChorus${part}`)) $(`partChorus${part}`).value = chorus;
    if ($(`partChorusVal${part}`)) $(`partChorusVal${part}`).textContent = chorus;
    partKnobs[part]?.chorus?.setValue(chorus, false);
    const reverb = data.reverbSend ?? 40;
    if ($(`partReverb${part}`)) $(`partReverb${part}`).value = reverb;
    if ($(`partReverbVal${part}`)) $(`partReverbVal${part}`).textContent = reverb;
    partKnobs[part]?.reverb?.setValue(reverb, false);
    $(`partAssign${part}`).value = data.outputAssign ?? 0;
    $(`partMute${part}`).checked = !!data.muteSwitch;
    $(`partRow${part}`).classList.toggle("part-muted", !!data.muteSwitch);
    if (data.patchName) {
      const nameEl = $(`partPatchName${part}`);
      if (nameEl) {
        nameEl.textContent = data.patchName;
        nameEl.title = data.patchName;
      }
    }
    const partSelect = $(`partPatchSelect${part}`);
    if (partSelect) {
      populateInstrumentSelectOptions(partSelect, part);
    }
    const stripBtn = $(`partStripBtn${part}`);
    if (stripBtn && data.patchName) {
      stripBtn.title = `Part ${part}: ${data.patchName}`;
    }
    if (part === (getSelectedPart() || 1)) {
      const headerName = $("activePatchHeaderName");
      if (headerName && data.patchName) headerName.textContent = data.patchName;
      const patchInstSel = $("patchInstrumentSelect");
      if (patchInstSel) populateInstrumentSelectOptions(patchInstSel, part);
    }
  }
  if (typeof window !== "undefined") window.updatePartUI = updatePartRow;
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
    updateMatrixGridUI(data);
    const dsPatchName = $("deepStudioPatchName");
    if (dsPatchName) dsPatchName.textContent = data.name || "INIT PATCH";
    const dsVoiceBadge = $("deepStudioVoiceModeBadge");
    if (dsVoiceBadge) dsVoiceBadge.textContent = data.monoPoly === 0 ? "MONO" : "POLY";
  }
  var matrixGridKnobs = {};
  function populateMatrixGridDropdowns() {
    for (let m = 1; m <= 4; m++) {
      const srcSelect = $(`matrix${m}Source`);
      if (srcSelect && srcSelect.children.length === 0) {
        MATRIX_SOURCES.forEach((name, idx) => {
          const opt = document.createElement("option");
          opt.value = idx;
          opt.textContent = MATRIX_SOURCE_LABELS[name] || (name.startsWith("CC") ? `${name}` : name);
          srcSelect.appendChild(opt);
        });
      }
    }
    for (let d = 1; d <= 4; d++) {
      const destSelect = $(`matrixDestRow${d}`);
      if (destSelect && destSelect.children.length === 0) {
        MATRIX_DESTINATIONS.forEach((name, idx) => {
          const opt = document.createElement("option");
          opt.value = idx;
          opt.textContent = MATRIX_DEST_LABELS[name] || name;
          destSelect.appendChild(opt);
        });
      }
    }
  }
  function updateMatrixGridUI(data) {
    if (!data) return;
    for (let m = 1; m <= 4; m++) {
      const srcSel = $(`matrix${m}Source`);
      if (srcSel) {
        srcSel.value = data[`matrix${m}Source`] ?? 0;
      }
    }
    for (let d = 1; d <= 4; d++) {
      const destSel = $(`matrixDestRow${d}`);
      if (destSel) {
        let activeDest = 0;
        for (let m = 1; m <= 4; m++) {
          const val = data[`matrix${m}Dest${d}`];
          if (val !== void 0 && val !== 0) {
            activeDest = val;
            break;
          }
        }
        destSel.value = activeDest;
      }
      for (let m = 1; m <= 4; m++) {
        const knob = matrixGridKnobs[`${m}_${d}`];
        if (knob) {
          const sensVal = data[`matrix${m}Sens${d}`] ?? 64;
          knob.setValue(sensVal, false);
        }
      }
    }
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
    updateMatrixGridUI(data);
  }
  var isAllTonesLinked = false;
  function getActiveToneTargets() {
    if (isAllTonesLinked) {
      return [1, 2, 3, 4];
    }
    return [currentToneIndex];
  }
  function updateToneCacheProperty(cache, paramKey, val) {
    if (!cache) return;
    const map = {
      TONE_LEVEL: "toneLevel",
      TONE_PAN: "tonePan",
      COARSE_TUNE: "coarseTune",
      FINE_TUNE: "fineTune",
      TVF_CUTOFF: "tvfCutoff",
      TVF_RESONANCE: "tvfResonance",
      TVF_FILTER_TYPE: "tvfFilterType",
      TVF_ENV_DEPTH: "tvfEnvDepth",
      TVF_ENV_T1: "tvfEnvT1",
      TVF_ENV_T2: "tvfEnvT2",
      TVF_ENV_T3: "tvfEnvT3",
      TVF_ENV_T4: "tvfEnvT4",
      TVF_ENV_L3: "tvfEnvL3",
      TVA_LEVEL: "tvaLevel",
      TVA_ENV_T1: "tvaEnvT1",
      TVA_ENV_T2: "tvaEnvT2",
      TVA_ENV_T3: "tvaEnvT3",
      TVA_ENV_T4: "tvaEnvT4",
      TVA_ENV_L3: "tvaEnvL3",
      PITCH_ENV_DEPTH: "pitchEnvDepth",
      PITCH_ENV_T1: "pitchEnvT1",
      PITCH_ENV_T2: "pitchEnvT2",
      PITCH_ENV_T3: "pitchEnvT3",
      PITCH_ENV_T4: "pitchEnvT4",
      PITCH_ENV_L1: "pitchEnvL1",
      WAVE_GROUP_TYPE: "waveGroupType",
      WAVE_GROUP_ID: "waveGroupId",
      WAVE_NUMBER_L: "waveNumberL",
      WAVE_NUMBER_R: "waveNumberR",
      WAVE_GAIN: "waveGain",
      WAVE_FXM_SWITCH: "waveFxmSwitch",
      WAVE_FXM_COLOR: "waveFxmColor",
      WAVE_FXM_DEPTH: "waveFxmDepth",
      WAVE_TEMPO_SYNC: "waveTempoSync"
    };
    const prop = map[paramKey];
    if (prop) {
      cache[prop] = val;
    }
  }
  function updateModuleTargetPill(label) {
    const pills = [
      "filterToneBadge",
      "tvaToneBadge",
      "pitchToneBadge",
      "lfoToneBadge",
      "tuningToneBadge"
    ];
    pills.forEach((id) => {
      const el = $(id);
      if (el) {
        el.textContent = label;
        el.classList.toggle("all-linked", isAllTonesLinked);
      }
    });
  }
  function selectToneTarget(target) {
    if (target === "all") {
      isAllTonesLinked = true;
      for (let i = 1; i <= 4; i++) {
        $(`btnSelectTone${i}`)?.classList.remove("active");
      }
      $("btnSelectToneAll")?.classList.add("active");
      const badge = $("toneFocusBadge");
      if (badge) {
        badge.textContent = "\u26A1 MASTER LINK: EDITING ALL 4 TONES SIMULTANEOUSLY";
        badge.classList.add("all-linked");
      }
      const nameDisp = $("currentToneNameDisplay");
      if (nameDisp) nameDisp.textContent = "ALL TONES (LINKED)";
      updateModuleTargetPill("ALL (LINKED)");
      if ($("tvfFilterDrive")) {
        $("tvfFilterDrive").value = $("booster12") ? parseInt($("booster12").value, 10) : 0;
      }
      const cached = currentToneCache[currentToneIndex - 1] || store.get(`patch.tones.${currentToneIndex - 1}`);
      if (cached) {
        updateToneUI(cached);
      }
      setStatus("Master Tone Link Active: Filter, envelopes & tuning changes apply to Tones 1, 2, 3, and 4 simultaneously");
    } else {
      isAllTonesLinked = false;
      currentToneIndex = target;
      for (let i = 1; i <= 4; i++) {
        $(`btnSelectTone${i}`)?.classList.toggle("active", i === target);
      }
      $("btnSelectToneAll")?.classList.remove("active");
      const badge = $("toneFocusBadge");
      if (badge) {
        badge.textContent = `EDIT TARGET: TONE ${target}`;
        badge.classList.remove("all-linked");
      }
      const nameDisp = $("currentToneNameDisplay");
      if (nameDisp) nameDisp.textContent = `TONE ${target}`;
      updateModuleTargetPill(`Tone ${target}`);
      if ($("tvfFilterDrive")) {
        const bVal = target === 1 || target === 2 ? $("booster12") ? parseInt($("booster12").value, 10) : 0 : $("booster34") ? parseInt($("booster34").value, 10) : 0;
        $("tvfFilterDrive").value = bVal;
      }
      updateTMTZoneUI(target);
      const cached = currentToneCache[target - 1] || store.get(`patch.tones.${target - 1}`);
      if (cached) {
        updateToneUI(cached);
      }
      setStatus(`Switched Tone Edit focus to Tone ${target}`);
    }
  }
  function dispatchToneParam(paramKey, val, throttled = true, throttleKey = null) {
    const targets = getActiveToneTargets();
    const part = currentPart();
    const devId = getDeviceId();
    for (const t of targets) {
      if (currentToneCache[t - 1]) {
        updateToneCacheProperty(currentToneCache[t - 1], paramKey, val);
      }
      if (midi.isConnected) {
        if (throttled) {
          const key = throttleKey ? `${throttleKey}_${t}` : `tone_${t}_${paramKey}`;
          sendThrottled(key, () => {
            sendPatchToneParam(midi, part, t, paramKey, val, devId);
          });
        } else {
          sendPatchToneParam(midi, part, t, paramKey, val, devId);
        }
      }
    }
  }
  function dispatchToneLFOParam(lfoNum, paramKey, val, throttled = true, throttleKey = null) {
    const targets = getActiveToneTargets();
    const part = currentPart();
    const devId = getDeviceId();
    for (const t of targets) {
      if (currentToneCache[t - 1]) {
        const propMap = {
          FORM: `lfo${lfoNum}Form`,
          RATE: `lfo${lfoNum}Rate`,
          PITCH_DEPTH: `lfo${lfoNum}PitchDepth`,
          TVF_DEPTH: `lfo${lfoNum}TvfDepth`,
          TVA_DEPTH: `lfo${lfoNum}TvaDepth`,
          PAN_DEPTH: `lfo${lfoNum}PanDepth`
        };
        if (propMap[paramKey]) {
          currentToneCache[t - 1][propMap[paramKey]] = val;
        }
      }
      if (midi.isConnected) {
        if (throttled) {
          const key = throttleKey ? `${throttleKey}_${t}` : `tone_lfo_${t}_${lfoNum}_${paramKey}`;
          sendThrottled(key, () => {
            sendToneLFOParam(midi, part, t, lfoNum, paramKey, val, devId);
          });
        } else {
          sendToneLFOParam(midi, part, t, lfoNum, paramKey, val, devId);
        }
      }
    }
  }
  function updatePatchTMTUI(data) {
    currentPatchTMTData = data;
    $("struct12").value = data.structureType12 ?? 0;
    $("booster12").value = data.booster12 ?? 0;
    $("struct34").value = data.structureType34 ?? 0;
    $("booster34").value = data.booster34 ?? 0;
    $("tmtVelCtrl").value = data.tmtVelControl ?? 0;
    if ($("tvfFilterDrive")) {
      const boosterVal = currentToneIndex === 1 || currentToneIndex === 2 || isAllTonesLinked ? data.booster12 ?? 0 : data.booster34 ?? 0;
      $("tvfFilterDrive").value = boosterVal;
    }
    for (let t = 1; t <= 4; t++) {
      const sw = $(`tone${t}Switch`);
      const on = !!data[`tone${t}Switch`];
      sw.checked = on;
      sw.closest(".tone-switch")?.classList.toggle("active", on);
      const stateEl = $(`tonePlaybackState${t}`);
      if (stateEl) {
        stateEl.textContent = on ? "SOUNDING" : "MUTED";
        stateEl.classList.toggle("playing", on);
        stateEl.classList.toggle("muted", !on);
      }
      const dot = $(`toneStatusDot${t}`);
      if (dot) {
        dot.classList.toggle("on", on);
        dot.classList.toggle("off", !on);
      }
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
  function setWaveSelectValue(selectEl, value, groupType) {
    if (!selectEl) return;
    const valStr = String(value);
    let found = false;
    for (let i = 0; i < selectEl.options.length; i++) {
      if (selectEl.options[i].value === valStr) {
        selectEl.selectedIndex = i;
        found = true;
        break;
      }
    }
    if (!found) {
      const opt = document.createElement("option");
      opt.value = value;
      opt.textContent = `${value}: ${getWaveName(groupType, value)}`;
      selectEl.appendChild(opt);
      selectEl.value = value;
    }
  }
  function formatToneWaveName(groupType, waveNumber, slot = "A") {
    if (!waveNumber || waveNumber === 0) return "OFF";
    if (groupType === 0) {
      return getWaveName(0, waveNumber);
    }
    const slotBoardId = slot === "B" ? $("srxSlotBSelect")?.value : $("srxSlotASelect")?.value;
    if (slotBoardId && slotBoardId !== "NONE") {
      const waves = getSrxWaveforms(slotBoardId);
      if (waves && waves[waveNumber - 1]) return waves[waveNumber - 1];
    }
    return getWaveName(groupType, waveNumber);
  }
  function updateWaveGroupDropdownLabels() {
    const wg = $("waveGroup");
    if (!wg) return;
    const optInt = wg.querySelector('option[value="INT"]');
    const optA = wg.querySelector('option[value="SRX-A"]');
    const optB = wg.querySelector('option[value="SRX-B"]');
    const boardIdA = $("srxSlotASelect")?.value || localStorage.getItem("xv5050_srx_slot_a") || "NONE";
    const boardIdB = $("srxSlotBSelect")?.value || localStorage.getItem("xv5050_srx_slot_b") || "NONE";
    const boardA = boardIdA && boardIdA !== "NONE" ? getSrxBoard(boardIdA) : null;
    const boardB = boardIdB && boardIdB !== "NONE" ? getSrxBoard(boardIdB) : null;
    if (optInt) optInt.textContent = "INT: Internal PCM (1,083 Waves)";
    if (optA) optA.textContent = boardA ? `SRX Slot A: ${boardA.name}` : "SRX Slot A (No Board)";
    if (optB) optB.textContent = boardB ? `SRX Slot B: ${boardB.name}` : "SRX Slot B (No Board)";
  }
  function updateToneUI(data) {
    if (!data) return;
    currentToneCache[currentToneIndex - 1] = data;
    const toneDisp = $("currentToneNameDisplay");
    if (toneDisp) toneDisp.textContent = isAllTonesLinked ? "ALL TONES (LINKED)" : `TONE ${currentToneIndex}`;
    updateModuleTargetPill(isAllTonesLinked ? "ALL (LINKED)" : `Tone ${currentToneIndex}`);
    $("toneLevel").value = data.toneLevel ?? 127;
    $("toneLevelVal").textContent = data.toneLevel ?? 127;
    $("tonePan").value = data.tonePan ?? 64;
    $("tonePanVal").textContent = panDisplay(data.tonePan ?? 64);
    $("toneCoarseTune").value = data.coarseTune ?? 64;
    $("toneCoarseTuneVal").textContent = (data.coarseTune ?? 64) - 64;
    $("toneFineTune").value = data.fineTune ?? 64;
    $("toneFineTuneVal").textContent = (data.fineTune ?? 64) - 64;
    const grp = data.waveGroupType ?? 0;
    const grpId = data.waveGroupId ?? 0;
    let wgVal = "INT";
    let slot = "A";
    if (grp === 2) {
      if (grpId === 2) {
        wgVal = "SRX-B";
        slot = "B";
      } else {
        wgVal = "SRX-A";
        slot = "A";
      }
    }
    const wgSelect = $("waveGroup");
    if (wgSelect) {
      updateWaveGroupDropdownLabels();
      wgSelect.value = wgVal;
    }
    populateWaveDropdowns(grp, slot);
    const badge = $("waveBankBadge");
    if (badge) {
      badge.textContent = grp === 0 ? "1,083 WAVES" : `SRX Slot ${slot}`;
    }
    $("waveGain").value = data.waveGain ?? 1;
    if ($("tvfWaveGain")) $("tvfWaveGain").value = data.waveGain ?? 1;
    $("waveFxmSwitch").checked = !!data.fxmSwitch;
    $("waveFxmColor").value = data.fxmColor ?? 0;
    $("waveFxmDepth").value = data.fxmDepth ?? 0;
    $("waveFxmDepthVal").textContent = data.fxmDepth ?? 0;
    $("waveTempoSync").checked = !!data.waveTempoSync;
    const wNumL = data.waveNumberL ?? 1;
    const wNumR = data.waveNumberR ?? 0;
    setWaveSelectValue($("waveNumberL"), wNumL, grp);
    setWaveSelectValue($("waveNumberR"), wNumR, grp);
    const nl = $("waveNameL");
    if (nl) nl.textContent = formatToneWaveName(grp, wNumL, slot);
    const nr = $("waveNameR");
    if (nr) nr.textContent = wNumR === 0 ? "OFF" : formatToneWaveName(grp, wNumR, slot);
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
    if ($("tvfEnvT2")) {
      $("tvfEnvT2").value = data.tvfEnvT2 ?? 25;
      $("tvfEnvT2Val").textContent = data.tvfEnvT2 ?? 25;
    }
    if ($("tvfEnvT3")) {
      $("tvfEnvT3").value = data.tvfEnvT3 ?? 40;
      $("tvfEnvT3Val").textContent = data.tvfEnvT3 ?? 40;
    }
    $("tvfEnvT4").value = data.tvfEnvT4 ?? 40;
    $("tvfEnvT4Val").textContent = data.tvfEnvT4 ?? 40;
    if ($("tvfEnvL3")) {
      $("tvfEnvL3").value = data.tvfEnvL3 ?? 60;
      $("tvfEnvL3Val").textContent = data.tvfEnvL3 ?? 60;
    }
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
    const srxGroup = $("waveSrxBoardGroup");
    if (srxGroup) srxGroup.style.display = grp === 2 ? "flex" : "none";
    syncDeepStudioToneCards();
    updateDeepStudioSpectrum();
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
    syncAllEnvelopeHandles();
  }
  function redrawPitchEnvCurve() {
    const t1 = parseInt($("pitchEnvT1").value, 10);
    const t2 = parseInt($("pitchEnvT2").value, 10);
    const t3 = parseInt($("pitchEnvT3").value, 10);
    const t4 = parseInt($("pitchEnvT4").value, 10);
    const l1 = parseInt($("pitchEnvL1").value, 10);
    const depth = parseInt($("pitchEnvDepth").value, 10) - 64;
    const d = generateEnvelopePath("pitch", { t1, t2, t3, t4, l0: 64, l1, l2: 64, l3: 64, l4: 64 }, 300, 75);
    $("pitchEnvPath").setAttribute("d", d);
    $("pitchEnvBadge").textContent = `Depth: ${depth >= 0 ? "+" : ""}${depth} semi`;
    syncEnvelopeHandles("pitch");
  }
  function redrawFilterCurves() {
    const fType = parseInt($("toneFilterType").value, 10);
    const cutoff = parseInt($("toneCutoff").value, 10);
    const resonance = parseInt($("toneResonance").value, 10);
    const t1 = parseInt($("tvfEnvT1").value, 10);
    const t2 = parseInt($("tvfEnvT2")?.value ?? 25, 10);
    const t3 = parseInt($("tvfEnvT3")?.value ?? 40, 10);
    const t4 = parseInt($("tvfEnvT4").value, 10);
    const l3 = parseInt($("tvfEnvL3")?.value ?? 60, 10);
    const filterD = generateFilterCurvePath(fType, cutoff, resonance, 300, 75);
    $("filterRespPath").setAttribute("d", filterD);
    $("filterRespBadge").textContent = FILTER_TYPES[fType] || "LPF";
    const envD = generateEnvelopePath("tvf", { t1, t2, t3, t4, l1: 127, l2: Math.max(l3, Math.round((127 + l3) / 2)), l3, l4: 0 }, 300, 75);
    $("tvfEnvPath").setAttribute("d", envD);
    syncEnvelopeHandles("tvf");
  }
  function redrawTVAEnvCurve() {
    const t1 = parseInt($("tvaEnvT1").value, 10);
    const t2 = parseInt($("tvaEnvT2").value, 10);
    const t3 = parseInt($("tvaEnvT3").value, 10);
    const t4 = parseInt($("tvaEnvT4").value, 10);
    const l3 = parseInt($("tvaEnvL3").value, 10);
    const level = parseInt($("toneTvaLevel").value, 10);
    const envD = generateEnvelopePath("tva", { t1, t2, t3, t4, l1: level, l2: Math.floor(level * 0.8), l3 }, 300, 75);
    $("tvaEnvPath").setAttribute("d", envD);
    $("tvaEnvBadge").textContent = `Level: ${level}`;
    syncEnvelopeHandles("tva");
  }
  function redrawLFOCurve() {
    const form = parseInt($("lfoForm").value, 10);
    const rate = parseInt($("lfoRate").value, 10);
    const waveD = generateLFOWavePath(form, rate, 300, 75);
    $("lfoWavePath").setAttribute("d", waveD);
    $("lfoWaveBadge").textContent = `${LFO_WAVEFORMS[form] || "TRI"} @ Rate ${rate}`;
  }
  function populateMatrixDropdowns() {
    const srcSelect = $("matrixSource");
    if (srcSelect && srcSelect.children.length === 0) {
      MATRIX_SOURCES.forEach((name, idx) => {
        const opt = document.createElement("option");
        opt.value = idx;
        opt.textContent = MATRIX_SOURCE_LABELS[name] || (name.startsWith("CC") ? `${name} (MIDI CC)` : name);
        srcSelect.appendChild(opt);
      });
    }
    for (let d = 1; d <= 4; d++) {
      const destSelect = $(`matrixDest${d}`);
      if (destSelect && destSelect.children.length === 0) {
        MATRIX_DESTINATIONS.forEach((name, idx) => {
          const opt = document.createElement("option");
          opt.value = idx;
          opt.textContent = MATRIX_DEST_LABELS[name] || name;
          destSelect.appendChild(opt);
        });
      }
    }
  }
  function populateWaveDropdowns(groupType = 0, srxSlot = "A") {
    const waveLSelect = $("waveNumberL");
    const waveRSelect = $("waveNumberR");
    let waveforms = INTERNAL_WAVEFORMS;
    if (groupType === 2) {
      const slotBoardId = srxSlot === "B" ? $("srxSlotBSelect")?.value : $("srxSlotASelect")?.value;
      if (slotBoardId && slotBoardId !== "NONE") {
        waveforms = getSrxWaveforms(slotBoardId);
      } else {
        waveforms = [`SRX-${srxSlot}: No Board Installed`];
      }
    }
    if (waveLSelect) {
      const currL = waveLSelect.value;
      waveLSelect.innerHTML = "";
      waveforms.forEach((name, idx) => {
        const opt = document.createElement("option");
        opt.value = idx + 1;
        opt.textContent = name;
        waveLSelect.appendChild(opt);
      });
      if (currL && waveLSelect.querySelector(`option[value="${currL}"]`)) {
        waveLSelect.value = currL;
      }
    }
    if (waveRSelect) {
      const currR = waveRSelect.value;
      waveRSelect.innerHTML = '<option value="0">OFF</option>';
      waveforms.forEach((name, idx) => {
        const opt = document.createElement("option");
        opt.value = idx + 1;
        opt.textContent = name;
        waveRSelect.appendChild(opt);
      });
      if (currR && waveRSelect.querySelector(`option[value="${currR}"]`)) {
        waveRSelect.value = currR;
      }
    }
  }
  function bindPatchControls() {
    populateMatrixDropdowns();
    populateWaveDropdowns();
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
        sendThrottled(`patch_common_${s.param}`, () => {
          sendPatchCommonParam(midi, currentPart(), s.param, val, getDeviceId());
        });
      });
      $(s.el).addEventListener("change", () => {
        const val = parseInt($(s.el).value, 10);
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
    populateMatrixGridDropdowns();
    for (let m = 1; m <= 4; m++) {
      for (let d = 1; d <= 4; d++) {
        const cellEl = $(`matrixKnob_${m}_${d}`);
        if (!cellEl) continue;
        const knob = new RotaryKnob(cellEl, {
          id: `knob_matrix_${m}_${d}`,
          min: 1,
          max: 127,
          defaultValue: 64,
          value: 64,
          size: 26,
          bipolar: true,
          color: "var(--accent, #ff7700)",
          formatValue: (v) => v === 64 ? "0" : v > 64 ? `+${v - 64}` : `${v - 64}`,
          onChange: (val) => {
            if (currentPatchCommonData) {
              currentPatchCommonData[`matrix${m}Sens${d}`] = val;
            }
            if (m === currentMatrixIndex) {
              const compEl = $(`matrixSens${d}`);
              if (compEl) compEl.value = val;
              const compVal = $(`matrixSens${d}Val`);
              if (compVal) compVal.textContent = val - 64;
            }
            if (!midi.isConnected) return;
            sendThrottled(`matrixSens_${m}_${d}`, () => {
              sendMatrixControlParam(midi, currentPart(), m, `SENS_${d}`, val, getDeviceId());
            });
          }
        });
        matrixGridKnobs[`${m}_${d}`] = knob;
      }
      const srcSel = $(`matrix${m}Source`);
      if (srcSel) {
        srcSel.addEventListener("change", () => {
          const val = parseInt(srcSel.value, 10);
          if (currentPatchCommonData) {
            currentPatchCommonData[`matrix${m}Source`] = val;
          }
          if (m === currentMatrixIndex) {
            const compSrc = $("matrixSource");
            if (compSrc) compSrc.value = val;
          }
          if (!midi.isConnected) return;
          sendMatrixControlParam(midi, currentPart(), m, "SOURCE", val, getDeviceId());
        });
      }
    }
    for (let d = 1; d <= 4; d++) {
      const destSel = $(`matrixDestRow${d}`);
      if (destSel) {
        destSel.addEventListener("change", () => {
          const val = parseInt(destSel.value, 10);
          if (currentPatchCommonData) {
            for (let m = 1; m <= 4; m++) {
              currentPatchCommonData[`matrix${m}Dest${d}`] = val;
            }
          }
          const compDest = $(`matrixDest${d}`);
          if (compDest) compDest.value = val;
          if (!midi.isConnected) return;
          for (let m = 1; m <= 4; m++) {
            sendMatrixControlParam(midi, currentPart(), m, `DEST_${d}`, val, getDeviceId());
          }
        });
      }
    }
    for (let m = 1; m <= 4; m++) {
      const btn = $(`btnMatrix${m}`);
      if (btn) {
        btn.addEventListener("click", () => {
          for (let i = 1; i <= 4; i++) {
            const b = $(`btnMatrix${i}`);
            if (b) b.classList.toggle("active", i === m);
          }
          currentMatrixIndex = m;
          updateMatrixUI(m);
        });
      }
    }
    const legacySrc = $("matrixSource");
    if (legacySrc) {
      legacySrc.addEventListener("change", () => {
        const val = parseInt(legacySrc.value, 10);
        if (currentPatchCommonData) currentPatchCommonData[`matrix${currentMatrixIndex}Source`] = val;
        const gridSrc = $(`matrix${currentMatrixIndex}Source`);
        if (gridSrc) gridSrc.value = val;
        if (!midi.isConnected) return;
        sendMatrixControlParam(midi, currentPart(), currentMatrixIndex, "SOURCE", val, getDeviceId());
      });
    }
    for (let d = 1; d <= 4; d++) {
      const legacyDest = $(`matrixDest${d}`);
      if (legacyDest) {
        legacyDest.addEventListener("change", () => {
          const val = parseInt(legacyDest.value, 10);
          if (currentPatchCommonData) currentPatchCommonData[`matrix${currentMatrixIndex}Dest${d}`] = val;
          const rowDest = $(`matrixDestRow${d}`);
          if (rowDest) rowDest.value = val;
          if (!midi.isConnected) return;
          sendMatrixControlParam(midi, currentPart(), currentMatrixIndex, `DEST_${d}`, val, getDeviceId());
        });
      }
      const legacySens = $(`matrixSens${d}`);
      if (legacySens) {
        legacySens.addEventListener("input", () => {
          const val = parseInt(legacySens.value, 10);
          const sensValEl = $(`matrixSens${d}Val`);
          if (sensValEl) sensValEl.textContent = val - 64;
          if (currentPatchCommonData) currentPatchCommonData[`matrix${currentMatrixIndex}Sens${d}`] = val;
          const knob = matrixGridKnobs[`${currentMatrixIndex}_${d}`];
          if (knob) knob.setValue(val, false);
          if (!midi.isConnected) return;
          sendThrottled(`matrixSens_${currentMatrixIndex}_${d}`, () => {
            sendMatrixControlParam(midi, currentPart(), currentMatrixIndex, `SENS_${d}`, val, getDeviceId());
          });
        });
        legacySens.addEventListener("change", () => {
          const val = parseInt(legacySens.value, 10);
          if (!midi.isConnected) return;
          sendMatrixControlParam(midi, currentPart(), currentMatrixIndex, `SENS_${d}`, val, getDeviceId());
        });
      }
    }
    $("struct12").addEventListener("change", () => {
      if (!midi.isConnected) return;
      sendPatchTMTParam(midi, currentPart(), "STRUCTURE_TYPE_1_2", parseInt($("struct12").value, 10), getDeviceId());
    });
    $("booster12").addEventListener("change", () => {
      if ($("tvfFilterDrive") && (currentToneIndex === 1 || currentToneIndex === 2 || isAllTonesLinked)) {
        $("tvfFilterDrive").value = $("booster12").value;
      }
      if (!midi.isConnected) return;
      sendPatchTMTParam(midi, currentPart(), "BOOSTER_1_2", parseInt($("booster12").value, 10), getDeviceId());
    });
    $("struct34").addEventListener("change", () => {
      if (!midi.isConnected) return;
      sendPatchTMTParam(midi, currentPart(), "STRUCTURE_TYPE_3_4", parseInt($("struct34").value, 10), getDeviceId());
    });
    $("booster34").addEventListener("change", () => {
      if ($("tvfFilterDrive") && (currentToneIndex === 3 || currentToneIndex === 4)) {
        $("tvfFilterDrive").value = $("booster34").value;
      }
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
      sendThrottled(`tmtKeyLower_${currentToneIndex}`, () => {
        sendTMTKeyRangeParam(midi, currentPart(), currentToneIndex, "KEY_LOWER", val, getDeviceId());
      });
    });
    $("tmtKeyLower").addEventListener("change", () => {
      if (!midi.isConnected) return;
      sendTMTKeyRangeParam(midi, currentPart(), currentToneIndex, "KEY_LOWER", parseInt($("tmtKeyLower").value, 10), getDeviceId());
    });
    $("tmtKeyUpper").addEventListener("input", () => {
      const val = parseInt($("tmtKeyUpper").value, 10);
      $("tmtKeyUpperVal").textContent = formatKeyNote(val);
      if (!midi.isConnected) return;
      sendThrottled(`tmtKeyUpper_${currentToneIndex}`, () => {
        sendTMTKeyRangeParam(midi, currentPart(), currentToneIndex, "KEY_UPPER", val, getDeviceId());
      });
    });
    $("tmtKeyUpper").addEventListener("change", () => {
      if (!midi.isConnected) return;
      sendTMTKeyRangeParam(midi, currentPart(), currentToneIndex, "KEY_UPPER", parseInt($("tmtKeyUpper").value, 10), getDeviceId());
    });
    $("tmtVelLower").addEventListener("input", () => {
      const val = parseInt($("tmtVelLower").value, 10);
      $("tmtVelLowerVal").textContent = val;
      if (!midi.isConnected) return;
      sendThrottled(`tmtVelLower_${currentToneIndex}`, () => {
        sendTMTKeyRangeParam(midi, currentPart(), currentToneIndex, "VEL_LOWER", val, getDeviceId());
      });
    });
    $("tmtVelLower").addEventListener("change", () => {
      if (!midi.isConnected) return;
      sendTMTKeyRangeParam(midi, currentPart(), currentToneIndex, "VEL_LOWER", parseInt($("tmtVelLower").value, 10), getDeviceId());
    });
    $("tmtVelUpper").addEventListener("input", () => {
      const val = parseInt($("tmtVelUpper").value, 10);
      $("tmtVelUpperVal").textContent = val;
      if (!midi.isConnected) return;
      sendThrottled(`tmtVelUpper_${currentToneIndex}`, () => {
        sendTMTKeyRangeParam(midi, currentPart(), currentToneIndex, "VEL_UPPER", val, getDeviceId());
      });
    });
    $("tmtVelUpper").addEventListener("change", () => {
      if (!midi.isConnected) return;
      sendTMTKeyRangeParam(midi, currentPart(), currentToneIndex, "VEL_UPPER", parseInt($("tmtVelUpper").value, 10), getDeviceId());
    });
    for (let t = 1; t <= 4; t++) {
      $(`tone${t}Switch`).addEventListener("change", () => {
        const on = $(`tone${t}Switch`).checked;
        $(`tone${t}Switch`).closest(".tone-switch")?.classList.toggle("active", on);
        const stateEl = $(`tonePlaybackState${t}`);
        if (stateEl) {
          stateEl.textContent = on ? "SOUNDING" : "MUTED";
          stateEl.classList.toggle("playing", on);
          stateEl.classList.toggle("muted", !on);
        }
        const dot = $(`toneStatusDot${t}`);
        if (dot) {
          dot.classList.toggle("on", on);
          dot.classList.toggle("off", !on);
        }
        if (currentPatchTMTData) currentPatchTMTData[`tone${t}Switch`] = on ? 1 : 0;
        if (!midi.isConnected) return;
        sendToneSwitch(midi, currentPart(), t, on, getDeviceId());
        setStatus(`Tone ${t} ${on ? "SOUNDING (Unmuted)" : "MUTED (Silent)"}`);
      });
    }
    document.querySelectorAll(".tone-switch").forEach((card) => {
      card.addEventListener("click", (e) => {
        if (e.target.closest(".toggle")) return;
        const t = parseInt(card.dataset.tone, 10);
        if (t >= 1 && t <= 4) {
          selectToneTarget(t);
        }
      });
    });
    for (let t = 1; t <= 4; t++) {
      $(`btnSelectTone${t}`)?.addEventListener("click", () => {
        selectToneTarget(t);
      });
    }
    $("btnSelectToneAll")?.addEventListener("click", () => {
      selectToneTarget("all");
    });
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
        dispatchToneParam(s.param, val, true, `tone_${s.param}`);
      });
      $(s.el).addEventListener("change", () => {
        const val = parseInt($(s.el).value, 10);
        if (s.onUpdate) s.onUpdate();
        dispatchToneParam(s.param, val, false);
      });
    }
    $("waveGroup").addEventListener("change", () => {
      const val = $("waveGroup").value;
      let grp = 0;
      let grpId = 0;
      let slot = "A";
      if (val === "SRX-A" || val === "2" || val === 2) {
        grp = 2;
        grpId = 1;
        slot = "A";
      } else if (val === "SRX-B") {
        grp = 2;
        grpId = 2;
        slot = "B";
      } else {
        grp = 0;
        grpId = 0;
      }
      populateWaveDropdowns(grp, slot);
      const numL = parseInt($("waveNumberL").value, 10) || 1;
      const numR = parseInt($("waveNumberR").value, 10) || 0;
      const targets = getActiveToneTargets();
      for (const t of targets) {
        const cached = currentToneCache[t - 1] || {};
        cached.waveGroupType = grp;
        cached.waveGroupId = grpId;
        cached.waveNumberL = numL;
        cached.waveNumberR = numR;
        if (midi.isConnected) {
          sendPatchToneParam(midi, currentPart(), t, "WAVE_GROUP_TYPE", grp, getDeviceId());
          sendPatchToneParam(midi, currentPart(), t, "WAVE_GROUP_ID", grpId, getDeviceId());
          sendPatchToneParam(midi, currentPart(), t, "WAVE_NUMBER_L", numL, getDeviceId());
          if (numR > 0) {
            sendPatchToneParam(midi, currentPart(), t, "WAVE_NUMBER_R", numR, getDeviceId());
          }
        }
      }
      const nl = $("waveNameL");
      if (nl) nl.textContent = formatToneWaveName(grp, numL, slot);
      const nr = $("waveNameR");
      if (nr) nr.textContent = numR === 0 ? "OFF" : formatToneWaveName(grp, numR, slot);
      const badge = $("waveBankBadge");
      if (badge) {
        badge.textContent = grp === 0 ? "1,083 WAVES" : `SRX Slot ${slot}`;
      }
    });
    $("waveNumberL").addEventListener("change", () => {
      const val = parseInt($("waveNumberL").value, 10) || 1;
      const wgVal = $("waveGroup").value;
      const grp = wgVal === "SRX-A" || wgVal === "SRX-B" ? 2 : 0;
      const slot = wgVal === "SRX-B" ? "B" : "A";
      const nl = $("waveNameL");
      if (nl) nl.textContent = formatToneWaveName(grp, val, slot);
      const targets = getActiveToneTargets();
      for (const t of targets) {
        if (currentToneCache[t - 1]) currentToneCache[t - 1].waveNumberL = val;
        if (midi.isConnected) {
          sendPatchToneParam(midi, currentPart(), t, "WAVE_NUMBER_L", val, getDeviceId());
        }
      }
    });
    $("waveNumberR").addEventListener("change", () => {
      const val = parseInt($("waveNumberR").value, 10) || 0;
      const wgVal = $("waveGroup").value;
      const grp = wgVal === "SRX-A" || wgVal === "SRX-B" ? 2 : 0;
      const slot = wgVal === "SRX-B" ? "B" : "A";
      const nr = $("waveNameR");
      if (nr) nr.textContent = val === 0 ? "OFF" : formatToneWaveName(grp, val, slot);
      const targets = getActiveToneTargets();
      for (const t of targets) {
        if (currentToneCache[t - 1]) currentToneCache[t - 1].waveNumberR = val;
        if (midi.isConnected) {
          sendPatchToneParam(midi, currentPart(), t, "WAVE_NUMBER_R", val, getDeviceId());
        }
      }
    });
    $("waveGain").addEventListener("change", () => {
      const val = parseInt($("waveGain").value, 10);
      if ($("tvfWaveGain")) $("tvfWaveGain").value = val;
      dispatchToneParam("WAVE_GAIN", val, false);
    });
    $("tvfWaveGain")?.addEventListener("change", () => {
      const val = parseInt($("tvfWaveGain").value, 10);
      if ($("waveGain")) $("waveGain").value = val;
      dispatchToneParam("WAVE_GAIN", val, false);
      setStatus(`Wave Pre-Filter Input Gain: ${$("tvfWaveGain").options[$("tvfWaveGain").selectedIndex].text}`);
    });
    $("tvfFilterDrive")?.addEventListener("change", () => {
      const driveVal = parseInt($("tvfFilterDrive").value, 10);
      const applyDrive = (pair) => {
        const boosterParam = pair === 1 ? "BOOSTER_1_2" : "BOOSTER_3_4";
        const structParam = pair === 1 ? "STRUCTURE_TYPE_1_2" : "STRUCTURE_TYPE_3_4";
        const boosterEl = pair === 1 ? $("booster12") : $("booster34");
        const structEl = pair === 1 ? $("struct12") : $("struct34");
        if (boosterEl) boosterEl.value = driveVal;
        let structVal = structEl ? parseInt(structEl.value, 10) : 0;
        if (driveVal > 0 && (structVal === 0 || structVal === 1)) {
          structVal = 3;
          if (structEl) structEl.value = structVal;
          if (midi.isConnected) {
            sendPatchTMTParam(midi, currentPart(), structParam, structVal, getDeviceId());
          }
        }
        if (midi.isConnected) {
          sendPatchTMTParam(midi, currentPart(), boosterParam, driveVal, getDeviceId());
        }
      };
      if (isAllTonesLinked) {
        applyDrive(1);
        applyDrive(2);
        setStatus(`TVF Pre-Filter Drive: ${$("tvfFilterDrive").options[$("tvfFilterDrive").selectedIndex].text} (All Tones Linked)`);
      } else {
        const pair = currentToneIndex === 1 || currentToneIndex === 2 ? 1 : 2;
        applyDrive(pair);
        setStatus(`TVF Pre-Filter Drive: ${$("tvfFilterDrive").options[$("tvfFilterDrive").selectedIndex].text} (Tones ${pair === 1 ? "1 & 2" : "3 & 4"})`);
      }
    });
    $("waveFxmSwitch").addEventListener("change", () => {
      dispatchToneParam("WAVE_FXM_SWITCH", $("waveFxmSwitch").checked ? 1 : 0, false);
    });
    $("waveFxmColor").addEventListener("change", () => {
      dispatchToneParam("WAVE_FXM_COLOR", parseInt($("waveFxmColor").value, 10), false);
    });
    $("waveTempoSync").addEventListener("change", () => {
      dispatchToneParam("WAVE_TEMPO_SYNC", $("waveTempoSync").checked ? 1 : 0, false);
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
        dispatchToneParam(p.param, val, true, `pitchEnv_${p.param}`);
      });
      $(p.el).addEventListener("change", () => {
        redrawPitchEnvCurve();
        const val = parseInt($(p.el).value, 10);
        dispatchToneParam(p.param, val, false);
      });
    }
    $("toneFilterType").addEventListener("change", () => {
      redrawFilterCurves();
      const val = parseInt($("toneFilterType").value, 10);
      dispatchToneParam("TVF_FILTER_TYPE", val, false);
    });
    const tvfEnvInputs = [
      { el: "tvfEnvDepth", valEl: "tvfEnvDepthVal", param: "TVF_ENV_DEPTH", format: (v) => v - 64 },
      { el: "tvfEnvT1", valEl: "tvfEnvT1Val", param: "TVF_ENV_T1", format: (v) => v },
      { el: "tvfEnvT2", valEl: "tvfEnvT2Val", param: "TVF_ENV_T2", format: (v) => v },
      { el: "tvfEnvT3", valEl: "tvfEnvT3Val", param: "TVF_ENV_T3", format: (v) => v },
      { el: "tvfEnvT4", valEl: "tvfEnvT4Val", param: "TVF_ENV_T4", format: (v) => v },
      { el: "tvfEnvL3", valEl: "tvfEnvL3Val", param: "TVF_ENV_L3", format: (v) => v }
    ];
    for (const t of tvfEnvInputs) {
      const el = $(t.el);
      if (!el) continue;
      el.addEventListener("input", () => {
        const val = parseInt(el.value, 10);
        const valEl = $(t.valEl);
        if (valEl) valEl.textContent = t.format(val);
        redrawFilterCurves();
        dispatchToneParam(t.param, val, true, `tvfEnv_${t.param}`);
      });
      el.addEventListener("change", () => {
        redrawFilterCurves();
        const val = parseInt(el.value, 10);
        dispatchToneParam(t.param, val, false);
      });
    }
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
        dispatchToneParam(t.param, val, true, `tvaEnv_${t.param}`);
      });
      $(t.el).addEventListener("change", () => {
        redrawTVAEnvCurve();
        const val = parseInt($(t.el).value, 10);
        dispatchToneParam(t.param, val, false);
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
      dispatchToneLFOParam(currentLfoIndex, "FORM", val, false);
    });
    $("lfoRate").addEventListener("input", () => {
      const val = parseInt($("lfoRate").value, 10);
      $("lfoRateVal").textContent = val;
      redrawLFOCurve();
      dispatchToneLFOParam(currentLfoIndex, "RATE", val, true, "lfoRate");
    });
    $("lfoRate").addEventListener("change", () => {
      redrawLFOCurve();
      const val = parseInt($("lfoRate").value, 10);
      dispatchToneLFOParam(currentLfoIndex, "RATE", val, false);
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
        dispatchToneLFOParam(currentLfoIndex, d.param, val, true, `lfoDepth_${d.param}`);
      });
      $(d.el).addEventListener("change", () => {
        const val = parseInt($(d.el).value, 10);
        dispatchToneLFOParam(currentLfoIndex, d.param, val, false);
      });
    }
    const entirePatchBtn = $("loadEntirePatchBtn");
    if (entirePatchBtn) {
      entirePatchBtn.addEventListener("click", async () => {
        if (!midi.isConnected) {
          setStatus("Not connected");
          return;
        }
        const part = currentPart();
        setStatus(`Loading entire patch for Part ${part} (Common, TMT, and all 4 Tones)...`);
        try {
          const patch = await requestEntirePatch(midi, part, getDeviceId(), (stage, cur, total) => {
            setStatus(`Loading Part ${part} patch: ${stage} (${cur + 1}/${total})...`);
          });
          updatePatchCommonUI(patch.common);
          updatePatchTMTUI(patch.tmt);
          patch.tones.forEach((toneData, idx) => {
            store.set(`patch.tones.${idx}`, toneData);
            currentToneCache[idx] = toneData;
          });
          updateToneUI(patch.tones[currentToneIndex - 1]);
          setStatus(`Successfully loaded entire patch: "${patch.common.name}" with 4 tones & wave data`);
        } catch (e) {
          setStatus(`Failed loading entire patch: ${e.message}`);
        }
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
          await new Promise((r) => setTimeout(r, 30));
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
      const tonesData = [];
      for (let t = 1; t <= 4; t++) {
        const toneBytes = new Array(265).fill(0);
        const cached = currentToneCache[t - 1] || store.get(`patch.tones.${t - 1}`) || {};
        toneBytes[0] = cached.toneLevel ?? 127;
        toneBytes[1] = cached.coarseTune ?? 64;
        toneBytes[2] = cached.fineTune ?? 64;
        toneBytes[4] = cached.tonePan ?? 64;
        const grp = cached.waveGroupType ?? 0;
        toneBytes[39] = grp;
        const wNumL = cached.waveNumberL ?? (t === 1 ? 1 : 0);
        toneBytes[44] = wNumL >> 12 & 15;
        toneBytes[45] = wNumL >> 8 & 15;
        toneBytes[46] = wNumL >> 4 & 15;
        toneBytes[47] = wNumL & 15;
        const wNumR = cached.waveNumberR ?? 0;
        toneBytes[48] = wNumR >> 12 & 15;
        toneBytes[49] = wNumR >> 8 & 15;
        toneBytes[50] = wNumR >> 4 & 15;
        toneBytes[51] = wNumR & 15;
        toneBytes[52] = cached.waveGain ?? 1;
        toneBytes[53] = cached.fxmSwitch ?? 0;
        toneBytes[54] = cached.fxmColor ?? 0;
        toneBytes[55] = cached.fxmDepth ?? 0;
        toneBytes[56] = cached.waveTempoSync ?? 0;
        toneBytes[58] = cached.pitchEnvDepth ?? 64;
        toneBytes[63] = cached.pitchEnvT1 ?? 0;
        toneBytes[64] = cached.pitchEnvT2 ?? 0;
        toneBytes[65] = cached.pitchEnvT3 ?? 0;
        toneBytes[66] = cached.pitchEnvT4 ?? 0;
        toneBytes[68] = cached.pitchEnvL1 ?? 64;
        toneBytes[72] = cached.tvfFilterType ?? 1;
        toneBytes[73] = cached.tvfCutoff ?? 127;
        toneBytes[77] = cached.tvfResonance ?? 0;
        toneBytes[79] = cached.tvfEnvDepth ?? 64;
        toneBytes[85] = cached.tvfEnvT1 ?? 15;
        toneBytes[86] = cached.tvfEnvT2 ?? 25;
        toneBytes[87] = cached.tvfEnvT3 ?? 40;
        toneBytes[88] = cached.tvfEnvT4 ?? 40;
        toneBytes[91] = cached.tvfEnvL3 ?? 60;
        toneBytes[98] = cached.tvaLevel ?? 127;
        tonesData.push(toneBytes);
      }
      const packets = createPatchSyxDump(getSelectedPart(), commonBytes, tmtBytes, tonesData, getDeviceId());
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
      const tonesSnapshot = [1, 2, 3, 4].map((t) => {
        const cached = currentToneCache[t - 1] || store.get(`patch.tones.${t - 1}`) || {};
        return {
          toneLevel: cached.toneLevel ?? 127,
          coarseTune: cached.coarseTune ?? 64,
          fineTune: cached.fineTune ?? 64,
          tonePan: cached.tonePan ?? 64,
          waveGroupType: cached.waveGroupType ?? 0,
          waveNumberL: cached.waveNumberL ?? (t === 1 ? 1 : 0),
          waveNumberR: cached.waveNumberR ?? 0,
          waveGain: cached.waveGain ?? 1,
          fxmSwitch: cached.fxmSwitch ?? 0,
          fxmColor: cached.fxmColor ?? 0,
          fxmDepth: cached.fxmDepth ?? 0,
          waveTempoSync: cached.waveTempoSync ?? 0
        };
      });
      const slotData = {
        name,
        timestamp: Date.now(),
        level: parseInt($("patchLevel").value, 10),
        pan: parseInt($("patchPan").value, 10),
        coarse: parseInt($("patchCoarseTune").value, 10),
        fine: parseInt($("patchFineTune").value, 10),
        monoPoly: parseInt($("patchMonoPoly").value, 10),
        tones: tonesSnapshot
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
        if (Array.isArray(s.tones)) {
          s.tones.forEach((toneData, tIdx) => {
            store.set(`patch.tones.${tIdx}`, toneData);
            currentToneCache[tIdx] = toneData;
          });
          if (currentToneCache[currentToneIndex - 1]) {
            updateToneUI(currentToneCache[currentToneIndex - 1]);
          }
        }
        setStatus(`Recalled patch '${s.name}' with wave parameters from slot ${idx + 1}`);
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
  var activeTranspiledPatch = null;
  function displayTranspiledResult(transpiled) {
    if (!transpiled || !transpiled.xvPatch) return;
    activeTranspiledPatch = transpiled;
    const resContainer = $("vstResultContainer");
    if (resContainer) resContainer.style.display = "block";
    const nameEl = $("vstResultPatchName");
    if (nameEl) nameEl.textContent = transpiled.xvPatch.common.patchName || transpiled.source.name || "VST PATCH";
    const engineEl = $("vstResultEngine");
    if (engineEl) engineEl.textContent = `${transpiled.source.engine || transpiled.source.format.toUpperCase()} Transpilation`;
    const tones = Array.isArray(transpiled.xvPatch.tones) ? transpiled.xvPatch.tones : [transpiled.xvPatch.tones[1], transpiled.xvPatch.tones[2], transpiled.xvPatch.tones[3], transpiled.xvPatch.tones[4]];
    for (let t = 0; t < 4; t++) {
      const tone = tones[t] || {};
      const waveEl = $(`vstTone${t + 1}Wave`);
      const paramsEl = $(`vstTone${t + 1}Params`);
      if (waveEl) {
        if (tone.enabled) {
          const wNum = tone.waveNumberL || 1;
          const wName = getWaveName(tone.waveGroupType || 0, wNum);
          waveEl.textContent = `Wave #${wNum}: ${wName}`;
        } else {
          waveEl.textContent = "Disabled / Off";
        }
      }
      if (paramsEl) {
        if (tone.enabled) {
          const panStr = panDisplay(tone.tonePan ?? 64);
          const tuneSemi = (tone.coarseTune ?? 64) - 64;
          const detuneCents = (tone.fineTune ?? 64) - 64;
          paramsEl.textContent = `Level: ${tone.toneLevel ?? 127} | Pan: ${panStr} | Tune: ${tuneSemi >= 0 ? "+" : ""}${tuneSemi}st, ${detuneCents >= 0 ? "+" : ""}${detuneCents}c`;
        } else {
          paramsEl.textContent = "Tone slot muted";
        }
      }
    }
    const c = transpiled.xvPatch.common;
    const fEl = $("vstReportFilter");
    if (fEl) {
      const t1 = tones[0] || {};
      const fType = FILTER_TYPES[t1.tvfFilterType ?? t1.filterType ?? 1] || "LPF";
      fEl.textContent = `TVF ${fType} (Cutoff: ${t1.tvfCutoff ?? t1.cutoff ?? 127}, Res: ${t1.tvfResonance ?? t1.resonance ?? 0})`;
    }
    const envEl = $("vstReportEnv");
    if (envEl) {
      const t1 = tones[0] || {};
      envEl.textContent = `TVA (A:${t1.tvaEnvT1 ?? 10}, D:${t1.tvaEnvT2 ?? 20}, S:${t1.tvaEnvL3 ?? 70}, R:${t1.tvaEnvT4 ?? 30})`;
    }
    const fxEl = $("vstReportFx");
    if (fxEl) {
      fxEl.textContent = `Chorus: ${c.chorusSend ?? 0}, Reverb: ${c.reverbSend ?? 0}`;
    }
    const voiceEl = $("vstReportVoice");
    if (voiceEl) {
      voiceEl.textContent = `${c.monoPoly === 0 ? "Mono" : "Poly"} (Porta: ${c.portamentoSwitch ? c.portamentoTime : "OFF"})`;
    }
    const statusEl = $("vstTranspileStatus");
    if (statusEl) {
      statusEl.innerHTML = `<span style="color:var(--success); font-weight:600;">\u2713 Successfully analyzed & transpiled "${c.patchName}" (${transpiled.source.format.toUpperCase()} -> XV-5050 4-Tone). Ready to load or transmit.</span>`;
    }
  }
  function loadTranspiledPatchIntoEditor(transpiled) {
    if (!transpiled || !transpiled.xvPatch) return;
    const common = transpiled.xvPatch.common;
    const tmt = transpiled.xvPatch.tmt;
    const tones = Array.isArray(transpiled.xvPatch.tones) ? transpiled.xvPatch.tones : [transpiled.xvPatch.tones[1], transpiled.xvPatch.tones[2], transpiled.xvPatch.tones[3], transpiled.xvPatch.tones[4]];
    store.set("patch.common", common);
    updatePatchCommonUI(common);
    store.set("patch.tmt", tmt);
    updatePatchTMTUI(tmt);
    for (let i = 0; i < 4; i++) {
      const tData = tones[i] || {};
      store.set("patch.tones." + i, tData);
      currentToneCache[i] = tData;
    }
    const activeTone = currentToneCache[currentToneIndex - 1];
    if (activeTone) updateToneUI(activeTone);
    if (typeof syncDeepStudioToneCards === "function") syncDeepStudioToneCards();
    if (typeof updateDeepStudioSpectrum === "function") updateDeepStudioSpectrum();
    markEdited();
    switchToTab("patch");
    setStatus(`Loaded transpiled patch "${common.patchName || "VST PATCH"}" into Patch Editor`);
  }
  async function sendTranspiledPatchToHardware(transpiled) {
    if (!transpiled || !transpiled.xvPatch) return;
    if (!midi.isConnected) {
      setStatus("Connect MIDI first before transmitting to hardware");
      return;
    }
    const patchName = transpiled.xvPatch.common.patchName || "VST PATCH";
    setStatus(`Transmitting transpiled patch "${patchName}" directly to Roland XV-5050 temporary buffer...`);
    try {
      const effPart = getEffectivePatchPart() || 1;
      const { packets } = buildTranspiledPatchSyx(transpiled, effPart, getDeviceId());
      for (const pkt of packets) {
        midi.send(pkt);
        await new Promise((r) => setTimeout(r, 25));
      }
      loadTranspiledPatchIntoEditor(transpiled);
      setStatus(`\u2713 Transmitted transpiled patch "${patchName}" directly to XV-5050 (Part ${effPart})`);
    } catch (err) {
      console.error("Failed to send transpiled patch to synth:", err);
      setStatus(`Transmission failed: ${err.message}`);
    }
  }
  function exportTranspiledPatchSyx(transpiled) {
    if (!transpiled || !transpiled.xvPatch) return;
    const patchName = transpiled.xvPatch.common.patchName || "VST PATCH";
    const effPart = getEffectivePatchPart() || 1;
    const { syxBytes } = buildTranspiledPatchSyx(transpiled, effPart, getDeviceId());
    const safeName = patchName.trim().replace(/[^a-zA-Z0-9_-]/g, "_") || "vst_patch";
    downloadBinaryBlob(syxBytes, `${safeName}.syx`);
    setStatus(`Exported transpiled patch to ${safeName}.syx`);
  }
  async function handleVstFile(file) {
    const statusEl = $("vstTranspileStatus");
    if (statusEl) statusEl.textContent = `Reading and transpiling ${file.name}...`;
    try {
      const transpiled = await transpileVstFile(file);
      displayTranspiledResult(transpiled);
    } catch (err) {
      if (statusEl) {
        statusEl.innerHTML = `<span style="color:var(--danger); font-weight:600;">Error transpiling ${file.name}: ${err.message}</span>`;
      }
    }
  }
  function initVstTranspiler() {
    const btnOpen = $("btnOpenVstTranspiler");
    if (btnOpen) {
      btnOpen.addEventListener("click", (e) => {
        e.stopPropagation();
        switchToTab("librarian");
        const card = $("vstTranspilerCard");
        if (card) {
          card.scrollIntoView({ behavior: "smooth", block: "start" });
          card.classList.add("flash-highlight");
          setTimeout(() => card.classList.remove("flash-highlight"), 1200);
        }
      });
    }
    const demoSelect = $("vstDemoPresetSelect");
    if (demoSelect) {
      demoSelect.addEventListener("change", () => {
        const val = demoSelect.value;
        if (!val) return;
        const demo = VST_DEMO_PATCHES.find((d) => d.id === val);
        if (demo) {
          try {
            const transpiled = parseVitalPatch(demo.data);
            displayTranspiledResult(transpiled);
          } catch (err) {
            const statusEl = $("vstTranspileStatus");
            if (statusEl) statusEl.textContent = `Error loading demo preset: ${err.message}`;
          }
        }
      });
    }
    const dropzone = $("vstDropzone");
    const fileInput = $("vstFileInput");
    if (dropzone && fileInput) {
      dropzone.addEventListener("click", () => fileInput.click());
      dropzone.addEventListener("dragover", (e) => {
        e.preventDefault();
        dropzone.classList.add("dragover");
      });
      dropzone.addEventListener("dragleave", () => dropzone.classList.remove("dragover"));
      dropzone.addEventListener("drop", async (e) => {
        e.preventDefault();
        dropzone.classList.remove("dragover");
        if (e.dataTransfer.files.length > 0) {
          await handleVstFile(e.dataTransfer.files[0]);
        }
      });
      fileInput.addEventListener("change", async () => {
        if (fileInput.files.length > 0) {
          await handleVstFile(fileInput.files[0]);
        }
      });
    }
    const btnLoad = $("btnLoadTranspiledPatch");
    if (btnLoad) {
      btnLoad.addEventListener("click", () => {
        if (activeTranspiledPatch) loadTranspiledPatchIntoEditor(activeTranspiledPatch);
      });
    }
    const btnSend = $("btnSendTranspiledToSynth");
    if (btnSend) {
      btnSend.addEventListener("click", async () => {
        if (activeTranspiledPatch) await sendTranspiledPatchToHardware(activeTranspiledPatch);
      });
    }
    const btnExport = $("btnExportTranspiledSyx");
    if (btnExport) {
      btnExport.addEventListener("click", () => {
        if (activeTranspiledPatch) exportTranspiledPatchSyx(activeTranspiledPatch);
      });
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
  async function loadEntirePerformanceData() {
    if (!midi.isConnected) {
      setStatus("Not connected");
      return;
    }
    const progEl = $("loadProgress");
    setStatus("Loading entire performance (Common, Effects, 16 Parts + Patch Names)...");
    try {
      const perf = await requestEntirePerformance(midi, getDeviceId(), (stage, cur, total, data) => {
        if (progEl) progEl.textContent = `Reading ${stage} (${cur + 1}/${total})...`;
        if (stage === "common" && data) updatePerformanceCommonUI(data);
        if (stage === "mfxA" && data) {
          perfMfxCache.A = data;
          updatePerfMfxBadges("A", data.mfxType);
          if (activePerfMfxSlot === "A") applyPerfMfxToUI(data);
        }
        if (stage === "mfxB" && data) {
          perfMfxCache.B = data;
          updatePerfMfxBadges("B", data.mfxType);
          if (activePerfMfxSlot === "B") applyPerfMfxToUI(data);
        }
        if (stage === "mfxC" && data) {
          perfMfxCache.C = data;
          updatePerfMfxBadges("C", data.mfxType);
          if (activePerfMfxSlot === "C") applyPerfMfxToUI(data);
        }
        if (stage === "chorus" && data) updatePerformanceChorusUI(data);
        if (stage === "reverb" && data) updatePerformanceReverbUI(data);
      });
      updatePerformanceCommonUI(perf.common);
      if (perf.mfxA) {
        perfMfxCache.A = perf.mfxA;
        updatePerfMfxBadges("A", perf.mfxA.mfxType);
      }
      if (perf.mfxB) {
        perfMfxCache.B = perf.mfxB;
        updatePerfMfxBadges("B", perf.mfxB.mfxType);
      }
      if (perf.mfxC) {
        perfMfxCache.C = perf.mfxC;
        updatePerfMfxBadges("C", perf.mfxC.mfxType);
      }
      if (perfMfxCache[activePerfMfxSlot]) {
        applyPerfMfxToUI(perfMfxCache[activePerfMfxSlot]);
      }
      updatePerformanceChorusUI(perf.chorus);
      updatePerformanceReverbUI(perf.reverb);
      perf.parts.forEach((p, idx) => updatePartRow(idx + 1, p));
      if (!syncedUnitDb) {
        syncedUnitDb = {
          setup: null,
          system: { common: null, eq: null },
          currentPerformance: perf,
          activePatches: [],
          userPerformances: [],
          userPatches: [],
          userRhythms: []
        };
      } else {
        syncedUnitDb.currentPerformance = perf;
      }
      populateAllInstrumentSelectors();
      renderPartNavigationStrip();
      saveSyncedDbToStorage();
      if (progEl) progEl.textContent = "Entire performance loaded";
      setStatus(`Successfully loaded Performance: "${perf.common.name}" (Common, 3-MFX, Chorus, Reverb, 16 Parts)`);
    } catch (e) {
      if (progEl) progEl.textContent = "";
      setStatus(`Failed loading entire performance: ${e.message}`);
    }
  }
  async function loadAllPartsData() {
    if (!midi.isConnected) {
      setStatus("Not connected");
      return;
    }
    const progEl = $("loadProgress");
    setStatus("Loading all 16 parts with patch names...");
    try {
      const parts = await requestAllParts(midi, getDeviceId(), (done, total, partData) => {
        if (progEl) progEl.textContent = `Reading Part ${done}/${total} (${partData?.patchName || ""})...`;
        if (partData) updatePartRow(done, partData);
      });
      parts.forEach((p, idx) => updatePartRow(idx + 1, p));
      if (!syncedUnitDb) {
        syncedUnitDb = {
          setup: null,
          system: { common: null, eq: null },
          currentPerformance: { common: null, parts },
          activePatches: [],
          userPerformances: [],
          userPatches: [],
          userRhythms: []
        };
      } else if (syncedUnitDb.currentPerformance) {
        syncedUnitDb.currentPerformance.parts = parts;
      }
      populateAllInstrumentSelectors();
      renderPartNavigationStrip();
      saveSyncedDbToStorage();
      if (progEl) progEl.textContent = "All 16 parts loaded";
      setStatus("Successfully loaded all 16 performance parts and sound names");
    } catch (e) {
      if (progEl) progEl.textContent = "";
      setStatus(`Failed loading parts: ${e.message}`);
    }
  }
  function switchToTab(target) {
    const isDeepRequest = target === "deepStudio";
    const effectiveTab = isDeepRequest ? "patch" : target;
    document.querySelectorAll(".tab-btn").forEach((b) => {
      b.classList.toggle("active", b.dataset.tab === target || isDeepRequest && b.dataset.tab === "patch");
    });
    document.querySelectorAll(".tab-content").forEach((c) => {
      c.classList.toggle("active", c.id === effectiveTab + "Tab");
    });
    const dsTab = $("deepStudioTab");
    if (dsTab) {
      dsTab.classList.toggle("active", effectiveTab === "patch");
    }
    if (isDeepRequest) {
      const rollupBody = $("deepStudioRollupBody");
      const toggleBtn = $("btnRollupToggleState");
      if (rollupBody) {
        rollupBody.style.display = "block";
        if (toggleBtn) toggleBtn.textContent = "Collapse \u25B2";
      }
      if (dsTab) {
        setTimeout(() => dsTab.scrollIntoView({ behavior: "smooth", block: "start" }), 50);
      }
    }
    if (target === "monitor") {
      renderTrafficBuffer();
    }
    if (target === "patch" || isDeepRequest) {
      redrawAllCurves();
      if (midi.isConnected) {
        const effPart = getEffectivePatchPart();
        if (!activePartPatchesCache[effPart]) {
          autoSyncActivePatchFromHardware(effPart);
        }
      }
    }
  }
  function initTabs() {
    document.querySelectorAll(".tab-btn").forEach((btn) => {
      btn.addEventListener("click", () => switchToTab(btn.dataset.tab));
    });
  }
  var isEdited = false;
  var isSyncInProgress = false;
  function markEdited() {
    if (!isEdited) {
      isEdited = true;
      const badge = $("dirtyBadge");
      if (badge) badge.style.display = "inline-flex";
    }
  }
  function clearEdited() {
    isEdited = false;
    const badge = $("dirtyBadge");
    if (badge) badge.style.display = "none";
  }
  function initEditTracking() {
    document.addEventListener("input", (e) => {
      if (!e.target) return;
      const tag = e.target.tagName;
      if (tag === "INPUT" || tag === "SELECT" || tag === "TEXTAREA") {
        if (e.target.id === "midiInput" || e.target.id === "midiOutput" || e.target.id === "deviceId") return;
        markEdited();
      }
    });
    document.addEventListener("change", (e) => {
      if (!e.target) return;
      const tag = e.target.tagName;
      if (tag === "INPUT" || tag === "SELECT" || tag === "TEXTAREA") {
        if (e.target.id === "midiInput" || e.target.id === "midiOutput" || e.target.id === "deviceId") return;
        markEdited();
      }
    });
  }
  async function handleSyncWithUnit() {
    if (isSyncInProgress) {
      setStatus("Unit sync is already in progress...");
      return;
    }
    if (!midi.sysexEnabled) {
      const hasAccess = await midi.requestAccess();
      if (hasAccess) refreshDeviceList();
      if (!midi.sysexEnabled) {
        setStatus("\u26A0\uFE0F SysEx permission required. Allow MIDI and SysEx in browser site permissions.");
        alert('SysEx permission is required to read from the XV-5050 synthesizer. Please allow SysEx permission in Chrome (click the site settings / tune icon in the address bar to allow "System exclusive messages").');
        return;
      }
    }
    if (!midi.isConnected) {
      let inputId = $("midiInput")?.value;
      let outputId = $("midiOutput")?.value;
      if (!inputId) {
        const dev = midi.getInputs().find((d) => d.name.includes("XV-5050"));
        if (dev) inputId = dev.id;
      }
      if (!outputId) {
        const dev = midi.getOutputs().find((d) => d.name.includes("XV-5050"));
        if (dev) outputId = dev.id;
      }
      if (inputId && outputId) {
        setStatus("Connecting to XV-5050 MIDI ports...");
        const success = await midi.connect(inputId, outputId);
        if (success) {
          setConnectionStatus(true, `${midi.inputName}`);
          $("connectBtn").textContent = "Disconnect";
          setDeviceInfo(`${midi.inputName} \u2194 ${midi.outputName}`);
          midi.onSysEx(handleIncomingSysEx);
        }
      }
    }
    if (!midi.isConnected) {
      setStatus("Cannot sync: XV-5050 is not connected. Connect MIDI first.");
      return;
    }
    if (isEdited) {
      const modal = $("confirmSyncModal");
      if (modal) {
        modal.style.display = "flex";
        return;
      }
      if (!window.confirm("You have edited content in the web editor. You will lose all edits. Are you sure you want to sync from unit?")) {
        return;
      }
    }
    executeSyncWithUnit();
  }
  var ROLAND_BANKS = [
    { id: "user", label: "User Patches (USER)", msb: 87, lsb: 0, count: 128, isRhythm: false },
    { id: "pra", label: "Preset A (PR-A)", msb: 87, lsb: 64, count: 128, isRhythm: false },
    { id: "prb", label: "Preset B (PR-B)", msb: 87, lsb: 65, count: 128, isRhythm: false },
    { id: "prc", label: "Preset C (PR-C)", msb: 87, lsb: 66, count: 128, isRhythm: false },
    { id: "prd", label: "Preset D (PR-D)", msb: 87, lsb: 67, count: 128, isRhythm: false },
    { id: "pre", label: "Preset E (PR-E)", msb: 87, lsb: 68, count: 128, isRhythm: false },
    { id: "prf", label: "Preset F (PR-F)", msb: 87, lsb: 69, count: 128, isRhythm: false },
    { id: "prg", label: "Preset G (PR-G)", msb: 87, lsb: 70, count: 128, isRhythm: false },
    { id: "prh", label: "Preset H (PR-H)", msb: 87, lsb: 71, count: 128, isRhythm: false },
    { id: "gm2", label: "GM2 Bank (GM)", msb: 121, lsb: 0, count: 256, isRhythm: false },
    { id: "preset_rhy", label: "Preset Rhythm Kits (PR-RHY)", msb: 86, lsb: 64, count: 8, isRhythm: true },
    { id: "user_rhy", label: "User Rhythm Kits (USER-RHY)", msb: 86, lsb: 0, count: 4, isRhythm: true }
  ];
  var SYNC_CACHE_KEY = "xv5050_synced_unit_db";
  var syncedUnitDb = null;
  function saveSyncedDbToStorage() {
    if (!syncedUnitDb) return;
    try {
      localStorage.setItem(SYNC_CACHE_KEY, JSON.stringify(syncedUnitDb));
    } catch (e) {
      console.warn("Could not save unit DB to localStorage:", e);
    }
  }
  function restoreSyncedDbFromStorage() {
    try {
      const raw = localStorage.getItem(SYNC_CACHE_KEY);
      if (!raw) return false;
      const db = JSON.parse(raw);
      if (!db || !db.userPerformances?.length && !db.userPatches?.length && !db.currentPerformance) {
        return false;
      }
      syncedUnitDb = db;
      populateUserBankSelectors();
      populateAllInstrumentSelectors();
      renderUserPerfsTable();
      renderUserPatchesTable();
      renderPartNavigationStrip();
      if (syncedUnitDb.currentPerformance?.common) {
        updatePerformanceCommonUI(syncedUnitDb.currentPerformance.common);
      }
      if (syncedUnitDb.currentPerformance?.mfxA) {
        perfMfxCache.A = syncedUnitDb.currentPerformance.mfxA;
        updatePerfMfxBadges("A", perfMfxCache.A.mfxType);
      }
      if (syncedUnitDb.currentPerformance?.mfxB) {
        perfMfxCache.B = syncedUnitDb.currentPerformance.mfxB;
        updatePerfMfxBadges("B", perfMfxCache.B.mfxType);
      }
      if (syncedUnitDb.currentPerformance?.mfxC) {
        perfMfxCache.C = syncedUnitDb.currentPerformance.mfxC;
        updatePerfMfxBadges("C", perfMfxCache.C.mfxType);
      }
      if (Array.isArray(syncedUnitDb.currentPerformance?.parts)) {
        syncedUnitDb.currentPerformance.parts.forEach((p, idx) => updatePartRow(idx + 1, p));
      }
      if (Array.isArray(syncedUnitDb.activePatches)) {
        syncedUnitDb.activePatches.forEach((ap) => {
          activePartPatchesCache[ap.part] = ap;
        });
        const activePart = getSelectedPart() || 1;
        const initialPatch = activePartPatchesCache[activePart] || syncedUnitDb.activePatches[0];
        if (initialPatch?.common) updatePatchCommonUI(initialPatch.common);
      }
      updateActivePartUI(getSelectedPart() || 1);
      setStatus("Restored synced instruments and sound database from browser storage");
      return true;
    } catch (err) {
      console.warn("Failed restoring unit DB from localStorage:", err);
      return false;
    }
  }
  function populateUserBankSelectors() {
    const perfSelect = $("userPerfSelect");
    if (perfSelect) {
      perfSelect.innerHTML = '<option value="">\u2014 Select Performance \u2014</option>';
      const ogUser = document.createElement("optgroup");
      ogUser.label = "\u2014 User Performances (1-64) \u2014";
      if (syncedUnitDb?.userPerformances?.length) {
        syncedUnitDb.userPerformances.forEach((p) => {
          const opt = document.createElement("option");
          opt.value = `user:${p.index}`;
          opt.textContent = `User ${String(p.index).padStart(2, "0")}: ${p.name}`;
          ogUser.appendChild(opt);
        });
      } else {
        for (let u = 1; u <= 64; u++) {
          const opt = document.createElement("option");
          opt.value = `user:${u}`;
          opt.textContent = `User ${String(u).padStart(2, "0")} (Bank 85/0)`;
          ogUser.appendChild(opt);
        }
      }
      perfSelect.appendChild(ogUser);
      if (ROLAND_PRESET_PERFORMANCES?.["PR-A"]) {
        const ogPra = document.createElement("optgroup");
        ogPra.label = "\u2014 Roland Factory Preset PR-A (1-64) \u2014";
        ROLAND_PRESET_PERFORMANCES["PR-A"].forEach((name, idx) => {
          const pNum = idx + 1;
          const opt = document.createElement("option");
          opt.value = `pra:${pNum}`;
          opt.textContent = `PR-A ${String(pNum).padStart(2, "0")}: ${name}`;
          ogPra.appendChild(opt);
        });
        perfSelect.appendChild(ogPra);
      }
      if (ROLAND_PRESET_PERFORMANCES?.["PR-B"]) {
        const ogPrb = document.createElement("optgroup");
        ogPrb.label = "\u2014 Roland Factory Preset PR-B (1-32) \u2014";
        ROLAND_PRESET_PERFORMANCES["PR-B"].forEach((name, idx) => {
          const pNum = idx + 1;
          const opt = document.createElement("option");
          opt.value = `prb:${pNum}`;
          opt.textContent = `PR-B ${String(pNum).padStart(2, "0")}: ${name}`;
          ogPrb.appendChild(opt);
        });
        perfSelect.appendChild(ogPrb);
      }
    }
    const patchSelect = $("userPatchSelect");
    if (patchSelect && syncedUnitDb?.userPatches) {
      patchSelect.innerHTML = '<option value="">\u2014 User Patches (1-128) \u2014</option>';
      syncedUnitDb.userPatches.forEach((p) => {
        const opt = document.createElement("option");
        opt.value = p.index;
        opt.textContent = `User ${String(p.index).padStart(3, "0")}: ${p.name}`;
        patchSelect.appendChild(opt);
      });
    }
  }
  function populateAllInstrumentSelectors() {
    for (let i = 1; i <= 16; i++) {
      const sel = $(`partPatchSelect${i}`);
      if (sel) populateInstrumentSelectOptions(sel, i);
    }
    const patchInstSel = $("patchInstrumentSelect");
    if (patchInstSel) {
      const activePart = getSelectedPart() || 1;
      populateInstrumentSelectOptions(patchInstSel, activePart);
    }
  }
  function populateInstrumentSelectOptions(selectEl, forPart = 1) {
    if (!selectEl) return;
    const currentVal = selectEl.value;
    selectEl.innerHTML = '<option value="">\u2014 Select Instrument \u2014</option>';
    const ogPerf = document.createElement("optgroup");
    ogPerf.label = "\u2014 Performance Channels (Parts 1-16) \u2014";
    for (let pNum = 1; pNum <= 16; pNum++) {
      const dbPart = syncedUnitDb?.currentPerformance?.parts?.[pNum - 1];
      const domName = $(`partPatchName${pNum}`)?.textContent?.trim();
      const domMsb = parseInt($(`partBankMSB${pNum}`)?.value || "87", 10);
      const domLsb = parseInt($(`partBankLSB${pNum}`)?.value || "64", 10);
      const domPc = parseInt($(`partPC${pNum}`)?.value || "1", 10);
      const name = dbPart?.patchName || (domName && domName !== "\u2014" ? domName : `Sound ${pNum}`);
      const msb = dbPart?.patchBankMSB ?? domMsb;
      const lsb = dbPart?.patchBankLSB ?? domLsb;
      const pc = dbPart?.patchPC ?? domPc;
      const isRhy = dbPart?.isRhythm || pNum === 10 || msb === 86;
      const opt = document.createElement("option");
      opt.value = `custom:${msb}:${lsb}:${pc}:${pNum}`;
      opt.textContent = `Part ${pNum} [Ch ${pNum}]${isRhy ? " \u{1F941}" : ""}: ${name}`;
      ogPerf.appendChild(opt);
    }
    selectEl.appendChild(ogPerf);
    const ogUser = document.createElement("optgroup");
    ogUser.label = "\u2014 Hardware User Patches (USER, Bank 87/0) \u2014";
    if (syncedUnitDb?.userPatches?.length) {
      syncedUnitDb.userPatches.forEach((p) => {
        const opt = document.createElement("option");
        opt.value = `user:${p.index}`;
        opt.textContent = `User ${String(p.index).padStart(3, "0")}: ${p.name}`;
        ogUser.appendChild(opt);
      });
    } else {
      for (let u = 1; u <= 128; u++) {
        const opt = document.createElement("option");
        opt.value = `user:${u}`;
        opt.textContent = `User ${String(u).padStart(3, "0")} (Bank 87/0 PC ${u})`;
        ogUser.appendChild(opt);
      }
    }
    selectEl.appendChild(ogUser);
    const ogPra = document.createElement("optgroup");
    ogPra.label = "\u2014 Roland Factory Preset A (PR-A, Bank 87/64) \u2014";
    for (let pc = 1; pc <= 128; pc++) {
      const opt = document.createElement("option");
      opt.value = `bank:pra:87:64:${pc}`;
      const name = ROLAND_PRESET_A_PATCHES[pc - 1] || `Preset A ${String(pc).padStart(3, "0")}`;
      opt.textContent = `PR-A ${String(pc).padStart(3, "0")}: ${name}`;
      ogPra.appendChild(opt);
    }
    selectEl.appendChild(ogPra);
    const ogPrb = document.createElement("optgroup");
    ogPrb.label = "\u2014 Roland Factory Preset B (PR-B, Bank 87/65) \u2014";
    for (let pc = 1; pc <= 128; pc++) {
      const opt = document.createElement("option");
      opt.value = `bank:prb:87:65:${pc}`;
      const name = ROLAND_PRESET_B_PATCHES[pc - 1] || `Preset B ${String(pc).padStart(3, "0")}`;
      opt.textContent = `PR-B ${String(pc).padStart(3, "0")}: ${name}`;
      ogPrb.appendChild(opt);
    }
    selectEl.appendChild(ogPrb);
    const ogPrc = document.createElement("optgroup");
    ogPrc.label = "\u2014 Roland Factory Preset C (PR-C, Bank 87/66) \u2014";
    for (let pc = 1; pc <= 128; pc++) {
      const opt = document.createElement("option");
      opt.value = `bank:prc:87:66:${pc}`;
      const name = ROLAND_PRESET_C_PATCHES[pc - 1] || `Preset C ${String(pc).padStart(3, "0")}`;
      opt.textContent = `PR-C ${String(pc).padStart(3, "0")}: ${name}`;
      ogPrc.appendChild(opt);
    }
    selectEl.appendChild(ogPrc);
    const ogPrd = document.createElement("optgroup");
    ogPrd.label = "\u2014 Roland Factory Preset D (PR-D, Bank 87/67) \u2014";
    for (let pc = 1; pc <= 128; pc++) {
      const opt = document.createElement("option");
      opt.value = `bank:prd:87:67:${pc}`;
      const name = ROLAND_PRESET_D_PATCHES[pc - 1] || `Preset D ${String(pc).padStart(3, "0")}`;
      opt.textContent = `PR-D ${String(pc).padStart(3, "0")}: ${name}`;
      ogPrd.appendChild(opt);
    }
    selectEl.appendChild(ogPrd);
    const ogPre = document.createElement("optgroup");
    ogPre.label = "\u2014 Roland Factory Preset E (PR-E, Bank 87/68) \u2014";
    for (let pc = 1; pc <= 128; pc++) {
      const opt = document.createElement("option");
      opt.value = `bank:pre:87:68:${pc}`;
      const name = ROLAND_PRESET_E_PATCHES[pc - 1] || `Preset E ${String(pc).padStart(3, "0")}`;
      opt.textContent = `PR-E ${String(pc).padStart(3, "0")}: ${name}`;
      ogPre.appendChild(opt);
    }
    selectEl.appendChild(ogPre);
    const ogPrf = document.createElement("optgroup");
    ogPrf.label = "\u2014 Roland Factory Preset F (PR-F, Bank 87/69) \u2014";
    for (let pc = 1; pc <= 128; pc++) {
      const opt = document.createElement("option");
      opt.value = `bank:prf:87:69:${pc}`;
      const name = ROLAND_PRESET_F_PATCHES[pc - 1] || `Preset F ${String(pc).padStart(3, "0")}`;
      opt.textContent = `PR-F ${String(pc).padStart(3, "0")}: ${name}`;
      ogPrf.appendChild(opt);
    }
    selectEl.appendChild(ogPrf);
    const ogPrg = document.createElement("optgroup");
    ogPrg.label = "\u2014 Roland Factory Preset G (PR-G, Bank 87/70) \u2014";
    for (let pc = 1; pc <= 128; pc++) {
      const opt = document.createElement("option");
      opt.value = `bank:prg:87:70:${pc}`;
      const name = ROLAND_PRESET_G_PATCHES[pc - 1] || `Preset G ${String(pc).padStart(3, "0")}`;
      opt.textContent = `PR-G ${String(pc).padStart(3, "0")}: ${name}`;
      ogPrg.appendChild(opt);
    }
    selectEl.appendChild(ogPrg);
    const ogPrh = document.createElement("optgroup");
    ogPrh.label = "\u2014 Roland Factory Preset H (PR-H, Bank 87/71) \u2014";
    for (let pc = 1; pc <= 128; pc++) {
      const opt = document.createElement("option");
      opt.value = `bank:prh:87:71:${pc}`;
      const name = ROLAND_PRESET_H_PATCHES[pc - 1] || `Preset H ${String(pc).padStart(3, "0")}`;
      opt.textContent = `PR-H ${String(pc).padStart(3, "0")}: ${name}`;
      ogPrh.appendChild(opt);
    }
    selectEl.appendChild(ogPrh);
    const ogGm = document.createElement("optgroup");
    ogGm.label = "\u2014 General MIDI 2 (GM2, Bank 121/0) \u2014";
    for (let pc = 1; pc <= 128; pc++) {
      const opt = document.createElement("option");
      opt.value = `bank:gm2:121:0:${pc}`;
      const name = ROLAND_GM2_PATCHES[pc - 1] || `GM2 ${String(pc).padStart(3, "0")}`;
      opt.textContent = `GM2 ${String(pc).padStart(3, "0")}: ${name}`;
      ogGm.appendChild(opt);
    }
    selectEl.appendChild(ogGm);
    const ogRhy = document.createElement("optgroup");
    ogRhy.label = "\u2014 Rhythm Drum Kits (Bank 86) \u2014";
    ROLAND_PRESET_DRUM_KITS.forEach((kitName, idx) => {
      const opt = document.createElement("option");
      opt.value = `rhythm:preset:${idx + 1}`;
      opt.textContent = `Preset Drum ${idx + 1}: ${kitName} (Bank 86/64 PC ${idx + 1})`;
      ogRhy.appendChild(opt);
    });
    ROLAND_USER_DRUM_KITS.forEach((kitName, idx) => {
      const opt = document.createElement("option");
      opt.value = `rhythm:user:${idx + 1}`;
      opt.textContent = `User Drum ${idx + 1}: ${kitName} (Bank 86/0 PC ${idx + 1})`;
      ogRhy.appendChild(opt);
    });
    selectEl.appendChild(ogRhy);
    const boardIdA = $("srxSlotASelect")?.value || localStorage.getItem("xv5050_srx_slot_a") || "NONE";
    if (boardIdA && boardIdA !== "NONE") {
      const boardA = getSrxBoard(boardIdA);
      if (boardA) {
        const ogSrxA = document.createElement("optgroup");
        ogSrxA.label = `\u2014 SRX Slot A: ${boardA.name} \u2014`;
        const patchesA = getSrxPatches(boardIdA);
        patchesA.forEach((patchName, idx) => {
          const pNum = idx + 1;
          const opt = document.createElement("option");
          opt.value = `srx:A:${boardIdA}:${pNum}`;
          opt.textContent = patchName;
          ogSrxA.appendChild(opt);
        });
        selectEl.appendChild(ogSrxA);
      }
    }
    const boardIdB = $("srxSlotBSelect")?.value || localStorage.getItem("xv5050_srx_slot_b") || "NONE";
    if (boardIdB && boardIdB !== "NONE") {
      const boardB = getSrxBoard(boardIdB);
      if (boardB) {
        const ogSrxB = document.createElement("optgroup");
        ogSrxB.label = `\u2014 SRX Slot B: ${boardB.name} \u2014`;
        const patchesB = getSrxPatches(boardIdB);
        patchesB.forEach((patchName, idx) => {
          const pNum = idx + 1;
          const opt = document.createElement("option");
          opt.value = `srx:B:${boardIdB}:${pNum}`;
          opt.textContent = patchName;
          ogSrxB.appendChild(opt);
        });
        selectEl.appendChild(ogSrxB);
      }
    }
    const curPartData = syncedUnitDb?.currentPerformance?.parts?.[forPart - 1];
    const curMsb = curPartData?.patchBankMSB ?? parseInt($(`partBankMSB${forPart}`)?.value || "87", 10);
    const curLsb = curPartData?.patchBankLSB ?? parseInt($(`partBankLSB${forPart}`)?.value || "64", 10);
    const curPc = curPartData?.patchPC ?? parseInt($(`partPC${forPart}`)?.value || "1", 10);
    if (curMsb === 87 && curLsb === 0) {
      const userVal = `user:${curPc}`;
      if (Array.from(selectEl.options).some((o) => o.value === userVal)) {
        selectEl.value = userVal;
        return;
      }
    }
    if (curMsb === 86) {
      const rVal = curLsb === 0 ? `rhythm:user:${curPc}` : `rhythm:preset:${curPc}`;
      if (Array.from(selectEl.options).some((o) => o.value === rVal)) {
        selectEl.value = rVal;
        return;
      }
    }
    if (curMsb === 93) {
      const slot = curLsb >= 4 ? "B" : "A";
      const baseLsb = slot === "A" ? 0 : 4;
      const patchNum = (curLsb - baseLsb) * 128 + curPc;
      const boardId = slot === "A" ? boardIdA : boardIdB;
      const srxVal = `srx:${slot}:${boardId}:${patchNum}`;
      if (Array.from(selectEl.options).some((o) => o.value === srxVal)) {
        selectEl.value = srxVal;
        return;
      }
    }
    const bankMatch = Array.from(selectEl.options).find((o) => o.value.startsWith("bank:") && o.value.endsWith(`:${curMsb}:${curLsb}:${curPc}`));
    if (bankMatch) {
      selectEl.value = bankMatch.value;
      return;
    }
    const customVal = `custom:${curMsb}:${curLsb}:${curPc}:${forPart}`;
    if (Array.from(selectEl.options).some((o) => o.value === customVal)) {
      selectEl.value = customVal;
      return;
    }
    if (currentVal && Array.from(selectEl.options).some((o) => o.value === currentVal)) {
      selectEl.value = currentVal;
    }
  }
  function renderPartNavigationStrip() {
    const container = $("partStripContainer");
    if (!container) return;
    container.innerHTML = "";
    const activePart = getSelectedPart() || 1;
    for (let i = 1; i <= 16; i++) {
      const btn = document.createElement("button");
      btn.className = `part-strip-btn${i === activePart ? " active" : ""}`;
      btn.id = `partStripBtn${i}`;
      const pData = syncedUnitDb?.currentPerformance?.parts?.[i - 1];
      const domName = $(`partPatchName${i}`)?.textContent?.trim();
      const isRhy = pData?.isRhythm || i === 10 || pData?.patchBankMSB === 86;
      const soundName = pData?.patchName || (domName && domName !== "\u2014" ? domName : `Sound ${i}`);
      btn.innerHTML = `${i}${isRhy ? " \u{1F941}" : ""}`;
      btn.title = `Part ${i} [Ch ${i}]: ${soundName}`;
      btn.addEventListener("click", () => {
        selectPart(i);
      });
      container.appendChild(btn);
    }
  }
  function selectPart(part, autoSync = true) {
    const partSel = $("patchPartSelect");
    if (partSel && parseInt(partSel.value, 10) !== part) {
      partSel.value = part;
    }
    for (let i = 1; i <= 16; i++) {
      const row = $("partRow" + i);
      if (row) row.classList.toggle("selected", i === part);
      const stripBtn = $("partStripBtn" + i);
      if (stripBtn) stripBtn.classList.toggle("active", i === part);
    }
    if (part === 0) {
      setSynthesizerMode(1, true);
    } else if (currentSoundMode === 1) {
      setSynthesizerMode(2, true);
    }
    updateActivePartUI(part);
    const cached = activePartPatchesCache[part];
    if (cached) {
      if (cached.common) updatePatchCommonUI(cached.common);
      if (cached.mfx || cached.chorus || cached.reverb) {
        applyPatchEffectsToUI(cached.mfx, cached.chorus, cached.reverb);
      }
      if (cached.tmt) updatePatchTMTUI(cached.tmt);
      if (Array.isArray(cached.tones)) {
        cached.tones.forEach((toneData, tIdx) => {
          currentToneCache[tIdx] = toneData;
        });
        const activeTone = currentToneCache[currentToneIndex - 1];
        if (activeTone) updateToneUI(activeTone);
      }
      setStatus("Switched to " + (part === 0 ? "Single Patch" : "Part " + part + " Patch") + " (" + (cached.common?.name || "") + ")");
    }
    if (autoSync && midi.isConnected) {
      autoSyncActivePatchFromHardware(part);
    }
  }
  function updateActivePartUI(part) {
    const pData = syncedUnitDb?.currentPerformance?.parts?.[part - 1];
    const domName = $(`partPatchName${part}`)?.textContent?.trim();
    const patchName = pData?.patchName || (domName && domName !== "\u2014" ? domName : `Part ${part} Sound`);
    const ch = pData?.receiveChannel ?? ($(`partChannel${part}`) ? parseInt($(`partChannel${part}`).value, 10) : part - 1);
    const badge = $("activePartBadge");
    if (badge) badge.textContent = part === 0 ? "SOLO" : `PART ${part}`;
    const nameHeader = $("activePatchHeaderName");
    if (nameHeader) nameHeader.textContent = patchName;
    const chBadge = $("activePartChannelBadge");
    if (chBadge) chBadge.textContent = `MIDI Ch ${ch + 1}`;
    const instSel = $("patchInstrumentSelect");
    if (instSel) {
      populateInstrumentSelectOptions(instSel, part);
    }
    const dsPartBadge = $("deepStudioPartBadge");
    if (dsPartBadge) dsPartBadge.textContent = part === 0 ? "SOLO" : `PART ${part}`;
    const dsPatchName = $("deepStudioPatchName");
    if (dsPatchName && patchName) dsPatchName.textContent = patchName;
  }
  async function handleInstrumentSelection(part, val) {
    if (!val) return;
    let bankMsb = 87;
    let bankLsb = 0;
    let pc = 1;
    let name = "";
    const parts = val.split(":");
    const type = parts[0];
    if (type === "user") {
      const index = parseInt(parts[1], 10);
      bankMsb = 87;
      bankLsb = 0;
      pc = index;
      const patch = syncedUnitDb?.userPatches?.find((p) => p.index === index);
      name = patch?.name || `User ${String(index).padStart(3, "0")}`;
    } else if (type === "custom") {
      bankMsb = parseInt(parts[1], 10);
      bankLsb = parseInt(parts[2], 10);
      pc = parseInt(parts[3], 10);
      const srcPartNum = parseInt(parts[4] || 0, 10);
      const srcPart = syncedUnitDb?.currentPerformance?.parts?.[srcPartNum - 1];
      const domName = $(`partPatchName${srcPartNum}`)?.textContent?.trim();
      name = srcPart?.patchName || (domName && domName !== "\u2014" ? domName : `Sound (B:${bankMsb}/${bankLsb} P:${pc})`);
    } else if (type === "rhythm") {
      const sub = parts[1];
      const rIdx = parseInt(parts[2], 10);
      bankMsb = 86;
      bankLsb = sub === "user" ? 0 : 64;
      pc = rIdx;
      name = sub === "user" ? ROLAND_USER_DRUM_KITS[rIdx - 1] || `User Drum Kit ${rIdx}` : ROLAND_PRESET_DRUM_KITS[rIdx - 1] || `Preset Drum Kit ${rIdx}`;
    } else if (type === "bank") {
      const bankId = parts[1];
      bankMsb = parseInt(parts[2], 10);
      bankLsb = parseInt(parts[3], 10);
      pc = parseInt(parts[4] || 1, 10);
      const bank = ROLAND_BANKS.find((b) => b.id === bankId);
      name = getPresetPatchName(bankId, pc) || `${bank?.label || "Preset"} #${pc}`;
    } else if (type === "srx") {
      const slot = parts[1];
      const boardId = parts[2];
      const patchNum = parseInt(parts[3] || "1", 10);
      const lsbOffset = slot === "A" ? 0 : 4;
      bankMsb = 93;
      bankLsb = lsbOffset + Math.floor((patchNum - 1) / 128);
      pc = (patchNum - 1) % 128 + 1;
      const patches = getSrxPatches(boardId);
      name = patches[patchNum - 1] || `${boardId} Patch #${patchNum}`;
    } else if (type === "srx_rhythm") {
      const slot = parts[1];
      const boardId = parts[2];
      const kitNum = parseInt(parts[3] || "1", 10);
      const lsbOffset = slot === "A" ? 0 : 2;
      bankMsb = 92;
      bankLsb = lsbOffset + Math.floor((kitNum - 1) / 128);
      pc = (kitNum - 1) % 128 + 1;
      name = `${boardId} Drum Kit #${kitNum}`;
    }
    const msbEl = $(`partBankMSB${part}`);
    const lsbEl = $(`partBankLSB${part}`);
    const pcEl = $(`partPC${part}`);
    if (msbEl) msbEl.value = bankMsb;
    if (lsbEl) lsbEl.value = bankLsb;
    if (pcEl) pcEl.value = pc;
    const nameEl = $(`partPatchName${part}`);
    if (nameEl) nameEl.textContent = name;
    const chEl = $(`partChannel${part}`);
    const receiveChannel = chEl ? parseInt(chEl.value, 10) : part - 1;
    if (midi.isConnected) {
      setStatus(`Assigning "${name}" to Part ${part} on XV-5050...`);
      try {
        sendPartBankAndProgram(midi, part, bankMsb, bankLsb, pc, getDeviceId(), receiveChannel);
        await new Promise((r) => setTimeout(r, 80));
        const freshName = await requestPartPatchName(midi, part, getDeviceId());
        if (freshName && freshName.trim()) {
          name = freshName;
          if (nameEl) nameEl.textContent = name;
        }
        setStatus(`Assigned "${name}" to Part ${part} (Ch ${receiveChannel + 1})`);
      } catch (e) {
        console.warn("Hardware assignment notification:", e);
        setStatus(`Assigned "${name}" to Part ${part}`);
      }
    } else {
      setStatus(`Assigned "${name}" to Part ${part} (Offline)`);
    }
    if (syncedUnitDb?.currentPerformance?.parts?.[part - 1]) {
      const p = syncedUnitDb.currentPerformance.parts[part - 1];
      p.patchBankMSB = bankMsb;
      p.patchBankLSB = bankLsb;
      p.patchPC = pc;
      p.patchName = name;
      saveSyncedDbToStorage();
    }
    populateAllInstrumentSelectors();
    if (getSelectedPart() === part || currentSoundMode === 1) {
      updateActivePartUI(part);
      if (midi.isConnected) {
        autoSyncActivePatchFromHardware(part);
      }
    }
  }
  function renderUserPerfsTable(filter = "") {
    const tbody = $("userPerfsTableBody");
    if (!tbody) return;
    if (!syncedUnitDb?.userPerformances?.length) {
      tbody.innerHTML = '<tr><td colspan="5" style="text-align:center; color:var(--text-secondary); padding:20px;">Click "Sync with Unit" to load all 64 User Performances from hardware.</td></tr>';
      return;
    }
    const q = filter.trim().toLowerCase();
    const list = syncedUnitDb.userPerformances.filter((p) => !q || p.name.toLowerCase().includes(q) || String(p.index).includes(q));
    const badge = $("perfCountBadge");
    if (badge) badge.textContent = `${list.length} of 64 Performances`;
    tbody.innerHTML = list.map((p) => `
    <tr>
      <td style="font-family:var(--font-mono); font-weight:600; color:var(--text-accent);">User ${String(p.index).padStart(2, "0")}</td>
      <td style="font-weight:600; color:var(--text-primary);">${p.name}</td>
      <td>${p.soloPart ? `Part ${p.soloPart}` : "OFF"}</td>
      <td>${p.mfxSource === 0 ? "PERFORM" : `Part ${p.mfxSource}`}</td>
      <td style="text-align:center;">
        <button class="btn btn-sm btn-secondary" onclick="window.loadSyncedUserPerf(${p.index})">Load</button>
      </td>
    </tr>
  `).join("");
  }
  function renderUserPatchesTable(filter = "") {
    const tbody = $("userPatchesTableBody");
    if (!tbody) return;
    if (!syncedUnitDb?.userPatches?.length) {
      tbody.innerHTML = '<tr><td colspan="5" style="text-align:center; color:var(--text-secondary); padding:20px;">Click "Sync with Unit" to load all 128 User Patches from hardware.</td></tr>';
      return;
    }
    const q = filter.trim().toLowerCase();
    const list = syncedUnitDb.userPatches.filter((p) => !q || p.name.toLowerCase().includes(q) || String(p.index).includes(q));
    const badge = $("patchCountBadge");
    if (badge) badge.textContent = `${list.length} of 128 Patches`;
    tbody.innerHTML = list.map((p) => `
    <tr>
      <td style="font-family:var(--font-mono); font-weight:600; color:var(--text-accent);">User ${String(p.index).padStart(3, "0")}</td>
      <td style="font-weight:600; color:var(--text-primary);">${p.name}</td>
      <td>${p.category || "General"}</td>
      <td>${p.level ?? 127}</td>
      <td style="text-align:center;">
        <button class="btn btn-sm btn-secondary" onclick="window.loadSyncedUserPatch(${p.index})">Load</button>
      </td>
    </tr>
  `).join("");
  }
  window.loadSyncedUserPerf = async function(spec) {
    switchToTab("performance");
    const sel = $("userPerfSelect");
    if (sel && sel.value !== String(spec)) sel.value = String(spec);
    let bank = "USER";
    let index = 1;
    let bankLabel = "User Performance";
    if (typeof spec === "number") {
      index = spec;
      bankLabel = `User Performance ${index}`;
    } else if (typeof spec === "string") {
      if (spec.startsWith("user:")) {
        index = parseInt(spec.split(":")[1], 10) || 1;
        bank = "USER";
        bankLabel = `User Performance ${index}`;
      } else if (spec.startsWith("pra:")) {
        index = parseInt(spec.split(":")[1], 10) || 1;
        bank = "PR-A";
        const pName = ROLAND_PRESET_PERFORMANCES?.["PR-A"]?.[index - 1] || "";
        bankLabel = `Preset PR-A ${index}${pName ? ` (${pName})` : ""}`;
      } else if (spec.startsWith("prb:")) {
        index = parseInt(spec.split(":")[1], 10) || 1;
        bank = "PR-B";
        const pName = ROLAND_PRESET_PERFORMANCES?.["PR-B"]?.[index - 1] || "";
        bankLabel = `Preset PR-B ${index}${pName ? ` (${pName})` : ""}`;
      } else {
        index = parseInt(spec, 10) || 1;
        bankLabel = `User Performance ${index}`;
      }
    }
    if (midi.isConnected) {
      try {
        setSynthesizerMode(2, true);
        await new Promise((r) => setTimeout(r, 50));
        setStatus(`Switching XV-5050 hardware to ${bankLabel}...`);
        const perfCtrlCh = syncedUnitDb?.systemCommon?.perfCtrlChannel;
        sendActivePerformanceSelection(midi, index, getDeviceId(), perfCtrlCh, bank);
        await new Promise((r) => setTimeout(r, 120));
        setStatus(`Reading ${bankLabel} from XV-5050 hardware...`);
        const fullPerf = bank === "USER" ? await requestEntireUserPerformance(midi, index, getDeviceId()) : await requestEntirePerformance(midi, getDeviceId());
        if (fullPerf.common) updatePerformanceCommonUI(fullPerf.common);
        if (fullPerf.mfxA) {
          perfMfxCache.A = fullPerf.mfxA;
          updatePerfMfxBadges("A", fullPerf.mfxA.mfxType);
        }
        if (fullPerf.chorus) updatePerformanceChorusUI(fullPerf.chorus);
        if (fullPerf.reverb) updatePerformanceReverbUI(fullPerf.reverb);
        if (Array.isArray(fullPerf.parts)) {
          fullPerf.parts.forEach((p, idx) => {
            if (p) updatePartRow(idx + 1, p);
          });
        }
        clearEdited();
        setStatus(`Switched XV-5050 to ${bankLabel}: "${fullPerf.common?.name || ""}"`);
        return;
      } catch (err) {
        console.warn("Hardware read failed, falling back to cached db:", err);
      }
    }
    if (bank === "USER" && syncedUnitDb) {
      const perf = syncedUnitDb.userPerformances?.find((p) => p.index === index);
      if (!perf) return;
      if (perf.raw) {
        const common = parsePerformanceCommon(perf.raw);
        updatePerformanceCommonUI(common);
      }
      setStatus(`Loaded cached User Performance ${index}: "${perf.name}" into editor`);
    } else if ((bank === "PR-A" || bank === "PR-B") && ROLAND_PRESET_PERFORMANCES?.[bank]) {
      const name = ROLAND_PRESET_PERFORMANCES[bank][index - 1] || `${bank} ${index}`;
      updatePerformanceCommonUI({ name });
      setStatus(`Loaded Preset ${bank} Performance ${index}: "${name}"`);
    }
  };
  window.loadSyncedUserPatch = async function(index) {
    switchToTab("patch");
    const sel = $("userPatchSelect");
    if (sel && sel.value !== String(index)) sel.value = String(index);
    if (midi.isConnected) {
      try {
        if (currentSoundMode === 1) {
          setStatus(`Switching XV-5050 hardware to User Patch ${index}...`);
          sendActivePatchSelection(midi, index, getDeviceId());
        } else {
          const activePart3 = getEffectivePatchPart() || 1;
          setStatus(`Assigning User Patch ${index} to Part ${activePart3} on XV-5050...`);
          sendPartPatchSelection(midi, activePart3, index, getDeviceId());
        }
        await new Promise((r) => setTimeout(r, 120));
        setStatus(`Reading complete User Patch ${index} (All 4 Tones & Waves) from XV-5050 hardware...`);
        const fullPatch = await requestEntireUserPatch(midi, index, getDeviceId());
        if (fullPatch.common) updatePatchCommonUI(fullPatch.common);
        if (fullPatch.mfx || fullPatch.chorus || fullPatch.reverb) {
          applyPatchEffectsToUI(fullPatch.mfx, fullPatch.chorus, fullPatch.reverb);
        }
        if (fullPatch.tmt) updatePatchTMTUI(fullPatch.tmt);
        if (Array.isArray(fullPatch.tones)) {
          fullPatch.tones.forEach((toneData, tIdx) => {
            currentToneCache[tIdx] = toneData;
          });
          const activeTone = currentToneCache[currentToneIndex - 1];
          if (activeTone) updateToneUI(activeTone);
        }
        const activePart2 = getEffectivePatchPart() || 1;
        const patchName = fullPatch.common?.name || `User ${String(index).padStart(3, "0")}`;
        const nameEl2 = $(`partPatchName${activePart2}`);
        if (nameEl2) nameEl2.textContent = patchName;
        const msbEl = $(`partBankMSB${activePart2}`);
        const lsbEl = $(`partBankLSB${activePart2}`);
        const pcEl = $(`partPC${activePart2}`);
        if (msbEl) msbEl.value = 87;
        if (lsbEl) lsbEl.value = 0;
        if (pcEl) pcEl.value = index;
        if (syncedUnitDb?.currentPerformance?.parts?.[activePart2 - 1]) {
          const p = syncedUnitDb.currentPerformance.parts[activePart2 - 1];
          p.patchName = patchName;
          p.patchBankMSB = 87;
          p.patchBankLSB = 0;
          p.patchPC = index;
          saveSyncedDbToStorage();
        }
        updateActivePartUI(activePart2);
        clearEdited();
        setStatus(`Switched XV-5050 to User Patch ${index}: "${fullPatch.common?.name || ""}"`);
        return;
      } catch (err) {
        console.warn("Hardware read failed, falling back to cached db:", err);
      }
    }
    if (!syncedUnitDb) return;
    const patch = syncedUnitDb.userPatches.find((p) => p.index === index);
    if (!patch) return;
    if (patch.raw) {
      const common = parsePatchCommon(patch.raw);
      updatePatchCommonUI(common);
      setStatus(`Loaded cached User Patch ${index}: "${patch.name}" into editor`);
    }
    const activePart = getEffectivePatchPart() || 1;
    const nameEl = $(`partPatchName${activePart}`);
    if (nameEl) nameEl.textContent = patch.name;
    updateActivePartUI(activePart);
  };
  function openWriteSlotModal(type) {
    if (!midi.isConnected) {
      setStatus("Cannot write: XV-5050 is not connected. Connect MIDI first.");
      return;
    }
    const modal = $("writeSlotModal");
    const title = $("writeSlotTitle");
    const prompt2 = $("writeSlotPrompt");
    const select = $("targetSlotSelect");
    if (!modal || !select) return;
    modal.dataset.type = type;
    select.innerHTML = "";
    if (type === "performance") {
      title.textContent = "\u2B06 Write Performance to Hardware User Slot";
      prompt2.textContent = "Select destination User Performance slot (1-64) on your XV-5050:";
      for (let i = 1; i <= 64; i++) {
        const opt = document.createElement("option");
        opt.value = i;
        const cached = syncedUnitDb?.userPerformances?.find((p) => p.index === i);
        opt.textContent = `User Perf ${String(i).padStart(2, "0")}${cached ? `: ${cached.name}` : ""}`;
        select.appendChild(opt);
      }
    } else {
      title.textContent = "\u2B06 Write Patch to Hardware User Slot";
      prompt2.textContent = "Select destination User Patch slot (1-128) on your XV-5050:";
      for (let i = 1; i <= 128; i++) {
        const opt = document.createElement("option");
        opt.value = i;
        const cached = syncedUnitDb?.userPatches?.find((p) => p.index === i);
        opt.textContent = `User Patch ${String(i).padStart(3, "0")}${cached ? `: ${cached.name}` : ""}`;
        select.appendChild(opt);
      }
    }
    modal.style.display = "flex";
  }
  async function handleConfirmWriteSlot() {
    const modal = $("writeSlotModal");
    const select = $("targetSlotSelect");
    if (!modal || !select) return;
    const slot = parseInt(select.value, 10);
    const type = modal.dataset.type;
    modal.style.display = "none";
    if (!slot) return;
    if (type === "performance") {
      try {
        setStatus(`Writing performance to User Performance slot ${slot}...`);
        const name = ($("perfName")?.value || "USER PERF").padEnd(12, " ").slice(0, 12);
        const commonRaw = new Array(53).fill(0);
        const encName = encodeName(name);
        for (let i = 0; i < 12; i++) commonRaw[i] = encName[i];
        const perfData = {
          common: { raw: commonRaw }
        };
        await sendEntireUserPerformance(midi, slot, perfData, getDeviceId());
        setStatus(`Successfully wrote performance "${name.trim()}" to User Slot ${slot}`);
      } catch (err) {
        setStatus(`Failed to write performance to slot ${slot}: ${err.message}`);
      }
    } else {
      try {
        setStatus(`Writing patch to User Patch slot ${slot}...`);
        const name = ($("patchName")?.value || "USER PATCH").padEnd(12, " ").slice(0, 12);
        const commonRaw = new Array(79).fill(0);
        const encName = encodeName(name);
        for (let i = 0; i < 12; i++) commonRaw[i] = encName[i];
        commonRaw[14] = parseInt($("patchLevel")?.value, 10) || 127;
        const tmtRaw = new Array(41).fill(0);
        tmtRaw[5] = 1;
        const patchData = {
          common: { raw: commonRaw },
          tmt: { raw: tmtRaw }
        };
        await sendEntireUserPatch(midi, slot, patchData, getDeviceId());
        setStatus(`Successfully wrote patch "${name.trim()}" to User Slot ${slot}`);
      } catch (err) {
        setStatus(`Failed to write patch to slot ${slot}: ${err.message}`);
      }
    }
  }
  async function handleAutoDetectId() {
    if (!midi.isConnected) {
      setStatus("Cannot detect ID: Connect MIDI ports first.");
      return;
    }
    setStatus("Scanning Device IDs 0x10 to 0x1F...");
    try {
      const detected = await detectDeviceId(midi);
      const sel = $("deviceId");
      if (sel) sel.value = String(detected);
      setStatus(`Auto-detected XV-5050 Device ID: 0x${detected.toString(16).toUpperCase()} (${detected + 1})`);
    } catch (err) {
      setStatus(`Device ID detection failed: ${err.message}`);
    }
  }
  async function executeHardwareDiagnostics() {
    if (!midi.isConnected) {
      setStatus("Cannot run diagnostics: XV-5050 is not connected. Connect MIDI first.");
      return;
    }
    const modal = $("diagnosticsModal");
    const container = $("diagStepsContainer");
    const bannerText = $("diagSummaryText");
    const bannerSub = $("diagSummarySub");
    if (!modal || !container) return;
    modal.style.display = "flex";
    bannerText.textContent = "Running Hardware Diagnostics...";
    bannerSub.textContent = `Testing XV-5050 on Device ID 0x${getDeviceId().toString(16).toUpperCase()}`;
    const stepNames = [
      "Device ID Handshake",
      "System & Setup Parameters",
      "Temporary Performance Common & Effects",
      "Temporary Patch & Tone Engine",
      "User Performance Bank Sample",
      "User Patch Bank Sample"
    ];
    container.innerHTML = stepNames.map((name, i) => `
    <div id="diagStepRow_${i}" style="display:flex; justify-content:space-between; align-items:center; padding:10px 14px; border-radius:6px; background:var(--bg-elevated); border:1px solid var(--border);">
      <div style="display:flex; align-items:center; gap:10px;">
        <span id="diagStepIcon_${i}" style="font-size:1.1rem;">\u23F3</span>
        <div>
          <div style="font-weight:600; font-size:0.88rem;">${name}</div>
          <div id="diagStepDetail_${i}" style="font-size:0.75rem; color:var(--text-dim);">Waiting to run...</div>
        </div>
      </div>
      <div id="diagStepLatency_${i}" style="font-size:0.8rem; font-family:monospace; color:var(--text-muted);">\u2014</div>
    </div>
  `).join("");
    const report = await runHardwareDiagnostics(midi, getDeviceId(), (prog) => {
      const idx = stepNames.indexOf(prog.name);
      if (idx < 0) return;
      const icon = $(`diagStepIcon_${idx}`);
      const detail = $(`diagStepDetail_${idx}`);
      const lat = $(`diagStepLatency_${idx}`);
      if (prog.status === "running") {
        if (icon) icon.textContent = "\u{1F504}";
        if (detail) detail.textContent = "Communicating with hardware...";
      } else if (prog.status === "passed") {
        if (icon) icon.textContent = "\u2705";
        if (detail) detail.textContent = "Passed \u2014 Valid SysEx response received";
        if (lat) lat.textContent = `${prog.latencyMs} ms`;
      } else if (prog.status === "failed") {
        if (icon) icon.textContent = "\u274C";
        if (detail) detail.textContent = `Failed: ${prog.error}`;
        if (lat) lat.textContent = "ERR";
      }
    });
    if (report.overallSuccess) {
      bannerText.innerHTML = '<span style="color:var(--success);">\u2714 All Diagnostics Passed!</span>';
      bannerSub.textContent = `XV-5050 USB link verified healthy (${report.steps.length} checks passed).`;
      setStatus("XV-5050 USB Hardware Diagnostics: All 6 tests passed successfully.");
    } else {
      bannerText.innerHTML = '<span style="color:var(--danger);">\u2716 Diagnostics Encountered Issues</span>';
      bannerSub.textContent = "One or more hardware SysEx checks failed. Check connection or Device ID.";
      setStatus("XV-5050 USB Hardware Diagnostics: Issues detected.");
    }
  }
  async function executeSyncWithUnit() {
    if (isSyncInProgress) return;
    isSyncInProgress = true;
    const modal = $("confirmSyncModal");
    if (modal) modal.style.display = "none";
    const progModal = $("syncProgressModal");
    const progDetail = $("syncProgressDetail");
    const progBar = $("syncProgressBar");
    const setProgress = (percent, detail) => {
      if (progBar) progBar.style.width = `${percent}%`;
      if (progDetail) progDetail.textContent = detail;
      setStatus(`Sync: ${detail} (${percent}%)`);
    };
    if (progModal) progModal.style.display = "flex";
    setProgress(2, "Connecting to XV-5050...");
    let activeDb = null;
    let unitDb = null;
    try {
      const devId = getDeviceId();
      unitDb = await syncEntireUnit(midi, devId, (pct, statusText, stage, currentDb) => {
        activeDb = currentDb;
        setProgress(pct, statusText);
        const db = currentDb || unitDb;
        if (db && (db.userPerformances?.length || db.userPatches?.length || db.currentPerformance?.parts?.length)) {
          syncedUnitDb = db;
          populateUserBankSelectors();
          populateAllInstrumentSelectors();
          renderPartNavigationStrip();
        }
      });
      syncedUnitDb = unitDb;
      try {
        if (unitDb.currentPerformance?.common) {
          updatePerformanceCommonUI(unitDb.currentPerformance.common);
          store.set("performance.common", unitDb.currentPerformance.common);
        }
        if (unitDb.currentPerformance?.mfxA) {
          perfMfxCache.A = unitDb.currentPerformance.mfxA;
          updatePerfMfxBadges("A", unitDb.currentPerformance.mfxA.mfxType);
        }
        if (unitDb.currentPerformance?.mfxB) {
          perfMfxCache.B = unitDb.currentPerformance.mfxB;
          updatePerfMfxBadges("B", unitDb.currentPerformance.mfxB.mfxType);
        }
        if (unitDb.currentPerformance?.mfxC) {
          perfMfxCache.C = unitDb.currentPerformance.mfxC;
          updatePerfMfxBadges("C", unitDb.currentPerformance.mfxC.mfxType);
        }
        if (perfMfxCache[activePerfMfxSlot]) {
          applyPerfMfxToUI(perfMfxCache[activePerfMfxSlot]);
        }
        if (unitDb.currentPerformance?.chorus) {
          updatePerformanceChorusUI(unitDb.currentPerformance.chorus);
          store.set("performance.effects.chorus", unitDb.currentPerformance.chorus);
        }
        if (unitDb.currentPerformance?.reverb) {
          updatePerformanceReverbUI(unitDb.currentPerformance.reverb);
          store.set("performance.effects.reverb", unitDb.currentPerformance.reverb);
        }
        if (Array.isArray(unitDb.currentPerformance?.parts)) {
          unitDb.currentPerformance.parts.forEach((p, idx) => {
            updatePartRow(idx + 1, p);
          });
          store.set("performance.parts", unitDb.currentPerformance.parts);
        }
      } catch (e) {
        console.warn("Non-fatal error updating performance UI:", e);
      }
      try {
        if (Array.isArray(unitDb.activePatches)) {
          unitDb.activePatches.forEach((ap) => {
            activePartPatchesCache[ap.part] = ap;
          });
          const activePart = getSelectedPart();
          const currentPatch = activePartPatchesCache[activePart] || unitDb.activePatches[0];
          if (currentPatch) {
            if (currentPatch.common) {
              updatePatchCommonUI(currentPatch.common);
              store.set("patch.common", currentPatch.common);
            }
            if (currentPatch.mfx || currentPatch.chorus || currentPatch.reverb) {
              applyPatchEffectsToUI(currentPatch.mfx, currentPatch.chorus, currentPatch.reverb);
            }
            if (currentPatch.tmt) {
              updatePatchTMTUI(currentPatch.tmt);
              store.set("patch.tmt", currentPatch.tmt);
            }
            if (Array.isArray(currentPatch.tones)) {
              currentPatch.tones.forEach((toneData, tIdx) => {
                store.set(`patch.tones.${tIdx}`, toneData);
                currentToneCache[tIdx] = toneData;
              });
              const activeTone = currentToneCache[currentToneIndex - 1];
              if (activeTone) updateToneUI(activeTone);
            }
          }
        }
      } catch (e) {
        console.warn("Non-fatal error updating patch UI:", e);
      }
      populateUserBankSelectors();
      populateAllInstrumentSelectors();
      renderPartNavigationStrip();
      renderUserPerfsTable();
      renderUserPatchesTable();
      saveSyncedDbToStorage();
      if (unitDb?.setup?.soundMode) {
        setSynthesizerMode(unitDb.setup.soundMode, false);
      }
      setProgress(100, "Entire Unit Sync Complete!");
      clearEdited();
      setStatus("\u2713 Successfully synchronized entire XV-5050 unit: Setup, System, Current Performance, 64 User Performances, 128 User Patches, 4 User Rhythm Sets");
      setTimeout(() => {
        if (progModal) progModal.style.display = "none";
      }, 600);
    } catch (err) {
      if (progModal) progModal.style.display = "none";
      const fallbackDb = unitDb || activeDb;
      if (fallbackDb && (fallbackDb.userPerformances?.length || fallbackDb.userPatches?.length || fallbackDb.currentPerformance?.parts?.length)) {
        syncedUnitDb = fallbackDb;
        populateUserBankSelectors();
        populateAllInstrumentSelectors();
        renderPartNavigationStrip();
        renderUserPerfsTable();
        renderUserPatchesTable();
        saveSyncedDbToStorage();
      }
      setStatus(`Sync completed with warning: ${err.message}`);
      console.error("Entire Unit Sync failed:", err);
    } finally {
      isSyncInProgress = false;
    }
  }
  var THEMES = [
    { id: "native-silver", name: "XV-5050 Native", icon: "\u{1F39B}\uFE0F", desc: "Brushed Silver Chassis with Amber Dot-Matrix LCD" },
    { id: "cyber-cyan", name: "Cyber Cyan", icon: "\u26A1", desc: "Deep Space Obsidian with Electric Cyan" },
    { id: "vintage-jd", name: "Roland JD Classic", icon: "\u{1F3B9}", desc: "Charcoal JD-800 Vintage Rack with Orange & Blue" },
    { id: "oled-obsidian", name: "OLED Obsidian", icon: "\u{1F311}", desc: "Monochrome High-Contrast Pitch Black" },
    { id: "emerald-matrix", name: "Emerald Matrix", icon: "\u{1F4DF}", desc: "Neon Phosphor Green CRT & Dot Matrix" },
    { id: "solar-amber", name: "Solar Amber", icon: "\u2600\uFE0F", desc: "Warm Tube Valve & Analog Copper Glow" },
    { id: "midnight-uv", name: "Midnight UV", icon: "\u{1F52E}", desc: "Synthwave Deep Violet & Electric Magenta" },
    { id: "studio-slate", name: "Studio Slate", icon: "\u{1F39A}\uFE0F", desc: "Pro Audio Titanium & Neutral Slate Gray" }
  ];
  function applyTheme(themeId, persist = true) {
    const theme = THEMES.find((t) => t.id === themeId) || THEMES[0];
    document.documentElement.setAttribute("data-theme", theme.id);
    const badge = $("themeNameBadge");
    if (badge) {
      badge.textContent = `${theme.icon} ${theme.name}`;
    }
    const btn = $("themeCycleBtn");
    if (btn) {
      const nextTheme = THEMES[(THEMES.indexOf(theme) + 1) % THEMES.length];
      btn.title = `Current Scheme: ${theme.name} (${theme.desc})
Click to cycle to: ${nextTheme.name}`;
    }
    if (persist) {
      try {
        localStorage.setItem("xv5050_theme", theme.id);
      } catch (e) {
        console.warn("Could not save theme to localStorage", e);
      }
    }
  }
  function cycleNextTheme() {
    const current = document.documentElement.getAttribute("data-theme") || "native-silver";
    const currentIndex = THEMES.findIndex((t) => t.id === current);
    const nextIndex = (currentIndex + 1) % THEMES.length;
    applyTheme(THEMES[nextIndex].id, true);
    setStatus(`Color Theme: ${THEMES[nextIndex].name}`);
  }
  function initThemeManager() {
    let savedTheme = "native-silver";
    try {
      savedTheme = localStorage.getItem("xv5050_theme") || "native-silver";
    } catch (e) {
      console.warn("Could not read theme from localStorage", e);
    }
    applyTheme(savedTheme, false);
    const cycleBtn = $("themeCycleBtn");
    if (cycleBtn) {
      cycleBtn.addEventListener("click", cycleNextTheme);
    }
  }
  function initSrxSlots() {
    const slotASel = $("srxSlotASelect");
    const slotBSel = $("srxSlotBSelect");
    const waveSrxSelect = $("waveSrxBoardSelect");
    let savedA = "NONE";
    let savedB = "NONE";
    try {
      savedA = localStorage.getItem("xv5050_srx_slot_a") || "NONE";
      savedB = localStorage.getItem("xv5050_srx_slot_b") || "NONE";
    } catch (e) {
      console.warn("Could not read SRX config from localStorage", e);
    }
    if (slotASel) slotASel.value = savedA;
    if (slotBSel) slotBSel.value = savedB;
    function updateSrxBoardOptions() {
      if (!waveSrxSelect) return;
      const aVal = slotASel ? slotASel.value : "NONE";
      const bVal = slotBSel ? slotBSel.value : "NONE";
      waveSrxSelect.innerHTML = `
      <option value="A">Slot A: ${aVal === "NONE" ? "(Empty)" : aVal}</option>
      <option value="B">Slot B: ${bVal === "NONE" ? "(Empty)" : bVal}</option>
    `;
    }
    updateSrxBoardOptions();
    updateWaveGroupDropdownLabels();
    if (slotASel) {
      slotASel.addEventListener("change", () => {
        try {
          localStorage.setItem("xv5050_srx_slot_a", slotASel.value);
        } catch (e) {
        }
        updateSrxBoardOptions();
        updateWaveGroupDropdownLabels();
        const curWg = $("waveGroup")?.value;
        if (curWg === "SRX-A") {
          populateWaveDropdowns(2, "A");
        }
        populateAllInstrumentSelectors();
        setStatus(`SRX Slot A set to ${slotASel.value}`);
      });
    }
    if (slotBSel) {
      slotBSel.addEventListener("change", () => {
        try {
          localStorage.setItem("xv5050_srx_slot_b", slotBSel.value);
        } catch (e) {
        }
        updateSrxBoardOptions();
        updateWaveGroupDropdownLabels();
        const curWg = $("waveGroup")?.value;
        if (curWg === "SRX-B") {
          populateWaveDropdowns(2, "B");
        }
        populateAllInstrumentSelectors();
        setStatus(`SRX Slot B set to ${slotBSel.value}`);
      });
    }
    if (waveSrxSelect) {
      waveSrxSelect.addEventListener("change", () => {
        populateWaveDropdowns(2, waveSrxSelect.value);
        const grp = parseInt($("waveGroup")?.value, 10);
        const numL = parseInt($("waveNumberL")?.value, 10) || 1;
        const nl = $("waveNameL");
        if (nl) nl.textContent = getWaveName(grp, numL);
      });
    }
  }
  function initScaleTuneControls() {
    const btnApply = $("btnApplyScaleTemperament");
    const tempSelect = $("scaleTemperamentSelect");
    if (!btnApply || !tempSelect) return;
    btnApply.addEventListener("click", () => {
      const part = getEffectivePatchPart() || 1;
      const scaleKey = tempSelect.value;
      const temp = SCALE_TEMPERAMENTS[scaleKey] || SCALE_TEMPERAMENTS.equal;
      const sysex = buildPartScaleTemperamentDT1(getDeviceId(), part, temp.offsets);
      if (midi.isConnected) {
        midi.sendSysEx(sysex);
        setStatus(`Applied ${temp.name} scale tuning to Part ${part}`);
      } else {
        setStatus(`Scale Tuning (${temp.name}): Connect MIDI to transmit to Part ${part}`);
      }
    });
  }
  var mutatorHistory = new MutatorHistory(20);
  var mutatorOriginalSnapshot = null;
  var isViewingOriginalAB = false;
  function getCurrentPatchFullSnapshot() {
    return {
      common: currentPatchCommonData ? JSON.parse(JSON.stringify(currentPatchCommonData)) : {},
      tmt: currentPatchTMTData ? JSON.parse(JSON.stringify(currentPatchTMTData)) : {},
      tones: {
        1: currentToneCache[0] ? JSON.parse(JSON.stringify(currentToneCache[0])) : {},
        2: currentToneCache[1] ? JSON.parse(JSON.stringify(currentToneCache[1])) : {},
        3: currentToneCache[2] ? JSON.parse(JSON.stringify(currentToneCache[2])) : {},
        4: currentToneCache[3] ? JSON.parse(JSON.stringify(currentToneCache[3])) : {}
      }
    };
  }
  function syncDeepStudioToneCards() {
    for (let t = 1; t <= 4; t++) {
      const data = currentToneCache[t - 1] || {};
      const card = $(`deepToneCard${t}`);
      const enCheckbox = $(`deepTone${t}En`);
      const levelInput = $(`deepTone${t}Level`);
      const levelVal = $(`deepTone${t}LevelVal`);
      const panInput = $(`deepTone${t}Pan`);
      const panVal = $(`deepTone${t}PanVal`);
      const cutoffInput = $(`deepTone${t}Cutoff`);
      const cutoffVal = $(`deepTone${t}CutoffVal`);
      const waveBadge = $(`deepTone${t}WaveBadge`);
      const grp = data.waveGroupType ?? 0;
      const wNumL = data.waveNumberL ?? (t === 1 ? 1 : 0);
      const lvl = data.toneLevel ?? (t <= 2 ? 127 : 0);
      const pan = data.tonePan ?? 64;
      const cut = data.tvfCutoff ?? 127;
      const isEnabled = currentPatchTMTData ? (currentPatchTMTData[`tone${t}Switch`] ?? (t <= 2 ? 1 : 0)) === 1 : lvl > 0;
      if (card) card.classList.toggle("disabled", !isEnabled);
      if (enCheckbox) enCheckbox.checked = isEnabled;
      if (levelInput) levelInput.value = lvl;
      if (levelVal) levelVal.textContent = lvl;
      if (panInput) panInput.value = pan;
      if (panVal) panVal.textContent = panDisplay(pan);
      if (cutoffInput) cutoffInput.value = cut;
      if (cutoffVal) cutoffVal.textContent = cut;
      if (waveBadge) waveBadge.textContent = wNumL === 0 ? "OFF" : getWaveName(grp, wNumL);
    }
  }
  function updateDeepStudioSpectrum() {
    const pathEl = $("deepSpectrumPath");
    if (!pathEl) return;
    const activeTone = currentToneCache[currentToneIndex - 1] || {};
    const cut = parseInt($("toneCutoff")?.value ?? activeTone.tvfCutoff ?? 127, 10);
    const res = parseInt($("toneResonance")?.value ?? activeTone.tvfResonance ?? 0, 10);
    const fType = parseInt($("toneFilterType")?.value ?? activeTone.tvfFilterType ?? 0, 10);
    const pathD = generateSpectrumPath(cut, res, fType, 360, 85);
    pathEl.setAttribute("d", pathD);
    const badge = $("spectrumFilterBadge");
    if (badge) {
      badge.textContent = `${FILTER_TYPES[fType] || "OFF"} Filter Active`;
    }
  }
  function applyFullPatchSnapshot(patchData, sendToHardware = true) {
    if (!patchData) return;
    if (patchData.common) {
      updatePatchCommonUI(patchData.common);
      store.set("patch.common", patchData.common);
    }
    if (patchData.tmt) {
      updatePatchTMTUI(patchData.tmt);
      store.set("patch.tmt", patchData.tmt);
    }
    if (patchData.tones) {
      for (let t = 1; t <= 4; t++) {
        const toneData = patchData.tones[t];
        if (toneData) {
          currentToneCache[t - 1] = toneData;
          store.set(`patch.tones.${t - 1}`, toneData);
        }
      }
      const activeTone = currentToneCache[currentToneIndex - 1];
      if (activeTone) updateToneUI(activeTone);
    }
    syncDeepStudioToneCards();
    updateDeepStudioSpectrum();
    if (sendToHardware && midi.isConnected) {
      const part = getEffectivePatchPart();
      const devId = getDeviceId();
      for (let t = 1; t <= 4; t++) {
        const toneData = currentToneCache[t - 1];
        if (toneData) {
          if (toneData.toneLevel !== void 0) sendPatchToneParam(midi, part, t, "TONE_LEVEL", toneData.toneLevel, devId);
          if (toneData.tvfCutoff !== void 0) sendPatchToneParam(midi, part, t, "TVF_CUTOFF", toneData.tvfCutoff, devId);
          if (toneData.tvfResonance !== void 0) sendPatchToneParam(midi, part, t, "TVF_RESONANCE", toneData.tvfResonance, devId);
          if (toneData.waveNumberL !== void 0) sendPatchToneParam(midi, part, t, "WAVE_NUMBER_L", toneData.waveNumberL, devId);
        }
      }
    }
  }
  function initDeepStudio() {
    const rollupHeader = $("btnToggleDeepStudioRollup");
    const rollupBody = $("deepStudioRollupBody");
    const toggleBtn = $("btnRollupToggleState");
    let isExpanded = false;
    try {
      const saved = localStorage.getItem("xv5050_deep_studio_rollup");
      if (saved !== null) isExpanded = saved === "true";
    } catch (_) {
    }
    if (rollupBody) {
      rollupBody.style.display = isExpanded ? "block" : "none";
      if (toggleBtn) toggleBtn.textContent = isExpanded ? "Collapse \u25B2" : "Expand \u25BC";
    }
    if (rollupHeader && rollupBody) {
      rollupHeader.addEventListener("click", (e) => {
        if (e.target.tagName === "INPUT" || e.target.tagName === "SELECT") return;
        isExpanded = rollupBody.style.display === "none";
        rollupBody.style.display = isExpanded ? "block" : "none";
        if (toggleBtn) toggleBtn.textContent = isExpanded ? "Collapse \u25B2" : "Expand \u25BC";
        try {
          localStorage.setItem("xv5050_deep_studio_rollup", isExpanded ? "true" : "false");
        } catch (_) {
        }
      });
    }
    for (let m = 1; m <= 4; m++) {
      const dial = $(`macro${m}Dial`);
      const valPill = $(`macro${m}Val`);
      if (dial && valPill) {
        dial.addEventListener("input", () => {
          const val = parseInt(dial.value, 10);
          const delta = val - 64;
          valPill.textContent = delta > 0 ? `+${delta}` : `${delta}`;
          const part = getEffectivePatchPart();
          const devId = getDeviceId();
          if (m === 1) {
            for (let t = 1; t <= 4; t++) {
              const currentCutoff = parseInt($(`deepTone${t}Cutoff`)?.value || 127, 10);
              const nextCutoff = Math.max(0, Math.min(127, currentCutoff + Math.round(delta * 0.5)));
              if (currentToneCache[t - 1]) currentToneCache[t - 1].tvfCutoff = nextCutoff;
              const cutInput = $(`deepTone${t}Cutoff`);
              if (cutInput) cutInput.value = nextCutoff;
              const cutVal = $(`deepTone${t}CutoffVal`);
              if (cutVal) cutVal.textContent = nextCutoff;
              if (currentToneIndex === t && $("toneCutoff")) {
                $("toneCutoff").value = nextCutoff;
                $("toneCutoffVal").textContent = nextCutoff;
              }
              if (midi.isConnected) {
                sendThrottled(`macro_cutoff_${t}`, () => {
                  sendPatchToneParam(midi, part, t, "TVF_CUTOFF", nextCutoff, devId);
                });
              }
            }
            updateDeepStudioSpectrum();
          } else if (m === 2) {
            for (let t = 1; t <= 4; t++) {
              const currentRes = currentToneCache[t - 1]?.tvfResonance ?? 10;
              const nextRes = Math.max(0, Math.min(127, currentRes + Math.round(delta * 0.4)));
              if (currentToneCache[t - 1]) currentToneCache[t - 1].tvfResonance = nextRes;
              if (currentToneIndex === t && $("toneResonance")) {
                $("toneResonance").value = nextRes;
                $("toneResonanceVal").textContent = nextRes;
              }
              if (midi.isConnected) {
                sendThrottled(`macro_res_${t}`, () => {
                  sendPatchToneParam(midi, part, t, "TVF_RESONANCE", nextRes, devId);
                });
              }
            }
            updateDeepStudioSpectrum();
          } else if (m === 3) {
            const baseCho = currentPatchCommonData?.chorusSend ?? 40;
            const baseRev = currentPatchCommonData?.reverbSend ?? 40;
            const nextCho = Math.max(0, Math.min(127, baseCho + Math.round(delta * 0.5)));
            const nextRev = Math.max(0, Math.min(127, baseRev + Math.round(delta * 0.5)));
            if (midi.isConnected) {
              sendThrottled("macro_space", () => {
                sendPatchChorusParam(midi, part, "CHORUS_SEND", nextCho, devId);
                sendPatchReverbParam(midi, part, "REVERB_SEND", nextRev, devId);
              });
            }
          } else if (m === 4) {
            for (let t = 1; t <= 4; t++) {
              const baseRate = currentToneCache[t - 1]?.lfo1Rate ?? 64;
              const nextRate = Math.max(0, Math.min(127, baseRate + Math.round(delta * 0.5)));
              if (currentToneCache[t - 1]) currentToneCache[t - 1].lfo1Rate = nextRate;
              if (currentToneIndex === t && $("lfoRate") && currentLfoIndex === 1) {
                $("lfoRate").value = nextRate;
                $("lfoRateVal").textContent = nextRate;
              }
              if (midi.isConnected) {
                sendThrottled(`macro_lfo_${t}`, () => {
                  sendToneLFOParam(midi, part, t, 1, "RATE", nextRate, devId);
                });
              }
            }
          }
        });
      }
    }
    for (let t = 1; t <= 4; t++) {
      const enCheckbox = $(`deepTone${t}En`);
      const lvlInput = $(`deepTone${t}Level`);
      const panInput = $(`deepTone${t}Pan`);
      const cutInput = $(`deepTone${t}Cutoff`);
      if (enCheckbox) {
        enCheckbox.addEventListener("change", () => {
          const checked = enCheckbox.checked;
          const card = $(`deepToneCard${t}`);
          if (card) card.classList.toggle("disabled", !checked);
          if (currentPatchTMTData) currentPatchTMTData[`tone${t}Switch`] = checked ? 1 : 0;
          if (midi.isConnected) {
            sendToneSwitch(midi, getEffectivePatchPart(), t, checked, getDeviceId());
          }
        });
      }
      if (lvlInput) {
        lvlInput.addEventListener("input", () => {
          const val = parseInt(lvlInput.value, 10);
          $(`deepTone${t}LevelVal`).textContent = val;
          if (currentToneCache[t - 1]) currentToneCache[t - 1].toneLevel = val;
          if (currentToneIndex === t && $("toneLevel")) {
            $("toneLevel").value = val;
            $("toneLevelVal").textContent = val;
          }
          if (midi.isConnected) {
            sendThrottled(`deepToneLvl_${t}`, () => {
              sendPatchToneParam(midi, getEffectivePatchPart(), t, "TONE_LEVEL", val, getDeviceId());
            });
          }
        });
      }
      if (panInput) {
        panInput.addEventListener("input", () => {
          const val = parseInt(panInput.value, 10);
          $(`deepTone${t}PanVal`).textContent = panDisplay(val);
          if (currentToneCache[t - 1]) currentToneCache[t - 1].tonePan = val;
          if (currentToneIndex === t && $("tonePan")) {
            $("tonePan").value = val;
            $("tonePanVal").textContent = panDisplay(val);
          }
          if (midi.isConnected) {
            sendThrottled(`deepTonePan_${t}`, () => {
              sendPatchToneParam(midi, getEffectivePatchPart(), t, "TONE_PAN", val, getDeviceId());
            });
          }
        });
      }
      if (cutInput) {
        cutInput.addEventListener("input", () => {
          const val = parseInt(cutInput.value, 10);
          $(`deepTone${t}CutoffVal`).textContent = val;
          if (currentToneCache[t - 1]) currentToneCache[t - 1].tvfCutoff = val;
          if (currentToneIndex === t && $("toneCutoff")) {
            $("toneCutoff").value = val;
            $("toneCutoffVal").textContent = val;
          }
          updateDeepStudioSpectrum();
          if (midi.isConnected) {
            sendThrottled(`deepToneCut_${t}`, () => {
              sendPatchToneParam(midi, getEffectivePatchPart(), t, "TVF_CUTOFF", val, getDeviceId());
            });
          }
        });
      }
    }
    const vectorPad = $("vectorMorphPad");
    const vectorPuck = $("vectorMorphPuck");
    const vectorCoords = $("vectorMorphCoords");
    if (vectorPad && vectorPuck) {
      let handleVectorPadMove = function(e) {
        const rect = vectorPad.getBoundingClientRect();
        const x = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
        const y = Math.max(0, Math.min(1, (e.clientY - rect.top) / rect.height));
        vectorPuck.style.left = `${x * 100}%`;
        vectorPuck.style.top = `${y * 100}%`;
        if (vectorCoords) {
          vectorCoords.textContent = `(${Math.round(x * 100)}%, ${Math.round(y * 100)}%)`;
        }
        const levels = calculateVectorMorphLevels(x, y, 127);
        $("vecTone1Val").textContent = levels.tone1;
        $("vecTone2Val").textContent = levels.tone2;
        $("vecTone3Val").textContent = levels.tone3;
        $("vecTone4Val").textContent = levels.tone4;
        const part = getEffectivePatchPart();
        const devId = getDeviceId();
        for (let t = 1; t <= 4; t++) {
          const lvl = levels[`tone${t}`];
          const lvlSlider = $(`deepTone${t}Level`);
          if (lvlSlider) lvlSlider.value = lvl;
          const lvlVal = $(`deepTone${t}LevelVal`);
          if (lvlVal) lvlVal.textContent = lvl;
          if (currentToneCache[t - 1]) currentToneCache[t - 1].toneLevel = lvl;
          if (currentToneIndex === t && $("toneLevel")) {
            $("toneLevel").value = lvl;
            $("toneLevelVal").textContent = lvl;
          }
          if (midi.isConnected) {
            sendThrottled(`vector_tone_${t}`, () => {
              sendPatchToneParam(midi, part, t, "TONE_LEVEL", lvl, devId);
            });
          }
        }
      };
      let isDraggingPuck = false;
      vectorPad.addEventListener("pointerdown", (e) => {
        isDraggingPuck = true;
        vectorPad.setPointerCapture(e.pointerId);
        handleVectorPadMove(e);
      });
      vectorPad.addEventListener("pointermove", (e) => {
        if (isDraggingPuck) handleVectorPadMove(e);
      });
      vectorPad.addEventListener("pointerup", (e) => {
        if (isDraggingPuck) {
          isDraggingPuck = false;
          try {
            vectorPad.releasePointerCapture(e.pointerId);
          } catch (_) {
          }
        }
      });
    }
    const mutatorIntensitySlider = $("mutatorIntensity");
    const mutatorIntensityVal = $("mutatorIntensityVal");
    if (mutatorIntensitySlider && mutatorIntensityVal) {
      mutatorIntensitySlider.addEventListener("input", () => {
        mutatorIntensityVal.textContent = `${mutatorIntensitySlider.value}% Variation`;
      });
    }
    $("btnMutatePatch")?.addEventListener("click", () => {
      if (!mutatorOriginalSnapshot) {
        mutatorOriginalSnapshot = getCurrentPatchFullSnapshot();
        mutatorHistory.setOriginal(mutatorOriginalSnapshot);
      }
      const intensity = parseInt($("mutatorIntensity")?.value || 20, 10) / 100;
      const archetype = $("mutatorArchetypeSelect")?.value || "general";
      const locks = {
        lockWaveforms: $("lockWaveforms")?.checked ?? false,
        lockFilters: $("lockFilters")?.checked ?? false,
        lockEnvelopes: $("lockEnvelopes")?.checked ?? false,
        lockTuning: $("lockTuning")?.checked ?? true,
        lockEffects: $("lockEffects")?.checked ?? false
      };
      const currentSnapshot = getCurrentPatchFullSnapshot();
      const mutated = mutatePatch(currentSnapshot, intensity, archetype, locks);
      mutatorHistory.push(mutated);
      applyFullPatchSnapshot(mutated, true);
      const statusEl = $("mutatorStatusMsg");
      if (statusEl) statusEl.textContent = `Mutated (${Math.round(intensity * 100)}% ${archetype})`;
      setStatus(`Mutated patch sound using ${archetype} archetype seed (${Math.round(intensity * 100)}%)`);
    });
    $("btnRandomizeWaves")?.addEventListener("click", () => {
      if (!mutatorOriginalSnapshot) {
        mutatorOriginalSnapshot = getCurrentPatchFullSnapshot();
        mutatorHistory.setOriginal(mutatorOriginalSnapshot);
      }
      const locks = {
        lockWaveforms: $("lockWaveforms")?.checked ?? false,
        lockFilters: $("lockFilters")?.checked ?? false,
        lockEnvelopes: $("lockEnvelopes")?.checked ?? false,
        lockTuning: $("lockTuning")?.checked ?? true,
        lockEffects: $("lockEffects")?.checked ?? false
      };
      const currentSnapshot = getCurrentPatchFullSnapshot();
      const mutated = randomizeWaveforms(currentSnapshot, locks);
      mutatorHistory.push(mutated);
      applyFullPatchSnapshot(mutated, true);
      const statusEl = $("mutatorStatusMsg");
      if (statusEl) statusEl.textContent = "Randomized PCM Waveforms";
      setStatus("Randomized internal PCM waveforms across active tones");
    });
    $("btnMutatorUndo")?.addEventListener("click", () => {
      const prev = mutatorHistory.undo();
      if (prev) {
        applyFullPatchSnapshot(prev, true);
        const statusEl = $("mutatorStatusMsg");
        if (statusEl) statusEl.textContent = "Undo mutation";
        setStatus("Undid patch mutation step");
      } else {
        setStatus("No further undo steps in mutation history");
      }
    });
    $("btnMutatorRedo")?.addEventListener("click", () => {
      const next = mutatorHistory.redo();
      if (next) {
        applyFullPatchSnapshot(next, true);
        const statusEl = $("mutatorStatusMsg");
        if (statusEl) statusEl.textContent = "Redo mutation";
        setStatus("Redid patch mutation step");
      } else {
        setStatus("No further redo steps in mutation history");
      }
    });
    $("btnMutatorCompare")?.addEventListener("click", () => {
      if (!mutatorOriginalSnapshot) {
        mutatorOriginalSnapshot = getCurrentPatchFullSnapshot();
        mutatorHistory.setOriginal(mutatorOriginalSnapshot);
        setStatus("Original sound snapshot captured for A/B comparison");
        return;
      }
      isViewingOriginalAB = !isViewingOriginalAB;
      const btnCompare = $("btnMutatorCompare");
      if (isViewingOriginalAB) {
        applyFullPatchSnapshot(mutatorOriginalSnapshot, true);
        if (btnCompare) {
          btnCompare.textContent = "Viewing: Original A (Click for B)";
          btnCompare.classList.add("btn-primary");
        }
        setStatus("Comparing Sound: Active sound is Original (A)");
      } else {
        const cur = mutatorHistory.getCurrent() || getCurrentPatchFullSnapshot();
        applyFullPatchSnapshot(cur, true);
        if (btnCompare) {
          btnCompare.textContent = "A/B Compare";
          btnCompare.classList.remove("btn-primary");
        }
        setStatus("Comparing Sound: Active sound is Mutated (B)");
      }
    });
  }
  var currentDrumOctave = 1;
  var currentDrumNote = 36;
  var drumKeyCache = {};
  var DRUM_CUSTOM_HITS_KEY = "xv5050_drum_custom_hits";
  var DRUM_CUSTOM_KITS_KEY = "xv5050_drum_custom_kits";
  function getCustomDrumHit(note) {
    try {
      const hits = JSON.parse(localStorage.getItem(DRUM_CUSTOM_HITS_KEY) || "{}");
      return hits[note] || null;
    } catch (_) {
      return null;
    }
  }
  function saveCustomDrumHit(note, name, category) {
    try {
      const hits = JSON.parse(localStorage.getItem(DRUM_CUSTOM_HITS_KEY) || "{}");
      hits[note] = { name, category };
      localStorage.setItem(DRUM_CUSTOM_HITS_KEY, JSON.stringify(hits));
    } catch (_) {
    }
  }
  function deleteCustomDrumHit(note) {
    try {
      const hits = JSON.parse(localStorage.getItem(DRUM_CUSTOM_HITS_KEY) || "{}");
      delete hits[note];
      localStorage.setItem(DRUM_CUSTOM_HITS_KEY, JSON.stringify(hits));
    } catch (_) {
    }
  }
  function initDrumKitEditor() {
    const padContainer = $("drumPadGridContainer");
    const octaveBadge = $("drumOctaveRangeBadge");
    const selectedNoteBadge = $("drumSelectedNoteBadge");
    function populateDrumKitSelectOptions() {
      const kitSel2 = $("drumKitSelect");
      if (!kitSel2) return;
      const currentVal = kitSel2.value;
      kitSel2.innerHTML = "";
      const customKits = JSON.parse(localStorage.getItem(DRUM_CUSTOM_KITS_KEY) || "{}");
      const ogUser = document.createElement("optgroup");
      ogUser.label = "\u2014 User Drum Kits (1-4) \u2014";
      const userDefaults = ["Tight Studio Kit", "Hip-Hop 808 Kit", "XV WayHipKit", "XV Jazz Kit"];
      for (let u = 1; u <= 4; u++) {
        const dbName = syncedUnitDb?.userRhythms?.[u - 1]?.name;
        const customName = customKits[`USER:${u}`];
        const name = customName || dbName || userDefaults[u - 1];
        const opt = document.createElement("option");
        opt.value = `USER:${u}`;
        opt.textContent = `User Drum ${u}: ${name} (Bank 86/0 PC ${u})`;
        ogUser.appendChild(opt);
      }
      kitSel2.appendChild(ogUser);
      const ogPreset = document.createElement("optgroup");
      ogPreset.label = "\u2014 Roland Preset Drum Kits (1-8) \u2014";
      const presetKits = [
        "Standard Kit 1",
        "Standard Kit 2",
        "Power Drum Kit",
        "Electronic Kit",
        "Analog 808/909",
        "Jazz Drum Kit",
        "Brush Drum Kit",
        "Orchestral Perc"
      ];
      for (let p = 1; p <= 8; p++) {
        const customName = customKits[`PRESET:${p}`];
        const name = customName || presetKits[p - 1];
        const opt = document.createElement("option");
        opt.value = `PRESET:${p}`;
        opt.textContent = `Preset Drum ${p}: ${name} (Bank 86/64 PC ${p})`;
        ogPreset.appendChild(opt);
      }
      kitSel2.appendChild(ogPreset);
      const slotABoard = $("srxSlotASelect")?.value || localStorage.getItem("xv5050_srx_slot_a") || "NONE";
      const slotBBoard = $("srxSlotBSelect")?.value || localStorage.getItem("xv5050_srx_slot_b") || "NONE";
      [{ slot: "A", id: slotABoard }, { slot: "B", id: slotBBoard }].forEach(({ slot, id }) => {
        if (id && id !== "NONE") {
          const board = getSrxBoard(id);
          if (board && board.drumKits && board.drumKits.length > 0) {
            const ogSrxKits = document.createElement("optgroup");
            ogSrxKits.label = `\u2014 SRX Slot ${slot}: ${board.name} \u2014`;
            board.drumKits.forEach((kitName, idx) => {
              const opt = document.createElement("option");
              opt.value = `SRX:${slot}:${id}:${idx + 1}`;
              opt.textContent = `${kitName} (Bank 92/${slot === "A" ? 0 : 2} PC ${idx + 1})`;
              ogSrxKits.appendChild(opt);
            });
            kitSel2.appendChild(ogSrxKits);
          }
        }
      });
      if (currentVal && Array.from(kitSel2.options).some((o) => o.value === currentVal)) {
        kitSel2.value = currentVal;
      }
    }
    populateDrumKitSelectOptions();
    const kitSel = $("drumKitSelect");
    if (kitSel) {
      kitSel.addEventListener("change", async (e) => {
        const val = e.target.value;
        if (!val) return;
        const parts = val.split(":");
        let msb = 86;
        let lsb = 0;
        let pc = 1;
        let kitName = e.target.selectedOptions[0]?.textContent || "Drum Kit";
        if (parts[0] === "USER") {
          msb = 86;
          lsb = 0;
          pc = parseInt(parts[1], 10);
        } else if (parts[0] === "PRESET") {
          msb = 86;
          lsb = 64;
          pc = parseInt(parts[1], 10);
        } else if (parts[0] === "SRX") {
          const slot = parts[1];
          msb = 92;
          lsb = slot === "A" ? 0 : 2;
          pc = parseInt(parts[3] || "1", 10);
        }
        const rhythmPart = 10;
        if (midi.isConnected) {
          setStatus(`Switching XV-5050 Rhythm Part to ${kitName}...`);
          try {
            sendPartBankAndProgram(midi, rhythmPart, msb, lsb, pc, getDeviceId(), 9);
            await new Promise((r) => setTimeout(r, 60));
            const freshName = await requestPartPatchName(midi, rhythmPart, getDeviceId());
            if (freshName && freshName.trim()) kitName = freshName;
            setStatus(`\u2713 Selected Drum Kit on XV-5050: "${kitName}"`);
          } catch (err) {
            setStatus(`Selected Drum Kit: "${kitName}"`);
          }
        } else {
          setStatus(`Selected Drum Kit: "${kitName}" (Offline)`);
        }
        const p10Name = $(`partPatchName10`);
        if (p10Name) p10Name.textContent = kitName;
        const p10Msb = $(`partBankMSB10`);
        if (p10Msb) p10Msb.value = msb;
        const p10Lsb = $(`partBankLSB10`);
        if (p10Lsb) p10Lsb.value = lsb;
        const p10Pc = $(`partPC10`);
        if (p10Pc) p10Pc.value = pc;
        if (syncedUnitDb?.currentPerformance?.parts?.[9]) {
          const p = syncedUnitDb.currentPerformance.parts[9];
          p.patchBankMSB = msb;
          p.patchBankLSB = lsb;
          p.patchPC = pc;
          p.patchName = kitName;
          saveSyncedDbToStorage();
        }
      });
    }
    function populateDrumWaveDropdown() {
      const drumWaveSel = $("drumWaveNumber");
      if (!drumWaveSel) return;
      const grp = parseInt($("drumWaveGroup")?.value || "0", 10);
      const currVal = drumWaveSel.value;
      drumWaveSel.innerHTML = "";
      let waves = INTERNAL_WAVEFORMS;
      if (grp === 1) {
        waves = INTERNAL_WAVEFORMS.slice(0, 256).map((w, i) => `SR-JV: ${String(i + 1).padStart(3, "0")} ${w}`);
      } else if (grp === 2) {
        const slotA = $("srxSlotASelect")?.value || localStorage.getItem("xv5050_srx_slot_a") || "NONE";
        if (slotA && slotA !== "NONE") {
          waves = getSrxWaveforms(slotA);
        } else {
          waves = ["SRX Slot A: No Board Installed"];
        }
      } else if (grp === 3) {
        const slotB = $("srxSlotBSelect")?.value || localStorage.getItem("xv5050_srx_slot_b") || "NONE";
        if (slotB && slotB !== "NONE") {
          waves = getSrxWaveforms(slotB);
        } else {
          waves = ["SRX Slot B: No Board Installed"];
        }
      }
      waves.forEach((name, idx) => {
        const opt = document.createElement("option");
        opt.value = idx + 1;
        opt.textContent = name;
        drumWaveSel.appendChild(opt);
      });
      if (currVal && drumWaveSel.querySelector(`option[value="${currVal}"]`)) {
        drumWaveSel.value = currVal;
      }
    }
    populateDrumWaveDropdown();
    function populateDrumHitLibraryOptions() {
      const libSel = $("drumHitLibrarySelect");
      if (!libSel) return;
      libSel.innerHTML = '<option value="">\u26A1 Load Hit from Library...</option>';
      const categories = ["Kick", "Snare", "Hi-Hat", "Tom", "Cymbal", "Latin", "Perc", "FX"];
      categories.forEach((cat) => {
        const hits = DRUM_HIT_LIBRARY.filter((h) => h.category === cat);
        if (hits.length > 0) {
          const og = document.createElement("optgroup");
          og.label = `\u2014 ${cat}s \u2014`;
          hits.forEach((h) => {
            const opt = document.createElement("option");
            opt.value = h.id;
            opt.textContent = `${h.name}`;
            og.appendChild(opt);
          });
          libSel.appendChild(og);
        }
      });
      const slotABoard = $("srxSlotASelect")?.value || localStorage.getItem("xv5050_srx_slot_a") || "NONE";
      const slotBBoard = $("srxSlotBSelect")?.value || localStorage.getItem("xv5050_srx_slot_b") || "NONE";
      ["A", "B"].forEach((slot) => {
        const boardId = slot === "A" ? slotABoard : slotBBoard;
        if (boardId && boardId !== "NONE") {
          const board = getSrxBoard(boardId);
          if (board && board.sampleWaves) {
            const ogSrx = document.createElement("optgroup");
            ogSrx.label = `\u2014 ${board.id}: ${board.name} \u2014`;
            board.sampleWaves.slice(0, 12).forEach((wName, i) => {
              const opt = document.createElement("option");
              opt.value = `srx_hit:${slot}:${boardId}:${i + 1}:${wName}`;
              opt.textContent = `${board.id} #${i + 1}: ${wName}`;
              ogSrx.appendChild(opt);
            });
            libSel.appendChild(ogSrx);
          }
        }
      });
    }
    populateDrumHitLibraryOptions();
    function auditionDrumNote(note) {
      if (!midi.isConnected) {
        setStatus(`Audition Note ${note}: Connect MIDI to hear drum sound`);
        return;
      }
      midi.sendNoteOn(9, note, 100);
      setTimeout(() => midi.sendNoteOff(9, note), 220);
      const info = DRUM_KEY_MAP[note] || { note: `Note ${note}`, name: "Drum Key" };
      const savedCustom = getCustomDrumHit(note);
      const displayName = drumKeyCache[note]?.customName || savedCustom?.name || info.name;
      setStatus(`Auditioning Drum: Note ${note} (${info.note} - ${displayName})`);
    }
    function onKnobParamChanged(paramKey, val, offset, inputId, valSpanId, formattedText) {
      const input = $(inputId);
      if (input) input.value = val;
      const span = $(valSpanId);
      if (span) span.textContent = formattedText;
      if (!drumKeyCache[currentDrumNote]) drumKeyCache[currentDrumNote] = {};
      drumKeyCache[currentDrumNote][paramKey] = val;
      if (midi.isConnected) {
        sendThrottled(`drum_${currentDrumNote}_${paramKey}`, () => {
          sendRhythmKeyParam(midi, currentDrumNote, offset, val, currentSoundMode === 2);
        });
      }
    }
    const knobCoarseTune = new RotaryKnob("knobWrapCoarseTune", {
      id: "knobDrumCoarseTune",
      min: 0,
      max: 127,
      defaultValue: 64,
      value: 64,
      label: "Pitch",
      color: "#38bdf8",
      formatValue: (v) => formatKeyNote(v),
      onChange: (val) => onKnobParamChanged("coarseTune", val, RHYTHM_KEY_OFFSETS.COARSE_TUNE, "drumCoarseTune", "drumCoarseTuneVal", formatKeyNote(val))
    });
    const knobFineTune = new RotaryKnob("knobWrapFineTune", {
      id: "knobDrumFineTune",
      min: 14,
      max: 114,
      defaultValue: 64,
      value: 64,
      bipolar: true,
      label: "Fine",
      color: "#38bdf8",
      formatValue: (v) => `${v - 64 > 0 ? "+" : ""}${v - 64}`,
      onChange: (val) => onKnobParamChanged("fineTune", val, RHYTHM_KEY_OFFSETS.FINE_TUNE, "drumFineTune", "drumFineTuneVal", `${val - 64}`)
    });
    const knobCutoff = new RotaryKnob("knobWrapCutoff", {
      id: "knobDrumCutoff",
      min: 0,
      max: 127,
      defaultValue: 127,
      value: 127,
      label: "Cutoff",
      color: "#4cc9f0",
      formatValue: (v) => String(v),
      onChange: (val) => onKnobParamChanged("cutoff", val, RHYTHM_KEY_OFFSETS.TVF_CUTOFF, "drumCutoff", "drumCutoffVal", String(val))
    });
    const knobResonance = new RotaryKnob("knobWrapResonance", {
      id: "knobDrumResonance",
      min: 0,
      max: 127,
      defaultValue: 0,
      value: 0,
      label: "Res",
      color: "#4cc9f0",
      formatValue: (v) => String(v),
      onChange: (val) => onKnobParamChanged("resonance", val, RHYTHM_KEY_OFFSETS.TVF_RESONANCE, "drumResonance", "drumResonanceVal", String(val))
    });
    const knobLevel = new RotaryKnob("knobWrapLevel", {
      id: "knobDrumLevel",
      min: 0,
      max: 127,
      defaultValue: 127,
      value: 127,
      label: "Level",
      color: "#ff9f1c",
      formatValue: (v) => String(v),
      onChange: (val) => onKnobParamChanged("level", val, RHYTHM_KEY_OFFSETS.LEVEL, "drumLevel", "drumLevelVal", String(val))
    });
    const knobPan = new RotaryKnob("knobWrapPan", {
      id: "knobDrumPan",
      min: 0,
      max: 127,
      defaultValue: 64,
      value: 64,
      bipolar: true,
      label: "Pan",
      color: "#ff9f1c",
      formatValue: (v) => panDisplay(v),
      onChange: (val) => onKnobParamChanged("pan", val, RHYTHM_KEY_OFFSETS.PAN, "drumPan", "drumPanVal", panDisplay(val))
    });
    const knobDecay = new RotaryKnob("knobWrapDecay", {
      id: "knobDrumDecay",
      min: 0,
      max: 127,
      defaultValue: 60,
      value: 60,
      label: "Decay",
      color: "#ff9f1c",
      formatValue: (v) => String(v),
      onChange: (val) => onKnobParamChanged("tvaDecay", val, RHYTHM_KEY_OFFSETS.TVA_DECAY, "drumTvaDecay", "drumTvaDecayVal", String(val))
    });
    const knobRelease = new RotaryKnob("knobWrapRelease", {
      id: "knobDrumRelease",
      min: 0,
      max: 127,
      defaultValue: 20,
      value: 20,
      label: "Rel",
      color: "#ff9f1c",
      formatValue: (v) => String(v),
      onChange: (val) => onKnobParamChanged("tvaRelease", val, RHYTHM_KEY_OFFSETS.TVA_RELEASE, "drumTvaRelease", "drumTvaReleaseVal", String(val))
    });
    const knobChorusSend = new RotaryKnob("knobWrapChorusSend", {
      id: "knobDrumChorusSend",
      min: 0,
      max: 127,
      defaultValue: 0,
      value: 0,
      label: "Chorus",
      color: "#a78bfa",
      formatValue: (v) => String(v),
      onChange: (val) => onKnobParamChanged("chorusSend", val, RHYTHM_KEY_OFFSETS.CHORUS_SEND, "drumChorusSend", "drumChorusSendVal", String(val))
    });
    const knobReverbSend = new RotaryKnob("knobWrapReverbSend", {
      id: "knobDrumReverbSend",
      min: 0,
      max: 127,
      defaultValue: 40,
      value: 40,
      label: "Reverb",
      color: "#a78bfa",
      formatValue: (v) => String(v),
      onChange: (val) => onKnobParamChanged("reverbSend", val, RHYTHM_KEY_OFFSETS.REVERB_SEND, "drumReverbSend", "drumReverbSendVal", String(val))
    });
    $("drumCoarseTune")?.addEventListener("input", (e) => knobCoarseTune.setValue(parseInt(e.target.value, 10)));
    $("drumFineTune")?.addEventListener("input", (e) => knobFineTune.setValue(parseInt(e.target.value, 10)));
    $("drumCutoff")?.addEventListener("input", (e) => knobCutoff.setValue(parseInt(e.target.value, 10)));
    $("drumResonance")?.addEventListener("input", (e) => knobResonance.setValue(parseInt(e.target.value, 10)));
    $("drumLevel")?.addEventListener("input", (e) => knobLevel.setValue(parseInt(e.target.value, 10)));
    $("drumPan")?.addEventListener("input", (e) => knobPan.setValue(parseInt(e.target.value, 10)));
    $("drumTvaDecay")?.addEventListener("input", (e) => knobDecay.setValue(parseInt(e.target.value, 10)));
    $("drumTvaRelease")?.addEventListener("input", (e) => knobRelease.setValue(parseInt(e.target.value, 10)));
    $("drumChorusSend")?.addEventListener("input", (e) => knobChorusSend.setValue(parseInt(e.target.value, 10)));
    $("drumReverbSend")?.addEventListener("input", (e) => knobReverbSend.setValue(parseInt(e.target.value, 10)));
    function selectDrumKey(note) {
      currentDrumNote = note;
      const defaultInfo = DRUM_KEY_MAP[note] || { note: `Note ${note}`, name: "Drum Key", category: "Perc", defaultMute: 0 };
      const savedCustom = getCustomDrumHit(note);
      const keyData = drumKeyCache[note] || {};
      const displayName = keyData.customName || savedCustom?.name || defaultInfo.name;
      const displayCat = keyData.category || savedCustom?.category || defaultInfo.category;
      if (selectedNoteBadge) {
        selectedNoteBadge.textContent = `Note ${note}: ${defaultInfo.note} - ${displayName}`;
      }
      if ($("drumHitNameInput")) $("drumHitNameInput").value = displayName;
      if ($("drumHitCatSelect")) $("drumHitCatSelect").value = displayCat;
      document.querySelectorAll(".drum-pad").forEach((p) => {
        p.classList.toggle("selected", parseInt(p.dataset.note, 10) === note);
      });
      const wGrp = keyData.waveGroup ?? 0;
      if ($("drumWaveGroup")) $("drumWaveGroup").value = wGrp;
      populateDrumWaveDropdown();
      if ($("drumWaveNumber")) $("drumWaveNumber").value = keyData.waveNumber ?? 1;
      if ($("drumWaveGain")) $("drumWaveGain").value = keyData.waveGain ?? 1;
      if ($("drumFilterType")) $("drumFilterType").value = keyData.filterType ?? 1;
      if ($("drumMuteGroup")) $("drumMuteGroup").value = keyData.muteGroup ?? defaultInfo.defaultMute ?? 0;
      knobCoarseTune.setValue(keyData.coarseTune ?? 64);
      knobFineTune.setValue(keyData.fineTune ?? 64);
      knobCutoff.setValue(keyData.cutoff ?? 127);
      knobResonance.setValue(keyData.resonance ?? 0);
      knobLevel.setValue(keyData.level ?? 127);
      knobPan.setValue(keyData.pan ?? 64);
      knobDecay.setValue(keyData.tvaDecay ?? 60);
      knobRelease.setValue(keyData.tvaRelease ?? 20);
      knobChorusSend.setValue(keyData.chorusSend ?? 0);
      knobReverbSend.setValue(keyData.reverbSend ?? 40);
      if ($("drumCoarseTune")) $("drumCoarseTune").value = keyData.coarseTune ?? 64;
      if ($("drumFineTune")) $("drumFineTune").value = keyData.fineTune ?? 64;
      if ($("drumCutoff")) $("drumCutoff").value = keyData.cutoff ?? 127;
      if ($("drumResonance")) $("drumResonance").value = keyData.resonance ?? 0;
      if ($("drumLevel")) $("drumLevel").value = keyData.level ?? 127;
      if ($("drumPan")) $("drumPan").value = keyData.pan ?? 64;
      if ($("drumTvaDecay")) $("drumTvaDecay").value = keyData.tvaDecay ?? 60;
      if ($("drumTvaRelease")) $("drumTvaRelease").value = keyData.tvaRelease ?? 20;
      if ($("drumChorusSend")) $("drumChorusSend").value = keyData.chorusSend ?? 0;
      if ($("drumReverbSend")) $("drumReverbSend").value = keyData.reverbSend ?? 40;
      if ($("drumCoarseTuneVal")) $("drumCoarseTuneVal").textContent = formatKeyNote(keyData.coarseTune ?? 64);
      if ($("drumFineTuneVal")) $("drumFineTuneVal").textContent = `${(keyData.fineTune ?? 64) - 64}`;
      if ($("drumCutoffVal")) $("drumCutoffVal").textContent = keyData.cutoff ?? 127;
      if ($("drumResonanceVal")) $("drumResonanceVal").textContent = keyData.resonance ?? 0;
      if ($("drumLevelVal")) $("drumLevelVal").textContent = keyData.level ?? 127;
      if ($("drumPanVal")) $("drumPanVal").textContent = panDisplay(keyData.pan ?? 64);
      if ($("drumTvaDecayVal")) $("drumTvaDecayVal").textContent = keyData.tvaDecay ?? 60;
      if ($("drumTvaReleaseVal")) $("drumTvaReleaseVal").textContent = keyData.tvaRelease ?? 20;
      if ($("drumChorusSendVal")) $("drumChorusSendVal").textContent = keyData.chorusSend ?? 0;
      if ($("drumReverbSendVal")) $("drumReverbSendVal").textContent = keyData.reverbSend ?? 40;
    }
    function renderDrumOctave(octave) {
      currentDrumOctave = octave;
      const bank = DRUM_OCTAVES.find((b) => b.octave === octave) || DRUM_OCTAVES[0];
      if (octaveBadge) octaveBadge.textContent = bank.label;
      document.querySelectorAll(".drum-octave-btn").forEach((btn) => {
        btn.classList.toggle("active", parseInt(btn.dataset.octave, 10) === octave);
      });
      if (!padContainer) return;
      padContainer.innerHTML = "";
      bank.notes.forEach((note) => {
        const defaultInfo = DRUM_KEY_MAP[note] || { note: `N${note}`, name: `Drum ${note}`, category: "Perc", defaultMute: 0 };
        const savedCustom = getCustomDrumHit(note);
        const keyData = drumKeyCache[note] || {};
        const displayName = keyData.customName || savedCustom?.name || defaultInfo.name;
        const displayCat = keyData.category || savedCustom?.category || defaultInfo.category;
        const muteGrp = keyData.muteGroup ?? defaultInfo.defaultMute ?? 0;
        const pad = document.createElement("div");
        pad.className = `drum-pad ${note === currentDrumNote ? "selected" : ""}`;
        pad.dataset.note = note;
        pad.innerHTML = `
        <div class="drum-pad-header">
          <span class="drum-pad-note">${defaultInfo.note}</span>
          <div style="display:flex; align-items:center;">
            <span class="drum-pad-cat">${displayCat}</span>
            ${muteGrp > 0 ? `<span class="drum-pad-mute">M${muteGrp}</span>` : ""}
          </div>
        </div>
        <div class="drum-pad-title" title="${displayName}">${displayName}</div>
      `;
        pad.addEventListener("pointerdown", () => {
          auditionDrumNote(note);
          selectDrumKey(note);
          pad.classList.add("triggered");
          setTimeout(() => pad.classList.remove("triggered"), 180);
        });
        padContainer.appendChild(pad);
      });
    }
    $("drumHitNameInput")?.addEventListener("input", (e) => {
      const val = e.target.value.trim();
      if (!drumKeyCache[currentDrumNote]) drumKeyCache[currentDrumNote] = {};
      drumKeyCache[currentDrumNote].customName = val;
      saveCustomDrumHit(currentDrumNote, val, drumKeyCache[currentDrumNote].category);
      const info = DRUM_KEY_MAP[currentDrumNote] || { note: `N${currentDrumNote}`, name: "Hit" };
      const pad = padContainer?.querySelector(`.drum-pad[data-note="${currentDrumNote}"]`);
      if (pad) {
        const titleEl = pad.querySelector(".drum-pad-title");
        if (titleEl) titleEl.textContent = val || info.name;
      }
      if (selectedNoteBadge) {
        selectedNoteBadge.textContent = `Note ${currentDrumNote}: ${info.note} - ${val || info.name}`;
      }
    });
    $("drumHitCatSelect")?.addEventListener("change", (e) => {
      const cat = e.target.value;
      if (!drumKeyCache[currentDrumNote]) drumKeyCache[currentDrumNote] = {};
      drumKeyCache[currentDrumNote].category = cat;
      saveCustomDrumHit(currentDrumNote, drumKeyCache[currentDrumNote].customName, cat);
      const pad = padContainer?.querySelector(`.drum-pad[data-note="${currentDrumNote}"]`);
      if (pad) {
        const catEl = pad.querySelector(".drum-pad-cat");
        if (catEl) catEl.textContent = cat;
      }
    });
    $("btnResetDrumHit")?.addEventListener("click", () => {
      const defaultInfo = DRUM_KEY_MAP[currentDrumNote];
      if (!defaultInfo) return;
      deleteCustomDrumHit(currentDrumNote);
      drumKeyCache[currentDrumNote] = {
        customName: defaultInfo.name,
        category: defaultInfo.category,
        muteGroup: defaultInfo.defaultMute ?? 0,
        coarseTune: 64,
        fineTune: 64,
        filterType: 1,
        cutoff: 127,
        resonance: 0,
        level: 127,
        pan: 64,
        tvaDecay: 60,
        tvaRelease: 20,
        chorusSend: 0,
        reverbSend: 40
      };
      selectDrumKey(currentDrumNote);
      renderDrumOctave(currentDrumOctave);
      auditionDrumNote(currentDrumNote);
      setStatus(`Reset Note ${currentDrumNote} (${defaultInfo.note}) to factory default`);
    });
    $("btnRenameDrumKit")?.addEventListener("click", () => {
      const kitSel2 = $("drumKitSelect");
      if (!kitSel2) return;
      const curOpt = kitSel2.selectedOptions[0];
      const oldName = curOpt ? curOpt.textContent : "Drum Kit";
      const newName = prompt("Enter custom name for this drum kit:", oldName);
      if (newName && newName.trim()) {
        curOpt.textContent = newName.trim();
        const customKits = JSON.parse(localStorage.getItem(DRUM_CUSTOM_KITS_KEY) || "{}");
        customKits[kitSel2.value] = newName.trim();
        try {
          localStorage.setItem(DRUM_CUSTOM_KITS_KEY, JSON.stringify(customKits));
        } catch (_) {
        }
        setStatus(`Renamed drum kit to "${newName.trim()}"`);
      }
    });
    function applyDrumHitPresetToKey(note, preset) {
      if (!drumKeyCache[note]) drumKeyCache[note] = {};
      const keyData = drumKeyCache[note];
      keyData.customName = preset.name;
      keyData.category = preset.category;
      keyData.waveGroup = preset.waveGroup ?? 0;
      keyData.waveNumber = preset.waveNumber ?? 1;
      keyData.coarseTune = preset.coarseTune ?? 64;
      keyData.fineTune = preset.fineTune ?? 64;
      keyData.filterType = preset.filterType ?? 1;
      keyData.cutoff = preset.cutoff ?? 127;
      keyData.resonance = preset.resonance ?? 0;
      keyData.level = preset.level ?? 127;
      keyData.pan = preset.pan ?? 64;
      keyData.muteGroup = preset.muteGroup ?? 0;
      keyData.tvaDecay = preset.tvaDecay ?? 60;
      keyData.tvaRelease = preset.tvaRelease ?? 20;
      keyData.chorusSend = preset.chorusSend ?? 0;
      keyData.reverbSend = preset.reverbSend ?? 40;
      saveCustomDrumHit(note, preset.name, preset.category);
      selectDrumKey(note);
      renderDrumOctave(currentDrumOctave);
      if (midi.isConnected) {
        const isPerf = currentSoundMode === 2;
        const rolandGrp = keyData.waveGroup >= 2 ? 2 : keyData.waveGroup;
        sendRhythmKeyParam(midi, note, RHYTHM_KEY_OFFSETS.WAVE_GROUP, rolandGrp, isPerf);
        sendRhythmKeyParam(midi, note, RHYTHM_KEY_OFFSETS.WAVE_NUMBER_L, encodeWaveNibbles(keyData.waveNumber), isPerf);
        sendRhythmKeyParam(midi, note, RHYTHM_KEY_OFFSETS.COARSE_TUNE, keyData.coarseTune, isPerf);
        sendRhythmKeyParam(midi, note, RHYTHM_KEY_OFFSETS.FINE_TUNE, keyData.fineTune, isPerf);
        sendRhythmKeyParam(midi, note, RHYTHM_KEY_OFFSETS.TVF_TYPE, keyData.filterType, isPerf);
        sendRhythmKeyParam(midi, note, RHYTHM_KEY_OFFSETS.TVF_CUTOFF, keyData.cutoff, isPerf);
        sendRhythmKeyParam(midi, note, RHYTHM_KEY_OFFSETS.TVF_RESONANCE, keyData.resonance, isPerf);
        sendRhythmKeyParam(midi, note, RHYTHM_KEY_OFFSETS.LEVEL, keyData.level, isPerf);
        sendRhythmKeyParam(midi, note, RHYTHM_KEY_OFFSETS.PAN, keyData.pan, isPerf);
        sendRhythmKeyParam(midi, note, RHYTHM_KEY_OFFSETS.MUTE_GROUP, keyData.muteGroup, isPerf);
        sendRhythmKeyParam(midi, note, RHYTHM_KEY_OFFSETS.TVA_DECAY, keyData.tvaDecay, isPerf);
        sendRhythmKeyParam(midi, note, RHYTHM_KEY_OFFSETS.TVA_RELEASE, keyData.tvaRelease, isPerf);
        sendRhythmKeyParam(midi, note, RHYTHM_KEY_OFFSETS.CHORUS_SEND, keyData.chorusSend, isPerf);
        sendRhythmKeyParam(midi, note, RHYTHM_KEY_OFFSETS.REVERB_SEND, keyData.reverbSend, isPerf);
      }
    }
    $("drumHitLibrarySelect")?.addEventListener("change", (e) => {
      const hitId = e.target.value;
      if (!hitId) return;
      let preset = DRUM_HIT_LIBRARY.find((h) => h.id === hitId);
      if (!preset && hitId.startsWith("srx_hit:")) {
        const parts = hitId.split(":");
        const slot = parts[1];
        const boardId = parts[2];
        const waveIdx = parseInt(parts[3], 10);
        const wName = parts[4] || `${boardId} Hit`;
        const isKick = /kick|bd/i.test(wName);
        const isSnare = /snare|sn|rim|clap/i.test(wName);
        const isHat = /hat|hh/i.test(wName);
        const isTom = /tom/i.test(wName);
        const isCymbal = /crash|ride|cymbal/i.test(wName);
        const cat = isKick ? "Kick" : isSnare ? "Snare" : isHat ? "Hi-Hat" : isTom ? "Tom" : isCymbal ? "Cymbal" : "Perc";
        preset = {
          name: wName,
          category: cat,
          waveGroup: slot === "B" ? 3 : 2,
          waveNumber: waveIdx,
          coarseTune: 64,
          fineTune: 64,
          filterType: 1,
          cutoff: 127,
          resonance: 0,
          level: 127,
          pan: 64,
          muteGroup: isHat ? 1 : 0,
          tvaDecay: isHat ? 45 : isKick ? 65 : 70,
          tvaRelease: 20,
          chorusSend: 0,
          reverbSend: 35
        };
      }
      if (preset) {
        applyDrumHitPresetToKey(currentDrumNote, preset);
        auditionDrumNote(currentDrumNote);
        setStatus(`Loaded Library Hit "${preset.name}" onto Note ${currentDrumNote}`);
      }
      e.target.value = "";
    });
    renderDrumOctave(1);
    selectDrumKey(36);
    $("btnPrevDrumOctave")?.addEventListener("click", () => {
      if (currentDrumOctave > 1) renderDrumOctave(currentDrumOctave - 1);
    });
    $("btnNextDrumOctave")?.addEventListener("click", () => {
      if (currentDrumOctave < 5) renderDrumOctave(currentDrumOctave + 1);
    });
    document.querySelectorAll(".drum-octave-btn").forEach((btn) => {
      btn.addEventListener("click", () => {
        const oct = parseInt(btn.dataset.octave, 10);
        if (oct) renderDrumOctave(oct);
      });
    });
    $("btnAuditionSelectedDrum")?.addEventListener("click", () => auditionDrumNote(currentDrumNote));
    $("btnAuditionCurrentKey")?.addEventListener("click", () => auditionDrumNote(currentDrumNote));
    $("btnDrumBackToMixer")?.addEventListener("click", () => {
      switchToTab("performance");
      const row = $("partRow10");
      if (row) {
        row.scrollIntoView({ behavior: "smooth", block: "center" });
        row.classList.add("selected");
      }
    });
    $("drumWaveGroup")?.addEventListener("change", (e) => {
      const val = parseInt(e.target.value, 10);
      populateDrumWaveDropdown();
      if (!drumKeyCache[currentDrumNote]) drumKeyCache[currentDrumNote] = {};
      drumKeyCache[currentDrumNote].waveGroup = val;
      if (midi.isConnected) {
        const rolandGroup = val >= 2 ? 2 : val;
        sendRhythmKeyParam(midi, currentDrumNote, RHYTHM_KEY_OFFSETS.WAVE_GROUP, rolandGroup, currentSoundMode === 2);
      }
    });
    $("drumWaveNumber")?.addEventListener("change", (e) => {
      const waveNum = parseInt(e.target.value, 10);
      if (!drumKeyCache[currentDrumNote]) drumKeyCache[currentDrumNote] = {};
      drumKeyCache[currentDrumNote].waveNumber = waveNum;
      if (midi.isConnected) {
        sendRhythmKeyParam(midi, currentDrumNote, RHYTHM_KEY_OFFSETS.WAVE_NUMBER_L, encodeWaveNibbles(waveNum), currentSoundMode === 2);
      }
      auditionDrumNote(currentDrumNote);
    });
    $("drumMuteGroup")?.addEventListener("change", (e) => {
      const val = parseInt(e.target.value, 10);
      if (!drumKeyCache[currentDrumNote]) drumKeyCache[currentDrumNote] = {};
      drumKeyCache[currentDrumNote].muteGroup = val;
      renderDrumOctave(currentDrumOctave);
      if (midi.isConnected) {
        sendRhythmKeyParam(midi, currentDrumNote, RHYTHM_KEY_OFFSETS.MUTE_GROUP, val, currentSoundMode === 2);
      }
    });
    $("drumFilterType")?.addEventListener("change", (e) => {
      const val = parseInt(e.target.value, 10);
      if (!drumKeyCache[currentDrumNote]) drumKeyCache[currentDrumNote] = {};
      drumKeyCache[currentDrumNote].filterType = val;
      if (midi.isConnected) {
        sendRhythmKeyParam(midi, currentDrumNote, RHYTHM_KEY_OFFSETS.TVF_TYPE, val, currentSoundMode === 2);
      }
    });
    $("drumWaveGain")?.addEventListener("change", (e) => {
      const val = parseInt(e.target.value, 10);
      if (!drumKeyCache[currentDrumNote]) drumKeyCache[currentDrumNote] = {};
      drumKeyCache[currentDrumNote].waveGain = val;
      if (midi.isConnected) {
        sendRhythmKeyParam(midi, currentDrumNote, RHYTHM_KEY_OFFSETS.WAVE_GAIN, val, currentSoundMode === 2);
      }
    });
  }
  function attachSelectSteppers(selectElOrId) {
    const selectEl = typeof selectElOrId === "string" ? $(selectElOrId) : selectElOrId;
    if (!selectEl) return;
    if (selectEl.parentElement?.classList.contains("stepper-select-wrap")) return;
    const wrap = document.createElement("div");
    wrap.className = "stepper-select-wrap";
    const btnPrev = document.createElement("button");
    btnPrev.type = "button";
    btnPrev.className = "btn-step btn-step-prev";
    btnPrev.innerHTML = "\u2039";
    btnPrev.title = "Previous item";
    const btnNext = document.createElement("button");
    btnNext.type = "button";
    btnNext.className = "btn-step btn-step-next";
    btnNext.innerHTML = "\u203A";
    btnNext.title = "Next item";
    selectEl.parentNode.insertBefore(wrap, selectEl);
    wrap.appendChild(btnPrev);
    wrap.appendChild(selectEl);
    wrap.appendChild(btnNext);
    function step(delta) {
      const opts = Array.from(selectEl.options).filter((o) => !o.disabled && o.value !== "");
      if (!opts.length) return;
      const curIdx = opts.findIndex((o) => o.value === selectEl.value);
      let nextIdx = curIdx === -1 ? delta > 0 ? 0 : opts.length - 1 : curIdx + delta;
      if (nextIdx < 0) nextIdx = 0;
      if (nextIdx >= opts.length) nextIdx = opts.length - 1;
      if (nextIdx !== curIdx) {
        selectEl.value = opts[nextIdx].value;
        selectEl.dispatchEvent(new Event("change", { bubbles: true }));
      }
    }
    btnPrev.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();
      step(-1);
    });
    btnNext.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();
      step(1);
    });
  }
  function init() {
    buildPartsTable();
    initTabs();
    initEditTracking();
    bindPerformanceCommonControls();
    bindPerfMfxControls();
    bindPatchControls();
    bindPatchEffectsControls();
    initHardwareRotaryKnobs();
    initLibrarianControls();
    initVstTranspiler();
    initSrxSlots();
    initScaleTuneControls();
    initDeepStudio();
    initDrumKitEditor();
    document.querySelectorAll("#btnDeepSyncHardware").forEach((btn) => {
      btn.addEventListener("click", () => {
        autoSyncActivePatchFromHardware(getEffectivePatchPart());
      });
    });
    const btnDeepStd = $("btnDeepSwitchToStandard");
    if (btnDeepStd) {
      btnDeepStd.addEventListener("click", () => {
        switchToTab("patch");
      });
    }
    $("connectBtn").addEventListener("click", connectMidi);
    $("refreshBtn").addEventListener("click", refreshDeviceList);
    $("panicBtn").addEventListener("click", handlePanic);
    $("auditionBtn").addEventListener("click", handleAudition);
    $("clearLogBtn").addEventListener("click", clearLog);
    const dawSelect = $("midiDawThru");
    if (dawSelect) {
      dawSelect.addEventListener("change", async (e) => {
        const val = e.target.value;
        localStorage.setItem("xv5050_daw_thru", val);
        if (midi.isConnected) {
          await midi.setDawThruInput(val);
          if (val) {
            setStatus(`DAW Thru route active: forwarding ${midi.dawInputName} -> XV-5050`);
          } else {
            setStatus("DAW Thru route disabled");
          }
        }
      });
    }
    $("midiInput")?.addEventListener("change", (e) => {
      if (e.target.value) localStorage.setItem("xv5050_midi_input", e.target.value);
    });
    $("midiOutput")?.addEventListener("change", (e) => {
      if (e.target.value) localStorage.setItem("xv5050_midi_output", e.target.value);
    });
    const chkAutoRelease = $("chkAutoReleaseMidi");
    let autoReleaseEnabled = localStorage.getItem("xv5050_auto_release_midi") === "true";
    if (chkAutoRelease) {
      chkAutoRelease.checked = autoReleaseEnabled;
      chkAutoRelease.addEventListener("change", (e) => {
        autoReleaseEnabled = e.target.checked;
        localStorage.setItem("xv5050_auto_release_midi", autoReleaseEnabled ? "true" : "false");
        setStatus(autoReleaseEnabled ? "Auto-Release enabled: Driver will release when switching to Renoise/other apps" : "Auto-Release disabled: Driver stays locked until Disconnect is clicked");
      });
    }
    let wasConnectedBeforeBlur = false;
    let blurReleaseTimeout = null;
    window.addEventListener("blur", () => {
      if (autoReleaseEnabled && midi.isConnected) {
        if (blurReleaseTimeout) clearTimeout(blurReleaseTimeout);
        blurReleaseTimeout = setTimeout(async () => {
          if (!document.hasFocus() && autoReleaseEnabled && midi.isConnected) {
            wasConnectedBeforeBlur = true;
            await midi.disconnect();
            setConnectionStatus(false);
            const btn = $("connectBtn");
            if (btn) btn.textContent = "Connect";
            setStatus("MIDI driver released (switched to Renoise / background app)");
          }
        }, 1500);
      }
    });
    window.addEventListener("focus", async () => {
      if (blurReleaseTimeout) {
        clearTimeout(blurReleaseTimeout);
        blurReleaseTimeout = null;
      }
      if (autoReleaseEnabled && wasConnectedBeforeBlur && !midi.isConnected) {
        wasConnectedBeforeBlur = false;
        const inId = $("midiInput")?.value;
        const outId = $("midiOutput")?.value;
        if (inId && outId) {
          setStatus("Re-acquiring MIDI driver for XV-5050...");
          const ok = await midi.connect(inId, outId);
          if (ok) {
            setConnectionStatus(true, `${midi.inputName}`);
            const btn = $("connectBtn");
            if (btn) btn.textContent = "Disconnect";
            setStatus("Re-connected to XV-5050");
            midi.onSysEx(handleIncomingSysEx);
            const dawThruId = $("midiDawThru")?.value;
            if (dawThruId) await midi.setDawThruInput(dawThruId);
          }
        }
      }
    });
    const btnModePerform = $("modeBtnPerform");
    if (btnModePerform) {
      btnModePerform.addEventListener("click", () => setSynthesizerMode(2, true));
    }
    const btnModePatch = $("modeBtnPatch");
    if (btnModePatch) {
      btnModePatch.addEventListener("click", () => {
        setSynthesizerMode(1, true);
        switchToTab("patch");
      });
    }
    const btnToggleDrawer = $("btnToggleSystemDrawer");
    if (btnToggleDrawer) {
      btnToggleDrawer.addEventListener("click", () => toggleSystemDrawer());
    }
    const btnCloseDrawer = $("btnCloseSystemDrawer");
    if (btnCloseDrawer) {
      btnCloseDrawer.addEventListener("click", () => toggleSystemDrawer(false));
    }
    const syncBtn = $("syncWithUnitBtn");
    if (syncBtn) syncBtn.addEventListener("click", handleSyncWithUnit);
    const cancelSync = $("cancelSyncBtn");
    if (cancelSync) cancelSync.addEventListener("click", () => {
      $("confirmSyncModal").style.display = "none";
    });
    const proceedSync = $("proceedSyncBtn");
    if (proceedSync) proceedSync.addEventListener("click", executeSyncWithUnit);
    const entirePerfBtn = $("loadEntirePerfBtn");
    if (entirePerfBtn) entirePerfBtn.addEventListener("click", loadEntirePerformanceData);
    $("loadPerfBtn").addEventListener("click", loadPerformanceCommon);
    $("loadPerfFxBtn").addEventListener("click", loadPerformanceFx);
    $("loadAllPartsBtn").addEventListener("click", loadAllPartsData);
    const userPerfSelect = $("userPerfSelect");
    if (userPerfSelect) {
      userPerfSelect.addEventListener("change", (e) => {
        const val = e.target.value;
        if (val) window.loadSyncedUserPerf(val);
      });
    }
    const userPatchSelect = $("userPatchSelect");
    if (userPatchSelect) {
      userPatchSelect.addEventListener("change", (e) => {
        const val = parseInt(e.target.value, 10);
        if (val) window.loadSyncedUserPatch(val);
      });
    }
    const patchPartSelect = $("patchPartSelect");
    if (patchPartSelect) {
      patchPartSelect.addEventListener("change", () => {
        const part = parseInt(patchPartSelect.value, 10);
        selectPart(part);
      });
    }
    const patchInstSelect = $("patchInstrumentSelect");
    if (patchInstSelect) {
      patchInstSelect.addEventListener("change", (e) => {
        const activePart = getEffectivePatchPart() || 1;
        handleInstrumentSelection(activePart, e.target.value);
      });
    }
    const btnBackMixer = $("btnBackToPerfMixer");
    if (btnBackMixer) {
      btnBackMixer.addEventListener("click", () => {
        switchToTab("performance");
        const activePart = getEffectivePatchPart() || 1;
        const row = $(`partRow${activePart}`);
        if (row) {
          row.scrollIntoView({ behavior: "smooth", block: "center" });
          row.classList.add("selected");
        }
      });
    }
    const btnSoloToggle = $("btnSoloModeToggle");
    if (btnSoloToggle) {
      btnSoloToggle.addEventListener("click", () => {
        if (currentSoundMode === 1) {
          setSynthesizerMode(2, true);
          selectPart(1);
        } else {
          setSynthesizerMode(1, true);
          selectPart(0);
        }
      });
    }
    const btnExportFullBackup = $("btnExportFullBackupSyx");
    if (btnExportFullBackup) {
      btnExportFullBackup.addEventListener("click", () => {
        if (!syncedUnitDb) {
          setStatus('Please click "Sync with Unit" first to dump the unit data before exporting full backup.');
          return;
        }
        const bytes = exportFullUnitBackup(syncedUnitDb, getDeviceId());
        const blob = new Blob([bytes], { type: "application/octet-stream" });
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = `XV5050_Full_Unit_Backup_${(/* @__PURE__ */ new Date()).toISOString().slice(0, 10)}.syx`;
        a.click();
        URL.revokeObjectURL(url);
        setStatus(`Downloaded full unit backup (${bytes.length} bytes, 64 User Perfs, 128 User Patches)`);
      });
    }
    const btnInvPerfs = $("btnInvPerfs");
    const btnInvPatches = $("btnInvPatches");
    const invPerfsPane = $("invPerfsPane");
    const invPatchesPane = $("invPatchesPane");
    if (btnInvPerfs && btnInvPatches && invPerfsPane && invPatchesPane) {
      btnInvPerfs.addEventListener("click", () => {
        btnInvPerfs.classList.add("active");
        btnInvPatches.classList.remove("active");
        invPerfsPane.style.display = "block";
        invPatchesPane.style.display = "none";
      });
      btnInvPatches.addEventListener("click", () => {
        btnInvPatches.classList.add("active");
        btnInvPerfs.classList.remove("active");
        invPerfsPane.style.display = "none";
        invPatchesPane.style.display = "block";
      });
    }
    const perfSearchInput = $("perfSearchInput");
    if (perfSearchInput) {
      perfSearchInput.addEventListener("input", (e) => renderUserPerfsTable(e.target.value));
    }
    const patchSearchInput = $("patchSearchInput");
    if (patchSearchInput) {
      patchSearchInput.addEventListener("input", (e) => renderUserPatchesTable(e.target.value));
    }
    const refreshInvBtn = $("refreshInventoryBtn");
    if (refreshInvBtn) {
      refreshInvBtn.addEventListener("click", handleSyncWithUnit);
    }
    const btnAutoDetect = $("btnAutoDetectId");
    if (btnAutoDetect) {
      btnAutoDetect.addEventListener("click", handleAutoDetectId);
    }
    const btnRunDiag = $("btnRunDiagnostics");
    if (btnRunDiag) {
      btnRunDiag.addEventListener("click", executeHardwareDiagnostics);
    }
    const runDiagAgain = $("runDiagAgainBtn");
    if (runDiagAgain) {
      runDiagAgain.addEventListener("click", executeHardwareDiagnostics);
    }
    const closeDiag = $("closeDiagBtn");
    if (closeDiag) {
      closeDiag.addEventListener("click", () => {
        const modal = $("diagnosticsModal");
        if (modal) modal.style.display = "none";
      });
    }
    const btnWritePerf = $("btnWritePerfSlot");
    if (btnWritePerf) {
      btnWritePerf.addEventListener("click", () => openWriteSlotModal("performance"));
    }
    const btnWritePatch = $("btnWritePatchSlot");
    if (btnWritePatch) {
      btnWritePatch.addEventListener("click", () => openWriteSlotModal("patch"));
    }
    const cancelWriteSlot = $("cancelWriteSlotBtn");
    if (cancelWriteSlot) {
      cancelWriteSlot.addEventListener("click", () => {
        const modal = $("writeSlotModal");
        if (modal) modal.style.display = "none";
      });
    }
    const confirmWriteSlot = $("confirmWriteSlotBtn");
    if (confirmWriteSlot) {
      confirmWriteSlot.addEventListener("click", handleConfirmWriteSlot);
    }
    midi.onStateChange((info) => {
      if (info.state === "disconnected" && !midi.isConnected) {
        setConnectionStatus(false);
        $("connectBtn").textContent = "Connect";
        setStatus(`Device disconnected: ${info.name}`);
      }
      refreshDeviceList();
    });
    initThemeManager();
    initMidi();
    renderPartNavigationStrip();
    populateAllInstrumentSelectors();
    restoreSyncedDbFromStorage();
    const steppers = [
      "waveGroup",
      "waveNumberL",
      "waveNumberR",
      "waveGain",
      "waveFxmColor",
      "toneFilterType",
      "patchInstrumentSelect",
      "userPerfSelect",
      "userPatchSelect",
      "drumKitSelect",
      "perfMfxType",
      "patchMfxType"
    ];
    steppers.forEach((id) => attachSelectSteppers(id));
    initInteractiveEnvelopes();
    redrawAllCurves();
  }
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
