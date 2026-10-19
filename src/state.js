/**
 * XV-5050 Editor — Application State
 * 
 * Centralized state management using a simple observable store pattern.
 * No external dependencies, works entirely client-side.
 */

/**
 * Simple observable store for application state.
 */
export class Store {
  constructor(initialState = {}) {
    /** @type {object} */
    this._state = structuredClone(initialState);

    /** @type {Map<string, Set<Function>>} */
    this._listeners = new Map();

    /** @type {Set<Function>} */
    this._globalListeners = new Set();
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
    return path.split('.').reduce((obj, key) => obj?.[key], this._state);
  }

  /**
   * Set a nested value using dot notation and notify listeners.
   * @param {string} path - Dot-separated path
   * @param {*} value - New value
   */
  set(path, value) {
    const keys = path.split('.');
    let obj = this._state;

    for (let i = 0; i < keys.length - 1; i++) {
      if (obj[keys[i]] === undefined) {
        obj[keys[i]] = {};
      }
      obj = obj[keys[i]];
    }

    const lastKey = keys[keys.length - 1];
    const oldValue = obj[lastKey];
    obj[lastKey] = value;

    // Notify path-specific listeners
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
      this._listeners.set(path, new Set());
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
    // Exact path listeners
    const listeners = this._listeners.get(path);
    if (listeners) {
      for (const cb of listeners) {
        cb(newValue, oldValue, path);
      }
    }

    // Parent path listeners (e.g., 'performance' listeners fire for 'performance.common.name')
    const parts = path.split('.');
    for (let i = parts.length - 1; i > 0; i--) {
      const parentPath = parts.slice(0, i).join('.');
      const parentListeners = this._listeners.get(parentPath);
      if (parentListeners) {
        for (const cb of parentListeners) {
          cb(this.get(parentPath), undefined, parentPath);
        }
      }
    }

    // Global listeners
    for (const cb of this._globalListeners) {
      cb(path, newValue, oldValue);
    }
  }
}

// =============================================================================
// Default application state
// =============================================================================

export const DEFAULT_STATE = {
  // MIDI connection
  midi: {
    inputId: null,
    outputId: null,
    connected: false,
    deviceId: 0x10, // XV-5050 device ID (0x10-0x1F)
  },

  // Currently loaded performance
  performance: {
    loaded: false,
    common: {
      name: 'INITIAL PERF',
      soloPartSelect: 0,
      mfxCtrlChannel: 0,
      mfxCtrlMidi1: 0,
      mfxCtrlMidi2: 0,
      mfxASource: 0,
      chorusSource: 0,
      reverbSource: 0,
    },
    chorus: {
      chorusType: 1, // CHORUS
      chorusLevel: 64,
      outputAssign: 0,
      outputSelect: 0,
    },
    reverb: {
      reverbType: 1, // REVERB
      reverbLevel: 64,
      outputAssign: 0,
    },
    parts: Array.from({ length: 16 }, (_, i) => ({
      receiveSwitch: 1,
      receiveChannel: i,
      patchBankMSB: 87, // Preset A default
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
      decayTimeOffset: 64,
    })),
  },

  // Currently loaded patch (for selected part or single patch mode)
  patch: {
    loaded: false,
    part: 1, // 1-16 for performance part, 0 for single patch mode
    common: {
      name: 'INITIAL PATCH',
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
      bendRangeDown: 2,
    },
    tmt: {
      structureType12: 0,
      booster12: 0,
      structureType34: 0,
      booster34: 0,
      tone1Switch: 1,
      tone2Switch: 1,
      tone3Switch: 0,
      tone4Switch: 0,
    },
    tones: [
      { toneLevel: 127, coarseTune: 64, fineTune: 64, tonePan: 64, waveGroupType: 0, waveGain: 1, tvfFilterType: 1, tvfCutoff: 127, tvfResonance: 0, tvaLevel: 127 },
      { toneLevel: 127, coarseTune: 64, fineTune: 64, tonePan: 64, waveGroupType: 0, waveGain: 1, tvfFilterType: 1, tvfCutoff: 127, tvfResonance: 0, tvaLevel: 127 },
      { toneLevel: 127, coarseTune: 64, fineTune: 64, tonePan: 64, waveGroupType: 0, waveGain: 1, tvfFilterType: 1, tvfCutoff: 127, tvfResonance: 0, tvaLevel: 127 },
      { toneLevel: 127, coarseTune: 64, fineTune: 64, tonePan: 64, waveGroupType: 0, waveGain: 1, tvfFilterType: 1, tvfCutoff: 127, tvfResonance: 0, tvaLevel: 127 },
    ],
  },

  // UI state
  ui: {
    currentTab: 'performance', // 'performance' | 'patch' | 'sysex'
    selectedPart: 1,
    selectedTone: 1,
    status: 'Disconnected',
    logs: [],
  },
};

/**
 * Create a new application store with default state.
 * @returns {Store}
 */
export function createStore() {
  return new Store(structuredClone(DEFAULT_STATE));
}
