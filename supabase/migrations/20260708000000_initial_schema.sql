-- Meeting KMS — initial Postgres schema (replaces Azure AI Search)
-- Run in Supabase SQL Editor, or via `supabase db push`.
--
-- Design notes:
-- - Embeddings are 1024-dim: set `"dimensions": 1024` on the Azure OpenAI
--   text-embedding-3-large request. Keeps vectors under the 2000-dim HNSW
--   limit and cuts storage 3x vs 3072.
-- - Full-text search uses the 'simple' config (language-neutral) because
--   transcripts may be English or German.
-- - RLS on every table: users only ever see their own rows.
-- - No grants for `anon`: unauthenticated requests fail at the permission
--   level even before RLS.

create extension if not exists vector with schema extensions;

-- ---------------------------------------------------------------------------
-- transcripts: one row per meeting (was docType='metadata' in Azure Search)
-- ---------------------------------------------------------------------------
create table public.transcripts (
  id text primary key,
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  title text not null default 'Untitled Transcript',
  meeting_date timestamptz not null default now(),
  duration numeric not null default 0,
  group_name text not null default '',
  project text not null default '',
  topic text not null default '',
  topics text[] not null default '{}',
  keywords text not null default '',
  tags text[] not null default '{}',
  state text not null default 'uploaded',
  segment_count int not null default 0,
  has_timestamps boolean not null default false,
  transcript text not null default '',
  summary_text text,
  personal_summary text,
  status text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index transcripts_user_date_idx on public.transcripts (user_id, meeting_date desc);
create index transcripts_project_idx on public.transcripts (user_id, project);

-- ---------------------------------------------------------------------------
-- segments: chunked transcript text + embedding (was docType='segment')
-- ---------------------------------------------------------------------------
create table public.segments (
  id text primary key, -- `${transcriptId}_${segmentId}`, same as Azure doc id
  transcript_id text not null references public.transcripts(id) on delete cascade,
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  segment_id text not null,
  text text not null,
  speaker text not null default '',
  start_time text not null default '',
  end_time text not null default '',
  embedding extensions.vector(1024),
  fts tsvector generated always as (to_tsvector('simple', text)) stored
);

create index segments_transcript_idx on public.segments (transcript_id);
create index segments_user_idx on public.segments (user_id);
create index segments_fts_idx on public.segments using gin (fts);
create index segments_embedding_idx on public.segments
  using hnsw (embedding extensions.vector_cosine_ops);

-- ---------------------------------------------------------------------------
-- project_memory: aggregated project / organization summaries
-- ---------------------------------------------------------------------------
create table public.project_memory (
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  scope text not null check (scope in ('project', 'organization')),
  name text not null default '', -- project name; '' for organization scope
  summary_text text not null,
  updated_at timestamptz not null default now(),
  primary key (user_id, scope, name)
);

-- ---------------------------------------------------------------------------
-- Row Level Security: every user only touches their own rows
-- ---------------------------------------------------------------------------
alter table public.transcripts enable row level security;
alter table public.segments enable row level security;
alter table public.project_memory enable row level security;

create policy "own transcripts" on public.transcripts
  for all using (user_id = auth.uid()) with check (user_id = auth.uid());

create policy "own segments" on public.segments
  for all using (user_id = auth.uid()) with check (user_id = auth.uid());

create policy "own project_memory" on public.project_memory
  for all using (user_id = auth.uid()) with check (user_id = auth.uid());

-- ---------------------------------------------------------------------------
-- Grants: authenticated users only. `anon` gets nothing on purpose —
-- unauthenticated calls die here even if a function forgets to check auth.
-- ---------------------------------------------------------------------------
grant usage on schema public to authenticated;
grant select, insert, update, delete on public.transcripts to authenticated;
grant select, insert, update, delete on public.segments to authenticated;
grant select, insert, update, delete on public.project_memory to authenticated;

-- Supabase's default privileges auto-grant anon on new tables; undo that here
-- and for any table created in the future.
revoke all on all tables in schema public from anon;
alter default privileges in schema public revoke all on tables from anon;

-- ---------------------------------------------------------------------------
-- hybrid_search: vector + keyword search fused with Reciprocal Rank Fusion.
-- SECURITY INVOKER so RLS applies to the calling user automatically.
-- Mirrors the Azure AI Search hybrid query used by transcripts-search/-chat.
-- ---------------------------------------------------------------------------
create or replace function public.hybrid_search(
  query_text text,
  query_embedding extensions.vector(1024),
  match_count int default 10,
  filter_transcript_id text default null,
  filter_project text default null,
  filter_group text default null,
  date_from timestamptz default null,
  date_to timestamptz default null,
  full_text_weight float default 1,
  semantic_weight float default 1,
  rrf_k int default 50
)
returns table (
  id text,
  transcript_id text,
  segment_id text,
  text text,
  speaker text,
  start_time text,
  end_time text,
  title text,
  meeting_date timestamptz,
  project text,
  group_name text,
  score float
)
language sql
stable
security invoker
set search_path = public, extensions
as $$
with base as (
  select s.id, s.transcript_id, s.segment_id, s.text, s.speaker,
         s.start_time, s.end_time, s.embedding, s.fts,
         t.title, t.meeting_date, t.project, t.group_name
  from public.segments s
  join public.transcripts t on t.id = s.transcript_id
  where (filter_transcript_id is null or s.transcript_id = filter_transcript_id)
    and (filter_project is null or t.project = filter_project)
    and (filter_group is null or t.group_name = filter_group)
    and (date_from is null or t.meeting_date >= date_from)
    and (date_to is null or t.meeting_date <= date_to)
),
full_text as (
  select id,
         row_number() over (
           order by ts_rank_cd(fts, websearch_to_tsquery('simple', query_text)) desc
         ) as rank_ix
  from base
  where query_text <> '' and fts @@ websearch_to_tsquery('simple', query_text)
  order by rank_ix
  limit greatest(match_count, 10) * 2
),
semantic as (
  select id,
         row_number() over (order by embedding <=> query_embedding) as rank_ix
  from base
  where embedding is not null
  order by rank_ix
  limit greatest(match_count, 10) * 2
)
select b.id, b.transcript_id, b.segment_id, b.text, b.speaker,
       b.start_time, b.end_time, b.title, b.meeting_date, b.project, b.group_name,
       (coalesce(1.0 / (rrf_k + full_text.rank_ix), 0.0) * full_text_weight
      + coalesce(1.0 / (rrf_k + semantic.rank_ix), 0.0) * semantic_weight) as score
from full_text
full outer join semantic on full_text.id = semantic.id
join base b on b.id = coalesce(full_text.id, semantic.id)
order by score desc
limit match_count;
$$;

revoke execute on function public.hybrid_search from anon;
grant execute on function public.hybrid_search to authenticated;
