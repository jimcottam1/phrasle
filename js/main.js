import { getTodayPhrase } from '../data/phrases.js';
import {
  MAX_WRONG, makeGuess, isLetterInPhrase, buildShareText,
  loadState, saveState, loadStats, saveStats, updateStats,
} from './game.js';

// ---------------------------------------------------------------------------
// Bootstrap
// ---------------------------------------------------------------------------

const phraseObj = getTodayPhrase();
const { phrase, category } = phraseObj;

document.getElementById('hint-category').textContent = category;
document.getElementById('hint-date').textContent =
  new Date().toLocaleDateString('en-IE', { weekday: 'long', day: 'numeric', month: 'long' });

let state = {
  guessedLetters: new Set(),
  wrongCount: 0,
  won: false,
  gameOver: false,
};

let shareText = '';

// ---------------------------------------------------------------------------
// Restore saved state
// ---------------------------------------------------------------------------

const saved = loadState();
if (saved?.phrase === phrase) {
  state     = saved;
  shareText = saved.shareText ?? '';
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

  phrase.split(' ').forEach((word) => {
    const wordEl = document.createElement('div');
    wordEl.className = 'phrase-word';

    [...word].forEach((char) => {
      const tile = document.createElement('div');
      const isRevealed = state.guessedLetters.has(char.toUpperCase()) || state.gameOver;
      tile.className = 'phrase-tile' + (isRevealed ? ' phrase-tile--revealed' : '');
      tile.textContent = isRevealed ? char : '';
      tile.setAttribute('data-letter', char);
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

const KEYBOARD_ROWS = ['QWERTYUIOP', 'ASDFGHJKL', 'ZXCVBNM'];

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
  document.querySelectorAll(`.phrase-tile[data-letter="${letter}"]`).forEach((tile) => {
    tile.textContent = letter;
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
  // Reveal all tiles on loss
  if (!state.won) {
    document.querySelectorAll('.phrase-tile').forEach((tile) => {
      tile.textContent = tile.getAttribute('data-letter');
      tile.classList.add('phrase-tile--revealed', 'phrase-tile--loss');
    });
  }

  const today = new Date().toLocaleDateString('en-IE', { day: 'numeric', month: 'short' });
  shareText = buildShareText(phraseObj, state.wrongCount, state.won, today);

  const stats = updateStats(loadStats(), state.won, state.wrongCount);
  saveStats(stats);
  persist();

  setTimeout(() => {
    showEndPanel();
    document.getElementById('end-panel').hidden = false;
  }, state.won ? 500 : 800);
}

function showEndPanel() {
  document.getElementById('end-title').textContent = state.won
    ? `🎉 Well done! ${state.wrongCount} wrong guess${state.wrongCount !== 1 ? 'es' : ''}`
    : `😞 Game over!`;
  document.getElementById('end-sub').innerHTML = state.won
    ? `The phrase was <strong>${phrase}</strong>`
    : `The phrase was <strong>${phrase}</strong>`;
}

// ---------------------------------------------------------------------------
// Share
// ---------------------------------------------------------------------------

document.getElementById('btn-share').addEventListener('click', () => {
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

['modal-how', 'modal-stats'].forEach((id) => {
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
  saveState(state, { phrase, shareText });
}
