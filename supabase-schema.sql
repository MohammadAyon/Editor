-- Run this in the Supabase SQL editor.
create table if not exists public.presets (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  client_name text,
  page jsonb not null,
  elements jsonb not null,
  owner_id uuid not null references auth.users(id),
  created_at timestamptz not null default now()
);

create table if not exists public.projects (
  id uuid primary key default gen_random_uuid(),
  project_name text not null,
  location text,
  client_name text,
  preset_id uuid references public.presets(id) on delete set null,
  preset_name text not null,
  preset_snapshot jsonb not null,
  project_image_url text,
  owner_id uuid not null references auth.users(id),
  created_at timestamptz not null default now()
);

create table if not exists public.brand_images (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  image_url text not null,
  owner_id uuid not null references auth.users(id),
  created_at timestamptz not null default now()
);

alter table public.presets enable row level security;
alter table public.projects enable row level security;
alter table public.brand_images enable row level security;

-- Existing installations: add these columns, backfill them to each studio
-- account in the dashboard, then set them NOT NULL before applying policies.
alter table public.presets add column if not exists owner_id uuid references auth.users(id);
alter table public.projects add column if not exists owner_id uuid references auth.users(id);
alter table public.brand_images add column if not exists owner_id uuid references auth.users(id);

drop policy if exists "Public can read presets" on public.presets;
drop policy if exists "Public can create presets" on public.presets;
drop policy if exists "Public can delete presets" on public.presets;
drop policy if exists "Public can read projects" on public.projects;
drop policy if exists "Public can create projects" on public.projects;
drop policy if exists "Public can delete projects" on public.projects;
drop policy if exists "Public can read brand images" on public.brand_images;
drop policy if exists "Public can create brand images" on public.brand_images;
drop policy if exists "Public can delete brand images" on public.brand_images;
drop policy if exists "Authenticated can read presets" on public.presets;
drop policy if exists "Authenticated can create presets" on public.presets;
drop policy if exists "Authenticated can update presets" on public.presets;
drop policy if exists "Authenticated can delete presets" on public.presets;
drop policy if exists "Authenticated can read projects" on public.projects;
drop policy if exists "Authenticated can create projects" on public.projects;
drop policy if exists "Authenticated can update projects" on public.projects;
drop policy if exists "Authenticated can delete projects" on public.projects;
drop policy if exists "Authenticated can read brand images" on public.brand_images;
drop policy if exists "Authenticated can create brand images" on public.brand_images;
drop policy if exists "Authenticated can delete brand images" on public.brand_images;

drop policy if exists "Public can read presets" on public.presets;
drop policy if exists "Public can create presets" on public.presets;
drop policy if exists "Public can delete presets" on public.presets;
drop policy if exists "Public can read projects" on public.projects;
drop policy if exists "Public can create projects" on public.projects;
drop policy if exists "Public can delete projects" on public.projects;
drop policy if exists "Public can read brand images" on public.brand_images;
drop policy if exists "Public can create brand images" on public.brand_images;
drop policy if exists "Public can delete brand images" on public.brand_images;

create policy "Authenticated can read presets" on public.presets for select using (auth.role() = 'authenticated');
create policy "Authenticated can create presets" on public.presets for insert with check (auth.role() = 'authenticated' and owner_id = auth.uid());
create policy "Authenticated can update presets" on public.presets for update using (auth.role() = 'authenticated') with check (auth.role() = 'authenticated');
create policy "Authenticated can delete presets" on public.presets for delete using (auth.role() = 'authenticated');

create policy "Authenticated can read projects" on public.projects for select using (auth.role() = 'authenticated');
create policy "Authenticated can create projects" on public.projects for insert with check (auth.role() = 'authenticated' and owner_id = auth.uid());
create policy "Authenticated can update projects" on public.projects for update using (auth.role() = 'authenticated') with check (auth.role() = 'authenticated');
create policy "Authenticated can delete projects" on public.projects for delete using (auth.role() = 'authenticated');

create policy "Authenticated can read brand images" on public.brand_images for select using (auth.role() = 'authenticated');
create policy "Authenticated can create brand images" on public.brand_images for insert with check (auth.role() = 'authenticated' and owner_id = auth.uid());
create policy "Authenticated can delete brand images" on public.brand_images for delete using (auth.role() = 'authenticated');

insert into storage.buckets (id, name, public)
values ('cover-images', 'cover-images', false)
on conflict (id) do nothing;
update storage.buckets set public = false where id = 'cover-images';

drop policy if exists "Public can read cover images" on storage.objects;
drop policy if exists "Public can upload cover images" on storage.objects;
drop policy if exists "Public can delete cover images" on storage.objects;
drop policy if exists "Authenticated can read cover images" on storage.objects;
drop policy if exists "Authenticated can upload cover images" on storage.objects;
drop policy if exists "Authenticated can delete cover images" on storage.objects;

create policy "Authenticated can read cover images"
on storage.objects for select
using (bucket_id = 'cover-images' and auth.role() = 'authenticated');

create policy "Authenticated can upload cover images"
on storage.objects for insert
with check (bucket_id = 'cover-images' and auth.role() = 'authenticated');

create policy "Authenticated can delete cover images"
on storage.objects for delete
using (bucket_id = 'cover-images' and auth.role() = 'authenticated');
