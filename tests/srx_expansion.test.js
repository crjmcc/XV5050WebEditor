import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { SRX_BOARDS, getSrxBoard, getSrxWaveforms } from '../src/srx_data.js';

describe('Roland SRX Expansion Boards Catalog', () => {
  test('SRX catalog contains all 12 official Roland SRX expansion boards', () => {
    assert.equal(SRX_BOARDS.length, 12);
    const ids = SRX_BOARDS.map(b => b.id);
    assert.deepEqual(ids, [
      'SRX-01', 'SRX-02', 'SRX-03', 'SRX-04',
      'SRX-05', 'SRX-06', 'SRX-07', 'SRX-08',
      'SRX-09', 'SRX-10', 'SRX-11', 'SRX-12'
    ]);
  });

  test('getSrxBoard retrieves board metadata by ID case-insensitively', () => {
    const srx7 = getSrxBoard('srx-07');
    assert.ok(srx7);
    assert.equal(srx7.name, 'SRX-07 Ultimate Keys');
    assert.equal(srx7.category, 'Vintage Keyboards');
    assert.equal(srx7.waveCount, 475);

    const srx1 = getSrxBoard('SRX-01');
    assert.ok(srx1);
    assert.equal(srx1.name, 'SRX-01 Dynamic Drum Kits');
    assert.equal(srx1.waveCount, 88);

    assert.equal(getSrxBoard('NONE'), null);
    assert.equal(getSrxBoard(''), null);
  });

  test('getSrxWaveforms generates correct number of named waveforms', () => {
    const waves7 = getSrxWaveforms('SRX-07');
    assert.equal(waves7.length, 475);
    assert.ok(waves7[0].includes('Rhodes MkI Stage mf'));
    assert.ok(waves7[3].includes('Wurly 200A Tremolo'));

    const waves1 = getSrxWaveforms('SRX-01');
    assert.equal(waves1.length, 88);
    assert.ok(waves1[0].includes('Dyn Dry Kick 1'));
  });
});

