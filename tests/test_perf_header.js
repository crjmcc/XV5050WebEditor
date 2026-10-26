import { chromium } from 'playwright';

async function run() {
  const browser = await chromium.launch({
    executablePath: 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    headless: true
  });
  const page = await browser.newPage({ viewport: { width: 1400, height: 1000 } });
  await page.goto('file:///C:/chris2026/XV5050WebEditor/index.html');

  // Apply the left-aligned performance dropdown layout
  await page.evaluate(() => {
    const card = document.querySelector('#performanceTab .card');
    const header = card.querySelector('.card-header');
    const title = header.querySelector('.card-title');
    const select = document.getElementById('userPerfSelect');
    
    // Create left cluster
    const leftCluster = document.createElement('div');
    leftCluster.style.display = 'flex';
    leftCluster.style.alignItems = 'center';
    leftCluster.style.gap = '12px';
    leftCluster.style.flexWrap = 'wrap';

    header.insertBefore(leftCluster, header.firstChild);
    leftCluster.appendChild(title);

    const selWrap = document.createElement('div');
    selWrap.style.display = 'flex';
    selWrap.style.alignItems = 'center';
    selWrap.style.gap = '6px';
    const label = document.createElement('label');
    label.textContent = 'PRESET:';
    label.style.fontSize = '0.75rem';
    label.style.fontWeight = '700';
    label.style.color = 'var(--text-muted)';
    label.style.letterSpacing = '0.04em';

    select.style.maxWidth = '260px';
    select.style.fontWeight = '600';

    selWrap.appendChild(label);
    selWrap.appendChild(select);
    leftCluster.appendChild(selWrap);
  });

  const header = await page.$('#performanceTab .card .card-header');
  await header.screenshot({
    path: 'C:/Users/crjmc/.gemini/antigravity/brain/a4d4c31a-aff3-4886-ac22-5a7ea14db660/perf_header_left_aligned.png'
  });

  const fullPerfCard = await page.$('#performanceTab .card');
  await fullPerfCard.screenshot({
    path: 'C:/Users/crjmc/.gemini/antigravity/brain/a4d4c31a-aff3-4886-ac22-5a7ea14db660/perf_card_left_aligned.png'
  });

  console.log('Saved screenshots of left-aligned performance preset dropdown');
  await browser.close();
}

run();

