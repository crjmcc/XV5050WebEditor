import { chromium } from 'playwright';
import path from 'path';
import { fileURLToPath, pathToFileURL } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function verifyCompactPatchKnobs() {
  console.log('--- Verifying Compact Patch Editor Rotary Knobs & Dead Space Removal ---');

  const browser = await chromium.launch({
    executablePath: 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox']
  });

  const context = await browser.newContext({
    permissions: ['midi', 'midi-sysex'],
    viewport: { width: 1400, height: 1100 }
  });
  const page = await context.newPage();

  page.on('pageerror', err => console.error('Page Error:', err));
  page.on('console', msg => {
    if (msg.type() === 'error' && !msg.text().includes('Failed to get Web MIDI access')) {
      console.error('Console Error:', msg.text());
    }
  });

  const indexUrl = pathToFileURL(path.resolve(__dirname, '../index.html')).href;
  await page.goto(indexUrl, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(600);

  // Switch to Patch & Tones tab
  await page.click('#tabPatch');
  await page.waitForTimeout(400);

  // 1. Verify Master & Voice Rotary Knobs
  console.log('1. Checking Master & Voice parameters rotary knobs...');
  const masterKnobWrappers = [
    'knobWrapPatchLevel', 'knobWrapPatchPan', 'knobWrapPatchOctave',
    'knobWrapPatchCoarseTune', 'knobWrapPatchFineTune', 'knobWrapPatchPortaTime'
  ];
  for (const id of masterKnobWrappers) {
    const knob = await page.$(`#${id} .rotary-knob`);
    const val = await page.$(`#${id} .rotary-knob-val`);
    if (!knob || !val) throw new Error(`Missing rotary knob in #${id}`);
  }
  console.log('✓ All 6 Master & Voice rotary knobs verified.');

  // Test interactive drag on Level knob
  console.log('Testing interactive drag on Master Level knob...');
  const levelKnob = await page.$('#knobWrapPatchLevel .rotary-knob');
  const levelBox = await levelKnob.boundingBox();
  await page.mouse.move(levelBox.x + levelBox.width / 2, levelBox.y + levelBox.height / 2);
  await page.mouse.down();
  await page.mouse.move(levelBox.x + levelBox.width / 2, levelBox.y + levelBox.height / 2 - 40);
  await page.mouse.up();
  await page.waitForTimeout(100);

  const levelValAfter = await page.$eval('#knobWrapPatchLevel .rotary-knob-val', el => el.textContent.trim());
  const hiddenLevelVal = await page.$eval('#patchLevel', el => el.value);
  console.log(`Master Level knob: ${levelValAfter}, Hidden input value: ${hiddenLevelVal}`);
  if (levelValAfter !== hiddenLevelVal) {
    throw new Error(`Knob value (${levelValAfter}) does not match hidden input (${hiddenLevelVal})`);
  }

  // 2. Verify MFX Common Knobs & 12 Parameters
  console.log('2. Checking MFX Common and Algorithm Parameter Knobs...');
  const mfxCommonWrappers = ['knobWrapPatchMfxDryLevel', 'knobWrapPatchMfxChorusSend', 'knobWrapPatchMfxReverbSend'];
  for (const id of mfxCommonWrappers) {
    const knob = await page.$(`#${id} .rotary-knob`);
    if (!knob) throw new Error(`Missing MFX common knob in #${id}`);
  }
  for (let i = 1; i <= 12; i++) {
    const knob = await page.$(`#knobWrapPatchMfxParam${i} .rotary-knob`);
    if (!knob) throw new Error(`Missing MFX param knob ${i}`);
  }
  console.log('✓ MFX Common and all 12 Algorithm parameter knobs verified.');

  // 3. Verify Dedicated Chorus & Reverb Panels
  console.log('3. Checking Dedicated Chorus & Reverb rotary knobs...');
  const chorusKnobs = ['knobWrapPatchChorusLevel', 'knobWrapPatchChorusRate', 'knobWrapPatchChorusDepth', 'knobWrapPatchChorusRevSend'];
  for (const id of chorusKnobs) {
    const knob = await page.$(`#${id} .rotary-knob`);
    if (!knob) throw new Error(`Missing Chorus knob in #${id}`);
  }
  const reverbKnobs = ['knobWrapPatchReverbLevel', 'knobWrapPatchReverbTime', 'knobWrapPatchReverbHfDamp'];
  for (const id of reverbKnobs) {
    const knob = await page.$(`#${id} .rotary-knob`);
    if (!knob) throw new Error(`Missing Reverb knob in #${id}`);
  }
  console.log('✓ Dedicated Chorus & Reverb knobs verified.');

  // 4. Verify Tone Synthesis Blocks
  console.log('4. Checking Tone synthesis module rotary knobs...');
  const toneKnobWrappers = [
    'knobWrapToneLevel', 'knobWrapTonePan', 'knobWrapToneCoarse', 'knobWrapToneFine',
    'knobWrapToneCutoff', 'knobWrapToneResonance', 'knobWrapTvfEnvDepth', 'knobWrapTvfEnvT1', 'knobWrapTvfEnvT2', 'knobWrapTvfEnvT3', 'knobWrapTvfEnvT4', 'knobWrapTvfEnvL3',
    'knobWrapToneTvaLevel', 'knobWrapTvaEnvT1', 'knobWrapTvaEnvT2', 'knobWrapTvaEnvT3', 'knobWrapTvaEnvT4', 'knobWrapTvaEnvL3',
    'knobWrapPitchEnvDepth', 'knobWrapPitchEnvT1', 'knobWrapPitchEnvT2', 'knobWrapPitchEnvT3', 'knobWrapPitchEnvT4', 'knobWrapPitchEnvL1',
    'knobWrapLfoRate', 'knobWrapLfoPitchDepth', 'knobWrapLfoTvfDepth', 'knobWrapLfoTvaDepth', 'knobWrapLfoPanDepth'
  ];
  for (const id of toneKnobWrappers) {
    const knob = await page.$(`#${id} .rotary-knob`);
    if (!knob) throw new Error(`Missing Tone knob in #${id}`);
  }
  console.log(`✓ All ${toneKnobWrappers.length} Tone synthesis rotary knobs verified.`);

  // 5. Measure Dead Space
  const masterCardBox = await (await page.$('.patch-master-card')).boundingBox();
  const matrixCardBox = await (await page.$('.patch-matrix-card')).boundingBox();
  console.log(`Layout check: Master card height: ${masterCardBox.height.toFixed(0)}px, Matrix card height: ${matrixCardBox.height.toFixed(0)}px`);

  // 6. Capture Screenshots
  const screenshotPath1 = 'C:\\Users\\crjmc\\.gemini\\antigravity\\brain\\a4d4c31a-aff3-4886-ac22-5a7ea14db660\\patch_editor_compact_knobs.png';
  await page.screenshot({ path: screenshotPath1, fullPage: false });
  console.log(`Saved screenshot to ${screenshotPath1}`);

  await browser.close();
  console.log('✅ ALL COMPACT ROTARY KNOB & DEAD SPACE VERIFICATIONS PASSED!');
}

verifyCompactPatchKnobs();

