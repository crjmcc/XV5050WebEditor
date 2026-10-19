import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  PATCH_COMMON,
  PATCH_TMT,
  PATCH_TONE,
  PATCH_MFX,
  PATCH_CHORUS,
  PATCH_REVERB,
  getPatchTempAddress,
  getPatchTMTAddress,
  getToneAddress,
  getPatchMFXAddress,
  getPatchChorusAddress,
  getPatchReverbAddress,
  addOffset,
} from '../src/addresses.js';
import {
  sendMatrixControlParam,
  sendTMTKeyRangeParam,
  sendToneEnvelopeParam,
  sendToneLFOParam,
} from '../src/patch.js';
import {
  generateEnvelopePath,
  generateFilterCurvePath,
  generateLFOWavePath,
} from '../src/visuals.js';
import {
  exportToSyx,
  parseSyxFile,
  createPatchSyxDump,
} from '../src/librarian.js';

describe('Stage 2 Sending Helpers & Patch Effects (Gaps 1, 2, 3, 4)', () => {
  // Mock MIDI manager to capture outgoing SysEx packets
  const createMockMidi = () => {
    const sent = [];
    return {
      sent,
      send: (bytes) => sent.push(bytes),
      sendAndReceive: async () => ({ data: [] }),
    };
  };

  test('sendMatrixControlParam builds DT1 message with correct address and byte', () => {
    const midi = createMockMidi();
    // Send Matrix 1 Source = 96 (BEND) to Single Patch mode (part 0)
    sendMatrixControlParam(midi, 0, 1, 'SOURCE', 96, 0x10);

    assert.equal(midi.sent.length, 1);
    const msg = midi.sent[0];
    assert.equal(msg[0], 0xF0);
    assert.equal(msg[msg.length - 1], 0xF7);
    // Address for Single Patch (1F 00 00 00) + offset 00 2B = 1F 00 00 2B
    assert.deepEqual(Array.from(msg.slice(6, 10)), [0x1F, 0x00, 0x00, 0x2B]);
    // Value = 96
    assert.equal(msg[10], 96);
  });

  test('sendTMTKeyRangeParam updates key splits directly via SysEx DT1', () => {
    const midi = createMockMidi();
    // Send Tone 2 Key Upper = 72 (C5) for Part 1 (base 11 00 00 00)
    sendTMTKeyRangeParam(midi, 1, 2, 'KEY_UPPER', 72, 0x10);

    assert.equal(midi.sent.length, 1);
    const msg = midi.sent[0];
    // TMT base for Part 1 is 11 00 10 00, TONE_2_KEY_UPPER offset is 0x10
    assert.deepEqual(Array.from(msg.slice(6, 10)), [0x11, 0x00, 0x10, 0x10]);
    assert.equal(msg[10], 72);
  });

  test('sendToneEnvelopeParam formats and sends Pitch, TVF, TVA envelope points', () => {
    const midi = createMockMidi();
    // Send Pitch Env T1 = 45 for Tone 1 in Single Patch mode
    sendToneEnvelopeParam(midi, 0, 1, 'PITCH', 'T1', 45, 0x10);
    // Send TVF Env Cutoff Depth = 90 (+26)
    sendToneEnvelopeParam(midi, 0, 1, 'TVF', 'DEPTH', 90, 0x10);

    assert.equal(midi.sent.length, 2);
    // Tone 1 Pitch Env T1 is at offset 0x3F from Tone 1 base (1F 00 20 00) -> 1F 00 20 3F
    assert.deepEqual(Array.from(midi.sent[0].slice(6, 10)), [0x1F, 0x00, 0x20, 0x3F]);
    assert.equal(midi.sent[0][10], 45);

    // TVF Env Depth is at offset 0x4F -> 1F 00 20 4F
    assert.deepEqual(Array.from(midi.sent[1].slice(6, 10)), [0x1F, 0x00, 0x20, 0x4F]);
    assert.equal(midi.sent[1][10], 90);
  });

  test('sendToneLFOParam sends LFO 1 and LFO 2 parameters to tone address space', () => {
    const midi = createMockMidi();
    // Send LFO1 Form = 4 (SQR)
    sendToneLFOParam(midi, 0, 3, 1, 'FORM', 4, 0x10);
    // Send LFO2 Rate = 80
    sendToneLFOParam(midi, 0, 3, 2, 'RATE', 80, 0x10);

    assert.equal(midi.sent.length, 2);
    // Tone 3 base is 1F 00 24 00. LFO1 Form is 0x8A -> 1F 00 24 8A
    // Note: 0x8A in 7-bit math: 24 00 + 8A = 25 0A
    const expectedLfo1Addr = addOffset([0x1F, 0x00, 0x24, 0x00], 0x8A);
    assert.deepEqual(Array.from(midi.sent[0].slice(6, 10)), expectedLfo1Addr);
    assert.equal(midi.sent[0][10], 4);

    const expectedLfo2Addr = addOffset([0x1F, 0x00, 0x24, 0x00], 0xFB);
    assert.deepEqual(Array.from(midi.sent[1].slice(6, 10)), expectedLfo2Addr);
    assert.equal(midi.sent[1][10], 80);
  });

  test('Patch MFX, Chorus, Reverb addresses and sizes match hardware tables', () => {
    const patchBase = getPatchTempAddress(0); // [1F, 00, 00, 00]
    const mfxAddr = getPatchMFXAddress(patchBase);
    const choAddr = getPatchChorusAddress(patchBase);
    const revAddr = getPatchReverbAddress(patchBase);

    assert.deepEqual(mfxAddr, [0x1F, 0x00, 0x02, 0x00]);
    assert.deepEqual(choAddr, [0x1F, 0x00, 0x04, 0x00]);
    assert.deepEqual(revAddr, [0x1F, 0x00, 0x06, 0x00]);

    assert.equal(PATCH_MFX.SIZE[3], 0x11);
    assert.equal(PATCH_CHORUS.SIZE[3], 0x34);
    assert.equal(PATCH_REVERB.SIZE[3], 0x53);
  });
});

describe('Visual Curves & SVG Generator (Stage 2 Gap 6)', () => {
  test('generateEnvelopePath creates valid SVG path coordinates for Pitch, TVF, and TVA', () => {
    const pitchPath = generateEnvelopePath('pitch', { t1: 20, t2: 30, t3: 40, t4: 30, l0: 64, l1: 84, l2: 64, l3: 64, l4: 64 });
    assert.ok(pitchPath.startsWith('M '));
    assert.ok(pitchPath.includes('L '));

    const tvfPath = generateEnvelopePath('tvf', { t1: 15, t2: 25, t3: 50, t4: 40, l1: 120, l2: 80, l3: 40, l4: 0 });
    assert.ok(tvfPath.startsWith('M '));

    const tvaPath = generateEnvelopePath('tva', { t1: 10, t2: 20, t3: 40, t4: 30, l1: 127, l2: 90, l3: 70 });
    assert.ok(tvaPath.startsWith('M '));
  });

  test('generateFilterCurvePath generates response slopes for LPF, HPF, BPF, PKG', () => {
    const lpfPath = generateFilterCurvePath('LPF', 80, 50);
    assert.ok(lpfPath.startsWith('M '));
    assert.ok(lpfPath.split('L').length > 25);

    const hpfPath = generateFilterCurvePath('HPF', 40, 20);
    assert.ok(hpfPath.startsWith('M '));

    const bpfPath = generateFilterCurvePath('BPF', 64, 90);
    assert.ok(bpfPath.startsWith('M '));
  });

  test('generateLFOWavePath visualizes waveform shapes over multiple cycles', () => {
    const sinPath = generateLFOWavePath('SIN', 64);
    assert.ok(sinPath.startsWith('M '));

    const sqrPath = generateLFOWavePath('SQR', 80);
    assert.ok(sqrPath.startsWith('M '));

    const sawPath = generateLFOWavePath('SAW-UP', 100);
    assert.ok(sawPath.startsWith('M '));
  });
});

describe('Librarian End-to-End File & Backup Workflows (Stage 2 Gap 5)', () => {
  test('Patch SYX creation, round-trip serialization and re-parsing', () => {
    const commonBytes = new Array(0x4F).fill(0);
    commonBytes[0x0E] = 115; // Patch level
    const tmtBytes = new Array(0x29).fill(0);
    tmtBytes[0x05] = 1; // Tone 1 active

    const syxPackets = createPatchSyxDump(0, commonBytes, tmtBytes, 0x10);
    assert.equal(syxPackets.length, 2);

    const binaryFile = exportToSyx(syxPackets);
    assert.ok(binaryFile instanceof Uint8Array);
    assert.ok(binaryFile.length > 50);

    const imported = parseSyxFile(binaryFile);
    assert.equal(imported.length, 2);
    assert.equal(imported[0].valid, true);
    assert.deepEqual(imported[0].address, [0x1F, 0x00, 0x00, 0x00]);
    assert.equal(imported[1].valid, true);
    assert.deepEqual(imported[1].address, [0x1F, 0x00, 0x10, 0x00]);
  });
});
