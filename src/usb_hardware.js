/**
 * XV-5050 Web Editor — USB Hardware Integration, Diagnostics & Resilience
 * 
 * Provides:
 * - Device ID auto-discovery across MIDI ports
 * - Resilient SysEx request engine with automatic retransmission & rate limiting
 * - Full read/write for User Performances (1-64)
 * - Full read/write for User Patches (1-128)
 * - Comprehensive hardware diagnostic test runner
 */

import { buildRQ1, buildDT1, parseSysEx } from './sysex.js';
import {
  SETUP,
  SYSTEM,
  PERF_TEMP,
  PERF_PART,
  PATCH_COMMON,
  PATCH_TMT,
  PATCH_TONE,
  getUserPerformanceAddress,
  getUserPatchAddress,
  getUserRhythmAddress,
  getPartAddress,
  getPatchTempAddress,
  getPatchTMTAddress,
  getToneAddress,
} from './addresses.js';
import { decodeName, encodeName } from './parameters.js';
import { parsePerformanceCommon, parsePerformanceChorus, parsePerformanceReverb, parsePerformancePart } from './performance.js';
import { parsePatchCommon, parsePatchTMT, parsePatchTone } from './patch.js';

function extractData(resp) {
  if (!resp) return null;
  if (resp.data) return resp.data;
  const parsed = parseSysEx(resp);
  return parsed?.data || null;
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Resilient SysEx transmission with automatic retry on timeout or checksum corruption.
 */
export async function sendAndReceiveWithRetry(
  midiManager,
  requestBytes,
  { maxRetries = 3, timeoutMs = 1500, throttleMs = 30 } = {}
) {
  let lastError = null;

  for (let attempt = 1; attempt <= maxRetries + 1; attempt++) {
    try {
      if (throttleMs > 0 && attempt > 1) {
        await sleep(throttleMs);
      }

      const response = await midiManager.sendAndReceive(requestBytes, timeoutMs);
      const parsed = response?.data ? response : parseSysEx(response);

      if (!parsed || !parsed.valid) {
        throw new Error(parsed?.error || 'Invalid SysEx packet received');
      }

      return parsed;
    } catch (err) {
      lastError = err;
    }
  }

  throw new Error(`Failed after ${maxRetries + 1} attempts: ${lastError?.message || 'Unknown error'}`);
}

/**
 * Auto-detect configured Device ID by probing 0x10 - 0x1F.
 */
export async function detectDeviceId(midiManager, timeoutMs = 200) {
  for (let devId = 0x10; devId <= 0x1F; devId++) {
    try {
      const rq1 = buildRQ1(SETUP.BASE, SETUP.SIZE, devId);
      const resp = await midiManager.sendAndReceive(rq1, timeoutMs);
      const parsed = resp?.data ? resp : parseSysEx(resp);
      if (parsed && parsed.valid) {
        return devId;
      }
    } catch {
      // Continue searching
    }
  }
  throw new Error('XV-5050 synthesizer did not respond. Check USB connection and MIDI port selection.');
}

/**
 * Request complete User Performance (Common, Effects, 16 Parts)
 */
export async function requestEntireUserPerformance(midiManager, perfIndex, deviceId = 0x10) {
  if (perfIndex < 1 || perfIndex > 64) {
    throw new Error('User Performance index must be 1-64');
  }

  const b1 = perfIndex - 1;
  const commonAddr = [0x20, b1, 0x00, 0x00];
  const chorusAddr = [0x20, b1, 0x04, 0x00];
  const reverbAddr = [0x20, b1, 0x06, 0x00];

  // Common
  const commResp = await sendAndReceiveWithRetry(
    midiManager,
    buildRQ1(commonAddr, PERF_TEMP.COMMON.SIZE, deviceId)
  );
  const common = parsePerformanceCommon(extractData(commResp));

  // Chorus
  const chorResp = await sendAndReceiveWithRetry(
    midiManager,
    buildRQ1(chorusAddr, PERF_TEMP.CHORUS.SIZE, deviceId)
  );
  const chorus = parsePerformanceChorus(extractData(chorResp));

  // Reverb
  const revResp = await sendAndReceiveWithRetry(
    midiManager,
    buildRQ1(reverbAddr, PERF_TEMP.REVERB.SIZE, deviceId)
  );
  const reverb = parsePerformanceReverb(extractData(revResp));

  // 16 Parts
  const parts = [];
  for (let p = 1; p <= 16; p++) {
    const partAddr = [0x20, b1, 0x20 + (p - 1), 0x00];
    const partResp = await sendAndReceiveWithRetry(
      midiManager,
      buildRQ1(partAddr, PERF_PART.SIZE, deviceId)
    );
    const part = parsePerformancePart(extractData(partResp), p);
    parts.push(part);
  }

  return {
    index: perfIndex,
    common,
    chorus,
    reverb,
    parts,
  };
}

/**
 * Write complete Performance into User Performance memory slot (1-64)
 */
export async function sendEntireUserPerformance(midiManager, perfIndex, perfData, deviceId = 0x10) {
  if (perfIndex < 1 || perfIndex > 64) {
    throw new Error('User Performance index must be 1-64');
  }

  const b1 = perfIndex - 1;

  // Common
  if (perfData.common?.raw) {
    const commonAddr = [0x20, b1, 0x00, 0x00];
    midiManager.send(buildDT1(commonAddr, perfData.common.raw, deviceId));
    await sleep(20);
  }

  // Chorus
  if (perfData.chorus?.raw) {
    const chorusAddr = [0x20, b1, 0x04, 0x00];
    midiManager.send(buildDT1(chorusAddr, perfData.chorus.raw, deviceId));
    await sleep(20);
  }

  // Reverb
  if (perfData.reverb?.raw) {
    const reverbAddr = [0x20, b1, 0x06, 0x00];
    midiManager.send(buildDT1(reverbAddr, perfData.reverb.raw, deviceId));
    await sleep(20);
  }

  // Parts 1-16
  if (Array.isArray(perfData.parts)) {
    for (let p = 1; p <= Math.min(16, perfData.parts.length); p++) {
      const part = perfData.parts[p - 1];
      if (part?.raw) {
        const partAddr = [0x20, b1, 0x20 + (p - 1), 0x00];
        midiManager.send(buildDT1(partAddr, part.raw, deviceId));
        await sleep(15);
      }
    }
  }
}

/**
 * Request complete User Patch (Common, TMT, 4 Tones)
 */
export async function requestEntireUserPatch(midiManager, patchIndex, deviceId = 0x10) {
  if (patchIndex < 1 || patchIndex > 128) {
    throw new Error('User Patch index must be 1-128');
  }

  const b1 = patchIndex - 1;
  const commonAddr = [0x30, b1, 0x00, 0x00];
  const tmtAddr = [0x30, b1, 0x10, 0x00];

  // Common
  const commResp = await sendAndReceiveWithRetry(
    midiManager,
    buildRQ1(commonAddr, PATCH_COMMON.SIZE, deviceId)
  );
  const common = parsePatchCommon(extractData(commResp));

  // TMT
  const tmtResp = await sendAndReceiveWithRetry(
    midiManager,
    buildRQ1(tmtAddr, PATCH_TMT.SIZE, deviceId)
  );
  const tmt = parsePatchTMT(extractData(tmtResp));

  // 4 Tones
  const tones = [];
  for (let t = 1; t <= 4; t++) {
    const toneAddr = [0x30, b1, 0x20 + (t - 1) * 2, 0x00];
    const toneResp = await sendAndReceiveWithRetry(
      midiManager,
      buildRQ1(toneAddr, PATCH_TONE.SIZE, deviceId)
    );
    const tone = parsePatchTone(extractData(toneResp), t);
    tones.push(tone);
  }

  return {
    index: patchIndex,
    common,
    tmt,
    tones,
  };
}

/**
 * Write complete Patch into User Patch memory slot (1-128)
 */
export async function sendEntireUserPatch(midiManager, patchIndex, patchData, deviceId = 0x10) {
  if (patchIndex < 1 || patchIndex > 128) {
    throw new Error('User Patch index must be 1-128');
  }

  const b1 = patchIndex - 1;

  // Common
  if (patchData.common?.raw) {
    const commonAddr = [0x30, b1, 0x00, 0x00];
    midiManager.send(buildDT1(commonAddr, patchData.common.raw, deviceId));
    await sleep(20);
  }

  // TMT
  if (patchData.tmt?.raw) {
    const tmtAddr = [0x30, b1, 0x10, 0x00];
    midiManager.send(buildDT1(tmtAddr, patchData.tmt.raw, deviceId));
    await sleep(20);
  }

  // 4 Tones
  if (Array.isArray(patchData.tones)) {
    for (let t = 1; t <= Math.min(4, patchData.tones.length); t++) {
      const tone = patchData.tones[t - 1];
      if (tone?.raw) {
        const toneAddr = [0x30, b1, 0x20 + (t - 1) * 2, 0x00];
        midiManager.send(buildDT1(toneAddr, tone.raw, deviceId));
        await sleep(15);
      }
    }
  }
}

/**
 * Execute comprehensive 6-step hardware diagnostic suite
 */
export async function runHardwareDiagnostics(midiManager, deviceId = 0x10, onProgress = null) {
  const steps = [];
  let overallSuccess = true;

  const runStep = async (name, action) => {
    const start = Date.now();
    try {
      if (typeof onProgress === 'function') {
        onProgress({ name, status: 'running' });
      }
      const res = await action();
      const elapsed = Date.now() - start;
      const stepResult = {
        name,
        passed: true,
        latencyMs: elapsed,
        bytesReceived: res?.bytesReceived || 0,
        details: res?.details || 'OK',
      };
      steps.push(stepResult);
      if (typeof onProgress === 'function') {
        onProgress({ name, status: 'passed', latencyMs: elapsed });
      }
      return true;
    } catch (err) {
      const elapsed = Date.now() - start;
      const stepResult = {
        name,
        passed: false,
        latencyMs: elapsed,
        bytesReceived: 0,
        error: err.message,
      };
      steps.push(stepResult);
      overallSuccess = false;
      if (typeof onProgress === 'function') {
        onProgress({ name, status: 'failed', error: err.message });
      }
      return false;
    }
  };

  // Step 1: Device ID Handshake
  await runStep('Device ID Handshake', async () => {
    const detected = await detectDeviceId(midiManager, 300);
    return { bytesReceived: 15, details: `Handshake verified on Device ID 0x${detected.toString(16).toUpperCase()}` };
  });

  // Step 2: System & Setup Parameters
  if (overallSuccess) {
    await runStep('System & Setup Parameters', async () => {
      const rq1 = buildRQ1(SYSTEM.COMMON.BASE, SYSTEM.COMMON.SIZE, deviceId);
      const resp = await sendAndReceiveWithRetry(midiManager, rq1, { timeoutMs: 400 });
      return { bytesReceived: resp.data.length, details: `Read ${resp.data.length} bytes System Common` };
    });
  }

  // Step 3: Temporary Performance Common & Effects
  if (overallSuccess) {
    await runStep('Temporary Performance Common & Effects', async () => {
      const rq1 = buildRQ1(PERF_TEMP.COMMON.BASE, PERF_TEMP.COMMON.SIZE, deviceId);
      const resp = await sendAndReceiveWithRetry(midiManager, rq1, { timeoutMs: 400 });
      return { bytesReceived: resp.data.length, details: `Read Performance Common (${decodeName(resp.data.slice(0, 12))})` };
    });
  }

  // Step 4: Temporary Patch & Tone Engine
  if (overallSuccess) {
    await runStep('Temporary Patch & Tone Engine', async () => {
      const toneAddr = getToneAddress(getPatchTempAddress(1), 1);
      const rq1 = buildRQ1(toneAddr, PATCH_TONE.SIZE, deviceId);
      const resp = await sendAndReceiveWithRetry(midiManager, rq1, { timeoutMs: 400 });
      return { bytesReceived: resp.data.length, details: `Read Tone 1 Wave & TVF Engine (${resp.data.length} bytes)` };
    });
  }

  // Step 5: User Performance Bank Sample
  if (overallSuccess) {
    await runStep('User Performance Bank Sample', async () => {
      const perf1Addr = getUserPerformanceAddress(1);
      const rq1 = buildRQ1(perf1Addr, PERF_TEMP.COMMON.SIZE, deviceId);
      const resp = await sendAndReceiveWithRetry(midiManager, rq1, { timeoutMs: 400 });
      return { bytesReceived: resp.data.length, details: `User Perf 01: "${decodeName(resp.data.slice(0, 12))}"` };
    });
  }

  // Step 6: User Patch Bank Sample
  if (overallSuccess) {
    await runStep('User Patch Bank Sample', async () => {
      const patch1Addr = getUserPatchAddress(1);
      const rq1 = buildRQ1(patch1Addr, PATCH_COMMON.SIZE, deviceId);
      const resp = await sendAndReceiveWithRetry(midiManager, rq1, { timeoutMs: 400 });
      return { bytesReceived: resp.data.length, details: `User Patch 001: "${decodeName(resp.data.slice(0, 12))}"` };
    });
  }

  return {
    overallSuccess,
    steps,
  };
}
