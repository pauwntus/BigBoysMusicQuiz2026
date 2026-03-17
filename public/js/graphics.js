/**
 * Big Boys Music Quiz 2026 – Canvas Graphics Engine
 * Animerade partiklar, konfetti och visuella effekter
 */

class GraphicsEngine {
  constructor(canvasId) {
    this.canvas = document.getElementById(canvasId);
    this.ctx = this.canvas.getContext('2d');
    this.particles = [];
    this.notes = [];
    this.animating = false;
    this._raf = null;
    this.resize();
    window.addEventListener('resize', () => this.resize());
  }

  resize() {
    this.canvas.width = window.innerWidth;
    this.canvas.height = window.innerHeight;
  }

  // ── Starfield Particles ───────────────────────────
  initStarfield(count = 120) {
    this.particles = Array.from({ length: count }, () => this._newStar());
    this.notes = Array.from({ length: 12 }, () => this._newNote());
  }

  _newStar() {
    return {
      x: Math.random() * window.innerWidth,
      y: Math.random() * window.innerHeight,
      r: Math.random() * 1.8 + 0.3,
      speed: Math.random() * 0.4 + 0.1,
      opacity: Math.random() * 0.6 + 0.2,
      twinkle: Math.random() * Math.PI * 2,
      twinkleSpeed: Math.random() * 0.03 + 0.01,
      color: ['#f59e0b', '#3b82f6', '#a855f7', '#22c55e', '#ffffff'][Math.floor(Math.random() * 5)],
    };
  }

  _newNote() {
    const symbols = ['♩', '♪', '♫', '♬', '𝄞', '🎵'];
    return {
      x: Math.random() * window.innerWidth,
      y: window.innerHeight + 40,
      symbol: symbols[Math.floor(Math.random() * symbols.length)],
      size: Math.random() * 22 + 14,
      speed: Math.random() * 0.8 + 0.3,
      drift: (Math.random() - 0.5) * 0.5,
      opacity: Math.random() * 0.4 + 0.1,
      rotation: Math.random() * Math.PI * 2,
      rotSpeed: (Math.random() - 0.5) * 0.02,
    };
  }

  start() {
    if (this.animating) return;
    this.animating = true;
    this.initStarfield();
    this._loop();
  }

  stop() {
    this.animating = false;
    if (this._raf) cancelAnimationFrame(this._raf);
    this._raf = null;
  }

  _loop() {
    if (!this.animating) return;
    this._draw();
    this._raf = requestAnimationFrame(() => this._loop());
  }

  _draw() {
    const W = this.canvas.width;
    const H = this.canvas.height;
    const ctx = this.ctx;

    // Background gradient
    const grad = ctx.createLinearGradient(0, 0, W, H);
    grad.addColorStop(0, '#050510');
    grad.addColorStop(0.5, '#0a0a1a');
    grad.addColorStop(1, '#080814');
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, W, H);

    // Grid lines
    ctx.strokeStyle = 'rgba(255,255,255,0.03)';
    ctx.lineWidth = 1;
    for (let x = 0; x < W; x += 80) {
      ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, H); ctx.stroke();
    }
    for (let y = 0; y < H; y += 80) {
      ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(W, y); ctx.stroke();
    }

    // Stars
    this.particles.forEach(p => {
      p.twinkle += p.twinkleSpeed;
      p.y -= p.speed;
      if (p.y < -5) { Object.assign(p, this._newStar(), { y: H + 5 }); }

      const alpha = p.opacity * (0.7 + 0.3 * Math.sin(p.twinkle));
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2);
      ctx.fillStyle = p.color.replace(')', `,${alpha})`).replace('rgb', 'rgba').replace('#', '');

      // Use hex color with opacity
      ctx.globalAlpha = alpha;
      ctx.fillStyle = p.color;
      ctx.fill();
      ctx.globalAlpha = 1;
    });

    // Floating music notes
    this.notes.forEach(n => {
      n.y -= n.speed;
      n.x += n.drift;
      n.rotation += n.rotSpeed;
      if (n.y < -50) { Object.assign(n, this._newNote()); }

      ctx.save();
      ctx.translate(n.x, n.y);
      ctx.rotate(n.rotation);
      ctx.globalAlpha = n.opacity;
      ctx.font = `${n.size}px serif`;
      ctx.fillStyle = '#f59e0b';
      ctx.textAlign = 'center';
      ctx.fillText(n.symbol, 0, 0);
      ctx.globalAlpha = 1;
      ctx.restore();
    });
  }

  // ── Buzz Flash Effect ─────────────────────────────
  flashBuzz(color = '#f59e0b') {
    const W = this.canvas.width;
    const H = this.canvas.height;
    const ctx = this.ctx;
    let alpha = 0.5;
    const fade = () => {
      ctx.fillStyle = color;
      ctx.globalAlpha = alpha;
      ctx.fillRect(0, 0, W, H);
      ctx.globalAlpha = 1;
      alpha -= 0.04;
      if (alpha > 0) requestAnimationFrame(fade);
    };
    requestAnimationFrame(fade);
  }

  // ── Ripple Effect on buzz ─────────────────────────
  ripple(x, y, color = '#f59e0b') {
    const ctx = this.ctx;
    let radius = 10;
    let alpha = 0.8;
    const draw = () => {
      ctx.beginPath();
      ctx.arc(x, y, radius, 0, Math.PI * 2);
      ctx.strokeStyle = color;
      ctx.lineWidth = 3;
      ctx.globalAlpha = alpha;
      ctx.stroke();
      ctx.globalAlpha = 1;
      radius += 15;
      alpha -= 0.05;
      if (alpha > 0) requestAnimationFrame(draw);
    };
    for (let i = 0; i < 3; i++) {
      setTimeout(() => requestAnimationFrame(draw), i * 150);
    }
  }
}

// ── Confetti Engine ───────────────────────────────
class ConfettiEngine {
  constructor(canvasId) {
    this.canvas = document.getElementById(canvasId);
    this.ctx = this.canvas.getContext('2d');
    this.pieces = [];
    this._raf = null;
    this.resize();
    window.addEventListener('resize', () => this.resize());
  }

  resize() {
    this.canvas.width = window.innerWidth;
    this.canvas.height = window.innerHeight;
  }

  _newPiece() {
    const colors = ['#f59e0b', '#ef4444', '#22c55e', '#3b82f6', '#a855f7', '#ec4899', '#06b6d4'];
    return {
      x: Math.random() * this.canvas.width,
      y: -10,
      w: Math.random() * 14 + 6,
      h: Math.random() * 8 + 4,
      color: colors[Math.floor(Math.random() * colors.length)],
      vx: (Math.random() - 0.5) * 4,
      vy: Math.random() * 3 + 2,
      rotation: Math.random() * Math.PI * 2,
      rotSpeed: (Math.random() - 0.5) * 0.2,
      opacity: 1,
    };
  }

  burst(count = 200) {
    for (let i = 0; i < count; i++) {
      const p = this._newPiece();
      p.x = this.canvas.width / 2 + (Math.random() - 0.5) * this.canvas.width;
      p.vy = Math.random() * 6 + 2;
      this.pieces.push(p);
    }
    this._loop();
  }

  _loop() {
    if (this._raf) cancelAnimationFrame(this._raf);
    this._raf = requestAnimationFrame(() => {
      this._draw();
      if (this.pieces.length > 0) this._loop();
    });
  }

  _draw() {
    const ctx = this.ctx;
    ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);

    this.pieces = this.pieces.filter(p => p.opacity > 0.01);
    this.pieces.forEach(p => {
      p.x += p.vx;
      p.y += p.vy;
      p.vy += 0.12; // gravity
      p.vx *= 0.99;
      p.rotation += p.rotSpeed;
      if (p.y > this.canvas.height * 0.7) p.opacity -= 0.015;

      ctx.save();
      ctx.translate(p.x, p.y);
      ctx.rotate(p.rotation);
      ctx.globalAlpha = p.opacity;
      ctx.fillStyle = p.color;
      ctx.fillRect(-p.w / 2, -p.h / 2, p.w, p.h);
      ctx.restore();
    });
  }
}

window.GraphicsEngine = GraphicsEngine;
window.ConfettiEngine = ConfettiEngine;
