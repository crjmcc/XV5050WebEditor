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
  SETUP,
  SYSTEM,
  MFX_PARAMS,
  CHORUS_PARAMS,
  REVERB_PARAMS,
  getPartAddress,
  getPatchTempAddress,
  getPerfMfxAddress,
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
  const response = (midi && typeof midi.sendAndReceiveWithRetry === 'function')
    ? await midi.sendAndReceiveWithRetry(msg, { maxRetries: 3, timeoutMs: 2500, throttleMs: 30 })
    : await midi.sendAndReceive(msg, 2500);
  return parsePerformanceCommon(response.data || response);
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
  const response = (midi && typeof midi.sendAndReceiveWithRetry === 'function')
    ? await midi.sendAndReceiveWithRetry(msg, { maxRetries: 3, timeoutMs: 2500, throttleMs: 30 })
    : await midi.sendAndReceive(msg, 2500);
  return parsePerformanceChorus(response.data || response);
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
  const response = (midi && typeof midi.sendAndReceiveWithRetry === 'function')
    ? await midi.sendAndReceiveWithRetry(msg, { maxRetries: 3, timeoutMs: 2500, throttleMs: 30 })
    : await midi.sendAndReceive(msg, 2500);
  return parsePerformanceReverb(response.data || response);
}

/**
 * Request Performance MFX block from the device for a slot ('A', 'B', 'C').
 * 
 * @param {import('./midi.js').MidiManager} midi - MIDI manager
 * @param {'A'|'B'|'C'} [slot='A'] - MFX Processor slot
 * @param {number} [deviceId] - Device ID
 * @returns {Promise<object>} Parsed MFX data
 */
export async function requestPerformanceMfx(midi, slot = 'A', deviceId) {
  const address = getPerfMfxAddress(slot);
  const msg = buildRQ1(address, PERF_TEMP.MFXA.SIZE, deviceId);
  const response = (midi && typeof midi.sendAndReceiveWithRetry === 'function')
    ? await midi.sendAndReceiveWithRetry(msg, { maxRetries: 3, timeoutMs: 2500, throttleMs: 30 })
    : await midi.sendAndReceive(msg, 2500);
  return parsePerformanceMfx(response.data || response);
}

/**
 * Send a parameter to a Performance MFX processor slot ('A', 'B', 'C').
 * 
 * @param {import('./midi.js').MidiManager} midi - MIDI manager
 * @param {'A'|'B'|'C'} slot - MFX Processor slot
 * @param {string} paramKey - Key from MFX_PARAMS
 * @param {number} value - Parameter value
 * @param {number} [deviceId] - Device ID
 */
export function sendPerformanceMfxParam(midi, slot, paramKey, value, deviceId) {
  const mfxBase = getPerfMfxAddress(slot);
  const param = MFX_PARAMS[paramKey];
  if (!param) {
    throw new Error(`Unknown performance MFX parameter: ${paramKey}`);
  }
  const address = addOffset(mfxBase, param.offset);

  let dataBytes;
  if (param.size === 4) {
    // 4-nibble word: split into [aaaa, bbbb, cccc, dddd]
    // Raw value in Roland memory is offset by 32768 (0x8000) for signed params
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
 * Send System 2-Band Output EQ parameter to hardware (02 00 02 00).
 * 
 * @param {import('./midi.js').MidiManager} midi - MIDI manager
 * @param {string} paramKey - Key from SYSTEM.EQ.params
 * @param {number} value - Parameter value
 * @param {number} [deviceId] - Device ID
 */
export function sendSystemEqParam(midi, paramKey, value, deviceId) {
  const param = SYSTEM.EQ.params[paramKey];
  if (!param) {
    throw new Error(`Unknown System EQ parameter: ${paramKey}`);
  }
  const address = addOffset(SYSTEM.EQ.BASE, param.offset);
  const msg = buildDT1(address, [value & 0x7F], deviceId);
  midi.send(msg);
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
  const response = (midi && typeof midi.sendAndReceiveWithRetry === 'function')
    ? await midi.sendAndReceiveWithRetry(msg, { maxRetries: 3, timeoutMs: 2500, throttleMs: 30 })
    : await midi.sendAndReceive(msg, 2500);
  return decodeName(response.data || response);
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
  const response = (midi && typeof midi.sendAndReceiveWithRetry === 'function')
    ? await midi.sendAndReceiveWithRetry(msg, { maxRetries: 3, timeoutMs: 2500, throttleMs: 30 })
    : await midi.sendAndReceive(msg, 2500);
  const partData = parsePerformancePart(response.data || response);

  // In Roland XV-5050, Part 10 with Bank MSB 0x5C (92) is a Preset Rhythm Set
  if (part === 10 && partData.patchBankMSB === 0x5C) {
    partData.isRhythm = true;
    partData.patchName = 'Rhythm Kit (Part 10)';
    return partData;
  }

  try {
    const patchName = await requestPartPatchName(midi, part, deviceId);
    partData.patchName = patchName || `Part ${part}`;
  } catch (_) {
    partData.patchName = (part === 10) ? 'Rhythm Kit (Part 10)' : `Part ${part}`;
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
 * Performance Common, MFX-A, Chorus, Reverb, and all 16 Parts + Patch Names.
 * 
 * @param {import('./midi.js').MidiManager} midi - MIDI manager
 * @param {number} [deviceId] - Device ID
 * @param {Function} [onProgress] - Callback (stage, current, total, data)
 * @returns {Promise<{common: object, mfxA: object, chorus: object, reverb: object, parts: object[]}>}
 */
export async function requestEntirePerformance(midi, deviceId, onProgress) {
  if (onProgress) onProgress('common', 0, 19, null);
  const common = await requestPerformanceCommon(midi, deviceId);
  await new Promise(r => setTimeout(r, 25));

  if (onProgress) onProgress('mfxA', 1, 21, common);
  let mfxA = null, mfxB = null, mfxC = null;
  try {
    mfxA = await requestPerformanceMfx(midi, 'A', deviceId);
    await new Promise(r => setTimeout(r, 25));
  } catch (_) {}
  try {
    mfxB = await requestPerformanceMfx(midi, 'B', deviceId);
    await new Promise(r => setTimeout(r, 25));
  } catch (_) {}
  try {
    mfxC = await requestPerformanceMfx(midi, 'C', deviceId);
    await new Promise(r => setTimeout(r, 25));
  } catch (_) {}

  if (onProgress) onProgress('chorus', 4, 21, mfxC || mfxB || mfxA);
  let chorus = null, reverb = null;
  try {
    chorus = await requestPerformanceChorus(midi, deviceId);
    await new Promise(r => setTimeout(r, 25));
  } catch (_) {}

  if (onProgress) onProgress('reverb', 5, 21, chorus || mfxC || mfxB || mfxA);
  try {
    reverb = await requestPerformanceReverb(midi, deviceId);
    await new Promise(r => setTimeout(r, 25));
  } catch (_) {}

  const parts = [];
  for (let i = 1; i <= 16; i++) {
    if (onProgress) onProgress('part', 5 + i, 21, null);
    try {
      const partData = await requestPerformancePart(midi, i, deviceId);
      parts.push(partData);
    } catch (_) {
      parts.push({ part: i, patchName: `Part ${i}` });
    }
    await new Promise(r => setTimeout(r, 25));
  }

  return { common, mfxA, mfxB, mfxC, chorus, reverb, parts };
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
    mfxASource: (data.length > 0x30 ? data[0x30] : 0) ?? 0,
    mfxBSource: (data.length > 0x31 ? data[0x31] : 0) ?? 0,
    mfxCSource: (data.length > 0x32 ? data[0x32] : 0) ?? 0,
    chorusSource: (data.length > 0x33 ? data[0x33] : 0) ?? 0,
    reverbSource: (data.length > 0x34 ? data[0x34] : 0) ?? 0,
  };
}

/**
 * Parse raw performance MFX data bytes (Table 1-3-2).
 * 
 * @param {number[]} data - Raw SysEx payload
 * @returns {object}
 */
export function parsePerformanceMfx(data) {
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
    preDelay: data[0x04] ?? 0,
    rate: data[0x05] ?? 0,
    depth: data[0x06] ?? 0,
    feedback: data[0x07] ?? 0,
    revSend: data[0x08] ?? 0,
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
    time: data[0x04] ?? 0,
    hfDamp: data[0x05] ?? 0,
    preDelay: data[0x07] ?? 0,
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

/**
 * Switch synthesizer Sound Mode (Patch mode vs Performance mode).
 * 
 * @param {import('./midi.js').MidiManager} midi - MIDI manager
 * @param {number} mode - 1 = PATCH, 2 = PERFORM, 3 = GM1, 4 = GM2, 5 = GS
 * @param {number} [deviceId] - Device ID
 */
export function sendSoundMode(midi, mode, deviceId) {
  const address = SETUP.BASE; // 01 00 00 00
  const msg = buildDT1(address, [mode & 0x7F], deviceId);
  midi.send(msg);
}

/**
 * Request current synthesizer Sound Mode from Setup area (01 00 00 00).
 * 
 * @param {import('./midi.js').MidiManager} midi - MIDI manager
 * @param {number} [deviceId] - Device ID
 * @returns {Promise<number>} Sound Mode (1=PATCH, 2=PERFORM, etc.)
 */
export async function requestSoundMode(midi, deviceId) {
  const msg = buildRQ1(SETUP.BASE, [0x00, 0x00, 0x00, 0x01], deviceId);
  const response = (midi && typeof midi.sendAndReceiveWithRetry === 'function')
    ? await midi.sendAndReceiveWithRetry(msg, { maxRetries: 3, timeoutMs: 2500, throttleMs: 30 })
    : await midi.sendAndReceive(msg, 2500);
  return (response.data || response)?.[0] ?? 2;
}

/**
 * Command the physical XV-5050 hardware to switch its active Performance.
 * Writes to Setup Area (01 00 00 04: MSB=85, LSB=0, PC=perfIndex-1)
 * and transmits Bank Select & Program Change to hardware.
 * 
 * @param {import('./midi.js').MidiManager} midi - MIDI manager
 * @param {number} perfIndex - 1-based User Performance number (1-64)
 * @param {number} [deviceId] - Roland Device ID
 */
export function sendActivePerformanceSelection(midi, perfIndex, deviceId = 0x10, perfCtrlCh = null) {
  if (perfIndex < 1 || perfIndex > 64) {
    throw new Error(`User Performance index must be 1-64, got ${perfIndex}`);
  }
  const pc = (perfIndex - 1) & 0x7F;
  // 1. SysEx DT1 to Setup Area: PERF_BANK_MSB, PERF_BANK_LSB, PERF_PROGRAM_NUM
  // Address: 01 00 00 04, Data: 0x55 (85 = User Perf Bank), 0x00, pc
  const setupAddress = [0x01, 0x00, 0x00, 0x04];
  const dt1Msg = buildDT1(setupAddress, [0x55, 0x00, pc], deviceId);
  midi.send(dt1Msg);

  // 2. Standard MIDI Bank Select + Program Change
  // Default Performance Control Channel is Channel 16 (0-indexed: 15) and Channel 1 (0-indexed: 0)
  const channels = new Set([15, 0]);
  if (typeof perfCtrlCh === 'number' && perfCtrlCh >= 0 && perfCtrlCh <= 15) {
    channels.add(perfCtrlCh);
  }
  for (const ch of channels) {
    midi.send([0xB0 | ch, 0x00, 0x55]); // Bank Select MSB (85 = User Performance)
    midi.send([0xB0 | ch, 0x20, 0x00]); // Bank Select LSB (0)
    midi.send([0xC0 | ch, pc]);         // Program Change
  }
}

/**
 * Command the physical XV-5050 hardware to switch its active Patch in Single Patch Mode.
 * Writes to Setup Area (01 00 00 07: MSB=87, LSB=0, PC=patchIndex-1)
 * and transmits Bank Select & Program Change to Channel 1.
 * 
 * @param {import('./midi.js').MidiManager} midi - MIDI manager
 * @param {number} patchIndex - 1-based User Patch number (1-128)
 * @param {number} [deviceId] - Roland Device ID
 */
export function sendActivePatchSelection(midi, patchIndex, deviceId = 0x10) {
  if (patchIndex < 1 || patchIndex > 128) {
    throw new Error(`User Patch index must be 1-128, got ${patchIndex}`);
  }
  const pc = (patchIndex - 1) & 0x7F;
  // 1. SysEx DT1 to Setup Area: PATCH_BANK_MSB, PATCH_BANK_LSB, PATCH_PROGRAM_NUM
  // Address: 01 00 00 07, Data: 0x57 (87 = User Patch Bank), 0x00, pc
  const setupAddress = [0x01, 0x00, 0x00, 0x07];
  const dt1Msg = buildDT1(setupAddress, [0x57, 0x00, pc], deviceId);
  midi.send(dt1Msg);

  // 2. Standard MIDI Bank Select + Program Change on Channel 1
  midi.send([0xB0, 0x00, 0x57]); // Bank Select MSB (87 = User Patch Bank)
  midi.send([0xB0, 0x20, 0x00]); // Bank Select LSB (0)
  midi.send([0xC0, pc]);         // Program Change
}

/**
 * Assign a User Patch to a specific Performance Part (1-16) on the hardware.
 * Writes to Part's parameters (10 00 2x 04: MSB=87, LSB=0, PC=patchIndex-1).
 * 
 * @param {import('./midi.js').MidiManager} midi - MIDI manager
 * @param {number} part - Part number (1-16)
 * @param {number} patchIndex - 1-based User Patch number (1-128)
 * @param {number} [deviceId] - Roland Device ID
 */
export function sendPartPatchSelection(midi, part, patchIndex, deviceId = 0x10) {
  if (part < 1 || part > 16) {
    throw new Error(`Part number must be 1-16, got ${part}`);
  }
  if (patchIndex < 1 || patchIndex > 128) {
    throw new Error(`User Patch index must be 1-128, got ${patchIndex}`);
  }
  const pc = (patchIndex - 1) & 0x7F;
  const partAddr = [0x10, 0x00, 0x20 + (part - 1), 0x04];
  const dt1Msg = buildDT1(partAddr, [0x57, 0x00, pc], deviceId);
  midi.send(dt1Msg);

  // Also send Channel Bank Select and Program Change on that Part's channel
  const ch = (part - 1) & 0x0F;
  midi.send([0xB0 | ch, 0x00, 0x57]);
  midi.send([0xB0 | ch, 0x20, 0x00]);
  midi.send([0xC0 | ch, pc]);
}


