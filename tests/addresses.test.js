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

describe('XV-5050 Address Map Specifications', () => {
  test('Performance Part addresses conform to Table 1-3 (10 00 20 00 to 10 00 2F 00)', () => {
    assert.deepEqual(getPartAddress(1), [0x10, 0x00, 0x20, 0x00]);
    assert.deepEqual(getPartAddress(2), [0x10, 0x00, 0x21, 0x00]);
    assert.deepEqual(getPartAddress(3), [0x10, 0x00, 0x22, 0x00]);
    assert.deepEqual(getPartAddress(16), [0x10, 0x00, 0x2F, 0x00]);
  });

  test('Performance MIDI addresses conform to Table 1-3-5 (10 00 10 00 to 10 00 1F 00)', () => {
    assert.deepEqual(getPerfMidiAddress(1), [0x10, 0x00, 0x10, 0x00]);
    assert.deepEqual(getPerfMidiAddress(16), [0x10, 0x00, 0x1F, 0x00]);
  });

  test('Temporary Patch base addresses in Performance Mode & Single Mode', () => {
    // Single patch mode
    assert.deepEqual(getPatchTempAddress(0), [0x1F, 0x00, 0x00, 0x00]);
    // Performance mode parts 1 to 16
    assert.deepEqual(getPatchTempAddress(1), [0x11, 0x00, 0x00, 0x00]);
    assert.deepEqual(getPatchTempAddress(2), [0x11, 0x20, 0x00, 0x00]);
    assert.deepEqual(getPatchTempAddress(3), [0x11, 0x40, 0x00, 0x00]);
    assert.deepEqual(getPatchTempAddress(4), [0x11, 0x60, 0x00, 0x00]);
    assert.deepEqual(getPatchTempAddress(5), [0x12, 0x00, 0x00, 0x00]);
    assert.deepEqual(getPatchTempAddress(16), [0x14, 0x60, 0x00, 0x00]);
  });

  test('Patch TMT (Tone Mix Table) and Tone addresses within a patch', () => {
    const singleBase = [0x1F, 0x00, 0x00, 0x00];
    assert.deepEqual(getPatchTMTAddress(singleBase), [0x1F, 0x00, 0x10, 0x00]);
    assert.deepEqual(getToneAddress(singleBase, 1), [0x1F, 0x00, 0x20, 0x00]);
    assert.deepEqual(getToneAddress(singleBase, 2), [0x1F, 0x00, 0x22, 0x00]);
    assert.deepEqual(getToneAddress(singleBase, 3), [0x1F, 0x00, 0x24, 0x00]);
    assert.deepEqual(getToneAddress(singleBase, 4), [0x1F, 0x00, 0x26, 0x00]);
  });

  test('addOffset 7-bit math handles carry correctly', () => {
    const base = [0x10, 0x00, 0x00, 0x7E];
    // Adding 3: 0x7E + 3 = 0x81 -> 0x01 with carry 1 to previous byte
    const result = addOffset(base, 3);
    assert.deepEqual(result, [0x10, 0x00, 0x01, 0x01]);
  });

  test('invalid part or tone numbers throw errors', () => {
    assert.throws(() => getPartAddress(0), /must be 1-16/);
    assert.throws(() => getPartAddress(17), /must be 1-16/);
    assert.throws(() => getToneAddress([0x1F, 0x00, 0x00, 0x00], 5), /must be 1-4/);
  });
});
