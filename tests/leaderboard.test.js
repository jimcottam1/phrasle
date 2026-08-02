import { describe, it, expect } from 'vitest';
import {
  resolveDisplayName, escapeHtml, buildSubmitScorePayload,
  buildLeaderboardPath, renderLeaderboardRows,
  buildWeeklyLeaderboardPath, renderWeeklyLeaderboardRows,
} from '../js/leaderboard.js';

// ---------------------------------------------------------------------------
// resolveDisplayName
// ---------------------------------------------------------------------------

describe('resolveDisplayName', () => {
  it('trims surrounding whitespace', () => {
    expect(resolveDisplayName('  Jim  ')).toBe('Jim');
  });

  it('falls back to Anonymous for an empty string', () => {
    expect(resolveDisplayName('')).toBe('Anonymous');
  });

  it('falls back to Anonymous for whitespace only', () => {
    expect(resolveDisplayName('   ')).toBe('Anonymous');
  });

  it('falls back to Anonymous for null/undefined', () => {
    expect(resolveDisplayName(null)).toBe('Anonymous');
    expect(resolveDisplayName(undefined)).toBe('Anonymous');
  });
});

// ---------------------------------------------------------------------------
// escapeHtml
// ---------------------------------------------------------------------------

describe('escapeHtml', () => {
  it('escapes angle brackets', () => {
    expect(escapeHtml('<script>')).toBe('&lt;script&gt;');
  });

  it('escapes ampersands, quotes and apostrophes', () => {
    expect(escapeHtml(`Tom & "Jerry" 'n friends`))
      .toBe('Tom &amp; &quot;Jerry&quot; &#39;n friends');
  });

  it('neutralizes an XSS payload used as a display name', () => {
    const malicious = '<img src=x onerror=alert(1)>';
    const escaped = escapeHtml(malicious);
    expect(escaped).not.toContain('<img');
    expect(escaped).toBe('&lt;img src=x onerror=alert(1)&gt;');
  });

  it('leaves ordinary text untouched', () => {
    expect(escapeHtml('Jim Cottam')).toBe('Jim Cottam');
  });
});

// ---------------------------------------------------------------------------
// buildSubmitScorePayload
// ---------------------------------------------------------------------------

describe('buildSubmitScorePayload', () => {
  it('shapes the body expected by the submit-score Edge Function', () => {
    const body = buildSubmitScorePayload('abc-123', 'Jim', 2, 42000);
    expect(body).toMatchObject({
      playerId: 'abc-123',
      name: 'Jim',
      wrongCount: 2,
      elapsedMs: 42000,
    });
    expect(Number.isInteger(body.timezoneOffsetMinutes)).toBe(true);
  });

  it('resolves a blank name to Anonymous', () => {
    expect(buildSubmitScorePayload('abc-123', '', 0, 1000).name).toBe('Anonymous');
  });

  it('rounds a fractional elapsed time to the nearest millisecond', () => {
    expect(buildSubmitScorePayload('abc-123', 'Jim', 0, 1234.7).elapsedMs).toBe(1235);
  });
});

// ---------------------------------------------------------------------------
// buildLeaderboardPath
// ---------------------------------------------------------------------------

describe('buildLeaderboardPath', () => {
  it('filters by the given date', () => {
    expect(buildLeaderboardPath('2026-08-01')).toContain('date=eq.2026-08-01');
  });

  it('sorts by wrong_count ascending then elapsed_ms ascending', () => {
    expect(buildLeaderboardPath('2026-08-01')).toContain('order=wrong_count.asc,elapsed_ms.asc');
  });

  it('joins the users table for the display name', () => {
    expect(buildLeaderboardPath('2026-08-01')).toContain('select=wrong_count,elapsed_ms,users(name)');
  });

  it('defaults the limit to 10', () => {
    expect(buildLeaderboardPath('2026-08-01')).toContain('limit=10');
  });

  it('accepts a custom limit', () => {
    expect(buildLeaderboardPath('2026-08-01', 3)).toContain('limit=3');
  });
});

// ---------------------------------------------------------------------------
// renderLeaderboardRows
// ---------------------------------------------------------------------------

describe('renderLeaderboardRows', () => {
  it('renders one row per score, ranked in the order given', () => {
    const rows = [
      { wrong_count: 0, elapsed_ms: 30000, users: { name: 'Alice' } },
      { wrong_count: 1, elapsed_ms: 45000, users: { name: 'Bob' } },
    ];
    const html = renderLeaderboardRows(rows);
    expect(html.indexOf('Alice')).toBeLessThan(html.indexOf('Bob'));
    expect(html).toContain('>1<'); // Alice's rank
    expect(html).toContain('>2<'); // Bob's rank
  });

  it('shows wrong-guess count and formatted time', () => {
    const html = renderLeaderboardRows([{ wrong_count: 3, elapsed_ms: 65000, users: { name: 'Alice' } }]);
    expect(html).toContain('3 wrong');
    expect(html).toContain('1:05');
  });

  it('falls back to Anonymous when the joined user has no name', () => {
    const html = renderLeaderboardRows([{ wrong_count: 0, elapsed_ms: 1000, users: null }]);
    expect(html).toContain('Anonymous');
  });

  it('escapes a malicious display name instead of injecting it', () => {
    const html = renderLeaderboardRows([
      { wrong_count: 0, elapsed_ms: 1000, users: { name: '<script>alert(1)</script>' } },
    ]);
    expect(html).not.toContain('<script>');
    expect(html).toContain('&lt;script&gt;');
  });

  it('returns an empty string for an empty list', () => {
    expect(renderLeaderboardRows([])).toBe('');
  });
});

// ---------------------------------------------------------------------------
// buildWeeklyLeaderboardPath
// ---------------------------------------------------------------------------

describe('buildWeeklyLeaderboardPath', () => {
  it('calls the weekly_leaderboard RPC with the given weeks_ago', () => {
    expect(buildWeeklyLeaderboardPath(0)).toBe('rpc/weekly_leaderboard?weeks_ago=0&limit=10');
    expect(buildWeeklyLeaderboardPath(1)).toBe('rpc/weekly_leaderboard?weeks_ago=1&limit=10');
  });

  it('accepts a custom limit', () => {
    expect(buildWeeklyLeaderboardPath(1, 3)).toBe('rpc/weekly_leaderboard?weeks_ago=1&limit=3');
  });
});

// ---------------------------------------------------------------------------
// renderWeeklyLeaderboardRows
// ---------------------------------------------------------------------------

describe('renderWeeklyLeaderboardRows', () => {
  it('renders rank, name, games played, avg wrong, and avg time', () => {
    const html = renderWeeklyLeaderboardRows([
      { name: 'Alice', games_played: 5, avg_wrong: 1.4, avg_elapsed_ms: 65000 },
    ]);
    expect(html).toContain('>1<');
    expect(html).toContain('Alice');
    expect(html).toContain('5 played');
    expect(html).toContain('1.4 avg wrong');
    expect(html).toContain('1:05');
  });

  it('rounds avg_wrong to one decimal place', () => {
    const html = renderWeeklyLeaderboardRows([
      { name: 'Bob', games_played: 3, avg_wrong: 2, avg_elapsed_ms: 1000 },
    ]);
    expect(html).toContain('2.0 avg wrong');
  });

  it('escapes a malicious name', () => {
    const html = renderWeeklyLeaderboardRows([
      { name: '<script>alert(1)</script>', games_played: 1, avg_wrong: 0, avg_elapsed_ms: 1000 },
    ]);
    expect(html).not.toContain('<script>');
    expect(html).toContain('&lt;script&gt;');
  });

  it('falls back to Anonymous when name is missing', () => {
    const html = renderWeeklyLeaderboardRows([
      { name: null, games_played: 1, avg_wrong: 0, avg_elapsed_ms: 1000 },
    ]);
    expect(html).toContain('Anonymous');
  });

  it('returns an empty string for an empty list', () => {
    expect(renderWeeklyLeaderboardRows([])).toBe('');
  });
});
