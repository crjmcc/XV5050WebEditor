import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  matchBestRolandWave,
  secondsToRolandTime,
  hzToRolandCutoff,
  parseVitalPatch,
  parseFxpPatch,
  transpileVstFile,
  buildTranspiledPatchSyx,
  VST_DEMO_PATCHES
} from '../src/vst_transpiler.js';

describe('VST Patch Transpiler Core Engine', () => {

  test('matchBestRolandWave: Timbral waveform matching to Roland PCM', () => {
    assert.equal(matchBestRolandWave('supersaw stack'), 534);
    assert.equal(matchBestRolandWave('JP-8 Bright Saw'), 535);
    assert.equal(matchBestRolandWave('OB-Xa Brass Saw'), 538);
    assert.equal(matchBestRolandWave('Pulse Lead', 'pulse'), 554);
    assert.equal(matchBestRolandWave('Sub Sine 808', 'sine'), 883);
    assert.equal(matchBestRolandWave('White Noise Burst'), 576);
    assert.equal(matchBestRolandWave('Space Choir', 'voice'), 459);
    assert.equal(matchBestRolandWave('FM Metallic Bell', 'bell'), 503);
  });

  test('secondsToRolandTime: Logarithmic analog time curve conversion', () => {
    assert.equal(secondsToRolandTime(0), 0);
    assert.equal(secondsToRolandTime(0.001), 10); // small attack ~1ms
    assert.equal(secondsToRolandTime(10), 127); // clamped max
    // Check monotonicity
    assert.ok(secondsToRolandTime(0.1) < secondsToRolandTime(0.8));
    assert.ok(secondsToRolandTime(0.8) < secondsToRolandTime(3.0));
  });

  test('hzToRolandCutoff: Frequency response to 7-bit cutoff', () => {
    assert.equal(hzToRolandCutoff(10), 0);
    assert.equal(hzToRolandCutoff(20000), 127);
    assert.ok(hzToRolandCutoff(500) < hzToRolandCutoff(2500));
    assert.ok(hzToRolandCutoff(2500) < hzToRolandCutoff(12000));
  });

  test('parseVitalPatch: Transpiles Vital preset to Roland 4-Tone patch', () => {
    const vitalPreset = {
      name: 'FutureBass',
      author: 'ProducerX',
      synth_version: '1.5.5',
      settings: {
        polyphony: 8,
        portamento_time: 0.05,
        osc_1_on: 1,
        osc_1_wave_frame: 'supersaw',
        osc_1_unison_voices: 5,
        osc_1_level: 0.9,
        osc_2_on: 1,
        osc_2_wave_frame: 'pulse pwm',
        osc_2_level: 0.7,
        osc_2_tune: 0.05,
        osc_3_on: 1,
        osc_3_wave_frame: 'sub sine',
        osc_3_transpose: -12,
        osc_3_level: 0.8,
        filter_1_cutoff: 72,
        filter_1_resonance: 0.3,
        env_1_attack: 0.01,
        env_1_decay: 0.9,
        env_1_sustain: 0.8,
        env_1_release: 0.4,
        chorus_on: 1,
        reverb_on: 1
      }
    };

    const res = parseVitalPatch(vitalPreset);
    assert.ok(res.source);
    assert.equal(res.source.format, 'vital');
    assert.equal(res.xvPatch.common.patchName, 'FUTUREBASS');
    assert.equal(res.xvPatch.common.monoPoly, 1);
    assert.ok(res.xvPatch.common.portamentoSwitch === 1);
    assert.ok(res.xvPatch.common.chorusSend > 0);
    assert.ok(res.xvPatch.common.reverbSend > 0);

    // Tone 1 & 2
    assert.equal(res.xvPatch.tones[0].enabled, true);
    assert.equal(res.xvPatch.tones[0].waveNumberL, 534); // Supersaw -> FAT Saw 534
    assert.equal(res.xvPatch.tones[1].enabled, true);
    assert.equal(res.xvPatch.tones[1].waveNumberL, 554); // Pulse PWM -> JD SynPulse1 554

    // Tone 3 (Sub)
    assert.equal(res.xvPatch.tones[2].enabled, true);
    assert.equal(res.xvPatch.tones[2].waveNumberL, 883); // Sub sine -> Low Sine 883

    // TMT Switches
    assert.equal(res.xvPatch.tmt.tone1Switch, 1);
    assert.equal(res.xvPatch.tmt.tone2Switch, 1);
    assert.equal(res.xvPatch.tmt.tone3Switch, 1);
  });

  test('parseFxpPatch: Parses Steinberg FXP chunk with CcnK magic header', () => {
    // Construct minimal FXP header chunk (60 bytes)
    const buf = new Uint8Array(80);
    // 'CcnK' magic header
    buf[0] = 0x43; buf[1] = 0x63; buf[2] = 0x6E; buf[3] = 0x4B;
    // Preset name at offset 28: "TranceLead"
    const name = 'TranceLead';
    for (let i = 0; i < name.length; i++) buf[28 + i] = name.charCodeAt(i);

    const res = parseFxpPatch(buf);
    assert.equal(res.source.format, 'fxp');
    assert.equal(res.xvPatch.common.patchName, 'TRANCELEAD');
    assert.ok(res.xvPatch.tones[0].enabled);
    assert.ok(res.xvPatch.tones[1].enabled);
  });

  test('transpileVstFile: Handles JSON string and demo presets', async () => {
    const demo = VST_DEMO_PATCHES[0];
    const res = await transpileVstFile(JSON.stringify(demo.data), `${demo.name}.vital`);
    assert.equal(res.source.format, 'vital');
    assert.equal(res.xvPatch.common.patchName, 'CYBERREESE');
    assert.equal(res.xvPatch.common.monoPoly, 0); // Bass mono
  });

  test('buildTranspiledPatchSyx: Generates valid Roland XV-5050 SysEx packets', () => {
    const demo = VST_DEMO_PATCHES[1]; // Trance Pluck
    const transpiled = parseVitalPatch(demo.data);
    const { packets, syxBytes } = buildTranspiledPatchSyx(transpiled, 1, 0x10);

    // Expect Common packet, TMT packet, and 4 Tone packets = 6 DT1 packets
    assert.equal(packets.length, 6);
    // First byte F0, last byte F7
    for (const pkt of packets) {
      assert.equal(pkt[0], 0xF0);
      assert.equal(pkt[pkt.length - 1], 0xF7);
    }
    // .SYX byte buffer
    assert.ok(syxBytes instanceof Uint8Array);
    assert.ok(syxBytes.length > 500);
  });

  test('All bundled VST_DEMO_PATCHES transpile successfully', () => {
    assert.equal(VST_DEMO_PATCHES.length, 3);
    for (const preset of VST_DEMO_PATCHES) {
      const transpiled = parseVitalPatch(preset.data);
      assert.ok(transpiled.xvPatch.common.patchName.length > 0);
      assert.equal(transpiled.xvPatch.tones.length, 4);
      const syx = buildTranspiledPatchSyx(transpiled, 1, 0x10);
      assert.equal(syx.packets.length, 6);
    }
  });

});
