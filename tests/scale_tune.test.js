import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  NOTE_NAMES,
  SCALE_TEMPERAMENTS,
  getPartScaleTuneAddress,
  centsToRaw,
  rawToCents,
  buildNoteScaleTuneDT1,
  buildPartScaleTemperamentDT1
} from '../src/scale_tune.js';

describe('Scale Tune & Microtonal Temperaments (OM Chapter 3 p. 66)', () => {
  test('NOTE_NAMES defines all 12 chromatic semitones starting at C', () => {
    assert.equal(NOTE_NAMES.length, 12);
    assert.deepEqual(NOTE_NAMES, ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B']);
  });

  test('centsToRaw and rawToCents convert accurately with center 64 = 0 cents', () => {
    assert.equal(centsToRaw(0), 64);
    assert.equal(centsToRaw(-64), 0);
    assert.equal(centsToRaw(63), 127);
    assert.equal(centsToRaw(-50), 14);

    assert.equal(rawToCents(64), 0);
    assert.equal(rawToCents(0), -64);
    assert.equal(rawToCents(127), 63);
    assert.equal(rawToCents(14), -50);
  });

  test('getPartScaleTuneAddress maps Part 1 to 10 00 10 40 through Part 16 to 10 00 1F 40', () => {
    assert.deepEqual(getPartScaleTuneAddress(1), [0x10, 0x00, 0x10, 0x40]);
    assert.deepEqual(getPartScaleTuneAddress(2), [0x10, 0x00, 0x11, 0x40]);
    assert.deepEqual(getPartScaleTuneAddress(10), [0x10, 0x00, 0x19, 0x40]);
    assert.deepEqual(getPartScaleTuneAddress(16), [0x10, 0x00, 0x1F, 0x40]);

    assert.throws(() => getPartScaleTuneAddress(0));
    assert.throws(() => getPartScaleTuneAddress(17));
  });

  test('buildNoteScaleTuneDT1 constructs valid Roland DT1 message for a note', () => {
    const msg = buildNoteScaleTuneDT1(0x10, 1, 0, 0); // Part 1, note C, 0 cents
    assert.equal(msg[0], 0xF0);
    assert.equal(msg[msg.length - 1], 0xF7);
    assert.equal(msg[5], 0x12); // DT1
    // Address 10 00 10 40
    assert.equal(msg[6], 0x10);
    assert.equal(msg[7], 0x00);
    assert.equal(msg[8], 0x10);
    assert.equal(msg[9], 0x40);
    assert.equal(msg[10], 64); // raw 0 cents
  });

  test('buildPartScaleTemperamentDT1 builds valid 12-byte DT1 packet', () => {
    const equalOffsets = SCALE_TEMPERAMENTS.equal.offsets;
    const msg = buildPartScaleTemperamentDT1(0x10, 1, equalOffsets);
    // F0(1) + 41(1) + dev(1) + 00(1) + 10(1) + cmd(1) + addr(4) + data(12) + chk(1) + F7(1) = 24 bytes
    assert.equal(msg.length, 24);
    for (let i = 10; i < 22; i++) {
      assert.equal(msg[i], 64); // all 0 cents
    }
  });

  test('SCALE_TEMPERAMENTS contains authentic historical and ethnic scales', () => {
    assert.ok(SCALE_TEMPERAMENTS.equal);
    assert.ok(SCALE_TEMPERAMENTS.justMajor);
    assert.ok(SCALE_TEMPERAMENTS.pythagorean);
    assert.ok(SCALE_TEMPERAMENTS.meantone);
    assert.ok(SCALE_TEMPERAMENTS.werckmeister);
    assert.ok(SCALE_TEMPERAMENTS.kirnberger);
    assert.ok(SCALE_TEMPERAMENTS.arabicRast);

    // Arabic Rast should have -50 cents on E (index 4) and B (index 11)
    assert.equal(SCALE_TEMPERAMENTS.arabicRast.offsets[4], -50);
    assert.equal(SCALE_TEMPERAMENTS.arabicRast.offsets[11], -50);
  });
});
