/**
 * Big Boys Music Quiz 2026 – Web Audio Engine
 * Programmerade ljud och musik via Web Audio API
 */

class AudioEngine {
  constructor() {
    this.ctx = null;
    this.master = null;
    this.bgNode = null;
    this.bgGain = null;
    this._lobbyLoop = null;
    this._inited = false;
  }

  init() {
    if (this._inited) return;
    this.ctx = new (window.AudioContext || window.webkitAudioContext)();
    this.master = this.ctx.createGain();
    this.master.gain.value = 0.8;
    this.master.connect(this.ctx.destination);
    this._inited = true;
  }

  resume() {
    if (this.ctx && this.ctx.state === 'suspended') this.ctx.resume();
  }

  // ── Helpers ──────────────────────────────────────
  _osc(type, freq, start, dur, gainVal = 0.3, dest = null) {
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(gainVal, start);
    g.gain.exponentialRampToValueAtTime(0.0001, start + dur);
    g.connect(dest || this.master);

    const o = this.ctx.createOscillator();
    o.type = type;
    o.frequency.setValueAtTime(freq, start);
    o.connect(g);
    o.start(start);
    o.stop(start + dur + 0.05);
    return o;
  }

  _noise(start, dur, gainVal = 0.1, filterFreq = 2000) {
    const buf = this.ctx.createBuffer(1, this.ctx.sampleRate * dur, this.ctx.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;

    const src = this.ctx.createBufferSource();
    src.buffer = buf;

    const filt = this.ctx.createBiquadFilter();
    filt.type = 'bandpass';
    filt.frequency.value = filterFreq;
    filt.Q.value = 0.5;

    const g = this.ctx.createGain();
    g.gain.setValueAtTime(gainVal, start);
    g.gain.exponentialRampToValueAtTime(0.0001, start + dur);

    src.connect(filt);
    filt.connect(g);
    g.connect(this.master);
    src.start(start);
    src.stop(start + dur + 0.01);
  }

  // ── BUZZ SOUND ────────────────────────────────────
  playBuzz(color = '#ffffff') {
    this.resume();
    const t = this.ctx.currentTime;
    // Sharp sawtooth buzz
    for (let i = 0; i < 3; i++) {
      this._osc('sawtooth', 120 + i * 30, t + i * 0.06, 0.18, 0.5);
    }
    this._noise(t, 0.15, 0.3, 800);
  }

  // ── CORRECT ANSWER ────────────────────────────────
  playCorrect() {
    this.resume();
    const t = this.ctx.currentTime;
    const notes = [523.25, 659.25, 783.99, 1046.5]; // C5, E5, G5, C6
    notes.forEach((freq, i) => {
      this._osc('triangle', freq, t + i * 0.1, 0.4, 0.35);
      this._osc('sine', freq * 2, t + i * 0.1, 0.25, 0.1);
    });
    // Final chord shimmer
    [523.25, 659.25, 783.99, 1046.5].forEach(f => {
      this._osc('sine', f, t + 0.5, 0.6, 0.15);
    });
  }

  // ── WRONG ANSWER ──────────────────────────────────
  playWrong() {
    this.resume();
    const t = this.ctx.currentTime;
    // Sad descending trombone-ish
    const osc = this.ctx.createOscillator();
    osc.type = 'sawtooth';
    osc.frequency.setValueAtTime(300, t);
    osc.frequency.exponentialRampToValueAtTime(80, t + 0.8);

    const filt = this.ctx.createBiquadFilter();
    filt.type = 'lowpass';
    filt.frequency.setValueAtTime(800, t);
    filt.frequency.exponentialRampToValueAtTime(200, t + 0.8);

    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0.4, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.9);

    osc.connect(filt); filt.connect(g); g.connect(this.master);
    osc.start(t); osc.stop(t + 1);
  }

  // ── COUNTDOWN BEEP ───────────────────────────────
  playCountdownBeep(n) {
    this.resume();
    const t = this.ctx.currentTime;
    const freq = n === 0 ? 880 : 440;
    const dur = n === 0 ? 0.5 : 0.15;
    this._osc('sine', freq, t, dur, 0.4);
    if (n === 0) this._osc('sine', freq * 1.5, t, dur, 0.2);
  }

  // ── REVEAL STING ──────────────────────────────────
  playRevealSting() {
    this.resume();
    const t = this.ctx.currentTime;
    // Drum roll
    for (let i = 0; i < 16; i++) {
      this._noise(t + i * 0.04, 0.06, 0.15 + i * 0.01, 3000);
    }
    // Big finish
    const chord = [261.63, 329.63, 392, 523.25];
    chord.forEach(f => this._osc('sawtooth', f, t + 0.75, 0.5, 0.2));
  }

  // ── GAME START FANFARE ────────────────────────────
  playGameStart() {
    this.resume();
    const t = this.ctx.currentTime;
    const melody = [
      [523.25, 0], [659.25, 0.15], [783.99, 0.3], [1046.5, 0.45],
      [783.99, 0.6], [1046.5, 0.75],
    ];
    melody.forEach(([f, offset]) => {
      this._osc('triangle', f, t + offset, 0.3, 0.4);
      this._osc('sine', f * 2, t + offset, 0.2, 0.1);
    });
    // Rhythm hits
    for (let i = 0; i < 4; i++) {
      this._noise(t + i * 0.25, 0.08, 0.4, 5000); // hihat
      if (i % 2 === 0) this._noise(t + i * 0.25, 0.15, 0.6, 100); // kick
    }
  }

  // ── CELEBRATION ───────────────────────────────────
  playCelebration() {
    this.resume();
    const t = this.ctx.currentTime;

    // Full chord arpeggio x3
    const notes = [261.63, 329.63, 392, 523.25, 659.25, 783.99, 1046.5];
    notes.forEach((f, i) => {
      this._osc('triangle', f, t + i * 0.07, 1.5 - i * 0.1, 0.3);
      this._osc('sine', f * 2, t + 0.5 + i * 0.07, 1.2, 0.15);
    });

    // Percussion
    for (let i = 0; i < 16; i++) {
      this._noise(t + i * 0.125, 0.06, 0.3, 4000); // hihat
      if (i % 4 === 0) this._noise(t + i * 0.125, 0.18, 0.7, 80); // kick
      if (i % 4 === 2) this._noise(t + i * 0.125, 0.12, 0.5, 300); // snare
    }

    // Big finale chord
    [261.63, 329.63, 392, 523.25, 659.25].forEach(f => {
      this._osc('sawtooth', f, t + 1.8, 1.2, 0.15);
    });
  }

  // ── LOBBY BACKGROUND MUSIC ────────────────────────
  startLobbyMusic() {
    this.resume();
    if (this.bgGain) return;

    this.bgGain = this.ctx.createGain();
    this.bgGain.gain.value = 0.18;
    this.bgGain.connect(this.master);

    // Simple bass/chord loop
    const BPM = 118;
    const beat = 60 / BPM;

    const bassLine = [65.41, 73.42, 65.41, 87.31]; // C2, D2, C2, E2
    const chordRoots = [261.63, 293.66, 261.63, 329.63]; // C4, D4, C4, E4

    let loopStart = this.ctx.currentTime + 0.1;
    const loopLength = beat * 8;

    const scheduleLoop = (start) => {
      bassLine.forEach((f, i) => {
        const osc = this.ctx.createOscillator();
        osc.type = 'sawtooth';
        osc.frequency.value = f;
        const filt = this.ctx.createBiquadFilter();
        filt.type = 'lowpass';
        filt.frequency.value = 400;
        const g = this.ctx.createGain();
        const noteStart = start + i * beat * 2;
        g.gain.setValueAtTime(0, noteStart);
        g.gain.linearRampToValueAtTime(0.6, noteStart + 0.02);
        g.gain.setValueAtTime(0.6, noteStart + beat * 1.8);
        g.gain.linearRampToValueAtTime(0, noteStart + beat * 2);
        osc.connect(filt); filt.connect(g); g.connect(this.bgGain);
        osc.start(noteStart); osc.stop(noteStart + beat * 2 + 0.05);
      });

      // Chord stabs on beat 2 and 4
      [1, 3, 5, 7].forEach(b => {
        const chord = chordRoots.map(r => r * (b % 4 < 2 ? 1 : 1.25));
        chord.forEach(f => {
          const osc = this.ctx.createOscillator();
          osc.type = 'square';
          osc.frequency.value = f;
          const filt = this.ctx.createBiquadFilter();
          filt.type = 'bandpass';
          filt.frequency.value = 800;
          filt.Q.value = 2;
          const g = this.ctx.createGain();
          const ns = start + b * beat;
          g.gain.setValueAtTime(0.2, ns);
          g.gain.exponentialRampToValueAtTime(0.0001, ns + 0.18);
          osc.connect(filt); filt.connect(g); g.connect(this.bgGain);
          osc.start(ns); osc.stop(ns + 0.25);
        });
      });

      // Schedule next
      this._lobbyLoop = setTimeout(() => scheduleLoop(start + loopLength), (loopLength - 0.2) * 1000);
    };

    scheduleLoop(loopStart);
  }

  stopLobbyMusic() {
    if (this._lobbyLoop) { clearTimeout(this._lobbyLoop); this._lobbyLoop = null; }
    if (this.bgGain) {
      this.bgGain.gain.linearRampToValueAtTime(0, this.ctx.currentTime + 0.5);
      setTimeout(() => { this.bgGain = null; }, 600);
    }
  }

  // ── QUESTION TENSION LOOP ─────────────────────────
  playTensionLoop(durationSec = 20) {
    this.resume();
    const t = this.ctx.currentTime;
    const BPM = 140;
    const beat = 60 / BPM;

    // Pulsing pad
    const freqs = [130.81, 164.81, 196, 220]; // C3 chord
    freqs.forEach(f => {
      const osc = this.ctx.createOscillator();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(f, t);
      osc.frequency.linearRampToValueAtTime(f * 1.01, t + durationSec);
      const tremolo = this.ctx.createGain();
      const lfo = this.ctx.createOscillator();
      lfo.frequency.value = 4 + Math.random() * 2;
      lfo.connect(tremolo.gain);
      lfo.start(t); lfo.stop(t + durationSec);
      tremolo.gain.value = 0.08;
      const g = this.ctx.createGain();
      g.gain.setValueAtTime(0.05, t);
      g.gain.linearRampToValueAtTime(0.1, t + durationSec * 0.7);
      g.gain.linearRampToValueAtTime(0.18, t + durationSec * 0.9);
      osc.connect(tremolo); tremolo.connect(g); g.connect(this.master);
      osc.start(t); osc.stop(t + durationSec + 0.1);
    });

    // Hi-hat pulse getting faster
    const totalBeats = Math.floor(durationSec / beat);
    for (let i = 0; i < totalBeats; i++) {
      const ratio = i / totalBeats;
      const subDiv = ratio > 0.6 ? 0.5 : 1;
      this._noise(t + i * beat * subDiv, 0.04, 0.06 + ratio * 0.1, 6000);
    }
  }
}

// Global instance
window.audio = new AudioEngine();
