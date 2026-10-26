/**
 * Interactive Envelope Drag Engine for Roland XV-5050 Web Editor.
 *
 * Places draggable control points directly onto the SVG envelope curves
 * (TVF Filter Envelope, TVA Amplifier Envelope, Pitch Envelope).
 *
 * Dragging control points updates:
 *   - Attack (T1), Decay 1 (T2), Decay 2 (T3), Release (T4)
 *   - Sustain (L3), TVA Level, Pitch Level 1 (L1)
 *
 * Changes are dispatched via input/change events to update sliders, rotary knobs,
 * parameter displays, and SysEx messaging in real time.
 */

import { getEnvelopePoints, generateEnvelopePath } from './visuals.js';

const ENVELOPE_CONFIGS = {
  tvf: {
    svgId: 'tvfEnvSvg',
    type: 'tvf',
    nodes: [
      {
        id: 1,
        title: 'Attack (T1)',
        paramX: 'tvfEnvT1',
        minX: 0, maxX: 127,
        format: (x) => `Attack (T1): ${x}`
      },
      {
        id: 2,
        title: 'Decay 1 (T2)',
        paramX: 'tvfEnvT2',
        minX: 0, maxX: 127,
        format: (x) => `Decay 1 (T2): ${x}`
      },
      {
        id: 3,
        title: 'Decay 2 & Sustain',
        paramX: 'tvfEnvT3',
        minX: 0, maxX: 127,
        paramY: 'tvfEnvL3',
        minY: 0, maxY: 127,
        format: (x, y) => `T3: ${x} | Sus (L3): ${y}`
      },
      {
        id: 4,
        title: 'Release (T4)',
        paramX: 'tvfEnvT4',
        minX: 0, maxX: 127,
        format: (x) => `Release (T4): ${x}`
      }
    ],
    getParams: () => ({
      t1: parseInt(document.getElementById('tvfEnvT1')?.value ?? 15, 10),
      t2: parseInt(document.getElementById('tvfEnvT2')?.value ?? 25, 10),
      t3: parseInt(document.getElementById('tvfEnvT3')?.value ?? 40, 10),
      t4: parseInt(document.getElementById('tvfEnvT4')?.value ?? 40, 10),
      l1: 127,
      l2: Math.max(
        parseInt(document.getElementById('tvfEnvL3')?.value ?? 60, 10),
        Math.round((127 + parseInt(document.getElementById('tvfEnvL3')?.value ?? 60, 10)) / 2)
      ),
      l3: parseInt(document.getElementById('tvfEnvL3')?.value ?? 60, 10),
      l4: 0
    })
  },

  tva: {
    svgId: 'tvaEnvSvg',
    type: 'tva',
    nodes: [
      {
        id: 1,
        title: 'Attack & Level',
        paramX: 'tvaEnvT1',
        minX: 0, maxX: 127,
        paramY: 'toneTvaLevel',
        minY: 0, maxY: 127,
        format: (x, y) => `Attack (T1): ${x} | Level: ${y}`
      },
      {
        id: 2,
        title: 'Decay 1 (T2)',
        paramX: 'tvaEnvT2',
        minX: 0, maxX: 127,
        format: (x) => `Decay 1 (T2): ${x}`
      },
      {
        id: 3,
        title: 'Decay 2 & Sustain',
        paramX: 'tvaEnvT3',
        minX: 0, maxX: 127,
        paramY: 'tvaEnvL3',
        minY: 0, maxY: 127,
        format: (x, y) => `T3: ${x} | Sus (L3): ${y}`
      },
      {
        id: 4,
        title: 'Release (T4)',
        paramX: 'tvaEnvT4',
        minX: 0, maxX: 127,
        format: (x) => `Release (T4): ${x}`
      }
    ],
    getParams: () => {
      const level = parseInt(document.getElementById('toneTvaLevel')?.value ?? 127, 10);
      const l3 = parseInt(document.getElementById('tvaEnvL3')?.value ?? 70, 10);
      return {
        t1: parseInt(document.getElementById('tvaEnvT1')?.value ?? 10, 10),
        t2: parseInt(document.getElementById('tvaEnvT2')?.value ?? 20, 10),
        t3: parseInt(document.getElementById('tvaEnvT3')?.value ?? 40, 10),
        t4: parseInt(document.getElementById('tvaEnvT4')?.value ?? 30, 10),
        l1: level,
        l2: Math.floor(level * 0.8),
        l3
      };
    }
  },

  pitch: {
    svgId: 'pitchEnvSvg',
    type: 'pitch',
    nodes: [
      {
        id: 1,
        title: 'Attack & Level 1',
        paramX: 'pitchEnvT1',
        minX: 0, maxX: 127,
        paramY: 'pitchEnvL1',
        minY: 1, maxY: 127,
        isSignedY: true,
        format: (x, y) => `Attack: ${x} | L1: ${y - 64}`
      },
      {
        id: 2,
        title: 'Time 2 (T2)',
        paramX: 'pitchEnvT2',
        minX: 0, maxX: 127,
        format: (x) => `Time 2 (T2): ${x}`
      },
      {
        id: 3,
        title: 'Time 3 (T3)',
        paramX: 'pitchEnvT3',
        minX: 0, maxX: 127,
        format: (x) => `Time 3 (T3): ${x}`
      },
      {
        id: 4,
        title: 'Release (T4)',
        paramX: 'pitchEnvT4',
        minX: 0, maxX: 127,
        format: (x) => `Release (T4): ${x}`
      }
    ],
    getParams: () => ({
      t1: parseInt(document.getElementById('pitchEnvT1')?.value ?? 20, 10),
      t2: parseInt(document.getElementById('pitchEnvT2')?.value ?? 20, 10),
      t3: parseInt(document.getElementById('pitchEnvT3')?.value ?? 40, 10),
      t4: parseInt(document.getElementById('pitchEnvT4')?.value ?? 40, 10),
      l0: 64,
      l1: parseInt(document.getElementById('pitchEnvL1')?.value ?? 64, 10),
      l2: 64,
      l3: 64,
      l4: 64
    })
  }
};

const SVG_NS = 'http://www.w3.org/2000/svg';

/**
 * Creates or retrieves the SVG handles layer for a given envelope SVG.
 */
function ensureHandlesLayer(svg, envKey) {
  let layer = svg.querySelector('.env-handles-layer');
  if (layer) return layer;

  layer = document.createElementNS(SVG_NS, 'g');
  layer.setAttribute('class', 'env-handles-layer');

  const config = ENVELOPE_CONFIGS[envKey];
  for (let i = 1; i <= 4; i++) {
    const nodeG = document.createElementNS(SVG_NS, 'g');
    nodeG.setAttribute('class', 'env-node');
    nodeG.setAttribute('data-env', envKey);
    nodeG.setAttribute('data-node', i);

    // Large invisible hit target circle (r=14)
    const hit = document.createElementNS(SVG_NS, 'circle');
    hit.setAttribute('class', 'env-node-hit');
    hit.setAttribute('r', '14');
    hit.setAttribute('fill', 'transparent');

    // Glowing halo (animated on hover/drag)
    const halo = document.createElementNS(SVG_NS, 'circle');
    halo.setAttribute('class', 'env-node-halo');
    halo.setAttribute('r', '8');
    halo.setAttribute('fill', 'rgba(0, 212, 255, 0.25)');
    halo.setAttribute('opacity', '0');

    // Outer ring with bright border
    const ring = document.createElementNS(SVG_NS, 'circle');
    ring.setAttribute('class', 'env-node-ring');
    ring.setAttribute('r', '5.5');
    ring.setAttribute('fill', '#040811');
    ring.setAttribute('stroke', '#00d4ff');
    ring.setAttribute('stroke-width', '2');

    // Inner glowing core
    const core = document.createElementNS(SVG_NS, 'circle');
    core.setAttribute('class', 'env-node-core');
    core.setAttribute('r', '2.5');
    core.setAttribute('fill', '#ff7b00');

    nodeG.appendChild(hit);
    nodeG.appendChild(halo);
    nodeG.appendChild(ring);
    nodeG.appendChild(core);
    layer.appendChild(nodeG);
  }

  // Floating HUD Readout (shows exact value above active handle)
  const hud = document.createElementNS(SVG_NS, 'g');
  hud.setAttribute('class', 'env-hud');
  hud.setAttribute('style', 'display: none;');

  const hudBg = document.createElementNS(SVG_NS, 'rect');
  hudBg.setAttribute('class', 'env-hud-bg');
  hudBg.setAttribute('x', '-50');
  hudBg.setAttribute('y', '-16');
  hudBg.setAttribute('width', '100');
  hudBg.setAttribute('height', '18');
  hudBg.setAttribute('rx', '4');
  hudBg.setAttribute('fill', '#040811');
  hudBg.setAttribute('stroke', '#ff7b00');
  hudBg.setAttribute('stroke-width', '1');

  const hudText = document.createElementNS(SVG_NS, 'text');
  hudText.setAttribute('class', 'env-hud-text');
  hudText.setAttribute('x', '0');
  hudText.setAttribute('y', '-4');
  hudText.setAttribute('text-anchor', 'middle');
  hudText.setAttribute('fill', '#ffb703');
  hudText.setAttribute('font-size', '8.5');
  hudText.setAttribute('font-weight', '700');
  hudText.setAttribute('font-family', 'monospace');
  hudText.textContent = '';

  hud.appendChild(hudBg);
  hud.appendChild(hudText);
  layer.appendChild(hud);

  svg.appendChild(layer);
  return layer;
}

/**
 * Synchronize the physical position of all 4 handles on an envelope SVG
 * to match the calculated mathematical envelope curve.
 *
 * @param {'tvf'|'tva'|'pitch'} envKey
 */
export function syncEnvelopeHandles(envKey) {
  const config = ENVELOPE_CONFIGS[envKey];
  if (!config) return;

  const svg = document.getElementById(config.svgId);
  if (!svg) return;

  const layer = ensureHandlesLayer(svg, envKey);
  const params = config.getParams();
  const pts = getEnvelopePoints(config.type, params, 300, 75);

  const pathEl = svg.querySelector('.curve-path');
  if (pathEl) {
    pathEl.setAttribute('d', generateEnvelopePath(config.type, params, 300, 75));
  }

  for (let i = 1; i <= 4; i++) {
    const nodeEl = layer.querySelector(`.env-node[data-node="${i}"]`);
    if (nodeEl && pts[i]) {
      nodeEl.setAttribute('transform', `translate(${pts[i].x.toFixed(1)}, ${pts[i].y.toFixed(1)})`);
    }
  }
}

/**
 * Initialize drag listeners for an envelope SVG.
 */
function bindEnvelopeDrag(envKey) {
  const config = ENVELOPE_CONFIGS[envKey];
  if (!config) return;

  const svg = document.getElementById(config.svgId);
  if (!svg) return;

  svg.classList.add('interactive-env-svg');
  const layer = ensureHandlesLayer(svg, envKey);
  const hud = layer.querySelector('.env-hud');
  const hudBg = hud?.querySelector('.env-hud-bg');
  const hudText = hud?.querySelector('.env-hud-text');

  let activeDrag = null;

  const startDrag = (e, nodeIdx) => {
    e.preventDefault();
    e.stopPropagation();

    const nodeConfig = config.nodes.find(n => n.id === nodeIdx);
    if (!nodeConfig) return;

    const nodeEl = layer.querySelector(`.env-node[data-node="${nodeIdx}"]`);
    if (nodeEl) nodeEl.classList.add('dragging');

    const inputX = nodeConfig.paramX ? document.getElementById(nodeConfig.paramX) : null;
    const inputY = nodeConfig.paramY ? document.getElementById(nodeConfig.paramY) : null;

    activeDrag = {
      nodeIdx,
      nodeConfig,
      nodeEl,
      inputX,
      inputY,
      startClientX: e.clientX,
      startClientY: e.clientY,
      startValX: inputX ? parseInt(inputX.value, 10) : 0,
      startValY: inputY ? parseInt(inputY.value, 10) : 0,
      pointerId: e.pointerId
    };

    if (e.target && typeof e.target.setPointerCapture === 'function') {
      try {
        e.target.setPointerCapture(e.pointerId);
      } catch (_) {}
    }

    updateHud(nodeConfig, activeDrag.startValX, activeDrag.startValY);
  };

  const updateHud = (nodeConfig, valX, valY) => {
    if (!hud || !hudText) return;
    const txt = nodeConfig.format(valX, valY);
    hudText.textContent = txt;

    // Dynamically size HUD background based on text width
    if (hudBg) {
      const w = Math.max(80, txt.length * 7 + 16);
      hudBg.setAttribute('width', `${w}`);
      hudBg.setAttribute('x', `${-w / 2}`);
    }

    const nodeEl = activeDrag?.nodeEl;
    if (nodeEl) {
      const transform = nodeEl.getAttribute('transform') || '';
      const match = transform.match(/translate\(([^,]+),\s*([^)]+)\)/);
      if (match) {
        const nx = parseFloat(match[1]);
        const ny = Math.max(16, parseFloat(match[2]));
        // Keep HUD clamped inside SVG horizontally
        const clampedX = Math.max(45, Math.min(255, nx));
        hud.setAttribute('transform', `translate(${clampedX.toFixed(1)}, ${(ny - 12).toFixed(1)})`);
        hud.style.display = '';
      }
    }
  };

  const onPointerMove = (e) => {
    if (!activeDrag) return;
    e.preventDefault();

    const rect = svg.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) return;

    const scaleX = 300 / rect.width;
    const scaleY = 75 / rect.height;

    const dSvgX = (e.clientX - activeDrag.startClientX) * scaleX;
    const dSvgY = (e.clientY - activeDrag.startClientY) * scaleY;

    // 130 SVG horizontal units sweeps ~127 parameter range
    const stepPerPxX = 127 / 130;
    const dValX = Math.round(dSvgX * stepPerPxX);

    let currentValX = activeDrag.startValX;
    let currentValY = activeDrag.startValY;

    if (activeDrag.inputX) {
      currentValX = Math.max(activeDrag.nodeConfig.minX, Math.min(activeDrag.nodeConfig.maxX, activeDrag.startValX + dValX));
      if (parseInt(activeDrag.inputX.value, 10) !== currentValX) {
        activeDrag.inputX.value = currentValX;
        activeDrag.inputX.dispatchEvent(new Event('input', { bubbles: true }));
      }
    }

    if (activeDrag.inputY) {
      if (activeDrag.nodeConfig.isSignedY) {
        // Pitch level: signed -63..+63 mapped to 1..127
        const stepPerPxY = 63 / 27.5;
        const dValY = Math.round(-dSvgY * stepPerPxY);
        currentValY = Math.max(activeDrag.nodeConfig.minY, Math.min(activeDrag.nodeConfig.maxY, activeDrag.startValY + dValY));
      } else {
        // 55 SVG vertical units sweeps 0 to 127
        const stepPerPxY = 127 / 55;
        const dValY = Math.round(-dSvgY * stepPerPxY);
        currentValY = Math.max(activeDrag.nodeConfig.minY, Math.min(activeDrag.nodeConfig.maxY, activeDrag.startValY + dValY));
      }

      if (parseInt(activeDrag.inputY.value, 10) !== currentValY) {
        activeDrag.inputY.value = currentValY;
        activeDrag.inputY.dispatchEvent(new Event('input', { bubbles: true }));
      }
    }

    // Sync handle positions immediately
    syncEnvelopeHandles(envKey);
    updateHud(activeDrag.nodeConfig, currentValX, currentValY);
  };

  const endDrag = (e) => {
    if (!activeDrag) return;
    if (activeDrag.nodeEl) activeDrag.nodeEl.classList.remove('dragging');

    if (activeDrag.inputX) {
      activeDrag.inputX.dispatchEvent(new Event('change', { bubbles: true }));
    }
    if (activeDrag.inputY) {
      activeDrag.inputY.dispatchEvent(new Event('change', { bubbles: true }));
    }

    if (hud) hud.style.display = 'none';
    activeDrag = null;
  };

  // Attach pointerdown to each node handle
  for (let i = 1; i <= 4; i++) {
    const nodeEl = layer.querySelector(`.env-node[data-node="${i}"]`);
    if (nodeEl) {
      nodeEl.addEventListener('pointerdown', (e) => startDrag(e, i));
    }
  }

  // Also support clicking near any node on the SVG background
  svg.addEventListener('pointerdown', (e) => {
    if (activeDrag) return;
    if (e.target.closest('.env-node')) return; // already handled by node

    const rect = svg.getBoundingClientRect();
    const clickSvgX = ((e.clientX - rect.left) / rect.width) * 300;
    const clickSvgY = ((e.clientY - rect.top) / rect.height) * 75;

    // Find closest node
    const params = config.getParams();
    const pts = getEnvelopePoints(config.type, params, 300, 75);

    let closestNode = 1;
    let minDist = Infinity;
    for (let i = 1; i <= 4; i++) {
      if (!pts[i]) continue;
      const dx = pts[i].x - clickSvgX;
      const dy = pts[i].y - clickSvgY;
      const dist = Math.sqrt(dx * dx + dy * dy);
      if (dist < minDist) {
        minDist = dist;
        closestNode = i;
      }
    }

    // If within 40 SVG units, grab that node
    if (minDist < 40) {
      startDrag(e, closestNode);
    }
  });

  window.addEventListener('pointermove', onPointerMove, { passive: false });
  window.addEventListener('pointerup', endDrag);
  window.addEventListener('pointercancel', endDrag);
}

/**
 * Initialize all interactive envelopes (TVF, TVA, Pitch).
 */
export function initInteractiveEnvelopes() {
  bindEnvelopeDrag('tvf');
  bindEnvelopeDrag('tva');
  bindEnvelopeDrag('pitch');

  // Initial handle sync
  syncAllEnvelopeHandles();
}

/**
 * Synchronize handles for all envelopes.
 */
export function syncAllEnvelopeHandles() {
  syncEnvelopeHandles('tvf');
  syncEnvelopeHandles('tva');
  syncEnvelopeHandles('pitch');
}

