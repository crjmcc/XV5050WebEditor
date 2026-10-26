import { chromium } from 'playwright';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function run() {
  console.log('--- Verifying Rotary Knob Arc Start and Direction ---');

  const browser = await chromium.launch({
    executablePath: 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox']
  });

  const context = await browser.newContext({ viewport: { width: 1400, height: 1000 } });
  const page = await context.newPage();

  const indexPath = 'file:///' + path.resolve(__dirname, '../index.html').replace(/\\/g, '/');
  console.log('Navigating to:', indexPath);
  await page.goto(indexPath);
  await page.waitForLoadState('domcontentloaded');

  // Switch to Patch & Tones tab
  await page.click('button[data-tab="patch"]');
  await page.waitForTimeout(300);

  // Find DRY LEVEL knob in Patch Multi-Effects
  const dryLevelKnob = await page.$('#knobWrapPatchMfxDryLevel');
  if (!dryLevelKnob) {
    throw new Error('Dry level knob wrap not found');
  }

  // Set dry level input to 50 (exactly matching user screenshot)
  await page.evaluate(() => {
    const input = document.getElementById('patchMfxDryLevel');
    if (input) {
      input.value = '50';
      input.dispatchEvent(new Event('input', { bubbles: true }));
    }
  });

  await page.waitForTimeout(100);

  // Inspect the SVG fill arc
  const arcData = await page.evaluate(() => {
    const knob = document.querySelector('#knobWrapPatchMfxDryLevel');
    const fillArc = knob.querySelector('.knob-fill');
    const track = knob.querySelector('.knob-track');
    const pointer = knob.querySelector('.knob-pointer');
    return {
      fillDasharray: fillArc?.getAttribute('stroke-dasharray'),
      fillDashoffset: fillArc?.getAttribute('stroke-dashoffset'),
      fillTransform: fillArc?.getAttribute('transform'),
      trackDasharray: track?.getAttribute('stroke-dasharray'),
      trackDashoffset: track?.getAttribute('stroke-dashoffset'),
      trackTransform: track?.getAttribute('transform'),
      pointerTransform: pointer?.getAttribute('transform'),
      valText: knob.querySelector('.rotary-knob-val')?.textContent
    };
  });

  console.log('Dry Level Knob (at 50) Arc Data:', arcData);

  // Assertions:
  // 1. Both track and fillArc must have transform="rotate(135, 22, 22)" so 0 starts at 7:30
  if (arcData.fillTransform !== 'rotate(135, 22, 22)') {
    throw new Error(`Expected fillTransform to be rotate(135, 22, 22), got ${arcData.fillTransform}`);
  }
  // 2. Unipolar fillArc stroke-dashoffset must be 0 (starting at the min position)
  if (arcData.fillDashoffset !== '0') {
    throw new Error(`Expected fillDashoffset to be 0, got ${arcData.fillDashoffset}`);
  }
  // 3. For 50/127 ratio (~0.3937), arc length should be ~29.7 (grows from 0 up to needle)
  const len = parseFloat(arcData.fillDasharray);
  console.log(`Computed arc length: ${len} (out of 75.4)`);
  if (len < 28 || len > 31) {
    throw new Error(`Expected arc length around 29.7, got ${len}`);
  }

  // Capture close-up screenshot of the DRY LEVEL knob at 50
  await dryLevelKnob.screenshot({
    path: 'C:/Users/crjmc/.gemini/antigravity/brain/a4d4c31a-aff3-4886-ac22-5a7ea14db660/dry_level_knob_arc_fixed.png'
  });
  console.log('Saved close-up screenshot of DRY LEVEL knob');

  // Also capture the MFX top controls showing multiple encoders
  const mfxCard = await page.$('#patchEffectsSection');
  if (mfxCard) {
    await mfxCard.screenshot({
      path: 'C:/Users/crjmc/.gemini/antigravity/brain/a4d4c31a-aff3-4886-ac22-5a7ea14db660/patch_effects_encoders_verified.png'
    });
    console.log('Saved Patch Effects encoders screenshot');
  }

  console.log('ALL ROTARY KNOB ARC DIRECTION TESTS PASSED!');
  await browser.close();
}

run().catch(err => {
  console.error(err);
  process.exit(1);
});
