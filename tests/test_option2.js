import { chromium } from 'playwright';

async function run() {
  const browser = await chromium.launch({
    executablePath: 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    headless: true
  });
  const page = await browser.newPage({ viewport: { width: 1400, height: 1100 } });
  await page.goto('file:///C:/chris2026/XV5050WebEditor/index.html');
  await page.click('button[data-tab="patch"]');

  await page.evaluate(() => {
    const cards = document.querySelectorAll('.tone-modules-grid .synth-module-card');
    const container = document.querySelector('.tone-modules-grid');
    // Reorder: TVF (0), LFO (3), TVA (1), Pitch (2)
    container.appendChild(cards[0]); // TVF
    container.appendChild(cards[3]); // LFO
    container.appendChild(cards[1]); // TVA
    container.appendChild(cards[2]); // Pitch
  });

  const grid = await page.$('.tone-modules-grid');
  await grid.screenshot({
    path: 'C:/Users/crjmc/.gemini/antigravity/brain/a4d4c31a-aff3-4886-ac22-5a7ea14db660/tone_modules_tva_pitch_same_line.png'
  });

  console.log('Saved screenshot of tone modules with TVA and Pitch on the same line');
  await browser.close();
}

run();

