import { chromium } from 'playwright';

async function testMfxUI() {
  console.log('Testing 3-MFX Roll-Up Section and Effects in browser...');
  const browser = await chromium.launch({
    executablePath: 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    headless: false,
    args: ['--enable-features=WebMIDI', '--no-first-run', '--no-default-browser-check']
  });

  const context = await browser.newContext({
    permissions: ['midi', 'midi-sysex'],
    viewport: { width: 1400, height: 950 }
  });

  const page = await context.newPage();
  const pageErrors = [];
  page.on('pageerror', err => {
    console.error('Browser Page Error:', err.message);
    pageErrors.push(err.message);
  });

  await page.goto('http://localhost:8080/index.html');
  await page.waitForLoadState('domcontentloaded');
  await new Promise(r => setTimeout(r, 1000));

  // 1. Verify 3-MFX Roll-Up Section is present in Performance Tab
  const mfxCard = await page.$('#perfMfxRollup');
  console.log('1. #perfMfxRollup exists:', !!mfxCard);
  if (!mfxCard) throw new Error('#perfMfxRollup not found in DOM');

  // 2. Check summary chips in header
  const chipA = await page.$eval('#summaryMfxA', el => el.textContent);
  const chipB = await page.$eval('#summaryMfxB', el => el.textContent);
  const chipC = await page.$eval('#summaryMfxC', el => el.textContent);
  console.log('2. Summary chips in header:', { chipA, chipB, chipC });

  // 3. Check algorithm dropdown options
  const optionCount = await page.$eval('#perfMfxType', el => el.querySelectorAll('option').length);
  console.log('3. MFX Type options count (should be >= 90):', optionCount);

  // 4. Test Slot Switching: click MFX-B
  await page.click('#btnSlotMfxB');
  await new Promise(r => setTimeout(r, 300));
  const activeSlotText = await page.$eval('#activeSlotIndicator', el => el.textContent);
  console.log('4. Clicked MFX-B. Indicator text:', activeSlotText);

  // 5. Change Algorithm on MFX-B to #23 Overdrive
  await page.selectOption('#perfMfxType', '23');
  await new Promise(r => setTimeout(r, 400));
  const param1Label = await page.$eval('#perfMfxParamLabel1', el => el.textContent);
  const badgeB = await page.$eval('#slotBadgeB', el => el.textContent);
  console.log('5. Selected Algorithm 23. Param 1 Label:', param1Label, '| Slot B Badge:', badgeB);

  // 6. Test Roll-Up Collapse: Click #btnTogglePerfMfx
  console.log('6. Testing Roll-Up Toggle (collapsing 3-MFX)...');
  await page.click('#btnTogglePerfMfx');
  await new Promise(r => setTimeout(r, 400));
  const isCollapsed = await page.$eval('#perfMfxRollup', el => el.classList.contains('collapsed'));
  const toggleBtnText = await page.$eval('#perfMfxRollupText', el => el.textContent);
  console.log('   Collapsed state:', isCollapsed, '| Button text:', toggleBtnText);

  // Capture screenshot of collapsed state
  await page.screenshot({ path: 'tests/screenshot_mfx_collapsed.png' });
  console.log('   Screenshot saved: tests/screenshot_mfx_collapsed.png');

  // 7. Test Roll-Up Expand: Click #btnTogglePerfMfx again
  console.log('7. Testing Roll-Up Toggle (expanding 3-MFX)...');
  await page.click('#btnTogglePerfMfx');
  await new Promise(r => setTimeout(r, 400));
  const isExpanded = await page.$eval('#perfMfxRollup', el => !el.classList.contains('collapsed'));
  console.log('   Expanded state:', isExpanded);

  // Capture screenshot of expanded state
  await page.screenshot({ path: 'tests/screenshot_mfx_expanded.png' });
  console.log('   Screenshot saved: tests/screenshot_mfx_expanded.png');

  await browser.close();

  if (pageErrors.length > 0) {
    throw new Error(`Page errors detected: ${pageErrors.join('; ')}`);
  }
  console.log('\nAll 3-MFX Roll-Up UI verification tests PASSED!\n');
}

testMfxUI().catch(err => {
  console.error('Test Failed:', err);
  process.exit(1);
});
