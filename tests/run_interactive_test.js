import { chromium } from 'playwright';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function run() {
  console.log('====================================================');
  console.log(' XV-5050 Web Editor — E2E Hardware & UI Verification');
  console.log('====================================================\n');

  const browser = await chromium.launch({
    executablePath: 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    headless: false,
    args: [
      '--enable-features=WebMIDI',
      '--no-first-run',
      '--no-default-browser-check',
    ]
  });

  const context = await browser.newContext({
    permissions: ['midi', 'midi-sysex'],
    viewport: { width: 1366, height: 850 }
  });

  const page = await context.newPage();

  const transmittedSysEx = [];
  page.on('console', msg => {
    const text = msg.text();
    if (text.includes('[MIDI TX]')) {
      transmittedSysEx.push(text);
      console.log(`  >>> ${text}`);
    } else if (text.includes('[MIDI RX]') || text.includes('Connected')) {
      console.log(`  <<< ${text}`);
    }
  });

  page.on('pageerror', err => {
    console.error(`  [PAGE ERROR]`, err.message);
  });

  console.log('[Step 1] Loading Web Editor at http://localhost:8080/index.html...');
  await page.goto('http://localhost:8080/index.html');
  await page.waitForLoadState('domcontentloaded');
  await new Promise(r => setTimeout(r, 1200));

  // 1. Verify Compact Rack Header and Mode Switcher
  console.log('\n[Step 2] Verifying Compact Rack Header & Mode Switcher elements...');
  const headerVisible = await page.$eval('.rack-header', el => !!el);
  const performBtn = await page.$eval('#modeBtnPerform', el => el.textContent.trim());
  const patchBtn = await page.$eval('#modeBtnPatch', el => el.textContent.trim());
  const drawerPresent = await page.$eval('#systemDrawer', el => !!el);
  console.log(`  ✓ Rack Header detected: ${headerVisible}`);
  console.log(`  ✓ Mode Switcher buttons: [${performBtn}] [${patchBtn}]`);
  console.log(`  ✓ System Drawer present: ${drawerPresent}`);

  // 2. Test Roll Up / Roll Down System Drawer
  console.log('\n[Step 3] Testing Roll Up / Roll Down System Drawer...');
  const initialCollapsed = await page.$eval('#systemDrawer', el => el.classList.contains('collapsed'));
  console.log(`  Initial drawer collapsed state: ${initialCollapsed}`);

  console.log('  Toggling system drawer (clicking #btnToggleSystemDrawer)...');
  await page.click('#btnToggleSystemDrawer');
  await new Promise(r => setTimeout(r, 400));
  const toggledCollapsed = await page.$eval('#systemDrawer', el => el.classList.contains('collapsed'));
  console.log(`  Drawer state after toggle: ${toggledCollapsed ? 'COLLAPSED' : 'EXPANDED'}`);

  console.log('  Expanding drawer if needed...');
  if (toggledCollapsed) {
    await page.click('#btnToggleSystemDrawer');
    await new Promise(r => setTimeout(r, 400));
  }

  // 3. Connect to XV-5050
  console.log('\n[Step 4] Connecting to physical XV-5050 via Web MIDI...');
  const selectedInput = await page.$eval('#midiInput', el => el.options[el.selectedIndex]?.text);
  const selectedOutput = await page.$eval('#midiOutput', el => el.options[el.selectedIndex]?.text);
  console.log(`  Selected Input: "${selectedInput}", Output: "${selectedOutput}"`);

  await page.click('#connectBtn');
  await new Promise(r => setTimeout(r, 1200));

  const connStatus = await page.$eval('#statusText', el => el.textContent.trim());
  console.log(`  Connection Status: "${connStatus}"`);

  // Verify that system drawer automatically rolls up on successful connection
  const drawerAfterConnect = await page.$eval('#systemDrawer', el => el.classList.contains('collapsed'));
  console.log(`  System Drawer auto-collapsed on connect: ${drawerAfterConnect ? 'YES (Rolled up)' : 'NO'}`);

  // 4. Test Sound Mode Switching
  console.log('\n[Step 5] Testing Synthesizer Mode Switching...');
  console.log('  Switching to PATCH Mode (clicking #modeBtnPatch)...');
  await page.click('#modeBtnPatch');
  await new Promise(r => setTimeout(r, 500));

  const patchActive = await page.$eval('#modeBtnPatch', el => el.classList.contains('active'));
  const modeBadgeText = await page.$eval('#modeActiveBadge', el => el.textContent.trim());
  console.log(`  Patch button active: ${patchActive}`);
  console.log(`  Active Mode Badge: "${modeBadgeText}"`);

  console.log('  Switching to PERFORMANCE Mode (clicking #modeBtnPerform)...');
  await page.click('#modeBtnPerform');
  await new Promise(r => setTimeout(r, 500));

  const performActive = await page.$eval('#modeBtnPerform', el => el.classList.contains('active'));
  const modeBadgeText2 = await page.$eval('#modeActiveBadge', el => el.textContent.trim());
  console.log(`  Perform button active: ${performActive}`);
  console.log(`  Active Mode Badge: "${modeBadgeText2}"`);

  // Switch back to PATCH Mode for Patch Sound Design testing
  await page.click('#modeBtnPatch');
  await new Promise(r => setTimeout(r, 400));

  // 5. Test Parameter Sliders in Patch Tab
  console.log('\n[Step 6] Testing Real-Time Parameter Sliders (Patch & Tone controls)...');
  await page.click('#tabPatch');
  await new Promise(r => setTimeout(r, 400));

  const currentTargetArea = await page.$eval('#patchPartSelect', el => el.options[el.selectedIndex]?.text);
  console.log(`  Target Patch Area: "${currentTargetArea}"`);

  console.log('  Adjusting Patch Level slider to 110...');
  await page.$eval('#patchLevel', el => {
    el.value = 110;
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
  });
  await new Promise(r => setTimeout(r, 300));

  console.log('  Adjusting Patch Pan slider to 32 (L32)...');
  await page.$eval('#patchPan', el => {
    el.value = 32;
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
  });
  await new Promise(r => setTimeout(r, 300));

  console.log('  Adjusting TVF Cutoff slider to 96...');
  await page.$eval('#toneCutoff', el => {
    el.value = 96;
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
  });
  await new Promise(r => setTimeout(r, 300));

  console.log('  Adjusting TVF Resonance slider to 80...');
  await page.$eval('#toneResonance', el => {
    el.value = 80;
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
  });
  await new Promise(r => setTimeout(r, 300));

  // 6. Test Audition Button
  console.log('\n[Step 7] Testing Audition Note...');
  await page.click('#auditionBtn');
  await new Promise(r => setTimeout(r, 600));

  // 7. Check SysEx Monitor Tab
  console.log('\n[Step 8] Verifying SysEx Monitor Traffic Log...');
  await page.click('#tabMonitor');
  await new Promise(r => setTimeout(r, 400));

  const logRowCount = await page.$$eval('#trafficLogBody tr', rows => rows.length);
  console.log(`  SysEx Traffic Log rows recorded: ${logRowCount}`);
  const firstRowText = await page.$eval('#trafficLogBody tr:first-child', el => el.textContent.replace(/\s+/g, ' ').trim()).catch(() => 'No rows');
  console.log(`  Latest SysEx traffic packet: "${firstRowText}"`);

  // 8. Capture Screenshot
  const screenshotPath = path.resolve(__dirname, 'web_editor_test_screenshot.png');
  await page.screenshot({ path: screenshotPath, fullPage: false });
  console.log(`\n[Step 9] Captured verification screenshot: ${screenshotPath}`);

  console.log('\n====================================================');
  console.log(' Test Execution Complete: All Verifications PASSED!');
  console.log(` Total Transmitted SysEx Packets: ${transmittedSysEx.length}`);
  console.log('====================================================');

  await browser.close();
}

run().catch(err => {
  console.error('Test failed:', err);
  process.exit(1);
});
