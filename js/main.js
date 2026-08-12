import { getTodayPhrase, getPhraseRequestCount } from '../data/phrases.js';
import {
  MAX_WRONG, makeGuess, isLetterInPhrase, getLetterSet, buildShareText, formatDuration, todayKey,
  loadState, saveState, loadStats, saveStats, updateStats,
  getPlayerId, getPlayerName, setPlayerName, getLeaderboardOptIn, setLeaderboardOptIn,
} from './game.js';
import {
  buildSubmitScorePayload, buildLeaderboardPath, renderLeaderboardRows, resolveDisplayName,
  buildWeeklyLeaderboardPath, renderWeeklyLeaderboardRows, escapeHtml,
} from './leaderboard.js';

// ---------------------------------------------------------------------------
// Supabase
// ---------------------------------------------------------------------------

const SUPABASE_URL = 'https://wvgbriuccwftcddfyhxq.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Ind2Z2JyaXVjY3dmdGNkZGZ5aHhxIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTU5Nzk1OTksImV4cCI6MjA3MTU1NTU5OX0.zgeh3FRGoleSLdeeG7uV8mTC5TM-END0XX2XFNyJRPY';

async function supabaseFetch(path, options = {}) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    ...options,
    headers: {
      apikey: SUPABASE_ANON_KEY,
      Authorization: `Bearer ${SUPABASE_ANON_KEY}`,
      'Content-Type': 'application/json',
      ...options.headers,
    },
  });
  if (!res.ok) throw new Error(`Supabase request failed: ${res.status}`);
  const text = await res.text();
  return text ? JSON.parse(text) : null;
}

// Writes go through the submit-score Edge Function, not direct REST inserts —
// it runs a profanity filter on the name and validates the score bounds
// server-side (using the service-role key), since the anon key alone can no
// longer write to users/scores (see supabase/lockdown_writes.sql).
async function submitScore(name, wrongCount, elapsedMs) {
  const playerId = getPlayerId();
  const sessionPlausible = isSessionPlausible(elapsedMs);
  const res = await fetch(`${SUPABASE_URL}/functions/v1/submit-score`, {
    method: 'POST',
    headers: {
      apikey: SUPABASE_ANON_KEY,
      Authorization: `Bearer ${SUPABASE_ANON_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(buildSubmitScorePayload(playerId, name, wrongCount, elapsedMs, sessionPlausible)),
  });

  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = new Error(data.error ?? 'submit_failed');
    err.code = data.error;
    throw err;
  }
  return data;
}

// Every player who posted a score today, not just the top 10 — this is a
// small family/friends leaderboard, so "everyone" is never a huge list.
async function fetchLeaderboard(date) {
  return supabaseFetch(buildLeaderboardPath(date, 1000));
}

// Same reasoning as fetchLeaderboard above — show every player who posted
// a score that week, not just the top 10.
async function fetchWeeklyLeaderboard(weeksAgo) {
  return supabaseFetch(buildWeeklyLeaderboardPath(weeksAgo, 1000));
}

// ---------------------------------------------------------------------------
// Bootstrap
// ---------------------------------------------------------------------------

const phraseObj = getTodayPhrase();
const { phrase, category, tier } = phraseObj;

const phraseRequestBaseline = getPhraseRequestCount();

// Deliberately generous lower bound so a genuinely fast/lucky player is
// never affected by this.
const MIN_SOLVE_MS_PER_LETTER = 250;

function isSessionPlausible(elapsedMs) {
  if (getPhraseRequestCount() > phraseRequestBaseline) return false;
  if (!state.won) return true;
  return elapsedMs >= getLetterSet(phrase).size * MIN_SOLVE_MS_PER_LETTER;
}

document.getElementById('hint-category').textContent = category;
const diffEl = document.getElementById('hint-difficulty');
diffEl.textContent = tier;
diffEl.className = `hint-difficulty hint-difficulty--${tier.toLowerCase()}`;
document.getElementById('hint-date').textContent =
  new Date().toLocaleDateString('en-IE', { weekday: 'long', day: 'numeric', month: 'long' });

let state = {
  guessedLetters: new Set(),
  wrongCount: 0,
  won: false,
  gameOver: false,
  elapsedMs: 0,
  activeSince: Date.now(),
};

let shareText = '';
let timerIntervalId = null;

// Tile -> true letter, kept in memory rather than as a DOM attribute so an
// unrevealed tile doesn't expose the answer to anyone reading the page
// (view-source, devtools, a userscript) before it's actually been guessed.
let tileLetters = new Map();

const KEYBOARD_ROWS = ['QWERTYUIOP', 'ASDFGHJKL', 'ZXCVBNM'];

// ---------------------------------------------------------------------------
// Restore saved state
// ---------------------------------------------------------------------------

const saved = loadState();
if (saved?.phrase === phrase) {
  // Older saves (from before the timer existed) won't have elapsedMs.
  state     = { elapsedMs: 0, activeSince: null, ...saved };
  shareText = saved.shareText ?? '';
  if (!state.gameOver) state.activeSince = Date.now();
  renderAll();
  if (state.gameOver) {
    document.getElementById('end-panel').hidden = false;
    showEndPanel();
    setTimeout(() => showToast('Already played today — come back tomorrow! 🎯', 4000), 800);
  }
} else {
  renderAll();
  if (!localStorage.getItem('phrasle_stats')) {
    openModal('modal-how');
  }
}

updateTimerDisplay();
if (!state.gameOver) startTimerTicking();

// ---------------------------------------------------------------------------
// Render
// ---------------------------------------------------------------------------

function renderAll() {
  renderPhrase();
  renderLives();
  renderKeyboard();
}

function renderPhrase() {
  const container = document.getElementById('phrase-display');
  container.innerHTML = '';
  tileLetters = new Map();

  phrase.split(' ').forEach((word) => {
    const wordEl = document.createElement('div');
    wordEl.className = 'phrase-word';

    [...word].forEach((char) => {
      const tile = document.createElement('div');
      const isRevealed = state.guessedLetters.has(char.toUpperCase()) || state.gameOver;
      tile.className = 'phrase-tile' + (isRevealed ? ' phrase-tile--revealed' : '');
      tile.textContent = isRevealed ? char : '';
      if (isRevealed) tile.setAttribute('data-letter', char);
      tileLetters.set(tile, char);
      wordEl.appendChild(tile);
    });

    container.appendChild(wordEl);
  });
}

function renderLives() {
  const row = document.getElementById('lives-row');
  row.innerHTML = '';
  for (let i = 0; i < MAX_WRONG; i++) {
    const pip = document.createElement('span');
    pip.className = 'life-pip' + (i < state.wrongCount ? ' life-pip--lost' : '');
    row.appendChild(pip);
  }
}

function renderKeyboard() {
  const container = document.getElementById('keyboard');
  container.innerHTML = '';

  KEYBOARD_ROWS.forEach((row) => {
    const rowEl = document.createElement('div');
    rowEl.className = 'key-row';

    [...row].forEach((letter) => {
      const key = document.createElement('button');
      key.className = 'key';
      key.textContent = letter;
      key.setAttribute('data-letter', letter);
      key.setAttribute('aria-label', `Guess letter ${letter}`);

      if (state.guessedLetters.has(letter)) {
        key.classList.add(isLetterInPhrase(letter, phrase) ? 'key--correct' : 'key--wrong');
        key.disabled = true;
      }
      if (state.gameOver) key.disabled = true;

      key.addEventListener('click', () => handleGuess(letter));
      rowEl.appendChild(key);
    });

    container.appendChild(rowEl);
  });
}

// ---------------------------------------------------------------------------
// Timer — pauses while the tab is hidden so elapsed time reflects time
// actually spent looking at the game, not wall-clock time.
// ---------------------------------------------------------------------------

function syncElapsed() {
  if (state.activeSince != null) {
    const now = Date.now();
    state.elapsedMs += now - state.activeSince;
    state.activeSince = now;
  }
}

function pauseTimer() {
  syncElapsed();
  state.activeSince = null;
}

function currentElapsedMs() {
  return state.elapsedMs + (state.activeSince != null ? Date.now() - state.activeSince : 0);
}

function updateTimerDisplay() {
  document.getElementById('hint-timer').textContent = formatDuration(currentElapsedMs());
}

function startTimerTicking() {
  if (timerIntervalId != null) return;
  timerIntervalId = setInterval(updateTimerDisplay, 250);
}

function stopTimerTicking() {
  if (timerIntervalId == null) return;
  clearInterval(timerIntervalId);
  timerIntervalId = null;
}

document.addEventListener('visibilitychange', () => {
  if (state.gameOver) return;
  if (document.hidden) {
    pauseTimer();
  } else {
    state.activeSince = Date.now();
    updateTimerDisplay();
  }
});

// ---------------------------------------------------------------------------
// Guess handling
// ---------------------------------------------------------------------------

document.addEventListener('keydown', (e) => {
  if (state.gameOver) return;
  if (document.getElementById('modal-how').hidden === false) return;
  if (document.getElementById('modal-stats').hidden === false) return;
  const letter = e.key.toUpperCase();
  if (letter.length === 1 && letter >= 'A' && letter <= 'Z') {
    handleGuess(letter);
  }
});

function handleGuess(letter) {
  if (state.gameOver || state.guessedLetters.has(letter)) return;

  state = makeGuess(letter, state, phrase);

  // Animate newly revealed tiles
  if (isLetterInPhrase(letter, phrase)) {
    revealTiles(letter);
  } else {
    flashKey(letter, 'key--wrong');
  }

  renderLives();
  updateKeyState(letter);

  if (state.gameOver) {
    endGame();
  } else {
    persist();
  }
}

function revealTiles(letter) {
  tileLetters.forEach((char, tile) => {
    if (char.toUpperCase() !== letter) return;
    tile.textContent = letter;
    tile.setAttribute('data-letter', char);
    tile.classList.add('phrase-tile--pop');
    setTimeout(() => {
      tile.classList.add('phrase-tile--revealed');
      tile.classList.remove('phrase-tile--pop');
    }, 50);
  });
}

function flashKey(letter, cls) {
  const key = document.querySelector(`.key[data-letter="${letter}"]`);
  if (!key) return;
  key.classList.add('key--shake');
  setTimeout(() => key.classList.remove('key--shake'), 400);
}

function updateKeyState(letter) {
  const key = document.querySelector(`.key[data-letter="${letter}"]`);
  if (!key) return;
  key.classList.add(isLetterInPhrase(letter, phrase) ? 'key--correct' : 'key--wrong');
  key.disabled = true;
}

// ---------------------------------------------------------------------------
// End game
// ---------------------------------------------------------------------------

function endGame() {
  pauseTimer();
  stopTimerTicking();
  updateTimerDisplay();

  // Reveal all tiles on loss
  if (!state.won) {
    tileLetters.forEach((char, tile) => {
      tile.textContent = char;
      tile.setAttribute('data-letter', char);
      tile.classList.add('phrase-tile--revealed', 'phrase-tile--loss');
    });
  }

  const today = new Date().toLocaleDateString('en-IE', { day: 'numeric', month: 'short' });
  shareText = buildShareText(phraseObj, state.wrongCount, state.won, today, state.elapsedMs);

  const stats = updateStats(loadStats(), state.won, state.wrongCount);
  saveStats(stats);
  persist();

  setTimeout(() => {
    showEndPanel();
    document.getElementById('end-panel').hidden = false;
    promptLeaderboard();
  }, state.won ? 500 : 800);
}

function promptLeaderboard() {
  const optIn = getLeaderboardOptIn();
  if (optIn === true) {
    submitScore(getPlayerName(), state.wrongCount, state.elapsedMs).catch((err) => {
      // A name that passed before can only fail now if the filter list
      // changed — bounce back to the opt-in modal so they can fix it,
      // instead of silently failing every day going forward.
      if (err.code === 'profane_name') {
        document.getElementById('optin-name').value = getPlayerName();
        openModal('modal-optin');
      }
    });
  } else if (optIn === null) {
    document.getElementById('optin-name').value = getPlayerName();
    openModal('modal-optin');
  }
}

function showEndPanel() {
  document.getElementById('end-title').textContent = state.won
    ? `🎉 Well done! ${state.wrongCount} wrong guess${state.wrongCount !== 1 ? 'es' : ''}`
    : `😞 Game over!`;
  document.getElementById('end-sub').innerHTML =
    `The phrase was <strong>${phrase}</strong> · ⏱️ ${formatDuration(state.elapsedMs)}`;
}

// ---------------------------------------------------------------------------
// Share
// ---------------------------------------------------------------------------

// Desktop browsers' native share sheet (Windows/macOS) is sparse — no
// WhatsApp/Twitter/etc, just "Nearby Share" or Mail — so it's worse than
// copying to clipboard. Only use navigator.share on actual mobile devices,
// where the share sheet is full of real targets.
const isMobile = navigator.userAgentData?.mobile ?? /Mobi|Android|iPhone|iPad/i.test(navigator.userAgent);

document.getElementById('btn-share').addEventListener('click', async () => {
  if (navigator.share && isMobile) {
    try {
      await navigator.share({ text: shareText });
    } catch (err) {
      if (err.name !== 'AbortError') showToast(shareText);
    }
    return;
  }

  if (navigator.clipboard) {
    navigator.clipboard.writeText(shareText)
      .then(() => showToast('Copied to clipboard!'))
      .catch(() => showToast(shareText));
  } else {
    showToast(shareText);
  }
});

document.getElementById('btn-stats-end').addEventListener('click', openStats);

// ---------------------------------------------------------------------------
// Modals
// ---------------------------------------------------------------------------

function openModal(id)  { document.getElementById(id).hidden = false; }
function closeModal(id) { document.getElementById(id).hidden = true; }

document.getElementById('btn-how').addEventListener('click',    () => openModal('modal-how'));
document.getElementById('close-how').addEventListener('click',  () => closeModal('modal-how'));
document.getElementById('btn-got-it').addEventListener('click', () => closeModal('modal-how'));
document.getElementById('btn-stats').addEventListener('click', openStats);
document.getElementById('close-stats').addEventListener('click', () => closeModal('modal-stats'));

['modal-how', 'modal-stats', 'modal-optin', 'modal-leaderboard', 'modal-weekly'].forEach((id) => {
  document.getElementById(id).addEventListener('click', (e) => {
    if (e.target.id === id) closeModal(id);
  });
});

function openStats() {
  const s = loadStats();
  const pct = s.played > 0 ? Math.round((s.won / s.played) * 100) : 0;
  const avg = s.won > 0 ? (s.totalWrong / s.won).toFixed(1) : '—';
  document.getElementById('stats-content').innerHTML = `
    <div class="stats-grid">
      <div class="stat"><div class="stat-num">${s.played}</div><div class="stat-lbl">Played</div></div>
      <div class="stat"><div class="stat-num">${pct}%</div><div class="stat-lbl">Win %</div></div>
      <div class="stat"><div class="stat-num">${s.streak}</div><div class="stat-lbl">Streak</div></div>
      <div class="stat"><div class="stat-num">${s.maxStreak}</div><div class="stat-lbl">Best</div></div>
    </div>
    <div class="stat-avg">Avg wrong guesses on wins: <strong>${avg}</strong></div>
  `;
  openModal('modal-stats');
}

// ---------------------------------------------------------------------------
// Leaderboard opt-in
// ---------------------------------------------------------------------------

document.getElementById('close-optin').addEventListener('click', () => closeModal('modal-optin'));

document.getElementById('btn-optin-yes').addEventListener('click', async () => {
  const name = resolveDisplayName(document.getElementById('optin-name').value);

  // Only today's finished game has a meaningful score to post — if the
  // player opts in before playing (or mid-game), the next endGame() call
  // will submit for them instead, so there's nothing to validate yet.
  if (state.gameOver) {
    try {
      await submitScore(name, state.wrongCount, state.elapsedMs);
    } catch (err) {
      showToast(err.code === 'profane_name'
        ? "That name isn't allowed — please pick another one"
        : "Couldn't reach the leaderboard — try again later");
      return;
    }
  }

  setPlayerName(name);
  setLeaderboardOptIn(true);
  closeModal('modal-optin');
});

document.getElementById('btn-optin-no').addEventListener('click', () => {
  setLeaderboardOptIn(false);
  closeModal('modal-optin');
});

// ---------------------------------------------------------------------------
// Leaderboard
// ---------------------------------------------------------------------------

document.getElementById('btn-leaderboard').addEventListener('click', openLeaderboard);
document.getElementById('btn-leaderboard-end').addEventListener('click', openLeaderboard);
document.getElementById('close-leaderboard').addEventListener('click', () => closeModal('modal-leaderboard'));

document.getElementById('btn-leaderboard-optout').addEventListener('click', () => {
  setLeaderboardOptIn(false);
  closeModal('modal-leaderboard');
  showToast("You're off the leaderboard — past scores stay, nothing new gets posted");
});

document.getElementById('btn-leaderboard-optin').addEventListener('click', () => {
  closeModal('modal-leaderboard');
  document.getElementById('optin-name').value = getPlayerName();
  openModal('modal-optin');
});

async function openLeaderboard() {
  openModal('modal-leaderboard');
  const optedIn = getLeaderboardOptIn() === true;
  document.getElementById('btn-leaderboard-optout').hidden = !optedIn;
  document.getElementById('btn-leaderboard-optin').hidden = optedIn;

  const content = document.getElementById('leaderboard-content');
  content.innerHTML = '<div class="leaderboard-empty">Loading…</div>';

  let rows;
  try {
    rows = await fetchLeaderboard(todayKey());
  } catch {
    content.innerHTML = '<div class="leaderboard-empty">Couldn\'t load the leaderboard right now.</div>';
    return;
  }

  if (!rows || rows.length === 0) {
    content.innerHTML = '<div class="leaderboard-empty">No scores yet today — be the first!</div>';
    return;
  }

  content.innerHTML = renderLeaderboardRows(rows);
}

// ---------------------------------------------------------------------------
// Weekly leaderboard — weeks_ago=1 is the most recently completed Mon-Sun
// week (final, locked, shown as a banner); weeks_ago=0 is the current
// in-progress week (live, changes as more scores come in, until it becomes
// next week's "weeks_ago=1").
// ---------------------------------------------------------------------------

document.getElementById('btn-open-weekly').addEventListener('click', () => {
  closeModal('modal-leaderboard');
  openWeekly();
});
document.getElementById('close-weekly').addEventListener('click', () => closeModal('modal-weekly'));

// A single lucky game shouldn't beat someone who played all week — the
// prize only goes to whoever ranks best among players with enough games
// to make the average mean something.
const MIN_GAMES_FOR_PRIZE = 5;

async function openWeekly() {
  openModal('modal-weekly');

  const banner = document.getElementById('weekly-winner-banner');
  const content = document.getElementById('weekly-content');
  banner.textContent = 'Loading…';
  content.innerHTML = '<div class="leaderboard-empty">Loading…</div>';

  let lastWeekRows, thisWeekRows;
  try {
    [lastWeekRows, thisWeekRows] = await Promise.all([
      fetchWeeklyLeaderboard(1),
      fetchWeeklyLeaderboard(0),
    ]);
  } catch {
    banner.textContent = '';
    content.innerHTML = '<div class="leaderboard-empty">Couldn\'t load the weekly leaderboard right now.</div>';
    return;
  }

  const winner = lastWeekRows?.find((row) => row.games_played >= MIN_GAMES_FOR_PRIZE);
  banner.classList.toggle('weekly-winner-banner--winner', !!winner);
  if (winner) {
    banner.innerHTML = `<span class="weekly-winner-trophy">🏆</span> Last week's winner: <strong>${escapeHtml(winner.name ?? 'Anonymous')}</strong>` +
      ` — ${Number(winner.avg_wrong).toFixed(1)} avg wrong, ${formatDuration(winner.avg_elapsed_ms)} avg`;
  } else if (lastWeekRows && lastWeekRows.length > 0) {
    banner.textContent = `No one played ${MIN_GAMES_FOR_PRIZE}+ games last week, so no prize was awarded.`;
  } else {
    banner.textContent = 'No games recorded last week.';
  }

  if (!thisWeekRows || thisWeekRows.length === 0) {
    content.innerHTML = '<div class="leaderboard-empty">No scores yet this week — be the first!</div>';
    return;
  }

  content.innerHTML = renderWeeklyLeaderboardRows(thisWeekRows);
}

// ---------------------------------------------------------------------------
// Toast
// ---------------------------------------------------------------------------

function showToast(message, duration = 2500) {
  const toast = document.getElementById('toast');
  toast.textContent = message;
  toast.classList.add('toast--visible');
  setTimeout(() => toast.classList.remove('toast--visible'), duration);
}

// ---------------------------------------------------------------------------
// Persist
// ---------------------------------------------------------------------------

function persist() {
  syncElapsed();
  saveState(state, { phrase, shareText });
}
