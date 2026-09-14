import test from 'node:test';
import assert from 'node:assert/strict';
import { loadFromStorage, normalizeStoredList, withFallback } from '../src/data/storage.js';

const originalStorage = globalThis.localStorage;

test.beforeEach(() => {
  const store = new Map();
  globalThis.localStorage = {
    getItem(key) { return store.has(key) ? store.get(key) : null; },
    setItem(key, value) { store.set(key, String(value)); },
    removeItem(key) { store.delete(key); },
    clear() { store.clear(); }
  };
});

test.afterEach(() => {
  globalThis.localStorage = originalStorage;
});

test('loadFromStorage returns a safe fallback when stored data is malformed', () => {
  globalThis.localStorage.setItem('coverGenerator:test', '{bad json');
  assert.deepEqual(loadFromStorage('coverGenerator:test', { fallback: [] }), []);
});

test('normalizeStoredList converts non-array values into an empty list', () => {
  assert.deepEqual(normalizeStoredList({ not: 'an array' }), []);
  assert.deepEqual(normalizeStoredList([{ ok: true }]), [{ ok: true }]);
});

test('withFallback preserves a valid stored value', () => {
  globalThis.localStorage.setItem('coverGenerator:test', JSON.stringify([{ ok: true }]));
  assert.deepEqual(withFallback(JSON.parse(globalThis.localStorage.getItem('coverGenerator:test')), []), [{ ok: true }]);
});
