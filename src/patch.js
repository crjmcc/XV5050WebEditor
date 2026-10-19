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
  getPatchTempAddress,
  getPatchTMTAddress,
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
  const response = await midi.sendAndReceive(msg);
  return parsePatchCommon(response.data);
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
  const response = await midi.sendAndReceive(msg);
  return parsePatchTMT(response.data);
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
  const response = await midi.sendAndReceive(msg);
  return parsePatchTone(response.data);
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
  const param = PATCH_TONE.params[paramKey];
  if (!param) {
    throw new Error(`Unknown tone parameter: ${paramKey}`);
  }
  const patchBase = getPatchTempAddress(part);
  const toneBase = getToneAddress(patchBase, tone);
  const address = addOffset(toneBase, param.offset);
  const msg = buildDT1(address, [value & 0x7F], deviceId);
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
    portamentoTime: data[0x1D] ?? 0,
    outputAssign: data[0x27] ?? 0,
    bendRangeUp: data[0x29] ?? 2,
    bendRangeDown: data[0x2A] ?? 2,
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
    tone1Switch: data[0x05] ?? 1,
    tone2Switch: data[0x0E] ?? 0,
    tone3Switch: data[0x17] ?? 0,
    tone4Switch: data[0x20] ?? 0,
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
    waveGroupType: data[0x27] ?? 0,
    waveGain: data[0x34] ?? 1,
    tvfFilterType: data[0x48] ?? 0,
    tvfCutoff: data[0x49] ?? 127,
    tvfResonance: data[0x4D] ?? 0,
    tvaLevel: data[0x6E] ?? 127,
  };
}
