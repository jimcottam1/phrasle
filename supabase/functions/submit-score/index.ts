// Server-side gatekeeper for leaderboard writes. The `users`/`scores` tables
// no longer accept direct anon inserts (see the RLS policy changes shipped
// alongside this function) — every score submission has to pass through
// here, where the display name is checked against a profanity filter and
// the score bounds are validated before writing with the service-role key.
import { createClient } from 'npm:@supabase/supabase-js@2';
import { Filter } from 'npm:bad-words@4';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

const MAX_WRONG = 6;
const MAX_NAME_LENGTH = 24;

const filter = new Filter();
// These are flagged by the base list but are too mild to reject a display
// name over — the list is tuned for general content moderation, not names.
filter.removeWords('crap', 'bloody', 'bum', 'boob', 'butt', 'damn', 'hell', 'god');

// bad-words only matches whole, space-separated words ("fuck you" but not
// "fuckyou"/"FuckYou") — useless against display names, which are almost
// always a single token. This is a narrow, deliberately short substring
// check as a second layer, for names with no spaces to split on.
const HARD_BLOCK_RE = /fuck|shit|cunt|nigger|faggot|bitch|asshole|whore|retard/i;

function isRejectedName(name: string): boolean {
  return filter.isProfane(name) || HARD_BLOCK_RE.test(name);
}

// The browser sends a CORS preflight OPTIONS request before the real POST
// (since the client sends custom headers cross-origin) — it has to get a
// 2xx with these headers or the browser never even attempts the POST.
const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', ...CORS_HEADERS },
  });
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: CORS_HEADERS });
  }
  if (req.method !== 'POST') {
    return json({ error: 'method_not_allowed' }, 405);
  }

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return json({ error: 'invalid_json' }, 400);
  }

  const { playerId, name, wrongCount, elapsedMs } = body;

  if (typeof playerId !== 'string' || !UUID_RE.test(playerId)) {
    return json({ error: 'invalid_player_id' }, 400);
  }

  if (typeof name !== 'string' || name.trim().length === 0) {
    return json({ error: 'invalid_name' }, 400);
  }
  const trimmedName = name.trim().slice(0, MAX_NAME_LENGTH);
  if (isRejectedName(trimmedName)) {
    return json({ error: 'profane_name' }, 422);
  }

  if (!Number.isInteger(wrongCount) || wrongCount < 0 || wrongCount > MAX_WRONG) {
    return json({ error: 'invalid_wrong_count' }, 400);
  }
  if (typeof elapsedMs !== 'number' || !Number.isFinite(elapsedMs) || elapsedMs < 0) {
    return json({ error: 'invalid_elapsed_ms' }, 400);
  }

  // The date is computed here, not trusted from the client, so a player
  // can't backdate/forward-date a submission by lying about "today."
  const date = new Date().toISOString().slice(0, 10);

  const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

  const { error: userError } = await supabase
    .from('users')
    .upsert({ id: playerId, name: trimmedName }, { onConflict: 'id' });
  if (userError) return json({ error: 'db_error', detail: userError.message }, 500);

  const { error: scoreError } = await supabase
    .from('scores')
    .upsert(
      { date, player_id: playerId, wrong_count: wrongCount, elapsed_ms: Math.round(elapsedMs) },
      { onConflict: 'date,player_id' },
    );
  if (scoreError) return json({ error: 'db_error', detail: scoreError.message }, 500);

  return json({ ok: true });
});
