create or replace function weekly_leaderboard(weeks_ago int default 0)
returns table(player_id uuid, name text, games_played int, avg_wrong numeric, avg_elapsed_ms numeric)
language sql
stable
as $$
  select s.player_id, u.name, count(*)::int as games_played,
         avg(s.wrong_count) as avg_wrong, avg(s.elapsed_ms) as avg_elapsed_ms
  from scores s
  join users u on u.id = s.player_id
  where s.date >= (date_trunc('week', current_date)::date - (weeks_ago * 7))
    and s.date <  (date_trunc('week', current_date)::date - (weeks_ago * 7) + 7)
  group by s.player_id, u.name
  order by avg_wrong asc, avg_elapsed_ms asc;
$$;

grant execute on function weekly_leaderboard(int) to anon, authenticated;
select pg_notify('pgrst', 'reload schema');
