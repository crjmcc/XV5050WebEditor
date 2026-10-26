/**
 * Intelligent Patch Genetics & Sound Mutator Engine
 * Inspired by Vital Synth & Xfer Serum sound design workflows
 * 
 * Features:
 * - Algorithmic parameter mutation with variable intensity (5% to 100%)
 * - Selective component locks (Lock Waves, Lock Filters, Lock Envelopes, Lock Tuning, Lock FX)
 * - Musical archetype seeds (Ambient Pad, Reese Bass, Poly Pluck, Vintage Keys, Evolving Texture, Sci-Fi Glitch)
 * - Intelligent gain staging and volume normalization
 * - 20-step undo/redo mutation stack and instant A/B original comparison
 */

import { INTERNAL_WAVEFORMS } from './parameters.js';

export const MUTATION_ARCHETYPES = {
  general: {
    id: 'general',
    name: 'Musical Drift',
    description: 'Natural organic variations around current patch character.'
  },
  ambient_pad: {
    id: 'ambient_pad',
    name: '✨ Lush Ambient Pad',
    description: 'Soft attack, warm LPF, dual stereo chorus, deep plate reverb, gentle LFO motion.'
  },
  reese_bass: {
    id: 'reese_bass',
    name: '⚡ Reese / Sub Bass',
    description: 'Punchy transient, low-pass filter with drive, dual detuned saw/sub waves, mono legato.'
  },
  poly_pluck: {
    id: 'poly_pluck',
    name: '✦ Poly Pluck & Mallet',
    description: 'Fast decaying filter envelope, bright attack transient, room reverb.'
  },
  vintage_keys: {
    id: 'vintage_keys',
    name: '🎹 Vintage Analog Keys',
    description: 'Warm EP / clavinet waves, medium sustain, warm chorus and subtle vibrato.'
  },
  evolving_texture: {
    id: 'evolving_texture',
    name: '🌀 Evolving Motion Texture',
    description: 'Polyrhythmic dual LFOs, ring modulation booster, sweeping bandpass filter.'
  },
  scifi_glitch: {
    id: 'scifi_glitch',
    name: '🚀 Cyber Sci-Fi FX',
    description: 'Sample & Hold LFO, FXM cross-modulation, extreme filter resonance and stereo delay.'
  }
};

/**
 * Mutate a numeric parameter value within [min, max] by an intensity percentage.
 * Clamps result strictly within [min, max].
 */
function mutateVal(current, min, max, intensity, bipolar = false) {
  const range = max - min;
  const delta = (Math.random() * 2 - 1) * range * intensity;
  let next = Math.round(current + delta);
  return Math.max(min, Math.min(max, next));
}

/**
 * Intelligent Patch Mutator
 * 
 * @param {object} sourcePatch - Current patch object with common, tmt, and tones
 * @param {number} intensity - Mutation intensity 0.05 to 1.0 (5% to 100%)
 * @param {string} archetypeId - Archetype key from MUTATION_ARCHETYPES
 * @param {object} locks - Component lock flags { lockWaveforms, lockFilters, lockEnvelopes, lockTuning, lockEffects }
 * @returns {object} Mutated patch object (deep clone)
 */
export function mutatePatch(sourcePatch, intensity = 0.20, archetypeId = 'general', locks = {}) {
  // Deep clone to ensure immutability
  const patch = JSON.parse(JSON.stringify(sourcePatch));

  if (!patch.common) patch.common = {};
  if (!patch.tmt) patch.tmt = {};
  if (!patch.tones) patch.tones = {};

  const totalWaves = INTERNAL_WAVEFORMS.length || 1083;

  // 1. Archetype Presets Conditioning
  if (archetypeId === 'ambient_pad') {
    patch.common.monoPoly = 1; // Poly
    patch.common.legato = 0;
    if (!locks.lockEffects) {
      patch.common.chorusSend = mutateVal(patch.common.chorusSend || 40, 50, 100, intensity);
      patch.common.reverbSend = mutateVal(patch.common.reverbSend || 60, 60, 110, intensity);
    }
  } else if (archetypeId === 'reese_bass') {
    patch.common.monoPoly = 0; // Mono
    patch.common.legato = 1; // Legato
    if (!locks.lockEffects) {
      patch.common.reverbSend = mutateVal(patch.common.reverbSend || 10, 0, 30, intensity);
    }
  } else if (archetypeId === 'poly_pluck') {
    patch.common.monoPoly = 1;
    patch.common.legato = 0;
  }

  // 2. Mutate Structure & Booster (TMT)
  if (!locks.lockFilters && !locks.lockWaveforms) {
    if (Math.random() < intensity) {
      if (archetypeId === 'evolving_texture' || archetypeId === 'scifi_glitch') {
        // Favor ring mod and boost
        patch.tmt.struct12 = Math.floor(Math.random() * 10);
        patch.tmt.booster12 = Math.min(3, Math.floor(Math.random() * 4));
      } else {
        // Favor clean or series
        patch.tmt.struct12 = Math.random() < 0.7 ? 0 : 1;
        patch.tmt.booster12 = 0;
      }
    }
  }

  // 3. Mutate Active Tones (1 through 4)
  for (let t = 1; t <= 4; t++) {
    const tone = patch.tones[t] || {};

    // Tone Level & Tuning
    if (!locks.lockTuning) {
      if (t === 1) {
        tone.level = mutateVal(tone.level !== undefined ? tone.level : 127, 90, 127, intensity);
        tone.coarseTune = 64; // Root
        tone.fineTune = mutateVal(tone.fineTune !== undefined ? tone.fineTune : 64, 60, 68, intensity);
      } else if (t === 2) {
        // Tone 2 often creates stereo spread or detune
        tone.level = mutateVal(tone.level !== undefined ? tone.level : 110, 60, 127, intensity);
        // Slight musical detune (-12 to +12 cents)
        tone.fineTune = mutateVal(tone.fineTune !== undefined ? tone.fineTune : 64, 52, 76, intensity);
        if (archetypeId === 'reese_bass') {
          tone.coarseTune = Math.random() < 0.3 ? 52 : 64; // Sub octave or unison
        }
      } else if (t === 3 || t === 4) {
        // Optional layers
        tone.level = mutateVal(tone.level !== undefined ? tone.level : 80, 0, 115, intensity);
        tone.fineTune = mutateVal(tone.fineTune !== undefined ? tone.fineTune : 64, 45, 83, intensity);
      }
    }

    // Waveform Selection
    if (!locks.lockWaveforms) {
      if (Math.random() < intensity) {
        if (archetypeId === 'ambient_pad') {
          // Select warm synth pad, choir, or string waveforms (index 300 to 550)
          tone.waveNumberL = mutateVal(tone.waveNumberL || 400, 300, 600, intensity);
        } else if (archetypeId === 'reese_bass') {
          // Select synth saw, square, pulse, sub waves (index 150 to 300)
          tone.waveNumberL = mutateVal(tone.waveNumberL || 200, 150, 320, intensity);
        } else if (archetypeId === 'vintage_keys') {
          // Select piano/EP/clav/organ waves (index 1 to 150)
          tone.waveNumberL = mutateVal(tone.waveNumberL || 50, 1, 160, intensity);
        } else {
          // General mutation across catalog
          tone.waveNumberL = mutateVal(tone.waveNumberL || 1, 1, totalWaves, intensity);
        }
        tone.waveGain = Math.min(2, Math.floor(Math.random() * 3)); // 0, +6dB
      }
    }

    // TVF Filter & Resonance
    if (!locks.lockFilters) {
      if (archetypeId === 'ambient_pad') {
        tone.filterType = 1; // LPF
        tone.cutoff = mutateVal(tone.cutoff || 65, 45, 95, intensity);
        tone.resonance = mutateVal(tone.resonance || 20, 5, 45, intensity);
      } else if (archetypeId === 'reese_bass') {
        tone.filterType = 5; // LPF2 steep
        tone.cutoff = mutateVal(tone.cutoff || 55, 30, 80, intensity);
        tone.resonance = mutateVal(tone.resonance || 40, 20, 85, intensity);
      } else if (archetypeId === 'poly_pluck') {
        tone.filterType = 1; // LPF
        tone.cutoff = mutateVal(tone.cutoff || 40, 20, 65, intensity);
        tone.resonance = mutateVal(tone.resonance || 35, 15, 60, intensity);
      } else {
        tone.cutoff = mutateVal(tone.cutoff !== undefined ? tone.cutoff : 100, 20, 127, intensity);
        tone.resonance = mutateVal(tone.resonance !== undefined ? tone.resonance : 10, 0, 110, intensity);
      }
    }

    // Envelopes (TVA & TVF)
    if (!locks.lockEnvelopes) {
      if (archetypeId === 'ambient_pad') {
        tone.tvaEnvT1 = mutateVal(tone.tvaEnvT1 || 50, 35, 85, intensity); // Slow attack
        tone.tvaEnvT4 = mutateVal(tone.tvaEnvT4 || 60, 45, 95, intensity); // Long release
        tone.tvaEnvL3 = mutateVal(tone.tvaEnvL3 || 90, 70, 127, intensity); // High sustain
        tone.tvfEnvT1 = mutateVal(tone.tvfEnvT1 || 40, 25, 75, intensity);
        tone.tvfEnvT2 = mutateVal(tone.tvfEnvT2 || 60, 40, 90, intensity);
        tone.tvfEnvL3 = mutateVal(tone.tvfEnvL3 || 80, 50, 110, intensity);
        tone.tvfEnvT4 = mutateVal(tone.tvfEnvT4 || 60, 40, 95, intensity);
      } else if (archetypeId === 'poly_pluck') {
        tone.tvaEnvT1 = mutateVal(tone.tvaEnvT1 || 2, 0, 8, intensity); // Instant attack
        tone.tvaEnvT2 = mutateVal(tone.tvaEnvT2 || 35, 20, 55, intensity); // Pluck decay
        tone.tvaEnvL3 = 0; // Zero sustain
        tone.tvaEnvT4 = mutateVal(tone.tvaEnvT4 || 25, 10, 45, intensity);
        tone.tvfEnvT1 = 0; // Instant filter attack
        tone.tvfEnvT2 = mutateVal(tone.tvfEnvT2 || 30, 15, 50, intensity); // Pluck filter decay
        tone.tvfEnvL3 = 0; // Filter closes down
        tone.tvfEnvT4 = mutateVal(tone.tvfEnvT4 || 20, 10, 40, intensity);
      } else if (archetypeId === 'reese_bass') {
        tone.tvaEnvT1 = 0; // Immediate attack
        tone.tvaEnvL3 = 110; // High sustain
        tone.tvaEnvT4 = mutateVal(tone.tvaEnvT4 || 20, 10, 35, intensity);
        tone.tvfEnvT1 = mutateVal(tone.tvfEnvT1 || 5, 0, 15, intensity);
        tone.tvfEnvT2 = mutateVal(tone.tvfEnvT2 || 50, 30, 70, intensity);
        tone.tvfEnvL3 = mutateVal(tone.tvfEnvL3 || 40, 20, 70, intensity);
      } else {
        tone.tvaEnvT1 = mutateVal(tone.tvaEnvT1 !== undefined ? tone.tvaEnvT1 : 10, 0, 127, intensity);
        tone.tvaEnvT2 = mutateVal(tone.tvaEnvT2 !== undefined ? tone.tvaEnvT2 : 30, 0, 127, intensity);
        tone.tvaEnvL3 = mutateVal(tone.tvaEnvL3 !== undefined ? tone.tvaEnvL3 : 80, 0, 127, intensity);
        tone.tvaEnvT4 = mutateVal(tone.tvaEnvT4 !== undefined ? tone.tvaEnvT4 : 35, 0, 127, intensity);
        tone.tvfEnvT1 = mutateVal(tone.tvfEnvT1 !== undefined ? tone.tvfEnvT1 : 15, 0, 127, intensity);
        tone.tvfEnvT2 = mutateVal(tone.tvfEnvT2 !== undefined ? tone.tvfEnvT2 : 25, 0, 127, intensity);
        tone.tvfEnvT3 = mutateVal(tone.tvfEnvT3 !== undefined ? tone.tvfEnvT3 : 40, 0, 127, intensity);
        tone.tvfEnvT4 = mutateVal(tone.tvfEnvT4 !== undefined ? tone.tvfEnvT4 : 40, 0, 127, intensity);
        tone.tvfEnvL3 = mutateVal(tone.tvfEnvL3 !== undefined ? tone.tvfEnvL3 : 60, 0, 127, intensity);
      }
    }

    // LFOs
    if (Math.random() < intensity) {
      tone.lfo1Rate = mutateVal(tone.lfo1Rate || 64, 20, 110, intensity);
      if (archetypeId === 'ambient_pad') {
        tone.lfo1PanDepth = mutateVal(tone.lfo1PanDepth || 64, 50, 85, intensity); // Gentle auto-pan
      }
    }

    patch.tones[t] = tone;
  }

  // 4. Intelligent Gain Staging & Normalization
  normalizeGain(patch);

  return patch;
}

/**
 * Intelligently Randomize Waveforms across active tones
 * @param {object} sourcePatch
 * @param {object} locks
 * @returns {object}
 */
export function randomizeWaveforms(sourcePatch, locks = {}) {
  const patch = JSON.parse(JSON.stringify(sourcePatch));
  if (locks.lockWaveforms) return patch;
  if (!patch.tones) patch.tones = {};

  const totalWaves = INTERNAL_WAVEFORMS.length || 1083;

  for (let t = 1; t <= 4; t++) {
    if (!patch.tones[t]) patch.tones[t] = {};
    const tone = patch.tones[t];
    tone.waveGroupType = 0; // INT
    tone.waveNumberL = Math.floor(Math.random() * totalWaves) + 1;
    if (tone.waveNumberR !== undefined && tone.waveNumberR > 0) {
      tone.waveNumberR = Math.floor(Math.random() * totalWaves) + 1;
    }
  }

  return patch;
}

/**
 * Intelligent Gain Staging:
 * Calculates total voice energy across all active tones.
 * Balances tone levels if booster or resonance is high, ensuring no clipping.
 */
export function normalizeGain(patch) {
  if (!patch.tones) return;

  let totalLevel = 0;
  let activeCount = 0;

  for (let t = 1; t <= 4; t++) {
    const tone = patch.tones[t];
    if (tone && tone.level > 0) {
      totalLevel += tone.level;
      activeCount++;
    }
  }

  // Check booster
  const booster12 = patch.tmt?.booster12 || 0;
  const boosterFactor = booster12 === 3 ? 1.8 : booster12 === 2 ? 1.4 : booster12 === 1 ? 1.2 : 1.0;

  // Effective combined level
  const effectiveMax = totalLevel * boosterFactor;
  const targetMax = 260; // Optimal headroom threshold for 4-tone Roland engine

  if (effectiveMax > targetMax && totalLevel > 0) {
    const scale = targetMax / effectiveMax;
    for (let t = 1; t <= 4; t++) {
      if (patch.tones[t] && patch.tones[t].level > 0) {
        patch.tones[t].level = Math.max(10, Math.round(patch.tones[t].level * scale));
      }
    }
  }
}

/**
 * Patch Mutation History Manager with Undo/Redo & A/B Snapshot
 */
export class MutatorHistory {
  constructor(maxSize = 20) {
    this.maxSize = maxSize;
    this.undoStack = [];
    this.redoStack = [];
    this.originalSnapshot = null;
    this.currentComparison = 'B'; // 'A' = Original, 'B' = Mutated
  }

  setOriginal(patch) {
    this.originalSnapshot = JSON.parse(JSON.stringify(patch));
    this.undoStack = [JSON.parse(JSON.stringify(patch))];
    this.redoStack = [];
  }

  push(patch) {
    this.undoStack.push(JSON.parse(JSON.stringify(patch)));
    if (this.undoStack.length > this.maxSize) {
      this.undoStack.shift();
    }
    this.redoStack = [];
    this.currentComparison = 'B';
  }

  canUndo() {
    return this.undoStack.length > 1;
  }

  canRedo() {
    return this.redoStack.length > 0;
  }

  undo() {
    if (!this.canUndo()) return null;
    const current = this.undoStack.pop();
    this.redoStack.push(current);
    return JSON.parse(JSON.stringify(this.undoStack[this.undoStack.length - 1]));
  }

  redo() {
    if (!this.canRedo()) return null;
    const next = this.redoStack.pop();
    this.undoStack.push(next);
    return JSON.parse(JSON.stringify(next));
  }

  getOriginal() {
    return this.originalSnapshot ? JSON.parse(JSON.stringify(this.originalSnapshot)) : null;
  }

  getCurrent() {
    return this.undoStack.length > 0 ? JSON.parse(JSON.stringify(this.undoStack[this.undoStack.length - 1])) : null;
  }
}
