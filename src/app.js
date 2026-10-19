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
  requestPerformancePart,
  requestAllParts,
  sendPerformanceCommonParam,
  sendPerformanceChorusParam,
  sendPerformanceReverbParam,
  sendPerformanceName,
  sendPartParam,
  parsePerformanceCommon,
  parsePerformanceChorus,
  parsePerformanceReverb,
  parsePerformancePart,
} from './performance.js';
import {
  requestPatchCommon,
  requestPatchTMT,
  requestPatchTone,
  sendPatchCommonParam,
  sendPatchTMTParam,
  sendPatchToneParam,
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

// =============================================================================
// Initialization
// =============================================================================

const midi = new MidiManager();
const store = createStore();

const $ = (id) => document.getElementById(id);

let currentToneIndex = 1; // 1-4
let activeAuditionTimeout = null;

// Status helpers
function setStatus(message) {
  const el = $('statusMessage');
  if (el) el.textContent = message;
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
  setStatus('MIDI access granted — select device and connect');

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
    inputSelect.appendChild(opt);
  }

  for (const dev of outputs) {
    const opt = document.createElement('option');
    opt.value = dev.id;
    opt.textContent = dev.name;
    outputSelect.appendChild(opt);
  }

  setStatus(`Found ${inputs.length} input(s), ${outputs.length} output(s)`);
}

function connectMidi() {
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
    $('statusDeviceInfo').textContent = '';
    setStatus('Disconnected');
    return;
  }

  const success = midi.connect(inputId, outputId);
  if (success) {
    setConnectionStatus(true, `${midi.inputName}`);
    $('connectBtn').textContent = 'Disconnect';
    $('statusDeviceInfo').textContent = `${midi.inputName} ↔ ${midi.outputName}`;
    setStatus('Connected — ready to communicate');
    midi.onSysEx(handleIncomingSysEx);
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
  const part = getSelectedPart();
  const channel = (part >= 1 && part <= 16) ? (part - 1) : 0;

  if (activeAuditionTimeout) clearTimeout(activeAuditionTimeout);

  midi.sendNoteOn(channel, 60, 100);
  setStatus(`Audition Note On: C4 (Part ${part}, Ch ${channel + 1})`);

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
  $('perfChorusSource').value = data.chorusSource ?? 0;
  $('perfReverbSource').value = data.reverbSource ?? 0;
}

function updatePerformanceChorusUI(data) {
  $('perfChorusType').value = data.chorusType ?? 1;
  $('perfChorusLevel').value = data.chorusLevel ?? 64;
  $('perfChorusLevelVal').textContent = data.chorusLevel ?? 64;
  $('perfChorusOutputAssign').value = data.outputAssign ?? 0;
}

function updatePerformanceReverbUI(data) {
  $('perfReverbType').value = data.reverbType ?? 1;
  $('perfReverbLevel').value = data.reverbLevel ?? 64;
  $('perfReverbLevelVal').textContent = data.reverbLevel ?? 64;
  $('perfReverbOutputAssign').value = data.outputAssign ?? 0;
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
    { el: 'perfChorusSource', param: 'CHORUS_SOURCE' },
    { el: 'perfReverbSource', param: 'REVERB_SOURCE' },
  ];

  for (const b of selectBindings) {
    $(b.el).addEventListener('change', () => {
      if (!midi.isConnected) return;
      sendPerformanceCommonParam(midi, b.param, parseInt($(b.el).value, 10), getDeviceId());
    });
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
    sendPerformanceChorusParam(midi, 'CHORUS_LEVEL', val, getDeviceId());
  });

  $('perfChorusOutputAssign').addEventListener('change', () => {
    if (!midi.isConnected) return;
    sendPerformanceChorusParam(midi, 'OUTPUT_ASSIGN', parseInt($('perfChorusOutputAssign').value, 10), getDeviceId());
  });

  // Reverb controls
  $('perfReverbType').addEventListener('change', () => {
    if (!midi.isConnected) return;
    sendPerformanceReverbParam(midi, 'REVERB_TYPE', parseInt($('perfReverbType').value, 10), getDeviceId());
  });

  $('perfReverbLevel').addEventListener('input', () => {
    const val = parseInt($('perfReverbLevel').value, 10);
    $('perfReverbLevelVal').textContent = val;
    if (!midi.isConnected) return;
    sendPerformanceReverbParam(midi, 'REVERB_LEVEL', val, getDeviceId());
  });

  $('perfReverbOutputAssign').addEventListener('change', () => {
    if (!midi.isConnected) return;
    sendPerformanceReverbParam(midi, 'OUTPUT_ASSIGN', parseInt($('perfReverbOutputAssign').value, 10), getDeviceId());
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
  $(`partSwitch${part}`).addEventListener('change', () => {
    if (!midi.isConnected) return;
    sendPartParam(midi, part, 'RECEIVE_SWITCH', $(`partSwitch${part}`).checked ? 1 : 0, getDeviceId());
  });

  $(`partChannel${part}`).addEventListener('change', () => {
    if (!midi.isConnected) return;
    sendPartParam(midi, part, 'RECEIVE_CHANNEL', parseInt($(`partChannel${part}`).value, 10), getDeviceId());
  });

  for (const [elSuffix, paramKey] of [['BankMSB', 'PATCH_BANK_MSB'], ['BankLSB', 'PATCH_BANK_LSB'], ['PC', 'PATCH_PC']]) {
    $(`part${elSuffix}${part}`).addEventListener('change', () => {
      if (!midi.isConnected) return;
      sendPartParam(midi, part, paramKey, parseInt($(`part${elSuffix}${part}`).value, 10), getDeviceId());
    });
  }

  $(`partLevel${part}`).addEventListener('input', () => {
    const val = parseInt($(`partLevel${part}`).value, 10);
    $(`partLevelVal${part}`).textContent = val;
    if (!midi.isConnected) return;
    sendPartParam(midi, part, 'PART_LEVEL', val, getDeviceId());
  });

  $(`partPan${part}`).addEventListener('input', () => {
    const val = parseInt($(`partPan${part}`).value, 10);
    $(`partPanVal${part}`).textContent = panDisplay(val);
    if (!midi.isConnected) return;
    sendPartParam(midi, part, 'PART_PAN', val, getDeviceId());
  });

  $(`partCoarse${part}`).addEventListener('input', () => {
    const val = parseInt($(`partCoarse${part}`).value, 10);
    $(`partCoarseVal${part}`).textContent = val - 64;
    if (!midi.isConnected) return;
    sendPartParam(midi, part, 'COARSE_TUNE', val, getDeviceId());
  });

  $(`partFine${part}`).addEventListener('input', () => {
    const val = parseInt($(`partFine${part}`).value, 10);
    $(`partFineVal${part}`).textContent = val - 64;
    if (!midi.isConnected) return;
    sendPartParam(midi, part, 'FINE_TUNE', val, getDeviceId());
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
    $('patchPartSelect').value = part;
    switchToTab('patch');
    $('loadPatchBtn').click();
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
}

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
  $('waveGroup').value = data.waveGroupType ?? 0;
  $('waveGain').value = data.waveGain ?? 1;
  $('waveFxmSwitch').checked = !!data.fxmSwitch;
  $('waveFxmColor').value = data.fxmColor ?? 0;
  $('waveFxmDepth').value = data.fxmDepth ?? 0;
  $('waveFxmDepthVal').textContent = data.fxmDepth ?? 0;
  $('waveTempoSync').checked = !!data.waveTempoSync;

  const wNumL = data.waveNumberL ?? 1;
  const wNumR = data.waveNumberR ?? 0;
  $('waveNumberL').value = wNumL;
  $('waveNumberR').value = wNumR;
  const grp = data.waveGroupType ?? 0;
  $('waveNameL').textContent = `${wNumL}: ${getWaveName(grp, wNumL)}`;
  $('waveNameR').textContent = wNumR === 0 ? 'OFF' : `${wNumR}: ${getWaveName(grp, wNumR)}`;

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

  const d = generateEnvelopePath('pitch', { t1, t2, t3, t4, l0: 64, l1, l2: 64, l3: 64, l4: 64 });
  $('pitchEnvPath').setAttribute('d', d);
  $('pitchEnvBadge').textContent = `Depth: ${depth >= 0 ? '+' : ''}${depth} semi`;
}

function redrawFilterCurves() {
  const fType = parseInt($('toneFilterType').value, 10);
  const cutoff = parseInt($('toneCutoff').value, 10);
  const resonance = parseInt($('toneResonance').value, 10);
  const t1 = parseInt($('tvfEnvT1').value, 10);
  const t4 = parseInt($('tvfEnvT4').value, 10);

  const filterD = generateFilterCurvePath(fType, cutoff, resonance);
  $('filterRespPath').setAttribute('d', filterD);
  $('filterRespBadge').textContent = FILTER_TYPES[fType] || 'LPF';

  const envD = generateEnvelopePath('tvf', { t1, t2: 25, t3: 40, t4, l1: 127, l2: 90, l3: 60, l4: 0 });
  $('tvfEnvPath').setAttribute('d', envD);
}

function redrawTVAEnvCurve() {
  const t1 = parseInt($('tvaEnvT1').value, 10);
  const t2 = parseInt($('tvaEnvT2').value, 10);
  const t3 = parseInt($('tvaEnvT3').value, 10);
  const t4 = parseInt($('tvaEnvT4').value, 10);
  const l3 = parseInt($('tvaEnvL3').value, 10);
  const level = parseInt($('toneTvaLevel').value, 10);

  const envD = generateEnvelopePath('tva', { t1, t2, t3, t4, l1: level, l2: Math.floor(level * 0.8), l3 });
  $('tvaEnvPath').setAttribute('d', envD);
  $('tvaEnvBadge').textContent = `Level: ${level}`;
}

function redrawLFOCurve() {
  const form = parseInt($('lfoForm').value, 10);
  const rate = parseInt($('lfoRate').value, 10);
  const waveD = generateLFOWavePath(form, rate);
  $('lfoWavePath').setAttribute('d', waveD);
  $('lfoWaveBadge').textContent = `${LFO_WAVEFORMS[form] || 'TRI'} @ Rate ${rate}`;
}

function populateMatrixDropdowns() {
  const srcSelect = $('matrixSource');
  if (srcSelect && srcSelect.children.length === 0) {
    MATRIX_SOURCES.forEach((name, idx) => {
      const opt = document.createElement('option');
      opt.value = idx;
      opt.textContent = `${idx}: ${name}`;
      srcSelect.appendChild(opt);
    });
  }

  for (let d = 1; d <= 4; d++) {
    const destSelect = $(`matrixDest${d}`);
    if (destSelect && destSelect.children.length === 0) {
      MATRIX_DESTINATIONS.forEach((name, idx) => {
        const opt = document.createElement('option');
        opt.value = idx;
        opt.textContent = `${idx}: ${name}`;
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
      opt.textContent = `${idx + 1}: ${name}`;
      waveLSelect.appendChild(opt);
    });
  }

  if (waveRSelect && waveRSelect.children.length <= 1) {
    INTERNAL_WAVEFORMS.forEach((name, idx) => {
      const opt = document.createElement('option');
      opt.value = idx + 1;
      opt.textContent = `${idx + 1}: ${name}`;
      waveRSelect.appendChild(opt);
    });
  }
}

function bindPatchControls() {
  const currentPart = () => getSelectedPart();
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
    sendTMTKeyRangeParam(midi, currentPart(), currentToneIndex, 'KEY_LOWER', val, getDeviceId());
  });

  $('tmtKeyUpper').addEventListener('input', () => {
    const val = parseInt($('tmtKeyUpper').value, 10);
    $('tmtKeyUpperVal').textContent = formatKeyNote(val);
    if (!midi.isConnected) return;
    sendTMTKeyRangeParam(midi, currentPart(), currentToneIndex, 'KEY_UPPER', val, getDeviceId());
  });

  $('tmtVelLower').addEventListener('input', () => {
    const val = parseInt($('tmtVelLower').value, 10);
    $('tmtVelLowerVal').textContent = val;
    if (!midi.isConnected) return;
    sendTMTKeyRangeParam(midi, currentPart(), currentToneIndex, 'VEL_LOWER', val, getDeviceId());
  });

  $('tmtVelUpper').addEventListener('input', () => {
    const val = parseInt($('tmtVelUpper').value, 10);
    $('tmtVelUpperVal').textContent = val;
    if (!midi.isConnected) return;
    sendTMTKeyRangeParam(midi, currentPart(), currentToneIndex, 'VEL_UPPER', val, getDeviceId());
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
      sendPatchToneParam(midi, currentPart(), currentToneIndex, s.param, val, getDeviceId());
    });
  }

  $('waveGroup').addEventListener('change', () => {
    const grp = parseInt($('waveGroup').value, 10);
    const numL = parseInt($('waveNumberL').value, 10) || 1;
    const numR = parseInt($('waveNumberR').value, 10) || 0;
    $('waveNameL').textContent = `${numL}: ${getWaveName(grp, numL)}`;
    $('waveNameR').textContent = numR === 0 ? 'OFF' : `${numR}: ${getWaveName(grp, numR)}`;
    if (!midi.isConnected) return;
    sendPatchToneParam(midi, currentPart(), currentToneIndex, 'WAVE_GROUP_TYPE', grp, getDeviceId());
  });

  $('waveNumberL').addEventListener('change', () => {
    const val = parseInt($('waveNumberL').value, 10);
    const grp = parseInt($('waveGroup').value, 10);
    $('waveNameL').textContent = `${val}: ${getWaveName(grp, val)}`;
    if (!midi.isConnected) return;
    sendPatchToneParam(midi, currentPart(), currentToneIndex, 'WAVE_NUMBER_L', val, getDeviceId());
  });

  $('waveNumberR').addEventListener('change', () => {
    const val = parseInt($('waveNumberR').value, 10);
    const grp = parseInt($('waveGroup').value, 10);
    $('waveNameR').textContent = val === 0 ? 'OFF' : `${val}: ${getWaveName(grp, val)}`;
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
      sendPatchToneParam(midi, currentPart(), currentToneIndex, p.param, val, getDeviceId());
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
    sendPatchToneParam(midi, currentPart(), currentToneIndex, 'TVF_ENV_DEPTH', val, getDeviceId());
  });

  $('tvfEnvT1').addEventListener('input', () => {
    const val = parseInt($('tvfEnvT1').value, 10);
    $('tvfEnvT1Val').textContent = val;
    redrawFilterCurves();
    if (!midi.isConnected) return;
    sendPatchToneParam(midi, currentPart(), currentToneIndex, 'TVF_ENV_T1', val, getDeviceId());
  });

  $('tvfEnvT4').addEventListener('input', () => {
    const val = parseInt($('tvfEnvT4').value, 10);
    $('tvfEnvT4Val').textContent = val;
    redrawFilterCurves();
    if (!midi.isConnected) return;
    sendPatchToneParam(midi, currentPart(), currentToneIndex, 'TVF_ENV_T4', val, getDeviceId());
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
      sendPatchToneParam(midi, currentPart(), currentToneIndex, t.param, val, getDeviceId());
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
    sendToneLFOParam(midi, currentPart(), currentToneIndex, currentLfoIndex, 'RATE', val, getDeviceId());
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
      sendToneLFOParam(midi, currentPart(), currentToneIndex, currentLfoIndex, d.param, val, getDeviceId());
    });
  }

  // Load Patch Button
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
        await new Promise(r => setTimeout(r, 40));
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

async function loadAllPartsData() {
  if (!midi.isConnected) { setStatus('Not connected'); return; }
  const progEl = $('loadProgress');
  setStatus('Loading all 16 parts...');
  try {
    const parts = await requestAllParts(midi, getDeviceId(), (done, total) => {
      if (progEl) progEl.textContent = `Reading Part ${done}/${total}...`;
    });
    parts.forEach((data, idx) => updatePartRow(idx + 1, data));
    if (progEl) progEl.textContent = 'All 16 parts loaded';
    setStatus('Successfully loaded all 16 performance parts');
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
// Initialization
// =============================================================================

function init() {
  buildPartsTable();
  initTabs();

  bindPerformanceCommonControls();
  bindPatchControls();
  initLibrarianControls();

  // Top header actions
  $('connectBtn').addEventListener('click', connectMidi);
  $('refreshBtn').addEventListener('click', refreshDeviceList);
  $('panicBtn').addEventListener('click', handlePanic);
  $('auditionBtn').addEventListener('click', handleAudition);
  $('clearLogBtn').addEventListener('click', clearLog);

  // Performance loader buttons
  $('loadPerfBtn').addEventListener('click', loadPerformanceCommon);
  $('loadPerfFxBtn').addEventListener('click', loadPerformanceFx);
  $('loadAllPartsBtn').addEventListener('click', loadAllPartsData);

  // MIDI port hotplug
  midi.onStateChange((info) => {
    if (info.state === 'disconnected' && !midi.isConnected) {
      setConnectionStatus(false);
      $('connectBtn').textContent = 'Connect';
      setStatus(`Device disconnected: ${info.name}`);
    }
    refreshDeviceList();
  });

  initMidi();
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init);
} else {
  init();
}
