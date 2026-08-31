import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

const root = new URL('../', import.meta.url);
const read = path => readFileSync(new URL(path, root), 'utf8');

test('HTML uses a strict script CSP with no inline event attributes', () => {
  const html = read('index.html');

  assert.doesNotMatch(html, /script-src[^"]*'unsafe-inline'/);
  assert.doesNotMatch(html, /\s(?:onclick|oninput|onchange|onsubmit)=/);
});

test('source-rendered markup does not create inline event attributes', () => {
  for(const path of [
    'src/brands/brands.js',
    'src/inspector/inspector.js',
    'src/presets/presets.js',
    'src/projects/projects.js',
    'src/template-io.js'
  ]){
    assert.doesNotMatch(read(path), /\b(?:onclick|oninput|onchange|onsubmit)=/);
  }
});

test('database and storage policies are scoped to the current owner', () => {
  const sql = read('supabase-schema.sql');

  for(const table of ['presets', 'projects', 'brand_images']){
    assert.match(sql, new RegExp(`on public\\.${table} for select using \\(owner_id = auth\\.uid\\(\\)\\)`, 'i'));
    assert.match(sql, new RegExp(`on public\\.${table} for update using \\(owner_id = auth\\.uid\\(\\)\\) with check \\(owner_id = auth\\.uid\\(\\)\\)`, 'i'));
    assert.match(sql, new RegExp(`on public\\.${table} for delete using \\(owner_id = auth\\.uid\\(\\)\\)`, 'i'));
  }

  assert.match(sql, /storage\.foldername\(name\)\[1\] = auth\.uid\(\)::text/i);
});
