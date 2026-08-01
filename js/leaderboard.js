import { formatDuration } from './game.js';

/** Trims a user-entered name, falling back to 'Anonymous' when blank. */
export function resolveDisplayName(rawName) {
  const trimmed = (rawName ?? '').trim();
  return trimmed || 'Anonymous';
}

export function escapeHtml(str) {
  return str.replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[c]));
}

/**
 * Body for the submit-score Edge Function, which validates + writes
 * server-side. timezoneOffsetMinutes (Date.prototype.getTimezoneOffset())
 * lets the function file the score under the player's *local* calendar day
 * instead of its own UTC clock's day — otherwise anyone playing within an
 * hour or so of midnight gets a score dated one day off from what their own
 * leaderboard view (which is local-date-based) asks for, and it silently
 * never appears. It's an offset, not an arbitrary date, so the function can
 * still bound it to real-world values rather than trusting it blindly.
 */
export function buildSubmitScorePayload(playerId, name, wrongCount, elapsedMs) {
  return {
    playerId,
    name: resolveDisplayName(name),
    wrongCount,
    elapsedMs: Math.round(elapsedMs),
    timezoneOffsetMinutes: new Date().getTimezoneOffset(),
  };
}

/** PostgREST path for today's top scores, ranked by fewest wrong guesses then fastest time. */
export function buildLeaderboardPath(date, limit = 10) {
  return `scores?date=eq.${date}&select=wrong_count,elapsed_ms,users(name)&order=wrong_count.asc,elapsed_ms.asc&limit=${limit}`;
}

export function renderLeaderboardRows(rows) {
  return rows.map((row, i) => `
    <div class="leaderboard-row">
      <span class="leaderboard-rank">${i + 1}</span>
      <span class="leaderboard-name">${escapeHtml(row.users?.name ?? 'Anonymous')}</span>
      <span class="leaderboard-wrong">${row.wrong_count} wrong</span>
      <span class="leaderboard-time">${formatDuration(row.elapsed_ms)}</span>
    </div>
  `).join('');
}
