create table if not exists public.isolated_lab_samples (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  details text,
  importance integer not null default 0,
  created_at timestamptz not null default now()
);

insert into public.isolated_lab_samples (title, details, importance)
values
  ('Cold storage update', 'Testing Supabase connectivity from isolated page', 2),
  ('ETF flow alert', 'Sample row seeded for UI scaffolding', 1),
  ('Halving prep note', 'Use this to verify inserts from the page', 3)
on conflict do nothing;

alter table public.isolated_lab_samples enable row level security;

drop policy if exists "Allow anon read isolated_lab_samples" on public.isolated_lab_samples;
create policy "Allow anon read isolated_lab_samples"
  on public.isolated_lab_samples
  for select
  to anon
  using (true);

drop policy if exists "Allow anon insert isolated_lab_samples" on public.isolated_lab_samples;
create policy "Allow anon insert isolated_lab_samples"
  on public.isolated_lab_samples
  for insert
  to anon
  with check (true);

