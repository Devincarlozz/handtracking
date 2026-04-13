/**
 * physics.js — Verlet-based particle + constraint physics
 * Handles strings, elastic bands, and web modes.
 */

/* ——————————————————————————————————————
   PARTICLE
—————————————————————————————————————— */
class Particle {
  constructor(x, y, pinned = false) {
    this.x = x; this.y = y;
    this.oldX = x; this.oldY = y;
    this.pinned = pinned;
    this.vx = 0; this.vy = 0;
    this.mass = 1;
    this.radius = 4;
    // glow / pluck state
    this.energy = 0;      // 0–1, decays over time
    this.hue = 270;        // color hue
  }

  update(gravity, damping, dt) {
    if (this.pinned) return;
    const vx = (this.x - this.oldX) * damping;
    const vy = (this.y - this.oldY) * damping;
    this.oldX = this.x;
    this.oldY = this.y;
    this.x += vx + gravity.x * dt * dt;
    this.y += vy + gravity.y * dt * dt;
    this.energy = Math.max(0, this.energy - 0.025);
  }

  applyForce(fx, fy) {
    if (this.pinned) return;
    this.oldX -= fx;
    this.oldY -= fy;
  }

  constrain(w, h) {
    if (this.pinned) return;
    const bounce = 0.4;
    if (this.x < this.radius) { this.x = this.radius; this.oldX = this.x + (this.x - this.oldX) * bounce; }
    if (this.x > w - this.radius) { this.x = w - this.radius; this.oldX = this.x + (this.x - this.oldX) * bounce; }
    if (this.y < this.radius) { this.y = this.radius; this.oldY = this.y + (this.y - this.oldY) * bounce; }
    if (this.y > h - this.radius) { this.y = h - this.radius; this.oldY = this.y + (this.y - this.oldY) * bounce; }
  }
}

/* ——————————————————————————————————————
   CONSTRAINT (spring / stick)
—————————————————————————————————————— */
class Constraint {
  constructor(p1, p2, opts = {}) {
    this.p1 = p1;
    this.p2 = p2;
    const dx = p2.x - p1.x;
    const dy = p2.y - p1.y;
    this.restLen = opts.restLen ?? Math.hypot(dx, dy);
    this.stiffness = opts.stiffness ?? 0.9;   // 0–1
    this.elasticity = opts.elasticity ?? 1.0;  // >1 = extra springy
    this.isTear = false;   // if true, render as broken
    this.tearThreshold = opts.tearThreshold ?? Infinity;
    this.energy = 0;
    this.hue = opts.hue ?? 270;
    this.width = opts.width ?? 2;
  }

  satisfy() {
    const dx = this.p2.x - this.p1.x;
    const dy = this.p2.y - this.p1.y;
    const dist = Math.hypot(dx, dy) || 0.001;
    const stretch = dist / this.restLen;

    // Check tear
    if (stretch > this.tearThreshold) {
      this.isTear = true;
      return;
    }

    const delta = (dist - this.restLen * this.elasticity) / dist * this.stiffness;
    const moveX = dx * delta * 0.5;
    const moveY = dy * delta * 0.5;

    // Energy from stretch — drives glow
    const exc = Math.abs(stretch - 1);
    this.energy = Math.min(1, this.energy * 0.9 + exc * 0.6);
    this.p1.energy = Math.min(1, this.p1.energy + exc * 0.3);
    this.p2.energy = Math.min(1, this.p2.energy + exc * 0.3);

    if (!this.p1.pinned) { this.p1.x += moveX; this.p1.y += moveY; }
    if (!this.p2.pinned) { this.p2.x -= moveX; this.p2.y -= moveY; }
  }
}

/* ——————————————————————————————————————
   STRING — a chain of particles
—————————————————————————————————————— */
class StringEntity {
  constructor(x1, y1, x2, y2, segments, opts = {}) {
    this.segments = segments;
    this.particles = [];
    this.constraints = [];
    this.hue = opts.hue ?? (Math.random() * 360 | 0);
    this.width = opts.width ?? 2;
    this.elasticity = opts.elasticity ?? 1.0;
    this.stiffness = opts.stiffness ?? 0.92;

    for (let i = 0; i <= segments; i++) {
      const t = i / segments;
      const p = new Particle(
        x1 + (x2 - x1) * t,
        y1 + (y2 - y1) * t,
        i === 0 || i === segments // pin endpoints
      );
      p.hue = this.hue;
      this.particles.push(p);
    }

    for (let i = 0; i < segments; i++) {
      const c = new Constraint(this.particles[i], this.particles[i + 1], {
        stiffness: this.stiffness,
        elasticity: this.elasticity,
        tearThreshold: opts.tearThreshold ?? Infinity,
        hue: this.hue,
        width: this.width,
      });
      this.constraints.push(c);
    }
  }

  update(gravity, damping, dt, w, h) {
    for (const p of this.particles) { p.update(gravity, damping, dt); p.constrain(w, h); }
  }

  satisfy(iters = 6) {
    for (let i = 0; i < iters; i++) {
      for (const c of this.constraints) { if (!c.isTear) c.satisfy(); }
    }
  }

  // Interact — apply force at closest particle within radius
  interact(hx, hy, radius, strength) {
    let closest = null, minDist = radius;
    for (const p of this.particles) {
      if (p.pinned) continue;
      const d = Math.hypot(p.x - hx, p.y - hy);
      if (d < minDist) { minDist = d; closest = p; }
    }
    if (closest) {
      const nx = (hx - closest.x) / (minDist || 1);
      const ny = (hy - closest.y) / (minDist || 1);
      const f = (1 - minDist / radius) * strength;
      closest.applyForce(-nx * f, -ny * f);
      closest.energy = 1;
    }
    return closest;
  }

  // Repin end-points to new positions
  setPins(x1, y1, x2, y2) {
    const first = this.particles[0];
    const last  = this.particles[this.particles.length - 1];
    first.x = x1; first.y = y1; first.oldX = x1; first.oldY = y1;
    last.x  = x2; last.y  = y2; last.oldX  = x2; last.oldY  = y2;
  }
}

/* ——————————————————————————————————————
   ELASTIC BAND — closed loop
—————————————————————————————————————— */
class ElasticBand {
  constructor(cx, cy, radius, segments, opts = {}) {
    this.particles = [];
    this.constraints = [];
    this.hue = opts.hue ?? (Math.random() * 360 | 0);
    this.width = opts.width ?? 3;
    this.stiffness = opts.stiffness ?? 0.85;
    this.cx = cx; this.cy = cy;
    this.radBase = radius;

    for (let i = 0; i < segments; i++) {
      const angle = (i / segments) * Math.PI * 2;
      const p = new Particle(
        cx + Math.cos(angle) * radius,
        cy + Math.sin(angle) * radius,
        false
      );
      p.hue = this.hue;
      this.particles.push(p);
    }

    // Wrap-around constraints
    for (let i = 0; i < segments; i++) {
      const c = new Constraint(
        this.particles[i],
        this.particles[(i + 1) % segments],
        { stiffness: this.stiffness, elasticity: 1.0, hue: this.hue, width: this.width }
      );
      this.constraints.push(c);
    }
  }

  update(gravity, damping, dt, w, h) {
    for (const p of this.particles) { p.update(gravity, damping, dt); p.constrain(w, h); }
  }

  satisfy(iters = 8) {
    // Also add a gentle centripetal pull back to center
    for (let i = 0; i < iters; i++) {
      for (const c of this.constraints) c.satisfy();
    }
    // Soft restoration — pull towards rest circle
    for (const p of this.particles) {
      if (!p.pinned) {
        const dx = this.cx - p.x, dy = this.cy - p.y;
        const d = Math.hypot(dx, dy);
        const restoreF = 0.002;
        p.applyForce(-dx * restoreF, -dy * restoreF);
      }
    }
  }

  interact(hx, hy, radius, strength) {
    for (const p of this.particles) {
      const d = Math.hypot(p.x - hx, p.y - hy);
      if (d < radius) {
        const nx = (p.x - hx) / (d || 1);
        const ny = (p.y - hy) / (d || 1);
        const f = (1 - d / radius) * strength;
        p.applyForce(nx * f * 0.4, ny * f * 0.4);
        p.energy = Math.min(1, p.energy + 0.2);
      }
    }
  }
}

/* ——————————————————————————————————————
   WEB — a grid of particles and constraints
—————————————————————————————————————— */
class Web {
  constructor(cx, cy, rings, spokes, maxR, opts = {}) {
    this.particles = [];
    this.constraints = [];
    this.hue = opts.hue ?? 200;
    this.width = opts.width ?? 1.2;
    this.stiffness = opts.stiffness ?? 0.9;

    const spokeParticles = [];

    // Center
    const center = new Particle(cx, cy, true);
    center.hue = this.hue;
    this.particles.push(center);

    // Build spokes and rings
    for (let s = 0; s < spokes; s++) {
      const angle = (s / spokes) * Math.PI * 2;
      const row = [center];
      for (let r = 1; r <= rings; r++) {
        const radius = (r / rings) * maxR;
        const p = new Particle(
          cx + Math.cos(angle) * radius,
          cy + Math.sin(angle) * radius,
          r === rings
        );
        p.hue = this.hue + r * 8;
        this.particles.push(p);
        row.push(p);

        // Radial constraint
        this.constraints.push(new Constraint(row[r - 1], p, {
          stiffness: this.stiffness, hue: this.hue + r * 4, width: this.width
        }));
      }
      spokeParticles.push(row);
    }

    // Ring constraints
    for (let r = 1; r <= rings; r++) {
      for (let s = 0; s < spokes; s++) {
        const a = spokeParticles[s][r];
        const b = spokeParticles[(s + 1) % spokes][r];
        this.constraints.push(new Constraint(a, b, {
          stiffness: this.stiffness * 0.95, hue: this.hue + r * 6, width: this.width * 0.8
        }));
      }
    }
  }

  update(gravity, damping, dt, w, h) {
    for (const p of this.particles) { p.update(gravity, damping, dt); p.constrain(w, h); }
  }

  satisfy(iters = 6) {
    for (let i = 0; i < iters; i++) {
      for (const c of this.constraints) c.satisfy();
    }
  }

  interact(hx, hy, radius, strength) {
    for (const p of this.particles) {
      if (p.pinned) continue;
      const d = Math.hypot(p.x - hx, p.y - hy);
      if (d < radius) {
        const nx = (p.x - hx) / (d || 1);
        const ny = (p.y - hy) / (d || 1);
        const f = (1 - d / radius) * strength;
        p.applyForce(nx * f * 0.3, ny * f * 0.3);
        p.energy = Math.min(1, p.energy + 0.15);
      }
    }
  }
}

/* ——————————————————————————————————————
   PHYSICS WORLD
—————————————————————————————————————— */
class PhysicsWorld {
  constructor(w, h) {
    this.w = w; this.h = h;
    this.gravity = { x: 0, y: 0.25 };
    this.damping = 0.98;
    this.dt = 1;
    this.entities = [];         // StringEntity | ElasticBand | Web
    this.mode = 'strings';
  }

  resize(w, h) { this.w = w; this.h = h; }

  setMode(mode) {
    this.mode = mode;
    this.entities = [];
    this.build();
  }

  build() {
    const { w, h, mode } = this;
    if (mode === 'strings') {
      // Several horizontal strings at different heights
      const rows = 5;
      const hues = [280, 200, 320, 170, 50];
      for (let i = 0; i < rows; i++) {
        const y = h * 0.2 + (h * 0.6 / (rows - 1)) * i;
        const s = new StringEntity(w * 0.05, y, w * 0.95, y, 28, {
          hue: hues[i % hues.length],
          width: 2.5,
          stiffness: 0.88 + i * 0.01,
        });
        this.entities.push(s);
      }
      // Diagonal strings
      const diagHues = [100, 40];
      for (let i = 0; i < 2; i++) {
        const s = new StringEntity(
          w * (0.1 + i * 0.4), h * 0.08,
          w * (0.5 + i * 0.2), h * 0.92,
          20, { hue: diagHues[i], width: 1.8, stiffness: 0.85 }
        );
        this.entities.push(s);
      }
    } else if (mode === 'elastic') {
      // Multiple elastic bands of different sizes
      const configs = [
        { r: h * 0.28, seg: 40, hue: 285 },
        { r: h * 0.18, seg: 30, hue: 180 },
        { r: h * 0.10, seg: 20, hue: 340 },
      ];
      for (const cfg of configs) {
        const b = new ElasticBand(w / 2, h / 2, cfg.r, cfg.seg, {
          hue: cfg.hue, width: 3, stiffness: 0.82
        });
        this.entities.push(b);
      }
      // Two small offset bands
      for (let i = 0; i < 2; i++) {
        const b = new ElasticBand(
          w * (0.25 + i * 0.5), h * 0.5,
          h * 0.12, 24,
          { hue: 60 + i * 130, width: 2.5, stiffness: 0.8 }
        );
        this.entities.push(b);
      }
    } else if (mode === 'web') {
      const web = new Web(w / 2, h / 2, 6, 12, Math.min(w, h) * 0.43, {
        hue: 200, width: 1.5, stiffness: 0.9
      });
      this.entities.push(web);
      // Extra small webs in corners
      const corners = [
        [w * 0.12, h * 0.15], [w * 0.88, h * 0.15],
        [w * 0.12, h * 0.85], [w * 0.88, h * 0.85],
      ];
      const hues = [280, 340, 160, 50];
      for (let i = 0; i < corners.length; i++) {
        const [cx, cy] = corners[i];
        const mw = new Web(cx, cy, 3, 8, Math.min(w, h) * 0.09, {
          hue: hues[i], width: 1.2, stiffness: 0.88
        });
        this.entities.push(mw);
      }
    }
  }

  step(handPoints) {
    const { w, h, gravity, damping, dt } = this;
    for (const ent of this.entities) {
      ent.update(gravity, damping, dt, w, h);

      const iters = ent instanceof Web ? 8 : 6;
      ent.satisfy(iters);

      // Hand interactions
      if (handPoints && handPoints.length > 0) {
        for (const hp of handPoints) {
          ent.interact(hp.x, hp.y, hp.radius, hp.strength);
        }
      }
    }
  }
}

// Exports for use in app.js
window.PhysicsWorld = PhysicsWorld;
window.StringEntity = StringEntity;
window.ElasticBand = ElasticBand;
window.Web = Web;
