/**
 * XV-5050 Web Editor — Main Application
 * 
 * Fully client-side Web MIDI synthesizer editor.
 * Communicates directly with hardware via Web MIDI API & SysEx.
 */

import { MidiManager } from './midi.js';
import { createStore } from './state.js';
import { formatParamValue, decodeName, encodeName } from './parameters.js';
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
  parsePatchCommon,
  parsePatchTMT,
  parsePatchTone,
} from './patch.js';
import { parseSysEx, formatSysEx, addressToString } from './sysex.js';

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

function updatePatchCommonUI(data) {
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
}

function updatePatchTMTUI(data) {
  $('struct12').value = data.structureType12 ?? 0;
  $('booster12').value = data.booster12 ?? 0;
  $('struct34').value = data.structureType34 ?? 0;
  $('booster34').value = data.booster34 ?? 0;

  for (let t = 1; t <= 4; t++) {
    const sw = $(`tone${t}Switch`);
    const on = !!(data[`tone${t}Switch`]);
    sw.checked = on;
    sw.closest('.tone-switch').classList.toggle('active', on);
  }
}

function updateToneUI(data) {
  if (!data) return;
  $('toneLevel').value = data.toneLevel ?? 127;
  $('toneLevelVal').textContent = data.toneLevel ?? 127;
  $('tonePan').value = data.tonePan ?? 64;
  $('tonePanVal').textContent = panDisplay(data.tonePan ?? 64);
  $('toneCoarseTune').value = data.coarseTune ?? 64;
  $('toneCoarseTuneVal').textContent = (data.coarseTune ?? 64) - 64;
  $('toneFineTune').value = data.fineTune ?? 64;
  $('toneFineTuneVal').textContent = (data.fineTune ?? 64) - 64;
  $('toneFilterType').value = data.tvfFilterType ?? 0;
  $('toneCutoff').value = data.tvfCutoff ?? 127;
  $('toneCutoffVal').textContent = data.tvfCutoff ?? 127;
  $('toneResonance').value = data.tvfResonance ?? 0;
  $('toneResonanceVal').textContent = data.tvfResonance ?? 0;
  $('toneTvaLevel').value = data.tvaLevel ?? 127;
  $('toneTvaLevelVal').textContent = data.tvaLevel ?? 127;
}

function bindPatchControls() {
  const currentPart = () => getSelectedPart();

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

  // TMT Structure controls
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
      const cached = store.get(`patch.tones.${t - 1}`);
      if (cached) {
        updateToneUI(cached);
      }
    });
  }

  // Tone Generator Parameters
  const toneSliders = [
    { el: 'toneLevel', valEl: 'toneLevelVal', param: 'TONE_LEVEL', format: v => v },
    { el: 'tonePan', valEl: 'tonePanVal', param: 'TONE_PAN', format: panDisplay },
    { el: 'toneCoarseTune', valEl: 'toneCoarseTuneVal', param: 'COARSE_TUNE', format: v => v - 64 },
    { el: 'toneFineTune', valEl: 'toneFineTuneVal', param: 'FINE_TUNE', format: v => v - 64 },
    { el: 'toneCutoff', valEl: 'toneCutoffVal', param: 'TVF_CUTOFF', format: v => v },
    { el: 'toneResonance', valEl: 'toneResonanceVal', param: 'TVF_RESONANCE', format: v => v },
    { el: 'toneTvaLevel', valEl: 'toneTvaLevelVal', param: 'TVA_LEVEL', format: v => v },
  ];

  for (const s of toneSliders) {
    $(s.el).addEventListener('input', () => {
      const val = parseInt($(s.el).value, 10);
      $(s.valEl).textContent = s.format(val);
      if (!midi.isConnected) return;
      sendPatchToneParam(midi, currentPart(), currentToneIndex, s.param, val, getDeviceId());
    });
  }

  $('toneFilterType').addEventListener('change', () => {
    if (!midi.isConnected) return;
    sendPatchToneParam(midi, currentPart(), currentToneIndex, 'TVF_FILTER_TYPE', parseInt($('toneFilterType').value, 10), getDeviceId());
  });

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
