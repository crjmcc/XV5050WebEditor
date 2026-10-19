/**
 * Web MIDI Connection Manager
 * 
 * Handles Web MIDI API access, device discovery, connection management,
 * and SysEx message routing for the XV-5050.
 * 
 * This module works entirely client-side using the browser's Web MIDI API.
 */

import { parseSysEx, formatSysEx } from './sysex.js';

/**
 * @typedef {object} MidiDevice
 * @property {string} id - Unique device identifier
 * @property {string} name - Device display name
 * @property {string} manufacturer - Manufacturer name
 */

/**
 * MIDI connection manager.
 * Wraps the Web MIDI API with event-driven callbacks and SysEx support.
 */
export class MidiManager {
  constructor() {
    /** @type {MIDIAccess|null} */
    this._midiAccess = null;

    /** @type {MIDIInput|null} */
    this._input = null;

    /** @type {MIDIOutput|null} */
    this._output = null;

    /** @type {Function|null} */
    this._onMessage = null;

    /** @type {Function|null} */
    this._onStateChange = null;

    /** @type {boolean} */
    this._connected = false;

    // Traffic listener for SysEx monitor
    this._onTraffic = null;

    // Bind the internal listener so we can add/remove it
    this._handleMidiMessage = this._handleMidiMessage.bind(this);
    this._handleStateChange = this._handleStateChange.bind(this);
  }

  /**
   * Request Web MIDI access from the browser with SysEx support.
   * @returns {Promise<boolean>} True if access granted, false otherwise.
   */
  async requestAccess() {
    if (typeof navigator === 'undefined' || !navigator.requestMIDIAccess) {
      console.warn('Web MIDI API is not supported in this environment.');
      return false;
    }
    try {
      this._midiAccess = await navigator.requestMIDIAccess({ sysex: true });
      this._midiAccess.onstatechange = this._handleStateChange;
      return true;
    } catch (err) {
      console.error('Failed to get Web MIDI access:', err);
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
        manufacturer: input.manufacturer || '',
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
        manufacturer: output.manufacturer || '',
      });
    }
    return devices;
  }

  /**
   * Connect to specified input and output MIDI ports.
   * @param {string} inputId
   * @param {string} outputId
   * @returns {boolean} True if successfully connected
   */
  async connect(inputId, outputId) {
    if (!this._midiAccess) return false;

    await this.disconnect();

    const input = this._midiAccess.inputs.get(inputId);
    const output = this._midiAccess.outputs.get(outputId);

    if (!input || !output) {
      console.error('Specified MIDI input or output device not found');
      return false;
    }

    try {
      if (input.open) await input.open();
      if (output.open) await output.open();
    } catch (err) {
      console.warn('Port open warning:', err);
    }

    this._input = input;
    this._output = output;
    this._input.onmidimessage = this._handleMidiMessage;
    this._connected = true;

    // Send warm-up identity request ping to wake USB MIDI stream endpoint
    try {
      this.sendRaw([0xF0, 0x7E, 0x7F, 0x06, 0x01, 0xF7]);
    } catch (_) {}

    return true;
  }

  /**
   * Disconnect current MIDI input and output ports.
   */
  async disconnect() {
    if (this._input) {
      this._input.onmidimessage = null;
      try { if (this._input.close) await this._input.close(); } catch (_) {}
      this._input = null;
    }
    if (this._output) {
      try { if (this._output.close) await this._output.close(); } catch (_) {}
      this._output = null;
    }
    this._connected = false;
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
      console.error('No MIDI output connected');
      return;
    }
    const uint8 = (message instanceof Uint8Array) ? message : new Uint8Array(message);
    const arr = Array.from(uint8);
    if (this._onTraffic) {
      this._onTraffic('TX', arr, Date.now());
    }
    try {
      this._output.send(uint8);
    } catch (err) {
      console.warn('Output send failed with Uint8Array, falling back to array:', err);
      this._output.send(arr);
    }
  }

  /**
   * Send raw MIDI bytes (e.g. Channel Voice messages).
   * @param {number[]} bytes - Raw MIDI message bytes
   */
  sendRaw(bytes) {
    if (!this._output) return;
    if (this._onTraffic) {
      this._onTraffic('TX', bytes, Date.now());
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
    this.sendRaw([0x90 | (channel & 0x0F), note & 0x7F, velocity & 0x7F]);
  }

  /**
   * Send Note Off.
   * @param {number} channel - 0-15
   * @param {number} note - Note number (0-127)
   */
  sendNoteOff(channel, note = 60) {
    this.sendRaw([0x80 | (channel & 0x0F), note & 0x7F, 0]);
  }

  /**
   * Send All Notes Off & Reset Controllers (Panic) on all channels or specific channel.
   * @param {number} [channel] - Optional specific channel (0-15)
   */
  sendAllNotesOff(channel) {
    const channels = (channel !== undefined && channel >= 0 && channel <= 15)
      ? [channel]
      : Array.from({ length: 16 }, (_, i) => i);

    for (const ch of channels) {
      this.sendRaw([0xB0 | ch, 120, 0]); // All Sound Off
      this.sendRaw([0xB0 | ch, 123, 0]); // All Notes Off
      this.sendRaw([0xB0 | ch, 121, 0]); // Reset All Controllers
    }
  }

  /**
   * Send a SysEx message and wait for the complete response within a timeout.
   * Handles multi-packet SysEx responses (e.g. Tone 265 bytes, MFX 273 bytes)
   * where the hardware sends successive DT1 packets up to 256 bytes each.
   * 
   * @param {Uint8Array|number[]} message - SysEx message to send
   * @param {number} [timeout=3000] - Timeout in milliseconds
   * @returns {Promise<object>} Complete parsed SysEx response
   */
  sendAndReceive(message, timeout = 3000) {
    if (this._midiAccess && !this._midiAccess.sysexEnabled) {
      return Promise.reject(new Error(
        'SysEx permission is blocked by browser! If opened via file://, run "npm start" and open http://localhost:3000 to enable SysEx.'
      ));
    }

    return new Promise((resolve, reject) => {
      // Check if message is an RQ1 data request
      const isRq1 = message && message[0] === 0xF0 && message[5] === 0x11 && message.length >= 14;
      let reqAddr = null;
      let expectedSize = 0;
      let accumulatedData = [];
      let bytesReceived = 0;

      if (isRq1) {
        reqAddr = [message[6], message[7], message[8], message[9]];
        // XV-5050 7-bit size arithmetic: [b0, b1, b2, b3] -> (b0 * 128^3) + (b1 * 128^2) + (b2 * 128) + b3
        expectedSize = (message[10] * 2097152) + (message[11] * 16384) + (message[12] * 128) + message[13];
        accumulatedData = new Array(expectedSize).fill(0);
      }

      const reqAddrInt = reqAddr ? ((reqAddr[0] * 2097152) + (reqAddr[1] * 16384) + (reqAddr[2] * 128) + reqAddr[3]) : 0;

      const previousHandler = this._onMessage;
      let timer = null;

      const cleanup = () => {
        if (timer) clearTimeout(timer);
        this._onMessage = previousHandler;
      };

      timer = setTimeout(() => {
        cleanup();
        reject(new Error(`SysEx response timeout (received ${bytesReceived}/${expectedSize || '?'} bytes)`));
      }, timeout);

      this._onMessage = (parsed) => {
        // Also notify previous handler (e.g. monitor) so UI traffic/state updates
        if (previousHandler) {
          try { previousHandler(parsed); } catch (_) {}
        }

        if (!parsed || !parsed.valid) return;

        // If not an RQ1 request, resolve on first valid SysEx response
        if (!isRq1 || expectedSize === 0) {
          cleanup();
          resolve(parsed);
          return;
        }

        // For RQ1 requests, verify this DT1 response matches the requested address range
        if (parsed.command === 0x12 && parsed.address && parsed.data) {
          const inAddrInt = (parsed.address[0] * 2097152) + (parsed.address[1] * 16384) + (parsed.address[2] * 128) + parsed.address[3];
          const offset = inAddrInt - reqAddrInt;

          // Check if packet falls within the expected address window [0, expectedSize)
          if (offset >= 0 && offset < expectedSize) {
            for (let i = 0; i < parsed.data.length && (offset + i) < expectedSize; i++) {
              accumulatedData[offset + i] = parsed.data[i];
            }
            bytesReceived += parsed.data.length;

            // If we've received all expected bytes, complete!
            if (bytesReceived >= expectedSize || (offset + parsed.data.length) >= expectedSize) {
              cleanup();
              resolve({
                valid: true,
                command: 0x12,
                address: reqAddr,
                data: accumulatedData,
                deviceId: parsed.deviceId,
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

    if (this._onTraffic) {
      this._onTraffic('RX', Array.from(data), Date.now());
    }

    // Reassemble fragmented SysEx chunks if delivered in pieces
    if (!this._sysexBuffer && data[0] === 0xF0) {
      if (data[data.length - 1] === 0xF7) {
        // Complete SysEx in single event
        this._dispatchSysEx(data);
        return;
      }
      // Start of multi-chunk SysEx
      this._sysexBuffer = Array.from(data);
      return;
    }

    if (this._sysexBuffer) {
      for (let i = 0; i < data.length; i++) {
        this._sysexBuffer.push(data[i]);
        if (data[i] === 0xF7) {
          const complete = new Uint8Array(this._sysexBuffer);
          this._sysexBuffer = null;
          this._dispatchSysEx(complete);
          return;
        }
      }
      return;
    }

    // Single message complete check
    if (data[0] === 0xF0) {
      this._dispatchSysEx(data);
    }
  }

  _dispatchSysEx(data) {
    const parsed = parseSysEx(data);
    if (this._onMessage) {
      this._onMessage(parsed);
    }
  }

  _handleStateChange(event) {
    const port = event.port;
    console.log(`MIDI ${port.type} "${port.name}" ${port.state}`);

    // If our connected device was disconnected, update state
    if (port.state === 'disconnected') {
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
        id: port.id,
      });
    }
  }
}
