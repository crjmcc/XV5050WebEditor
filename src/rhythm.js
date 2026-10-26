/**
 * Roland XV-5050 Rhythm Set & Per-Key Drum Designer Engine
 * Roland Owner's Manual Chapter 2 (pp. 55-63) & MIDI Implementation 1-4-2
 * 
 * Provides:
 * - 64 Roland/GM standard drum key assignments (Notes 35/B1 through 98/D7)
 * - Octave-banked pad grid model for triggering and tweaking drum sounds
 * - Roland SysEx DT1 parameter addressing for individual drum keys
 * - Built-in Drum Hit Preset Library (Kicks, Snares, Hats, Toms, Cymbals, Latin, FX)
 * - Drum Hit renaming and sound replacement engine
 */

import { buildDT1 } from './sysex.js';
import { addOffset } from './addresses.js';

export const DRUM_KEY_MAP = {
  35: { note: 'B1',  name: 'Acoustic Bass Drum', category: 'Kick',     octave: 1, defaultMute: 0 },
  36: { note: 'C2',  name: 'Bass Drum 1',        category: 'Kick',     octave: 1, defaultMute: 0 },
  37: { note: 'C#2', name: 'Side Stick',         category: 'Snare',    octave: 1, defaultMute: 0 },
  38: { note: 'D2',  name: 'Acoustic Snare',     category: 'Snare',    octave: 1, defaultMute: 0 },
  39: { note: 'D#2', name: 'Hand Clap',          category: 'Snare',    octave: 1, defaultMute: 0 },
  40: { note: 'E2',  name: 'Electric Snare',     category: 'Snare',    octave: 1, defaultMute: 0 },
  41: { note: 'F2',  name: 'Low Floor Tom',      category: 'Tom',      octave: 1, defaultMute: 0 },
  42: { note: 'F#2', name: 'Closed Hi-Hat',      category: 'Hi-Hat',   octave: 1, defaultMute: 1 },
  43: { note: 'G2',  name: 'High Floor Tom',     category: 'Tom',      octave: 1, defaultMute: 0 },
  44: { note: 'G#2', name: 'Pedal Hi-Hat',       category: 'Hi-Hat',   octave: 1, defaultMute: 1 },
  45: { note: 'A2',  name: 'Low Tom',            category: 'Tom',      octave: 1, defaultMute: 0 },
  46: { note: 'A#2', name: 'Open Hi-Hat',        category: 'Hi-Hat',   octave: 1, defaultMute: 1 },
  47: { note: 'B2',  name: 'Low-Mid Tom',        category: 'Tom',      octave: 2, defaultMute: 0 },
  48: { note: 'C3',  name: 'Hi-Mid Tom',         category: 'Tom',      octave: 2, defaultMute: 0 },
  49: { note: 'C#3', name: 'Crash Cymbal 1',     category: 'Cymbal',   octave: 2, defaultMute: 0 },
  50: { note: 'D3',  name: 'High Tom',           category: 'Tom',      octave: 2, defaultMute: 0 },
  51: { note: 'D#3', name: 'Ride Cymbal 1',      category: 'Cymbal',   octave: 2, defaultMute: 0 },
  52: { note: 'E3',  name: 'Chinese Cymbal',     category: 'Cymbal',   octave: 2, defaultMute: 0 },
  53: { note: 'F3',  name: 'Ride Bell',          category: 'Cymbal',   octave: 2, defaultMute: 0 },
  54: { note: 'F#3', name: 'Tambourine',         category: 'Perc',     octave: 2, defaultMute: 0 },
  55: { note: 'G3',  name: 'Splash Cymbal',      category: 'Cymbal',   octave: 2, defaultMute: 0 },
  56: { note: 'G#3', name: 'Cowbell',            category: 'Perc',     octave: 2, defaultMute: 0 },
  57: { note: 'A3',  name: 'Crash Cymbal 2',     category: 'Cymbal',   octave: 2, defaultMute: 0 },
  58: { note: 'A#3', name: 'Vibra-Slap',         category: 'Perc',     octave: 2, defaultMute: 0 },
  59: { note: 'B3',  name: 'Ride Cymbal 2',      category: 'Cymbal',   octave: 3, defaultMute: 0 },
  60: { note: 'C4',  name: 'High Bongo',         category: 'Latin',    octave: 3, defaultMute: 0 },
  61: { note: 'C#4', name: 'Low Bongo',          category: 'Latin',    octave: 3, defaultMute: 0 },
  62: { note: 'D4',  name: 'Mute High Conga',    category: 'Latin',    octave: 3, defaultMute: 2 },
  63: { note: 'D#4', name: 'Open High Conga',    category: 'Latin',    octave: 3, defaultMute: 2 },
  64: { note: 'E4',  name: 'Low Conga',          category: 'Latin',    octave: 3, defaultMute: 2 },
  65: { note: 'F4',  name: 'High Timbale',       category: 'Latin',    octave: 3, defaultMute: 0 },
  66: { note: 'F#4', name: 'Low Timbale',        category: 'Latin',    octave: 3, defaultMute: 0 },
  67: { note: 'G4',  name: 'High Agogo',         category: 'Latin',    octave: 3, defaultMute: 0 },
  68: { note: 'G#4', name: 'Low Agogo',          category: 'Latin',    octave: 3, defaultMute: 0 },
  69: { note: 'A4',  name: 'Cabasa',             category: 'Latin',    octave: 3, defaultMute: 0 },
  70: { note: 'A#4', name: 'Maracas',            category: 'Latin',    octave: 3, defaultMute: 0 },
  71: { note: 'B4',  name: 'Short Whistle',      category: 'Latin',    octave: 4, defaultMute: 3 },
  72: { note: 'C5',  name: 'Long Whistle',       category: 'Latin',    octave: 4, defaultMute: 3 },
  73: { note: 'C#5', name: 'Short Guiro',        category: 'Latin',    octave: 4, defaultMute: 4 },
  74: { note: 'D5',  name: 'Long Guiro',         category: 'Latin',    octave: 4, defaultMute: 4 },
  75: { note: 'D#5', name: 'Claves',             category: 'Latin',    octave: 4, defaultMute: 0 },
  76: { note: 'E5',  name: 'High Wood Block',    category: 'Perc',     octave: 4, defaultMute: 0 },
  77: { note: 'F5',  name: 'Low Wood Block',     category: 'Perc',     octave: 4, defaultMute: 0 },
  78: { note: 'F#5', name: 'Mute Cuica',         category: 'Latin',    octave: 4, defaultMute: 5 },
  79: { note: 'G5',  name: 'Open Cuica',         category: 'Latin',    octave: 4, defaultMute: 5 },
  80: { note: 'G#5', name: 'Mute Triangle',      category: 'Perc',     octave: 4, defaultMute: 6 },
  81: { note: 'A5',  name: 'Open Triangle',      category: 'Perc',     octave: 4, defaultMute: 6 },
  82: { note: 'A#5', name: 'Shaker',             category: 'Perc',     octave: 4, defaultMute: 0 },
  83: { note: 'B5',  name: 'Jingle Bell',        category: 'Perc',     octave: 5, defaultMute: 0 },
  84: { note: 'C6',  name: 'Bell Tree',          category: 'Perc',     octave: 5, defaultMute: 0 },
  85: { note: 'C#6', name: 'Castanets',          category: 'Perc',     octave: 5, defaultMute: 0 },
  86: { note: 'D6',  name: 'Mute Surdo',         category: 'Latin',    octave: 5, defaultMute: 7 },
  87: { note: 'D#6', name: 'Open Surdo',         category: 'Latin',    octave: 5, defaultMute: 7 },
  88: { note: 'E6',  name: 'Applause',           category: 'FX',       octave: 5, defaultMute: 0 },
  89: { note: 'F6',  name: 'Gunshot',            category: 'FX',       octave: 5, defaultMute: 0 },
  90: { note: 'F#6', name: 'Laser Gun',          category: 'FX',       octave: 5, defaultMute: 0 },
  91: { note: 'G6',  name: 'Siren',              category: 'FX',       octave: 5, defaultMute: 0 },
  92: { note: 'G#6', name: 'Starship',           category: 'FX',       octave: 5, defaultMute: 0 },
  93: { note: 'A6',  name: 'Car Engine',         category: 'FX',       octave: 5, defaultMute: 0 },
  94: { note: 'A#6', name: 'Car Stop',           category: 'FX',       octave: 5, defaultMute: 0 },
  95: { note: 'B6',  name: 'Car Pass',           category: 'FX',       octave: 5, defaultMute: 0 },
  96: { note: 'C7',  name: 'Car Crash',          category: 'FX',       octave: 5, defaultMute: 0 },
  97: { note: 'C#7', name: 'Bubble',             category: 'FX',       octave: 5, defaultMute: 0 },
  98: { note: 'D7',  name: 'Dog Bark',           category: 'FX',       octave: 5, defaultMute: 0 }
};

export const DRUM_OCTAVES = [
  { octave: 1, label: 'Octave 1: Kicks, Snares & Hats (B1 - A#2)', notes: [35, 36, 37, 38, 39, 40, 41, 42, 43, 44, 45, 46] },
  { octave: 2, label: 'Octave 2: Toms & Cymbals (B2 - A#3)',       notes: [47, 48, 49, 50, 51, 52, 53, 54, 55, 56, 57, 58] },
  { octave: 3, label: 'Octave 3: Bongos & Congas (B3 - A#4)',      notes: [59, 60, 61, 62, 63, 64, 65, 66, 67, 68, 69, 70] },
  { octave: 4, label: 'Octave 4: Latin Percussion (B4 - A#5)',     notes: [71, 72, 73, 74, 75, 76, 77, 78, 79, 80, 81, 82] },
  { octave: 5, label: 'Octave 5: Bells, Surdos & FX (B5 - D7)',    notes: [83, 84, 85, 86, 87, 88, 89, 90, 91, 92, 93, 94, 95, 96, 97, 98] }
];

/**
 * Rich Drum Hit Preset Library
 * Allows instant replacement of any drum hit on any pad with authentic Roland waveforms & parameters
 */
export const DRUM_HIT_LIBRARY = [
  // --- KICKS ---
  {
    id: 'kick_acoustic_studio',
    name: 'Acoustic Studio Kick',
    category: 'Kick',
    waveGroup: 0,
    waveNumber: 722, // Dry Kick
    coarseTune: 64,
    fineTune: 64,
    filterType: 1,
    cutoff: 127,
    resonance: 0,
    level: 127,
    pan: 64,
    muteGroup: 0,
    tvaDecay: 70,
    tvaRelease: 25,
    chorusSend: 0,
    reverbSend: 35
  },
  {
    id: 'kick_808_sub',
    name: '808 Sub Boom Kick',
    category: 'Kick',
    waveGroup: 0,
    waveNumber: 743, // 808 Kick
    coarseTune: 58,
    fineTune: 64,
    filterType: 1,
    cutoff: 105,
    resonance: 15,
    level: 127,
    pan: 64,
    muteGroup: 0,
    tvaDecay: 90,
    tvaRelease: 45,
    chorusSend: 0,
    reverbSend: 15
  },
  {
    id: 'kick_909_dance',
    name: '909 Punch Dance Kick',
    category: 'Kick',
    waveGroup: 0,
    waveNumber: 744, // 909 Kick 1
    coarseTune: 64,
    fineTune: 64,
    filterType: 1,
    cutoff: 127,
    resonance: 5,
    level: 127,
    pan: 64,
    muteGroup: 0,
    tvaDecay: 65,
    tvaRelease: 20,
    chorusSend: 0,
    reverbSend: 20
  },
  {
    id: 'kick_rock_punch',
    name: 'Rock Heavy Punch Kick',
    category: 'Kick',
    waveGroup: 0,
    waveNumber: 726, // Rock Kick f
    coarseTune: 63,
    fineTune: 64,
    filterType: 1,
    cutoff: 127,
    resonance: 0,
    level: 127,
    pan: 64,
    muteGroup: 0,
    tvaDecay: 62,
    tvaRelease: 20,
    chorusSend: 0,
    reverbSend: 45
  },
  {
    id: 'kick_jazz_warm',
    name: 'Warm Jazz Kick',
    category: 'Kick',
    waveGroup: 0,
    waveNumber: 730, // Jazz Kick
    coarseTune: 65,
    fineTune: 64,
    filterType: 1,
    cutoff: 95,
    resonance: 0,
    level: 118,
    pan: 64,
    muteGroup: 0,
    tvaDecay: 55,
    tvaRelease: 18,
    chorusSend: 0,
    reverbSend: 50
  },

  // --- SNARES ---
  {
    id: 'snare_acoustic_birch',
    name: 'Acoustic Birch Snare',
    category: 'Snare',
    waveGroup: 0,
    waveNumber: 682, // Rock Rim f L
    coarseTune: 64,
    fineTune: 64,
    filterType: 1,
    cutoff: 127,
    resonance: 0,
    level: 125,
    pan: 64,
    muteGroup: 0,
    tvaDecay: 65,
    tvaRelease: 25,
    chorusSend: 0,
    reverbSend: 40
  },
  {
    id: 'snare_808_crisp',
    name: '808 Crisp Snare',
    category: 'Snare',
    waveGroup: 0,
    waveNumber: 709, // 808 SN
    coarseTune: 64,
    fineTune: 64,
    filterType: 1,
    cutoff: 127,
    resonance: 10,
    level: 127,
    pan: 64,
    muteGroup: 0,
    tvaDecay: 60,
    tvaRelease: 22,
    chorusSend: 0,
    reverbSend: 25
  },
  {
    id: 'snare_909_power',
    name: '909 Power Snare',
    category: 'Snare',
    waveGroup: 0,
    waveNumber: 707, // 909 SN 1
    coarseTune: 64,
    fineTune: 64,
    filterType: 1,
    cutoff: 127,
    resonance: 0,
    level: 127,
    pan: 64,
    muteGroup: 0,
    tvaDecay: 70,
    tvaRelease: 25,
    chorusSend: 0,
    reverbSend: 35
  },
  {
    id: 'snare_piccolo_crack',
    name: 'Piccolo Rimshot Crack',
    category: 'Snare',
    waveGroup: 0,
    waveNumber: 678, // Rock Rim p L
    coarseTune: 68,
    fineTune: 70,
    filterType: 1,
    cutoff: 127,
    resonance: 12,
    level: 125,
    pan: 64,
    muteGroup: 0,
    tvaDecay: 50,
    tvaRelease: 18,
    chorusSend: 0,
    reverbSend: 30
  },
  {
    id: 'snare_clap_vintage',
    name: 'Vintage Hand Clap',
    category: 'Snare',
    waveGroup: 0,
    waveNumber: 709, // Clap
    coarseTune: 64,
    fineTune: 64,
    filterType: 1,
    cutoff: 120,
    resonance: 5,
    level: 120,
    pan: 68,
    muteGroup: 0,
    tvaDecay: 55,
    tvaRelease: 30,
    chorusSend: 20,
    reverbSend: 50
  },
  {
    id: 'snare_side_stick',
    name: 'Studio Side Stick',
    category: 'Snare',
    waveGroup: 0,
    waveNumber: 695, // Jazz Rim p L
    coarseTune: 64,
    fineTune: 64,
    filterType: 1,
    cutoff: 127,
    resonance: 0,
    level: 115,
    pan: 64,
    muteGroup: 0,
    tvaDecay: 45,
    tvaRelease: 15,
    chorusSend: 0,
    reverbSend: 25
  },

  // --- HI-HATS ---
  {
    id: 'hat_closed_tight',
    name: 'Tight Closed Hat',
    category: 'Hi-Hat',
    waveGroup: 0,
    waveNumber: 788, // Cl HiHat 1
    coarseTune: 64,
    fineTune: 64,
    filterType: 1,
    cutoff: 127,
    resonance: 0,
    level: 120,
    pan: 56,
    muteGroup: 1,
    tvaDecay: 40,
    tvaRelease: 15,
    chorusSend: 0,
    reverbSend: 15
  },
  {
    id: 'hat_open_sizzle',
    name: 'Sizzle Open Hat',
    category: 'Hi-Hat',
    waveGroup: 0,
    waveNumber: 798, // Op HiHat
    coarseTune: 64,
    fineTune: 64,
    filterType: 1,
    cutoff: 127,
    resonance: 0,
    level: 125,
    pan: 58,
    muteGroup: 1,
    tvaDecay: 85,
    tvaRelease: 45,
    chorusSend: 0,
    reverbSend: 30
  },
  {
    id: 'hat_pedal_chick',
    name: 'Pedal Hat Chick',
    category: 'Hi-Hat',
    waveGroup: 0,
    waveNumber: 804, // Pedal HiHat
    coarseTune: 64,
    fineTune: 64,
    filterType: 1,
    cutoff: 127,
    resonance: 0,
    level: 110,
    pan: 54,
    muteGroup: 1,
    tvaDecay: 35,
    tvaRelease: 15,
    chorusSend: 0,
    reverbSend: 20
  },
  {
    id: 'hat_909_crisp',
    name: '909 Metallic Hat',
    category: 'Hi-Hat',
    waveGroup: 0,
    waveNumber: 807, // 909 NZ HiHat
    coarseTune: 66,
    fineTune: 64,
    filterType: 1,
    cutoff: 127,
    resonance: 8,
    level: 122,
    pan: 56,
    muteGroup: 1,
    tvaDecay: 48,
    tvaRelease: 18,
    chorusSend: 0,
    reverbSend: 20
  },

  // --- TOMS ---
  {
    id: 'tom_acoustic_floor',
    name: 'Acoustic Low Floor Tom',
    category: 'Tom',
    waveGroup: 0,
    waveNumber: 746, // Rock TomL1 p
    coarseTune: 56,
    fineTune: 64,
    filterType: 1,
    cutoff: 127,
    resonance: 0,
    level: 127,
    pan: 72,
    muteGroup: 0,
    tvaDecay: 75,
    tvaRelease: 28,
    chorusSend: 0,
    reverbSend: 40
  },
  {
    id: 'tom_acoustic_mid',
    name: 'Acoustic Mid Rack Tom',
    category: 'Tom',
    waveGroup: 0,
    waveNumber: 747, // Rock TomL2 p
    coarseTune: 62,
    fineTune: 64,
    filterType: 1,
    cutoff: 127,
    resonance: 0,
    level: 125,
    pan: 60,
    muteGroup: 0,
    tvaDecay: 70,
    tvaRelease: 25,
    chorusSend: 0,
    reverbSend: 38
  },
  {
    id: 'tom_acoustic_high',
    name: 'Acoustic High Tom',
    category: 'Tom',
    waveGroup: 0,
    waveNumber: 747,
    coarseTune: 68,
    fineTune: 64,
    filterType: 1,
    cutoff: 127,
    resonance: 0,
    level: 124,
    pan: 52,
    muteGroup: 0,
    tvaDecay: 65,
    tvaRelease: 22,
    chorusSend: 0,
    reverbSend: 38
  },

  // --- CYMBALS ---
  {
    id: 'cymbal_studio_crash',
    name: 'Studio Crash 16"',
    category: 'Cymbal',
    waveGroup: 0,
    waveNumber: 638, // Crash
    coarseTune: 64,
    fineTune: 64,
    filterType: 1,
    cutoff: 127,
    resonance: 0,
    level: 127,
    pan: 48,
    muteGroup: 0,
    tvaDecay: 100,
    tvaRelease: 65,
    chorusSend: 0,
    reverbSend: 45
  },
  {
    id: 'cymbal_ride_bell',
    name: 'Ride Cymbal Bell',
    category: 'Cymbal',
    waveGroup: 0,
    waveNumber: 638,
    coarseTune: 69,
    fineTune: 64,
    filterType: 1,
    cutoff: 127,
    resonance: 0,
    level: 125,
    pan: 76,
    muteGroup: 0,
    tvaDecay: 90,
    tvaRelease: 50,
    chorusSend: 0,
    reverbSend: 40
  },

  // --- LATIN & PERCUSSION ---
  {
    id: 'perc_bongo_high',
    name: 'High Bongo Slap',
    category: 'Latin',
    waveGroup: 0,
    waveNumber: 485,
    coarseTune: 72,
    fineTune: 64,
    filterType: 1,
    cutoff: 127,
    resonance: 0,
    level: 120,
    pan: 56,
    muteGroup: 0,
    tvaDecay: 45,
    tvaRelease: 18,
    chorusSend: 0,
    reverbSend: 30
  },
  {
    id: 'perc_conga_open',
    name: 'Open High Conga',
    category: 'Latin',
    waveGroup: 0,
    waveNumber: 485,
    coarseTune: 64,
    fineTune: 64,
    filterType: 1,
    cutoff: 127,
    resonance: 0,
    level: 122,
    pan: 68,
    muteGroup: 2,
    tvaDecay: 60,
    tvaRelease: 25,
    chorusSend: 0,
    reverbSend: 35
  },
  {
    id: 'perc_cowbell_mambo',
    name: 'Mambo Cowbell',
    category: 'Perc',
    waveGroup: 0,
    waveNumber: 503, // JD Cowbell
    coarseTune: 64,
    fineTune: 64,
    filterType: 1,
    cutoff: 127,
    resonance: 0,
    level: 120,
    pan: 60,
    muteGroup: 0,
    tvaDecay: 50,
    tvaRelease: 20,
    chorusSend: 0,
    reverbSend: 30
  },

  // --- SOUND FX ---
  {
    id: 'fx_vinyl_scratch',
    name: 'Vinyl Scratch FX',
    category: 'FX',
    waveGroup: 0,
    waveNumber: 588, // Scratch 1
    coarseTune: 64,
    fineTune: 64,
    filterType: 1,
    cutoff: 127,
    resonance: 0,
    level: 127,
    pan: 64,
    muteGroup: 0,
    tvaDecay: 55,
    tvaRelease: 20,
    chorusSend: 15,
    reverbSend: 20
  }
];

/**
 * Calculate the 4-byte SysEx address for an individual Rhythm Key.
 * Roland Table 1-4-2:
 * Rhythm Tone Key #21 (A0) base offset = 0x00 10 00.
 * Each note steps by 0x02 00.
 * 
 * In Single Rhythm mode, base is 0x10 00 40 00.
 * In 16-Part Performance mode (Part 10), base is 0x14 70 00 00.
 * 
 * @param {number} noteNumber - MIDI note number (35 to 98)
 * @param {boolean} isPerformanceMode - true if Performance mode (Part 10)
 * @returns {Array<number>} 4-byte address
 */
export function getRhythmKeyAddress(noteNumber, isPerformanceMode = true) {
  if (noteNumber < 21 || noteNumber > 108) {
    throw new Error(`Rhythm key note must be 21-108, got ${noteNumber}`);
  }

  // Base address
  const base = isPerformanceMode ? [0x14, 0x70, 0x00, 0x00] : [0x10, 0x00, 0x40, 0x00];

  // Offset from Key 21: (noteNumber - 21) * 0x02 00
  // Key 21 offset: 0x00 10 00 = 2048
  // Each note step: 0x00 02 00 = 256
  const totalOffset = 2048 + (noteNumber - 21) * 256;
  return addOffset(base, totalOffset);
}

/**
 * Rhythm Key Parameter Offsets (Table 1-4-2-5)
 */
export const RHYTHM_KEY_OFFSETS = {
  ASSIGN_TYPE:    0x0C, // 0: MULTI, 1: SINGLE
  MUTE_GROUP:     0x0D, // 0: OFF, 1-31
  LEVEL:          0x0E, // 0-127
  COARSE_TUNE:    0x0F, // 0-127 (C-1 to G9, center 64 = C4)
  FINE_TUNE:      0x10, // 14-114 (-50 to +50 cents, center 64)
  RANDOM_PITCH:   0x11, // 0-30
  PAN:            0x12, // 0-127 (L64 - 63R)
  ENV_MODE:       0x15, // 0: NO-SUS, 1: SUSTAIN
  DRY_LEVEL:      0x16, // 0-127
  CHORUS_SEND:    0x17, // 0-127
  REVERB_SEND:    0x18, // 0-127
  OUTPUT_ASSIGN:  0x1B, // 0: MFX, 1: A, 2: B, etc.
  WAVE_GROUP:     0x22, // 0: INT, 1: SR-JV80, 2: SRX, 3: SAMPLE
  WAVE_NUMBER_L:  0x27, // 4-nibble (0-16384)
  WAVE_NUMBER_R:  0x2B, // 4-nibble (0-16384)
  WAVE_GAIN:      0x2F, // 0: -6dB, 1: 0dB, 2: +6dB, 3: +12dB
  TVF_TYPE:       0x3E, // 0: OFF, 1: LPF, 2: BPF, 3: HPF, 4: PKG
  TVF_CUTOFF:     0x3F, // 0-127
  TVF_RESONANCE:  0x40, // 0-127
  TVA_DECAY:      0x48, // 0-127
  TVA_RELEASE:    0x4A  // 0-127
};

/**
 * Build DT1 message to update an individual parameter on a Rhythm Key.
 * @param {number} deviceId - Roland Device ID (0x10 - 0x1F)
 * @param {number} noteNumber - MIDI Note (35 to 98)
 * @param {number} paramOffset - Offset from RHYTHM_KEY_OFFSETS
 * @param {number|Array<number>} value - 1-byte value or array (e.g. 4 nibbles)
 * @param {boolean} isPerformanceMode
 * @returns {Uint8Array}
 */
export function buildRhythmKeyDT1(deviceId, noteNumber, paramOffset, value, isPerformanceMode = true) {
  const keyBase = getRhythmKeyAddress(noteNumber, isPerformanceMode);
  const addr = addOffset(keyBase, paramOffset);
  const data = Array.isArray(value) ? value : [value];
  return buildDT1(addr, data, deviceId);
}

/**
 * Send a parameter update for a rhythm key to the synthesizer.
 * @param {object} midi - MidiManager instance
 * @param {number} noteNumber - MIDI Note
 * @param {number} paramOffset
 * @param {number|Array<number>} value
 * @param {boolean} isPerformanceMode
 */
export async function sendRhythmKeyParam(midi, noteNumber, paramOffset, value, isPerformanceMode = true) {
  const msg = buildRhythmKeyDT1(midi.deviceId, noteNumber, paramOffset, value, isPerformanceMode);
  await midi.sendSysEx(msg);
}

/**
 * Encode 16-bit integer as 4 nibbles for Wave Number
 * @param {number} num - Wave Number (1-16384)
 * @returns {Array<number>} 4 nibbles
 */
export function encodeWaveNibbles(num) {
  return [
    (num >> 12) & 0x0F,
    (num >> 8) & 0x0F,
    (num >> 4) & 0x0F,
    num & 0x0F
  ];
}
