const base = {
  face: 1, left: 0, right: 0, eyeWidth: 0.087, eyeHeight: 0.18,
  spacing: 0.245, eyeY: -0.18, eyeCurve: 0.035, slant: 0,
  smile: 0.12, mouthWidth: 0.34, mouthOpen: 0, mouthShift: 0,
  energy: 0.3, spin: 0.10, tilt: 0, sx: 1, sy: 1, hop: 0, lookX: 0, lookY: 0,
};
const pose = overrides => Object.freeze({ ...base, ...overrides });
export const STATES = Object.freeze({
  idle: pose({ face: 0, energy: 0.2 }),
  listening: pose({ eyeHeight: 0.215, eyeWidth: 0.093, spacing: 0.27, smile: 0.055, mouthWidth: 0.23, tilt: -0.19, sy: 1.045, sx: 0.98, spin: 0.065 }),
  thinking: pose({ left: 0.08, right: 0.52, eyeHeight: 0.19, slant: -0.15, smile: -0.025, mouthWidth: 0.19, mouthShift: 0.13, tilt: 0.15, lookX: -0.08, lookY: -0.055, energy: 0.58, spin: 0.23 }),
  focused: pose({ left: 0.54, right: 0.54, eyeCurve: -0.035, slant: -0.21, spacing: 0.23, mouthWidth: 0.19, smile: 0.015, eyeY: -0.17, sy: 0.95, sx: 1.035, energy: 0.18, spin: 0.045 }),
  understanding: pose({ eyeWidth: 0.10, eyeHeight: 0.22, smile: 0.11, mouthWidth: 0.35, mouthOpen: 0.075, sy: 1.055, sx: 0.975, lookY: -0.035, spin: 0.10 }),
  happy: pose({ left: 0.25, right: 0.25, eyeCurve: 0.085, eyeWidth: 0.10, eyeHeight: 0.17, smile: 0.13, mouthWidth: 0.43, mouthOpen: 0.12, tilt: -0.095, sy: 0.97, sx: 1.035, energy: 0.48 }),
  celebrating: pose({ left: 0.45, right: 0.45, eyeCurve: 0.095, eyeWidth: 0.11, smile: 0.09, mouthWidth: 0.46, mouthOpen: 0.23, energy: 0.9, spin: 0.19, sy: 1.025 }),
});

export function stateName(value) {
  return Object.hasOwn(STATES, value) ? value : 'idle';
}

const smooth = x => { x = Math.max(0, Math.min(1, x)); return x * x * (3 - 2 * x); };
const pulse = (t, at, duration) => t < at || t > at + duration ? 0 : Math.sin((t - at) / duration * Math.PI) ** 2;

// A deliberate close / hold / release. Every active state blinks within its first 2 s.
export function blinkAt(state, time) {
  if (state === 'idle') return 0;
  const period = state === 'thinking' ? 3.8 : state === 'celebrating' ? 2.7 : 4.2;
  const t = ((time % period) + period) % period;
  const blink = at => t < at || t >= at + 0.36 ? 0
    : t < at + 0.09 ? smooth((t - at) / 0.09)
    : t < at + 0.17 ? 1 : 1 - smooth((t - at - 0.17) / 0.19);
  return Math.max(blink(1.5), state === 'thinking' || state === 'understanding' ? blink(1.98) : 0);
}

// Acting is authored per state. The renderer eases these targets across interruptions.
export function expressionAt(state, time, out = {}) {
  Object.assign(out, STATES[stateName(state)]);
  const t = Math.max(0, time);
  switch (state) {
    case 'listening': {
      const nod = pulse(t % 4.6, 0.45, 0.65) + pulse(t % 4.6, 1.15, 0.5) * 0.6;
      out.tilt += Math.sin(t * 1.7) * 0.06;
      out.hop += nod * 0.055;
      out.sy -= nod * 0.035;
      out.lookY += nod * 0.045;
      break;
    }
    case 'thinking': {
      const glance = Math.sin(t * 0.95);
      out.lookX += glance * 0.07;
      out.tilt += Math.sin(t * 1.35) * 0.09;
      out.right += Math.sin(t * 1.9) * 0.13;
      out.mouthShift += glance * 0.045;
      out.hop = Math.sin(t * 2.1) * 0.025;
      break;
    }
    case 'focused': {
      const scan = Math.sin(t * 1.15);
      out.lookX = scan * 0.065;
      out.lookY = 0.025;
      out.tilt = scan * 0.035;
      out.left += pulse(t % 4.8, 2.8, 1.1) * 0.17;
      out.right += pulse(t % 4.8, 2.8, 1.1) * 0.17;
      break;
    }
    case 'understanding': {
      const aha = pulse(t % 5.4, 0, 1.45);
      out.eyeHeight += aha * 0.045;
      out.mouthWidth -= aha * 0.23;
      out.mouthOpen += aha * 0.14;
      out.smile = out.smile * (1 - aha) - aha * 0.10;
      out.hop = -aha * 0.12 + pulse(t % 5.4, 2.5, 0.65) * 0.045;
      out.sy += aha * 0.06;
      out.tilt = -Math.sin(t * 1.3) * 0.05;
      break;
    }
    case 'happy': {
      const beam = pulse(t % 4.4, 2.5, 1.3);
      out.left += beam * 0.65; out.right += beam * 0.65;
      out.tilt += Math.sin(t * 2.4) * 0.105;
      out.hop = -Math.abs(Math.sin(t * 2.4)) * 0.045;
      out.mouthOpen += beam * 0.045;
      break;
    }
    case 'celebrating': {
      const leap = Math.max(0, Math.sin(t * 4.8));
      const land = Math.max(0, -Math.sin(t * 4.8));
      out.hop = -leap * 0.20 + land * 0.035;
      out.sy += leap * 0.10 - land * 0.13;
      out.sx += land * 0.10 - leap * 0.055;
      out.tilt = Math.sin(t * 2.4) * 0.19;
      out.left += Math.sin(t * 2.4) * 0.32;
      out.right += Math.sin(t * 2.4) * 0.32;
      out.mouthOpen += leap * 0.055;
      break;
    }
  }
  return out;
}

export function random(seed = 17) {
  return () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let n = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    n = (n + Math.imul(n ^ (n >>> 7), 61 | n)) ^ n;
    return ((n ^ (n >>> 14)) >>> 0) / 4294967296;
  };
}

export function createParticles(count = 1500) {
  count = Math.max(80, Math.min(4000, Math.round(Number(count) || 1500)));
  const rand = random(73);
  const body = Array.from({ length: count }, (_, i) => {
    const y = 1 - 2 * ((i + 0.5) / count);
    const angle = i * Math.PI * (3 - Math.sqrt(5));
    const radius = i % 4 === 0 ? 0.50 + rand() * 0.44 : 0.94 + rand() * 0.06;
    const ring = Math.sqrt(1 - y * y);
    return {
      bx: Math.cos(angle) * ring * radius, by: y * radius, bz: Math.sin(angle) * ring * radius,
      x: Math.cos(angle) * ring * radius, y: y * radius, z: Math.sin(angle) * ring * radius,
      role: 0, size: 0.62 + Math.pow(rand(), 3) * 1.50,
      phase: rand() * Math.PI * 2, drift: rand(),
    };
  });
  // Additional particles, never borrowed from any latitude of the body.
  const faceCount = Math.round(count * 0.24);
  const eyeCount = Math.floor(faceCount * 0.30);
  const mouthCount = faceCount - eyeCount * 2;
  const face = Array.from({ length: faceCount }, (_, i) => {
    const role = i < eyeCount ? -1 : i < eyeCount * 2 ? 1 : 2;
    const j = role === -1 ? i : role === 1 ? i - eyeCount : i - eyeCount * 2;
    return {
      bx: 0, by: 0, bz: 1.10, x: 0, y: 0, z: 1.10, role,
      u: (j + 0.5) / (role === 2 ? mouthCount : eyeCount), angle: j * 2.3999632297,
      size: 0.90 + rand() * 0.25, phase: rand() * Math.PI * 2, drift: rand(),
    };
  });
  return body.concat(face);
}

// Filled sunflower ovals, no pupil. Blink geometry is applied after pose easing.
export function faceTarget(p, pose, blink, out) {
  if (p.role === 2) {
    const a = p.u * Math.PI * 2;
    const x = Math.sin(a) * pose.mouthWidth;
    const arc = 1 - (x / pose.mouthWidth) ** 2;
    out.x = x + pose.mouthShift;
    out.y = 0.17 + pose.smile * arc + Math.max(0, Math.cos(a)) * pose.mouthOpen + Math.sin(p.angle) * 0.013;
  } else {
    const closed = Math.max(p.role < 0 ? pose.left : pose.right, blink);
    const radius = Math.sqrt(p.u);
    const openX = Math.cos(p.angle) * radius * pose.eyeWidth;
    const openY = Math.sin(p.angle) * radius * pose.eyeHeight;
    const curveX = (p.u * 2 - 1) * pose.eyeWidth * 1.35;
    const curveY = -pose.eyeCurve * (1 - ((p.u * 2 - 1) ** 2)) + Math.sin(p.angle) * 0.008;
    const x = openX * (1 - closed) + curveX * closed;
    const y = openY * (1 - closed) + curveY * closed;
    const angle = pose.slant * p.role;
    out.x = p.role * pose.spacing + x * Math.cos(angle) - y * Math.sin(angle);
    out.y = pose.eyeY + x * Math.sin(angle) + y * Math.cos(angle);
  }
  out.x += pose.lookX;
  out.y += pose.lookY;
  // On top of the cloud; body coverage and opacity never depend on face visibility.
  out.z = 1.10;
  return out;
}
