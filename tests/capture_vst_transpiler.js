import { chromium } from 'playwright';
import path from 'path';
import { fileURLToPath, pathToFileURL } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function capture() {
  const browser = await chromium.launch({
    executablePath: 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox']
  });

  const context = await browser.newContext({
    viewport: { width: 1400, height: 950 },
    permissions: ['midi', 'midi-sysex']
  });

  const page = await context.newPage();
  const indexUrl = pathToFileURL(path.resolve(__dirname, '../index.html')).href;
  await page.goto(indexUrl, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(1000);

  // 1. Go to Librarian Tab & select Cyberpunk Reese demo
  await page.click('#tabLibrarian');
  await page.waitForTimeout(300);

  await page.selectOption('#vstDemoPresetSelect', 'vital_cyberpunk_reese');
  await page.waitForTimeout(300);

  const cardElement = await page.$('#vstTranspilerCard');
  if (cardElement) {
    await cardElement.screenshot({ path: path.resolve(__dirname, '../vst_transpiler_card.png') });
    console.log('Saved vst_transpiler_card.png');
  }

  // 2. Load into Patch Editor
  await page.click('#btnLoadTranspiledPatch');
  await page.waitForTimeout(500);

  await page.screenshot({ path: path.resolve(__dirname, '../patch_editor_transpiled.png'), fullPage: false });
  console.log('Saved patch_editor_transpiled.png');

  await browser.close();
}

capture().catch(console.error);

