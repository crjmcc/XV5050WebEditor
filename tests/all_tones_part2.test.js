import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { sendPatchToneParam } from '../src/patch.js';
import { getPatchTempAddress, getToneAddress, addOffset, PATCH_TONE } from '../src/addresses.js';

describe('Part 2 Performance Tone & Filter Editing', () => {
  test('Part 2 Temporary Patch base address is [0x11, 0x20, 0x00, 0x00]', () => {
    const base = getPatchTempAddress(2);
    assert.deepEqual(base, [0x11, 0x20, 0x00, 0x00]);
  });

  test('All 4 tones for Part 2 calculate correct SysEx addresses for TVF Cutoff', () => {
    const part = 2;
    const base = getPatchTempAddress(part);

    const expectedAddresses = [
      [0x11, 0x20, 0x20, 0x49], // Tone 1
      [0x11, 0x20, 0x22, 0x49], // Tone 2
      [0x11, 0x20, 0x24, 0x49], // Tone 3
      [0x11, 0x20, 0x26, 0x49], // Tone 4
    ];

    for (let t = 1; t <= 4; t++) {
      const toneBase = getToneAddress(base, t);
      const cutoffAddr = addOffset(toneBase, PATCH_TONE.params.TVF_CUTOFF.offset);
      assert.deepEqual(cutoffAddr, expectedAddresses[t - 1]);
    }
  });

  test('sendPatchToneParam transmits valid DT1 packet for each tone on Part 2', () => {
    const sentPackets = [];
    const mockMidi = {
      send: (bytes) => sentPackets.push(Array.from(bytes))
    };

    const cutoffVal = 85;
    for (let t = 1; t <= 4; t++) {
      sendPatchToneParam(mockMidi, 2, t, 'TVF_CUTOFF', cutoffVal, 0x10);
    }

    assert.equal(sentPackets.length, 4, 'Should have sent 4 packets (one per tone)');
    // Check packet structure: F0 41 10 00 10 12 [addr] [data] [chk] F7
    for (let i = 0; i < 4; i++) {
      const pkt = sentPackets[i];
      assert.equal(pkt[0], 0xF0);
      assert.equal(pkt[1], 0x41);
      assert.equal(pkt[2], 0x10);
      assert.equal(pkt[3], 0x00);
      assert.equal(pkt[4], 0x10);
      assert.equal(pkt[5], 0x12);
      // Address: 11 20 20+2*i 49
      assert.equal(pkt[6], 0x11);
      assert.equal(pkt[7], 0x20);
      assert.equal(pkt[8], 0x20 + i * 2);
      assert.equal(pkt[9], 0x49);
      // Data: 85 (0x55)
      assert.equal(pkt[10], 85);
      assert.equal(pkt[12], 0xF7);
    }
  });
});

