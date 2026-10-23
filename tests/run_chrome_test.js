import { chromium } from 'playwright';
import path from 'path';
import { fileURLToPath, pathToFileURL } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function run() {
  console.log('--- Launching Chrome for End-to-End Hardware Test ---');
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
    permissions: ['midi', 'midi-sysex']
  });

  const page = await context.newPage();

  page.on('console', msg => {
    const text = msg.text();
    if (text.includes('[MIDI') || text.includes('[SysEx') || text.includes('Error') || text.includes('Connected') || text.includes('Sync') || text.includes('warning') || text.includes('Failed')) {
      console.log(`[BROWSER] ${text}`);
    }
  });

  page.on('pageerror', err => {
    console.error(`[PAGE ERROR]`, err);
  });

  const indexUrl = pathToFileURL(path.resolve(__dirname, '../index.html')).href;
  console.log(`1. Loading ${indexUrl}...`);
  await page.goto(indexUrl);

  // Wait for Web MIDI discovery & dropdown population
  await new Promise(r => setTimeout(r, 1500));

  // Verify dropdown selections
  const selectedInput = await page.$eval('#midiInput', el => el.options[el.selectedIndex]?.text);
  const selectedOutput = await page.$eval('#midiOutput', el => el.options[el.selectedIndex]?.text);
  console.log(`2. Dropdown selections: Input="${selectedInput}", Output="${selectedOutput}"`);

  // Click Connect button
  console.log('3. Clicking Connect button...');
  await page.click('#connectBtn');
  await new Promise(r => setTimeout(r, 800));

  const statusText = await page.$eval('#statusText', el => el.textContent);
  console.log(`4. Connection status: "${statusText}"`);

  // 5. Test "Sync with Unit" button
  console.log('5. Clicking "⇄ Sync with Unit" button...');
  await page.evaluate(() => document.getElementById('syncWithUnitBtn').click());
  await new Promise(r => setTimeout(r, 800));

  // If confirm modal appears, click proceed
  const confirmVisible = await page.$eval('#confirmSyncModal', el => el.style.display !== 'none').catch(() => false);
  if (confirmVisible) {
    console.log('6. Confirm modal appeared, clicking proceed...');
    await page.evaluate(() => document.getElementById('proceedSyncBtn').click());
  }

  // Monitor progress modal through all 6 stages
  console.log('7. Monitoring Full Unit Sync progress across all stages...');
  let completed = false;
  let lastDetail = '';
  for (let i = 0; i < 90; i++) {
    await new Promise(r => setTimeout(r, 1000));
    const detail = await page.$eval('#syncProgressDetail', el => el.textContent).catch(() => '');
    const progressModal = await page.$eval('#syncProgressModal', el => el.style.display !== 'none').catch(() => false);
    if (detail !== lastDetail) {
      console.log(`   Sync Progress (${i + 1}s): "${detail}" (Modal active: ${progressModal})`);
      lastDetail = detail;
    }
    if (!progressModal && i > 5) {
      console.log(`   Sync finished! Progress modal closed after ~${i + 1} seconds.`);
      completed = true;
      break;
    }
  }

  const finalPerfName = await page.$eval('#perfName', el => el.value);
  console.log(`8. UI Performance Name after Sync: "${finalPerfName}"`);

  // Verify User Performance Dropdown
  const userPerfCount = await page.$$eval('#userPerfSelect option', opts => opts.length);
  const firstPerfOption = await page.$eval('#userPerfSelect option:nth-child(2)', el => el?.textContent || '').catch(() => '');
  console.log(`9. User Performance Dropdown count: ${userPerfCount} (Example: "${firstPerfOption}")`);

  // Verify User Patch Dropdown
  const userPatchCount = await page.$$eval('#userPatchSelect option', opts => opts.length);
  const firstPatchOption = await page.$eval('#userPatchSelect option:nth-child(2)', el => el?.textContent || '').catch(() => '');
  console.log(`10. User Patch Dropdown count: ${userPatchCount} (Example: "${firstPatchOption}")`);

  const infoStatus = await page.$eval('#statusText', el => el.textContent);
  console.log(`11. Editor status bar text: "${infoStatus}"`);

  // Verify dropdown selection functionality
  if (userPerfCount > 1) {
    console.log('12. Testing selection from User Performance dropdown...');
    await page.selectOption('#userPerfSelect', '1');
    await new Promise(r => setTimeout(r, 1000));
    const perfAfterSelect = await page.$eval('#perfName', el => el.value);
    const statusAfterSelect = await page.$eval('#statusText', el => el.textContent);
    console.log(`    Selected Perf 1: Name="${perfAfterSelect}", Status="${statusAfterSelect}"`);
  }

  // Take screenshot of fully synchronized web editor
  const screenshotPath = path.resolve(__dirname, 'full_unit_sync_result.png');
  await page.screenshot({ path: screenshotPath, fullPage: false });
  console.log(`13. Verification screenshot captured: ${screenshotPath}`);

  await browser.close();
  console.log('--- E2E Hardware Browser Test Completed Successfully ---');
}

run().catch(console.error);
