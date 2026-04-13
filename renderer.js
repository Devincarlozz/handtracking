/**
 * renderer.js — Canvas 2D renderer for hand + face tracking overlay.
 * Coordinate system: MediaPipe gives x in [0,1] from left of RAW camera.
 * The video is CSS-mirrored. So we mirror X in JS: px = (1 - lm.x) * W
 * The canvas has NO CSS transform, so this JS mirroring perfectly aligns
 * the drawn landmarks onto the CSS-mirrored video below.
 */

class Renderer {
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.time = 0;
    this.ripples = [];
  }

  resize(w, h) {
    this.canvas.width = w;
    this.canvas.height = h;
  }

  clear() {
    const { ctx, canvas } = this;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    this.time++;
  }

  // ——— Draw hand landmarks ———
  drawHands(handsData, canvasW, canvasH) {
    const { ctx } = this;

    for (const hand of handsData) {
      const lms = hand.landmarks;
      const label = hand.label;
      const baseHue = label === 'Left' ? 270 : 185;
      if (!lms || lms.length === 0) continue;

      // Mirror helper: (1 - lm.x) flips to match CSS-mirrored video
      const px = (lm) => (1 - lm.x) * canvasW;
      const py = (lm) => lm.y * canvasH;

      // Palm skeleton lines
      const palmIndices = [0, 1, 2, 3, 4, 0, 5, 6, 7, 8, 5, 9, 10, 11, 12, 9, 13, 14, 15, 16, 13, 17, 18, 19, 20, 17, 0];
      ctx.save();
      ctx.strokeStyle = `hsla(${baseHue}, 80%, 70%, 0.55)`;
      ctx.lineWidth = 2;
      ctx.shadowColor = `hsla(${baseHue}, 100%, 70%, 0.5)`;
      ctx.shadowBlur = 10;
      ctx.beginPath();
      let first = true;
      for (const idx of palmIndices) {
        const lm = lms[idx];
        if (first) { ctx.moveTo(px(lm), py(lm)); first = false; }
        else ctx.lineTo(px(lm), py(lm));
      }
      ctx.stroke();
      ctx.restore();

      // Landmark dots
      for (let i = 0; i < lms.length; i++) {
        const lm = lms[i];
        const isTip = [4, 8, 12, 16, 20].includes(i);
        const r = isTip ? 7 : 4;
        const hue = baseHue + i * 3;
        ctx.save();
        ctx.shadowColor = `hsla(${hue}, 100%, 75%, 1)`;
        ctx.shadowBlur = isTip ? 22 : 10;
        ctx.fillStyle = isTip
          ? `hsla(${hue}, 100%, 78%, 0.95)`
          : `hsla(${hue}, 70%, 65%, 0.7)`;
        ctx.beginPath();
        ctx.arc(px(lm), py(lm), r, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();
      }

      // Pulsing glow rings on fingertips
      const tips = [4, 8, 12, 16, 20];
      for (const ti of tips) {
        const lm = lms[ti];
        const pulse = Math.sin(this.time * 0.05 + ti) * 0.5 + 0.5;
        ctx.save();
        ctx.strokeStyle = `hsla(${baseHue + ti * 6}, 100%, 75%, ${0.2 + pulse * 0.35})`;
        ctx.lineWidth = 1.5;
        ctx.shadowColor = `hsla(${baseHue + ti * 6}, 100%, 75%, 0.6)`;
        ctx.shadowBlur = 12;
        ctx.beginPath();
        ctx.arc(px(lm), py(lm), 14 + pulse * 6, 0, Math.PI * 2);
        ctx.stroke();
        ctx.restore();
      }
    }
  }

  // ——— Draw face mesh dots ———
  drawFace(faceLandmarks, canvasW, canvasH) {
    const { ctx } = this;
    if (!faceLandmarks || faceLandmarks.length === 0) return;

    ctx.save();
    ctx.fillStyle = `hsla(300, 90%, 72%, 0.55)`;
    ctx.shadowColor = `hsla(300, 100%, 75%, 0.7)`;
    ctx.shadowBlur = 5;

    for (let i = 0; i < faceLandmarks.length; i++) {
      if (i % 3 !== 0) continue; // draw 1 in 3 points for speed
      const lm = faceLandmarks[i];
      const x = (1 - lm.x) * canvasW;
      const y = lm.y * canvasH;
      ctx.beginPath();
      ctx.arc(x, y, 1.5, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
  }

  // ——— Ripple effects ———
  addRipple(x, y, hue) {
    this.ripples.push({ x, y, r: 0, alpha: 1, hue });
  }

  drawRipples() {
    const { ctx } = this;
    this.ripples = this.ripples.filter(rp => rp.alpha > 0.01);
    for (const rp of this.ripples) {
      rp.r += 2.5;
      rp.alpha *= 0.92;
      ctx.save();
      ctx.strokeStyle = `hsla(${rp.hue}, 100%, 70%, ${rp.alpha * 0.6})`;
      ctx.lineWidth = 1.5;
      ctx.shadowColor = `hsla(${rp.hue}, 100%, 70%, ${rp.alpha})`;
      ctx.shadowBlur = 10;
      ctx.beginPath();
      ctx.arc(rp.x, rp.y, rp.r, 0, Math.PI * 2);
      ctx.stroke();
      ctx.restore();
    }
  }
}

window.Renderer = Renderer;
