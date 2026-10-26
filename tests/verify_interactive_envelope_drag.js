import { chromium } from 'playwright';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function run() {
  console.log('--- Verifying Draggable Envelope Points (TVF, TVA, Pitch) ---');

  const browser = await chromium.launch({
    executablePath: 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox']
  });

  const context = await browser.newContext({ viewport: { width: 1400, height: 1000 } });
  const page = await context.newPage();

  const indexPath = 'file:///' + path.resolve(__dirname, '../index.html').replace(/\\/g, '/');
  console.log('Navigating to:', indexPath);
  await page.goto(indexPath);
  await page.waitForLoadState('domcontentloaded');

  // Switch to Patch & Tones tab
  await page.click('button[data-tab="patch"]');
  await page.waitForTimeout(300);

  // 1. Verify existence of envelope handles on all 3 SVGs
  const envTypes = ['tvf', 'tva', 'pitch'];
  for (const env of envTypes) {
    const svgId = `#${env}EnvSvg`;
    const svg = await page.$(svgId);
    if (!svg) throw new Error(`SVG ${svgId} not found`);

    const handles = await page.$$(`${svgId} .env-node`);
    console.log(`Found ${handles.length} draggable handles on ${svgId}`);
    if (handles.length !== 4) {
      throw new Error(`Expected 4 handles on ${svgId}, found ${handles.length}`);
    }
  }

  // 2. Test dragging Point 1 (Attack) on TVF envelope
  console.log('Testing dragging Point 1 (Attack T1) on TVF Envelope...');
  const initT1 = await page.$eval('#tvfEnvT1', el => parseInt(el.value, 10));
  const p1Handle = await page.$('#tvfEnvSvg .env-node[data-node="1"] .env-node-hit');
  await p1Handle.scrollIntoViewIfNeeded();
  await page.waitForTimeout(100);
  const box1 = await p1Handle.boundingBox();

  // Drag right by 50px
  await page.mouse.move(box1.x + box1.width / 2, box1.y + box1.height / 2);
  await page.mouse.down();
  await page.mouse.move(box1.x + box1.width / 2 + 50, box1.y + box1.height / 2, { steps: 5 });
  await page.mouse.up();

  const afterT1 = await page.$eval('#tvfEnvT1', el => parseInt(el.value, 10));
  console.log(`TVF Attack T1 changed from ${initT1} to ${afterT1}`);
  if (afterT1 === initT1) {
    throw new Error('Dragging Point 1 did not change TVF Attack T1 value');
  }

  // 3. Test dragging Point 3 (Sustain & Decay 2) on TVF envelope
  console.log('Testing dragging Point 3 (Sustain L3) on TVF Envelope...');
  const initL3 = await page.$eval('#tvfEnvL3', el => parseInt(el.value, 10));
  const p3Handle = await page.$('#tvfEnvSvg .env-node[data-node="3"] .env-node-hit');
  await p3Handle.scrollIntoViewIfNeeded();
  await page.waitForTimeout(100);
  const box3 = await p3Handle.boundingBox();

  // Drag up by 30px (should increase sustain level)
  await page.mouse.move(box3.x + box3.width / 2, box3.y + box3.height / 2);
  await page.mouse.down();
  await page.mouse.move(box3.x + box3.width / 2, box3.y + box3.height / 2 - 30, { steps: 5 });
  await page.mouse.up();

  const afterL3 = await page.$eval('#tvfEnvL3', el => parseInt(el.value, 10));
  console.log(`TVF Sustain L3 changed from ${initL3} to ${afterL3}`);
  if (afterL3 <= initL3) {
    throw new Error(`Expected Sustain L3 to increase from ${initL3}, got ${afterL3}`);
  }

  // 4. Test dragging Point 1 (Attack & Level) on TVA envelope
  console.log('Testing dragging Point 1 on TVA Envelope...');
  const initTvaT1 = await page.$eval('#tvaEnvT1', el => parseInt(el.value, 10));
  const tvaP1Handle = await page.$('#tvaEnvSvg .env-node[data-node="1"] .env-node-hit');
  await tvaP1Handle.scrollIntoViewIfNeeded();
  await page.waitForTimeout(100);
  const tvaBox1 = await tvaP1Handle.boundingBox();

  await page.mouse.move(tvaBox1.x + tvaBox1.width / 2, tvaBox1.y + tvaBox1.height / 2);
  await page.mouse.down();
  await page.mouse.move(tvaBox1.x + tvaBox1.width / 2 + 40, tvaBox1.y + tvaBox1.height / 2, { steps: 5 });
  await page.mouse.up();

  const afterTvaT1 = await page.$eval('#tvaEnvT1', el => parseInt(el.value, 10));
  console.log(`TVA Attack T1 changed from ${initTvaT1} to ${afterTvaT1}`);
  if (afterTvaT1 === initTvaT1) {
    throw new Error('Dragging Point 1 did not change TVA Attack T1');
  }

  // 5. Test dragging Point 1 (Attack & Level 1) on Pitch envelope
  console.log('Testing dragging Point 1 on Pitch Envelope...');
  const initPitchL1 = await page.$eval('#pitchEnvL1', el => parseInt(el.value, 10));
  const pitchP1Handle = await page.$('#pitchEnvSvg .env-node[data-node="1"] .env-node-hit');
  await pitchP1Handle.scrollIntoViewIfNeeded();
  await page.waitForTimeout(100);
  const pitchBox1 = await pitchP1Handle.boundingBox();

  // Drag up by 25px (increases pitch semitones)
  await page.mouse.move(pitchBox1.x + pitchBox1.width / 2, pitchBox1.y + pitchBox1.height / 2);
  await page.mouse.down();
  await page.mouse.move(pitchBox1.x + pitchBox1.width / 2, pitchBox1.y + pitchBox1.height / 2 - 25, { steps: 5 });
  await page.mouse.up();

  const afterPitchL1 = await page.$eval('#pitchEnvL1', el => parseInt(el.value, 10));
  console.log(`Pitch Level 1 changed from ${initPitchL1} to ${afterPitchL1}`);
  if (afterPitchL1 <= initPitchL1) {
    throw new Error(`Expected Pitch L1 to increase from ${initPitchL1}, got ${afterPitchL1}`);
  }

  // 6. Capture screenshots of all 3 envelope cards
  const tvfModule = await page.$('.synth-module-card:has(#toneFilterType)');
  if (tvfModule) {
    await tvfModule.screenshot({
      path: 'C:/Users/crjmc/.gemini/antigravity/brain/a4d4c31a-aff3-4886-ac22-5a7ea14db660/tvf_envelope_draggable_points_verified.png'
    });
    console.log('Saved TVF draggable envelope screenshot');
  }

  const tvaModule = await page.$('.synth-module-card:has(#toneTvaLevel)');
  if (tvaModule) {
    await tvaModule.screenshot({
      path: 'C:/Users/crjmc/.gemini/antigravity/brain/a4d4c31a-aff3-4886-ac22-5a7ea14db660/tva_envelope_draggable_points_verified.png'
    });
    console.log('Saved TVA draggable envelope screenshot');
  }

  const pitchModule = await page.$('.synth-module-card:has(#pitchEnvT1)');
  if (pitchModule) {
    await pitchModule.screenshot({
      path: 'C:/Users/crjmc/.gemini/antigravity/brain/a4d4c31a-aff3-4886-ac22-5a7ea14db660/pitch_envelope_draggable_points_verified.png'
    });
    console.log('Saved Pitch draggable envelope screenshot');
  }

  // Also capture the whole 2x2 grid
  const toneGrid = await page.$('.tone-modules-grid');
  if (toneGrid) {
    await toneGrid.screenshot({
      path: 'C:/Users/crjmc/.gemini/antigravity/brain/a4d4c31a-aff3-4886-ac22-5a7ea14db660/all_envelopes_draggable_points_verified.png'
    });
    console.log('Saved full 2x2 modular grid screenshot');
  }

  console.log('ALL DRAGGABLE ENVELOPE VERIFICATION TESTS PASSED!');
  await browser.close();
}

run().catch(err => {
  console.error(err);
  process.exit(1);
});
