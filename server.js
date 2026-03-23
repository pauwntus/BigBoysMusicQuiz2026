require('dotenv').config();
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const QRCode = require('qrcode');
const os = require('os');
const fs = require('fs');
const path = require('path');
const Anthropic = require('@anthropic-ai/sdk');

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: '*' } });

app.use(express.static(path.join(__dirname, 'public')));

// Load default questions (music quiz)
const defaultQuestions = JSON.parse(fs.readFileSync(path.join(__dirname, 'questions.json'), 'utf8'));
// activeQuestions can be swapped to trivia questions during a session
let activeQuestions = defaultQuestions;

// Song database for music quiz mode
const songDatabase = JSON.parse(fs.readFileSync(path.join(__dirname, 'songs.json'), 'utf8'));

// Allowed emoji list (security: only allow from this set)
const ALLOWED_EMOJIS = new Set([
  '🎸','🎤','🥁','🎹','🎺','🎻','🤘','🦄','🔥','👾','🤖','⭐','🦊','🐸','💀','🎭',
  '🎵','🎶','🦁','🐯','🦊','🐺','🦅','🐲','👑','🧠','🎯','🚀','💎','🌟','🍕','🎪',
]);

// Game state
let gameState = {
  phase: 'lobby', // lobby | countdown | question | buzz_open | buzz_claimed | reveal | scoreboard | game_over
  players: {},    // socketId -> { name, score, color, connected, avatar }
  questionIndex: -1,
  currentQuestion: null,
  buzzedBy: null,   // socketId
  answers: {},      // socketId -> { answer, time, correct }
  timer: 0,
  round: 0,
  totalQuestions: activeQuestions.length,
  testMode: false,
  gameMode: 'default', // 'default' | 'trivia' | 'music'
};

// Bot logic
const BOT_CONFIGS = [
  { name: 'R2-Quiz', color: '#3b82f6', emoji: '🤖' },
  { name: 'Musica', color: '#ef4444', emoji: '🎸' },
  { name: 'Quizzo', color: '#22c55e', emoji: '👾' },
];
const BOT_PREFIX = 'bot-';

function addBots() {
  BOT_CONFIGS.forEach(cfg => {
    const id = BOT_PREFIX + cfg.name;
    gameState.players[id] = {
      id,
      name: cfg.name,
      score: 0,
      color: cfg.color,
      emoji: cfg.emoji,
      connected: true,
      isBot: true,
    };
  });
}

function scheduleBotAnswers() {
  if (!gameState.testMode) return;
  const q = activeQuestions[gameState.questionIndex];
  if (!q || q.type !== 'multiple-choice') return;

  const bots = Object.entries(gameState.players).filter(([, p]) => p.isBot && p.connected);
  bots.forEach(([id]) => {
    const delay = 3000 + Math.random() * 12000;
    setTimeout(() => {
      if (gameState.phase !== 'buzz_open') return;
      if (gameState.answers[id]) return;

      // 60% chance correct
      let answer;
      if (Math.random() < 0.6) {
        answer = q.answer;
      } else {
        const wrong = q.options.filter(o => o !== q.answer);
        answer = wrong[Math.floor(Math.random() * wrong.length)];
      }

      const correct = answer === q.answer;
      const points = correct ? (q.points || 2) : 0;
      gameState.answers[id] = { answer, correct, points };
      if (correct) gameState.players[id].score += points;

      const connected = Object.keys(gameState.players).filter(pid => gameState.players[pid].connected);
      if (Object.keys(gameState.answers).length >= connected.length) {
        stopTimer();
        revealAnswer();
      } else {
        broadcast();
      }
    }, delay);
  });
}

function getLocalIP() {
  const interfaces = os.networkInterfaces();
  for (const iface of Object.values(interfaces)) {
    for (const alias of iface) {
      if (alias.family === 'IPv4' && !alias.internal) return alias.address;
    }
  }
  return '127.0.0.1';
}

// Generate QR code as data URL
async function generateQR(url) {
  return QRCode.toDataURL(url, {
    width: 300,
    margin: 2,
    color: { dark: '#000000', light: '#ffffff' },
  });
}

// Broadcast game state to all
function broadcast() {
  io.emit('state', sanitizeState());
}

function sanitizeState() {
  return {
    phase: gameState.phase,
    players: gameState.players,
    questionIndex: gameState.questionIndex,
    currentQuestion: gameState.currentQuestion,
    buzzedBy: gameState.buzzedBy,
    answers: gameState.answers,
    timer: gameState.timer,
    round: gameState.round,
    totalQuestions: gameState.totalQuestions,
    gameMode: gameState.gameMode,
  };
}

function getConnectedPlayerNames() {
  return Object.values(gameState.players)
    .filter(p => p.connected)
    .map(p => p.name);
}

// Countdown timer
let timerInterval = null;
function startTimer(seconds, onTick, onDone) {
  clearInterval(timerInterval);
  gameState.timer = seconds;
  timerInterval = setInterval(() => {
    gameState.timer--;
    if (onTick) onTick(gameState.timer);
    broadcast();
    if (gameState.timer <= 0) {
      clearInterval(timerInterval);
      if (onDone) onDone();
    }
  }, 1000);
}

function stopTimer() {
  clearInterval(timerInterval);
  timerInterval = null;
}

// ---- Socket.io Events ----
io.on('connection', (socket) => {
  console.log(`[+] Connected: ${socket.id}`);

  // Send current state immediately
  socket.emit('state', sanitizeState());

  // Host requests QR code
  socket.on('host:qr', async () => {
    const ip = getLocalIP();
    const url = `http://${ip}:3000/player.html`;
    const qr = await generateQR(url);
    socket.emit('qr', { url, qr });
  });

  // Player joins with a name, color, emoji
  socket.on('player:join', (data) => {
    const name = (data.name || '').trim().replace(/\s+/g, ' ').substring(0, 20);
    if (name.length < 1) return;

    const color = /^#[0-9a-f]{6}$/i.test(data.color) ? data.color : '#f59e0b';
    const emoji = ALLOWED_EMOJIS.has(data.emoji) ? data.emoji : '🎵';

    // Check if name already taken by a connected human player
    const alreadyTaken = Object.values(gameState.players).some(
      p => p.name.toLowerCase() === name.toLowerCase() && p.connected && p.id !== socket.id && !p.isBot
    );
    if (alreadyTaken) {
      socket.emit('join:error', { message: `"${name}" är redan taget!` });
      return;
    }

    // Reassign if reconnecting (same name)
    const existing = Object.entries(gameState.players).find(
      ([, p]) => p.name.toLowerCase() === name.toLowerCase() && !p.isBot
    );
    if (existing) {
      const [oldId] = existing;
      if (oldId !== socket.id) {
        gameState.players[socket.id] = { ...gameState.players[oldId], id: socket.id, connected: true };
        delete gameState.players[oldId];
      } else {
        gameState.players[socket.id].connected = true;
      }
    } else {
      gameState.players[socket.id] = {
        id: socket.id,
        name,
        score: 0,
        color,
        emoji,
        connected: true,
      };
    }

    console.log(`[player] ${name} ${emoji} joined`);
    socket.emit('join:ok', { name, color, emoji });
    broadcast();
  });

  // Host activates test mode (adds 3 bots)
  socket.on('host:test_mode', () => {
    if (gameState.phase !== 'lobby') return;
    gameState.testMode = true;
    addBots();
    broadcast();
  });

  // Host starts game
  socket.on('host:start', () => {
    if (gameState.phase !== 'lobby') return;
    gameState.phase = 'countdown';
    gameState.questionIndex = -1;
    // Reset scores
    Object.values(gameState.players).forEach(p => { p.score = 0; });
    broadcast();
  });

  // Host advances to next question
  socket.on('host:next', () => {
    stopTimer();
    gameState.questionIndex++;
    if (gameState.questionIndex >= activeQuestions.length) {
      gameState.phase = 'game_over';
      broadcast();
      return;
    }

    const q = activeQuestions[gameState.questionIndex];
    gameState.currentQuestion = {
      ...q,
      // Don't send answer to clients initially
      answer: undefined,
      correctAnswer: q.answer,
    };
    gameState.round = Math.floor(gameState.questionIndex / 5) + 1;
    gameState.buzzedBy = null;
    gameState.answers = {};
    gameState.phase = 'question';
    broadcast();
    // Waits for host:ready_for_buzz before opening for answers
  });

  // Host signals that the question intro is done – now open for answers
  socket.on('host:ready_for_buzz', () => {
    if (gameState.phase !== 'question') return;
    const q = activeQuestions[gameState.questionIndex];
    if (!q) return;
    gameState.phase = 'buzz_open';
    broadcast();
    if (q.type === 'multiple-choice') {
      scheduleBotAnswers();
      startTimer(20, null, () => { revealAnswer(); });
    } else if (q.type === 'buzz') {
      startTimer(30, null, () => { revealAnswer(); });
    }
  });

  // Player buzzes in
  socket.on('player:buzz', () => {
    if (gameState.phase !== 'buzz_open') return;
    if (!gameState.players[socket.id]) return;

    gameState.buzzedBy = socket.id;
    gameState.phase = 'buzz_claimed';
    stopTimer();
    broadcast();
  });

  // Player answers (multiple choice)
  socket.on('player:answer', (data) => {
    if (gameState.phase !== 'buzz_open' && gameState.phase !== 'buzz_claimed') return;
    if (!gameState.players[socket.id]) return;
    if (gameState.answers[socket.id]) return; // already answered

    const q = activeQuestions[gameState.questionIndex];
    const correct = data.answer === q.answer;
    const points = correct ? (q.points || 2) : 0;

    gameState.answers[socket.id] = {
      answer: data.answer,
      correct,
      points,
    };

    if (correct) {
      gameState.players[socket.id].score += points;
    }

    // If all connected players answered, reveal
    const connected = Object.keys(gameState.players).filter(id => gameState.players[id].connected);
    const answered = Object.keys(gameState.answers).length;
    if (answered >= connected.length) {
      stopTimer();
      revealAnswer();
    } else {
      broadcast();
    }
  });

  // Host marks buzz answer as correct
  socket.on('host:correct', () => {
    if (!gameState.buzzedBy) return;
    const q = activeQuestions[gameState.questionIndex];
    const points = q.points || 3;
    gameState.players[gameState.buzzedBy].score += points;
    gameState.answers[gameState.buzzedBy] = { correct: true, points };
    revealAnswer();
  });

  // Host marks buzz answer as wrong
  socket.on('host:wrong', () => {
    if (!gameState.buzzedBy) return;
    gameState.answers[gameState.buzzedBy] = { correct: false, points: 0 };
    // Reopen buzz
    gameState.buzzedBy = null;
    gameState.phase = 'buzz_open';
    broadcast();
    startTimer(15, null, revealAnswer);
  });

  // Host reveals answer manually
  socket.on('host:reveal', () => {
    stopTimer();
    revealAnswer();
  });

  // Host loads trivia questions (replaces default questions for this session)
  socket.on('host:load_trivia', (triviaQuestions) => {
    if (!Array.isArray(triviaQuestions) || triviaQuestions.length === 0) return;
    activeQuestions = triviaQuestions;
    gameState.totalQuestions = triviaQuestions.length;
    gameState.gameMode = 'trivia';
    console.log(`[trivia] Laddade ${triviaQuestions.length} triviafrågor`);
    broadcast();
  });

  // Host loads music quiz questions
  socket.on('host:load_music', (musicQuestions) => {
    if (!Array.isArray(musicQuestions) || musicQuestions.length === 0) return;
    activeQuestions = musicQuestions;
    gameState.totalQuestions = musicQuestions.length;
    gameState.gameMode = 'music';
    console.log(`[musik] Laddade ${musicQuestions.length} musikfrågor`);
    broadcast();
  });

  // Host resets to lobby
  socket.on('host:reset', () => {
    stopTimer();
    activeQuestions = defaultQuestions;
    gameState = {
      phase: 'lobby',
      players: {},
      questionIndex: -1,
      currentQuestion: null,
      buzzedBy: null,
      answers: {},
      timer: 0,
      round: 0,
      totalQuestions: activeQuestions.length,
      testMode: false,
      gameMode: 'default',
    };
    broadcast();
  });

  socket.on('disconnect', () => {
    if (gameState.players[socket.id]) {
      gameState.players[socket.id].connected = false;
      console.log(`[-] ${gameState.players[socket.id].name} disconnected`);
      broadcast();
    }
  });
});

function revealAnswer() {
  const q = activeQuestions[gameState.questionIndex];
  if (gameState.currentQuestion) {
    gameState.currentQuestion.answer = q.answer;
    gameState.currentQuestion.explanation = q.explanation || null;
  }
  gameState.phase = 'reveal';
  broadcast();
}

// ── ElevenLabs TTS proxy ─────────────────────────────────────────────────
app.use(express.json());

// ── Trivia Questions (Open Trivia DB + Claude commentary) ─────────────────
function decodeHtmlEntities(str) {
  return str
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#039;/g, "'")
    .replace(/&apos;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&ldquo;/g, '"')
    .replace(/&rdquo;/g, '"')
    .replace(/&lsquo;/g, "'")
    .replace(/&rsquo;/g, "'")
    .replace(/&hellip;/g, '…')
    .replace(/&ndash;/g, '–')
    .replace(/&mdash;/g, '—');
}

function shuffleArray(arr) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

async function fetchTriviaWithCommentary(amount = 10) {
  // 1. Fetch from Open Trivia DB
  const triviaRes = await fetch(`https://opentdb.com/api.php?amount=${amount}&type=multiple`);
  if (!triviaRes.ok) throw new Error(`opentdb svarade ${triviaRes.status}`);
  const triviaData = await triviaRes.json();
  if (triviaData.response_code !== 0 || !triviaData.results?.length) {
    throw new Error('opentdb returnerade inga frågor');
  }

  // 2. Decode raw items (keep original order for Claude mapping)
  const rawItems = triviaData.results.map((item, i) => {
    const question = decodeHtmlEntities(item.question);
    const correct = decodeHtmlEntities(item.correct_answer);
    const allOptions = shuffleArray([
      correct,
      ...item.incorrect_answers.map(decodeHtmlEntities),
    ]);
    return {
      id: 1000 + i,
      difficulty: item.difficulty,
      category: decodeHtmlEntities(item.category),
      question,
      options: allOptions,
      answer: correct,
    };
  });

  // 3. Use Claude to translate + generate commentary in one call (if API key available)
  const anthropicKey = process.env.ANTHROPIC_API_KEY;
  if (anthropicKey && anthropicKey !== 'din_anthropic_nyckel_här') {
    try {
      const client = new Anthropic({ apiKey: anthropicKey });

      const inputJson = JSON.stringify(rawItems.map(q => ({
        question: q.question,
        options: q.options,
        answer: q.answer,
        category: q.category,
      })));

      const msg = await client.messages.create({
        model: 'claude-haiku-4-5',
        max_tokens: 4096,
        messages: [{
          role: 'user',
          content: `Du är en rolig och energisk svensk quizvärd. Du får ${rawItems.length} triviafrågor på engelska.

Ditt uppdrag för varje fråga:
1. "question": Översätt frågan till naturlig svenska
2. "options": Översätt ALLA svarsalternativ till svenska (bevara samma ordning)
3. "answer": Översätt det rätta svaret till svenska (måste matcha exakt ett av "options")
4. "intro": Skriv en rolig, KONTEXTSPECIFIK introduktion PÅ SVENSKA (1-2 meningar) som bygger upp spänning och refererar till frågans ämne. Inte generisk – nämn vad frågan handlar om!
5. "outro": Skriv en rolig KONTEXTSPECIFIK kommentar PÅ SVENSKA (1-2 meningar) om det rätta svaret. Kan vara ett fascinerande faktum, ironi eller humor kopplat till just det svaret.

Frågorna (JSON):
${inputJson}

Svara ENBART med giltig JSON-array utan kodblock eller extra text:
[{"question":"...","options":["...","...","...","..."],"answer":"...","intro":"...","outro":"..."},...]`,
        }],
      });

      let raw = msg.content[0]?.text?.trim() || '[]';
      // Strip markdown code fences if Claude added them
      raw = raw.replace(/^```(?:json)?\s*/i, '').replace(/\s*```\s*$/, '');
      const translated = JSON.parse(raw);

      const formatted = rawItems.map((item, i) => {
        const t = translated[i] || {};
        return {
          id: item.id,
          type: 'multiple-choice',
          category: `🌍 ${item.category}`,
          question: t.question || item.question,
          options: t.options || item.options,
          answer: t.answer || item.answer,
          points: item.difficulty === 'hard' ? 3 : item.difficulty === 'medium' ? 2 : 1,
          explanation: '',
          funnyIntro: t.intro || null,
          funnyOutro: t.outro || null,
        };
      });

      console.log(`[trivia] Claude översatte och kommenterade ${translated.length} frågor`);
      return formatted;
    } catch (e) {
      console.warn('[trivia] Claude-anrop misslyckades:', e.message);
      // Attach error to fallback so client can surface it
      const fallback = rawItems.map(item => ({
        id: item.id,
        type: 'multiple-choice',
        category: `🌍 ${item.category}`,
        question: item.question,
        options: item.options,
        answer: item.answer,
        points: item.difficulty === 'hard' ? 3 : item.difficulty === 'medium' ? 2 : 1,
        explanation: '',
        funnyIntro: null,
        funnyOutro: null,
      }));
      fallback._claudeError = e.message;
      return fallback;
    }
  } else {
    console.log('[trivia] ANTHROPIC_API_KEY ej konfigurerad – returnerar engelska frågor utan kommentarer');
  }

  // Fallback: return untranslated English questions without commentary
  return rawItems.map(item => ({
    id: item.id,
    type: 'multiple-choice',
    category: `🌍 ${item.category}`,
    question: item.question,
    options: item.options,
    answer: item.answer,
    points: item.difficulty === 'hard' ? 3 : item.difficulty === 'medium' ? 2 : 1,
    explanation: '',
    funnyIntro: null,
    funnyOutro: null,
  }));
}

// ── Musikquiz – slumpar låtar från songs.json ─────────────────────────────
const MUSIC_QUESTION_TEMPLATES = [
  '🎵 Lyssna noga – vilken låt spelas?',
  '🎵 Hör du det? Vilken låt är det?',
  '🎵 Kan du identifiera den här låten?',
  '🎵 Lyssna – vilken av dessa spelas?',
];

function buildMusicQuestions(count) {
  const shuffled = shuffleArray(songDatabase);
  const selected = shuffled.slice(0, Math.min(count, shuffled.length));

  return selected.map((song, idx) => {
    // Välj distractors: samma era först, sedan övriga
    const sameEra = songDatabase.filter(s => s.era === song.era && s.id !== song.id);
    const otherEra = songDatabase.filter(s => s.era !== song.era);
    const pool = shuffleArray([...sameEra, ...shuffleArray(otherEra)]);
    const distractors = pool.slice(0, 3);

    const correctLabel = `${song.artist} – ${song.title}`;
    const options = shuffleArray([
      correctLabel,
      ...distractors.map(s => `${s.artist} – ${s.title}`),
    ]);

    return {
      id: idx + 1,
      type: 'multiple-choice',
      category: '🎵 Gissa Låten',
      question: MUSIC_QUESTION_TEMPLATES[idx % MUSIC_QUESTION_TEMPLATES.length],
      options,
      answer: correctLabel,
      points: song.points || 2,
      media: {
        type: 'youtube',
        videoId: song.youtube.videoId,
        startAt: song.youtube.startAt,
        audioOnly: true,
      },
      explanation: `${song.artist} – "${song.title}" (${song.year})`,
    };
  });
}

app.get('/api/music-questions', (req, res) => {
  const count = Math.min(parseInt(req.query.count) || 12, 20);
  const questions = buildMusicQuestions(count);
  res.json({ questions });
});

app.get('/api/trivia-questions', async (req, res) => {
  try {
    const questions = await fetchTriviaWithCommentary(10);
    const aiUsed = questions.some(q => q.funnyIntro);
    const claudeError = questions._claudeError || null;
    res.json({ questions, aiUsed, claudeError });
  } catch (e) {
    console.error('[trivia] Fel:', e.message);
    res.status(500).json({ error: e.message });
  }
});

// ── Konfigurations-status (för felsökning) ────────────────────────────────
app.get('/api/config-status', (req, res) => {
  const anthropicKey = process.env.ANTHROPIC_API_KEY;
  const elevenKey = process.env.ELEVENLABS_API_KEY;
  res.json({
    anthropic: anthropicKey && anthropicKey !== 'din_anthropic_nyckel_här'
      ? `✅ Konfigurerad (${anthropicKey.slice(0, 10)}…)`
      : '❌ Ej konfigurerad (sätt ANTHROPIC_API_KEY i .env)',
    elevenlabs: elevenKey && elevenKey !== 'din_nyckel_här'
      ? `✅ Konfigurerad`
      : '❌ Ej konfigurerad',
  });
});
const ttsCache = new Map(); // text → Buffer

app.post('/api/tts', async (req, res) => {
  const { text } = req.body || {};
  if (!text) return res.status(400).json({ error: 'text saknas' });

  const apiKey = process.env.ELEVENLABS_API_KEY;
  if (!apiKey || apiKey === 'din_nyckel_här') {
    return res.status(503).json({ error: 'ELEVENLABS_API_KEY inte konfigurerad' });
  }

  const cacheKey = text.trim().toLowerCase();
  if (ttsCache.has(cacheKey)) {
    res.set('Content-Type', 'audio/mpeg');
    return res.send(ttsCache.get(cacheKey));
  }

  const voiceId = process.env.ELEVENLABS_VOICE_ID || 'pNInz6obpgDQGcFmaJgB';
  const url = `https://api.elevenlabs.io/v1/text-to-speech/${voiceId}`;

  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'xi-api-key': apiKey,
        'Content-Type': 'application/json',
        'Accept': 'audio/mpeg',
      },
      body: JSON.stringify({
        text,
        model_id: 'eleven_multilingual_v2',
        voice_settings: {
          stability: 0.45,
          similarity_boost: 0.80,
          style: 0.35,
          use_speaker_boost: true,
        },
      }),
    });

    if (!response.ok) {
      const err = await response.text();
      console.error('ElevenLabs fel:', response.status, err);
      return res.status(response.status).json({ error: err });
    }

    const buffer = Buffer.from(await response.arrayBuffer());
    ttsCache.set(cacheKey, buffer);   // cache i minne under körning
    res.set('Content-Type', 'audio/mpeg');
    res.send(buffer);
  } catch (e) {
    console.error('TTS fetch-fel:', e.message);
    res.status(500).json({ error: e.message });
  }
});

// HTTP routes
app.get('/api/qr', async (req, res) => {
  const ip = getLocalIP();
  const url = `http://${ip}:3000/player.html`;
  const qr = await generateQR(url);
  res.json({ url, qr });
});

app.get('/player.html', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'player.html'));
});

app.get('/host.html', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'host.html'));
});

app.get('/', (req, res) => {
  res.redirect('/host.html');
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, '0.0.0.0', () => {
  const ip = getLocalIP();
  console.log(`\n🎵 Big Boys Music Quiz 2026 🎵`);
  console.log(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
  console.log(`Host-skärm:  http://${ip}:${PORT}/host.html`);
  console.log(`Spelare:     http://${ip}:${PORT}/player.html`);
  console.log(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n`);
});
