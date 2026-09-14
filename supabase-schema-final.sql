-- Final Supabase schema + owner-only RLS for project, preset, and brand data
-- Paste this into the Supabase SQL editor and run it.

create table if not exists public.presets (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  client_name text,
  page jsonb not null,
  elements jsonb not null,
  owner_id uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now()
);

create table if not exists public.projects (
  id uuid primary key default gen_random_uuid(),
  project_name text not null,
  location text,
  client_name text,
  drawing_type text not null default 'ARCHITECTURAL DRAWING',
  preset_id uuid references public.presets(id) on delete set null,
  preset_name text not null,
  preset_snapshot jsonb not null,
  project_image_url text,
  owner_id uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now()
);

create table if not exists public.brand_images (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  image_url text not null,
  owner_id uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now()
);

alter table public.presets enable row level security;
alter table public.projects enable row level security;
alter table public.brand_images enable row level security;

-- Ensure the bucket exists for project and logo uploads.
insert into storage.buckets (id, name, public)
values ('cover-images', 'cover-images', false)
on conflict (id) do nothing;

update storage.buckets
set public = false
where id = 'cover-images';

-- Drop any older broad policies that may exist.
drop policy if exists "users_can_read_own_presets" on public.presets;
drop policy if exists "users_can_insert_own_presets" on public.presets;
drop policy if exists "users_can_update_own_presets" on public.presets;
drop policy if exists "users_can_delete_own_presets" on public.presets;

drop policy if exists "users_can_read_own_projects" on public.projects;
drop policy if exists "users_can_insert_own_projects" on public.projects;
drop policy if exists "users_can_update_own_projects" on public.projects;
drop policy if exists "users_can_delete_own_projects" on public.projects;

drop policy if exists "users_can_read_own_brand_images" on public.brand_images;
drop policy if exists "users_can_insert_own_brand_images" on public.brand_images;
drop policy if exists "users_can_update_own_brand_images" on public.brand_images;
drop policy if exists "users_can_delete_own_brand_images" on public.brand_images;

drop policy if exists "users_can_read_own_cover_images" on storage.objects;
drop policy if exists "users_can_upload_own_cover_images" on storage.objects;
drop policy if exists "users_can_delete_own_cover_images" on storage.objects;

-- Presets: owner-only access
create policy "users_can_read_own_presets"
on public.presets
for select
using (auth.uid() = owner_id);

create policy "users_can_insert_own_presets"
on public.presets
for insert
with check (auth.uid() = owner_id);

create policy "users_can_update_own_presets"
on public.presets
for update
using (auth.uid() = owner_id)
with check (auth.uid() = owner_id);

create policy "users_can_delete_own_presets"
on public.presets
for delete
using (auth.uid() = owner_id);

-- Projects: owner-only access
create policy "users_can_read_own_projects"
on public.projects
for select
using (auth.uid() = owner_id);

create policy "users_can_insert_own_projects"
on public.projects
for insert
with check (auth.uid() = owner_id);

create policy "users_can_update_own_projects"
on public.projects
for update
using (auth.uid() = owner_id)
with check (auth.uid() = owner_id);

create policy "users_can_delete_own_projects"
on public.projects
for delete
using (auth.uid() = owner_id);

-- Brand images: owner-only access
create policy "users_can_read_own_brand_images"
on public.brand_images
for select
using (auth.uid() = owner_id);

create policy "users_can_insert_own_brand_images"
on public.brand_images
for insert
with check (auth.uid() = owner_id);

create policy "users_can_update_own_brand_images"
on public.brand_images
for update
using (auth.uid() = owner_id)
with check (auth.uid() = owner_id);

create policy "users_can_delete_own_brand_images"
on public.brand_images
for delete
using (auth.uid() = owner_id);

-- Storage bucket: private and owner-only access.
create policy "users_can_read_own_cover_images"
on storage.objects
for select
using (
  bucket_id = 'cover-images'
  and (storage.foldername(name))[1] = (auth.uid())::text
);

create policy "users_can_upload_own_cover_images"
on storage.objects
for insert
with check (
  bucket_id = 'cover-images'
  and (storage.foldername(name))[1] = (auth.uid())::text
  and (storage.foldername(name))[2] in ('projects', 'logos', 'elements')
);

create policy "users_can_delete_own_cover_images"
on storage.objects
for delete
using (
  bucket_id = 'cover-images'
  and (storage.foldername(name))[1] = (auth.uid())::text
);
