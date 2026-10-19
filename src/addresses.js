/**
 * XV-5050 Parameter Address Map
 * 
 * Defines memory layouts, address constants, and parameter offsets for
 * communicating with the XV-5050 synthesizer module via SysEx.
 * All addresses and sizes are 4-byte 7-bit arrays: [MSB, upper-mid, lower-mid, LSB].
 * Fully conforms to the official XV-5050 MIDI Implementation specification.
 */

// =============================================================================
// 1-2 System Area
// =============================================================================
export const SYSTEM = {
  COMMON: {
    BASE: [0x02, 0x00, 0x00, 0x00],
    SIZE: [0x00, 0x00, 0x00, 0x21], // 33 bytes
    params: {
      MASTER_TUNE:        { offset: 0x00, size: 4 }, // 4 nibbles, 24-2024 (-100.0 to +100.0 cent)
      MASTER_KEY_SHIFT:   { offset: 0x04, size: 1 }, // 40-88 (-24 to +24 semitones, 64 = 0)
      MASTER_LEVEL:       { offset: 0x05, size: 1 }, // 0-127
      SCALE_TUNE_SWITCH:  { offset: 0x06, size: 1 }, // 0-1 (OFF, ON)
      PATCH_REMAIN:       { offset: 0x07, size: 1 }, // 0-1 (OFF, ON)
      MIX_PARALLEL:       { offset: 0x08, size: 1 }, // 0-1 (MIX, PARALLEL)
      PERF_CTRL_CH:       { offset: 0x09, size: 1 }, // 0-16 (1-16, OFF)
      PATCH_RECEIVE_CH:   { offset: 0x0B, size: 1 }, // 0-15 (1-16)
      SYSTEM_CTRL_1:      { offset: 0x18, size: 1 }, // 0-97 (OFF, CC01-31, CC33-95, BEND, AFT)
      SYSTEM_CTRL_2:      { offset: 0x19, size: 1 },
      SYSTEM_CTRL_3:      { offset: 0x1A, size: 1 },
      SYSTEM_CTRL_4:      { offset: 0x1B, size: 1 },
      RECEIVE_PC:         { offset: 0x1C, size: 1 }, // 0-1 (OFF, ON)
      RECEIVE_BANK:       { offset: 0x1D, size: 1 }, // 0-1 (OFF, ON)
      CLOCK_SOURCE:       { offset: 0x1E, size: 1 }, // 0-2 (INT, MIDI, USB)
      SYSTEM_TEMPO_MSB:   { offset: 0x1F, size: 1 }, // 20-250 BPM (nibble split)
      SYSTEM_TEMPO_LSB:   { offset: 0x20, size: 1 },
    },
  },
};

// =============================================================================
// 1-3 Performance Temporary Area (Base: 10 00 00 00)
// =============================================================================
export const PERF_TEMP = {
  COMMON: {
    BASE: [0x10, 0x00, 0x00, 0x00],
    SIZE: [0x00, 0x00, 0x00, 0x35], // 53 bytes
    params: {
      NAME_1:             { offset: 0x00, size: 1 }, // ASCII 32-127
      NAME_2:             { offset: 0x01, size: 1 },
      NAME_3:             { offset: 0x02, size: 1 },
      NAME_4:             { offset: 0x03, size: 1 },
      NAME_5:             { offset: 0x04, size: 1 },
      NAME_6:             { offset: 0x05, size: 1 },
      NAME_7:             { offset: 0x06, size: 1 },
      NAME_8:             { offset: 0x07, size: 1 },
      NAME_9:             { offset: 0x08, size: 1 },
      NAME_10:            { offset: 0x09, size: 1 },
      NAME_11:            { offset: 0x0A, size: 1 },
      NAME_12:            { offset: 0x0B, size: 1 },
      SOLO_PART_SELECT:   { offset: 0x0C, size: 1 }, // 0-32 (OFF, 1-16, 17-32)
      MFX_CTRL_CHANNEL:   { offset: 0x0D, size: 1 }, // 0-16 (1-16, OFF)
      MFX_CTRL_MIDI1:     { offset: 0x0E, size: 1 }, // 0-1 (OFF, ON)
      MFX_CTRL_MIDI2:     { offset: 0x0F, size: 1 }, // 0-1 (OFF, ON)
      MFXA_SOURCE:        { offset: 0x30, size: 1 }, // 0-32 (PERFORM, 1-16, 17-32)
      MFXB_SOURCE:        { offset: 0x31, size: 1 },
      MFXC_SOURCE:        { offset: 0x32, size: 1 },
      CHORUS_SOURCE:      { offset: 0x33, size: 1 },
      REVERB_SOURCE:      { offset: 0x34, size: 1 },
    },
  },

  // Performance Common Chorus (Offset 00 04 00)
  CHORUS: {
    BASE: [0x10, 0x00, 0x04, 0x00],
    SIZE: [0x00, 0x00, 0x00, 0x34], // 52 bytes
    params: {
      CHORUS_TYPE:        { offset: 0x00, size: 1 }, // 0-3 (OFF, CHORUS, DELAY, GM2 CHORUS)
      CHORUS_LEVEL:       { offset: 0x01, size: 1 }, // 0-127
      OUTPUT_ASSIGN:      { offset: 0x02, size: 1 }, // 0-3 (A, B, C, D)
      OUTPUT_SELECT:      { offset: 0x03, size: 1 }, // 0-2 (MAIN, REV, MAIN+REV)
    },
  },

  // Performance Common Reverb (Offset 00 06 00)
  REVERB: {
    BASE: [0x10, 0x00, 0x06, 0x00],
    SIZE: [0x00, 0x00, 0x00, 0x53], // 83 bytes
    params: {
      REVERB_TYPE:        { offset: 0x00, size: 1 }, // 0-5 (OFF, REVERB, SRV ROOM, SRV HALL, SRV PLATE, GM2 REVERB)
      REVERB_LEVEL:       { offset: 0x01, size: 1 }, // 0-127
      OUTPUT_ASSIGN:      { offset: 0x02, size: 1 }, // 0-3 (A, B, C, D)
    },
  },
};

/**
 * Get the base address for Performance MIDI parameters (Channel 1-16).
 * Table 1-3-5 in manual: Base 10 00 10 00 - 10 00 1F 00.
 * @param {number} ch - Channel number (1-16)
 * @returns {number[]} 4-byte address
 */
export function getPerfMidiAddress(ch) {
  if (ch < 1 || ch > 16) {
    throw new Error(`Performance MIDI channel must be 1-16, got ${ch}`);
  }
  return [0x10, 0x00, 0x10 + (ch - 1), 0x00];
}

export const PERF_MIDI = {
  SIZE: [0x00, 0x00, 0x00, 0x0C], // 12 bytes
  params: {
    RECEIVE_PC:           { offset: 0x00, size: 1 }, // 0-1
    RECEIVE_BANK:         { offset: 0x01, size: 1 }, // 0-1
    RECEIVE_BENDER:       { offset: 0x02, size: 1 }, // 0-1
    RECEIVE_POLY_PRESS:   { offset: 0x03, size: 1 }, // 0-1
    RECEIVE_CH_PRESS:     { offset: 0x04, size: 1 }, // 0-1
    RECEIVE_MODULATION:   { offset: 0x05, size: 1 }, // 0-1
    RECEIVE_VOLUME:       { offset: 0x06, size: 1 }, // 0-1
    RECEIVE_PAN:          { offset: 0x07, size: 1 }, // 0-1
    RECEIVE_EXPRESSION:   { offset: 0x08, size: 1 }, // 0-1
    RECEIVE_HOLD1:        { offset: 0x09, size: 1 }, // 0-1
    PHASE_LOCK:           { offset: 0x0A, size: 1 }, // 0-1
    VELOCITY_CURVE:       { offset: 0x0B, size: 1 }, // 0-4 (OFF, 1-4)
  },
};

/**
 * Get the base address for a Performance Part (Part 1-16).
 * Table 1-3-6 in manual: Base 10 00 20 00 - 10 00 2F 00.
 * @param {number} part - Part number (1-16)
 * @returns {number[]} 4-byte address
 */
export function getPartAddress(part) {
  if (part < 1 || part > 16) {
    throw new Error(`Part number must be 1-16, got ${part}`);
  }
  return [0x10, 0x00, 0x20 + (part - 1), 0x00];
}

export const PERF_PART = {
  SIZE: [0x00, 0x00, 0x00, 0x31], // 49 bytes
  params: {
    RECEIVE_CHANNEL:      { offset: 0x00, size: 1 }, // 0-15 (1-16)
    RECEIVE_SWITCH:       { offset: 0x01, size: 1 }, // 0-1 (OFF, ON)
    RECEIVE_MIDI1:        { offset: 0x02, size: 1 }, // 0-1 (OFF, ON)
    RECEIVE_MIDI2:        { offset: 0x03, size: 1 }, // 0-1 (OFF, ON)
    PATCH_BANK_MSB:       { offset: 0x04, size: 1 }, // 0-127 (CC# 0)
    PATCH_BANK_LSB:       { offset: 0x05, size: 1 }, // 0-127 (CC# 32)
    PATCH_PC:             { offset: 0x06, size: 1 }, // 0-127 (PC 1-128)
    PART_LEVEL:           { offset: 0x07, size: 1 }, // 0-127 (CC# 7)
    PART_PAN:             { offset: 0x08, size: 1 }, // 0-127 (CC# 10, L64-63R, 64=Center)
    COARSE_TUNE:          { offset: 0x09, size: 1 }, // 16-112 (-48 to +48, 64=0)
    FINE_TUNE:            { offset: 0x0A, size: 1 }, // 14-114 (-50 to +50, 64=0)
    MONO_POLY:            { offset: 0x0B, size: 1 }, // 0-2 (MONO, POLY, PATCH)
    LEGATO_SWITCH:        { offset: 0x0C, size: 1 }, // 0-2 (OFF, ON, PATCH)
    PITCH_BEND_RANGE:     { offset: 0x0D, size: 1 }, // 0-25 (0-24, PATCH)
    PORTAMENTO_SWITCH:    { offset: 0x0E, size: 1 }, // 0-2 (OFF, ON, PATCH)
    PORTAMENTO_TIME_MSB:  { offset: 0x0F, size: 1 }, // nibble split
    PORTAMENTO_TIME_LSB:  { offset: 0x10, size: 1 }, // 0-128 (0-127, PATCH)
    CUTOFF_OFFSET:        { offset: 0x11, size: 1 }, // 0-127 (-64 to +63, 64=0)
    RESONANCE_OFFSET:     { offset: 0x12, size: 1 }, // 0-127 (-64 to +63, 64=0)
    ATTACK_TIME_OFFSET:   { offset: 0x13, size: 1 }, // 0-127 (-64 to +63, 64=0)
    RELEASE_TIME_OFFSET:  { offset: 0x14, size: 1 }, // 0-127 (-64 to +63, 64=0)
    OCTAVE_SHIFT:         { offset: 0x15, size: 1 }, // 61-67 (-3 to +3, 64=0)
    VELOCITY_SENS_OFFSET: { offset: 0x16, size: 1 }, // 1-127 (-63 to +63, 64=0)
    KEY_RANGE_LOWER:      { offset: 0x17, size: 1 }, // 0-127 (C-1 to UPPER)
    KEY_RANGE_UPPER:      { offset: 0x18, size: 1 }, // 0-127 (LOWER to G9)
    KEY_FADE_LOWER:       { offset: 0x19, size: 1 }, // 0-127
    KEY_FADE_UPPER:       { offset: 0x1A, size: 1 }, // 0-127
    MUTE_SWITCH:          { offset: 0x1B, size: 1 }, // 0-1 (OFF, MUTE)
    DRY_SEND_LEVEL:       { offset: 0x1C, size: 1 }, // 0-127
    CHORUS_SEND:          { offset: 0x1D, size: 1 }, // 0-127 (CC# 93)
    REVERB_SEND:          { offset: 0x1E, size: 1 }, // 0-127 (CC# 91)
    OUTPUT_ASSIGN:        { offset: 0x1F, size: 1 }, // 0-13 (MFX, A, B, C, D, 1, 2, 3, 4, 5, 6, 7, 8, PATCH)
    OUTPUT_MFX_SELECT:    { offset: 0x20, size: 1 }, // 0-2 (MFXA, MFXB, MFXC)
    DECAY_TIME_OFFSET:    { offset: 0x21, size: 1 }, // 0-127 (-64 to +63)
    VIBRATO_RATE:         { offset: 0x22, size: 1 }, // 0-127 (-64 to +63)
    VIBRATO_DEPTH:        { offset: 0x23, size: 1 }, // 0-127 (-64 to +63)
    VIBRATO_DELAY:        { offset: 0x24, size: 1 }, // 0-127 (-64 to +63)
  },
};

// =============================================================================
// 1-4 Patch Temporary Area
// =============================================================================
// Single Patch Mode: 1F 00 00 00
// Performance Mode Part 1:  11 00 00 00
// Performance Mode Part 2:  11 20 00 00
// ...
// Performance Mode Part 16: 14 60 00 00

/**
 * Get the 4-byte base address for a patch temporary area.
 * @param {number} part - Part number (1-16), or 0 for Single Patch mode
 * @returns {number[]} 4-byte base address
 */
export function getPatchTempAddress(part) {
  if (part === 0) {
    return [0x1F, 0x00, 0x00, 0x00];
  }
  if (part < 1 || part > 16) {
    throw new Error(`Part number must be 0-16, got ${part}`);
  }
  const idx = part - 1;
  const msb = 0x11 + Math.floor(idx / 4);
  const mid = (idx % 4) * 0x20;
  return [msb, mid, 0x00, 0x00];
}

// 1-4-1-1 Patch Common (Offset 00 00 00)
export const PATCH_COMMON = {
  SIZE: [0x00, 0x00, 0x00, 0x4F], // 79 bytes
  params: {
    NAME_1:               { offset: 0x00, size: 1 }, // ASCII 32-127
    NAME_2:               { offset: 0x01, size: 1 },
    NAME_3:               { offset: 0x02, size: 1 },
    NAME_4:               { offset: 0x03, size: 1 },
    NAME_5:               { offset: 0x04, size: 1 },
    NAME_6:               { offset: 0x05, size: 1 },
    NAME_7:               { offset: 0x06, size: 1 },
    NAME_8:               { offset: 0x07, size: 1 },
    NAME_9:               { offset: 0x08, size: 1 },
    NAME_10:              { offset: 0x09, size: 1 },
    NAME_11:              { offset: 0x0A, size: 1 },
    NAME_12:              { offset: 0x0B, size: 1 },
    PATCH_CATEGORY:       { offset: 0x0C, size: 1 }, // 0-127
    TONE_TYPE:            { offset: 0x0D, size: 1 }, // 0-1 (4TONES, MULTI-PARTIAL)
    PATCH_LEVEL:          { offset: 0x0E, size: 1 }, // 0-127
    PATCH_PAN:            { offset: 0x0F, size: 1 }, // 0-127 (L64-63R, 64=Center)
    PATCH_PRIORITY:       { offset: 0x10, size: 1 }, // 0-1 (LAST, LOUDEST)
    COARSE_TUNE:          { offset: 0x11, size: 1 }, // 16-112 (-48 to +48, 64=0)
    FINE_TUNE:            { offset: 0x12, size: 1 }, // 14-114 (-50 to +50, 64=0)
    OCTAVE_SHIFT:         { offset: 0x13, size: 1 }, // 61-67 (-3 to +3, 64=0)
    STRETCH_TUNE_DEPTH:   { offset: 0x14, size: 1 }, // 0-3 (OFF, 1-3)
    ANALOG_FEEL:          { offset: 0x15, size: 1 }, // 0-127
    MONO_POLY:            { offset: 0x16, size: 1 }, // 0-1 (MONO, POLY)
    LEGATO_SWITCH:        { offset: 0x17, size: 1 }, // 0-1 (OFF, ON)
    LEGATO_RETRIGGER:     { offset: 0x18, size: 1 }, // 0-1 (OFF, ON)
    PORTAMENTO_SWITCH:    { offset: 0x19, size: 1 }, // 0-1 (OFF, ON)
    PORTAMENTO_MODE:      { offset: 0x1A, size: 1 }, // 0-1 (NORMAL, LEGATO)
    PORTAMENTO_TYPE:      { offset: 0x1B, size: 1 }, // 0-1 (RATE, TIME)
    PORTAMENTO_START:     { offset: 0x1C, size: 1 }, // 0-1 (PITCH, NOTE)
    PORTAMENTO_TIME:      { offset: 0x1D, size: 1 }, // 0-127
    PATCH_CLOCK_SOURCE:   { offset: 0x1E, size: 1 }, // 0-1 (PATCH, SYSTEM)
    PATCH_TEMPO_MSB:      { offset: 0x1F, size: 1 }, // 20-250 (nibble split)
    PATCH_TEMPO_LSB:      { offset: 0x20, size: 1 },
    CUTOFF_OFFSET:        { offset: 0x22, size: 1 }, // 1-127 (-63 to +63)
    RESONANCE_OFFSET:     { offset: 0x23, size: 1 }, // 1-127 (-63 to +63)
    ATTACK_TIME_OFFSET:   { offset: 0x24, size: 1 }, // 1-127 (-63 to +63)
    RELEASE_TIME_OFFSET:  { offset: 0x25, size: 1 }, // 1-127 (-63 to +63)
    VELOCITY_SENS_OFFSET: { offset: 0x26, size: 1 }, // 1-127 (-63 to +63)
    OUTPUT_ASSIGN:        { offset: 0x27, size: 1 }, // 0-13 (MFX, A, B, C, D, 1..8, TONE)
    TMT_CTRL_SWITCH:      { offset: 0x28, size: 1 }, // 0-1 (OFF, ON)
    BEND_RANGE_UP:        { offset: 0x29, size: 1 }, // 0-48
    BEND_RANGE_DOWN:      { offset: 0x2A, size: 1 }, // 0-48
    // Matrix Control 1
    MATRIX_CTRL_1_SOURCE: { offset: 0x2B, size: 1 }, // 0-109
    MATRIX_CTRL_1_DEST_1: { offset: 0x2C, size: 1 }, // 0-33
    MATRIX_CTRL_1_SENS_1: { offset: 0x2D, size: 1 }, // 1-127 (-63 to +63)
    MATRIX_CTRL_1_DEST_2: { offset: 0x2E, size: 1 },
    MATRIX_CTRL_1_SENS_2: { offset: 0x2F, size: 1 },
    MATRIX_CTRL_1_DEST_3: { offset: 0x30, size: 1 },
    MATRIX_CTRL_1_SENS_3: { offset: 0x31, size: 1 },
    MATRIX_CTRL_1_DEST_4: { offset: 0x32, size: 1 },
    MATRIX_CTRL_1_SENS_4: { offset: 0x33, size: 1 },
    // Matrix Control 2
    MATRIX_CTRL_2_SOURCE: { offset: 0x34, size: 1 },
    MATRIX_CTRL_2_DEST_1: { offset: 0x35, size: 1 },
    MATRIX_CTRL_2_SENS_1: { offset: 0x36, size: 1 },
    MATRIX_CTRL_2_DEST_2: { offset: 0x37, size: 1 },
    MATRIX_CTRL_2_SENS_2: { offset: 0x38, size: 1 },
    MATRIX_CTRL_2_DEST_3: { offset: 0x39, size: 1 },
    MATRIX_CTRL_2_SENS_3: { offset: 0x3A, size: 1 },
    MATRIX_CTRL_2_DEST_4: { offset: 0x3B, size: 1 },
    MATRIX_CTRL_2_SENS_4: { offset: 0x3C, size: 1 },
    // Matrix Control 3
    MATRIX_CTRL_3_SOURCE: { offset: 0x3D, size: 1 },
    MATRIX_CTRL_3_DEST_1: { offset: 0x3E, size: 1 },
    MATRIX_CTRL_3_SENS_1: { offset: 0x3F, size: 1 },
    MATRIX_CTRL_3_DEST_2: { offset: 0x40, size: 1 },
    MATRIX_CTRL_3_SENS_2: { offset: 0x41, size: 1 },
    MATRIX_CTRL_3_DEST_3: { offset: 0x42, size: 1 },
    MATRIX_CTRL_3_SENS_3: { offset: 0x43, size: 1 },
    MATRIX_CTRL_3_DEST_4: { offset: 0x44, size: 1 },
    MATRIX_CTRL_3_SENS_4: { offset: 0x45, size: 1 },
    // Matrix Control 4
    MATRIX_CTRL_4_SOURCE: { offset: 0x46, size: 1 },
    MATRIX_CTRL_4_DEST_1: { offset: 0x47, size: 1 },
    MATRIX_CTRL_4_SENS_1: { offset: 0x48, size: 1 },
    MATRIX_CTRL_4_DEST_2: { offset: 0x49, size: 1 },
    MATRIX_CTRL_4_SENS_2: { offset: 0x4A, size: 1 },
    MATRIX_CTRL_4_DEST_3: { offset: 0x4B, size: 1 },
    MATRIX_CTRL_4_SENS_3: { offset: 0x4C, size: 1 },
    MATRIX_CTRL_4_DEST_4: { offset: 0x4D, size: 1 },
    MATRIX_CTRL_4_SENS_4: { offset: 0x4E, size: 1 },
  },
};

// 1-4-1-2 Patch Common MFX (Offset 00 02 00)
export const PATCH_MFX = {
  OFFSET: [0x00, 0x00, 0x02, 0x00],
  SIZE:   [0x00, 0x00, 0x01, 0x11], // 273 bytes
  params: {
    MFX_TYPE:             { offset: 0x00, size: 1 }, // 0-127 (0-90 MFX types)
    DRY_LEVEL:            { offset: 0x01, size: 1 }, // 0-127
    CHORUS_SEND:          { offset: 0x02, size: 1 }, // 0-127
    REVERB_SEND:          { offset: 0x03, size: 1 }, // 0-127
    OUTPUT_ASSIGN:        { offset: 0x04, size: 1 }, // 0-3 (A, B, C, D)
    MFX_CTRL_1_SOURCE:    { offset: 0x05, size: 1 }, // 0-101
    MFX_CTRL_1_SENS:      { offset: 0x06, size: 1 }, // 1-127 (-63 to +63)
    MFX_CTRL_2_SOURCE:    { offset: 0x07, size: 1 }, // 0-101
    MFX_CTRL_2_SENS:      { offset: 0x08, size: 1 }, // 1-127 (-63 to +63)
    MFX_CTRL_3_SOURCE:    { offset: 0x09, size: 1 }, // 0-101
    MFX_CTRL_3_SENS:      { offset: 0x0A, size: 1 }, // 1-127 (-63 to +63)
    MFX_CTRL_4_SOURCE:    { offset: 0x0B, size: 1 }, // 0-101
    MFX_CTRL_4_SENS:      { offset: 0x0C, size: 1 }, // 1-127 (-63 to +63)
  },
};

// 1-4-1-3 Patch Common Chorus (Offset 00 04 00)
export const PATCH_CHORUS = {
  OFFSET: [0x00, 0x00, 0x04, 0x00],
  SIZE:   [0x00, 0x00, 0x00, 0x34], // 52 bytes
  params: {
    CHORUS_TYPE:          { offset: 0x00, size: 1 }, // 0-3 (OFF, CHORUS, DELAY, GM2 CHORUS)
    CHORUS_LEVEL:         { offset: 0x01, size: 1 }, // 0-127
    OUTPUT_ASSIGN:        { offset: 0x02, size: 1 }, // 0-3 (A, B, C, D)
    OUTPUT_SELECT:        { offset: 0x03, size: 1 }, // 0-2 (MAIN, REV, MAIN+REV)
  },
};

// 1-4-1-4 Patch Common Reverb (Offset 00 06 00)
export const PATCH_REVERB = {
  OFFSET: [0x00, 0x00, 0x06, 0x00],
  SIZE:   [0x00, 0x00, 0x00, 0x53], // 83 bytes
  params: {
    REVERB_TYPE:          { offset: 0x00, size: 1 }, // 0-5 (OFF, REVERB, SRV ROOM, SRV HALL, SRV PLATE, GM2 REVERB)
    REVERB_LEVEL:         { offset: 0x01, size: 1 }, // 0-127
    OUTPUT_ASSIGN:        { offset: 0x02, size: 1 }, // 0-3 (A, B, C, D)
  },
};

/**
 * Get Patch MFX address.
 * @param {number[]} patchBase - Base address of patch
 * @returns {number[]} 4-byte address
 */
export function getPatchMFXAddress(patchBase) {
  return [patchBase[0], patchBase[1], patchBase[2] + 0x02, patchBase[3]];
}

/**
 * Get Patch Chorus address.
 * @param {number[]} patchBase - Base address of patch
 * @returns {number[]} 4-byte address
 */
export function getPatchChorusAddress(patchBase) {
  return [patchBase[0], patchBase[1], patchBase[2] + 0x04, patchBase[3]];
}

/**
 * Get Patch Reverb address.
 * @param {number[]} patchBase - Base address of patch
 * @returns {number[]} 4-byte address
 */
export function getPatchReverbAddress(patchBase) {
  return [patchBase[0], patchBase[1], patchBase[2] + 0x06, patchBase[3]];
}

// 1-4-1-5 Patch TMT (Tone Mix Table, Offset 00 10 00)
export const PATCH_TMT = {
  OFFSET: [0x00, 0x00, 0x10, 0x00],
  SIZE:   [0x00, 0x00, 0x00, 0x29], // 41 bytes
  params: {
    STRUCTURE_TYPE_1_2:   { offset: 0x00, size: 1 }, // 0-9 (Type 1-10)
    BOOSTER_1_2:          { offset: 0x01, size: 1 }, // 0-3 (0, +6, +12, +18 dB)
    STRUCTURE_TYPE_3_4:   { offset: 0x02, size: 1 }, // 0-9 (Type 1-10)
    BOOSTER_3_4:          { offset: 0x03, size: 1 }, // 0-3 (0, +6, +12, +18 dB)
    TMT_VEL_CONTROL:      { offset: 0x04, size: 1 }, // 0-2 (OFF, ON, RANDOM)
    // Tone 1
    TONE_1_SWITCH:        { offset: 0x05, size: 1 }, // 0-1 (OFF, ON)
    TONE_1_KEY_LOWER:     { offset: 0x06, size: 1 },
    TONE_1_KEY_UPPER:     { offset: 0x07, size: 1 },
    TONE_1_KEY_FADE_L:    { offset: 0x08, size: 1 },
    TONE_1_KEY_FADE_U:    { offset: 0x09, size: 1 },
    TONE_1_VEL_LOWER:     { offset: 0x0A, size: 1 },
    TONE_1_VEL_UPPER:     { offset: 0x0B, size: 1 },
    TONE_1_VEL_FADE_L:    { offset: 0x0C, size: 1 },
    TONE_1_VEL_FADE_U:    { offset: 0x0D, size: 1 },
    // Tone 2
    TONE_2_SWITCH:        { offset: 0x0E, size: 1 }, // 0-1 (OFF, ON)
    TONE_2_KEY_LOWER:     { offset: 0x0F, size: 1 },
    TONE_2_KEY_UPPER:     { offset: 0x10, size: 1 },
    TONE_2_KEY_FADE_L:    { offset: 0x11, size: 1 },
    TONE_2_KEY_FADE_U:    { offset: 0x12, size: 1 },
    TONE_2_VEL_LOWER:     { offset: 0x13, size: 1 },
    TONE_2_VEL_UPPER:     { offset: 0x14, size: 1 },
    TONE_2_VEL_FADE_L:    { offset: 0x15, size: 1 },
    TONE_2_VEL_FADE_U:    { offset: 0x16, size: 1 },
    // Tone 3
    TONE_3_SWITCH:        { offset: 0x17, size: 1 }, // 0-1 (OFF, ON)
    TONE_3_KEY_LOWER:     { offset: 0x18, size: 1 },
    TONE_3_KEY_UPPER:     { offset: 0x19, size: 1 },
    TONE_3_KEY_FADE_L:    { offset: 0x1A, size: 1 },
    TONE_3_KEY_FADE_U:    { offset: 0x1B, size: 1 },
    TONE_3_VEL_LOWER:     { offset: 0x1C, size: 1 },
    TONE_3_VEL_UPPER:     { offset: 0x1D, size: 1 },
    TONE_3_VEL_FADE_L:    { offset: 0x1E, size: 1 },
    TONE_3_VEL_FADE_U:    { offset: 0x1F, size: 1 },
    // Tone 4
    TONE_4_SWITCH:        { offset: 0x20, size: 1 }, // 0-1 (OFF, ON)
    TONE_4_KEY_LOWER:     { offset: 0x21, size: 1 },
    TONE_4_KEY_UPPER:     { offset: 0x22, size: 1 },
    TONE_4_KEY_FADE_L:    { offset: 0x23, size: 1 },
    TONE_4_KEY_FADE_U:    { offset: 0x24, size: 1 },
    TONE_4_VEL_LOWER:     { offset: 0x25, size: 1 },
    TONE_4_VEL_UPPER:     { offset: 0x26, size: 1 },
    TONE_4_VEL_FADE_L:    { offset: 0x27, size: 1 },
    TONE_4_VEL_FADE_U:    { offset: 0x28, size: 1 },
  },
};

/**
 * Get the 4-byte base address for a Patch TMT block.
 * @param {number[]} patchBase - 4-byte patch base address
 * @returns {number[]} 4-byte TMT address
 */
export function getPatchTMTAddress(patchBase) {
  return [patchBase[0], patchBase[1], patchBase[2] + 0x10, patchBase[3]];
}

/**
 * Get the 4-byte base address for a Tone (1-4) within a patch.
 * Tone 1: patchBase + [0x00, 0x00, 0x20, 0x00]
 * Tone 2: patchBase + [0x00, 0x00, 0x22, 0x00]
 * Tone 3: patchBase + [0x00, 0x00, 0x24, 0x00]
 * Tone 4: patchBase + [0x00, 0x00, 0x26, 0x00]
 * 
 * @param {number[]} patchBase - Base address of the patch
 * @param {number} tone - Tone number (1-4)
 * @returns {number[]} 4-byte base address for the tone
 */
export function getToneAddress(patchBase, tone) {
  if (tone < 1 || tone > 4) {
    throw new Error(`Tone number must be 1-4, got ${tone}`);
  }
  const toneOffset = 0x20 + (tone - 1) * 2;
  return [patchBase[0], patchBase[1], patchBase[2] + toneOffset, patchBase[3]];
}

// 1-4-1-6 Patch Tone (Base: Tone address, Size: 0x0109 = 265 bytes)
export const PATCH_TONE = {
  SIZE: [0x00, 0x00, 0x01, 0x09], // 265 bytes
  params: {
    TONE_LEVEL:           { offset: 0x00, size: 1 }, // 0-127
    COARSE_TUNE:          { offset: 0x01, size: 1 }, // 16-112 (-48 to +48, 64=0)
    FINE_TUNE:            { offset: 0x02, size: 1 }, // 14-114 (-50 to +50, 64=0)
    RANDOM_PITCH_DEPTH:   { offset: 0x03, size: 1 }, // 0-30
    TONE_PAN:             { offset: 0x04, size: 1 }, // 0-127 (64=Center)
    PAN_KEYFOLLOW:        { offset: 0x05, size: 1 }, // 54-74 (-100 to +100)
    RANDOM_PAN_DEPTH:     { offset: 0x06, size: 1 }, // 0-63
    ALT_PAN_DEPTH:        { offset: 0x07, size: 1 }, // 1-127 (-63 to +63)
    // Wave
    WAVE_GROUP_TYPE:      { offset: 0x27, size: 1 }, // 0-3 (INT, SR-JV80, SRX, SAMPLE)
    WAVE_GROUP_ID:        { offset: 0x28, size: 4 }, // 4 nibbles
    WAVE_GROUP_ID_1:      { offset: 0x28, size: 1 }, // 4 nibbles
    WAVE_GROUP_ID_2:      { offset: 0x29, size: 1 },
    WAVE_GROUP_ID_3:      { offset: 0x2A, size: 1 },
    WAVE_GROUP_ID_4:      { offset: 0x2B, size: 1 },
    WAVE_NUMBER_L:        { offset: 0x2C, size: 4 }, // 4 nibbles (0 - 16384)
    WAVE_NUMBER_L_1:      { offset: 0x2C, size: 1 }, // 4 nibbles
    WAVE_NUMBER_L_2:      { offset: 0x2D, size: 1 },
    WAVE_NUMBER_L_3:      { offset: 0x2E, size: 1 },
    WAVE_NUMBER_L_4:      { offset: 0x2F, size: 1 },
    WAVE_NUMBER_R:        { offset: 0x30, size: 4 }, // 4 nibbles (0 - 16384)
    WAVE_NUMBER_R_1:      { offset: 0x30, size: 1 }, // 4 nibbles
    WAVE_NUMBER_R_2:      { offset: 0x31, size: 1 },
    WAVE_NUMBER_R_3:      { offset: 0x32, size: 1 },
    WAVE_NUMBER_R_4:      { offset: 0x33, size: 1 },
    WAVE_GAIN:            { offset: 0x34, size: 1 }, // 0-3 (-6, 0, +6, +12 dB)
    WAVE_FXM_SWITCH:      { offset: 0x35, size: 1 }, // 0-1 (OFF, ON)
    WAVE_FXM_SW:          { offset: 0x35, size: 1 }, // alias
    WAVE_FXM_COLOR:       { offset: 0x36, size: 1 }, // 0-3 (1-4)
    WAVE_FXM_DEPTH:       { offset: 0x37, size: 1 }, // 0-16
    WAVE_TEMPO_SYNC:      { offset: 0x38, size: 1 }, // 0-1 (OFF, ON)
    WAVE_PITCH_KEYFOLLOW: { offset: 0x39, size: 1 }, // 44-84 (-200% to +200%)
    PITCH_KEYFOLLOW:      { offset: 0x39, size: 1 }, // alias
    // Pitch Envelope
    PITCH_ENV_DEPTH:      { offset: 0x3A, size: 1 }, // 52-76 (-12 to +12)
    PITCH_ENV_VEL_SENS:   { offset: 0x3B, size: 1 }, // 1-127 (-63 to +63)
    PITCH_ENV_TIME1_VEL:  { offset: 0x3C, size: 1 }, // 1-127 (-63 to +63)
    PITCH_ENV_TIME4_VEL:  { offset: 0x3D, size: 1 }, // 1-127 (-63 to +63)
    PITCH_ENV_TIME_KEY:   { offset: 0x3E, size: 1 }, // 54-74 (-100 to +100)
    PITCH_ENV_T1:         { offset: 0x3F, size: 1 }, // 0-127
    PITCH_ENV_T2:         { offset: 0x40, size: 1 },
    PITCH_ENV_T3:         { offset: 0x41, size: 1 },
    PITCH_ENV_T4:         { offset: 0x42, size: 1 },
    PITCH_ENV_L0:         { offset: 0x43, size: 1 }, // 1-127 (-63 to +63)
    PITCH_ENV_L1:         { offset: 0x44, size: 1 },
    PITCH_ENV_L2:         { offset: 0x45, size: 1 },
    PITCH_ENV_L3:         { offset: 0x46, size: 1 },
    PITCH_ENV_L4:         { offset: 0x47, size: 1 },
    // TVF
    TVF_FILTER_TYPE:      { offset: 0x48, size: 1 }, // 0-6 (OFF, LPF, BPF, HPF, PKG, LPF2, LPF3)
    TVF_CUTOFF:           { offset: 0x49, size: 1 }, // 0-127
    TVF_CUTOFF_KEYFOLLOW: { offset: 0x4A, size: 1 }, // 44-84 (-200% to +200%)
    TVF_CUTOFF_VEL_CURVE: { offset: 0x4B, size: 1 }, // 0-7 (FIXED, 1-7)
    TVF_CUTOFF_VEL_SENS:  { offset: 0x4C, size: 1 }, // 1-127 (-63 to +63)
    TVF_RESONANCE:        { offset: 0x4D, size: 1 }, // 0-127
    TVF_RESO_VEL_SENS:    { offset: 0x4E, size: 1 }, // 1-127 (-63 to +63)
    TVF_ENV_DEPTH:        { offset: 0x4F, size: 1 }, // 1-127 (-63 to +63)
    TVF_ENV_VEL_CURVE:    { offset: 0x50, size: 1 }, // 0-6 (1-7)
    TVF_ENV_VEL_SENS:     { offset: 0x51, size: 1 }, // 1-127 (-63 to +63)
    TVF_ENV_TIME1_VEL:    { offset: 0x52, size: 1 }, // 1-127 (-63 to +63)
    TVF_ENV_TIME4_VEL:    { offset: 0x53, size: 1 }, // 1-127 (-63 to +63)
    TVF_ENV_TIME_KEY:     { offset: 0x54, size: 1 }, // 54-74 (-100 to +100)
    TVF_ENV_T1:           { offset: 0x55, size: 1 }, // 0-127
    TVF_ENV_T2:           { offset: 0x56, size: 1 },
    TVF_ENV_T3:           { offset: 0x57, size: 1 },
    TVF_ENV_T4:           { offset: 0x58, size: 1 },
    TVF_ENV_L1:           { offset: 0x59, size: 1 }, // 0-127
    TVF_ENV_L2:           { offset: 0x5A, size: 1 },
    TVF_ENV_L3:           { offset: 0x5B, size: 1 },
    TVF_ENV_L4:           { offset: 0x5C, size: 1 },
    // TVA
    TVA_LEVEL:            { offset: 0x6E, size: 1 }, // 0-127
    TVA_VEL_CURVE:        { offset: 0x6F, size: 1 }, // 0-6 (1-7)
    TVA_VEL_SENS:         { offset: 0x70, size: 1 }, // 1-127 (-63 to +63)
    TVA_ENV_TIME1_VEL:    { offset: 0x71, size: 1 }, // 1-127 (-63 to +63)
    TVA_ENV_TIME4_VEL:    { offset: 0x72, size: 1 }, // 1-127 (-63 to +63)
    TVA_ENV_TIME_KEY:     { offset: 0x73, size: 1 }, // 54-74 (-100 to +100)
    TVA_ENV_T1:           { offset: 0x74, size: 1 }, // 0-127
    TVA_ENV_T2:           { offset: 0x75, size: 1 },
    TVA_ENV_T3:           { offset: 0x76, size: 1 },
    TVA_ENV_T4:           { offset: 0x77, size: 1 },
    TVA_ENV_L1:           { offset: 0x78, size: 1 }, // 0-127
    TVA_ENV_L2:           { offset: 0x79, size: 1 },
    TVA_ENV_L3:           { offset: 0x7A, size: 1 },
    // LFO 1
    LFO1_FORM:            { offset: 0x8A, size: 1 }, // 0-9
    LFO1_RATE:            { offset: 0x8B, size: 1 }, // 0-127
    LFO1_TEMPO_SYNC:      { offset: 0x8D, size: 1 }, // 0-1 (OFF, ON)
    LFO1_FADE_MODE:       { offset: 0x8E, size: 1 }, // 0-3 (ON-IN, ON-OUT, OFF-IN, OFF-OUT)
    LFO1_DELAY_TIME:      { offset: 0x8F, size: 1 }, // 0-127
    LFO1_FADE_TIME:       { offset: 0x90, size: 1 }, // 0-127
    LFO1_OFFSET:          { offset: 0x91, size: 1 }, // 0-4 (-100, -50, 0, +50, +100)
    LFO1_KEY_TRIGGER:     { offset: 0x93, size: 1 }, // 0-1 (OFF, ON)
    LFO1_PITCH_DEPTH:     { offset: 0x94, size: 1 }, // 1-127 (-63 to +63)
    LFO1_TVF_DEPTH:       { offset: 0x95, size: 1 }, // 1-127 (-63 to +63)
    LFO1_TVA_DEPTH:       { offset: 0x96, size: 1 }, // 1-127 (-63 to +63)
    LFO1_PAN_DEPTH:       { offset: 0x97, size: 1 }, // 1-127 (-63 to +63)
    // LFO 2
    LFO2_FORM:            { offset: 0xFA, size: 1 }, // 0-9
    LFO2_RATE:            { offset: 0xFB, size: 1 }, // 0-127
    LFO2_TEMPO_SYNC:      { offset: 0xFD, size: 1 }, // 0-1 (OFF, ON)
    LFO2_FADE_MODE:       { offset: 0xFE, size: 1 }, // 0-3
    LFO2_DELAY_TIME:      { offset: 0xFF, size: 1 }, // 0-127
    LFO2_FADE_TIME:       { offset: 0x0100, size: 1 }, // 0-127
    LFO2_OFFSET:          { offset: 0x0101, size: 1 }, // 0-4
    LFO2_KEY_TRIGGER:     { offset: 0x0104, size: 1 }, // 0-1
    LFO2_PITCH_DEPTH:     { offset: 0x0105, size: 1 }, // 1-127 (-63 to +63)
    LFO2_TVF_DEPTH:       { offset: 0x0106, size: 1 }, // 1-127 (-63 to +63)
    LFO2_TVA_DEPTH:       { offset: 0x0107, size: 1 }, // 1-127 (-63 to +63)
    LFO2_PAN_DEPTH:       { offset: 0x0108, size: 1 }, // 1-127 (-63 to +63)
  },
};

// =============================================================================
// Address Math Helper
// =============================================================================

/**
 * Add an offset to a 4-byte MIDI address (7-bit arithmetic).
 * @param {number[]} base - 4-byte base address
 * @param {number} offset - Offset to add
 * @returns {number[]} New 4-byte address
 */
export function addOffset(base, offset) {
  const result = [...base];
  let carry = offset;

  for (let i = 3; i >= 0; i--) {
    const sum = result[i] + carry;
    result[i] = sum & 0x7F;
    carry = Math.floor(sum / 0x80);
  }

  return result;
}
