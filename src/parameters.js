/**
 * XV-5050 Parameter Definitions
 * 
 * Parameter metadata — names, ranges, types, enum mappings, and display formatting
 * for all XV-5050 parameters used in the editor.
 */

/**
 * @typedef {object} ParamDef
 * @property {string} name - Human-readable parameter name
 * @property {number} min - Minimum raw value
 * @property {number} max - Maximum raw value
 * @property {string} [type] - Display type: 'number', 'switch', 'ascii', 'enum', 'signed', 'pan'
 * @property {number} [displayOffset] - Offset for display (e.g., -64 for signed params)
 * @property {string[]} [enumValues] - Labels for enum-type parameters
 */

// =============================================================================
// System parameter definitions
// =============================================================================
export const SYSTEM_PARAMS = {
  MASTER_LEVEL:       { name: 'Master Level', min: 0, max: 127, type: 'number' },
  MASTER_KEY_SHIFT:   { name: 'Master Key Shift', min: 40, max: 88, type: 'signed', displayOffset: -64 },
  SCALE_TUNE_SWITCH:  { name: 'Scale Tune', min: 0, max: 1, type: 'switch' },
  PATCH_REMAIN:       { name: 'Patch Remain', min: 0, max: 1, type: 'switch' },
  MIX_PARALLEL:       { name: 'Output Mode', min: 0, max: 1, type: 'enum', enumValues: ['MIX', 'PARALLEL'] },
  CLOCK_SOURCE:       { name: 'Clock Source', min: 0, max: 2, type: 'enum', enumValues: ['INT', 'MIDI', 'USB'] },
  RECEIVE_PC:         { name: 'Receive Program Change', min: 0, max: 1, type: 'switch' },
  RECEIVE_BANK:       { name: 'Receive Bank Select', min: 0, max: 1, type: 'switch' },
};

// =============================================================================
// Performance Common parameter definitions
// =============================================================================
export const PERF_COMMON_PARAMS = {
  SOLO_PART_SELECT: {
    name: 'Solo Part Select',
    min: 0,
    max: 16,
    type: 'enum',
    enumValues: ['OFF', '1', '2', '3', '4', '5', '6', '7', '8', '9', '10', '11', '12', '13', '14', '15', '16'],
  },
  MFX_CTRL_CHANNEL: {
    name: 'MFX Control Channel',
    min: 0,
    max: 16,
    type: 'enum',
    enumValues: ['1', '2', '3', '4', '5', '6', '7', '8', '9', '10', '11', '12', '13', '14', '15', '16', 'OFF'],
  },
  MFXA_SOURCE: { name: 'MFX-A Source', min: 0, max: 16, type: 'enum', enumValues: ['PERFORM', ...Array.from({ length: 16 }, (_, i) => `PART ${i + 1}`)] },
  CHORUS_SOURCE: { name: 'Chorus Source', min: 0, max: 16, type: 'enum', enumValues: ['PERFORM', ...Array.from({ length: 16 }, (_, i) => `PART ${i + 1}`)] },
  REVERB_SOURCE: { name: 'Reverb Source', min: 0, max: 16, type: 'enum', enumValues: ['PERFORM', ...Array.from({ length: 16 }, (_, i) => `PART ${i + 1}`)] },
};

export const PERF_CHORUS_PARAMS = {
  CHORUS_TYPE:   { name: 'Chorus Type', min: 0, max: 3, type: 'enum', enumValues: ['OFF', 'CHORUS', 'DELAY', 'GM2 CHORUS'] },
  CHORUS_LEVEL:  { name: 'Chorus Level', min: 0, max: 127, type: 'number' },
  OUTPUT_ASSIGN: { name: 'Output Assign', min: 0, max: 3, type: 'enum', enumValues: ['A', 'B', 'C', 'D'] },
  OUTPUT_SELECT: { name: 'Output Select', min: 0, max: 2, type: 'enum', enumValues: ['MAIN', 'REV', 'MAIN+REV'] },
};

export const PERF_REVERB_PARAMS = {
  REVERB_TYPE:   { name: 'Reverb Type', min: 0, max: 5, type: 'enum', enumValues: ['OFF', 'REVERB', 'SRV ROOM', 'SRV HALL', 'SRV PLATE', 'GM2 REVERB'] },
  REVERB_LEVEL:  { name: 'Reverb Level', min: 0, max: 127, type: 'number' },
  OUTPUT_ASSIGN: { name: 'Output Assign', min: 0, max: 3, type: 'enum', enumValues: ['A', 'B', 'C', 'D'] },
};

// =============================================================================
// Performance Part parameter definitions
// =============================================================================
export const PERF_PART_PARAMS = {
  RECEIVE_CHANNEL:      { name: 'MIDI Channel', min: 0, max: 15, type: 'enum',
    enumValues: ['1','2','3','4','5','6','7','8','9','10','11','12','13','14','15','16'] },
  RECEIVE_SWITCH:       { name: 'Part Switch', min: 0, max: 1, type: 'switch' },
  PATCH_BANK_MSB:       { name: 'Bank MSB', min: 0, max: 127, type: 'number' },
  PATCH_BANK_LSB:       { name: 'Bank LSB', min: 0, max: 127, type: 'number' },
  PATCH_PC:             { name: 'Program Number', min: 0, max: 127, type: 'number' },
  PART_LEVEL:           { name: 'Level', min: 0, max: 127, type: 'number' },
  PART_PAN:             { name: 'Pan', min: 0, max: 127, type: 'pan' },
  COARSE_TUNE:          { name: 'Coarse Tune', min: 16, max: 112, type: 'signed', displayOffset: -64 },
  FINE_TUNE:            { name: 'Fine Tune', min: 14, max: 114, type: 'signed', displayOffset: -64 },
  MONO_POLY:            { name: 'Mono/Poly', min: 0, max: 2, type: 'enum', enumValues: ['MONO', 'POLY', 'PATCH'] },
  LEGATO_SWITCH:        { name: 'Legato Switch', min: 0, max: 2, type: 'enum', enumValues: ['OFF', 'ON', 'PATCH'] },
  PITCH_BEND_RANGE:     { name: 'Bend Range', min: 0, max: 25, type: 'enum', enumValues: [...Array.from({ length: 25 }, (_, i) => `${i}`), 'PATCH'] },
  PORTAMENTO_SWITCH:    { name: 'Portamento', min: 0, max: 2, type: 'enum', enumValues: ['OFF', 'ON', 'PATCH'] },
  CUTOFF_OFFSET:        { name: 'Cutoff Offset', min: 0, max: 127, type: 'signed', displayOffset: -64 },
  RESONANCE_OFFSET:     { name: 'Resonance Offset', min: 0, max: 127, type: 'signed', displayOffset: -64 },
  ATTACK_TIME_OFFSET:   { name: 'Attack Offset', min: 0, max: 127, type: 'signed', displayOffset: -64 },
  RELEASE_TIME_OFFSET:  { name: 'Release Offset', min: 0, max: 127, type: 'signed', displayOffset: -64 },
  OCTAVE_SHIFT:         { name: 'Octave Shift', min: 61, max: 67, type: 'signed', displayOffset: -64 },
  VELOCITY_SENS_OFFSET: { name: 'Vel Sens Offset', min: 1, max: 127, type: 'signed', displayOffset: -64 },
  KEY_RANGE_LOWER:      { name: 'Key Range Lower', min: 0, max: 127, type: 'number' },
  KEY_RANGE_UPPER:      { name: 'Key Range Upper', min: 0, max: 127, type: 'number' },
  MUTE_SWITCH:          { name: 'Mute', min: 0, max: 1, type: 'switch' },
  DRY_SEND_LEVEL:       { name: 'Dry Level', min: 0, max: 127, type: 'number' },
  CHORUS_SEND:          { name: 'Chorus Send', min: 0, max: 127, type: 'number' },
  REVERB_SEND:          { name: 'Reverb Send', min: 0, max: 127, type: 'number' },
  OUTPUT_ASSIGN:        { name: 'Output Assign', min: 0, max: 13, type: 'enum',
    enumValues: ['MFX', 'A', 'B', 'C', 'D', '1', '2', '3', '4', '5', '6', '7', '8', 'PATCH'] },
  OUTPUT_MFX_SELECT:    { name: 'MFX Select', min: 0, max: 2, type: 'enum', enumValues: ['MFXA', 'MFXB', 'MFXC'] },
};

// =============================================================================
// Stage 2 Enums and Tables
// =============================================================================

export const MATRIX_SOURCES = [
  'OFF',
  ...Array.from({ length: 95 }, (_, i) => `CC${String(i + 1).padStart(2, '0')}`),
  'BEND', 'AFT', 'SYS1', 'SYS2', 'SYS3', 'SYS4',
  'VELOCITY', 'KEYFOLLOW', 'TEMPO', 'LFO1', 'LFO2',
  'PIT-ENV', 'TVF-ENV', 'TVA-ENV'
];

export const MATRIX_DESTINATIONS = [
  'OFF', 'PCH', 'CUT', 'RES', 'LEV', 'PAN',
  'DRY', 'CHO', 'REV',
  'PIT-LFO1', 'PIT-LFO2', 'TVF-LFO1', 'TVF-LFO2', 'TVA-LFO1', 'TVA-LFO2',
  'PAN-LFO1', 'PAN-LFO2', 'LFO1-RATE', 'LFO2-RATE',
  'PIT-ATK', 'PIT-DCY', 'PIT-REL',
  'TVF-ATK', 'TVF-DCY', 'TVF-REL',
  'TVA-ATK', 'TVA-DCY', 'TVA-REL',
  'TMT', 'FXM',
  'MFX-CTRL1', 'MFX-CTRL2', 'MFX-CTRL3', 'MFX-CTRL4'
];

import { INTERNAL_WAVEFORMS } from './waveforms.js';
export { INTERNAL_WAVEFORMS };

export const WAVE_GROUP_TYPES = ['INT', 'SR-JV80', 'SRX', 'SAMPLE'];

/**
 * Get waveform name for a given wave group type and wave number (1-based).
 * @param {number} groupType - 0: INT, 1: SR-JV80, 2: SRX, 3: SAMPLE
 * @param {number} waveNumber - 1-16384 (or 0 for OFF)
 * @returns {string} Waveform name
 */
export function getWaveName(groupType, waveNumber) {
  if (!waveNumber || waveNumber === 0) return 'OFF';
  if (groupType === 0) {
    return INTERNAL_WAVEFORMS[waveNumber - 1] || `Wave ${waveNumber}`;
  }
  const groupLabel = WAVE_GROUP_TYPES[groupType] || 'EXP';
  return `${groupLabel}:${String(waveNumber).padStart(4, '0')}`;
}

export const LFO_WAVEFORMS = [
  'TRI', 'SIN', 'SAW-UP', 'SAW-DN', 'SQR',
  'TRP', 'S&H', 'RND', 'STEP1', 'STEP2'
];

export const FILTER_TYPES = [
  'OFF', 'LPF', 'BPF', 'HPF', 'PKG', 'LPF2', 'LPF3'
];

// =============================================================================
// Patch Common parameter definitions
// =============================================================================
export const PATCH_COMMON_PARAMS = {
  PATCH_CATEGORY:     { name: 'Category', min: 0, max: 127, type: 'number' },
  TONE_TYPE:          { name: 'Tone Type', min: 0, max: 1, type: 'enum', enumValues: ['4TONES', 'MULTI-PARTIAL'] },
  PATCH_LEVEL:        { name: 'Patch Level', min: 0, max: 127, type: 'number' },
  PATCH_PAN:          { name: 'Patch Pan', min: 0, max: 127, type: 'pan' },
  PATCH_PRIORITY:     { name: 'Voice Priority', min: 0, max: 1, type: 'enum', enumValues: ['LAST', 'LOUDEST'] },
  COARSE_TUNE:        { name: 'Coarse Tune', min: 16, max: 112, type: 'signed', displayOffset: -64 },
  FINE_TUNE:          { name: 'Fine Tune', min: 14, max: 114, type: 'signed', displayOffset: -64 },
  OCTAVE_SHIFT:       { name: 'Octave Shift', min: 61, max: 67, type: 'signed', displayOffset: -64 },
  STRETCH_TUNE_DEPTH: { name: 'Stretch Tune', min: 0, max: 3, type: 'enum', enumValues: ['OFF', '1', '2', '3'] },
  ANALOG_FEEL:        { name: 'Analog Feel', min: 0, max: 127, type: 'number' },
  MONO_POLY:          { name: 'Mono/Poly', min: 0, max: 1, type: 'enum', enumValues: ['MONO', 'POLY'] },
  LEGATO_SWITCH:      { name: 'Legato', min: 0, max: 1, type: 'switch' },
  LEGATO_RETRIGGER:   { name: 'Legato Retrigger', min: 0, max: 1, type: 'switch' },
  PORTAMENTO_SWITCH:  { name: 'Portamento', min: 0, max: 1, type: 'switch' },
  PORTAMENTO_MODE:    { name: 'Portamento Mode', min: 0, max: 1, type: 'enum', enumValues: ['NORMAL', 'LEGATO'] },
  PORTAMENTO_TYPE:    { name: 'Portamento Type', min: 0, max: 1, type: 'enum', enumValues: ['RATE', 'TIME'] },
  PORTAMENTO_START:   { name: 'Portamento Start', min: 0, max: 1, type: 'enum', enumValues: ['PITCH', 'NOTE'] },
  PORTAMENTO_TIME:    { name: 'Portamento Time', min: 0, max: 127, type: 'number' },
  PATCH_CLOCK_SOURCE: { name: 'Patch Clock Source', min: 0, max: 1, type: 'enum', enumValues: ['PATCH', 'SYSTEM'] },
  CUTOFF_OFFSET:      { name: 'Cutoff Offset', min: 1, max: 127, type: 'signed', displayOffset: -64 },
  RESONANCE_OFFSET:   { name: 'Resonance Offset', min: 1, max: 127, type: 'signed', displayOffset: -64 },
  ATTACK_TIME_OFFSET: { name: 'Attack Offset', min: 1, max: 127, type: 'signed', displayOffset: -64 },
  RELEASE_TIME_OFFSET:{ name: 'Release Offset', min: 1, max: 127, type: 'signed', displayOffset: -64 },
  VELOCITY_SENS_OFFSET:{ name: 'Velocity Sens Offset', min: 1, max: 127, type: 'signed', displayOffset: -64 },
  OUTPUT_ASSIGN:      { name: 'Output Assign', min: 0, max: 13, type: 'enum',
    enumValues: ['MFX', 'A', 'B', 'C', 'D', '1', '2', '3', '4', '5', '6', '7', '8', 'TONE'] },
  TMT_CTRL_SWITCH:    { name: 'TMT Ctrl Switch', min: 0, max: 1, type: 'switch' },
  BEND_RANGE_UP:      { name: 'Bend Range Up', min: 0, max: 48, type: 'number' },
  BEND_RANGE_DOWN:    { name: 'Bend Range Down', min: 0, max: 48, type: 'number' },
  // Matrix Control 1-4 definitions
  MATRIX_CTRL_1_SOURCE: { name: 'Matrix 1 Source', min: 0, max: 109, type: 'enum', enumValues: MATRIX_SOURCES },
  MATRIX_CTRL_1_DEST_1: { name: 'Matrix 1 Dest 1', min: 0, max: 33, type: 'enum', enumValues: MATRIX_DESTINATIONS },
  MATRIX_CTRL_1_SENS_1: { name: 'Matrix 1 Sens 1', min: 1, max: 127, type: 'signed', displayOffset: -64 },
  MATRIX_CTRL_1_DEST_2: { name: 'Matrix 1 Dest 2', min: 0, max: 33, type: 'enum', enumValues: MATRIX_DESTINATIONS },
  MATRIX_CTRL_1_SENS_2: { name: 'Matrix 1 Sens 2', min: 1, max: 127, type: 'signed', displayOffset: -64 },
  MATRIX_CTRL_1_DEST_3: { name: 'Matrix 1 Dest 3', min: 0, max: 33, type: 'enum', enumValues: MATRIX_DESTINATIONS },
  MATRIX_CTRL_1_SENS_3: { name: 'Matrix 1 Sens 3', min: 1, max: 127, type: 'signed', displayOffset: -64 },
  MATRIX_CTRL_1_DEST_4: { name: 'Matrix 1 Dest 4', min: 0, max: 33, type: 'enum', enumValues: MATRIX_DESTINATIONS },
  MATRIX_CTRL_1_SENS_4: { name: 'Matrix 1 Sens 4', min: 1, max: 127, type: 'signed', displayOffset: -64 },
};

// =============================================================================
// Patch TMT (Tone Mix Table) parameter definitions
// =============================================================================
export const PATCH_TMT_PARAMS = {
  STRUCTURE_TYPE_1_2: { name: 'Structure 1-2', min: 0, max: 9, type: 'enum',
    enumValues: ['1 (Type 1)', '2 (Type 2)', '3 (Type 3)', '4 (Type 4)', '5 (Type 5)', '6 (Type 6)', '7 (Type 7)', '8 (Type 8)', '9 (Type 9)', '10 (Type 10)'] },
  BOOSTER_1_2:        { name: 'Booster 1-2', min: 0, max: 3, type: 'enum', enumValues: ['0 dB', '+6 dB', '+12 dB', '+18 dB'] },
  STRUCTURE_TYPE_3_4: { name: 'Structure 3-4', min: 0, max: 9, type: 'enum',
    enumValues: ['1 (Type 1)', '2 (Type 2)', '3 (Type 3)', '4 (Type 4)', '5 (Type 5)', '6 (Type 6)', '7 (Type 7)', '8 (Type 8)', '9 (Type 9)', '10 (Type 10)'] },
  BOOSTER_3_4:        { name: 'Booster 3-4', min: 0, max: 3, type: 'enum', enumValues: ['0 dB', '+6 dB', '+12 dB', '+18 dB'] },
  TMT_VEL_CONTROL:    { name: 'TMT Velocity Control', min: 0, max: 2, type: 'enum', enumValues: ['OFF', 'ON', 'RANDOM'] },
  TONE_1_SWITCH:      { name: 'Tone 1 Switch', min: 0, max: 1, type: 'switch' },
  TONE_1_KEY_LOWER:   { name: 'Tone 1 Key Lower', min: 0, max: 127, type: 'number' },
  TONE_1_KEY_UPPER:   { name: 'Tone 1 Key Upper', min: 0, max: 127, type: 'number' },
  TONE_1_VEL_LOWER:   { name: 'Tone 1 Vel Lower', min: 1, max: 127, type: 'number' },
  TONE_1_VEL_UPPER:   { name: 'Tone 1 Vel Upper', min: 1, max: 127, type: 'number' },
  TONE_2_SWITCH:      { name: 'Tone 2 Switch', min: 0, max: 1, type: 'switch' },
  TONE_2_KEY_LOWER:   { name: 'Tone 2 Key Lower', min: 0, max: 127, type: 'number' },
  TONE_2_KEY_UPPER:   { name: 'Tone 2 Key Upper', min: 0, max: 127, type: 'number' },
  TONE_2_VEL_LOWER:   { name: 'Tone 2 Vel Lower', min: 1, max: 127, type: 'number' },
  TONE_2_VEL_UPPER:   { name: 'Tone 2 Vel Upper', min: 1, max: 127, type: 'number' },
  TONE_3_SWITCH:      { name: 'Tone 3 Switch', min: 0, max: 1, type: 'switch' },
  TONE_3_KEY_LOWER:   { name: 'Tone 3 Key Lower', min: 0, max: 127, type: 'number' },
  TONE_3_KEY_UPPER:   { name: 'Tone 3 Key Upper', min: 0, max: 127, type: 'number' },
  TONE_3_VEL_LOWER:   { name: 'Tone 3 Vel Lower', min: 1, max: 127, type: 'number' },
  TONE_3_VEL_UPPER:   { name: 'Tone 3 Vel Upper', min: 1, max: 127, type: 'number' },
  TONE_4_SWITCH:      { name: 'Tone 4 Switch', min: 0, max: 1, type: 'switch' },
  TONE_4_KEY_LOWER:   { name: 'Tone 4 Key Lower', min: 0, max: 127, type: 'number' },
  TONE_4_KEY_UPPER:   { name: 'Tone 4 Key Upper', min: 0, max: 127, type: 'number' },
  TONE_4_VEL_LOWER:   { name: 'Tone 4 Vel Lower', min: 1, max: 127, type: 'number' },
  TONE_4_VEL_UPPER:   { name: 'Tone 4 Vel Upper', min: 1, max: 127, type: 'number' },
};

// =============================================================================
// Patch Tone parameter definitions
// =============================================================================
export const PATCH_TONE_PARAMS = {
  TONE_LEVEL:           { name: 'Tone Level', min: 0, max: 127, type: 'number' },
  COARSE_TUNE:          { name: 'Coarse Tune', min: 16, max: 112, type: 'signed', displayOffset: -64 },
  FINE_TUNE:            { name: 'Fine Tune', min: 14, max: 114, type: 'signed', displayOffset: -64 },
  TONE_PAN:             { name: 'Tone Pan', min: 0, max: 127, type: 'pan' },
  WAVE_GROUP_TYPE:      { name: 'Wave Group', min: 0, max: 3, type: 'enum', enumValues: ['INT', 'SR-JV80', 'SRX', 'SAMPLE'] },
  WAVE_NUMBER_L:        { name: 'Wave Number L (Mono)', min: 0, max: 16384, type: 'number' },
  WAVE_NUMBER_R:        { name: 'Wave Number R', min: 0, max: 16384, type: 'number' },
  WAVE_GAIN:            { name: 'Wave Gain', min: 0, max: 3, type: 'enum', enumValues: ['-6 dB', '0 dB', '+6 dB', '+12 dB'] },
  WAVE_FXM_SWITCH:      { name: 'FXM Switch', min: 0, max: 1, type: 'switch' },
  WAVE_FXM_COLOR:       { name: 'FXM Color', min: 0, max: 3, type: 'enum', enumValues: ['1', '2', '3', '4'] },
  WAVE_FXM_DEPTH:       { name: 'FXM Depth', min: 0, max: 16, type: 'number' },
  WAVE_TEMPO_SYNC:      { name: 'Wave Tempo Sync', min: 0, max: 1, type: 'switch' },
  WAVE_PITCH_KEYFOLLOW: { name: 'Wave Pitch Keyfollow', min: 44, max: 84, type: 'signed', displayOffset: -64 },
  // Pitch Envelope
  PITCH_ENV_DEPTH:      { name: 'Pitch Env Depth', min: 52, max: 76, type: 'signed', displayOffset: -64 },
  PITCH_ENV_VEL_SENS:   { name: 'Pitch Env Vel Sens', min: 1, max: 127, type: 'signed', displayOffset: -64 },
  PITCH_ENV_T1:         { name: 'Pitch Env T1', min: 0, max: 127, type: 'number' },
  PITCH_ENV_T2:         { name: 'Pitch Env T2', min: 0, max: 127, type: 'number' },
  PITCH_ENV_T3:         { name: 'Pitch Env T3', min: 0, max: 127, type: 'number' },
  PITCH_ENV_T4:         { name: 'Pitch Env T4', min: 0, max: 127, type: 'number' },
  PITCH_ENV_L0:         { name: 'Pitch Env L0', min: 1, max: 127, type: 'signed', displayOffset: -64 },
  PITCH_ENV_L1:         { name: 'Pitch Env L1', min: 1, max: 127, type: 'signed', displayOffset: -64 },
  PITCH_ENV_L2:         { name: 'Pitch Env L2', min: 1, max: 127, type: 'signed', displayOffset: -64 },
  PITCH_ENV_L3:         { name: 'Pitch Env L3', min: 1, max: 127, type: 'signed', displayOffset: -64 },
  PITCH_ENV_L4:         { name: 'Pitch Env L4', min: 1, max: 127, type: 'signed', displayOffset: -64 },
  // TVF
  TVF_FILTER_TYPE:      { name: 'Filter Type', min: 0, max: 6, type: 'enum', enumValues: FILTER_TYPES },
  TVF_CUTOFF:           { name: 'Cutoff', min: 0, max: 127, type: 'number' },
  TVF_RESONANCE:        { name: 'Resonance', min: 0, max: 127, type: 'number' },
  TVF_ENV_DEPTH:        { name: 'TVF Env Depth', min: 1, max: 127, type: 'signed', displayOffset: -64 },
  TVF_ENV_T1:           { name: 'TVF Env T1', min: 0, max: 127, type: 'number' },
  TVF_ENV_T2:           { name: 'TVF Env T2', min: 0, max: 127, type: 'number' },
  TVF_ENV_T3:           { name: 'TVF Env T3', min: 0, max: 127, type: 'number' },
  TVF_ENV_T4:           { name: 'TVF Env T4', min: 0, max: 127, type: 'number' },
  TVF_ENV_L1:           { name: 'TVF Env L1', min: 0, max: 127, type: 'number' },
  TVF_ENV_L2:           { name: 'TVF Env L2', min: 0, max: 127, type: 'number' },
  TVF_ENV_L3:           { name: 'TVF Env L3', min: 0, max: 127, type: 'number' },
  TVF_ENV_L4:           { name: 'TVF Env L4', min: 0, max: 127, type: 'number' },
  // TVA
  TVA_LEVEL:            { name: 'TVA Level', min: 0, max: 127, type: 'number' },
  TVA_ENV_T1:           { name: 'TVA Env T1', min: 0, max: 127, type: 'number' },
  TVA_ENV_T2:           { name: 'TVA Env T2', min: 0, max: 127, type: 'number' },
  TVA_ENV_T3:           { name: 'TVA Env T3', min: 0, max: 127, type: 'number' },
  TVA_ENV_T4:           { name: 'TVA Env T4', min: 0, max: 127, type: 'number' },
  TVA_ENV_L1:           { name: 'TVA Env L1', min: 0, max: 127, type: 'number' },
  TVA_ENV_L2:           { name: 'TVA Env L2', min: 0, max: 127, type: 'number' },
  TVA_ENV_L3:           { name: 'TVA Env L3', min: 0, max: 127, type: 'number' },
  // LFO 1 & 2
  LFO1_FORM:            { name: 'LFO 1 Form', min: 0, max: 9, type: 'enum', enumValues: LFO_WAVEFORMS },
  LFO1_RATE:            { name: 'LFO 1 Rate', min: 0, max: 127, type: 'number' },
  LFO1_PITCH_DEPTH:     { name: 'LFO 1 Pitch Depth', min: 1, max: 127, type: 'signed', displayOffset: -64 },
  LFO1_TVF_DEPTH:       { name: 'LFO 1 TVF Depth', min: 1, max: 127, type: 'signed', displayOffset: -64 },
  LFO1_TVA_DEPTH:       { name: 'LFO 1 TVA Depth', min: 1, max: 127, type: 'signed', displayOffset: -64 },
  LFO1_PAN_DEPTH:       { name: 'LFO 1 Pan Depth', min: 1, max: 127, type: 'signed', displayOffset: -64 },
  LFO2_FORM:            { name: 'LFO 2 Form', min: 0, max: 9, type: 'enum', enumValues: LFO_WAVEFORMS },
  LFO2_RATE:            { name: 'LFO 2 Rate', min: 0, max: 127, type: 'number' },
  LFO2_PITCH_DEPTH:     { name: 'LFO 2 Pitch Depth', min: 1, max: 127, type: 'signed', displayOffset: -64 },
  LFO2_TVF_DEPTH:       { name: 'LFO 2 TVF Depth', min: 1, max: 127, type: 'signed', displayOffset: -64 },
  LFO2_TVA_DEPTH:       { name: 'LFO 2 TVA Depth', min: 1, max: 127, type: 'signed', displayOffset: -64 },
  LFO2_PAN_DEPTH:       { name: 'LFO 2 Pan Depth', min: 1, max: 127, type: 'signed', displayOffset: -64 },
};

// =============================================================================
// Display & Conversion Helpers
// =============================================================================

/**
 * Format a raw parameter value for display.
 * @param {ParamDef} paramDef - Parameter definition
 * @param {number} value - Raw value
 * @returns {string} Formatted display string
 */
export function formatParamValue(paramDef, value) {
  if (!paramDef) return `${value}`;
  switch (paramDef.type) {
    case 'switch':
      return value ? 'ON' : 'OFF';
    case 'enum':
      return paramDef.enumValues?.[value] ?? `${value}`;
    case 'signed':
      return `${value + (paramDef.displayOffset || 0)}`;
    case 'pan':
      if (value === 64) return 'C';
      return value < 64 ? `L${64 - value}` : `R${value - 64}`;
    case 'ascii':
      return String.fromCharCode(value);
    default:
      return `${value}`;
  }
}

/**
 * Parse a display string back to a raw parameter value.
 * @param {ParamDef} paramDef - Parameter definition
 * @param {string|number} displayValue - Display value
 * @returns {number} Raw parameter value
 */
export function parseDisplayValue(paramDef, displayValue) {
  if (!paramDef) return Number(displayValue);
  switch (paramDef.type) {
    case 'switch':
      return displayValue === 'ON' || displayValue === true || displayValue === 1 ? 1 : 0;
    case 'enum': {
      const idx = paramDef.enumValues?.indexOf(String(displayValue));
      return (idx !== undefined && idx >= 0) ? idx : Number(displayValue);
    }
    case 'signed':
      return Number(displayValue) - (paramDef.displayOffset || 0);
    case 'pan': {
      const s = String(displayValue).trim().toUpperCase();
      if (s === 'C') return 64;
      if (s.startsWith('L')) return 64 - parseInt(s.slice(1), 10);
      if (s.startsWith('R')) return 64 + parseInt(s.slice(1), 10);
      return Number(displayValue);
    }
    default:
      return Number(displayValue);
  }
}

/**
 * Decode a name from an array of ASCII byte values.
 * @param {number[]} bytes - Array of ASCII byte values (12 chars)
 * @returns {string} Decoded name string
 */
export function decodeName(bytes) {
  if (!bytes) return '';
  return bytes.map(b => String.fromCharCode(b)).join('').trimEnd();
}

/**
 * Encode a name string to an array of ASCII byte values.
 * @param {string} name - Name string (max 12 chars)
 * @returns {number[]} Array of 12 ASCII byte values, space-padded
 */
export function encodeName(name) {
  const padded = (name || '').padEnd(12, ' ').slice(0, 12);
  return Array.from(padded).map(c => c.charCodeAt(0));
}
