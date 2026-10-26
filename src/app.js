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
  ROLAND_PRESET_PERFORMANCES,
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
  initInteractiveEnvelopes,
  syncEnvelopeHandles,
  syncAllEnvelopeHandles,
} from './interactive_envelope.js';
import { SRX_BOARDS, getSrxBoard, getSrxWaveforms, getSrxPatches } from './srx_data.js';
import { SCALE_TEMPERAMENTS, buildPartScaleTemperamentDT1 } from './scale_tune.js';
import { DRUM_KEY_MAP, DRUM_OCTAVES, DRUM_HIT_LIBRARY, RHYTHM_KEY_OFFSETS, buildRhythmKeyDT1, sendRhythmKeyParam, encodeWaveNibbles } from './rhythm.js';
import { mutatePatch, randomizeWaveforms, MutatorHistory } from './mutator.js';
import { MACRO_DEFINITIONS, calculateVectorMorphLevels, generateSpectrumPath } from './deep_patch.js';
import { RotaryKnob, createSyncedKnob } from './rotary_knob.js';
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
import {
  transpileVstFile,
  buildTranspiledPatchSyx,
  VST_DEMO_PATCHES,
  parseVitalPatch,
} from './vst_transpiler.js';
import {
  ROLAND_PRESET_A_PATCHES,
  ROLAND_PRESET_B_PATCHES,
  ROLAND_PRESET_C_PATCHES,
  ROLAND_PRESET_D_PATCHES,
  ROLAND_PRESET_E_PATCHES,
  ROLAND_PRESET_F_PATCHES,
  ROLAND_PRESET_G_PATCHES,
  ROLAND_PRESET_H_PATCHES,
  ROLAND_GM2_PATCHES,
  ROLAND_PRESET_DRUM_KITS,
  ROLAND_USER_DRUM_KITS,
  getPresetPatchName,
} from './preset_patches.js';

// =============================================================================
// Initialization
// =============================================================================

const midi = new MidiManager();
const store = createStore();

const $ = (id) => document.getElementById(id);

let currentToneIndex = 1; // 1-4
let activeAuditionTimeout = null;
let currentSoundMode = 2; // 1 = PATCH, 2 = PERFORM
const activePartPatchesCache = {};
let isAutoSyncingPatch = false;
const partKnobs = {};
if (typeof window !== 'undefined') window.partKnobs = partKnobs;

/**
 * Automatically fetch the active patch from hardware and synchronize UI.
 * Queries the XV-5050 hardware unit's temporary edit buffer directly.
 * @param {number} [partNumber] - Part 1-16 or 0 for Single Patch mode
 */
async function autoSyncActivePatchFromHardware(partNumber) {
  if (!midi.isConnected) return;
  if (isAutoSyncingPatch) return;
  isAutoSyncingPatch = true;

  const targetPart = (partNumber !== undefined && partNumber !== null) ? partNumber : getEffectivePatchPart();
  const label = targetPart === 0 ? 'Single Patch' : ('Part ' + targetPart + ' Patch');
  setStatus('Auto-syncing ' + label + ' directly from XV-5050 hardware...');

  try {
    const patch = await requestEntirePatch(midi, targetPart, getDeviceId(), (stage, cur, total) => {
      setStatus('Syncing ' + label + ' from unit: ' + stage + ' (' + (cur + 1) + '/' + total + ')...');
    });

    if (!patch) {
      isAutoSyncingPatch = false;
      return;
    }

    activePartPatchesCache[targetPart] = patch;

    if (patch.common) {
      updatePatchCommonUI(patch.common);
      store.set('patch.common', patch.common);
    }

    if (patch.tmt) {
      updatePatchTMTUI(patch.tmt);
      store.set('patch.tmt', patch.tmt);
    }

    if (Array.isArray(patch.tones)) {
      patch.tones.forEach((toneData, idx) => {
        store.set('patch.tones.' + idx, toneData);
        currentToneCache[idx] = toneData;
      });
      const activeTone = currentToneCache[currentToneIndex - 1];
      if (activeTone) updateToneUI(activeTone);
    }

    if (patch.mfx || patch.chorus || patch.reverb) {
      applyPatchEffectsToUI(patch.mfx, patch.chorus, patch.reverb);
    }

    if (typeof syncDeepStudioToneCards === 'function') syncDeepStudioToneCards();
    if (typeof updateDeepStudioSpectrum === 'function') updateDeepStudioSpectrum();
    updateActivePartUI(targetPart);

    const name = patch.common?.name || 'Sound';
    setStatus('✓ In sync with unit: "' + name + '" (' + label + ')');
  } catch (err) {
    console.warn('Auto-sync failed for ' + label + ':', err);
    setStatus('Note: Could not auto-sync ' + label + ' (' + err.message + '). Click "Read Sound from Hardware" to retry.');
  } finally {
    isAutoSyncingPatch = false;
  }
}

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
  const previousMode = currentSoundMode;
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
      autoSyncActivePatchFromHardware(0);
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
      const activePart = getSelectedPart() || 1;
      autoSyncActivePatchFromHardware(activePart);
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
  const dawSelect = $('midiDawThru');
  if (!inputSelect || !outputSelect) return;

  const prevInput = inputSelect.value || localStorage.getItem('xv5050_midi_input') || '';
  const prevOutput = outputSelect.value || localStorage.getItem('xv5050_midi_output') || '';
  const prevDaw = (dawSelect && dawSelect.value) ? dawSelect.value : (localStorage.getItem('xv5050_daw_thru') || '');

  inputSelect.innerHTML = '<option value="">— Select MIDI Input —</option>';
  outputSelect.innerHTML = '<option value="">— Select MIDI Output —</option>';
  if (dawSelect) {
    dawSelect.innerHTML = '<option value="">— None (Disabled) —</option>';
  }

  const inputs = midi.getInputs();
  const outputs = midi.getOutputs();

  for (const dev of inputs) {
    const opt = document.createElement('option');
    opt.value = dev.id;
    opt.textContent = dev.name;
    if (dev.id === prevInput || (!prevInput && dev.name.includes('XV-5050'))) {
      opt.selected = true;
    }
    inputSelect.appendChild(opt);

    if (dawSelect) {
      const dawOpt = document.createElement('option');
      dawOpt.value = dev.id;
      const isLoop = dev.name.toLowerCase().includes('loop') || dev.name.toLowerCase().includes('virtual');
      dawOpt.textContent = `${dev.name}${isLoop ? ' (Virtual Cable)' : ''}`;
      if (dev.id === prevDaw) {
        dawOpt.selected = true;
      }
      dawSelect.appendChild(dawOpt);
    }
  }

  if (dawSelect && prevDaw) {
    dawSelect.value = prevDaw;
  }

  for (const dev of outputs) {
    const opt = document.createElement('option');
    opt.value = dev.id;
    opt.textContent = dev.name;
    if (dev.id === prevOutput || (!prevOutput && dev.name.includes('XV-5050'))) {
      opt.selected = true;
    }
    outputSelect.appendChild(opt);
  }

  setStatus(`Found ${inputs.length} input(s), ${outputs.length} output(s)`);
}

async function connectMidi() {
  const inputId = $('midiInput')?.value;
  const outputId = $('midiOutput')?.value;
  const dawThruId = $('midiDawThru')?.value || localStorage.getItem('xv5050_daw_thru') || '';

  if (!inputId || !outputId) {
    setStatus('Please select both input and output ports');
    return;
  }

  // Persist selections
  localStorage.setItem('xv5050_midi_input', inputId);
  localStorage.setItem('xv5050_midi_output', outputId);
  if (dawThruId) {
    localStorage.setItem('xv5050_daw_thru', dawThruId);
  }

  if (midi.isConnected) {
    await midi.disconnect();
    setConnectionStatus(false);
    $('connectBtn').textContent = 'Connect';
    setDeviceInfo('');
    setStatus('Disconnected (MIDI driver released)');
    if ($('midiDawThru') && dawThruId) {
      $('midiDawThru').value = dawThruId;
    }
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

    if (dawThruId) {
      await midi.setDawThruInput(dawThruId);
      if ($('midiDawThru')) {
        $('midiDawThru').value = dawThruId;
      }
      setStatus(`Connected to XV-5050 with DAW Thru active (${midi.dawInputName})`);
    }

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

// In-memory buffer for real-time traffic logging to avoid DOM thrashing and audio hiccups
const trafficBuffer = [];
let trafficRenderQueued = false;

function renderTrafficBuffer() {
  const tbody = $('trafficLogBody');
  const isMonitorActive = $('monitorTab')?.classList.contains('active');
  if (!tbody || !isMonitorActive) {
    trafficRenderQueued = false;
    return;
  }

  const fragment = document.createDocumentFragment();
  while (trafficBuffer.length > 0) {
    const item = trafficBuffer.shift();
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td>${item.timeStr}</td>
      <td><span class="log-badge ${item.direction.toLowerCase()}">${item.direction}</span></td>
      <td>${item.cmd}</td>
      <td style="font-family:var(--font-mono);">${item.addrStr}</td>
      <td>${item.sizeStr}</td>
      <td class="log-raw">${item.rawHex}</td>
    `;
    fragment.insertBefore(tr, fragment.firstChild);
  }
  tbody.insertBefore(fragment, tbody.firstChild);

  while (tbody.children.length > 150) {
    tbody.removeChild(tbody.lastChild);
  }
  trafficRenderQueued = false;
}

function handleTraffic(direction, bytes, timestamp) {
  if (!bytes || bytes.length === 0) return;
  const isSysEx = bytes[0] === 0xF0;
  const isMonitorActive = $('monitorTab')?.classList.contains('active');

  // Skip high-frequency channel voice messages (Note On/Off, CC) unless the monitor tab is actively open
  if (!isSysEx && !isMonitorActive) {
    return;
  }

  const date = new Date(timestamp);
  const timeStr = date.toTimeString().split(' ')[0] + '.' + String(date.getMilliseconds()).padStart(3, '0');

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
    else if (status === 0xE0) cmd = 'PitchBend';
  }

  trafficBuffer.push({
    timeStr,
    direction,
    cmd,
    addrStr,
    sizeStr,
    rawHex: formatSysEx(bytes)
  });

  if (trafficBuffer.length > 150) {
    trafficBuffer.shift();
  }

  if (isMonitorActive && !trafficRenderQueued) {
    trafficRenderQueued = true;
    requestAnimationFrame(renderTrafficBuffer);
  }
}

function clearLog() {
  trafficBuffer.length = 0;
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
      if (prefix === 'patchMfx' && patchMfxKnobs.params && patchMfxKnobs.params[i]) {
        const knob = patchMfxKnobs.params[i];
        knob.min = paramDef.min;
        knob.max = paramDef.max;
        knob.bipolar = (paramDef.min < 0);
        knob.setValue(parseFloat(input.value) || paramDef.min, false);
      }
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
    ind.textContent = `Editing MFX-${activePerfMfxSlot}`;
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

  if ($('patchChorusRate')) {
    $('patchChorusRate').addEventListener('input', () => {
      const val = parseInt($('patchChorusRate').value, 10);
      $('patchChorusRateVal').textContent = val;
      if (!midi.isConnected) return;
      const part = parseInt($('patchPartSelect')?.value || '0', 10);
      sendThrottled('patchChorusRate', () => {
        sendPatchChorusParam(midi, part, 'RATE', val, getDeviceId());
      });
    });
  }

  if ($('patchChorusDepth')) {
    $('patchChorusDepth').addEventListener('input', () => {
      const val = parseInt($('patchChorusDepth').value, 10);
      $('patchChorusDepthVal').textContent = val;
      if (!midi.isConnected) return;
      const part = parseInt($('patchPartSelect')?.value || '0', 10);
      sendThrottled('patchChorusDepth', () => {
        sendPatchChorusParam(midi, part, 'DEPTH', val, getDeviceId());
      });
    });
  }

  if ($('patchChorusRevSend')) {
    $('patchChorusRevSend').addEventListener('input', () => {
      const val = parseInt($('patchChorusRevSend').value, 10);
      $('patchChorusRevSendVal').textContent = val;
      if (!midi.isConnected) return;
      const part = parseInt($('patchPartSelect')?.value || '0', 10);
      sendThrottled('patchChorusRevSend', () => {
        sendPatchChorusParam(midi, part, 'REV_SEND', val, getDeviceId());
      });
    });
  }

  if ($('patchChorusOutputAssign')) {
    $('patchChorusOutputAssign').addEventListener('change', () => {
      if (!midi.isConnected) return;
      const part = parseInt($('patchPartSelect')?.value || '0', 10);
      sendPatchChorusParam(midi, part, 'OUTPUT_ASSIGN', parseInt($('patchChorusOutputAssign').value, 10), getDeviceId());
    });
  }

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

  if ($('patchReverbTime')) {
    $('patchReverbTime').addEventListener('input', () => {
      const val = parseInt($('patchReverbTime').value, 10);
      $('patchReverbTimeVal').textContent = val;
      if (!midi.isConnected) return;
      const part = parseInt($('patchPartSelect')?.value || '0', 10);
      sendThrottled('patchReverbTime', () => {
        sendPatchReverbParam(midi, part, 'TIME', val, getDeviceId());
      });
    });
  }

  if ($('patchReverbHfDamp')) {
    $('patchReverbHfDamp').addEventListener('input', () => {
      const val = parseInt($('patchReverbHfDamp').value, 10);
      $('patchReverbHfDampVal').textContent = val;
      if (!midi.isConnected) return;
      const part = parseInt($('patchPartSelect')?.value || '0', 10);
      sendThrottled('patchReverbHfDamp', () => {
        sendPatchReverbParam(midi, part, 'HF_DAMP', val, getDeviceId());
      });
    });
  }

  if ($('patchReverbOutputAssign')) {
    $('patchReverbOutputAssign').addEventListener('change', () => {
      if (!midi.isConnected) return;
      const part = parseInt($('patchPartSelect')?.value || '0', 10);
      sendPatchReverbParam(midi, part, 'OUTPUT_ASSIGN', parseInt($('patchReverbOutputAssign').value, 10), getDeviceId());
    });
  }

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
    if ($('patchChorusRate')) {
      $('patchChorusRate').value = choData.rate ?? 32;
      $('patchChorusRateVal').textContent = choData.rate ?? 32;
    }
    if ($('patchChorusDepth')) {
      $('patchChorusDepth').value = choData.depth ?? 64;
      $('patchChorusDepthVal').textContent = choData.depth ?? 64;
    }
    if ($('patchChorusRevSend')) {
      $('patchChorusRevSend').value = choData.revSend ?? 0;
      $('patchChorusRevSendVal').textContent = choData.revSend ?? 0;
    }
    if ($('patchChorusOutputAssign')) {
      $('patchChorusOutputAssign').value = choData.outputAssign ?? 0;
    }
  }

  if (revData) {
    if ($('patchReverbType')) $('patchReverbType').value = revData.reverbType ?? 1;
    if ($('patchReverbLevel')) {
      $('patchReverbLevel').value = revData.reverbLevel ?? 64;
      $('patchReverbLevelVal').textContent = revData.reverbLevel ?? 64;
    }
    if ($('patchReverbTime')) {
      $('patchReverbTime').value = revData.time ?? 64;
      $('patchReverbTimeVal').textContent = revData.time ?? 64;
    }
    if ($('patchReverbHfDamp')) {
      $('patchReverbHfDamp').value = revData.hfDamp ?? 17;
      $('patchReverbHfDampVal').textContent = revData.hfDamp ?? 17;
    }
    if ($('patchReverbOutputAssign')) {
      $('patchReverbOutputAssign').value = revData.outputAssign ?? 0;
    }
  }
}

// Precision Hardware Rotary Knobs
export const patchMasterKnobs = {};
export const patchMfxKnobs = { params: [] };
export const patchChorusKnobs = {};
export const patchReverbKnobs = {};
export const toneKnobs = {};

function initHardwareRotaryKnobs() {
  // 1. Patch Master & Voice Controls
  patchMasterKnobs.level = createSyncedKnob('knobWrapPatchLevel', 'patchLevel', {
    label: 'LEVEL',
    min: 0,
    max: 127,
    defaultValue: 127,
    color: '#ff7700',
    formatValue: v => String(v)
  });

  patchMasterKnobs.pan = createSyncedKnob('knobWrapPatchPan', 'patchPan', {
    label: 'PAN',
    min: 0,
    max: 127,
    defaultValue: 64,
    bipolar: true,
    color: '#ff7700',
    formatValue: v => panDisplay(v)
  });

  patchMasterKnobs.octave = createSyncedKnob('knobWrapPatchOctave', 'patchOctaveShift', {
    label: 'OCTAVE',
    min: 61,
    max: 67,
    defaultValue: 64,
    bipolar: true,
    color: '#38bdf8',
    formatValue: v => (v - 64 > 0 ? `+${v - 64}` : `${v - 64}`)
  });

  patchMasterKnobs.coarse = createSyncedKnob('knobWrapPatchCoarseTune', 'patchCoarseTune', {
    label: 'COARSE',
    min: 16,
    max: 112,
    defaultValue: 64,
    bipolar: true,
    color: '#38bdf8',
    formatValue: v => (v - 64 > 0 ? `+${v - 64}` : `${v - 64}`)
  });

  patchMasterKnobs.fine = createSyncedKnob('knobWrapPatchFineTune', 'patchFineTune', {
    label: 'FINE',
    min: 14,
    max: 114,
    defaultValue: 64,
    bipolar: true,
    color: '#38bdf8',
    formatValue: v => (v - 64 > 0 ? `+${v - 64}` : `${v - 64}`)
  });

  patchMasterKnobs.portaTime = createSyncedKnob('knobWrapPatchPortaTime', 'patchPortaTime', {
    label: 'PORTA',
    min: 0,
    max: 127,
    defaultValue: 0,
    color: '#a78bfa',
    formatValue: v => String(v)
  });

  // 2. Patch Multi-Effects (MFX) Common
  patchMfxKnobs.dryLevel = createSyncedKnob('knobWrapPatchMfxDryLevel', 'patchMfxDryLevel', {
    label: 'DRY LEVEL',
    min: 0,
    max: 127,
    defaultValue: 127,
    color: '#ff7700'
  });

  patchMfxKnobs.chorusSend = createSyncedKnob('knobWrapPatchMfxChorusSend', 'patchMfxChorusSend', {
    label: 'CHO SEND',
    min: 0,
    max: 127,
    defaultValue: 0,
    color: '#38bdf8'
  });

  patchMfxKnobs.reverbSend = createSyncedKnob('knobWrapPatchMfxReverbSend', 'patchMfxReverbSend', {
    label: 'REV SEND',
    min: 0,
    max: 127,
    defaultValue: 0,
    color: '#a78bfa'
  });

  // 12 Algorithm Parameters
  for (let i = 1; i <= 12; i++) {
    patchMfxKnobs.params[i] = createSyncedKnob(`knobWrapPatchMfxParam${i}`, `patchMfxParam${i}`, {
      label: `P${i}`,
      min: 0,
      max: 127,
      defaultValue: 64,
      color: '#ff9f1c',
      formatValue: (v) => {
        const input = $(`patchMfxParam${i}`);
        const valEl = $(`patchMfxParamVal${i}`);
        if (input && valEl) {
          formatMfxParamValue(input, valEl);
          return valEl.textContent || String(v);
        }
        return String(v);
      }
    });
  }

  // 3. Patch Chorus Encoders
  patchChorusKnobs.level = createSyncedKnob('knobWrapPatchChorusLevel', 'patchChorusLevel', {
    label: 'LEVEL',
    min: 0,
    max: 127,
    defaultValue: 64,
    color: '#ff7700'
  });

  patchChorusKnobs.rate = createSyncedKnob('knobWrapPatchChorusRate', 'patchChorusRate', {
    label: 'RATE',
    min: 0,
    max: 127,
    defaultValue: 32,
    color: '#38bdf8'
  });

  patchChorusKnobs.depth = createSyncedKnob('knobWrapPatchChorusDepth', 'patchChorusDepth', {
    label: 'DEPTH',
    min: 0,
    max: 127,
    defaultValue: 64,
    color: '#38bdf8'
  });

  patchChorusKnobs.revSend = createSyncedKnob('knobWrapPatchChorusRevSend', 'patchChorusRevSend', {
    label: 'REV SEND',
    min: 0,
    max: 127,
    defaultValue: 0,
    color: '#a78bfa'
  });

  // 4. Patch Reverb Encoders
  patchReverbKnobs.level = createSyncedKnob('knobWrapPatchReverbLevel', 'patchReverbLevel', {
    label: 'LEVEL',
    min: 0,
    max: 127,
    defaultValue: 64,
    color: '#ff7700'
  });

  patchReverbKnobs.time = createSyncedKnob('knobWrapPatchReverbTime', 'patchReverbTime', {
    label: 'TIME',
    min: 0,
    max: 127,
    defaultValue: 64,
    color: '#a78bfa'
  });

  patchReverbKnobs.hfDamp = createSyncedKnob('knobWrapPatchReverbHfDamp', 'patchReverbHfDamp', {
    label: 'HF DAMP',
    min: 0,
    max: 17,
    defaultValue: 17,
    color: '#a78bfa',
    formatValue: v => String(v)
  });

  // 5. Tone Level & Tuning Encoders
  toneKnobs.level = createSyncedKnob('knobWrapToneLevel', 'toneLevel', {
    label: 'LEVEL',
    min: 0,
    max: 127,
    defaultValue: 127,
    color: '#ff7700'
  });

  toneKnobs.pan = createSyncedKnob('knobWrapTonePan', 'tonePan', {
    label: 'PAN',
    min: 0,
    max: 127,
    defaultValue: 64,
    bipolar: true,
    color: '#ff7700',
    formatValue: v => panDisplay(v)
  });

  toneKnobs.coarse = createSyncedKnob('knobWrapToneCoarse', 'toneCoarseTune', {
    label: 'COARSE',
    min: 16,
    max: 112,
    defaultValue: 64,
    bipolar: true,
    color: '#38bdf8',
    formatValue: v => (v - 64 > 0 ? `+${v - 64}` : `${v - 64}`)
  });

  toneKnobs.fine = createSyncedKnob('knobWrapToneFine', 'toneFineTune', {
    label: 'FINE',
    min: 14,
    max: 114,
    defaultValue: 64,
    bipolar: true,
    color: '#38bdf8',
    formatValue: v => (v - 64 > 0 ? `+${v - 64}` : `${v - 64}`)
  });

  // 6. Tone TVF Filter Encoders
  toneKnobs.tvfCutoff = createSyncedKnob('knobWrapToneCutoff', 'toneCutoff', {
    label: 'CUTOFF',
    min: 0,
    max: 127,
    defaultValue: 127,
    color: '#00d4ff'
  });

  toneKnobs.tvfResonance = createSyncedKnob('knobWrapToneResonance', 'toneResonance', {
    label: 'RES',
    min: 0,
    max: 127,
    defaultValue: 0,
    color: '#00d4ff'
  });

  toneKnobs.tvfEnvDepth = createSyncedKnob('knobWrapTvfEnvDepth', 'tvfEnvDepth', {
    label: 'DEPTH',
    min: 1,
    max: 127,
    defaultValue: 64,
    bipolar: true,
    color: '#ff7700',
    formatValue: v => (v - 64 > 0 ? `+${v - 64}` : `${v - 64}`)
  });

  toneKnobs.tvfEnvT1 = createSyncedKnob('knobWrapTvfEnvT1', 'tvfEnvT1', {
    label: 'T1 (ATT)',
    min: 0,
    max: 127,
    defaultValue: 15,
    color: '#4ade80'
  });

  toneKnobs.tvfEnvT2 = createSyncedKnob('knobWrapTvfEnvT2', 'tvfEnvT2', {
    label: 'T2 (HLD)',
    min: 0,
    max: 127,
    defaultValue: 25,
    color: '#4ade80'
  });

  toneKnobs.tvfEnvT3 = createSyncedKnob('knobWrapTvfEnvT3', 'tvfEnvT3', {
    label: 'T3 (DEC)',
    min: 0,
    max: 127,
    defaultValue: 40,
    color: '#4ade80'
  });

  toneKnobs.tvfEnvT4 = createSyncedKnob('knobWrapTvfEnvT4', 'tvfEnvT4', {
    label: 'T4 (REL)',
    min: 0,
    max: 127,
    defaultValue: 40,
    color: '#4ade80'
  });

  toneKnobs.tvfEnvL3 = createSyncedKnob('knobWrapTvfEnvL3', 'tvfEnvL3', {
    label: 'L3 (SUS)',
    min: 0,
    max: 127,
    defaultValue: 60,
    color: '#4ade80'
  });

  // 7. Tone TVA Amplifier Encoders
  toneKnobs.tvaLevel = createSyncedKnob('knobWrapToneTvaLevel', 'toneTvaLevel', {
    label: 'LEVEL',
    min: 0,
    max: 127,
    defaultValue: 127,
    color: '#ff7700'
  });

  toneKnobs.tvaEnvT1 = createSyncedKnob('knobWrapTvaEnvT1', 'tvaEnvT1', {
    label: 'T1 (ATT)',
    min: 0,
    max: 127,
    defaultValue: 10,
    color: '#f43f5e'
  });

  toneKnobs.tvaEnvT2 = createSyncedKnob('knobWrapTvaEnvT2', 'tvaEnvT2', {
    label: 'T2 (HLD)',
    min: 0,
    max: 127,
    defaultValue: 20,
    color: '#f43f5e'
  });

  toneKnobs.tvaEnvT3 = createSyncedKnob('knobWrapTvaEnvT3', 'tvaEnvT3', {
    label: 'T3 (DEC)',
    min: 0,
    max: 127,
    defaultValue: 40,
    color: '#f43f5e'
  });

  toneKnobs.tvaEnvT4 = createSyncedKnob('knobWrapTvaEnvT4', 'tvaEnvT4', {
    label: 'T4 (REL)',
    min: 0,
    max: 127,
    defaultValue: 30,
    color: '#f43f5e'
  });

  toneKnobs.tvaEnvL3 = createSyncedKnob('knobWrapTvaEnvL3', 'tvaEnvL3', {
    label: 'L3 (SUS)',
    min: 0,
    max: 127,
    defaultValue: 70,
    color: '#f43f5e'
  });

  // 8. Tone Pitch Envelope Encoders
  toneKnobs.pitchEnvDepth = createSyncedKnob('knobWrapPitchEnvDepth', 'pitchEnvDepth', {
    label: 'DEPTH',
    min: 52,
    max: 76,
    defaultValue: 64,
    bipolar: true,
    color: '#00d4ff',
    formatValue: v => (v - 64 > 0 ? `+${v - 64}` : `${v - 64}`)
  });

  toneKnobs.pitchEnvT1 = createSyncedKnob('knobWrapPitchEnvT1', 'pitchEnvT1', {
    label: 'T1',
    min: 0,
    max: 127,
    defaultValue: 20,
    color: '#00d4ff'
  });

  toneKnobs.pitchEnvT2 = createSyncedKnob('knobWrapPitchEnvT2', 'pitchEnvT2', {
    label: 'T2',
    min: 0,
    max: 127,
    defaultValue: 20,
    color: '#00d4ff'
  });

  toneKnobs.pitchEnvT3 = createSyncedKnob('knobWrapPitchEnvT3', 'pitchEnvT3', {
    label: 'T3',
    min: 0,
    max: 127,
    defaultValue: 40,
    color: '#00d4ff'
  });

  toneKnobs.pitchEnvT4 = createSyncedKnob('knobWrapPitchEnvT4', 'pitchEnvT4', {
    label: 'T4',
    min: 0,
    max: 127,
    defaultValue: 40,
    color: '#00d4ff'
  });

  toneKnobs.pitchEnvL1 = createSyncedKnob('knobWrapPitchEnvL1', 'pitchEnvL1', {
    label: 'L1',
    min: 1,
    max: 127,
    defaultValue: 64,
    bipolar: true,
    color: '#00d4ff',
    formatValue: v => (v - 64 > 0 ? `+${v - 64}` : `${v - 64}`)
  });

  // 9. Tone LFO Encoders
  toneKnobs.lfoRate = createSyncedKnob('knobWrapLfoRate', 'lfoRate', {
    label: 'RATE',
    min: 0,
    max: 127,
    defaultValue: 64,
    color: '#c084fc'
  });

  toneKnobs.lfoPitchDepth = createSyncedKnob('knobWrapLfoPitchDepth', 'lfoPitchDepth', {
    label: 'PITCH',
    min: 1,
    max: 127,
    defaultValue: 64,
    bipolar: true,
    color: '#c084fc',
    formatValue: v => (v - 64 > 0 ? `+${v - 64}` : `${v - 64}`)
  });

  toneKnobs.lfoTvfDepth = createSyncedKnob('knobWrapLfoTvfDepth', 'lfoTvfDepth', {
    label: 'TVF',
    min: 1,
    max: 127,
    defaultValue: 64,
    bipolar: true,
    color: '#c084fc',
    formatValue: v => (v - 64 > 0 ? `+${v - 64}` : `${v - 64}`)
  });

  toneKnobs.lfoTvaDepth = createSyncedKnob('knobWrapLfoTvaDepth', 'lfoTvaDepth', {
    label: 'TVA',
    min: 1,
    max: 127,
    defaultValue: 64,
    bipolar: true,
    color: '#c084fc',
    formatValue: v => (v - 64 > 0 ? `+${v - 64}` : `${v - 64}`)
  });

  toneKnobs.lfoPanDepth = createSyncedKnob('knobWrapLfoPanDepth', 'lfoPanDepth', {
    label: 'PAN',
    min: 1,
    max: 127,
    defaultValue: 64,
    bipolar: true,
    color: '#c084fc',
    formatValue: v => (v - 64 > 0 ? `+${v - 64}` : `${v - 64}`)
  });
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
      <td class="cell-knob">
        <div id="knobWrapPartLevel${i}"></div>
        <input type="hidden" id="partLevel${i}" value="100">
        <span id="partLevelVal${i}" style="display:none;">100</span>
      </td>
      <td class="cell-knob">
        <div id="knobWrapPartPan${i}"></div>
        <input type="hidden" id="partPan${i}" value="64">
        <span id="partPanVal${i}" style="display:none;">C</span>
      </td>
      <td class="cell-knob">
        <div id="knobWrapPartCoarse${i}"></div>
        <input type="hidden" id="partCoarse${i}" value="64">
        <span id="partCoarseVal${i}" style="display:none;">0</span>
      </td>
      <td class="cell-knob">
        <div id="knobWrapPartFine${i}"></div>
        <input type="hidden" id="partFine${i}" value="64">
        <span id="partFineVal${i}" style="display:none;">0</span>
      </td>
      <td class="cell-knob">
        <div id="knobWrapPartChorus${i}"></div>
        <input type="hidden" id="partChorus${i}" value="0">
        <span id="partChorusVal${i}" style="display:none;">0</span>
      </td>
      <td class="cell-knob">
        <div id="knobWrapPartReverb${i}"></div>
        <input type="hidden" id="partReverb${i}" value="40">
        <span id="partReverbVal${i}" style="display:none;">40</span>
      </td>
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

  // Hardware Rotary Encoders for Part Strip
  const knobLevel = new RotaryKnob(`knobWrapPartLevel${part}`, {
    id: `knobPartLevel${part}`,
    min: 0,
    max: 127,
    defaultValue: 100,
    value: 100,
    size: 30,
    color: '#ff9f1c',
    formatValue: (v) => String(v),
    onChange: (val) => {
      const hidden = $(`partLevel${part}`);
      if (hidden) hidden.value = val;
      const valEl = $(`partLevelVal${part}`);
      if (valEl) valEl.textContent = val;
      if (!midi.isConnected) return;
      sendThrottled(`partLevel_${part}`, () => {
        sendPartParam(midi, part, 'PART_LEVEL', val, getDeviceId());
      });
    }
  });

  const knobPan = new RotaryKnob(`knobWrapPartPan${part}`, {
    id: `knobPartPan${part}`,
    min: 0,
    max: 127,
    defaultValue: 64,
    value: 64,
    bipolar: true,
    size: 30,
    color: '#ff9f1c',
    formatValue: (v) => panDisplay(v),
    onChange: (val) => {
      const hidden = $(`partPan${part}`);
      if (hidden) hidden.value = val;
      const valEl = $(`partPanVal${part}`);
      if (valEl) valEl.textContent = panDisplay(val);
      if (!midi.isConnected) return;
      sendThrottled(`partPan_${part}`, () => {
        sendPartParam(midi, part, 'PART_PAN', val, getDeviceId());
      });
    }
  });

  const knobCoarse = new RotaryKnob(`knobWrapPartCoarse${part}`, {
    id: `knobPartCoarse${part}`,
    min: 16,
    max: 112,
    defaultValue: 64,
    value: 64,
    bipolar: true,
    size: 30,
    color: '#38bdf8',
    formatValue: (v) => (v - 64 > 0 ? `+${v - 64}` : `${v - 64}`),
    onChange: (val) => {
      const hidden = $(`partCoarse${part}`);
      if (hidden) hidden.value = val;
      const valEl = $(`partCoarseVal${part}`);
      if (valEl) valEl.textContent = val - 64;
      if (!midi.isConnected) return;
      sendThrottled(`partCoarse_${part}`, () => {
        sendPartParam(midi, part, 'COARSE_TUNE', val, getDeviceId());
      });
    }
  });

  const knobFine = new RotaryKnob(`knobWrapPartFine${part}`, {
    id: `knobPartFine${part}`,
    min: 14,
    max: 114,
    defaultValue: 64,
    value: 64,
    bipolar: true,
    size: 30,
    color: '#38bdf8',
    formatValue: (v) => (v - 64 > 0 ? `+${v - 64}` : `${v - 64}`),
    onChange: (val) => {
      const hidden = $(`partFine${part}`);
      if (hidden) hidden.value = val;
      const valEl = $(`partFineVal${part}`);
      if (valEl) valEl.textContent = val - 64;
      if (!midi.isConnected) return;
      sendThrottled(`partFine_${part}`, () => {
        sendPartParam(midi, part, 'FINE_TUNE', val, getDeviceId());
      });
    }
  });

  const knobChorus = new RotaryKnob(`knobWrapPartChorus${part}`, {
    id: `knobPartChorus${part}`,
    min: 0,
    max: 127,
    defaultValue: 0,
    value: 0,
    size: 30,
    color: '#a78bfa',
    formatValue: (v) => String(v),
    onChange: (val) => {
      const hidden = $(`partChorus${part}`);
      if (hidden) hidden.value = val;
      const valEl = $(`partChorusVal${part}`);
      if (valEl) valEl.textContent = val;
      if (!midi.isConnected) return;
      sendThrottled(`partChorus_${part}`, () => {
        sendPartParam(midi, part, 'CHORUS_SEND', val, getDeviceId());
      });
    }
  });

  const knobReverb = new RotaryKnob(`knobWrapPartReverb${part}`, {
    id: `knobPartReverb${part}`,
    min: 0,
    max: 127,
    defaultValue: 40,
    value: 40,
    size: 30,
    color: '#a78bfa',
    formatValue: (v) => String(v),
    onChange: (val) => {
      const hidden = $(`partReverb${part}`);
      if (hidden) hidden.value = val;
      const valEl = $(`partReverbVal${part}`);
      if (valEl) valEl.textContent = val;
      if (!midi.isConnected) return;
      sendThrottled(`partReverb_${part}`, () => {
        sendPartParam(midi, part, 'REVERB_SEND', val, getDeviceId());
      });
    }
  });

  partKnobs[part] = {
    level: knobLevel,
    pan: knobPan,
    coarse: knobCoarse,
    fine: knobFine,
    chorus: knobChorus,
    reverb: knobReverb
  };

  // Synchronize when hidden inputs receive input/change
  $(`partLevel${part}`)?.addEventListener('input', (e) => knobLevel.setValue(parseInt(e.target.value, 10), false));
  $(`partLevel${part}`)?.addEventListener('change', (e) => knobLevel.setValue(parseInt(e.target.value, 10), false));
  $(`partPan${part}`)?.addEventListener('input', (e) => knobPan.setValue(parseInt(e.target.value, 10), false));
  $(`partPan${part}`)?.addEventListener('change', (e) => knobPan.setValue(parseInt(e.target.value, 10), false));
  $(`partCoarse${part}`)?.addEventListener('input', (e) => knobCoarse.setValue(parseInt(e.target.value, 10), false));
  $(`partCoarse${part}`)?.addEventListener('change', (e) => knobCoarse.setValue(parseInt(e.target.value, 10), false));
  $(`partFine${part}`)?.addEventListener('input', (e) => knobFine.setValue(parseInt(e.target.value, 10), false));
  $(`partFine${part}`)?.addEventListener('change', (e) => knobFine.setValue(parseInt(e.target.value, 10), false));
  $(`partChorus${part}`)?.addEventListener('input', (e) => knobChorus.setValue(parseInt(e.target.value, 10), false));
  $(`partChorus${part}`)?.addEventListener('change', (e) => knobChorus.setValue(parseInt(e.target.value, 10), false));
  $(`partReverb${part}`)?.addEventListener('input', (e) => knobReverb.setValue(parseInt(e.target.value, 10), false));
  $(`partReverb${part}`)?.addEventListener('change', (e) => knobReverb.setValue(parseInt(e.target.value, 10), false));

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

  const level = data.partLevel ?? 100;
  if ($(`partLevel${part}`)) $(`partLevel${part}`).value = level;
  if ($(`partLevelVal${part}`)) $(`partLevelVal${part}`).textContent = level;
  partKnobs[part]?.level?.setValue(level, false);

  const pan = data.partPan ?? 64;
  if ($(`partPan${part}`)) $(`partPan${part}`).value = pan;
  if ($(`partPanVal${part}`)) $(`partPanVal${part}`).textContent = panDisplay(pan);
  partKnobs[part]?.pan?.setValue(pan, false);

  const coarse = data.coarseTune ?? 64;
  if ($(`partCoarse${part}`)) $(`partCoarse${part}`).value = coarse;
  if ($(`partCoarseVal${part}`)) $(`partCoarseVal${part}`).textContent = coarse - 64;
  partKnobs[part]?.coarse?.setValue(coarse, false);

  const fine = data.fineTune ?? 64;
  if ($(`partFine${part}`)) $(`partFine${part}`).value = fine;
  if ($(`partFineVal${part}`)) $(`partFineVal${part}`).textContent = fine - 64;
  partKnobs[part]?.fine?.setValue(fine, false);

  const chorus = data.chorusSend ?? 0;
  if ($(`partChorus${part}`)) $(`partChorus${part}`).value = chorus;
  if ($(`partChorusVal${part}`)) $(`partChorusVal${part}`).textContent = chorus;
  partKnobs[part]?.chorus?.setValue(chorus, false);

  const reverb = data.reverbSend ?? 40;
  if ($(`partReverb${part}`)) $(`partReverb${part}`).value = reverb;
  if ($(`partReverbVal${part}`)) $(`partReverbVal${part}`).textContent = reverb;
  partKnobs[part]?.reverb?.setValue(reverb, false);

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
if (typeof window !== 'undefined') window.updatePartUI = updatePartRow;

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
  updateMatrixGridUI(data);

  const dsPatchName = $('deepStudioPatchName');
  if (dsPatchName) dsPatchName.textContent = data.name || 'INIT PATCH';
  const dsVoiceBadge = $('deepStudioVoiceModeBadge');
  if (dsVoiceBadge) dsVoiceBadge.textContent = (data.monoPoly === 0) ? 'MONO' : 'POLY';
}

const matrixGridKnobs = {};

function populateMatrixGridDropdowns() {
  for (let m = 1; m <= 4; m++) {
    const srcSelect = $(`matrix${m}Source`);
    if (srcSelect && srcSelect.children.length === 0) {
      MATRIX_SOURCES.forEach((name, idx) => {
        const opt = document.createElement('option');
        opt.value = idx;
        opt.textContent = MATRIX_SOURCE_LABELS[name] || (name.startsWith('CC') ? `${name}` : name);
        srcSelect.appendChild(opt);
      });
    }
  }

  for (let d = 1; d <= 4; d++) {
    const destSelect = $(`matrixDestRow${d}`);
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

function updateMatrixGridUI(data) {
  if (!data) return;
  for (let m = 1; m <= 4; m++) {
    const srcSel = $(`matrix${m}Source`);
    if (srcSel) {
      srcSel.value = data[`matrix${m}Source`] ?? 0;
    }
  }

  for (let d = 1; d <= 4; d++) {
    const destSel = $(`matrixDestRow${d}`);
    if (destSel) {
      let activeDest = 0;
      for (let m = 1; m <= 4; m++) {
        const val = data[`matrix${m}Dest${d}`];
        if (val !== undefined && val !== 0) {
          activeDest = val;
          break;
        }
      }
      destSel.value = activeDest;
    }

    for (let m = 1; m <= 4; m++) {
      const knob = matrixGridKnobs[`${m}_${d}`];
      if (knob) {
        const sensVal = data[`matrix${m}Sens${d}`] ?? 64;
        knob.setValue(sensVal, false);
      }
    }
  }
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
  updateMatrixGridUI(data);
}

export let isAllTonesLinked = false;

export function getActiveToneTargets() {
  if (isAllTonesLinked) {
    return [1, 2, 3, 4];
  }
  return [currentToneIndex];
}

export function updateToneCacheProperty(cache, paramKey, val) {
  if (!cache) return;
  const map = {
    TONE_LEVEL: 'toneLevel',
    TONE_PAN: 'tonePan',
    COARSE_TUNE: 'coarseTune',
    FINE_TUNE: 'fineTune',
    TVF_CUTOFF: 'tvfCutoff',
    TVF_RESONANCE: 'tvfResonance',
    TVF_FILTER_TYPE: 'tvfFilterType',
    TVF_ENV_DEPTH: 'tvfEnvDepth',
    TVF_ENV_T1: 'tvfEnvT1',
    TVF_ENV_T2: 'tvfEnvT2',
    TVF_ENV_T3: 'tvfEnvT3',
    TVF_ENV_T4: 'tvfEnvT4',
    TVF_ENV_L3: 'tvfEnvL3',
    TVA_LEVEL: 'tvaLevel',
    TVA_ENV_T1: 'tvaEnvT1',
    TVA_ENV_T2: 'tvaEnvT2',
    TVA_ENV_T3: 'tvaEnvT3',
    TVA_ENV_T4: 'tvaEnvT4',
    TVA_ENV_L3: 'tvaEnvL3',
    PITCH_ENV_DEPTH: 'pitchEnvDepth',
    PITCH_ENV_T1: 'pitchEnvT1',
    PITCH_ENV_T2: 'pitchEnvT2',
    PITCH_ENV_T3: 'pitchEnvT3',
    PITCH_ENV_T4: 'pitchEnvT4',
    PITCH_ENV_L1: 'pitchEnvL1',
    WAVE_GROUP_TYPE: 'waveGroupType',
    WAVE_GROUP_ID: 'waveGroupId',
    WAVE_NUMBER_L: 'waveNumberL',
    WAVE_NUMBER_R: 'waveNumberR',
    WAVE_GAIN: 'waveGain',
    WAVE_FXM_SWITCH: 'waveFxmSwitch',
    WAVE_FXM_COLOR: 'waveFxmColor',
    WAVE_FXM_DEPTH: 'waveFxmDepth',
    WAVE_TEMPO_SYNC: 'waveTempoSync',
  };
  const prop = map[paramKey];
  if (prop) {
    cache[prop] = val;
  }
}

export function updateModuleTargetPill(label) {
  const pills = [
    'filterToneBadge',
    'tvaToneBadge',
    'pitchToneBadge',
    'lfoToneBadge',
    'tuningToneBadge'
  ];
  pills.forEach(id => {
    const el = $(id);
    if (el) {
      el.textContent = label;
      el.classList.toggle('all-linked', isAllTonesLinked);
    }
  });
}

export function selectToneTarget(target) {
  if (target === 'all') {
    isAllTonesLinked = true;
    for (let i = 1; i <= 4; i++) {
      $(`btnSelectTone${i}`)?.classList.remove('active');
    }
    $('btnSelectToneAll')?.classList.add('active');

    const badge = $('toneFocusBadge');
    if (badge) {
      badge.textContent = '⚡ MASTER LINK: EDITING ALL 4 TONES SIMULTANEOUSLY';
      badge.classList.add('all-linked');
    }

    const nameDisp = $('currentToneNameDisplay');
    if (nameDisp) nameDisp.textContent = 'ALL TONES (LINKED)';

    updateModuleTargetPill('ALL (LINKED)');

    if ($('tvfFilterDrive')) {
      $('tvfFilterDrive').value = $('booster12') ? parseInt($('booster12').value, 10) : 0;
    }

    const cached = currentToneCache[currentToneIndex - 1] || store.get(`patch.tones.${currentToneIndex - 1}`);
    if (cached) {
      updateToneUI(cached);
    }
    setStatus('Master Tone Link Active: Filter, envelopes & tuning changes apply to Tones 1, 2, 3, and 4 simultaneously');
  } else {
    isAllTonesLinked = false;
    currentToneIndex = target;
    for (let i = 1; i <= 4; i++) {
      $(`btnSelectTone${i}`)?.classList.toggle('active', i === target);
    }
    $('btnSelectToneAll')?.classList.remove('active');

    const badge = $('toneFocusBadge');
    if (badge) {
      badge.textContent = `EDIT TARGET: TONE ${target}`;
      badge.classList.remove('all-linked');
    }

    const nameDisp = $('currentToneNameDisplay');
    if (nameDisp) nameDisp.textContent = `TONE ${target}`;

    updateModuleTargetPill(`Tone ${target}`);

    if ($('tvfFilterDrive')) {
      const bVal = (target === 1 || target === 2)
        ? ($('booster12') ? parseInt($('booster12').value, 10) : 0)
        : ($('booster34') ? parseInt($('booster34').value, 10) : 0);
      $('tvfFilterDrive').value = bVal;
    }

    updateTMTZoneUI(target);
    const cached = currentToneCache[target - 1] || store.get(`patch.tones.${target - 1}`);
    if (cached) {
      updateToneUI(cached);
    }
    setStatus(`Switched Tone Edit focus to Tone ${target}`);
  }
}

export function dispatchToneParam(paramKey, val, throttled = true, throttleKey = null) {
  const targets = getActiveToneTargets();
  for (const t of targets) {
    if (currentToneCache[t - 1]) {
      updateToneCacheProperty(currentToneCache[t - 1], paramKey, val);
    }
    if (midi.isConnected) {
      if (throttled) {
        const key = throttleKey ? `${throttleKey}_${t}` : `tone_${t}_${paramKey}`;
        sendThrottled(key, () => {
          sendPatchToneParam(midi, currentPart(), t, paramKey, val, getDeviceId());
        });
      } else {
        sendPatchToneParam(midi, currentPart(), t, paramKey, val, getDeviceId());
      }
    }
  }
}

export function dispatchToneLFOParam(lfoNum, paramKey, val, throttled = true, throttleKey = null) {
  const targets = getActiveToneTargets();
  for (const t of targets) {
    if (currentToneCache[t - 1]) {
      const propMap = {
        FORM: `lfo${lfoNum}Form`,
        RATE: `lfo${lfoNum}Rate`,
        PITCH_DEPTH: `lfo${lfoNum}PitchDepth`,
        TVF_DEPTH: `lfo${lfoNum}TvfDepth`,
        TVA_DEPTH: `lfo${lfoNum}TvaDepth`,
        PAN_DEPTH: `lfo${lfoNum}PanDepth`
      };
      if (propMap[paramKey]) {
        currentToneCache[t - 1][propMap[paramKey]] = val;
      }
    }
    if (midi.isConnected) {
      if (throttled) {
        const key = throttleKey ? `${throttleKey}_${t}` : `tone_lfo_${t}_${lfoNum}_${paramKey}`;
        sendThrottled(key, () => {
          sendToneLFOParam(midi, currentPart(), t, lfoNum, paramKey, val, getDeviceId());
        });
      } else {
        sendToneLFOParam(midi, currentPart(), t, lfoNum, paramKey, val, getDeviceId());
      }
    }
  }
}

function updatePatchTMTUI(data) {
  currentPatchTMTData = data;
  $('struct12').value = data.structureType12 ?? 0;
  $('booster12').value = data.booster12 ?? 0;
  $('struct34').value = data.structureType34 ?? 0;
  $('booster34').value = data.booster34 ?? 0;
  $('tmtVelCtrl').value = data.tmtVelControl ?? 0;

  if ($('tvfFilterDrive')) {
    const boosterVal = (currentToneIndex === 1 || currentToneIndex === 2 || isAllTonesLinked)
      ? (data.booster12 ?? 0)
      : (data.booster34 ?? 0);
    $('tvfFilterDrive').value = boosterVal;
  }

  for (let t = 1; t <= 4; t++) {
    const sw = $(`tone${t}Switch`);
    const on = !!(data[`tone${t}Switch`]);
    sw.checked = on;
    sw.closest('.tone-switch')?.classList.toggle('active', on);
    const stateEl = $(`tonePlaybackState${t}`);
    if (stateEl) {
      stateEl.textContent = on ? 'SOUNDING' : 'MUTED';
      stateEl.classList.toggle('playing', on);
      stateEl.classList.toggle('muted', !on);
    }
    const dot = $(`toneStatusDot${t}`);
    if (dot) {
      dot.classList.toggle('on', on);
      dot.classList.toggle('off', !on);
    }
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

function formatToneWaveName(groupType, waveNumber, slot = 'A') {
  if (!waveNumber || waveNumber === 0) return 'OFF';
  if (groupType === 0) {
    return getWaveName(0, waveNumber);
  }
  const slotBoardId = (slot === 'B') ? $('srxSlotBSelect')?.value : $('srxSlotASelect')?.value;
  if (slotBoardId && slotBoardId !== 'NONE') {
    const waves = getSrxWaveforms(slotBoardId);
    if (waves && waves[waveNumber - 1]) return waves[waveNumber - 1];
  }
  return getWaveName(groupType, waveNumber);
}

function updateWaveGroupDropdownLabels() {
  const wg = $('waveGroup');
  if (!wg) return;
  const optInt = wg.querySelector('option[value="INT"]');
  const optA = wg.querySelector('option[value="SRX-A"]');
  const optB = wg.querySelector('option[value="SRX-B"]');

  const boardIdA = $('srxSlotASelect')?.value || localStorage.getItem('xv5050_srx_slot_a') || 'NONE';
  const boardIdB = $('srxSlotBSelect')?.value || localStorage.getItem('xv5050_srx_slot_b') || 'NONE';

  const boardA = (boardIdA && boardIdA !== 'NONE') ? getSrxBoard(boardIdA) : null;
  const boardB = (boardIdB && boardIdB !== 'NONE') ? getSrxBoard(boardIdB) : null;

  if (optInt) optInt.textContent = 'INT: Internal PCM (1,083 Waves)';
  if (optA) optA.textContent = boardA ? `SRX Slot A: ${boardA.name}` : 'SRX Slot A (No Board)';
  if (optB) optB.textContent = boardB ? `SRX Slot B: ${boardB.name}` : 'SRX Slot B (No Board)';
}

function updateToneUI(data) {
  if (!data) return;
  currentToneCache[currentToneIndex - 1] = data;

  const toneDisp = $('currentToneNameDisplay');
  if (toneDisp) toneDisp.textContent = isAllTonesLinked ? 'ALL TONES (LINKED)' : `TONE ${currentToneIndex}`;
  updateModuleTargetPill(isAllTonesLinked ? 'ALL (LINKED)' : `Tone ${currentToneIndex}`);

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
  const grpId = data.waveGroupId ?? 0;
  let wgVal = 'INT';
  let slot = 'A';
  if (grp === 2) {
    if (grpId === 2) {
      wgVal = 'SRX-B';
      slot = 'B';
    } else {
      wgVal = 'SRX-A';
      slot = 'A';
    }
  }
  const wgSelect = $('waveGroup');
  if (wgSelect) {
    updateWaveGroupDropdownLabels();
    wgSelect.value = wgVal;
  }

  populateWaveDropdowns(grp, slot);

  const badge = $('waveBankBadge');
  if (badge) {
    badge.textContent = (grp === 0) ? '1,083 WAVES' : `SRX Slot ${slot}`;
  }

  $('waveGain').value = data.waveGain ?? 1;
  if ($('tvfWaveGain')) $('tvfWaveGain').value = data.waveGain ?? 1;
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
  if (nl) nl.textContent = formatToneWaveName(grp, wNumL, slot);
  const nr = $('waveNameR');
  if (nr) nr.textContent = wNumR === 0 ? 'OFF' : formatToneWaveName(grp, wNumR, slot);

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
  if ($('tvfEnvT2')) {
    $('tvfEnvT2').value = data.tvfEnvT2 ?? 25;
    $('tvfEnvT2Val').textContent = data.tvfEnvT2 ?? 25;
  }
  if ($('tvfEnvT3')) {
    $('tvfEnvT3').value = data.tvfEnvT3 ?? 40;
    $('tvfEnvT3Val').textContent = data.tvfEnvT3 ?? 40;
  }
  $('tvfEnvT4').value = data.tvfEnvT4 ?? 40;
  $('tvfEnvT4Val').textContent = data.tvfEnvT4 ?? 40;
  if ($('tvfEnvL3')) {
    $('tvfEnvL3').value = data.tvfEnvL3 ?? 60;
    $('tvfEnvL3Val').textContent = data.tvfEnvL3 ?? 60;
  }

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

  const srxGroup = $('waveSrxBoardGroup');
  if (srxGroup) srxGroup.style.display = grp === 2 ? 'flex' : 'none';

  syncDeepStudioToneCards();
  updateDeepStudioSpectrum();
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
  syncAllEnvelopeHandles();
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
  syncEnvelopeHandles('pitch');
}

function redrawFilterCurves() {
  const fType = parseInt($('toneFilterType').value, 10);
  const cutoff = parseInt($('toneCutoff').value, 10);
  const resonance = parseInt($('toneResonance').value, 10);
  const t1 = parseInt($('tvfEnvT1').value, 10);
  const t2 = parseInt($('tvfEnvT2')?.value ?? 25, 10);
  const t3 = parseInt($('tvfEnvT3')?.value ?? 40, 10);
  const t4 = parseInt($('tvfEnvT4').value, 10);
  const l3 = parseInt($('tvfEnvL3')?.value ?? 60, 10);

  const filterD = generateFilterCurvePath(fType, cutoff, resonance, 300, 75);
  $('filterRespPath').setAttribute('d', filterD);
  $('filterRespBadge').textContent = FILTER_TYPES[fType] || 'LPF';

  const envD = generateEnvelopePath('tvf', { t1, t2, t3, t4, l1: 127, l2: Math.max(l3, Math.round((127 + l3) / 2)), l3, l4: 0 }, 300, 75);
  $('tvfEnvPath').setAttribute('d', envD);
  syncEnvelopeHandles('tvf');
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
  syncEnvelopeHandles('tva');
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

function populateWaveDropdowns(groupType = 0, srxSlot = 'A') {
  const waveLSelect = $('waveNumberL');
  const waveRSelect = $('waveNumberR');

  let waveforms = INTERNAL_WAVEFORMS;
  if (groupType === 2) {
    const slotBoardId = (srxSlot === 'B') ? $('srxSlotBSelect')?.value : $('srxSlotASelect')?.value;
    if (slotBoardId && slotBoardId !== 'NONE') {
      waveforms = getSrxWaveforms(slotBoardId);
    } else {
      waveforms = [`SRX-${srxSlot}: No Board Installed`];
    }
  }

  if (waveLSelect) {
    const currL = waveLSelect.value;
    waveLSelect.innerHTML = '';
    waveforms.forEach((name, idx) => {
      const opt = document.createElement('option');
      opt.value = idx + 1;
      opt.textContent = name;
      waveLSelect.appendChild(opt);
    });
    if (currL && waveLSelect.querySelector(`option[value="${currL}"]`)) {
      waveLSelect.value = currL;
    }
  }

  if (waveRSelect) {
    const currR = waveRSelect.value;
    waveRSelect.innerHTML = '<option value="0">OFF</option>';
    waveforms.forEach((name, idx) => {
      const opt = document.createElement('option');
      opt.value = idx + 1;
      opt.textContent = name;
      waveRSelect.appendChild(opt);
    });
    if (currR && waveRSelect.querySelector(`option[value="${currR}"]`)) {
      waveRSelect.value = currR;
    }
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

  // Modulation Matrix Grid (4 Sources × 4 Destinations)
  populateMatrixGridDropdowns();

  for (let m = 1; m <= 4; m++) {
    for (let d = 1; d <= 4; d++) {
      const cellEl = $(`matrixKnob_${m}_${d}`);
      if (!cellEl) continue;

      const knob = new RotaryKnob(cellEl, {
        id: `knob_matrix_${m}_${d}`,
        min: 1,
        max: 127,
        defaultValue: 64,
        value: 64,
        size: 26,
        bipolar: true,
        color: 'var(--accent, #ff7700)',
        formatValue: (v) => (v === 64 ? '0' : (v > 64 ? `+${v - 64}` : `${v - 64}`)),
        onChange: (val) => {
          if (currentPatchCommonData) {
            currentPatchCommonData[`matrix${m}Sens${d}`] = val;
          }
          if (m === currentMatrixIndex) {
            const compEl = $(`matrixSens${d}`);
            if (compEl) compEl.value = val;
            const compVal = $(`matrixSens${d}Val`);
            if (compVal) compVal.textContent = val - 64;
          }
          if (!midi.isConnected) return;
          sendThrottled(`matrixSens_${m}_${d}`, () => {
            sendMatrixControlParam(midi, currentPart(), m, `SENS_${d}`, val, getDeviceId());
          });
        }
      });
      matrixGridKnobs[`${m}_${d}`] = knob;
    }

    const srcSel = $(`matrix${m}Source`);
    if (srcSel) {
      srcSel.addEventListener('change', () => {
        const val = parseInt(srcSel.value, 10);
        if (currentPatchCommonData) {
          currentPatchCommonData[`matrix${m}Source`] = val;
        }
        if (m === currentMatrixIndex) {
          const compSrc = $('matrixSource');
          if (compSrc) compSrc.value = val;
        }
        if (!midi.isConnected) return;
        sendMatrixControlParam(midi, currentPart(), m, 'SOURCE', val, getDeviceId());
      });
    }
  }

  for (let d = 1; d <= 4; d++) {
    const destSel = $(`matrixDestRow${d}`);
    if (destSel) {
      destSel.addEventListener('change', () => {
        const val = parseInt(destSel.value, 10);
        if (currentPatchCommonData) {
          for (let m = 1; m <= 4; m++) {
            currentPatchCommonData[`matrix${m}Dest${d}`] = val;
          }
        }
        const compDest = $(`matrixDest${d}`);
        if (compDest) compDest.value = val;

        if (!midi.isConnected) return;
        for (let m = 1; m <= 4; m++) {
          sendMatrixControlParam(midi, currentPart(), m, `DEST_${d}`, val, getDeviceId());
        }
      });
    }
  }

  // Matrix Control Tab switching (Matrix 1-4 Compatibility)
  for (let m = 1; m <= 4; m++) {
    const btn = $(`btnMatrix${m}`);
    if (btn) {
      btn.addEventListener('click', () => {
        for (let i = 1; i <= 4; i++) {
          const b = $(`btnMatrix${i}`);
          if (b) b.classList.toggle('active', i === m);
        }
        currentMatrixIndex = m;
        updateMatrixUI(m);
      });
    }
  }

  // Matrix Control inputs (Compatibility)
  const legacySrc = $('matrixSource');
  if (legacySrc) {
    legacySrc.addEventListener('change', () => {
      const val = parseInt(legacySrc.value, 10);
      if (currentPatchCommonData) currentPatchCommonData[`matrix${currentMatrixIndex}Source`] = val;
      const gridSrc = $(`matrix${currentMatrixIndex}Source`);
      if (gridSrc) gridSrc.value = val;
      if (!midi.isConnected) return;
      sendMatrixControlParam(midi, currentPart(), currentMatrixIndex, 'SOURCE', val, getDeviceId());
    });
  }

  for (let d = 1; d <= 4; d++) {
    const legacyDest = $(`matrixDest${d}`);
    if (legacyDest) {
      legacyDest.addEventListener('change', () => {
        const val = parseInt(legacyDest.value, 10);
        if (currentPatchCommonData) currentPatchCommonData[`matrix${currentMatrixIndex}Dest${d}`] = val;
        const rowDest = $(`matrixDestRow${d}`);
        if (rowDest) rowDest.value = val;
        if (!midi.isConnected) return;
        sendMatrixControlParam(midi, currentPart(), currentMatrixIndex, `DEST_${d}`, val, getDeviceId());
      });
    }

    const legacySens = $(`matrixSens${d}`);
    if (legacySens) {
      legacySens.addEventListener('input', () => {
        const val = parseInt(legacySens.value, 10);
        const sensValEl = $(`matrixSens${d}Val`);
        if (sensValEl) sensValEl.textContent = val - 64;
        if (currentPatchCommonData) currentPatchCommonData[`matrix${currentMatrixIndex}Sens${d}`] = val;
        const knob = matrixGridKnobs[`${currentMatrixIndex}_${d}`];
        if (knob) knob.setValue(val, false);
        if (!midi.isConnected) return;
        sendThrottled(`matrixSens_${currentMatrixIndex}_${d}`, () => {
          sendMatrixControlParam(midi, currentPart(), currentMatrixIndex, `SENS_${d}`, val, getDeviceId());
        });
      });
      legacySens.addEventListener('change', () => {
        const val = parseInt(legacySens.value, 10);
        if (!midi.isConnected) return;
        sendMatrixControlParam(midi, currentPart(), currentMatrixIndex, `SENS_${d}`, val, getDeviceId());
      });
    }
  }

  // TMT Structure & Zones controls
  $('struct12').addEventListener('change', () => {
    if (!midi.isConnected) return;
    sendPatchTMTParam(midi, currentPart(), 'STRUCTURE_TYPE_1_2', parseInt($('struct12').value, 10), getDeviceId());
  });

  $('booster12').addEventListener('change', () => {
    if ($('tvfFilterDrive') && (currentToneIndex === 1 || currentToneIndex === 2 || isAllTonesLinked)) {
      $('tvfFilterDrive').value = $('booster12').value;
    }
    if (!midi.isConnected) return;
    sendPatchTMTParam(midi, currentPart(), 'BOOSTER_1_2', parseInt($('booster12').value, 10), getDeviceId());
  });

  $('struct34').addEventListener('change', () => {
    if (!midi.isConnected) return;
    sendPatchTMTParam(midi, currentPart(), 'STRUCTURE_TYPE_3_4', parseInt($('struct34').value, 10), getDeviceId());
  });

  $('booster34').addEventListener('change', () => {
    if ($('tvfFilterDrive') && (currentToneIndex === 3 || currentToneIndex === 4)) {
      $('tvfFilterDrive').value = $('booster34').value;
    }
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

  // Tone Playback Switches
  for (let t = 1; t <= 4; t++) {
    $(`tone${t}Switch`).addEventListener('change', () => {
      const on = $(`tone${t}Switch`).checked;
      $(`tone${t}Switch`).closest('.tone-switch')?.classList.toggle('active', on);
      const stateEl = $(`tonePlaybackState${t}`);
      if (stateEl) {
        stateEl.textContent = on ? 'SOUNDING' : 'MUTED';
        stateEl.classList.toggle('playing', on);
        stateEl.classList.toggle('muted', !on);
      }
      const dot = $(`toneStatusDot${t}`);
      if (dot) {
        dot.classList.toggle('on', on);
        dot.classList.toggle('off', !on);
      }
      if (currentPatchTMTData) currentPatchTMTData[`tone${t}Switch`] = on ? 1 : 0;
      if (!midi.isConnected) return;
      sendToneSwitch(midi, currentPart(), t, on, getDeviceId());
      setStatus(`Tone ${t} ${on ? 'SOUNDING (Unmuted)' : 'MUTED (Silent)'}`);
    });
  }

  // Clicking a tone playback switch card switches edit target to that tone
  document.querySelectorAll('.tone-switch').forEach(card => {
    card.addEventListener('click', (e) => {
      if (e.target.closest('.toggle')) return; // toggle switch was clicked
      const t = parseInt(card.dataset.tone, 10);
      if (t >= 1 && t <= 4) {
        selectToneTarget(t);
      }
    });
  });

  // Tone Generator Tab Selectors
  for (let t = 1; t <= 4; t++) {
    $(`btnSelectTone${t}`)?.addEventListener('click', () => {
      selectToneTarget(t);
    });
  }

  $('btnSelectToneAll')?.addEventListener('click', () => {
    selectToneTarget('all');
  });

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
      dispatchToneParam(s.param, val, true, `tone_${s.param}`);
    });
    $(s.el).addEventListener('change', () => {
      const val = parseInt($(s.el).value, 10);
      if (s.onUpdate) s.onUpdate();
      dispatchToneParam(s.param, val, false);
    });
  }

  $('waveGroup').addEventListener('change', () => {
    const val = $('waveGroup').value;
    let grp = 0;
    let grpId = 0;
    let slot = 'A';

    if (val === 'SRX-A' || val === '2' || val === 2) {
      grp = 2;
      grpId = 1;
      slot = 'A';
    } else if (val === 'SRX-B') {
      grp = 2;
      grpId = 2;
      slot = 'B';
    } else {
      grp = 0;
      grpId = 0;
    }

    populateWaveDropdowns(grp, slot);

    const numL = parseInt($('waveNumberL').value, 10) || 1;
    const numR = parseInt($('waveNumberR').value, 10) || 0;

    const targets = getActiveToneTargets();
    for (const t of targets) {
      const cached = currentToneCache[t - 1] || {};
      cached.waveGroupType = grp;
      cached.waveGroupId = grpId;
      cached.waveNumberL = numL;
      cached.waveNumberR = numR;

      if (midi.isConnected) {
        sendPatchToneParam(midi, currentPart(), t, 'WAVE_GROUP_TYPE', grp, getDeviceId());
        sendPatchToneParam(midi, currentPart(), t, 'WAVE_GROUP_ID', grpId, getDeviceId());
        sendPatchToneParam(midi, currentPart(), t, 'WAVE_NUMBER_L', numL, getDeviceId());
        if (numR > 0) {
          sendPatchToneParam(midi, currentPart(), t, 'WAVE_NUMBER_R', numR, getDeviceId());
        }
      }
    }

    const nl = $('waveNameL');
    if (nl) nl.textContent = formatToneWaveName(grp, numL, slot);
    const nr = $('waveNameR');
    if (nr) nr.textContent = numR === 0 ? 'OFF' : formatToneWaveName(grp, numR, slot);

    const badge = $('waveBankBadge');
    if (badge) {
      badge.textContent = (grp === 0) ? '1,083 WAVES' : `SRX Slot ${slot}`;
    }
  });

  $('waveNumberL').addEventListener('change', () => {
    const val = parseInt($('waveNumberL').value, 10) || 1;
    const wgVal = $('waveGroup').value;
    const grp = (wgVal === 'SRX-A' || wgVal === 'SRX-B') ? 2 : 0;
    const slot = (wgVal === 'SRX-B') ? 'B' : 'A';
    const nl = $('waveNameL');
    if (nl) nl.textContent = formatToneWaveName(grp, val, slot);

    const targets = getActiveToneTargets();
    for (const t of targets) {
      if (currentToneCache[t - 1]) currentToneCache[t - 1].waveNumberL = val;
      if (midi.isConnected) {
        sendPatchToneParam(midi, currentPart(), t, 'WAVE_NUMBER_L', val, getDeviceId());
      }
    }
  });

  $('waveNumberR').addEventListener('change', () => {
    const val = parseInt($('waveNumberR').value, 10) || 0;
    const wgVal = $('waveGroup').value;
    const grp = (wgVal === 'SRX-A' || wgVal === 'SRX-B') ? 2 : 0;
    const slot = (wgVal === 'SRX-B') ? 'B' : 'A';
    const nr = $('waveNameR');
    if (nr) nr.textContent = val === 0 ? 'OFF' : formatToneWaveName(grp, val, slot);

    const targets = getActiveToneTargets();
    for (const t of targets) {
      if (currentToneCache[t - 1]) currentToneCache[t - 1].waveNumberR = val;
      if (midi.isConnected) {
        sendPatchToneParam(midi, currentPart(), t, 'WAVE_NUMBER_R', val, getDeviceId());
      }
    }
  });

  $('waveGain').addEventListener('change', () => {
    const val = parseInt($('waveGain').value, 10);
    if ($('tvfWaveGain')) $('tvfWaveGain').value = val;
    dispatchToneParam('WAVE_GAIN', val, false);
  });

  $('tvfWaveGain')?.addEventListener('change', () => {
    const val = parseInt($('tvfWaveGain').value, 10);
    if ($('waveGain')) $('waveGain').value = val;
    dispatchToneParam('WAVE_GAIN', val, false);
    setStatus(`Wave Pre-Filter Input Gain: ${$('tvfWaveGain').options[$('tvfWaveGain').selectedIndex].text}`);
  });

  $('tvfFilterDrive')?.addEventListener('change', () => {
    const driveVal = parseInt($('tvfFilterDrive').value, 10);
    const applyDrive = (pair) => {
      const boosterParam = pair === 1 ? 'BOOSTER_1_2' : 'BOOSTER_3_4';
      const structParam = pair === 1 ? 'STRUCTURE_TYPE_1_2' : 'STRUCTURE_TYPE_3_4';
      const boosterEl = pair === 1 ? $('booster12') : $('booster34');
      const structEl = pair === 1 ? $('struct12') : $('struct34');

      if (boosterEl) boosterEl.value = driveVal;

      let structVal = structEl ? parseInt(structEl.value, 10) : 0;
      // If user selected drive (> 0 dB) and the structure is currently Type 1 or Type 2 (clean / unboosted),
      // auto-switch to Type 4 (Booster in series) so the hardware activates the Booster circuit
      if (driveVal > 0 && (structVal === 0 || structVal === 1)) {
        structVal = 3; // Type 4: Tone 1/3 TVF -> Booster -> TVF 2/4
        if (structEl) structEl.value = structVal;
        if (midi.isConnected) {
          sendPatchTMTParam(midi, currentPart(), structParam, structVal, getDeviceId());
        }
      }

      if (midi.isConnected) {
        sendPatchTMTParam(midi, currentPart(), boosterParam, driveVal, getDeviceId());
      }
    };

    if (isAllTonesLinked) {
      applyDrive(1);
      applyDrive(2);
      setStatus(`TVF Pre-Filter Drive: ${$('tvfFilterDrive').options[$('tvfFilterDrive').selectedIndex].text} (All Tones Linked)`);
    } else {
      const pair = (currentToneIndex === 1 || currentToneIndex === 2) ? 1 : 2;
      applyDrive(pair);
      setStatus(`TVF Pre-Filter Drive: ${$('tvfFilterDrive').options[$('tvfFilterDrive').selectedIndex].text} (Tones ${pair === 1 ? '1 & 2' : '3 & 4'})`);
    }
  });

  $('waveFxmSwitch').addEventListener('change', () => {
    dispatchToneParam('WAVE_FXM_SWITCH', $('waveFxmSwitch').checked ? 1 : 0, false);
  });

  $('waveFxmColor').addEventListener('change', () => {
    dispatchToneParam('WAVE_FXM_COLOR', parseInt($('waveFxmColor').value, 10), false);
  });

  $('waveTempoSync').addEventListener('change', () => {
    dispatchToneParam('WAVE_TEMPO_SYNC', $('waveTempoSync').checked ? 1 : 0, false);
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
      dispatchToneParam(p.param, val, true, `pitchEnv_${p.param}`);
    });
    $(p.el).addEventListener('change', () => {
      redrawPitchEnvCurve();
      const val = parseInt($(p.el).value, 10);
      dispatchToneParam(p.param, val, false);
    });
  }

  // TVF Filter & Env Sliders & Curves
  $('toneFilterType').addEventListener('change', () => {
    redrawFilterCurves();
    const val = parseInt($('toneFilterType').value, 10);
    dispatchToneParam('TVF_FILTER_TYPE', val, false);
  });

  const tvfEnvInputs = [
    { el: 'tvfEnvDepth', valEl: 'tvfEnvDepthVal', param: 'TVF_ENV_DEPTH', format: v => v - 64 },
    { el: 'tvfEnvT1', valEl: 'tvfEnvT1Val', param: 'TVF_ENV_T1', format: v => v },
    { el: 'tvfEnvT2', valEl: 'tvfEnvT2Val', param: 'TVF_ENV_T2', format: v => v },
    { el: 'tvfEnvT3', valEl: 'tvfEnvT3Val', param: 'TVF_ENV_T3', format: v => v },
    { el: 'tvfEnvT4', valEl: 'tvfEnvT4Val', param: 'TVF_ENV_T4', format: v => v },
    { el: 'tvfEnvL3', valEl: 'tvfEnvL3Val', param: 'TVF_ENV_L3', format: v => v },
  ];

  for (const t of tvfEnvInputs) {
    const el = $(t.el);
    if (!el) continue;
    el.addEventListener('input', () => {
      const val = parseInt(el.value, 10);
      const valEl = $(t.valEl);
      if (valEl) valEl.textContent = t.format(val);
      redrawFilterCurves();
      dispatchToneParam(t.param, val, true, `tvfEnv_${t.param}`);
    });
    el.addEventListener('change', () => {
      redrawFilterCurves();
      const val = parseInt(el.value, 10);
      dispatchToneParam(t.param, val, false);
    });
  }

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
      dispatchToneParam(t.param, val, true, `tvaEnv_${t.param}`);
    });
    $(t.el).addEventListener('change', () => {
      redrawTVAEnvCurve();
      const val = parseInt($(t.el).value, 10);
      dispatchToneParam(t.param, val, false);
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
    dispatchToneLFOParam(currentLfoIndex, 'FORM', val, false);
  });

  $('lfoRate').addEventListener('input', () => {
    const val = parseInt($('lfoRate').value, 10);
    $('lfoRateVal').textContent = val;
    redrawLFOCurve();
    dispatchToneLFOParam(currentLfoIndex, 'RATE', val, true, 'lfoRate');
  });
  $('lfoRate').addEventListener('change', () => {
    redrawLFOCurve();
    const val = parseInt($('lfoRate').value, 10);
    dispatchToneLFOParam(currentLfoIndex, 'RATE', val, false);
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
      dispatchToneLFOParam(currentLfoIndex, d.param, val, true, `lfoDepth_${d.param}`);
    });
    $(d.el).addEventListener('change', () => {
      const val = parseInt($(d.el).value, 10);
      dispatchToneLFOParam(currentLfoIndex, d.param, val, false);
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
      toneBytes[0x4F] = cached.tvfEnvDepth ?? 64;
      toneBytes[0x55] = cached.tvfEnvT1 ?? 15;
      toneBytes[0x56] = cached.tvfEnvT2 ?? 25;
      toneBytes[0x57] = cached.tvfEnvT3 ?? 40;
      toneBytes[0x58] = cached.tvfEnvT4 ?? 40;
      toneBytes[0x5B] = cached.tvfEnvL3 ?? 60;

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
// Modern VST Preset Transpiler (Vital & Serum to XV-5050)
// =============================================================================

let activeTranspiledPatch = null;

function displayTranspiledResult(transpiled) {
  if (!transpiled || !transpiled.xvPatch) return;
  activeTranspiledPatch = transpiled;

  const resContainer = $('vstResultContainer');
  if (resContainer) resContainer.style.display = 'block';

  const nameEl = $('vstResultPatchName');
  if (nameEl) nameEl.textContent = transpiled.xvPatch.common.patchName || transpiled.source.name || 'VST PATCH';

  const engineEl = $('vstResultEngine');
  if (engineEl) engineEl.textContent = `${transpiled.source.engine || transpiled.source.format.toUpperCase()} Transpilation`;

  // Update Tone 1..4 breakdown
  const tones = Array.isArray(transpiled.xvPatch.tones)
    ? transpiled.xvPatch.tones
    : [transpiled.xvPatch.tones[1], transpiled.xvPatch.tones[2], transpiled.xvPatch.tones[3], transpiled.xvPatch.tones[4]];

  for (let t = 0; t < 4; t++) {
    const tone = tones[t] || {};
    const waveEl = $(`vstTone${t + 1}Wave`);
    const paramsEl = $(`vstTone${t + 1}Params`);
    if (waveEl) {
      if (tone.enabled) {
        const wNum = tone.waveNumberL || 1;
        const wName = getWaveName(tone.waveGroupType || 0, wNum);
        waveEl.textContent = `Wave #${wNum}: ${wName}`;
      } else {
        waveEl.textContent = 'Disabled / Off';
      }
    }
    if (paramsEl) {
      if (tone.enabled) {
        const panStr = panDisplay(tone.tonePan ?? 64);
        const tuneSemi = (tone.coarseTune ?? 64) - 64;
        const detuneCents = (tone.fineTune ?? 64) - 64;
        paramsEl.textContent = `Level: ${tone.toneLevel ?? 127} | Pan: ${panStr} | Tune: ${tuneSemi >= 0 ? '+' : ''}${tuneSemi}st, ${detuneCents >= 0 ? '+' : ''}${detuneCents}c`;
      } else {
        paramsEl.textContent = 'Tone slot muted';
      }
    }
  }

  // Update Synthesis Metrics
  const c = transpiled.xvPatch.common;
  const fEl = $('vstReportFilter');
  if (fEl) {
    const t1 = tones[0] || {};
    const fType = FILTER_TYPES[t1.tvfFilterType ?? t1.filterType ?? 1] || 'LPF';
    fEl.textContent = `TVF ${fType} (Cutoff: ${t1.tvfCutoff ?? t1.cutoff ?? 127}, Res: ${t1.tvfResonance ?? t1.resonance ?? 0})`;
  }

  const envEl = $('vstReportEnv');
  if (envEl) {
    const t1 = tones[0] || {};
    envEl.textContent = `TVA (A:${t1.tvaEnvT1 ?? 10}, D:${t1.tvaEnvT2 ?? 20}, S:${t1.tvaEnvL3 ?? 70}, R:${t1.tvaEnvT4 ?? 30})`;
  }

  const fxEl = $('vstReportFx');
  if (fxEl) {
    fxEl.textContent = `Chorus: ${c.chorusSend ?? 0}, Reverb: ${c.reverbSend ?? 0}`;
  }

  const voiceEl = $('vstReportVoice');
  if (voiceEl) {
    voiceEl.textContent = `${c.monoPoly === 0 ? 'Mono' : 'Poly'} (Porta: ${c.portamentoSwitch ? c.portamentoTime : 'OFF'})`;
  }

  const statusEl = $('vstTranspileStatus');
  if (statusEl) {
    statusEl.innerHTML = `<span style="color:var(--success); font-weight:600;">✓ Successfully analyzed & transpiled "${c.patchName}" (${transpiled.source.format.toUpperCase()} -> XV-5050 4-Tone). Ready to load or transmit.</span>`;
  }
}

function loadTranspiledPatchIntoEditor(transpiled) {
  if (!transpiled || !transpiled.xvPatch) return;
  const common = transpiled.xvPatch.common;
  const tmt = transpiled.xvPatch.tmt;
  const tones = Array.isArray(transpiled.xvPatch.tones)
    ? transpiled.xvPatch.tones
    : [transpiled.xvPatch.tones[1], transpiled.xvPatch.tones[2], transpiled.xvPatch.tones[3], transpiled.xvPatch.tones[4]];

  store.set('patch.common', common);
  updatePatchCommonUI(common);

  store.set('patch.tmt', tmt);
  updatePatchTMTUI(tmt);

  for (let i = 0; i < 4; i++) {
    const tData = tones[i] || {};
    store.set('patch.tones.' + i, tData);
    currentToneCache[i] = tData;
  }

  const activeTone = currentToneCache[currentToneIndex - 1];
  if (activeTone) updateToneUI(activeTone);

  if (typeof syncDeepStudioToneCards === 'function') syncDeepStudioToneCards();
  if (typeof updateDeepStudioSpectrum === 'function') updateDeepStudioSpectrum();

  markEdited();
  switchToTab('patch');
  setStatus(`Loaded transpiled patch "${common.patchName || 'VST PATCH'}" into Patch Editor`);
}

async function sendTranspiledPatchToHardware(transpiled) {
  if (!transpiled || !transpiled.xvPatch) return;
  if (!midi.isConnected) {
    setStatus('Connect MIDI first before transmitting to hardware');
    return;
  }
  const patchName = transpiled.xvPatch.common.patchName || 'VST PATCH';
  setStatus(`Transmitting transpiled patch "${patchName}" directly to Roland XV-5050 temporary buffer...`);
  try {
    const effPart = getEffectivePatchPart() || 1;
    const { packets } = buildTranspiledPatchSyx(transpiled, effPart, getDeviceId());
    for (const pkt of packets) {
      midi.send(pkt);
      await new Promise(r => setTimeout(r, 25));
    }
    // Also load into editor DOM so UI stays synchronized with hardware
    loadTranspiledPatchIntoEditor(transpiled);
    setStatus(`✓ Transmitted transpiled patch "${patchName}" directly to XV-5050 (Part ${effPart})`);
  } catch (err) {
    console.error('Failed to send transpiled patch to synth:', err);
    setStatus(`Transmission failed: ${err.message}`);
  }
}

function exportTranspiledPatchSyx(transpiled) {
  if (!transpiled || !transpiled.xvPatch) return;
  const patchName = transpiled.xvPatch.common.patchName || 'VST PATCH';
  const effPart = getEffectivePatchPart() || 1;
  const { syxBytes } = buildTranspiledPatchSyx(transpiled, effPart, getDeviceId());
  const safeName = patchName.trim().replace(/[^a-zA-Z0-9_-]/g, '_') || 'vst_patch';
  downloadBinaryBlob(syxBytes, `${safeName}.syx`);
  setStatus(`Exported transpiled patch to ${safeName}.syx`);
}

async function handleVstFile(file) {
  const statusEl = $('vstTranspileStatus');
  if (statusEl) statusEl.textContent = `Reading and transpiling ${file.name}...`;
  try {
    const transpiled = await transpileVstFile(file);
    displayTranspiledResult(transpiled);
  } catch (err) {
    if (statusEl) {
      statusEl.innerHTML = `<span style="color:var(--danger); font-weight:600;">Error transpiling ${file.name}: ${err.message}</span>`;
    }
  }
}

function initVstTranspiler() {
  const btnOpen = $('btnOpenVstTranspiler');
  if (btnOpen) {
    btnOpen.addEventListener('click', (e) => {
      e.stopPropagation();
      switchToTab('librarian');
      const card = $('vstTranspilerCard');
      if (card) {
        card.scrollIntoView({ behavior: 'smooth', block: 'start' });
        card.classList.add('flash-highlight');
        setTimeout(() => card.classList.remove('flash-highlight'), 1200);
      }
    });
  }

  const demoSelect = $('vstDemoPresetSelect');
  if (demoSelect) {
    demoSelect.addEventListener('change', () => {
      const val = demoSelect.value;
      if (!val) return;
      const demo = VST_DEMO_PATCHES.find(d => d.id === val);
      if (demo) {
        try {
          const transpiled = parseVitalPatch(demo.data);
          displayTranspiledResult(transpiled);
        } catch (err) {
          const statusEl = $('vstTranspileStatus');
          if (statusEl) statusEl.textContent = `Error loading demo preset: ${err.message}`;
        }
      }
    });
  }

  const dropzone = $('vstDropzone');
  const fileInput = $('vstFileInput');

  if (dropzone && fileInput) {
    dropzone.addEventListener('click', () => fileInput.click());

    dropzone.addEventListener('dragover', (e) => {
      e.preventDefault();
      dropzone.classList.add('dragover');
    });

    dropzone.addEventListener('dragleave', () => dropzone.classList.remove('dragover'));

    dropzone.addEventListener('drop', async (e) => {
      e.preventDefault();
      dropzone.classList.remove('dragover');
      if (e.dataTransfer.files.length > 0) {
        await handleVstFile(e.dataTransfer.files[0]);
      }
    });

    fileInput.addEventListener('change', async () => {
      if (fileInput.files.length > 0) {
        await handleVstFile(fileInput.files[0]);
      }
    });
  }

  const btnLoad = $('btnLoadTranspiledPatch');
  if (btnLoad) {
    btnLoad.addEventListener('click', () => {
      if (activeTranspiledPatch) loadTranspiledPatchIntoEditor(activeTranspiledPatch);
    });
  }

  const btnSend = $('btnSendTranspiledToSynth');
  if (btnSend) {
    btnSend.addEventListener('click', async () => {
      if (activeTranspiledPatch) await sendTranspiledPatchToHardware(activeTranspiledPatch);
    });
  }

  const btnExport = $('btnExportTranspiledSyx');
  if (btnExport) {
    btnExport.addEventListener('click', () => {
      if (activeTranspiledPatch) exportTranspiledPatchSyx(activeTranspiledPatch);
    });
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
  const isDeepRequest = (target === 'deepStudio');
  const effectiveTab = isDeepRequest ? 'patch' : target;

  document.querySelectorAll('.tab-btn').forEach(b => {
    b.classList.toggle('active', b.dataset.tab === target || (isDeepRequest && b.dataset.tab === 'patch'));
  });
  document.querySelectorAll('.tab-content').forEach(c => {
    c.classList.toggle('active', c.id === (effectiveTab + 'Tab'));
  });

  const dsTab = $('deepStudioTab');
  if (dsTab) {
    dsTab.classList.toggle('active', effectiveTab === 'patch');
  }

  if (isDeepRequest) {
    const rollupBody = $('deepStudioRollupBody');
    const toggleBtn = $('btnRollupToggleState');
    if (rollupBody) {
      rollupBody.style.display = 'block';
      if (toggleBtn) toggleBtn.textContent = 'Collapse ▲';
    }
    if (dsTab) {
      setTimeout(() => dsTab.scrollIntoView({ behavior: 'smooth', block: 'start' }), 50);
    }
  }

  if (target === 'monitor') {
    renderTrafficBuffer();
  }

  if ((target === 'patch' || isDeepRequest) && midi.isConnected) {
    const effPart = getEffectivePatchPart();
    if (!activePartPatchesCache[effPart]) {
      autoSyncActivePatchFromHardware(effPart);
    }
  }
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
  { id: 'prf', label: 'Preset F (PR-F)', msb: 87, lsb: 69, count: 128, isRhythm: false },
  { id: 'prg', label: 'Preset G (PR-G)', msb: 87, lsb: 70, count: 128, isRhythm: false },
  { id: 'prh', label: 'Preset H (PR-H)', msb: 87, lsb: 71, count: 128, isRhythm: false },
  { id: 'gm2', label: 'GM2 Bank (GM)', msb: 121, lsb: 0, count: 256, isRhythm: false },
  { id: 'preset_rhy', label: 'Preset Rhythm Kits (PR-RHY)', msb: 86, lsb: 64, count: 8, isRhythm: true },
  { id: 'user_rhy', label: 'User Rhythm Kits (USER-RHY)', msb: 86, lsb: 0, count: 4, isRhythm: true },
];

const SYNC_CACHE_KEY = 'xv5050_synced_unit_db';
let syncedUnitDb = null;

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
  if (perfSelect) {
    perfSelect.innerHTML = '<option value="">— Select Performance —</option>';

    // Group 1: User Performances (1-64)
    const ogUser = document.createElement('optgroup');
    ogUser.label = '— User Performances (1-64) —';
    if (syncedUnitDb?.userPerformances?.length) {
      syncedUnitDb.userPerformances.forEach((p) => {
        const opt = document.createElement('option');
        opt.value = `user:${p.index}`;
        opt.textContent = `User ${String(p.index).padStart(2, '0')}: ${p.name}`;
        ogUser.appendChild(opt);
      });
    } else {
      for (let u = 1; u <= 64; u++) {
        const opt = document.createElement('option');
        opt.value = `user:${u}`;
        opt.textContent = `User ${String(u).padStart(2, '0')} (Bank 85/0)`;
        ogUser.appendChild(opt);
      }
    }
    perfSelect.appendChild(ogUser);

    // Group 2: Roland Factory Preset PR-A (1-64)
    if (ROLAND_PRESET_PERFORMANCES?.['PR-A']) {
      const ogPra = document.createElement('optgroup');
      ogPra.label = '— Roland Factory Preset PR-A (1-64) —';
      ROLAND_PRESET_PERFORMANCES['PR-A'].forEach((name, idx) => {
        const pNum = idx + 1;
        const opt = document.createElement('option');
        opt.value = `pra:${pNum}`;
        opt.textContent = `PR-A ${String(pNum).padStart(2, '0')}: ${name}`;
        ogPra.appendChild(opt);
      });
      perfSelect.appendChild(ogPra);
    }

    // Group 3: Roland Factory Preset PR-B (1-32)
    if (ROLAND_PRESET_PERFORMANCES?.['PR-B']) {
      const ogPrb = document.createElement('optgroup');
      ogPrb.label = '— Roland Factory Preset PR-B (1-32) —';
      ROLAND_PRESET_PERFORMANCES['PR-B'].forEach((name, idx) => {
        const pNum = idx + 1;
        const opt = document.createElement('option');
        opt.value = `prb:${pNum}`;
        opt.textContent = `PR-B ${String(pNum).padStart(2, '0')}: ${name}`;
        ogPrb.appendChild(opt);
      });
      perfSelect.appendChild(ogPrb);
    }
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
  ogUser.label = '— Hardware User Patches (USER, Bank 87/0) —';
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

  // Group 3: Roland Factory Preset A (PR-A, Bank 87/64)
  const ogPra = document.createElement('optgroup');
  ogPra.label = '— Roland Factory Preset A (PR-A, Bank 87/64) —';
  for (let pc = 1; pc <= 128; pc++) {
    const opt = document.createElement('option');
    opt.value = `bank:pra:87:64:${pc}`;
    const name = ROLAND_PRESET_A_PATCHES[pc - 1] || `Preset A ${String(pc).padStart(3, '0')}`;
    opt.textContent = `PR-A ${String(pc).padStart(3, '0')}: ${name}`;
    ogPra.appendChild(opt);
  }
  selectEl.appendChild(ogPra);

  // Group 4: Roland Factory Preset B (PR-B, Bank 87/65)
  const ogPrb = document.createElement('optgroup');
  ogPrb.label = '— Roland Factory Preset B (PR-B, Bank 87/65) —';
  for (let pc = 1; pc <= 128; pc++) {
    const opt = document.createElement('option');
    opt.value = `bank:prb:87:65:${pc}`;
    const name = ROLAND_PRESET_B_PATCHES[pc - 1] || `Preset B ${String(pc).padStart(3, '0')}`;
    opt.textContent = `PR-B ${String(pc).padStart(3, '0')}: ${name}`;
    ogPrb.appendChild(opt);
  }
  selectEl.appendChild(ogPrb);

  // Group 5: Roland Factory Preset C (PR-C, Bank 87/66)
  const ogPrc = document.createElement('optgroup');
  ogPrc.label = '— Roland Factory Preset C (PR-C, Bank 87/66) —';
  for (let pc = 1; pc <= 128; pc++) {
    const opt = document.createElement('option');
    opt.value = `bank:prc:87:66:${pc}`;
    const name = ROLAND_PRESET_C_PATCHES[pc - 1] || `Preset C ${String(pc).padStart(3, '0')}`;
    opt.textContent = `PR-C ${String(pc).padStart(3, '0')}: ${name}`;
    ogPrc.appendChild(opt);
  }
  selectEl.appendChild(ogPrc);

  // Group 6: Roland Factory Preset D (PR-D, Bank 87/67)
  const ogPrd = document.createElement('optgroup');
  ogPrd.label = '— Roland Factory Preset D (PR-D, Bank 87/67) —';
  for (let pc = 1; pc <= 128; pc++) {
    const opt = document.createElement('option');
    opt.value = `bank:prd:87:67:${pc}`;
    const name = ROLAND_PRESET_D_PATCHES[pc - 1] || `Preset D ${String(pc).padStart(3, '0')}`;
    opt.textContent = `PR-D ${String(pc).padStart(3, '0')}: ${name}`;
    ogPrd.appendChild(opt);
  }
  selectEl.appendChild(ogPrd);

  // Group 7: Roland Factory Preset E (PR-E, Bank 87/68)
  const ogPre = document.createElement('optgroup');
  ogPre.label = '— Roland Factory Preset E (PR-E, Bank 87/68) —';
  for (let pc = 1; pc <= 128; pc++) {
    const opt = document.createElement('option');
    opt.value = `bank:pre:87:68:${pc}`;
    const name = ROLAND_PRESET_E_PATCHES[pc - 1] || `Preset E ${String(pc).padStart(3, '0')}`;
    opt.textContent = `PR-E ${String(pc).padStart(3, '0')}: ${name}`;
    ogPre.appendChild(opt);
  }
  selectEl.appendChild(ogPre);

  // Group 8: Roland Factory Preset F (PR-F, Bank 87/69)
  const ogPrf = document.createElement('optgroup');
  ogPrf.label = '— Roland Factory Preset F (PR-F, Bank 87/69) —';
  for (let pc = 1; pc <= 128; pc++) {
    const opt = document.createElement('option');
    opt.value = `bank:prf:87:69:${pc}`;
    const name = ROLAND_PRESET_F_PATCHES[pc - 1] || `Preset F ${String(pc).padStart(3, '0')}`;
    opt.textContent = `PR-F ${String(pc).padStart(3, '0')}: ${name}`;
    ogPrf.appendChild(opt);
  }
  selectEl.appendChild(ogPrf);

  // Group 9: Roland Factory Preset G (PR-G, Bank 87/70)
  const ogPrg = document.createElement('optgroup');
  ogPrg.label = '— Roland Factory Preset G (PR-G, Bank 87/70) —';
  for (let pc = 1; pc <= 128; pc++) {
    const opt = document.createElement('option');
    opt.value = `bank:prg:87:70:${pc}`;
    const name = ROLAND_PRESET_G_PATCHES[pc - 1] || `Preset G ${String(pc).padStart(3, '0')}`;
    opt.textContent = `PR-G ${String(pc).padStart(3, '0')}: ${name}`;
    ogPrg.appendChild(opt);
  }
  selectEl.appendChild(ogPrg);

  // Group 10: Roland Factory Preset H (PR-H, Bank 87/71)
  const ogPrh = document.createElement('optgroup');
  ogPrh.label = '— Roland Factory Preset H (PR-H, Bank 87/71) —';
  for (let pc = 1; pc <= 128; pc++) {
    const opt = document.createElement('option');
    opt.value = `bank:prh:87:71:${pc}`;
    const name = ROLAND_PRESET_H_PATCHES[pc - 1] || `Preset H ${String(pc).padStart(3, '0')}`;
    opt.textContent = `PR-H ${String(pc).padStart(3, '0')}: ${name}`;
    ogPrh.appendChild(opt);
  }
  selectEl.appendChild(ogPrh);

  // Group 11: General MIDI 2 (GM2, Bank 121/0)
  const ogGm = document.createElement('optgroup');
  ogGm.label = '— General MIDI 2 (GM2, Bank 121/0) —';
  for (let pc = 1; pc <= 128; pc++) {
    const opt = document.createElement('option');
    opt.value = `bank:gm2:121:0:${pc}`;
    const name = ROLAND_GM2_PATCHES[pc - 1] || `GM2 ${String(pc).padStart(3, '0')}`;
    opt.textContent = `GM2 ${String(pc).padStart(3, '0')}: ${name}`;
    ogGm.appendChild(opt);
  }
  selectEl.appendChild(ogGm);

  // Group 12: Rhythm Drum Kits (Bank 86)
  const ogRhy = document.createElement('optgroup');
  ogRhy.label = '— Rhythm Drum Kits (Bank 86) —';
  ROLAND_PRESET_DRUM_KITS.forEach((kitName, idx) => {
    const opt = document.createElement('option');
    opt.value = `rhythm:preset:${idx + 1}`;
    opt.textContent = `Preset Drum ${idx + 1}: ${kitName} (Bank 86/64 PC ${idx + 1})`;
    ogRhy.appendChild(opt);
  });
  ROLAND_USER_DRUM_KITS.forEach((kitName, idx) => {
    const opt = document.createElement('option');
    opt.value = `rhythm:user:${idx + 1}`;
    opt.textContent = `User Drum ${idx + 1}: ${kitName} (Bank 86/0 PC ${idx + 1})`;
    ogRhy.appendChild(opt);
  });
  selectEl.appendChild(ogRhy);

  // Group 10: SRX Slot A Expansion Board Patches (Real authentic patch names)
  const boardIdA = $('srxSlotASelect')?.value || localStorage.getItem('xv5050_srx_slot_a') || 'NONE';
  if (boardIdA && boardIdA !== 'NONE') {
    const boardA = getSrxBoard(boardIdA);
    if (boardA) {
      const ogSrxA = document.createElement('optgroup');
      ogSrxA.label = `— SRX Slot A: ${boardA.name} —`;
      const patchesA = getSrxPatches(boardIdA);
      patchesA.forEach((patchName, idx) => {
        const pNum = idx + 1;
        const opt = document.createElement('option');
        opt.value = `srx:A:${boardIdA}:${pNum}`;
        opt.textContent = patchName;
        ogSrxA.appendChild(opt);
      });
      selectEl.appendChild(ogSrxA);
    }
  }

  // Group 11: SRX Slot B Expansion Board Patches
  const boardIdB = $('srxSlotBSelect')?.value || localStorage.getItem('xv5050_srx_slot_b') || 'NONE';
  if (boardIdB && boardIdB !== 'NONE') {
    const boardB = getSrxBoard(boardIdB);
    if (boardB) {
      const ogSrxB = document.createElement('optgroup');
      ogSrxB.label = `— SRX Slot B: ${boardB.name} —`;
      const patchesB = getSrxPatches(boardIdB);
      patchesB.forEach((patchName, idx) => {
        const pNum = idx + 1;
        const opt = document.createElement('option');
        opt.value = `srx:B:${boardIdB}:${pNum}`;
        opt.textContent = patchName;
        ogSrxB.appendChild(opt);
      });
      selectEl.appendChild(ogSrxB);
    }
  }

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
  if (curMsb === 93) {
    // SRX Patch Pre-selection
    const slot = curLsb >= 4 ? 'B' : 'A';
    const baseLsb = slot === 'A' ? 0 : 4;
    const patchNum = (curLsb - baseLsb) * 128 + curPc;
    const boardId = slot === 'A' ? boardIdA : boardIdB;
    const srxVal = `srx:${slot}:${boardId}:${patchNum}`;
    if (Array.from(selectEl.options).some(o => o.value === srxVal)) {
      selectEl.value = srxVal;
      return;
    }
  }
  const bankMatch = Array.from(selectEl.options).find(o => o.value.startsWith('bank:') && o.value.endsWith(`:${curMsb}:${curLsb}:${curPc}`));
  if (bankMatch) {
    selectEl.value = bankMatch.value;
    return;
  }
  const customVal = `custom:${curMsb}:${curLsb}:${curPc}:${forPart}`;
  if (Array.from(selectEl.options).some(o => o.value === customVal)) {
    selectEl.value = customVal;
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

function selectPart(part, autoSync = true) {
  const partSel = $('patchPartSelect');
  if (partSel && parseInt(partSel.value, 10) !== part) {
    partSel.value = part;
  }

  for (let i = 1; i <= 16; i++) {
    const row = $('partRow' + i);
    if (row) row.classList.toggle('selected', i === part);
    const stripBtn = $('partStripBtn' + i);
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
    setStatus('Switched to ' + (part === 0 ? 'Single Patch' : ('Part ' + part + ' Patch')) + ' (' + (cached.common?.name || '') + ')');
  }

  // Automatically sync the exact patch from the hardware unit
  if (autoSync && midi.isConnected) {
    autoSyncActivePatchFromHardware(part);
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

  const dsPartBadge = $('deepStudioPartBadge');
  if (dsPartBadge) dsPartBadge.textContent = part === 0 ? 'SOLO' : `PART ${part}`;
  const dsPatchName = $('deepStudioPatchName');
  if (dsPatchName && patchName) dsPatchName.textContent = patchName;
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
    name = sub === 'user'
      ? (ROLAND_USER_DRUM_KITS[rIdx - 1] || `User Drum Kit ${rIdx}`)
      : (ROLAND_PRESET_DRUM_KITS[rIdx - 1] || `Preset Drum Kit ${rIdx}`);
  } else if (type === 'bank') {
    const bankId = parts[1];
    bankMsb = parseInt(parts[2], 10);
    bankLsb = parseInt(parts[3], 10);
    pc = parseInt(parts[4] || 1, 10);
    const bank = ROLAND_BANKS.find(b => b.id === bankId);
    name = getPresetPatchName(bankId, pc) || `${bank?.label || 'Preset'} #${pc}`;
  } else if (type === 'srx') {
    const slot = parts[1]; // 'A' or 'B'
    const boardId = parts[2];
    const patchNum = parseInt(parts[3] || '1', 10);
    const lsbOffset = slot === 'A' ? 0 : 4;
    bankMsb = 93;
    bankLsb = lsbOffset + Math.floor((patchNum - 1) / 128);
    pc = ((patchNum - 1) % 128) + 1;
    const patches = getSrxPatches(boardId);
    name = patches[patchNum - 1] || `${boardId} Patch #${patchNum}`;
  } else if (type === 'srx_rhythm') {
    const slot = parts[1];
    const boardId = parts[2];
    const kitNum = parseInt(parts[3] || '1', 10);
    const lsbOffset = slot === 'A' ? 0 : 2;
    bankMsb = 92;
    bankLsb = lsbOffset + Math.floor((kitNum - 1) / 128);
    pc = ((kitNum - 1) % 128) + 1;
    name = `${boardId} Drum Kit #${kitNum}`;
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
  if (getSelectedPart() === part || currentSoundMode === 1) {
    updateActivePartUI(part);
    if (midi.isConnected) {
      autoSyncActivePatchFromHardware(part);
    }
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

window.loadSyncedUserPerf = async function(spec) {
  switchToTab('performance');
  const sel = $('userPerfSelect');
  if (sel && sel.value !== String(spec)) sel.value = String(spec);

  let bank = 'USER';
  let index = 1;
  let bankLabel = 'User Performance';
  if (typeof spec === 'number') {
    index = spec;
    bankLabel = `User Performance ${index}`;
  } else if (typeof spec === 'string') {
    if (spec.startsWith('user:')) {
      index = parseInt(spec.split(':')[1], 10) || 1;
      bank = 'USER';
      bankLabel = `User Performance ${index}`;
    } else if (spec.startsWith('pra:')) {
      index = parseInt(spec.split(':')[1], 10) || 1;
      bank = 'PR-A';
      const pName = ROLAND_PRESET_PERFORMANCES?.['PR-A']?.[index - 1] || '';
      bankLabel = `Preset PR-A ${index}${pName ? ` (${pName})` : ''}`;
    } else if (spec.startsWith('prb:')) {
      index = parseInt(spec.split(':')[1], 10) || 1;
      bank = 'PR-B';
      const pName = ROLAND_PRESET_PERFORMANCES?.['PR-B']?.[index - 1] || '';
      bankLabel = `Preset PR-B ${index}${pName ? ` (${pName})` : ''}`;
    } else {
      index = parseInt(spec, 10) || 1;
      bankLabel = `User Performance ${index}`;
    }
  }

  if (midi.isConnected) {
    try {
      // 1. Ensure synthesizer software state, UI badges, and hardware unit are in Performance Mode
      setSynthesizerMode(2, true);

      // Allow hardware CPU 50ms to switch modes before receiving selection commands
      await new Promise(r => setTimeout(r, 50));

      // 2. Command the physical XV-5050 hardware to switch its active Performance
      setStatus(`Switching XV-5050 hardware to ${bankLabel}...`);
      const perfCtrlCh = syncedUnitDb?.systemCommon?.perfCtrlChannel;
      sendActivePerformanceSelection(midi, index, getDeviceId(), perfCtrlCh, bank);

      // 3. Allow hardware CPU to switch active performance buffers
      await new Promise(r => setTimeout(r, 120));

      // 4. Request complete performance data from hardware to update editor UI
      setStatus(`Reading ${bankLabel} from XV-5050 hardware...`);
      const fullPerf = (bank === 'USER')
        ? await requestEntireUserPerformance(midi, index, getDeviceId())
        : await requestEntirePerformance(midi, getDeviceId());

      if (fullPerf.common) updatePerformanceCommonUI(fullPerf.common);
      if (fullPerf.mfxA) {
        perfMfxCache.A = fullPerf.mfxA;
        updatePerfMfxBadges('A', fullPerf.mfxA.mfxType);
      }
      if (fullPerf.chorus) updatePerformanceChorusUI(fullPerf.chorus);
      if (fullPerf.reverb) updatePerformanceReverbUI(fullPerf.reverb);
      if (Array.isArray(fullPerf.parts)) {
        fullPerf.parts.forEach((p, idx) => {
          if (p) updatePartRow(idx + 1, p);
        });
      }
      clearEdited();
      setStatus(`Switched XV-5050 to ${bankLabel}: "${fullPerf.common?.name || ''}"`);
      return;
    } catch (err) {
      console.warn('Hardware read failed, falling back to cached db:', err);
    }
  }

  if (bank === 'USER' && syncedUnitDb) {
    const perf = syncedUnitDb.userPerformances?.find(p => p.index === index);
    if (!perf) return;
    if (perf.raw) {
      const common = parsePerformanceCommon(perf.raw);
      updatePerformanceCommonUI(common);
    }
    setStatus(`Loaded cached User Performance ${index}: "${perf.name}" into editor`);
  } else if ((bank === 'PR-A' || bank === 'PR-B') && ROLAND_PRESET_PERFORMANCES?.[bank]) {
    const name = ROLAND_PRESET_PERFORMANCES[bank][index - 1] || `${bank} ${index}`;
    updatePerformanceCommonUI({ name });
    setStatus(`Loaded Preset ${bank} Performance ${index}: "${name}"`);
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
// SRX Expansion Boards Management
// =============================================================================

function initSrxSlots() {
  const slotASel = $('srxSlotASelect');
  const slotBSel = $('srxSlotBSelect');
  const waveSrxSelect = $('waveSrxBoardSelect');

  let savedA = 'NONE';
  let savedB = 'NONE';
  try {
    savedA = localStorage.getItem('xv5050_srx_slot_a') || 'NONE';
    savedB = localStorage.getItem('xv5050_srx_slot_b') || 'NONE';
  } catch (e) {
    console.warn('Could not read SRX config from localStorage', e);
  }

  if (slotASel) slotASel.value = savedA;
  if (slotBSel) slotBSel.value = savedB;

  function updateSrxBoardOptions() {
    if (!waveSrxSelect) return;
    const aVal = slotASel ? slotASel.value : 'NONE';
    const bVal = slotBSel ? slotBSel.value : 'NONE';
    waveSrxSelect.innerHTML = `
      <option value="A">Slot A: ${aVal === 'NONE' ? '(Empty)' : aVal}</option>
      <option value="B">Slot B: ${bVal === 'NONE' ? '(Empty)' : bVal}</option>
    `;
  }

  updateSrxBoardOptions();
  updateWaveGroupDropdownLabels();

  if (slotASel) {
    slotASel.addEventListener('change', () => {
      try {
        localStorage.setItem('xv5050_srx_slot_a', slotASel.value);
      } catch (e) {}
      updateSrxBoardOptions();
      updateWaveGroupDropdownLabels();
      const curWg = $('waveGroup')?.value;
      if (curWg === 'SRX-A') {
        populateWaveDropdowns(2, 'A');
      }
      populateAllInstrumentSelectors();
      setStatus(`SRX Slot A set to ${slotASel.value}`);
    });
  }

  if (slotBSel) {
    slotBSel.addEventListener('change', () => {
      try {
        localStorage.setItem('xv5050_srx_slot_b', slotBSel.value);
      } catch (e) {}
      updateSrxBoardOptions();
      updateWaveGroupDropdownLabels();
      const curWg = $('waveGroup')?.value;
      if (curWg === 'SRX-B') {
        populateWaveDropdowns(2, 'B');
      }
      populateAllInstrumentSelectors();
      setStatus(`SRX Slot B set to ${slotBSel.value}`);
    });
  }

  if (waveSrxSelect) {
    waveSrxSelect.addEventListener('change', () => {
      populateWaveDropdowns(2, waveSrxSelect.value);
      const grp = parseInt($('waveGroup')?.value, 10);
      const numL = parseInt($('waveNumberL')?.value, 10) || 1;
      const nl = $('waveNameL');
      if (nl) nl.textContent = getWaveName(grp, numL);
    });
  }
}

// =============================================================================
// Microtonal Temperaments & Scale Tuning (Table 1-3-5)
// =============================================================================

function initScaleTuneControls() {
  const btnApply = $('btnApplyScaleTemperament');
  const tempSelect = $('scaleTemperamentSelect');
  if (!btnApply || !tempSelect) return;

  btnApply.addEventListener('click', () => {
    const part = getEffectivePatchPart() || 1;
    const scaleKey = tempSelect.value;
    const temp = SCALE_TEMPERAMENTS[scaleKey] || SCALE_TEMPERAMENTS.equal;
    const sysex = buildPartScaleTemperamentDT1(getDeviceId(), part, temp.offsets);
    if (midi.isConnected) {
      midi.sendSysEx(sysex);
      setStatus(`Applied ${temp.name} scale tuning to Part ${part}`);
    } else {
      setStatus(`Scale Tuning (${temp.name}): Connect MIDI to transmit to Part ${part}`);
    }
  });
}

// =============================================================================
// Deep Patch Studio Engine (Modern VST Architecture & Mutator)
// =============================================================================

const mutatorHistory = new MutatorHistory(20);
let mutatorOriginalSnapshot = null;
let isViewingOriginalAB = false;

function getCurrentPatchFullSnapshot() {
  return {
    common: currentPatchCommonData ? JSON.parse(JSON.stringify(currentPatchCommonData)) : {},
    tmt: currentPatchTMTData ? JSON.parse(JSON.stringify(currentPatchTMTData)) : {},
    tones: {
      1: currentToneCache[0] ? JSON.parse(JSON.stringify(currentToneCache[0])) : {},
      2: currentToneCache[1] ? JSON.parse(JSON.stringify(currentToneCache[1])) : {},
      3: currentToneCache[2] ? JSON.parse(JSON.stringify(currentToneCache[2])) : {},
      4: currentToneCache[3] ? JSON.parse(JSON.stringify(currentToneCache[3])) : {}
    }
  };
}

function syncDeepStudioToneCards() {
  for (let t = 1; t <= 4; t++) {
    const data = currentToneCache[t - 1] || {};
    const card = $(`deepToneCard${t}`);
    const enCheckbox = $(`deepTone${t}En`);
    const levelInput = $(`deepTone${t}Level`);
    const levelVal = $(`deepTone${t}LevelVal`);
    const panInput = $(`deepTone${t}Pan`);
    const panVal = $(`deepTone${t}PanVal`);
    const cutoffInput = $(`deepTone${t}Cutoff`);
    const cutoffVal = $(`deepTone${t}CutoffVal`);
    const waveBadge = $(`deepTone${t}WaveBadge`);

    const grp = data.waveGroupType ?? 0;
    const wNumL = data.waveNumberL ?? (t === 1 ? 1 : 0);
    const lvl = data.toneLevel ?? (t <= 2 ? 127 : 0);
    const pan = data.tonePan ?? 64;
    const cut = data.tvfCutoff ?? 127;
    const isEnabled = currentPatchTMTData ? (currentPatchTMTData[`tone${t}Switch`] ?? (t <= 2 ? 1 : 0)) === 1 : (lvl > 0);

    if (card) card.classList.toggle('disabled', !isEnabled);
    if (enCheckbox) enCheckbox.checked = isEnabled;
    if (levelInput) levelInput.value = lvl;
    if (levelVal) levelVal.textContent = lvl;
    if (panInput) panInput.value = pan;
    if (panVal) panVal.textContent = panDisplay(pan);
    if (cutoffInput) cutoffInput.value = cut;
    if (cutoffVal) cutoffVal.textContent = cut;
    if (waveBadge) waveBadge.textContent = wNumL === 0 ? 'OFF' : getWaveName(grp, wNumL);
  }
}

function updateDeepStudioSpectrum() {
  const pathEl = $('deepSpectrumPath');
  if (!pathEl) return;
  const activeTone = currentToneCache[currentToneIndex - 1] || {};
  const cut = parseInt($('toneCutoff')?.value ?? activeTone.tvfCutoff ?? 127, 10);
  const res = parseInt($('toneResonance')?.value ?? activeTone.tvfResonance ?? 0, 10);
  const fType = parseInt($('toneFilterType')?.value ?? activeTone.tvfFilterType ?? 0, 10);
  const pathD = generateSpectrumPath(cut, res, fType, 360, 85);
  pathEl.setAttribute('d', pathD);
  const badge = $('spectrumFilterBadge');
  if (badge) {
    badge.textContent = `${FILTER_TYPES[fType] || 'OFF'} Filter Active`;
  }
}

function applyFullPatchSnapshot(patchData, sendToHardware = true) {
  if (!patchData) return;
  if (patchData.common) {
    updatePatchCommonUI(patchData.common);
    store.set('patch.common', patchData.common);
  }
  if (patchData.tmt) {
    updatePatchTMTUI(patchData.tmt);
    store.set('patch.tmt', patchData.tmt);
  }
  if (patchData.tones) {
    for (let t = 1; t <= 4; t++) {
      const toneData = patchData.tones[t];
      if (toneData) {
        currentToneCache[t - 1] = toneData;
        store.set(`patch.tones.${t - 1}`, toneData);
      }
    }
    const activeTone = currentToneCache[currentToneIndex - 1];
    if (activeTone) updateToneUI(activeTone);
  }

  syncDeepStudioToneCards();
  updateDeepStudioSpectrum();

  if (sendToHardware && midi.isConnected) {
    const part = getEffectivePatchPart();
    const devId = getDeviceId();
    // Transmit key parameters for all active tones
    for (let t = 1; t <= 4; t++) {
      const toneData = currentToneCache[t - 1];
      if (toneData) {
        if (toneData.toneLevel !== undefined) sendPatchToneParam(midi, part, t, 'TONE_LEVEL', toneData.toneLevel, devId);
        if (toneData.tvfCutoff !== undefined) sendPatchToneParam(midi, part, t, 'TVF_CUTOFF', toneData.tvfCutoff, devId);
        if (toneData.tvfResonance !== undefined) sendPatchToneParam(midi, part, t, 'TVF_RESONANCE', toneData.tvfResonance, devId);
        if (toneData.waveNumberL !== undefined) sendPatchToneParam(midi, part, t, 'WAVE_NUMBER_L', toneData.waveNumberL, devId);
      }
    }
  }
}

function initDeepStudio() {
  // 0. Roll-Up Collapsible Panel Controls
  const rollupHeader = $('btnToggleDeepStudioRollup');
  const rollupBody = $('deepStudioRollupBody');
  const toggleBtn = $('btnRollupToggleState');

  let isExpanded = false;
  try {
    const saved = localStorage.getItem('xv5050_deep_studio_rollup');
    if (saved !== null) isExpanded = saved === 'true';
  } catch (_) {}

  if (rollupBody) {
    rollupBody.style.display = isExpanded ? 'block' : 'none';
    if (toggleBtn) toggleBtn.textContent = isExpanded ? 'Collapse ▲' : 'Expand ▼';
  }

  if (rollupHeader && rollupBody) {
    rollupHeader.addEventListener('click', (e) => {
      // Don't toggle if clicking on an interactive control inside header
      if (e.target.tagName === 'INPUT' || e.target.tagName === 'SELECT') return;
      isExpanded = rollupBody.style.display === 'none';
      rollupBody.style.display = isExpanded ? 'block' : 'none';
      if (toggleBtn) toggleBtn.textContent = isExpanded ? 'Collapse ▲' : 'Expand ▼';
      try {
        localStorage.setItem('xv5050_deep_studio_rollup', isExpanded ? 'true' : 'false');
      } catch (_) {}
    });
  }

  // 1. Performance Macro Knobs
  for (let m = 1; m <= 4; m++) {
    const dial = $(`macro${m}Dial`);
    const valPill = $(`macro${m}Val`);
    if (dial && valPill) {
      dial.addEventListener('input', () => {
        const val = parseInt(dial.value, 10);
        const delta = val - 64;
        valPill.textContent = delta > 0 ? `+${delta}` : `${delta}`;

        const part = getEffectivePatchPart();
        const devId = getDeviceId();

        if (m === 1) {
          // Macro 1: Brightness (Cutoff Offset across active tones)
          for (let t = 1; t <= 4; t++) {
            const currentCutoff = parseInt($(`deepTone${t}Cutoff`)?.value || 127, 10);
            const nextCutoff = Math.max(0, Math.min(127, currentCutoff + Math.round(delta * 0.5)));
            if (currentToneCache[t - 1]) currentToneCache[t - 1].tvfCutoff = nextCutoff;
            const cutInput = $(`deepTone${t}Cutoff`);
            if (cutInput) cutInput.value = nextCutoff;
            const cutVal = $(`deepTone${t}CutoffVal`);
            if (cutVal) cutVal.textContent = nextCutoff;
            if (currentToneIndex === t && $('toneCutoff')) {
              $('toneCutoff').value = nextCutoff;
              $('toneCutoffVal').textContent = nextCutoff;
            }
            if (midi.isConnected) {
              sendThrottled(`macro_cutoff_${t}`, () => {
                sendPatchToneParam(midi, part, t, 'TVF_CUTOFF', nextCutoff, devId);
              });
            }
          }
          updateDeepStudioSpectrum();
        } else if (m === 2) {
          // Macro 2: Timbre (Resonance Offset across active tones)
          for (let t = 1; t <= 4; t++) {
            const currentRes = currentToneCache[t - 1]?.tvfResonance ?? 10;
            const nextRes = Math.max(0, Math.min(127, currentRes + Math.round(delta * 0.4)));
            if (currentToneCache[t - 1]) currentToneCache[t - 1].tvfResonance = nextRes;
            if (currentToneIndex === t && $('toneResonance')) {
              $('toneResonance').value = nextRes;
              $('toneResonanceVal').textContent = nextRes;
            }
            if (midi.isConnected) {
              sendThrottled(`macro_res_${t}`, () => {
                sendPatchToneParam(midi, part, t, 'TVF_RESONANCE', nextRes, devId);
              });
            }
          }
          updateDeepStudioSpectrum();
        } else if (m === 3) {
          // Macro 3: Space (Chorus and Reverb send levels)
          const baseCho = currentPatchCommonData?.chorusSend ?? 40;
          const baseRev = currentPatchCommonData?.reverbSend ?? 40;
          const nextCho = Math.max(0, Math.min(127, baseCho + Math.round(delta * 0.5)));
          const nextRev = Math.max(0, Math.min(127, baseRev + Math.round(delta * 0.5)));
          if (midi.isConnected) {
            sendThrottled('macro_space', () => {
              sendPatchChorusParam(midi, part, 'CHORUS_SEND', nextCho, devId);
              sendPatchReverbParam(midi, part, 'REVERB_SEND', nextRev, devId);
            });
          }
        } else if (m === 4) {
          // Macro 4: Motion (LFO 1 Rate)
          for (let t = 1; t <= 4; t++) {
            const baseRate = currentToneCache[t - 1]?.lfo1Rate ?? 64;
            const nextRate = Math.max(0, Math.min(127, baseRate + Math.round(delta * 0.5)));
            if (currentToneCache[t - 1]) currentToneCache[t - 1].lfo1Rate = nextRate;
            if (currentToneIndex === t && $('lfoRate') && currentLfoIndex === 1) {
              $('lfoRate').value = nextRate;
              $('lfoRateVal').textContent = nextRate;
            }
            if (midi.isConnected) {
              sendThrottled(`macro_lfo_${t}`, () => {
                sendToneLFOParam(midi, part, t, 1, 'RATE', nextRate, devId);
              });
            }
          }
        }
      });
    }
  }

  // 2. 4-Tone Layer Strip Controls
  for (let t = 1; t <= 4; t++) {
    const enCheckbox = $(`deepTone${t}En`);
    const lvlInput = $(`deepTone${t}Level`);
    const panInput = $(`deepTone${t}Pan`);
    const cutInput = $(`deepTone${t}Cutoff`);

    if (enCheckbox) {
      enCheckbox.addEventListener('change', () => {
        const checked = enCheckbox.checked;
        const card = $(`deepToneCard${t}`);
        if (card) card.classList.toggle('disabled', !checked);
        if (currentPatchTMTData) currentPatchTMTData[`tone${t}Switch`] = checked ? 1 : 0;
        if (midi.isConnected) {
          sendToneSwitch(midi, getEffectivePatchPart(), t, checked, getDeviceId());
        }
      });
    }

    if (lvlInput) {
      lvlInput.addEventListener('input', () => {
        const val = parseInt(lvlInput.value, 10);
        $(`deepTone${t}LevelVal`).textContent = val;
        if (currentToneCache[t - 1]) currentToneCache[t - 1].toneLevel = val;
        if (currentToneIndex === t && $('toneLevel')) {
          $('toneLevel').value = val;
          $('toneLevelVal').textContent = val;
        }
        if (midi.isConnected) {
          sendThrottled(`deepToneLvl_${t}`, () => {
            sendPatchToneParam(midi, getEffectivePatchPart(), t, 'TONE_LEVEL', val, getDeviceId());
          });
        }
      });
    }

    if (panInput) {
      panInput.addEventListener('input', () => {
        const val = parseInt(panInput.value, 10);
        $(`deepTone${t}PanVal`).textContent = panDisplay(val);
        if (currentToneCache[t - 1]) currentToneCache[t - 1].tonePan = val;
        if (currentToneIndex === t && $('tonePan')) {
          $('tonePan').value = val;
          $('tonePanVal').textContent = panDisplay(val);
        }
        if (midi.isConnected) {
          sendThrottled(`deepTonePan_${t}`, () => {
            sendPatchToneParam(midi, getEffectivePatchPart(), t, 'TONE_PAN', val, getDeviceId());
          });
        }
      });
    }

    if (cutInput) {
      cutInput.addEventListener('input', () => {
        const val = parseInt(cutInput.value, 10);
        $(`deepTone${t}CutoffVal`).textContent = val;
        if (currentToneCache[t - 1]) currentToneCache[t - 1].tvfCutoff = val;
        if (currentToneIndex === t && $('toneCutoff')) {
          $('toneCutoff').value = val;
          $('toneCutoffVal').textContent = val;
        }
        updateDeepStudioSpectrum();
        if (midi.isConnected) {
          sendThrottled(`deepToneCut_${t}`, () => {
            sendPatchToneParam(midi, getEffectivePatchPart(), t, 'TVF_CUTOFF', val, getDeviceId());
          });
        }
      });
    }
  }

  // 3. 2D Vector Morphing X-Y Pad
  const vectorPad = $('vectorMorphPad');
  const vectorPuck = $('vectorMorphPuck');
  const vectorCoords = $('vectorMorphCoords');

  if (vectorPad && vectorPuck) {
    let isDraggingPuck = false;

    function handleVectorPadMove(e) {
      const rect = vectorPad.getBoundingClientRect();
      const x = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
      const y = Math.max(0, Math.min(1, (e.clientY - rect.top) / rect.height));

      vectorPuck.style.left = `${x * 100}%`;
      vectorPuck.style.top = `${y * 100}%`;
      if (vectorCoords) {
        vectorCoords.textContent = `(${Math.round(x * 100)}%, ${Math.round(y * 100)}%)`;
      }

      const levels = calculateVectorMorphLevels(x, y, 127);
      $('vecTone1Val').textContent = levels.tone1;
      $('vecTone2Val').textContent = levels.tone2;
      $('vecTone3Val').textContent = levels.tone3;
      $('vecTone4Val').textContent = levels.tone4;

      const part = getEffectivePatchPart();
      const devId = getDeviceId();

      for (let t = 1; t <= 4; t++) {
        const lvl = levels[`tone${t}`];
        const lvlSlider = $(`deepTone${t}Level`);
        if (lvlSlider) lvlSlider.value = lvl;
        const lvlVal = $(`deepTone${t}LevelVal`);
        if (lvlVal) lvlVal.textContent = lvl;
        if (currentToneCache[t - 1]) currentToneCache[t - 1].toneLevel = lvl;

        if (currentToneIndex === t && $('toneLevel')) {
          $('toneLevel').value = lvl;
          $('toneLevelVal').textContent = lvl;
        }

        if (midi.isConnected) {
          sendThrottled(`vector_tone_${t}`, () => {
            sendPatchToneParam(midi, part, t, 'TONE_LEVEL', lvl, devId);
          });
        }
      }
    }

    vectorPad.addEventListener('pointerdown', (e) => {
      isDraggingPuck = true;
      vectorPad.setPointerCapture(e.pointerId);
      handleVectorPadMove(e);
    });

    vectorPad.addEventListener('pointermove', (e) => {
      if (isDraggingPuck) handleVectorPadMove(e);
    });

    vectorPad.addEventListener('pointerup', (e) => {
      if (isDraggingPuck) {
        isDraggingPuck = false;
        try { vectorPad.releasePointerCapture(e.pointerId); } catch (_) {}
      }
    });
  }

  // 4. Intelligent Patch Genetics & Mutator Studio
  const mutatorIntensitySlider = $('mutatorIntensity');
  const mutatorIntensityVal = $('mutatorIntensityVal');
  if (mutatorIntensitySlider && mutatorIntensityVal) {
    mutatorIntensitySlider.addEventListener('input', () => {
      mutatorIntensityVal.textContent = `${mutatorIntensitySlider.value}% Variation`;
    });
  }

  $('btnMutatePatch')?.addEventListener('click', () => {
    if (!mutatorOriginalSnapshot) {
      mutatorOriginalSnapshot = getCurrentPatchFullSnapshot();
      mutatorHistory.setOriginal(mutatorOriginalSnapshot);
    }

    const intensity = (parseInt($('mutatorIntensity')?.value || 20, 10)) / 100;
    const archetype = $('mutatorArchetypeSelect')?.value || 'general';
    const locks = {
      lockWaveforms: $('lockWaveforms')?.checked ?? false,
      lockFilters: $('lockFilters')?.checked ?? false,
      lockEnvelopes: $('lockEnvelopes')?.checked ?? false,
      lockTuning: $('lockTuning')?.checked ?? true,
      lockEffects: $('lockEffects')?.checked ?? false
    };

    const currentSnapshot = getCurrentPatchFullSnapshot();
    const mutated = mutatePatch(currentSnapshot, intensity, archetype, locks);
    mutatorHistory.push(mutated);
    applyFullPatchSnapshot(mutated, true);

    const statusEl = $('mutatorStatusMsg');
    if (statusEl) statusEl.textContent = `Mutated (${Math.round(intensity * 100)}% ${archetype})`;
    setStatus(`Mutated patch sound using ${archetype} archetype seed (${Math.round(intensity * 100)}%)`);
  });

  $('btnRandomizeWaves')?.addEventListener('click', () => {
    if (!mutatorOriginalSnapshot) {
      mutatorOriginalSnapshot = getCurrentPatchFullSnapshot();
      mutatorHistory.setOriginal(mutatorOriginalSnapshot);
    }

    const locks = {
      lockWaveforms: $('lockWaveforms')?.checked ?? false,
      lockFilters: $('lockFilters')?.checked ?? false,
      lockEnvelopes: $('lockEnvelopes')?.checked ?? false,
      lockTuning: $('lockTuning')?.checked ?? true,
      lockEffects: $('lockEffects')?.checked ?? false
    };

    const currentSnapshot = getCurrentPatchFullSnapshot();
    const mutated = randomizeWaveforms(currentSnapshot, locks);
    mutatorHistory.push(mutated);
    applyFullPatchSnapshot(mutated, true);

    const statusEl = $('mutatorStatusMsg');
    if (statusEl) statusEl.textContent = 'Randomized PCM Waveforms';
    setStatus('Randomized internal PCM waveforms across active tones');
  });

  $('btnMutatorUndo')?.addEventListener('click', () => {
    const prev = mutatorHistory.undo();
    if (prev) {
      applyFullPatchSnapshot(prev, true);
      const statusEl = $('mutatorStatusMsg');
      if (statusEl) statusEl.textContent = 'Undo mutation';
      setStatus('Undid patch mutation step');
    } else {
      setStatus('No further undo steps in mutation history');
    }
  });

  $('btnMutatorRedo')?.addEventListener('click', () => {
    const next = mutatorHistory.redo();
    if (next) {
      applyFullPatchSnapshot(next, true);
      const statusEl = $('mutatorStatusMsg');
      if (statusEl) statusEl.textContent = 'Redo mutation';
      setStatus('Redid patch mutation step');
    } else {
      setStatus('No further redo steps in mutation history');
    }
  });

  $('btnMutatorCompare')?.addEventListener('click', () => {
    if (!mutatorOriginalSnapshot) {
      mutatorOriginalSnapshot = getCurrentPatchFullSnapshot();
      mutatorHistory.setOriginal(mutatorOriginalSnapshot);
      setStatus('Original sound snapshot captured for A/B comparison');
      return;
    }

    isViewingOriginalAB = !isViewingOriginalAB;
    const btnCompare = $('btnMutatorCompare');

    if (isViewingOriginalAB) {
      applyFullPatchSnapshot(mutatorOriginalSnapshot, true);
      if (btnCompare) {
        btnCompare.textContent = 'Viewing: Original A (Click for B)';
        btnCompare.classList.add('btn-primary');
      }
      setStatus('Comparing Sound: Active sound is Original (A)');
    } else {
      const cur = mutatorHistory.getCurrent() || getCurrentPatchFullSnapshot();
      applyFullPatchSnapshot(cur, true);
      if (btnCompare) {
        btnCompare.textContent = 'A/B Compare';
        btnCompare.classList.remove('btn-primary');
      }
      setStatus('Comparing Sound: Active sound is Mutated (B)');
    }
  });
}

// =============================================================================
// Drum Kit Editor (Compact Layout, Rotary Knobs, Renaming & Hit Library)
// =============================================================================

let currentDrumOctave = 1;
let currentDrumNote = 36; // C2: Bass Drum 1
const drumKeyCache = {};

const DRUM_CUSTOM_HITS_KEY = 'xv5050_drum_custom_hits';
const DRUM_CUSTOM_KITS_KEY = 'xv5050_drum_custom_kits';

function getCustomDrumHit(note) {
  try {
    const hits = JSON.parse(localStorage.getItem(DRUM_CUSTOM_HITS_KEY) || '{}');
    return hits[note] || null;
  } catch (_) {
    return null;
  }
}

function saveCustomDrumHit(note, name, category) {
  try {
    const hits = JSON.parse(localStorage.getItem(DRUM_CUSTOM_HITS_KEY) || '{}');
    hits[note] = { name, category };
    localStorage.setItem(DRUM_CUSTOM_HITS_KEY, JSON.stringify(hits));
  } catch (_) {}
}

function deleteCustomDrumHit(note) {
  try {
    const hits = JSON.parse(localStorage.getItem(DRUM_CUSTOM_HITS_KEY) || '{}');
    delete hits[note];
    localStorage.setItem(DRUM_CUSTOM_HITS_KEY, JSON.stringify(hits));
  } catch (_) {}
}

function initDrumKitEditor() {
  const padContainer = $('drumPadGridContainer');
  const octaveBadge = $('drumOctaveRangeBadge');
  const selectedNoteBadge = $('drumSelectedNoteBadge');

  // Populate drum kit dropdown with User, Preset, and SRX kits
  function populateDrumKitSelectOptions() {
    const kitSel = $('drumKitSelect');
    if (!kitSel) return;
    const currentVal = kitSel.value;
    kitSel.innerHTML = '';

    const customKits = JSON.parse(localStorage.getItem(DRUM_CUSTOM_KITS_KEY) || '{}');

    // Group 1: User Drum Kits (1-4)
    const ogUser = document.createElement('optgroup');
    ogUser.label = '— User Drum Kits (1-4) —';
    const userDefaults = ['Tight Studio Kit', 'Hip-Hop 808 Kit', 'XV WayHipKit', 'XV Jazz Kit'];
    for (let u = 1; u <= 4; u++) {
      const dbName = syncedUnitDb?.userRhythms?.[u - 1]?.name;
      const customName = customKits[`USER:${u}`];
      const name = customName || dbName || userDefaults[u - 1];
      const opt = document.createElement('option');
      opt.value = `USER:${u}`;
      opt.textContent = `User Drum ${u}: ${name} (Bank 86/0 PC ${u})`;
      ogUser.appendChild(opt);
    }
    kitSel.appendChild(ogUser);

    // Group 2: Roland Preset Drum Kits (1-8)
    const ogPreset = document.createElement('optgroup');
    ogPreset.label = '— Roland Preset Drum Kits (1-8) —';
    const presetKits = [
      'Standard Kit 1', 'Standard Kit 2', 'Power Drum Kit', 'Electronic Kit',
      'Analog 808/909', 'Jazz Drum Kit', 'Brush Drum Kit', 'Orchestral Perc'
    ];
    for (let p = 1; p <= 8; p++) {
      const customName = customKits[`PRESET:${p}`];
      const name = customName || presetKits[p - 1];
      const opt = document.createElement('option');
      opt.value = `PRESET:${p}`;
      opt.textContent = `Preset Drum ${p}: ${name} (Bank 86/64 PC ${p})`;
      ogPreset.appendChild(opt);
    }
    kitSel.appendChild(ogPreset);

    // Group 3: SRX Expansion Drum Kits
    const slotABoard = $('srxSlotASelect')?.value || localStorage.getItem('xv5050_srx_slot_a') || 'NONE';
    const slotBBoard = $('srxSlotBSelect')?.value || localStorage.getItem('xv5050_srx_slot_b') || 'NONE';

    [ { slot: 'A', id: slotABoard }, { slot: 'B', id: slotBBoard } ].forEach(({ slot, id }) => {
      if (id && id !== 'NONE') {
        const board = getSrxBoard(id);
        if (board && board.drumKits && board.drumKits.length > 0) {
          const ogSrxKits = document.createElement('optgroup');
          ogSrxKits.label = `— SRX Slot ${slot}: ${board.name} —`;
          board.drumKits.forEach((kitName, idx) => {
            const opt = document.createElement('option');
            opt.value = `SRX:${slot}:${id}:${idx + 1}`;
            opt.textContent = `${kitName} (Bank 92/${slot === 'A' ? 0 : 2} PC ${idx + 1})`;
            ogSrxKits.appendChild(opt);
          });
          kitSel.appendChild(ogSrxKits);
        }
      }
    });

    if (currentVal && Array.from(kitSel.options).some(o => o.value === currentVal)) {
      kitSel.value = currentVal;
    }
  }

  populateDrumKitSelectOptions();

  const kitSel = $('drumKitSelect');
  if (kitSel) {
    kitSel.addEventListener('change', async (e) => {
      const val = e.target.value;
      if (!val) return;
      const parts = val.split(':');
      let msb = 86;
      let lsb = 0;
      let pc = 1;
      let kitName = e.target.selectedOptions[0]?.textContent || 'Drum Kit';

      if (parts[0] === 'USER') {
        msb = 86; lsb = 0; pc = parseInt(parts[1], 10);
      } else if (parts[0] === 'PRESET') {
        msb = 86; lsb = 64; pc = parseInt(parts[1], 10);
      } else if (parts[0] === 'SRX') {
        const slot = parts[1];
        msb = 92;
        lsb = slot === 'A' ? 0 : 2;
        pc = parseInt(parts[3] || '1', 10);
      }

      const rhythmPart = 10;
      if (midi.isConnected) {
        setStatus(`Switching XV-5050 Rhythm Part to ${kitName}...`);
        try {
          sendPartBankAndProgram(midi, rhythmPart, msb, lsb, pc, getDeviceId(), 9);
          await new Promise(r => setTimeout(r, 60));
          const freshName = await requestPartPatchName(midi, rhythmPart, getDeviceId());
          if (freshName && freshName.trim()) kitName = freshName;
          setStatus(`✓ Selected Drum Kit on XV-5050: "${kitName}"`);
        } catch (err) {
          setStatus(`Selected Drum Kit: "${kitName}"`);
        }
      } else {
        setStatus(`Selected Drum Kit: "${kitName}" (Offline)`);
      }

      const p10Name = $(`partPatchName10`);
      if (p10Name) p10Name.textContent = kitName;
      const p10Msb = $(`partBankMSB10`);
      if (p10Msb) p10Msb.value = msb;
      const p10Lsb = $(`partBankLSB10`);
      if (p10Lsb) p10Lsb.value = lsb;
      const p10Pc = $(`partPC10`);
      if (p10Pc) p10Pc.value = pc;

      if (syncedUnitDb?.currentPerformance?.parts?.[9]) {
        const p = syncedUnitDb.currentPerformance.parts[9];
        p.patchBankMSB = msb;
        p.patchBankLSB = lsb;
        p.patchPC = pc;
        p.patchName = kitName;
        saveSyncedDbToStorage();
      }
    });
  }

  // Populate drum waveform dropdown
  function populateDrumWaveDropdown() {
    const drumWaveSel = $('drumWaveNumber');
    if (!drumWaveSel) return;
    const grp = parseInt($('drumWaveGroup')?.value || '0', 10);
    const currVal = drumWaveSel.value;
    drumWaveSel.innerHTML = '';

    let waves = INTERNAL_WAVEFORMS;
    if (grp === 1) {
      waves = INTERNAL_WAVEFORMS.slice(0, 256).map((w, i) => `SR-JV: ${String(i+1).padStart(3, '0')} ${w}`);
    } else if (grp === 2) {
      const slotA = $('srxSlotASelect')?.value || localStorage.getItem('xv5050_srx_slot_a') || 'NONE';
      if (slotA && slotA !== 'NONE') {
        waves = getSrxWaveforms(slotA);
      } else {
        waves = ['SRX Slot A: No Board Installed'];
      }
    } else if (grp === 3) {
      const slotB = $('srxSlotBSelect')?.value || localStorage.getItem('xv5050_srx_slot_b') || 'NONE';
      if (slotB && slotB !== 'NONE') {
        waves = getSrxWaveforms(slotB);
      } else {
        waves = ['SRX Slot B: No Board Installed'];
      }
    }

    waves.forEach((name, idx) => {
      const opt = document.createElement('option');
      opt.value = idx + 1;
      opt.textContent = name;
      drumWaveSel.appendChild(opt);
    });

    if (currVal && drumWaveSel.querySelector(`option[value="${currVal}"]`)) {
      drumWaveSel.value = currVal;
    }
  }

  populateDrumWaveDropdown();

  // Populate Drum Hit Library dropdown
  function populateDrumHitLibraryOptions() {
    const libSel = $('drumHitLibrarySelect');
    if (!libSel) return;
    libSel.innerHTML = '<option value="">⚡ Load Hit from Library...</option>';

    const categories = ['Kick', 'Snare', 'Hi-Hat', 'Tom', 'Cymbal', 'Latin', 'Perc', 'FX'];
    categories.forEach(cat => {
      const hits = DRUM_HIT_LIBRARY.filter(h => h.category === cat);
      if (hits.length > 0) {
        const og = document.createElement('optgroup');
        og.label = `— ${cat}s —`;
        hits.forEach(h => {
          const opt = document.createElement('option');
          opt.value = h.id;
          opt.textContent = `${h.name}`;
          og.appendChild(opt);
        });
        libSel.appendChild(og);
      }
    });

    // Check installed SRX expansion boards for additional hits
    const slotABoard = $('srxSlotASelect')?.value || localStorage.getItem('xv5050_srx_slot_a') || 'NONE';
    const slotBBoard = $('srxSlotBSelect')?.value || localStorage.getItem('xv5050_srx_slot_b') || 'NONE';
    ['A', 'B'].forEach(slot => {
      const boardId = slot === 'A' ? slotABoard : slotBBoard;
      if (boardId && boardId !== 'NONE') {
        const board = getSrxBoard(boardId);
        if (board && board.sampleWaves) {
          const ogSrx = document.createElement('optgroup');
          ogSrx.label = `— ${board.id}: ${board.name} —`;
          board.sampleWaves.slice(0, 12).forEach((wName, i) => {
            const opt = document.createElement('option');
            opt.value = `srx_hit:${slot}:${boardId}:${i+1}:${wName}`;
            opt.textContent = `${board.id} #${i+1}: ${wName}`;
            ogSrx.appendChild(opt);
          });
          libSel.appendChild(ogSrx);
        }
      }
    });
  }

  populateDrumHitLibraryOptions();

  function auditionDrumNote(note) {
    if (!midi.isConnected) {
      setStatus(`Audition Note ${note}: Connect MIDI to hear drum sound`);
      return;
    }
    // Channel 9 is Part 10 Drum Channel
    midi.sendNoteOn(9, note, 100);
    setTimeout(() => midi.sendNoteOff(9, note), 220);
    const info = DRUM_KEY_MAP[note] || { note: `Note ${note}`, name: 'Drum Key' };
    const savedCustom = getCustomDrumHit(note);
    const displayName = drumKeyCache[note]?.customName || savedCustom?.name || info.name;
    setStatus(`Auditioning Drum: Note ${note} (${info.note} - ${displayName})`);
  }

  // Define Rotary Knobs replacing sliders
  function onKnobParamChanged(paramKey, val, offset, inputId, valSpanId, formattedText) {
    const input = $(inputId);
    if (input) input.value = val;
    const span = $(valSpanId);
    if (span) span.textContent = formattedText;

    if (!drumKeyCache[currentDrumNote]) drumKeyCache[currentDrumNote] = {};
    drumKeyCache[currentDrumNote][paramKey] = val;

    if (midi.isConnected) {
      sendThrottled(`drum_${currentDrumNote}_${paramKey}`, () => {
        sendRhythmKeyParam(midi, currentDrumNote, offset, val, currentSoundMode === 2);
      });
    }
  }

  const knobCoarseTune = new RotaryKnob('knobWrapCoarseTune', {
    id: 'knobDrumCoarseTune',
    min: 0,
    max: 127,
    defaultValue: 64,
    value: 64,
    label: 'Pitch',
    color: '#38bdf8',
    formatValue: (v) => formatKeyNote(v),
    onChange: (val) => onKnobParamChanged('coarseTune', val, RHYTHM_KEY_OFFSETS.COARSE_TUNE, 'drumCoarseTune', 'drumCoarseTuneVal', formatKeyNote(val))
  });

  const knobFineTune = new RotaryKnob('knobWrapFineTune', {
    id: 'knobDrumFineTune',
    min: 14,
    max: 114,
    defaultValue: 64,
    value: 64,
    bipolar: true,
    label: 'Fine',
    color: '#38bdf8',
    formatValue: (v) => `${v - 64 > 0 ? '+' : ''}${v - 64}`,
    onChange: (val) => onKnobParamChanged('fineTune', val, RHYTHM_KEY_OFFSETS.FINE_TUNE, 'drumFineTune', 'drumFineTuneVal', `${val - 64}`)
  });

  const knobCutoff = new RotaryKnob('knobWrapCutoff', {
    id: 'knobDrumCutoff',
    min: 0,
    max: 127,
    defaultValue: 127,
    value: 127,
    label: 'Cutoff',
    color: '#4cc9f0',
    formatValue: (v) => String(v),
    onChange: (val) => onKnobParamChanged('cutoff', val, RHYTHM_KEY_OFFSETS.TVF_CUTOFF, 'drumCutoff', 'drumCutoffVal', String(val))
  });

  const knobResonance = new RotaryKnob('knobWrapResonance', {
    id: 'knobDrumResonance',
    min: 0,
    max: 127,
    defaultValue: 0,
    value: 0,
    label: 'Res',
    color: '#4cc9f0',
    formatValue: (v) => String(v),
    onChange: (val) => onKnobParamChanged('resonance', val, RHYTHM_KEY_OFFSETS.TVF_RESONANCE, 'drumResonance', 'drumResonanceVal', String(val))
  });

  const knobLevel = new RotaryKnob('knobWrapLevel', {
    id: 'knobDrumLevel',
    min: 0,
    max: 127,
    defaultValue: 127,
    value: 127,
    label: 'Level',
    color: '#ff9f1c',
    formatValue: (v) => String(v),
    onChange: (val) => onKnobParamChanged('level', val, RHYTHM_KEY_OFFSETS.LEVEL, 'drumLevel', 'drumLevelVal', String(val))
  });

  const knobPan = new RotaryKnob('knobWrapPan', {
    id: 'knobDrumPan',
    min: 0,
    max: 127,
    defaultValue: 64,
    value: 64,
    bipolar: true,
    label: 'Pan',
    color: '#ff9f1c',
    formatValue: (v) => panDisplay(v),
    onChange: (val) => onKnobParamChanged('pan', val, RHYTHM_KEY_OFFSETS.PAN, 'drumPan', 'drumPanVal', panDisplay(val))
  });

  const knobDecay = new RotaryKnob('knobWrapDecay', {
    id: 'knobDrumDecay',
    min: 0,
    max: 127,
    defaultValue: 60,
    value: 60,
    label: 'Decay',
    color: '#ff9f1c',
    formatValue: (v) => String(v),
    onChange: (val) => onKnobParamChanged('tvaDecay', val, RHYTHM_KEY_OFFSETS.TVA_DECAY, 'drumTvaDecay', 'drumTvaDecayVal', String(val))
  });

  const knobRelease = new RotaryKnob('knobWrapRelease', {
    id: 'knobDrumRelease',
    min: 0,
    max: 127,
    defaultValue: 20,
    value: 20,
    label: 'Rel',
    color: '#ff9f1c',
    formatValue: (v) => String(v),
    onChange: (val) => onKnobParamChanged('tvaRelease', val, RHYTHM_KEY_OFFSETS.TVA_RELEASE, 'drumTvaRelease', 'drumTvaReleaseVal', String(val))
  });

  const knobChorusSend = new RotaryKnob('knobWrapChorusSend', {
    id: 'knobDrumChorusSend',
    min: 0,
    max: 127,
    defaultValue: 0,
    value: 0,
    label: 'Chorus',
    color: '#a78bfa',
    formatValue: (v) => String(v),
    onChange: (val) => onKnobParamChanged('chorusSend', val, RHYTHM_KEY_OFFSETS.CHORUS_SEND, 'drumChorusSend', 'drumChorusSendVal', String(val))
  });

  const knobReverbSend = new RotaryKnob('knobWrapReverbSend', {
    id: 'knobDrumReverbSend',
    min: 0,
    max: 127,
    defaultValue: 40,
    value: 40,
    label: 'Reverb',
    color: '#a78bfa',
    formatValue: (v) => String(v),
    onChange: (val) => onKnobParamChanged('reverbSend', val, RHYTHM_KEY_OFFSETS.REVERB_SEND, 'drumReverbSend', 'drumReverbSendVal', String(val))
  });

  // Backward compatibility: If hidden inputs receive input event, sync to rotary knobs
  $('drumCoarseTune')?.addEventListener('input', (e) => knobCoarseTune.setValue(parseInt(e.target.value, 10)));
  $('drumFineTune')?.addEventListener('input', (e) => knobFineTune.setValue(parseInt(e.target.value, 10)));
  $('drumCutoff')?.addEventListener('input', (e) => knobCutoff.setValue(parseInt(e.target.value, 10)));
  $('drumResonance')?.addEventListener('input', (e) => knobResonance.setValue(parseInt(e.target.value, 10)));
  $('drumLevel')?.addEventListener('input', (e) => knobLevel.setValue(parseInt(e.target.value, 10)));
  $('drumPan')?.addEventListener('input', (e) => knobPan.setValue(parseInt(e.target.value, 10)));
  $('drumTvaDecay')?.addEventListener('input', (e) => knobDecay.setValue(parseInt(e.target.value, 10)));
  $('drumTvaRelease')?.addEventListener('input', (e) => knobRelease.setValue(parseInt(e.target.value, 10)));
  $('drumChorusSend')?.addEventListener('input', (e) => knobChorusSend.setValue(parseInt(e.target.value, 10)));
  $('drumReverbSend')?.addEventListener('input', (e) => knobReverbSend.setValue(parseInt(e.target.value, 10)));

  function selectDrumKey(note) {
    currentDrumNote = note;
    const defaultInfo = DRUM_KEY_MAP[note] || { note: `Note ${note}`, name: 'Drum Key', category: 'Perc', defaultMute: 0 };
    const savedCustom = getCustomDrumHit(note);
    const keyData = drumKeyCache[note] || {};

    const displayName = keyData.customName || savedCustom?.name || defaultInfo.name;
    const displayCat = keyData.category || savedCustom?.category || defaultInfo.category;

    if (selectedNoteBadge) {
      selectedNoteBadge.textContent = `Note ${note}: ${defaultInfo.note} - ${displayName}`;
    }

    // Update Rename Bar inputs
    if ($('drumHitNameInput')) $('drumHitNameInput').value = displayName;
    if ($('drumHitCatSelect')) $('drumHitCatSelect').value = displayCat;

    // Update active state on pads
    document.querySelectorAll('.drum-pad').forEach(p => {
      p.classList.toggle('selected', parseInt(p.dataset.note, 10) === note);
    });

    // Populate wave dropdown and selects
    const wGrp = keyData.waveGroup ?? 0;
    if ($('drumWaveGroup')) $('drumWaveGroup').value = wGrp;
    populateDrumWaveDropdown();
    if ($('drumWaveNumber')) $('drumWaveNumber').value = keyData.waveNumber ?? 1;
    if ($('drumWaveGain')) $('drumWaveGain').value = keyData.waveGain ?? 1;
    if ($('drumFilterType')) $('drumFilterType').value = keyData.filterType ?? 1;
    if ($('drumMuteGroup')) $('drumMuteGroup').value = keyData.muteGroup ?? defaultInfo.defaultMute ?? 0;

    // Populate rotary knobs
    knobCoarseTune.setValue(keyData.coarseTune ?? 64);
    knobFineTune.setValue(keyData.fineTune ?? 64);
    knobCutoff.setValue(keyData.cutoff ?? 127);
    knobResonance.setValue(keyData.resonance ?? 0);
    knobLevel.setValue(keyData.level ?? 127);
    knobPan.setValue(keyData.pan ?? 64);
    knobDecay.setValue(keyData.tvaDecay ?? 60);
    knobRelease.setValue(keyData.tvaRelease ?? 20);
    knobChorusSend.setValue(keyData.chorusSend ?? 0);
    knobReverbSend.setValue(keyData.reverbSend ?? 40);

    // Sync hidden inputs & labels
    if ($('drumCoarseTune')) $('drumCoarseTune').value = keyData.coarseTune ?? 64;
    if ($('drumFineTune')) $('drumFineTune').value = keyData.fineTune ?? 64;
    if ($('drumCutoff')) $('drumCutoff').value = keyData.cutoff ?? 127;
    if ($('drumResonance')) $('drumResonance').value = keyData.resonance ?? 0;
    if ($('drumLevel')) $('drumLevel').value = keyData.level ?? 127;
    if ($('drumPan')) $('drumPan').value = keyData.pan ?? 64;
    if ($('drumTvaDecay')) $('drumTvaDecay').value = keyData.tvaDecay ?? 60;
    if ($('drumTvaRelease')) $('drumTvaRelease').value = keyData.tvaRelease ?? 20;
    if ($('drumChorusSend')) $('drumChorusSend').value = keyData.chorusSend ?? 0;
    if ($('drumReverbSend')) $('drumReverbSend').value = keyData.reverbSend ?? 40;

    if ($('drumCoarseTuneVal')) $('drumCoarseTuneVal').textContent = formatKeyNote(keyData.coarseTune ?? 64);
    if ($('drumFineTuneVal')) $('drumFineTuneVal').textContent = `${(keyData.fineTune ?? 64) - 64}`;
    if ($('drumCutoffVal')) $('drumCutoffVal').textContent = keyData.cutoff ?? 127;
    if ($('drumResonanceVal')) $('drumResonanceVal').textContent = keyData.resonance ?? 0;
    if ($('drumLevelVal')) $('drumLevelVal').textContent = keyData.level ?? 127;
    if ($('drumPanVal')) $('drumPanVal').textContent = panDisplay(keyData.pan ?? 64);
    if ($('drumTvaDecayVal')) $('drumTvaDecayVal').textContent = keyData.tvaDecay ?? 60;
    if ($('drumTvaReleaseVal')) $('drumTvaReleaseVal').textContent = keyData.tvaRelease ?? 20;
    if ($('drumChorusSendVal')) $('drumChorusSendVal').textContent = keyData.chorusSend ?? 0;
    if ($('drumReverbSendVal')) $('drumReverbSendVal').textContent = keyData.reverbSend ?? 40;
  }

  function renderDrumOctave(octave) {
    currentDrumOctave = octave;
    const bank = DRUM_OCTAVES.find(b => b.octave === octave) || DRUM_OCTAVES[0];
    if (octaveBadge) octaveBadge.textContent = bank.label;

    document.querySelectorAll('.drum-octave-btn').forEach(btn => {
      btn.classList.toggle('active', parseInt(btn.dataset.octave, 10) === octave);
    });

    if (!padContainer) return;
    padContainer.innerHTML = '';

    bank.notes.forEach(note => {
      const defaultInfo = DRUM_KEY_MAP[note] || { note: `N${note}`, name: `Drum ${note}`, category: 'Perc', defaultMute: 0 };
      const savedCustom = getCustomDrumHit(note);
      const keyData = drumKeyCache[note] || {};
      const displayName = keyData.customName || savedCustom?.name || defaultInfo.name;
      const displayCat = keyData.category || savedCustom?.category || defaultInfo.category;
      const muteGrp = keyData.muteGroup ?? defaultInfo.defaultMute ?? 0;

      const pad = document.createElement('div');
      pad.className = `drum-pad ${note === currentDrumNote ? 'selected' : ''}`;
      pad.dataset.note = note;
      pad.innerHTML = `
        <div class="drum-pad-header">
          <span class="drum-pad-note">${defaultInfo.note}</span>
          <div style="display:flex; align-items:center;">
            <span class="drum-pad-cat">${displayCat}</span>
            ${muteGrp > 0 ? `<span class="drum-pad-mute">M${muteGrp}</span>` : ''}
          </div>
        </div>
        <div class="drum-pad-title" title="${displayName}">${displayName}</div>
      `;

      pad.addEventListener('pointerdown', () => {
        auditionDrumNote(note);
        selectDrumKey(note);
        pad.classList.add('triggered');
        setTimeout(() => pad.classList.remove('triggered'), 180);
      });

      padContainer.appendChild(pad);
    });
  }

  // Hit Name input event
  $('drumHitNameInput')?.addEventListener('input', (e) => {
    const val = e.target.value.trim();
    if (!drumKeyCache[currentDrumNote]) drumKeyCache[currentDrumNote] = {};
    drumKeyCache[currentDrumNote].customName = val;
    saveCustomDrumHit(currentDrumNote, val, drumKeyCache[currentDrumNote].category);

    const info = DRUM_KEY_MAP[currentDrumNote] || { note: `N${currentDrumNote}`, name: 'Hit' };
    const pad = padContainer?.querySelector(`.drum-pad[data-note="${currentDrumNote}"]`);
    if (pad) {
      const titleEl = pad.querySelector('.drum-pad-title');
      if (titleEl) titleEl.textContent = val || info.name;
    }
    if (selectedNoteBadge) {
      selectedNoteBadge.textContent = `Note ${currentDrumNote}: ${info.note} - ${val || info.name}`;
    }
  });

  // Hit Category change event
  $('drumHitCatSelect')?.addEventListener('change', (e) => {
    const cat = e.target.value;
    if (!drumKeyCache[currentDrumNote]) drumKeyCache[currentDrumNote] = {};
    drumKeyCache[currentDrumNote].category = cat;
    saveCustomDrumHit(currentDrumNote, drumKeyCache[currentDrumNote].customName, cat);

    const pad = padContainer?.querySelector(`.drum-pad[data-note="${currentDrumNote}"]`);
    if (pad) {
      const catEl = pad.querySelector('.drum-pad-cat');
      if (catEl) catEl.textContent = cat;
    }
  });

  // Reset Hit button
  $('btnResetDrumHit')?.addEventListener('click', () => {
    const defaultInfo = DRUM_KEY_MAP[currentDrumNote];
    if (!defaultInfo) return;
    deleteCustomDrumHit(currentDrumNote);
    drumKeyCache[currentDrumNote] = {
      customName: defaultInfo.name,
      category: defaultInfo.category,
      muteGroup: defaultInfo.defaultMute ?? 0,
      coarseTune: 64,
      fineTune: 64,
      filterType: 1,
      cutoff: 127,
      resonance: 0,
      level: 127,
      pan: 64,
      tvaDecay: 60,
      tvaRelease: 20,
      chorusSend: 0,
      reverbSend: 40
    };
    selectDrumKey(currentDrumNote);
    renderDrumOctave(currentDrumOctave);
    auditionDrumNote(currentDrumNote);
    setStatus(`Reset Note ${currentDrumNote} (${defaultInfo.note}) to factory default`);
  });

  // Rename Kit button
  $('btnRenameDrumKit')?.addEventListener('click', () => {
    const kitSel = $('drumKitSelect');
    if (!kitSel) return;
    const curOpt = kitSel.selectedOptions[0];
    const oldName = curOpt ? curOpt.textContent : 'Drum Kit';
    const newName = prompt('Enter custom name for this drum kit:', oldName);
    if (newName && newName.trim()) {
      curOpt.textContent = newName.trim();
      const customKits = JSON.parse(localStorage.getItem(DRUM_CUSTOM_KITS_KEY) || '{}');
      customKits[kitSel.value] = newName.trim();
      try {
        localStorage.setItem(DRUM_CUSTOM_KITS_KEY, JSON.stringify(customKits));
      } catch (_) {}
      setStatus(`Renamed drum kit to "${newName.trim()}"`);
    }
  });

  // Apply Drum Hit Preset from Library
  function applyDrumHitPresetToKey(note, preset) {
    if (!drumKeyCache[note]) drumKeyCache[note] = {};
    const keyData = drumKeyCache[note];
    keyData.customName = preset.name;
    keyData.category = preset.category;
    keyData.waveGroup = preset.waveGroup ?? 0;
    keyData.waveNumber = preset.waveNumber ?? 1;
    keyData.coarseTune = preset.coarseTune ?? 64;
    keyData.fineTune = preset.fineTune ?? 64;
    keyData.filterType = preset.filterType ?? 1;
    keyData.cutoff = preset.cutoff ?? 127;
    keyData.resonance = preset.resonance ?? 0;
    keyData.level = preset.level ?? 127;
    keyData.pan = preset.pan ?? 64;
    keyData.muteGroup = preset.muteGroup ?? 0;
    keyData.tvaDecay = preset.tvaDecay ?? 60;
    keyData.tvaRelease = preset.tvaRelease ?? 20;
    keyData.chorusSend = preset.chorusSend ?? 0;
    keyData.reverbSend = preset.reverbSend ?? 40;

    saveCustomDrumHit(note, preset.name, preset.category);
    selectDrumKey(note);
    renderDrumOctave(currentDrumOctave);

    if (midi.isConnected) {
      const isPerf = currentSoundMode === 2;
      const rolandGrp = keyData.waveGroup >= 2 ? 2 : keyData.waveGroup;
      sendRhythmKeyParam(midi, note, RHYTHM_KEY_OFFSETS.WAVE_GROUP, rolandGrp, isPerf);
      sendRhythmKeyParam(midi, note, RHYTHM_KEY_OFFSETS.WAVE_NUMBER_L, encodeWaveNibbles(keyData.waveNumber), isPerf);
      sendRhythmKeyParam(midi, note, RHYTHM_KEY_OFFSETS.COARSE_TUNE, keyData.coarseTune, isPerf);
      sendRhythmKeyParam(midi, note, RHYTHM_KEY_OFFSETS.FINE_TUNE, keyData.fineTune, isPerf);
      sendRhythmKeyParam(midi, note, RHYTHM_KEY_OFFSETS.TVF_TYPE, keyData.filterType, isPerf);
      sendRhythmKeyParam(midi, note, RHYTHM_KEY_OFFSETS.TVF_CUTOFF, keyData.cutoff, isPerf);
      sendRhythmKeyParam(midi, note, RHYTHM_KEY_OFFSETS.TVF_RESONANCE, keyData.resonance, isPerf);
      sendRhythmKeyParam(midi, note, RHYTHM_KEY_OFFSETS.LEVEL, keyData.level, isPerf);
      sendRhythmKeyParam(midi, note, RHYTHM_KEY_OFFSETS.PAN, keyData.pan, isPerf);
      sendRhythmKeyParam(midi, note, RHYTHM_KEY_OFFSETS.MUTE_GROUP, keyData.muteGroup, isPerf);
      sendRhythmKeyParam(midi, note, RHYTHM_KEY_OFFSETS.TVA_DECAY, keyData.tvaDecay, isPerf);
      sendRhythmKeyParam(midi, note, RHYTHM_KEY_OFFSETS.TVA_RELEASE, keyData.tvaRelease, isPerf);
      sendRhythmKeyParam(midi, note, RHYTHM_KEY_OFFSETS.CHORUS_SEND, keyData.chorusSend, isPerf);
      sendRhythmKeyParam(midi, note, RHYTHM_KEY_OFFSETS.REVERB_SEND, keyData.reverbSend, isPerf);
    }
  }

  $('drumHitLibrarySelect')?.addEventListener('change', (e) => {
    const hitId = e.target.value;
    if (!hitId) return;

    let preset = DRUM_HIT_LIBRARY.find(h => h.id === hitId);
    if (!preset && hitId.startsWith('srx_hit:')) {
      const parts = hitId.split(':');
      const slot = parts[1];
      const boardId = parts[2];
      const waveIdx = parseInt(parts[3], 10);
      const wName = parts[4] || `${boardId} Hit`;
      const isKick = /kick|bd/i.test(wName);
      const isSnare = /snare|sn|rim|clap/i.test(wName);
      const isHat = /hat|hh/i.test(wName);
      const isTom = /tom/i.test(wName);
      const isCymbal = /crash|ride|cymbal/i.test(wName);
      const cat = isKick ? 'Kick' : isSnare ? 'Snare' : isHat ? 'Hi-Hat' : isTom ? 'Tom' : isCymbal ? 'Cymbal' : 'Perc';
      preset = {
        name: wName,
        category: cat,
        waveGroup: slot === 'B' ? 3 : 2,
        waveNumber: waveIdx,
        coarseTune: 64,
        fineTune: 64,
        filterType: 1,
        cutoff: 127,
        resonance: 0,
        level: 127,
        pan: 64,
        muteGroup: isHat ? 1 : 0,
        tvaDecay: isHat ? 45 : isKick ? 65 : 70,
        tvaRelease: 20,
        chorusSend: 0,
        reverbSend: 35
      };
    }

    if (preset) {
      applyDrumHitPresetToKey(currentDrumNote, preset);
      auditionDrumNote(currentDrumNote);
      setStatus(`Loaded Library Hit "${preset.name}" onto Note ${currentDrumNote}`);
    }
    e.target.value = '';
  });

  // Initial octave render & key selection
  renderDrumOctave(1);
  selectDrumKey(36);

  // Octave buttons
  $('btnPrevDrumOctave')?.addEventListener('click', () => {
    if (currentDrumOctave > 1) renderDrumOctave(currentDrumOctave - 1);
  });
  $('btnNextDrumOctave')?.addEventListener('click', () => {
    if (currentDrumOctave < 5) renderDrumOctave(currentDrumOctave + 1);
  });

  document.querySelectorAll('.drum-octave-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const oct = parseInt(btn.dataset.octave, 10);
      if (oct) renderDrumOctave(oct);
    });
  });

  // Audition buttons
  $('btnAuditionSelectedDrum')?.addEventListener('click', () => auditionDrumNote(currentDrumNote));
  $('btnAuditionCurrentKey')?.addEventListener('click', () => auditionDrumNote(currentDrumNote));

  // Back to mixer
  $('btnDrumBackToMixer')?.addEventListener('click', () => {
    switchToTab('performance');
    const row = $('partRow10');
    if (row) {
      row.scrollIntoView({ behavior: 'smooth', block: 'center' });
      row.classList.add('selected');
    }
  });

  // Select dropdown events
  $('drumWaveGroup')?.addEventListener('change', (e) => {
    const val = parseInt(e.target.value, 10);
    populateDrumWaveDropdown();
    if (!drumKeyCache[currentDrumNote]) drumKeyCache[currentDrumNote] = {};
    drumKeyCache[currentDrumNote].waveGroup = val;
    if (midi.isConnected) {
      const rolandGroup = val >= 2 ? 2 : val;
      sendRhythmKeyParam(midi, currentDrumNote, RHYTHM_KEY_OFFSETS.WAVE_GROUP, rolandGroup, currentSoundMode === 2);
    }
  });

  $('drumWaveNumber')?.addEventListener('change', (e) => {
    const waveNum = parseInt(e.target.value, 10);
    if (!drumKeyCache[currentDrumNote]) drumKeyCache[currentDrumNote] = {};
    drumKeyCache[currentDrumNote].waveNumber = waveNum;
    if (midi.isConnected) {
      sendRhythmKeyParam(midi, currentDrumNote, RHYTHM_KEY_OFFSETS.WAVE_NUMBER_L, encodeWaveNibbles(waveNum), currentSoundMode === 2);
    }
    auditionDrumNote(currentDrumNote);
  });

  $('drumMuteGroup')?.addEventListener('change', (e) => {
    const val = parseInt(e.target.value, 10);
    if (!drumKeyCache[currentDrumNote]) drumKeyCache[currentDrumNote] = {};
    drumKeyCache[currentDrumNote].muteGroup = val;
    renderDrumOctave(currentDrumOctave);
    if (midi.isConnected) {
      sendRhythmKeyParam(midi, currentDrumNote, RHYTHM_KEY_OFFSETS.MUTE_GROUP, val, currentSoundMode === 2);
    }
  });

  $('drumFilterType')?.addEventListener('change', (e) => {
    const val = parseInt(e.target.value, 10);
    if (!drumKeyCache[currentDrumNote]) drumKeyCache[currentDrumNote] = {};
    drumKeyCache[currentDrumNote].filterType = val;
    if (midi.isConnected) {
      sendRhythmKeyParam(midi, currentDrumNote, RHYTHM_KEY_OFFSETS.TVF_TYPE, val, currentSoundMode === 2);
    }
  });

  $('drumWaveGain')?.addEventListener('change', (e) => {
    const val = parseInt(e.target.value, 10);
    if (!drumKeyCache[currentDrumNote]) drumKeyCache[currentDrumNote] = {};
    drumKeyCache[currentDrumNote].waveGain = val;
    if (midi.isConnected) {
      sendRhythmKeyParam(midi, currentDrumNote, RHYTHM_KEY_OFFSETS.WAVE_GAIN, val, currentSoundMode === 2);
    }
  });
}

// =============================================================================
// Initialization
// =============================================================================

/**
 * Attach intuitive < and > stepper arrow buttons to a <select> element
 * allowing quick browsing without having to open the dropdown menu.
 * 
 * @param {HTMLElement|string} selectElOrId - Target select element or ID
 */
export function attachSelectSteppers(selectElOrId) {
  const selectEl = (typeof selectElOrId === 'string') ? $(selectElOrId) : selectElOrId;
  if (!selectEl) return;
  if (selectEl.parentElement?.classList.contains('stepper-select-wrap')) return;

  const wrap = document.createElement('div');
  wrap.className = 'stepper-select-wrap';

  const btnPrev = document.createElement('button');
  btnPrev.type = 'button';
  btnPrev.className = 'btn-step btn-step-prev';
  btnPrev.innerHTML = '‹';
  btnPrev.title = 'Previous item';

  const btnNext = document.createElement('button');
  btnNext.type = 'button';
  btnNext.className = 'btn-step btn-step-next';
  btnNext.innerHTML = '›';
  btnNext.title = 'Next item';

  selectEl.parentNode.insertBefore(wrap, selectEl);
  wrap.appendChild(btnPrev);
  wrap.appendChild(selectEl);
  wrap.appendChild(btnNext);

  function step(delta) {
    const opts = Array.from(selectEl.options).filter(o => !o.disabled && o.value !== '');
    if (!opts.length) return;
    const curIdx = opts.findIndex(o => o.value === selectEl.value);
    let nextIdx = (curIdx === -1) ? (delta > 0 ? 0 : opts.length - 1) : curIdx + delta;
    if (nextIdx < 0) nextIdx = 0;
    if (nextIdx >= opts.length) nextIdx = opts.length - 1;
    if (nextIdx !== curIdx) {
      selectEl.value = opts[nextIdx].value;
      selectEl.dispatchEvent(new Event('change', { bubbles: true }));
    }
  }

  btnPrev.addEventListener('click', (e) => {
    e.preventDefault();
    e.stopPropagation();
    step(-1);
  });

  btnNext.addEventListener('click', (e) => {
    e.preventDefault();
    e.stopPropagation();
    step(1);
  });
}

function init() {
  buildPartsTable();
  initTabs();
  initEditTracking();

  bindPerformanceCommonControls();
  bindPerfMfxControls();
  bindPatchControls();
  bindPatchEffectsControls();
  initHardwareRotaryKnobs();
  initLibrarianControls();
  initVstTranspiler();
  initSrxSlots();
  initScaleTuneControls();
  initDeepStudio();
  initDrumKitEditor();

  // Deep Studio Hardware Sync buttons
  document.querySelectorAll('#btnDeepSyncHardware').forEach(btn => {
    btn.addEventListener('click', () => {
      autoSyncActivePatchFromHardware(getEffectivePatchPart());
    });
  });

  const btnDeepStd = $('btnDeepSwitchToStandard');
  if (btnDeepStd) {
    btnDeepStd.addEventListener('click', () => {
      switchToTab('patch');
    });
  }

  // Top header actions
  $('connectBtn').addEventListener('click', connectMidi);
  $('refreshBtn').addEventListener('click', refreshDeviceList);
  $('panicBtn').addEventListener('click', handlePanic);
  $('auditionBtn').addEventListener('click', handleAudition);
  $('clearLogBtn').addEventListener('click', clearLog);

  // DAW Thru & Multi-Client driver sharing
  const dawSelect = $('midiDawThru');
  if (dawSelect) {
    dawSelect.addEventListener('change', async (e) => {
      const val = e.target.value;
      localStorage.setItem('xv5050_daw_thru', val);
      if (midi.isConnected) {
        await midi.setDawThruInput(val);
        if (val) {
          setStatus(`DAW Thru route active: forwarding ${midi.dawInputName} -> XV-5050`);
        } else {
          setStatus('DAW Thru route disabled');
        }
      }
    });
  }

  $('midiInput')?.addEventListener('change', (e) => {
    if (e.target.value) localStorage.setItem('xv5050_midi_input', e.target.value);
  });
  $('midiOutput')?.addEventListener('change', (e) => {
    if (e.target.value) localStorage.setItem('xv5050_midi_output', e.target.value);
  });

  const chkAutoRelease = $('chkAutoReleaseMidi');
  let autoReleaseEnabled = localStorage.getItem('xv5050_auto_release_midi') === 'true';
  if (chkAutoRelease) {
    chkAutoRelease.checked = autoReleaseEnabled;
    chkAutoRelease.addEventListener('change', (e) => {
      autoReleaseEnabled = e.target.checked;
      localStorage.setItem('xv5050_auto_release_midi', autoReleaseEnabled ? 'true' : 'false');
      setStatus(autoReleaseEnabled
        ? 'Auto-Release enabled: Driver will release when switching to Renoise/other apps'
        : 'Auto-Release disabled: Driver stays locked until Disconnect is clicked');
    });
  }

  let wasConnectedBeforeBlur = false;
  let blurReleaseTimeout = null;

  window.addEventListener('blur', () => {
    if (autoReleaseEnabled && midi.isConnected) {
      if (blurReleaseTimeout) clearTimeout(blurReleaseTimeout);
      blurReleaseTimeout = setTimeout(async () => {
        if (!document.hasFocus() && autoReleaseEnabled && midi.isConnected) {
          wasConnectedBeforeBlur = true;
          await midi.disconnect();
          setConnectionStatus(false);
          const btn = $('connectBtn');
          if (btn) btn.textContent = 'Connect';
          setStatus('MIDI driver released (switched to Renoise / background app)');
        }
      }, 1500);
    }
  });

  window.addEventListener('focus', async () => {
    if (blurReleaseTimeout) {
      clearTimeout(blurReleaseTimeout);
      blurReleaseTimeout = null;
    }
    if (autoReleaseEnabled && wasConnectedBeforeBlur && !midi.isConnected) {
      wasConnectedBeforeBlur = false;
      const inId = $('midiInput')?.value;
      const outId = $('midiOutput')?.value;
      if (inId && outId) {
        setStatus('Re-acquiring MIDI driver for XV-5050...');
        const ok = await midi.connect(inId, outId);
        if (ok) {
          setConnectionStatus(true, `${midi.inputName}`);
          const btn = $('connectBtn');
          if (btn) btn.textContent = 'Disconnect';
          setStatus('Re-connected to XV-5050');
          midi.onSysEx(handleIncomingSysEx);
          const dawThruId = $('midiDawThru')?.value;
          if (dawThruId) await midi.setDawThruInput(dawThruId);
        }
      }
    }
  });

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
      const val = e.target.value;
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

  // Attach intuitive < and > stepper arrow buttons to key dropdowns
  const steppers = [
    'waveGroup',
    'waveNumberL',
    'waveNumberR',
    'waveGain',
    'waveFxmColor',
    'toneFilterType',
    'patchInstrumentSelect',
    'userPerfSelect',
    'userPatchSelect',
    'drumKitSelect',
    'perfMfxType',
    'patchMfxType',
  ];
  steppers.forEach(id => attachSelectSteppers(id));

  initInteractiveEnvelopes();
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init);
} else {
  init();
}
