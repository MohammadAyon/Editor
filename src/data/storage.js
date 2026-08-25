// src/data/storage.js â€” localStorage cache helpers
export const LS_KEYS = {
  presets:     'coverGenerator:presets',
  brandImages: 'coverGenerator:brandImages',
  projects:    'coverGenerator:projects'
};

export function loadFromStorage(key){
  try{ const raw = localStorage.getItem(key); return raw ? JSON.parse(raw) : null; }
  catch(err){ console.warn('Could not read', key, err); return null; }
}

export function saveToStorage(key, value){
  try{ localStorage.setItem(key, JSON.stringify(value)); return true; }
  catch(err){ console.warn('Could not save', key, err); return false; }
}
