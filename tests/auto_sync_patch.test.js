import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { getPatchTempAddress } from '../src/addresses.js';
import { requestEntirePatch } from '../src/patch.js';

describe('Auto-Sync Patch Architecture (Hardware Synchronization)', () => {
  test('Single Patch Mode (Part 0) maps to Base Address 1F 00 00 00', () => {
    const addr = getPatchTempAddress(0);
    assert.deepEqual(addr, [0x1F, 0x00, 0x00, 0x00]);
  });

  test('Performance Parts 1-16 map to Performance temporary patch buffers', () => {
    assert.deepEqual(getPatchTempAddress(1), [0x11, 0x00, 0x00, 0x00]);
    assert.deepEqual(getPatchTempAddress(2), [0x11, 0x20, 0x00, 0x00]);
    assert.deepEqual(getPatchTempAddress(16), [0x14, 0x60, 0x00, 0x00]);
  });

  test('requestEntirePatch properly queries Single Patch buffer when part is 0', async () => {
    const sentAddresses = [];
    const mockMidi = {
      isConnected: true,
      deviceId: 0x10,
      send(msg) {
        sentAddresses.push(Array.from(msg.slice(6, 10)));
      },
      async sendAndReceive(msg) {
        const addr = Array.from(msg.slice(6, 10));
        sentAddresses.push(addr);
        // Return dummy valid DT1 response with sufficient bytes
        const dummyPayload = new Array(0x80).fill(0);
        return new Uint8Array([0xF0, 0x41, 0x10, 0x00, 0x10, 0x12, ...addr, ...dummyPayload, 0xF7]);
      },
      async sendAndReceiveWithRetry(msg) {
        return this.sendAndReceive(msg);
      }
    };

    const patch = await requestEntirePatch(mockMidi, 0, 0x10);
    assert.ok(patch);
    assert.ok(patch.common);
    assert.ok(patch.tmt);
    assert.equal(patch.tones.length, 4);

    // Verify the first request went to 1F 00 00 00 (Single Patch buffer)
    assert.deepEqual(sentAddresses[0], [0x1F, 0x00, 0x00, 0x00]);
  });
});

