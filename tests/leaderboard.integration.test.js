import { describe, it, expect, beforeEach, vi } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { getTodayPhrase } from '../data/phrases.js';
import { getLetterSet } from '../js/game.js';

// ---------------------------------------------------------------------------
// Drives the actual DOM (index.html) + main.js bootstrap, with fetch mocked,
// to confirm the leaderboard flow actually works end to end: play a game,
// get opt-in-prompted, join (via the submit-score Edge Function), see the
// leaderboard, leave, rejoin, and get bounced back on a rejected name.
// ---------------------------------------------------------------------------

const HTML_PATH = path.resolve(__dirname, '../index.html');
const SUBMIT_URL_FRAGMENT = '/functions/v1/submit-score';

function loadIndexBody() {
  const html = fs.readFileSync(HTML_PATH, 'utf-8');
  const body = html.match(/<body>([\s\S]*)<\/body>/)[1];
  // The real bootstrap script is imported manually per test instead.
  document.body.innerHTML = body.replace(/<script[^>]*src="js\/main\.js"[^>]*><\/script>/, '');
}

async function importMain() {
  vi.resetModules();
  return import('../js/main.js');
}

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function click(id) {
  document.getElementById(id).click();
}

/** Guesses every unique letter in today's phrase so the game ends in a clean win. */
async function playToWin(phrase) {
  for (const letter of getLetterSet(phrase)) {
    const key = document.querySelector(`.key[data-letter="${letter}"]`);
    key.click();
  }
  await wait(700); // covers endGame's setTimeout(showEndPanel/promptLeaderboard, 500)
}

describe('leaderboard flow (integration)', () => {
  let fetchMock;
  let postCalls;
  let submitScoreResult; // { ok: true } or { ok: false, status, error }
  const mockRows = [
    { wrong_count: 0, elapsed_ms: 12000, users: { name: 'Alice' } },
    { wrong_count: 1, elapsed_ms: 9000, users: { name: 'Bob' } },
  ];

  beforeEach(() => {
    localStorage.clear();
    localStorage.setItem('phrasle_stats', JSON.stringify({ played: 1, won: 1, streak: 1, maxStreak: 1, totalWrong: 0 }));
    loadIndexBody();

    postCalls = [];
    submitScoreResult = { ok: true };

    fetchMock = vi.fn(async (url, options = {}) => {
      if (url.includes(SUBMIT_URL_FRAGMENT)) {
        postCalls.push({ url, options });
        return submitScoreResult.ok
          ? { ok: true, status: 200, json: async () => ({ ok: true }) }
          : { ok: false, status: submitScoreResult.status, json: async () => ({ error: submitScoreResult.error }) };
      }
      // GET leaderboard reads straight from PostgREST.
      return { ok: true, text: async () => JSON.stringify(mockRows) };
    });
    vi.stubGlobal('fetch', fetchMock);
  });

  it('prompts to join on first win, submits via the Edge Function, and shows it on the leaderboard', async () => {
    const { phrase } = getTodayPhrase();
    await importMain();

    await playToWin(phrase);

    // 1. Never asked before -> opt-in modal appears.
    expect(document.getElementById('modal-optin').hidden).toBe(false);
    expect(localStorage.getItem('phrasle_leaderboard_optin')).toBeNull();

    // 2. Join in as "Jim".
    document.getElementById('optin-name').value = 'Jim';
    click('btn-optin-yes');
    await wait(10);

    expect(document.getElementById('modal-optin').hidden).toBe(true);
    expect(localStorage.getItem('phrasle_leaderboard_optin')).toBe('true');

    // 3. One POST to the Edge Function — not a direct table insert — with
    // the right auth header and body shape.
    expect(postCalls).toHaveLength(1);
    const [submitCall] = postCalls;
    expect(submitCall.url).toContain(SUBMIT_URL_FRAGMENT);
    expect(submitCall.options.headers.apikey).toBeTruthy();
    expect(submitCall.options.headers.Authorization).toMatch(/^Bearer /);

    const body = JSON.parse(submitCall.options.body);
    expect(body.name).toBe('Jim');
    expect(body.playerId).toMatch(/^[0-9a-f-]{36}$/i);
    expect(body.wrongCount).toBe(0); // only correct letters were guessed
    expect(body.elapsedMs).toBeGreaterThanOrEqual(0);
    expect(Number.isInteger(body.timezoneOffsetMinutes)).toBe(true); // lets the function file it under the player's local day

    // 4. Player id/name persist locally.
    expect(localStorage.getItem('phrasle_player_id')).toBe(body.playerId);
    expect(localStorage.getItem('phrasle_player_name')).toBe('Jim');

    // 5. Open the leaderboard — mocked GET returns two rows, rendered in order.
    click('btn-leaderboard');
    await wait(10);

    const content = document.getElementById('leaderboard-content').innerHTML;
    expect(content.indexOf('Alice')).toBeLessThan(content.indexOf('Bob'));
    expect(content).toContain('0 wrong');
    expect(content).toContain('1 wrong');

    const getCall = fetchMock.mock.calls.find(([url]) => !url.includes(SUBMIT_URL_FRAGMENT));
    expect(getCall[0]).toContain('order=wrong_count.asc,elapsed_ms.asc');

    // 6. Currently opted in -> "leave" button shows, "join" button hidden.
    expect(document.getElementById('btn-leaderboard-optout').hidden).toBe(false);
    expect(document.getElementById('btn-leaderboard-optin').hidden).toBe(true);

    // 7. Leave the leaderboard.
    click('btn-leaderboard-optout');
    expect(localStorage.getItem('phrasle_leaderboard_optin')).toBe('false');
    expect(document.getElementById('modal-leaderboard').hidden).toBe(true);

    // 8. Reopening shows the "join" button instead, since we're now opted out.
    click('btn-leaderboard');
    await wait(10);
    expect(document.getElementById('btn-leaderboard-optout').hidden).toBe(true);
    expect(document.getElementById('btn-leaderboard-optin').hidden).toBe(false);

    // 9. Rejoin from the leaderboard modal itself.
    postCalls.length = 0;
    click('btn-leaderboard-optin');
    expect(document.getElementById('modal-optin').hidden).toBe(false);
    expect(document.getElementById('optin-name').value).toBe('Jim'); // remembers the prior name

    click('btn-optin-yes');
    await wait(10);
    expect(localStorage.getItem('phrasle_leaderboard_optin')).toBe('true');
    expect(postCalls).toHaveLength(1); // resubmits today's already-finished score
  });

  it('does not submit a score or re-prompt once the player declines', async () => {
    const { phrase } = getTodayPhrase();
    await importMain();

    await playToWin(phrase);
    expect(document.getElementById('modal-optin').hidden).toBe(false);

    click('btn-optin-no');
    expect(localStorage.getItem('phrasle_leaderboard_optin')).toBe('false');
    expect(postCalls).toHaveLength(0);

    // Opening the leaderboard should offer to join, not to leave.
    click('btn-leaderboard');
    await wait(10);
    expect(document.getElementById('btn-leaderboard-optin').hidden).toBe(false);
    expect(document.getElementById('btn-leaderboard-optout').hidden).toBe(true);
  });

  it('keeps the opt-in modal open and shows an error when the Edge Function rejects a profane name', async () => {
    const { phrase } = getTodayPhrase();
    await importMain();

    await playToWin(phrase);

    submitScoreResult = { ok: false, status: 422, error: 'profane_name' };
    document.getElementById('optin-name').value = 'RudeWord';
    click('btn-optin-yes');
    await wait(10);

    // Rejected -> modal stays open, nothing gets persisted as opted-in.
    expect(document.getElementById('modal-optin').hidden).toBe(false);
    expect(localStorage.getItem('phrasle_leaderboard_optin')).toBeNull();
    expect(localStorage.getItem('phrasle_player_name')).toBeNull();

    const toast = document.getElementById('toast');
    expect(toast.textContent).toMatch(/isn't allowed/i);
    expect(toast.classList.contains('toast--visible')).toBe(true);

    // Fix the name and retry — now it goes through.
    submitScoreResult = { ok: true };
    document.getElementById('optin-name').value = 'Jim';
    click('btn-optin-yes');
    await wait(10);

    expect(document.getElementById('modal-optin').hidden).toBe(true);
    expect(localStorage.getItem('phrasle_leaderboard_optin')).toBe('true');
    expect(localStorage.getItem('phrasle_player_name')).toBe('Jim');
  });
});
