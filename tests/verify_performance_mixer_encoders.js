import { chromium } from 'playwright';
import path from 'path';
import { fileURLToPath, pathToFileURL } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function verifyMixerEncoders() {
  console.log('--- Verifying 16-Part Mixer Endless Encoders ---');

  const browser = await chromium.launch({
    executablePath: 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox']
  });

  const context = await browser.newContext({
    permissions: ['midi', 'midi-sysex']
  });
  const page = await context.newPage();
  await page.setViewportSize({ width: 1400, height: 950 });

  const errors = [];
  page.on('pageerror', err => {
    console.error('Page Error:', err);
    errors.push(err.message);
  });
  page.on('console', msg => {
    if (msg.type() === 'error') {
      const text = msg.text();
      if (!text.includes('Failed to get Web MIDI access') && !text.includes('NotAllowedError')) {
        console.error('Console Error:', text);
        errors.push(text);
      }
    }
  });

  const indexUrl = pathToFileURL(path.resolve(__dirname, '../index.html')).href;
  console.log(`Loading ${indexUrl}...`);
  await page.goto(indexUrl, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(1000);

  // 1. Verify 16 rows exist in #partsTableBody
  const rowCount = await page.$$eval('#partsTableBody tr', rows => rows.length);
  console.log(`Found ${rowCount} parts rows in table.`);
  if (rowCount !== 16) throw new Error(`Expected 16 rows, got ${rowCount}`);

  // 2. Verify all 16 rows have rotary encoders for Level, Pan, Coarse, Fine, Chorus, Reverb
  for (let i = 1; i <= 16; i++) {
    const levelKnob = await page.$(`#knobPartLevel${i}`);
    const panKnob = await page.$(`#knobPartPan${i}`);
    const coarseKnob = await page.$(`#knobPartCoarse${i}`);
    const fineKnob = await page.$(`#knobPartFine${i}`);
    const chorusKnob = await page.$(`#knobPartChorus${i}`);
    const reverbKnob = await page.$(`#knobPartReverb${i}`);

    if (!levelKnob || !panKnob || !coarseKnob || !fineKnob || !chorusKnob || !reverbKnob) {
      throw new Error(`Part ${i} missing one or more rotary encoders`);
    }

    // Check value labels underneath
    const levelVal = await page.$eval(`#knobWrapPartLevel${i} .rotary-knob-val`, el => el.textContent.trim());
    const panVal = await page.$eval(`#knobWrapPartPan${i} .rotary-knob-val`, el => el.textContent.trim());
    const coarseVal = await page.$eval(`#knobWrapPartCoarse${i} .rotary-knob-val`, el => el.textContent.trim());
    const fineVal = await page.$eval(`#knobWrapPartFine${i} .rotary-knob-val`, el => el.textContent.trim());
    const chorusVal = await page.$eval(`#knobWrapPartChorus${i} .rotary-knob-val`, el => el.textContent.trim());
    const reverbVal = await page.$eval(`#knobWrapPartReverb${i} .rotary-knob-val`, el => el.textContent.trim());

    if (levelVal !== '100' || panVal !== 'C' || coarseVal !== '0' || fineVal !== '0' || chorusVal !== '0' || reverbVal !== '40') {
      throw new Error(`Part ${i} initial values mismatch: Level=${levelVal}, Pan=${panVal}, Coarse=${coarseVal}, Fine=${fineVal}, Cho=${chorusVal}, Rev=${reverbVal}`);
    }
  }
  console.log('✓ All 16 rows verified with 6 rotary encoders and formatted value badges.');

  // 3. Test interaction: Drag adjustment on Level knob of Part 1
  console.log('Testing vertical drag adjustment on Part 1 Level knob...');
  const knobDial = page.locator('#knobWrapPartLevel1 .rotary-knob-dial');
  await knobDial.scrollIntoViewIfNeeded();
  const levelBox = await knobDial.boundingBox();
  if (!levelBox) throw new Error('Could not find bounding box for Part 1 Level knob');
  
  const startX = levelBox.x + levelBox.width / 2;
  const startY = levelBox.y + levelBox.height / 2;
  await page.mouse.move(startX, startY);
  await page.mouse.down();
  // Drag upward by 30 pixels
  await page.mouse.move(startX, startY - 30, { steps: 5 });
  await page.mouse.up();
  await page.waitForTimeout(100);

  const draggedLevel = await page.$eval('#knobWrapPartLevel1 .rotary-knob-val', el => parseInt(el.textContent, 10));
  console.log(`Part 1 Level value after drag upward: ${draggedLevel}`);
  if (draggedLevel <= 100) throw new Error(`Expected level to increase above 100 on upward drag, got ${draggedLevel}`);

  // Test double-click reset
  await knobDial.dblclick();
  await page.waitForTimeout(100);
  const resetLevel = await page.$eval('#knobWrapPartLevel1 .rotary-knob-val', el => el.textContent.trim());
  console.log(`Part 1 Level value after double-click: ${resetLevel}`);
  if (resetLevel !== '100') throw new Error(`Expected level reset to 100, got ${resetLevel}`);
  console.log('✓ Double-click reset to default verified.');

  // Test mouse wheel
  console.log('Testing mouse wheel adjustment on Part 1 Level knob...');
  await knobDial.hover();
  await page.mouse.wheel(0, -50);
  await page.waitForTimeout(100);
  const wheeledLevel = await page.$eval('#knobWrapPartLevel1 .rotary-knob-val', el => parseInt(el.textContent, 10));
  console.log(`Part 1 Level value after wheel up: ${wheeledLevel}`);
  if (wheeledLevel <= 100) {
    // If wheel in headless chrome didn't fire DOM wheel, dispatch wheel event directly to verify listener
    await page.$eval('#knobWrapPartLevel1', el => {
      el.dispatchEvent(new WheelEvent('wheel', { deltaY: -100, bubbles: true }));
    });
    const dispatchedLevel = await page.$eval('#knobWrapPartLevel1 .rotary-knob-val', el => parseInt(el.textContent, 10));
    console.log(`Part 1 Level value after dispatched wheel: ${dispatchedLevel}`);
    if (dispatchedLevel <= 100) throw new Error(`Expected wheel to increase level, got ${dispatchedLevel}`);
  }
  console.log('✓ Wheel adjustment verified.');

  // Reset back to 100
  await knobDial.dblclick();
  await page.waitForTimeout(100);

  // 4. Test programmatic updatePartUI reflection (simulating unit sync / performance load)
  console.log('Testing updatePartUI with complex values (Pan R30, Coarse +12, Fine -8)...');
  await page.evaluate(() => {
    window.updatePartUI(1, {
      receiveSwitch: 1,
      receiveChannel: 0,
      patchBankMSB: 87,
      patchBankLSB: 64,
      patchPC: 1,
      partLevel: 114,
      partPan: 94,        // 94 - 64 = R30
      coarseTune: 76,     // 76 - 64 = +12
      fineTune: 56,       // 56 - 64 = -8
      chorusSend: 107,
      reverbSend: 127,
      patchName: 'X-Treme Lead'
    });
  });
  await page.waitForTimeout(200);

  const updatedLevel = await page.$eval('#knobWrapPartLevel1 .rotary-knob-val', el => el.textContent.trim());
  const updatedPan = await page.$eval('#knobWrapPartPan1 .rotary-knob-val', el => el.textContent.trim());
  const updatedCoarse = await page.$eval('#knobWrapPartCoarse1 .rotary-knob-val', el => el.textContent.trim());
  const updatedFine = await page.$eval('#knobWrapPartFine1 .rotary-knob-val', el => el.textContent.trim());
  const updatedChorus = await page.$eval('#knobWrapPartChorus1 .rotary-knob-val', el => el.textContent.trim());
  const updatedReverb = await page.$eval('#knobWrapPartReverb1 .rotary-knob-val', el => el.textContent.trim());

  console.log(`Part 1 Updated Values -> Level: ${updatedLevel}, Pan: ${updatedPan}, Coarse: ${updatedCoarse}, Fine: ${updatedFine}, Cho: ${updatedChorus}, Rev: ${updatedReverb}`);
  if (updatedLevel !== '114') throw new Error(`Level mismatch: ${updatedLevel}`);
  if (updatedPan !== 'R30') throw new Error(`Pan mismatch: ${updatedPan}`);
  if (updatedCoarse !== '+12') throw new Error(`Coarse mismatch: ${updatedCoarse}`);
  if (updatedFine !== '-8') throw new Error(`Fine mismatch: ${updatedFine}`);
  if (updatedChorus !== '107') throw new Error(`Chorus mismatch: ${updatedChorus}`);
  if (updatedReverb !== '127') throw new Error(`Reverb mismatch: ${updatedReverb}`);
  console.log('✓ Hardware reflection and value formatting verified 100%.');

  // Populate multiple rows to resemble live studio session
  await page.evaluate(() => {
    window.updatePartUI(2, { partLevel: 79, partPan: 94, coarseTune: 64, fineTune: 64, chorusSend: 107, reverbSend: 127, patchName: 'Warm Pad' });
    window.updatePartUI(3, { partLevel: 77, partPan: 64, coarseTune: 64, fineTune: 64, chorusSend: 88, reverbSend: 0, patchName: 'Sub Bass' });
    window.updatePartUI(4, { partLevel: 54, partPan: 64, coarseTune: 64, fineTune: 64, chorusSend: 81, reverbSend: 116, patchName: 'Pluck Arp' });
    window.updatePartUI(5, { partLevel: 68, partPan: 52, coarseTune: 64, fineTune: 64, chorusSend: 0, reverbSend: 97, patchName: 'Air Bells' });
  });
  await page.waitForTimeout(200);

  // 5. Capture screenshot of the Performance Mixer Table
  const tableEl = await page.$('#partsTable');
  const screenshotPath = 'C:\\Users\\crjmc\\.gemini\\antigravity\\brain\\a4d4c31a-aff3-4886-ac22-5a7ea14db660\\performance_mixer_encoders.png';
  if (tableEl) {
    await tableEl.screenshot({ path: screenshotPath });
    console.log(`✓ Saved screenshot to ${screenshotPath}`);
  }

  await browser.close();
  if (errors.length > 0) {
    throw new Error(`Encountered page errors: ${errors.join(', ')}`);
  }
  console.log('=== All Mixer Encoder Verifications Passed! ===');
}

verifyMixerEncoders().catch(err => {
  console.error('Test Failed:', err);
  process.exit(1);
});
