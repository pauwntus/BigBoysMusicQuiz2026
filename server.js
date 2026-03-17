const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const QRCode = require('qrcode');
const os = require('os');
const fs = require('fs');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: '*' } });

app.use(express.static(path.join(__dirname, 'public')));

// Load questions
const questions = JSON.parse(fs.readFileSync(path.join(__dirname, 'questions.json'), 'utf8'));

// Player name colors
const PLAYER_COLORS = {
  Johan: '#3b82f6',
  Langos: '#ef4444',
  Andy: '#22c55e',
  Pontus: '#a855f7',
};

const AVAILABLE_NAMES = ['Johan', 'Langos', 'Andy', 'Pontus'];

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
  totalQuestions: questions.length,
};

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

  // Player joins with a name
  socket.on('player:join', (data) => {
    const name = data.name;
    if (!AVAILABLE_NAMES.includes(name)) return;

    // Check if name already taken by a connected player
    const alreadyTaken = Object.values(gameState.players).some(
      p => p.name === name && p.connected && p.id !== socket.id
    );
    if (alreadyTaken) {
      socket.emit('join:error', { message: `${name} är redan ansluten!` });
      return;
    }

    // Reassign if reconnecting
    const existing = Object.entries(gameState.players).find(([, p]) => p.name === name);
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
        color: PLAYER_COLORS[name] || '#ffffff',
        connected: true,
      };
    }

    console.log(`[player] ${name} joined`);
    socket.emit('join:ok', { name, color: PLAYER_COLORS[name] });
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
    if (gameState.questionIndex >= questions.length) {
      gameState.phase = 'game_over';
      broadcast();
      return;
    }

    const q = questions[gameState.questionIndex];
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

    // After displaying question for a few seconds, open for answers
    if (q.type === 'multiple-choice') {
      setTimeout(() => {
        gameState.phase = 'buzz_open';
        broadcast();
        startTimer(20, null, () => {
          // Time's up - auto reveal
          revealAnswer();
        });
      }, 4000);
    } else if (q.type === 'buzz') {
      setTimeout(() => {
        gameState.phase = 'buzz_open';
        broadcast();
        startTimer(30, null, () => {
          revealAnswer();
        });
      }, 4000);
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

    const q = questions[gameState.questionIndex];
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
    const q = questions[gameState.questionIndex];
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

  // Host resets to lobby
  socket.on('host:reset', () => {
    stopTimer();
    gameState = {
      phase: 'lobby',
      players: {},
      questionIndex: -1,
      currentQuestion: null,
      buzzedBy: null,
      answers: {},
      timer: 0,
      round: 0,
      totalQuestions: questions.length,
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
  const q = questions[gameState.questionIndex];
  if (gameState.currentQuestion) {
    gameState.currentQuestion.answer = q.answer;
    gameState.currentQuestion.explanation = q.explanation || null;
  }
  gameState.phase = 'reveal';
  broadcast();
}

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
