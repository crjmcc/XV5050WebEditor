/**
 * XV-5050 Web Editor — Main Application
 * 
 * Fully client-side Web MIDI synthesizer editor.
 * Communicates directly with hardware via Web MIDI API & SysEx.
 */

import { MidiManager } from './midi.js';
import { createStore } from './state.js';
import {
  formatParamValue,
  decodeName,
  encodeName,
  MATRIX_SOURCES,
  MATRIX_DESTINATIONS,
  MATRIX_SOURCE_LABELS,
  MATRIX_DEST_LABELS,
  LFO_WAVEFORMS,
  FILTER_TYPES,
  INTERNAL_WAVEFORMS,
  WAVE_GROUP_TYPES,
  getWaveName,
} from './parameters.js';
import {
  requestPerformanceCommon,
  requestPerformanceChorus,
  requestPerformanceReverb,
  requestPerformanceMfx,
  requestPerformancePart,
  requestPartPatchName,
  requestAllParts,
  requestEntirePerformance,
  sendPerformanceCommonParam,
  sendPerformanceChorusParam,
  sendPerformanceReverbParam,
  sendPerformanceMfxParam,
  sendSystemEqParam,
  sendPerformanceName,
  sendPartParam,
  sendSoundMode,
  requestSoundMode,
  sendActivePerformanceSelection,
  sendActivePatchSelection,
  sendPartPatchSelection,
  sendPartBankAndProgram,
  parsePerformanceCommon,
  parsePerformanceChorus,
  parsePerformanceReverb,
  parsePerformancePart,
} from './performance.js';
import {
  requestPatchCommon,
  requestPatchTMT,
  requestPatchTone,
  requestPatchMfx,
  requestPatchChorus,
  requestPatchReverb,
  requestEntirePatch,
  sendPatchCommonParam,
  sendPatchTMTParam,
  sendPatchToneParam,
  sendPatchMfxParam,
  sendPatchChorusParam,
  sendPatchReverbParam,
  sendToneSwitch,
  sendPatchName,
  sendMatrixControlParam,
  sendTMTKeyRangeParam,
  sendToneEnvelopeParam,
  sendToneLFOParam,
  parsePatchCommon,
  parsePatchTMT,
  parsePatchTone,
} from './patch.js';
import {
  MFX_CATALOG,
  MFX_CTRL_SOURCES,
  getMfxAlgorithm,
} from './mfx_data.js';
import { parseSysEx, formatSysEx, addressToString, buildDT1 } from './sysex.js';
import {
  generateEnvelopePath,
  generateFilterCurvePath,
  generateLFOWavePath,
} from './visuals.js';
import {
  exportToSyx,
  parseSyxFile,
  createPatchSyxDump,
  createPerformanceSyxDump,
} from './librarian.js';
import {
  syncEntireUnit,
  exportFullUnitBackup,
  importFullUnitBackup,
  requestUserPerformanceHeader,
  requestUserPatchHeader,
} from './unit_sync.js';
import {
  detectDeviceId,
  runHardwareDiagnostics,
  requestEntireUserPerformance,
  sendEntireUserPerformance,
  requestEntireUserPatch,
  sendEntireUserPatch,
} from './usb_hardware.js';

// =============================================================================
// Initialization
// =============================================================================

const midi = new MidiManager();
const store = createStore();

const $ = (id) => document.getElementById(id);

let currentToneIndex = 1; // 1-4
let activeAuditionTimeout = null;
let currentSoundMode = 2; // 1 = PATCH, 2 = PERFORM

// Throttled transmission helper for continuous UI sliders
const sendTimers = new Map();
function sendThrottled(key, fn, delay = 25) {
  if (sendTimers.has(key)) {
    clearTimeout(sendTimers.get(key));
  }
  const timer = setTimeout(() => {
    sendTimers.delete(key);
    fn();
  }, delay);
  sendTimers.set(key, timer);
}

// Status helpers
function setStatus(message) {
  const el = $('statusMessage');
  if (el) el.textContent = message;
}

function setDeviceInfo(text) {
  const el = $('statusDeviceInfo');
  if (el) el.textContent = text;
  const drawerEl = $('drawerDeviceInfo');
  if (drawerEl) drawerEl.textContent = text;
}

function setConnectionStatus(connected, label) {
  const dot = $('statusDot');
  const text = $('statusText');
  if (dot) dot.classList.toggle('connected', connected);
  if (text) text.textContent = label || (connected ? 'Connected' : 'Disconnected');
}

function panDisplay(value) {
  if (value === 64) return 'C';
  return value < 64 ? `L${64 - value}` : `R${value - 64}`;
}

function getDeviceId() {
  const el = $('deviceId');
  return el ? parseInt(el.value, 10) : 0x10;
}

function getSelectedPart() {
  const el = $('patchPartSelect');
  return el ? parseInt(el.value, 10) : 1;
}

function getEffectivePatchPart() {
  if (currentSoundMode === 1) {
    return 0; // Single Patch mode (Base: 1F 00 00 00)
  }
  const el = $('patchPartSelect');
  const val = el ? parseInt(el.value, 10) : 1;
  return (val >= 0 && val <= 16) ? val : 1;
}

function setSynthesizerMode(mode, sendToHardware = true) {
  currentSoundMode = mode;
  const btnPerform = $('modeBtnPerform');
  const btnPatch = $('modeBtnPatch');
  const badge = $('modeActiveBadge');
  const partSelect = $('patchPartSelect');

  if (mode === 1) {
    if (btnPatch) btnPatch.classList.add('active');
    if (btnPerform) btnPerform.classList.remove('active');
    if (badge) {
      badge.textContent = 'PATCH MODE';
      badge.className = 'mode-active-indicator mode-patch';
    }
    if (partSelect) partSelect.value = '0';
    if (sendToHardware && midi.isConnected) {
      sendSoundMode(midi, 1, getDeviceId());
      setStatus('XV-5050 switched to Single PATCH Mode');
    }
  } else {
    if (btnPerform) btnPerform.classList.add('active');
    if (btnPatch) btnPatch.classList.remove('active');
    if (badge) {
      badge.textContent = 'PERFORM MODE';
      badge.className = 'mode-active-indicator mode-perform';
    }
    if (partSelect && partSelect.value === '0') partSelect.value = '1';
    if (sendToHardware && midi.isConnected) {
      sendSoundMode(midi, 2, getDeviceId());
      setStatus('XV-5050 switched to PERFORMANCE Mode (16 Parts)');
    }
  }
}

function toggleSystemDrawer(expand) {
  const drawer = $('systemDrawer');
  const arrow = $('drawerToggleIcon');
  if (!drawer) return;
  const shouldOpen = expand !== undefined ? expand : drawer.classList.contains('collapsed');
  if (shouldOpen) {
    drawer.classList.remove('collapsed');
    if (arrow) arrow.textContent = '▴';
  } else {
    drawer.classList.add('collapsed');
    if (arrow) arrow.textContent = '▾';
  }
}


// =============================================================================
// MIDI Device Discovery & Connection
// =============================================================================

async function initMidi() {
  const hasAccess = await midi.requestAccess();
  if (!hasAccess) {
    setStatus('Web MIDI not available — use Chrome, Edge, or Opera with MIDI devices');
    return;
  }
  refreshDeviceList();

  if (!midi.sysexEnabled) {
    console.warn('Web MIDI SysEx is not enabled in this browser session');
    setStatus('⚠️ SysEx permission is not granted! Click the site settings icon in the browser address bar and enable "System exclusive messages" for this page.');
  } else {
    setStatus('MIDI access granted with SysEx enabled — select device and connect');
  }

  // Traffic listener for real-time monitor
  midi.onTraffic(handleTraffic);
}

function refreshDeviceList() {
  const inputSelect = $('midiInput');
  const outputSelect = $('midiOutput');
  if (!inputSelect || !outputSelect) return;

  inputSelect.innerHTML = '<option value="">— Select MIDI Input —</option>';
  outputSelect.innerHTML = '<option value="">— Select MIDI Output —</option>';

  const inputs = midi.getInputs();
  const outputs = midi.getOutputs();

  for (const dev of inputs) {
    const opt = document.createElement('option');
    opt.value = dev.id;
    opt.textContent = dev.name;
    if (dev.name.includes('XV-5050')) opt.selected = true;
    inputSelect.appendChild(opt);
  }

  for (const dev of outputs) {
    const opt = document.createElement('option');
    opt.value = dev.id;
    opt.textContent = dev.name;
    if (dev.name.includes('XV-5050')) opt.selected = true;
    outputSelect.appendChild(opt);
  }

  setStatus(`Found ${inputs.length} input(s), ${outputs.length} output(s)`);
}

async function connectMidi() {
  const inputId = $('midiInput').value;
  const outputId = $('midiOutput').value;

  if (!inputId || !outputId) {
    setStatus('Please select both input and output ports');
    return;
  }

  if (midi.isConnected) {
    midi.disconnect();
    setConnectionStatus(false);
    $('connectBtn').textContent = 'Connect';
    setDeviceInfo('');
    setStatus('Disconnected');
    return;
  }

  setStatus('Connecting to MIDI ports...');
  const success = await midi.connect(inputId, outputId);
  if (success) {
    setConnectionStatus(true, `${midi.inputName}`);
    $('connectBtn').textContent = 'Disconnect';
    setDeviceInfo(`${midi.inputName} ↔ ${midi.outputName}`);
    setStatus('Connected — ready to communicate');
    midi.onSysEx(handleIncomingSysEx);
    toggleSystemDrawer(false); // Roll up drawer once connected to maximize studio workspace
  } else {
    setStatus('Connection failed — verify device selection');
  }
}

// Panic (All Notes Off)
function handlePanic() {
  if (!midi.isConnected) return;
  midi.sendAllNotesOff();
  setStatus('Sent All Notes Off & Reset Controllers on all channels');
}

// Audition Note
function handleAudition() {
  if (!midi.isConnected) {
    setStatus('Connect MIDI first to audition');
    return;
  }
  const part = getEffectivePatchPart();
  let channel = 0;
  if (currentSoundMode !== 1 && part >= 1 && part <= 16) {
    const chEl = $(`partChannel${part}`);
    channel = chEl ? parseInt(chEl.value, 10) : (part - 1);
  }

  if (activeAuditionTimeout) clearTimeout(activeAuditionTimeout);

  midi.sendNoteOn(channel, 60, 100);
  setStatus(`Audition Note On: C4 (${currentSoundMode === 1 ? 'Patch Mode' : `Part ${part}`}, Ch ${channel + 1})`);

  activeAuditionTimeout = setTimeout(() => {
    midi.sendNoteOff(channel, 60);
    activeAuditionTimeout = null;
  }, 400);
}


// =============================================================================
// Real-Time SysEx Monitor
// =============================================================================

function handleTraffic(direction, bytes, timestamp) {
  const tbody = $('trafficLogBody');
  if (!tbody) return;

  const date = new Date(timestamp);
  const timeStr = date.toTimeString().split(' ')[0] + '.' + String(date.getMilliseconds()).padStart(3, '0');

  const isSysEx = bytes[0] === 0xF0;
  let cmd = isSysEx ? 'SysEx' : 'MIDI';
  let addrStr = '—';
  let sizeStr = `${bytes.length}`;

  if (isSysEx && bytes.length >= 10) {
    const cmdByte = bytes[5];
    if (cmdByte === 0x11) cmd = 'RQ1 (Read)';
    else if (cmdByte === 0x12) cmd = 'DT1 (Set)';
    addrStr = bytes.slice(6, 10).map(b => b.toString(16).toUpperCase().padStart(2, '0')).join(' ');
  } else if (!isSysEx) {
    const status = bytes[0] & 0xF0;
    if (status === 0x90) cmd = 'Note On';
    else if (status === 0x80) cmd = 'Note Off';
    else if (status === 0xB0) cmd = 'CC';
  }

  const tr = document.createElement('tr');
  tr.innerHTML = `
    <td>${timeStr}</td>
    <td><span class="log-badge ${direction.toLowerCase()}">${direction}</span></td>
    <td>${cmd}</td>
    <td style="font-family:var(--font-mono);">${addrStr}</td>
    <td>${sizeStr}</td>
    <td class="log-raw">${formatSysEx(bytes)}</td>
  `;

  tbody.insertBefore(tr, tbody.firstChild);

  // Cap log at 150 rows
  while (tbody.children.length > 150) {
    tbody.removeChild(tbody.lastChild);
  }
}

function clearLog() {
  const tbody = $('trafficLogBody');
  if (tbody) tbody.innerHTML = '';
}

// =============================================================================
// Incoming SysEx Router
// =============================================================================

function handleIncomingSysEx(parsed) {
  if (!parsed.valid) {
    setStatus(`Received invalid SysEx: ${parsed.error}`);
    return;
  }

  const addr = parsed.address;

  // Performance Common (10 00 00 00)
  if (addr[0] === 0x10 && addr[1] === 0x00 && addr[2] === 0x00 && addr[3] === 0x00) {
    const perfData = parsePerformanceCommon(parsed.data);
    updatePerformanceCommonUI(perfData);
    setStatus('Performance Common loaded');
    return;
  }

  // Performance Chorus (10 00 04 00)
  if (addr[0] === 0x10 && addr[1] === 0x00 && addr[2] === 0x04 && addr[3] === 0x00) {
    const choData = parsePerformanceChorus(parsed.data);
    updatePerformanceChorusUI(choData);
    setStatus('Performance Chorus loaded');
    return;
  }

  // Performance Reverb (10 00 06 00)
  if (addr[0] === 0x10 && addr[1] === 0x00 && addr[2] === 0x06 && addr[3] === 0x00) {
    const revData = parsePerformanceReverb(parsed.data);
    updatePerformanceReverbUI(revData);
    setStatus('Performance Reverb loaded');
    return;
  }

  // Performance Part (10 00 20 00 to 10 00 2F 00)
  if (addr[0] === 0x10 && addr[1] === 0x00 && addr[2] >= 0x20 && addr[2] <= 0x2F && addr[3] === 0x00) {
    const partNum = (addr[2] - 0x20) + 1;
    const partData = parsePerformancePart(parsed.data);
    updatePartRow(partNum, partData);
    setStatus(`Part ${partNum} loaded`);
    return;
  }

  // Patch Common (Offset 00 00 00)
  if (addr[2] === 0x00 && addr[3] === 0x00 && parsed.data.length >= 0x2B) {
    const patchData = parsePatchCommon(parsed.data);
    updatePatchCommonUI(patchData);
    setStatus(`Patch Common loaded: ${patchData.name}`);
    return;
  }

  // Patch TMT (Offset 00 10 00)
  if (addr[2] === 0x10 && addr[3] === 0x00 && parsed.data.length >= 0x21) {
    const tmtData = parsePatchTMT(parsed.data);
    updatePatchTMTUI(tmtData);
    setStatus('Patch TMT & Tone Switches loaded');
    return;
  }

  // Patch Tone (Offset 00 20/22/24/26 00)
  if (addr[2] >= 0x20 && addr[2] <= 0x26 && addr[3] === 0x00) {
    const toneNum = Math.floor((addr[2] - 0x20) / 2) + 1;
    const toneData = parsePatchTone(parsed.data);
    store.set(`patch.tones.${toneNum - 1}`, toneData);
    if (currentToneIndex === toneNum) {
      updateToneUI(toneData);
    }
    setStatus(`Tone ${toneNum} loaded`);
    return;
  }
}

// =============================================================================
// Performance Common UI
// =============================================================================

function updatePerformanceCommonUI(data) {
  $('perfName').value = data.name || '';
  $('perfSoloPart').value = data.soloPartSelect ?? 0;
  $('perfMfxCtrlCh').value = data.mfxCtrlChannel ?? 0;
  $('perfMfxASource').value = data.mfxASource ?? 0;
  if ($('perfMfxBSource')) $('perfMfxBSource').value = data.mfxBSource ?? 0;
  if ($('perfMfxCSource')) $('perfMfxCSource').value = data.mfxCSource ?? 0;
  $('perfChorusSource').value = data.chorusSource ?? 0;
  $('perfReverbSource').value = data.reverbSource ?? 0;
}

function updatePerformanceChorusUI(data) {
  $('perfChorusType').value = data.chorusType ?? 1;
  $('perfChorusLevel').value = data.chorusLevel ?? 64;
  $('perfChorusLevelVal').textContent = data.chorusLevel ?? 64;
  $('perfChorusOutputAssign').value = data.outputAssign ?? 0;
  if ($('perfChorusRate')) {
    $('perfChorusRate').value = data.rate ?? 32;
    $('perfChorusRateVal').textContent = data.rate ?? 32;
  }
  if ($('perfChorusDepth')) {
    $('perfChorusDepth').value = data.depth ?? 64;
    $('perfChorusDepthVal').textContent = data.depth ?? 64;
  }
  if ($('perfChorusRevSend')) {
    $('perfChorusRevSend').value = data.revSend ?? 0;
    $('perfChorusRevSendVal').textContent = data.revSend ?? 0;
  }
}

function updatePerformanceReverbUI(data) {
  $('perfReverbType').value = data.reverbType ?? 1;
  $('perfReverbLevel').value = data.reverbLevel ?? 64;
  $('perfReverbLevelVal').textContent = data.reverbLevel ?? 64;
  $('perfReverbOutputAssign').value = data.outputAssign ?? 0;
  if ($('perfReverbTime')) {
    $('perfReverbTime').value = data.time ?? 64;
    $('perfReverbTimeVal').textContent = data.time ?? 64;
  }
  if ($('perfReverbHfDamp')) {
    const hf = data.hfDamp ?? 17;
    $('perfReverbHfDamp').value = hf;
    $('perfReverbHfDampVal').textContent = hf === 17 ? 'BYPASS' : `${hf}`;
  }
}

function bindPerformanceCommonControls() {
  $('perfName').addEventListener('change', () => {
    if (!midi.isConnected) return;
    sendPerformanceName(midi, $('perfName').value, getDeviceId());
    setStatus('Sent performance name');
  });

  const selectBindings = [
    { el: 'perfSoloPart', param: 'SOLO_PART_SELECT' },
    { el: 'perfMfxCtrlCh', param: 'MFX_CTRL_CHANNEL' },
    { el: 'perfMfxASource', param: 'MFXA_SOURCE' },
    { el: 'perfMfxBSource', param: 'MFXB_SOURCE' },
    { el: 'perfMfxCSource', param: 'MFXC_SOURCE' },
    { el: 'perfChorusSource', param: 'CHORUS_SOURCE' },
    { el: 'perfReverbSource', param: 'REVERB_SOURCE' },
  ];

  for (const b of selectBindings) {
    const el = $(b.el);
    if (el) {
      el.addEventListener('change', () => {
        if (!midi.isConnected) return;
        sendPerformanceCommonParam(midi, b.param, parseInt(el.value, 10), getDeviceId());
      });
    }
  }

  // Chorus controls
  $('perfChorusType').addEventListener('change', () => {
    if (!midi.isConnected) return;
    sendPerformanceChorusParam(midi, 'CHORUS_TYPE', parseInt($('perfChorusType').value, 10), getDeviceId());
  });

  $('perfChorusLevel').addEventListener('input', () => {
    const val = parseInt($('perfChorusLevel').value, 10);
    $('perfChorusLevelVal').textContent = val;
    if (!midi.isConnected) return;
    sendThrottled('perfChorusLevel', () => {
      sendPerformanceChorusParam(midi, 'CHORUS_LEVEL', val, getDeviceId());
    });
  });
  $('perfChorusLevel').addEventListener('change', () => {
    if (!midi.isConnected) return;
    sendPerformanceChorusParam(midi, 'CHORUS_LEVEL', parseInt($('perfChorusLevel').value, 10), getDeviceId());
  });

  $('perfChorusOutputAssign').addEventListener('change', () => {
    if (!midi.isConnected) return;
    sendPerformanceChorusParam(midi, 'OUTPUT_ASSIGN', parseInt($('perfChorusOutputAssign').value, 10), getDeviceId());
  });

  if ($('perfChorusRate')) {
    $('perfChorusRate').addEventListener('input', () => {
      const val = parseInt($('perfChorusRate').value, 10);
      $('perfChorusRateVal').textContent = val;
      if (!midi.isConnected) return;
      sendThrottled('perfChorusRate', () => {
        sendPerformanceChorusParam(midi, 'RATE', val, getDeviceId());
      });
    });
  }

  if ($('perfChorusDepth')) {
    $('perfChorusDepth').addEventListener('input', () => {
      const val = parseInt($('perfChorusDepth').value, 10);
      $('perfChorusDepthVal').textContent = val;
      if (!midi.isConnected) return;
      sendThrottled('perfChorusDepth', () => {
        sendPerformanceChorusParam(midi, 'DEPTH', val, getDeviceId());
      });
    });
  }

  if ($('perfChorusRevSend')) {
    $('perfChorusRevSend').addEventListener('input', () => {
      const val = parseInt($('perfChorusRevSend').value, 10);
      $('perfChorusRevSendVal').textContent = val;
      if (!midi.isConnected) return;
      sendThrottled('perfChorusRevSend', () => {
        sendPerformanceChorusParam(midi, 'REV_SEND', val, getDeviceId());
      });
    });
  }

  // Reverb controls
  $('perfReverbType').addEventListener('change', () => {
    if (!midi.isConnected) return;
    sendPerformanceReverbParam(midi, 'REVERB_TYPE', parseInt($('perfReverbType').value, 10), getDeviceId());
  });

  $('perfReverbLevel').addEventListener('input', () => {
    const val = parseInt($('perfReverbLevel').value, 10);
    $('perfReverbLevelVal').textContent = val;
    if (!midi.isConnected) return;
    sendThrottled('perfReverbLevel', () => {
      sendPerformanceReverbParam(midi, 'REVERB_LEVEL', val, getDeviceId());
    });
  });
  $('perfReverbLevel').addEventListener('change', () => {
    if (!midi.isConnected) return;
    sendPerformanceReverbParam(midi, 'REVERB_LEVEL', parseInt($('perfReverbLevel').value, 10), getDeviceId());
  });

  $('perfReverbOutputAssign').addEventListener('change', () => {
    if (!midi.isConnected) return;
    sendPerformanceReverbParam(midi, 'OUTPUT_ASSIGN', parseInt($('perfReverbOutputAssign').value, 10), getDeviceId());
  });

  if ($('perfReverbTime')) {
    $('perfReverbTime').addEventListener('input', () => {
      const val = parseInt($('perfReverbTime').value, 10);
      $('perfReverbTimeVal').textContent = val;
      if (!midi.isConnected) return;
      sendThrottled('perfReverbTime', () => {
        sendPerformanceReverbParam(midi, 'TIME', val, getDeviceId());
      });
    });
  }

  if ($('perfReverbHfDamp')) {
    $('perfReverbHfDamp').addEventListener('input', () => {
      const val = parseInt($('perfReverbHfDamp').value, 10);
      $('perfReverbHfDampVal').textContent = val === 17 ? 'BYPASS' : `${val}`;
      if (!midi.isConnected) return;
      sendThrottled('perfReverbHfDamp', () => {
        sendPerformanceReverbParam(midi, 'HF_DAMP', val, getDeviceId());
      });
    });
  }

  // System 2-Band EQ controls
  if ($('sysEqBassFreq')) {
    $('sysEqBassFreq').addEventListener('change', () => {
      if (!midi.isConnected) return;
      sendSystemEqParam(midi, 'EQ1_LOW_FREQ', parseInt($('sysEqBassFreq').value, 10), getDeviceId());
    });
  }

  if ($('sysEqBassGain')) {
    $('sysEqBassGain').addEventListener('input', () => {
      const val = parseInt($('sysEqBassGain').value, 10);
      const db = val - 15;
      $('sysEqBassGainVal').textContent = (db > 0 ? `+${db}` : `${db}`) + ' dB';
      if (!midi.isConnected) return;
      sendThrottled('sysEqBassGain', () => {
        sendSystemEqParam(midi, 'EQ1_LOW_GAIN', val, getDeviceId());
      });
    });
  }

  if ($('sysEqTrebleFreq')) {
    $('sysEqTrebleFreq').addEventListener('change', () => {
      if (!midi.isConnected) return;
      sendSystemEqParam(midi, 'EQ1_HIGH_FREQ', parseInt($('sysEqTrebleFreq').value, 10), getDeviceId());
    });
  }

  if ($('sysEqTrebleGain')) {
    $('sysEqTrebleGain').addEventListener('input', () => {
      const val = parseInt($('sysEqTrebleGain').value, 10);
      const db = val - 15;
      $('sysEqTrebleGainVal').textContent = (db > 0 ? `+${db}` : `${db}`) + ' dB';
      if (!midi.isConnected) return;
      sendThrottled('sysEqTrebleGain', () => {
        sendSystemEqParam(midi, 'EQ1_HIGH_GAIN', val, getDeviceId());
      });
    });
  }
}

// =============================================================================
// Roll-Up 3-MFX Multi-Effects Architecture
// =============================================================================

let activePerfMfxSlot = 'A';
const perfMfxCache = { A: null, B: null, C: null };

function togglePerfMfxRollup(expand) {
  const card = $('perfMfxRollup');
  const arrow = $('perfMfxArrow');
  const text = $('perfMfxRollupText');
  if (!card) return;
  const shouldOpen = expand !== undefined ? expand : card.classList.contains('collapsed');
  if (shouldOpen) {
    card.classList.remove('collapsed');
    if (arrow) arrow.textContent = '▴';
    if (text) text.textContent = '▲ Roll Up';
    localStorage.setItem('xv5050_perf_mfx_collapsed', 'false');
  } else {
    card.classList.add('collapsed');
    if (arrow) arrow.textContent = '▾';
    if (text) text.textContent = '▼ Expand';
    localStorage.setItem('xv5050_perf_mfx_collapsed', 'true');
  }
}

function togglePatchEffectsRollup(expand) {
  const card = $('patchEffectsRollup');
  const arrow = $('patchEffectsArrow');
  const text = $('patchEffectsRollupText');
  if (!card) return;
  const shouldOpen = expand !== undefined ? expand : card.classList.contains('collapsed');
  if (shouldOpen) {
    card.classList.remove('collapsed');
    if (arrow) arrow.textContent = '▴';
    if (text) text.textContent = '▲ Roll Up';
    localStorage.setItem('xv5050_patch_effects_collapsed', 'false');
  } else {
    card.classList.add('collapsed');
    if (arrow) arrow.textContent = '▾';
    if (text) text.textContent = '▼ Expand';
    localStorage.setItem('xv5050_patch_effects_collapsed', 'true');
  }
}

function populateMfxDropdown(selectEl) {
  if (!selectEl) return;
  selectEl.innerHTML = '';
  const categories = {};
  MFX_CATALOG.forEach(algo => {
    const cat = algo.category || 'General';
    if (!categories[cat]) categories[cat] = [];
    categories[cat].push(algo);
  });

  for (const [catName, algos] of Object.entries(categories)) {
    const optgroup = document.createElement('optgroup');
    optgroup.label = catName;
    for (const algo of algos) {
      const opt = document.createElement('option');
      opt.value = algo.id;
      opt.textContent = algo.name;
      optgroup.appendChild(opt);
    }
    selectEl.appendChild(optgroup);
  }
}

function populateMfxCtrlSources(selectEl) {
  if (!selectEl) return;
  selectEl.innerHTML = '';
  MFX_CTRL_SOURCES.forEach((name, idx) => {
    const opt = document.createElement('option');
    opt.value = idx;
    opt.textContent = name;
    selectEl.appendChild(opt);
  });
}

function formatMfxParamValue(inputEl, valEl) {
  if (!inputEl || !valEl) return;
  const val = parseFloat(inputEl.value);
  if (inputEl.dataset.enumValues) {
    try {
      const enums = JSON.parse(inputEl.dataset.enumValues);
      valEl.textContent = enums[val] !== undefined ? enums[val] : val;
      return;
    } catch (_) {}
  }
  const unit = inputEl.dataset.unit || '';
  if (unit === 'dB') {
    valEl.textContent = (val > 0 ? `+${val}` : `${val}`) + ' dB';
  } else if (unit) {
    valEl.textContent = `${val} ${unit}`;
  } else {
    valEl.textContent = `${val}`;
  }
}

function updateMfxAlgorithmUI(prefix, typeId) {
  const algo = getMfxAlgorithm(typeId);
  const countBadge = $(prefix === 'perfMfx' ? 'algoParamCountBadge' : 'patchAlgoParamCountBadge');
  if (countBadge) {
    countBadge.textContent = `${algo.params.length} Parameters`;
  }

  for (let i = 1; i <= 12; i++) {
    const box = $(`${prefix}ParamBox${i}`);
    const label = $(`${prefix}ParamLabel${i}`);
    const input = $(`${prefix}Param${i}`);
    const valEl = $(`${prefix}ParamVal${i}`);
    if (!box || !label || !input) continue;

    const paramDef = algo.params[i - 1];
    if (paramDef) {
      box.classList.remove('hidden');
      label.textContent = paramDef.name;
      input.min = paramDef.min;
      input.max = paramDef.max;
      input.step = paramDef.step || 1;
      input.dataset.unit = paramDef.unit || '';
      if (paramDef.type === 'enum' && paramDef.enumValues) {
        input.dataset.enumValues = JSON.stringify(paramDef.enumValues);
      } else {
        delete input.dataset.enumValues;
      }
      formatMfxParamValue(input, valEl);
    } else {
      box.classList.add('hidden');
    }
  }

  if (prefix === 'perfMfx') {
    for (let c = 1; c <= 4; c++) {
      const assignSel = $(`perfMfxCtrl${c}Assign`);
      if (!assignSel) continue;
      const currentVal = assignSel.value;
      assignSel.innerHTML = '<option value="0">OFF</option>';
      algo.params.forEach((p, idx) => {
        const opt = document.createElement('option');
        opt.value = idx + 1;
        opt.textContent = `${idx + 1}: ${p.name}`;
        assignSel.appendChild(opt);
      });
      assignSel.value = currentVal <= algo.params.length ? currentVal : 0;
    }
  }
}

function updatePerfMfxBadges(slot, typeId) {
  const algo = getMfxAlgorithm(typeId);
  const text = algo.name;
  const slotBadge = $(`slotBadge${slot}`);
  if (slotBadge) slotBadge.textContent = text;
  const summaryChip = $(`summaryMfx${slot}`);
  if (summaryChip) summaryChip.textContent = `MFX-${slot}: ${text}`;
}

function applyPerfMfxToUI(data) {
  if (!data) return;
  const typeId = data.mfxType ?? 0;
  if ($('perfMfxType')) $('perfMfxType').value = typeId;
  if ($('perfMfxDryLevel')) {
    $('perfMfxDryLevel').value = data.dryLevel ?? 127;
    $('perfMfxDryLevelVal').textContent = data.dryLevel ?? 127;
  }
  if ($('perfMfxChorusSend')) {
    $('perfMfxChorusSend').value = data.chorusSend ?? 0;
    $('perfMfxChorusSendVal').textContent = data.chorusSend ?? 0;
  }
  if ($('perfMfxReverbSend')) {
    $('perfMfxReverbSend').value = data.reverbSend ?? 0;
    $('perfMfxReverbSendVal').textContent = data.reverbSend ?? 0;
  }
  if ($('perfMfxOutputAssign')) $('perfMfxOutputAssign').value = data.outputAssign ?? 0;

  updateMfxAlgorithmUI('perfMfx', typeId);

  if (Array.isArray(data.params)) {
    data.params.forEach((val, idx) => {
      const input = $(`perfMfxParam${idx + 1}`);
      const valEl = $(`perfMfxParamVal${idx + 1}`);
      if (input) {
        input.value = val;
        formatMfxParamValue(input, valEl);
      }
    });
  }

  for (let c = 1; c <= 4; c++) {
    const srcSel = $(`perfMfxCtrl${c}Source`);
    const sensIn = $(`perfMfxCtrl${c}Sens`);
    const sensVal = $(`perfMfxCtrl${c}SensVal`);
    const assSel = $(`perfMfxCtrl${c}Assign`);
    if (srcSel) srcSel.value = data[`ctrl${c}Source`] ?? 0;
    if (sensIn) {
      const s = data[`ctrl${c}Sens`] ?? 0;
      sensIn.value = s;
      if (sensVal) sensVal.textContent = s > 0 ? `+${s}` : `${s}`;
    }
    if (assSel) assSel.value = data[`ctrl${c}Assign`] ?? 0;
  }

  updatePerfMfxBadges(activePerfMfxSlot, typeId);
}

function setActivePerfMfxSlot(slot) {
  activePerfMfxSlot = slot.toUpperCase();
  ['A', 'B', 'C'].forEach(s => {
    const btn = $(`btnSlotMfx${s}`);
    if (btn) btn.classList.toggle('active', s === activePerfMfxSlot);
  });
  const ind = $('activeSlotIndicator');
  if (ind) {
    const addr = activePerfMfxSlot === 'A' ? '10 00 02 00' : (activePerfMfxSlot === 'B' ? '10 00 08 00' : '10 00 0A 00');
    ind.textContent = `Editing MFX-${activePerfMfxSlot} (SysEx ${addr})`;
  }

  const cached = perfMfxCache[activePerfMfxSlot];
  if (cached) {
    applyPerfMfxToUI(cached);
  } else if (midi.isConnected) {
    requestPerformanceMfx(midi, activePerfMfxSlot, getDeviceId()).then(data => {
      perfMfxCache[activePerfMfxSlot] = data;
      applyPerfMfxToUI(data);
    }).catch(e => {
      console.warn(`Could not read MFX-${activePerfMfxSlot}:`, e);
    });
  }
}

function bindPerfMfxControls() {
  populateMfxDropdown($('perfMfxType'));
  for (let c = 1; c <= 4; c++) {
    populateMfxCtrlSources($(`perfMfxCtrl${c}Source`));
  }

  const isCollapsed = localStorage.getItem('xv5050_perf_mfx_collapsed') === 'true';
  if (isCollapsed) togglePerfMfxRollup(false);

  const btnToggle = $('btnTogglePerfMfx');
  if (btnToggle) {
    btnToggle.addEventListener('click', (e) => {
      e.stopPropagation();
      togglePerfMfxRollup();
    });
  }
  const rollupHeader = $('perfMfxRollupHeader');
  if (rollupHeader) {
    rollupHeader.addEventListener('click', (e) => {
      if (e.target.closest('button') || e.target.closest('select')) return;
      togglePerfMfxRollup();
    });
  }

  ['A', 'B', 'C'].forEach(slot => {
    const btn = $(`btnSlotMfx${slot}`);
    if (btn) {
      btn.addEventListener('click', () => setActivePerfMfxSlot(slot));
    }
  });

  const btnSync = $('btnSyncActiveMfx');
  if (btnSync) {
    btnSync.addEventListener('click', async () => {
      if (!midi.isConnected) { setStatus('Not connected'); return; }
      setStatus(`Reading MFX-${activePerfMfxSlot} from XV-5050...`);
      try {
        const data = await requestPerformanceMfx(midi, activePerfMfxSlot, getDeviceId());
        perfMfxCache[activePerfMfxSlot] = data;
        applyPerfMfxToUI(data);
        setStatus(`MFX-${activePerfMfxSlot} successfully read from hardware`);
      } catch (e) {
        setStatus(`Failed reading MFX-${activePerfMfxSlot}: ${e.message}`);
      }
    });
  }

  $('perfMfxType').addEventListener('change', () => {
    const typeId = parseInt($('perfMfxType').value, 10);
    updateMfxAlgorithmUI('perfMfx', typeId);
    updatePerfMfxBadges(activePerfMfxSlot, typeId);
    if (!midi.isConnected) return;
    sendPerformanceMfxParam(midi, activePerfMfxSlot, 'MFX_TYPE', typeId, getDeviceId());
    setStatus(`MFX-${activePerfMfxSlot} Algorithm set to ${typeId}`);
  });

  $('perfMfxDryLevel').addEventListener('input', () => {
    const val = parseInt($('perfMfxDryLevel').value, 10);
    $('perfMfxDryLevelVal').textContent = val;
    if (!midi.isConnected) return;
    sendThrottled(`perfMfx${activePerfMfxSlot}DryLevel`, () => {
      sendPerformanceMfxParam(midi, activePerfMfxSlot, 'DRY_LEVEL', val, getDeviceId());
    });
  });

  $('perfMfxChorusSend').addEventListener('input', () => {
    const val = parseInt($('perfMfxChorusSend').value, 10);
    $('perfMfxChorusSendVal').textContent = val;
    if (!midi.isConnected) return;
    sendThrottled(`perfMfx${activePerfMfxSlot}ChorusSend`, () => {
      sendPerformanceMfxParam(midi, activePerfMfxSlot, 'CHORUS_SEND', val, getDeviceId());
    });
  });

  $('perfMfxReverbSend').addEventListener('input', () => {
    const val = parseInt($('perfMfxReverbSend').value, 10);
    $('perfMfxReverbSendVal').textContent = val;
    if (!midi.isConnected) return;
    sendThrottled(`perfMfx${activePerfMfxSlot}ReverbSend`, () => {
      sendPerformanceMfxParam(midi, activePerfMfxSlot, 'REVERB_SEND', val, getDeviceId());
    });
  });

  $('perfMfxOutputAssign').addEventListener('change', () => {
    const val = parseInt($('perfMfxOutputAssign').value, 10);
    if (!midi.isConnected) return;
    sendPerformanceMfxParam(midi, activePerfMfxSlot, 'OUTPUT_ASSIGN', val, getDeviceId());
  });

  for (let i = 1; i <= 12; i++) {
    const input = $(`perfMfxParam${i}`);
    const valEl = $(`perfMfxParamVal${i}`);
    if (!input) continue;
    input.addEventListener('input', () => {
      formatMfxParamValue(input, valEl);
      if (!midi.isConnected) return;
      const val = parseInt(input.value, 10);
      sendThrottled(`perfMfx${activePerfMfxSlot}Param${i}`, () => {
        sendPerformanceMfxParam(midi, activePerfMfxSlot, `PARAM_${i}`, val, getDeviceId());
      });
    });
  }

  for (let c = 1; c <= 4; c++) {
    const srcSel = $(`perfMfxCtrl${c}Source`);
    const sensIn = $(`perfMfxCtrl${c}Sens`);
    const sensVal = $(`perfMfxCtrl${c}SensVal`);
    const assSel = $(`perfMfxCtrl${c}Assign`);

    if (srcSel) {
      srcSel.addEventListener('change', () => {
        if (!midi.isConnected) return;
        sendPerformanceMfxParam(midi, activePerfMfxSlot, `MFX_CTRL_${c}_SOURCE`, parseInt(srcSel.value, 10), getDeviceId());
      });
    }
    if (sensIn) {
      sensIn.addEventListener('input', () => {
        const s = parseInt(sensIn.value, 10);
        if (sensVal) sensVal.textContent = s > 0 ? `+${s}` : `${s}`;
        if (!midi.isConnected) return;
        sendThrottled(`perfMfx${activePerfMfxSlot}Ctrl${c}Sens`, () => {
          sendPerformanceMfxParam(midi, activePerfMfxSlot, `MFX_CTRL_${c}_SENS`, s, getDeviceId());
        });
      });
    }
    if (assSel) {
      assSel.addEventListener('change', () => {
        if (!midi.isConnected) return;
        sendPerformanceMfxParam(midi, activePerfMfxSlot, `MFX_CTRL_${c}_ASSIGN`, parseInt(assSel.value, 10), getDeviceId());
      });
    }
  }

  updateMfxAlgorithmUI('perfMfx', 1);
  updatePerfMfxBadges('A', 1);
  updatePerfMfxBadges('B', 1);
  updatePerfMfxBadges('C', 1);
}

function bindPatchEffectsControls() {
  populateMfxDropdown($('patchMfxType'));

  const isCollapsed = localStorage.getItem('xv5050_patch_effects_collapsed') === 'true';
  if (isCollapsed) togglePatchEffectsRollup(false);

  const btnToggle = $('btnTogglePatchEffects');
  if (btnToggle) {
    btnToggle.addEventListener('click', (e) => {
      e.stopPropagation();
      togglePatchEffectsRollup();
    });
  }
  const rollupHeader = $('patchEffectsRollupHeader');
  if (rollupHeader) {
    rollupHeader.addEventListener('click', (e) => {
      if (e.target.closest('button') || e.target.closest('select')) return;
      togglePatchEffectsRollup();
    });
  }

  const btnSync = $('btnSyncPatchEffects');
  if (btnSync) {
    btnSync.addEventListener('click', async () => {
      if (!midi.isConnected) { setStatus('Not connected'); return; }
      const part = parseInt($('patchPartSelect')?.value || '0', 10);
      setStatus('Reading Patch Effects from XV-5050...');
      try {
        const [mfxData, choData, revData] = await Promise.all([
          requestPatchMfx(midi, part, getDeviceId()),
          requestPatchChorus(midi, part, getDeviceId()),
          requestPatchReverb(midi, part, getDeviceId()),
        ]);
        applyPatchEffectsToUI(mfxData, choData, revData);
        setStatus('Patch Effects read successfully');
      } catch (e) {
        setStatus(`Failed reading Patch Effects: ${e.message}`);
      }
    });
  }

  $('patchMfxType').addEventListener('change', () => {
    const typeId = parseInt($('patchMfxType').value, 10);
    updateMfxAlgorithmUI('patchMfx', typeId);
    const algo = getMfxAlgorithm(typeId);
    if ($('summaryPatchMfx')) $('summaryPatchMfx').textContent = `MFX: ${String(typeId).padStart(2, '0')}: ${algo.name}`;
    if (!midi.isConnected) return;
    const part = parseInt($('patchPartSelect')?.value || '0', 10);
    sendPatchMfxParam(midi, part, 'MFX_TYPE', typeId, getDeviceId());
  });

  $('patchMfxDryLevel').addEventListener('input', () => {
    const val = parseInt($('patchMfxDryLevel').value, 10);
    $('patchMfxDryLevelVal').textContent = val;
    if (!midi.isConnected) return;
    const part = parseInt($('patchPartSelect')?.value || '0', 10);
    sendThrottled('patchMfxDryLevel', () => {
      sendPatchMfxParam(midi, part, 'DRY_LEVEL', val, getDeviceId());
    });
  });

  $('patchMfxChorusSend').addEventListener('input', () => {
    const val = parseInt($('patchMfxChorusSend').value, 10);
    $('patchMfxChorusSendVal').textContent = val;
    if (!midi.isConnected) return;
    const part = parseInt($('patchPartSelect')?.value || '0', 10);
    sendThrottled('patchMfxChorusSend', () => {
      sendPatchMfxParam(midi, part, 'CHORUS_SEND', val, getDeviceId());
    });
  });

  $('patchMfxReverbSend').addEventListener('input', () => {
    const val = parseInt($('patchMfxReverbSend').value, 10);
    $('patchMfxReverbSendVal').textContent = val;
    if (!midi.isConnected) return;
    const part = parseInt($('patchPartSelect')?.value || '0', 10);
    sendThrottled('patchMfxReverbSend', () => {
      sendPatchMfxParam(midi, part, 'REVERB_SEND', val, getDeviceId());
    });
  });

  $('patchMfxOutputAssign').addEventListener('change', () => {
    const val = parseInt($('patchMfxOutputAssign').value, 10);
    if (!midi.isConnected) return;
    const part = parseInt($('patchPartSelect')?.value || '0', 10);
    sendPatchMfxParam(midi, part, 'OUTPUT_ASSIGN', val, getDeviceId());
  });

  for (let i = 1; i <= 12; i++) {
    const input = $(`patchMfxParam${i}`);
    const valEl = $(`patchMfxParamVal${i}`);
    if (!input) continue;
    input.addEventListener('input', () => {
      formatMfxParamValue(input, valEl);
      if (!midi.isConnected) return;
      const part = parseInt($('patchPartSelect')?.value || '0', 10);
      const val = parseInt(input.value, 10);
      sendThrottled(`patchMfxParam${i}`, () => {
        sendPatchMfxParam(midi, part, `PARAM_${i}`, val, getDeviceId());
      });
    });
  }

  // Patch Chorus controls
  $('patchChorusType').addEventListener('change', () => {
    if (!midi.isConnected) return;
    const part = parseInt($('patchPartSelect')?.value || '0', 10);
    sendPatchChorusParam(midi, part, 'CHORUS_TYPE', parseInt($('patchChorusType').value, 10), getDeviceId());
  });

  $('patchChorusLevel').addEventListener('input', () => {
    const val = parseInt($('patchChorusLevel').value, 10);
    $('patchChorusLevelVal').textContent = val;
    if (!midi.isConnected) return;
    const part = parseInt($('patchPartSelect')?.value || '0', 10);
    sendThrottled('patchChorusLevel', () => {
      sendPatchChorusParam(midi, part, 'CHORUS_LEVEL', val, getDeviceId());
    });
  });

  // Patch Reverb controls
  $('patchReverbType').addEventListener('change', () => {
    if (!midi.isConnected) return;
    const part = parseInt($('patchPartSelect')?.value || '0', 10);
    sendPatchReverbParam(midi, part, 'REVERB_TYPE', parseInt($('patchReverbType').value, 10), getDeviceId());
  });

  $('patchReverbLevel').addEventListener('input', () => {
    const val = parseInt($('patchReverbLevel').value, 10);
    $('patchReverbLevelVal').textContent = val;
    if (!midi.isConnected) return;
    const part = parseInt($('patchPartSelect')?.value || '0', 10);
    sendThrottled('patchReverbLevel', () => {
      sendPatchReverbParam(midi, part, 'REVERB_LEVEL', val, getDeviceId());
    });
  });

  updateMfxAlgorithmUI('patchMfx', 1);
}

function applyPatchEffectsToUI(mfxData, choData, revData) {
  if (mfxData) {
    const typeId = mfxData.mfxType ?? 0;
    if ($('patchMfxType')) $('patchMfxType').value = typeId;
    if ($('patchMfxDryLevel')) {
      $('patchMfxDryLevel').value = mfxData.dryLevel ?? 127;
      $('patchMfxDryLevelVal').textContent = mfxData.dryLevel ?? 127;
    }
    if ($('patchMfxChorusSend')) {
      $('patchMfxChorusSend').value = mfxData.chorusSend ?? 0;
      $('patchMfxChorusSendVal').textContent = mfxData.chorusSend ?? 0;
    }
    if ($('patchMfxReverbSend')) {
      $('patchMfxReverbSend').value = mfxData.reverbSend ?? 0;
      $('patchMfxReverbSendVal').textContent = mfxData.reverbSend ?? 0;
    }
    if ($('patchMfxOutputAssign')) $('patchMfxOutputAssign').value = mfxData.outputAssign ?? 0;
    updateMfxAlgorithmUI('patchMfx', typeId);
    const algo = getMfxAlgorithm(typeId);
    if ($('summaryPatchMfx')) $('summaryPatchMfx').textContent = `MFX: ${String(typeId).padStart(2, '0')}: ${algo.name}`;

    if (Array.isArray(mfxData.params)) {
      mfxData.params.forEach((val, idx) => {
        const input = $(`patchMfxParam${idx + 1}`);
        const valEl = $(`patchMfxParamVal${idx + 1}`);
        if (input) {
          input.value = val;
          formatMfxParamValue(input, valEl);
        }
      });
    }
  }

  if (choData) {
    if ($('patchChorusType')) $('patchChorusType').value = choData.chorusType ?? 1;
    if ($('patchChorusLevel')) {
      $('patchChorusLevel').value = choData.chorusLevel ?? 64;
      $('patchChorusLevelVal').textContent = choData.chorusLevel ?? 64;
    }
  }

  if (revData) {
    if ($('patchReverbType')) $('patchReverbType').value = revData.reverbType ?? 1;
    if ($('patchReverbLevel')) {
      $('patchReverbLevel').value = revData.reverbLevel ?? 64;
      $('patchReverbLevelVal').textContent = revData.reverbLevel ?? 64;
    }
  }
}

// =============================================================================
// Performance Parts Table
// =============================================================================

function buildPartsTable() {
  const tbody = $('partsTableBody');
  if (!tbody) return;
  tbody.innerHTML = '';

  for (let i = 1; i <= 16; i++) {
    const tr = document.createElement('tr');
    tr.id = `partRow${i}`;
    tr.dataset.part = i;

    tr.innerHTML = `
      <td style="font-weight:600; color:var(--text-accent);">${i}</td>
      <td>
        <label class="toggle">
          <input type="checkbox" id="partSwitch${i}" checked>
          <span class="toggle-slider"></span>
        </label>
      </td>
      <td style="min-width:210px;">
        <div style="display:flex; align-items:center; gap:6px;">
          <div style="flex:1; min-width:0;">
            <div id="partPatchName${i}" style="font-weight:600; color:var(--text-primary); text-overflow:ellipsis; overflow:hidden; white-space:nowrap; font-size:0.85rem;" title="Part ${i} Current Patch">—</div>
            <select id="partPatchSelect${i}" class="part-patch-select" style="width:100%; margin-top:3px; padding:2px 4px; font-size:0.75rem;" title="Select Instrument for Part ${i}">
              <option value="">— Choose Instrument —</option>
            </select>
          </div>
          <button class="btn btn-sm btn-primary btn-tweak-part" id="partTweak${i}" title="Tweak Part ${i} Sound in Patch & Tones Editor" style="padding:3px 7px; font-size:0.72rem; white-space:nowrap;">🎛️ Tweak</button>
        </div>
      </td>
      <td>
        <select id="partChannel${i}" style="min-width:55px;">
          ${Array.from({ length: 16 }, (_, ch) =>
            `<option value="${ch}"${ch === (i - 1) ? ' selected' : ''}>${ch + 1}</option>`
          ).join('')}
        </select>
      </td>
      <td><input type="number" id="partBankMSB${i}" min="0" max="127" value="87" style="width:48px;"></td>
      <td><input type="number" id="partBankLSB${i}" min="0" max="127" value="64" style="width:48px;"></td>
      <td><input type="number" id="partPC${i}" min="0" max="127" value="1" style="width:48px;"></td>
      <td>
        <div style="display:flex; align-items:center; gap:4px;">
          <input type="range" id="partLevel${i}" min="0" max="127" value="100" style="width:70px;">
          <span class="param-value" id="partLevelVal${i}" style="min-width:24px;">100</span>
        </div>
      </td>
      <td>
        <div style="display:flex; align-items:center; gap:4px;">
          <input type="range" id="partPan${i}" min="0" max="127" value="64" style="width:70px;">
          <span class="param-value" id="partPanVal${i}" style="min-width:24px;">C</span>
        </div>
      </td>
      <td>
        <div style="display:flex; align-items:center; gap:2px;">
          <input type="range" id="partCoarse${i}" min="16" max="112" value="64" style="width:60px;">
          <span class="param-value" id="partCoarseVal${i}" style="min-width:22px;">0</span>
        </div>
      </td>
      <td>
        <div style="display:flex; align-items:center; gap:2px;">
          <input type="range" id="partFine${i}" min="14" max="114" value="64" style="width:60px;">
          <span class="param-value" id="partFineVal${i}" style="min-width:22px;">0</span>
        </div>
      </td>
      <td><input type="number" id="partChorus${i}" min="0" max="127" value="0" style="width:45px;"></td>
      <td><input type="number" id="partReverb${i}" min="0" max="127" value="40" style="width:45px;"></td>
      <td>
        <select id="partAssign${i}" style="width:65px;">
          <option value="0">MFX</option><option value="1">A</option><option value="2">B</option>
          <option value="5">1</option><option value="6">2</option><option value="13">PAT</option>
        </select>
      </td>
      <td>
        <label class="toggle">
          <input type="checkbox" id="partMute${i}">
          <span class="toggle-slider"></span>
        </label>
      </td>
      <td style="white-space:nowrap;">
        <button class="btn btn-sm" id="partLoad${i}" title="Read Part ${i} from device">↓</button>
        <button class="btn btn-sm" id="partEditPatch${i}" title="Edit Patch for Part ${i}">✎</button>
      </td>
    `;

    tbody.appendChild(tr);
    bindPartControls(i);
  }
}

function bindPartControls(part) {
  const tr = $(`partRow${part}`);
  if (tr) {
    tr.addEventListener('click', (e) => {
      if (e.target.closest('input, select, button, label')) return;
      selectPart(part);
    });
  }

  const tweakBtn = $(`partTweak${part}`);
  if (tweakBtn) {
    tweakBtn.addEventListener('click', () => {
      selectPart(part);
      switchToTab('patch');
    });
  }

  const patchSel = $(`partPatchSelect${part}`);
  if (patchSel) {
    patchSel.addEventListener('change', (e) => {
      handleInstrumentSelection(part, e.target.value);
    });
  }

  $(`partSwitch${part}`).addEventListener('change', () => {
    if (!midi.isConnected) return;
    sendPartParam(midi, part, 'RECEIVE_SWITCH', $(`partSwitch${part}`).checked ? 1 : 0, getDeviceId());
  });

  $(`partChannel${part}`).addEventListener('change', () => {
    if (!midi.isConnected) return;
    sendPartParam(midi, part, 'RECEIVE_CHANNEL', parseInt($(`partChannel${part}`).value, 10), getDeviceId());
  });

  const handleBankPcInput = async () => {
    const msb = parseInt($(`partBankMSB${part}`).value, 10) || 0;
    const lsb = parseInt($(`partBankLSB${part}`).value, 10) || 0;
    const pc = parseInt($(`partPC${part}`).value, 10) || 1;
    const chEl = $(`partChannel${part}`);
    const ch = chEl ? parseInt(chEl.value, 10) : (part - 1);

    if (midi.isConnected) {
      sendPartBankAndProgram(midi, part, msb, lsb, pc, getDeviceId(), ch);
      setStatus(`Sent Bank ${msb}/${lsb} PC ${pc} to Part ${part} (Ch ${ch + 1})`);
      try {
        const freshName = await requestPartPatchName(midi, part, getDeviceId());
        if (freshName && freshName.trim()) {
          const nameEl = $(`partPatchName${part}`);
          if (nameEl) nameEl.textContent = freshName;
          if (syncedUnitDb?.currentPerformance?.parts?.[part - 1]) {
            syncedUnitDb.currentPerformance.parts[part - 1].patchName = freshName;
            syncedUnitDb.currentPerformance.parts[part - 1].patchBankMSB = msb;
            syncedUnitDb.currentPerformance.parts[part - 1].patchBankLSB = lsb;
            syncedUnitDb.currentPerformance.parts[part - 1].patchPC = pc;
            saveSyncedDbToStorage();
          }
          if (getSelectedPart() === part) updateActivePartUI(part);
        }
      } catch (_) {}
    }
  };

  $(`partBankMSB${part}`).addEventListener('change', handleBankPcInput);
  $(`partBankLSB${part}`).addEventListener('change', handleBankPcInput);
  $(`partPC${part}`).addEventListener('change', handleBankPcInput);

  $(`partLevel${part}`).addEventListener('input', () => {
    const val = parseInt($(`partLevel${part}`).value, 10);
    $(`partLevelVal${part}`).textContent = val;
    if (!midi.isConnected) return;
    sendThrottled(`partLevel_${part}`, () => {
      sendPartParam(midi, part, 'PART_LEVEL', val, getDeviceId());
    });
  });
  $(`partLevel${part}`).addEventListener('change', () => {
    if (!midi.isConnected) return;
    sendPartParam(midi, part, 'PART_LEVEL', parseInt($(`partLevel${part}`).value, 10), getDeviceId());
  });

  $(`partPan${part}`).addEventListener('input', () => {
    const val = parseInt($(`partPan${part}`).value, 10);
    $(`partPanVal${part}`).textContent = panDisplay(val);
    if (!midi.isConnected) return;
    sendThrottled(`partPan_${part}`, () => {
      sendPartParam(midi, part, 'PART_PAN', val, getDeviceId());
    });
  });
  $(`partPan${part}`).addEventListener('change', () => {
    if (!midi.isConnected) return;
    sendPartParam(midi, part, 'PART_PAN', parseInt($(`partPan${part}`).value, 10), getDeviceId());
  });

  $(`partCoarse${part}`).addEventListener('input', () => {
    const val = parseInt($(`partCoarse${part}`).value, 10);
    $(`partCoarseVal${part}`).textContent = val - 64;
    if (!midi.isConnected) return;
    sendThrottled(`partCoarse_${part}`, () => {
      sendPartParam(midi, part, 'COARSE_TUNE', val, getDeviceId());
    });
  });
  $(`partCoarse${part}`).addEventListener('change', () => {
    if (!midi.isConnected) return;
    sendPartParam(midi, part, 'COARSE_TUNE', parseInt($(`partCoarse${part}`).value, 10), getDeviceId());
  });

  $(`partFine${part}`).addEventListener('input', () => {
    const val = parseInt($(`partFine${part}`).value, 10);
    $(`partFineVal${part}`).textContent = val - 64;
    if (!midi.isConnected) return;
    sendThrottled(`partFine_${part}`, () => {
      sendPartParam(midi, part, 'FINE_TUNE', val, getDeviceId());
    });
  });
  $(`partFine${part}`).addEventListener('change', () => {
    if (!midi.isConnected) return;
    sendPartParam(midi, part, 'FINE_TUNE', parseInt($(`partFine${part}`).value, 10), getDeviceId());
  });

  $(`partChorus${part}`).addEventListener('change', () => {
    if (!midi.isConnected) return;
    sendPartParam(midi, part, 'CHORUS_SEND', parseInt($(`partChorus${part}`).value, 10), getDeviceId());
  });

  $(`partReverb${part}`).addEventListener('change', () => {
    if (!midi.isConnected) return;
    sendPartParam(midi, part, 'REVERB_SEND', parseInt($(`partReverb${part}`).value, 10), getDeviceId());
  });

  $(`partAssign${part}`).addEventListener('change', () => {
    if (!midi.isConnected) return;
    sendPartParam(midi, part, 'OUTPUT_ASSIGN', parseInt($(`partAssign${part}`).value, 10), getDeviceId());
  });

  $(`partMute${part}`).addEventListener('change', () => {
    const muted = $(`partMute${part}`).checked;
    $(`partRow${part}`).classList.toggle('part-muted', muted);
    if (!midi.isConnected) return;
    sendPartParam(midi, part, 'MUTE_SWITCH', muted ? 1 : 0, getDeviceId());
  });

  $(`partLoad${part}`).addEventListener('click', async () => {
    if (!midi.isConnected) { setStatus('Not connected'); return; }
    setStatus(`Loading Part ${part}...`);
    try {
      const data = await requestPerformancePart(midi, part, getDeviceId());
      updatePartRow(part, data);
      setStatus(`Part ${part} loaded`);
    } catch (e) {
      setStatus(`Failed to load Part ${part}: ${e.message}`);
    }
  });

  $(`partEditPatch${part}`).addEventListener('click', () => {
    selectPart(part);
    switchToTab('patch');
  });
}

function updatePartRow(part, data) {
  $(`partSwitch${part}`).checked = !!data.receiveSwitch;
  $(`partChannel${part}`).value = data.receiveChannel ?? (part - 1);
  $(`partBankMSB${part}`).value = data.patchBankMSB ?? 87;
  $(`partBankLSB${part}`).value = data.patchBankLSB ?? 64;
  $(`partPC${part}`).value = data.patchPC ?? 1;
  $(`partLevel${part}`).value = data.partLevel ?? 100;
  $(`partLevelVal${part}`).textContent = data.partLevel ?? 100;
  $(`partPan${part}`).value = data.partPan ?? 64;
  $(`partPanVal${part}`).textContent = panDisplay(data.partPan ?? 64);
  $(`partCoarse${part}`).value = data.coarseTune ?? 64;
  $(`partCoarseVal${part}`).textContent = (data.coarseTune ?? 64) - 64;
  $(`partFine${part}`).value = data.fineTune ?? 64;
  $(`partFineVal${part}`).textContent = (data.fineTune ?? 64) - 64;
  $(`partChorus${part}`).value = data.chorusSend ?? 0;
  $(`partReverb${part}`).value = data.reverbSend ?? 40;
  $(`partAssign${part}`).value = data.outputAssign ?? 0;
  $(`partMute${part}`).checked = !!data.muteSwitch;
  $(`partRow${part}`).classList.toggle('part-muted', !!data.muteSwitch);
  if (data.patchName) {
    const nameEl = $(`partPatchName${part}`);
    if (nameEl) {
      nameEl.textContent = data.patchName;
      nameEl.title = data.patchName;
    }
  }
  const partSelect = $(`partPatchSelect${part}`);
  if (partSelect) {
    populateInstrumentSelectOptions(partSelect, part);
  }
  const stripBtn = $(`partStripBtn${part}`);
  if (stripBtn && data.patchName) {
    stripBtn.title = `Part ${part}: ${data.patchName}`;
  }
  if (part === (getSelectedPart() || 1)) {
    const headerName = $('activePatchHeaderName');
    if (headerName && data.patchName) headerName.textContent = data.patchName;
    const patchInstSel = $('patchInstrumentSelect');
    if (patchInstSel) populateInstrumentSelectOptions(patchInstSel, part);
  }
}

const updatePartUI = updatePartRow;

// =============================================================================
// Patch & Tones UI
// =============================================================================

// =============================================================================
// Patch & Tones UI
// =============================================================================

let currentMatrixIndex = 1; // 1-4
let currentLfoIndex = 1;    // 1-2
let currentPatchCommonData = null;
let currentPatchTMTData = null;
let currentToneCache = [null, null, null, null];

function updatePatchCommonUI(data) {
  currentPatchCommonData = data;
  $('patchName').value = data.name || '';
  $('patchLevel').value = data.patchLevel ?? 127;
  $('patchLevelVal').textContent = data.patchLevel ?? 127;
  $('patchPan').value = data.patchPan ?? 64;
  $('patchPanVal').textContent = panDisplay(data.patchPan ?? 64);
  $('patchCoarseTune').value = data.coarseTune ?? 64;
  $('patchCoarseTuneVal').textContent = (data.coarseTune ?? 64) - 64;
  $('patchFineTune').value = data.fineTune ?? 64;
  $('patchFineTuneVal').textContent = (data.fineTune ?? 64) - 64;
  $('patchOctaveShift').value = data.octaveShift ?? 64;
  $('patchOctaveShiftVal').textContent = (data.octaveShift ?? 64) - 64;
  $('patchMonoPoly').value = data.monoPoly ?? 1;
  $('patchLegato').checked = !!data.legatoSwitch;
  $('patchPortamento').checked = !!data.portamentoSwitch;
  $('patchPortaTime').value = data.portamentoTime ?? 0;
  $('patchPortaTimeVal').textContent = data.portamentoTime ?? 0;
  $('patchBendUp').value = data.bendRangeUp ?? 2;
  $('patchBendDown').value = data.bendRangeDown ?? 2;
  $('patchOutputAssign').value = data.outputAssign ?? 0;

  updateMatrixUI(currentMatrixIndex);
}

function updateMatrixUI(mIdx) {
  if (!currentPatchCommonData) return;
  const data = currentPatchCommonData;
  const src = data[`matrix${mIdx}Source`] ?? 0;
  const sEl = $('matrixSource');
  if (sEl) sEl.value = src;

  for (let d = 1; d <= 4; d++) {
    const dest = data[`matrix${mIdx}Dest${d}`] ?? 0;
    const sens = data[`matrix${mIdx}Sens${d}`] ?? 64;
    const dEl = $(`matrixDest${d}`);
    const sensEl = $(`matrixSens${d}`);
    const sensValEl = $(`matrixSens${d}Val`);
    if (dEl) dEl.value = dest;
    if (sensEl) sensEl.value = sens;
    if (sensValEl) sensValEl.textContent = sens - 64;
  }
}

function updatePatchTMTUI(data) {
  currentPatchTMTData = data;
  $('struct12').value = data.structureType12 ?? 0;
  $('booster12').value = data.booster12 ?? 0;
  $('struct34').value = data.structureType34 ?? 0;
  $('booster34').value = data.booster34 ?? 0;
  $('tmtVelCtrl').value = data.tmtVelControl ?? 0;

  for (let t = 1; t <= 4; t++) {
    const sw = $(`tone${t}Switch`);
    const on = !!(data[`tone${t}Switch`]);
    sw.checked = on;
    sw.closest('.tone-switch').classList.toggle('active', on);
  }

  updateTMTZoneUI(currentToneIndex);
}

function updateTMTZoneUI(tone) {
  if (!currentPatchTMTData) return;
  const data = currentPatchTMTData;
  $('currentZoneToneLabel').textContent = `${tone}`;
  const kLow = data[`tone${tone}KeyLower`] ?? 0;
  const kUp = data[`tone${tone}KeyUpper`] ?? 127;
  const vLow = data[`tone${tone}VelLower`] ?? 1;
  const vUp = data[`tone${tone}VelUpper`] ?? 127;

  $('tmtKeyLower').value = kLow;
  $('tmtKeyLowerVal').textContent = formatKeyNote(kLow);
  $('tmtKeyUpper').value = kUp;
  $('tmtKeyUpperVal').textContent = formatKeyNote(kUp);
  $('tmtVelLower').value = vLow;
  $('tmtVelLowerVal').textContent = vLow;
  $('tmtVelUpper').value = vUp;
  $('tmtVelUpperVal').textContent = vUp;
}

function formatKeyNote(midiNote) {
  const notes = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
  const oct = Math.floor(midiNote / 12) - 1;
  return `${notes[midiNote % 12]}${oct}`;
}

function setWaveSelectValue(selectEl, value, groupType) {
  if (!selectEl) return;
  const valStr = String(value);
  let found = false;
  for (let i = 0; i < selectEl.options.length; i++) {
    if (selectEl.options[i].value === valStr) {
      selectEl.selectedIndex = i;
      found = true;
      break;
    }
  }
  if (!found) {
    const opt = document.createElement('option');
    opt.value = value;
    opt.textContent = `${value}: ${getWaveName(groupType, value)}`;
    selectEl.appendChild(opt);
    selectEl.value = value;
  }
}

function updateToneUI(data) {
  if (!data) return;
  currentToneCache[currentToneIndex - 1] = data;

  // Basic Tuning & Wave
  $('toneLevel').value = data.toneLevel ?? 127;
  $('toneLevelVal').textContent = data.toneLevel ?? 127;
  $('tonePan').value = data.tonePan ?? 64;
  $('tonePanVal').textContent = panDisplay(data.tonePan ?? 64);
  $('toneCoarseTune').value = data.coarseTune ?? 64;
  $('toneCoarseTuneVal').textContent = (data.coarseTune ?? 64) - 64;
  $('toneFineTune').value = data.fineTune ?? 64;
  $('toneFineTuneVal').textContent = (data.fineTune ?? 64) - 64;
  const grp = data.waveGroupType ?? 0;
  $('waveGroup').value = grp;
  $('waveGain').value = data.waveGain ?? 1;
  $('waveFxmSwitch').checked = !!data.fxmSwitch;
  $('waveFxmColor').value = data.fxmColor ?? 0;
  $('waveFxmDepth').value = data.fxmDepth ?? 0;
  $('waveFxmDepthVal').textContent = data.fxmDepth ?? 0;
  $('waveTempoSync').checked = !!data.waveTempoSync;

  const wNumL = data.waveNumberL ?? 1;
  const wNumR = data.waveNumberR ?? 0;
  setWaveSelectValue($('waveNumberL'), wNumL, grp);
  setWaveSelectValue($('waveNumberR'), wNumR, grp);
  const nl = $('waveNameL');
  if (nl) nl.textContent = getWaveName(grp, wNumL);
  const nr = $('waveNameR');
  if (nr) nr.textContent = wNumR === 0 ? 'OFF' : getWaveName(grp, wNumR);

  // Pitch Env
  const pDepth = data.pitchEnvDepth ?? 64;
  $('pitchEnvDepth').value = pDepth;
  $('pitchEnvDepthVal').textContent = pDepth - 64;
  $('pitchEnvT1').value = data.pitchEnvT1 ?? 20;
  $('pitchEnvT1Val').textContent = data.pitchEnvT1 ?? 20;
  $('pitchEnvT2').value = data.pitchEnvT2 ?? 20;
  $('pitchEnvT2Val').textContent = data.pitchEnvT2 ?? 20;
  $('pitchEnvT3').value = data.pitchEnvT3 ?? 40;
  $('pitchEnvT3Val').textContent = data.pitchEnvT3 ?? 40;
  $('pitchEnvT4').value = data.pitchEnvT4 ?? 40;
  $('pitchEnvT4Val').textContent = data.pitchEnvT4 ?? 40;
  $('pitchEnvL1').value = data.pitchEnvL1 ?? 64;
  $('pitchEnvL1Val').textContent = (data.pitchEnvL1 ?? 64) - 64;

  // TVF
  $('toneFilterType').value = data.tvfFilterType ?? 0;
  $('toneCutoff').value = data.tvfCutoff ?? 127;
  $('toneCutoffVal').textContent = data.tvfCutoff ?? 127;
  $('toneResonance').value = data.tvfResonance ?? 0;
  $('toneResonanceVal').textContent = data.tvfResonance ?? 0;
  const tvfDepth = data.tvfEnvDepth ?? 64;
  $('tvfEnvDepth').value = tvfDepth;
  $('tvfEnvDepthVal').textContent = tvfDepth - 64;
  $('tvfEnvT1').value = data.tvfEnvT1 ?? 15;
  $('tvfEnvT1Val').textContent = data.tvfEnvT1 ?? 15;
  $('tvfEnvT4').value = data.tvfEnvT4 ?? 40;
  $('tvfEnvT4Val').textContent = data.tvfEnvT4 ?? 40;

  // TVA
  $('toneTvaLevel').value = data.tvaLevel ?? 127;
  $('toneTvaLevelVal').textContent = data.tvaLevel ?? 127;
  $('tvaEnvT1').value = data.tvaEnvT1 ?? 10;
  $('tvaEnvT1Val').textContent = data.tvaEnvT1 ?? 10;
  $('tvaEnvT2').value = data.tvaEnvT2 ?? 20;
  $('tvaEnvT2Val').textContent = data.tvaEnvT2 ?? 20;
  $('tvaEnvT3').value = data.tvaEnvT3 ?? 40;
  $('tvaEnvT3Val').textContent = data.tvaEnvT3 ?? 40;
  $('tvaEnvT4').value = data.tvaEnvT4 ?? 30;
  $('tvaEnvT4Val').textContent = data.tvaEnvT4 ?? 30;
  $('tvaEnvL3').value = data.tvaEnvL3 ?? 70;
  $('tvaEnvL3Val').textContent = data.tvaEnvL3 ?? 70;

  // LFO
  updateToneLFOUI(currentLfoIndex);

  // Redraw all curves
  redrawAllCurves();
}

function updateToneLFOUI(lfoNum) {
  const data = currentToneCache[currentToneIndex - 1];
  if (!data) return;

  const form = data[`lfo${lfoNum}Form`] ?? 0;
  const rate = data[`lfo${lfoNum}Rate`] ?? 64;
  const pDepth = data[`lfo${lfoNum}PitchDepth`] ?? 64;
  const fDepth = data[`lfo${lfoNum}TvfDepth`] ?? 64;
  const aDepth = data[`lfo${lfoNum}TvaDepth`] ?? 64;
  const panDepth = data[`lfo${lfoNum}PanDepth`] ?? 64;

  $('lfoForm').value = form;
  $('lfoRate').value = rate;
  $('lfoRateVal').textContent = rate;
  $('lfoPitchDepth').value = pDepth;
  $('lfoPitchDepthVal').textContent = pDepth - 64;
  $('lfoTvfDepth').value = fDepth;
  $('lfoTvfDepthVal').textContent = fDepth - 64;
  $('lfoTvaDepth').value = aDepth;
  $('lfoTvaDepthVal').textContent = aDepth - 64;
  $('lfoPanDepth').value = panDepth;
  $('lfoPanDepthVal').textContent = panDepth - 64;

  redrawLFOCurve();
}

function redrawAllCurves() {
  redrawPitchEnvCurve();
  redrawFilterCurves();
  redrawTVAEnvCurve();
  redrawLFOCurve();
}

function redrawPitchEnvCurve() {
  const t1 = parseInt($('pitchEnvT1').value, 10);
  const t2 = parseInt($('pitchEnvT2').value, 10);
  const t3 = parseInt($('pitchEnvT3').value, 10);
  const t4 = parseInt($('pitchEnvT4').value, 10);
  const l1 = parseInt($('pitchEnvL1').value, 10);
  const depth = parseInt($('pitchEnvDepth').value, 10) - 64;

  const d = generateEnvelopePath('pitch', { t1, t2, t3, t4, l0: 64, l1, l2: 64, l3: 64, l4: 64 }, 300, 75);
  $('pitchEnvPath').setAttribute('d', d);
  $('pitchEnvBadge').textContent = `Depth: ${depth >= 0 ? '+' : ''}${depth} semi`;
}

function redrawFilterCurves() {
  const fType = parseInt($('toneFilterType').value, 10);
  const cutoff = parseInt($('toneCutoff').value, 10);
  const resonance = parseInt($('toneResonance').value, 10);
  const t1 = parseInt($('tvfEnvT1').value, 10);
  const t4 = parseInt($('tvfEnvT4').value, 10);

  const filterD = generateFilterCurvePath(fType, cutoff, resonance, 300, 75);
  $('filterRespPath').setAttribute('d', filterD);
  $('filterRespBadge').textContent = FILTER_TYPES[fType] || 'LPF';

  const envD = generateEnvelopePath('tvf', { t1, t2: 25, t3: 40, t4, l1: 127, l2: 90, l3: 60, l4: 0 }, 300, 75);
  $('tvfEnvPath').setAttribute('d', envD);
}

function redrawTVAEnvCurve() {
  const t1 = parseInt($('tvaEnvT1').value, 10);
  const t2 = parseInt($('tvaEnvT2').value, 10);
  const t3 = parseInt($('tvaEnvT3').value, 10);
  const t4 = parseInt($('tvaEnvT4').value, 10);
  const l3 = parseInt($('tvaEnvL3').value, 10);
  const level = parseInt($('toneTvaLevel').value, 10);

  const envD = generateEnvelopePath('tva', { t1, t2, t3, t4, l1: level, l2: Math.floor(level * 0.8), l3 }, 300, 75);
  $('tvaEnvPath').setAttribute('d', envD);
  $('tvaEnvBadge').textContent = `Level: ${level}`;
}

function redrawLFOCurve() {
  const form = parseInt($('lfoForm').value, 10);
  const rate = parseInt($('lfoRate').value, 10);
  const waveD = generateLFOWavePath(form, rate, 300, 75);
  $('lfoWavePath').setAttribute('d', waveD);
  $('lfoWaveBadge').textContent = `${LFO_WAVEFORMS[form] || 'TRI'} @ Rate ${rate}`;
}

function populateMatrixDropdowns() {
  const srcSelect = $('matrixSource');
  if (srcSelect && srcSelect.children.length === 0) {
    MATRIX_SOURCES.forEach((name, idx) => {
      const opt = document.createElement('option');
      opt.value = idx;
      opt.textContent = MATRIX_SOURCE_LABELS[name] || (name.startsWith('CC') ? `${name} (MIDI CC)` : name);
      srcSelect.appendChild(opt);
    });
  }

  for (let d = 1; d <= 4; d++) {
    const destSelect = $(`matrixDest${d}`);
    if (destSelect && destSelect.children.length === 0) {
      MATRIX_DESTINATIONS.forEach((name, idx) => {
        const opt = document.createElement('option');
        opt.value = idx;
        opt.textContent = MATRIX_DEST_LABELS[name] || name;
        destSelect.appendChild(opt);
      });
    }
  }
}

function populateWaveDropdowns() {
  const waveLSelect = $('waveNumberL');
  const waveRSelect = $('waveNumberR');

  if (waveLSelect && waveLSelect.children.length === 0) {
    INTERNAL_WAVEFORMS.forEach((name, idx) => {
      const opt = document.createElement('option');
      opt.value = idx + 1;
      opt.textContent = name;
      waveLSelect.appendChild(opt);
    });
  }

  if (waveRSelect && waveRSelect.children.length <= 1) {
    INTERNAL_WAVEFORMS.forEach((name, idx) => {
      const opt = document.createElement('option');
      opt.value = idx + 1;
      opt.textContent = name;
      waveRSelect.appendChild(opt);
    });
  }
}

function bindPatchControls() {
  const currentPart = () => getEffectivePatchPart();
  populateMatrixDropdowns();
  populateWaveDropdowns();

  $('patchName').addEventListener('change', () => {
    if (!midi.isConnected) return;
    sendPatchName(midi, currentPart(), $('patchName').value, getDeviceId());
    setStatus('Sent patch name');
  });

  const sliders = [
    { el: 'patchLevel', valEl: 'patchLevelVal', param: 'PATCH_LEVEL', format: v => v },
    { el: 'patchPan', valEl: 'patchPanVal', param: 'PATCH_PAN', format: panDisplay },
    { el: 'patchCoarseTune', valEl: 'patchCoarseTuneVal', param: 'COARSE_TUNE', format: v => v - 64 },
    { el: 'patchFineTune', valEl: 'patchFineTuneVal', param: 'FINE_TUNE', format: v => v - 64 },
    { el: 'patchOctaveShift', valEl: 'patchOctaveShiftVal', param: 'OCTAVE_SHIFT', format: v => v - 64 },
    { el: 'patchPortaTime', valEl: 'patchPortaTimeVal', param: 'PORTAMENTO_TIME', format: v => v },
  ];

  for (const s of sliders) {
    $(s.el).addEventListener('input', () => {
      const val = parseInt($(s.el).value, 10);
      $(s.valEl).textContent = s.format(val);
      if (!midi.isConnected) return;
      sendThrottled(`patch_common_${s.param}`, () => {
        sendPatchCommonParam(midi, currentPart(), s.param, val, getDeviceId());
      });
    });
    $(s.el).addEventListener('change', () => {
      const val = parseInt($(s.el).value, 10);
      if (!midi.isConnected) return;
      sendPatchCommonParam(midi, currentPart(), s.param, val, getDeviceId());
    });
  }

  $('patchLegato').addEventListener('change', () => {
    if (!midi.isConnected) return;
    sendPatchCommonParam(midi, currentPart(), 'LEGATO_SWITCH', $('patchLegato').checked ? 1 : 0, getDeviceId());
  });

  $('patchPortamento').addEventListener('change', () => {
    if (!midi.isConnected) return;
    sendPatchCommonParam(midi, currentPart(), 'PORTAMENTO_SWITCH', $('patchPortamento').checked ? 1 : 0, getDeviceId());
  });

  $('patchMonoPoly').addEventListener('change', () => {
    if (!midi.isConnected) return;
    sendPatchCommonParam(midi, currentPart(), 'MONO_POLY', parseInt($('patchMonoPoly').value, 10), getDeviceId());
  });

  $('patchOutputAssign').addEventListener('change', () => {
    if (!midi.isConnected) return;
    sendPatchCommonParam(midi, currentPart(), 'OUTPUT_ASSIGN', parseInt($('patchOutputAssign').value, 10), getDeviceId());
  });

  $('patchBendUp').addEventListener('change', () => {
    if (!midi.isConnected) return;
    sendPatchCommonParam(midi, currentPart(), 'BEND_RANGE_UP', parseInt($('patchBendUp').value, 10), getDeviceId());
  });

  $('patchBendDown').addEventListener('change', () => {
    if (!midi.isConnected) return;
    sendPatchCommonParam(midi, currentPart(), 'BEND_RANGE_DOWN', parseInt($('patchBendDown').value, 10), getDeviceId());
  });

  // Matrix Control Tab switching (Matrix 1-4)
  for (let m = 1; m <= 4; m++) {
    $(`btnMatrix${m}`).addEventListener('click', () => {
      for (let i = 1; i <= 4; i++) {
        $(`btnMatrix${i}`).classList.toggle('active', i === m);
      }
      currentMatrixIndex = m;
      updateMatrixUI(m);
    });
  }

  // Matrix Control inputs
  $('matrixSource').addEventListener('change', () => {
    const val = parseInt($('matrixSource').value, 10);
    if (currentPatchCommonData) currentPatchCommonData[`matrix${currentMatrixIndex}Source`] = val;
    if (!midi.isConnected) return;
    sendMatrixControlParam(midi, currentPart(), currentMatrixIndex, 'SOURCE', val, getDeviceId());
  });

  for (let d = 1; d <= 4; d++) {
    $(`matrixDest${d}`).addEventListener('change', () => {
      const val = parseInt($(`matrixDest${d}`).value, 10);
      if (currentPatchCommonData) currentPatchCommonData[`matrix${currentMatrixIndex}Dest${d}`] = val;
      if (!midi.isConnected) return;
      sendMatrixControlParam(midi, currentPart(), currentMatrixIndex, `DEST_${d}`, val, getDeviceId());
    });

    $(`matrixSens${d}`).addEventListener('input', () => {
      const val = parseInt($(`matrixSens${d}`).value, 10);
      $(`matrixSens${d}Val`).textContent = val - 64;
      if (currentPatchCommonData) currentPatchCommonData[`matrix${currentMatrixIndex}Sens${d}`] = val;
      if (!midi.isConnected) return;
      sendThrottled(`matrixSens_${currentMatrixIndex}_${d}`, () => {
        sendMatrixControlParam(midi, currentPart(), currentMatrixIndex, `SENS_${d}`, val, getDeviceId());
      });
    });
    $(`matrixSens${d}`).addEventListener('change', () => {
      const val = parseInt($(`matrixSens${d}`).value, 10);
      if (!midi.isConnected) return;
      sendMatrixControlParam(midi, currentPart(), currentMatrixIndex, `SENS_${d}`, val, getDeviceId());
    });
  }

  // TMT Structure & Zones controls
  $('struct12').addEventListener('change', () => {
    if (!midi.isConnected) return;
    sendPatchTMTParam(midi, currentPart(), 'STRUCTURE_TYPE_1_2', parseInt($('struct12').value, 10), getDeviceId());
  });

  $('booster12').addEventListener('change', () => {
    if (!midi.isConnected) return;
    sendPatchTMTParam(midi, currentPart(), 'BOOSTER_1_2', parseInt($('booster12').value, 10), getDeviceId());
  });

  $('struct34').addEventListener('change', () => {
    if (!midi.isConnected) return;
    sendPatchTMTParam(midi, currentPart(), 'STRUCTURE_TYPE_3_4', parseInt($('struct34').value, 10), getDeviceId());
  });

  $('booster34').addEventListener('change', () => {
    if (!midi.isConnected) return;
    sendPatchTMTParam(midi, currentPart(), 'BOOSTER_3_4', parseInt($('booster34').value, 10), getDeviceId());
  });

  $('tmtVelCtrl').addEventListener('change', () => {
    if (!midi.isConnected) return;
    sendPatchTMTParam(midi, currentPart(), 'TMT_VEL_CONTROL', parseInt($('tmtVelCtrl').value, 10), getDeviceId());
  });

  // TMT Key & Vel zones
  $('tmtKeyLower').addEventListener('input', () => {
    const val = parseInt($('tmtKeyLower').value, 10);
    $('tmtKeyLowerVal').textContent = formatKeyNote(val);
    if (!midi.isConnected) return;
    sendThrottled(`tmtKeyLower_${currentToneIndex}`, () => {
      sendTMTKeyRangeParam(midi, currentPart(), currentToneIndex, 'KEY_LOWER', val, getDeviceId());
    });
  });
  $('tmtKeyLower').addEventListener('change', () => {
    if (!midi.isConnected) return;
    sendTMTKeyRangeParam(midi, currentPart(), currentToneIndex, 'KEY_LOWER', parseInt($('tmtKeyLower').value, 10), getDeviceId());
  });

  $('tmtKeyUpper').addEventListener('input', () => {
    const val = parseInt($('tmtKeyUpper').value, 10);
    $('tmtKeyUpperVal').textContent = formatKeyNote(val);
    if (!midi.isConnected) return;
    sendThrottled(`tmtKeyUpper_${currentToneIndex}`, () => {
      sendTMTKeyRangeParam(midi, currentPart(), currentToneIndex, 'KEY_UPPER', val, getDeviceId());
    });
  });
  $('tmtKeyUpper').addEventListener('change', () => {
    if (!midi.isConnected) return;
    sendTMTKeyRangeParam(midi, currentPart(), currentToneIndex, 'KEY_UPPER', parseInt($('tmtKeyUpper').value, 10), getDeviceId());
  });

  $('tmtVelLower').addEventListener('input', () => {
    const val = parseInt($('tmtVelLower').value, 10);
    $('tmtVelLowerVal').textContent = val;
    if (!midi.isConnected) return;
    sendThrottled(`tmtVelLower_${currentToneIndex}`, () => {
      sendTMTKeyRangeParam(midi, currentPart(), currentToneIndex, 'VEL_LOWER', val, getDeviceId());
    });
  });
  $('tmtVelLower').addEventListener('change', () => {
    if (!midi.isConnected) return;
    sendTMTKeyRangeParam(midi, currentPart(), currentToneIndex, 'VEL_LOWER', parseInt($('tmtVelLower').value, 10), getDeviceId());
  });

  $('tmtVelUpper').addEventListener('input', () => {
    const val = parseInt($('tmtVelUpper').value, 10);
    $('tmtVelUpperVal').textContent = val;
    if (!midi.isConnected) return;
    sendThrottled(`tmtVelUpper_${currentToneIndex}`, () => {
      sendTMTKeyRangeParam(midi, currentPart(), currentToneIndex, 'VEL_UPPER', val, getDeviceId());
    });
  });
  $('tmtVelUpper').addEventListener('change', () => {
    if (!midi.isConnected) return;
    sendTMTKeyRangeParam(midi, currentPart(), currentToneIndex, 'VEL_UPPER', parseInt($('tmtVelUpper').value, 10), getDeviceId());
  });

  // Tone On/Off Switches
  for (let t = 1; t <= 4; t++) {
    $(`tone${t}Switch`).addEventListener('change', () => {
      const on = $(`tone${t}Switch`).checked;
      $(`tone${t}Switch`).closest('.tone-switch').classList.toggle('active', on);
      if (!midi.isConnected) return;
      sendToneSwitch(midi, currentPart(), t, on, getDeviceId());
      setStatus(`Tone ${t} ${on ? 'ON' : 'OFF'}`);
    });
  }

  // Tone Generator Tab Selectors
  for (let t = 1; t <= 4; t++) {
    $(`btnSelectTone${t}`).addEventListener('click', () => {
      for (let i = 1; i <= 4; i++) {
        $(`btnSelectTone${i}`).classList.toggle('active', i === t);
      }
      currentToneIndex = t;
      updateTMTZoneUI(t);
      const cached = currentToneCache[t - 1] || store.get(`patch.tones.${t - 1}`);
      if (cached) {
        updateToneUI(cached);
      }
    });
  }

  // Basic Tone & Wave Parameters
  const toneSliders = [
    { el: 'toneLevel', valEl: 'toneLevelVal', param: 'TONE_LEVEL', format: v => v },
    { el: 'tonePan', valEl: 'tonePanVal', param: 'TONE_PAN', format: panDisplay },
    { el: 'toneCoarseTune', valEl: 'toneCoarseTuneVal', param: 'COARSE_TUNE', format: v => v - 64 },
    { el: 'toneFineTune', valEl: 'toneFineTuneVal', param: 'FINE_TUNE', format: v => v - 64 },
    { el: 'waveFxmDepth', valEl: 'waveFxmDepthVal', param: 'WAVE_FXM_DEPTH', format: v => v },
    { el: 'toneCutoff', valEl: 'toneCutoffVal', param: 'TVF_CUTOFF', format: v => v, onUpdate: redrawFilterCurves },
    { el: 'toneResonance', valEl: 'toneResonanceVal', param: 'TVF_RESONANCE', format: v => v, onUpdate: redrawFilterCurves },
    { el: 'toneTvaLevel', valEl: 'toneTvaLevelVal', param: 'TVA_LEVEL', format: v => v, onUpdate: redrawTVAEnvCurve },
  ];

  for (const s of toneSliders) {
    $(s.el).addEventListener('input', () => {
      const val = parseInt($(s.el).value, 10);
      $(s.valEl).textContent = s.format(val);
      if (s.onUpdate) s.onUpdate();
      if (!midi.isConnected) return;
      sendThrottled(`tone_${currentToneIndex}_${s.param}`, () => {
        sendPatchToneParam(midi, currentPart(), currentToneIndex, s.param, val, getDeviceId());
      });
    });
    $(s.el).addEventListener('change', () => {
      const val = parseInt($(s.el).value, 10);
      if (s.onUpdate) s.onUpdate();
      if (!midi.isConnected) return;
      sendPatchToneParam(midi, currentPart(), currentToneIndex, s.param, val, getDeviceId());
    });
  }

  $('waveGroup').addEventListener('change', () => {
    const grp = parseInt($('waveGroup').value, 10);
    const numL = parseInt($('waveNumberL').value, 10) || 1;
    const numR = parseInt($('waveNumberR').value, 10) || 0;
    const nl = $('waveNameL');
    if (nl) nl.textContent = getWaveName(grp, numL);
    const nr = $('waveNameR');
    if (nr) nr.textContent = numR === 0 ? 'OFF' : getWaveName(grp, numR);
    if (!midi.isConnected) return;
    sendPatchToneParam(midi, currentPart(), currentToneIndex, 'WAVE_GROUP_TYPE', grp, getDeviceId());
  });

  $('waveNumberL').addEventListener('change', () => {
    const val = parseInt($('waveNumberL').value, 10);
    const grp = parseInt($('waveGroup').value, 10);
    const nl = $('waveNameL');
    if (nl) nl.textContent = getWaveName(grp, val);
    if (!midi.isConnected) return;
    sendPatchToneParam(midi, currentPart(), currentToneIndex, 'WAVE_NUMBER_L', val, getDeviceId());
  });

  $('waveNumberR').addEventListener('change', () => {
    const val = parseInt($('waveNumberR').value, 10);
    const grp = parseInt($('waveGroup').value, 10);
    const nr = $('waveNameR');
    if (nr) nr.textContent = val === 0 ? 'OFF' : getWaveName(grp, val);
    if (!midi.isConnected) return;
    sendPatchToneParam(midi, currentPart(), currentToneIndex, 'WAVE_NUMBER_R', val, getDeviceId());
  });

  $('waveGain').addEventListener('change', () => {
    if (!midi.isConnected) return;
    sendPatchToneParam(midi, currentPart(), currentToneIndex, 'WAVE_GAIN', parseInt($('waveGain').value, 10), getDeviceId());
  });

  $('waveFxmSwitch').addEventListener('change', () => {
    if (!midi.isConnected) return;
    sendPatchToneParam(midi, currentPart(), currentToneIndex, 'WAVE_FXM_SWITCH', $('waveFxmSwitch').checked ? 1 : 0, getDeviceId());
  });

  $('waveFxmColor').addEventListener('change', () => {
    if (!midi.isConnected) return;
    sendPatchToneParam(midi, currentPart(), currentToneIndex, 'WAVE_FXM_COLOR', parseInt($('waveFxmColor').value, 10), getDeviceId());
  });

  $('waveTempoSync').addEventListener('change', () => {
    if (!midi.isConnected) return;
    sendPatchToneParam(midi, currentPart(), currentToneIndex, 'WAVE_TEMPO_SYNC', $('waveTempoSync').checked ? 1 : 0, getDeviceId());
  });

  // Pitch Env Sliders & Curves
  const pitchEnvInputs = [
    { el: 'pitchEnvDepth', valEl: 'pitchEnvDepthVal', param: 'PITCH_ENV_DEPTH', format: v => v - 64 },
    { el: 'pitchEnvT1', valEl: 'pitchEnvT1Val', param: 'PITCH_ENV_T1', format: v => v },
    { el: 'pitchEnvT2', valEl: 'pitchEnvT2Val', param: 'PITCH_ENV_T2', format: v => v },
    { el: 'pitchEnvT3', valEl: 'pitchEnvT3Val', param: 'PITCH_ENV_T3', format: v => v },
    { el: 'pitchEnvT4', valEl: 'pitchEnvT4Val', param: 'PITCH_ENV_T4', format: v => v },
    { el: 'pitchEnvL1', valEl: 'pitchEnvL1Val', param: 'PITCH_ENV_L1', format: v => v - 64 },
  ];

  for (const p of pitchEnvInputs) {
    $(p.el).addEventListener('input', () => {
      const val = parseInt($(p.el).value, 10);
      $(p.valEl).textContent = p.format(val);
      redrawPitchEnvCurve();
      if (!midi.isConnected) return;
      sendThrottled(`pitchEnv_${currentToneIndex}_${p.param}`, () => {
        sendPatchToneParam(midi, currentPart(), currentToneIndex, p.param, val, getDeviceId());
      });
    });
    $(p.el).addEventListener('change', () => {
      redrawPitchEnvCurve();
      if (!midi.isConnected) return;
      sendPatchToneParam(midi, currentPart(), currentToneIndex, p.param, parseInt($(p.el).value, 10), getDeviceId());
    });
  }

  // TVF Filter & Env Sliders & Curves
  $('toneFilterType').addEventListener('change', () => {
    redrawFilterCurves();
    if (!midi.isConnected) return;
    sendPatchToneParam(midi, currentPart(), currentToneIndex, 'TVF_FILTER_TYPE', parseInt($('toneFilterType').value, 10), getDeviceId());
  });

  $('tvfEnvDepth').addEventListener('input', () => {
    const val = parseInt($('tvfEnvDepth').value, 10);
    $('tvfEnvDepthVal').textContent = val - 64;
    redrawFilterCurves();
    if (!midi.isConnected) return;
    sendThrottled(`tvfEnvDepth_${currentToneIndex}`, () => {
      sendPatchToneParam(midi, currentPart(), currentToneIndex, 'TVF_ENV_DEPTH', val, getDeviceId());
    });
  });
  $('tvfEnvDepth').addEventListener('change', () => {
    redrawFilterCurves();
    if (!midi.isConnected) return;
    sendPatchToneParam(midi, currentPart(), currentToneIndex, 'TVF_ENV_DEPTH', parseInt($('tvfEnvDepth').value, 10), getDeviceId());
  });

  $('tvfEnvT1').addEventListener('input', () => {
    const val = parseInt($('tvfEnvT1').value, 10);
    $('tvfEnvT1Val').textContent = val;
    redrawFilterCurves();
    if (!midi.isConnected) return;
    sendThrottled(`tvfEnvT1_${currentToneIndex}`, () => {
      sendPatchToneParam(midi, currentPart(), currentToneIndex, 'TVF_ENV_T1', val, getDeviceId());
    });
  });
  $('tvfEnvT1').addEventListener('change', () => {
    redrawFilterCurves();
    if (!midi.isConnected) return;
    sendPatchToneParam(midi, currentPart(), currentToneIndex, 'TVF_ENV_T1', parseInt($('tvfEnvT1').value, 10), getDeviceId());
  });

  $('tvfEnvT4').addEventListener('input', () => {
    const val = parseInt($('tvfEnvT4').value, 10);
    $('tvfEnvT4Val').textContent = val;
    redrawFilterCurves();
    if (!midi.isConnected) return;
    sendThrottled(`tvfEnvT4_${currentToneIndex}`, () => {
      sendPatchToneParam(midi, currentPart(), currentToneIndex, 'TVF_ENV_T4', val, getDeviceId());
    });
  });
  $('tvfEnvT4').addEventListener('change', () => {
    redrawFilterCurves();
    if (!midi.isConnected) return;
    sendPatchToneParam(midi, currentPart(), currentToneIndex, 'TVF_ENV_T4', parseInt($('tvfEnvT4').value, 10), getDeviceId());
  });

  // TVA Env Sliders & Curves
  const tvaInputs = [
    { el: 'tvaEnvT1', valEl: 'tvaEnvT1Val', param: 'TVA_ENV_T1' },
    { el: 'tvaEnvT2', valEl: 'tvaEnvT2Val', param: 'TVA_ENV_T2' },
    { el: 'tvaEnvT3', valEl: 'tvaEnvT3Val', param: 'TVA_ENV_T3' },
    { el: 'tvaEnvT4', valEl: 'tvaEnvT4Val', param: 'TVA_ENV_T4' },
    { el: 'tvaEnvL3', valEl: 'tvaEnvL3Val', param: 'TVA_ENV_L3' },
  ];

  for (const t of tvaInputs) {
    $(t.el).addEventListener('input', () => {
      const val = parseInt($(t.el).value, 10);
      $(t.valEl).textContent = val;
      redrawTVAEnvCurve();
      if (!midi.isConnected) return;
      sendThrottled(`tvaEnv_${currentToneIndex}_${t.param}`, () => {
        sendPatchToneParam(midi, currentPart(), currentToneIndex, t.param, val, getDeviceId());
      });
    });
    $(t.el).addEventListener('change', () => {
      redrawTVAEnvCurve();
      if (!midi.isConnected) return;
      sendPatchToneParam(midi, currentPart(), currentToneIndex, t.param, parseInt($(t.el).value, 10), getDeviceId());
    });
  }

  // Dual LFO controls
  $('btnLfo1').addEventListener('click', () => {
    $('btnLfo1').classList.add('active');
    $('btnLfo2').classList.remove('active');
    currentLfoIndex = 1;
    updateToneLFOUI(1);
  });

  $('btnLfo2').addEventListener('click', () => {
    $('btnLfo2').classList.add('active');
    $('btnLfo1').classList.remove('active');
    currentLfoIndex = 2;
    updateToneLFOUI(2);
  });

  $('lfoForm').addEventListener('change', () => {
    const val = parseInt($('lfoForm').value, 10);
    redrawLFOCurve();
    if (!midi.isConnected) return;
    sendToneLFOParam(midi, currentPart(), currentToneIndex, currentLfoIndex, 'FORM', val, getDeviceId());
  });

  $('lfoRate').addEventListener('input', () => {
    const val = parseInt($('lfoRate').value, 10);
    $('lfoRateVal').textContent = val;
    redrawLFOCurve();
    if (!midi.isConnected) return;
    sendThrottled(`lfoRate_${currentToneIndex}_${currentLfoIndex}`, () => {
      sendToneLFOParam(midi, currentPart(), currentToneIndex, currentLfoIndex, 'RATE', val, getDeviceId());
    });
  });
  $('lfoRate').addEventListener('change', () => {
    redrawLFOCurve();
    if (!midi.isConnected) return;
    sendToneLFOParam(midi, currentPart(), currentToneIndex, currentLfoIndex, 'RATE', parseInt($('lfoRate').value, 10), getDeviceId());
  });

  const lfoDepths = [
    { el: 'lfoPitchDepth', valEl: 'lfoPitchDepthVal', param: 'PITCH_DEPTH' },
    { el: 'lfoTvfDepth', valEl: 'lfoTvfDepthVal', param: 'TVF_DEPTH' },
    { el: 'lfoTvaDepth', valEl: 'lfoTvaDepthVal', param: 'TVA_DEPTH' },
    { el: 'lfoPanDepth', valEl: 'lfoPanDepthVal', param: 'PAN_DEPTH' },
  ];

  for (const d of lfoDepths) {
    $(d.el).addEventListener('input', () => {
      const val = parseInt($(d.el).value, 10);
      $(d.valEl).textContent = val - 64;
      if (!midi.isConnected) return;
      sendThrottled(`lfoDepth_${currentToneIndex}_${currentLfoIndex}_${d.param}`, () => {
        sendToneLFOParam(midi, currentPart(), currentToneIndex, currentLfoIndex, d.param, val, getDeviceId());
      });
    });
    $(d.el).addEventListener('change', () => {
      if (!midi.isConnected) return;
      sendToneLFOParam(midi, currentPart(), currentToneIndex, currentLfoIndex, d.param, parseInt($(d.el).value, 10), getDeviceId());
    });
  }

  // Load Entire Patch Button (Common, TMT, 4 Tones with Waveforms)
  const entirePatchBtn = $('loadEntirePatchBtn');
  if (entirePatchBtn) {
    entirePatchBtn.addEventListener('click', async () => {
      if (!midi.isConnected) { setStatus('Not connected'); return; }
      const part = currentPart();
      setStatus(`Loading entire patch for Part ${part} (Common, TMT, and all 4 Tones)...`);
      try {
        const patch = await requestEntirePatch(midi, part, getDeviceId(), (stage, cur, total) => {
          setStatus(`Loading Part ${part} patch: ${stage} (${cur + 1}/${total})...`);
        });
        updatePatchCommonUI(patch.common);
        updatePatchTMTUI(patch.tmt);
        patch.tones.forEach((toneData, idx) => {
          store.set(`patch.tones.${idx}`, toneData);
          currentToneCache[idx] = toneData;
        });
        updateToneUI(patch.tones[currentToneIndex - 1]);
        setStatus(`Successfully loaded entire patch: "${patch.common.name}" with 4 tones & wave data`);
      } catch (e) {
        setStatus(`Failed loading entire patch: ${e.message}`);
      }
    });
  }

  // Load Patch Button (Common & TMT)
  $('loadPatchBtn').addEventListener('click', async () => {
    if (!midi.isConnected) { setStatus('Not connected'); return; }
    const part = currentPart();
    setStatus(`Loading Patch Common & TMT for Part ${part}...`);
    try {
      const common = await requestPatchCommon(midi, part, getDeviceId());
      updatePatchCommonUI(common);
      const tmt = await requestPatchTMT(midi, part, getDeviceId());
      updatePatchTMTUI(tmt);
      setStatus(`Patch loaded: ${common.name}`);
    } catch (e) {
      setStatus(`Failed to load patch: ${e.message}`);
    }
  });

  // Load 4 Tones Button
  $('loadTonesBtn').addEventListener('click', async () => {
    if (!midi.isConnected) { setStatus('Not connected'); return; }
    const part = currentPart();
    setStatus(`Loading 4 tones for Part ${part}...`);
    try {
      for (let t = 1; t <= 4; t++) {
        const toneData = await requestPatchTone(midi, part, t, getDeviceId());
        store.set(`patch.tones.${t - 1}`, toneData);
        currentToneCache[t - 1] = toneData;
        if (currentToneIndex === t) {
          updateToneUI(toneData);
        }
        await new Promise(r => setTimeout(r, 30));
      }
      setStatus(`Loaded all 4 tones for Part ${part}`);
    } catch (e) {
      setStatus(`Failed loading tones: ${e.message}`);
    }
  });
}

// =============================================================================
// Librarian & Memory Management (Stage 2 Gap 5)
// =============================================================================

function downloadBinaryBlob(uint8Array, filename) {
  const blob = new Blob([uint8Array], { type: 'application/octet-stream' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

function initLibrarianControls() {
  renderMemoryBank();

  // Export Active Patch SYX
  $('btnExportPatchSyx').addEventListener('click', () => {
    const commonBytes = new Array(0x4F).fill(0);
    const tmtBytes = new Array(0x29).fill(0);

    // Populate commonBytes with current values
    const patchName = ($('patchName').value || 'USER PATCH').padEnd(12, ' ').slice(0, 12);
    for (let i = 0; i < 12; i++) commonBytes[i] = patchName.charCodeAt(i);
    commonBytes[0x0E] = parseInt($('patchLevel').value, 10);
    commonBytes[0x0F] = parseInt($('patchPan').value, 10);
    commonBytes[0x11] = parseInt($('patchCoarseTune').value, 10);
    commonBytes[0x12] = parseInt($('patchFineTune').value, 10);

    // Build 4 tones data arrays (0x0109 = 265 bytes each)
    const tonesData = [];
    for (let t = 1; t <= 4; t++) {
      const toneBytes = new Array(0x0109).fill(0);
      const cached = currentToneCache[t - 1] || store.get(`patch.tones.${t - 1}`) || {};
      
      toneBytes[0x00] = cached.toneLevel ?? 127;
      toneBytes[0x01] = cached.coarseTune ?? 64;
      toneBytes[0x02] = cached.fineTune ?? 64;
      toneBytes[0x04] = cached.tonePan ?? 64;
      
      // Wave parameters
      const grp = cached.waveGroupType ?? 0;
      toneBytes[0x27] = grp;
      
      const wNumL = cached.waveNumberL ?? (t === 1 ? 1 : 0);
      toneBytes[0x2C] = (wNumL >> 12) & 0x0F;
      toneBytes[0x2D] = (wNumL >> 8) & 0x0F;
      toneBytes[0x2E] = (wNumL >> 4) & 0x0F;
      toneBytes[0x2F] = wNumL & 0x0F;

      const wNumR = cached.waveNumberR ?? 0;
      toneBytes[0x30] = (wNumR >> 12) & 0x0F;
      toneBytes[0x31] = (wNumR >> 8) & 0x0F;
      toneBytes[0x32] = (wNumR >> 4) & 0x0F;
      toneBytes[0x33] = wNumR & 0x0F;

      toneBytes[0x34] = cached.waveGain ?? 1;
      toneBytes[0x35] = cached.fxmSwitch ?? 0;
      toneBytes[0x36] = cached.fxmColor ?? 0;
      toneBytes[0x37] = cached.fxmDepth ?? 0;
      toneBytes[0x38] = cached.waveTempoSync ?? 0;

      // Pitch Env
      toneBytes[0x3A] = cached.pitchEnvDepth ?? 64;
      toneBytes[0x3F] = cached.pitchEnvT1 ?? 0;
      toneBytes[0x40] = cached.pitchEnvT2 ?? 0;
      toneBytes[0x41] = cached.pitchEnvT3 ?? 0;
      toneBytes[0x42] = cached.pitchEnvT4 ?? 0;
      toneBytes[0x44] = cached.pitchEnvL1 ?? 64;

      // TVF
      toneBytes[0x48] = cached.tvfFilterType ?? 1;
      toneBytes[0x49] = cached.tvfCutoff ?? 127;
      toneBytes[0x4D] = cached.tvfResonance ?? 0;

      // TVA
      toneBytes[0x62] = cached.tvaLevel ?? 127;

      tonesData.push(toneBytes);
    }

    const packets = createPatchSyxDump(getSelectedPart(), commonBytes, tmtBytes, tonesData, getDeviceId());
    const syxFile = exportToSyx(packets);
    const safeName = patchName.trim().replace(/[^a-zA-Z0-9_-]/g, '_') || 'patch';
    downloadBinaryBlob(syxFile, `${safeName}.syx`);
    setStatus(`Exported patch to ${safeName}.syx`);
  });

  // Export Active Performance SYX
  $('btnExportPerfSyx').addEventListener('click', () => {
    const commonData = new Array(0x35).fill(0);
    const chorusData = new Array(0x34).fill(0);
    const reverbData = new Array(0x53).fill(0);
    const partsData = Array.from({ length: 16 }, () => new Array(0x31).fill(0));

    const perfName = ($('perfName').value || 'PERFORMANCE').padEnd(12, ' ').slice(0, 12);
    for (let i = 0; i < 12; i++) commonData[i] = perfName.charCodeAt(i);

    const packets = createPerformanceSyxDump(commonData, chorusData, reverbData, partsData, getDeviceId());
    const syxFile = exportToSyx(packets);
    const safeName = perfName.trim().replace(/[^a-zA-Z0-9_-]/g, '_') || 'performance';
    downloadBinaryBlob(syxFile, `${safeName}.syx`);
    setStatus(`Exported performance to ${safeName}.syx`);
  });

  // SYX Dropzone / File input
  const dropzone = $('syxDropzone');
  const fileInput = $('syxFileInput');

  dropzone.addEventListener('click', () => fileInput.click());

  dropzone.addEventListener('dragover', (e) => {
    e.preventDefault();
    dropzone.classList.add('dragover');
  });

  dropzone.addEventListener('dragleave', () => dropzone.classList.remove('dragover'));

  dropzone.addEventListener('drop', (e) => {
    e.preventDefault();
    dropzone.classList.remove('dragover');
    if (e.dataTransfer.files.length > 0) {
      handleSyxFile(e.dataTransfer.files[0]);
    }
  });

  fileInput.addEventListener('change', () => {
    if (fileInput.files.length > 0) {
      handleSyxFile(fileInput.files[0]);
    }
  });

  // Save current patch to memory slot
  $('btnSaveCurrentPatchSlot').addEventListener('click', () => {
    const name = $('patchName').value.trim() || `Patch ${new Date().toLocaleTimeString()}`;
    const tonesSnapshot = [1, 2, 3, 4].map(t => {
      const cached = currentToneCache[t - 1] || store.get(`patch.tones.${t - 1}`) || {};
      return {
        toneLevel: cached.toneLevel ?? 127,
        coarseTune: cached.coarseTune ?? 64,
        fineTune: cached.fineTune ?? 64,
        tonePan: cached.tonePan ?? 64,
        waveGroupType: cached.waveGroupType ?? 0,
        waveNumberL: cached.waveNumberL ?? (t === 1 ? 1 : 0),
        waveNumberR: cached.waveNumberR ?? 0,
        waveGain: cached.waveGain ?? 1,
        fxmSwitch: cached.fxmSwitch ?? 0,
        fxmColor: cached.fxmColor ?? 0,
        fxmDepth: cached.fxmDepth ?? 0,
        waveTempoSync: cached.waveTempoSync ?? 0,
      };
    });

    const slotData = {
      name,
      timestamp: Date.now(),
      level: parseInt($('patchLevel').value, 10),
      pan: parseInt($('patchPan').value, 10),
      coarse: parseInt($('patchCoarseTune').value, 10),
      fine: parseInt($('patchFineTune').value, 10),
      monoPoly: parseInt($('patchMonoPoly').value, 10),
      tones: tonesSnapshot,
    };

    const slots = getStoredSlots();
    slots.push(slotData);
    localStorage.setItem('xv5050_user_patches', JSON.stringify(slots));
    renderMemoryBank();
    setStatus(`Saved patch '${name}' to memory bank`);
  });
}

function getStoredSlots() {
  try {
    const raw = localStorage.getItem('xv5050_user_patches');
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

function renderMemoryBank() {
  const container = $('bankGridContainer');
  if (!container) return;
  const slots = getStoredSlots();

  if (slots.length === 0) {
    container.innerHTML = '<div style="color:var(--text-muted); font-size:0.85rem; padding:12px;">No stored patches in local memory. Click "Save Active Patch to Slot" above.</div>';
    return;
  }

  container.innerHTML = '';
  slots.forEach((s, idx) => {
    const card = document.createElement('div');
    card.className = 'bank-slot-card';
    card.innerHTML = `
      <div>
        <div class="bank-slot-num">SLOT ${String(idx + 1).padStart(2, '0')}</div>
        <div class="bank-slot-name">${s.name}</div>
        <div style="font-size:0.75rem; color:var(--text-secondary); margin-top:4px;">
          Level: ${s.level} | Pan: ${panDisplay(s.pan)}
        </div>
      </div>
      <div class="bank-slot-actions">
        <button class="btn btn-sm btn-primary" id="btnRecallSlot${idx}">Recall</button>
        <button class="btn btn-sm" id="btnDeleteSlot${idx}">✕</button>
      </div>
    `;
    container.appendChild(card);

    card.querySelector(`#btnRecallSlot${idx}`).addEventListener('click', () => {
      $('patchName').value = s.name;
      $('patchLevel').value = s.level;
      $('patchLevelVal').textContent = s.level;
      $('patchPan').value = s.pan;
      $('patchPanVal').textContent = panDisplay(s.pan);
      $('patchCoarseTune').value = s.coarse;
      $('patchCoarseTuneVal').textContent = s.coarse - 64;
      $('patchFineTune').value = s.fine;
      $('patchFineTuneVal').textContent = s.fine - 64;
      $('patchMonoPoly').value = s.monoPoly;

      if (Array.isArray(s.tones)) {
        s.tones.forEach((toneData, tIdx) => {
          store.set(`patch.tones.${tIdx}`, toneData);
          currentToneCache[tIdx] = toneData;
        });
        if (currentToneCache[currentToneIndex - 1]) {
          updateToneUI(currentToneCache[currentToneIndex - 1]);
        }
      }

      setStatus(`Recalled patch '${s.name}' with wave parameters from slot ${idx + 1}`);
    });

    card.querySelector(`#btnDeleteSlot${idx}`).addEventListener('click', () => {
      const remaining = slots.filter((_, i) => i !== idx);
      localStorage.setItem('xv5050_user_patches', JSON.stringify(remaining));
      renderMemoryBank();
    });
  });
}

async function handleSyxFile(file) {
  const statusEl = $('syxImportStatus');
  statusEl.textContent = `Reading ${file.name}...`;
  try {
    const arrayBuffer = await file.arrayBuffer();
    const packets = parseSyxFile(arrayBuffer);
    const validCount = packets.filter(p => p.valid).length;

    if (validCount === 0) {
      statusEl.textContent = `No valid SysEx packets recognized in ${file.name}`;
      return;
    }

    statusEl.innerHTML = `<span style="color:var(--success);">✓ Loaded ${validCount} valid SysEx packets from ${file.name}.</span> ` +
      `<button class="btn btn-sm btn-primary" id="btnTransmitSyxPackets" style="margin-left:8px;">Send ${validCount} Packets to Device</button>`;

    $('btnTransmitSyxPackets').addEventListener('click', async () => {
      if (!midi.isConnected) { setStatus('Connect MIDI first'); return; }
      setStatus(`Transmitting ${validCount} SysEx packets...`);
      for (const p of packets) {
        if (p.valid && p.address && p.data) {
          const raw = buildDT1(p.address, p.data, p.deviceId || getDeviceId());
          midi.send(raw);
          await new Promise(r => setTimeout(r, 25));
        }
      }
      setStatus(`Transmitted ${validCount} SysEx packets to synthesizer`);
    });
  } catch (err) {
    statusEl.textContent = `Error reading SYX file: ${err.message}`;
  }
}

// =============================================================================
// Load Functions
// =============================================================================

async function loadPerformanceCommon() {
  if (!midi.isConnected) { setStatus('Not connected'); return; }
  setStatus('Loading Performance Common...');
  try {
    const data = await requestPerformanceCommon(midi, getDeviceId());
    updatePerformanceCommonUI(data);
    setStatus(`Performance Common loaded: ${data.name}`);
  } catch (e) {
    setStatus(`Failed loading performance common: ${e.message}`);
  }
}

async function loadPerformanceFx() {
  if (!midi.isConnected) { setStatus('Not connected'); return; }
  setStatus('Loading Performance Chorus & Reverb...');
  try {
    const chorus = await requestPerformanceChorus(midi, getDeviceId());
    updatePerformanceChorusUI(chorus);
    const reverb = await requestPerformanceReverb(midi, getDeviceId());
    updatePerformanceReverbUI(reverb);
    setStatus('Performance Chorus & Reverb loaded');
  } catch (e) {
    setStatus(`Failed loading effects: ${e.message}`);
  }
}

async function loadEntirePerformanceData() {
  if (!midi.isConnected) { setStatus('Not connected'); return; }
  const progEl = $('loadProgress');
  setStatus('Loading entire performance (Common, Effects, 16 Parts + Patch Names)...');
  try {
    const perf = await requestEntirePerformance(midi, getDeviceId(), (stage, cur, total, data) => {
      if (progEl) progEl.textContent = `Reading ${stage} (${cur + 1}/${total})...`;
      if (stage === 'common' && data) updatePerformanceCommonUI(data);
      if (stage === 'mfxA' && data) {
        perfMfxCache.A = data;
        updatePerfMfxBadges('A', data.mfxType);
        if (activePerfMfxSlot === 'A') applyPerfMfxToUI(data);
      }
      if (stage === 'mfxB' && data) {
        perfMfxCache.B = data;
        updatePerfMfxBadges('B', data.mfxType);
        if (activePerfMfxSlot === 'B') applyPerfMfxToUI(data);
      }
      if (stage === 'mfxC' && data) {
        perfMfxCache.C = data;
        updatePerfMfxBadges('C', data.mfxType);
        if (activePerfMfxSlot === 'C') applyPerfMfxToUI(data);
      }
      if (stage === 'chorus' && data) updatePerformanceChorusUI(data);
      if (stage === 'reverb' && data) updatePerformanceReverbUI(data);
    });
    updatePerformanceCommonUI(perf.common);
    if (perf.mfxA) {
      perfMfxCache.A = perf.mfxA;
      updatePerfMfxBadges('A', perf.mfxA.mfxType);
    }
    if (perf.mfxB) {
      perfMfxCache.B = perf.mfxB;
      updatePerfMfxBadges('B', perf.mfxB.mfxType);
    }
    if (perf.mfxC) {
      perfMfxCache.C = perf.mfxC;
      updatePerfMfxBadges('C', perf.mfxC.mfxType);
    }
    if (perfMfxCache[activePerfMfxSlot]) {
      applyPerfMfxToUI(perfMfxCache[activePerfMfxSlot]);
    }
    updatePerformanceChorusUI(perf.chorus);
    updatePerformanceReverbUI(perf.reverb);
    perf.parts.forEach((p, idx) => updatePartRow(idx + 1, p));
    if (!syncedUnitDb) {
      syncedUnitDb = {
        setup: null,
        system: { common: null, eq: null },
        currentPerformance: perf,
        activePatches: [],
        userPerformances: [],
        userPatches: [],
        userRhythms: [],
      };
    } else {
      syncedUnitDb.currentPerformance = perf;
    }
    populateAllInstrumentSelectors();
    renderPartNavigationStrip();
    saveSyncedDbToStorage();
    if (progEl) progEl.textContent = 'Entire performance loaded';
    setStatus(`Successfully loaded Performance: "${perf.common.name}" (Common, 3-MFX, Chorus, Reverb, 16 Parts)`);
  } catch (e) {
    if (progEl) progEl.textContent = '';
    setStatus(`Failed loading entire performance: ${e.message}`);
  }
}

async function loadAllPartsData() {
  if (!midi.isConnected) { setStatus('Not connected'); return; }
  const progEl = $('loadProgress');
  setStatus('Loading all 16 parts with patch names...');
  try {
    const parts = await requestAllParts(midi, getDeviceId(), (done, total, partData) => {
      if (progEl) progEl.textContent = `Reading Part ${done}/${total} (${partData?.patchName || ''})...`;
      if (partData) updatePartRow(done, partData);
    });
    parts.forEach((p, idx) => updatePartRow(idx + 1, p));
    if (!syncedUnitDb) {
      syncedUnitDb = {
        setup: null,
        system: { common: null, eq: null },
        currentPerformance: { common: null, parts },
        activePatches: [],
        userPerformances: [],
        userPatches: [],
        userRhythms: [],
      };
    } else if (syncedUnitDb.currentPerformance) {
      syncedUnitDb.currentPerformance.parts = parts;
    }
    populateAllInstrumentSelectors();
    renderPartNavigationStrip();
    saveSyncedDbToStorage();
    if (progEl) progEl.textContent = 'All 16 parts loaded';
    setStatus('Successfully loaded all 16 performance parts and sound names');
  } catch (e) {
    if (progEl) progEl.textContent = '';
    setStatus(`Failed loading parts: ${e.message}`);
  }
}

// =============================================================================
// Navigation
// =============================================================================

function switchToTab(target) {
  document.querySelectorAll('.tab-btn').forEach(b => {
    b.classList.toggle('active', b.dataset.tab === target);
  });
  document.querySelectorAll('.tab-content').forEach(c => {
    c.classList.toggle('active', c.id === `${target}Tab`);
  });
}

function initTabs() {
  document.querySelectorAll('.tab-btn').forEach(btn => {
    btn.addEventListener('click', () => switchToTab(btn.dataset.tab));
  });
}

// =============================================================================
// Edit Tracking & Sync with Unit
// =============================================================================

let isEdited = false;
let isSyncInProgress = false;

function markEdited() {
  if (!isEdited) {
    isEdited = true;
    const badge = $('dirtyBadge');
    if (badge) badge.style.display = 'inline-flex';
  }
}

function clearEdited() {
  isEdited = false;
  const badge = $('dirtyBadge');
  if (badge) badge.style.display = 'none';
}

function initEditTracking() {
  document.addEventListener('input', (e) => {
    if (!e.target) return;
    const tag = e.target.tagName;
    if (tag === 'INPUT' || tag === 'SELECT' || tag === 'TEXTAREA') {
      if (e.target.id === 'midiInput' || e.target.id === 'midiOutput' || e.target.id === 'deviceId') return;
      markEdited();
    }
  });

  document.addEventListener('change', (e) => {
    if (!e.target) return;
    const tag = e.target.tagName;
    if (tag === 'INPUT' || tag === 'SELECT' || tag === 'TEXTAREA') {
      if (e.target.id === 'midiInput' || e.target.id === 'midiOutput' || e.target.id === 'deviceId') return;
      markEdited();
    }
  });
}

async function handleSyncWithUnit() {
  if (isSyncInProgress) {
    setStatus('Unit sync is already in progress...');
    return;
  }

  if (!midi.sysexEnabled) {
    const hasAccess = await midi.requestAccess();
    if (hasAccess) refreshDeviceList();
    if (!midi.sysexEnabled) {
      setStatus('⚠️ SysEx permission required. Allow MIDI and SysEx in browser site permissions.');
      alert('SysEx permission is required to read from the XV-5050 synthesizer. Please allow SysEx permission in Chrome (click the site settings / tune icon in the address bar to allow "System exclusive messages").');
      return;
    }
  }

  if (!midi.isConnected) {
    let inputId = $('midiInput')?.value;
    let outputId = $('midiOutput')?.value;
    if (!inputId) {
      const dev = midi.getInputs().find(d => d.name.includes('XV-5050'));
      if (dev) inputId = dev.id;
    }
    if (!outputId) {
      const dev = midi.getOutputs().find(d => d.name.includes('XV-5050'));
      if (dev) outputId = dev.id;
    }

    if (inputId && outputId) {
      setStatus('Connecting to XV-5050 MIDI ports...');
      const success = await midi.connect(inputId, outputId);
      if (success) {
        setConnectionStatus(true, `${midi.inputName}`);
        $('connectBtn').textContent = 'Disconnect';
        setDeviceInfo(`${midi.inputName} ↔ ${midi.outputName}`);
        midi.onSysEx(handleIncomingSysEx);
      }
    }
  }

  if (!midi.isConnected) {
    setStatus('Cannot sync: XV-5050 is not connected. Connect MIDI first.');
    return;
  }

  if (isEdited) {
    const modal = $('confirmSyncModal');
    if (modal) {
      modal.style.display = 'flex';
      return;
    }
    if (!window.confirm('You have edited content in the web editor. You will lose all edits. Are you sure you want to sync from unit?')) {
      return;
    }
  }

  executeSyncWithUnit();
}

// =============================================================================
// Full Unit Sync, Instrument Banks & Hardware Inventory State
// =============================================================================

export const ROLAND_BANKS = [
  { id: 'user', label: 'User Patches (USER)', msb: 87, lsb: 0, count: 128, isRhythm: false },
  { id: 'pra', label: 'Preset A (PR-A)', msb: 87, lsb: 64, count: 128, isRhythm: false },
  { id: 'prb', label: 'Preset B (PR-B)', msb: 87, lsb: 65, count: 128, isRhythm: false },
  { id: 'prc', label: 'Preset C (PR-C)', msb: 87, lsb: 66, count: 128, isRhythm: false },
  { id: 'prd', label: 'Preset D (PR-D)', msb: 87, lsb: 67, count: 128, isRhythm: false },
  { id: 'pre', label: 'Preset E (PR-E)', msb: 87, lsb: 68, count: 128, isRhythm: false },
  { id: 'gm2', label: 'GM2 Bank (GM)', msb: 121, lsb: 0, count: 256, isRhythm: false },
  { id: 'preset_rhy', label: 'Preset Rhythm Kits (PR-RHY)', msb: 86, lsb: 64, count: 8, isRhythm: true },
  { id: 'user_rhy', label: 'User Rhythm Kits (USER-RHY)', msb: 86, lsb: 0, count: 4, isRhythm: true },
];

const SYNC_CACHE_KEY = 'xv5050_synced_unit_db';
let syncedUnitDb = null;
const activePartPatchesCache = {};

function saveSyncedDbToStorage() {
  if (!syncedUnitDb) return;
  try {
    localStorage.setItem(SYNC_CACHE_KEY, JSON.stringify(syncedUnitDb));
  } catch (e) {
    console.warn('Could not save unit DB to localStorage:', e);
  }
}

function restoreSyncedDbFromStorage() {
  try {
    const raw = localStorage.getItem(SYNC_CACHE_KEY);
    if (!raw) return false;
    const db = JSON.parse(raw);
    if (!db || (!db.userPerformances?.length && !db.userPatches?.length && !db.currentPerformance)) {
      return false;
    }
    syncedUnitDb = db;
    populateUserBankSelectors();
    populateAllInstrumentSelectors();
    renderUserPerfsTable();
    renderUserPatchesTable();
    renderPartNavigationStrip();

    if (syncedUnitDb.currentPerformance?.common) {
      updatePerformanceCommonUI(syncedUnitDb.currentPerformance.common);
    }
    if (syncedUnitDb.currentPerformance?.mfxA) {
      perfMfxCache.A = syncedUnitDb.currentPerformance.mfxA;
      updatePerfMfxBadges('A', perfMfxCache.A.mfxType);
    }
    if (syncedUnitDb.currentPerformance?.mfxB) {
      perfMfxCache.B = syncedUnitDb.currentPerformance.mfxB;
      updatePerfMfxBadges('B', perfMfxCache.B.mfxType);
    }
    if (syncedUnitDb.currentPerformance?.mfxC) {
      perfMfxCache.C = syncedUnitDb.currentPerformance.mfxC;
      updatePerfMfxBadges('C', perfMfxCache.C.mfxType);
    }
    if (Array.isArray(syncedUnitDb.currentPerformance?.parts)) {
      syncedUnitDb.currentPerformance.parts.forEach((p, idx) => updatePartRow(idx + 1, p));
    }
    if (Array.isArray(syncedUnitDb.activePatches)) {
      syncedUnitDb.activePatches.forEach(ap => {
        activePartPatchesCache[ap.part] = ap;
      });
      const activePart = getSelectedPart() || 1;
      const initialPatch = activePartPatchesCache[activePart] || syncedUnitDb.activePatches[0];
      if (initialPatch?.common) updatePatchCommonUI(initialPatch.common);
    }
    updateActivePartUI(getSelectedPart() || 1);
    setStatus('Restored synced instruments and sound database from browser storage');
    return true;
  } catch (err) {
    console.warn('Failed restoring unit DB from localStorage:', err);
    return false;
  }
}

function populateUserBankSelectors() {
  const perfSelect = $('userPerfSelect');
  if (perfSelect && syncedUnitDb?.userPerformances) {
    perfSelect.innerHTML = '<option value="">— User Performances (1-64) —</option>';
    syncedUnitDb.userPerformances.forEach((p) => {
      const opt = document.createElement('option');
      opt.value = p.index;
      opt.textContent = `User ${String(p.index).padStart(2, '0')}: ${p.name}`;
      perfSelect.appendChild(opt);
    });
  }

  const patchSelect = $('userPatchSelect');
  if (patchSelect && syncedUnitDb?.userPatches) {
    patchSelect.innerHTML = '<option value="">— User Patches (1-128) —</option>';
    syncedUnitDb.userPatches.forEach((p) => {
      const opt = document.createElement('option');
      opt.value = p.index;
      opt.textContent = `User ${String(p.index).padStart(3, '0')}: ${p.name}`;
      patchSelect.appendChild(opt);
    });
  }
}

function populateAllInstrumentSelectors() {
  for (let i = 1; i <= 16; i++) {
    const sel = $(`partPatchSelect${i}`);
    if (sel) populateInstrumentSelectOptions(sel, i);
  }

  const patchInstSel = $('patchInstrumentSelect');
  if (patchInstSel) {
    const activePart = getSelectedPart() || 1;
    populateInstrumentSelectOptions(patchInstSel, activePart);
  }
}

function populateInstrumentSelectOptions(selectEl, forPart = 1) {
  if (!selectEl) return;
  const currentVal = selectEl.value;
  selectEl.innerHTML = '<option value="">— Select Instrument —</option>';

  // Group 1: Performance Channels (Parts 1-16) with live names from DB or DOM
  const ogPerf = document.createElement('optgroup');
  ogPerf.label = '— Performance Channels (Parts 1-16) —';
  for (let pNum = 1; pNum <= 16; pNum++) {
    const dbPart = syncedUnitDb?.currentPerformance?.parts?.[pNum - 1];
    const domName = $(`partPatchName${pNum}`)?.textContent?.trim();
    const domMsb = parseInt($(`partBankMSB${pNum}`)?.value || '87', 10);
    const domLsb = parseInt($(`partBankLSB${pNum}`)?.value || '64', 10);
    const domPc = parseInt($(`partPC${pNum}`)?.value || '1', 10);

    const name = dbPart?.patchName || (domName && domName !== '—' ? domName : `Sound ${pNum}`);
    const msb = dbPart?.patchBankMSB ?? domMsb;
    const lsb = dbPart?.patchBankLSB ?? domLsb;
    const pc = dbPart?.patchPC ?? domPc;
    const isRhy = dbPart?.isRhythm || pNum === 10 || msb === 86;

    const opt = document.createElement('option');
    opt.value = `custom:${msb}:${lsb}:${pc}:${pNum}`;
    opt.textContent = `Part ${pNum} [Ch ${pNum}]${isRhy ? ' 🥁' : ''}: ${name}`;
    ogPerf.appendChild(opt);
  }
  selectEl.appendChild(ogPerf);

  // Group 2: Hardware User Patches (1-128)
  const ogUser = document.createElement('optgroup');
  ogUser.label = '— Hardware User Patches (1-128) —';
  if (syncedUnitDb?.userPatches?.length) {
    syncedUnitDb.userPatches.forEach((p) => {
      const opt = document.createElement('option');
      opt.value = `user:${p.index}`;
      opt.textContent = `User ${String(p.index).padStart(3, '0')}: ${p.name}`;
      ogUser.appendChild(opt);
    });
  } else {
    for (let u = 1; u <= 128; u++) {
      const opt = document.createElement('option');
      opt.value = `user:${u}`;
      opt.textContent = `User ${String(u).padStart(3, '0')} (Bank 87/0 PC ${u})`;
      ogUser.appendChild(opt);
    }
  }
  selectEl.appendChild(ogUser);

  // Group 3: Rhythm Drum Kits (User 1-4 & Preset 1-8)
  const ogRhythm = document.createElement('optgroup');
  ogRhythm.label = '— Rhythm Drum Kits —';
  if (syncedUnitDb?.userRhythms?.length) {
    syncedUnitDb.userRhythms.forEach((r) => {
      const opt = document.createElement('option');
      opt.value = `rhythm:user:${r.index}`;
      opt.textContent = `User Drum ${r.index}: ${r.name}`;
      ogRhythm.appendChild(opt);
    });
  } else {
    for (let r = 1; r <= 4; r++) {
      const opt = document.createElement('option');
      opt.value = `rhythm:user:${r}`;
      opt.textContent = `User Drum Kit ${r} (Bank 86/0 PC ${r})`;
      ogRhythm.appendChild(opt);
    }
  }
  for (let pr = 1; pr <= 8; pr++) {
    const opt = document.createElement('option');
    opt.value = `rhythm:preset:${pr}`;
    opt.textContent = `Preset Drum Kit ${pr} (Bank 86/64 PC ${pr})`;
    ogRhythm.appendChild(opt);
  }
  selectEl.appendChild(ogRhythm);

  // Group 4: Roland XV-5050 Factory Preset Banks
  const ogPresets = document.createElement('optgroup');
  ogPresets.label = '— Roland Factory Preset Banks —';
  ROLAND_BANKS.filter(b => !b.isRhythm && b.id !== 'user').forEach(b => {
    const opt = document.createElement('option');
    opt.value = `bank:${b.id}:${b.msb}:${b.lsb}:1`;
    opt.textContent = `${b.label} (Bank ${b.msb}/${b.lsb})`;
    ogPresets.appendChild(opt);
  });
  selectEl.appendChild(ogPresets);

  // Pre-select matching instrument for forPart
  const curPartData = syncedUnitDb?.currentPerformance?.parts?.[forPart - 1];
  const curMsb = curPartData?.patchBankMSB ?? parseInt($(`partBankMSB${forPart}`)?.value || '87', 10);
  const curLsb = curPartData?.patchBankLSB ?? parseInt($(`partBankLSB${forPart}`)?.value || '64', 10);
  const curPc = curPartData?.patchPC ?? parseInt($(`partPC${forPart}`)?.value || '1', 10);

  if (curMsb === 87 && curLsb === 0) {
    const userVal = `user:${curPc}`;
    if (Array.from(selectEl.options).some(o => o.value === userVal)) {
      selectEl.value = userVal;
      return;
    }
  }
  if (curMsb === 86) {
    const rVal = curLsb === 0 ? `rhythm:user:${curPc}` : `rhythm:preset:${curPc}`;
    if (Array.from(selectEl.options).some(o => o.value === rVal)) {
      selectEl.value = rVal;
      return;
    }
  }
  const customVal = `custom:${curMsb}:${curLsb}:${curPc}:${forPart}`;
  if (Array.from(selectEl.options).some(o => o.value === customVal)) {
    selectEl.value = customVal;
    return;
  }
  const bankMatch = Array.from(selectEl.options).find(o => o.value.startsWith('bank:') && o.value.includes(`:${curMsb}:${curLsb}:`));
  if (bankMatch) {
    selectEl.value = bankMatch.value;
    return;
  }
  if (currentVal && Array.from(selectEl.options).some(o => o.value === currentVal)) {
    selectEl.value = currentVal;
  }
}

function renderPartNavigationStrip() {
  const container = $('partStripContainer');
  if (!container) return;
  container.innerHTML = '';

  const activePart = getSelectedPart() || 1;

  for (let i = 1; i <= 16; i++) {
    const btn = document.createElement('button');
    btn.className = `part-strip-btn${i === activePart ? ' active' : ''}`;
    btn.id = `partStripBtn${i}`;
    const pData = syncedUnitDb?.currentPerformance?.parts?.[i - 1];
    const domName = $(`partPatchName${i}`)?.textContent?.trim();
    const isRhy = pData?.isRhythm || i === 10 || pData?.patchBankMSB === 86;
    const soundName = pData?.patchName || (domName && domName !== '—' ? domName : `Sound ${i}`);
    btn.innerHTML = `${i}${isRhy ? ' 🥁' : ''}`;
    btn.title = `Part ${i} [Ch ${i}]: ${soundName}`;

    btn.addEventListener('click', () => {
      selectPart(i);
    });

    container.appendChild(btn);
  }
}

function selectPart(part) {
  const partSel = $('patchPartSelect');
  if (partSel && parseInt(partSel.value, 10) !== part) {
    partSel.value = part;
  }

  for (let i = 1; i <= 16; i++) {
    const row = $(`partRow${i}`);
    if (row) row.classList.toggle('selected', i === part);
    const stripBtn = $(`partStripBtn${i}`);
    if (stripBtn) stripBtn.classList.toggle('active', i === part);
  }

  if (part === 0) {
    setSynthesizerMode(1, true);
  } else if (currentSoundMode === 1) {
    setSynthesizerMode(2, true);
  }

  updateActivePartUI(part);

  const cached = activePartPatchesCache[part];
  if (cached) {
    if (cached.common) updatePatchCommonUI(cached.common);
    if (cached.mfx || cached.chorus || cached.reverb) {
      applyPatchEffectsToUI(cached.mfx, cached.chorus, cached.reverb);
    }
    if (cached.tmt) updatePatchTMTUI(cached.tmt);
    if (Array.isArray(cached.tones)) {
      cached.tones.forEach((toneData, tIdx) => {
        currentToneCache[tIdx] = toneData;
      });
      const activeTone = currentToneCache[currentToneIndex - 1];
      if (activeTone) updateToneUI(activeTone);
    }
    setStatus(`Switched to synced ${part === 0 ? 'Single Patch' : `Part ${part} Patch`} (${cached.common?.name || ''})`);
  }
}

function updateActivePartUI(part) {
  const pData = syncedUnitDb?.currentPerformance?.parts?.[part - 1];
  const domName = $(`partPatchName${part}`)?.textContent?.trim();
  const patchName = pData?.patchName || (domName && domName !== '—' ? domName : `Part ${part} Sound`);
  const ch = pData?.receiveChannel ?? ($(`partChannel${part}`) ? parseInt($(`partChannel${part}`).value, 10) : (part - 1));

  const badge = $('activePartBadge');
  if (badge) badge.textContent = part === 0 ? 'SOLO' : `PART ${part}`;

  const nameHeader = $('activePatchHeaderName');
  if (nameHeader) nameHeader.textContent = patchName;

  const chBadge = $('activePartChannelBadge');
  if (chBadge) chBadge.textContent = `MIDI Ch ${ch + 1}`;

  const instSel = $('patchInstrumentSelect');
  if (instSel) {
    populateInstrumentSelectOptions(instSel, part);
  }
}

async function handleInstrumentSelection(part, val) {
  if (!val) return;
  let bankMsb = 87;
  let bankLsb = 0;
  let pc = 1;
  let name = '';

  const parts = val.split(':');
  const type = parts[0];

  if (type === 'user') {
    const index = parseInt(parts[1], 10);
    bankMsb = 87;
    bankLsb = 0;
    pc = index;
    const patch = syncedUnitDb?.userPatches?.find(p => p.index === index);
    name = patch?.name || `User ${String(index).padStart(3, '0')}`;
  } else if (type === 'custom') {
    bankMsb = parseInt(parts[1], 10);
    bankLsb = parseInt(parts[2], 10);
    pc = parseInt(parts[3], 10);
    const srcPartNum = parseInt(parts[4] || 0, 10);
    const srcPart = syncedUnitDb?.currentPerformance?.parts?.[srcPartNum - 1];
    const domName = $(`partPatchName${srcPartNum}`)?.textContent?.trim();
    name = srcPart?.patchName || (domName && domName !== '—' ? domName : `Sound (B:${bankMsb}/${bankLsb} P:${pc})`);
  } else if (type === 'rhythm') {
    const sub = parts[1]; // 'user' or 'preset'
    const rIdx = parseInt(parts[2], 10);
    bankMsb = 86;
    bankLsb = sub === 'user' ? 0 : 64;
    pc = rIdx;
    name = `${sub === 'user' ? 'User' : 'Preset'} Drum Kit ${rIdx}`;
  } else if (type === 'bank') {
    bankMsb = parseInt(parts[2], 10);
    bankLsb = parseInt(parts[3], 10);
    pc = parseInt(parts[4] || 1, 10);
    const bank = ROLAND_BANKS.find(b => b.id === parts[1]);
    name = `${bank?.label || 'Preset'} #${pc}`;
  }

  // 1. Update Part Row Inputs
  const msbEl = $(`partBankMSB${part}`);
  const lsbEl = $(`partBankLSB${part}`);
  const pcEl = $(`partPC${part}`);
  if (msbEl) msbEl.value = bankMsb;
  if (lsbEl) lsbEl.value = bankLsb;
  if (pcEl) pcEl.value = pc;

  const nameEl = $(`partPatchName${part}`);
  if (nameEl) nameEl.textContent = name;

  // 2. Transmit to Hardware
  const chEl = $(`partChannel${part}`);
  const receiveChannel = chEl ? parseInt(chEl.value, 10) : (part - 1);

  if (midi.isConnected) {
    setStatus(`Assigning "${name}" to Part ${part} on XV-5050...`);
    try {
      sendPartBankAndProgram(midi, part, bankMsb, bankLsb, pc, getDeviceId(), receiveChannel);
      await new Promise(r => setTimeout(r, 80));

      const freshName = await requestPartPatchName(midi, part, getDeviceId());
      if (freshName && freshName.trim()) {
        name = freshName;
        if (nameEl) nameEl.textContent = name;
      }
      setStatus(`Assigned "${name}" to Part ${part} (Ch ${receiveChannel + 1})`);
    } catch (e) {
      console.warn('Hardware assignment notification:', e);
      setStatus(`Assigned "${name}" to Part ${part}`);
    }
  } else {
    setStatus(`Assigned "${name}" to Part ${part} (Offline)`);
  }

  // 3. Update cached DB
  if (syncedUnitDb?.currentPerformance?.parts?.[part - 1]) {
    const p = syncedUnitDb.currentPerformance.parts[part - 1];
    p.patchBankMSB = bankMsb;
    p.patchBankLSB = bankLsb;
    p.patchPC = pc;
    p.patchName = name;
    saveSyncedDbToStorage();
  }

  // 4. Re-populate all selectors & Update Header if editing this part
  populateAllInstrumentSelectors();
  if (getSelectedPart() === part) {
    updateActivePartUI(part);
  }
}

function renderUserPerfsTable(filter = '') {
  const tbody = $('userPerfsTableBody');
  if (!tbody) return;
  if (!syncedUnitDb?.userPerformances?.length) {
    tbody.innerHTML = '<tr><td colspan="5" style="text-align:center; color:var(--text-secondary); padding:20px;">Click "Sync with Unit" to load all 64 User Performances from hardware.</td></tr>';
    return;
  }

  const q = filter.trim().toLowerCase();
  const list = syncedUnitDb.userPerformances.filter(p => !q || p.name.toLowerCase().includes(q) || String(p.index).includes(q));

  const badge = $('perfCountBadge');
  if (badge) badge.textContent = `${list.length} of 64 Performances`;

  tbody.innerHTML = list.map(p => `
    <tr>
      <td style="font-family:var(--font-mono); font-weight:600; color:var(--text-accent);">User ${String(p.index).padStart(2, '0')}</td>
      <td style="font-weight:600; color:var(--text-primary);">${p.name}</td>
      <td>${p.soloPart ? `Part ${p.soloPart}` : 'OFF'}</td>
      <td>${p.mfxSource === 0 ? 'PERFORM' : `Part ${p.mfxSource}`}</td>
      <td style="text-align:center;">
        <button class="btn btn-sm btn-secondary" onclick="window.loadSyncedUserPerf(${p.index})">Load</button>
      </td>
    </tr>
  `).join('');
}

function renderUserPatchesTable(filter = '') {
  const tbody = $('userPatchesTableBody');
  if (!tbody) return;
  if (!syncedUnitDb?.userPatches?.length) {
    tbody.innerHTML = '<tr><td colspan="5" style="text-align:center; color:var(--text-secondary); padding:20px;">Click "Sync with Unit" to load all 128 User Patches from hardware.</td></tr>';
    return;
  }

  const q = filter.trim().toLowerCase();
  const list = syncedUnitDb.userPatches.filter(p => !q || p.name.toLowerCase().includes(q) || String(p.index).includes(q));

  const badge = $('patchCountBadge');
  if (badge) badge.textContent = `${list.length} of 128 Patches`;

  tbody.innerHTML = list.map(p => `
    <tr>
      <td style="font-family:var(--font-mono); font-weight:600; color:var(--text-accent);">User ${String(p.index).padStart(3, '0')}</td>
      <td style="font-weight:600; color:var(--text-primary);">${p.name}</td>
      <td>${p.category || 'General'}</td>
      <td>${p.level ?? 127}</td>
      <td style="text-align:center;">
        <button class="btn btn-sm btn-secondary" onclick="window.loadSyncedUserPatch(${p.index})">Load</button>
      </td>
    </tr>
  `).join('');
}

window.loadSyncedUserPerf = async function(index) {
  switchToTab('performance');
  const sel = $('userPerfSelect');
  if (sel && sel.value !== String(index)) sel.value = String(index);

  if (midi.isConnected) {
    try {
      // 1. Ensure synthesizer software state, UI badges, and hardware unit are in Performance Mode
      setSynthesizerMode(2, true);

      // Allow hardware CPU 50ms to switch modes before receiving selection commands
      await new Promise(r => setTimeout(r, 50));

      // 2. Command the physical XV-5050 hardware to switch its active Performance
      setStatus(`Switching XV-5050 hardware to User Performance ${index}...`);
      const perfCtrlCh = syncedUnitDb?.systemCommon?.perfCtrlChannel;
      sendActivePerformanceSelection(midi, index, getDeviceId(), perfCtrlCh);

      // 3. Allow hardware CPU to switch active performance buffers
      await new Promise(r => setTimeout(r, 120));

      // 4. Request complete performance data from hardware to update editor UI
      setStatus(`Reading complete User Performance ${index} from XV-5050 hardware...`);
      const fullPerf = await requestEntireUserPerformance(midi, index, getDeviceId());
      if (fullPerf.common) updatePerformanceCommonUI(fullPerf.common);
      if (fullPerf.mfxA) {
        perfMfxCache.A = fullPerf.mfxA;
        updatePerfMfxBadges('A', fullPerf.mfxA.mfxType);
      }
      if (fullPerf.mfxB) {
        perfMfxCache.B = fullPerf.mfxB;
        updatePerfMfxBadges('B', fullPerf.mfxB.mfxType);
      }
      if (fullPerf.mfxC) {
        perfMfxCache.C = fullPerf.mfxC;
        updatePerfMfxBadges('C', fullPerf.mfxC.mfxType);
      }
      if (perfMfxCache[activePerfMfxSlot]) {
        applyPerfMfxToUI(perfMfxCache[activePerfMfxSlot]);
      }
      if (fullPerf.chorus) updatePerformanceChorusUI(fullPerf.chorus);
      if (fullPerf.reverb) updatePerformanceReverbUI(fullPerf.reverb);
      if (Array.isArray(fullPerf.parts)) {
        fullPerf.parts.forEach((p, idx) => updatePartRow(idx + 1, p));
      }
      clearEdited();
      setStatus(`Switched XV-5050 to User Performance ${index}: "${fullPerf.common?.name || ''}"`);
      return;
    } catch (err) {
      console.warn('Hardware read failed, falling back to cached db:', err);
    }
  }

  if (!syncedUnitDb) return;
  const perf = syncedUnitDb.userPerformances.find(p => p.index === index);
  if (!perf) return;
  if (perf.raw) {
    const common = parsePerformanceCommon(perf.raw);
    updatePerformanceCommonUI(common);
    setStatus(`Loaded cached User Performance ${index}: "${perf.name}" into editor`);
  }
};

window.loadSyncedUserPatch = async function(index) {
  switchToTab('patch');
  const sel = $('userPatchSelect');
  if (sel && sel.value !== String(index)) sel.value = String(index);

  if (midi.isConnected) {
    try {
      if (currentSoundMode === 1) {
        // Single Patch Mode: Command hardware to switch its active Patch
        setStatus(`Switching XV-5050 hardware to User Patch ${index}...`);
        sendActivePatchSelection(midi, index, getDeviceId());
      } else {
        // Performance Mode: Assign User Patch to the active Part on the hardware
        const activePart = getEffectivePatchPart() || 1;
        setStatus(`Assigning User Patch ${index} to Part ${activePart} on XV-5050...`);
        sendPartPatchSelection(midi, activePart, index, getDeviceId());
      }

      await new Promise(r => setTimeout(r, 120));

      setStatus(`Reading complete User Patch ${index} (All 4 Tones & Waves) from XV-5050 hardware...`);
      const fullPatch = await requestEntireUserPatch(midi, index, getDeviceId());
      if (fullPatch.common) updatePatchCommonUI(fullPatch.common);
      if (fullPatch.mfx || fullPatch.chorus || fullPatch.reverb) {
        applyPatchEffectsToUI(fullPatch.mfx, fullPatch.chorus, fullPatch.reverb);
      }
      if (fullPatch.tmt) updatePatchTMTUI(fullPatch.tmt);
      if (Array.isArray(fullPatch.tones)) {
        fullPatch.tones.forEach((toneData, tIdx) => {
          currentToneCache[tIdx] = toneData;
        });
        const activeTone = currentToneCache[currentToneIndex - 1];
        if (activeTone) updateToneUI(activeTone);
      }
      const activePart = getEffectivePatchPart() || 1;
      const patchName = fullPatch.common?.name || `User ${String(index).padStart(3, '0')}`;
      const nameEl = $(`partPatchName${activePart}`);
      if (nameEl) nameEl.textContent = patchName;
      const msbEl = $(`partBankMSB${activePart}`);
      const lsbEl = $(`partBankLSB${activePart}`);
      const pcEl = $(`partPC${activePart}`);
      if (msbEl) msbEl.value = 87;
      if (lsbEl) lsbEl.value = 0;
      if (pcEl) pcEl.value = index;
      if (syncedUnitDb?.currentPerformance?.parts?.[activePart - 1]) {
        const p = syncedUnitDb.currentPerformance.parts[activePart - 1];
        p.patchName = patchName;
        p.patchBankMSB = 87;
        p.patchBankLSB = 0;
        p.patchPC = index;
        saveSyncedDbToStorage();
      }
      updateActivePartUI(activePart);
      clearEdited();
      setStatus(`Switched XV-5050 to User Patch ${index}: "${fullPatch.common?.name || ''}"`);
      return;
    } catch (err) {
      console.warn('Hardware read failed, falling back to cached db:', err);
    }
  }

  if (!syncedUnitDb) return;
  const patch = syncedUnitDb.userPatches.find(p => p.index === index);
  if (!patch) return;
  if (patch.raw) {
    const common = parsePatchCommon(patch.raw);
    updatePatchCommonUI(common);
    setStatus(`Loaded cached User Patch ${index}: "${patch.name}" into editor`);
  }
  const activePart = getEffectivePatchPart() || 1;
  const nameEl = $(`partPatchName${activePart}`);
  if (nameEl) nameEl.textContent = patch.name;
  updateActivePartUI(activePart);
};

function openWriteSlotModal(type) {
  if (!midi.isConnected) {
    setStatus('Cannot write: XV-5050 is not connected. Connect MIDI first.');
    return;
  }
  const modal = $('writeSlotModal');
  const title = $('writeSlotTitle');
  const prompt = $('writeSlotPrompt');
  const select = $('targetSlotSelect');
  if (!modal || !select) return;

  modal.dataset.type = type;
  select.innerHTML = '';

  if (type === 'performance') {
    title.textContent = '⬆ Write Performance to Hardware User Slot';
    prompt.textContent = 'Select destination User Performance slot (1-64) on your XV-5050:';
    for (let i = 1; i <= 64; i++) {
      const opt = document.createElement('option');
      opt.value = i;
      const cached = syncedUnitDb?.userPerformances?.find(p => p.index === i);
      opt.textContent = `User Perf ${String(i).padStart(2, '0')}${cached ? `: ${cached.name}` : ''}`;
      select.appendChild(opt);
    }
  } else {
    title.textContent = '⬆ Write Patch to Hardware User Slot';
    prompt.textContent = 'Select destination User Patch slot (1-128) on your XV-5050:';
    for (let i = 1; i <= 128; i++) {
      const opt = document.createElement('option');
      opt.value = i;
      const cached = syncedUnitDb?.userPatches?.find(p => p.index === i);
      opt.textContent = `User Patch ${String(i).padStart(3, '0')}${cached ? `: ${cached.name}` : ''}`;
      select.appendChild(opt);
    }
  }

  modal.style.display = 'flex';
}

async function handleConfirmWriteSlot() {
  const modal = $('writeSlotModal');
  const select = $('targetSlotSelect');
  if (!modal || !select) return;
  const slot = parseInt(select.value, 10);
  const type = modal.dataset.type;
  modal.style.display = 'none';

  if (!slot) return;

  if (type === 'performance') {
    try {
      setStatus(`Writing performance to User Performance slot ${slot}...`);
      const name = ($('perfName')?.value || 'USER PERF').padEnd(12, ' ').slice(0, 12);
      const commonRaw = new Array(53).fill(0);
      const encName = encodeName(name);
      for (let i = 0; i < 12; i++) commonRaw[i] = encName[i];

      const perfData = {
        common: { raw: commonRaw },
      };
      await sendEntireUserPerformance(midi, slot, perfData, getDeviceId());
      setStatus(`Successfully wrote performance "${name.trim()}" to User Slot ${slot}`);
    } catch (err) {
      setStatus(`Failed to write performance to slot ${slot}: ${err.message}`);
    }
  } else {
    try {
      setStatus(`Writing patch to User Patch slot ${slot}...`);
      const name = ($('patchName')?.value || 'USER PATCH').padEnd(12, ' ').slice(0, 12);
      const commonRaw = new Array(79).fill(0);
      const encName = encodeName(name);
      for (let i = 0; i < 12; i++) commonRaw[i] = encName[i];
      commonRaw[0x0E] = parseInt($('patchLevel')?.value, 10) || 127;

      const tmtRaw = new Array(41).fill(0);
      tmtRaw[0x05] = 1; // Tone 1 ON

      const patchData = {
        common: { raw: commonRaw },
        tmt: { raw: tmtRaw },
      };
      await sendEntireUserPatch(midi, slot, patchData, getDeviceId());
      setStatus(`Successfully wrote patch "${name.trim()}" to User Slot ${slot}`);
    } catch (err) {
      setStatus(`Failed to write patch to slot ${slot}: ${err.message}`);
    }
  }
}

async function handleAutoDetectId() {
  if (!midi.isConnected) {
    setStatus('Cannot detect ID: Connect MIDI ports first.');
    return;
  }
  setStatus('Scanning Device IDs 0x10 to 0x1F...');
  try {
    const detected = await detectDeviceId(midi);
    const sel = $('deviceId');
    if (sel) sel.value = String(detected);
    setStatus(`Auto-detected XV-5050 Device ID: 0x${detected.toString(16).toUpperCase()} (${detected + 1})`);
  } catch (err) {
    setStatus(`Device ID detection failed: ${err.message}`);
  }
}

async function executeHardwareDiagnostics() {
  if (!midi.isConnected) {
    setStatus('Cannot run diagnostics: XV-5050 is not connected. Connect MIDI first.');
    return;
  }
  const modal = $('diagnosticsModal');
  const container = $('diagStepsContainer');
  const bannerText = $('diagSummaryText');
  const bannerSub = $('diagSummarySub');
  if (!modal || !container) return;

  modal.style.display = 'flex';
  bannerText.textContent = 'Running Hardware Diagnostics...';
  bannerSub.textContent = `Testing XV-5050 on Device ID 0x${getDeviceId().toString(16).toUpperCase()}`;

  const stepNames = [
    'Device ID Handshake',
    'System & Setup Parameters',
    'Temporary Performance Common & Effects',
    'Temporary Patch & Tone Engine',
    'User Performance Bank Sample',
    'User Patch Bank Sample',
  ];

  container.innerHTML = stepNames.map((name, i) => `
    <div id="diagStepRow_${i}" style="display:flex; justify-content:space-between; align-items:center; padding:10px 14px; border-radius:6px; background:var(--bg-elevated); border:1px solid var(--border);">
      <div style="display:flex; align-items:center; gap:10px;">
        <span id="diagStepIcon_${i}" style="font-size:1.1rem;">⏳</span>
        <div>
          <div style="font-weight:600; font-size:0.88rem;">${name}</div>
          <div id="diagStepDetail_${i}" style="font-size:0.75rem; color:var(--text-dim);">Waiting to run...</div>
        </div>
      </div>
      <div id="diagStepLatency_${i}" style="font-size:0.8rem; font-family:monospace; color:var(--text-muted);">—</div>
    </div>
  `).join('');

  const report = await runHardwareDiagnostics(midi, getDeviceId(), (prog) => {
    const idx = stepNames.indexOf(prog.name);
    if (idx < 0) return;
    const icon = $(`diagStepIcon_${idx}`);
    const detail = $(`diagStepDetail_${idx}`);
    const lat = $(`diagStepLatency_${idx}`);

    if (prog.status === 'running') {
      if (icon) icon.textContent = '🔄';
      if (detail) detail.textContent = 'Communicating with hardware...';
    } else if (prog.status === 'passed') {
      if (icon) icon.textContent = '✅';
      if (detail) detail.textContent = 'Passed — Valid SysEx response received';
      if (lat) lat.textContent = `${prog.latencyMs} ms`;
    } else if (prog.status === 'failed') {
      if (icon) icon.textContent = '❌';
      if (detail) detail.textContent = `Failed: ${prog.error}`;
      if (lat) lat.textContent = 'ERR';
    }
  });

  if (report.overallSuccess) {
    bannerText.innerHTML = '<span style="color:var(--success);">✔ All Diagnostics Passed!</span>';
    bannerSub.textContent = `XV-5050 USB link verified healthy (${report.steps.length} checks passed).`;
    setStatus('XV-5050 USB Hardware Diagnostics: All 6 tests passed successfully.');
  } else {
    bannerText.innerHTML = '<span style="color:var(--danger);">✖ Diagnostics Encountered Issues</span>';
    bannerSub.textContent = 'One or more hardware SysEx checks failed. Check connection or Device ID.';
    setStatus('XV-5050 USB Hardware Diagnostics: Issues detected.');
  }
}

async function executeSyncWithUnit() {
  if (isSyncInProgress) return;
  isSyncInProgress = true;

  const modal = $('confirmSyncModal');
  if (modal) modal.style.display = 'none';

  const progModal = $('syncProgressModal');
  const progDetail = $('syncProgressDetail');
  const progBar = $('syncProgressBar');

  const setProgress = (percent, detail) => {
    if (progBar) progBar.style.width = `${percent}%`;
    if (progDetail) progDetail.textContent = detail;
    setStatus(`Sync: ${detail} (${percent}%)`);
  };

  if (progModal) progModal.style.display = 'flex';
  setProgress(2, 'Connecting to XV-5050...');

  let activeDb = null;
  let unitDb = null;
  try {
    const devId = getDeviceId();

    // Execute complete 6-stage entire unit sync with progressive selector updates
    unitDb = await syncEntireUnit(midi, devId, (pct, statusText, stage, currentDb) => {
      activeDb = currentDb;
      setProgress(pct, statusText);
      const db = currentDb || unitDb;
      if (db && (db.userPerformances?.length || db.userPatches?.length || db.currentPerformance?.parts?.length)) {
        syncedUnitDb = db;
        populateUserBankSelectors();
        populateAllInstrumentSelectors();
        renderPartNavigationStrip();
      }
    });

    syncedUnitDb = unitDb;

    // 1. Update Performance UI & 3-MFX
    try {
      if (unitDb.currentPerformance?.common) {
        updatePerformanceCommonUI(unitDb.currentPerformance.common);
        store.set('performance.common', unitDb.currentPerformance.common);
      }
      if (unitDb.currentPerformance?.mfxA) {
        perfMfxCache.A = unitDb.currentPerformance.mfxA;
        updatePerfMfxBadges('A', unitDb.currentPerformance.mfxA.mfxType);
      }
      if (unitDb.currentPerformance?.mfxB) {
        perfMfxCache.B = unitDb.currentPerformance.mfxB;
        updatePerfMfxBadges('B', unitDb.currentPerformance.mfxB.mfxType);
      }
      if (unitDb.currentPerformance?.mfxC) {
        perfMfxCache.C = unitDb.currentPerformance.mfxC;
        updatePerfMfxBadges('C', unitDb.currentPerformance.mfxC.mfxType);
      }
      if (perfMfxCache[activePerfMfxSlot]) {
        applyPerfMfxToUI(perfMfxCache[activePerfMfxSlot]);
      }
      if (unitDb.currentPerformance?.chorus) {
        updatePerformanceChorusUI(unitDb.currentPerformance.chorus);
        store.set('performance.effects.chorus', unitDb.currentPerformance.chorus);
      }
      if (unitDb.currentPerformance?.reverb) {
        updatePerformanceReverbUI(unitDb.currentPerformance.reverb);
        store.set('performance.effects.reverb', unitDb.currentPerformance.reverb);
      }
      if (Array.isArray(unitDb.currentPerformance?.parts)) {
        unitDb.currentPerformance.parts.forEach((p, idx) => {
          updatePartRow(idx + 1, p);
        });
        store.set('performance.parts', unitDb.currentPerformance.parts);
      }
    } catch (e) {
      console.warn('Non-fatal error updating performance UI:', e);
    }

    // 2. Cache & Update Active Patches for All 16 Parts & Patch Effects
    try {
      if (Array.isArray(unitDb.activePatches)) {
        unitDb.activePatches.forEach(ap => {
          activePartPatchesCache[ap.part] = ap;
        });
        const activePart = getSelectedPart();
        const currentPatch = activePartPatchesCache[activePart] || unitDb.activePatches[0];
        if (currentPatch) {
          if (currentPatch.common) {
            updatePatchCommonUI(currentPatch.common);
            store.set('patch.common', currentPatch.common);
          }
          if (currentPatch.mfx || currentPatch.chorus || currentPatch.reverb) {
            applyPatchEffectsToUI(currentPatch.mfx, currentPatch.chorus, currentPatch.reverb);
          }
          if (currentPatch.tmt) {
            updatePatchTMTUI(currentPatch.tmt);
            store.set('patch.tmt', currentPatch.tmt);
          }
          if (Array.isArray(currentPatch.tones)) {
            currentPatch.tones.forEach((toneData, tIdx) => {
              store.set(`patch.tones.${tIdx}`, toneData);
              currentToneCache[tIdx] = toneData;
            });
            const activeTone = currentToneCache[currentToneIndex - 1];
            if (activeTone) updateToneUI(activeTone);
          }
        }
      }
    } catch (e) {
      console.warn('Non-fatal error updating patch UI:', e);
    }

    // 3. Populate User Bank Selectors, Instrument Selectors, Part Strip and Tables
    populateUserBankSelectors();
    populateAllInstrumentSelectors();
    renderPartNavigationStrip();
    renderUserPerfsTable();
    renderUserPatchesTable();
    saveSyncedDbToStorage();

    if (unitDb?.setup?.soundMode) {
      setSynthesizerMode(unitDb.setup.soundMode, false);
    }

    setProgress(100, 'Entire Unit Sync Complete!');
    clearEdited();
    setStatus('✓ Successfully synchronized entire XV-5050 unit: Setup, System, Current Performance, 64 User Performances, 128 User Patches, 4 User Rhythm Sets');

    setTimeout(() => {
      if (progModal) progModal.style.display = 'none';
    }, 600);

  } catch (err) {
    if (progModal) progModal.style.display = 'none';
    const fallbackDb = unitDb || activeDb;
    if (fallbackDb && (fallbackDb.userPerformances?.length || fallbackDb.userPatches?.length || fallbackDb.currentPerformance?.parts?.length)) {
      syncedUnitDb = fallbackDb;
      populateUserBankSelectors();
      populateAllInstrumentSelectors();
      renderPartNavigationStrip();
      renderUserPerfsTable();
      renderUserPatchesTable();
      saveSyncedDbToStorage();
    }
    setStatus(`Sync completed with warning: ${err.message}`);
    console.error('Entire Unit Sync failed:', err);
  } finally {
    isSyncInProgress = false;
  }
}

// =============================================================================
// Theme Switcher System (8 Synthesizer Schemes, Persisted in Browser Storage)
// =============================================================================

export const THEMES = [
  { id: 'native-silver', name: 'XV-5050 Native', icon: '🎛️', desc: 'Brushed Silver Chassis with Amber Dot-Matrix LCD' },
  { id: 'cyber-cyan', name: 'Cyber Cyan', icon: '⚡', desc: 'Deep Space Obsidian with Electric Cyan' },
  { id: 'vintage-jd', name: 'Roland JD Classic', icon: '🎹', desc: 'Charcoal JD-800 Vintage Rack with Orange & Blue' },
  { id: 'oled-obsidian', name: 'OLED Obsidian', icon: '🌑', desc: 'Monochrome High-Contrast Pitch Black' },
  { id: 'emerald-matrix', name: 'Emerald Matrix', icon: '📟', desc: 'Neon Phosphor Green CRT & Dot Matrix' },
  { id: 'solar-amber', name: 'Solar Amber', icon: '☀️', desc: 'Warm Tube Valve & Analog Copper Glow' },
  { id: 'midnight-uv', name: 'Midnight UV', icon: '🔮', desc: 'Synthwave Deep Violet & Electric Magenta' },
  { id: 'studio-slate', name: 'Studio Slate', icon: '🎚️', desc: 'Pro Audio Titanium & Neutral Slate Gray' }
];

export function applyTheme(themeId, persist = true) {
  const theme = THEMES.find(t => t.id === themeId) || THEMES[0];
  document.documentElement.setAttribute('data-theme', theme.id);
  const badge = $('themeNameBadge');
  if (badge) {
    badge.textContent = `${theme.icon} ${theme.name}`;
  }
  const btn = $('themeCycleBtn');
  if (btn) {
    const nextTheme = THEMES[(THEMES.indexOf(theme) + 1) % THEMES.length];
    btn.title = `Current Scheme: ${theme.name} (${theme.desc})\nClick to cycle to: ${nextTheme.name}`;
  }
  if (persist) {
    try {
      localStorage.setItem('xv5050_theme', theme.id);
    } catch (e) {
      console.warn('Could not save theme to localStorage', e);
    }
  }
}

export function cycleNextTheme() {
  const current = document.documentElement.getAttribute('data-theme') || 'native-silver';
  const currentIndex = THEMES.findIndex(t => t.id === current);
  const nextIndex = (currentIndex + 1) % THEMES.length;
  applyTheme(THEMES[nextIndex].id, true);
  setStatus(`Color Theme: ${THEMES[nextIndex].name}`);
}

export function initThemeManager() {
  let savedTheme = 'native-silver';
  try {
    savedTheme = localStorage.getItem('xv5050_theme') || 'native-silver';
  } catch (e) {
    console.warn('Could not read theme from localStorage', e);
  }
  applyTheme(savedTheme, false);

  const cycleBtn = $('themeCycleBtn');
  if (cycleBtn) {
    cycleBtn.addEventListener('click', cycleNextTheme);
  }
}

// =============================================================================
// Initialization
// =============================================================================

function init() {
  buildPartsTable();
  initTabs();
  initEditTracking();

  bindPerformanceCommonControls();
  bindPerfMfxControls();
  bindPatchControls();
  bindPatchEffectsControls();
  initLibrarianControls();

  // Top header actions
  $('connectBtn').addEventListener('click', connectMidi);
  $('refreshBtn').addEventListener('click', refreshDeviceList);
  $('panicBtn').addEventListener('click', handlePanic);
  $('auditionBtn').addEventListener('click', handleAudition);
  $('clearLogBtn').addEventListener('click', clearLog);

  // Hardware Mode Switcher buttons
  const btnModePerform = $('modeBtnPerform');
  if (btnModePerform) {
    btnModePerform.addEventListener('click', () => setSynthesizerMode(2, true));
  }
  const btnModePatch = $('modeBtnPatch');
  if (btnModePatch) {
    btnModePatch.addEventListener('click', () => {
      setSynthesizerMode(1, true);
      switchToTab('patch');
    });
  }

  // Collapsible System Drawer Toggle & Close
  const btnToggleDrawer = $('btnToggleSystemDrawer');
  if (btnToggleDrawer) {
    btnToggleDrawer.addEventListener('click', () => toggleSystemDrawer());
  }
  const btnCloseDrawer = $('btnCloseSystemDrawer');
  if (btnCloseDrawer) {
    btnCloseDrawer.addEventListener('click', () => toggleSystemDrawer(false));
  }

  // Sync with Unit & Modals
  const syncBtn = $('syncWithUnitBtn');
  if (syncBtn) syncBtn.addEventListener('click', handleSyncWithUnit);

  const cancelSync = $('cancelSyncBtn');
  if (cancelSync) cancelSync.addEventListener('click', () => {
    $('confirmSyncModal').style.display = 'none';
  });

  const proceedSync = $('proceedSyncBtn');
  if (proceedSync) proceedSync.addEventListener('click', executeSyncWithUnit);

  // Performance loader buttons
  const entirePerfBtn = $('loadEntirePerfBtn');
  if (entirePerfBtn) entirePerfBtn.addEventListener('click', loadEntirePerformanceData);
  $('loadPerfBtn').addEventListener('click', loadPerformanceCommon);
  $('loadPerfFxBtn').addEventListener('click', loadPerformanceFx);
  $('loadAllPartsBtn').addEventListener('click', loadAllPartsData);

  // User Bank dropdown quick selectors
  const userPerfSelect = $('userPerfSelect');
  if (userPerfSelect) {
    userPerfSelect.addEventListener('change', (e) => {
      const val = parseInt(e.target.value, 10);
      if (val) window.loadSyncedUserPerf(val);
    });
  }

  const userPatchSelect = $('userPatchSelect');
  if (userPatchSelect) {
    userPatchSelect.addEventListener('change', (e) => {
      const val = parseInt(e.target.value, 10);
      if (val) window.loadSyncedUserPatch(val);
    });
  }

  // Part selector change updates patch view from cached active patches
  const patchPartSelect = $('patchPartSelect');
  if (patchPartSelect) {
    patchPartSelect.addEventListener('change', () => {
      const part = parseInt(patchPartSelect.value, 10);
      selectPart(part);
    });
  }

  // Instrument selector on Patch & Tones tab
  const patchInstSelect = $('patchInstrumentSelect');
  if (patchInstSelect) {
    patchInstSelect.addEventListener('change', (e) => {
      const activePart = getEffectivePatchPart() || 1;
      handleInstrumentSelection(activePart, e.target.value);
    });
  }

  // Back to Performance Mixer button
  const btnBackMixer = $('btnBackToPerfMixer');
  if (btnBackMixer) {
    btnBackMixer.addEventListener('click', () => {
      switchToTab('performance');
      const activePart = getEffectivePatchPart() || 1;
      const row = $(`partRow${activePart}`);
      if (row) {
        row.scrollIntoView({ behavior: 'smooth', block: 'center' });
        row.classList.add('selected');
      }
    });
  }

  // Solo mode toggle button
  const btnSoloToggle = $('btnSoloModeToggle');
  if (btnSoloToggle) {
    btnSoloToggle.addEventListener('click', () => {
      if (currentSoundMode === 1) {
        setSynthesizerMode(2, true);
        selectPart(1);
      } else {
        setSynthesizerMode(1, true);
        selectPart(0);
      }
    });
  }

  // Full Unit Backup & Hardware Inventory
  const btnExportFullBackup = $('btnExportFullBackupSyx');
  if (btnExportFullBackup) {
    btnExportFullBackup.addEventListener('click', () => {
      if (!syncedUnitDb) {
        setStatus('Please click "Sync with Unit" first to dump the unit data before exporting full backup.');
        return;
      }
      const bytes = exportFullUnitBackup(syncedUnitDb, getDeviceId());
      const blob = new Blob([bytes], { type: 'application/octet-stream' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `XV5050_Full_Unit_Backup_${new Date().toISOString().slice(0, 10)}.syx`;
      a.click();
      URL.revokeObjectURL(url);
      setStatus(`Downloaded full unit backup (${bytes.length} bytes, 64 User Perfs, 128 User Patches)`);
    });
  }

  const btnInvPerfs = $('btnInvPerfs');
  const btnInvPatches = $('btnInvPatches');
  const invPerfsPane = $('invPerfsPane');
  const invPatchesPane = $('invPatchesPane');

  if (btnInvPerfs && btnInvPatches && invPerfsPane && invPatchesPane) {
    btnInvPerfs.addEventListener('click', () => {
      btnInvPerfs.classList.add('active');
      btnInvPatches.classList.remove('active');
      invPerfsPane.style.display = 'block';
      invPatchesPane.style.display = 'none';
    });
    btnInvPatches.addEventListener('click', () => {
      btnInvPatches.classList.add('active');
      btnInvPerfs.classList.remove('active');
      invPerfsPane.style.display = 'none';
      invPatchesPane.style.display = 'block';
    });
  }

  const perfSearchInput = $('perfSearchInput');
  if (perfSearchInput) {
    perfSearchInput.addEventListener('input', (e) => renderUserPerfsTable(e.target.value));
  }

  const patchSearchInput = $('patchSearchInput');
  if (patchSearchInput) {
    patchSearchInput.addEventListener('input', (e) => renderUserPatchesTable(e.target.value));
  }

  const refreshInvBtn = $('refreshInventoryBtn');
  if (refreshInvBtn) {
    refreshInvBtn.addEventListener('click', handleSyncWithUnit);
  }

  // Auto-Detect Device ID
  const btnAutoDetect = $('btnAutoDetectId');
  if (btnAutoDetect) {
    btnAutoDetect.addEventListener('click', handleAutoDetectId);
  }

  // USB Hardware Diagnostics
  const btnRunDiag = $('btnRunDiagnostics');
  if (btnRunDiag) {
    btnRunDiag.addEventListener('click', executeHardwareDiagnostics);
  }
  const runDiagAgain = $('runDiagAgainBtn');
  if (runDiagAgain) {
    runDiagAgain.addEventListener('click', executeHardwareDiagnostics);
  }
  const closeDiag = $('closeDiagBtn');
  if (closeDiag) {
    closeDiag.addEventListener('click', () => {
      const modal = $('diagnosticsModal');
      if (modal) modal.style.display = 'none';
    });
  }

  // Write to User Memory Slot Modals
  const btnWritePerf = $('btnWritePerfSlot');
  if (btnWritePerf) {
    btnWritePerf.addEventListener('click', () => openWriteSlotModal('performance'));
  }
  const btnWritePatch = $('btnWritePatchSlot');
  if (btnWritePatch) {
    btnWritePatch.addEventListener('click', () => openWriteSlotModal('patch'));
  }
  const cancelWriteSlot = $('cancelWriteSlotBtn');
  if (cancelWriteSlot) {
    cancelWriteSlot.addEventListener('click', () => {
      const modal = $('writeSlotModal');
      if (modal) modal.style.display = 'none';
    });
  }
  const confirmWriteSlot = $('confirmWriteSlotBtn');
  if (confirmWriteSlot) {
    confirmWriteSlot.addEventListener('click', handleConfirmWriteSlot);
  }

  // MIDI port hotplug
  midi.onStateChange((info) => {
    if (info.state === 'disconnected' && !midi.isConnected) {
      setConnectionStatus(false);
      $('connectBtn').textContent = 'Connect';
      setStatus(`Device disconnected: ${info.name}`);
    }
    refreshDeviceList();
  });

  initThemeManager();
  initMidi();
  renderPartNavigationStrip();
  populateAllInstrumentSelectors();
  restoreSyncedDbFromStorage();
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init);
} else {
  init();
}
