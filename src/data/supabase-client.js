// src/data/supabase-client.js â€” Supabase client, session, raw DB/storage ops
export const db = (typeof window !== 'undefined' && window.SUPABASE_CONFIG && window.supabase)
  ? window.supabase.createClient(window.SUPABASE_CONFIG.url, window.SUPABASE_CONFIG.anonKey)
  : null;

export const COVER_BUCKET = 'cover-images';
export let currentSession  = null;
export let databaseInitRun = 0;

export function setCurrentSession(s)       { currentSession  = s; }
export function incrementDatabaseInitRun() { return ++databaseInitRun; }

export function currentUserId(){
  return currentSession && currentSession.user ? currentSession.user.id : null;
}

export async function uploadCoverImage(file, folder){
  const ext = file.name && file.name.includes('.') ? file.name.split('.').pop() : 'png';
  const path = `${folder}/${crypto.randomUUID()}.${ext}`;
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
