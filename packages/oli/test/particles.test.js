import test from 'node:test';
import assert from 'node:assert/strict';
import { createParticles, faceTarget, STATES, stateName, blinkAt, expressionAt } from '../src/particles.js';

test('the complete body is preserved, with additional facial particles', () => {
  const a = createParticles(1600), b = createParticles(1600);
  assert.deepEqual(a, b);
  const body = a.filter(p => !p.role);
  assert.equal(body.length, 1600);
  assert.equal(a.length, 1920);
  for (const p of body) assert.ok(Math.hypot(p.x, p.y, p.z) <= 1.001);
  assert.ok(body.filter(p => p.by > 0.5).length > 300, 'lower hemisphere remains populated');
  assert.ok(a.some(p => p.role === -1) && a.some(p => p.role === 1) && a.some(p => p.role === -2) && a.some(p => p.role === 2));
  const before = structuredClone(body);
  for (const state of Object.keys(STATES)) {
    const pose = expressionAt(state, 1);
    for (const p of a.filter(p => p.role)) faceTarget(p, pose, 0, {});
  }
  assert.deepEqual(body, before, 'expressions cannot borrow from the body');
});

test('all animated expressions stay finite and eyes retain filled centres without pupils', () => {
  const particles = createParticles(1600).filter(p => p.role);
  for (const state of Object.keys(STATES)) {
    for (let t = 0; t < 12; t += 0.1) {
      const pose = expressionAt(state, t);
      assert.ok(Object.values(pose).every(Number.isFinite));
      for (const p of particles) {
        const v = faceTarget(p, pose, blinkAt(state, t), {});
        assert.ok(Object.values(v).every(Number.isFinite));
        assert.ok(Math.abs(v.x) < 0.65 && Math.abs(v.y) < 0.65);
      }
    }
  }
  const pose = STATES.listening;
  const left = particles.filter(p => p.role === -1).map(p => faceTarget(p, pose, 0, {}));
  assert.ok(left.some(p => Math.hypot((p.x + pose.spacing) / pose.eyeWidth, (p.y - pose.eyeY) / pose.eyeHeight) < 0.15));
  assert.equal(STATES.idle.face, 0);
  assert.equal(stateName('not-a-state'), 'idle');
});

test('every active emotion visibly closes and reopens its eyes, including happy and celebrating', () => {
  const particles = createParticles(1600).filter(p => p.role === -1);
  const extent = points => Math.max(...points.map(p => p.y)) - Math.min(...points.map(p => p.y));
  for (const state of Object.keys(STATES).filter(s => s !== 'idle')) {
    assert.equal(blinkAt(state, 1.62), 1);
    assert.equal(blinkAt(state, 2.5), 0);
    const pose = expressionAt(state, 0);
    const open = particles.map(p => faceTarget(p, pose, 0, {}));
    const shut = particles.map(p => faceTarget(p, pose, 1, {}));
    assert.ok(extent(shut) < extent(open) * 0.65, state);
  }
  assert.equal(blinkAt('idle', 1.62), 0);
});

test('the face contains only eyes and two eyebrows that stay above their eyes during acting', () => {
  const particles = createParticles(1600).filter(p => p.role);
  assert.deepEqual([...new Set(particles.map(p => p.role))].sort(), [-1, -2, 1, 2]);
  for (const state of Object.keys(STATES)) {
    for (let t = 0; t < 6; t += 0.2) {
      const pose = expressionAt(state, t);
      for (const side of [-1, 1]) {
        const targets = role => particles.filter(p => p.role === role).map(p => faceTarget(p, pose, blinkAt(state, t), {}));
        const eyeTop = Math.min(...targets(side).map(p => p.y));
        const browBottom = Math.max(...targets(side * 2).map(p => p.y));
        assert.ok(browBottom < eyeTop - 0.02, `${state}: eyebrow must remain separate from the eye`);
      }
    }
  }
});

test('particle allocation bounds include the additional face budget', () => {
  for (const n of [-10, 0, NaN, Infinity, 100000]) {
    const points = createParticles(n);
    assert.ok(points.length >= 96 && points.length <= 4800);
    assert.ok(points.filter(p => !p.role).length <= 4000);
  }
});
