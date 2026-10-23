/**
 * XV-5050 Web Editor — Full Unit SysEx Dump & Synchronization Engine
 * 
 * Orchestrates complete reads from the connected XV-5050 synthesizer:
 * - Setup (01 00 00 00)
 * - System Common & EQ (02 00 00 00 & 02 00 02 00)
 * - Temporary Performance & All 16 Parts (10 00 00 00)
 * - Active Temporary Patches for Parts 1-16 (11 00 00 00 - 14 60 00 00)
 * - All 64 User Performances (20 00 00 00 - 20 3F 00 00)
 * - All 128 User Patches (30 00 00 00 - 30 7F 00 00)
 * - All 4 User Rhythm Sets (40 00 00 00 - 40 30 00 00)
 */

import { buildRQ1, buildDT1, parseSysEx } from './sysex.js';
import {
  SETUP,
  SYSTEM,
  PERF_TEMP,
  PATCH_COMMON,
  PATCH_TMT,
  PATCH_TONE,
  getUserPerformanceAddress,
  getUserPatchAddress,
  getUserRhythmAddress,
  getPartAddress,
  getPatchTempAddress,
  getPatchTMTAddress,
  getToneAddress,
} from './addresses.js';
import { decodeName, encodeName } from './parameters.js';
import {
  requestPerformanceCommon,
  requestPerformanceChorus,
  requestPerformanceReverb,
  requestPerformanceMfx,
  requestAllParts,
  parsePerformanceCommon,
} from './performance.js';
import {
  requestPatchCommon,
  requestPatchTMT,
  requestPatchTone,
  requestPatchMfx,
  requestPatchChorus,
  requestPatchReverb,
  parsePatchCommon,
  parsePatchTone,
} from './patch.js';
import { exportToSyx, parseSyxFile } from './librarian.js';
import { sendAndReceiveWithRetry } from './usb_hardware.js';

// =============================================================================
// Parsing Helpers
// =============================================================================

export function parseSetup(data) {
  if (!data || data.length < 15) return {};
  return {
    raw: data,
    soundMode: data[0x00],
    perfBankMsb: data[0x04] !== undefined && data[0x04] !== 0 ? data[0x04] : data[0x00],
    perfBankLsb: data[0x05] !== undefined ? data[0x05] : data[0x01],
    perfProgramNum: data[0x06] !== undefined ? data[0x06] : data[0x02],
    patchBankMsb: data[0x07] !== undefined ? data[0x07] : data[0x03],
    patchBankLsb: data[0x08] !== undefined ? data[0x08] : data[0x04],
    patchProgramNum: data[0x09] !== undefined ? data[0x09] : data[0x05],
    mfxSwitch: data[0x0A],
    chorusSwitch: data[0x0B],
    reverbSwitch: data[0x0C],
    transpose: (data[0x0D] ?? 64) - 64,
    octaveShift: (data[0x0E] ?? 64) - 64,
  };
}

export function parseSystemCommon(data) {
  if (!data || data.length < 33) return {};
  return {
    raw: data,
    masterKeyShift: (data[0x04] ?? 64) - 64,
    masterLevel: data[0x05] ?? 127,
    scaleTuneSwitch: data[0x06] ?? 0,
    patchRemain: data[0x07] ?? 0,
    mixParallel: data[0x08] ?? 0,
    perfCtrlChannel: data[0x09] ?? 16,
    patchReceiveChannel: data[0x0B] ?? 0,
    receivePC: data[0x1C] ?? 1,
    receiveBank: data[0x1D] ?? 1,
    clockSource: data[0x1E] ?? 0,
    systemTempo: ((data[0x1F] ?? 0) << 4) | (data[0x20] ?? 0),
  };
}

export function parseSystemEQ(data) {
  if (!data || data.length < 17) return {};
  return {
    raw: data,
    eqSwitch: data[0x00],
    eq1LowFreq: data[0x01],
    eq1LowGain: (data[0x02] ?? 15) - 15,
    eq1HighFreq: data[0x03],
    eq1HighGain: (data[0x04] ?? 15) - 15,
    eq2LowFreq: data[0x05],
    eq2LowGain: (data[0x06] ?? 15) - 15,
    eq2HighFreq: data[0x07],
    eq2HighGain: (data[0x08] ?? 15) - 15,
    eq3LowFreq: data[0x09],
    eq3LowGain: (data[0x0A] ?? 15) - 15,
    eq3HighFreq: data[0x0B],
    eq3HighGain: (data[0x0C] ?? 15) - 15,
    eq4LowFreq: data[0x0D],
    eq4LowGain: (data[0x0E] ?? 15) - 15,
    eq4HighFreq: data[0x0F],
    eq4HighGain: (data[0x10] ?? 15) - 15,
  };
}

export function parseUserPerformanceHeader(data, index) {
  if (!data || data.length < 12) return { index, name: `User Perf ${index}` };
  return {
    index,
    raw: data,
    name: decodeName(data.slice(0, 12)) || `USER PERF ${index}`,
    soloPart: data[0x0C] ?? 0,
    mfxCtrlChannel: data[0x0D] ?? 0,
    mfxSource: (data.length > 0x30 ? data[0x30] : 0) ?? 0,
    chorusSource: (data.length > 0x33 ? data[0x33] : 0) ?? 0,
    reverbSource: (data.length > 0x34 ? data[0x34] : 0) ?? 0,
  };
}

export function parseUserPatchHeader(data, index) {
  if (!data || data.length < 12) return { index, name: `User Patch ${index}` };
  return {
    index,
    raw: data,
    name: decodeName(data.slice(0, 12)) || `USER PATCH ${index}`,
    category: data[0x0C] ?? 0,
    level: data[0x0E] ?? 127,
    pan: data[0x0F] ?? 64,
    poly: data[0x16] ?? 1,
  };
}

export function parseUserRhythmHeader(data, index) {
  if (!data || data.length < 18) return { index, name: `User Rhythm ${index}` };
  return {
    index,
    raw: data,
    name: decodeName(data.slice(0, 12)) || `USER DRUM ${index}`,
  };
}

// =============================================================================
// Hardware SysEx Requests
// =============================================================================

function extractData(resp) {
  if (!resp) return null;
  if (resp.data) return resp.data;
  const parsed = parseSysEx(resp);
  return parsed?.data || null;
}

export async function requestSetup(midiManager, deviceId = 0x10) {
  const rq1 = buildRQ1(SETUP.BASE, SETUP.SIZE, deviceId);
  const resp = await sendAndReceiveWithRetry(midiManager, rq1);
  return parseSetup(extractData(resp));
}

export async function requestSystemCommon(midiManager, deviceId = 0x10) {
  const rq1 = buildRQ1(SYSTEM.COMMON.BASE, SYSTEM.COMMON.SIZE, deviceId);
  const resp = await sendAndReceiveWithRetry(midiManager, rq1);
  return parseSystemCommon(extractData(resp));
}

export async function requestSystemEQ(midiManager, deviceId = 0x10) {
  const rq1 = buildRQ1(SYSTEM.EQ.BASE, SYSTEM.EQ.SIZE, deviceId);
  const resp = await sendAndReceiveWithRetry(midiManager, rq1);
  return parseSystemEQ(extractData(resp));
}

export async function requestUserPerformanceHeader(midiManager, perfIndex, deviceId = 0x10) {
  const addr = getUserPerformanceAddress(perfIndex);
  const rq1 = buildRQ1(addr, PERF_TEMP.COMMON.SIZE, deviceId);
  const resp = await sendAndReceiveWithRetry(midiManager, rq1);
  return parseUserPerformanceHeader(extractData(resp), perfIndex);
}

export async function requestAllUserPerformanceHeaders(midiManager, deviceId = 0x10, onProgress = null) {
  const performances = [];
  const total = 64;

  for (let i = 1; i <= total; i++) {
    const perf = await requestUserPerformanceHeader(midiManager, i, deviceId);
    performances.push(perf);
    if (typeof onProgress === 'function') {
      onProgress(i, total, perf);
    }
  }

  return performances;
}

export async function requestUserPatchHeader(midiManager, patchIndex, deviceId = 0x10) {
  const addr = getUserPatchAddress(patchIndex);
  const rq1 = buildRQ1(addr, PATCH_COMMON.SIZE, deviceId);
  const resp = await sendAndReceiveWithRetry(midiManager, rq1);
  return parseUserPatchHeader(extractData(resp), patchIndex);
}

export async function requestAllUserPatchHeaders(midiManager, deviceId = 0x10, onProgress = null) {
  const patches = [];
  const total = 128;

  for (let i = 1; i <= total; i++) {
    const patch = await requestUserPatchHeader(midiManager, i, deviceId);
    patches.push(patch);
    if (typeof onProgress === 'function') {
      onProgress(i, total, patch);
    }
  }

  return patches;
}

export async function requestUserRhythmHeader(midiManager, rhythmIndex, deviceId = 0x10) {
  const addr = getUserRhythmAddress(rhythmIndex);
  const rq1 = buildRQ1(addr, [0x00, 0x00, 0x00, 0x12], deviceId);
  const resp = await sendAndReceiveWithRetry(midiManager, rq1);
  return parseUserRhythmHeader(extractData(resp), rhythmIndex);
}

// =============================================================================
// Multi-Stage Master Unit Sync
// =============================================================================

/**
 * Execute full sync with XV-5050 hardware:
 * 1. Setup & System Common/EQ
 * 2. Current Performance & 16 Parts
 * 3. Patches for all active parts (Common, Structure, 4 Tones with Waveforms)
 * 4. All 64 User Performances
 * 5. All 128 User Patches
 * 6. User Rhythm Sets
 * 
 * @param {object} midiManager - MidiManager instance
 * @param {number} [deviceId=0x10] - Device ID
 * @param {function} [onProgress] - Callback (percent, statusText, stageKey)
 * @returns {Promise<object>} Complete Unit Database
 */
export async function syncEntireUnit(midiManager, deviceId = 0x10, onProgress = null) {
  const report = (pct, text, stage) => {
    if (typeof onProgress === 'function') {
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
    timestamp: Date.now(),
  };

  // ---------------------------------------------------------------------------
  // Stage 1: Setup & System (0% - 10%)
  // ---------------------------------------------------------------------------
  report(2, 'Reading Setup parameters...', 'setup_system');
  unitDb.setup = await requestSetup(midiManager, deviceId);

  report(5, 'Reading System Common...', 'setup_system');
  unitDb.system.common = await requestSystemCommon(midiManager, deviceId);

  report(8, 'Reading System EQ...', 'setup_system');
  unitDb.system.eq = await requestSystemEQ(midiManager, deviceId);

  // ---------------------------------------------------------------------------
  // Stage 2: Current Performance & 16 Parts (10% - 35%)
  // ---------------------------------------------------------------------------
  report(12, 'Reading Current Performance Common...', 'current_performance');
  unitDb.currentPerformance.common = await requestPerformanceCommon(midiManager, deviceId);

  report(14, 'Reading Performance MFX Processors...', 'current_performance');
  try { unitDb.currentPerformance.mfxA = await requestPerformanceMfx(midiManager, 'A', deviceId); } catch (_) {}
  try { unitDb.currentPerformance.mfxB = await requestPerformanceMfx(midiManager, 'B', deviceId); } catch (_) {}
  try { unitDb.currentPerformance.mfxC = await requestPerformanceMfx(midiManager, 'C', deviceId); } catch (_) {}

  report(16, 'Reading Performance Effects...', 'current_performance');
  try { unitDb.currentPerformance.chorus = await requestPerformanceChorus(midiManager, deviceId); } catch (_) {}
  try { unitDb.currentPerformance.reverb = await requestPerformanceReverb(midiManager, deviceId); } catch (_) {}

  report(18, 'Reading 16 Performance Parts...', 'current_performance');
  unitDb.currentPerformance.parts = await requestAllParts(midiManager, deviceId, (done, total, part) => {
    const pct = 18 + Math.round((done / total) * 17);
    report(pct, `Reading Part ${done}/${total}: "${part.patchName}"`, 'current_performance');
  });

  // ---------------------------------------------------------------------------
  // Stage 3: Active Patches for Parts 1-16 (35% - 55%)
  // ---------------------------------------------------------------------------
  report(36, 'Reading Active Part Patches & Waveforms...', 'active_patches');
  for (let p = 1; p <= 16; p++) {
    const pct = 36 + Math.round((p / 16) * 19);
    report(pct, `Reading Part ${p}/16 Patch & Effects...`, 'active_patches');

    const partInfo = unitDb.currentPerformance?.parts?.[p - 1];
    const isRhythm = partInfo?.isRhythm || (p === 10 && partInfo?.patchBankMSB === 0x5C);

    if (isRhythm) {
      unitDb.activePatches.push({
        part: p,
        isRhythm: true,
        common: { name: partInfo?.patchName || `Part ${p} (Rhythm Kit)` },
        mfx: null,
        chorus: null,
        reverb: null,
        tmt: null,
        tones: [],
      });
      continue;
    }

    try {
      const pCommon = await requestPatchCommon(midiManager, p, deviceId);
      let pMfx = null, pCho = null, pRev = null;
      if (p === 1) {
        try { pMfx = await requestPatchMfx(midiManager, p, deviceId); } catch (_) {}
        try { pCho = await requestPatchChorus(midiManager, p, deviceId); } catch (_) {}
        try { pRev = await requestPatchReverb(midiManager, p, deviceId); } catch (_) {}
      }

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
        mfx: pMfx,
        chorus: pCho,
        reverb: pRev,
        tmt: pTmt,
        tones,
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
        tones: [],
      });
    }
  }

  // ---------------------------------------------------------------------------
  // Stage 4: 64 User Performances (55% - 75%)
  // ---------------------------------------------------------------------------
  report(56, 'Reading 64 User Performances...', 'user_performances');
  unitDb.userPerformances = [];
  await requestAllUserPerformanceHeaders(midiManager, deviceId, (done, total, perf) => {
    unitDb.userPerformances.push(perf);
    const pct = 56 + Math.round((done / total) * 19);
    report(pct, `User Performance ${done}/${total}: "${perf.name}"`, 'user_performances');
  });

  // ---------------------------------------------------------------------------
  // Stage 5: 128 User Patches (75% - 95%)
  // ---------------------------------------------------------------------------
  report(76, 'Reading 128 User Patches...', 'user_patches');
  unitDb.userPatches = [];
  await requestAllUserPatchHeaders(midiManager, deviceId, (done, total, patch) => {
    unitDb.userPatches.push(patch);
    const pct = 76 + Math.round((done / total) * 19);
    report(pct, `User Patch ${done}/${total}: "${patch.name}"`, 'user_patches');
  });

  // ---------------------------------------------------------------------------
  // Stage 6: User Rhythm Sets (95% - 100%)
  // ---------------------------------------------------------------------------
  report(96, 'Reading User Rhythm Sets...', 'user_rhythms');
  for (let r = 1; r <= 4; r++) {
    const rSet = await requestUserRhythmHeader(midiManager, r, deviceId);
    unitDb.userRhythms.push(rSet);
    report(96 + r, `User Rhythm ${r}/4: "${rSet.name}"`, 'user_rhythms');
  }

  report(100, 'Entire Unit Sync Complete!', 'complete');
  return unitDb;
}

// =============================================================================
// Full Unit SysEx Backup Import & Export
// =============================================================================

export function exportFullUnitBackup(unitDb, deviceId = 0x10) {
  const packets = [];

  // Setup
  if (unitDb.setup?.raw) {
    packets.push(buildDT1(SETUP.BASE, unitDb.setup.raw, deviceId));
  }

  // System Common & EQ
  if (unitDb.system?.common?.raw) {
    packets.push(buildDT1(SYSTEM.COMMON.BASE, unitDb.system.common.raw, deviceId));
  }
  if (unitDb.system?.eq?.raw) {
    packets.push(buildDT1(SYSTEM.EQ.BASE, unitDb.system.eq.raw, deviceId));
  }

  // Current Performance
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

  // Active Patches
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

  // User Performances
  if (Array.isArray(unitDb.userPerformances)) {
    for (const up of unitDb.userPerformances) {
      if (up.raw) {
        packets.push(buildDT1(getUserPerformanceAddress(up.index), up.raw, deviceId));
      }
    }
  }

  // User Patches
  if (Array.isArray(unitDb.userPatches)) {
    for (const up of unitDb.userPatches) {
      if (up.raw) {
        packets.push(buildDT1(getUserPatchAddress(up.index), up.raw, deviceId));
      }
    }
  }

  // User Rhythms
  if (Array.isArray(unitDb.userRhythms)) {
    for (const ur of unitDb.userRhythms) {
      if (ur.raw) {
        packets.push(buildDT1(getUserRhythmAddress(ur.index), ur.raw, deviceId));
      }
    }
  }

  return exportToSyx(packets);
}

export function importFullUnitBackup(syxData) {
  const parsedPackets = parseSyxFile(syxData);
  const unitDb = {
    setup: null,
    system: { common: null, eq: null },
    currentPerformance: { common: null, parts: [] },
    activePatches: [],
    userPerformances: [],
    userPatches: [],
    userRhythms: [],
    timestamp: Date.now(),
  };

  for (const pkt of parsedPackets) {
    if (!pkt.valid || pkt.command !== 0x12) continue; // Must be DT1

    const [a0, a1, a2, a3] = pkt.address;

    // Setup: 01 00 00 00
    if (a0 === 0x01 && a1 === 0x00 && a2 === 0x00 && a3 === 0x00) {
      unitDb.setup = parseSetup(pkt.data);
    }
    // System Common: 02 00 00 00
    else if (a0 === 0x02 && a1 === 0x00 && a2 === 0x00 && a3 === 0x00) {
      unitDb.system.common = parseSystemCommon(pkt.data);
    }
    // System EQ: 02 00 02 00
    else if (a0 === 0x02 && a1 === 0x00 && a2 === 0x02 && a3 === 0x00) {
      unitDb.system.eq = parseSystemEQ(pkt.data);
    }
    // User Performance: 20 xx 00 00 (xx = 0 to 63)
    else if (a0 === 0x20 && a2 === 0x00 && a3 === 0x00) {
      const perfIndex = a1 + 1;
      unitDb.userPerformances.push(parseUserPerformanceHeader(pkt.data, perfIndex));
    }
    // User Patch: 30 xx 00 00 (xx = 0 to 127)
    else if (a0 === 0x30 && a2 === 0x00 && a3 === 0x00) {
      const patchIndex = a1 + 1;
      unitDb.userPatches.push(parseUserPatchHeader(pkt.data, patchIndex));
    }
    // User Rhythm: 40 xx 00 00
    else if (a0 === 0x40 && a2 === 0x00 && a3 === 0x00) {
      const rhythmIndex = Math.floor(a1 / 0x10) + 1;
      unitDb.userRhythms.push(parseUserRhythmHeader(pkt.data, rhythmIndex));
    }
  }

  // Sort user banks by index
  unitDb.userPerformances.sort((a, b) => a.index - b.index);
  unitDb.userPatches.sort((a, b) => a.index - b.index);
  unitDb.userRhythms.sort((a, b) => a.index - b.index);

  return unitDb;
}
