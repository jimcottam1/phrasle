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

const WRONG_LABEL = 'Wrong';
const TIME_LABEL = 'Time';

export function renderLeaderboardRows(rows) {
  if (rows.length === 0) return '';
  // Sizes the name column to the longest name actually on the board (capped,
  // with ellipsis as a fallback) instead of stretching it to fill the row —
  // otherwise a short name like "Jim" leaves a wide dead gap before the stats.
  const nameWidth = Math.min(20, Math.max(1, ...rows.map((row) => (row.users?.name ?? 'Anonymous').length)));
  // Both stat columns are sized to fit whichever is wider — the column
  // label or the longest value actually in the list — so the header always
  // lines up with the numbers/times beneath it. +1ch is slack for the
  // header's uppercase transform, which renders wider per character than
  // the digits/colons the "ch" unit is calibrated against.
  const wrongWidth = Math.max(WRONG_LABEL.length, ...rows.map((row) => String(row.wrong_count).length)) + 1;
  const timeWidth = Math.max(TIME_LABEL.length, ...rows.map((row) => formatDuration(row.elapsed_ms).length)) + 1;
  const header = `
    <div class="leaderboard-row leaderboard-row--header">
      <span class="leaderboard-rank"></span>
      <span class="leaderboard-name" style="width: ${nameWidth}ch"></span>
      <span class="leaderboard-wrong" style="width: ${wrongWidth}ch">${WRONG_LABEL}</span>
      <span class="leaderboard-time" style="width: ${timeWidth}ch">${TIME_LABEL}</span>
    </div>
  `;
  const body = rows.map((row, i) => `
    <div class="leaderboard-row">
      <span class="leaderboard-rank">${i + 1}</span>
      <span class="leaderboard-name" style="width: ${nameWidth}ch">${escapeHtml(row.users?.name ?? 'Anonymous')}</span>
      <span class="leaderboard-wrong" style="width: ${wrongWidth}ch">${row.wrong_count}</span>
      <span class="leaderboard-time" style="width: ${timeWidth}ch">${formatDuration(row.elapsed_ms)}</span>
    </div>
  `).join('');
  return header + body;
}

// ---------------------------------------------------------------------------
// Weekly leaderboard — a Postgres function (not a plain table/view) since it
// takes a "weeks ago" parameter: 0 = the current, still-in-progress week
// (Mon 00:00 so far), 1 = the most recently completed Mon-Sun week, whose
// result is final and never changes again once that week is over.
// ---------------------------------------------------------------------------

export function buildWeeklyLeaderboardPath(weeksAgo, limit = 10) {
  return `rpc/weekly_leaderboard?weeks_ago=${weeksAgo}&limit=${limit}`;
}

export function renderWeeklyLeaderboardRows(rows) {
  return rows.map((row, i) => `
    <div class="leaderboard-row">
      <span class="leaderboard-rank">${i + 1}</span>
      <span class="leaderboard-name">${escapeHtml(row.name ?? 'Anonymous')}</span>
      <span class="leaderboard-games">${row.games_played} played</span>
      <span class="leaderboard-wrong">${Number(row.avg_wrong).toFixed(1)} avg wrong</span>
      <span class="leaderboard-time">${formatDuration(row.avg_elapsed_ms)} avg</span>
    </div>
  `).join('');
}
