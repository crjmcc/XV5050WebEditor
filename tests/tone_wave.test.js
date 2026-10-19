import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  INTERNAL_WAVEFORMS,
  WAVE_GROUP_TYPES,
  getWaveName,
  PATCH_TONE_PARAMS,
} from '../src/parameters.js';
import {
  PATCH_TONE,
  getToneAddress,
} from '../src/addresses.js';
import {
  parsePatchTone,
  sendPatchToneParam,
  sendToneWaveParam,
} from '../src/patch.js';
import { createPatchSyxDump, exportToSyx, parseSyxFile } from '../src/librarian.js';
import { parseSysEx } from '../src/sysex.js';

describe('Tone Wave Information & 1,083 Internal Waveform Catalog', () => {
  test('waveform catalog contains exactly 1,083 entries matching manual Table pp. 138-140', () => {
    assert.equal(INTERNAL_WAVEFORMS.length, 1083);
    // Wave 1
    assert.equal(INTERNAL_WAVEFORMS[0], 'StGrand pA L');
    // Wave 2
    assert.equal(INTERNAL_WAVEFORMS[1], 'StGrand pA R');
    // Intermediate landmark waves from manual
    assert.equal(INTERNAL_WAVEFORMS[99], 'RockOrg1 A L');
    assert.equal(INTERNAL_WAVEFORMS[299], 'Clarinet C');
    assert.equal(INTERNAL_WAVEFORMS[499], 'DIGI Bell 1');
    assert.equal(INTERNAL_WAVEFORMS[1081], 'REV Timp3 mp');
    // Final wave 1083
    assert.equal(INTERNAL_WAVEFORMS[1082], 'REV Metro');
  });

  test('getWaveName resolves internal waveforms and expansion names correctly', () => {
    // Wave 0 is OFF
    assert.equal(getWaveName(0, 0), 'OFF');
    // Internal 1-1083
    assert.equal(getWaveName(0, 1), 'StGrand pA L');
    assert.equal(getWaveName(0, 2), 'StGrand pA R');
    assert.equal(getWaveName(0, 1083), 'REV Metro');
    // Out of range internal
    assert.equal(getWaveName(0, 1084), 'Wave 1084');

    // Expansion groups
    assert.equal(getWaveName(1, 42), 'SR-JV80:0042');
    assert.equal(getWaveName(2, 99), 'SRX:0099');
    assert.equal(getWaveName(3, 10), 'SAMPLE:0010');
  });

  test('Wave Number L and Wave Number R 4-nibble parameter definitions in addresses.js', () => {
    assert.equal(PATCH_TONE.params.WAVE_NUMBER_L.offset, 0x2C);
    assert.equal(PATCH_TONE.params.WAVE_NUMBER_L.size, 4);

    assert.equal(PATCH_TONE.params.WAVE_NUMBER_R.offset, 0x30);
    assert.equal(PATCH_TONE.params.WAVE_NUMBER_R.size, 4);

    assert.equal(PATCH_TONE.params.WAVE_GROUP_TYPE.offset, 0x27);
    assert.equal(PATCH_TONE.params.WAVE_GROUP_ID.offset, 0x28);
    assert.equal(PATCH_TONE.params.WAVE_GROUP_ID.size, 4);
    assert.equal(PATCH_TONE.params.WAVE_GAIN.offset, 0x34);
    assert.equal(PATCH_TONE.params.WAVE_FXM_SWITCH.offset, 0x35);
    assert.equal(PATCH_TONE.params.WAVE_FXM_SW.offset, 0x35);
    assert.equal(PATCH_TONE.params.WAVE_FXM_COLOR.offset, 0x36);
    assert.equal(PATCH_TONE.params.WAVE_FXM_DEPTH.offset, 0x37);
    assert.equal(PATCH_TONE.params.WAVE_TEMPO_SYNC.offset, 0x38);
    assert.equal(PATCH_TONE.params.WAVE_PITCH_KEYFOLLOW.offset, 0x39);
    assert.equal(PATCH_TONE.params.PITCH_KEYFOLLOW.offset, 0x39);
  });

  test('sendPatchToneParam encodes 4-nibble wave numbers into DT1 messages', () => {
    const sent = [];
    const mockMidi = {
      send: (bytes) => sent.push(bytes),
    };

    // Send Wave Number L = 1083 (0x043B -> nibbles 0x00, 0x04, 0x03, 0x0B) to Part 1, Tone 1
    sendPatchToneParam(mockMidi, 1, 1, 'WAVE_NUMBER_L', 1083, 0x10);

    assert.equal(sent.length, 1);
    const parsed = parseSysEx(sent[0]);
    assert.equal(parsed.command, 0x12); // DT1
    // Offset for Tone 1 Base (0x00, 0x20, 0x00) + 0x2C = 0x00, 0x20, 0x2C
    // In Performance mode Part 1: Base is [0x11, 0x00, 0x00, 0x00]
    // Tone 1 address: [0x11, 0x00, 0x20, 0x2C]
    assert.deepEqual(parsed.address, [0x11, 0x00, 0x20, 0x2C]);
    // 4 nibbles of 1083:
    assert.deepEqual(parsed.data, [0x00, 0x04, 0x03, 0x0B]);

    // Send Wave Number R = 2 (0x0002 -> nibbles 0x00, 0x00, 0x00, 0x02) to Part 1, Tone 2 using object form
    sendPatchToneParam(mockMidi, 1, 2, PATCH_TONE.params.WAVE_NUMBER_R, 2, 0x10);
    assert.equal(sent.length, 2);
    const parsed2 = parseSysEx(sent[1]);
    assert.deepEqual(parsed2.address, [0x11, 0x00, 0x22, 0x30]);
    assert.deepEqual(parsed2.data, [0x00, 0x00, 0x00, 0x02]);
  });

  test('sendToneWaveParam helper convenience function routes wave parameters correctly', () => {
    const sent = [];
    const mockMidi = {
      send: (bytes) => sent.push(bytes),
    };

    // Set Tone 3 Wave Gain (+12 dB = 3)
    sendToneWaveParam(mockMidi, 1, 3, 'WAVE_GAIN', 3, 0x10);
    assert.equal(sent.length, 1);
    const parsed = parseSysEx(sent[0]);
    assert.deepEqual(parsed.address, [0x11, 0x00, 0x24, 0x34]);
    assert.deepEqual(parsed.data, [0x03]);
  });

  test('parsePatchTone parses 4-nibble waveGroupId, waveNumberL, and waveNumberR', () => {
    const raw = new Array(0x0109).fill(0);
    // Wave Group ID: nibbles [0, 0, 0, 1] -> 1
    raw[0x28] = 0; raw[0x29] = 0; raw[0x2A] = 0; raw[0x2B] = 1;
    // Wave Number L: 1083 (0x043B -> [0, 4, 3, 11])
    raw[0x2C] = 0; raw[0x2D] = 4; raw[0x2E] = 3; raw[0x2F] = 11;
    // Wave Number R: 299 (0x012B -> [0, 1, 2, 11])
    raw[0x30] = 0; raw[0x31] = 1; raw[0x32] = 2; raw[0x33] = 11;
    // Wave FXM Color = 3, Depth = 12, Tempo Sync = 1
    raw[0x36] = 3;
    raw[0x37] = 12;
    raw[0x38] = 1;

    const parsed = parsePatchTone(raw);
    assert.equal(parsed.waveGroupId, 1);
    assert.equal(parsed.waveNumberL, 1083);
    assert.equal(parsed.waveNumberR, 299);
    assert.equal(parsed.waveFxmColor, 3);
    assert.equal(parsed.waveFxmDepth, 12);
    assert.equal(parsed.waveTempoSync, 1);
  });

  test('createPatchSyxDump packages complete 6-packet dump with Tone wave data', () => {
    const commonData = new Array(0x4F).fill(0);
    commonData[0x00] = 0x57; // 'W'
    commonData[0x01] = 0x41; // 'A'
    commonData[0x02] = 0x56; // 'V'
    commonData[0x03] = 0x45; // 'E'

    const tmtData = new Array(0x28).fill(0);

    // Create 4 tones with distinct wave numbers
    const tonesData = [];
    for (let t = 1; t <= 4; t++) {
      const tone = new Array(0x0109).fill(0);
      tone[0x00] = 100 + t; // Tone level
      // Set Wave Number L to t * 100
      const waveNum = t * 100;
      tone[0x2C] = (waveNum >> 12) & 0x0F;
      tone[0x2D] = (waveNum >> 8) & 0x0F;
      tone[0x2E] = (waveNum >> 4) & 0x0F;
      tone[0x2F] = waveNum & 0x0F;
      tonesData.push(tone);
    }

    const packets = createPatchSyxDump(1, commonData, tmtData, tonesData, 0x10);
    assert.equal(packets.length, 6);

    const syxBytes = exportToSyx(packets);
    const parsedPackets = parseSyxFile(syxBytes);

    // Should contain 6 packets: Common + TMT + Tone 1 + Tone 2 + Tone 3 + Tone 4
    assert.equal(parsedPackets.length, 6);

    // Packet 0: Common
    assert.deepEqual(parsedPackets[0].address, [0x11, 0x00, 0x00, 0x00]);
    assert.equal(parsedPackets[0].data.length, 0x4F);

    // Packet 1: TMT
    assert.deepEqual(parsedPackets[1].address, [0x11, 0x00, 0x10, 0x00]);
    assert.equal(parsedPackets[1].data.length, 0x28);

    // Packet 2: Tone 1 (Wave Number L = 100)
    assert.deepEqual(parsedPackets[2].address, [0x11, 0x00, 0x20, 0x00]);
    assert.equal(parsedPackets[2].data.length, 0x0109);
    const waveNum1 = (parsedPackets[2].data[0x2C] << 12) |
                     (parsedPackets[2].data[0x2D] << 8) |
                     (parsedPackets[2].data[0x2E] << 4) |
                     parsedPackets[2].data[0x2F];
    assert.equal(waveNum1, 100);

    // Packet 5: Tone 4 (Wave Number L = 400)
    assert.deepEqual(parsedPackets[5].address, [0x11, 0x00, 0x26, 0x00]);
    assert.equal(parsedPackets[5].data.length, 0x0109);
    const waveNum4 = (parsedPackets[5].data[0x2C] << 12) |
                     (parsedPackets[5].data[0x2D] << 8) |
                     (parsedPackets[5].data[0x2E] << 4) |
                     parsedPackets[5].data[0x2F];
    assert.equal(waveNum4, 400);
  });
});
