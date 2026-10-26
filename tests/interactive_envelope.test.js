import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { getEnvelopePoints, generateEnvelopePath } from '../src/visuals.js';

describe('Interactive Envelope Generator & Coordinate Mapping Engine', () => {
  test('getEnvelopePoints calculates 5 discrete (x, y) coordinates for TVF', () => {
    const params = { t1: 20, t2: 30, t3: 40, t4: 50, l1: 127, l2: 90, l3: 60, l4: 0 };
    const pts = getEnvelopePoints('tvf', params, 300, 75);

    assert.equal(pts.length, 5, 'Should return 5 coordinates (P0..P4)');
    // P0 starts at base
    assert.equal(pts[0].x, 10, 'P0 x should be padding 10');
    assert.equal(pts[0].y, 65, 'P0 y should be baseY (10 + 55 = 65)');

    // P1 Attack peak
    const totalT = 20 + 30 + 40 + 50; // 140
    const expectedX1 = 10 + (20 / 140) * 280; // 50
    assert.equal(Math.round(pts[1].x), Math.round(expectedX1));
    assert.equal(pts[1].y, 10, 'P1 y should be top (127 level = 10)');

    // P3 Sustain level (l3 = 60)
    // baseY (65) - (60/127)*55 ≈ 39
    assert.ok(pts[3].y > 10 && pts[3].y < 65, 'Sustain y should be between top and base');

    // P4 Release end
    assert.equal(pts[4].x, 290, 'P4 x should be pad + drawW = 290');
    assert.equal(pts[4].y, 65, 'P4 y should return to base');
  });

  test('getEnvelopePoints calculates discrete (x, y) coordinates for TVA', () => {
    const params = { t1: 15, t2: 25, t3: 35, t4: 45, l1: 100, l2: 80, l3: 50 };
    const pts = getEnvelopePoints('tva', params, 300, 75);

    assert.equal(pts.length, 5);
    assert.equal(pts[0].x, 10);
    assert.equal(pts[0].y, 65);
    // P1 level is 100 -> baseY (65) - (100/127)*55 ≈ 21.7
    assert.ok(Math.abs(pts[1].y - (65 - (100 / 127) * 55)) < 0.1);
    assert.equal(pts[4].x, 290);
    assert.equal(pts[4].y, 65);
  });

  test('getEnvelopePoints handles signed bipolar values for Pitch Envelope', () => {
    // Pitch: 64 is 0 semitones (center y = 37.5)
    // l1 = 127 (+63 semi, top y = 10)
    const ptsHigh = getEnvelopePoints('pitch', { t1: 20, t2: 20, t3: 40, t4: 40, l0: 64, l1: 127, l2: 64, l3: 64, l4: 64 }, 300, 75);
    assert.equal(ptsHigh[0].y, 37.5, 'Center level should be at midY 37.5');
    assert.equal(ptsHigh[1].y, 10, 'Peak +63 semitones should be at top y 10');

    // l1 = 1 (-63 semi, bottom y = 65)
    const ptsLow = getEnvelopePoints('pitch', { t1: 20, t2: 20, t3: 40, t4: 40, l0: 64, l1: 1, l2: 64, l3: 64, l4: 64 }, 300, 75);
    assert.equal(ptsLow[1].y, 65, 'Low -63 semitones should be at bottom y 65');
  });

  test('generateEnvelopePath precisely matches getEnvelopePoints vertices', () => {
    const params = { t1: 25, t2: 35, t3: 45, t4: 55, l1: 127, l2: 80, l3: 40, l4: 0 };
    const pathD = generateEnvelopePath('tvf', params, 300, 75);
    const pts = getEnvelopePoints('tvf', params, 300, 75);

    const expected = `M ${pts[0].x.toFixed(1)} ${pts[0].y.toFixed(1)} ` +
                     `L ${pts[1].x.toFixed(1)} ${pts[1].y.toFixed(1)} ` +
                     `L ${pts[2].x.toFixed(1)} ${pts[2].y.toFixed(1)} ` +
                     `L ${pts[3].x.toFixed(1)} ${pts[3].y.toFixed(1)} ` +
                     `L ${pts[4].x.toFixed(1)} ${pts[4].y.toFixed(1)}`;
    assert.equal(pathD, expected);
  });
});

