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

  test('sendActivePerformanceSelection transmits Setup DT1 and MIDI Bank Select/PC', async () => {
    const { sendActivePerformanceSelection } = await import('../src/performance.js');
    const sent = [];
    const mockMidi = { send: (bytes) => sent.push(Array.from(bytes)) };

    sendActivePerformanceSelection(mockMidi, 1, 0x10);
    // 1st message: SysEx DT1 to 01 00 00 04, data: [0x55, 0x00, 0x00]
    assert.equal(sent[0][0], 0xF0);
    assert.deepEqual(sent[0].slice(6, 10), [0x01, 0x00, 0x00, 0x04]);
    assert.deepEqual(sent[0].slice(10, 13), [0x55, 0x00, 0x00]);

    // Check MIDI CC0 (Bank MSB=85), CC32 (Bank LSB=0), Program Change (0) on Ch 16 (0xBF, 0xCF) and Ch 1 (0xB0, 0xC0)
    const hasCh16Bank = sent.some(m => m[0] === 0xBF && m[1] === 0x00 && m[2] === 0x55);
    const hasCh16PC = sent.some(m => m[0] === 0xCF && m[1] === 0x00);
    const hasCh1Bank = sent.some(m => m[0] === 0xB0 && m[1] === 0x00 && m[2] === 0x55);
    const hasCh1PC = sent.some(m => m[0] === 0xC0 && m[1] === 0x00);
    assert.ok(hasCh16Bank && hasCh16PC, 'Must transmit Bank 85 and PC on Ch 16');
    assert.ok(hasCh1Bank && hasCh1PC, 'Must transmit Bank 85 and PC on Ch 1');

    assert.throws(() => sendActivePerformanceSelection(mockMidi, 0), /must be 1-64/);
    assert.throws(() => sendActivePerformanceSelection(mockMidi, 65), /must be 1-64/);
  });

  test('sendActivePatchSelection and sendPartPatchSelection transmit correct Setup and Part DT1', async () => {
    const { sendActivePatchSelection, sendPartPatchSelection } = await import('../src/performance.js');
    const sent = [];
    const mockMidi = { send: (bytes) => sent.push(Array.from(bytes)) };

    // Active Patch Selection in Single Patch Mode (User Patch 5 -> pc = 4)
    sendActivePatchSelection(mockMidi, 5, 0x10);
    assert.deepEqual(sent[0].slice(6, 10), [0x01, 0x00, 0x00, 0x07]);
    assert.deepEqual(sent[0].slice(10, 13), [0x57, 0x00, 0x04]);

    // Part Patch Selection in Performance Mode (Part 3, User Patch 10 -> pc = 9)
    sent.length = 0;
    sendPartPatchSelection(mockMidi, 3, 10, 0x10);
    assert.deepEqual(sent[0].slice(6, 10), [0x10, 0x00, 0x22, 0x04]);
    assert.deepEqual(sent[0].slice(10, 13), [0x57, 0x00, 0x09]);
    // Channel Bank Select on Part 3's channel (Ch 3 -> index 2: 0xB2, 0xC2)
    const hasPart3PC = sent.some(m => m[0] === 0xC2 && m[1] === 0x09);
    assert.ok(hasPart3PC, 'Must transmit PC on Part 3 channel');
  });
});

