import test from 'node:test';
import assert from 'node:assert/strict';
import { OliCanvas } from '../src/renderer.js';

test('animation lifecycle pauses, handles visibility/reduced motion, and cleans up on remount', () => {
  const callbacks = new Map();
  let next = 0;
  let draws = 0;
  const documentEvents = new Map(), motionEvents = new Map();
  const media = { matches: false, addEventListener: (k, fn) => motionEvents.set(k, fn), removeEventListener: k => motionEvents.delete(k) };
  const observers = [];
  class Observer {
    constructor(callback) { this.callback = callback; this.disconnected = false; observers.push(this); }
    observe() {}
    disconnect() { this.disconnected = true; }
  }
  const mockDocument = { hidden: false, addEventListener: (k, fn) => documentEvents.set(k, fn), removeEventListener: k => documentEvents.delete(k) };
  const originals = new Map();
  const globals = { document: mockDocument, window: { devicePixelRatio: 3 }, matchMedia: () => media, ResizeObserver: Observer, IntersectionObserver: Observer,
    requestAnimationFrame: fn => { callbacks.set(++next, fn); return next; }, cancelAnimationFrame: id => callbacks.delete(id) };
  for (const [key, value] of Object.entries(globals)) { originals.set(key, Object.getOwnPropertyDescriptor(globalThis, key)); Object.defineProperty(globalThis, key, { configurable: true, writable: true, value }); }
  const ctx = { setTransform() {}, clearRect() {}, beginPath() {}, arc(...args) { assert.ok(args.every(Number.isFinite)); }, fill() { draws++; } };
  const canvas = { getContext: () => ctx, getBoundingClientRect: () => ({ width: 240, height: 240 }) };
  try {
    const oli = new OliCanvas(canvas, { particles: 100 });
    assert.equal(callbacks.size, 1);
    assert.equal(canvas.width, 480, 'pixel density is capped at 2');
    oli.setOptions({ paused: true });
    assert.equal(callbacks.size, 0);
    const prior = draws;
    oli.setState('happy');
    assert.ok(draws > prior, 'state changes are visible while paused');
    assert.equal(oli.pose.face, 1);
    oli.setOptions({ paused: false });
    assert.equal(callbacks.size, 1);
    mockDocument.hidden = true; documentEvents.get('visibilitychange')();
    assert.equal(callbacks.size, 0);
    mockDocument.hidden = false; documentEvents.get('visibilitychange')();
    assert.equal(callbacks.size, 1);
    media.matches = true; motionEvents.get('change')();
    assert.equal(callbacks.size, 0);
    oli.setState('idle'); assert.equal(oli.pose.face, 0);
    oli.destroy();
    assert.equal(documentEvents.size, 0); assert.equal(motionEvents.size, 0);
    assert.ok(observers.every(o => o.disconnected));
    const remount = new OliCanvas(canvas, { state: 'listening', particles: 100 });
    assert.equal(callbacks.size, 0, 'a reduced-motion remount stays static');
    assert.equal(remount.pose.face, 1);
    remount.destroy();
  } finally {
    for (const [key, descriptor] of originals) { if (descriptor) Object.defineProperty(globalThis, key, descriptor); else delete globalThis[key]; }
  }
});
