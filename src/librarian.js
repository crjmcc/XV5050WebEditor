/**
 * XV-5050 Web Editor — Librarian & SysEx File Management
 * 
 * Handles importing and exporting standard .syx files, creating bulk dump packets,
 * and managing in-browser patch/performance storage.
 */

import { parseSysEx, buildDT1, SYSEX_START, SYSEX_END } from './sysex.js';
import { getPatchTempAddress, getPatchTMTAddress } from './addresses.js';

/**
 * Serialize an array of SysEx packets into a single binary Uint8Array suitable for .syx download.
 * 
 * @param {Array<Uint8Array|number[]>} packets - Array of SysEx messages
 * @returns {Uint8Array} Continuous byte buffer
 */
export function exportToSyx(packets) {
  if (!Array.isArray(packets)) {
    throw new Error('Packets must be an array');
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

/**
 * Parse a raw binary .syx file byte stream into individual validated SysEx packets.
 * 
 * @param {Uint8Array|number[]} fileData - Binary content of .syx file
 * @returns {Array<object>} Array of parsed SysEx message objects
 */
export function parseSyxFile(fileData) {
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

/**
 * Create a multi-packet DT1 SysEx dump for a patch (Common + TMT).
 * 
 * @param {number} part - Part number (0 for Single mode, 1-16 for performance part)
 * @param {number[]} commonData - 79-byte Patch Common data
 * @param {number[]} tmtData - 41-byte Patch TMT data
 * @param {number} [deviceId=0x10] - Device ID
 * @returns {Uint8Array[]} Array of 2 SysEx packets (Common, TMT)
 */
export function createPatchSyxDump(part, commonData, tmtData, deviceId = 0x10) {
  const patchBase = getPatchTempAddress(part);
  const tmtBase = getPatchTMTAddress(patchBase);

  const packet1 = buildDT1(patchBase, commonData, deviceId);
  const packet2 = buildDT1(tmtBase, tmtData, deviceId);

  return [packet1, packet2];
}

/**
 * Create a multi-packet DT1 SysEx dump for a performance.
 * 
 * @param {number[]} commonData - Performance Common data
 * @param {number[]} chorusData - Performance Chorus data
 * @param {number[]} reverbData - Performance Reverb data
 * @param {Array<number[]>} partsData - Array of 16 part data arrays
 * @param {number} [deviceId=0x10] - Device ID
 * @returns {Uint8Array[]} Array of SysEx packets
 */
export function createPerformanceSyxDump(commonData, chorusData, reverbData, partsData, deviceId = 0x10) {
  const packets = [];

  // Performance Common
  packets.push(buildDT1([0x10, 0x00, 0x00, 0x00], commonData, deviceId));

  // Chorus & Reverb
  if (chorusData) {
    packets.push(buildDT1([0x10, 0x00, 0x04, 0x00], chorusData, deviceId));
  }
  if (reverbData) {
    packets.push(buildDT1([0x10, 0x00, 0x06, 0x00], reverbData, deviceId));
  }

  // Parts 1-16
  if (Array.isArray(partsData)) {
    for (let p = 0; p < partsData.length; p++) {
      const partAddr = [0x10, 0x00, 0x20 + p, 0x00];
      packets.push(buildDT1(partAddr, partsData[p], deviceId));
    }
  }

  return packets;
}

// =============================================================================
// Local Storage Library Management
// =============================================================================

const STORAGE_KEY_PATCHES = 'xv5050_user_patches';
const STORAGE_KEY_PERFS = 'xv5050_user_perfs';

export function getLocalPatches() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY_PATCHES);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

export function saveLocalPatch(name, patchData) {
  const list = getLocalPatches();
  const entry = {
    id: 'patch_' + Date.now(),
    name: name || 'UNTITLED',
    date: new Date().toISOString(),
    data: patchData,
  };
  list.unshift(entry);
  localStorage.setItem(STORAGE_KEY_PATCHES, JSON.stringify(list));
  return entry;
}

export function deleteLocalPatch(id) {
  const list = getLocalPatches().filter(p => p.id !== id);
  localStorage.setItem(STORAGE_KEY_PATCHES, JSON.stringify(list));
}
