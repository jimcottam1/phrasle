import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  MAX_WRONG, getLetterSet, isLetterInPhrase, isWin, makeGuess,
  buildShareText, formatDuration, loadState, saveState, loadStats, saveStats, updateStats,
  todayKey, getPlayerId, getPlayerName, setPlayerName, getLeaderboardOptIn, setLeaderboardOptIn,
} from '../js/game.js';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const PHRASE = 'BITE THE BULLET';

// ---------------------------------------------------------------------------
// getLetterSet
// ---------------------------------------------------------------------------

describe('getLetterSet', () => {
  it('returns a Set of unique uppercase letters', () => {
    const s = getLetterSet('HELLO');
    expect(s).toEqual(new Set(['H', 'E', 'L', 'O']));
  });

  it('ignores spaces', () => {
    const s = getLetterSet('HIT ME');
    expect(s.has(' ')).toBe(false);
  });

  it('is case-insensitive', () => {
    expect(getLetterSet('hello')).toEqual(getLetterSet('HELLO'));
  });

  it('handles phrases with repeated letters', () => {
    const s = getLetterSet(PHRASE); // B I T E H U L
    expect(s.has('B')).toBe(true);
    expect(s.has('T')).toBe(true);
    expect(s.size).toBe(7); // B,I,T,E,H,U,L
  });
});

// ---------------------------------------------------------------------------
// isLetterInPhrase
// ---------------------------------------------------------------------------

describe('isLetterInPhrase', () => {
  it('returns true for a letter in the phrase', () => {
    expect(isLetterInPhrase('B', PHRASE)).toBe(true);
  });

  it('returns false for a letter not in the phrase', () => {
    expect(isLetterInPhrase('Z', PHRASE)).toBe(false);
  });

  it('is case-insensitive', () => {
    expect(isLetterInPhrase('b', PHRASE)).toBe(true);
  });

  it('ignores spaces (space is not a valid guess)', () => {
    expect(isLetterInPhrase('A', 'BITE THE BULLET')).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// isWin
// ---------------------------------------------------------------------------

describe('isWin', () => {
  it('returns false when no letters guessed', () => {
    expect(isWin(new Set(), PHRASE)).toBe(false);
  });

  it('returns true when all unique letters are guessed', () => {
    const all = getLetterSet(PHRASE); // B,I,T,E,H,U,L
    expect(isWin(all, PHRASE)).toBe(true);
  });

  it('returns false when one letter is missing', () => {
    const almost = new Set(['B', 'I', 'T', 'E', 'H', 'U']); // missing L
    expect(isWin(almost, PHRASE)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// makeGuess
// ---------------------------------------------------------------------------

describe('makeGuess', () => {
  const base = { guessedLetters: new Set(), wrongCount: 0, won: false, gameOver: false };

  it('adds the letter to guessedLetters', () => {
    const next = makeGuess('B', base, PHRASE);
    expect(next.guessedLetters.has('B')).toBe(true);
  });

  it('does not increment wrongCount for a correct letter', () => {
    const next = makeGuess('B', base, PHRASE);
    expect(next.wrongCount).toBe(0);
  });

  it('increments wrongCount for a wrong letter', () => {
    const next = makeGuess('Z', base, PHRASE);
    expect(next.wrongCount).toBe(1);
  });

  it('does not mutate the original state', () => {
    makeGuess('Z', base, PHRASE);
    expect(base.wrongCount).toBe(0);
    expect(base.guessedLetters.size).toBe(0);
  });

  it('ignores a letter that was already guessed', () => {
    const withB = makeGuess('B', base, PHRASE);
    const again = makeGuess('B', withB, PHRASE);
    expect(again).toBe(withB); // same reference — no change
  });

  it('ignores a guess when gameOver is true', () => {
    const over = { ...base, gameOver: true };
    const next = makeGuess('A', over, PHRASE);
    expect(next).toBe(over);
  });

  it('sets won = true when all letters are guessed', () => {
    let s = base;
    for (const l of ['B', 'I', 'T', 'E', 'H', 'U', 'L']) {
      s = makeGuess(l, s, PHRASE);
    }
    expect(s.won).toBe(true);
    expect(s.gameOver).toBe(true);
  });

  it('sets gameOver = true when wrongCount reaches MAX_WRONG', () => {
    let s = base;
    for (const l of ['Z', 'X', 'Q', 'J', 'V', 'W']) { // 6 wrong letters not in PHRASE
      s = makeGuess(l, s, PHRASE);
    }
    expect(s.wrongCount).toBe(MAX_WRONG);
    expect(s.gameOver).toBe(true);
    expect(s.won).toBe(false);
  });

  it('MAX_WRONG is 6', () => {
    expect(MAX_WRONG).toBe(6);
  });
});

// ---------------------------------------------------------------------------
// buildShareText
// ---------------------------------------------------------------------------

describe('buildShareText', () => {
  const phraseObj = { phrase: 'BITE THE BULLET', category: 'Idiom' };

  it('does not include the answer phrase', () => {
    expect(buildShareText(phraseObj, 2, true, '21 Jun')).not.toContain('BITE THE BULLET');
  });

  it('includes a word-length pattern instead', () => {
    // BITE=4, THE=3, BULLET=6 → □□□□  □□□  □□□□□□
    const text = buildShareText(phraseObj, 2, true, '21 Jun');
    expect(text).toContain('□□□□');
    expect(text).toContain('□□□');
    expect(text).toContain('□□□□□□');
  });

  it('includes the category', () => {
    expect(buildShareText(phraseObj, 2, true, '21 Jun')).toContain('Idiom');
  });

  it('includes the date', () => {
    expect(buildShareText(phraseObj, 2, true, '21 Jun')).toContain('21 Jun');
  });

  it('shows wrong count on win', () => {
    expect(buildShareText(phraseObj, 2, true, '21 Jun')).toContain('2 wrong');
  });

  it('shows failure message on loss', () => {
    expect(buildShareText(phraseObj, 6, false, '21 Jun')).toContain('Too many');
  });

  it('omits the time line when elapsedMs is not given', () => {
    expect(buildShareText(phraseObj, 2, true, '21 Jun')).not.toContain('⏱️');
  });

  it('includes the formatted time when elapsedMs is given', () => {
    expect(buildShareText(phraseObj, 2, true, '21 Jun', 42000)).toContain('⏱️ 0:42');
  });
});

// ---------------------------------------------------------------------------
// formatDuration
// ---------------------------------------------------------------------------

describe('formatDuration', () => {
  it('formats sub-minute durations as 0:SS', () => {
    expect(formatDuration(42000)).toBe('0:42');
  });

  it('pads single-digit seconds', () => {
    expect(formatDuration(65000)).toBe('1:05');
  });

  it('formats multi-minute durations', () => {
    expect(formatDuration(125000)).toBe('2:05');
  });

  it('floors partial seconds', () => {
    expect(formatDuration(1999)).toBe('0:01');
  });

  it('clamps negative durations to 0:00', () => {
    expect(formatDuration(-500)).toBe('0:00');
  });
});

// ---------------------------------------------------------------------------
// localStorage persistence
// ---------------------------------------------------------------------------

describe('state persistence', () => {
  beforeEach(() => localStorage.clear());

  it('loadState returns null when nothing saved', () => {
    expect(loadState()).toBeNull();
  });

  it('round-trips state through save/load', () => {
    const state = { guessedLetters: new Set(['A', 'B']), wrongCount: 1, won: false, gameOver: false };
    saveState(state, { phrase: PHRASE });
    const loaded = loadState();
    expect(loaded).not.toBeNull();
    expect(loaded.guessedLetters.has('A')).toBe(true);
    expect(loaded.wrongCount).toBe(1);
    expect(loaded.phrase).toBe(PHRASE);
  });

  it('loadState returns null for a stale date', () => {
    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1);
    const key = `${yesterday.getFullYear()}-${String(yesterday.getMonth()+1).padStart(2,'0')}-${String(yesterday.getDate()).padStart(2,'0')}`;
    localStorage.setItem('phrasle_state', JSON.stringify({ guessedLetters: [], date: key }));
    expect(loadState()).toBeNull();
  });

  it('deserializes guessedLetters back into a Set', () => {
    const state = { guessedLetters: new Set(['X', 'Y']), wrongCount: 2, won: false, gameOver: false };
    saveState(state, { phrase: PHRASE });
    const loaded = loadState();
    expect(loaded.guessedLetters).toBeInstanceOf(Set);
    expect(loaded.guessedLetters.has('X')).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Stats
// ---------------------------------------------------------------------------

describe('loadStats / saveStats', () => {
  beforeEach(() => localStorage.clear());

  it('returns defaults when nothing saved', () => {
    const s = loadStats();
    expect(s.played).toBe(0);
    expect(s.won).toBe(0);
    expect(s.streak).toBe(0);
    expect(s.totalWrong).toBe(0);
  });

  it('round-trips through save/load', () => {
    const stats = { played: 3, won: 2, streak: 1, maxStreak: 2, totalWrong: 4 };
    saveStats(stats);
    expect(loadStats().played).toBe(3);
  });
});

describe('updateStats', () => {
  const base = { played: 5, won: 3, streak: 2, maxStreak: 4, totalWrong: 6 };

  it('increments played on every call', () => {
    expect(updateStats(base, true, 1).played).toBe(6);
    expect(updateStats(base, false, 6).played).toBe(6);
  });

  it('increments won and streak on a win', () => {
    const next = updateStats(base, true, 2);
    expect(next.won).toBe(4);
    expect(next.streak).toBe(3);
  });

  it('accumulates totalWrong on a win', () => {
    const next = updateStats(base, true, 3);
    expect(next.totalWrong).toBe(9);
  });

  it('resets streak on a loss', () => {
    expect(updateStats(base, false, 6).streak).toBe(0);
  });

  it('does not change totalWrong on a loss', () => {
    expect(updateStats(base, false, 6).totalWrong).toBe(6);
  });

  it('updates maxStreak when current streak exceeds it', () => {
    const high = { ...base, streak: 4 };
    expect(updateStats(high, true, 1).maxStreak).toBe(5);
  });

  it('does not mutate the original stats', () => {
    updateStats(base, true, 1);
    expect(base.played).toBe(5);
  });
});

// ---------------------------------------------------------------------------
// todayKey
// ---------------------------------------------------------------------------

describe('todayKey', () => {
  it('formats as YYYY-MM-DD', () => {
    expect(todayKey()).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it('matches the local date', () => {
    const d = new Date();
    const expected = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    expect(todayKey()).toBe(expected);
  });
});

// ---------------------------------------------------------------------------
// Leaderboard identity — player id, name, opt-in
// ---------------------------------------------------------------------------

describe('getPlayerId', () => {
  beforeEach(() => localStorage.clear());

  it('generates a uuid on first call', () => {
    const id = getPlayerId();
    expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i);
  });

  it('returns the same id on subsequent calls', () => {
    const first = getPlayerId();
    const second = getPlayerId();
    expect(second).toBe(first);
  });

  it('persists the id across separate loads (localStorage)', () => {
    const id = getPlayerId();
    expect(localStorage.getItem('phrasle_player_id')).toBe(id);
  });
});

describe('getPlayerName / setPlayerName', () => {
  beforeEach(() => localStorage.clear());

  it('returns an empty string when no name has been set', () => {
    expect(getPlayerName()).toBe('');
  });

  it('round-trips a saved name', () => {
    setPlayerName('Jim');
    expect(getPlayerName()).toBe('Jim');
  });

  it('overwrites a previously saved name', () => {
    setPlayerName('Jim');
    setPlayerName('Cottam');
    expect(getPlayerName()).toBe('Cottam');
  });
});

describe('getLeaderboardOptIn / setLeaderboardOptIn', () => {
  beforeEach(() => localStorage.clear());

  it('returns null when the player has never been asked', () => {
    expect(getLeaderboardOptIn()).toBeNull();
  });

  it('returns true after opting in', () => {
    setLeaderboardOptIn(true);
    expect(getLeaderboardOptIn()).toBe(true);
  });

  it('returns false after opting out', () => {
    setLeaderboardOptIn(false);
    expect(getLeaderboardOptIn()).toBe(false);
  });

  it('can flip from opted-in back to opted-out', () => {
    setLeaderboardOptIn(true);
    setLeaderboardOptIn(false);
    expect(getLeaderboardOptIn()).toBe(false);
  });
});
