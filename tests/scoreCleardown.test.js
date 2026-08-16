import { describe, it, expect } from 'vitest';
import { cleardownCutoffDate } from '../supabase/functions/submit-score/scoreCleardown.ts';

describe('cleardownCutoffDate', () => {
  it('returns the date exactly 14 days before "now"', () => {
    expect(cleardownCutoffDate(new Date('2026-08-16T12:00:00.000Z'))).toBe('2026-08-02');
  });

  it('crosses a month boundary correctly', () => {
    expect(cleardownCutoffDate(new Date('2026-03-05T00:00:00.000Z'))).toBe('2026-02-19');
  });

  it('crosses a year boundary correctly', () => {
    expect(cleardownCutoffDate(new Date('2026-01-05T00:00:00.000Z'))).toBe('2025-12-22');
  });
});
