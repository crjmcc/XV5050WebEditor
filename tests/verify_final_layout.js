import { chromium } from 'playwright';

async function verify() {
  const browser = await chromium.launch({
    executablePath: 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    headless: true
  });
  const page = await browser.newPage({ viewport: { width: 1400, height: 1100 } });
  await page.goto('file:///C:/chris2026/XV5050WebEditor/index.html');

  // 1. Capture Performance Tab Header
  const perfHeader = await page.$('#performanceTab .card .card-header');
  if (perfHeader) {
    await perfHeader.screenshot({
      path: 'C:/Users/crjmc/.gemini/antigravity/brain/a4d4c31a-aff3-4886-ac22-5a7ea14db660/perf_header_verified.png'
    });
    console.log('Saved perf_header_verified.png');
  }

  // 2. Switch to Patch Tab and capture Tone Modules Grid
  await page.click('button[data-tab="patch"]');
  await page.waitForTimeout(300);

  const grid = await page.$('.tone-modules-grid');
  if (grid) {
    await grid.screenshot({
      path: 'C:/Users/crjmc/.gemini/antigravity/brain/a4d4c31a-aff3-4886-ac22-5a7ea14db660/tone_modules_verified.png'
    });
    console.log('Saved tone_modules_verified.png');
  }

  await browser.close();
}

verify().catch(console.error);

