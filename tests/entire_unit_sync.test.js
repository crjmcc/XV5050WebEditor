import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import {
  SETUP,
  SYSTEM,
  getUserPerformanceAddress,
  getUserPatchAddress,
  getUserRhythmAddress,
  getPatchTempAddress,
  getPartAddress,
  getPatchTMTAddress,
  getToneAddress,
  addOffset,
} from '../src/addresses.js';

import {
  parseSetup,
  parseSystemCommon,
  parseSystemEQ,
  requestSetup,
  requestSystemCommon,
  requestSystemEQ,
  requestUserPerformanceHeader,
  requestAllUserPerformanceHeaders,
  requestUserPatchHeader,
  requestAllUserPatchHeaders,
  requestUserRhythmHeader,
  syncEntireUnit,
  exportFullUnitBackup,
  importFullUnitBackup,
} from '../src/unit_sync.js';

import { buildDT1, buildRQ1, parseSysEx } from '../src/sysex.js';
import { encodeName } from '../src/parameters.js';

/**
 * Mock Hardware Unit containing complete memory space:
 * - Setup (01 00 00 00)
 * - System Common & EQ (02 00 00 00 & 02 00 02 00)
 * - Temporary Performance (10 00 00 00) + 16 Parts
 * - Temporary Patches for Parts 1-16 (11 00 00 00 - 14 60 00 00)
 * - 64 User Performances (20 00 00 00 - 20 3F 00 00)
 * - 128 User Patches (30 00 00 00 - 30 7F 00 00)
 * - 4 User Rhythm Sets (40 00 00 00 - 40 30 00 00)
 */
class FullUnitMockDevice {
  constructor(deviceId = 0x10) {
    this.deviceId = deviceId;
    this.deviceMemory = new Map();
    this.sentMessages = [];
    this.initMockMemory();
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

  initMockMemory() {
    // 1. Setup (15 bytes)
    const setup = new Array(15).fill(0);
    setup[0x00] = 85; // Perf Bank MSB
    setup[0x02] = 0;  // Perf PC
    setup[0x0A] = 1;  // MFX Switch ON
    setup[0x0B] = 1;  // Chorus Switch ON
    setup[0x0C] = 1;  // Reverb Switch ON
    this.setMemory([0x01, 0x00, 0x00, 0x00], setup);

    // 2. System Common (33 bytes) & EQ (17 bytes)
    const sysCommon = new Array(33).fill(0);
    sysCommon[0x04] = 64; // Master Key Shift 0
    sysCommon[0x05] = 127; // Master Level 127
    sysCommon[0x09] = 16;  // Performance Control Channel 16
    sysCommon[0x1E] = 2;   // Clock USB
    this.setMemory([0x02, 0x00, 0x00, 0x00], sysCommon);

    const sysEQ = new Array(17).fill(0);
    sysEQ[0x00] = 1; // EQ Switch ON
    sysEQ[0x02] = 15; // EQ1 Low Gain 0 dB
    this.setMemory([0x02, 0x00, 0x02, 0x00], sysEQ);

    // 3. Current / Temporary Performance (53 bytes) + Effects + 16 Parts
    const tempPerf = new Array(53).fill(0);
    const pName = encodeName('INITIAL PERF');
    for (let i = 0; i < 12; i++) tempPerf[i] = pName[i];
    this.setMemory([0x10, 0x00, 0x00, 0x00], tempPerf);

    // Chorus (52 bytes) & Reverb (83 bytes)
    this.setMemory([0x10, 0x00, 0x04, 0x00], new Array(52).fill(0));
    this.setMemory([0x10, 0x00, 0x06, 0x00], new Array(83).fill(0));

    for (let p = 1; p <= 16; p++) {
      const part = new Array(49).fill(0);
      part[0x00] = p - 1; // MIDI ch
      part[0x07] = 100;   // Level
      this.setMemory(getPartAddress(p), part);

      // Part sound name
      this.setMemory(getPatchTempAddress(p), encodeName(`Part ${p} Sound`));

      // Part Patch Common (79 bytes) + TMT (41 bytes) + 4 Tones (137 bytes each)
      const patchBase = getPatchTempAddress(p);
      const patchComm = new Array(79).fill(0);
      const soundName = encodeName(`Part ${p} Sound`);
      for (let i = 0; i < 12; i++) patchComm[i] = soundName[i];
      patchComm[0x0E] = 120; // Level
      this.setMemory(patchBase, patchComm);

      const tmt = new Array(41).fill(0);
      tmt[0x05] = 1; // Tone 1 Switch ON
      this.setMemory(getPatchTMTAddress(patchBase), tmt);

      for (let t = 1; t <= 4; t++) {
        const tone = new Array(137).fill(0);
        tone[0x00] = 127; // Tone level
        tone[0x2C] = 0; tone[0x2D] = 0; tone[0x2E] = 0; tone[0x2F] = p; // Wave number
        this.setMemory(getToneAddress(patchBase, t), tone);
      }
    }

    // 4. 64 User Performances (20 00 00 00 to 20 3F 00 00)
    for (let i = 1; i <= 64; i++) {
      const perfAddr = getUserPerformanceAddress(i);
      const uPerfCommon = new Array(53).fill(0);
      const uName = encodeName(`U-Perf ${i}`);
      for (let c = 0; c < 12; c++) uPerfCommon[c] = uName[c];
      uPerfCommon[0x0C] = 0; // Solo Part
      this.setMemory(perfAddr, uPerfCommon);
    }

    // 5. 128 User Patches (30 00 00 00 to 30 7F 00 00)
    for (let i = 1; i <= 128; i++) {
      const patchAddr = getUserPatchAddress(i);
      const uPatchCommon = new Array(79).fill(0);
      const uName = encodeName(`U-Patch ${i}`);
      for (let c = 0; c < 12; c++) uPatchCommon[c] = uName[c];
      uPatchCommon[0x0C] = (i % 38); // Category
      uPatchCommon[0x0E] = 110;      // Level
      this.setMemory(patchAddr, uPatchCommon);

      // TMT
      const uTmt = new Array(41).fill(0);
      uTmt[0x05] = 1; // Tone 1 ON
      this.setMemory(getPatchTMTAddress(patchAddr), uTmt);

      // 4 Tones
      for (let t = 1; t <= 4; t++) {
        const uTone = new Array(137).fill(0);
        uTone[0x00] = 127;
        uTone[0x2C] = 0; uTone[0x2D] = 0; uTone[0x2E] = 0; uTone[0x2F] = (i % 500) + 1;
        this.setMemory(getToneAddress(patchAddr, t), uTone);
      }
    }

    // 6. 4 User Rhythm Sets (40 00 00 00 to 40 30 00 00)
    for (let i = 1; i <= 4; i++) {
      const rhythmAddr = getUserRhythmAddress(i);
      const uRhythm = new Array(18).fill(0);
      const rName = encodeName(`U-Drum ${i}`);
      for (let c = 0; c < 12; c++) uRhythm[c] = rName[c];
      this.setMemory(rhythmAddr, uRhythm);
    }
  }

  send(bytes) {
    this.sentMessages.push(bytes);
  }

  async sendAndReceive(requestBytes) {
    this.sentMessages.push(requestBytes);
    const parsed = parseSysEx(requestBytes);
    if (!parsed.valid || parsed.command !== 0x11) {
      throw new Error('Expected valid RQ1 command');
    }
    const key = this._key(parsed.address);
    const mem = this.deviceMemory.get(key);
    if (!mem) {
      throw new Error(`Device memory address not found: ${key}`);
    }

    const dt1 = buildDT1(parsed.address, mem, this.deviceId);
    return parseSysEx(dt1);
  }
}

describe('Entire Unit SysEx Memory Map & Addressing Specifications', () => {
  test('Setup address is 01 00 00 00 with size 15 bytes', () => {
    assert.deepEqual(SETUP.BASE, [0x01, 0x00, 0x00, 0x00]);
    assert.deepEqual(SETUP.SIZE, [0x00, 0x00, 0x00, 0x0F]);
  });

  test('System Common is 02 00 00 00 (33 bytes) and EQ is 02 00 02 00 (17 bytes)', () => {
    assert.deepEqual(SYSTEM.COMMON.BASE, [0x02, 0x00, 0x00, 0x00]);
    assert.deepEqual(SYSTEM.COMMON.SIZE, [0x00, 0x00, 0x00, 0x21]);
    assert.deepEqual(SYSTEM.EQ.BASE, [0x02, 0x00, 0x02, 0x00]);
    assert.deepEqual(SYSTEM.EQ.SIZE, [0x00, 0x00, 0x00, 0x11]);
  });

  test('Exhaustive validation: All 64 User Performance base addresses are continuous 20 00 00 00 to 20 3F 00 00', () => {
    for (let i = 1; i <= 64; i++) {
      const addr = getUserPerformanceAddress(i);
      assert.equal(addr[0], 0x20, `User Perf ${i} MSB must be 0x20`);
      assert.equal(addr[1], i - 1, `User Perf ${i} index byte must be ${i - 1}`);
      assert.equal(addr[2], 0x00);
      assert.equal(addr[3], 0x00);
    }
    assert.throws(() => getUserPerformanceAddress(0), /1-64/);
    assert.throws(() => getUserPerformanceAddress(65), /1-64/);
  });

  test('Exhaustive validation: All 128 User Patch base addresses are continuous 30 00 00 00 to 30 7F 00 00', () => {
    for (let i = 1; i <= 128; i++) {
      const addr = getUserPatchAddress(i);
      assert.equal(addr[0], 0x30, `User Patch ${i} MSB must be 0x30`);
      assert.equal(addr[1], i - 1, `User Patch ${i} index byte must be ${i - 1}`);
      assert.equal(addr[2], 0x00);
      assert.equal(addr[3], 0x00);
    }
    assert.throws(() => getUserPatchAddress(0), /1-128/);
    assert.throws(() => getUserPatchAddress(129), /1-128/);
  });

  test('Exhaustive validation: All 4 User Rhythm Set base addresses are 40 00 00 00 to 40 30 00 00', () => {
    for (let i = 1; i <= 4; i++) {
      const addr = getUserRhythmAddress(i);
      assert.equal(addr[0], 0x40);
      assert.equal(addr[1], (i - 1) * 0x10);
      assert.equal(addr[2], 0x00);
      assert.equal(addr[3], 0x00);
    }
    assert.throws(() => getUserRhythmAddress(0), /1-4/);
    assert.throws(() => getUserRhythmAddress(5), /1-4/);
  });
});

describe('Entire Unit SysEx Data Request & Parsing Engine', () => {
  let mockDevice;

  test('setup and initialize mock hardware unit', () => {
    mockDevice = new FullUnitMockDevice(0x10);
    assert.ok(mockDevice.deviceMemory.size > 200);
  });

  test('requestSetup retrieves and parses unit setup parameters', async () => {
    const setup = await requestSetup(mockDevice);
    assert.equal(setup.perfBankMsb, 85);
    assert.equal(setup.mfxSwitch, 1);
    assert.equal(setup.chorusSwitch, 1);
    assert.equal(setup.reverbSwitch, 1);
  });

  test('requestSystemCommon and requestSystemEQ retrieve system parameters', async () => {
    const sys = await requestSystemCommon(mockDevice);
    assert.equal(sys.masterLevel, 127);
    assert.equal(sys.perfCtrlChannel, 16);
    assert.equal(sys.clockSource, 2); // USB

    const eq = await requestSystemEQ(mockDevice);
    assert.equal(eq.eqSwitch, 1);
  });

  test('requestUserPerformanceHeader fetches individual performance summary', async () => {
    const p1 = await requestUserPerformanceHeader(mockDevice, 1);
    assert.equal(p1.index, 1);
    assert.equal(p1.name, 'U-Perf 1');

    const p42 = await requestUserPerformanceHeader(mockDevice, 42);
    assert.equal(p42.index, 42);
    assert.equal(p42.name, 'U-Perf 42');
  });

  test('requestAllUserPerformanceHeaders queries all 64 user performances with progress reporting', async () => {
    const progressLog = [];
    const performances = await requestAllUserPerformanceHeaders(mockDevice, 0x10, (done, total, perf) => {
      progressLog.push({ done, total, name: perf.name });
    });

    assert.equal(performances.length, 64);
    assert.equal(performances[0].name, 'U-Perf 1');
    assert.equal(performances[63].name, 'U-Perf 64');
    assert.equal(progressLog.length, 64);
    assert.equal(progressLog[63].done, 64);
  });

  test('requestUserPatchHeader fetches patch name and category', async () => {
    const patch1 = await requestUserPatchHeader(mockDevice, 1);
    assert.equal(patch1.index, 1);
    assert.equal(patch1.name, 'U-Patch 1');
    assert.equal(patch1.category, 1);

    const patch100 = await requestUserPatchHeader(mockDevice, 100);
    assert.equal(patch100.index, 100);
    assert.equal(patch100.name, 'U-Patch 100');
  });

  test('requestAllUserPatchHeaders queries all 128 user patches with progress reporting', async () => {
    const patches = await requestAllUserPatchHeaders(mockDevice, 0x10);
    assert.equal(patches.length, 128);
    assert.equal(patches[0].name, 'U-Patch 1');
    assert.equal(patches[127].name, 'U-Patch 128');
  });

  test('requestUserRhythmHeader retrieves drum kit name', async () => {
    const r1 = await requestUserRhythmHeader(mockDevice, 1);
    assert.equal(r1.name, 'U-Drum 1');
    const r4 = await requestUserRhythmHeader(mockDevice, 4);
    assert.equal(r4.name, 'U-Drum 4');
  });
});

describe('Full Unit Master Sync & Database Aggregation', () => {
  test('syncEntireUnit executes all 6 stages and returns unified unit database', async () => {
    const mockDevice = new FullUnitMockDevice(0x10);
    const stagesVisited = new Set();

    const unitDb = await syncEntireUnit(mockDevice, 0x10, (pct, statusText, stage) => {
      assert.ok(pct >= 0 && pct <= 100, `Percentage ${pct} must be 0-100`);
      assert.ok(statusText && statusText.length > 0);
      stagesVisited.add(stage);
    });

    // Verify all 6 stages executed
    assert.ok(stagesVisited.has('setup_system'));
    assert.ok(stagesVisited.has('current_performance'));
    assert.ok(stagesVisited.has('active_patches'));
    assert.ok(stagesVisited.has('user_performances'));
    assert.ok(stagesVisited.has('user_patches'));
    assert.ok(stagesVisited.has('user_rhythms'));

    // Verify database contents
    assert.equal(unitDb.setup.mfxSwitch, 1);
    assert.equal(unitDb.system.common.masterLevel, 127);
    assert.equal(unitDb.currentPerformance.common.name, 'INITIAL PERF');
    assert.equal(unitDb.currentPerformance.parts.length, 16);
    assert.equal(unitDb.userPerformances.length, 64);
    assert.equal(unitDb.userPerformances[0].name, 'U-Perf 1');
    assert.equal(unitDb.userPerformances[63].name, 'U-Perf 64');
    assert.equal(unitDb.userPatches.length, 128);
    assert.equal(unitDb.userPatches[0].name, 'U-Patch 1');
    assert.equal(unitDb.userPatches[127].name, 'U-Patch 128');
    assert.equal(unitDb.userRhythms.length, 4);
    assert.equal(unitDb.userRhythms[0].name, 'U-Drum 1');
  });

  test('exportFullUnitBackup generates validated complete .syx backup byte stream', async () => {
    const mockDevice = new FullUnitMockDevice(0x10);
    const unitDb = await syncEntireUnit(mockDevice, 0x10);

    const syxBytes = exportFullUnitBackup(unitDb, 0x10);
    assert.ok(syxBytes instanceof Uint8Array);
    assert.ok(syxBytes.length > 5000, `Backup size ${syxBytes.length} must contain all blocks`);

    // Verify round-trip parsing
    const restoredDb = importFullUnitBackup(syxBytes);
    assert.equal(restoredDb.userPerformances.length, 64);
    assert.equal(restoredDb.userPerformances[0].name, 'U-Perf 1');
    assert.equal(restoredDb.userPatches[0].name, 'U-Patch 1');
    assert.equal(restoredDb.setup.mfxSwitch, 1);
  });
});

