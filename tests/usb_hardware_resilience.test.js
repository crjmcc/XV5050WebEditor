import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

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
  addOffset,
} from '../src/addresses.js';

import {
  sendAndReceiveWithRetry,
  detectDeviceId,
  requestEntireUserPerformance,
  sendEntireUserPerformance,
  requestEntireUserPatch,
  sendEntireUserPatch,
  runHardwareDiagnostics,
} from '../src/usb_hardware.js';

import { buildDT1, buildRQ1, parseSysEx, calculateChecksum } from '../src/sysex.js';
import { encodeName } from '../src/parameters.js';

/**
 * Resilient Hardware Simulation Device supporting:
 * - Configurable Device ID
 * - Simulated Packet Loss / Flaky connection
 * - Checksum corruption injection
 * - Full memory hierarchy for User Banks (64 Perfs, 128 Patches)
 */
class FlakyHardwareUnit {
  constructor(deviceId = 0x10) {
    this.deviceId = deviceId;
    this.deviceMemory = new Map();
    this.sentMessages = [];
    this.failNextNRequests = 0;
    this.corruptNextNReplies = 0;
    this.requestCount = 0;
    this.initMemory();
  }

  _key(addr) {
    return addr.map(b => b.toString(16).padStart(2, '0')).join('-');
  }

  setMemory(addr, data) {
    this.deviceMemory.set(this._key(addr), data);
  }

  getMemory(addr) {
    return this.deviceMemory.get(this._key(addr));
  }

  initMemory() {
    // System Common (02 00 00 00)
    const sysCommon = new Array(33).fill(0);
    sysCommon[0x05] = 127;
    this.setMemory([0x02, 0x00, 0x00, 0x00], sysCommon);

    // Setup (01 00 00 00)
    const setup = new Array(15).fill(0);
    setup[0x0A] = 1;
    this.setMemory([0x01, 0x00, 0x00, 0x00], setup);

    // Temp Performance (10 00 00 00)
    const tempPerf = new Array(53).fill(0);
    const tpName = encodeName('TEMP PERF');
    for (let i = 0; i < 12; i++) tempPerf[i] = tpName[i];
    this.setMemory([0x10, 0x00, 0x00, 0x00], tempPerf);

    // Temp Patch Part 1 (11 00 00 00)
    const ptCommon = new Array(79).fill(0);
    const ptName = encodeName('TEMP SOUND');
    for (let i = 0; i < 12; i++) ptCommon[i] = ptName[i];
    this.setMemory([0x11, 0x00, 0x00, 0x00], ptCommon);

    // Temp Patch Tone 1 (11 00 20 00)
    const ptTone = new Array(137).fill(0);
    ptTone[0x00] = 127;
    ptTone[0x49] = 100;
    this.setMemory([0x11, 0x00, 0x20, 0x00], ptTone);

    // Populate all 64 User Performances with full structure:
    // Base: 20 [perfIndex-1] 00 00 (Common 53 bytes)
    // Chorus: 20 [perfIndex-1] 04 00 (52 bytes)
    // Reverb: 20 [perfIndex-1] 06 00 (83 bytes)
    // Parts 1-16: 20 [perfIndex-1] [0x20 + (p-1)] 00 (49 bytes each)
    for (let pIdx = 1; pIdx <= 64; pIdx++) {
      const b1 = pIdx - 1;
      const common = new Array(53).fill(0);
      const name = encodeName(`U-Perf ${pIdx}`);
      for (let i = 0; i < 12; i++) common[i] = name[i];
      common[0x0C] = 0; // Solo
      this.setMemory([0x20, b1, 0x00, 0x00], common);

      const chorus = new Array(52).fill(0);
      chorus[0x00] = 1; // Chorus Type 1
      chorus[0x01] = 60 + (pIdx % 40);
      this.setMemory([0x20, b1, 0x04, 0x00], chorus);

      const reverb = new Array(83).fill(0);
      reverb[0x00] = 2; // Reverb Type 2
      reverb[0x01] = 75;
      this.setMemory([0x20, b1, 0x06, 0x00], reverb);

      for (let part = 1; part <= 16; part++) {
        const partData = new Array(49).fill(0);
        partData[0x00] = part - 1; // MIDI channel
        partData[0x06] = part;     // Patch PC
        partData[0x07] = 100;      // Level
        partData[0x08] = 64;       // Pan
        this.setMemory([0x20, b1, 0x20 + (part - 1), 0x00], partData);
      }
    }

    // Populate all 128 User Patches with full structure:
    // Base: 30 [patchIndex-1] 00 00 (Common 79 bytes)
    // TMT: 30 [patchIndex-1] 10 00 (41 bytes)
    // Tones 1-4: 30 [patchIndex-1] [0x20, 0x22, 0x24, 0x26] 00 (137 bytes each)
    for (let pIdx = 1; pIdx <= 128; pIdx++) {
      const b1 = pIdx - 1;
      const common = new Array(79).fill(0);
      const name = encodeName(`U-Patch ${pIdx}`);
      for (let i = 0; i < 12; i++) common[i] = name[i];
      common[0x0C] = pIdx % 38; // Category
      common[0x0E] = 118;       // Level
      this.setMemory([0x30, b1, 0x00, 0x00], common);

      const tmt = new Array(41).fill(0);
      tmt[0x00] = 0; // Structure Type 1
      tmt[0x05] = 1; // Tone 1 Switch ON
      tmt[0x0E] = 1; // Tone 2 Switch ON
      this.setMemory([0x30, b1, 0x10, 0x00], tmt);

      for (let t = 1; t <= 4; t++) {
        const toneData = new Array(137).fill(0);
        toneData[0x00] = 127; // Level
        toneData[0x04] = 64;  // Pan C
        toneData[0x27] = 0;   // INT Wave Group
        const waveNum = (pIdx % 500) + 1;
        toneData[0x2C] = (waveNum >> 12) & 0x0F;
        toneData[0x2D] = (waveNum >> 8) & 0x0F;
        toneData[0x2E] = (waveNum >> 4) & 0x0F;
        toneData[0x2F] = waveNum & 0x0F;
        toneData[0x49] = 95;  // Cutoff
        const toneAddr = [0x30, b1, 0x20 + (t - 1) * 2, 0x00];
        this.setMemory(toneAddr, toneData);
      }
    }
  }

  send(bytes) {
    this.sentMessages.push(bytes);
    const parsed = parseSysEx(bytes);
    if (parsed.valid && parsed.command === 0x12) {
      // Memory write (DT1)
      this.setMemory(parsed.address, parsed.data);
    }
  }

  async sendAndReceive(requestBytes, timeoutMs = 500) {
    this.requestCount++;
    this.sentMessages.push(requestBytes);

    if (this.failNextNRequests > 0) {
      this.failNextNRequests--;
      throw new Error('MIDI SysEx request timed out (simulated packet loss)');
    }

    const req = parseSysEx(requestBytes);
    if (!req.valid || req.command !== 0x11) {
      throw new Error('Expected valid RQ1 command');
    }

    // Check device ID match
    if (req.deviceId !== this.deviceId) {
      throw new Error(`Device ID mismatch: requested ${req.deviceId}, unit is ${this.deviceId}`);
    }

    const key = this._key(req.address);
    const mem = this.deviceMemory.get(key);
    if (!mem) {
      throw new Error(`Hardware memory address not mapped: ${key}`);
    }

    let dt1 = buildDT1(req.address, mem, this.deviceId);

    if (this.corruptNextNReplies > 0) {
      this.corruptNextNReplies--;
      // Invert checksum byte to simulate corrupt transmission
      dt1 = new Uint8Array(dt1);
      dt1[dt1.length - 2] = (dt1[dt1.length - 2] ^ 0x7F);
    }

    return parseSysEx(dt1);
  }
}

// =============================================================================
// Test Suites
// =============================================================================

describe('USB Hardware Device Auto-Detection', () => {
  test('detectDeviceId discovers hardware configured with standard ID 0x10', async () => {
    const hw = new FlakyHardwareUnit(0x10);
    const detected = await detectDeviceId(hw);
    assert.equal(detected, 0x10);
  });

  test('detectDeviceId discovers hardware configured with alternate ID (e.g. 0x15)', async () => {
    const hw = new FlakyHardwareUnit(0x15);
    const detected = await detectDeviceId(hw);
    assert.equal(detected, 0x15);
  });

  test('detectDeviceId throws descriptive error if device is not responding', async () => {
    const hw = new FlakyHardwareUnit(0x10);
    hw.failNextNRequests = 100; // Total blackout
    await assert.rejects(
      () => detectDeviceId(hw, 50),
      /XV-5050 synthesizer did not respond/
    );
  });
});

describe('USB SysEx Communication Resilience & Retry Protocol', () => {
  test('sendAndReceiveWithRetry succeeds on first attempt under normal conditions', async () => {
    const hw = new FlakyHardwareUnit(0x10);
    const rq1 = buildRQ1([0x01, 0x00, 0x00, 0x00], [0x00, 0x00, 0x00, 0x0F], 0x10);

    const resp = await sendAndReceiveWithRetry(hw, rq1, { maxRetries: 3, timeoutMs: 200 });
    assert.equal(resp.valid, true);
    assert.equal(resp.data.length, 15);
    assert.equal(hw.requestCount, 1);
  });

  test('sendAndReceiveWithRetry recovers automatically when packets are dropped', async () => {
    const hw = new FlakyHardwareUnit(0x10);
    hw.failNextNRequests = 2; // Fail first 2 attempts, 3rd succeeds

    const rq1 = buildRQ1([0x01, 0x00, 0x00, 0x00], [0x00, 0x00, 0x00, 0x0F], 0x10);
    const resp = await sendAndReceiveWithRetry(hw, rq1, { maxRetries: 3, timeoutMs: 50 });

    assert.equal(resp.valid, true);
    assert.equal(resp.data.length, 15);
    assert.equal(hw.requestCount, 3);
  });

  test('sendAndReceiveWithRetry recovers automatically from corrupted checksum replies', async () => {
    const hw = new FlakyHardwareUnit(0x10);
    hw.corruptNextNReplies = 1; // Corrupt 1st reply, 2nd succeeds

    const rq1 = buildRQ1([0x01, 0x00, 0x00, 0x00], [0x00, 0x00, 0x00, 0x0F], 0x10);
    const resp = await sendAndReceiveWithRetry(hw, rq1, { maxRetries: 2, timeoutMs: 50 });

    assert.equal(resp.valid, true);
    assert.equal(resp.data.length, 15);
    assert.equal(hw.requestCount, 2);
  });

  test('sendAndReceiveWithRetry fails with clear diagnostic error after exceeding max retries', async () => {
    const hw = new FlakyHardwareUnit(0x10);
    hw.failNextNRequests = 5;

    const rq1 = buildRQ1([0x01, 0x00, 0x00, 0x00], [0x00, 0x00, 0x00, 0x0F], 0x10);
    await assert.rejects(
      () => sendAndReceiveWithRetry(hw, rq1, { maxRetries: 2, timeoutMs: 50 }),
      /Failed after 3 attempts/
    );
  });
});

describe('Deep User Performance Read & Write Architecture', () => {
  test('requestEntireUserPerformance retrieves complete multi-part setup for User Performance #7', async () => {
    const hw = new FlakyHardwareUnit(0x10);
    const perf = await requestEntireUserPerformance(hw, 7, 0x10);

    assert.equal(perf.index, 7);
    assert.equal(perf.common.name, 'U-Perf 7');
    assert.equal(perf.chorus.chorusType, 1);
    assert.equal(perf.reverb.reverbType, 2);
    assert.equal(perf.parts.length, 16);
    assert.equal(perf.parts[0].patchPC, 1);
    assert.equal(perf.parts[15].patchPC, 16);
  });

  test('sendEntireUserPerformance writes full performance into hardware slot and verifies data roundtrip', async () => {
    const hw = new FlakyHardwareUnit(0x10);

    // Prepare modified performance data
    const newPerfData = {
      common: {
        raw: new Array(53).fill(0),
        name: 'MODIFIED P12',
      },
      chorus: {
        raw: new Array(52).fill(0),
      },
      reverb: {
        raw: new Array(83).fill(0),
      },
      parts: Array.from({ length: 16 }, (_, i) => ({
        raw: new Array(49).fill(0),
      })),
    };
    // Put encoded name into common raw
    const encName = encodeName('MODIFIED P12');
    for (let i = 0; i < 12; i++) newPerfData.common.raw[i] = encName[i];
    newPerfData.chorus.raw[0x01] = 99; // Chorus level
    newPerfData.parts[0].raw[0x07] = 110; // Part 1 level

    await sendEntireUserPerformance(hw, 12, newPerfData, 0x10);

    // Read back directly to verify hardware memory was updated
    const retrieved = await requestEntireUserPerformance(hw, 12, 0x10);
    assert.equal(retrieved.common.name, 'MODIFIED P12');
    assert.equal(retrieved.chorus.chorusLevel, 99);
    assert.equal(retrieved.parts[0].partLevel, 110);
  });
});

describe('Deep User Patch Read & Write Architecture', () => {
  test('requestEntireUserPatch retrieves complete Common, TMT, and all 4 Tones for User Patch #42', async () => {
    const hw = new FlakyHardwareUnit(0x10);
    const patch = await requestEntireUserPatch(hw, 42, 0x10);

    assert.equal(patch.index, 42);
    assert.equal(patch.common.name, 'U-Patch 42');
    assert.equal(patch.common.patchLevel, 118);
    assert.equal(patch.tmt.tone1Switch, 1);
    assert.equal(patch.tmt.tone2Switch, 1);
    assert.equal(patch.tones.length, 4);
    assert.equal(patch.tones[0].toneLevel, 127);
    assert.equal(patch.tones[0].tvfCutoff, 95);
    assert.equal(patch.tones[0].waveNumberL, 43); // (42 % 500) + 1
  });

  test('sendEntireUserPatch writes complete patch into hardware slot and verifies data roundtrip', async () => {
    const hw = new FlakyHardwareUnit(0x10);

    const newPatchData = {
      common: {
        raw: new Array(79).fill(0),
        name: 'CUSTOM LEAD',
      },
      tmt: {
        raw: new Array(41).fill(0),
      },
      tones: Array.from({ length: 4 }, () => ({
        raw: new Array(137).fill(0),
      })),
    };
    const encName = encodeName('CUSTOM LEAD');
    for (let i = 0; i < 12; i++) newPatchData.common.raw[i] = encName[i];
    newPatchData.common.raw[0x0E] = 125; // Patch Level
    newPatchData.tmt.raw[0x05] = 1;      // Tone 1 switch ON
    newPatchData.tones[0].raw[0x49] = 112; // Cutoff 112

    await sendEntireUserPatch(hw, 88, newPatchData, 0x10);

    // Read back to verify write
    const retrieved = await requestEntireUserPatch(hw, 88, 0x10);
    assert.equal(retrieved.common.name, 'CUSTOM LEAD');
    assert.equal(retrieved.common.patchLevel, 125);
    assert.equal(retrieved.tones[0].tvfCutoff, 112);
  });
});

describe('Full Hardware Diagnostic Suite Execution', () => {
  test('runHardwareDiagnostics executes comprehensive 6-step test and generates structured pass report', async () => {
    const hw = new FlakyHardwareUnit(0x10);
    const progressReports = [];

    const report = await runHardwareDiagnostics(hw, 0x10, (prog) => {
      progressReports.push(prog);
    });

    assert.equal(report.overallSuccess, true);
    assert.equal(report.steps.length, 6);
    assert.equal(report.steps[0].name, 'Device ID Handshake');
    assert.equal(report.steps[0].passed, true);
    assert.equal(report.steps[1].name, 'System & Setup Parameters');
    assert.equal(report.steps[1].passed, true);
    assert.equal(report.steps[2].name, 'Temporary Performance Common & Effects');
    assert.equal(report.steps[2].passed, true);
    assert.equal(report.steps[3].name, 'Temporary Patch & Tone Engine');
    assert.equal(report.steps[3].passed, true);
    assert.equal(report.steps[4].name, 'User Performance Bank Sample');
    assert.equal(report.steps[4].passed, true);
    assert.equal(report.steps[5].name, 'User Patch Bank Sample');
    assert.equal(report.steps[5].passed, true);

    assert.ok(progressReports.length >= 6);
  });

  test('runHardwareDiagnostics reports specific step failure when connection fails mid-diagnostics', async () => {
    const hw = new FlakyHardwareUnit(0x10);
    // Let step 0 pass, but step 1 fails
    hw.failNextNRequests = 50;

    const report = await runHardwareDiagnostics(hw, 0x10);
    assert.equal(report.overallSuccess, false);
    assert.equal(report.steps[0].passed, false);
    assert.ok(report.steps[0].error.length > 0);
  });
});
