-- Microsoft Teams integration: OAuth token storage + imported-transcript dedupe.

-- OAuth tokens. Deliberately NO policies and NO grants: this table must be
-- invisible to PostgREST clients; only edge functions (service role) read it.
create table public.ms_connections (
  user_id uuid primary key references auth.users(id) on delete cascade,
  tenant_id text,
  account_email text,
  refresh_token text not null,
  scopes text not null default '',
  connected_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table public.ms_connections enable row level security;
revoke all on public.ms_connections from anon, authenticated;

-- Which Graph transcripts were already imported (sync dedupe).
create table public.imported_meetings (
  user_id uuid not null references auth.users(id) on delete cascade,
  provider text not null default 'teams',
  provider_transcript_id text not null,
  transcript_id text, -- our transcripts.id (null if later deleted)
  meeting_subject text,
  imported_at timestamptz not null default now(),
  primary key (user_id, provider, provider_transcript_id)
);
alter table public.imported_meetings enable row level security;
create policy "own imported_meetings" on public.imported_meetings
  for select using (user_id = auth.uid());
-- Read-only for clients; writes happen in edge functions via service role.
revoke all on public.imported_meetings from anon, authenticated;
grant select on public.imported_meetings to authenticated;
