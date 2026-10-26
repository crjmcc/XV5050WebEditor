import { chromium } from 'playwright';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function run() {
  const browser = await chromium.launch({
    executablePath: 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    headless: true
  });
  const page = await browser.newPage({ viewport: { width: 1400, height: 1100 } });
  const indexPath = 'file:///' + path.resolve(__dirname, '../index.html').replace(/\\/g, '/');
  await page.goto(indexPath);
  await page.click('button[data-tab="patch"]');

  // Capture current layout
  const grid = await page.$('.tone-modules-grid');
  await grid.screenshot({ path: 'C:/Users/crjmc/.gemini/antigravity/brain/a4d4c31a-aff3-4886-ac22-5a7ea14db660/layout_before.png' });

  // Option 1: TVF full width, TVA and Pitch on row 2, LFO full width
  await page.evaluate(() => {
    const cards = document.querySelectorAll('.tone-modules-grid .synth-module-card');
    // cards[0]: TVF
    // cards[1]: TVA
    // cards[2]: Pitch
    // cards[3]: LFO
    cards[0].style.gridColumn = '1 / -1';
    cards[1].style.gridColumn = '1 / 2';
    cards[2].style.gridColumn = '2 / 3';
    cards[3].style.gridColumn = '1 / -1';
  });

  await grid.screenshot({ path: 'C:/Users/crjmc/.gemini/antigravity/brain/a4d4c31a-aff3-4886-ac22-5a7ea14db660/layout_option1_tvf_full.png' });

  // Option 2: TVF & LFO row 1, TVA & Pitch row 2
  await page.evaluate(() => {
    const cards = document.querySelectorAll('.tone-modules-grid .synth-module-card');
    cards[0].style.gridColumn = '1 / 2'; // TVF
    cards[3].style.gridColumn = '2 / 3'; // LFO
    cards[1].style.gridColumn = '1 / 2'; // TVA
    cards[2].style.gridColumn = '2 / 3'; // Pitch

    // Reorder DOM so LFO is second, TVA is third, Pitch is fourth
    const container = document.querySelector('.tone-modules-grid');
    container.appendChild(cards[0]); // TVF
    container.appendChild(cards[3]); // LFO
    container.appendChild(cards[1]); // TVA
    container.appendChild(cards[2]); // Pitch
  });

  await grid.screenshot({ path: 'C:/Users/crjmc/.gemini/antigravity/brain/a4d4c31a-aff3-4886-ac22-5a7ea14db660/layout_option2_tvf_lfo_then_tva_pitch.png' });

  console.log('Saved layout comparison screenshots');
  await browser.close();
}

run();

