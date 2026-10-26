import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  DRUM_KEY_MAP,
  DRUM_OCTAVES,
  DRUM_HIT_LIBRARY,
  getRhythmKeyAddress,
  RHYTHM_KEY_OFFSETS,
  buildRhythmKeyDT1,
  encodeWaveNibbles
} from '../src/rhythm.js';
import { getSrxBoard, getSrxPatches, getSrxWaveforms } from '../src/srx_data.js';

describe('Roland XV-5050 Rhythm Set & Per-Key Drum Designer Engine', () => {
  test('DRUM_KEY_MAP covers standard Roland/GM range from 35/B1 to 98/D7 (64 keys)', () => {
    const keys = Object.keys(DRUM_KEY_MAP).map(Number);
    assert.equal(keys.length, 64);
    assert.equal(Math.min(...keys), 35);
    assert.equal(Math.max(...keys), 98);

    assert.equal(DRUM_KEY_MAP[35].name, 'Acoustic Bass Drum');
    assert.equal(DRUM_KEY_MAP[36].name, 'Bass Drum 1');
    assert.equal(DRUM_KEY_MAP[38].name, 'Acoustic Snare');
    assert.equal(DRUM_KEY_MAP[42].name, 'Closed Hi-Hat');
    assert.equal(DRUM_KEY_MAP[46].name, 'Open Hi-Hat');
    assert.equal(DRUM_KEY_MAP[49].name, 'Crash Cymbal 1');
    assert.equal(DRUM_KEY_MAP[51].name, 'Ride Cymbal 1');

    // Hi-hats should share Mute Group 1
    assert.equal(DRUM_KEY_MAP[42].defaultMute, 1);
    assert.equal(DRUM_KEY_MAP[44].defaultMute, 1);
    assert.equal(DRUM_KEY_MAP[46].defaultMute, 1);
  });

  test('DRUM_OCTAVES groups all 64 keys into 5 scrollable octave banks', () => {
    assert.equal(DRUM_OCTAVES.length, 5);
    let totalNotes = 0;
    for (const bank of DRUM_OCTAVES) {
      assert.ok(bank.octave >= 1 && bank.octave <= 5);
      assert.ok(bank.label.length > 0);
      assert.ok(bank.notes.length > 0);
      totalNotes += bank.notes.length;
    }
    assert.equal(totalNotes, 64);
  });

  test('getRhythmKeyAddress correctly calculates 7-bit addresses according to Table 1-4-2', () => {
    // Single mode Key 21 should be 10 00 50 00
    const addr21Single = getRhythmKeyAddress(21, false);
    assert.deepEqual(addr21Single, [0x10, 0x00, 0x50, 0x00]);

    // Single mode Key 35 (Note 35, 14 steps above Key 21)
    const addr35Single = getRhythmKeyAddress(35, false);
    assert.ok(addr35Single);

    // Performance mode Part 10 temporary rhythm set base is 14 70 00 00
    const addr36Perf = getRhythmKeyAddress(36, true);
    assert.equal(addr36Perf[0], 0x14);

    assert.throws(() => getRhythmKeyAddress(10));
    assert.throws(() => getRhythmKeyAddress(110));
  });

  test('buildRhythmKeyDT1 builds valid DT1 packet for tuning or cutoff', () => {
    const msgCutoff = buildRhythmKeyDT1(0x10, 36, RHYTHM_KEY_OFFSETS.TVF_CUTOFF, 100);
    assert.equal(msgCutoff[0], 0xF0);
    assert.equal(msgCutoff[msgCutoff.length - 1], 0xF7);
    assert.equal(msgCutoff[5], 0x12); // DT1
    assert.equal(msgCutoff[10], 100); // Cutoff value 100
  });

  test('encodeWaveNibbles correctly encodes 16-bit waveform numbers into 4 Roland nibbles', () => {
    const nibbles1 = encodeWaveNibbles(1);
    assert.deepEqual(nibbles1, [0, 0, 0, 1]);

    const nibbles743 = encodeWaveNibbles(743); // 0x02E7 -> 0, 2, 14, 7
    assert.deepEqual(nibbles743, [0, 2, 14, 7]);
  });

  test('DRUM_HIT_LIBRARY contains categorized drum hit presets with valid parameters', () => {
    assert.ok(DRUM_HIT_LIBRARY.length >= 20);
    const categories = new Set(DRUM_HIT_LIBRARY.map(h => h.category));
    assert.ok(categories.has('Kick'));
    assert.ok(categories.has('Snare'));
    assert.ok(categories.has('Hi-Hat'));
    assert.ok(categories.has('Tom'));
    assert.ok(categories.has('Cymbal'));

    const kick808 = DRUM_HIT_LIBRARY.find(h => h.id === 'kick_808_sub');
    assert.ok(kick808);
    assert.equal(kick808.name, '808 Sub Boom Kick');
    assert.equal(kick808.waveNumber, 743);
    assert.equal(kick808.coarseTune, 58);

    const hatClosed = DRUM_HIT_LIBRARY.find(h => h.id === 'hat_closed_tight');
    assert.ok(hatClosed);
    assert.equal(hatClosed.muteGroup, 1); // Standard Hi-Hat choke
  });

  test('SRX Expansion boards provide selectable patch presets and drum waveforms', () => {
    const board01 = getSrxBoard('SRX-01');
    assert.ok(board01);
    assert.equal(board01.name, 'SRX-01 Dynamic Drum Kits');
    assert.ok(board01.drumKits.length >= 8);

    const patches01 = getSrxPatches('SRX-01');
    assert.equal(patches01.length, 128);
    assert.ok(patches01[0].includes('SRX-01'));

    const waves01 = getSrxWaveforms('SRX-01');
    assert.equal(waves01.length, 88);
    assert.ok(waves01[0].includes('Dyn Dry Kick 1'));
  });
});

