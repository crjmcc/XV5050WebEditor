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
  connect(inputId, outputId) {
    if (!this._midiAccess) return false;

    this.disconnect();

    const input = this._midiAccess.inputs.get(inputId);
    const output = this._midiAccess.outputs.get(outputId);

    if (!input || !output) {
      console.error('Specified MIDI input or output device not found');
      return false;
    }

    this._input = input;
    this._output = output;
    this._input.onmidimessage = this._handleMidiMessage;
    this._connected = true;

    return true;
  }

  /**
   * Disconnect current MIDI input and output ports.
   */
  disconnect() {
    if (this._input) {
      this._input.onmidimessage = null;
      this._input = null;
    }
    this._output = null;
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
   * @param {Uint8Array} message - Complete SysEx message bytes
   */
  send(message) {
    if (!this._output) {
      console.error('No MIDI output connected');
      return;
    }
    const arr = Array.from(message);
    if (this._onTraffic) {
      this._onTraffic('TX', arr, Date.now());
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
   * Send a SysEx message and wait for a reply within a timeout.
   * Returns the first valid parsed SysEx response.
   * 
   * @param {Uint8Array} message - SysEx message to send
   * @param {number} [timeout=2000] - Timeout in milliseconds
   * @returns {Promise<object>} Parsed SysEx response
   */
  sendAndReceive(message, timeout = 2000) {
    return new Promise((resolve, reject) => {
      const previousHandler = this._onMessage;
      const timer = setTimeout(() => {
        this._onMessage = previousHandler;
        reject(new Error('SysEx response timeout'));
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
      this._onTraffic('RX', Array.from(data), Date.now());
    }

    // Only process SysEx messages (starting with 0xF0)
    if (data[0] !== 0xF0) return;

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
