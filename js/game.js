export const MAX_WRONG = 6;

/** Set of unique A-Z letters that appear in the phrase. */
export function getLetterSet(phrase) {
  return new Set([...phrase.toUpperCase()].filter(c => c >= 'A' && c <= 'Z'));
}

/** True if the letter (case-insensitive) appears in the phrase. */
export function isLetterInPhrase(letter, phrase) {
  return phrase.toUpperCase().includes(letter.toUpperCase());
}

/** True when every required letter has been guessed. */
export function isWin(guessedLetters, phrase) {
  return [...getLetterSet(phrase)].every(l => guessedLetters.has(l));
}

/**
 * Apply a guess to the current state.
 * Returns a new state object (does not mutate).
 */
export function makeGuess(letter, state, phrase) {
  const l = letter.toUpperCase();
  if (state.guessedLetters.has(l) || state.gameOver) return state;

  const guessedLetters = new Set(state.guessedLetters);
  guessedLetters.add(l);

  const inPhrase  = isLetterInPhrase(l, phrase);
  const wrongCount = inPhrase ? state.wrongCount : state.wrongCount + 1;
  const won       = isWin(guessedLetters, phrase);
  const gameOver  = won || wrongCount >= MAX_WRONG;

  return { guessedLetters, wrongCount, won, gameOver };
}

// ---------------------------------------------------------------------------
// Share text
// ---------------------------------------------------------------------------

export function buildShareText(phraseObj, wrongCount, won, dateStr) {
  const pattern = phraseObj.phrase.split(' ').map(w => '□'.repeat(w.length)).join('  ');
  const result  = won ? `✅ Solved — ${wrongCount} wrong guess${wrongCount !== 1 ? 'es' : ''}` : `❌ Too many wrong guesses`;
  return `Phrasle ${dateStr} — ${phraseObj.category}\n${pattern}\n${result}\nPlay today's Phrasle! https://jimcottam1.github.io/phrasle/`;
}

// ---------------------------------------------------------------------------
// localStorage persistence
// ---------------------------------------------------------------------------

const STATE_KEY = 'phrasle_state';
const STATS_KEY = 'phrasle_stats';

function todayKey() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function serializeState(state) {
  return { ...state, guessedLetters: [...state.guessedLetters] };
}

function deserializeState(raw) {
  return { ...raw, guessedLetters: new Set(raw.guessedLetters ?? []) };
}

export function loadState() {
  try {
    const raw = localStorage.getItem(STATE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (parsed.date !== todayKey()) return null;
    return deserializeState(parsed);
  } catch {
    return null;
  }
}

export function saveState(state, extra = {}) {
  try {
    localStorage.setItem(STATE_KEY, JSON.stringify({
      ...serializeState(state),
      ...extra,
      date: todayKey(),
    }));
  } catch { /* ignore */ }
}

export function loadStats() {
  try {
    return JSON.parse(localStorage.getItem(STATS_KEY) ?? 'null') ?? defaultStats();
  } catch {
    return defaultStats();
  }
}

function defaultStats() {
  return { played: 0, won: 0, streak: 0, maxStreak: 0, totalWrong: 0 };
}

export function saveStats(stats) {
  try {
    localStorage.setItem(STATS_KEY, JSON.stringify(stats));
  } catch { /* ignore */ }
}

export function updateStats(stats, won, wrongCount) {
  const next = { ...stats };
  next.played++;
  if (won) {
    next.won++;
    next.streak++;
    next.maxStreak = Math.max(next.maxStreak, next.streak);
    next.totalWrong += wrongCount;
  } else {
    next.streak = 0;
  }
  return next;
}
