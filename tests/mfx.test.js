import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { MFX_CATALOG, MFX_CTRL_SOURCES, getMfxAlgorithm } from '../src/mfx_data.js';
import { getPerfMfxAddress, MFX_PARAMS } from '../src/addresses.js';
import { sendPerformanceMfxParam, parsePerformanceMfx } from '../src/performance.js';
import { parseSysEx } from '../src/sysex.js';

describe('Roland XV-5050 3-MFX Multi-Effects Engine & Catalog', () => {
  test('MFX catalog contains all 90 Roland XV-5050 algorithms', () => {
    assert.equal(MFX_CATALOG.length, 91); // 0 (OFF) + 1-90
    for (let id = 1; id <= 90; id++) {
      const algo = MFX_CATALOG[id];
      assert.ok(algo, `Algorithm #${id} must exist in catalog`);
      assert.equal(algo.id, id);
      assert.ok(algo.name && algo.name.length > 0, `Algorithm #${id} must have a non-empty name`);
      assert.ok(algo.category, `Algorithm #${id} must have a category`);
      assert.ok(Array.isArray(algo.params), `Algorithm #${id} must have a params array`);
      assert.ok(algo.params.length <= 12, `Algorithm #${id} must not exceed 12 parameters`);
    }
  });

  test('MFX controller sources catalog contains 101 controller options', () => {
    assert.equal(MFX_CTRL_SOURCES.length, 101);
    assert.equal(MFX_CTRL_SOURCES[0], 'OFF');
    assert.equal(MFX_CTRL_SOURCES[1], 'CC 01: Modulation');
    assert.equal(MFX_CTRL_SOURCES[95], 'BEND: Pitch Bend');
    assert.equal(MFX_CTRL_SOURCES[96], 'AFT: Aftertouch');
    assert.equal(MFX_CTRL_SOURCES[97], 'SYS-CTRL 1');
  });

  test('getPerfMfxAddress maps MFX-A, MFX-B, MFX-C to accurate hardware SysEx addresses', () => {
    assert.deepEqual(getPerfMfxAddress('A'), [0x10, 0x00, 0x02, 0x00]);
    assert.deepEqual(getPerfMfxAddress('a'), [0x10, 0x00, 0x02, 0x00]);
    assert.deepEqual(getPerfMfxAddress('B'), [0x10, 0x00, 0x08, 0x00]);
    assert.deepEqual(getPerfMfxAddress('b'), [0x10, 0x00, 0x08, 0x00]);
    assert.deepEqual(getPerfMfxAddress('C'), [0x10, 0x00, 0x0A, 0x00]);
    assert.deepEqual(getPerfMfxAddress('c'), [0x10, 0x00, 0x0A, 0x00]);
  });

  test('sendPerformanceMfxParam builds correct 4-nibble word for algorithm parameter', () => {
    const mockMidi = {
      sent: [],
      send(msg) { this.sent.push(msg); },
    };

    // Send PARAM_1 (offset 0x11, size 4) with value 200 (offset by 32768 => 32968 = 0x80C8)
    sendPerformanceMfxParam(mockMidi, 'A', 'PARAM_1', 200, 0x10);
    assert.equal(mockMidi.sent.length, 1);
    const parsed = parseSysEx(mockMidi.sent[0]);
    assert.ok(parsed.valid);
    assert.deepEqual(parsed.address, [0x10, 0x00, 0x02, 0x11]);
    // 32968 in 4 nibbles: 0x8, 0x0, 0xC, 0x8
    assert.deepEqual(parsed.data, [0x08, 0x00, 0x0C, 0x08]);
  });

  test('sendPerformanceMfxParam builds correct bipolar byte for controller sensitivity', () => {
    const mockMidi = {
      sent: [],
      send(msg) { this.sent.push(msg); },
    };

    // Send MFX_CTRL_1_SENS with sensitivity -10 (encoded as -10 + 64 = 54 = 0x36)
    sendPerformanceMfxParam(mockMidi, 'B', 'MFX_CTRL_1_SENS', -10, 0x10);
    assert.equal(mockMidi.sent.length, 1);
    const parsed = parseSysEx(mockMidi.sent[0]);
    assert.ok(parsed.valid);
    assert.deepEqual(parsed.address, [0x10, 0x00, 0x08, 0x06]);
    assert.deepEqual(parsed.data, [54]);
  });

  test('parsePerformanceMfx correctly extracts full 3-MFX block data', () => {
    // Construct mock raw buffer with 75 bytes:
    // [0x00]: Type=1 (Stereo EQ), [0x01]: Dry=100, [0x02]: Cho=20, [0x03]: Rev=40, [0x04]: Assign=1 (B)
    // [0x05]: Ctrl1Src=1, [0x06]: Ctrl1Sens=74 (+10), [0x07]: Ctrl2Src=2, [0x08]: Ctrl2Sens=64 (0)
    // [0x11..0x14]: Param 1 = 32968 (value 200) => 8, 0, 12, 8
    const raw = new Array(80).fill(0);
    raw[0x00] = 1;
    raw[0x01] = 100;
    raw[0x02] = 20;
    raw[0x03] = 40;
    raw[0x04] = 1;
    raw[0x05] = 1;
    raw[0x06] = 74; // +10
    raw[0x11] = 0x08;
    raw[0x12] = 0x00;
    raw[0x13] = 0x0C;
    raw[0x14] = 0x08;

    const parsed = parsePerformanceMfx(raw);
    assert.equal(parsed.mfxType, 1);
    assert.equal(parsed.dryLevel, 100);
    assert.equal(parsed.chorusSend, 20);
    assert.equal(parsed.reverbSend, 40);
    assert.equal(parsed.outputAssign, 1);
    assert.equal(parsed.ctrl1Source, 1);
    assert.equal(parsed.ctrl1Sens, 10);
    assert.equal(parsed.params[0], 200);
  });
});
