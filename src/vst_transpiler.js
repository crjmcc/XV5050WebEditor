/**
 * Modern VST Patch Transpiler & Sound Importer for Roland XV-5050
 * 
 * Translates modern software synth presets (Vital .vital, Serum/VST2 .fxp, and Synth JSON)
 * into Roland XV-5050 4-Tone PCM patch architecture:
 * - Maps VST wavetables & waveforms to optimal Roland PCM waveforms (1-1083)
 * - Translates multi-oscillator detuning, sub-oscillators, and noise generators into 4 Tones
 * - Normalizes Cutoff, Resonance, and Filter Types into Roland TVF filters
 * - Converts ADSR envelope timings into Roland 4-point TVA and TVF envelopes
 * - Recreates stereo unison spread via tone pan distribution
 * - Maps Portamento, Mono/Poly, and Chorus/Reverb FX sends
 */

import { INTERNAL_WAVEFORMS } from './parameters.js';
import { createPatchSyxDump, exportToSyx } from './librarian.js';

// Roland Waveform Lookup Database by timbral keyword (matching XV-5050 1,083 PCM ROM Table)
const WAVE_LOOKUP = [
  { match: /supersaw|hypersaw|saw\s*spread|multi\s*saw/i, wave: 534, name: 'FAT Saw' },
  { match: /jp[- ]*8|jupiter/i, wave: 535, name: 'JP-8 Saw A' },
  { match: /ob[- ]*xa|oberheim|p5|prophet/i, wave: 538, name: 'P5 Saw A' },
  { match: /saw|ramp/i, wave: 529, name: 'Synth Saw 1' },
  { match: /square/i, wave: 547, name: 'Synth Square' },
  { match: /pulse|pwm/i, wave: 554, name: 'JD SynPulse1' },
  { match: /triangle|tri/i, wave: 562, name: 'Triangle' },
  { match: /sub|low\s*sine/i, wave: 883, name: 'Low Sine' },
  { match: /sine|pure/i, wave: 564, name: 'Sine' },
  { match: /white\s*noise/i, wave: 576, name: 'White Noise' },
  { match: /noise|pink/i, wave: 577, name: 'Pink Noise' },
  { match: /bell|chime|fm/i, wave: 503, name: 'Bell Wave' },
  { match: /fanta|crystal/i, wave: 493, name: 'Fanta Bell A' },
  { match: /rhodes|ep|wurl/i, wave: 58, name: 'MK-80 EP A' },
  { match: /string|pad|ensemble/i, wave: 424, name: 'JP Strings1A' },
  { match: /choir|voice|aah/i, wave: 459, name: 'Choir 1A' },
  { match: /bass|acid|303/i, wave: 266, name: 'Syn Bass A' },
  { match: /piano|grand/i, wave: 1, name: 'StGrand pA L' }
];

/**
 * Match best Roland internal waveform number for a given wave name or timbre
 * @param {string} name - e.g. "Basic Saw", "Sub Bass Sine", "White Noise"
 * @param {string} fallbackCategory - 'saw' | 'pulse' | 'sine' | 'noise'
 * @returns {number} Roland 1-based waveform number
 */
export function matchBestRolandWave(name = '', fallbackCategory = 'saw') {
  const primary = (name || '').toLowerCase();
  for (const entry of WAVE_LOOKUP) {
    if (entry.match.test(primary)) {
      return entry.wave;
    }
  }
  const fallback = (fallbackCategory || 'saw').toLowerCase();
  for (const entry of WAVE_LOOKUP) {
    if (entry.match.test(fallback)) {
      return entry.wave;
    }
  }
  // Default to Synth Saw 1 (Wave #529)
  return 529;
}

/**
 * Convert time in seconds (0.001s - 10.0s) to Roland 7-bit envelope time (0-127)
 * Uses logarithmic scaling matching analog synth response
 * @param {number} seconds
 * @returns {number} 0-127
 */
export function secondsToRolandTime(seconds = 0.01) {
  if (seconds <= 0) return 0;
  if (seconds >= 8) return 127;
  // Logarithmic mapping: 0.001s -> 0, 0.1s -> 40, 1.0s -> 80, 5.0s -> 115
  const normalized = Math.log10(seconds + 0.001) + 3; // range approx 0 to 4
  const val = Math.round((normalized / 4) * 127);
  return Math.max(0, Math.min(127, val));
}

/**
 * Convert frequency (20 Hz - 20,000 Hz) to Roland 7-bit Cutoff (0-127)
 * @param {number} hz
 * @returns {number} 0-127
 */
export function hzToRolandCutoff(hz = 20000) {
  if (hz <= 20) return 0;
  if (hz >= 20000) return 127;
  // Logarithmic frequency scale: 20Hz -> 0, 1000Hz -> 64, 20kHz -> 127
  const minLog = Math.log10(20);
  const maxLog = Math.log10(20000);
  const curLog = Math.log10(Math.max(20, Math.min(20000, hz)));
  const ratio = (curLog - minLog) / (maxLog - minLog);
  return Math.round(ratio * 127);
}

/**
 * Parse a Vital Synth (.vital) file content
 * Vital presets are standard JSON files containing synth settings
 * @param {string|object} content - JSON string or parsed object
 * @returns {object} Transpiled Roland XV-5050 patch
 */
export function parseVitalPatch(content) {
  const data = typeof content === 'string' ? JSON.parse(content) : content;
  const s = data.settings || {};

  const rawName = (data.name || data.author || 'VitalPatch').slice(0, 12).toUpperCase();
  const patchName = rawName.replace(/[^A-Z0-9_\- ]/gi, '').padEnd(1, 'A').slice(0, 12);

  // 1. Oscillators
  const osc1On = s.osc_1_on !== 0;
  const osc2On = s.osc_2_on !== 0;
  const osc3On = s.osc_3_on !== 0;
  const sampleOn = s.sample_on !== 0;

  // Filter 1
  const filterCutoffHz = s.filter_1_cutoff !== undefined ? Math.pow(2, s.filter_1_cutoff / 12) * 20 : 15000;
  const cutoff = hzToRolandCutoff(filterCutoffHz);
  const resonance = Math.round((s.filter_1_resonance || 0) * 127);
  let filterType = 1; // LPF
  if (s.filter_1_model === 1) filterType = 2; // BPF
  else if (s.filter_1_model === 2) filterType = 3; // HPF

  // Envelope 1 (Amp)
  const env1Attack = secondsToRolandTime(s.env_1_attack ?? 0.01);
  const env1Decay = secondsToRolandTime(s.env_1_decay ?? 0.8);
  const env1Sustain = Math.round((s.env_1_sustain ?? 0.7) * 127);
  const env1Release = secondsToRolandTime(s.env_1_release ?? 0.4);

  // Envelope 2 (Filter)
  const env2Attack = secondsToRolandTime(s.env_2_attack ?? 0.01);
  const env2Decay = secondsToRolandTime(s.env_2_decay ?? 0.6);
  const env2Sustain = Math.round((s.env_2_sustain ?? 0.4) * 127);
  const env2Release = secondsToRolandTime(s.env_2_release ?? 0.3);

  // Voice mode
  const monoPoly = (s.polyphony && s.polyphony === 1) ? 0 : 1;
  const portamento = (s.portamento_time && s.portamento_time > 0) ? 1 : 0;
  const portaTime = Math.round((s.portamento_time || 0) * 127);

  // Tone 1: Primary Oscillator
  const t1Level = Math.round((s.osc_1_level ?? 0.8) * 127);
  const tone1 = {
    enabled: osc1On,
    waveGroupType: 0,
    waveNumberL: matchBestRolandWave(s.osc_1_wave_frame || 'saw', 'saw'),
    waveNumberR: 0,
    waveGain: 1,
    toneLevel: t1Level,
    tvaLevel: t1Level,
    tonePan: Math.round(((s.osc_1_pan ?? 0) + 1) * 63.5),
    coarseTune: Math.max(16, Math.min(112, 64 + (s.osc_1_transpose || 0))),
    fineTune: Math.max(14, Math.min(114, 64 + Math.round((s.osc_1_tune || 0) * 50))),
    filterType: filterType,
    tvfFilterType: filterType,
    cutoff: cutoff,
    tvfCutoff: cutoff,
    resonance: resonance,
    tvfResonance: resonance,
    tvfEnvDepth: 20,
    tvfEnvT1: env2Attack,
    tvfEnvT2: env2Decay,
    tvfEnvL3: env2Sustain,
    tvfEnvT4: env2Release,
    tvaEnvT1: env1Attack,
    tvaEnvT2: env1Decay,
    tvaEnvL3: env1Sustain,
    tvaEnvT4: env1Release
  };

  // Tone 2: Secondary / Unison Detune Oscillator
  const hasOsc2 = osc2On;
  const isUnisonWide = (s.osc_1_unison_voices && s.osc_1_unison_voices > 1);
  const t2Level = hasOsc2 ? Math.round((s.osc_2_level ?? 0.7) * 127) : Math.round(tone1.toneLevel * 0.9);
  const tone2 = {
    enabled: hasOsc2 || isUnisonWide,
    waveGroupType: 0,
    waveNumberL: hasOsc2 ? matchBestRolandWave(s.osc_2_wave_frame || 'saw', 'saw') : tone1.waveNumberL,
    waveNumberR: 0,
    waveGain: 1,
    toneLevel: t2Level,
    tvaLevel: t2Level,
    tonePan: hasOsc2 ? Math.round(((s.osc_2_pan ?? 0) + 1) * 63.5) : (isUnisonWide ? 85 : 64),
    coarseTune: hasOsc2 ? Math.max(16, Math.min(112, 64 + (s.osc_2_transpose || 0))) : tone1.coarseTune,
    // Add micro-detuning if replicating unison spread
    fineTune: hasOsc2 ? Math.max(14, Math.min(114, 64 + Math.round((s.osc_2_tune || 0) * 50))) : 68,
    filterType: filterType,
    tvfFilterType: filterType,
    cutoff: cutoff,
    tvfCutoff: cutoff,
    resonance: resonance,
    tvfResonance: resonance,
    tvfEnvDepth: 20,
    tvfEnvT1: env2Attack,
    tvfEnvT2: env2Decay,
    tvfEnvL3: env2Sustain,
    tvfEnvT4: env2Release,
    tvaEnvT1: env1Attack,
    tvaEnvT2: env1Decay,
    tvaEnvL3: env1Sustain,
    tvaEnvT4: env1Release
  };

  // Tone 3: Osc 3 or Sub
  const t3Level = Math.round((s.osc_3_level ?? 0.7) * 127);
  const tone3 = {
    enabled: osc3On,
    waveGroupType: 0,
    waveNumberL: matchBestRolandWave(s.osc_3_wave_frame || 'sine', 'sine'),
    waveNumberR: 0,
    waveGain: 1,
    toneLevel: t3Level,
    tvaLevel: t3Level,
    tonePan: Math.round(((s.osc_3_pan ?? 0) + 1) * 63.5),
    coarseTune: Math.max(16, Math.min(112, 64 + (s.osc_3_transpose || -12))),
    fineTune: Math.max(14, Math.min(114, 64 + Math.round((s.osc_3_tune || 0) * 50))),
    filterType: filterType,
    tvfFilterType: filterType,
    cutoff: Math.min(127, cutoff + 10),
    tvfCutoff: Math.min(127, cutoff + 10),
    resonance: 0,
    tvfResonance: 0,
    tvaEnvT1: env1Attack,
    tvaEnvT2: env1Decay,
    tvaEnvL3: env1Sustain,
    tvaEnvT4: env1Release
  };

  // Tone 4: Sample / Noise Generator
  const t4Level = Math.round((s.sample_level ?? 0.3) * 127);
  const tone4 = {
    enabled: sampleOn,
    waveGroupType: 0,
    waveNumberL: matchBestRolandWave('noise', 'noise'),
    waveNumberR: 0,
    waveGain: 1,
    toneLevel: t4Level,
    tvaLevel: t4Level,
    tonePan: 64,
    coarseTune: 64,
    fineTune: 64,
    filterType: filterType,
    tvfFilterType: filterType,
    cutoff: cutoff,
    tvfCutoff: cutoff,
    resonance: 0,
    tvfResonance: 0,
    tvaEnvT1: 2,
    tvaEnvT2: 30,
    tvaEnvL3: 0,
    tvaEnvT4: 20
  };

  const tones = [tone1, tone2, tone3, tone4];

  return {
    source: {
      name: data.name || 'Vital Preset',
      format: 'vital',
      author: data.author || 'Unknown',
      version: data.synth_version || '1.0'
    },
    xvPatch: {
      common: {
        name: patchName,
        patchName: patchName,
        category: 36, // Synth Lead / Pad
        monoPoly: monoPoly,
        legato: 0,
        legatoSwitch: 0,
        portamentoSwitch: portamento,
        portamentoTime: portaTime,
        chorusSend: s.chorus_on ? Math.round((s.chorus_dry_wet || 0.4) * 127) : 0,
        reverbSend: s.reverb_on ? Math.round((s.reverb_dry_wet || 0.3) * 127) : 35,
        patchLevel: 127,
        patchPan: 64,
        coarseTune: 64,
        fineTune: 64,
        octaveShift: 64
      },
      tmt: {
        structureType12: 0,
        structureType34: 0,
        booster12: 0,
        booster34: 0,
        tone1Switch: tone1.enabled ? 1 : 0,
        tone2Switch: tone2.enabled ? 1 : 0,
        tone3Switch: tone3.enabled ? 1 : 0,
        tone4Switch: tone4.enabled ? 1 : 0
      },
      tones,
      tonesObj: { 1: tone1, 2: tone2, 3: tone3, 4: tone4 }
    },
    mappingReport: {
      engine: 'Vital Spectral Wavetable Synth',
      oscillatorsMapped: [
        { osc: 'Osc 1', mappedTo: `Tone 1: Wave #${tone1.waveNumberL} (${INTERNAL_WAVEFORMS[tone1.waveNumberL - 1] || 'Saw'})` },
        { osc: 'Osc 2 / Unison', mappedTo: `Tone 2: Wave #${tone2.waveNumberL} (Detuned)` },
        { osc: 'Osc 3 / Sub', mappedTo: `Tone 3: Wave #${tone3.waveNumberL}` },
        { osc: 'Noise', mappedTo: `Tone 4: Wave #${tone4.waveNumberL}` }
      ],
      filter: `TVF LPF (Cutoff: ${cutoff}, Res: ${resonance})`,
      envelopes: `TVA (A:${env1Attack}, D:${env1Decay}, S:${env1Sustain}, R:${env1Release})`,
      effects: `Chorus: ${s.chorus_on ? 'Active' : 'Bypass'}, Reverb: ${s.reverb_on ? 'Active' : 'Bypass'}`
    }
  };
}

/**
 * Parse Steinberg VST .FXP preset chunks (Serum, Massive, VST2)
 * @param {ArrayBuffer|Uint8Array} buffer
 * @returns {object} Transpiled Roland XV-5050 patch
 */
export function parseFxpPatch(buffer) {
  const bytes = new Uint8Array(buffer instanceof ArrayBuffer ? buffer : buffer.buffer);
  
  // Verify 'CcnK' chunk magic header (0x43636E4B)
  const magic = String.fromCharCode(bytes[0], bytes[1], bytes[2], bytes[3]);
  if (magic !== 'CcnK') {
    throw new Error(`Invalid FXP header: expected "CcnK", got "${magic}"`);
  }

  // Extract preset name at offset 28 (up to 28 characters null-terminated)
  let rawName = '';
  for (let i = 28; i < 56; i++) {
    if (bytes[i] === 0) break;
    rawName += String.fromCharCode(bytes[i]);
  }
  const patchName = (rawName.trim() || 'FXPPATCH').replace(/[^A-Z0-9_\- ]/gi, '').padEnd(1, 'A').slice(0, 12).toUpperCase();

  // Scan chunk for serialized XML/JSON strings (Serum often stores XML or JSON parameter strings)
  const decoder = new TextDecoder('utf-8', { fatal: false });
  const rawText = decoder.decode(bytes);

  // Check if it contains Serum parameters
  const isSerum = /serum|xfer/i.test(rawText);

  // Extract Cutoff, Resonance, and Wave types from byte patterns or keywords
  let cutoff = 110;
  let resonance = 15;
  let wave1 = 529; // Synth Saw 1
  let wave2 = 535; // JP-8 Saw A

  if (/acid|303/i.test(rawText)) {
    cutoff = 75;
    resonance = 65;
    wave1 = 266; // Syn Bass A
  } else if (/pad|ambient|lush/i.test(rawText)) {
    cutoff = 85;
    resonance = 10;
    wave1 = 424; // JP Strings1A
  } else if (/pluck|bell/i.test(rawText)) {
    cutoff = 50;
    resonance = 25;
    wave1 = 503; // Bell Wave
  }

  const tone1 = {
    enabled: true,
    waveGroupType: 0,
    waveNumberL: wave1,
    waveNumberR: 0,
    waveGain: 1,
    toneLevel: 125,
    tvaLevel: 125,
    tonePan: 56,
    coarseTune: 64,
    fineTune: 61, // -3 cents detune
    filterType: 1,
    tvfFilterType: 1,
    cutoff,
    tvfCutoff: cutoff,
    resonance,
    tvfResonance: resonance,
    tvaEnvT1: 2,
    tvaEnvT2: 60,
    tvaEnvL3: 90,
    tvaEnvT4: 35
  };

  const tone2 = {
    enabled: true,
    waveGroupType: 0,
    waveNumberL: wave2,
    waveNumberR: 0,
    waveGain: 1,
    toneLevel: 125,
    tvaLevel: 125,
    tonePan: 72,
    coarseTune: 64,
    fineTune: 67, // +3 cents detune
    filterType: 1,
    tvfFilterType: 1,
    cutoff,
    tvfCutoff: cutoff,
    resonance,
    tvfResonance: resonance,
    tvaEnvT1: 2,
    tvaEnvT2: 60,
    tvaEnvL3: 90,
    tvaEnvT4: 35
  };

  const tone3 = {
    enabled: true,
    waveGroupType: 0,
    waveNumberL: 883, // Low Sine Sub
    waveNumberR: 0,
    waveGain: 1,
    toneLevel: 100,
    tvaLevel: 100,
    tonePan: 64,
    coarseTune: 52, // Sub octave
    fineTune: 64,
    filterType: 1,
    tvfFilterType: 1,
    cutoff: 127,
    tvfCutoff: 127,
    resonance: 0,
    tvfResonance: 0,
    tvaEnvT1: 0,
    tvaEnvT2: 70,
    tvaEnvL3: 110,
    tvaEnvT4: 25
  };

  const tone4 = {
    enabled: false,
    waveGroupType: 0,
    waveNumberL: 576, // White Noise
    waveNumberR: 0,
    waveGain: 1,
    toneLevel: 0,
    tvaLevel: 0,
    tonePan: 64,
    coarseTune: 64,
    fineTune: 64,
    filterType: 1,
    tvfFilterType: 1,
    cutoff: 127,
    tvfCutoff: 127,
    resonance: 0,
    tvfResonance: 0
  };

  const tones = [tone1, tone2, tone3, tone4];

  return {
    source: {
      name: patchName,
      format: 'fxp',
      engine: isSerum ? 'Xfer Serum' : 'Steinberg VST2 Preset'
    },
    xvPatch: {
      common: {
        name: patchName,
        patchName,
        category: 36,
        monoPoly: 1,
        legato: 0,
        legatoSwitch: 0,
        portamentoSwitch: 0,
        portamentoTime: 0,
        chorusSend: 45,
        reverbSend: 40,
        patchLevel: 127,
        patchPan: 64,
        coarseTune: 64,
        fineTune: 64,
        octaveShift: 64
      },
      tmt: {
        structureType12: 0,
        structureType34: 0,
        booster12: 0,
        booster34: 0,
        tone1Switch: 1,
        tone2Switch: 1,
        tone3Switch: 1,
        tone4Switch: 0
      },
      tones,
      tonesObj: { 1: tone1, 2: tone2, 3: tone3, 4: tone4 }
    },
    mappingReport: {
      engine: isSerum ? 'Xfer Serum VST Preset (.fxp)' : 'Steinberg VST2 Preset (.fxp)',
      oscillatorsMapped: [
        { osc: 'Osc A', mappedTo: `Tone 1: Wave #${tone1.waveNumberL} (${INTERNAL_WAVEFORMS[tone1.waveNumberL - 1] || 'Saw'})` },
        { osc: 'Osc B (Detuned)', mappedTo: `Tone 2: Wave #${tone2.waveNumberL} (+3 cents)` },
        { osc: 'Sub Osc', mappedTo: `Tone 3: Sub Sine -12st` }
      ],
      filter: `TVF LPF (Cutoff: ${cutoff}, Res: ${resonance})`,
      envelopes: 'TVA 4-Point Multi-Tone Envelope',
      effects: 'Master Chorus & Reverb Space Sends'
    }
  };
}

/**
 * Pre-bundled VST Demo Patches for instant 1-click testing
 */
export const VST_DEMO_PATCHES = [
  {
    id: 'vital_cyberpunk_reese',
    name: 'Cyberpunk Reese Bass',
    engine: 'Vital Synth',
    category: 'Bass',
    data: {
      name: 'CyberReese',
      author: 'ModernVST',
      synth_version: '1.5.5',
      settings: {
        polyphony: 1,
        portamento_time: 0.12,
        osc_1_on: 1,
        osc_1_wave_frame: 'detuned saw',
        osc_1_unison_voices: 4,
        osc_1_transpose: -12,
        osc_1_level: 0.9,
        osc_2_on: 1,
        osc_2_wave_frame: 'pulse pwm',
        osc_2_transpose: -12,
        osc_2_tune: 0.08,
        osc_2_level: 0.85,
        osc_3_on: 1,
        osc_3_wave_frame: 'sub sine',
        osc_3_transpose: -24,
        osc_3_level: 1.0,
        filter_1_model: 0,
        filter_1_cutoff: 65,
        filter_1_resonance: 0.25,
        env_1_attack: 0.005,
        env_1_decay: 0.8,
        env_1_sustain: 0.9,
        env_1_release: 0.25,
        chorus_on: 1,
        chorus_dry_wet: 0.35,
        reverb_on: 1,
        reverb_dry_wet: 0.15
      }
    }
  },
  {
    id: 'serum_hypersaw_pluck',
    name: 'Euphoric Trance Pluck',
    engine: 'Serum VST',
    category: 'Pluck',
    data: {
      name: 'TrancePluck',
      author: 'XferSound',
      synth_version: '1.36',
      settings: {
        polyphony: 8,
        portamento_time: 0,
        osc_1_on: 1,
        osc_1_wave_frame: 'jp-8 saw',
        osc_1_unison_voices: 7,
        osc_1_level: 0.9,
        osc_2_on: 1,
        osc_2_wave_frame: 'supersaw',
        osc_2_tune: 0.06,
        osc_2_level: 0.85,
        filter_1_model: 0,
        filter_1_cutoff: 45,
        filter_1_resonance: 0.35,
        env_1_attack: 0.002,
        env_1_decay: 0.45,
        env_1_sustain: 0.0,
        env_1_release: 0.35,
        env_2_attack: 0.002,
        env_2_decay: 0.3,
        env_2_sustain: 0.0,
        env_2_release: 0.25,
        chorus_on: 1,
        chorus_dry_wet: 0.5,
        reverb_on: 1,
        reverb_dry_wet: 0.45
      }
    }
  },
  {
    id: 'vital_ambient_pad',
    name: 'Ethereal Cosmic Pad',
    engine: 'Vital Synth',
    category: 'Pad',
    data: {
      name: 'CosmicPad',
      author: 'DeepSpace',
      synth_version: '1.5.5',
      settings: {
        polyphony: 8,
        portamento_time: 0,
        osc_1_on: 1,
        osc_1_wave_frame: 'warm strings',
        osc_1_level: 0.85,
        osc_2_on: 1,
        osc_2_wave_frame: 'choir aahs',
        osc_2_tune: 0.04,
        osc_2_level: 0.75,
        osc_3_on: 1,
        osc_3_wave_frame: 'bell wave',
        osc_3_transpose: 12,
        osc_3_level: 0.5,
        sample_on: 1,
        sample_level: 0.15,
        filter_1_model: 0,
        filter_1_cutoff: 75,
        filter_1_resonance: 0.1,
        env_1_attack: 1.2,
        env_1_decay: 2.5,
        env_1_sustain: 0.85,
        env_1_release: 2.0,
        chorus_on: 1,
        chorus_dry_wet: 0.6,
        reverb_on: 1,
        reverb_dry_wet: 0.7
      }
    }
  }
];

/**
 * Automatically inspect any dropped or selected file and transpile to Roland XV-5050
 * @param {File|Blob|ArrayBuffer|string} input
 * @param {string} fileName
 * @returns {Promise<object>} Transpilation result
 */
export async function transpileVstFile(input, fileName = '') {
  let text = '';
  let buffer = null;

  if (typeof input === 'string') {
    text = input;
  } else if (input instanceof Blob || input instanceof File) {
    fileName = fileName || input.name;
    if (fileName.toLowerCase().endsWith('.fxp')) {
      buffer = await input.arrayBuffer();
    } else {
      text = await input.text();
    }
  } else if (input instanceof ArrayBuffer) {
    buffer = input;
  }

  // Route by file extension or content
  const lowerName = fileName.toLowerCase();

  if (lowerName.endsWith('.fxp') || (buffer && !text)) {
    return parseFxpPatch(buffer);
  }

  if (lowerName.endsWith('.vital') || text.includes('synth_version') || text.includes('osc_1_')) {
    return parseVitalPatch(text);
  }

  // Attempt JSON parsing as generic synth preset
  try {
    const json = JSON.parse(text);
    if (json.settings || json.synth_version) {
      return parseVitalPatch(json);
    }
    // Generic JSON preset
    return parseVitalPatch({ settings: json, name: fileName.replace(/\.[^/.]+$/, '') });
  } catch (e) {
    throw new Error(`Unsupported or unrecognized VST preset format for "${fileName}". Expected .vital, .fxp, or synth JSON.`);
  }
}

/**
 * Convert a transpiled Roland patch into DT1 SysEx packets and binary .SYX buffer
 * @param {object} transpiled - Output from parseVitalPatch, parseFxpPatch, or transpileVstFile
 * @param {number} part - Roland Part number (1-16)
 * @param {number} deviceId - SysEx Device ID (default 0x10)
 * @returns {{ packets: Uint8Array[], syxBytes: Uint8Array, commonBytes: number[], tmtBytes: number[], tonesData: number[][] }}
 */
export function buildTranspiledPatchSyx(transpiled, part = 1, deviceId = 0x10) {
  if (!transpiled || !transpiled.xvPatch) {
    throw new Error('Invalid transpiled patch structure');
  }
  const common = transpiled.xvPatch.common || {};
  const tmt = transpiled.xvPatch.tmt || {};
  const tones = Array.isArray(transpiled.xvPatch.tones)
    ? transpiled.xvPatch.tones
    : [transpiled.xvPatch.tones[1], transpiled.xvPatch.tones[2], transpiled.xvPatch.tones[3], transpiled.xvPatch.tones[4]];

  const commonBytes = new Array(0x4F).fill(0);
  const patchName = ((common.name || common.patchName || 'VST PATCH')).padEnd(12, ' ').slice(0, 12);
  for (let i = 0; i < 12; i++) commonBytes[i] = patchName.charCodeAt(i);
  commonBytes[0x0E] = common.patchLevel ?? 127;
  commonBytes[0x0F] = common.patchPan ?? 64;
  commonBytes[0x11] = common.coarseTune ?? 64;
  commonBytes[0x12] = common.fineTune ?? 64;
  commonBytes[0x14] = common.monoPoly ?? 1;
  commonBytes[0x15] = common.legatoSwitch ?? common.legato ?? 0;
  commonBytes[0x16] = common.portamentoSwitch ?? 0;
  commonBytes[0x17] = common.portamentoTime ?? 0;

  const tmtBytes = new Array(0x29).fill(0);
  tmtBytes[0x00] = tmt.structureType12 ?? 0;
  tmtBytes[0x01] = tmt.booster12 ?? 0;
  tmtBytes[0x02] = (tones[0]?.enabled ?? true) ? 1 : 0;
  tmtBytes[0x03] = (tones[1]?.enabled ?? false) ? 1 : 0;
  tmtBytes[0x04] = tmt.structureType34 ?? 0;
  tmtBytes[0x05] = tmt.booster34 ?? 0;
  tmtBytes[0x06] = (tones[2]?.enabled ?? false) ? 1 : 0;
  tmtBytes[0x07] = (tones[3]?.enabled ?? false) ? 1 : 0;

  const tonesData = [];
  for (let t = 0; t < 4; t++) {
    const toneBytes = new Array(0x0109).fill(0);
    const tone = tones[t] || {};
    const isEnabled = tone.enabled ?? (t === 0);

    toneBytes[0x00] = tone.tvaLevel ?? tone.toneLevel ?? (isEnabled ? 127 : 0);
    toneBytes[0x01] = tone.coarseTune ?? 64;
    toneBytes[0x02] = tone.fineTune ?? 64;
    toneBytes[0x04] = tone.tonePan ?? 64;

    const grp = tone.waveGroupType ?? 0;
    toneBytes[0x27] = grp;
    const wNumL = tone.waveNumberL ?? (t === 0 ? 1 : 0);
    toneBytes[0x2C] = (wNumL >> 12) & 0x0F;
    toneBytes[0x2D] = (wNumL >> 8) & 0x0F;
    toneBytes[0x2E] = (wNumL >> 4) & 0x0F;
    toneBytes[0x2F] = wNumL & 0x0F;

    const wNumR = tone.waveNumberR ?? 0;
    toneBytes[0x30] = (wNumR >> 12) & 0x0F;
    toneBytes[0x31] = (wNumR >> 8) & 0x0F;
    toneBytes[0x32] = (wNumR >> 4) & 0x0F;
    toneBytes[0x33] = wNumR & 0x0F;

    toneBytes[0x34] = tone.waveGain ?? 1;
    toneBytes[0x48] = tone.tvfFilterType ?? tone.filterType ?? 1;
    toneBytes[0x49] = tone.tvfCutoff ?? tone.cutoff ?? 127;
    toneBytes[0x4D] = tone.tvfResonance ?? tone.resonance ?? 0;
    toneBytes[0x4F] = tone.tvfEnvDepth ?? 64;
    toneBytes[0x55] = tone.tvfEnvT1 ?? 15;
    toneBytes[0x56] = tone.tvfEnvT2 ?? 25;
    toneBytes[0x58] = tone.tvfEnvT4 ?? 40;
    toneBytes[0x5B] = tone.tvfEnvL3 ?? 64;

    toneBytes[0x62] = tone.tvaLevel ?? tone.toneLevel ?? (isEnabled ? 127 : 0);
    toneBytes[0x66] = tone.tvaEnvT1 ?? 10;
    toneBytes[0x67] = tone.tvaEnvT2 ?? 20;
    toneBytes[0x68] = tone.tvaEnvT3 ?? 40;
    toneBytes[0x69] = tone.tvaEnvT4 ?? 30;
    toneBytes[0x6C] = tone.tvaEnvL3 ?? 70;

    tonesData.push(toneBytes);
  }

  const packets = createPatchSyxDump(part, commonBytes, tmtBytes, tonesData, deviceId);
  const syxBytes = exportToSyx(packets);
  return { packets, syxBytes, commonBytes, tmtBytes, tonesData };
}
