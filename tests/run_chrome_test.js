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
    if (text.includes('[MIDI') || text.includes('[SysEx') || text.includes('Error') || text.includes('Connected')) {
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

  // Click "Load Performance Common" (loads current performance name and common params)
  console.log('5. Clicking "↓ Common" button to read Performance Common from hardware...');
  await page.click('#loadPerfBtn');
  await new Promise(r => setTimeout(r, 1500));

  const perfName = await page.$eval('#perfName', el => el.value);
  console.log(`6. Loaded Performance Name from physical XV-5050: "${perfName}"`);

  // Run USB Hardware Diagnostics Suite (all 6 hardware checks)
  console.log('7. Running USB Hardware Diagnostics Suite...');
  await page.click('#btnRunDiagnostics');
  await new Promise(r => setTimeout(r, 3000));

  // Close diagnostics modal
  await page.click('#closeDiagBtn');
  await new Promise(r => setTimeout(r, 400));

  // Test "Sync with Unit" button
  console.log('10. Testing "⇄ Sync with Unit" button...');
  await page.click('#syncWithUnitBtn');

  // If confirm modal appears, click proceed
  const confirmVisible = await page.$eval('#confirmSyncModal', el => el.style.display !== 'none');
  if (confirmVisible) {
    console.log('   Confirm modal appeared, clicking proceed...');
    await page.click('#proceedSyncBtn');
  }

  // Monitor progress modal
  console.log('11. Monitoring Full Unit Sync progress...');
  for (let i = 0; i < 15; i++) {
    await new Promise(r => setTimeout(r, 1000));
    const detail = await page.$eval('#syncProgressDetail', el => el.textContent).catch(() => '');
    const progressModal = await page.$eval('#syncProgressModal', el => el.style.display !== 'none').catch(() => false);
    console.log(`    Sync Progress (${i + 1}s): "${detail}" (Modal active: ${progressModal})`);
    if (!progressModal && i > 3) {
      console.log('    Sync complete! Progress modal closed.');
      break;
    }
  }

  const finalPerfName = await page.$eval('#perfName', el => el.value);
  console.log(`12. UI Performance Name after Sync: "${finalPerfName}"`);

  await browser.close();
  console.log('--- E2E Hardware Browser Test Completed Successfully ---');
}

run().catch(console.error);
