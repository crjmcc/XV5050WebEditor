import { chromium } from 'playwright';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function run() {
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

  // Check that tvfFilterDrive and tvfWaveGain exist
  const tvfFilterDrive = await page.$('#tvfFilterDrive');
  const tvfWaveGain = await page.$('#tvfWaveGain');
  if (!tvfFilterDrive || !tvfWaveGain) {
    throw new Error('tvfFilterDrive or tvfWaveGain not found in DOM');
  }
  console.log('Found tvfFilterDrive and tvfWaveGain elements');

  // Verify initial values
  const initDrive = await page.$eval('#tvfFilterDrive', el => el.value);
  const initWaveGain = await page.$eval('#tvfWaveGain', el => el.value);
  console.log(`Initial values: Drive = ${initDrive}, WaveGain = ${initWaveGain}`);

  // Test selecting Warm Drive (+6 dB -> value "1")
  await page.selectOption('#tvfFilterDrive', '1');
  const booster12Val = await page.$eval('#booster12', el => el.value);
  const struct12Val = await page.$eval('#struct12', el => el.value);
  console.log(`After selecting +6 dB drive on Tone 1: booster12 = ${booster12Val}, struct12 = ${struct12Val}`);
  if (booster12Val !== '1') throw new Error(`Expected booster12 to be 1, got ${booster12Val}`);
  // Structure should have auto-upgraded to a boosted structure (e.g. type 4 / index 3)
  if (struct12Val !== '3') throw new Error(`Expected struct12 to be auto-upgraded to 3, got ${struct12Val}`);

  // Test selecting Wave Gain (+12 dB -> value "3")
  await page.selectOption('#tvfWaveGain', '3');
  const waveGainVal = await page.$eval('#waveGain', el => el.value);
  console.log(`After selecting +12 dB Wave Gain: waveGain = ${waveGainVal}`);
  if (waveGainVal !== '3') throw new Error(`Expected waveGain to be 3, got ${waveGainVal}`);

  // Test Master Link
  await page.click('#btnSelectToneAll');
  await page.waitForTimeout(100);
  await page.selectOption('#tvfFilterDrive', '2'); // Crunch Drive +12 dB
  const b12 = await page.$eval('#booster12', el => el.value);
  const b34 = await page.$eval('#booster34', el => el.value);
  console.log(`After Master Link Drive change: booster12 = ${b12}, booster34 = ${b34}`);
  if (b12 !== '2' || b34 !== '2') throw new Error(`Expected both boosters to be 2, got ${b12}, ${b34}`);

  // Capture screenshot of the TVF card
  const tvfCard = await page.$('.synth-module-card:has(#toneFilterType)');
  if (tvfCard) {
    await tvfCard.screenshot({
      path: 'C:/Users/crjmc/.gemini/antigravity/brain/a4d4c31a-aff3-4886-ac22-5a7ea14db660/tvf_filter_drive_controls_verified.png'
    });
    console.log('Saved TVF card screenshot');
  }

  console.log('ALL TVF FILTER DRIVE TESTS PASSED!');
  await browser.close();
}

run().catch(err => {
  console.error(err);
  process.exit(1);
});
