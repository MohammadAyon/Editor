-- Run this in the Supabase SQL editor.
create table if not exists public.presets (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  client_name text,
  page jsonb not null,
  elements jsonb not null,
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
  created_at timestamptz not null default now()
);

create table if not exists public.brand_images (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  image_url text not null,
  created_at timestamptz not null default now()
);

alter table public.presets enable row level security;
alter table public.projects enable row level security;
alter table public.brand_images enable row level security;

-- Replace these open policies with authenticated-user policies before production.
drop policy if exists "Public can read presets" on public.presets;
drop policy if exists "Public can create presets" on public.presets;
drop policy if exists "Public can delete presets" on public.presets;
drop policy if exists "Public can read projects" on public.projects;
drop policy if exists "Public can create projects" on public.projects;
drop policy if exists "Public can delete projects" on public.projects;
drop policy if exists "Public can read brand images" on public.brand_images;
drop policy if exists "Public can create brand images" on public.brand_images;
drop policy if exists "Public can delete brand images" on public.brand_images;

create policy "Public can read presets" on public.presets for select using (true);
create policy "Public can create presets" on public.presets for insert with check (true);
create policy "Public can delete presets" on public.presets for delete using (true);

create policy "Public can read projects" on public.projects for select using (true);
create policy "Public can create projects" on public.projects for insert with check (true);
create policy "Public can delete projects" on public.projects for delete using (true);

create policy "Public can read brand images" on public.brand_images for select using (true);
create policy "Public can create brand images" on public.brand_images for insert with check (true);
create policy "Public can delete brand images" on public.brand_images for delete using (true);

insert into storage.buckets (id, name, public)
values ('cover-images', 'cover-images', true)
on conflict (id) do nothing;

drop policy if exists "Public can read cover images" on storage.objects;
drop policy if exists "Public can upload cover images" on storage.objects;
drop policy if exists "Public can delete cover images" on storage.objects;

create policy "Public can read cover images"
on storage.objects for select
using (bucket_id = 'cover-images');

create policy "Public can upload cover images"
on storage.objects for insert
with check (bucket_id = 'cover-images');

create policy "Public can delete cover images"
on storage.objects for delete
using (bucket_id = 'cover-images');
