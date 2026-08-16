// Pure date math for the leaderboard's rolling 2-week retention, split out
// from index.ts so it can be unit-tested without Deno's runtime (index.ts
// reads Deno.env at module load, which throws under Node/vitest).
const TWO_WEEKS_MS = 14 * 24 * 60 * 60 * 1000;

/** Scores dated before this (UTC, YYYY-MM-DD) are older than 2 weeks and get cleared down. */
export function cleardownCutoffDate(now = new Date()): string {
  return new Date(now.getTime() - TWO_WEEKS_MS).toISOString().slice(0, 10);
}
