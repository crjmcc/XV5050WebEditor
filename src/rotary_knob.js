/**
 * Precision Hardware-Style Rotary Knob Component
 * 
 * Replaces bulky horizontal/vertical sliders with compact, responsive audio knobs.
 * Features:
 * - 270-degree rotational throw (-135° to +135°)
 * - Glowing SVG arc meter (unipolar 0->max or bipolar center->L/R)
 * - Pointer needle rotation
 * - Vertical drag adjustment with Shift key fine-tune (1/4 speed)
 * - Mouse wheel adjustment
 * - Double-click to reset to default
 * - Value formatting callback
 */

export class RotaryKnob {
  /**
   * @param {HTMLElement|string} target - Container element or ID
   * @param {object} options
   */
  constructor(target, options = {}) {
    this.container = typeof target === 'string' ? document.getElementById(target) : target;
    if (!this.container) {
      throw new Error(`RotaryKnob target element not found: ${target}`);
    }

    this.id = options.id || `knob_${Math.random().toString(36).substr(2, 9)}`;
    this.min = options.min ?? 0;
    this.max = options.max ?? 127;
    this.defaultValue = options.defaultValue ?? options.value ?? Math.round((this.min + this.max) / 2);
    this.value = options.value ?? this.defaultValue;
    this.label = options.label || '';
    this.bipolar = !!options.bipolar;
    this.color = options.color || 'var(--accent, #ff7700)';
    this.size = options.size || 34;
    this.formatValue = options.formatValue || ((v) => String(v));
    this.onChange = options.onChange || null;

    this.isDragging = false;
    this.startY = 0;
    this.startVal = 0;

    this._render();
    this._bindEvents();
    this.setValue(this.value, false);
  }

  _render() {
    this.container.classList.add('rotary-knob-wrapper');
    const size = this.size;
    this.container.innerHTML = `
      <div class="rotary-knob" id="${this.id}" tabindex="0" role="slider" aria-valuemin="${this.min}" aria-valuemax="${this.max}" aria-valuenow="${this.value}">
        ${this.label ? `<span class="rotary-knob-label">${this.label}</span>` : ''}
        <div class="rotary-knob-dial" style="width:${size}px; height:${size}px;">
          <svg class="rotary-knob-svg" viewBox="0 0 44 44" width="${size}" height="${size}">
            <!-- Background Track Arc (270 deg from 135 to 405) -->
            <circle class="knob-track" cx="22" cy="22" r="16" fill="none" stroke="rgba(255,255,255,0.14)" stroke-width="3" stroke-linecap="round" stroke-dasharray="75.4 100" stroke-dashoffset="0" transform="rotate(135, 22, 22)" />
            <!-- Active Fill Arc -->
            <circle class="knob-fill" cx="22" cy="22" r="16" fill="none" stroke="${this.color}" stroke-width="3.2" stroke-linecap="round" stroke-dasharray="0 100" stroke-dashoffset="0" transform="rotate(135, 22, 22)" />
            <!-- Center Knob Body -->
            <circle class="knob-face" cx="22" cy="22" r="11.5" fill="#141926" stroke="#2a354d" stroke-width="1.2" />
            <!-- Needle Pointer -->
            <line class="knob-pointer" x1="22" y1="22" x2="22" y2="12" stroke="#ffffff" stroke-width="2" stroke-linecap="round" />
          </svg>
        </div>
        <span class="rotary-knob-val" title="Drag or scroll to adjust, double-click to reset">${this.formatValue(this.value)}</span>
      </div>
    `;

    this.fillArc = this.container.querySelector('.knob-fill');
    this.pointer = this.container.querySelector('.knob-pointer');
    this.valDisplay = this.container.querySelector('.rotary-knob-val');
    this.knobEl = this.container.querySelector('.rotary-knob');
  }

  _bindEvents() {
    const dial = this.container.querySelector('.rotary-knob-dial');
    const dragTarget = dial;
    if (!dragTarget) return;

    const startDrag = (e) => {
      this.isDragging = true;
      this.startY = e.clientY;
      this.startVal = this.value;
      try { dragTarget.setPointerCapture(e.pointerId); } catch (_) {}
      this.knobEl.classList.add('active');
      e.preventDefault();
    };

    dragTarget.addEventListener('pointerdown', startDrag);

    dragTarget.addEventListener('pointermove', (e) => {
      if (!this.isDragging) return;
      const deltaY = this.startY - e.clientY;
      const range = this.max - this.min;
      const speedMultiplier = e.shiftKey ? 0.25 : 1.0;
      // 100 vertical pixels spans the full range
      const stepDelta = Math.round((deltaY / 100) * range * speedMultiplier);
      const newVal = Math.min(this.max, Math.max(this.min, this.startVal + stepDelta));
      if (newVal !== this.value) {
        this.setValue(newVal, true);
      }
    });

    const stopDrag = (e) => {
      if (this.isDragging) {
        this.isDragging = false;
        try { dragTarget.releasePointerCapture(e.pointerId); } catch (_) {}
        this.knobEl.classList.remove('active');
      }
    };

    dragTarget.addEventListener('pointerup', stopDrag);
    dragTarget.addEventListener('pointercancel', stopDrag);

    // Mouse wheel support anywhere on knob wrapper
    const onWheel = (e) => {
      e.preventDefault();
      e.stopPropagation();
      const step = (this.max - this.min) > 50 ? (e.shiftKey ? 1 : 2) : 1;
      const delta = e.deltaY < 0 ? step : -step;
      const newVal = Math.min(this.max, Math.max(this.min, this.value + delta));
      if (newVal !== this.value) {
        this.setValue(newVal, true);
      }
    };
    this.container.addEventListener('wheel', onWheel, { passive: false, capture: true });

    // Double-click to reset on dial or value badge
    dragTarget.addEventListener('dblclick', (e) => {
      e.preventDefault();
      this.setValue(this.defaultValue, true);
    });

    if (this.valDisplay) {
      this.valDisplay.addEventListener('dblclick', (e) => {
        e.preventDefault();
        e.stopPropagation();
        this.setValue(this.defaultValue, true);
      });
    }

    // Keyboard support
    this.knobEl.addEventListener('keydown', (e) => {
      let delta = 0;
      if (e.key === 'ArrowUp' || e.key === 'ArrowRight') delta = 1;
      else if (e.key === 'ArrowDown' || e.key === 'ArrowLeft') delta = -1;
      else if (e.key === 'PageUp') delta = 10;
      else if (e.key === 'PageDown') delta = -10;
      else if (e.key === 'Home') delta = this.min - this.value;
      else if (e.key === 'End') delta = this.max - this.value;

      if (delta !== 0) {
        e.preventDefault();
        const newVal = Math.min(this.max, Math.max(this.min, this.value + delta));
        if (newVal !== this.value) {
          this.setValue(newVal, true);
        }
      }
    });
  }

  /**
   * Set knob value and update visuals
   * @param {number} val
   * @param {boolean} fireChange
   */
  setValue(val, fireChange = false) {
    this.value = Math.min(this.max, Math.max(this.min, Math.round(val)));
    
    // Circumference of r=16 circle = 2 * PI * 16 = 100.531
    // 270-degree arc portion = 100.531 * (270 / 360) = 75.398
    const totalArc = 75.4;
    const halfArc = totalArc / 2; // 37.7 (center at 12 o'clock)

    let angle = 0;
    if (this.bipolar) {
      const centerVal = this.defaultValue !== undefined ? this.defaultValue : Math.round((this.min + this.max) / 2);
      const diff = this.value - centerVal;
      const maxRange = diff >= 0 ? (this.max - centerVal || 1) : (centerVal - this.min || 1);
      const normDiff = diff / maxRange; // -1.0 to +1.0
      angle = normDiff * 135; // -135deg at min, 0deg at center, +135deg at max
      
      const arcLength = Math.abs(normDiff) * halfArc;
      if (this.fillArc) {
        if (diff >= 0) {
          // Positive arc from 12 o'clock clockwise towards max
          this.fillArc.setAttribute('stroke-dasharray', `${arcLength.toFixed(1)} 100`);
          this.fillArc.setAttribute('stroke-dashoffset', `${(-halfArc).toFixed(2)}`);
        } else {
          // Negative arc from current needle position clockwise to 12 o'clock
          const startOffset = -(halfArc - arcLength);
          this.fillArc.setAttribute('stroke-dasharray', `${arcLength.toFixed(1)} 100`);
          this.fillArc.setAttribute('stroke-dashoffset', `${startOffset.toFixed(2)}`);
        }
      }
    } else {
      // Unipolar: 0.0 -> 1.0 ratio
      const ratio = (this.value - this.min) / (this.max - this.min || 1);
      angle = -135 + ratio * 270;
      
      if (this.fillArc) {
        // Unipolar: Arc starts at 0 (7:30, offset 0) and grows clockwise with the encoder needle
        const arcLen = ratio * totalArc;
        this.fillArc.setAttribute('stroke-dasharray', `${arcLen.toFixed(1)} 100`);
        this.fillArc.setAttribute('stroke-dashoffset', '0');
      }
    }

    if (this.pointer) {
      this.pointer.setAttribute('transform', `rotate(${angle.toFixed(1)}, 22, 22)`);
    }

    if (this.valDisplay) {
      this.valDisplay.textContent = this.formatValue(this.value);
    }

    if (this.knobEl) {
      this.knobEl.setAttribute('aria-valuenow', this.value);
    }

    if (fireChange && typeof this.onChange === 'function') {
      this.onChange(this.value, this);
    }
  }

  getValue() {
    return this.value;
  }
}

/**
 * Convenience helper to create multiple knobs
 */
export function createKnob(containerId, options) {
  return new RotaryKnob(containerId, options);
}

/**
 * Creates a RotaryKnob that is fully bidirectionally synchronized with an underlying input element.
 * Retains the input element in the DOM for full compatibility with existing SysEx & test harnesses,
 * while replacing the visual slider presentation with a compact hardware-style rotary encoder.
 * 
 * @param {HTMLElement|string} containerTarget - Knob container element or ID
 * @param {HTMLInputElement|string} inputTarget - Underlying input element or ID
 * @param {object} [options] - Knob configuration options
 * @returns {RotaryKnob|null}
 */
export function createSyncedKnob(containerTarget, inputTarget, options = {}) {
  const container = typeof containerTarget === 'string' ? document.getElementById(containerTarget) : containerTarget;
  const input = typeof inputTarget === 'string' ? document.getElementById(inputTarget) : inputTarget;
  if (!container || !input) return null;

  const min = options.min ?? (input.min !== '' ? parseFloat(input.min) : 0);
  const max = options.max ?? (input.max !== '' ? parseFloat(input.max) : 127);
  const defaultValue = options.defaultValue ?? (input.defaultValue !== '' ? parseFloat(input.defaultValue) : Math.round((min + max) / 2));
  const initialVal = input.value !== '' ? parseFloat(input.value) : defaultValue;
  const bipolar = options.bipolar ?? false;
  const size = options.size ?? 28;
  const color = options.color || 'var(--accent, #ff7700)';
  const label = options.label || '';
  const formatValue = options.formatValue || ((v) => {
    if (bipolar) return v > 0 ? `+${v}` : `${v}`;
    return String(v);
  });

  const knob = new RotaryKnob(container, {
    min,
    max,
    defaultValue,
    value: initialVal,
    label,
    bipolar,
    size,
    color,
    formatValue,
    onChange: (val) => {
      input.value = val;
      input.dispatchEvent(new Event('input', { bubbles: true }));
      input.dispatchEvent(new Event('change', { bubbles: true }));
      if (typeof options.onChange === 'function') {
        options.onChange(val, knob);
      }
    }
  });

  // Intercept direct value assignments so programmatic changes (like SysEx updates) sync the knob
  try {
    const proto = typeof window !== 'undefined' && window.HTMLInputElement ? window.HTMLInputElement.prototype : Object.getPrototypeOf(input);
    const descriptor = Object.getOwnPropertyDescriptor(proto, 'value');
    if (descriptor && descriptor.get && descriptor.set) {
      Object.defineProperty(input, 'value', {
        configurable: true,
        get() {
          return descriptor.get.call(this);
        },
        set(val) {
          descriptor.set.call(this, val);
          const parsed = parseFloat(val);
          if (!isNaN(parsed) && knob.value !== parsed) {
            knob.setValue(parsed, false);
          }
        }
      });
    }
  } catch (_) {}

  // Automatically update knob whenever underlying input value changes (e.g. from incoming SysEx or tests)
  input.addEventListener('input', () => {
    const parsed = parseFloat(input.value);
    if (!isNaN(parsed) && knob.value !== parsed) {
      knob.setValue(parsed, false);
    }
  });

  // Hide the original slider
  input.style.display = 'none';

  return knob;
}
