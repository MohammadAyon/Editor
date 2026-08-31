// src/data/storage.js â€” localStorage cache helpers
export const LS_KEYS = {
  presets:     'coverGenerator:presets',
  brandImages: 'coverGenerator:brandImages',
  projects:    'coverGenerator:projects',
  debugMode:   'coverGenerator:debugMode',
  activeTab:   'coverGenerator:activeTab'
};

export function loadFromStorage(key){
  if(typeof localStorage === 'undefined') return null;
  try{ const raw = localStorage.getItem(key); return raw ? JSON.parse(raw) : null; }
  catch(err){ console.warn('Could not read', key, err); return null; }
}

export function saveToStorage(key, value){
  if(typeof localStorage === 'undefined') return false;
  try{ localStorage.setItem(key, JSON.stringify(value)); return true; }
  catch(err){ console.warn('Could not save', key, err); return false; }
}

export function toCacheSafeProjects(items){
  return (items || []).map(project => ({
    ...project,
    projectImage: project.projectImagePath ? null : project.projectImage
  }));
}

export function toCacheSafeBrandImages(items){
  return (items || []).map(image => ({
    ...image,
    dataUrl: image.storagePath ? null : image.dataUrl
  }));
}
