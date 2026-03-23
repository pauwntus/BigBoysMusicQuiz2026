/**
 * MusicQuiz – modul för musikquiz-läget.
 *
 * Exponerar window.MusicQuiz med:
 *   HOST        – programledarens repliker för musikquiz-läget
 *   init(socket) – kopplar upp knappen i lobbyn och hanterar laddning
 */
const MusicQuiz = (() => {
  // Stephen Fry-stil, musikfokuserad
  const HOST = {
    roundIntros: [
      'Spetsa öronen. Det är musikens stund.',
      'Lyssna noga – svaret bör vara uppenbart. För de musikaliskt bildade, alltså.',
      'Kan du identifiera det här? Det vore förvånansvärt, men låt oss försöka.',
      'Musikhjärnan träder in på scenen. Applåder, tack.',
      'Nästa ton väntar. Hör du det? Bra. Vad är det?',
      'En fråga som separerar de musikaliskt bildade från de övriga.',
      'Lyssna med hela din odelbara uppmärksamhet. Det är allt jag begär.',
      'Känn igen den, om ni törs.',
    ],
    allCorrect: [
      'Alla rätt! Antingen har ni ovanligt goda öron, eller också är mina låtval för uppenbara. Troligen det senare.',
      'Perfekt omgång. Ni sjunger förmodligen med i duschen. Det är inte en kritik.',
      'Fantastiskt. Alla kände igen den. Jag är rörd, på ett sätt jag inte förväntade mig.',
    ],
    noneCorrect: [
      'Ingen rätt. Ingen. Alls. Jag föreslår att vi alla lyssnar mer på musik i allmänhet.',
      'Noll poäng till samtliga. Det är faktiskt ett prestationsrekord, fast i fel riktning.',
      'Häpnadsväckande. Alla fel på en musikfråga. Det kräver en viss talang.',
    ],
    someCorrect: [
      'Delade öron i salen. Som alltid när musiken ställer folk mot väggen.',
      'Hälften kände igen den. Den andra hälften hade sina skäl, förmodar jag.',
      'Blandade resultat. Musiken är inte rättvis – men det är heller inte livet.',
    ],
  };

  function setStatus(text, color) {
    const el = document.getElementById('trivia-status');
    if (!el) return;
    el.style.display = 'block';
    el.textContent = text;
    el.style.color = color || '#a855f7';
  }

  function setModeIndicator(label) {
    const el = document.getElementById('mode-indicator');
    if (!el) return;
    el.textContent = label;
    el.style.display = label ? 'inline-block' : 'none';
  }

  async function showCacheStatus() {
    try {
      const res = await fetch('/api/music-cache-status');
      const { total, cached, hasApiKey } = await res.json();
      if (!hasApiKey) {
        setStatus(
          `🎵 ${cached}/${total} låtar förcachade. Lägg till YOUTUBE_API_KEY i .env för full sökning.`,
          '#f59e0b'
        );
      } else {
        setStatus(`🎵 ${cached}/${total} låtar i cache – ${total - cached} söks vid laddning.`, '#a855f7');
      }
    } catch {}
  }

  function init(socket) {
    const btn = document.getElementById('btn-load-music');
    if (!btn) return;

    // Visa cache-status direkt
    showCacheStatus();

    btn.addEventListener('click', async () => {
      btn.disabled = true;
      btn.textContent = '⏳ Söker låtar…';
      setStatus('🎵 Söker YouTube-IDs och bygger frågor…', '#a855f7');

      try {
        const res = await fetch('/api/music-questions?count=12');
        if (!res.ok) {
          const err = await res.json().catch(() => ({ error: `HTTP ${res.status}` }));
          throw new Error(err.error || `HTTP ${res.status}`);
        }
        const { questions } = await res.json();

        setStatus(`✅ ${questions.length} musikfrågor laddade från ${154} låtar!`, '#22c55e');
        btn.textContent = `🎵 ${questions.length} låtar laddade!`;
        setModeIndicator('🎵 MUSIKQUIZ-LÄGE');

        // Reset trivia-knappen
        const triviaBtn = document.getElementById('btn-load-trivia');
        if (triviaBtn) {
          triviaBtn.disabled = false;
          triviaBtn.textContent = '🎲 Ladda triviafrågör (AI)';
        }

        socket.emit('host:load_music', questions);
      } catch (err) {
        setStatus(`❌ ${err.message}`, '#ef4444');
        btn.disabled = false;
        btn.textContent = '🎵 Musikquiz-läge';
      }
    });

    // Nollställ mode-indikatorn när trivia laddas
    const triviaBtn = document.getElementById('btn-load-trivia');
    if (triviaBtn) {
      triviaBtn.addEventListener('click', () => {
        setModeIndicator('🎲 TRIVIA-LÄGE');
        btn.disabled = false;
        btn.textContent = '🎵 Musikquiz-läge';
      });
    }
  }

  return { HOST, init };
})();
window.MusicQuiz = MusicQuiz;
