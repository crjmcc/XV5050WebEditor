import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  mutatePatch,
  normalizeGain,
  MutatorHistory,
  MUTATION_ARCHETYPES
} from '../src/mutator.js';
import {
  calculateVectorMorphLevels,
  applyMacroToPatch,
  generateSpectrumPath,
  MACRO_DEFINITIONS
} from '../src/deep_patch.js';

describe('Patch Genetics Mutator & Deep Studio Engine', () => {
  const samplePatch = {
    common: {
      name: 'TEST SOUND',
      level: 127,
      pan: 64,
      monoPoly: 1,
      legato: 0,
      chorusSend: 40,
      reverbSend: 40
    },
    tmt: {
      struct12: 0,
      booster12: 0,
      struct34: 0,
      booster34: 0
    },
    tones: {
      1: { level: 127, pan: 64, waveNumberL: 10, cutoff: 80, resonance: 20, tvaEnvT1: 10, tvaEnvL3: 80, tvaEnvT4: 30 },
      2: { level: 100, pan: 50, waveNumberL: 12, cutoff: 80, resonance: 20, tvaEnvT1: 10, tvaEnvL3: 80, tvaEnvT4: 30 },
      3: { level: 0, pan: 64, waveNumberL: 1, cutoff: 100, resonance: 0, tvaEnvT1: 10, tvaEnvL3: 80, tvaEnvT4: 30 },
      4: { level: 0, pan: 64, waveNumberL: 1, cutoff: 100, resonance: 0, tvaEnvT1: 10, tvaEnvL3: 80, tvaEnvT4: 30 }
    }
  };

  test('MUTATION_ARCHETYPES contains key style seeds', () => {
    assert.ok(MUTATION_ARCHETYPES.ambient_pad);
    assert.ok(MUTATION_ARCHETYPES.reese_bass);
    assert.ok(MUTATION_ARCHETYPES.poly_pluck);
    assert.ok(MUTATION_ARCHETYPES.vintage_keys);
    assert.ok(MUTATION_ARCHETYPES.evolving_texture);
    assert.ok(MUTATION_ARCHETYPES.scifi_glitch);
  });

  test('mutatePatch modifies parameters while honoring locks', () => {
    // Lock waveforms and filters
    const mutated = mutatePatch(samplePatch, 0.5, 'general', {
      lockWaveforms: true,
      lockFilters: true
    });

    // Waveform and filter should be identical
    assert.equal(mutated.tones[1].waveNumberL, samplePatch.tones[1].waveNumberL);
    assert.equal(mutated.tones[1].cutoff, samplePatch.tones[1].cutoff);
    assert.equal(mutated.tones[1].resonance, samplePatch.tones[1].resonance);
  });

  test('normalizeGain scales down excessive multi-tone energy to prevent clipping', () => {
    const loudPatch = {
      tmt: { booster12: 3 }, // +18dB booster (factor 1.8)
      tones: {
        1: { level: 127 },
        2: { level: 127 },
        3: { level: 127 },
        4: { level: 127 }
      }
    };
    normalizeGain(loudPatch);
    // Combined level should have been scaled down
    const sum = loudPatch.tones[1].level + loudPatch.tones[2].level + loudPatch.tones[3].level + loudPatch.tones[4].level;
    assert.ok(sum < 508);
  });

  test('MutatorHistory manages undo/redo stack and A/B comparison', () => {
    const history = new MutatorHistory(5);
    history.setOriginal(samplePatch);

    assert.equal(history.canUndo(), false);
    assert.equal(history.canRedo(), false);

    const mut1 = mutatePatch(samplePatch, 0.2);
    history.push(mut1);
    assert.equal(history.canUndo(), true);

    const undone = history.undo();
    assert.ok(undone);
    assert.equal(history.canRedo(), true);

    const redone = history.redo();
    assert.ok(redone);
  });

  test('calculateVectorMorphLevels computes smooth 4-quadrant bilinear blending', () => {
    // Top-Left (0, 0) -> Tone 1 = 127, others = 0
    const tl = calculateVectorMorphLevels(0, 0, 127);
    assert.equal(tl.tone1, 127);
    assert.equal(tl.tone2, 0);
    assert.equal(tl.tone3, 0);
    assert.equal(tl.tone4, 0);

    // Top-Right (1, 0) -> Tone 2 = 127
    const tr = calculateVectorMorphLevels(1, 0, 127);
    assert.equal(tr.tone2, 127);
    assert.equal(tr.tone1, 0);

    // Center (0.5, 0.5) -> All 4 tones equal
    const center = calculateVectorMorphLevels(0.5, 0.5, 128);
    assert.equal(center.tone1, 32);
    assert.equal(center.tone2, 32);
    assert.equal(center.tone3, 32);
    assert.equal(center.tone4, 32);
  });

  test('applyMacroToPatch adjusts target parameters across active tones', () => {
    // Macro 1: Brightness / Cutoff
    const boostedCutoff = applyMacroToPatch(1, 127, samplePatch); // full up (+48)
    assert.ok(boostedCutoff.tones[1].cutoff > samplePatch.tones[1].cutoff);

    // Macro 2: Timbre / Resonance
    const boostedRes = applyMacroToPatch(2, 127, samplePatch);
    assert.ok(boostedRes.tones[1].resonance > samplePatch.tones[1].resonance);
  });

  test('generateSpectrumPath returns valid SVG path coordinates', () => {
    const path = generateSpectrumPath(100, 20, 1, 300, 80);
    assert.ok(path.startsWith('M '));
    assert.ok(path.includes(' L '));
  });
});

