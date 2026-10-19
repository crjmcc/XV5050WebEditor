import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  requestPerformanceCommon,
  requestPerformanceChorus,
  requestPerformanceReverb,
  requestPerformancePart,
  requestPartPatchName,
  requestAllParts,
  requestEntirePerformance,
  sendPerformanceCommonParam,
  sendPerformanceName,
  sendPartParam,
} from '../src/performance.js';
import {
  requestPatchCommon,
  requestPatchTMT,
  requestPatchTone,
  requestEntirePatch,
  sendPatchCommonParam,
  sendPatchTMTParam,
  sendToneSwitch,
  sendPatchName,
} from '../src/patch.js';
import { MidiManager } from '../src/midi.js';
import { buildDT1, buildRQ1, parseSysEx, calculateChecksum } from '../src/sysex.js';
import {
  PERF_TEMP,
  PERF_PART,
  PATCH_COMMON,
  PATCH_TMT,
  PATCH_TONE,
  getPartAddress,
  getPatchTempAddress,
  getPatchTMTAddress,
  getToneAddress,
} from '../src/addresses.js';
import { encodeName } from '../src/parameters.js';

/**
 * Mock MIDI Manager that simulates the hardware responding to SysEx RQ1 requests.
 */
class MockMidiDevice {
  constructor(deviceId = 0x10) {
    this.deviceId = deviceId;
    this.sentMessages = [];
    this.deviceMemory = new Map();
    this._initDefaultMemory();
  }

  _initDefaultMemory() {
    // Performance Common (53 bytes)
    const perfCommon = new Array(0x35).fill(0);
    const perfName = encodeName('MELLOW PERF');
    for (let i = 0; i < 12; i++) perfCommon[i] = perfName[i];
    perfCommon[0x0C] = 0; // Solo OFF
    perfCommon[0x30] = 0; // MFXA Source PERFORM
    perfCommon[0x33] = 0; // Chorus Source PERFORM
    perfCommon[0x34] = 0; // Reverb Source PERFORM
    this.setMemory([0x10, 0x00, 0x00, 0x00], perfCommon);

    // Performance Chorus (52 bytes)
    const chorus = new Array(0x34).fill(0);
    chorus[0x00] = 1; // Type CHORUS
    chorus[0x01] = 64; // Level 64
    this.setMemory([0x10, 0x00, 0x04, 0x00], chorus);

    // Performance Reverb (83 bytes)
    const reverb = new Array(0x53).fill(0);
    reverb[0x00] = 2; // SRV ROOM
    reverb[0x01] = 70; // Level 70
    this.setMemory([0x10, 0x00, 0x06, 0x00], reverb);

    // Parts 1-16 (49 bytes each)
    for (let p = 1; p <= 16; p++) {
      const part = new Array(0x31).fill(0);
      part[0x00] = p - 1; // MIDI channel
      part[0x01] = 1;     // Switch ON
      part[0x04] = 87;    // Bank MSB
      part[0x05] = 64;    // Bank LSB
      part[0x06] = p;     // PC
      part[0x07] = 100;   // Level
      part[0x08] = 64;    // Center Pan
      part[0x09] = 64;    // Coarse 0
      part[0x0A] = 64;    // Fine 0
      part[0x1B] = 0;     // Not muted
      this.setMemory(getPartAddress(p), part);

      // Sound/Patch name for Part p (up to 12 chars)
      const partPatchName = encodeName(`Pt ${p} Sound`);
      this.setMemory(getPatchTempAddress(p), partPatchName);
    }

    // Patch Mode (Single: 1F 00 00 00)
    const patchBase = [0x1F, 0x00, 0x00, 0x00];
    const patchCommon = new Array(0x4F).fill(0);
    const patchName = encodeName('SYNTH BRASS');
    for (let i = 0; i < 12; i++) patchCommon[i] = patchName[i];
    patchCommon[0x0E] = 115; // Level
    patchCommon[0x0F] = 64;  // Pan
    patchCommon[0x16] = 1;   // Poly
    this.setMemory(patchBase, patchCommon);

    // Patch TMT (41 bytes)
    const tmt = new Array(0x29).fill(0);
    tmt[0x00] = 0; // Structure 1-2 Type 1
    tmt[0x05] = 1; // Tone 1 Switch ON
    tmt[0x0E] = 1; // Tone 2 Switch ON
    this.setMemory(getPatchTMTAddress(patchBase), tmt);

    // Tones 1-4 (265 bytes each)
    for (let t = 1; t <= 4; t++) {
      const tone = new Array(0x0109).fill(0);
      tone[0x00] = 127; // Tone Level
      tone[0x04] = 64;  // Pan C
      tone[0x27] = 0;   // INT Wave Group
      tone[0x2C] = 0; tone[0x2D] = 0; tone[0x2E] = 0; tone[0x2F] = t; // Wave Number L = t
      tone[0x49] = 100; // Cutoff
      this.setMemory(getToneAddress(patchBase, t), tone);
    }
  }

  setMemory(address, data) {
    const key = address.map(b => b.toString(16).padStart(2, '0')).join('-');
    this.deviceMemory.set(key, data);
  }

  send(bytes) {
    this.sentMessages.push(bytes);
    const parsed = parseSysEx(bytes);
    if (parsed.valid && parsed.command === 0x12) { // DT1
      // Handle write to memory
      const key = parsed.address.map(b => b.toString(16).padStart(2, '0')).join('-');
      this.deviceMemory.set(key, parsed.data);
    }
  }

  async sendAndReceive(requestBytes) {
    this.sentMessages.push(requestBytes);
    const req = parseSysEx(requestBytes);
    if (!req.valid || req.command !== 0x11) {
      throw new Error('Expected valid RQ1 command');
    }
    const key = req.address.map(b => b.toString(16).padStart(2, '0')).join('-');
    const mem = this.deviceMemory.get(key);
    if (!mem) {
      throw new Error(`Device memory not found at ${key}`);
    }

    // Build DT1 reply with requested data
    const reply = buildDT1(req.address, mem, this.deviceId);
    return parseSysEx(reply);
  }
}

describe('End-to-End MIDI SysEx Communication Simulation', () => {
  test('requestPerformanceCommon queries hardware and parses response', async () => {
    const mock = new MockMidiDevice();
    const common = await requestPerformanceCommon(mock, 0x10);

    assert.equal(common.name, 'MELLOW PERF');
    assert.equal(common.soloPartSelect, 0);
    assert.equal(common.mfxASource, 0);

    // Verify the sent message was a valid RQ1 to 10 00 00 00
    const sent = mock.sentMessages[0];
    const parsedReq = parseSysEx(sent);
    assert.equal(parsedReq.valid, true);
    assert.equal(parsedReq.command, 0x11);
    assert.deepEqual(parsedReq.address, [0x10, 0x00, 0x00, 0x00]);
  });

  test('requestPerformanceChorus and Reverb return accurate settings', async () => {
    const mock = new MockMidiDevice();
    const chorus = await requestPerformanceChorus(mock, 0x10);
    assert.equal(chorus.chorusType, 1);
    assert.equal(chorus.chorusLevel, 64);

    const reverb = await requestPerformanceReverb(mock, 0x10);
    assert.equal(reverb.reverbType, 2);
    assert.equal(reverb.reverbLevel, 70);
  });

  test('requestPerformancePart for all parts 1-16 retrieves correct part settings and sound/patch names', async () => {
    const mock = new MockMidiDevice();
    for (let p = 1; p <= 16; p++) {
      const part = await requestPerformancePart(mock, p, 0x10);
      assert.equal(part.receiveChannel, p - 1);
      assert.equal(part.patchPC, p);
      assert.equal(part.partLevel, 100);
      assert.equal(part.partPan, 64);
      assert.equal(part.patchName, `Pt ${p} Sound`);
    }
  });

  test('requestAllParts queries all 16 parts with patch names and triggers progress', async () => {
    const mock = new MockMidiDevice();
    let progressCalls = 0;
    const parts = await requestAllParts(mock, 0x10, (done, total, data) => {
      progressCalls++;
      assert.equal(total, 16);
      assert.ok(data.patchName.startsWith('Pt '));
    });

    assert.equal(parts.length, 16);
    assert.equal(progressCalls, 16);
    assert.equal(parts[0].patchName, 'Pt 1 Sound');
    assert.equal(parts[15].patchName, 'Pt 16 Sound');
  });

  test('requestEntirePerformance loads common, effects, and all 16 parts in one sweep', async () => {
    const mock = new MockMidiDevice();
    const stages = [];
    const perf = await requestEntirePerformance(mock, 0x10, (stage) => {
      stages.push(stage);
    });

    assert.equal(perf.common.name, 'MELLOW PERF');
    assert.equal(perf.chorus.chorusLevel, 64);
    assert.equal(perf.reverb.reverbLevel, 70);
    assert.equal(perf.parts.length, 16);
    assert.equal(perf.parts[0].patchName, 'Pt 1 Sound');
    assert.ok(stages.includes('common'));
    assert.ok(stages.includes('chorus'));
    assert.ok(stages.includes('reverb'));
    assert.ok(stages.includes('part'));
  });

  test('sendPartParam generates accurate DT1 SysEx message', () => {
    const mock = new MockMidiDevice();
    // Set Part 2 level (offset 0x07) to 115
    sendPartParam(mock, 2, 'PART_LEVEL', 115, 0x10);

    const sent = mock.sentMessages[0];
    const parsed = parseSysEx(sent);
    assert.equal(parsed.valid, true);
    assert.equal(parsed.command, 0x12);
    // Part 2 address is 10 00 21 00, level offset is 07 -> address 10 00 21 07
    assert.deepEqual(parsed.address, [0x10, 0x00, 0x21, 0x07]);
    assert.deepEqual(parsed.data, [115]);
  });

  test('sendPerformanceName sends space-padded 12-byte DT1 message', () => {
    const mock = new MockMidiDevice();
    sendPerformanceName(mock, 'NEW NAME', 0x10);

    const sent = mock.sentMessages[0];
    const parsed = parseSysEx(sent);
    assert.equal(parsed.valid, true);
    assert.deepEqual(parsed.address, [0x10, 0x00, 0x00, 0x00]);
    assert.equal(parsed.data.length, 12);
  });

  test('requestPatchCommon, requestPatchTMT, and requestPatchTone retrieve Single patch', async () => {
    const mock = new MockMidiDevice();
    const common = await requestPatchCommon(mock, 0, 0x10);
    assert.equal(common.name, 'SYNTH BRASS');
    assert.equal(common.patchLevel, 115);
    assert.equal(common.monoPoly, 1);

    const tmt = await requestPatchTMT(mock, 0, 0x10);
    assert.equal(tmt.structureType12, 0);
    assert.equal(tmt.tone1Switch, 1);
    assert.equal(tmt.tone2Switch, 1);

    const tone1 = await requestPatchTone(mock, 0, 1, 0x10);
    assert.equal(tone1.toneLevel, 127);
    assert.equal(tone1.tonePan, 64);
    assert.equal(tone1.tvfCutoff, 100);
  });

  test('requestEntirePatch loads Common, TMT, and all 4 Tones with wave numbers', async () => {
    const mock = new MockMidiDevice();
    const patch = await requestEntirePatch(mock, 0, 0x10);

    assert.equal(patch.common.name, 'SYNTH BRASS');
    assert.equal(patch.common.patchLevel, 115);
    assert.equal(patch.tmt.structureType12, 0);
    assert.equal(patch.tones.length, 4);
    assert.equal(patch.tones[0].waveNumberL, 1);
    assert.equal(patch.tones[1].waveNumberL, 2);
    assert.equal(patch.tones[2].waveNumberL, 3);
    assert.equal(patch.tones[3].waveNumberL, 4);
  });

  test('sendToneSwitch sends DT1 directly into Patch TMT memory', () => {
    const mock = new MockMidiDevice();
    // Tone 2 Switch (offset 0x0E in TMT) OFF
    sendToneSwitch(mock, 0, 2, false, 0x10);

    const sent = mock.sentMessages[0];
    const parsed = parseSysEx(sent);
    assert.equal(parsed.valid, true);
    // Single patch TMT base is 1F 00 10 00, Tone 2 switch offset is 0x0E -> 1F 00 10 0E
    assert.deepEqual(parsed.address, [0x1F, 0x00, 0x10, 0x0E]);
    assert.deepEqual(parsed.data, [0]);
  });
});

describe('MidiManager sendAndReceive Protocol & Multi-Packet Handling', () => {
  test('sendAndReceive resolves single-packet DT1 response for Tone size (137 bytes)', async () => {
    const mgr = new MidiManager();
    const toneAddr = [0x1F, 0x00, 0x20, 0x00];
    const toneSize = [0x00, 0x00, 0x01, 0x09]; // 137 bytes in XV-5050 7-bit addressing

    // Wire up mock input/output directly to manager
    mgr._output = {
      send: (bytes) => {
        // Build simulated 137-byte Tone response
        const dummyTone = new Array(137).fill(0).map((_, i) => (i + 1) & 0x7F);
        const reply = buildDT1(toneAddr, dummyTone, 0x10);
        setTimeout(() => {
          mgr._handleMidiMessage({ data: reply });
        }, 5);
      }
    };
    mgr._input = { onmidimessage: null };
    mgr._connected = true;

    const rq1 = buildRQ1(toneAddr, toneSize, 0x10);
    const resp = await mgr.sendAndReceive(rq1, 1000);

    assert.equal(resp.valid, true);
    assert.equal(resp.data.length, 137);
    assert.equal(resp.data[0], 1);
    assert.equal(resp.data[136], (137 & 0x7F));
  });

  test('sendAndReceive accumulates multi-packet DT1 responses across 256-byte boundaries', async () => {
    const mgr = new MidiManager();
    const startAddr = [0x10, 0x00, 0x00, 0x00];
    // Request 300 bytes: 00 00 02 2C (2 * 128 + 44 = 300)
    const sizeBytes = [0x00, 0x00, 0x02, 0x2C];

    mgr._output = {
      send: (bytes) => {
        // Hardware sends Packet 1 (256 bytes at 10 00 00 00)
        // 256 in 7-bit address addition: 10 00 02 00
        const packet1Data = new Array(256).fill(0).map((_, i) => i & 0x7F);
        const packet1 = buildDT1(startAddr, packet1Data, 0x10);

        // Packet 2 (44 bytes at 10 00 02 00)
        const packet2Addr = [0x10, 0x00, 0x02, 0x00];
        const packet2Data = new Array(44).fill(0).map((_, i) => (i + 100) & 0x7F);
        const packet2 = buildDT1(packet2Addr, packet2Data, 0x10);

        setTimeout(() => {
          mgr._handleMidiMessage({ data: packet1 });
          setTimeout(() => {
            mgr._handleMidiMessage({ data: packet2 });
          }, 10);
        }, 5);
      }
    };
    mgr._input = { onmidimessage: null };
    mgr._connected = true;

    const rq1 = buildRQ1(startAddr, sizeBytes, 0x10);
    const resp = await mgr.sendAndReceive(rq1, 1000);

    assert.equal(resp.valid, true);
    assert.equal(resp.data.length, 300);
    // Verify first packet data
    assert.equal(resp.data[0], 0);
    assert.equal(resp.data[255], 255 & 0x7F);
    // Verify second packet data
    assert.equal(resp.data[256], 100);
    assert.equal(resp.data[299], (43 + 100) & 0x7F);
  });
});

