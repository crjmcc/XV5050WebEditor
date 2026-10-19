import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  exportToSyx,
  parseSyxFile,
  createPatchSyxDump,
  createPerformanceSyxDump,
} from '../src/librarian.js';
import { parseSysEx, CMD_DT1, MODEL_ID, MANUFACTURER_ID } from '../src/sysex.js';
import { encodeName } from '../src/parameters.js';

describe('Librarian & .syx SysEx File Management (Stage 2 Gap 5)', () => {
  test('exportToSyx serializes single and multi-packet SysEx arrays into binary Uint8Array', () => {
    const packet1 = new Uint8Array([0xF0, 0x41, 0x10, 0x00, 0x10, 0x12, 0x10, 0x00, 0x04, 0x00, 0x02, 0x6A, 0xF7]);
    const packet2 = new Uint8Array([0xF0, 0x41, 0x10, 0x00, 0x10, 0x12, 0x10, 0x00, 0x06, 0x00, 0x01, 0x69, 0xF7]);

    const fileBytes = exportToSyx([packet1, packet2]);
    assert.equal(fileBytes.length, packet1.length + packet2.length);
    assert.deepEqual(fileBytes.slice(0, packet1.length), packet1);
    assert.deepEqual(fileBytes.slice(packet1.length), packet2);
  });

  test('parseSyxFile splits continuous .syx stream into individual validated SysEx packets', () => {
    const p1 = [0xF0, 0x41, 0x10, 0x00, 0x10, 0x12, 0x10, 0x00, 0x04, 0x00, 0x02, 0x6A, 0xF7];
    const p2 = [0xF0, 0x41, 0x10, 0x00, 0x10, 0x12, 0x10, 0x00, 0x06, 0x00, 0x01, 0x69, 0xF7];
    const stream = new Uint8Array([...p1, ...p2]);

    const packets = parseSyxFile(stream);
    assert.equal(packets.length, 2);
    assert.equal(packets[0].valid, true);
    assert.equal(packets[1].valid, true);
    assert.deepEqual(packets[0].address, [0x10, 0x00, 0x04, 0x00]);
    assert.deepEqual(packets[1].address, [0x10, 0x00, 0x06, 0x00]);
  });

  test('createPatchSyxDump builds valid DT1 packet for Patch Common & TMT', () => {
    const commonData = new Array(0x4F).fill(0);
    const nameBytes = encodeName('CUSTOM PAD');
    for (let i = 0; i < 12; i++) commonData[i] = nameBytes[i];
    commonData[0x0E] = 110;

    const tmtData = new Array(0x29).fill(0);
    tmtData[0x05] = 1; // Tone 1 ON

    const dump = createPatchSyxDump(0, commonData, tmtData, 0x10);
    assert.equal(dump.length, 2); // 1 packet for common, 1 for TMT

    const pCommon = parseSysEx(dump[0]);
    assert.equal(pCommon.valid, true);
    assert.deepEqual(pCommon.address, [0x1F, 0x00, 0x00, 0x00]);
    assert.equal(pCommon.data.length, 0x4F);

    const pTMT = parseSysEx(dump[1]);
    assert.equal(pTMT.valid, true);
    assert.deepEqual(pTMT.address, [0x1F, 0x00, 0x10, 0x00]);
    assert.equal(pTMT.data.length, 0x29);
  });
});
