-- Run this in the Supabase SQL editor after the submit-score Edge Function
-- is deployed. It removes the anon key's ability to write to users/scores
-- directly — from this point on, the only way to write a row is through
-- the Edge Function (which uses the service-role key and enforces the
-- profanity filter + score bounds). Reads are untouched; the leaderboard
-- modal still queries these tables directly with the anon key.

drop policy if exists "anyone can upsert own user" on users;
drop policy if exists "anyone can update users" on users;
drop policy if exists "anyone can insert scores" on scores;

-- select policies ("anyone can read users" / "anyone can read scores") are
-- left in place — the leaderboard still reads directly.
