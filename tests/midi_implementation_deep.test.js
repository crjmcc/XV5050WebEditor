import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  SYSTEM,
  PERF_TEMP,
  PERF_PART,
  PATCH_COMMON,
  PATCH_TMT,
  PATCH_TONE,
  getPartAddress,
  getPerfMidiAddress,
  getPatchTempAddress,
  getPatchTMTAddress,
  getToneAddress,
  addOffset,
} from '../src/addresses.js';
import {
  calculateChecksum,
  validateChecksum,
  buildDT1,
  buildRQ1,
  parseSysEx,
} from '../src/sysex.js';
import {
  SYSTEM_PARAMS,
  PERF_COMMON_PARAMS,
  PERF_PART_PARAMS,
  PATCH_COMMON_PARAMS,
  PATCH_TMT_PARAMS,
  PATCH_TONE_PARAMS,
  formatParamValue,
  parseDisplayValue,
} from '../src/parameters.js';

describe('Exhaustive Address Map Validation for All 16 Parts & 4 Tones', () => {
  test('all 16 performance part addresses are strictly continuous and increment by 0x0100', () => {
    for (let p = 1; p <= 16; p++) {
      const addr = getPartAddress(p);
      assert.equal(addr[0], 0x10, 'MSB should be 0x10');
      assert.equal(addr[1], 0x00, 'Upper-mid should be 0x00');
      assert.equal(addr[2], 0x20 + (p - 1), `Part ${p} offset byte`);
      assert.equal(addr[3], 0x00, 'LSB should be 0x00');
    }
  });

  test('all 16 performance MIDI addresses are continuous from 10 00 10 00 to 10 00 1F 00', () => {
    for (let ch = 1; ch <= 16; ch++) {
      const addr = getPerfMidiAddress(ch);
      assert.equal(addr[0], 0x10);
      assert.equal(addr[1], 0x00);
      assert.equal(addr[2], 0x10 + (ch - 1));
      assert.equal(addr[3], 0x00);
    }
  });

  test('all 16 performance mode patch base addresses match the 4-part bank stepping in manual', () => {
    // Part 1-4: 11 00/20/40/60
    assert.deepEqual(getPatchTempAddress(1), [0x11, 0x00, 0x00, 0x00]);
    assert.deepEqual(getPatchTempAddress(2), [0x11, 0x20, 0x00, 0x00]);
    assert.deepEqual(getPatchTempAddress(3), [0x11, 0x40, 0x00, 0x00]);
    assert.deepEqual(getPatchTempAddress(4), [0x11, 0x60, 0x00, 0x00]);
    // Part 5-8: 12 00/20/40/60
    assert.deepEqual(getPatchTempAddress(5), [0x12, 0x00, 0x00, 0x00]);
    assert.deepEqual(getPatchTempAddress(8), [0x12, 0x60, 0x00, 0x00]);
    // Part 9-12: 13 00/20/40/60
    assert.deepEqual(getPatchTempAddress(9), [0x13, 0x00, 0x00, 0x00]);
    assert.deepEqual(getPatchTempAddress(12), [0x13, 0x60, 0x00, 0x00]);
    // Part 13-16: 14 00/20/40/60
    assert.deepEqual(getPatchTempAddress(13), [0x14, 0x00, 0x00, 0x00]);
    assert.deepEqual(getPatchTempAddress(16), [0x14, 0x60, 0x00, 0x00]);
  });

  test('tone addresses for any patch base offset correctly by 0x20, 0x22, 0x24, 0x26', () => {
    const bases = [
      [0x1F, 0x00, 0x00, 0x00], // Single Mode
      [0x11, 0x00, 0x00, 0x00], // Part 1
      [0x14, 0x60, 0x00, 0x00], // Part 16
    ];

    for (const base of bases) {
      assert.deepEqual(getToneAddress(base, 1), [base[0], base[1], base[2] + 0x20, 0x00]);
      assert.deepEqual(getToneAddress(base, 2), [base[0], base[1], base[2] + 0x22, 0x00]);
      assert.deepEqual(getToneAddress(base, 3), [base[0], base[1], base[2] + 0x24, 0x00]);
      assert.deepEqual(getToneAddress(base, 4), [base[0], base[1], base[2] + 0x26, 0x00]);
    }
  });
});

describe('Parameter Ranges and Type Constraints Verification', () => {
  test('coarse tune displays -48 to +48 with raw values 16 to 112', () => {
    const param = PERF_PART_PARAMS.COARSE_TUNE;
    assert.equal(param.min, 16);
    assert.equal(param.max, 112);
    assert.equal(param.displayOffset, -64);
    assert.equal(formatParamValue(param, 16), '-48');
    assert.equal(formatParamValue(param, 64), '0');
    assert.equal(formatParamValue(param, 112), '48');
  });

  test('fine tune displays -50 to +50 with raw values 14 to 114', () => {
    const param = PERF_PART_PARAMS.FINE_TUNE;
    assert.equal(param.min, 14);
    assert.equal(param.max, 114);
    assert.equal(param.displayOffset, -64);
    assert.equal(formatParamValue(param, 14), '-50');
    assert.equal(formatParamValue(param, 64), '0');
    assert.equal(formatParamValue(param, 114), '50');
  });

  test('structure types 1-10 mapped to values 0-9 in Patch TMT', () => {
    const param = PATCH_TMT_PARAMS.STRUCTURE_TYPE_1_2;
    assert.equal(param.min, 0);
    assert.equal(param.max, 9);
    assert.equal(param.enumValues.length, 10);
    assert.equal(formatParamValue(param, 0), '1 (Type 1)');
    assert.equal(formatParamValue(param, 9), '10 (Type 10)');
  });

  test('booster levels 0 dB to +18 dB mapped to values 0-3 in Patch TMT', () => {
    const param = PATCH_TMT_PARAMS.BOOSTER_1_2;
    assert.equal(param.min, 0);
    assert.equal(param.max, 3);
    assert.deepEqual(param.enumValues, ['0 dB', '+6 dB', '+12 dB', '+18 dB']);
  });

  test('TVF Filter Types OFF, LPF, BPF, HPF, PKG, LPF2, LPF3 in Patch Tone', () => {
    const param = PATCH_TONE_PARAMS.TVF_FILTER_TYPE;
    assert.equal(param.min, 0);
    assert.equal(param.max, 6);
    assert.equal(param.enumValues[0], 'OFF');
    assert.equal(param.enumValues[1], 'LPF');
    assert.equal(param.enumValues[5], 'LPF2');
    assert.equal(param.enumValues[6], 'LPF3');
  });
});

describe('SysEx Safety & Boundary Stress Tests', () => {
  test('all device IDs from 0x10 to 0x1F are valid', () => {
    for (let devId = 0x10; devId <= 0x1F; devId++) {
      const msg = buildDT1([0x10, 0x00, 0x00, 0x00], [0x00], devId);
      assert.equal(msg[2], devId);
      const parsed = parseSysEx(msg);
      assert.equal(parsed.valid, true);
      assert.equal(parsed.deviceId, devId);
    }
  });

  test('multi-byte block DT1 messages validate checksum accurately', () => {
    // 12-byte performance name payload
    const nameBytes = [65, 66, 67, 68, 69, 70, 71, 72, 73, 74, 75, 76];
    const msg = buildDT1([0x10, 0x00, 0x00, 0x00], nameBytes, 0x10);
    const parsed = parseSysEx(msg);
    assert.equal(parsed.valid, true);
    assert.deepEqual(parsed.data, nameBytes);
  });

  test('truncated or corrupt SysEx messages fail gracefully', () => {
    // Missing end F7
    const noEnd = new Uint8Array([0xF0, 0x41, 0x10, 0x00, 0x10, 0x12, 0x10, 0x00, 0x00, 0x00, 0x00, 0x60]);
    assert.equal(parseSysEx(noEnd).valid, false);

    // Corrupted checksum
    const badCs = new Uint8Array([0xF0, 0x41, 0x10, 0x00, 0x10, 0x12, 0x10, 0x00, 0x00, 0x00, 0x00, 0x77, 0xF7]);
    assert.equal(parseSysEx(badCs).valid, false);
  });
});
