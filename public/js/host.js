/**
 * Big Boys Music Quiz 2026 – Host Controller
 */

const socket = io();

// Graphics & Audio
const gfx = new GraphicsEngine('bgCanvas');
gfx.start();
let confetti = null;

// ── TTS – ElevenLabs med Web Speech fallback ──────────────────────────
let ttsVoice = null;
let ttsAudio = null;      // aktiv ElevenLabs Audio-instans
let elevenLabsOK = null;  // null=okänd, true=funkar, false=ej konfigurerad
let ttsResolve = null;    // löser aktiv speak()-promise vid avbrott

function initTTS() {
  const load = () => {
    const voices = speechSynthesis.getVoices();
    ttsVoice = voices.find(v => v.lang === 'sv-SE')
      || voices.find(v => v.lang.startsWith('sv'))
      || voices.find(v => v.lang.startsWith('en'))
      || voices[0] || null;
  };
  load();
  speechSynthesis.onvoiceschanged = load;
}

function speakFallback(text) {
  return new Promise((resolve) => {
    speechSynthesis.cancel();
    if (!text) { resolve(); return; }
    const utt = new SpeechSynthesisUtterance(text);
    utt.lang = 'sv-SE'; utt.rate = 0.88; utt.pitch = 1.1; utt.volume = 1;
    if (ttsVoice) utt.voice = ttsVoice;
    utt.onend = () => { stopTalking(); resolve(); };
    utt.onerror = () => { stopTalking(); resolve(); };
    startTalking();
    speechSynthesis.speak(utt);
  });
}

async function speak(text) {
  if (!text) return;
  speechSynthesis.cancel();
  if (ttsAudio) { ttsAudio.pause(); ttsAudio = null; }
  // Resolve any pending promise so awaiting code can continue
  if (ttsResolve) { ttsResolve(); ttsResolve = null; }
  stopTalking();

  if (elevenLabsOK === false) { return speakFallback(text); }

  try {
    const res = await fetch('/api/tts', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text }),
    });
    // 503 = ej konfigurerad, 401 = kvot slut – byt permanent till fallback
    if (res.status === 503 || res.status === 401) { elevenLabsOK = false; return speakFallback(text); }
    if (!res.ok) throw new Error(`HTTP ${res.status}`);

    elevenLabsOK = true;
    const blob = await res.blob();
    const url  = URL.createObjectURL(blob);

    return new Promise((resolve) => {
      ttsResolve = resolve;
      ttsAudio = new Audio(url);
      ttsAudio.onended = () => { URL.revokeObjectURL(url); ttsResolve = null; stopTalking(); resolve(); };
      ttsAudio.onerror = () => { URL.revokeObjectURL(url); ttsResolve = null; stopTalking(); resolve(); };
      startTalking();
      ttsAudio.play();
    });
  } catch (e) {
    console.warn('ElevenLabs TTS fel, faller tillbaka:', e.message);
    if (elevenLabsOK !== true) elevenLabsOK = false;
    return speakFallback(text);
  }
}

// ── Programledarfigur – mun & blinkning ───────────────────────────────
let talkingTimer = null;
let mouthOpen = false;

function startTalking() {
  if (talkingTimer) return;
  mouthOpen = false;
  talkingTimer = setInterval(() => {
    mouthOpen = !mouthOpen;
    const mo = document.getElementById('avatar-mouth-open');
    const mc = document.getElementById('avatar-mouth-closed');
    if (mo) mo.setAttribute('display', mouthOpen ? '' : 'none');
    if (mc) mc.style.display = mouthOpen ? 'none' : '';
  }, 120);
}

function stopTalking() {
  clearInterval(talkingTimer);
  talkingTimer = null;
  mouthOpen = false;
  const mo = document.getElementById('avatar-mouth-open');
  const mc = document.getElementById('avatar-mouth-closed');
  if (mo) mo.setAttribute('display', 'none');
  if (mc) mc.style.display = '';
}

function setAvatarPosition(pos) { // 'center' | 'corner'
  const el = document.getElementById('host-avatar');
  if (!el) return;
  el.classList.toggle('host-avatar--center', pos === 'center');
  el.classList.toggle('host-avatar--corner', pos === 'corner');
}

function ensureQuestionVisible() {
  const qText = document.getElementById('q-text');
  const qOpts = document.getElementById('q-options');
  if (qText) qText.style.opacity = '1';
  if (qOpts) qOpts.style.opacity = '1';
}

function initBlink() {
  function doBlink() {
    const l = document.getElementById('eyelid-l');
    const r = document.getElementById('eyelid-r');
    if (l) l.setAttribute('ry', '9');
    if (r) r.setAttribute('ry', '9');
    setTimeout(() => {
      if (l) l.setAttribute('ry', '1');
      if (r) r.setAttribute('ry', '1');
      setTimeout(doBlink, 2500 + Math.random() * 4000);
    }, 130);
  }
  setTimeout(doBlink, 1000 + Math.random() * 2000);
}

function pick(arr) { return arr[Math.floor(Math.random() * arr.length)]; }

const HOST = {
  intros: [
    'Ah, och nu väntar nästa fråga. Beredd? Det verkar optimistiskt.',
    'Tänk noga nu – hjärnan kan göra underverk när man ger den chansen.',
    'Nu kräver situationen eftertanke. Det vet jag, det är ovanligt.',
    'Spänningen är nästan outhärdlig – för mig i varje fall.',
    'Med sedvanlig elegans presenterar jag nu nästa fråga.',
    'En fråga som separerar de bildade från de övriga.',
    'Intellekten fram, mina vänner. Det är dags.',
  ],
  musicIntros: [
    'Ah, en MUSIKFRÅGA! Lyssna nu med hela din odelbara uppmärksamhet!',
    'Musik – själens föda! Och er chans att briljera. MUSIKFRÅGA!',
    'Nu träder musikhjärnan in på scenen. Applåder, tack!',
    'En MUSIKFRÅGA! Må de med öron – och minne – vinna.',
    'Det är musikens stund. Lyssna, tänk, och för guds skull – gissa inte.',
  ],
  allCorrect: [
    'Alla rätt! Antingen är ni fenomenala, eller också är jag för generös. Förmodligen det senare.',
    'Perfekt omgång. Jag är genuint imponerad, vilket sällan händer.',
    'Storartat! Ni har bevisat att intelligensen fortfarande frodas i detta rum.',
    'Alla?! ALLA?! Jag måste omedelbart skärpa nästa fråga avsevärt.',
  ],
  someCorrect: [
    'Delade läger. Som alltid när mänskligheten ställs inför sanningen.',
    'Hmm. Hälften lysande, hälften… charmigt begränsade.',
    'Blandade resultat. Precis som livet självt, om man tänker efter.',
    'Splittrade svar. Det är quiz-formens stora skönhet och förbannelse.',
  ],
  noneCorrect: [
    'Ingen rätt. Ingen alls. Jag är rörd, på ett sätt jag inte riktigt kan förklara.',
    'Noll poäng till samtliga. Det är faktiskt imponerande, fast på ett oroväckande sätt.',
    'Häpnadsväckande. Alla fel. Jag visste inte att det var möjligt, men här är vi.',
    'En fullständig katastrof. Jag föreslår att vi låtsas som om det inte hände och går vidare.',
  ],
  timeUp: [
    'Och med det är tidens tyranni ett faktum. Penslarna ner.',
    'Klockan har talat – med en viss oförsonlighet, måste jag säga.',
    'STOPP! Ingen mer tid. Livet är en grym mästare.',
  ],
};

initTTS();
initBlink();

// ── YouTube IFrame API ─────────────────────────────
let ytVideoPlayer = null;
let ytAudioPlayer = null;
let ytVideoReady = false;
let ytAudioReady = false;
let mediaState = { videoId: null, startAt: 0, audioOnly: true, isPlaying: false };

window.onYouTubeIframeAPIReady = () => {
  ytAudioPlayer = new YT.Player('yt-audio-player', {
    width: '1', height: '1',
    playerVars: { controls: 0, rel: 0, modestbranding: 1, disablekb: 1, iv_load_policy: 3 },
    events: { onReady: () => { ytAudioReady = true; } },
  });
  ytVideoPlayer = new YT.Player('yt-player-container', {
    width: '100%', height: '100%',
    playerVars: { controls: 1, rel: 0, modestbranding: 1, iv_load_policy: 3, fs: 0 },
    events: { onReady: () => { ytVideoReady = true; } },
  });
};

function loadMedia(media) {
  const area = document.getElementById('media-area');
  const audioEl = document.getElementById('media-audio');
  const videoEl = document.getElementById('media-video');
  const imageEl = document.getElementById('media-image');
  const playBtn = document.getElementById('btn-play-media');

  stopMedia(false);

  if (!media) { area.style.display = 'none'; return; }

  area.style.display = 'flex';
  audioEl.style.display = 'none';
  videoEl.style.display = 'none';
  imageEl.style.display = 'none';
  playBtn.style.display = 'none';

  if (media.type === 'youtube') {
    mediaState = { videoId: media.videoId, startAt: media.startAt || 0, audioOnly: media.audioOnly !== false, isPlaying: false };
    if (mediaState.audioOnly) {
      audioEl.style.display = 'flex';
      pauseSoundBars();
    } else {
      videoEl.style.display = 'flex';
    }
    playBtn.style.display = 'inline-block';
    playBtn.textContent = '▶ SPELA';
    playBtn.classList.remove('playing');
  } else if (media.type === 'image') {
    imageEl.style.display = 'flex';
    document.getElementById('media-img').src = media.url;
    document.getElementById('media-img').alt = media.alt || '';
  }
}

function autoPlayMedia() {
  const { videoId, startAt, audioOnly } = mediaState;
  if (!videoId) return;
  function attempt() {
    try {
      if (audioOnly && ytAudioReady) {
        ytAudioPlayer.loadVideoById({ videoId, startSeconds: startAt });
        ytAudioPlayer.playVideo();
        ytAudioPlayer.setVolume(100);
        mediaState.isPlaying = true;
        playSoundBars();
        const pb = document.getElementById('btn-play-media');
        if (pb) { pb.textContent = '⏸ PAUSA'; pb.classList.add('playing'); }
        const npt = document.getElementById('now-playing-text');
        if (npt) npt.textContent = '🎵 Spelar…';
      } else if (!audioOnly && ytVideoReady) {
        ytVideoPlayer.loadVideoById({ videoId, startSeconds: startAt });
        ytVideoPlayer.playVideo();
        mediaState.isPlaying = true;
      } else {
        setTimeout(attempt, 400); // player inte redo ännu
      }
    } catch (e) {
      console.warn('[YT] autoplay-fel, försöker igen:', e.message);
      setTimeout(attempt, 400);
    }
  }
  attempt();
}

function stopMedia(hideArea = true) {
  try {
    if (ytAudioReady && ytAudioPlayer) ytAudioPlayer.stopVideo();
    if (ytVideoReady && ytVideoPlayer) ytVideoPlayer.stopVideo();
  } catch(e) {}
  mediaState.isPlaying = false;
  pauseSoundBars();
  const pb = document.getElementById('btn-play-media');
  if (pb) { pb.textContent = '▶ SPELA'; pb.classList.remove('playing'); }
  if (hideArea) document.getElementById('media-area').style.display = 'none';
}

function pauseSoundBars() {
  document.querySelectorAll('.sound-bar').forEach(b => b.classList.add('paused'));
}
function playSoundBars() {
  document.querySelectorAll('.sound-bar').forEach(b => b.classList.remove('paused'));
}

document.getElementById('btn-play-media').addEventListener('click', () => {
  const { videoId, startAt, audioOnly, isPlaying } = mediaState;
  if (!videoId) return;
  const pb = document.getElementById('btn-play-media');
  if (isPlaying) {
    try {
      if (audioOnly && ytAudioReady) ytAudioPlayer.pauseVideo();
      else if (!audioOnly && ytVideoReady) ytVideoPlayer.pauseVideo();
    } catch(e) {}
    mediaState.isPlaying = false;
    pauseSoundBars();
    pb.textContent = '▶ SPELA'; pb.classList.remove('playing');
    document.getElementById('now-playing-text').textContent = '⏸ Pausad';
  } else {
    try {
      if (audioOnly && ytAudioReady) {
        ytAudioPlayer.loadVideoById({ videoId, startSeconds: startAt });
        ytAudioPlayer.playVideo();
        ytAudioPlayer.setVolume(100);
      } else if (!audioOnly && ytVideoReady) {
        ytVideoPlayer.loadVideoById({ videoId, startSeconds: startAt });
        ytVideoPlayer.playVideo();
      }
    } catch(e) { console.warn('YT error', e); }
    mediaState.isPlaying = true;
    playSoundBars();
    pb.textContent = '⏸ PAUSA'; pb.classList.add('playing');
    document.getElementById('now-playing-text').textContent = '🎵 Spelar…';
  }
});

function speakRevealCommentary(state) {
  const answers = Object.values(state.answers);
  const connected = Object.values(state.players).filter(p => p.connected);
  const correct = answers.filter(a => a.correct).length;
  const total = connected.length;
  const ans = state.currentQuestion?.answer || '';
  const expl = state.currentQuestion?.explanation || '';
  const funnyOutro = state.currentQuestion?.funnyOutro;

  if (funnyOutro) {
    // AI-generated outro after revealing the answer
    let scoreSummary;
    if (correct === total && total > 0) scoreSummary = 'Alla hade rätt!';
    else if (correct === 0) scoreSummary = 'Ingen hade rätt!';
    else scoreSummary = `${correct} av ${total} hade rätt.`;
    speak(`Rätt svar: ${ans}. ${scoreSummary} ${funnyOutro}`);
  } else {
    const hostPhrases = (state.gameMode === 'music' && window.MusicQuiz) ? MusicQuiz.HOST : HOST;
    let phrase;
    if (correct === total && total > 0) phrase = pick(hostPhrases.allCorrect);
    else if (correct === 0) phrase = pick(hostPhrases.noneCorrect);
    else phrase = pick(hostPhrases.someCorrect);
    speak(`Rätt svar: ${ans}. ${phrase} ${expl}`, 0.86, 1.12);
  }
}
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

// ── Musikquiz-modul initiering ────────────────────
if (window.MusicQuiz) {
  MusicQuiz.init(socket);
}

// ── Lobby ─────────────────────────────────────────
document.getElementById('btn-start').addEventListener('click', () => {
  audio.resume();
  socket.emit('host:start');
});

document.getElementById('btn-test-mode').addEventListener('click', (e) => {
  socket.emit('host:test_mode');
  e.target.disabled = true;
  e.target.textContent = '🤖 Bottar anslutna!';
});

document.getElementById('btn-load-trivia').addEventListener('click', async (e) => {
  const btn = e.target;
  const status = document.getElementById('trivia-status');
  btn.disabled = true;
  btn.textContent = '⏳ Hämtar frågor…';
  status.style.display = 'block';
  status.textContent = '🌐 Ansluter till Open Trivia DB…';

  try {
    const res = await fetch('/api/trivia-questions');
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const { questions, aiUsed, claudeError } = await res.json();

    if (aiUsed) {
      status.textContent = `✅ ${questions.length} triviafrågor laddade med AI-kommentarer!`;
      status.style.color = '#22c55e';
    } else if (claudeError) {
      status.textContent = `⚠️ Frågor laddade (engelska) – Claude-fel: ${claudeError}`;
      status.style.color = '#f59e0b';
    } else {
      status.textContent = `⚠️ Frågor laddade (engelska) – ANTHROPIC_API_KEY saknas i .env`;
      status.style.color = '#f59e0b';
    }
    btn.textContent = `🎲 ${questions.length} frågor laddade!`;

    socket.emit('host:load_trivia', questions);
  } catch (err) {
    status.textContent = `❌ Misslyckades: ${err.message}`;
    btn.disabled = false;
    btn.textContent = '🎲 Ladda triviafrågör (AI)';
  }
});

function updateLobby(players) {
  const connected = Object.values(players).filter(p => p.connected);
  const list = document.getElementById('lobby-players');
  list.innerHTML = '';

  if (connected.length === 0) {
    list.innerHTML = '<p class="waiting-msg">Väntar på spelare… skanna QR-koden!</p>';
  } else {
    connected.forEach(p => {
      const slot = document.createElement('div');
      slot.className = 'player-slot connected';
      slot.innerHTML = `
        <div class="slot-avatar" style="background:${p.color}">${p.emoji || p.name[0]}</div>
        <div class="slot-name" style="color:${p.color}">${p.name}</div>
        <div class="slot-status connected">✓ ${p.isBot ? 'Bot' : 'Ansluten'}</div>
      `;
      list.appendChild(slot);
    });
  }

  document.getElementById('btn-start').disabled = connected.length === 0;
  document.getElementById('player-count').textContent = `${connected.length} spelare anslutna`;
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
      speak('Välkommen, välkommen! Big Boys Music Quiz tjugohundraextrasex – kvällens utan tvekan mest intellektuella nöje. Låt oss börja.', 0.88, 1.1);
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
  } else if (q.type === 'music-freetext') {
    grid.innerHTML = `<p style="color:#a855f7;font-size:1.1rem;font-style:italic;text-align:center;grid-column:1/-1">🎵 Spelare skriver in titel + artist på sin skärm</p>`;
  } else {
    grid.innerHTML = `<p style="color:#a855f7;font-size:1.2rem;font-style:italic;text-align:center;grid-column:1/-1">🎤 Buzz-in fråga – tryck på buzz-knappen!</p>`;
  }

  // Load media
  loadMedia(q.media || null);

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
  speak(`${playerName} har mod nog att buzza in! Imponerande.`, 0.95, 1.2);

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
    const answerText = ans.answer && ans.answer !== q?.answer
      ? `<span style="font-size:0.8em;opacity:0.8"> – "${ans.answer}"</span>`
      : '';
    chip.innerHTML = `${ans.correct ? '✓' : '✗'} <strong>${player.name}</strong>${answerText} ${ans.correct ? `+${ans.points}p` : ''}`;
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
    speak(`Och med det är spelet till ända. Vinnaren – med ${winner.score} välförtjänta poäng – är ingen annan än ${winner.name}. Välförtjänt, och mycket välförtjänt.`, 0.88, 1.1);
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
      setAvatarPosition('center');
    }

    if (phase === 'countdown' && prevPhase === 'lobby') {
      showScreen('countdown');
      audio.stopLobbyMusic();
      setAvatarPosition('center');
      runCountdown(3);
    }

    if (phase === 'question' && questionIndex !== prevIndex) {
      showScreen('question');
      hideBuzz();
      renderQuestion(state);
      const q = state.currentQuestion;
      const isMusic = q?.category?.startsWith('🎵');

      // Show/hide music banner
      const musicBanner = document.getElementById('music-banner');
      if (musicBanner) musicBanner.style.display = isMusic ? 'flex' : 'none';

      if (q?.funnyIntro) {
        // Göm frågetexten tills introt är klart
        const qText = document.getElementById('q-text');
        const qOpts = document.getElementById('q-options');
        qText.style.opacity = '0';
        qOpts.style.opacity = '0';
        setAvatarPosition('center'); // stor figur under intro

        setTimeout(async () => {
          await speak(q.funnyIntro);
          // Visa frågan efter introt
          qText.style.opacity = '1';
          qOpts.style.opacity = '1';
          setAvatarPosition('corner'); // flytta till hörnet
          await speak(q.question);
          socket.emit('host:ready_for_buzz');
        }, 600);
      } else if (isMusic) {
        setAvatarPosition('corner');
        audio.playMusicJingle();
        const introPool = (state.gameMode === 'music' && window.MusicQuiz)
          ? MusicQuiz.HOST.roundIntros
          : HOST.musicIntros;
        const intro = pick(introPool);
        setTimeout(async () => {
          await speak(`${intro} ${q?.question || ''}`, 0.86, 1.15);
          socket.emit('host:ready_for_buzz');
          autoPlayMedia();
        }, 900);
      } else {
        setAvatarPosition('corner');
        const roundAnnounce = questionIndex === 0 ? 'Och så börjar det. Fråga nummer ett.' :
          questionIndex % 5 === 0 ? `En ny runda träder in. Fråga nummer ${questionIndex + 1}.` :
          `${pick(HOST.intros)} Fråga ${questionIndex + 1}.`;
        (async () => {
          await speak(`${roundAnnounce} ${q?.question || ''}`, 0.87);
          socket.emit('host:ready_for_buzz');
        })();
      }
      prevIndex = questionIndex;
    }

    if (phase === 'buzz_open' && !buzzedBy) {
      ensureQuestionVisible(); // visa frågan om intro fortfarande pågår
      hideBuzz();
      if (currentQuestion?.type === 'multiple-choice') {
        audio.playTensionLoop(20);
      }
    }

    if (phase === 'buzz_claimed' && buzzedBy && buzzedBy !== prevBuzzedBy) {
      ensureQuestionVisible();
      const player = players[buzzedBy];
      if (player) showBuzz(player.name, player.color);
    }

    if (phase === 'reveal') {
      hideBuzz();
      stopMedia(true);
      audio.playDrumroll();
      setTimeout(() => {
        renderReveal(state);
        showScreen('reveal');
        setAvatarPosition('center');
        speakRevealCommentary(state);
      }, 900);
    }

    if (phase === 'game_over') {
      setAvatarPosition('center');
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
