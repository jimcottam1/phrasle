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

/** Body for the submit-score Edge Function, which validates + writes server-side. */
export function buildSubmitScorePayload(playerId, name, wrongCount, elapsedMs) {
  return {
    playerId,
    name: resolveDisplayName(name),
    wrongCount,
    elapsedMs: Math.round(elapsedMs),
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
