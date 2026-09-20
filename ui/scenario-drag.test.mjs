import test from 'node:test';
import assert from 'node:assert/strict';
import { installScenarioDrag } from './public/scenario-drag.js';

class Element {
  constructor(parent = null, dataset = {}) {
    this.parent = parent;
    this.dataset = dataset;
    this.listeners = {};
    this.style = {};
    this.classes = new Set();
    this.classList = {
      add: (...names) => names.forEach(name => this.classes.add(name)),
      remove: (...names) => names.forEach(name => this.classes.delete(name)),
      toggle: (name, value) => value ? this.classes.add(name) : this.classes.delete(name),
    };
    this.scrollLeft = 0;
  }
  addEventListener(type, fn) { (this.listeners[type] ||= []).push(fn); }
  emit(type, event) { for (const fn of this.listeners[type] || []) fn(event); }
  contains(node) { return node === this || Boolean(node?.parent && this.contains(node.parent)); }
  closest(selector) {
    if (selector.includes('data-insert-index') && this.dataset.insertIndex !== undefined) return this;
    if (selector.includes('data-step-index') && this.dataset.stepIndex !== undefined) return this;
    if (selector.includes('data-endpoint-id') && this.dataset.endpointId !== undefined) return this;
    return this.parent?.closest(selector) || null;
  }
  querySelector() { return null; }
  querySelectorAll() { return []; }
  getBoundingClientRect() { return this.rect || { left: 100, top: 100, right: 340, bottom: 240, width: 240, height: 140 }; }
  setPointerCapture(id) { this.capture = id; }
  hasPointerCapture(id) { return this.capture === id; }
  releasePointerCapture() { this.capture = null; }
  cloneNode() { return new Element(); }
  setAttribute() {}
  removeAttribute() {}
  remove() { this.removed = true; }
}

function fixture() {
  const doc = new Element();
  const win = new Element();
  const canvas = new Element();
  const board = new Element(canvas);
  const shelf = new Element();
  const card = new Element(shelf, { endpointId: 'example' });
  const existing = new Element(board, { stepIndex: '2' });
  const arrow = new Element(board, { insertIndex: '1' });
  arrow.rect = { left: 400, top: 150, width: 56, height: 44, right: 456, bottom: 194 };
  board.querySelectorAll = selector => selector === '.dropTarget' ? [arrow] : [existing];
  let hit = arrow;
  let ghost;
  let frame;
  const calls = [];
  doc.elementFromPoint = () => hit;
  doc.body = { append(node) { ghost = node; } };
  const replacements = { document: doc, window: win, requestAnimationFrame: fn => { frame = fn; return 1; }, cancelAnimationFrame() {} };
  const previous = Object.fromEntries(Object.keys(replacements).map(key => [key, globalThis[key]]));
  Object.assign(globalThis, replacements);
  const controller = installScenarioDrag({ shelf, board, canvas, resolveSource: node => node, insert: (...args) => calls.push(args) });
  const event = (target, x = 120, y = 120) => ({ target, pointerId: 1, button: 0, isPrimary: true, clientX: x, clientY: y, preventDefault() {} });
  return { doc, win, shelf, board, card, existing, arrow, controller, calls, event,
    ghost: () => ghost, frame: time => frame(time), hit: node => { hit = node; },
    restore: () => Object.assign(globalThis, previous) };
}

test('shelf card snaps to 30%, commits only on release, ghost is removed', () => {
  const f = fixture();
  try {
    f.doc.emit('pointerdown', f.event(f.card));
    f.doc.emit('pointermove', f.event(f.card, 420, 170));
    assert.match(f.ghost().style.transform, /scale\(0.3\)/);
    assert.equal(f.calls.length, 0);
    f.win.emit('pointerup', f.event(f.card, 420, 170));
    assert.deepEqual(f.calls, [[f.card, 1]]);
    assert.equal(f.ghost().removed, true);
  } finally { f.restore(); }
});

test('leaving the arrow restores scale; releasing outside cancels', () => {
  const f = fixture();
  try {
    f.doc.emit('pointerdown', f.event(f.existing));
    f.doc.emit('pointermove', f.event(f.existing, 420, 170));
    f.hit(null);
    f.doc.emit('pointermove', f.event(f.existing, 700, 300));
    assert.match(f.ghost().style.transform, /scale\(1\)/);
    f.win.emit('pointerup', f.event(f.existing, 700, 300));
    assert.equal(f.calls.length, 0);
  } finally { f.restore(); }
});

test('Escape and pointercancel cancel without inserting', () => {
  for (const type of ['keydown', 'pointercancel']) {
    const f = fixture();
    try {
      f.doc.emit('pointerdown', f.event(f.existing));
      f.doc.emit('pointermove', f.event(f.existing, 420, 170));
      (type === 'pointercancel' ? f.win : f.doc).emit(type, { ...f.event(f.existing), key: 'Escape' });
      assert.equal(f.calls.length, 0);
      assert.equal(f.controller.isDragging(), false);
      assert.equal(f.ghost().removed, true);
    } finally { f.restore(); }
  }
});

test('existing source identity retained and edge scroll runs without pointer movement', () => {
  const f = fixture();
  try {
    f.doc.emit('pointerdown', f.event(f.existing));
    f.doc.emit('pointermove', f.event(f.existing, 338, 150));
    f.frame(16);
    assert(f.board.scrollLeft > 0);
    f.win.emit('pointerup', f.event(f.existing, 420, 170));
    assert.equal(f.calls[0][0], f.existing);
    assert.equal(f.calls[0][1], 1);
  } finally { f.restore(); }
});

test('capture transfer does not cancel insertion; repeated release inserts once', () => {
  const f = fixture();
  try {
    f.doc.emit('pointerdown', f.event(f.card));
    f.doc.emit('pointermove', f.event(f.card, 420, 170));
    f.doc.emit('lostpointercapture', f.event(f.card, 420, 170));
    assert.equal(f.controller.isDragging(), true);
    f.win.emit('pointerup', f.event(f.shelf, 420, 170));
    f.win.emit('pointerup', f.event(f.shelf, 420, 170));
    assert.deepEqual(f.calls, [[f.card, 1]]);
    assert.equal(f.controller.isDragging(), false);
  } finally { f.restore(); }
});

test('mouse release missed by the page finishes on the next unpressed move', () => {
  const f = fixture();
  try {
    f.doc.emit('pointerdown', f.event(f.card));
    f.doc.emit('pointermove', { ...f.event(f.card, 420, 170), pointerType: 'mouse', buttons: 1 });
    f.doc.emit('pointermove', { ...f.event(f.shelf, 420, 170), pointerType: 'mouse', buttons: 0 });
    f.win.emit('pointerup', f.event(f.shelf, 420, 170));
    assert.deepEqual(f.calls, [[f.card, 1]]);
  } finally { f.restore(); }
});
