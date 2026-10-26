/**
 * Scale Tune & Microtonal Temperaments Engine
 * Roland XV-5050 Owner's Manual Chapter 3 (p. 66) & Table 1-3-5
 * 
 * Supports per-part microtonal scale tuning across all 12 semitones (C through B)
 * with range -64 to +63 cents (raw SysEx value 0 to 127, center 64 = 0 cents).
 */

import { buildDT1 } from './sysex.js';

export const NOTE_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];

export const SCALE_TEMPERAMENTS = {
  equal: {
    name: 'Equal Temperament',
    description: 'Modern standard 12-TET division (0 cents on all notes).',
    offsets: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]
  },
  justMajor: {
    name: 'Just Intonation (Major C)',
    description: 'Acoustically pure natural harmonics for major triads in key of C.',
    offsets: [0, -14, 4, 16, -14, -2, -10, 2, 14, -16, -4, -12]
  },
  justMinor: {
    name: 'Just Intonation (Minor C)',
    description: 'Acoustically pure natural harmonics for minor triads in key of C.',
    offsets: [0, 16, 4, 16, -14, -2, 16, 2, 14, -16, 18, -12]
  },
  pythagorean: {
    name: 'Pythagorean Scale',
    description: 'Ancient Greek temperament based on a sequence of pure 3:2 fifths.',
    offsets: [0, -10, 4, -6, 8, -2, 6, 2, -8, 6, -4, 10]
  },
  meantone: {
    name: 'Meantone (1/4 Comma)',
    description: 'Renaissance tuning with pure major thirds, popular in early keyboard music.',
    offsets: [0, -24, -7, 10, -14, 3, -21, -3, -27, -10, 7, -17]
  },
  werckmeister: {
    name: 'Werckmeister III',
    description: 'Baroque well-tempered tuning designed by Andreas Werckmeister (1691).',
    offsets: [0, -10, -8, -6, -10, -2, -8, -4, -8, -10, -4, -8]
  },
  kirnberger: {
    name: 'Kirnberger III',
    description: 'Johann Kirnberger well-temperament (1779) creating varied key characters.',
    offsets: [0, -10, -7, -6, -14, -2, -10, -3, -8, -10, -4, -12]
  },
  arabicRast: {
    name: 'Arabic Quarter-Tone (Rast)',
    description: 'Traditional Middle Eastern Maqam with neutral quarter-tones on E and B (-50 cents).',
    offsets: [0, 0, 0, 0, -50, 0, 0, 0, 0, 0, 0, -50]
  },
  arabicBayati: {
    name: 'Arabic Quarter-Tone (Bayati)',
    description: 'Traditional Middle Eastern Maqam with neutral quarter-tones on E (-50 cents).',
    offsets: [0, 0, 0, 0, -50, 0, 0, 0, 0, 0, 0, 0]
  }
};

/**
 * Get the 4-byte base address for a Part's Scale Tune block.
 * Part 1: 10 00 10 40 ... Part 16: 10 00 1F 40
 * @param {number} partNumber - 1 to 16
 * @returns {Array<number>} 4-byte address
 */
export function getPartScaleTuneAddress(partNumber) {
  if (partNumber < 1 || partNumber > 16) {
    throw new Error(`Part number must be 1-16, got ${partNumber}`);
  }
  return [0x10, 0x00, 0x10 + (partNumber - 1), 0x40];
}

/**
 * Convert cents (-64 to +63) to raw Roland SysEx value (0 to 127).
 * Center 0 cents = 64.
 * @param {number} cents
 * @returns {number} 0-127
 */
export function centsToRaw(cents) {
  const clamped = Math.max(-64, Math.min(63, Math.round(cents)));
  return clamped + 64;
}

/**
 * Convert raw Roland SysEx value (0 to 127) to cents (-64 to +63).
 * @param {number} raw
 * @returns {number}
 */
export function rawToCents(raw) {
  const clamped = Math.max(0, Math.min(127, Math.round(raw)));
  return clamped - 64;
}

/**
 * Build a DT1 message to write a single note's scale tune offset on a Part.
 * @param {number} deviceId - Roland Device ID (0x10 - 0x1F)
 * @param {number} partNumber - Part 1 to 16
 * @param {number} noteIndex - 0 (C) to 11 (B)
 * @param {number} cents - Offset in cents (-64 to +63)
 * @returns {Uint8Array} SysEx message
 */
export function buildNoteScaleTuneDT1(deviceId, partNumber, noteIndex, cents) {
  if (noteIndex < 0 || noteIndex > 11) {
    throw new Error(`Note index must be 0-11, got ${noteIndex}`);
  }
  const base = getPartScaleTuneAddress(partNumber);
  const addr = [base[0], base[1], base[2], base[3] + noteIndex];
  const raw = centsToRaw(cents);
  return buildDT1(addr, [raw], deviceId);
}

/**
 * Build a DT1 message to write all 12 notes of a scale temperament simultaneously.
 * @param {number} deviceId - Roland Device ID (0x10 - 0x1F)
 * @param {number} partNumber - Part 1 to 16
 * @param {Array<number>} offsetsInCents - Array of 12 cents values
 * @returns {Uint8Array} SysEx message
 */
export function buildPartScaleTemperamentDT1(deviceId, partNumber, offsetsInCents) {
  if (!offsetsInCents || offsetsInCents.length !== 12) {
    throw new Error(`Must provide exactly 12 note offsets in cents`);
  }
  const addr = getPartScaleTuneAddress(partNumber);
  const data = offsetsInCents.map(c => centsToRaw(c));
  return buildDT1(addr, data, deviceId);
}

/**
 * Send Scale Tune temperament to hardware over MIDI.
 * @param {object} midi - MidiManager instance
 * @param {number} partNumber - Part 1 to 16
 * @param {Array<number>} offsetsInCents - 12 note values
 */
export async function sendPartScaleTemperament(midi, partNumber, offsetsInCents) {
  const msg = buildPartScaleTemperamentDT1(midi.deviceId, partNumber, offsetsInCents);
  await midi.sendSysEx(msg);
}
