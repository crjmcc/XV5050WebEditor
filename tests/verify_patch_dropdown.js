import { chromium } from 'playwright';
import path from 'path';
import { fileURLToPath, pathToFileURL } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function testPatchDropdown() {
  console.log('--- Starting Patch Dropdown & Preset Banks Verification ---');

  const browser = await chromium.launch({
    executablePath: 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox']
  });

  const context = await browser.newContext({
    permissions: ['midi', 'midi-sysex']
  });
  const page = await context.newPage();

  page.on('pageerror', err => console.error('Page Error:', err));

  const indexUrl = pathToFileURL(path.resolve(__dirname, '../index.html')).href;
  console.log(`Loading ${indexUrl}...`);
  await page.goto(indexUrl, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(1000);

  // 1. Switch to Patch tab
  console.log('1. Switching to Patch & Tones tab...');
  await page.click('#tabPatch');
  await page.waitForTimeout(300);

  // 2. Check #patchInstrumentSelect
  console.log('2. Inspecting #patchInstrumentSelect...');
  const patchInst = await page.$('#patchInstrumentSelect');
  if (!patchInst) throw new Error('#patchInstrumentSelect not found');

  const optgroups = await page.$$eval('#patchInstrumentSelect optgroup', groups =>
    groups.map(g => g.label)
  );
  console.log('Found Optgroups:', optgroups);

  const expectedGroups = [
    '— Performance Channels (Parts 1-16) —',
    '— Hardware User Patches (USER, Bank 87/0) —',
    '— Roland Factory Preset A (PR-A, Bank 87/64) —',
    '— Roland Factory Preset B (PR-B, Bank 87/65) —',
    '— Roland Factory Preset C (PR-C, Bank 87/66) —',
    '— Roland Factory Preset D (PR-D, Bank 87/67) —',
    '— Roland Factory Preset E (PR-E, Bank 87/68) —',
    '— Roland Factory Preset F (PR-F, Bank 87/69) —',
    '— Roland Factory Preset G (PR-G, Bank 87/70) —',
    '— Roland Factory Preset H (PR-H, Bank 87/71) —',
    '— General MIDI 2 (GM2, Bank 121/0) —',
    '— Rhythm Drum Kits (Bank 86) —'
  ];

  for (const exp of expectedGroups) {
    if (!optgroups.includes(exp)) {
      throw new Error(`Missing expected optgroup: "${exp}"`);
    }
  }

  const optionCount = await page.$$eval('#patchInstrumentSelect option', opts => opts.length);
  console.log(`Total options in #patchInstrumentSelect: ${optionCount}`);
  if (optionCount < 1200) {
    throw new Error(`Expected at least 1200 options, found ${optionCount}`);
  }

  // 3. Verify specific presets exist in the options
  const samplePresets = [
    { val: 'bank:pra:87:64:1', text: 'PR-A 001: 64voicePiano' },
    { val: 'bank:pra:87:64:128', text: 'PR-A 128: RockYurSocks' },
    { val: 'bank:prb:87:65:62', text: 'PR-B 062: Seq Mallet' },
    { val: 'bank:pre:87:68:106', text: 'PR-E 106: XV Trumpet' },
    { val: 'bank:prf:87:69:1', text: 'PR-F 001: 80s Retrosyn' },
    { val: 'bank:prg:87:70:1', text: 'PR-G 001: Power Octs' },
    { val: 'bank:prh:87:71:1', text: 'PR-H 001: Hall Grand' },
    { val: 'bank:gm2:121:0:1', text: 'GM2 001: Acoustic Grand Piano' },
    { val: 'rhythm:preset:1', text: 'Preset Drum 1: Standard Kit 1 (Bank 86/64 PC 1)' }
  ];

  for (const sample of samplePresets) {
    const optText = await page.$eval(
      `#patchInstrumentSelect option[value="${sample.val}"]`,
      el => el.textContent
    ).catch(() => null);
    if (!optText) {
      throw new Error(`Option with value "${sample.val}" not found!`);
    }
    console.log(`Verified preset option: [${sample.val}] -> "${optText}"`);
  }

  // 4. Test selecting PR-A 001 (64voicePiano)
  console.log('4. Selecting PR-A 001 (64voicePiano)...');
  await page.selectOption('#patchInstrumentSelect', 'bank:pra:87:64:1');
  await page.waitForTimeout(300);

  // Verify Part 1 Bank MSB, LSB, PC
  let part1Msb = await page.$eval('#partBankMSB1', el => el.value);
  let part1Lsb = await page.$eval('#partBankLSB1', el => el.value);
  let part1Pc = await page.$eval('#partPC1', el => el.value);
  let part1Name = await page.$eval('#partPatchName1', el => el.textContent);
  console.log(`Part 1 state: MSB=${part1Msb}, LSB=${part1Lsb}, PC=${part1Pc}, Name="${part1Name}"`);

  if (part1Msb !== '87' || part1Lsb !== '64' || part1Pc !== '1') {
    throw new Error(`Part 1 Bank/PC did not update to 87:64:1. Got ${part1Msb}:${part1Lsb}:${part1Pc}`);
  }
  if (!part1Name.includes('64voicePiano')) {
    throw new Error(`Part 1 Name did not update to 64voicePiano. Got "${part1Name}"`);
  }

  // 4b. Test selecting PR-B 062 (Seq Mallet)
  console.log('4b. Selecting PR-B 062 (Seq Mallet)...');
  await page.selectOption('#patchInstrumentSelect', 'bank:prb:87:65:62');
  await page.waitForTimeout(300);

  part1Msb = await page.$eval('#partBankMSB1', el => el.value);
  part1Lsb = await page.$eval('#partBankLSB1', el => el.value);
  part1Pc = await page.$eval('#partPC1', el => el.value);
  part1Name = await page.$eval('#partPatchName1', el => el.textContent);
  console.log(`Part 1 after PR-B 062: MSB=${part1Msb}, LSB=${part1Lsb}, PC=${part1Pc}, Name="${part1Name}"`);
  if (part1Name !== 'Seq Mallet') {
    throw new Error(`Expected Part 1 Name to be "Seq Mallet", got "${part1Name}"`);
  }

  // 4c. Test selecting PR-E 106 (XV Trumpet)
  console.log('4c. Selecting PR-E 106 (XV Trumpet)...');
  await page.selectOption('#patchInstrumentSelect', 'bank:pre:87:68:106');
  await page.waitForTimeout(300);

  part1Msb = await page.$eval('#partBankMSB1', el => el.value);
  part1Lsb = await page.$eval('#partBankLSB1', el => el.value);
  part1Pc = await page.$eval('#partPC1', el => el.value);
  part1Name = await page.$eval('#partPatchName1', el => el.textContent);
  console.log(`Part 1 after PR-E 106: MSB=${part1Msb}, LSB=${part1Lsb}, PC=${part1Pc}, Name="${part1Name}"`);
  if (part1Name !== 'XV Trumpet') {
    throw new Error(`Expected Part 1 Name to be "XV Trumpet", got "${part1Name}"`);
  }

  // 5. Test Stepper Buttons (< >) around #patchInstrumentSelect
  console.log('5. Testing prev/next steppers...');
  const nextBtn = await page.$('#patchInstrumentSelect-next');
  if (nextBtn) {
    await nextBtn.click();
    await page.waitForTimeout(200);
    const selectedVal = await page.$eval('#patchInstrumentSelect', el => el.value);
    console.log(`After next click, selected value: ${selectedVal}`);
  }

  // 6. Test Part Mixer Part 1 Patch Select (#partPatchSelect1)
  console.log('6. Checking Part Mixer Part 1 Patch Select...');
  await page.click('#tabPerformance');
  await page.waitForTimeout(300);

  const part1SelectOpts = await page.$$eval('#partPatchSelect1 option', opts => opts.length);
  console.log(`Total options in #partPatchSelect1: ${part1SelectOpts}`);
  if (part1SelectOpts < 800) {
    throw new Error(`Expected at least 800 options in #partPatchSelect1, found ${part1SelectOpts}`);
  }

  // 7. Capture visual screenshot
  const screenshotPath = 'C:\\Users\\crjmc\\.gemini\\antigravity\\brain\\a4d4c31a-aff3-4886-ac22-5a7ea14db660\\preset_patches_dropdown_verified.png';
  await page.screenshot({ path: screenshotPath, fullPage: false });
  console.log(`Saved screenshot to ${screenshotPath}`);

  await browser.close();
  console.log('✅ ALL PRESET PATCH TESTS PASSED SUCCESSFULLY!');
}

testPatchDropdown().catch(err => {
  console.error('Fatal test error:', err);
  process.exit(1);
});
