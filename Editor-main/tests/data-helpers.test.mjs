import assert from 'node:assert/strict';
import { test } from 'node:test';

import * as supabaseClient from '../src/data/supabase-client.js';
import * as storage from '../src/data/storage.js';

test('cover image upload paths are prefixed by owner id', () => {
  assert.equal(typeof supabaseClient.buildCoverImagePath, 'function');

  const path = supabaseClient.buildCoverImagePath(
    { name: 'Cover.Photo.Final.JPG', type: 'image/jpeg', size: 1024 },
    'projects',
    '11111111-1111-1111-1111-111111111111'
  );

  assert.match(path, /^11111111-1111-1111-1111-111111111111\/projects\/[0-9a-f-]+\.jpg$/);
});

test('image upload validation rejects unsafe files before storage upload', () => {
  assert.equal(typeof supabaseClient.validateImageFile, 'function');

  assert.deepEqual(
    supabaseClient.validateImageFile({ name: 'cover.png', type: 'image/png', size: 1024 }),
    { ok: true, error: null }
  );
  assert.equal(
    supabaseClient.validateImageFile({ name: 'notes.txt', type: 'text/plain', size: 1024 }).ok,
    false
  );
  assert.equal(
    supabaseClient.validateImageFile({ name: 'huge.jpg', type: 'image/jpeg', size: 11 * 1024 * 1024 }).ok,
    false
  );
});

test('cache serialization drops transient signed urls and stored data urls', () => {
  assert.equal(typeof storage.toCacheSafeProjects, 'function');
  assert.equal(typeof storage.toCacheSafeBrandImages, 'function');

  const projects = storage.toCacheSafeProjects([
    {
      id: 'project_1',
      projectName: 'Stored',
      projectImagePath: 'owner/projects/photo.jpg',
      projectImage: 'https://example.supabase.co/signed'
    },
    {
      id: 'project_2',
      projectName: 'Local only',
      projectImage: 'data:image/png;base64,abc'
    }
  ]);
  const brands = storage.toCacheSafeBrandImages([
    {
      id: 'brand_1',
      name: 'Logo',
      storagePath: 'owner/logos/logo.png',
      dataUrl: 'https://example.supabase.co/signed'
    },
    {
      id: 'brand_2',
      name: 'Local Logo',
      dataUrl: 'data:image/png;base64,xyz'
    }
  ]);

  assert.equal(projects[0].projectImage, null);
  assert.equal(projects[1].projectImage, 'data:image/png;base64,abc');
  assert.equal(brands[0].dataUrl, null);
  assert.equal(brands[1].dataUrl, 'data:image/png;base64,xyz');
});
