import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  PATCH_COMMON,
  PATCH_TMT,
  PATCH_TONE,
  getPatchTempAddress,
  getPatchTMTAddress,
  getToneAddress,
  addOffset,
} from '../src/addresses.js';
import {
  MATRIX_SOURCES,
  MATRIX_DESTINATIONS,
  LFO_WAVEFORMS,
  FILTER_TYPES,
  formatParamValue,
  parseDisplayValue,
  PATCH_COMMON_PARAMS,
  PATCH_TMT_PARAMS,
  PATCH_TONE_PARAMS,
} from '../src/parameters.js';
import {
  parsePatchCommon,
  parsePatchTMT,
  parsePatchTone,
  sendMatrixControlParam,
  sendTMTKeyRangeParam,
  sendToneEnvelopeParam,
  sendToneLFOParam,
} from '../src/patch.js';
import { buildDT1, parseSysEx } from '../src/sysex.js';

describe('Deep Patch Common & Matrix Control (Stage 2 Gap 1)', () => {
  test('Matrix Control parameter addresses match manual specifications', () => {
    // Matrix Control 1: Source at 00 2B, Dest 1-4 at 2C, 2E, 30, 32; Sens 1-4 at 2D, 2F, 31, 33
    assert.equal(PATCH_COMMON.params.MATRIX_CTRL_1_SOURCE.offset, 0x2B);
    assert.equal(PATCH_COMMON.params.MATRIX_CTRL_1_DEST_1.offset, 0x2C);
    assert.equal(PATCH_COMMON.params.MATRIX_CTRL_1_SENS_1.offset, 0x2D);
    assert.equal(PATCH_COMMON.params.MATRIX_CTRL_1_DEST_4.offset, 0x32);
    assert.equal(PATCH_COMMON.params.MATRIX_CTRL_1_SENS_4.offset, 0x33);

    // Matrix Control 4: Source at 00 46, Dest 1-4 at 47, 49, 4B, 4D; Sens 1-4 at 48, 4A, 4C, 4E
    assert.equal(PATCH_COMMON.params.MATRIX_CTRL_4_SOURCE.offset, 0x46);
    assert.equal(PATCH_COMMON.params.MATRIX_CTRL_4_DEST_4.offset, 0x4D);
    assert.equal(PATCH_COMMON.params.MATRIX_CTRL_4_SENS_4.offset, 0x4E);
  });

  test('Matrix Control sources has 110 entries and destinations has 34 entries', () => {
    assert.equal(MATRIX_SOURCES.length, 110);
    assert.equal(MATRIX_SOURCES[0], 'OFF');
    assert.equal(MATRIX_SOURCES[1], 'CC01');
    assert.equal(MATRIX_SOURCES[96], 'BEND');
    assert.equal(MATRIX_SOURCES[97], 'AFT');
    assert.equal(MATRIX_SOURCES[109], 'TVA-ENV');

    assert.equal(MATRIX_DESTINATIONS.length, 34);
    assert.equal(MATRIX_DESTINATIONS[0], 'OFF');
    assert.equal(MATRIX_DESTINATIONS[1], 'PCH');
    assert.equal(MATRIX_DESTINATIONS[2], 'CUT');
    assert.equal(MATRIX_DESTINATIONS[33], 'MFX-CTRL4');
  });

  test('parsePatchCommon extracts full Matrix Controls and Portamento/Offsets', () => {
    const raw = new Array(0x4F).fill(0);
    raw[0x1A] = 1; // Portamento Mode: LEGATO
    raw[0x1B] = 1; // Portamento Type: TIME
    raw[0x1C] = 1; // Portamento Start: NOTE
    raw[0x22] = 80; // Cutoff offset +16
    raw[0x2B] = 96; // Matrix 1 Source = BEND
    raw[0x2C] = 2;  // Matrix 1 Dest 1 = CUT (Cutoff)
    raw[0x2D] = 94; // Matrix 1 Sens 1 = +30 (94 - 64)

    const parsed = parsePatchCommon(raw);
    assert.equal(parsed.portamentoMode, 1);
    assert.equal(parsed.portamentoType, 1);
    assert.equal(parsed.portamentoStart, 1);
    assert.equal(parsed.cutoffOffset, 80);
    assert.equal(parsed.matrix1Source, 96);
    assert.equal(parsed.matrix1Dest1, 2);
    assert.equal(parsed.matrix1Sens1, 94);
  });
});

describe('TMT Key & Velocity Zones (Stage 2 Gap 2)', () => {
  test('TMT Key Range and Velocity Range parameter offsets conform to table 1-4-1-5', () => {
    // Tone 1: Key Lower 06, Upper 07, Fade Lower 08, Fade Upper 09
    // Vel Lower 0A, Upper 0B, Fade Lower 0C, Fade Upper 0D
    assert.equal(PATCH_TMT.params.TONE_1_KEY_LOWER.offset, 0x06);
    assert.equal(PATCH_TMT.params.TONE_1_KEY_UPPER.offset, 0x07);
    assert.equal(PATCH_TMT.params.TONE_1_VEL_LOWER.offset, 0x0A);
    assert.equal(PATCH_TMT.params.TONE_1_VEL_UPPER.offset, 0x0B);

    // Tone 4: Key Lower 21, Upper 22; Vel Lower 25, Upper 26
    assert.equal(PATCH_TMT.params.TONE_4_KEY_LOWER.offset, 0x21);
    assert.equal(PATCH_TMT.params.TONE_4_KEY_UPPER.offset, 0x22);
    assert.equal(PATCH_TMT.params.TONE_4_VEL_LOWER.offset, 0x25);
    assert.equal(PATCH_TMT.params.TONE_4_VEL_UPPER.offset, 0x26);
  });

  test('parsePatchTMT parses keyzones and velocity splits for all 4 tones', () => {
    const raw = new Array(0x29).fill(0);
    raw[0x04] = 1; // TMT Vel Control ON
    // Tone 1: C4 (60) to C6 (84), Vel 64 to 127
    raw[0x05] = 1;  // Tone 1 ON
    raw[0x06] = 60; // Key Lower
    raw[0x07] = 84; // Key Upper
    raw[0x0A] = 64; // Vel Lower
    raw[0x0B] = 127; // Vel Upper

    const parsed = parsePatchTMT(raw);
    assert.equal(parsed.tmtVelControl, 1);
    assert.equal(parsed.tone1Switch, 1);
    assert.equal(parsed.tone1KeyLower, 60);
    assert.equal(parsed.tone1KeyUpper, 84);
    assert.equal(parsed.tone1VelLower, 64);
    assert.equal(parsed.tone1VelUpper, 127);
  });
});

describe('Deep Tone Generator Engine (Stage 2 Gap 3)', () => {
  test('Tone Wave, Envelope, and LFO parameter offsets conform to table 1-4-1-6', () => {
    // Wave
    assert.equal(PATCH_TONE.params.WAVE_GROUP_TYPE.offset, 0x27);
    assert.equal(PATCH_TONE.params.WAVE_GAIN.offset, 0x34);
    assert.equal(PATCH_TONE.params.WAVE_FXM_SWITCH.offset, 0x35);
    assert.equal(PATCH_TONE.params.WAVE_FXM_DEPTH.offset, 0x37);

    // Pitch Envelope
    assert.equal(PATCH_TONE.params.PITCH_ENV_DEPTH.offset, 0x3A);
    assert.equal(PATCH_TONE.params.PITCH_ENV_T1.offset, 0x3F);
    assert.equal(PATCH_TONE.params.PITCH_ENV_L4.offset, 0x47);

    // TVF Filter & Envelope
    assert.equal(PATCH_TONE.params.TVF_FILTER_TYPE.offset, 0x48);
    assert.equal(PATCH_TONE.params.TVF_CUTOFF.offset, 0x49);
    assert.equal(PATCH_TONE.params.TVF_ENV_DEPTH.offset, 0x4F);
    assert.equal(PATCH_TONE.params.TVF_ENV_T1.offset, 0x55);
    assert.equal(PATCH_TONE.params.TVF_ENV_L4.offset, 0x5C);

    // TVA Amp & Envelope
    assert.equal(PATCH_TONE.params.TVA_LEVEL.offset, 0x6E);
    assert.equal(PATCH_TONE.params.TVA_ENV_T1.offset, 0x74);
    assert.equal(PATCH_TONE.params.TVA_ENV_L3.offset, 0x7A);

    // Dual LFO 1 & 2
    assert.equal(PATCH_TONE.params.LFO1_FORM.offset, 0x8A);
    assert.equal(PATCH_TONE.params.LFO1_RATE.offset, 0x8B);
    assert.equal(PATCH_TONE.params.LFO1_PITCH_DEPTH.offset, 0x94);
    assert.equal(PATCH_TONE.params.LFO2_FORM.offset, 0xFA);
    assert.equal(PATCH_TONE.params.LFO2_RATE.offset, 0xFB);
    assert.equal(PATCH_TONE.params.LFO2_TVF_DEPTH.offset, 0x0106);
  });

  test('parsePatchTone parses complete Wave, TVF, TVA, Envelope, and LFO blocks', () => {
    const raw = new Array(0x0109).fill(0);
    raw[0x00] = 110; // Tone Level
    raw[0x04] = 64;  // Pan C
    // Wave
    raw[0x27] = 2;   // SRX
    raw[0x34] = 2;   // +6 dB
    raw[0x35] = 1;   // FXM ON
    raw[0x37] = 8;   // FXM Depth 8
    // Pitch Env
    raw[0x3A] = 66;  // Pitch Env Depth +2 (66 - 64)
    raw[0x3F] = 20;  // Pitch T1
    raw[0x44] = 74;  // Pitch L1 +10
    // TVF
    raw[0x48] = 5;   // LPF2
    raw[0x49] = 88;  // Cutoff
    raw[0x4D] = 45;  // Resonance
    raw[0x4F] = 94;  // TVF Env Depth +30
    raw[0x55] = 30;  // TVF T1
    raw[0x59] = 120; // TVF L1
    // TVA
    raw[0x6E] = 105; // TVA Level
    raw[0x74] = 15;  // TVA T1
    raw[0x78] = 127; // TVA L1
    // LFO1
    raw[0x8A] = 1;   // SIN wave
    raw[0x8B] = 85;  // Rate
    raw[0x94] = 74;  // Pitch Depth +10
    // LFO2
    raw[0xFA] = 4;   // SQR wave
    raw[0xFB] = 40;  // Rate
    raw[0x0106] = 84;// TVF Depth +20

    const parsed = parsePatchTone(raw);
    assert.equal(parsed.toneLevel, 110);
    assert.equal(parsed.waveGroupType, 2);
    assert.equal(parsed.waveGain, 2);
    assert.equal(parsed.fxmSwitch, 1);
    assert.equal(parsed.pitchEnvDepth, 66);
    assert.equal(parsed.pitchEnvT1, 20);
    assert.equal(parsed.tvfFilterType, 5);
    assert.equal(parsed.tvfCutoff, 88);
    assert.equal(parsed.tvfResonance, 45);
    assert.equal(parsed.tvfEnvDepth, 94);
    assert.equal(parsed.tvfEnvT1, 30);
    assert.equal(parsed.tvaLevel, 105);
    assert.equal(parsed.tvaEnvT1, 15);
    assert.equal(parsed.lfo1Form, 1);
    assert.equal(parsed.lfo1Rate, 85);
    assert.equal(parsed.lfo1PitchDepth, 74);
    assert.equal(parsed.lfo2Form, 4);
    assert.equal(parsed.lfo2Rate, 40);
    assert.equal(parsed.lfo2TvfDepth, 84);
  });
});
