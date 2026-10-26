import { chromium } from 'playwright';
import path from 'path';
import { fileURLToPath, pathToFileURL } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function testMatrixGrid() {
  console.log('--- Verifying Modulation Matrix Grid & Modern Synth Lab Roll-Up ---');

  const browser = await chromium.launch({
    executablePath: 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox']
  });

  const context = await browser.newContext({
    permissions: ['midi', 'midi-sysex']
  });
  const page = await context.newPage();

  page.on('pageerror', err => console.error('Page Error:', err));

  const indexUrl = pathToFileURL(path.resolve(__dirname, '../index.html')).href;
  console.log(`Loading ${indexUrl}...`);
  await page.goto(indexUrl, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(1000);

  // 1. Switch to Patch & Tones tab
  console.log('1. Switching to Patch & Tones tab...');
  await page.click('#tabPatch');
  await page.waitForTimeout(400);

  // 2. Verify Modern Synth Lab is rolled up (collapsed) by default
  console.log('2. Verifying Modern Synth Lab default roll-up state...');
  const rollupBodyDisplay = await page.$eval('#deepStudioRollupBody', el => window.getComputedStyle(el).display);
  const toggleBtnText = await page.$eval('#btnRollupToggleState', el => el.textContent.trim());
  console.log(`Synth Lab display: "${rollupBodyDisplay}", Toggle button text: "${toggleBtnText}"`);

  if (rollupBodyDisplay !== 'none') {
    throw new Error(`Expected Modern Synth Lab to be rolled up (display: none), got: "${rollupBodyDisplay}"`);
  }
  if (!toggleBtnText.includes('Expand')) {
    throw new Error(`Expected Toggle button to say "Expand", got: "${toggleBtnText}"`);
  }

  // 3. Verify Modulation Matrix Grid Table
  console.log('3. Checking Modulation Matrix Grid Table...');
  const table = await page.$('#matrixGridTable');
  if (!table) throw new Error('#matrixGridTable not found');

  // Verify Column Sources (M1 - M4)
  for (let m = 1; m <= 4; m++) {
    const srcSel = await page.$(`#matrix${m}Source`);
    if (!srcSel) throw new Error(`Missing source selector for Matrix ${m}`);
    const opts = await page.$$eval(`#matrix${m}Source option`, o => o.length);
    if (opts < 30) throw new Error(`Matrix ${m} source options count too low: ${opts}`);
  }
  console.log('✓ All 4 Matrix Sources (M1-M4) verified along the top.');

  // Verify Destination Rows (Row 1 - 4)
  for (let d = 1; d <= 4; d++) {
    const destSel = await page.$(`#matrixDestRow${d}`);
    if (!destSel) throw new Error(`Missing destination selector for Row ${d}`);
    const opts = await page.$$eval(`#matrixDestRow${d} option`, o => o.length);
    if (opts < 30) throw new Error(`Row ${d} destination options count too low: ${opts}`);
  }
  console.log('✓ All 4 Destination Rows verified on the left.');

  // Verify 16 Rotary Knobs (4x4 Grid)
  console.log('4. Verifying 16 Modulation Matrix Rotary Knobs (4x4 Grid)...');
  for (let m = 1; m <= 4; m++) {
    for (let d = 1; d <= 4; d++) {
      const knobEl = await page.$(`#matrixKnob_${m}_${d} .rotary-knob`);
      const valEl = await page.$(`#matrixKnob_${m}_${d} .rotary-knob-val, #matrixKnob_${m}_${d} .knob-value`);
      if (!knobEl || !valEl) {
        throw new Error(`Missing RotaryKnob in cell [M${m}, Dest${d}]`);
      }
    }
  }
  console.log('✓ All 16 Modulation Matrix knobs verified on the grid.');

  // Test adjusting M1 Dest 1 knob
  console.log('5. Testing adjustment of Matrix 1 Dest 1 knob...');
  const knob1_1 = await page.$('#matrixKnob_1_1 .rotary-knob');
  const box = await knob1_1.boundingBox();
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2 - 30);
  await page.mouse.up();
  await page.waitForTimeout(100);

  const valAfter = await page.$eval('#matrixKnob_1_1 .rotary-knob-val, #matrixKnob_1_1 .knob-value', el => el.textContent.trim());
  console.log(`M1 Dest 1 knob value after drag: ${valAfter}`);
  if (valAfter === '0') {
    throw new Error('Knob value did not change after drag');
  }

  // Test double-click reset to 0
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2, { clickCount: 2 });
  await page.waitForTimeout(100);
  const valReset = await page.$eval('#matrixKnob_1_1 .rotary-knob-val, #matrixKnob_1_1 .knob-value', el => el.textContent.trim());
  console.log(`M1 Dest 1 knob value after double-click reset: ${valReset}`);
  if (valReset !== '0') {
    throw new Error(`Expected reset to 0, got ${valReset}`);
  }

  // 6. Capture screenshot
  const screenshotPath = 'C:\\Users\\crjmc\\.gemini\\antigravity\\brain\\a4d4c31a-aff3-4886-ac22-5a7ea14db660\\modulation_matrix_grid_verified.png';
  await page.screenshot({ path: screenshotPath, fullPage: false });
  console.log(`Saved screenshot to ${screenshotPath}`);

  await browser.close();
  console.log('✅ ALL MATRIX GRID & SYNTH LAB ROLL-UP TESTS PASSED!');
}

testMatrixGrid().catch(err => {
  console.error('Fatal test error:', err);
  process.exit(1);
});

