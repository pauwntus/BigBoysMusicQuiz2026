/**
 * Big Boys Music Quiz 2026 – Host Controller
 */

const socket = io();

// Graphics & Audio
const gfx = new GraphicsEngine('bgCanvas');
gfx.start();
let confetti = null;

// TTS – Programledare (Swedish)
let ttsVoice = null;
function initTTS() {
  const load = () => {
    const voices = speechSynthesis.getVoices();
    ttsVoice = voices.find(v => v.lang.startsWith('sv')) || voices[0] || null;
  };
  load();
  speechSynthesis.onvoiceschanged = load;
}

function speak(text, rate = 0.92, pitch = 1.05) {
  speechSynthesis.cancel();
  if (!text) return;
  const utt = new SpeechSynthesisUtterance(text);
  utt.lang = 'sv-SE';
  utt.rate = rate;
  utt.pitch = pitch;
  utt.volume = 1;
  if (ttsVoice) utt.voice = ttsVoice;
  speechSynthesis.speak(utt);
}

initTTS();
audio.init();

// ── Screen Management ──────────────────────────────
const screens = {
  lobby: document.getElementById('screen-lobby'),
  countdown: document.getElementById('screen-countdown'),
  question: document.getElementById('screen-question'),
  reveal: document.getElementById('screen-reveal'),
  scoreboard: document.getElementById('screen-scoreboard'),
  gameover: document.getElementById('screen-gameover'),
};

let currentScreen = 'lobby';

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

// ── QR Code ───────────────────────────────────────
(async () => {
  try {
    const res = await fetch('/api/qr');
    const { url, qr } = await res.json();
    document.getElementById('qr-container').innerHTML = `<img src="${qr}" alt="QR">`;
    document.getElementById('connect-url').textContent = url;
  } catch (e) {
    document.getElementById('qr-container').innerHTML = '<p style="color:#888">QR ej tillgänglig</p>';
  }
})();

// ── Lobby ─────────────────────────────────────────
document.getElementById('btn-start').addEventListener('click', () => {
  audio.resume();
  socket.emit('host:start');
});

function updateLobby(players) {
  const names = ['Johan', 'Langos', 'Andy', 'Pontus'];
  const connectedNames = Object.values(players).filter(p => p.connected).map(p => p.name);
  names.forEach(name => {
    const slot = document.querySelector(`.player-slot[data-name="${name}"]`);
    const status = document.getElementById(`status-${name}`);
    if (connectedNames.includes(name)) {
      slot.classList.add('connected');
      status.textContent = '✓ Ansluten';
      status.classList.add('connected');
    } else {
      slot.classList.remove('connected');
      status.textContent = 'Väntar…';
      status.classList.remove('connected');
    }
  });
  document.getElementById('btn-start').disabled = connectedNames.length === 0;
}

// ── Countdown ─────────────────────────────────────
let countdownInterval = null;
function runCountdown(from = 3) {
  const el = document.getElementById('countdown-number');
  let n = from;
  el.textContent = n;
  audio.playCountdownBeep(n);
  speak(`${n}...`);
  countdownInterval = setInterval(() => {
    n--;
    if (n > 0) {
      el.textContent = n;
      audio.playCountdownBeep(n);
      speak(`${n}...`);
    } else {
      clearInterval(countdownInterval);
      el.textContent = 'QUIZ!';
      audio.playGameStart();
      speak('Välkommen till Big Boys Music Quiz tjugohundraextrasex! Nu kör vi!', 0.88, 1.1);
      setTimeout(() => socket.emit('host:next'), 2500);
    }
  }, 1200);
}

// ── Question Display ──────────────────────────────
const LABELS = ['A', 'B', 'C', 'D'];
let timerMax = 20;
let timerCircumference = 2 * Math.PI * 54;

document.getElementById('btn-reveal').addEventListener('click', () => socket.emit('host:reveal'));
document.getElementById('btn-correct').addEventListener('click', () => {
  audio.playCorrect();
  socket.emit('host:correct');
});
document.getElementById('btn-wrong').addEventListener('click', () => {
  audio.playWrong();
  socket.emit('host:wrong');
});

function renderQuestion(state) {
  const q = state.currentQuestion;
  if (!q) return;

  document.getElementById('q-category').textContent = q.category || '';
  document.getElementById('q-progress').textContent = `Fråga ${state.questionIndex + 1} / ${state.totalQuestions}`;
  document.getElementById('q-points').textContent = `⭐ ${q.points || 2}p`;
  document.getElementById('q-text').textContent = q.question;

  const grid = document.getElementById('q-options');
  grid.innerHTML = '';

  if (q.type === 'multiple-choice' && q.options) {
    q.options.forEach((opt, i) => {
      const btn = document.createElement('div');
      btn.className = 'option-btn';
      btn.dataset.opt = opt;
      btn.innerHTML = `<span class="option-label">${LABELS[i]}</span><span>${opt}</span>`;
      grid.appendChild(btn);
    });
  } else {
    grid.innerHTML = `<p style="color:#a855f7;font-size:1.2rem;font-style:italic;text-align:center;grid-column:1/-1">🎤 Buzz-in fråga – tryck på buzz-knappen!</p>`;
  }

  // Host controls
  document.getElementById('btn-reveal').style.display = 'inline-block';
  document.getElementById('btn-correct').style.display = 'none';
  document.getElementById('btn-wrong').style.display = 'none';
}

function updateTimer(seconds, max) {
  const ring = document.getElementById('timer-ring');
  const num = document.getElementById('timer-num');
  if (!ring || !num) return;

  const fraction = seconds / max;
  const offset = timerCircumference * (1 - fraction);
  ring.style.strokeDashoffset = offset;
  num.textContent = seconds;

  if (seconds <= 5) {
    ring.classList.add('warning');
    num.style.color = 'var(--red)';
  } else {
    ring.classList.remove('warning');
    num.style.color = 'var(--accent)';
  }
}

// ── Buzz Overlay ──────────────────────────────────
const buzzOverlay = document.getElementById('buzz-overlay');
function showBuzz(playerName, color) {
  document.getElementById('buzz-player-name').textContent = playerName.toUpperCase();
  document.getElementById('buzz-player-name').style.color = color || '#f59e0b';
  buzzOverlay.classList.remove('hidden');
  audio.playBuzz();
  gfx.flashBuzz(color || '#f59e0b');
  speak(`${playerName} buzzade in!`, 0.95, 1.2);

  // Show correct/wrong buttons
  document.getElementById('btn-correct').style.display = 'inline-block';
  document.getElementById('btn-wrong').style.display = 'inline-block';
  document.getElementById('btn-reveal').style.display = 'none';
}

function hideBuzz() {
  buzzOverlay.classList.add('hidden');
}

// ── Reveal ────────────────────────────────────────
function renderReveal(state) {
  const q = state.currentQuestion;
  if (!q) return;

  document.getElementById('reveal-category').textContent = q.category || '';
  document.getElementById('reveal-question').textContent = q.question;
  document.getElementById('reveal-answer').textContent = q.answer || '–';
  document.getElementById('reveal-explanation').textContent = q.explanation || '';

  // Mark correct/wrong options
  if (q.type === 'multiple-choice') {
    document.querySelectorAll('.option-btn').forEach(btn => {
      if (btn.dataset.opt === q.answer) btn.classList.add('correct');
    });
  }

  // Results
  const results = document.getElementById('reveal-results');
  results.innerHTML = '';
  Object.entries(state.answers).forEach(([id, ans]) => {
    const player = state.players[id];
    if (!player) return;
    const chip = document.createElement('div');
    chip.className = `result-chip ${ans.correct ? 'correct' : 'wrong'}`;
    chip.innerHTML = `${ans.correct ? '✓' : '✗'} <strong>${player.name}</strong> ${ans.correct ? `+${ans.points}p` : ''}`;
    results.appendChild(chip);
  });
}

// ── Scoreboard ────────────────────────────────────
function renderScoreboard(players, nextBtnId = 'btn-next-from-score') {
  const sorted = Object.values(players)
    .filter(p => p.connected)
    .sort((a, b) => b.score - a.score);

  const maxScore = sorted[0]?.score || 1;
  const ranks = ['🥇', '🥈', '🥉', '4️⃣'];

  const list = document.getElementById('scoreboard-list');
  if (!list) return;
  list.innerHTML = '';
  sorted.forEach((p, i) => {
    const row = document.createElement('div');
    row.className = 'score-row';
    const barWidth = Math.max(5, (p.score / maxScore) * 100);
    row.innerHTML = `
      <div class="score-rank">${ranks[i] || (i + 1)}</div>
      <div class="score-avatar" style="background:${p.color}">${p.name[0]}</div>
      <div class="score-name">${p.name}</div>
      <div class="score-bar-wrap">
        <div class="score-bar" style="width:0%;background:${p.color}" data-target="${barWidth}"></div>
      </div>
      <div class="score-pts">${p.score}p</div>
    `;
    list.appendChild(row);
    setTimeout(() => {
      row.querySelector('.score-bar').style.width = barWidth + '%';
    }, 100 + i * 150);
  });
}

// ── Game Over ─────────────────────────────────────
function renderGameOver(players) {
  const sorted = Object.values(players)
    .filter(p => p.connected)
    .sort((a, b) => b.score - a.score);

  const winner = sorted[0];
  const winnerEl = document.getElementById('winner-announce');
  winnerEl.innerHTML = winner
    ? `<span style="color:${winner.color}">🏆 ${winner.name}</span> vinner med <strong>${winner.score} poäng</strong>!`
    : '';

  const finalScores = document.getElementById('final-scores');
  finalScores.innerHTML = '';
  sorted.forEach((p, i) => {
    const el = document.createElement('div');
    el.className = 'score-row';
    el.innerHTML = `
      <div class="score-rank">${['🥇','🥈','🥉','4️⃣'][i] || (i+1)}</div>
      <div class="score-avatar" style="background:${p.color}">${p.name[0]}</div>
      <div class="score-name">${p.name}</div>
      <div class="score-pts" style="color:${p.color}">${p.score}p</div>
    `;
    finalScores.appendChild(el);
  });

  // Confetti!
  if (!confetti) confetti = new ConfettiEngine('confetti-canvas');
  setTimeout(() => confetti.burst(300), 300);
  setTimeout(() => confetti.burst(200), 1200);
  setTimeout(() => confetti.burst(150), 2200);

  audio.playCelebration();
  if (winner) {
    speak(`Spelet är slut! Vinnaren är ${winner.name} med ${winner.score} poäng! Grattis!`, 0.88, 1.1);
  }
}

document.getElementById('btn-reset').addEventListener('click', () => socket.emit('host:reset'));

// ── Next buttons ──────────────────────────────────
document.getElementById('btn-next').addEventListener('click', () => socket.emit('host:next'));
document.getElementById('btn-next-from-score').addEventListener('click', () => socket.emit('host:next'));

// ── State Machine ─────────────────────────────────
let prevPhase = null;
let prevBuzzedBy = null;
let prevIndex = -1;

socket.on('state', (state) => {
  const { phase, players, currentQuestion, buzzedBy, timer, questionIndex } = state;

  // Update lobby player status always
  updateLobby(players);

  // Phase transitions
  if (phase !== prevPhase || (phase === 'buzz_open' && buzzedBy !== prevBuzzedBy)) {

    if (phase === 'lobby') {
      showScreen('lobby');
      audio.startLobbyMusic();
    }

    if (phase === 'countdown' && prevPhase === 'lobby') {
      showScreen('countdown');
      audio.stopLobbyMusic();
      runCountdown(3);
    }

    if (phase === 'question' && questionIndex !== prevIndex) {
      showScreen('question');
      hideBuzz();
      renderQuestion(state);
      const q = state.currentQuestion;
      const roundAnnounce = questionIndex === 0 ? 'Fråga nummer ett!' :
        questionIndex % 5 === 0 ? `Ny runda! Fråga nummer ${questionIndex + 1}!` :
        `Fråga nummer ${questionIndex + 1}.`;
      speak(`${roundAnnounce} Kategori: ${q?.category || ''}. ${q?.question || ''}`, 0.88);
      prevIndex = questionIndex;
    }

    if (phase === 'buzz_open' && !buzzedBy) {
      hideBuzz();
      if (currentQuestion?.type === 'multiple-choice') {
        audio.playTensionLoop(20);
      }
    }

    if (phase === 'buzz_claimed' && buzzedBy && buzzedBy !== prevBuzzedBy) {
      const player = players[buzzedBy];
      if (player) showBuzz(player.name, player.color);
    }

    if (phase === 'reveal') {
      hideBuzz();
      renderReveal(state);
      showScreen('reveal');
      const correct = state.currentQuestion?.answer;
      speak(`Rätt svar: ${correct}. ${state.currentQuestion?.explanation || ''}`, 0.88);
    }

    if (phase === 'game_over') {
      showScreen('gameover');
      renderGameOver(players);
    }
  }

  // Timer update
  if (phase === 'buzz_open' && timer > 0) {
    const max = currentQuestion?.type === 'multiple-choice' ? 20 : 30;
    updateTimer(timer, max);
    if (timer <= 5 && timer > 0) audio.playCountdownBeep(timer);
  }

  prevPhase = phase;
  prevBuzzedBy = buzzedBy;
});
