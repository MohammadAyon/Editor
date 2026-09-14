// src/data/storage.js — localStorage cache helpers
export const LS_KEYS = {
  presets:     'coverGenerator:presets',
  brandImages: 'coverGenerator:brandImages',
  projects:    'coverGenerator:projects',
  debugMode:   'coverGenerator:debugMode'
};

export function withFallback(value, fallback){
  return value === undefined || value === null ? fallback : value;
}

export function normalizeStoredList(value){
  return Array.isArray(value) ? value : [];
}

export function loadFromStorage(key, options = {}){
  const fallback = options.fallback ?? null;
  if(typeof localStorage === 'undefined') return fallback;
  try{
    const raw = localStorage.getItem(key);
    if(!raw) return fallback;
    const parsed = JSON.parse(raw);
    return withFallback(parsed, fallback);
  }
  catch(err){
    console.warn('Could not read', key, err);
    return fallback;
  }
}

export function saveToStorage(key, value){
  if(typeof localStorage === 'undefined') return false;
  try{ localStorage.setItem(key, JSON.stringify(value)); return true; }
  catch(err){ console.warn('Could not save', key, err); return false; }
}