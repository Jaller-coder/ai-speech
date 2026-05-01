-- 在 Supabase 控制台 → SQL Editor 中执行本文件，创建与灵芽口播助手后端对应的表与策略。
-- 若使用「service_role」密钥仅跑在自有服务器上，可酌情关闭 RLS 或收紧策略。

create table if not exists public.topics (
  id text primary key,
  list_seq bigint,
  platform text not null default '小红书',
  status text not null default '待拍',
  topic text not null default '',
  hook text not null default '',
  body text not null default '',
  ending_cta text not null default '',
  cover_title text not null default '',
  body_title text not null default '',
  search_keywords jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_topics_updated_at on public.topics (updated_at desc);
create index if not exists idx_topics_list_seq on public.topics (list_seq);

create table if not exists public.app_settings (
  id smallint primary key check (id = 1),
  platform text not null default '小红书',
  persona_name text not null default '',
  audience_profile text not null default '',
  tone_style text not null default '朋友式共鸣',
  tone_details text not null default '',
  hook_style text not null default '',
  body_framework text not null default '',
  cta_template text not null default '',
  risk_blacklist text not null default '',
  cover_title_style text not null default '',
  body_title_style text not null default '',
  api_key text not null default '',
  updated_at timestamptz not null default now()
);

create table if not exists public.generation_logs (
  id text primary key,
  task text not null default '',
  source text not null default 'mock',
  model text not null default '',
  batch_size integer not null default 0,
  latency_ms integer not null default 0,
  request_payload jsonb not null default '{}'::jsonb,
  response_payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists idx_generation_logs_created on public.generation_logs (created_at desc);

-- 使用 anon 密钥时建议开启策略；使用 service_role 且仅服务端调用时可跳过或改为更严规则。
alter table public.topics enable row level security;
alter table public.app_settings enable row level security;
alter table public.generation_logs enable row level security;

drop policy if exists "topics_allow_all" on public.topics;
create policy "topics_allow_all" on public.topics for all using (true) with check (true);

drop policy if exists "app_settings_allow_all" on public.app_settings;
create policy "app_settings_allow_all" on public.app_settings for all using (true) with check (true);

drop policy if exists "generation_logs_allow_all" on public.generation_logs;
create policy "generation_logs_allow_all" on public.generation_logs for all using (true) with check (true);

-- 若表早已建好、仅需把新行默认状态改为「待拍」，可在 SQL Editor 执行：
-- alter table public.topics alter column status set default '待拍';
