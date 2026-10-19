/**
 * XV-5050 Editor — Performance Data Manager
 * 
 * Handles requesting, parsing, and sending Performance data
 * via SysEx to and from the XV-5050 synthesizer module.
 */

import { buildDT1, buildRQ1 } from './sysex.js';
import {
  PERF_TEMP,
  PERF_PART,
  getPartAddress,
  getPatchTempAddress,
  addOffset,
} from './addresses.js';
import { decodeName, encodeName } from './parameters.js';

/**
 * Request the Performance Common block from the device.
 * 
 * @param {import('./midi.js').MidiManager} midi - MIDI manager
 * @param {number} [deviceId] - Device ID
 * @returns {Promise<object>} Parsed performance common data
 */
export async function requestPerformanceCommon(midi, deviceId) {
  const msg = buildRQ1(
    PERF_TEMP.COMMON.BASE,
    PERF_TEMP.COMMON.SIZE,
    deviceId
  );
  const response = await midi.sendAndReceive(msg);
  return parsePerformanceCommon(response.data);
}

/**
 * Request Performance Chorus block from the device.
 * 
 * @param {import('./midi.js').MidiManager} midi - MIDI manager
 * @param {number} [deviceId] - Device ID
 * @returns {Promise<object>} Parsed chorus data
 */
export async function requestPerformanceChorus(midi, deviceId) {
  const msg = buildRQ1(
    PERF_TEMP.CHORUS.BASE,
    PERF_TEMP.CHORUS.SIZE,
    deviceId
  );
  const response = await midi.sendAndReceive(msg);
  return parsePerformanceChorus(response.data);
}

/**
 * Request Performance Reverb block from the device.
 * 
 * @param {import('./midi.js').MidiManager} midi - MIDI manager
 * @param {number} [deviceId] - Device ID
 * @returns {Promise<object>} Parsed reverb data
 */
export async function requestPerformanceReverb(midi, deviceId) {
  const msg = buildRQ1(
    PERF_TEMP.REVERB.BASE,
    PERF_TEMP.REVERB.SIZE,
    deviceId
  );
  const response = await midi.sendAndReceive(msg);
  return parsePerformanceReverb(response.data);
}

/**
 * Request the Patch Name for a specific Performance Part (Part 1-16).
 * Queried from the part's Temporary Patch Common area.
 * 
 * @param {import('./midi.js').MidiManager} midi - MIDI manager
 * @param {number} part - Part number (1-16)
 * @param {number} [deviceId] - Device ID
 * @returns {Promise<string>} Decoded patch name
 */
export async function requestPartPatchName(midi, part, deviceId) {
  const base = getPatchTempAddress(part);
  const msg = buildRQ1(base, [0x00, 0x00, 0x00, 0x0C], deviceId);
  const response = await midi.sendAndReceive(msg);
  return decodeName(response.data);
}

/**
 * Request a single performance part block (Part 1-16) including its loaded patch name.
 * 
 * @param {import('./midi.js').MidiManager} midi - MIDI manager
 * @param {number} part - Part number (1-16)
 * @param {number} [deviceId] - Device ID
 * @returns {Promise<object>} Parsed part data with patchName property
 */
export async function requestPerformancePart(midi, part, deviceId) {
  const address = getPartAddress(part);
  const msg = buildRQ1(address, PERF_PART.SIZE, deviceId);
  const response = await midi.sendAndReceive(msg);
  const partData = parsePerformancePart(response.data);

  try {
    const patchName = await requestPartPatchName(midi, part, deviceId);
    partData.patchName = patchName || `Part ${part}`;
  } catch (_) {
    partData.patchName = `Part ${part}`;
  }

  return partData;
}

/**
 * Request all 16 performance parts from the device sequentially,
 * querying both part parameters and sound/patch names.
 * 
 * @param {import('./midi.js').MidiManager} midi - MIDI manager
 * @param {number} [deviceId] - Device ID
 * @param {Function} [onProgress] - Callback (completedPartNumber, totalParts, partData)
 * @returns {Promise<object[]>} Array of 16 parsed part objects with patch names
 */
export async function requestAllParts(midi, deviceId, onProgress) {
  const parts = [];
  for (let i = 1; i <= 16; i++) {
    const partData = await requestPerformancePart(midi, i, deviceId);
    parts.push(partData);
    if (onProgress) onProgress(i, 16, partData);
    await new Promise(r => setTimeout(r, 25));
  }
  return parts;
}

/**
 * Request an entire performance in one coordinated operation:
 * Performance Common, Chorus, Reverb, and all 16 Parts + Patch Names.
 * 
 * @param {import('./midi.js').MidiManager} midi - MIDI manager
 * @param {number} [deviceId] - Device ID
 * @param {Function} [onProgress] - Callback (stage, current, total, data)
 * @returns {Promise<{common: object, chorus: object, reverb: object, parts: object[]}>}
 */
export async function requestEntirePerformance(midi, deviceId, onProgress) {
  if (onProgress) onProgress('common', 0, 18, null);
  const common = await requestPerformanceCommon(midi, deviceId);
  await new Promise(r => setTimeout(r, 25));

  if (onProgress) onProgress('chorus', 1, 18, common);
  const chorus = await requestPerformanceChorus(midi, deviceId);
  await new Promise(r => setTimeout(r, 25));

  if (onProgress) onProgress('reverb', 2, 18, chorus);
  const reverb = await requestPerformanceReverb(midi, deviceId);
  await new Promise(r => setTimeout(r, 25));

  const parts = [];
  for (let i = 1; i <= 16; i++) {
    if (onProgress) onProgress('part', 2 + i, 18, null);
    const partData = await requestPerformancePart(midi, i, deviceId);
    parts.push(partData);
    await new Promise(r => setTimeout(r, 25));
  }

  return { common, chorus, reverb, parts };
}

/**
 * Send a performance common parameter to the device.
 * 
 * @param {import('./midi.js').MidiManager} midi - MIDI manager
 * @param {string} paramKey - Key from PERF_TEMP.COMMON.params
 * @param {number} value - Parameter value
 * @param {number} [deviceId] - Device ID
 */
export function sendPerformanceCommonParam(midi, paramKey, value, deviceId) {
  const param = PERF_TEMP.COMMON.params[paramKey];
  if (!param) {
    throw new Error(`Unknown performance common parameter: ${paramKey}`);
  }
  const address = addOffset(PERF_TEMP.COMMON.BASE, param.offset);
  const msg = buildDT1(address, [value & 0x7F], deviceId);
  midi.send(msg);
}

/**
 * Send a performance chorus parameter to the device.
 * 
 * @param {import('./midi.js').MidiManager} midi - MIDI manager
 * @param {string} paramKey - Key from PERF_TEMP.CHORUS.params
 * @param {number} value - Parameter value
 * @param {number} [deviceId] - Device ID
 */
export function sendPerformanceChorusParam(midi, paramKey, value, deviceId) {
  const param = PERF_TEMP.CHORUS.params[paramKey];
  if (!param) {
    throw new Error(`Unknown performance chorus parameter: ${paramKey}`);
  }
  const address = addOffset(PERF_TEMP.CHORUS.BASE, param.offset);
  const msg = buildDT1(address, [value & 0x7F], deviceId);
  midi.send(msg);
}

/**
 * Send a performance reverb parameter to the device.
 * 
 * @param {import('./midi.js').MidiManager} midi - MIDI manager
 * @param {string} paramKey - Key from PERF_TEMP.REVERB.params
 * @param {number} value - Parameter value
 * @param {number} [deviceId] - Device ID
 */
export function sendPerformanceReverbParam(midi, paramKey, value, deviceId) {
  const param = PERF_TEMP.REVERB.params[paramKey];
  if (!param) {
    throw new Error(`Unknown performance reverb parameter: ${paramKey}`);
  }
  const address = addOffset(PERF_TEMP.REVERB.BASE, param.offset);
  const msg = buildDT1(address, [value & 0x7F], deviceId);
  midi.send(msg);
}

/**
 * Send performance name to the device (12 ASCII chars).
 * 
 * @param {import('./midi.js').MidiManager} midi - MIDI manager
 * @param {string} name - Performance name
 * @param {number} [deviceId] - Device ID
 */
export function sendPerformanceName(midi, name, deviceId) {
  const nameBytes = encodeName(name);
  const address = PERF_TEMP.COMMON.BASE;
  const msg = buildDT1(address, nameBytes, deviceId);
  midi.send(msg);
}

/**
 * Send a single performance part parameter to the device.
 * 
 * @param {import('./midi.js').MidiManager} midi - MIDI manager
 * @param {number} part - Part number (1-16)
 * @param {string} paramKey - Key from PERF_PART.params
 * @param {number} value - Parameter value
 * @param {number} [deviceId] - Device ID
 */
export function sendPartParam(midi, part, paramKey, value, deviceId) {
  const param = PERF_PART.params[paramKey];
  if (!param) {
    throw new Error(`Unknown part parameter: ${paramKey}`);
  }
  const partBase = getPartAddress(part);
  const address = addOffset(partBase, param.offset);
  const msg = buildDT1(address, [value & 0x7F], deviceId);
  midi.send(msg);
}

/**
 * Parse raw performance common data bytes.
 * 
 * @param {number[]} data - Raw SysEx payload
 * @returns {object}
 */
export function parsePerformanceCommon(data) {
  if (!data || data.length < 12) {
    throw new Error(`Performance common data too short: ${data?.length} bytes`);
  }
  return {
    name: decodeName(data.slice(0, 12)),
    soloPartSelect: data[0x0C] ?? 0,
    mfxCtrlChannel: data[0x0D] ?? 0,
    mfxCtrlMidi1: data[0x0E] ?? 0,
    mfxCtrlMidi2: data[0x0F] ?? 0,
    mfxASource: data[0x30] ?? 0,
    mfxBSource: data[0x31] ?? 0,
    mfxCSource: data[0x32] ?? 0,
    chorusSource: data[0x33] ?? 0,
    reverbSource: data[0x34] ?? 0,
  };
}

/**
 * Parse raw performance chorus data bytes.
 * 
 * @param {number[]} data - Raw SysEx payload
 * @returns {object}
 */
export function parsePerformanceChorus(data) {
  if (!data || data.length < 4) {
    throw new Error(`Performance chorus data too short: ${data?.length} bytes`);
  }
  return {
    chorusType: data[0x00],
    chorusLevel: data[0x01],
    outputAssign: data[0x02],
    outputSelect: data[0x03],
  };
}

/**
 * Parse raw performance reverb data bytes.
 * 
 * @param {number[]} data - Raw SysEx payload
 * @returns {object}
 */
export function parsePerformanceReverb(data) {
  if (!data || data.length < 3) {
    throw new Error(`Performance reverb data too short: ${data?.length} bytes`);
  }
  return {
    reverbType: data[0x00],
    reverbLevel: data[0x01],
    outputAssign: data[0x02],
  };
}

/**
 * Parse raw performance part data bytes.
 * 
 * @param {number[]} data - Raw SysEx payload
 * @returns {object}
 */
export function parsePerformancePart(data) {
  if (!data || data.length < 0x21) {
    throw new Error(`Part data too short: ${data?.length} bytes`);
  }
  return {
    receiveChannel: data[0x00],
    receiveSwitch: data[0x01],
    receiveMidi1: data[0x02],
    receiveMidi2: data[0x03],
    patchBankMSB: data[0x04],
    patchBankLSB: data[0x05],
    patchPC: data[0x06],
    partLevel: data[0x07],
    partPan: data[0x08],
    coarseTune: data[0x09],
    fineTune: data[0x0A],
    monoPoly: data[0x0B],
    legatoSwitch: data[0x0C],
    pitchBendRange: data[0x0D],
    portamentoSwitch: data[0x0E],
    cutoffOffset: data[0x11],
    resonanceOffset: data[0x12],
    attackTimeOffset: data[0x13],
    releaseTimeOffset: data[0x14],
    octaveShift: data[0x15],
    velocitySensOffset: data[0x16],
    keyRangeLower: data[0x17],
    keyRangeUpper: data[0x18],
    keyFadeLower: data[0x19],
    keyFadeUpper: data[0x1A],
    muteSwitch: data[0x1B],
    drySendLevel: data[0x1C],
    chorusSend: data[0x1D],
    reverbSend: data[0x1E],
    outputAssign: data[0x1F],
    outputMfxSelect: data[0x20],
    decayTimeOffset: data[0x21] ?? 64,
  };
}
