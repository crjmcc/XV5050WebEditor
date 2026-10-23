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
  await new Promise(r => setTimeout(r, 1500));

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

  // Verify Part 2 Instrument in 16 Parts Table
  const part2Name = await page.$eval('#partPatchName2', el => el.textContent);
  console.log(`11. Part 2 Instrument Name in Table: "${part2Name}"`);
  const part2DropdownOptions = await page.$$eval('#partPatchSelect2 option', opts => opts.length);
  console.log(`12. Part 2 Instrument Selector option count: ${part2DropdownOptions}`);

  // 13. Test clicking "🎛️ Tweak" on Part 2
  console.log('13. Testing "🎛️ Tweak" on Part 2...');
  await page.click('#partTweak2');
  await new Promise(r => setTimeout(r, 600));

  const isPatchTabActive = await page.$eval('#patchTab', el => el.classList.contains('active'));
  const activePartBadgeText = await page.$eval('#activePartBadge', el => el.textContent);
  const activeHeaderName = await page.$eval('#activePatchHeaderName', el => el.textContent);
  const stripBtn2Active = await page.$eval('#partStripBtn2', el => el.classList.contains('active'));
  console.log(`14. Tweak Part 2 Verification: TabActive=${isPatchTabActive}, Badge="${activePartBadgeText}", HeaderName="${activeHeaderName}", StripBtn2Active=${stripBtn2Active}`);

  // 15. Verify Instrument Selector on Patch & Tones Tab
  const patchInstCount = await page.$$eval('#patchInstrumentSelect option', opts => opts.length);
  console.log(`15. Patch & Tones Instrument Selector option count: ${patchInstCount}`);

  // 16. Test "⬡ Back to Mixer" button
  console.log('16. Clicking "⬡ Back to Mixer" button...');
  await page.click('#btnBackToPerfMixer');
  await new Promise(r => setTimeout(r, 500));
  const isPerfTabActive = await page.$eval('#performanceTab', el => el.classList.contains('active'));
  console.log(`17. Returned to Performance Mixer: TabActive=${isPerfTabActive}`);

  // 18. Test LocalStorage Persistence across Page Reload
  console.log('18. Testing LocalStorage persistence across page reload...');
  await page.reload();
  await new Promise(r => setTimeout(r, 1200));

  const reloadedUserPatchCount = await page.$$eval('#userPatchSelect option', opts => opts.length);
  const reloadedPart2Name = await page.$eval('#partPatchName2', el => el.textContent);
  const reloadedStripCount = await page.$$eval('.part-strip-btn', btns => btns.length);
  console.log(`19. Post-Reload Verification: UserPatches=${reloadedUserPatchCount}, Part2Name="${reloadedPart2Name}", PartStripButtons=${reloadedStripCount}`);

  // Take screenshot of fully synchronized web editor
  const screenshotPath = path.resolve(__dirname, 'full_unit_sync_result.png');
  await page.screenshot({ path: screenshotPath, fullPage: false });
  console.log(`20. Verification screenshot captured: ${screenshotPath}`);

  await browser.close();
  console.log('--- E2E Hardware Browser Test Completed Successfully ---');
}

run().catch(console.error);
