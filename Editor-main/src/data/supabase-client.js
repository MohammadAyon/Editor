// src/data/supabase-client.js â€” Supabase client, session, raw DB/storage ops
export const db = (typeof window !== 'undefined' && window.SUPABASE_CONFIG && window.supabase)
  ? window.supabase.createClient(window.SUPABASE_CONFIG.url, window.SUPABASE_CONFIG.anonKey)
  : null;

export const COVER_BUCKET = 'cover-images';
export const MAX_UPLOAD_BYTES = 10 * 1024 * 1024;
export const ALLOWED_IMAGE_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/gif']);
export let currentSession  = null;
export let databaseInitRun = 0;

export function setCurrentSession(s)       { currentSession  = s; }
export function incrementDatabaseInitRun() { return ++databaseInitRun; }

export function currentUserId(){
  return currentSession && currentSession.user ? currentSession.user.id : null;
}

export function validateImageFile(file){
  if(!file) return { ok: false, error: 'Choose an image file.' };
  if(!ALLOWED_IMAGE_TYPES.has(file.type)) return { ok: false, error: 'Use a JPG, PNG, WebP, or GIF image.' };
  if(!Number.isFinite(file.size) || file.size <= 0) return { ok: false, error: 'The selected image is empty.' };
  if(file.size > MAX_UPLOAD_BYTES) return { ok: false, error: 'Images must be 10 MB or smaller.' };
  return { ok: true, error: null };
}

function extensionFor(file){
  const byType = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'image/gif': 'gif' };
  if(byType[file.type]) return byType[file.type];
  const ext = file.name && file.name.includes('.') ? file.name.split('.').pop().toLowerCase() : '';
  return /^[a-z0-9]{1,8}$/.test(ext) ? ext : 'png';
}

export function buildCoverImagePath(file, folder, ownerId){
  const userId = ownerId || currentUserId();
  if(!userId) throw new Error('You must be signed in before uploading images.');
  const safeFolder = folder === 'logos' ? 'logos' : 'projects';
  return `${userId}/${safeFolder}/${crypto.randomUUID()}.${extensionFor(file)}`;
}

export async function uploadCoverImage(file, folder){
  const validation = validateImageFile(file);
  if(!validation.ok) throw new Error(validation.error);
  const path = buildCoverImagePath(file, folder);
  const { error } = await db.storage.from(COVER_BUCKET).upload(path, file, { cacheControl:'3600', upsert:false });
  if(error) throw error;
  return path;
}

export async function signedCoverImageUrl(path, expiresInSeconds){
  if(!path || !db) return null;
  const { data, error } = await db.storage.from(COVER_BUCKET).createSignedUrl(path, expiresInSeconds || 60 * 60);
  if(error){ console.warn('Could not sign image URL', error); return null; }
  return data.signedUrl;
}

export async function deleteCoverImage(path){
  if(!path) return;
  try{ await db.storage.from(COVER_BUCKET).remove([path]); }
  catch(err){ console.warn('Could not delete stored image', err); }
}

export function presetFromRow(row){
  return { id: row.id, name: row.name, clientName: row.client_name || '', page: row.page, elements: row.elements };
}
export function presetToRow(preset){
  return { name: preset.name, client_name: preset.clientName || null, page: preset.page, elements: preset.elements, owner_id: currentUserId() };
}
export function brandImageFromRow(row){
  return { id: row.id, dbId: row.id, name: row.name, storagePath: row.image_url, dataUrl: null };
}
export function projectFromRow(row){
  return {
    id: row.id, dbId: row.id, projectName: row.project_name, location: row.location,
    clientName: row.client_name, projectImage: null, projectImagePath: row.project_image_url,
    presetId: row.preset_id, presetName: row.preset_name,
    presetSnapshot: row.preset_snapshot, createdAt: row.created_at
  };
}
