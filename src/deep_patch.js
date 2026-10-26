/**
 * Deep Patch Studio Engine (Modern VST Architecture)
 * Inspired by Vital Synth and Xfer Serum
 * 
 * Features:
 * - 4 Performance Macro Knobs with real-time multi-tone parameter scaling & SysEx
 * - 4-Tone 2D Vector Morphing X-Y Pad (vector synthesis crossfading)
 * - Dynamic Harmonic Spectrum / FFT Analyzer rendering
 */

import { sendPatchToneParam } from './patch.js';

export const MACRO_DEFINITIONS = {
  1: { id: 1, name: 'BRIGHTNESS', target: 'cutoff',    color: '#00d4ff', label: 'TVF Cutoff Offset' },
  2: { id: 2, name: 'TIMBRE',     target: 'resonance', color: '#ff9f1c', label: 'Resonance & Color' },
  3: { id: 3, name: 'SPACE',      target: 'effects',   color: '#b537f2', label: 'Reverb & Chorus Send' },
  4: { id: 4, name: 'MOTION',     target: 'lfo',       color: '#10b981', label: 'LFO Speed & Depth' }
};

/**
 * Calculate 4-Tone Levels from 2D Vector Morphing X-Y Coordinates
 * Coordinates x in [0, 1] (left to right) and y in [0, 1] (top to bottom).
 * 
 * Quadrants:
 * (0, 0) = Tone 1 (Top-Left)
 * (1, 0) = Tone 2 (Top-Right)
 * (0, 1) = Tone 3 (Bottom-Left)
 * (1, 1) = Tone 4 (Bottom-Right)
 * 
 * @param {number} x - 0.0 to 1.0
 * @param {number} y - 0.0 to 1.0
 * @param {number} masterLevel - 0 to 127 (default 127)
 * @returns {object} { tone1: number, tone2: number, tone3: number, tone4: number }
 */
export function calculateVectorMorphLevels(x, y, masterLevel = 127) {
  const clampedX = Math.max(0, Math.min(1, x));
  const clampedY = Math.max(0, Math.min(1, y));

  // Inverse distance / bilinear weights
  const w1 = (1 - clampedX) * (1 - clampedY);
  const w2 = clampedX * (1 - clampedY);
  const w3 = (1 - clampedX) * clampedY;
  const w4 = clampedX * clampedY;

  return {
    tone1: Math.round(w1 * masterLevel),
    tone2: Math.round(w2 * masterLevel),
    tone3: Math.round(w3 * masterLevel),
    tone4: Math.round(w4 * masterLevel)
  };
}

/**
 * Apply Macro Offset to Patch Tones
 * @param {number} macroId - 1 to 4
 * @param {number} macroValue - -64 to +63 (center 0) or 0 to 127
 * @param {object} basePatch - original patch before macro offset
 * @returns {object} modified patch
 */
export function applyMacroToPatch(macroId, macroValue, basePatch) {
  const patch = JSON.parse(JSON.stringify(basePatch));
  if (!patch.tones) patch.tones = {};

  const normalized = (macroValue - 64) / 64; // -1.0 to +1.0

  if (macroId === 1) {
    // Macro 1: Brightness (Cutoff Offset across active tones)
    const cutoffOffset = Math.round(normalized * 48); // +/- 48 semitones / steps
    for (let t = 1; t <= 4; t++) {
      if (patch.tones[t]) {
        const baseCutoff = patch.tones[t].cutoff !== undefined ? patch.tones[t].cutoff : 100;
        patch.tones[t].cutoff = Math.max(0, Math.min(127, baseCutoff + cutoffOffset));
      }
    }
  } else if (macroId === 2) {
    // Macro 2: Timbre (Resonance Offset across active tones)
    const resOffset = Math.round(normalized * 40);
    for (let t = 1; t <= 4; t++) {
      if (patch.tones[t]) {
        const baseRes = patch.tones[t].resonance !== undefined ? patch.tones[t].resonance : 10;
        patch.tones[t].resonance = Math.max(0, Math.min(127, baseRes + resOffset));
      }
    }
  } else if (macroId === 3) {
    // Macro 3: Space (Chorus and Reverb sends)
    const sendOffset = Math.round(normalized * 45);
    if (!patch.common) patch.common = {};
    const baseCho = patch.common.chorusSend !== undefined ? patch.common.chorusSend : 40;
    const baseRev = patch.common.reverbSend !== undefined ? patch.common.reverbSend : 40;
    patch.common.chorusSend = Math.max(0, Math.min(127, baseCho + sendOffset));
    patch.common.reverbSend = Math.max(0, Math.min(127, baseRev + sendOffset));
  } else if (macroId === 4) {
    // Macro 4: Motion (LFO Rates & Depths)
    const lfoOffset = Math.round(normalized * 35);
    for (let t = 1; t <= 4; t++) {
      if (patch.tones[t]) {
        const baseRate = patch.tones[t].lfo1Rate !== undefined ? patch.tones[t].lfo1Rate : 64;
        patch.tones[t].lfo1Rate = Math.max(0, Math.min(127, baseRate + lfoOffset));
      }
    }
  }

  return patch;
}

/**
 * Generate Real-Time Harmonic Spectrum Scope Data (SVG path or canvas bars)
 * Simulates FFT spectrum harmonics from tone waveform, cutoff, and resonance.
 * 
 * @param {number} cutoff - 0 to 127
 * @param {number} resonance - 0 to 127
 * @param {number} filterType - 0: OFF, 1: LPF, 2: BPF, 3: HPF, 4: PKG
 * @param {number} width - SVG canvas width
 * @param {number} height - SVG canvas height
 * @returns {string} SVG Path string `d="..."`
 */
export function generateSpectrumPath(cutoff = 100, resonance = 10, filterType = 1, width = 360, height = 90) {
  const points = [];
  const numBands = 36;
  const step = width / (numBands - 1);

  // Normalized cutoff and resonance
  const normCutoff = (cutoff / 127) * (numBands - 1);
  const normRes = (resonance / 127);

  for (let i = 0; i < numBands; i++) {
    const x = i * step;

    // Harmonic falloff (fundamental + natural rolloff)
    let amplitude = Math.exp(-i / 8);

    // Filter shape attenuation
    if (filterType === 1 || filterType === 5 || filterType === 6) {
      // Low-pass
      if (i > normCutoff) {
        const dist = i - normCutoff;
        amplitude *= Math.exp(-dist / 3);
      }
      // Resonance peak around cutoff
      const resDist = Math.abs(i - normCutoff);
      if (resDist < 4) {
        amplitude += normRes * Math.exp(-resDist * 0.8) * 0.9;
      }
    } else if (filterType === 3) {
      // High-pass
      if (i < normCutoff) {
        const dist = normCutoff - i;
        amplitude *= Math.exp(-dist / 3);
      }
      const resDist = Math.abs(i - normCutoff);
      if (resDist < 4) {
        amplitude += normRes * Math.exp(-resDist * 0.8) * 0.9;
      }
    } else if (filterType === 2) {
      // Band-pass
      const dist = Math.abs(i - normCutoff);
      amplitude *= Math.exp(-dist / 4);
      if (dist < 4) {
        amplitude += normRes * Math.exp(-dist * 0.8) * 0.9;
      }
    }

    // Clamp amplitude and invert Y coordinate for SVG
    const clampedAmp = Math.max(0.04, Math.min(1.0, amplitude));
    const y = height - (clampedAmp * (height - 12)) - 6;
    points.push({ x: Math.round(x), y: Math.round(y) });
  }

  // Build SVG path
  let path = `M ${points[0].x} ${points[0].y}`;
  for (let i = 1; i < points.length; i++) {
    path += ` L ${points[i].x} ${points[i].y}`;
  }

  return path;
}

