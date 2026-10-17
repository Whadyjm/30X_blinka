import { STATES, createParticles, faceTarget, stateName, expressionAt, blinkAt } from './particles.js';

/** Independent Canvas renderer. React never renders individual particles. */
export class OliCanvas {
  constructor(canvas, options = {}) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d', { alpha: true });
    if (!this.ctx) throw new Error('Este navegador no permite dibujar a Oli.');
    this.state = stateName(options.state ?? 'idle');
    this.pose = { ...STATES[this.state] };
    this.speed = Number.isFinite(options.speed) ? Math.max(0, options.speed) : 1;
    this.dark = options.dark !== false;
    this.paused = Boolean(options.paused);
    this.motion = matchMedia('(prefers-reduced-motion: reduce)');
    this.time = 0;
    this.stateTime = 0;
    this.desired = { ...this.pose };
    this.rotation = 0;
    this.last = 0;
    this.frame = 0;
    this.visible = true;
    this.destroyed = false;
    this.pointer = { x: 0, y: 0 };
    this.gaze = { x: 0, y: 0 };
    this.touch = { x: 0, y: 0, strength: 0 };
    this.burst = 0;
    this.target = { x: 0, y: 0, z: 0 };
    this.width = 1;
    this.height = 1;
    this.particles = createParticles(options.particles ?? 1600);
    this.sorted = [...this.particles];
    this.tick = this.tick.bind(this);
    this.onVisibility = () => this.sync();
    this.onMotion = () => { this.pose = { ...STATES[this.state] }; this.render(0, true); this.sync(); };
    document.addEventListener('visibilitychange', this.onVisibility);
    this.motion.addEventListener('change', this.onMotion);
    this.resizeObserver = new ResizeObserver(() => this.resize());
    this.resizeObserver.observe(canvas);
    this.intersectionObserver = new IntersectionObserver(([entry]) => {
      this.visible = entry.isIntersecting;
      this.sync();
    });
    this.intersectionObserver.observe(canvas);
    this.resize();
    this.sync();
  }

  resize() {
    const { width, height } = this.canvas.getBoundingClientRect();
    if (!width || !height) return;
    this.width = width;
    this.height = height;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    this.canvas.width = Math.round(width * dpr);
    this.canvas.height = Math.round(height * dpr);
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    this.render(0, this.motion.matches || this.paused);
  }

  setState(value) {
    const next = stateName(value);
    if (next !== this.state) this.stateTime = 0;
    if (next !== this.state && next === 'celebrating') this.burst = 1;
    this.state = next;
    if (this.motion.matches || this.paused || this.speed === 0) {
      this.pose = { ...STATES[next] };
      this.render(0, true);
    }
    this.sync();
  }

  setOptions(options = {}) {
    if (options.speed !== undefined && Number.isFinite(options.speed)) this.speed = Math.max(0, options.speed);
    if (options.dark !== undefined) this.dark = options.dark;
    if (options.paused !== undefined) this.paused = options.paused;
    if (options.state !== undefined) this.setState(options.state);
    this.render(0, this.motion.matches || this.paused || this.speed === 0);
    this.sync();
  }

  lookAt(x, y) {
    this.pointer.x = Math.max(-1, Math.min(1, x));
    this.pointer.y = Math.max(-1, Math.min(1, y));
  }

  ripple(x = 0, y = 0) {
    if (this.motion.matches) return;
    this.touch = { x, y, strength: 1 };
  }

  sync() {
    if (this.destroyed) return;
    const run = !this.paused && !this.motion.matches && !document.hidden && this.visible && this.speed > 0;
    if (run && !this.frame) {
      this.last = 0;
      this.frame = requestAnimationFrame(this.tick);
    } else if (!run && this.frame) {
      cancelAnimationFrame(this.frame);
      this.frame = 0;
      this.last = 0;
    }
  }

  tick(now) {
    if (this.destroyed) return;
    const dt = this.last ? Math.min((now - this.last) / 1000, 0.05) : 1 / 60;
    this.last = now;
    this.render(dt * this.speed);
    this.frame = requestAnimationFrame(this.tick);
  }

  render(dt = 0, snap = false) {
    const { ctx, width, height, pose } = this;
    this.time += dt;
    this.stateTime += dt;
    const t = this.time;
    const settle = snap ? 1 : 1 - Math.exp(-dt * 9);
    const move = snap ? 1 : 1 - Math.exp(-dt * 7);
    const desired = this.motion.matches ? STATES[this.state] : expressionAt(this.state, this.stateTime, this.desired);
    for (const key of Object.keys(desired)) pose[key] += (desired[key] - pose[key]) * settle;
    this.gaze.x += (this.pointer.x - this.gaze.x) * move;
    this.gaze.y += (this.pointer.y - this.gaze.y) * move;
    this.rotation += dt * pose.spin;
    this.burst *= Math.exp(-dt * 1.65);
    this.touch.strength *= Math.exp(-dt * 2.4);
    const yaw = this.rotation;
    const cos = Math.cos(yaw), sin = Math.sin(yaw);
    const breathing = 1 + Math.sin(t * 1.45) * 0.023;
    const tilt = pose.tilt + this.gaze.x * 0.035;
    const ct = Math.cos(tilt), st = Math.sin(tilt);
    const blink = this.motion.matches ? 0 : blinkAt(this.state, this.stateTime);
    const r = Math.min(width, height) * 0.355;
    const cx = width / 2, cy = height / 2;
    const dotScale = Math.max(0.46, Math.min(1.1, r / 175));
    ctx.clearRect(0, 0, width, height);

    for (const p of this.particles) {
      let x = p.bx * cos + p.bz * sin;
      let z = p.bz * cos - p.bx * sin;
      let y = p.by;
      const wave = Math.sin(p.phase + t * (0.5 + pose.energy) + y * 3) * (0.015 + pose.energy * 0.016);
      const swell = breathing + wave;
      x *= swell; y *= swell; z *= swell;
      if (p.role) {
        faceTarget(p, pose, blink, this.target);
        // The face gathers locally, fading in without moving a single body point.
        x = this.target.x * (0.90 + pose.face * 0.10) + this.gaze.x * 0.065;
        y = this.target.y * (0.90 + pose.face * 0.10) + this.gaze.y * 0.045;
        z = this.target.z;
      } else {
        // A brief expansion travels through the same particles; no confetti layer.
        const lift = this.burst * (0.10 + p.drift * 0.30);
        x *= 1 + lift; z *= 1 + lift; y = y * (1 + lift) - lift * 0.3;
        const dx = x - this.touch.x, dy = y - this.touch.y;
        const dist = Math.hypot(dx, dy) + 0.08;
        const ripple = Math.sin(dist * 11 - (1 - this.touch.strength) * 12) * this.touch.strength * 0.065;
        x += dx / dist * ripple; y += dy / dist * ripple;
      }
      x *= pose.sx; y *= pose.sy;
      const tx = x * ct - y * st;
      const ty = x * st + y * ct + pose.hop;
      // Body targets are fluid; the already-eased face follows the blink precisely.
      const follow = p.role ? 1 : move;
      p.x += (tx - p.x) * follow;
      p.y += (ty - p.y) * follow;
      p.z += (z - p.z) * follow;
    }

    this.sorted.sort((a, b) => a.z - b.z);
    ctx.fillStyle = this.dark ? '#f5f1e8' : '#242725';
    for (const p of this.sorted) {
      if (p.role && pose.face < 0.001) continue;
      const perspective = 3.8 / (3.8 - p.z * 0.26);
      const depth = Math.max(0, Math.min(1, (p.z + 1) / 2));
      let alpha = 0.24 + depth * 0.70;
      let size = p.size * dotScale * (0.70 + depth * 0.40);
      if (p.role) {
        alpha = pose.face;
        size = p.size * dotScale;
      }
      alpha *= 0.94 + Math.sin(t * 1.1 + p.phase) * 0.06;
      ctx.globalAlpha = Math.max(0, Math.min(1, alpha));
      ctx.beginPath();
      ctx.arc(cx + p.x * r * perspective, cy + p.y * r * perspective, size, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalAlpha = 1;
  }

  destroy() {
    this.destroyed = true;
    cancelAnimationFrame(this.frame);
    this.frame = 0;
    this.resizeObserver.disconnect();
    this.intersectionObserver.disconnect();
    this.motion.removeEventListener('change', this.onMotion);
    document.removeEventListener('visibilitychange', this.onVisibility);
  }
}
