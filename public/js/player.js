/**
 * Big Boys Music Quiz 2026 – Spelar-klient
 */

const socket = io();

// Player state
let myName = null;
let myColor = null;
let myScore = 0;
let hasBuzzed = false;
let hasAnswered = false;

// ── Screen Management ──────────────────────────────
const screens = {
  select: document.getElementById('screen-select'),
  lobby: document.getElementById('screen-lobby'),
  buzz: document.getElementById('screen-buzz'),
  mc: document.getElementById('screen-mc'),
  reveal: document.getElementById('screen-reveal'),
  gameover: document.getElementById('screen-gameover'),
};

let currentScreen = 'select';

function showScreen(name) {
  if (currentScreen === name) return;
  const old = screens[currentScreen];
  if (old) { old.classList.remove('active'); old.style.display = 'none'; }
  currentScreen = name;
  const next = screens[name];
  if (next) {
    next.style.display = 'flex';
    requestAnimationFrame(() => next.classList.add('active'));
  }
}

// ── Haptic Feedback ───────────────────────────────
function vibrate(pattern = [30]) {
  if (navigator.vibrate) navigator.vibrate(pattern);
}

// ── Simple Beep (player audio) ───────────────────
let _audioCtx = null;
function getAudioCtx() {
  if (!_audioCtx) _audioCtx = new (window.AudioContext || window.webkitAudioContext)();
  if (_audioCtx.state === 'suspended') _audioCtx.resume();
  return _audioCtx;
}

function beep(freq = 440, dur = 0.15, type = 'sine', gainVal = 0.3) {
  try {
    const ctx = getAudioCtx();
    const t = ctx.currentTime;
    const osc = ctx.createOscillator();
    const g = ctx.createGain();
    osc.type = type;
    osc.frequency.value = freq;
    g.gain.setValueAtTime(gainVal, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    osc.connect(g); g.connect(ctx.destination);
    osc.start(t); osc.stop(t + dur + 0.05);
  } catch (e) {}
}

function playBuzzBeep() {
  beep(200, 0.12, 'sawtooth', 0.5);
  setTimeout(() => beep(180, 0.12, 'sawtooth', 0.4), 80);
  setTimeout(() => beep(160, 0.18, 'sawtooth', 0.3), 160);
  vibrate([50, 30, 50]);
}

function playCorrectBeep() {
  beep(523, 0.15, 'triangle', 0.4);
  setTimeout(() => beep(659, 0.15, 'triangle', 0.4), 120);
  setTimeout(() => beep(784, 0.25, 'triangle', 0.4), 240);
  vibrate([80]);
}

function playWrongBeep() {
  beep(220, 0.3, 'sawtooth', 0.3);
  setTimeout(() => beep(180, 0.4, 'sawtooth', 0.2), 200);
  vibrate([100, 50, 100]);
}

function playSelectBeep(color) {
  beep(440, 0.1, 'triangle', 0.3);
  vibrate([20]);
}

// ── Name Selection ────────────────────────────────
document.querySelectorAll('.name-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    const name = btn.dataset.name;
    const color = btn.dataset.color;
    playSelectBeep(color);
    document.querySelectorAll('.name-btn').forEach(b => b.classList.remove('selected'));
    btn.classList.add('selected');

    socket.emit('player:join', { name });
  });
});

socket.on('join:ok', ({ name, color }) => {
  myName = name;
  myColor = color;

  // Set CSS variable for player color
  document.documentElement.style.setProperty('--player-color', color);

  // Update lobby card
  document.getElementById('player-avatar').textContent = name[0];
  document.getElementById('player-avatar').style.background = color;
  document.getElementById('player-name-display').textContent = name;
  document.getElementById('player-name-display').style.color = color;
  document.getElementById('player-score').style.color = color;

  // Update lobby card border
  document.getElementById('player-card').style.borderColor = color;
  document.getElementById('player-card').style.boxShadow = `0 0 40px ${color}33`;

  showScreen('lobby');
});

socket.on('join:error', ({ message }) => {
  const err = document.getElementById('select-error');
  err.textContent = message;
  err.classList.remove('hidden');
  setTimeout(() => err.classList.add('hidden'), 3000);
  vibrate([100, 50, 100]);
});

// ── State Updates ─────────────────────────────────
let prevPhase = null;
let prevQuestionIndex = -1;
let prevBuzzedBy = null;

const LABELS = ['A', 'B', 'C', 'D'];

socket.on('state', (state) => {
  const { phase, players, currentQuestion, buzzedBy, timer, questionIndex } = state;

  // Update own score
  const myPlayer = Object.values(players).find(p => p.name === myName);
  if (myPlayer) {
    myScore = myPlayer.score;
    document.getElementById('player-score').textContent = myScore;
  }

  // If not yet joined, stay on select screen
  if (!myName) return;

  // Phase logic
  if (phase === 'lobby' || phase === 'countdown') {
    showScreen('lobby');
    document.getElementById('lobby-status').querySelector('span').textContent =
      phase === 'countdown' ? 'Quizet startar…' : 'Väntar på att quizet startar…';
  }

  if (phase === 'question') {
    hasBuzzed = false;
    hasAnswered = false;
    const q = currentQuestion;
    if (!q) return;

    if (q.type === 'buzz') {
      showBuzzScreen(q);
    } else if (q.type === 'multiple-choice') {
      showMCScreen(q);
    }
  }

  if (phase === 'buzz_open') {
    if (currentQuestion?.type === 'buzz') {
      const btn = document.getElementById('buzz-btn');
      btn.classList.remove('buzzed', 'taken');
      document.getElementById('buzz-status').textContent = '';
      btn.querySelector('.buzz-btn-label').textContent = 'BUZZ!';
    }
  }

  if (phase === 'buzz_claimed') {
    const isMe = buzzedBy && players[buzzedBy]?.name === myName;
    const btn = document.getElementById('buzz-btn');
    if (isMe) {
      btn.classList.add('buzzed');
      btn.querySelector('.buzz-btn-label').textContent = '⚡ DU!';
      document.getElementById('buzz-status').textContent = 'Du buzzade in! Svara högt!';
    } else if (buzzedBy) {
      btn.classList.add('taken');
      const who = players[buzzedBy]?.name || '?';
      document.getElementById('buzz-status').textContent = `${who} buzzade in!`;
    }
  }

  if (phase === 'reveal') {
    const q = currentQuestion;
    const myAnswerData = myPlayer ? Object.entries(state.answers).find(([id]) => players[id]?.name === myName) : null;
    const myAnswer = myAnswerData ? myAnswerData[1] : null;
    showRevealScreen(q, myAnswer);
  }

  if (phase === 'game_over') {
    showGameOver(players);
  }

  // Timer bar update
  if (phase === 'buzz_open' && currentQuestion) {
    const max = currentQuestion.type === 'multiple-choice' ? 20 : 30;
    const fraction = Math.max(0, timer / max);
    const barEl = currentQuestion.type === 'multiple-choice'
      ? document.getElementById('mc-timer-bar')
      : document.getElementById('timer-bar');
    if (barEl) {
      barEl.style.width = (fraction * 100) + '%';
      if (fraction < 0.3) barEl.classList.add('warning');
      else barEl.classList.remove('warning');
    }
  }

  prevPhase = phase;
  prevQuestionIndex = questionIndex;
  prevBuzzedBy = buzzedBy;
});

// ── Buzz Screen ───────────────────────────────────
function showBuzzScreen(q) {
  document.getElementById('buzz-question-text').textContent = q.question;
  document.getElementById('buzz-status').textContent = '';
  const btn = document.getElementById('buzz-btn');
  btn.classList.remove('buzzed', 'taken');
  btn.querySelector('.buzz-btn-label').textContent = 'BUZZ!';
  const bar = document.getElementById('timer-bar');
  if (bar) { bar.style.width = '100%'; bar.classList.remove('warning'); }
  showScreen('buzz');
}

document.getElementById('buzz-btn').addEventListener('click', () => {
  if (hasBuzzed) return;
  hasBuzzed = true;
  playBuzzBeep();
  socket.emit('player:buzz');
});

// ── Multiple Choice Screen ────────────────────────
function showMCScreen(q) {
  document.getElementById('mc-category').textContent = q.category || '';
  document.getElementById('mc-question').textContent = q.question;
  document.getElementById('mc-status').textContent = '';
  hasAnswered = false;

  const bar = document.getElementById('mc-timer-bar');
  if (bar) { bar.style.width = '100%'; bar.classList.remove('warning'); }

  const opts = document.getElementById('mc-options');
  opts.innerHTML = '';
  (q.options || []).forEach((opt, i) => {
    const btn = document.createElement('button');
    btn.className = 'mc-btn';
    btn.dataset.answer = opt;
    btn.innerHTML = `<span class="mc-label">${LABELS[i]}</span><span>${opt}</span>`;
    btn.addEventListener('click', () => {
      if (hasAnswered) return;
      hasAnswered = true;
      document.querySelectorAll('.mc-btn').forEach(b => { b.disabled = true; b.classList.remove('selected'); });
      btn.classList.add('selected');
      beep(440, 0.1, 'triangle', 0.3);
      vibrate([25]);
      document.getElementById('mc-status').textContent = 'Svar skickat! ✓';
      socket.emit('player:answer', { answer: opt });
    });
    opts.appendChild(btn);
  });

  showScreen('mc');
}

// ── Reveal Screen ─────────────────────────────────
function showRevealScreen(q, myAnswer) {
  const correct = myAnswer?.correct;
  const pts = myAnswer?.points || 0;

  const icon = document.getElementById('reveal-icon');
  const text = document.getElementById('reveal-result-text');
  const ptsEl = document.getElementById('reveal-pts');

  if (!myAnswer) {
    icon.textContent = '⏳';
    text.textContent = 'Inget svar';
    text.style.color = 'var(--muted)';
    ptsEl.textContent = '';
  } else if (correct) {
    icon.textContent = '✅';
    text.textContent = 'Rätt!';
    text.style.color = 'var(--green)';
    ptsEl.textContent = `+${pts} poäng!`;
    playCorrectBeep();
  } else {
    icon.textContent = '❌';
    text.textContent = 'Fel!';
    text.style.color = 'var(--red)';
    ptsEl.textContent = '';
    playWrongBeep();
  }

  document.getElementById('reveal-answer-val').textContent = q?.answer || '–';
  showScreen('reveal');
}

// ── Game Over ─────────────────────────────────────
function showGameOver(players) {
  const sorted = Object.values(players)
    .filter(p => p.connected)
    .sort((a, b) => b.score - a.score);

  const myRank = sorted.findIndex(p => p.name === myName) + 1;
  const rankLabels = ['🥇 1:a plats!', '🥈 2:a plats!', '🥉 3:e plats!', '4:e plats'];
  const myFinalScore = sorted.find(p => p.name === myName)?.score || 0;

  document.getElementById('final-score-display').textContent = `${myFinalScore}p`;
  document.getElementById('final-rank').textContent = rankLabels[myRank - 1] || `${myRank}:e plats`;

  if (myRank === 1) {
    beep(523, 0.15, 'triangle', 0.4);
    setTimeout(() => beep(659, 0.15, 'triangle', 0.4), 150);
    setTimeout(() => beep(784, 0.3, 'triangle', 0.4), 300);
    vibrate([200, 100, 200, 100, 200]);
  }

  showScreen('gameover');
}

// ── Connection Handling ───────────────────────────
socket.on('disconnect', () => {
  document.getElementById('lobby-status').querySelector('span').textContent = 'Anslutning förlorad…';
});

socket.on('connect', () => {
  if (myName) socket.emit('player:join', { name: myName });
});
