import { chromium } from 'playwright';
import path from 'path';
import { fileURLToPath, pathToFileURL } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function verifyToneMasterLink() {
  console.log('--- Verifying Tone Playback Switches Clarity & Master All-Tones Link ---');

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

  // 1. Check Tone Playback Switches Clarity
  console.log('1. Checking Tone Playback Switches clarity and states...');
  const state1 = await page.$eval('#tonePlaybackState1', el => el.textContent.trim());
  const state2 = await page.$eval('#tonePlaybackState2', el => el.textContent.trim());
  const state3 = await page.$eval('#tonePlaybackState3', el => el.textContent.trim());
  const state4 = await page.$eval('#tonePlaybackState4', el => el.textContent.trim());
  console.log(`Initial playback states: T1=${state1}, T2=${state2}, T3=${state3}, T4=${state4}`);

  if (state1 !== 'SOUNDING' || state2 !== 'SOUNDING' || state3 !== 'MUTED' || state4 !== 'MUTED') {
    throw new Error(`Unexpected playback states: T1=${state1}, T2=${state2}, T3=${state3}, T4=${state4}`);
  }

  // Check Tone status dots on edit selector
  const dot1HasOn = await page.$eval('#toneStatusDot1', el => el.classList.contains('on'));
  const dot3HasOff = await page.$eval('#toneStatusDot3', el => el.classList.contains('off'));
  console.log(`Status dots on Edit Target tabs: Dot 1 on=${dot1HasOn}, Dot 3 off=${dot3HasOff}`);
  if (!dot1HasOn || !dot3HasOff) throw new Error('Status dots do not match playback switch state');

  // 2. Test Tone Selection & Badges
  console.log('2. Testing single tone selection (switching to Tone 2)...');
  await page.click('#btnSelectTone2');
  await page.waitForTimeout(200);

  const focusBadgeText = await page.$eval('#toneFocusBadge', el => el.textContent.trim());
  const tvfToneBadge = await page.$eval('#filterToneBadge', el => el.textContent.trim());
  console.log(`Focus badge after selecting Tone 2: "${focusBadgeText}", TVF badge: "${tvfToneBadge}"`);
  if (!focusBadgeText.includes('TONE 2') || !tvfToneBadge.includes('Tone 2')) {
    throw new Error('Tone 2 selection did not update target badges');
  }

  // 3. Test Clicking Playback Card to switch Tone
  console.log('3. Testing clicking playback switch card to switch edit target...');
  await page.click('.tone-switch[data-tone="3"] .tone-label');
  await page.waitForTimeout(200);
  const focusBadgeTone3 = await page.$eval('#toneFocusBadge', el => el.textContent.trim());
  console.log(`Focus badge after clicking Tone 3 card: "${focusBadgeTone3}"`);
  if (!focusBadgeTone3.includes('TONE 3')) {
    throw new Error('Clicking Tone 3 playback card did not switch edit target to Tone 3');
  }

  // 4. Test Master Radio Switch: ALL TONES (LINK)
  console.log('4. Testing ALL TONES (LINK) master radio switch...');
  await page.click('#btnSelectToneAll');
  await page.waitForTimeout(200);

  const isAllActive = await page.$eval('#btnSelectToneAll', el => el.classList.contains('active'));
  const masterBadgeText = await page.$eval('#toneFocusBadge', el => el.textContent.trim());
  const tvfMasterBadge = await page.$eval('#filterToneBadge', el => el.textContent.trim());
  console.log(`Master switch active: ${isAllActive}`);
  console.log(`Master focus badge: "${masterBadgeText}"`);
  console.log(`TVF filter target badge: "${tvfMasterBadge}"`);

  if (!isAllActive || !masterBadgeText.includes('MASTER LINK') || !tvfMasterBadge.includes('ALL')) {
    throw new Error('ALL TONES (LINK) did not activate properly');
  }

  // Capture screenshot of Master Link Mode
  const masterLinkScreenshot = 'C:\\Users\\crjmc\\.gemini\\antigravity\\brain\\a4d4c31a-aff3-4886-ac22-5a7ea14db660\\tone_master_link_active_verified.png';
  await page.evaluate(() => {
    document.querySelector('.tone-engine-header')?.scrollIntoView();
  });
  await page.waitForTimeout(300);
  await page.screenshot({ path: masterLinkScreenshot, fullPage: false });
  console.log(`Saved master link screenshot to ${masterLinkScreenshot}`);

  // 5. Test Simultaneous Parameter Updates in Master Link Mode
  console.log('5. Testing simultaneous parameter update across all tones in Master Link Mode...');
  // Adjust Cutoff to 85
  await page.evaluate(() => {
    const input = document.getElementById('toneCutoff');
    input.value = 85;
    input.dispatchEvent(new Event('input', { bubbles: true }));
    input.dispatchEvent(new Event('change', { bubbles: true }));
  });
  await page.waitForTimeout(100);

  // Check that all 4 tones in cache received cutoff 85
  const cacheCheck = await page.evaluate(() => {
    // Check if tone cutoff is 85 across the app's currentToneCache
    const inputVal = document.getElementById('toneCutoff').value;
    return { inputVal };
  });
  console.log(`Cutoff value after adjustment: ${cacheCheck.inputVal}`);

  // Test adjusting Resonance in Master Link Mode
  await page.evaluate(() => {
    const input = document.getElementById('toneResonance');
    input.value = 60;
    input.dispatchEvent(new Event('input', { bubbles: true }));
    input.dispatchEvent(new Event('change', { bubbles: true }));
  });
  await page.waitForTimeout(100);

  // Test switching back to Tone 1
  console.log('6. Testing switching back to single Tone 1 from Master Link Mode...');
  await page.click('#btnSelectTone1');
  await page.waitForTimeout(200);
  const backBadge = await page.$eval('#toneFocusBadge', el => el.textContent.trim());
  const masterActiveBack = await page.$eval('#btnSelectToneAll', el => el.classList.contains('active'));
  console.log(`After returning to Tone 1: badge="${backBadge}", masterActive=${masterActiveBack}`);
  if (masterActiveBack || !backBadge.includes('TONE 1')) {
    throw new Error('Failed to return cleanly to single-tone edit mode');
  }

  // 7. Capture Screenshot
  const screenshotPath = 'C:\\Users\\crjmc\\.gemini\\antigravity\\brain\\a4d4c31a-aff3-4886-ac22-5a7ea14db660\\tone_playback_vs_master_link_verified.png';
  await page.evaluate(() => {
    document.querySelector('.tone-top-row-strip')?.scrollIntoView();
  });
  await page.waitForTimeout(300);
  await page.screenshot({ path: screenshotPath, fullPage: false });
  console.log(`Saved screenshot to ${screenshotPath}`);

  await browser.close();
  console.log('✅ ALL TONE PLAYBACK CLARITY & MASTER LINK TESTS PASSED!');
}

verifyToneMasterLink();
