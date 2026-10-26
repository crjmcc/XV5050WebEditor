import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { MidiManager } from '../src/midi.js';

describe('MidiManager DAW Thru & Multi-Client Port Sharing Architecture', () => {
  test('disconnect invokes close() on active MIDI ports to release OS device handles', async () => {
    const mgr = new MidiManager();
    let inClosed = false;
    let outClosed = false;
    let dawClosed = false;

    mgr._input = {
      close: async () => { inClosed = true; },
      onmidimessage: () => {},
    };
    mgr._output = {
      close: async () => { outClosed = true; },
      send: () => {},
    };
    mgr._dawInput = {
      close: async () => { dawClosed = true; },
      onmidimessage: () => {},
    };
    mgr._connected = true;

    await mgr.disconnect();

    assert.equal(inClosed, true, 'Input port close() must be invoked');
    assert.equal(outClosed, true, 'Output port close() must be invoked');
    assert.equal(dawClosed, true, 'DAW port close() must be invoked');
    assert.equal(mgr._input, null);
    assert.equal(mgr._output, null);
    assert.equal(mgr._dawInput, null);
    assert.equal(mgr.isConnected, false);
  });

  test('setDawThruInput forwards incoming channel voice messages directly to synth output in real time', async () => {
    const mgr = new MidiManager();
    const sentToSynth = [];

    mgr._output = {
      send: (bytes) => sentToSynth.push(Array.from(bytes)),
    };
    mgr._connected = true;

    const mockDawInput = {
      name: 'loopMIDI Port 1',
      connection: 'open',
      onmidimessage: null,
      open: async () => {},
    };

    mgr._midiAccess = {
      inputs: new Map([['daw-port-id', mockDawInput]]),
    };

    const attached = await mgr.setDawThruInput('daw-port-id');
    assert.equal(attached, true);
    assert.equal(mgr.dawInputName, 'loopMIDI Port 1');
    assert.ok(typeof mockDawInput.onmidimessage === 'function');

    // Simulate Renoise playing Note On (Ch 1: 0x90, Note 60: 0x3C, Vel 100: 0x64)
    const noteOnEvent = { data: new Uint8Array([0x90, 0x3C, 0x64]) };
    mockDawInput.onmidimessage(noteOnEvent);

    // Simulate Renoise Pitch Bend (Ch 1: 0xE0, 0x00, 0x40)
    const pitchBendEvent = { data: new Uint8Array([0xE0, 0x00, 0x40]) };
    mockDawInput.onmidimessage(pitchBendEvent);

    assert.equal(sentToSynth.length, 2);
    assert.deepEqual(sentToSynth[0], [0x90, 0x3C, 0x64]);
    assert.deepEqual(sentToSynth[1], [0xE0, 0x00, 0x40]);
  });

  test('traffic monitor receives THRU events when DAW pass-through messages occur', async () => {
    const mgr = new MidiManager();
    const trafficEvents = [];
    mgr.onTraffic((dir, bytes) => trafficEvents.push({ dir, bytes }));

    mgr._output = { send: () => {} };
    mgr._connected = true;

    const mockDawInput = {
      name: 'loopMIDI Cable',
      connection: 'open',
      onmidimessage: null,
    };
    mgr._midiAccess = {
      inputs: new Map([['cable-id', mockDawInput]]),
    };

    await mgr.setDawThruInput('cable-id');

    // Simulate CC#1 (Modulation Wheel = 127) from Renoise
    mockDawInput.onmidimessage({ data: new Uint8Array([0xB0, 0x01, 0x7F]) });

    assert.equal(trafficEvents.length, 1);
    assert.equal(trafficEvents[0].dir, 'THRU');
    assert.deepEqual(trafficEvents[0].bytes, [0xB0, 0x01, 0x7F]);
  });

  test('connect does not send unsolicited SysEx identity requests during playback', async () => {
    const mgr = new MidiManager();
    const sentBytes = [];
    const mockOutput = {
      name: 'XV-5050 Output',
      connection: 'closed',
      open: async () => {},
      send: (bytes) => sentBytes.push(Array.from(bytes)),
    };
    const mockInput = {
      name: 'XV-5050 Input',
      connection: 'closed',
      open: async () => {},
      onmidimessage: null,
    };
    mgr._midiAccess = {
      inputs: new Map([['in-1', mockInput]]),
      outputs: new Map([['out-1', mockOutput]]),
    };

    const connected = await mgr.connect('in-1', 'out-1');
    assert.equal(connected, true);
    // Verified: No unsolicited Identity Request (F0 7E 7F 06 01 F7) sent on connect
    assert.equal(sentBytes.length, 0, 'No unsolicited SysEx should be transmitted upon connecting');
  });
});

