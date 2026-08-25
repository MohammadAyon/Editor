// src/state/state.js â€” shared application state, pure helpers, undo/redo
import { loadFromStorage, LS_KEYS } from '../data/storage.js';

// ---------- ID counter ----------
export let idCounter = 1;
export function newId(prefix){ return prefix + '_' + (idCounter++); }
export function advanceIdCounter(elements){
  (elements || []).forEach(el => {
    const match = String(el.id || '').match(/_(\d+)$/);
    if(match) idCounter = Math.max(idCounter, Number(match[1]) + 1);
  });
}

// ---------- page sizes ----------
export const PAGE_SIZES = { A4: { w:210, h:297 }, A3: { w:297, h:420 } };

// ---------- editor state ----------
export const state = {
  page: { size:'A4', orientation:'portrait', width:210, height:297 },
  zoom: 1,
  data: { projectName:'Midnight Bloom', location:'Dhaka, Bangladesh', clientName:'John Smith' },
  elements: [
    { id:'el_image',    type:'image', role:'photo', field:'projectImage', x:20, y:20,  width:170, height:170 },
    { id:'el_divider',  type:'line',  x:20, y:200, width:170, height:0 },
    { id:'el_title',    type:'text',  field:'projectName', prefix:'',            x:20, y:208, width:170, height:14, fontSize:30, weight:500, align:'center', variant:'display' },
    { id:'el_location', type:'text',  field:'location',    prefix:'Location â€” ', x:20, y:228, width:170, height:8,  fontSize:10, weight:500, align:'left',   variant:'label' },
    { id:'el_client',   type:'text',  field:'clientName',  prefix:'Client â€” ',   x:20, y:240, width:170, height:8,  fontSize:10, weight:500, align:'left',   variant:'label' }
  ],
  selectedIds: new Set()
};

// ---------- data collections (source of truth after db load) ----------
export let presets     = loadFromStorage(LS_KEYS.presets)     || [];
export let brandImages = loadFromStorage(LS_KEYS.brandImages) || [];
export let projects    = loadFromStorage(LS_KEYS.projects)    || [];

export function setPresets(val)     { presets     = val; }
export function setBrandImages(val) { brandImages = val; }
export function setProjects(val)    { projects    = val; }

// ---------- create-project state ----------
export let editingPresetId = null;
export let createZoom      = 1;
export const createData = {
  projectName: 'Riverside Residence',
  location:    'Chattogram, Bangladesh',
  clientName:  'John Smith',
  projectImage:     null,
  projectImageFile: null
};

export function setEditingPresetId(val) { editingPresetId = val; }
export function setCreateZoom(val)      { createZoom      = val; }

// ---------- interaction state ----------
export let interaction       = null;
export let suppressClick     = false;
export let guideVEl          = null;
export let guideHEl          = null;
export let undoStack         = [];
export let redoStack         = [];
export let lastEditKey       = null;
export let lastEditTime      = 0;
export let konvaStage        = null;
export let konvaLayer        = null;
export let konvaGuideLayer   = null;
export let konvaTransformer  = null;
export let konvaDragState    = null;
export let konvaMarqueeState = null;

export function setInteraction(val)       { interaction       = val; }
export function setSuppressClick(val)     { suppressClick     = val; }
export function setGuideVEl(val)          { guideVEl          = val; }
export function setGuideHEl(val)          { guideHEl          = val; }
export function setKonvaStage(val)        { konvaStage        = val; }
export function setKonvaLayer(val)        { konvaLayer        = val; }
export function setKonvaGuideLayer(val)   { konvaGuideLayer   = val; }
export function setKonvaTransformer(val)  { konvaTransformer  = val; }
export function setKonvaDragState(val)    { konvaDragState    = val; }
export function setKonvaMarqueeState(val) { konvaMarqueeState = val; }

// ---------- pure helpers ----------
export function getEl(id)         { return state.elements.find(e => e.id === id); }
export function clamp(v, min, max){ return Math.max(min, Math.min(max, v)); }
export function round1(v)         { return Math.round(v * 10) / 10; }
export function heightOf(el)      { return el.type === 'line' ? 0 : el.height; }
export function escapeHtml(s){ return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#39;'); }
export function sanitizeImageSrc(src){
  if(typeof src !== 'string' || !src) return null;
  if(/^data:image\//i.test(src) || /^blob:/i.test(src) || /^https:\/\//i.test(src)) return src;
  return null;
}

// ---------- undo / redo ----------
export function pushUndo(){
  undoStack.push(JSON.stringify({ page: state.page, elements: state.elements }));
  if(undoStack.length > 60) undoStack.shift();
  redoStack.length = 0;
  refreshUndoRedoButtons();
}
export function pushUndoDebounced(key){
  const now = Date.now();
  if(key === lastEditKey && now - lastEditTime < 800){ lastEditTime = now; return; }
  pushUndo();
  lastEditKey = key; lastEditTime = now;
}
// restoreEditorSnapshot only touches state â€” callers must call syncPageConfig + render
export function restoreEditorSnapshot(snapshot){
  const parsed = JSON.parse(snapshot);
  state.elements = Array.isArray(parsed) ? parsed : parsed.elements;
  if(!Array.isArray(parsed) && parsed.page) state.page = parsed.page;
  advanceIdCounter(state.elements);
  state.selectedIds = new Set([...state.selectedIds].filter(id => getEl(id)));
}
export function undo(){
  if(!undoStack.length) return;
  const snap = undoStack.pop();
  redoStack.push(JSON.stringify({ page: state.page, elements: state.elements }));
  restoreEditorSnapshot(snap);
  refreshUndoRedoButtons();
  // window.syncPageConfig is set by main.js to sync page-config UI after state restore
  if(window.syncPageConfig) window.syncPageConfig();
  if(window.render) window.render();
}
export function redo(){
  if(!redoStack.length) return;
  const snap = redoStack.pop();
  undoStack.push(JSON.stringify({ page: state.page, elements: state.elements }));
  restoreEditorSnapshot(snap);
  refreshUndoRedoButtons();
  if(window.syncPageConfig) window.syncPageConfig();
  if(window.render) window.render();
}
export function refreshUndoRedoButtons(){
  if(typeof document === 'undefined') return;
  const u = document.getElementById('btnUndo'), r = document.getElementById('btnRedo');
  if(u) u.disabled = undoStack.length === 0;
  if(r) r.disabled = redoStack.length === 0;
}
