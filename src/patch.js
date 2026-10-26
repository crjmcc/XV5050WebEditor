/**
 * XV-5050 Editor — Patch Data Manager
 * 
 * Handles requesting, receiving, and sending patch data
 * via SysEx to/from the XV-5050 synthesizer module.
 */

import { buildDT1, buildRQ1 } from './sysex.js';
import {
  PATCH_COMMON,
  PATCH_TMT,
  PATCH_TONE,
  PATCH_MFX,
  PATCH_CHORUS,
  PATCH_REVERB,
  MFX_PARAMS,
  CHORUS_PARAMS,
  REVERB_PARAMS,
  getPatchTempAddress,
  getPatchTMTAddress,
  getPatchMFXAddress,
  getPatchChorusAddress,
  getPatchReverbAddress,
  getToneAddress,
  addOffset,
} from './addresses.js';
import { decodeName, encodeName } from './parameters.js';

/**
 * Request the Patch Common block for a part (or 0 for Single patch mode).
 * 
 * @param {import('./midi.js').MidiManager} midi - MIDI manager
 * @param {number} part - Part number (1-16, or 0 for single patch mode)
 * @param {number} [deviceId] - Device ID
 * @returns {Promise<object>} Parsed patch common data
 */
export async function requestPatchCommon(midi, part, deviceId) {
  const base = getPatchTempAddress(part);
  const msg = buildRQ1(base, PATCH_COMMON.SIZE, deviceId);
  const response = (midi && typeof midi.sendAndReceiveWithRetry === 'function')
    ? await midi.sendAndReceiveWithRetry(msg, { maxRetries: 1, timeoutMs: 600, throttleMs: 20 })
    : await midi.sendAndReceive(msg, 600);
  return parsePatchCommon(response.data || response);
}

/**
 * Request the Patch TMT (Tone Mix Table) block for a part.
 * 
 * @param {import('./midi.js').MidiManager} midi - MIDI manager
 * @param {number} part - Part number (1-16, or 0 for single patch mode)
 * @param {number} [deviceId] - Device ID
 * @returns {Promise<object>} Parsed TMT data
 */
export async function requestPatchTMT(midi, part, deviceId) {
  const patchBase = getPatchTempAddress(part);
  const tmtAddress = getPatchTMTAddress(patchBase);
  const msg = buildRQ1(tmtAddress, PATCH_TMT.SIZE, deviceId);
  const response = (midi && typeof midi.sendAndReceiveWithRetry === 'function')
    ? await midi.sendAndReceiveWithRetry(msg, { maxRetries: 1, timeoutMs: 600, throttleMs: 20 })
    : await midi.sendAndReceive(msg, 600);
  return parsePatchTMT(response.data || response);
}

/**
 * Request a single Tone block (Tone 1-4) for a part.
 * 
 * @param {import('./midi.js').MidiManager} midi - MIDI manager
 * @param {number} part - Part number (1-16, or 0 for single patch mode)
 * @param {number} tone - Tone number (1-4)
 * @param {number} [deviceId] - Device ID
 * @returns {Promise<object>} Parsed tone data
 */
export async function requestPatchTone(midi, part, tone, deviceId) {
  const patchBase = getPatchTempAddress(part);
  const toneAddress = getToneAddress(patchBase, tone);
  const msg = buildRQ1(toneAddress, PATCH_TONE.SIZE, deviceId);
  const response = (midi && typeof midi.sendAndReceiveWithRetry === 'function')
    ? await midi.sendAndReceiveWithRetry(msg, { maxRetries: 1, timeoutMs: 600, throttleMs: 20 })
    : await midi.sendAndReceive(msg, 600);
  return parsePatchTone(response.data || response);
}

/**
 * Request Patch MFX block for a part (or 0 for Single patch mode).
 * 
 * @param {import('./midi.js').MidiManager} midi - MIDI manager
 * @param {number} part - Part number (1-16, or 0 for single patch mode)
 * @param {number} [deviceId] - Device ID
 * @returns {Promise<object>} Parsed MFX data
 */
export async function requestPatchMfx(midi, part = 0, deviceId) {
  const patchBase = getPatchTempAddress(part);
  const mfxAddr = getPatchMFXAddress(patchBase);
  const msg = buildRQ1(mfxAddr, PATCH_MFX.SIZE, deviceId);
  const response = (midi && typeof midi.sendAndReceiveWithRetry === 'function')
    ? await midi.sendAndReceiveWithRetry(msg, { maxRetries: 1, timeoutMs: 600, throttleMs: 20 })
    : await midi.sendAndReceive(msg, 600);
  return parsePatchMfx(response.data || response);
}

/**
 * Request Patch Chorus block for a part.
 * 
 * @param {import('./midi.js').MidiManager} midi - MIDI manager
 * @param {number} part - Part number (1-16, or 0 for single patch mode)
 * @param {number} [deviceId] - Device ID
 * @returns {Promise<object>} Parsed Chorus data
 */
export async function requestPatchChorus(midi, part = 0, deviceId) {
  const patchBase = getPatchTempAddress(part);
  const choAddr = getPatchChorusAddress(patchBase);
  const msg = buildRQ1(choAddr, PATCH_CHORUS.SIZE, deviceId);
  const response = (midi && typeof midi.sendAndReceiveWithRetry === 'function')
    ? await midi.sendAndReceiveWithRetry(msg, { maxRetries: 1, timeoutMs: 600, throttleMs: 20 })
    : await midi.sendAndReceive(msg, 600);
  return parsePatchChorus(response.data || response);
}

/**
 * Request Patch Reverb block for a part.
 * 
 * @param {import('./midi.js').MidiManager} midi - MIDI manager
 * @param {number} part - Part number (1-16, or 0 for single patch mode)
 * @param {number} [deviceId] - Device ID
 * @returns {Promise<object>} Parsed Reverb data
 */
export async function requestPatchReverb(midi, part = 0, deviceId) {
  const patchBase = getPatchTempAddress(part);
  const revAddr = getPatchReverbAddress(patchBase);
  const msg = buildRQ1(revAddr, PATCH_REVERB.SIZE, deviceId);
  const response = (midi && typeof midi.sendAndReceiveWithRetry === 'function')
    ? await midi.sendAndReceiveWithRetry(msg, { maxRetries: 1, timeoutMs: 600, throttleMs: 20 })
    : await midi.sendAndReceive(msg, 600);
  return parsePatchReverb(response.data || response);
}

/**
 * Request an entire patch in one coordinated sweep:
 * Patch Common, MFX, Chorus, Reverb, TMT, and all 4 Tones (including full wave configuration).
 * 
 * @param {import('./midi.js').MidiManager} midi - MIDI manager
 * @param {number} part - Part number (1-16, or 0 for single patch mode)
 * @param {number} [deviceId] - Device ID
 * @param {Function} [onProgress] - Callback (stage, current, total, data)
 * @returns {Promise<{common: object, mfx: object, chorus: object, reverb: object, tmt: object, tones: object[]}>}
 */
export async function requestEntirePatch(midi, part = 0, deviceId, onProgress) {
  if (onProgress) onProgress('common', 0, 9, null);
  const common = await requestPatchCommon(midi, part, deviceId);
  await new Promise(r => setTimeout(r, 20));

  let mfx = null;
  let chorus = null;
  let reverb = null;

  // In Roland XV-5050, Patch MFX, Chorus, and Reverb ONLY exist in Single Patch Mode (part === 0).
  // Performance Parts (1-16) use the Performance-level effects;
  // requesting patch MFX/Chorus/Reverb on performance parts causes 20+ seconds of hardware retry timeouts.
  if (part === 0) {
    try {
      if (onProgress) onProgress('mfx', 1, 9, common);
      mfx = await requestPatchMfx(midi, part, deviceId);
      await new Promise(r => setTimeout(r, 20));
    } catch (_) {}

    try {
      if (onProgress) onProgress('chorus', 2, 9, mfx);
      chorus = await requestPatchChorus(midi, part, deviceId);
      await new Promise(r => setTimeout(r, 20));
    } catch (_) {}

    try {
      if (onProgress) onProgress('reverb', 3, 9, chorus);
      reverb = await requestPatchReverb(midi, part, deviceId);
      await new Promise(r => setTimeout(r, 20));
    } catch (_) {}
  }

  if (onProgress) onProgress('tmt', 4, 9, reverb);
  const tmt = await requestPatchTMT(midi, part, deviceId);
  await new Promise(r => setTimeout(r, 20));

  const tones = [];
  for (let t = 1; t <= 4; t++) {
    if (onProgress) onProgress(`tone${t}`, 4 + t, 9, null);
    const toneData = await requestPatchTone(midi, part, t, deviceId);
    tones.push(toneData);
    await new Promise(r => setTimeout(r, 20));
  }

  return { common, mfx, chorus, reverb, tmt, tones };
}


/**
 * Send a single patch common parameter to the device.
 * 
 * @param {import('./midi.js').MidiManager} midi - MIDI manager
 * @param {number} part - Part number (1-16, or 0 for single)
 * @param {string} paramKey - Key from PATCH_COMMON.params
 * @param {number} value - Parameter value
 * @param {number} [deviceId] - Device ID
 */
export function sendPatchCommonParam(midi, part, paramKey, value, deviceId) {
  const param = PATCH_COMMON.params[paramKey];
  if (!param) {
    throw new Error(`Unknown patch common parameter: ${paramKey}`);
  }
  const base = getPatchTempAddress(part);
  const address = addOffset(base, param.offset);
  const msg = buildDT1(address, [value & 0x7F], deviceId);
  midi.send(msg);
}

/**
 * Send a patch TMT parameter to the device.
 * 
 * @param {import('./midi.js').MidiManager} midi - MIDI manager
 * @param {number} part - Part number (1-16, or 0 for single)
 * @param {string} paramKey - Key from PATCH_TMT.params
 * @param {number} value - Parameter value
 * @param {number} [deviceId] - Device ID
 */
export function sendPatchTMTParam(midi, part, paramKey, value, deviceId) {
  const param = PATCH_TMT.params[paramKey];
  if (!param) {
    throw new Error(`Unknown patch TMT parameter: ${paramKey}`);
  }
  const patchBase = getPatchTempAddress(part);
  const tmtBase = getPatchTMTAddress(patchBase);
  const address = addOffset(tmtBase, param.offset);
  const msg = buildDT1(address, [value & 0x7F], deviceId);
  midi.send(msg);
}

/**
 * Send a Patch MFX parameter to the device.
 * 
 * @param {import('./midi.js').MidiManager} midi - MIDI manager
 * @param {number} part - Part number (1-16, or 0 for single)
 * @param {string} paramKey - Key from MFX_PARAMS
 * @param {number} value - Parameter value
 * @param {number} [deviceId] - Device ID
 */
export function sendPatchMfxParam(midi, part = 0, paramKey, value, deviceId = 0x10) {
  const param = MFX_PARAMS[paramKey];
  if (!param) {
    throw new Error(`Unknown patch MFX parameter: ${paramKey}`);
  }
  const patchBase = getPatchTempAddress(part);
  const mfxBase = getPatchMFXAddress(patchBase);
  const address = addOffset(mfxBase, param.offset);

  let dataBytes;
  if (param.size === 4) {
    const rawVal = value < 0 ? value + 32768 : (value <= 127 ? value : value + 32768);
    dataBytes = [
      (rawVal >> 12) & 0x0F,
      (rawVal >> 8) & 0x0F,
      (rawVal >> 4) & 0x0F,
      rawVal & 0x0F,
    ];
  } else if (paramKey.endsWith('_SENS')) {
    dataBytes = [(value + 64) & 0x7F];
  } else {
    dataBytes = [value & 0x7F];
  }

  const msg = buildDT1(address, dataBytes, deviceId);
  midi.send(msg);
}

/**
 * Send a Patch Chorus parameter to the device.
 * 
 * @param {import('./midi.js').MidiManager} midi - MIDI manager
 * @param {number} part - Part number (1-16, or 0 for single)
 * @param {string} paramKey - Key from CHORUS_PARAMS
 * @param {number} value - Parameter value
 * @param {number} [deviceId] - Device ID
 */
export function sendPatchChorusParam(midi, part = 0, paramKey, value, deviceId = 0x10) {
  const param = CHORUS_PARAMS[paramKey];
  if (!param) {
    throw new Error(`Unknown patch Chorus parameter: ${paramKey}`);
  }
  const patchBase = getPatchTempAddress(part);
  const choBase = getPatchChorusAddress(patchBase);
  const address = addOffset(choBase, param.offset);
  const msg = buildDT1(address, [value & 0x7F], deviceId);
  midi.send(msg);
}

/**
 * Send a Patch Reverb parameter to the device.
 * 
 * @param {import('./midi.js').MidiManager} midi - MIDI manager
 * @param {number} part - Part number (1-16, or 0 for single)
 * @param {string} paramKey - Key from REVERB_PARAMS
 * @param {number} value - Parameter value
 * @param {number} [deviceId] - Device ID
 */
export function sendPatchReverbParam(midi, part = 0, paramKey, value, deviceId = 0x10) {
  const param = REVERB_PARAMS[paramKey];
  if (!param) {
    throw new Error(`Unknown patch Reverb parameter: ${paramKey}`);
  }
  const patchBase = getPatchTempAddress(part);
  const revBase = getPatchReverbAddress(patchBase);
  const address = addOffset(revBase, param.offset);
  const msg = buildDT1(address, [value & 0x7F], deviceId);
  midi.send(msg);
}

/**
 * Send a parameter for a specific Tone (1-4).
 * 
 * @param {import('./midi.js').MidiManager} midi - MIDI manager
 * @param {number} part - Part number (1-16, or 0 for single)
 * @param {number} tone - Tone number (1-4)
 * @param {string} paramKey - Key from PATCH_TONE.params
 * @param {number} value - Parameter value
 * @param {number} [deviceId] - Device ID
 */
export function sendPatchToneParam(midi, part, tone, paramKey, value, deviceId) {
  const param = (typeof paramKey === 'string') ? PATCH_TONE.params[paramKey] : paramKey;
  if (!param) {
    throw new Error(`Unknown tone parameter: ${paramKey}`);
  }
  const patchBase = getPatchTempAddress(part);
  const toneBase = getToneAddress(patchBase, tone);
  const address = addOffset(toneBase, param.offset);

  let dataBytes;
  if (param.size === 4) {
    // 4-nibble word: split value into 4 nibbles [aaaa, bbbb, cccc, dddd]
    dataBytes = [
      (value >> 12) & 0x0F,
      (value >> 8) & 0x0F,
      (value >> 4) & 0x0F,
      value & 0x0F,
    ];
  } else {
    dataBytes = [value & 0x7F];
  }

  const msg = buildDT1(address, dataBytes, deviceId);
  midi.send(msg);
}

/**
 * Send a patch name to the device.
 * 
 * @param {import('./midi.js').MidiManager} midi - MIDI manager
 * @param {number} part - Part number (1-16, or 0 for single)
 * @param {string} name - Patch name (max 12 chars)
 * @param {number} [deviceId] - Device ID
 */
export function sendPatchName(midi, part, name, deviceId) {
  const nameBytes = encodeName(name);
  const base = getPatchTempAddress(part);
  const msg = buildDT1(base, nameBytes, deviceId);
  midi.send(msg);
}

/**
 * Send a tone on/off switch to the device (located in Patch TMT).
 * 
 * @param {import('./midi.js').MidiManager} midi - MIDI manager
 * @param {number} part - Part number (1-16, or 0 for single)
 * @param {number} tone - Tone number (1-4)
 * @param {boolean|number} enabled - Whether the tone is active
 * @param {number} [deviceId] - Device ID
 */
export function sendToneSwitch(midi, part, tone, enabled, deviceId) {
  const paramKey = `TONE_${tone}_SWITCH`;
  sendPatchTMTParam(midi, part, paramKey, enabled ? 1 : 0, deviceId);
}

/**
 * Send a Matrix Control parameter (Stage 2 Gap 1).
 * 
 * @param {import('./midi.js').MidiManager} midi - MIDI manager
 * @param {number} part - Part number (1-16, or 0 for single)
 * @param {number|string} matrixNumOrKey - Matrix number (1-4) or full param key
 * @param {string|number} [paramKeyOrVal] - Param suffix (e.g., 'SOURCE', 'DEST_1', 'SENS_1') or value if key provided
 * @param {number} [value] - Parameter value
 * @param {number} [deviceId] - Device ID
 */
export function sendMatrixControlParam(midi, part, matrixNumOrKey, paramKeyOrVal, value, deviceId) {
  let paramKey;
  let val;
  let devId = deviceId;

  if (typeof matrixNumOrKey === 'string') {
    paramKey = matrixNumOrKey;
    val = paramKeyOrVal;
  } else {
    const matrixNum = matrixNumOrKey;
    const subParam = String(paramKeyOrVal);
    paramKey = subParam.startsWith('MATRIX_CTRL') ? subParam : `MATRIX_CTRL_${matrixNum}_${subParam}`;
    val = value;
  }

  sendPatchCommonParam(midi, part, paramKey, val, devId);
}

/**
 * Send a TMT Keyboard or Velocity range parameter (Stage 2 Gap 2).
 * 
 * @param {import('./midi.js').MidiManager} midi - MIDI manager
 * @param {number} part - Part number (1-16, or 0 for single)
 * @param {number} tone - Tone number (1-4)
 * @param {string} paramType - Range type (e.g., 'KEY_LOWER', 'KEY_UPPER', 'VEL_LOWER', 'VEL_UPPER')
 * @param {number} value - Parameter value
 * @param {number} [deviceId] - Device ID
 */
export function sendTMTKeyRangeParam(midi, part, tone, paramType, value, deviceId) {
  const key = paramType.startsWith('TONE_') ? paramType : `TONE_${tone}_${paramType}`;
  sendPatchTMTParam(midi, part, key, value, deviceId);
}

/**
 * Send a Tone Envelope parameter (Stage 2 Gap 3).
 * 
 * @param {import('./midi.js').MidiManager} midi - MIDI manager
 * @param {number} part - Part number (1-16, or 0 for single)
 * @param {number} tone - Tone number (1-4)
 * @param {string} envType - 'PITCH', 'TVF', or 'TVA'
 * @param {string} param - Param key suffix (e.g., 'DEPTH', 'T1', 'L1')
 * @param {number} value - Parameter value
 * @param {number} [deviceId] - Device ID
 */
export function sendToneEnvelopeParam(midi, part, tone, envType, param, value, deviceId) {
  let key;
  const upperEnv = envType.toUpperCase();
  if (param.startsWith(`${upperEnv}_`)) {
    key = param;
  } else if (upperEnv === 'PITCH' || upperEnv === 'TVF' || upperEnv === 'TVA') {
    key = `${upperEnv}_ENV_${param}`;
  } else {
    key = param;
  }
  sendPatchToneParam(midi, part, tone, key, value, deviceId);
}

/**
 * Send a Tone LFO parameter (Stage 2 Gap 3).
 * 
 * @param {import('./midi.js').MidiManager} midi - MIDI manager
 * @param {number} part - Part number (1-16, or 0 for single)
 * @param {number} tone - Tone number (1-4)
 * @param {number} lfoNum - LFO number (1 or 2)
 * @param {string} param - Param key suffix (e.g., 'FORM', 'RATE', 'PITCH_DEPTH', 'TVF_DEPTH')
 * @param {number} value - Parameter value
 * @param {number} [deviceId] - Device ID
 */
export function sendToneLFOParam(midi, part, tone, lfoNum, param, value, deviceId) {
  const key = param.startsWith('LFO') ? param : `LFO${lfoNum}_${param}`;
  sendPatchToneParam(midi, part, tone, key, value, deviceId);
}

/**
 * Send a Tone Wave parameter (Wave Number L/R, Wave Group, FXM, etc.).
 * 
 * @param {import('./midi.js').MidiManager} midi - MIDI manager
 * @param {number} part - Part number (1-16, or 0 for single)
 * @param {number} tone - Tone number (1-4)
 * @param {string} waveParam - 'WAVE_NUMBER_L', 'WAVE_NUMBER_R', 'WAVE_GROUP_TYPE', 'WAVE_GAIN', etc.
 * @param {number} value - Parameter value (e.g. 1-1083 for wave number)
 * @param {number} [deviceId] - Device ID
 */
export function sendToneWaveParam(midi, part, tone, waveParam, value, deviceId) {
  sendPatchToneParam(midi, part, tone, waveParam, value, deviceId);
}

/**
 * Parse raw patch MFX data bytes (Table 1-4-1-2).
 * 
 * @param {number[]} data - Raw SysEx payload
 * @returns {object}
 */
export function parsePatchMfx(data) {
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
      params: Array(12).fill(0),
    };
  }

  const params = [];
  for (let i = 0; i < 12; i++) {
    const off = 0x11 + (i * 4);
    if (off + 3 < data.length) {
      const val = (data[off] << 12) | (data[off + 1] << 8) | (data[off + 2] << 4) | data[off + 3];
      params.push(val >= 32768 ? val - 32768 : val);
    } else {
      params.push(0);
    }
  }

  return {
    mfxType: data[0x00] ?? 0,
    dryLevel: data[0x01] ?? 127,
    chorusSend: data[0x02] ?? 0,
    reverbSend: data[0x03] ?? 0,
    outputAssign: data[0x04] ?? 0,
    ctrl1Source: data[0x05] ?? 0,
    ctrl1Sens: (data[0x06] ?? 64) - 64,
    ctrl2Source: data[0x07] ?? 0,
    ctrl2Sens: (data[0x08] ?? 64) - 64,
    ctrl3Source: data[0x09] ?? 0,
    ctrl3Sens: (data[0x0A] ?? 64) - 64,
    ctrl4Source: data[0x0B] ?? 0,
    ctrl4Sens: (data[0x0C] ?? 64) - 64,
    ctrl1Assign: data[0x0D] ?? 0,
    ctrl2Assign: data[0x0E] ?? 0,
    ctrl3Assign: data[0x0F] ?? 0,
    ctrl4Assign: data[0x10] ?? 0,
    params,
  };
}

/**
 * Parse raw patch chorus data bytes.
 * 
 * @param {number[]} data - Raw SysEx payload
 * @returns {object}
 */
export function parsePatchChorus(data) {
  if (!data || data.length < 4) {
    return { chorusType: 0, chorusLevel: 0, outputAssign: 0, outputSelect: 0, preDelay: 0, rate: 0, depth: 0, feedback: 0, revSend: 0 };
  }
  return {
    chorusType: data[0x00],
    chorusLevel: data[0x01],
    outputAssign: data[0x02],
    outputSelect: data[0x03],
    preDelay: data[0x04] ?? 0,
    rate: data[0x05] ?? 0,
    depth: data[0x06] ?? 0,
    feedback: data[0x07] ?? 0,
    revSend: data[0x08] ?? 0,
  };
}

/**
 * Parse raw patch reverb data bytes.
 * 
 * @param {number[]} data - Raw SysEx payload
 * @returns {object}
 */
export function parsePatchReverb(data) {
  if (!data || data.length < 3) {
    return { reverbType: 0, reverbLevel: 0, outputAssign: 0, time: 0, hfDamp: 0, preDelay: 0 };
  }
  return {
    reverbType: data[0x00],
    reverbLevel: data[0x01],
    outputAssign: data[0x02],
    time: data[0x04] ?? 0,
    hfDamp: data[0x05] ?? 0,
    preDelay: data[0x07] ?? 0,
  };
}

/**
 * Parse raw patch common data bytes into a structured object.
 * 
 * @param {number[]} data - Raw SysEx payload
 * @returns {object}
 */
export function parsePatchCommon(data) {
  if (!data || data.length < 0x2B) {
    throw new Error(`Patch common data too short: ${data?.length} bytes`);
  }

  return {
    name: decodeName(data.slice(0, 12)),
    patchCategory: data[0x0C] ?? 0,
    toneType: data[0x0D] ?? 0,
    patchLevel: data[0x0E] ?? 127,
    patchPan: data[0x0F] ?? 64,
    patchPriority: data[0x10] ?? 0,
    coarseTune: data[0x11] ?? 64,
    fineTune: data[0x12] ?? 64,
    octaveShift: data[0x13] ?? 64,
    stretchTuneDepth: data[0x14] ?? 0,
    analogFeel: data[0x15] ?? 0,
    monoPoly: data[0x16] ?? 1,
    legatoSwitch: data[0x17] ?? 0,
    legatoRetrigger: data[0x18] ?? 0,
    portamentoSwitch: data[0x19] ?? 0,
    portamentoMode: data[0x1A] ?? 0,
    portamentoType: data[0x1B] ?? 0,
    portamentoStart: data[0x1C] ?? 0,
    portamentoTime: data[0x1D] ?? 0,
    patchClockSource: data[0x1E] ?? 0,
    cutoffOffset: data[0x22] ?? 64,
    resonanceOffset: data[0x23] ?? 64,
    attackTimeOffset: data[0x24] ?? 64,
    releaseTimeOffset: data[0x25] ?? 64,
    velocitySensOffset: data[0x26] ?? 64,
    outputAssign: data[0x27] ?? 0,
    tmtCtrlSwitch: data[0x28] ?? 0,
    bendRangeUp: data[0x29] ?? 2,
    bendRangeDown: data[0x2A] ?? 2,
    // Matrix Control 1
    matrix1Source: data[0x2B] ?? 0,
    matrix1Dest1: data[0x2C] ?? 0,
    matrix1Sens1: data[0x2D] ?? 64,
    matrix1Dest2: data[0x2E] ?? 0,
    matrix1Sens2: data[0x2F] ?? 64,
    matrix1Dest3: data[0x30] ?? 0,
    matrix1Sens3: data[0x31] ?? 64,
    matrix1Dest4: data[0x32] ?? 0,
    matrix1Sens4: data[0x33] ?? 64,
    // Matrix Control 2
    matrix2Source: data[0x34] ?? 0,
    matrix2Dest1: data[0x35] ?? 0,
    matrix2Sens1: data[0x36] ?? 64,
    matrix2Dest2: data[0x37] ?? 0,
    matrix2Sens2: data[0x38] ?? 64,
    matrix2Dest3: data[0x39] ?? 0,
    matrix2Sens3: data[0x3A] ?? 64,
    matrix2Dest4: data[0x3B] ?? 0,
    matrix2Sens4: data[0x3C] ?? 64,
    // Matrix Control 3
    matrix3Source: data[0x3D] ?? 0,
    matrix3Dest1: data[0x3E] ?? 0,
    matrix3Sens1: data[0x3F] ?? 64,
    matrix3Dest2: data[0x40] ?? 0,
    matrix3Sens2: data[0x41] ?? 64,
    matrix3Dest3: data[0x42] ?? 0,
    matrix3Sens3: data[0x43] ?? 64,
    matrix3Dest4: data[0x44] ?? 0,
    matrix3Sens4: data[0x45] ?? 64,
    // Matrix Control 4
    matrix4Source: data[0x46] ?? 0,
    matrix4Dest1: data[0x47] ?? 0,
    matrix4Sens1: data[0x48] ?? 64,
    matrix4Dest2: data[0x49] ?? 0,
    matrix4Sens2: data[0x4A] ?? 64,
    matrix4Dest3: data[0x4B] ?? 0,
    matrix4Sens3: data[0x4C] ?? 64,
    matrix4Dest4: data[0x4D] ?? 0,
    matrix4Sens4: data[0x4E] ?? 64,
  };
}

/**
 * Parse raw patch TMT data bytes.
 * 
 * @param {number[]} data - Raw SysEx payload
 * @returns {object}
 */
export function parsePatchTMT(data) {
  if (!data || data.length < 0x21) {
    throw new Error(`Patch TMT data too short: ${data?.length} bytes`);
  }

  return {
    structureType12: data[0x00] ?? 0,
    booster12: data[0x01] ?? 0,
    structureType34: data[0x02] ?? 0,
    booster34: data[0x03] ?? 0,
    tmtVelControl: data[0x04] ?? 0,
    // Tone 1
    tone1Switch: data[0x05] ?? 1,
    tone1KeyLower: data[0x06] ?? 0,
    tone1KeyUpper: data[0x07] ?? 127,
    tone1KeyFadeL: data[0x08] ?? 0,
    tone1KeyFadeU: data[0x09] ?? 0,
    tone1VelLower: data[0x0A] ?? 1,
    tone1VelUpper: data[0x0B] ?? 127,
    tone1VelFadeL: data[0x0C] ?? 0,
    tone1VelFadeU: data[0x0D] ?? 0,
    // Tone 2
    tone2Switch: data[0x0E] ?? 0,
    tone2KeyLower: data[0x0F] ?? 0,
    tone2KeyUpper: data[0x10] ?? 127,
    tone2KeyFadeL: data[0x11] ?? 0,
    tone2KeyFadeU: data[0x12] ?? 0,
    tone2VelLower: data[0x13] ?? 1,
    tone2VelUpper: data[0x14] ?? 127,
    tone2VelFadeL: data[0x15] ?? 0,
    tone2VelFadeU: data[0x16] ?? 0,
    // Tone 3
    tone3Switch: data[0x17] ?? 0,
    tone3KeyLower: data[0x18] ?? 0,
    tone3KeyUpper: data[0x19] ?? 127,
    tone3KeyFadeL: data[0x1A] ?? 0,
    tone3KeyFadeU: data[0x1B] ?? 0,
    tone3VelLower: data[0x1C] ?? 1,
    tone3VelUpper: data[0x1D] ?? 127,
    tone3VelFadeL: data[0x1E] ?? 0,
    tone3VelFadeU: data[0x1F] ?? 0,
    // Tone 4
    tone4Switch: data[0x20] ?? 0,
    tone4KeyLower: data[0x21] ?? 0,
    tone4KeyUpper: data[0x22] ?? 127,
    tone4KeyFadeL: data[0x23] ?? 0,
    tone4KeyFadeU: data[0x24] ?? 0,
    tone4VelLower: data[0x25] ?? 1,
    tone4VelUpper: data[0x26] ?? 127,
    tone4VelFadeL: data[0x27] ?? 0,
    tone4VelFadeU: data[0x28] ?? 0,
  };
}

/**
 * Parse raw patch tone data bytes.
 * 
 * @param {number[]} data - Raw SysEx payload
 * @returns {object}
 */
export function parsePatchTone(data) {
  if (!data || data.length < 0x05) {
    throw new Error(`Patch tone data too short: ${data?.length} bytes`);
  }

  return {
    toneLevel: data[0x00] ?? 127,
    coarseTune: data[0x01] ?? 64,
    fineTune: data[0x02] ?? 64,
    randomPitchDepth: data[0x03] ?? 0,
    tonePan: data[0x04] ?? 64,
    panKeyfollow: data[0x05] ?? 64,
    randomPanDepth: data[0x06] ?? 0,
    altPanDepth: data[0x07] ?? 64,
    // Wave
    waveGroupType: data[0x27] ?? 0,
    waveGroupId: (((data[0x28] ?? 0) & 0x0F) << 12) |
                 (((data[0x29] ?? 0) & 0x0F) << 8) |
                 (((data[0x2A] ?? 0) & 0x0F) << 4) |
                 ((data[0x2B] ?? 0) & 0x0F),
    waveNumberL: (((data[0x2C] ?? 0) & 0x0F) << 12) |
                 (((data[0x2D] ?? 0) & 0x0F) << 8) |
                 (((data[0x2E] ?? 0) & 0x0F) << 4) |
                 ((data[0x2F] ?? 0) & 0x0F),
    waveNumberR: (((data[0x30] ?? 0) & 0x0F) << 12) |
                 (((data[0x31] ?? 0) & 0x0F) << 8) |
                 (((data[0x32] ?? 0) & 0x0F) << 4) |
                 ((data[0x33] ?? 0) & 0x0F),
    waveGain: data[0x34] ?? 1,
    fxmSwitch: data[0x35] ?? 0,
    waveFxmSwitch: data[0x35] ?? 0,
    fxmColor: data[0x36] ?? 0,
    waveFxmColor: data[0x36] ?? 0,
    fxmDepth: data[0x37] ?? 0,
    waveFxmDepth: data[0x37] ?? 0,
    waveTempoSync: data[0x38] ?? 0,
    wavePitchKeyfollow: data[0x39] ?? 64,
    // Pitch Envelope
    pitchEnvDepth: data[0x3A] ?? 64,
    pitchEnvVelSens: data[0x3B] ?? 64,
    pitchEnvTime1Vel: data[0x3C] ?? 64,
    pitchEnvTime4Vel: data[0x3D] ?? 64,
    pitchEnvTimeKey: data[0x3E] ?? 64,
    pitchEnvT1: data[0x3F] ?? 0,
    pitchEnvT2: data[0x40] ?? 0,
    pitchEnvT3: data[0x41] ?? 0,
    pitchEnvT4: data[0x42] ?? 0,
    pitchEnvL0: data[0x43] ?? 64,
    pitchEnvL1: data[0x44] ?? 64,
    pitchEnvL2: data[0x45] ?? 64,
    pitchEnvL3: data[0x46] ?? 64,
    pitchEnvL4: data[0x47] ?? 64,
    // TVF
    tvfFilterType: data[0x48] ?? 0,
    tvfCutoff: data[0x49] ?? 127,
    tvfCutoffKeyfollow: data[0x4A] ?? 64,
    tvfCutoffVelCurve: data[0x4B] ?? 0,
    tvfCutoffVelSens: data[0x4C] ?? 64,
    tvfResonance: data[0x4D] ?? 0,
    tvfResoVelSens: data[0x4E] ?? 64,
    tvfEnvDepth: data[0x4F] ?? 64,
    tvfEnvVelCurve: data[0x50] ?? 0,
    tvfEnvVelSens: data[0x51] ?? 64,
    tvfEnvTime1Vel: data[0x52] ?? 64,
    tvfEnvTime4Vel: data[0x53] ?? 64,
    tvfEnvTimeKey: data[0x54] ?? 64,
    tvfEnvT1: data[0x55] ?? 0,
    tvfEnvT2: data[0x56] ?? 0,
    tvfEnvT3: data[0x57] ?? 0,
    tvfEnvT4: data[0x58] ?? 0,
    tvfEnvL1: data[0x59] ?? 0,
    tvfEnvL2: data[0x5A] ?? 0,
    tvfEnvL3: data[0x5B] ?? 0,
    tvfEnvL4: data[0x5C] ?? 0,
    // TVA
    tvaLevel: data[0x00] ?? 127,
    tvaVelCurve: data[0x61] ?? 0,
    tvaVelSens: data[0x62] ?? 64,
    tvaEnvTime1Vel: data[0x63] ?? 64,
    tvaEnvTime4Vel: data[0x64] ?? 64,
    tvaEnvTimeKey: data[0x65] ?? 64,
    tvaEnvT1: data[0x66] ?? 0,
    tvaEnvT2: data[0x67] ?? 0,
    tvaEnvT3: data[0x68] ?? 0,
    tvaEnvT4: data[0x69] ?? 0,
    tvaEnvL1: data[0x6A] ?? 0,
    tvaEnvL2: data[0x6B] ?? 0,
    tvaEnvL3: data[0x6C] ?? 0,
    // LFO 1
    lfo1Form: data[0x6D] ?? 0,
    lfo1Rate: data[0x6E] ?? 0,
    lfo1Offset: data[0x70] ?? 0,
    lfo1RateDetune: data[0x71] ?? 0,
    lfo1DelayTime: data[0x72] ?? 0,
    lfo1DelayTimeKey: data[0x73] ?? 64,
    lfo1FadeMode: data[0x74] ?? 0,
    lfo1FadeTime: data[0x75] ?? 0,
    lfo1KeyTrigger: data[0x76] ?? 0,
    lfo1PitchDepth: data[0x77] ?? 64,
    lfo1TvfDepth: data[0x78] ?? 64,
    lfo1TvaDepth: data[0x79] ?? 64,
    lfo1PanDepth: data[0x7A] ?? 64,
    // LFO 2
    lfo2Form: data[0x7B] ?? 0,
    lfo2Rate: data[0x7C] ?? 0,
    lfo2Offset: data[0x7E] ?? 0,
    lfo2RateDetune: data[0x7F] ?? 0,
    lfo2DelayTime: data[0x80] ?? 0,
    lfo2DelayTimeKey: data[0x81] ?? 64,
    lfo2FadeMode: data[0x82] ?? 0,
    lfo2FadeTime: data[0x83] ?? 0,
    lfo2KeyTrigger: data[0x84] ?? 0,
    lfo2PitchDepth: data[0x85] ?? 64,
    lfo2TvfDepth: data[0x86] ?? 64,
    lfo2TvaDepth: data[0x87] ?? 64,
    lfo2PanDepth: data[0x88] ?? 64,
  };
}
