import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

// Simple mock for browser DOM environment in node tests
class MockElement {
  constructor(tag = 'div') {
    this.tagName = tag.toUpperCase();
    this.classList = {
      _classes: new Set(),
      add(c) { this._classes.add(c); },
      remove(c) { this._classes.delete(c); },
      contains(c) { return this._classes.has(c); }
    };
    this.attributes = {};
    this.style = {};
    this.innerHTML = '';
    this.listeners = {};
  }

  setAttribute(k, v) { this.attributes[k] = String(v); }
  getAttribute(k) { return this.attributes[k] ?? null; }
  addEventListener(event, fn) {
    if (!this.listeners[event]) this.listeners[event] = [];
    this.listeners[event].push(fn);
  }
  querySelector(sel) {
    if (!this._children) this._children = {};
    if (!this._children[sel]) this._children[sel] = new MockElement();
    return this._children[sel];
  }
  querySelectorAll(sel) {
    return [this.querySelector(sel)];
  }
}

// Global DOM mocks for Node testing
globalThis.document = {
  getElementById: (id) => new MockElement(),
  createElement: (tag) => new MockElement(tag)
};

import { RotaryKnob, createKnob } from '../src/rotary_knob.js';

describe('Precision Hardware Rotary Knob Component', () => {
  test('creates unipolar knob with default values and clamping', () => {
    const mockContainer = new MockElement();
    let changeVal = null;

    const knob = new RotaryKnob(mockContainer, {
      id: 'testCutoff',
      min: 0,
      max: 127,
      defaultValue: 100,
      value: 64,
      onChange: (v) => { changeVal = v; }
    });

    assert.equal(knob.getValue(), 64);

    // setValue within range
    knob.setValue(80, true);
    assert.equal(knob.getValue(), 80);
    assert.equal(changeVal, 80);

    // Clamping above max
    knob.setValue(200, true);
    assert.equal(knob.getValue(), 127);
    assert.equal(changeVal, 127);

    // Clamping below min
    knob.setValue(-50, true);
    assert.equal(knob.getValue(), 0);
    assert.equal(changeVal, 0);

    // Verify arc geometry starts at 0 (min) and stroke-dashoffset is 0
    assert.equal(knob.fillArc.getAttribute('stroke-dashoffset'), '0');
    assert.equal(knob.fillArc.getAttribute('stroke-dasharray'), '0.0 100');

    // At 50% value (64 / 127)
    knob.setValue(64);
    assert.equal(knob.fillArc.getAttribute('stroke-dashoffset'), '0');
    const expectedHalfArc = ((64 / 127) * 75.4).toFixed(1);
    assert.equal(knob.fillArc.getAttribute('stroke-dasharray'), `${expectedHalfArc} 100`);

    // At max value (127)
    knob.setValue(127);
    assert.equal(knob.fillArc.getAttribute('stroke-dashoffset'), '0');
    assert.equal(knob.fillArc.getAttribute('stroke-dasharray'), '75.4 100');
  });

  test('creates bipolar knob with formatting and center-out arc geometry', () => {
    const mockContainer = new MockElement();
    const knob = createKnob(mockContainer, {
      id: 'testPan',
      min: 0,
      max: 127,
      defaultValue: 64,
      value: 64,
      bipolar: true,
      formatValue: (v) => v === 64 ? 'C' : v < 64 ? `L${64 - v}` : `${v - 64}R`
    });

    assert.equal(knob.bipolar, true);
    assert.equal(knob.formatValue(64), 'C');
    assert.equal(knob.formatValue(32), 'L32');
    assert.equal(knob.formatValue(96), '32R');

    // Center value (64) -> arcLength is 0
    knob.setValue(64);
    assert.equal(knob.fillArc.getAttribute('stroke-dasharray'), '0.0 100');

    // Positive value (e.g. 96 -> pan right) -> starts at 12 o'clock (-37.70)
    knob.setValue(96);
    assert.equal(knob.fillArc.getAttribute('stroke-dashoffset'), '-37.70');
    assert.ok(parseFloat(knob.fillArc.getAttribute('stroke-dasharray')) > 0);

    // Negative value (e.g. 32 -> pan left) -> starts at needle position and reaches 12 o'clock
    knob.setValue(32);
    const negOffset = parseFloat(knob.fillArc.getAttribute('stroke-dashoffset'));
    assert.ok(negOffset > -37.70 && negOffset < 0);
  });
});
