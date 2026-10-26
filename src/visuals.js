/**
 * XV-5050 Visualizer & Curve Generation Utilities
 * 
 * Provides mathematical and SVG generation functions for:
 * - Dynamic visual envelopes (Pitch, TVF Filter, TVA Amp)
 * - Filter frequency response curves with resonance peak
 * - Dual LFO waveform previews
 */

/**
 * Generate an SVG path string for Pitch, TVF, or TVA envelopes.
 * 
 * @param {'pitch'|'tvf'|'tva'} type - Envelope type
 * @param {object} params - Time and Level parameters
 * @param {number} [width=300] - SVG viewport width in pixels
 * @param {number} [height=120] - SVG viewport height in pixels
 * @returns {string} SVG path 'd' attribute
 */
export function getEnvelopePoints(type, params = {}, width = 300, height = 120) {
  const pad = 10;
  const drawW = width - pad * 2;
  const drawH = height - pad * 2;

  const t1 = Math.max(1, params.t1 ?? 20);
  const t2 = Math.max(1, params.t2 ?? 20);
  const t3 = Math.max(1, params.t3 ?? 40);
  const t4 = Math.max(1, params.t4 ?? 40);
  const totalT = t1 + t2 + t3 + t4;

  const x0 = pad;
  const x1 = pad + (t1 / totalT) * drawW;
  const x2 = x1 + (t2 / totalT) * drawW;
  const x3 = x2 + (t3 / totalT) * drawW;
  const x4 = pad + drawW;

  if (type === 'pitch') {
    // Pitch levels are signed: 1 to 127, 64 is center (0 semitones)
    const midY = pad + drawH / 2;
    const toY = (lvl) => {
      const val = (lvl ?? 64) - 64; // -63 to +63
      return midY - (val / 63) * (drawH / 2);
    };

    return [
      { x: x0, y: toY(params.l0 ?? 64) },
      { x: x1, y: toY(params.l1 ?? 64) },
      { x: x2, y: toY(params.l2 ?? 64) },
      { x: x3, y: toY(params.l3 ?? 64) },
      { x: x4, y: toY(params.l4 ?? 64) }
    ];
  }

  if (type === 'tvf') {
    // TVF levels are unipolar: 0 to 127
    const baseY = pad + drawH;
    const toY = (lvl) => baseY - ((lvl ?? 0) / 127) * drawH;

    return [
      { x: x0, y: baseY },
      { x: x1, y: toY(params.l1 ?? 127) },
      { x: x2, y: toY(params.l2 ?? 100) },
      { x: x3, y: toY(params.l3 ?? 60) },
      { x: x4, y: toY(params.l4 ?? 0) }
    ];
  }

  // TVA: Amp envelope (0 to 127), returns to 0 after T4
  const baseY = pad + drawH;
  const toY = (lvl) => baseY - ((lvl ?? 0) / 127) * drawH;

  return [
    { x: x0, y: baseY },
    { x: x1, y: toY(params.l1 ?? 127) },
    { x: x2, y: toY(params.l2 ?? 90) },
    { x: x3, y: toY(params.l3 ?? 70) },
    { x: x4, y: baseY }
  ];
}

export function generateEnvelopePath(type, params = {}, width = 300, height = 120) {
  const pts = getEnvelopePoints(type, params, width, height);
  return `M ${pts[0].x.toFixed(1)} ${pts[0].y.toFixed(1)} ` +
         `L ${pts[1].x.toFixed(1)} ${pts[1].y.toFixed(1)} ` +
         `L ${pts[2].x.toFixed(1)} ${pts[2].y.toFixed(1)} ` +
         `L ${pts[3].x.toFixed(1)} ${pts[3].y.toFixed(1)} ` +
         `L ${pts[4].x.toFixed(1)} ${pts[4].y.toFixed(1)}`;
}

/**
 * Generate an SVG path string for a Filter Frequency Response curve.
 * 
 * @param {string|number} filterType - 'OFF'|'LPF'|'BPF'|'HPF'|'PKG'|'LPF2'|'LPF3' or 0-6
 * @param {number} cutoff - 0 to 127
 * @param {number} resonance - 0 to 127
 * @param {number} [width=300] - SVG width
 * @param {number} [height=120] - SVG height
 * @returns {string} SVG path
 */
export function generateFilterCurvePath(filterType, cutoff = 64, resonance = 0, width = 300, height = 120) {
  const pad = 10;
  const drawW = width - pad * 2;
  const drawH = height - pad * 2;
  const points = [];

  const types = ['OFF', 'LPF', 'BPF', 'HPF', 'PKG', 'LPF2', 'LPF3'];
  const typeStr = typeof filterType === 'number' ? (types[filterType] || 'OFF') : String(filterType).toUpperCase();
  const cNorm = cutoff / 127;
  const rNorm = resonance / 127;

  const steps = 30;
  for (let i = 0; i <= steps; i++) {
    const x = pad + (i / steps) * drawW;
    const f = i / steps; // 0 to 1
    let gain = 1.0;

    switch (typeStr) {
      case 'OFF':
        gain = 0.8;
        break;
      case 'LPF':
      case 'LPF2':
      case 'LPF3': {
        const order = typeStr === 'LPF' ? 2 : (typeStr === 'LPF2' ? 3 : 4);
        const dist = f - cNorm;
        if (dist <= 0) {
          gain = 0.85 + (Math.exp(dist * 6) * rNorm * 0.4);
        } else {
          gain = Math.max(0.02, (0.85 + rNorm * 0.4) * Math.exp(-dist * order * 5));
        }
        break;
      }
      case 'HPF': {
        const dist = cNorm - f;
        if (dist <= 0) {
          gain = 0.85 + (Math.exp(dist * 6) * rNorm * 0.4);
        } else {
          gain = Math.max(0.02, (0.85 + rNorm * 0.4) * Math.exp(-dist * 2 * 5));
        }
        break;
      }
      case 'BPF': {
        const diff = Math.abs(f - cNorm);
        const q = 3 + rNorm * 8;
        gain = Math.max(0.02, (0.9 + rNorm * 0.3) / (1 + Math.pow(diff * q, 2)));
        break;
      }
      case 'PKG': {
        const diff = Math.abs(f - cNorm);
        gain = 0.5 + (0.5 * rNorm) / (1 + Math.pow(diff * 10, 2));
        break;
      }
      default:
        gain = 0.8;
    }

    const clampedGain = Math.min(1.2, Math.max(0, gain));
    const y = (pad + drawH) - clampedGain * (drawH * 0.8);
    points.push(`${i === 0 ? 'M' : 'L'} ${x.toFixed(1)} ${y.toFixed(1)}`);
  }

  return points.join(' ');
}

/**
 * Generate an SVG path string for an LFO waveform preview.
 * 
 * @param {string|number} waveform - 0-9 or waveform name
 * @param {number} [rate=64] - LFO rate (0-127)
 * @param {number} [width=300] - SVG width
 * @param {number} [height=100] - SVG height
 * @returns {string} SVG path
 */
export function generateLFOWavePath(waveform, rate = 64, width = 300, height = 100) {
  const pad = 10;
  const drawW = width - pad * 2;
  const drawH = height - pad * 2;
  const midY = pad + drawH / 2;
  const amp = (drawH / 2) * 0.85;

  const names = ['TRI', 'SIN', 'SAW-UP', 'SAW-DN', 'SQR', 'TRP', 'S&H', 'RND', 'STEP1', 'STEP2'];
  const waveStr = typeof waveform === 'number' ? (names[waveform] || 'TRI') : String(waveform).toUpperCase();

  const cycles = 2 + Math.floor((rate / 127) * 3);
  const steps = 60;
  const points = [];

  for (let i = 0; i <= steps; i++) {
    const x = pad + (i / steps) * drawW;
    const phase = (i / steps) * cycles * 2 * Math.PI;
    const frac = ((phase / (2 * Math.PI)) % 1);
    let val = 0;

    switch (waveStr) {
      case 'SIN':
        val = Math.sin(phase);
        break;
      case 'TRI':
        val = frac < 0.5 ? (4 * frac - 1) : (3 - 4 * frac);
        break;
      case 'SAW-UP':
        val = 2 * frac - 1;
        break;
      case 'SAW-DN':
        val = 1 - 2 * frac;
        break;
      case 'SQR':
        val = frac < 0.5 ? 1 : -1;
        break;
      case 'TRP': // Trapezoid
        if (frac < 0.25) val = frac * 4;
        else if (frac < 0.5) val = 1;
        else if (frac < 0.75) val = 1 - (frac - 0.5) * 4;
        else val = -1;
        break;
      case 'S&H':
      case 'RND':
      case 'STEP1':
      case 'STEP2': {
        const stepNum = Math.floor(frac * 4);
        val = ((stepNum * 47) % 7) / 3.5 - 1;
        break;
      }
      default:
        val = Math.sin(phase);
    }

    const y = midY - val * amp;
    points.push(`${i === 0 ? 'M' : 'L'} ${x.toFixed(1)} ${y.toFixed(1)}`);
  }

  return points.join(' ');
}
