-- Double.net database setup
-- Run this once in Supabase: Dashboard -> SQL Editor -> New query -> paste all of this -> Run

-- ============================================================
-- TABLES
-- ============================================================

create table if not exists profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  username text unique not null,
  email text not null,
  avatar_url text,
  country text,
  bio text,
  is_admin boolean not null default false,
  verified boolean not null default false,
  locked_permanent boolean not null default false,
  locked_until timestamptz,
  created_at timestamptz not null default now()
);

create table if not exists settings (
  id int primary key default 1,
  site_name text not null default 'Double.net',
  tagline text not null default 'Updates from the top, conversation from everyone verified.',
  banner_url text,
  banner_position_y int not null default 50,
  constraint single_row check (id = 1)
);
insert into settings (id) values (1) on conflict (id) do nothing;

create table if not exists forums (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  description text,
  created_at timestamptz not null default now()
);

create table if not exists messages (
  id uuid primary key default gen_random_uuid(),
  forum_id uuid not null references forums(id) on delete cascade,
  author_id uuid not null references profiles(id) on delete cascade,
  body text,
  image_url text,
  created_at timestamptz not null default now()
);

create table if not exists official_posts (
  id uuid primary key default gen_random_uuid(),
  author_id uuid not null references profiles(id) on delete cascade,
  title text not null,
  body text not null,
  image_url text,
  pinned boolean not null default false,
  created_at timestamptz not null default now()
);

create table if not exists flags (
  id uuid primary key default gen_random_uuid(),
  author_id uuid references profiles(id) on delete set null,
  room text,
  text text,
  created_at timestamptz not null default now()
);

-- ============================================================
-- HELPER FUNCTIONS (used inside RLS policies below)
-- security definer lets these bypass RLS internally for a single boolean
-- lookup, which avoids recursive-policy problems.
-- ============================================================

create or replace function is_current_user_admin()
returns boolean
language sql
security definer
stable
as $$
  select coalesce((select is_admin from profiles where id = auth.uid()), false);
$$;

create or replace function can_post_messages()
returns boolean
language sql
security definer
stable
as $$
  select coalesce((select (verified or is_admin) from profiles where id = auth.uid()), false);
$$;

-- ============================================================
-- ROW LEVEL SECURITY
-- ============================================================

alter table profiles enable row level security;
alter table settings enable row level security;
alter table forums enable row level security;
alter table messages enable row level security;
alter table official_posts enable row level security;
alter table flags enable row level security;

-- profiles: everyone can read (needed for People search, message sender
-- lookups, public profile pages); you can edit your own row; admins can
-- edit or remove anyone else's.
create policy "profiles are publicly readable" on profiles for select using (true);
create policy "users can insert their own profile" on profiles for insert with check (auth.uid() = id);
create policy "users can update own profile, admins can update any" on profiles for update
  using (auth.uid() = id or is_current_user_admin());
create policy "admins can delete profiles" on profiles for delete using (is_current_user_admin());

-- settings: publicly readable, only admins can change site name/tagline/banner
create policy "settings are publicly readable" on settings for select using (true);
create policy "admins can update settings" on settings for update using (is_current_user_admin());

-- forums: publicly readable, only admins manage the list of rooms
create policy "forums are publicly readable" on forums for select using (true);
create policy "admins manage forums" on forums for insert with check (is_current_user_admin());
create policy "admins update forums" on forums for update using (is_current_user_admin());
create policy "admins delete forums" on forums for delete using (is_current_user_admin());

-- messages: publicly readable; only verified members or admins can post
create policy "messages are publicly readable" on messages for select using (true);
create policy "verified members can post messages" on messages for insert
  with check (auth.uid() = author_id and can_post_messages());
create policy "admins can delete messages" on messages for delete using (is_current_user_admin());

-- official posts: publicly readable, only admins post/edit/delete
create policy "official posts are publicly readable" on official_posts for select using (true);
create policy "admins post official updates" on official_posts for insert with check (is_current_user_admin());
create policy "admins update official posts" on official_posts for update using (is_current_user_admin());
create policy "admins delete official posts" on official_posts for delete using (is_current_user_admin());

-- flags (reported messages): only admins can read or dismiss; any signed-in
-- user's client can file one (this happens automatically when the app's
-- profanity filter blocks a message)
create policy "admins read flags" on flags for select using (is_current_user_admin());
create policy "signed in users can file a flag" on flags for insert with check (auth.uid() is not null);
create policy "admins dismiss flags" on flags for delete using (is_current_user_admin());

-- ============================================================
-- STORAGE (profile photos, banners, chat images)
-- ============================================================

insert into storage.buckets (id, name, public)
values ('photos', 'photos', true)
on conflict (id) do nothing;

create policy "anyone can view photos" on storage.objects for select using (bucket_id = 'photos');
create policy "signed in users can upload photos" on storage.objects for insert
  with check (bucket_id = 'photos' and auth.uid() is not null);
