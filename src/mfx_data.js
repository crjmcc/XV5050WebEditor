/**
 * Roland XV-5050 Multi-Effects (MFX) Catalog & Parameter Definitions
 * 
 * Provides complete metadata for all 90 Roland MFX algorithms, including
 * algorithm categories, names, and dynamic parameter assignments for
 * real-time SysEx editing in Performance and Patch modes.
 */

export const MFX_CATALOG = [
  { id: 0, name: 'THRU (Bypass)', category: 'Bypass', params: [] },
  {
    id: 1, name: '01: Stereo EQ', category: 'Equalizer / Filter',
    params: [
      { name: 'Low Freq', min: 0, max: 1, display: ['200Hz', '400Hz'] },
      { name: 'Low Gain', min: 49, max: 79, offset: 64, unit: 'dB' },
      { name: 'Mid 1 Freq', min: 0, max: 16, unit: 'kHz' },
      { name: 'Mid 1 Q', min: 0, max: 4, display: ['0.5', '1.0', '2.0', '4.0', '8.0'] },
      { name: 'Mid 1 Gain', min: 49, max: 79, offset: 64, unit: 'dB' },
      { name: 'Mid 2 Freq', min: 0, max: 16, unit: 'kHz' },
      { name: 'Mid 2 Q', min: 0, max: 4, display: ['0.5', '1.0', '2.0', '4.0', '8.0'] },
      { name: 'Mid 2 Gain', min: 49, max: 79, offset: 64, unit: 'dB' },
      { name: 'High Freq', min: 0, max: 1, display: ['4kHz', '8kHz'] },
      { name: 'High Gain', min: 49, max: 79, offset: 64, unit: 'dB' },
      { name: 'Level', min: 0, max: 127 },
      { name: 'Phase', min: 0, max: 1, display: ['Normal', 'Inverse'] },
    ]
  },
  {
    id: 2, name: '02: Overdrive', category: 'Distortion / Amp',
    params: [
      { name: 'Drive', min: 0, max: 127 },
      { name: 'Level', min: 0, max: 127 },
      { name: 'Tone', min: 0, max: 127 },
      { name: 'Amp Simulator', min: 0, max: 4, display: ['Small', 'Built-in', '2-Stack', '3-Stack', 'Off'] },
      { name: 'Low Gain', min: 49, max: 79, offset: 64, unit: 'dB' },
      { name: 'High Gain', min: 49, max: 79, offset: 64, unit: 'dB' },
      { name: 'Pan', min: 0, max: 127, display: 'pan' },
      { name: 'Dry/Wet', min: 0, max: 127 },
    ]
  },
  {
    id: 3, name: '03: Distortion', category: 'Distortion / Amp',
    params: [
      { name: 'Drive', min: 0, max: 127 },
      { name: 'Level', min: 0, max: 127 },
      { name: 'Tone', min: 0, max: 127 },
      { name: 'Amp Simulator', min: 0, max: 4, display: ['Small', 'Built-in', '2-Stack', '3-Stack', 'Off'] },
      { name: 'Low Gain', min: 49, max: 79, offset: 64, unit: 'dB' },
      { name: 'High Gain', min: 49, max: 79, offset: 64, unit: 'dB' },
      { name: 'Pan', min: 0, max: 127, display: 'pan' },
      { name: 'Dry/Wet', min: 0, max: 127 },
    ]
  },
  {
    id: 4, name: '04: Phaser', category: 'Modulation',
    params: [
      { name: 'Manual', min: 0, max: 127 },
      { name: 'Rate', min: 0, max: 127 },
      { name: 'Depth', min: 0, max: 127 },
      { name: 'Resonance', min: 0, max: 127 },
      { name: 'Mix Level', min: 0, max: 127 },
      { name: 'Low Gain', min: 49, max: 79, offset: 64, unit: 'dB' },
      { name: 'High Gain', min: 49, max: 79, offset: 64, unit: 'dB' },
      { name: 'Level', min: 0, max: 127 },
    ]
  },
  {
    id: 5, name: '05: Spectrum', category: 'Equalizer / Filter',
    params: [
      { name: 'Band 1 (250Hz)', min: 49, max: 79, offset: 64, unit: 'dB' },
      { name: 'Band 2 (500Hz)', min: 49, max: 79, offset: 64, unit: 'dB' },
      { name: 'Band 3 (1kHz)', min: 49, max: 79, offset: 64, unit: 'dB' },
      { name: 'Band 4 (2kHz)', min: 49, max: 79, offset: 64, unit: 'dB' },
      { name: 'Band 5 (4kHz)', min: 49, max: 79, offset: 64, unit: 'dB' },
      { name: 'Band 6 (8kHz)', min: 49, max: 79, offset: 64, unit: 'dB' },
      { name: 'Bandwidth Q', min: 0, max: 4, display: ['0.5', '1.0', '2.0', '4.0', '8.0'] },
      { name: 'Level', min: 0, max: 127 },
    ]
  },
  {
    id: 6, name: '06: Enhancer', category: 'Equalizer / Filter',
    params: [
      { name: 'Sens', min: 0, max: 127 },
      { name: 'Mix', min: 0, max: 127 },
      { name: 'Low Gain', min: 49, max: 79, offset: 64, unit: 'dB' },
      { name: 'High Gain', min: 49, max: 79, offset: 64, unit: 'dB' },
      { name: 'Level', min: 0, max: 127 },
    ]
  },
  {
    id: 7, name: '07: Auto Wah', category: 'Equalizer / Filter',
    params: [
      { name: 'Filter Type', min: 0, max: 1, display: ['LPF', 'BPF'] },
      { name: 'Manual', min: 0, max: 127 },
      { name: 'Peak', min: 0, max: 127 },
      { name: 'Sens', min: 0, max: 127 },
      { name: 'Polarity', min: 0, max: 1, display: ['Up', 'Down'] },
      { name: 'Rate', min: 0, max: 127 },
      { name: 'Depth', min: 0, max: 127 },
      { name: 'Level', min: 0, max: 127 },
    ]
  },
  {
    id: 8, name: '08: Rotary', category: 'Modulation',
    params: [
      { name: 'Speed', min: 0, max: 1, display: ['Slow', 'Fast'] },
      { name: 'Woofer Slow', min: 0, max: 127 },
      { name: 'Woofer Fast', min: 0, max: 127 },
      { name: 'Woofer Accel', min: 0, max: 127 },
      { name: 'Tweeter Slow', min: 0, max: 127 },
      { name: 'Tweeter Fast', min: 0, max: 127 },
      { name: 'Tweeter Accel', min: 0, max: 127 },
      { name: 'Separation', min: 0, max: 127 },
      { name: 'Level', min: 0, max: 127 },
    ]
  },
  {
    id: 9, name: '09: Compressor', category: 'Dynamics',
    params: [
      { name: 'Attack', min: 0, max: 127 },
      { name: 'Sustain', min: 0, max: 127 },
      { name: 'Post Gain', min: 0, max: 3, display: ['0dB', '+6dB', '+12dB', '+18dB'] },
      { name: 'Low Gain', min: 49, max: 79, offset: 64, unit: 'dB' },
      { name: 'High Gain', min: 49, max: 79, offset: 64, unit: 'dB' },
      { name: 'Level', min: 0, max: 127 },
    ]
  },
  {
    id: 10, name: '10: Limiter', category: 'Dynamics',
    params: [
      { name: 'Threshold', min: 0, max: 127 },
      { name: 'Release', min: 0, max: 127 },
      { name: 'Ratio', min: 0, max: 3, display: ['1.5:1', '2:1', '4:1', '100:1'] },
      { name: 'Post Gain', min: 0, max: 3, display: ['0dB', '+6dB', '+12dB', '+18dB'] },
      { name: 'Low Gain', min: 49, max: 79, offset: 64, unit: 'dB' },
      { name: 'High Gain', min: 49, max: 79, offset: 64, unit: 'dB' },
      { name: 'Level', min: 0, max: 127 },
    ]
  },
  {
    id: 11, name: '11: Hexa-Chorus', category: 'Modulation',
    params: [
      { name: 'Pre-Delay', min: 0, max: 127 },
      { name: 'Rate', min: 0, max: 127 },
      { name: 'Depth', min: 0, max: 127 },
      { name: 'Pre-Delay Dev', min: 0, max: 20 },
      { name: 'Depth Dev', min: 0, max: 20 },
      { name: 'Pan Dev', min: 0, max: 20 },
      { name: 'Level', min: 0, max: 127 },
    ]
  },
  {
    id: 12, name: '12: Tremolo Chorus', category: 'Modulation',
    params: [
      { name: 'Pre-Delay', min: 0, max: 127 },
      { name: 'Chorus Rate', min: 0, max: 127 },
      { name: 'Chorus Depth', min: 0, max: 127 },
      { name: 'Tremolo Rate', min: 0, max: 127 },
      { name: 'Tremolo Depth', min: 0, max: 127 },
      { name: 'Tremolo Phase', min: 0, max: 180, unit: 'deg' },
      { name: 'Level', min: 0, max: 127 },
    ]
  },
  {
    id: 13, name: '13: Space-D', category: 'Modulation',
    params: [
      { name: 'Pre-Delay', min: 0, max: 127 },
      { name: 'Rate', min: 0, max: 127 },
      { name: 'Depth', min: 0, max: 127 },
      { name: 'Phase', min: 0, max: 180, unit: 'deg' },
      { name: 'Low Gain', min: 49, max: 79, offset: 64, unit: 'dB' },
      { name: 'High Gain', min: 49, max: 79, offset: 64, unit: 'dB' },
      { name: 'Level', min: 0, max: 127 },
    ]
  },
  {
    id: 14, name: '14: Stereo Chorus', category: 'Modulation',
    params: [
      { name: 'Pre-Delay', min: 0, max: 127 },
      { name: 'Rate', min: 0, max: 127 },
      { name: 'Depth', min: 0, max: 127 },
      { name: 'Phase', min: 0, max: 180, unit: 'deg' },
      { name: 'Filter Type', min: 0, max: 2, display: ['Off', 'LPF', 'HPF'] },
      { name: 'Cutoff Freq', min: 0, max: 16, unit: 'kHz' },
      { name: 'Level', min: 0, max: 127 },
    ]
  },
  {
    id: 15, name: '15: Stereo Flanger', category: 'Modulation',
    params: [
      { name: 'Pre-Delay', min: 0, max: 127 },
      { name: 'Rate', min: 0, max: 127 },
      { name: 'Depth', min: 0, max: 127 },
      { name: 'Feedback', min: 0, max: 127 },
      { name: 'Phase', min: 0, max: 180, unit: 'deg' },
      { name: 'Filter Type', min: 0, max: 2, display: ['Off', 'LPF', 'HPF'] },
      { name: 'Level', min: 0, max: 127 },
    ]
  },
  {
    id: 16, name: '16: Step Flanger', category: 'Modulation',
    params: [
      { name: 'Pre-Delay', min: 0, max: 127 },
      { name: 'Rate', min: 0, max: 127 },
      { name: 'Depth', min: 0, max: 127 },
      { name: 'Feedback', min: 0, max: 127 },
      { name: 'Step Rate', min: 0, max: 127 },
      { name: 'Phase', min: 0, max: 180, unit: 'deg' },
      { name: 'Level', min: 0, max: 127 },
    ]
  },
  {
    id: 17, name: '17: Stereo Delay', category: 'Delay',
    params: [
      { name: 'Delay Left', min: 0, max: 127 },
      { name: 'Delay Right', min: 0, max: 127 },
      { name: 'Feedback Mode', min: 0, max: 1, display: ['Normal', 'Cross'] },
      { name: 'Feedback', min: 0, max: 127 },
      { name: 'HF Damp', min: 0, max: 17, display: ['Bypass', '16k', '12k', '10k', '8k', '6k', '4k', '2k'] },
      { name: 'Level', min: 0, max: 127 },
    ]
  },
  {
    id: 18, name: '18: Modulation Delay', category: 'Delay',
    params: [
      { name: 'Delay Left', min: 0, max: 127 },
      { name: 'Delay Right', min: 0, max: 127 },
      { name: 'Feedback', min: 0, max: 127 },
      { name: 'Rate', min: 0, max: 127 },
      { name: 'Depth', min: 0, max: 127 },
      { name: 'HF Damp', min: 0, max: 17 },
      { name: 'Level', min: 0, max: 127 },
    ]
  },
  {
    id: 19, name: '19: Triple Tap Delay', category: 'Delay',
    params: [
      { name: 'Delay Center', min: 0, max: 127 },
      { name: 'Delay Left', min: 0, max: 127 },
      { name: 'Delay Right', min: 0, max: 127 },
      { name: 'Feedback', min: 0, max: 127 },
      { name: 'HF Damp', min: 0, max: 17 },
      { name: 'Level', min: 0, max: 127 },
    ]
  },
  {
    id: 20, name: '20: Quadruple Tap Delay', category: 'Delay',
    params: [
      { name: 'Delay Tap 1', min: 0, max: 127 },
      { name: 'Delay Tap 2', min: 0, max: 127 },
      { name: 'Delay Tap 3', min: 0, max: 127 },
      { name: 'Delay Tap 4', min: 0, max: 127 },
      { name: 'Feedback', min: 0, max: 127 },
      { name: 'Level', min: 0, max: 127 },
    ]
  },
  {
    id: 21, name: '21: Time Control Delay', category: 'Delay',
    params: [
      { name: 'Delay Time', min: 0, max: 127 },
      { name: 'Acceleration', min: 0, max: 15 },
      { name: 'Feedback', min: 0, max: 127 },
      { name: 'HF Damp', min: 0, max: 17 },
      { name: 'Level', min: 0, max: 127 },
    ]
  },
  {
    id: 22, name: '22: 2-Voice Pitch Shifter', category: 'Pitch Shift',
    params: [
      { name: 'Pitch 1 Coarse', min: 40, max: 88, offset: 64, unit: 'semi' },
      { name: 'Pitch 1 Fine', min: 14, max: 114, offset: 64, unit: 'cent' },
      { name: 'Pitch 1 Pan', min: 0, max: 127, display: 'pan' },
      { name: 'Pitch 1 Level', min: 0, max: 127 },
      { name: 'Pitch 2 Coarse', min: 40, max: 88, offset: 64, unit: 'semi' },
      { name: 'Pitch 2 Fine', min: 14, max: 114, offset: 64, unit: 'cent' },
      { name: 'Pitch 2 Pan', min: 0, max: 127, display: 'pan' },
      { name: 'Pitch 2 Level', min: 0, max: 127 },
    ]
  },
  {
    id: 23, name: '23: FB Pitch Shifter', category: 'Pitch Shift',
    params: [
      { name: 'Coarse Tune', min: 40, max: 88, offset: 64, unit: 'semi' },
      { name: 'Fine Tune', min: 14, max: 114, offset: 64, unit: 'cent' },
      { name: 'Feedback', min: 0, max: 127 },
      { name: 'Pre-Delay', min: 0, max: 127 },
      { name: 'Level', min: 0, max: 127 },
    ]
  },
  {
    id: 24, name: '24: Reverb', category: 'Reverb',
    params: [
      { name: 'Reverb Type', min: 0, max: 5, display: ['Room 1', 'Room 2', 'Stage 1', 'Stage 2', 'Hall 1', 'Hall 2'] },
      { name: 'Pre-Delay', min: 0, max: 127 },
      { name: 'Reverb Time', min: 0, max: 127 },
      { name: 'HF Damp', min: 0, max: 17 },
      { name: 'Level', min: 0, max: 127 },
    ]
  },
  {
    id: 25, name: '25: Gate Reverb', category: 'Reverb',
    params: [
      { name: 'Type', min: 0, max: 3, display: ['Normal', 'Reverse', 'Sweep 1', 'Sweep 2'] },
      { name: 'Pre-Delay', min: 0, max: 127 },
      { name: 'Gate Time', min: 0, max: 127 },
      { name: 'Level', min: 0, max: 127 },
    ]
  },
  // Multi combinations & Chains 26-40
  { id: 26, name: '26: Overdrive -> Chorus', category: 'Combination', params: [{ name: 'Drive', min: 0, max: 127 }, { name: 'Cho Rate', min: 0, max: 127 }, { name: 'Cho Depth', min: 0, max: 127 }, { name: 'Level', min: 0, max: 127 }] },
  { id: 27, name: '27: Overdrive -> Flanger', category: 'Combination', params: [{ name: 'Drive', min: 0, max: 127 }, { name: 'Flg Rate', min: 0, max: 127 }, { name: 'Flg Depth', min: 0, max: 127 }, { name: 'Level', min: 0, max: 127 }] },
  { id: 28, name: '28: Overdrive -> Delay', category: 'Combination', params: [{ name: 'Drive', min: 0, max: 127 }, { name: 'Delay Time', min: 0, max: 127 }, { name: 'Feedback', min: 0, max: 127 }, { name: 'Level', min: 0, max: 127 }] },
  { id: 29, name: '29: Distortion -> Chorus', category: 'Combination', params: [{ name: 'Drive', min: 0, max: 127 }, { name: 'Cho Rate', min: 0, max: 127 }, { name: 'Cho Depth', min: 0, max: 127 }, { name: 'Level', min: 0, max: 127 }] },
  { id: 30, name: '30: Distortion -> Flanger', category: 'Combination', params: [{ name: 'Drive', min: 0, max: 127 }, { name: 'Flg Rate', min: 0, max: 127 }, { name: 'Flg Depth', min: 0, max: 127 }, { name: 'Level', min: 0, max: 127 }] },
  { id: 31, name: '31: Distortion -> Delay', category: 'Combination', params: [{ name: 'Drive', min: 0, max: 127 }, { name: 'Delay Time', min: 0, max: 127 }, { name: 'Feedback', min: 0, max: 127 }, { name: 'Level', min: 0, max: 127 }] },
  { id: 32, name: '32: Enhancer -> Chorus', category: 'Combination', params: [{ name: 'Sens', min: 0, max: 127 }, { name: 'Cho Rate', min: 0, max: 127 }, { name: 'Cho Depth', min: 0, max: 127 }, { name: 'Level', min: 0, max: 127 }] },
  { id: 33, name: '33: Enhancer -> Flanger', category: 'Combination', params: [{ name: 'Sens', min: 0, max: 127 }, { name: 'Flg Rate', min: 0, max: 127 }, { name: 'Flg Depth', min: 0, max: 127 }, { name: 'Level', min: 0, max: 127 }] },
  { id: 34, name: '34: Enhancer -> Delay', category: 'Combination', params: [{ name: 'Sens', min: 0, max: 127 }, { name: 'Delay Time', min: 0, max: 127 }, { name: 'Feedback', min: 0, max: 127 }, { name: 'Level', min: 0, max: 127 }] },
  { id: 35, name: '35: Chorus -> Delay', category: 'Combination', params: [{ name: 'Cho Rate', min: 0, max: 127 }, { name: 'Cho Depth', min: 0, max: 127 }, { name: 'Delay Time', min: 0, max: 127 }, { name: 'Feedback', min: 0, max: 127 }] },
  { id: 36, name: '36: Flanger -> Delay', category: 'Combination', params: [{ name: 'Flg Rate', min: 0, max: 127 }, { name: 'Flg Feedback', min: 0, max: 127 }, { name: 'Delay Time', min: 0, max: 127 }, { name: 'Feedback', min: 0, max: 127 }] },
  { id: 37, name: '37: Chorus -> Flanger', category: 'Combination', params: [{ name: 'Cho Rate', min: 0, max: 127 }, { name: 'Flg Rate', min: 0, max: 127 }, { name: 'Flg Feedback', min: 0, max: 127 }, { name: 'Level', min: 0, max: 127 }] },
  { id: 38, name: '38: Chorus / Delay', category: 'Combination', params: [{ name: 'Cho Level', min: 0, max: 127 }, { name: 'Delay Time', min: 0, max: 127 }, { name: 'Delay Level', min: 0, max: 127 }, { name: 'Level', min: 0, max: 127 }] },
  { id: 39, name: '39: Flanger / Delay', category: 'Combination', params: [{ name: 'Flg Level', min: 0, max: 127 }, { name: 'Delay Time', min: 0, max: 127 }, { name: 'Delay Level', min: 0, max: 127 }, { name: 'Level', min: 0, max: 127 }] },
  { id: 40, name: '40: Chorus / Flanger', category: 'Combination', params: [{ name: 'Cho Level', min: 0, max: 127 }, { name: 'Flg Level', min: 0, max: 127 }, { name: 'Balance', min: 0, max: 127 }, { name: 'Level', min: 0, max: 127 }] },
  { id: 41, name: '41: Isolator', category: 'Equalizer / Filter', params: [{ name: 'Low Boost/Cut', min: 0, max: 127 }, { name: 'Mid Boost/Cut', min: 0, max: 127 }, { name: 'High Boost/Cut', min: 0, max: 127 }, { name: 'Level', min: 0, max: 127 }] },
  { id: 42, name: '42: 3D Chorus', category: 'Modulation', params: [{ name: 'Pre-Delay', min: 0, max: 127 }, { name: 'Rate', min: 0, max: 127 }, { name: 'Depth', min: 0, max: 127 }, { name: 'Level', min: 0, max: 127 }] },
  { id: 43, name: '43: 3D Flanger', category: 'Modulation', params: [{ name: 'Pre-Delay', min: 0, max: 127 }, { name: 'Rate', min: 0, max: 127 }, { name: 'Depth', min: 0, max: 127 }, { name: 'Feedback', min: 0, max: 127 }] },
  { id: 44, name: '44: 3D Step Flanger', category: 'Modulation', params: [{ name: 'Rate', min: 0, max: 127 }, { name: 'Depth', min: 0, max: 127 }, { name: 'Step Rate', min: 0, max: 127 }, { name: 'Level', min: 0, max: 127 }] },
  { id: 45, name: '45: Band Pass Filter', category: 'Equalizer / Filter', params: [{ name: 'Cutoff Freq', min: 0, max: 127 }, { name: 'Q', min: 0, max: 127 }, { name: 'Level', min: 0, max: 127 }] },
  { id: 46, name: '46: Ring Modulator', category: 'Modulation', params: [{ name: 'Frequency', min: 0, max: 127 }, { name: 'Sens', min: 0, max: 127 }, { name: 'Mix Level', min: 0, max: 127 }, { name: 'Level', min: 0, max: 127 }] },
  { id: 47, name: '47: Stereo Auto Wah', category: 'Equalizer / Filter', params: [{ name: 'Manual', min: 0, max: 127 }, { name: 'Rate', min: 0, max: 127 }, { name: 'Depth', min: 0, max: 127 }, { name: 'Level', min: 0, max: 127 }] },
  { id: 48, name: '48: Step Auto Wah', category: 'Equalizer / Filter', params: [{ name: 'Manual', min: 0, max: 127 }, { name: 'Step Rate', min: 0, max: 127 }, { name: 'Depth', min: 0, max: 127 }, { name: 'Level', min: 0, max: 127 }] },
  { id: 49, name: '49: Guitar Amp Simulator', category: 'Distortion / Amp', params: [{ name: 'Pre-Amp Type', min: 0, max: 127 }, { name: 'Drive', min: 0, max: 127 }, { name: 'Master', min: 0, max: 127 }, { name: 'Speaker', min: 0, max: 127 }] },
  { id: 50, name: '50: Rhodes Rotary', category: 'Modulation', params: [{ name: 'Speed', min: 0, max: 1 }, { name: 'Slow Rate', min: 0, max: 127 }, { name: 'Fast Rate', min: 0, max: 127 }, { name: 'Level', min: 0, max: 127 }] },
  { id: 51, name: '51: VK Rotary', category: 'Modulation', params: [{ name: 'Speed', min: 0, max: 1 }, { name: 'Brake', min: 0, max: 1 }, { name: 'Horn/Rotor', min: 0, max: 127 }, { name: 'Level', min: 0, max: 127 }] },
  { id: 52, name: '52: Keyboard Multi', category: 'Multi', params: [{ name: 'Ring Mod Freq', min: 0, max: 127 }, { name: 'Phaser Rate', min: 0, max: 127 }, { name: 'Pitch Shift', min: 40, max: 88, offset: 64 }, { name: 'Level', min: 0, max: 127 }] },
  { id: 53, name: '53: Guitar Multi', category: 'Multi', params: [{ name: 'Drive', min: 0, max: 127 }, { name: 'Amp Type', min: 0, max: 127 }, { name: 'Cho Rate', min: 0, max: 127 }, { name: 'Delay Time', min: 0, max: 127 }] },
  { id: 54, name: '54: Vocal Multi', category: 'Multi', params: [{ name: 'Compressor', min: 0, max: 127 }, { name: 'De-Esser', min: 0, max: 127 }, { name: 'Delay Time', min: 0, max: 127 }, { name: 'Reverb Level', min: 0, max: 127 }] },
  { id: 55, name: '55: Clean Guitar Multi', category: 'Multi', params: [{ name: 'Comp', min: 0, max: 127 }, { name: 'EQ Mid', min: 49, max: 79, offset: 64 }, { name: 'Chorus', min: 0, max: 127 }, { name: 'Delay', min: 0, max: 127 }] },
  { id: 56, name: '56: Bass Multi', category: 'Multi', params: [{ name: 'Comp Threshold', min: 0, max: 127 }, { name: 'Drive', min: 0, max: 127 }, { name: 'Low Freq', min: 0, max: 127 }, { name: 'Level', min: 0, max: 127 }] },
  { id: 57, name: '57: Rotary Multi', category: 'Multi', params: [{ name: 'Drive', min: 0, max: 127 }, { name: 'Rotary Speed', min: 0, max: 1 }, { name: 'Separation', min: 0, max: 127 }, { name: 'Level', min: 0, max: 127 }] },
  { id: 58, name: '58: Short Delay', category: 'Delay', params: [{ name: 'Delay Time', min: 0, max: 127 }, { name: 'Feedback', min: 0, max: 127 }, { name: 'HF Damp', min: 0, max: 17 }, { name: 'Level', min: 0, max: 127 }] },
  { id: 59, name: '59: Auto Pan', category: 'Modulation', params: [{ name: 'Waveform', min: 0, max: 3 }, { name: 'Rate', min: 0, max: 127 }, { name: 'Depth', min: 0, max: 127 }, { name: 'Level', min: 0, max: 127 }] },
  { id: 60, name: '60: Tremolo', category: 'Modulation', params: [{ name: 'Waveform', min: 0, max: 3 }, { name: 'Rate', min: 0, max: 127 }, { name: 'Depth', min: 0, max: 127 }, { name: 'Level', min: 0, max: 127 }] },
  { id: 61, name: '61: Slicer', category: 'Modulation', params: [{ name: 'Pattern', min: 0, max: 19 }, { name: 'Rate', min: 0, max: 127 }, { name: 'Attack', min: 0, max: 127 }, { name: 'Level', min: 0, max: 127 }] },
  { id: 62, name: '62: Phono Noise', category: 'Lo-Fi', params: [{ name: 'Disc Type', min: 0, max: 2 }, { name: 'Noise Level', min: 0, max: 127 }, { name: 'Tone', min: 0, max: 127 }, { name: 'Level', min: 0, max: 127 }] },
  { id: 63, name: '63: Lo-Fi Processor', category: 'Lo-Fi', params: [{ name: 'Bit Down', min: 0, max: 7 }, { name: 'Sample Rate', min: 0, max: 31 }, { name: 'Post Gain', min: 0, max: 127 }, { name: 'Level', min: 0, max: 127 }] },
  { id: 64, name: '64: Radio Tuning', category: 'Lo-Fi', params: [{ name: 'Detune', min: 0, max: 127 }, { name: 'Noise', min: 0, max: 127 }, { name: 'Bandwidth', min: 0, max: 127 }, { name: 'Level', min: 0, max: 127 }] },
  { id: 65, name: '65: Noise Generator', category: 'Lo-Fi', params: [{ name: 'Noise Type', min: 0, max: 3 }, { name: 'Cutoff', min: 0, max: 127 }, { name: 'Noise Level', min: 0, max: 127 }, { name: 'Level', min: 0, max: 127 }] },
  { id: 66, name: '66: Overdrive 2', category: 'Distortion / Amp', params: [{ name: 'Drive', min: 0, max: 127 }, { name: 'Tone', min: 0, max: 127 }, { name: 'Bottom', min: 0, max: 127 }, { name: 'Level', min: 0, max: 127 }] },
  { id: 67, name: '67: Distortion 2', category: 'Distortion / Amp', params: [{ name: 'Drive', min: 0, max: 127 }, { name: 'Tone', min: 0, max: 127 }, { name: 'Edge', min: 0, max: 127 }, { name: 'Level', min: 0, max: 127 }] },
  { id: 68, name: '68: Multi-Stage Phaser', category: 'Modulation', params: [{ name: 'Mode', min: 0, max: 4, display: ['4-Stage', '8-Stage', '12-Stage', '16-Stage', '24-Stage'] }, { name: 'Rate', min: 0, max: 127 }, { name: 'Depth', min: 0, max: 127 }, { name: 'Feedback', min: 0, max: 127 }] },
  { id: 69, name: '69: Compressor 2', category: 'Dynamics', params: [{ name: 'Threshold', min: 0, max: 127 }, { name: 'Attack', min: 0, max: 127 }, { name: 'Release', min: 0, max: 127 }, { name: 'Gain', min: 0, max: 127 }] },
  { id: 70, name: '70: Limiter 2', category: 'Dynamics', params: [{ name: 'Threshold', min: 0, max: 127 }, { name: 'Release', min: 0, max: 127 }, { name: 'Post Gain', min: 0, max: 127 }, { name: 'Level', min: 0, max: 127 }] },
  { id: 71, name: '71: Stereo Pitch Shifter', category: 'Pitch Shift', params: [{ name: 'Coarse', min: 40, max: 88, offset: 64 }, { name: 'Fine', min: 14, max: 114, offset: 64 }, { name: 'Feedback', min: 0, max: 127 }, { name: 'Level', min: 0, max: 127 }] },
  { id: 72, name: '72: Delay -> Chorus', category: 'Combination', params: [{ name: 'Delay Time', min: 0, max: 127 }, { name: 'Feedback', min: 0, max: 127 }, { name: 'Cho Rate', min: 0, max: 127 }, { name: 'Cho Depth', min: 0, max: 127 }] },
  { id: 73, name: '73: Reverb 2', category: 'Reverb', params: [{ name: 'Type', min: 0, max: 5 }, { name: 'Time', min: 0, max: 127 }, { name: 'HF Damp', min: 0, max: 17 }, { name: 'Level', min: 0, max: 127 }] },
  { id: 74, name: '74: 3D Delay', category: 'Delay', params: [{ name: 'Delay Time', min: 0, max: 127 }, { name: 'Feedback', min: 0, max: 127 }, { name: 'Azimuth', min: 0, max: 127 }, { name: 'Level', min: 0, max: 127 }] },
  { id: 75, name: '75: 3D Rotary', category: 'Modulation', params: [{ name: 'Speed', min: 0, max: 1 }, { name: 'Separation', min: 0, max: 127 }, { name: 'Horn Level', min: 0, max: 127 }, { name: 'Rotor Level', min: 0, max: 127 }] },
  { id: 76, name: '76: 3D Auto Pan', category: 'Modulation', params: [{ name: 'Rate', min: 0, max: 127 }, { name: 'Depth', min: 0, max: 127 }, { name: 'Direction', min: 0, max: 1 }, { name: 'Level', min: 0, max: 127 }] },
  { id: 77, name: '77: 4-Band EQ', category: 'Equalizer / Filter', params: [{ name: 'Low Freq', min: 0, max: 1 }, { name: 'Low Gain', min: 49, max: 79, offset: 64 }, { name: 'Mid 1 Gain', min: 49, max: 79, offset: 64 }, { name: 'Mid 2 Gain', min: 49, max: 79, offset: 64 }, { name: 'High Gain', min: 49, max: 79, offset: 64 }, { name: 'Level', min: 0, max: 127 }] },
  { id: 78, name: '78: Mastering Limiter', category: 'Dynamics', params: [{ name: 'Threshold', min: 0, max: 127 }, { name: 'Release', min: 0, max: 127 }, { name: 'Post Gain', min: 0, max: 127 }, { name: 'Ceiling', min: 0, max: 127 }] },
  { id: 79, name: '79: Enhancer 2', category: 'Equalizer / Filter', params: [{ name: 'Sens', min: 0, max: 127 }, { name: 'Frequency', min: 0, max: 127 }, { name: 'Mix', min: 0, max: 127 }, { name: 'Level', min: 0, max: 127 }] },
  { id: 80, name: '80: Auto Wah 2', category: 'Equalizer / Filter', params: [{ name: 'Manual', min: 0, max: 127 }, { name: 'Sens', min: 0, max: 127 }, { name: 'Rate', min: 0, max: 127 }, { name: 'Depth', min: 0, max: 127 }] },
  { id: 81, name: '81: Humanizer', category: 'Equalizer / Filter', params: [{ name: 'Vowel 1', min: 0, max: 4, display: ['a', 'e', 'i', 'o', 'u'] }, { name: 'Vowel 2', min: 0, max: 4, display: ['a', 'e', 'i', 'o', 'u'] }, { name: 'Rate', min: 0, max: 127 }, { name: 'Depth', min: 0, max: 127 }] },
  { id: 82, name: '82: Speaker Simulator', category: 'Distortion / Amp', params: [{ name: 'Cabinet Type', min: 0, max: 15 }, { name: 'Mic Pos', min: 0, max: 1 }, { name: 'Tone', min: 0, max: 127 }, { name: 'Level', min: 0, max: 127 }] },
  { id: 83, name: '83: Feedbacker', category: 'Distortion / Amp', params: [{ name: 'Mode', min: 0, max: 1 }, { name: 'Depth', min: 0, max: 127 }, { name: 'Feedback', min: 0, max: 127 }, { name: 'Level', min: 0, max: 127 }] },
  { id: 84, name: '84: Stereo Reverb', category: 'Reverb', params: [{ name: 'Type', min: 0, max: 5 }, { name: 'Pre-Delay', min: 0, max: 127 }, { name: 'Time', min: 0, max: 127 }, { name: 'Level', min: 0, max: 127 }] },
  { id: 85, name: '85: Stereo Mod Delay', category: 'Delay', params: [{ name: 'Delay Time', min: 0, max: 127 }, { name: 'Rate', min: 0, max: 127 }, { name: 'Depth', min: 0, max: 127 }, { name: 'Level', min: 0, max: 127 }] },
  { id: 86, name: '86: 3-Tap Pan Delay', category: 'Delay', params: [{ name: 'Tap 1 Time', min: 0, max: 127 }, { name: 'Tap 2 Time', min: 0, max: 127 }, { name: 'Tap 3 Time', min: 0, max: 127 }, { name: 'Feedback', min: 0, max: 127 }] },
  { id: 87, name: '87: 4-Tap Pan Delay', category: 'Delay', params: [{ name: 'Tap 1 Time', min: 0, max: 127 }, { name: 'Tap 2 Time', min: 0, max: 127 }, { name: 'Tap 3 Time', min: 0, max: 127 }, { name: 'Tap 4 Time', min: 0, max: 127 }] },
  { id: 88, name: '88: Chorus -> Delay -> Reverb', category: 'Multi', params: [{ name: 'Cho Level', min: 0, max: 127 }, { name: 'Delay Time', min: 0, max: 127 }, { name: 'Rev Level', min: 0, max: 127 }, { name: 'Master Level', min: 0, max: 127 }] },
  { id: 89, name: '89: Flanger -> Delay -> Reverb', category: 'Multi', params: [{ name: 'Flg Level', min: 0, max: 127 }, { name: 'Delay Time', min: 0, max: 127 }, { name: 'Rev Level', min: 0, max: 127 }, { name: 'Master Level', min: 0, max: 127 }] },
  { id: 90, name: '90: Multi-Effects Chain', category: 'Multi', params: [{ name: 'Drive', min: 0, max: 127 }, { name: 'Chorus', min: 0, max: 127 }, { name: 'Delay', min: 0, max: 127 }, { name: 'Master Level', min: 0, max: 127 }] },
];

/**
 * Controller source definitions for MFX Matrix Modulation (Ctrl 1-4).
 * Values 0-101.
 */
const CC_LABELS = {
  1: 'CC 01: Modulation',
  2: 'CC 02: Breath Controller',
  4: 'CC 04: Foot Controller',
  5: 'CC 05: Portamento Time',
  7: 'CC 07: Volume',
  8: 'CC 08: Balance',
  10: 'CC 10: Pan',
  11: 'CC 11: Expression',
  64: 'CC 64: Hold 1 (Damper)',
  65: 'CC 65: Portamento',
  66: 'CC 66: Sostenuto',
  67: 'CC 67: Soft Pedal',
  71: 'CC 71: Resonance',
  72: 'CC 72: Release Time',
  73: 'CC 73: Attack Time',
  74: 'CC 74: Cutoff Freq',
};

export const MFX_CTRL_SOURCES = [
  'OFF',
  ...Array.from({ length: 31 }, (_, i) => {
    const cc = i + 1;
    return CC_LABELS[cc] || `CC ${String(cc).padStart(2, '0')}`;
  }),
  ...Array.from({ length: 63 }, (_, i) => {
    const cc = i + 33;
    return CC_LABELS[cc] || `CC ${String(cc).padStart(2, '0')}`;
  }),
  'BEND: Pitch Bend',
  'AFT: Aftertouch',
  'SYS-CTRL 1',
  'SYS-CTRL 2',
  'SYS-CTRL 3',
  'SYS-CTRL 4',
];

/**
 * Get MFX metadata by algorithm index (0-90).
 */
export function getMfxAlgorithm(typeId) {
  return MFX_CATALOG[typeId] || {
    id: typeId,
    name: `Algorithm ${typeId}`,
    category: 'Other',
    params: Array.from({ length: 12 }, (_, i) => ({ name: `Param ${i + 1}`, min: 0, max: 127 }))
  };
}
