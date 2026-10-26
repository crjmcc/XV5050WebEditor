import { chromium } from 'playwright';

(async () => {
  const browser = await chromium.launch({
    executablePath: 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox']
  });
  const page = await browser.newPage({ viewport: { width: 1280, height: 950 } });
  await page.goto('file:///C:/chris2026/XV5050WebEditor/index.html');
  await page.click('button[data-tab="patch"]');
  await page.waitForTimeout(300);

  // Scroll envelopes module into view
  const modulesGrid = await page.$('.tone-modules-grid');
  if (modulesGrid) {
    await modulesGrid.scrollIntoViewIfNeeded();
  }
  await page.waitForTimeout(200);

  await page.screenshot({
    path: 'C:/Users/crjmc/.gemini/antigravity/brain/a4d4c31a-aff3-4886-ac22-5a7ea14db660/tone_editor_compact_redesign.png',
    fullPage: false
  });
  await browser.close();
  console.log('Redesigned Tone Editor screenshot captured successfully.');
})();
