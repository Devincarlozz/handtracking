/**
 * app.js — Vision Tracker
 *
 * Architecture: Zero-latency sync
 * ─────────────────────────────────────────────────────────
 * 1. getUserMedia directly (no Camera utility buffering)
 * 2. requestVideoFrameCallback — fires on REAL camera frames
 * 3. Each frame: draw video to canvas FIRST (always current)
 * 4. Overlay last known landmarks (1 frame old max, imperceptible)
 * 5. Send new frame to MediaPipe async → updates landmarks next tick
 * 6. Face sent every other frame to halve CPU load
 * ─────────────────────────────────────────────────────────
 * Result: Video is ALWAYS in sync. Landmarks follow within ~33ms.
 */

/* ═══════════════════════════════════════════════════════════
   SPLASH CANVAS
═══════════════════════════════════════════════════════════ */
(function () {
  const canvas = document.getElementById('splash-canvas');
  if (!canvas) return;
  const ctx = canvas.getContext('2d');
  let W, H, t = 0;
  const hues = [270, 200, 320, 170, 50, 340];
  const lines = Array.from({ length: 8 }, (_, i) => ({
    x1: 0, y1: 0, x2: 0, y2: 0,
    hue: hues[i % hues.length],
    phase: Math.random() * Math.PI * 2,
    speed: 0.3 + Math.random() * 0.4,
    amp: 30 + Math.random() * 60,
  }));

  function resize() {
    W = canvas.width = canvas.offsetWidth;
    H = canvas.height = canvas.offsetHeight;
    lines.forEach(ln => {
      ln.x1 = Math.random() * W; ln.y1 = Math.random() * H;
      ln.x2 = Math.random() * W; ln.y2 = Math.random() * H;
    });
  }
  resize();
  window.addEventListener('resize', resize);

  function loop() {
    ctx.fillStyle = 'rgba(6,4,15,0.18)';
    ctx.fillRect(0, 0, W, H);
    t += 0.012;
    for (const ln of lines) {
      const hue = ln.hue + Math.sin(t * ln.speed) * 20;
      const alpha = 0.12 + Math.sin(t * 0.5 + ln.phase) * 0.06;
      ctx.save();
      ctx.strokeStyle = `hsla(${hue},80%,65%,${alpha})`;
      ctx.lineWidth = 1.5;
      ctx.shadowColor = `hsla(${hue},100%,70%,${alpha * 2})`;
      ctx.shadowBlur = 18;
      ctx.beginPath();
      for (let s = 0; s <= 30; s++) {
        const tl = s / 30;
        const x = ln.x1 + (ln.x2 - ln.x1) * tl;
        const y = ln.y1 + (ln.y2 - ln.y1) * tl + Math.sin(tl * Math.PI * 2 + t * ln.speed + ln.phase) * ln.amp;
        s === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
      }
      ctx.stroke();
      ctx.restore();
    }
    requestAnimationFrame(loop);
  }
  loop();
})();


/* ═══════════════════════════════════════════════════════════
   MAIN APP
═══════════════════════════════════════════════════════════ */
(function () {
  const splash    = document.getElementById('splash');
  const startBtn  = document.getElementById('start-btn');
  const appEl     = document.getElementById('app');
  const videoEl   = document.getElementById('webcam');
  const canvas    = document.getElementById('main-canvas');
  const ctx       = canvas.getContext('2d');
  const loadingEl = document.getElementById('loading');
  const loadText  = document.getElementById('loading-text');
  const leftDot   = document.getElementById('left-dot');
  const rightDot  = document.getElementById('right-dot');
  const handText  = document.getElementById('hand-text');
  const fpsEl     = document.getElementById('fps-counter');

  // ─── State ───────────────────────────────────────────────
  let targetHandLms = null;   // latest from detector
  let currentHandLms = null;  // interpolated drawing state
  let ripples       = [];
  let time          = 0;
  let frameCount    = 0;
  let lastRipple    = 0;
  let fpsFrames     = 0;
  let fpsLast       = performance.now();
  let isProcessing  = false;  

  // Math helper for smooth movement
  const lerp = (start, end, factor) => start + (end - start) * factor;

  // ─── Canvas sizing ───────────────────────────────────────
  function resize() {
    canvas.width  = window.innerWidth;
    canvas.height = window.innerHeight;
  }
  resize();
  window.addEventListener('resize', resize);

  // ─── Draw: hands ─────────────────────────────────────────
  const PALM_IDX = [0,1,2,3,4,0,5,6,7,8,5,9,10,11,12,9,13,14,15,16,13,17,18,19,20,17,0];
  const TIP_IDX  = [4, 8, 12, 16, 20];

  function drawHands(W, H) {
    if (!currentHandLms) return;
    for (const { landmarks: lms, label } of currentHandLms) {
      const baseHue = label === 'Left' ? 270 : 185;
      // Landmarks from MediaPipe Hands are already in "selfie" space
      // so x=0 is left of mirrored image. Since we draw video mirrored,
      // coordinates must match → use lm.x * W directly.
      const px = lm => lm.x * W;
      const py = lm => lm.y * H;

      // Palm skeleton
      ctx.save();
      ctx.strokeStyle = `hsla(${baseHue},85%,70%,0.75)`;
      ctx.lineWidth = 2.5;
      ctx.lineJoin = 'round';
      ctx.shadowColor = `hsla(${baseHue},100%,70%,0.6)`;
      ctx.shadowBlur = 14;
      ctx.beginPath();
      let first = true;
      for (const i of PALM_IDX) {
        const lm = lms[i];
        first ? ctx.moveTo(px(lm), py(lm)) : ctx.lineTo(px(lm), py(lm));
        first = false;
      }
      ctx.stroke();
      ctx.restore();

      // Joints
      lms.forEach((lm, i) => {
        const isTip = TIP_IDX.includes(i);
        const hue = baseHue + i * 4;
        ctx.save();
        ctx.shadowColor = `hsla(${hue},100%,75%,1)`;
        ctx.shadowBlur = isTip ? 24 : 10;
        ctx.fillStyle = isTip
          ? `hsla(${hue},100%,78%,0.95)`
          : `hsla(${hue},75%,65%,0.75)`;
        ctx.beginPath();
        ctx.arc(px(lm), py(lm), isTip ? 8 : 4, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();
      });

      // Pulsing rings on fingertips
      TIP_IDX.forEach(ti => {
        const lm = lms[ti];
        const pulse = Math.sin(time * 0.06 + ti) * 0.5 + 0.5;
        ctx.save();
        ctx.strokeStyle = `hsla(${baseHue + ti * 8},100%,80%,${0.25 + pulse * 0.4})`;
        ctx.lineWidth = 1.5;
        ctx.shadowColor = `hsla(${baseHue + ti * 8},100%,80%,0.7)`;
        ctx.shadowBlur = 14;
        ctx.beginPath();
        ctx.arc(px(lm), py(lm), 16 + pulse * 8, 0, Math.PI * 2);
        ctx.stroke();
        ctx.restore();
      });

      // Optional: keep pinch ripple for single hand interactions
      const thumb = lms[4], index = lms[8];
      if (Math.hypot(thumb.x - index.x, thumb.y - index.y) < 0.05) {
        const now = performance.now();
        if (now - lastRipple > 150) {
          ripples.push({
            x: (thumb.x + index.x) / 2 * W,
            y: (thumb.y + index.y) / 2 * H,
            r: 0, alpha: 1, hue: baseHue,
          });
          lastRipple = now;
        }
      }
    }
  }

  // ─── Draw: Rigid Sticks (Between all 5 fingers of the two hands) ───────
  function drawSticks(W, H) {
    if (!currentHandLms || currentHandLms.length < 2) return;
    
    // The 5 fingertips: Thumb, Index, Middle, Ring, Pinky
    const TIPS = [4, 8, 12, 16, 20];
    
    for (let i = 0; i < TIPS.length; i++) {
      const tipIdx = TIPS[i];
      const pt1 = currentHandLms[0].landmarks[tipIdx];
      const pt2 = currentHandLms[1].landmarks[tipIdx];
      
      const x1 = pt1.x * W;
      const y1 = pt1.y * H;
      const x2 = pt2.x * W;
      const y2 = pt2.y * H;
      
      // Solid opacity, rigid appearance
      const thickness = 6; 
      const alpha = 0.9;
      
      // Spread colors across the spectrum for the 5 sticks
      const fingerRatio = i / 4; // 0 to 1
      const hue = lerp(170, 310, fingerRatio);
      
      ctx.save();
      ctx.lineCap = 'round';
      ctx.shadowBlur = 20;
      ctx.shadowColor = `hsla(${hue}, 100%, 65%, 0.9)`;
      
      // Draw straight solid outer glow
      ctx.beginPath();
      ctx.moveTo(x1, y1);
      ctx.lineTo(x2, y2); // Straight line, NO droop
      
      ctx.strokeStyle = `hsla(${hue}, 100%, 75%, ${alpha})`;
      ctx.lineWidth = thickness;
      ctx.stroke();
      
      // Draw inner white core (makes it look like a solid neon tube / lightsaber)
      ctx.beginPath();
      ctx.moveTo(x1, y1);
      ctx.lineTo(x2, y2);
      ctx.strokeStyle = `rgba(255, 255, 255, 0.95)`;
      ctx.lineWidth = thickness * 0.4;
      ctx.stroke();
      
      // Sharp connection nodes at the end points
      ctx.fillStyle = '#fff';
      ctx.shadowBlur = 10;
      ctx.shadowColor = '#fff';
      ctx.beginPath(); ctx.arc(x1, y1, thickness - 1, 0, Math.PI * 2); ctx.fill();
      ctx.beginPath(); ctx.arc(x2, y2, thickness - 1, 0, Math.PI * 2); ctx.fill();
      
      ctx.restore();
    }
  }

  // Face tracking removed as requested

  // ─── Draw: ripples ────────────────────────────────────────
  function drawRipples() {
    ripples = ripples.filter(r => r.alpha > 0.01);
    for (const r of ripples) {
      r.r += 3; r.alpha *= 0.91;
      ctx.save();
      ctx.strokeStyle = `hsla(${r.hue},100%,70%,${r.alpha * 0.7})`;
      ctx.lineWidth = 1.5;
      ctx.shadowColor = `hsla(${r.hue},100%,70%,${r.alpha})`;
      ctx.shadowBlur = 10;
      ctx.beginPath();
      ctx.arc(r.x, r.y, r.r, 0, Math.PI * 2);
      ctx.stroke();
      ctx.restore();
    }
  }

  // ─── Update status bar ────────────────────────────────────
  function updateStatus() {
    if (!targetHandLms || targetHandLms.length === 0) {
      leftDot.classList.remove('active', 'left');
      rightDot.classList.remove('active', 'right');
      handText.textContent = 'Searching for hands…';
      return;
    }
    let left = false, right = false;
    for (const { label } of targetHandLms) {
      if (label === 'Left')  left  = true;
      if (label === 'Right') right = true;
    }
    leftDot.classList.toggle('active', left);
    leftDot.classList.toggle('left', left);
    rightDot.classList.toggle('active', right);
    rightDot.classList.toggle('right', right);
    handText.textContent = left && right ? 'Both hands ✦' : left ? 'Left hand' : 'Right hand';
  }

  // ─── Interpolation Logic ──────────────────────────────────
  function interpolateHands(factor = 0.4) {
    if (!targetHandLms) {
      currentHandLms = null;
      return;
    }
    
    // If mismatch in hand count, snap to target instantly
    if (!currentHandLms || currentHandLms.length !== targetHandLms.length) {
      currentHandLms = JSON.parse(JSON.stringify(targetHandLms));
      return;
    }

    // Otherwise glide smoothly
    for (let h = 0; h < targetHandLms.length; h++) {
      const targetLms = targetHandLms[h].landmarks;
      const currentLms = currentHandLms[h].landmarks;
      for (let i = 0; i < targetLms.length; i++) {
        currentLms[i].x = lerp(currentLms[i].x, targetLms[i].x, factor);
        currentLms[i].y = lerp(currentLms[i].y, targetLms[i].y, factor);
      }
    }
  }

  // ─── Render Pipeline (60+ FPS) ────────────────────────────
  function renderLoop(now) {
    requestAnimationFrame(renderLoop);
    
    // Interpolate towards actual detected position
    interpolateHands(0.35); // 0.35 = snappy but buttery smooth

    const W = canvas.width;
    const H = canvas.height;

    // 1. Draw raw native video frame directly onto canvas (unmirrored)
    ctx.drawImage(videoEl, 0, 0, W, H);

    // 2. Subtle dark overlay for neon contrast
    ctx.fillStyle = 'rgba(6,4,15,0.42)';
    ctx.fillRect(0, 0, W, H);

    // 3. Render overlays strictly inside context
    time++;
    drawRipples();
    drawSticks(W, H); 
    drawHands(W, H);

    // 4. FPS counter
    fpsFrames++;
    if (now - fpsLast >= 1000) {
      fpsEl.textContent = `${fpsFrames} fps`;
      fpsFrames = 0;
      fpsLast = now;
    }
  }

  // ─── AI Pipeline (Native Camera FPS) ──────────────────────
  function processVideo() {
    videoEl.requestVideoFrameCallback(processVideo);

    if (isProcessing) return;
    
    isProcessing = true;
    frameCount++;
    
    const promises = [handsDetector.send({ image: videoEl })];
    Promise.all(promises).finally(() => { isProcessing = false; });
  }



  // ─── MediaPipe setup ──────────────────────────────────────
  let handsDetector;

  function initDetectors() {
    handsDetector = new Hands({
      locateFile: f => `https://cdn.jsdelivr.net/npm/@mediapipe/hands/${f}`,
    });
    handsDetector.setOptions({
      maxNumHands: 2,
      modelComplexity: 0,        // lightest, fastest
      minDetectionConfidence: 0.5,
      minTrackingConfidence: 0.5,
    });
    handsDetector.onResults(results => {
      targetHandLms = [];
      if (!results.multiHandLandmarks) {
        updateStatus();
        return;
      }
      results.multiHandLandmarks.forEach((lms, i) => {
        targetHandLms.push({
          landmarks: lms.map(l => ({ x: l.x, y: l.y, z: l.z })),
          label: results.multiHandedness[i]?.label || 'Right',
        });
      });
      updateStatus();
    });
  }

  // ─── Rotation Toggle ──────────────────────────────────────
  const rotateBtn = document.getElementById('rotate-cam-btn');
  if (rotateBtn) {
    rotateBtn.addEventListener('click', async () => {
      // First try native screen orientation API (works on Android Chrome)
      if (document.documentElement.requestFullscreen && screen.orientation) {
        try {
          if (!document.fullscreenElement) {
            await document.documentElement.requestFullscreen();
            await screen.orientation.lock("landscape");
          } else {
            document.exitFullscreen();
            screen.orientation.unlock();
          }
          return;
        } catch (e) {
          console.log("Native orientation lock not supported, falling back to CSS");
        }
      }
      
      // Fallback: Rotate container via CSS
      appEl.classList.toggle('rotated');
      setTimeout(resize, 350); // Give CSS transform time to apply, then resize canvas
    });
  }

  // ─── Start ────────────────────────────────────────────────
  startBtn.addEventListener('click', async () => {
    splash.classList.add('fade-out');
    setTimeout(() => splash.classList.add('hidden'), 700);
    appEl.classList.remove('hidden');

    loadText.textContent = 'Initialising detectors…';
    initDetectors();

    loadText.textContent = 'Requesting camera…';
    let stream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({
        video: {
          width:     { ideal: 1280 },
          height:    { ideal: 720 },
          frameRate: { ideal: 30, max: 60 },
          facingMode: 'user',
        },
      });
    } catch (err) {
      loadText.textContent = '⚠️ Camera access denied. Please allow and reload.';
      console.error(err);
      return;
    }

    videoEl.srcObject = stream;
    videoEl.onloadedmetadata = () => {
      videoEl.play();
      loadingEl.classList.add('done');
      setTimeout(() => loadingEl.remove(), 500);
      // Start dual loops for decoupled tracking vs rendering
      requestAnimationFrame(renderLoop);
      videoEl.requestVideoFrameCallback(processVideo);
    };
  });
})();
