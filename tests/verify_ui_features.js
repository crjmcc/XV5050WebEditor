import { chromium } from 'playwright';
import path from 'path';
import { fileURLToPath, pathToFileURL } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function testUI() {
  console.log('--- Starting Comprehensive UI Verification ---');

  const browser = await chromium.launch({
    executablePath: 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox']
  });

  const context = await browser.newContext({
    permissions: ['midi', 'midi-sysex']
  });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', err => {
    console.error('Page Error:', err);
    errors.push(err.message);
  });
  page.on('console', msg => {
    if (msg.type() === 'error') {
      const text = msg.text();
      if (!text.includes('Failed to get Web MIDI access') && !text.includes('NotAllowedError')) {
        console.error('Console Error:', text);
        errors.push(text);
      }
    }
  });

  const indexUrl = pathToFileURL(path.resolve(__dirname, '../index.html')).href;
  console.log(`Loading ${indexUrl}...`);
  await page.goto(indexUrl, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(1000);

  // 1. Verify System Drawer & SRX Expansion Controls
  console.log('1. Checking System Drawer, SRX Expansion & Scale Tune...');
  const srxSlotA = await page.$('#srxSlotASelect');
  const srxSlotB = await page.$('#srxSlotBSelect');
  const scaleSelect = await page.$('#scaleTemperamentSelect');
  const btnApplyScale = await page.$('#btnApplyScaleTemperament');

  if (!srxSlotA || !srxSlotB || !scaleSelect || !btnApplyScale) {
    throw new Error('Missing SRX or Scale Tune elements in System Drawer');
  }

  // 2. Verify Tab Navigation Buttons
  console.log('2. Checking Tab Bar...');
  const tabPerf = await page.$('#tabPerformance');
  const tabPatch = await page.$('#tabPatch');
  const tabDeep = await page.$('#tabDeepStudio');
  const tabDrum = await page.$('#tabDrumKit');
  const tabLib = await page.$('#tabLibrarian');

  if (!tabPerf || !tabPatch || !tabDrum || !tabLib) {
    throw new Error('Missing main navigation tabs');
  }
  if (tabDeep) {
    throw new Error('tabDeepStudio should be removed from top navigation bar (it is embedded in Patch tab)');
  }

  // 3. Test Deep Studio & Mutator inside Patch & Tones Tab
  console.log('3. Switching to Patch & Tones Tab (with embedded Deep Studio & Mutator)...');
  await tabPatch.click();
  await page.waitForTimeout(300);

  const isPatchTabActive = await page.$eval('#patchTab', el => el.classList.contains('active'));
  if (!isPatchTabActive) throw new Error('Patch Tab did not become active');

  const deepStudioCard = await page.$('#deepStudioTab');
  if (!deepStudioCard) throw new Error('Missing #deepStudioTab roll-up card inside Patch & Tones');

  // Modern Synth Lab defaults to rolled up; expand it for interaction
  const btnToggleRollup = await page.$('#btnToggleDeepStudioRollup');
  if (btnToggleRollup) {
    await btnToggleRollup.click();
    await page.waitForTimeout(200);
  }

  // Verify 4 Performance Macros
  for (let m = 1; m <= 4; m++) {
    const dial = await page.$(`#macro${m}Dial`);
    const pill = await page.$(`#macro${m}Val`);
    if (!dial || !pill) throw new Error(`Missing Macro ${m} control`);
  }
  // Change Macro 1
  await page.$eval('#macro1Dial', el => {
    el.value = '90';
    el.dispatchEvent(new Event('input'));
  });
  const macro1Text = await page.$eval('#macro1Val', el => el.textContent);
  console.log(`Macro 1 dial adjusted -> pill value: ${macro1Text}`);

  // Verify 4-Tone Layer Strip
  for (let t = 1; t <= 4; t++) {
    const card = await page.$(`#deepToneCard${t}`);
    const lvl = await page.$(`#deepTone${t}Level`);
    if (!card || !lvl) throw new Error(`Missing Deep Tone Card ${t}`);
  }

  // Verify 2D Vector Morphing Pad
  console.log('Checking 2D Vector Morphing Pad...');
  const vectorPad = await page.$('#vectorMorphPad');
  const puck = await page.$('#vectorMorphPuck');
  if (!vectorPad || !puck) throw new Error('Missing Vector Pad or Puck');

  // Verify Spectrum Analyzer Path
  const spectrumPathD = await page.$eval('#deepSpectrumPath', el => el.getAttribute('d'));
  console.log(`Spectrum SVG Path initial: ${spectrumPathD?.slice(0, 30)}...`);
  if (!spectrumPathD || !spectrumPathD.startsWith('M')) {
    throw new Error('Dynamic Spectrum Path not generated properly');
  }

  // Verify Mutator controls
  console.log('Testing Mutator action...');
  const btnMutate = await page.$('#btnMutatePatch');
  const btnRandom = await page.$('#btnRandomizeWaves');
  const btnUndo = await page.$('#btnMutatorUndo');
  const btnRedo = await page.$('#btnMutatorRedo');
  const btnCompare = await page.$('#btnMutatorCompare');

  if (!btnMutate || !btnRandom || !btnUndo || !btnRedo || !btnCompare) {
    throw new Error('Missing mutator action buttons');
  }

  await btnMutate.click();
  await page.waitForTimeout(200);
  const statusMsg = await page.$eval('#mutatorStatusMsg', el => el.textContent);
  console.log(`Mutator status: ${statusMsg}`);
  if (!statusMsg || statusMsg === 'Ready to mutate') {
    throw new Error('Mutator status did not update after mutation');
  }

  // 4. Test Drum Kit Editor Tab (Scrollable Octave Pad Grid Layout)
  console.log('4. Switching to Drum Kit Editor Tab...');
  await tabDrum.click();
  await page.waitForTimeout(300);

  const isDrumActive = await page.$eval('#drumKitTab', el => el.classList.contains('active'));
  if (!isDrumActive) throw new Error('Drum Kit Tab did not become active');

  // Verify octave buttons
  const octaveBtns = await page.$$('.drum-octave-btn');
  console.log(`Found ${octaveBtns.length} drum octave bank buttons (expected 5)`);
  if (octaveBtns.length !== 5) throw new Error('Expected 5 octave buttons');

  // Verify drum pads rendered in pad grid container
  const pads = await page.$$('#drumPadGridContainer .drum-pad');
  console.log(`Found ${pads.length} interactive drum pads in Octave 1`);
  if (pads.length < 12) throw new Error('Expected at least 12 pads in Octave 1');

  // Click on a drum pad (e.g. C2 Bass Drum 1)
  const bassDrumPad = await page.$('.drum-pad[data-note="36"]');
  if (!bassDrumPad) throw new Error('Missing Bass Drum 1 (Note 36) pad');
  await bassDrumPad.click();
  await page.waitForTimeout(100);

  const selectedNoteBadgeText = await page.$eval('#drumSelectedNoteBadge', el => el.textContent);
  console.log(`Selected drum note badge: ${selectedNoteBadgeText}`);
  if (!selectedNoteBadgeText.includes('Note 36') || !selectedNoteBadgeText.includes('Bass Drum 1')) {
    throw new Error('Drum Selected Note badge did not update properly');
  }

  // Verify Per-Key Designer controls and Rotary Knobs
  const drumCutoff = await page.$('#drumCutoff');
  const drumLevel = await page.$('#drumLevel');
  const drumMuteGroup = await page.$('#drumMuteGroup');
  const drumKnobs = await page.$$('#drumKeyDesignerCard .rotary-knob');
  console.log(`Found ${drumKnobs.length} rotary knobs in Drum Key Designer`);
  if (!drumCutoff || !drumLevel || !drumMuteGroup || drumKnobs.length < 10) {
    throw new Error('Missing per-key drum designer rotary knobs or controls');
  }

  // Test Drum Hit Renaming
  console.log('Testing drum hit renaming...');
  const hitNameInput = await page.$('#drumHitNameInput');
  if (!hitNameInput) throw new Error('Missing drumHitNameInput');
  await page.fill('#drumHitNameInput', 'Studio 808 Thump');
  await page.$eval('#drumHitNameInput', el => el.dispatchEvent(new Event('input')));
  await page.waitForTimeout(100);
  const pad36Title = await page.$eval('.drum-pad[data-note="36"] .drum-pad-title', el => el.textContent);
  console.log(`Renamed drum pad 36 title: "${pad36Title}"`);
  if (pad36Title !== 'Studio 808 Thump') {
    throw new Error(`Pad title was not updated on rename. Got: ${pad36Title}`);
  }

  // Test Drum Hit Library Selection
  console.log('Testing drum hit library replacement...');
  const hitLibrarySelect = await page.$('#drumHitLibrarySelect');
  if (!hitLibrarySelect) throw new Error('Missing drumHitLibrarySelect');
  await page.selectOption('#drumHitLibrarySelect', 'snare_808_crisp');
  await page.waitForTimeout(100);
  const afterLibTitle = await page.$eval('.drum-pad[data-note="36"] .drum-pad-title', el => el.textContent);
  console.log(`Library replaced drum pad 36: "${afterLibTitle}"`);
  if (!afterLibTitle.includes('808 Crisp Snare')) {
    throw new Error(`Pad title was not updated from library. Got: ${afterLibTitle}`);
  }

  // Switch to Octave 2
  console.log('Testing octave bank switching...');
  await page.click('.drum-octave-btn[data-octave="2"]');
  await page.waitForTimeout(100);
  const oct2Pads = await page.$$('#drumPadGridContainer .drum-pad');
  console.log(`Octave 2 pads rendered: ${oct2Pads.length}`);
  const oct2Badge = await page.$eval('#drumOctaveRangeBadge', el => el.textContent);
  if (!oct2Badge.includes('Octave 2')) throw new Error('Octave range badge did not update');

  // 5. Check Deep Studio Roll-Up & Tight Slider Layout on Patch Screen
  console.log('5. Checking Patch Editor Screen & Deep Studio Roll-Up...');
  await tabPatch.click();
  await page.waitForTimeout(300);

  // Verify Deep Studio Roll-Up exists inside Patch Tab
  const deepRollup = await page.$('#deepStudioTab');
  const rollupHeader = await page.$('#btnToggleDeepStudioRollup');
  const rollupBody = await page.$('#deepStudioRollupBody');
  if (!deepRollup || !rollupHeader || !rollupBody) {
    throw new Error('Deep Studio roll-up panel missing from Patch tab');
  }

  // Test roll-up collapse / expand
  console.log('Testing Deep Studio roll-up collapse/expand toggle...');
  await rollupHeader.click();
  await page.waitForTimeout(100);
  const isBodyCollapsed = await page.$eval('#deepStudioRollupBody', el => el.style.display === 'none');
  console.log(`Roll-up collapsed after click: ${isBodyCollapsed}`);
  if (!isBodyCollapsed) throw new Error('Roll-up body did not collapse');

  // Click again to expand
  await rollupHeader.click();
  await page.waitForTimeout(100);
  const isBodyExpanded = await page.$eval('#deepStudioRollupBody', el => el.style.display !== 'none');
  console.log(`Roll-up re-expanded: ${isBodyExpanded}`);
  if (!isBodyExpanded) throw new Error('Roll-up body did not re-expand');

  // 6. Verify SRX Patches in Instrument Selectors
  console.log('6. Checking SRX Expansion Patches in Instrument Dropdown...');
  await page.selectOption('#srxSlotASelect', 'SRX-07');
  await page.waitForTimeout(150);

  const srxOptions = await page.$$eval('#patchInstrumentSelect optgroup', groups => {
    return groups.map(g => g.label).filter(l => l.includes('SRX Slot A'));
  });
  console.log(`Found SRX optgroups in instrument select:`, srxOptions);
  if (srxOptions.length === 0) {
    throw new Error('Expected SRX Slot A optgroup in patchInstrumentSelect after selecting SRX-07');
  }

  // Check Tone Level fader wrapper width
  const toneFaderWrap = await page.$eval('#toneLevel', el => {
    const parent = el.closest('.compact-fader-wrap');
    const style = window.getComputedStyle(el);
    return {
      hasCompactWrap: !!parent,
      maxWidth: style.maxWidth,
      width: style.width
    };
  });
  console.log('Tone slider CSS dimensions:', toneFaderWrap);

  // Check Tone Wave & Tuning Rack exists
  const waveRack = await page.$('.tone-wave-tuning-rack');
  const tmtStrip = await page.$('.tmt-split-strip');
  if (!waveRack || !tmtStrip) {
    throw new Error('Missing modular Tone Rack or TMT split strip');
  }

  // Check that changing waveGroup to SRX-A alters the wave dropdown contents
  await page.$eval('#waveGroup', el => {
    el.value = 'SRX-A';
    el.dispatchEvent(new Event('change'));
  });
  const waveLOptionCount = await page.$eval('#waveNumberL', el => el.options.length);
  const waveLFirstOpt = await page.$eval('#waveNumberL', el => el.options[0]?.textContent);
  console.log(`SRX Slot A wave dropdown options: ${waveLOptionCount}, First: "${waveLFirstOpt}"`);
  if (waveLOptionCount < 50) {
    throw new Error('waveNumberL options should be populated with SRX waveforms when SRX-A is selected');
  }

  // Check < and > stepper buttons around waveNumberL
  const hasStepperWrap = await page.$eval('#waveNumberL', el => el.parentElement.classList.contains('stepper-select-wrap'));
  const hasPrevBtn = await page.$eval('#waveNumberL', el => !!el.parentElement.querySelector('.btn-step-prev'));
  const hasNextBtn = await page.$eval('#waveNumberL', el => !!el.parentElement.querySelector('.btn-step-next'));
  console.log('Stepper controls on waveNumberL:', { hasStepperWrap, hasPrevBtn, hasNextBtn });
  if (!hasStepperWrap || !hasPrevBtn || !hasNextBtn) {
    throw new Error('waveNumberL must be wrapped with stepper-select-wrap containing prev/next buttons');
  }

  // Test clicking next stepper button to advance waveNumberL
  await page.click('#waveNumberL ~ .btn-step-next, .stepper-select-wrap:has(#waveNumberL) .btn-step-next');
  const steppedVal = await page.$eval('#waveNumberL', el => el.value);
  console.log('WaveNumberL value after clicking next stepper:', steppedVal);

  // 7. Verify Modern VST Patch Transpiler
  console.log('7. Testing Modern VST Patch Transpiler...');
  const btnOpenTranspiler = await page.$('#btnOpenVstTranspiler');
  if (!btnOpenTranspiler) throw new Error('Missing #btnOpenVstTranspiler button in Deep Studio rollup');
  
  await btnOpenTranspiler.click();
  await page.waitForTimeout(300);

  const isLibrarianActive = await page.$eval('#librarianTab', el => el.classList.contains('active'));
  console.log(`Switched to Librarian tab: ${isLibrarianActive}`);
  if (!isLibrarianActive) throw new Error('Failed to switch to Librarian tab from Transpiler button');

  const vstCard = await page.$('#vstTranspilerCard');
  const vstDropzone = await page.$('#vstDropzone');
  const demoSelect = await page.$('#vstDemoPresetSelect');
  if (!vstCard || !vstDropzone || !demoSelect) {
    throw new Error('Missing VST Transpiler elements in Librarian tab');
  }

  // Select demo preset: Cyberpunk Reese Bass (Vital)
  console.log('Selecting "vital_cyberpunk_reese" demo preset...');
  await page.selectOption('#vstDemoPresetSelect', 'vital_cyberpunk_reese');
  await page.waitForTimeout(200);

  const isResultVisible = await page.$eval('#vstResultContainer', el => window.getComputedStyle(el).display !== 'none');
  console.log(`Transpiler result container displayed: ${isResultVisible}`);
  if (!isResultVisible) throw new Error('Result container did not display after selecting demo preset');

  const patchName = await page.$eval('#vstResultPatchName', el => el.textContent);
  const tone1Wave = await page.$eval('#vstTone1Wave', el => el.textContent);
  const filterReport = await page.$eval('#vstReportFilter', el => el.textContent);
  console.log(`Transpiled patch: ${patchName}, Tone 1: ${tone1Wave}, Filter: ${filterReport}`);

  if (!patchName.includes('CYBERREESE')) {
    throw new Error(`Expected CYBERREESE patch name, got: ${patchName}`);
  }
  if (!filterReport.includes('TVF LPF')) {
    throw new Error(`Expected TVF LPF in filter report, got: ${filterReport}`);
  }

  // Click "Load into Patch Editor"
  console.log('Loading transpiled patch into Patch Editor...');
  await page.click('#btnLoadTranspiledPatch');
  await page.waitForTimeout(300);

  const isPatchActive = await page.$eval('#patchTab', el => el.classList.contains('active'));
  console.log(`Patch tab active after load: ${isPatchActive}`);
  if (!isPatchActive) throw new Error('Patch tab did not activate after loading transpiled patch');

  const loadedPatchName = await page.$eval('#patchName', el => el.value);
  console.log(`Active patch name in editor: "${loadedPatchName}"`);
  if (!loadedPatchName.includes('CYBERREESE')) {
    throw new Error(`Editor patch name was not updated. Got: ${loadedPatchName}`);
  }

  await browser.close();

  if (errors.length > 0) {
    console.error('Errors encountered during test:', errors);
    process.exit(1);
  }

  console.log('✅ ALL UI TESTS PASSED SUCCESSFULLY!');
}

testUI().catch(err => {
  console.error('Fatal test error:', err);
  process.exit(1);
});
