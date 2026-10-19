import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  calculateChecksum,
  validateChecksum,
  buildDT1,
  buildRQ1,
  parseSysEx,
  addressToString,
  stringToAddress,
  formatSysEx,
  SYSEX_START,
  SYSEX_END,
  MANUFACTURER_ID,
  MODEL_ID,
  DEFAULT_DEVICE_ID,
  CMD_DT1,
  CMD_RQ1,
} from '../src/sysex.js';

describe('XV-5050 SysEx Checksum Calculation', () => {
  test('official manual Example 1: Chorus Type to DELAY DT1', () => {
    // Address 10 00 04 00 + Data 02 -> Checksum 6A
    const bytes = [0x10, 0x00, 0x04, 0x00, 0x02];
    const cs = calculateChecksum(bytes);
    assert.equal(cs, 0x6A);
    assert.equal(validateChecksum(bytes, 0x6A), true);
  });

  test('official manual Example 2: RQ1 for Performance Part 3', () => {
    // Address 20 02 22 00 + Size 00 00 00 31 -> Checksum 0B
    const bytes = [0x20, 0x02, 0x22, 0x00, 0x00, 0x00, 0x00, 0x31];
    const cs = calculateChecksum(bytes);
    assert.equal(cs, 0x0B);
    assert.equal(validateChecksum(bytes, 0x0B), true);
  });

  test('checksum edge case: sum % 128 === 0 yields 0x00', () => {
    // 0x40 (64) + 0x40 (64) = 128. 128 - (128 % 128) = 128 -> becomes 0
    const bytes = [0x40, 0x40];
    assert.equal(calculateChecksum(bytes), 0x00);
  });

  test('checksum edge case: sum % 128 === 1 yields 0x7F (127)', () => {
    const bytes = [0x01];
    assert.equal(calculateChecksum(bytes), 0x7F);
  });

  test('rejects empty byte array', () => {
    assert.throws(() => calculateChecksum([]), /non-empty array/);
  });
});

describe('XV-5050 SysEx Builder & Parser', () => {
  test('buildDT1 constructs exact official Example 1 message', () => {
    const address = [0x10, 0x00, 0x04, 0x00];
    const data = [0x02];
    const msg = buildDT1(address, data, 0x10);

    const expected = new Uint8Array([
      0xF0, 0x41, 0x10, 0x00, 0x10, 0x12, 0x10, 0x00, 0x04, 0x00, 0x02, 0x6A, 0xF7
    ]);
    assert.deepEqual(msg, expected);
  });

  test('buildRQ1 constructs exact official Example 2 message', () => {
    const address = [0x20, 0x02, 0x22, 0x00];
    const size = [0x00, 0x00, 0x00, 0x31];
    const msg = buildRQ1(address, size, 0x10);

    const expected = new Uint8Array([
      0xF0, 0x41, 0x10, 0x00, 0x10, 0x11, 0x20, 0x02, 0x22, 0x00, 0x00, 0x00, 0x00, 0x31, 0x0B, 0xF7
    ]);
    assert.deepEqual(msg, expected);
  });

  test('parseSysEx correctly parses valid DT1 response', () => {
    const raw = new Uint8Array([
      0xF0, 0x41, 0x10, 0x00, 0x10, 0x12, 0x10, 0x00, 0x04, 0x00, 0x02, 0x6A, 0xF7
    ]);
    const parsed = parseSysEx(raw);
    assert.equal(parsed.valid, true);
    assert.equal(parsed.command, CMD_DT1);
    assert.deepEqual(parsed.address, [0x10, 0x00, 0x04, 0x00]);
    assert.deepEqual(parsed.data, [0x02]);
    assert.equal(parsed.deviceId, 0x10);
  });

  test('parseSysEx detects invalid checksum', () => {
    const raw = new Uint8Array([
      0xF0, 0x41, 0x10, 0x00, 0x10, 0x12, 0x10, 0x00, 0x04, 0x00, 0x02, 0x00, 0xF7
    ]);
    const parsed = parseSysEx(raw);
    assert.equal(parsed.valid, false);
    assert.match(parsed.error, /checksum/i);
  });

  test('parseSysEx rejects wrong manufacturer or model ID', () => {
    const wrongMfr = new Uint8Array([0xF0, 0x42, 0x10, 0x00, 0x10, 0x12, 0x10, 0x00, 0x04, 0x00, 0x02, 0x6A, 0xF7]);
    assert.equal(parseSysEx(wrongMfr).valid, false);

    const wrongModel = new Uint8Array([0xF0, 0x41, 0x10, 0x00, 0x11, 0x12, 0x10, 0x00, 0x04, 0x00, 0x02, 0x6A, 0xF7]);
    assert.equal(parseSysEx(wrongModel).valid, false);
  });
});

describe('SysEx Utility Helpers', () => {
  test('addressToString and stringToAddress roundtrip', () => {
    const addr = [0x10, 0x00, 0x20, 0x00];
    const str = addressToString(addr);
    assert.equal(str, '10-00-20-00');
    assert.deepEqual(stringToAddress(str), addr);
  });

  test('formatSysEx produces clean uppercase hex dump', () => {
    const bytes = [0xF0, 0x41, 0x10, 0xF7];
    assert.equal(formatSysEx(bytes), 'F0 41 10 F7');
  });
});
