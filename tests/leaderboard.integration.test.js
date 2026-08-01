import { describe, it, expect, beforeEach, vi } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { getTodayPhrase } from '../data/phrases.js';
import { getLetterSet } from '../js/game.js';

// ---------------------------------------------------------------------------
// Drives the actual DOM (index.html) + main.js bootstrap, with fetch mocked,
// to confirm the leaderboard flow described to the user actually works end
// to end: play a game, get opted-in-prompted, join, see the leaderboard,
// leave, and rejoin.
// ---------------------------------------------------------------------------

const HTML_PATH = path.resolve(__dirname, '../index.html');

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
  const mockRows = [
    { wrong_count: 0, elapsed_ms: 12000, users: { name: 'Alice' } },
    { wrong_count: 1, elapsed_ms: 9000, users: { name: 'Bob' } },
  ];

  beforeEach(() => {
    localStorage.clear();
    localStorage.setItem('phrasle_stats', JSON.stringify({ played: 1, won: 1, streak: 1, maxStreak: 1, totalWrong: 0 }));
    loadIndexBody();

    postCalls = [];
    fetchMock = vi.fn(async (url, options = {}) => {
      if ((options.method || 'GET') === 'POST') {
        postCalls.push({ url, options });
        return { ok: true, text: async () => '' };
      }
      return { ok: true, text: async () => JSON.stringify(mockRows) };
    });
    vi.stubGlobal('fetch', fetchMock);
  });

  it('prompts to join on first win, submits the score, and shows it on the leaderboard', async () => {
    const { phrase } = getTodayPhrase();
    await importMain();

    await playToWin(phrase);

    // 1. Never asked before -> opt-in modal appears, not the leaderboard's own state.
    expect(document.getElementById('modal-optin').hidden).toBe(false);
    expect(localStorage.getItem('phrasle_leaderboard_optin')).toBeNull();

    // 2. Join in as "Jim".
    document.getElementById('optin-name').value = 'Jim';
    click('btn-optin-yes');
    await wait(10);

    expect(document.getElementById('modal-optin').hidden).toBe(true);
    expect(localStorage.getItem('phrasle_leaderboard_optin')).toBe('true');

    // 3. Two POSTs: users upsert, then scores upsert — correct URLs/headers/bodies.
    expect(postCalls).toHaveLength(2);

    const [userCall, scoreCall] = postCalls;
    expect(userCall.url).toContain('/rest/v1/users?on_conflict=id');
    expect(userCall.options.headers.Prefer).toBe('resolution=merge-duplicates');
    const userBody = JSON.parse(userCall.options.body);
    expect(userBody.name).toBe('Jim');
    expect(userBody.id).toMatch(/^[0-9a-f-]{36}$/i);

    expect(scoreCall.url).toContain('/rest/v1/scores?on_conflict=date,player_id');
    const scoreBody = JSON.parse(scoreCall.options.body);
    expect(scoreBody.player_id).toBe(userBody.id);
    expect(scoreBody.wrong_count).toBe(0); // only correct letters were guessed
    expect(scoreBody.elapsed_ms).toBeGreaterThanOrEqual(0);
    expect(scoreBody.date).toMatch(/^\d{4}-\d{2}-\d{2}$/);

    // 4. Player id persists in localStorage under the browser's profile.
    expect(localStorage.getItem('phrasle_player_id')).toBe(userBody.id);
    expect(localStorage.getItem('phrasle_player_name')).toBe('Jim');

    // 5. Open the leaderboard — mocked GET returns two rows, rendered in order.
    click('btn-leaderboard');
    await wait(10);

    const content = document.getElementById('leaderboard-content').innerHTML;
    expect(content.indexOf('Alice')).toBeLessThan(content.indexOf('Bob'));
    expect(content).toContain('0 wrong');
    expect(content).toContain('1 wrong');

    const getCall = fetchMock.mock.calls.find(([, opts]) => !opts || (opts.method || 'GET') === 'GET');
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
    expect(postCalls).toHaveLength(2); // resubmits today's already-finished score
  });

  it('does not submit a score or re-prompt once the player declines', async () => {
    const { phrase } = getTodayPhrase();
    await importMain();

    await playToWin(phrase);
    expect(document.getElementById('modal-optin').hidden).toBe(false);

    click('btn-optin-no');
    expect(localStorage.getItem('phrasle_leaderboard_optin')).toBe('false');
    expect(postCalls.filter((c) => c.url.includes('/scores'))).toHaveLength(0);

    // Opening the leaderboard should offer to join, not to leave.
    click('btn-leaderboard');
    await wait(10);
    expect(document.getElementById('btn-leaderboard-optin').hidden).toBe(false);
    expect(document.getElementById('btn-leaderboard-optout').hidden).toBe(true);
  });
});
