import { chromium } from 'playwright';

async function run() {
  const browser = await chromium.launch({
    executablePath: 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    headless: true
  });
  const page = await browser.newPage({ viewport: { width: 1400, height: 1100 } });
  await page.goto('file:///C:/chris2026/XV5050WebEditor/index.html');
  await page.click('button[data-tab="patch"]');

  const heights = await page.evaluate(() => {
    return Array.from(document.querySelectorAll('.synth-module-card')).map(c => ({
      title: c.querySelector('.synth-module-title')?.innerText?.split('\n')[0],
      h: c.offsetHeight,
      w: c.offsetWidth
    }));
  });
  console.log('Module Dimensions:', heights);
  await browser.close();
}

run();

