import { chromium } from 'playwright';
import path from 'path';
import { fileURLToPath, pathToFileURL } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function captureBottom() {
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
  const indexUrl = pathToFileURL(path.resolve(__dirname, '../index.html')).href;
  await page.goto(indexUrl, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(600);

  await page.click('#tabPatch');
  await page.waitForTimeout(400);

  // Scroll to MFX and Chorus/Reverb
  await page.evaluate(() => {
    document.querySelector('#patchEffectsRollup')?.scrollIntoView();
  });
  await page.waitForTimeout(400);

  const fxScreenshot = 'C:\\Users\\crjmc\\.gemini\\antigravity\\brain\\a4d4c31a-aff3-4886-ac22-5a7ea14db660\\patch_fx_section_verified.png';
  await page.screenshot({ path: fxScreenshot, fullPage: false });

  // Scroll to Tone synthesis section
  await page.evaluate(() => {
    document.querySelector('.tone-modules-grid')?.scrollIntoView();
  });
  await page.waitForTimeout(400);

  const toneScreenshot = 'C:\\Users\\crjmc\\.gemini\\antigravity\\brain\\a4d4c31a-aff3-4886-ac22-5a7ea14db660\\patch_tone_synth_verified.png';
  await page.screenshot({ path: toneScreenshot, fullPage: false });

  await browser.close();
}
captureBottom();
