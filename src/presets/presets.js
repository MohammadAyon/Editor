// src/presets/presets.js — Preset file save, load, update, delete, and list management
import { state, presets, setPresets, editingPresetId, setEditingPresetId, newId, advanceIdCounter, undoStack, redoStack, escapeHtml } from '../state/state.js';
import { db, presetToRow, presetFromRow, signedCoverImageUrl } from '../data/supabase-client.js';
import { saveToStorage, LS_KEYS } from '../data/storage.js';
import { syncPageConfig } from '../page-config.js';

// Strip large proxy blobs from image elements that have a permanent Supabase path,
// so they don't pollute localStorage or the DB preset snapshot.
export function stripProxiesForPresetStorage(elements){
  return elements.map(el => {
    if(el.type !== 'image' || !el.originalPath) return el;
    const stripped = { ...el };
    delete stripped.src;
    delete stripped.printSrc;
    return stripped;
  });
}

// Hydrate image elements that were stripped: fetch a fresh signed URL into el.src.
export async function hydratePresetElements(elements){
  await Promise.all(
    elements.filter(el => el.type === 'image' && el.originalPath && !el.src).map(async el => {
      try{ el.src = await signedCoverImageUrl(el.originalPath); }
      catch(err){ console.warn('Could not hydrate image element', el.id, err); }
    })
  );
}

export function loadedPresetHasChanges(){
  const preset = presets.find(item => item.id === editingPresetId);
  if(!preset) return false;
  return JSON.stringify({ clientName: preset.clientName || '', page: preset.page, elements: preset.elements }) !==
    JSON.stringify({ clientName: state.data.clientName || '', page: state.page, elements: state.elements });
}

export function renderPresetSaveState(){
  const button = document.getElementById('savePresetChangesBtn');
  const status = document.getElementById('presetEditStatus');
  const preset = presets.find(item => item.id === editingPresetId);
  if(!button || !status) return;
  if(!preset){
    button.disabled = true;
    status.textContent = 'Load a saved preset to edit and save it.';
    return;
  }
  const dirty = loadedPresetHasChanges();
  button.disabled = !dirty;
  status.textContent = dirty
    ? `Unsaved changes to “${preset.name}”.`
    : `Editing “${preset.name}” — all changes are saved.`;
}

export function seedDefaultPreset(){
  presets.push({
    id: newId('preset'),
    name: 'A4 Architecture Cover',
    clientName: state.data.clientName,
    page: JSON.parse(JSON.stringify(state.page)),
    elements: JSON.parse(JSON.stringify(state.elements))
  });
}

export async function saveCurrentAsPreset(){
  if(presets.length >= 10){
    alert('You have reached the maximum limit of 10 presets. Please delete an existing preset to save a new one.');
    return;
  }
  const name = prompt('Name this preset:', 'Untitled preset');
  if(!name) return;
  const preset = {
    id: newId('preset'),
    name,
    clientName: state.data.clientName,
    page: JSON.parse(JSON.stringify(state.page)),
    elements: stripProxiesForPresetStorage(JSON.parse(JSON.stringify(state.elements)))
  };
  if(db){
    try{
      const { data, error } = await db.from('presets').insert(presetToRow(preset)).select().single();
      if(error) throw error;
      preset.id = data.id;
    }catch(err){
      alert('Could not save this preset to the database, so it will only exist on this device: ' + err.message);
    }
  }
  presets.push(preset);
  setEditingPresetId(preset.id);
  saveToStorage(LS_KEYS.presets, presets);
  renderSavedPresetsList();
  refreshPresetSelect();
  const sel = document.getElementById('cpPresetSelect');
  if(sel) sel.value = String(presets.length - 1);
  if(window.renderCreatePreview) window.renderCreatePreview();
  renderPresetSaveState();
  alert(`Saved "${name}" — it's now selectable on the Create project tab.`);
}

export async function loadPresetForEditing(id){
  const preset = presets.find(item => item.id === id);
  if(!preset) return;
  setEditingPresetId(preset.id);
  state.page = JSON.parse(JSON.stringify(preset.page));
  state.elements = JSON.parse(JSON.stringify(preset.elements));
  advanceIdCounter(state.elements);
  state.data.clientName = preset.clientName || state.data.clientName;
  const clientNameInput = document.getElementById('data-clientName');
  if(clientNameInput) clientNameInput.value = state.data.clientName;
  state.selectedIds = new Set();
  undoStack.length = 0;
  redoStack.length = 0;
  syncPageConfig();
  if(window.render) window.render();
  if(window.switchTab) window.switchTab('editor');
  renderSavedPresetsList();
  await hydratePresetElements(state.elements);
  if(window.render) window.render();
}

export async function updateLoadedPreset(){
  const preset = presets.find(item => item.id === editingPresetId);
  if(!preset) return;
  const updated = {
    ...preset,
    clientName: state.data.clientName,
    page: JSON.parse(JSON.stringify(state.page)),
    elements: stripProxiesForPresetStorage(JSON.parse(JSON.stringify(state.elements)))
  };
  if(db){
    const { error } = await db.from('presets').update(presetToRow(updated)).eq('id', preset.id);
    if(error){ alert('Could not update this preset: ' + error.message); return; }
  }
  const index = presets.findIndex(item => item.id === preset.id);
  if(index >= 0) presets[index] = updated;
  saveToStorage(LS_KEYS.presets, presets);
  renderSavedPresetsList();
  refreshPresetSelect();
  if(window.renderCreatePreview) window.renderCreatePreview();
  renderPresetSaveState();
  alert(`Updated "${updated.name}".`);
}

export async function deletePreset(id){
  setPresets(presets.filter(p => p.id !== id));
  saveToStorage(LS_KEYS.presets, presets);
  renderSavedPresetsList();
  refreshPresetSelect();
  if(window.renderCreatePreview) window.renderCreatePreview();
  if(db){
    const { error } = await db.from('presets').delete().eq('id', id);
    if(error) console.warn('Could not delete preset from the database', error);
  }
  if(editingPresetId === id) setEditingPresetId(null);
  renderPresetSaveState();
}

export function renderSavedPresetsList(){
  const box = document.getElementById('savedPresetsList');
  if(!box) return;
  box.innerHTML = presets.map(p => `
    <div class="brand-row">
      <span class="brand-name">${escapeHtml(p.name)}${p.clientName ? ` · ${escapeHtml(p.clientName)}` : ''}</span>
      <button class="btn tiny" onclick="loadPresetForEditing('${p.id}')">Edit</button>
      <button class="btn tiny danger" onclick="deletePreset('${p.id}')">Remove</button>
    </div>`).join('');
}

export function refreshPresetSelect(){
  const sel = document.getElementById('cpPresetSelect');
  if(!sel) return;
  const prev = sel.value;
  sel.innerHTML = presets.map((p,i) => `<option value="${i}">${escapeHtml(p.name)}</option>`).join('');
  if(presets.length){ sel.value = prev && Number(prev) < presets.length ? prev : '0'; }
}

export function getSelectedPreset(){
  const sel = document.getElementById('cpPresetSelect');
  const i = sel ? parseInt(sel.value, 10) : 0;
  return presets[i] || presets[0] || null;
}
