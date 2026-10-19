import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  decodeName,
  encodeName,
  formatParamValue,
  parseDisplayValue,
  PERF_PART_PARAMS,
  PATCH_COMMON_PARAMS,
} from '../src/parameters.js';
import {
  parsePerformanceCommon,
  parsePerformanceChorus,
  parsePerformanceReverb,
  parsePerformancePart,
} from '../src/performance.js';
import {
  parsePatchCommon,
  parsePatchTMT,
  parsePatchTone,
} from '../src/patch.js';

describe('Parameter Formatting and Name Encoding', () => {
  test('ASCII name encoding pads to 12 characters', () => {
    const encoded = encodeName('XV LEAD');
    assert.equal(encoded.length, 12);
    assert.deepEqual(encoded.slice(0, 7), [88, 86, 32, 76, 69, 65, 68]);
    assert.deepEqual(encoded.slice(7), [32, 32, 32, 32, 32]);
  });

  test('ASCII name decoding trims trailing spaces', () => {
    const bytes = [88, 86, 32, 76, 69, 65, 68, 32, 32, 32, 32, 32];
    assert.equal(decodeName(bytes), 'XV LEAD');
  });

  test('formatParamValue handles pan values (0-127)', () => {
    const panDef = PERF_PART_PARAMS.PART_PAN;
    assert.equal(formatParamValue(panDef, 64), 'C');
    assert.equal(formatParamValue(panDef, 0), 'L64');
    assert.equal(formatParamValue(panDef, 127), 'R63');
  });

  test('formatParamValue handles signed values with displayOffset', () => {
    const coarseDef = PERF_PART_PARAMS.COARSE_TUNE; // offset -64
    assert.equal(formatParamValue(coarseDef, 64), '0');
    assert.equal(formatParamValue(coarseDef, 76), '12');
    assert.equal(formatParamValue(coarseDef, 52), '-12');
  });

  test('parseDisplayValue converts pan strings back to raw bytes', () => {
    const panDef = PERF_PART_PARAMS.PART_PAN;
    assert.equal(parseDisplayValue(panDef, 'C'), 64);
    assert.equal(parseDisplayValue(panDef, 'L64'), 0);
    assert.equal(parseDisplayValue(panDef, 'R63'), 127);
  });
});

describe('Performance and Patch Data Parsing', () => {
  test('parsePerformanceCommon accurately parses header and source assignments', () => {
    const mockData = new Array(53).fill(0);
    // Name "STAGE PIANO "
    const nameBytes = encodeName('STAGE PIANO');
    for (let i = 0; i < 12; i++) mockData[i] = nameBytes[i];
    mockData[0x0C] = 3; // Solo Part 3
    mockData[0x30] = 1; // MFXA Source = Part 1

    const parsed = parsePerformanceCommon(mockData);
    assert.equal(parsed.name, 'STAGE PIANO');
    assert.equal(parsed.soloPartSelect, 3);
    assert.equal(parsed.mfxASource, 1);
  });

  test('parsePerformancePart accurately maps Part parameters', () => {
    const mockPart = new Array(49).fill(0);
    mockPart[0x00] = 5; // Channel 6 (0-indexed 5)
    mockPart[0x01] = 1; // Receive ON
    mockPart[0x04] = 87; // Bank MSB
    mockPart[0x05] = 64; // Bank LSB
    mockPart[0x06] = 12; // PC 12
    mockPart[0x07] = 110; // Part Level
    mockPart[0x08] = 64; // Center Pan
    mockPart[0x09] = 64; // Coarse Tune 0
    mockPart[0x1B] = 0; // Not Muted

    const parsed = parsePerformancePart(mockPart);
    assert.equal(parsed.receiveChannel, 5);
    assert.equal(parsed.receiveSwitch, 1);
    assert.equal(parsed.patchBankMSB, 87);
    assert.equal(parsed.patchBankLSB, 64);
    assert.equal(parsed.patchPC, 12);
    assert.equal(parsed.partLevel, 110);
    assert.equal(parsed.partPan, 64);
    assert.equal(parsed.muteSwitch, 0);
  });

  test('parsePatchCommon and parsePatchTMT extract patch attributes and tone switches', () => {
    const mockPatchCommon = new Array(79).fill(0);
    const patchNameBytes = encodeName('WARM STRINGS');
    for (let i = 0; i < 12; i++) mockCommonCopy(mockPatchCommon, patchNameBytes, i);
    mockPatchCommon[0x0E] = 120; // Level
    mockPatchCommon[0x0F] = 64;  // Pan
    mockPatchCommon[0x16] = 1;   // Poly
    mockPatchCommon[0x19] = 1;   // Portamento ON

    const parsedCommon = parsePatchCommon(mockPatchCommon);
    assert.equal(parsedCommon.name, 'WARM STRINGS');
    assert.equal(parsedCommon.patchLevel, 120);
    assert.equal(parsedCommon.patchPan, 64);
    assert.equal(parsedCommon.monoPoly, 1);
    assert.equal(parsedCommon.portamentoSwitch, 1);

    const mockTMT = new Array(41).fill(0);
    mockTMT[0x00] = 2; // Structure 1-2 Type 3
    mockTMT[0x05] = 1; // Tone 1 ON
    mockTMT[0x0E] = 1; // Tone 2 ON
    mockTMT[0x17] = 0; // Tone 3 OFF
    mockTMT[0x20] = 0; // Tone 4 OFF

    const parsedTMT = parsePatchTMT(mockTMT);
    assert.equal(parsedTMT.structureType12, 2);
    assert.equal(parsedTMT.tone1Switch, 1);
    assert.equal(parsedTMT.tone2Switch, 1);
    assert.equal(parsedTMT.tone3Switch, 0);
    assert.equal(parsedTMT.tone4Switch, 0);
  });
});

function mockCommonCopy(dest, src, i) {
  dest[i] = src[i];
}
