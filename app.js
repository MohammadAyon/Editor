/*
  Core idea (unchanged): a template schema (page + elements, mm units) is
  the only layout data. elementHTML() renders it into real DOM/CSS, and the
  same markup drives the editor, the Create Project preview, and print.

  v4 adds: localStorage-backed persistence for presets/brand assets/projects
  (this needs a real browser tab, not just the inline preview, to actually
  persist), a brand-asset library for logos separate from project photos,
  and a project record that snapshots which preset made it — so presets and
  projects are traceably connected, and reprints stay faithful even if the
  preset is edited later.
*/

let idCounter = 1;
function newId(prefix){ return prefix + '_' + (idCounter++); }

const PAGE_SIZES = {
  A4: { w:210, h:297 },
  A3: { w:297, h:420 }
};

const LS_KEYS = { presets:'coverGenerator:presets', brandImages:'coverGenerator:brandImages', projects:'coverGenerator:projects' };
function loadFromStorage(key){
  try{ const raw = localStorage.getItem(key); return raw ? JSON.parse(raw) : null; }
  catch(err){ console.warn('Could not read', key, err); return null; }
}
function saveToStorage(key, value){
  try{ localStorage.setItem(key, JSON.stringify(value)); return true; }
  catch(err){ console.warn('Could not save', key, err); return false; }
}

// ---------- Supabase (shared database + storage for presets/brand assets/projects) ----------
// localStorage above now only acts as an offline cache; Supabase is the source of truth.
const db = (window.SUPABASE_CONFIG && window.supabase)
  ? window.supabase.createClient(window.SUPABASE_CONFIG.url, window.SUPABASE_CONFIG.anonKey)
  : null;
const COVER_BUCKET = 'cover-images';
let currentSession = null;
let databaseInitRun = 0;

function currentUserId(){ return currentSession && currentSession.user ? currentSession.user.id : null; }

async function uploadCoverImage(file, folder){
  const ext = file.name && file.name.includes('.') ? file.name.split('.').pop() : 'png';
  const path = `${folder}/${crypto.randomUUID()}.${ext}`;
  const { error } = await db.storage.from(COVER_BUCKET).upload(path, file, { cacheControl:'3600', upsert:false });
  if(error) throw error;
  return path;
}
async function signedCoverImageUrl(path, expiresInSeconds){
  if(!path || !db) return null;
  const { data, error } = await db.storage.from(COVER_BUCKET).createSignedUrl(path, expiresInSeconds || 60 * 60 * 24);
  if(error){ console.warn('Could not sign image URL', error); return null; }
  return data.signedUrl;
}
async function deleteCoverImage(path){
  if(!path) return;
  try{ await db.storage.from(COVER_BUCKET).remove([path]); }
  catch(err){ console.warn('Could not delete stored image', err); }
}

function presetFromRow(row){
  return { id: row.id, name: row.name, clientName: row.client_name || '', page: row.page, elements: row.elements };
}
function presetToRow(preset){
  return { name: preset.name, client_name: preset.clientName || null, page: preset.page, elements: preset.elements, owner_id: currentUserId() };
}
function brandImageFromRow(row){
  return { id: row.id, dbId: row.id, name: row.name, storagePath: row.image_url, dataUrl: null };
}
function projectFromRow(row){
  return {
    id: row.id, dbId: row.id, projectName: row.project_name, location: row.location, clientName: row.client_name,
    projectImage: null, projectImagePath: row.project_image_url, presetId: row.preset_id, presetName: row.preset_name,
    presetSnapshot: row.preset_snapshot, createdAt: row.created_at
  };
}

const state = {
  page: { size:'A4', orientation:'portrait', width: 210, height: 297 },
  zoom: 1,
  data: {
    projectName: 'Midnight Bloom',
    location: 'Dhaka, Bangladesh',
    clientName: 'John Smith'
  },
  elements: [
    { id:'el_image',    type:'image', role:'photo', field:'projectImage', x:20, y:20,  width:170, height:170 },
    { id:'el_divider',  type:'line',  x:20, y:200, width:170, height:0 },
    { id:'el_title',    type:'text',  field:'projectName', prefix:'',            x:20, y:208, width:170, height:14, fontSize:30, weight:500, align:'center', variant:'display' },
    { id:'el_location', type:'text',  field:'location',    prefix:'Location — ', x:20, y:228, width:170, height:8,  fontSize:10, weight:500, align:'left',   variant:'label' },
    { id:'el_client',   type:'text',  field:'clientName',  prefix:'Client — ',   x:20, y:240, width:170, height:8,  fontSize:10, weight:500, align:'left',   variant:'label' }
  ],
  selectedIds: new Set()
};

let presets = loadFromStorage(LS_KEYS.presets) || [];
let brandImages = loadFromStorage(LS_KEYS.brandImages) || [];
let projects = loadFromStorage(LS_KEYS.projects) || [];
let editingPresetId = null;
const createData = { projectName:'Riverside Residence', location:'Chattogram, Bangladesh', clientName:'John Smith', projectImage:null, projectImageFile:null };

let interaction = null;
let suppressClick = false;
let guideVEl = null, guideHEl = null;
let undoStack = [], redoStack = [];
let lastEditKey = null, lastEditTime = 0;
let konvaStage = null, konvaLayer = null, konvaGuideLayer = null, konvaTransformer = null;
let konvaDragState = null;
let konvaMarqueeState = null;

function cancelInteraction(){
  if(interaction && interaction.boxEl) interaction.boxEl.remove();
  if(konvaMarqueeState && konvaMarqueeState.box) konvaMarqueeState.box.remove();
  interaction = null;
  konvaDragState = null;
  konvaMarqueeState = null;
  hideGuideV();
  hideGuideH();
}

function updateKonvaNodePosition(id){
  if(!konvaLayer) return;
  const el = getEl(id);
  const node = el && konvaLayer.findOne('#' + id);
  if(!el || !node) return;
  node.x(mmToPx(el.x + el.width / 2));
  node.y(mmToPx(el.y + heightOf(el) / 2));
}

function updateSelectionOverlayPosition(id){
  const el = getEl(id);
  const overlay = el && document.querySelector(`.selection-overlay[data-id="${id}"]`);
  if(!el || !overlay) return;
  overlay.style.left = el.x + 'mm';
  overlay.style.top = el.y + 'mm';
}

function getStagePointer(nativeEvent){
  if(konvaStage && nativeEvent) konvaStage.setPointersPositions(nativeEvent);
  const pointer = konvaStage && konvaStage.getPointerPosition();
  if(pointer) return pointer;
  const canvas = document.querySelector('.konva-editor-layer canvas');
  const rect = canvas && canvas.getBoundingClientRect();
  if(!rect || !konvaStage) return null;
  return {
    x:(nativeEvent.clientX - rect.left) * konvaStage.width() / rect.width,
    y:(nativeEvent.clientY - rect.top) * konvaStage.height() / rect.height
  };
}

function resizeSnapBox(oldBox, newBox, selectedElement){
  const minWidth = mmToPx(5);
  const minHeight = selectedElement && selectedElement.type === 'line' ? mmToPx(2) : mmToPx(5);
  if(newBox.width < minWidth || newBox.height < minHeight) return oldBox;

  const rotation = Math.abs(Number(selectedElement && selectedElement.rotation) || 0) % 180;
  if(rotation > 0.1 && rotation < 179.9) return newBox;

  const threshold = mmToPx(1.5);
  const selectedId = selectedElement && selectedElement.id;
  const xCandidates = [0, state.page.width].map(mmToPx);
  const yCandidates = [0, state.page.height].map(mmToPx);
  state.elements.forEach(element => {
    if(element.id === selectedId) return;
    xCandidates.push(mmToPx(element.x), mmToPx(element.x + element.width));
    yCandidates.push(mmToPx(element.y), mmToPx(element.y + heightOf(element)));
  });

  const result = { ...newBox };
  const leftAnchored = Math.abs(newBox.x - oldBox.x) > 0.5;
  const topAnchored = Math.abs(newBox.y - oldBox.y) > 0.5;
  const right = newBox.x + newBox.width;
  const bottom = newBox.y + newBox.height;
  const nearest = (value, candidates) => {
    let match = null;
    candidates.forEach(candidate => {
      if(Math.abs(value - candidate) <= threshold && (!match || Math.abs(value - candidate) < Math.abs(value - match))) match = candidate;
    });
    return match;
  };
  const leftSnap = leftAnchored ? nearest(newBox.x, xCandidates) : null;
  const rightSnap = leftAnchored ? null : nearest(right, xCandidates);
  const topSnap = topAnchored ? nearest(newBox.y, yCandidates) : null;
  const bottomSnap = topAnchored ? null : nearest(bottom, yCandidates);
  if(leftSnap != null){ result.width += result.x - leftSnap; result.x = leftSnap; }
  if(rightSnap != null) result.width = rightSnap - result.x;
  if(topSnap != null){ result.height += result.y - topSnap; result.y = topSnap; }
  if(bottomSnap != null) result.height = bottomSnap - result.y;
  if(result.width < minWidth || result.height < minHeight) return oldBox;
  return result;
}

if(location.hostname === 'localhost' || location.hostname === '127.0.0.1'){
  window.getEditorDiagnostics = () => ({
    stageNodes: konvaStage ? Array.from(konvaStage.getChildren()).reduce((count, layer) => count + 1 + layer.getChildren().length, 0) : 0,
    layerCount: konvaStage ? konvaStage.getLayers().length : 0,
    designObjectCount: state.elements.length,
    guideHelperCount: (konvaGuideLayer ? konvaGuideLayer.getChildren().length : 0) + document.querySelectorAll('.marquee-box, .selection-overlay, .selection-bbox').length,
    transformerCount: konvaStage ? konvaStage.find('Transformer').length : 0,
    activeInteraction: interaction ? interaction.mode : null
  });
}

// ---------- page size / orientation ----------
function applyPageCSSVars(){
  document.documentElement.style.setProperty('--page-w', state.page.width + 'mm');
  document.documentElement.style.setProperty('--page-h', state.page.height + 'mm');
}
function updatePrintStyle(width, height){
  width = width || state.page.width; height = height || state.page.height;
  let tag = document.getElementById('dynamicPrintStyle');
  if(!tag){ tag = document.createElement('style'); tag.id = 'dynamicPrintStyle'; document.head.appendChild(tag); }
  tag.textContent = `@page{ size:${width}mm ${height}mm; }`;
}
function updatePageSub(){
  const orientLabel = state.page.orientation === 'landscape' ? 'Landscape' : 'Portrait';
  const sub = document.getElementById('pageSub');
  if(sub) sub.textContent = `${state.page.size} ${orientLabel} · ${state.page.width} × ${state.page.height}mm`;
}
function heightOf(el){ return el.type === 'line' ? 0 : el.height; }
function onPageSizeChange(value){
  const [size, orientation] = value.split('-');
  pushUndo();
  const base = PAGE_SIZES[size];
  const width = orientation === 'landscape' ? base.h : base.w;
  const height = orientation === 'landscape' ? base.w : base.h;
  state.page.size = size;
  state.page.orientation = orientation;
  state.page.width = width;
  state.page.height = height;
  state.elements.forEach(el => {
    el.width = round1(Math.min(el.width, width));
    if(el.type !== 'line') el.height = round1(Math.min(el.height, height));
    el.x = round1(clamp(el.x, 0, width - el.width));
    el.y = round1(clamp(el.y, 0, height - heightOf(el)));
  });
  applyPageCSSVars();
  updatePrintStyle();
  updatePageSub();
  buildRulerLabels();
  render();
  centerZoomedPage();
}
function syncPageSizeSelect(){
  const sel = document.getElementById('pageSizeSelect');
  if(sel) sel.value = state.page.size + '-' + state.page.orientation;
}

// ---------- helpers ----------
function getEl(id){ return state.elements.find(e => e.id === id); }
function clamp(v,min,max){ return Math.max(min, Math.min(max, v)); }
function round1(v){ return Math.round(v*10)/10; }
function escapeHtml(s){ return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#39;'); }
function sanitizeImageSrc(src){
  if(typeof src !== 'string' || !src) return null;
  if(/^data:image\//i.test(src) || /^blob:/i.test(src) || /^https:\/\//i.test(src)) return src;
  return null;
}
function getPxPerMm(){
  const page = document.getElementById('page');
  return page.getBoundingClientRect().width / (state.page.width * state.zoom);
}
function rectFill(el){ return el.fill || '#ffffff'; }
function rectStroke(el){ return el.stroke || '#171614'; }
function lineStroke(el){ return el.stroke || '#171614'; }
function lineWidth(el){ return Number.isFinite(el.strokeWidth) ? el.strokeWidth : 1; }
function updateZoomReadout(){
  const readout = document.getElementById('zoomReadout');
  if(readout) readout.textContent = Math.round(state.zoom * 100) + '%';
}
function syncZoomLayout(){
  const page = document.getElementById('page');
  const frame = page && page.parentElement;
  if(!page || !frame) return;
  frame.style.width = `${16 + page.offsetWidth * state.zoom}px`;
  frame.style.height = `${16 + page.offsetHeight * state.zoom}px`;
}
function centerZoomedPage(){
  const wrapper = document.querySelector('.canvas-wrapper');
  const frame = document.querySelector('.page-frame');
  if(!wrapper || !frame) return;
  const innerWidth = wrapper.clientWidth - 64;
  wrapper.scrollLeft = Math.max(0, (frame.offsetWidth - innerWidth) / 2);
  wrapper.scrollTop = Math.max(0, (frame.offsetHeight - (wrapper.clientHeight - 112)) / 2);
}
function setZoom(value, clientX, clientY){
  const wrapper = document.querySelector('.canvas-wrapper');
  const page = document.getElementById('page');
  if(!wrapper || !page) return;
  const oldZoom = state.zoom;
  state.zoom = clamp(Math.round(value * 20) / 20, 0.25, 4);
  if(state.zoom === oldZoom) return;
  const before = page.getBoundingClientRect();
  const anchorX = clientX == null ? before.left + before.width / 2 : clientX;
  const anchorY = clientY == null ? before.top + before.height / 2 : clientY;
  const localX = (anchorX - before.left) / oldZoom;
  const localY = (anchorY - before.top) / oldZoom;
  page.style.transform = `scale(${state.zoom})`;
  syncZoomLayout();
  const after = page.getBoundingClientRect();
  if(clientX == null && clientY == null){
    centerZoomedPage();
  } else {
    wrapper.scrollLeft += after.left + localX * state.zoom - anchorX;
    wrapper.scrollTop += after.top + localY * state.zoom - anchorY;
  }
  updateZoomReadout();
}
function changeZoom(delta){ setZoom(state.zoom + delta); }
function resetZoom(){ setZoom(1); }
function onCanvasWheel(event){
  if(getActiveTab() !== 'editor') return;
  event.preventDefault();
  setZoom(state.zoom * (event.deltaY < 0 ? 1.1 : 0.9), event.clientX, event.clientY);
}

// ---------- undo / redo ----------
function pushUndo(){
  undoStack.push(JSON.stringify(state.elements));
  if(undoStack.length > 60) undoStack.shift();
  redoStack.length = 0;
  refreshUndoRedoButtons();
}
function pushUndoDebounced(key){
  const now = Date.now();
  if(key === lastEditKey && now - lastEditTime < 800){ lastEditTime = now; return; }
  pushUndo();
  lastEditKey = key; lastEditTime = now;
}
function undo(){
  if(!undoStack.length) return;
  const snap = undoStack.pop();
  redoStack.push(JSON.stringify(state.elements));
  state.elements = JSON.parse(snap);
  state.selectedIds = new Set([...state.selectedIds].filter(id => getEl(id)));
  refreshUndoRedoButtons();
  render();
}
function redo(){
  if(!redoStack.length) return;
  const snap = redoStack.pop();
  undoStack.push(JSON.stringify(state.elements));
  state.elements = JSON.parse(snap);
  state.selectedIds = new Set([...state.selectedIds].filter(id => getEl(id)));
  refreshUndoRedoButtons();
  render();
}
function refreshUndoRedoButtons(){
  const u = document.getElementById('btnUndo'), r = document.getElementById('btnRedo');
  if(u) u.disabled = undoStack.length === 0;
  if(r) r.disabled = redoStack.length === 0;
}

// ---------- rendering (shared by editor + create-project preview) ----------
function resolveImageSrc(el, dataSource){
  if(el.role === 'logo'){
    const brand = brandImages.find(b => b.id === el.logoRef);
    return brand ? sanitizeImageSrc(brand.dataUrl) : null;
  }
  return sanitizeImageSrc(el.field ? ((dataSource || state.data)[el.field] || el.src) : el.src);
}
function elementHTML(el, dataSource){
  dataSource = dataSource || state.data;
  const flip = `scale(${el.flipX ? -1 : 1},${el.flipY ? -1 : 1})`;
  const style = `left:${el.x}mm;top:${el.y}mm;width:${el.width}mm;` + (el.type !== 'line' ? `height:${el.height}mm;` : '') + `opacity:${Number.isFinite(el.opacity) ? el.opacity : 1};transform:rotate(${Number(el.rotation) || 0}deg) ${flip};transform-origin:center;`;
  if(el.type === 'text'){
    const value = el.field ? (dataSource[el.field] || '') : (el.content || '');
    const text = (el.prefix || '') + value;
    const variantClass = el.variant === 'display' ? 'el-text--display' : el.variant === 'label' ? 'el-text--label' : '';
    return `<div class="element el-text ${variantClass}" data-id="${el.id}" style="${style}font-size:${el.fontSize}px;font-weight:${el.weight};text-align:${el.align};">${escapeHtml(text)}</div>`;
  }
  if(el.type === 'image'){
    const src = resolveImageSrc(el, dataSource);
    if(src) return `<div class="element el-image" data-id="${escapeHtml(el.id)}" data-role="${escapeHtml(el.role||'photo')}" style="${style}"><img src="${escapeHtml(src)}" draggable="false"></div>`;
    const label = el.role === 'logo' ? 'Pick a logo in the inspector' : 'Click to add image';
    return `<div class="element el-image el-image-empty" data-id="${el.id}" data-role="${el.role||'photo'}" style="${style}"><span class="no-print">${label}</span></div>`;
  }
  if(el.type === 'line') return `<div class="element el-line" data-id="${el.id}" style="${style}border-top-color:${lineStroke(el)};border-top-width:${lineWidth(el)}px;"></div>`;
  if(el.type === 'rect') return `<div class="element el-rect" data-id="${el.id}" style="${style}"><svg aria-hidden="true" width="100%" height="100%" viewBox="0 0 100 100" preserveAspectRatio="none"><rect x="0" y="0" width="100" height="100" fill="${escapeHtml(rectFill(el))}" stroke="${escapeHtml(rectStroke(el))}" stroke-width="${Number(el.strokeWidth) || 1}" vector-effect="non-scaling-stroke" stroke-linejoin="${el.lineJoin || 'miter'}"></rect></svg></div>`;
  return '';
}

function overlayHTML(){
  const ids = [...state.selectedIds].filter(id => getEl(id));
  if(!ids.length) return '';
  if(ids.length === 1){
    const el = getEl(ids[0]);
    const h = el.type === 'line' ? 2 : el.height;
    return `<div class="selection-overlay no-print" data-id="${el.id}" style="left:${el.x}mm;top:${el.y}mm;width:${el.width}mm;height:${h}mm;">
      <div class="resize-handle" data-id="${el.id}"></div>
    </div>`;
  }
  const elsArr = ids.map(getEl);
  const minX = Math.min(...elsArr.map(e => e.x)), maxX = Math.max(...elsArr.map(e => e.x + e.width));
  const minY = Math.min(...elsArr.map(e => e.y)), maxY = Math.max(...elsArr.map(e => e.y + heightOf(e)));
  let html = `<div class="selection-bbox no-print" style="left:${minX}mm;top:${minY}mm;width:${maxX-minX}mm;height:${maxY-minY}mm;"></div>`;
  elsArr.forEach(el => {
    const h = el.type === 'line' ? 2 : el.height;
    html += `<div class="selection-overlay selection-overlay--multi no-print" data-id="${el.id}" style="left:${el.x}mm;top:${el.y}mm;width:${el.width}mm;height:${h}mm;"></div>`;
  });
  return html;
}

function renderPage(){
  cancelInteraction();
  const page = document.getElementById('page');
  if(konvaStage){ konvaStage.destroy(); konvaStage = null; konvaLayer = null; konvaGuideLayer = null; konvaTransformer = null; }
  page.innerHTML = state.elements.map(el => elementHTML(el)).join('') + overlayHTML();
  page.classList.add('konva-editor-active');
  renderKonva();
  syncZoomLayout();
}

function mmToPx(mm){ return mm * getPxPerMm(); }
function konvaTextValue(el){ return (el.prefix || '') + (el.field ? (state.data[el.field] || '') : (el.content || '')); }
function makeKonvaNode(el){
  const x = mmToPx(el.x), y = mmToPx(el.y), width = mmToPx(el.width), height = mmToPx(el.type === 'line' ? 2 : el.height);
  const visualHeight = height;
  let node;
  if(el.type === 'text'){
    node = new Konva.Text({ text:konvaTextValue(el), x:x + width / 2, y:y + visualHeight / 2, offsetX:width / 2, offsetY:visualHeight / 2, width, height, fontSize:el.fontSize, fontFamily:el.variant === 'display' ? 'Fraunces' : 'Inter', fontStyle:el.weight >= 600 ? 'bold' : 'normal', fill:'#171614', align:el.align, listening:true });
  } else if(el.type === 'line'){
    node = new Konva.Group({ x:x + width / 2, y:y + visualHeight / 2, offsetX:width / 2, offsetY:visualHeight / 2, width, height:visualHeight, listening:true });
    node.add(new Konva.Rect({ x:0, y:-6, width, height:12, fill:'#000000', opacity:0.01, listening:true }));
    node.add(new Konva.Line({ points:[0, 0, width, 0], stroke:lineStroke(el), strokeWidth:lineWidth(el), lineJoin:el.lineJoin || 'miter', listening:false }));
  } else if(el.type === 'rect'){
    node = new Konva.Rect({ x:x + width / 2, y:y + visualHeight / 2, offsetX:width / 2, offsetY:visualHeight / 2, width, height, fill:rectFill(el), stroke:rectStroke(el), strokeWidth:Number(el.strokeWidth) || 1, lineJoin:el.lineJoin || 'miter', listening:true });
  } else {
    node = new Konva.Group({ x:x + width / 2, y:y + visualHeight / 2, offsetX:width / 2, offsetY:visualHeight / 2, width, height, listening:true });
    node.add(new Konva.Rect({ x:0, y:0, width, height, fill:'#EEEBE3', stroke:'#B4B0A4', dash:[4,3], listening:true }));
    const src = resolveImageSrc(el);
    if(src){
      const image = new Image();
      image.onload = () => { node.add(new Konva.Image({ image, width, height, listening:false })); node.getLayer().batchDraw(); };
      image.src = src;
    } else {
      node.add(new Konva.Text({ text:el.role === 'logo' ? 'Pick a logo in the inspector' : 'Click to add image', x:0, y:height / 2 - 7, width, fontSize:10, fill:'#7A776E', align:'center', listening:false }));
    }
  }
  node.id(el.id);
  node.rotation(Number(el.rotation) || 0);
  node.scale({ x:el.flipX ? -1 : 1, y:el.flipY ? -1 : 1 });
  node.opacity(Number.isFinite(el.opacity) ? el.opacity : 1);
  if(typeof node.shadowColor === 'function'){
    node.shadowColor(el.shadowColor || '#171614');
    node.shadowBlur(Number(el.shadowBlur) || 0);
    node.shadowOffset({ x:Number(el.shadowOffsetX) || 0, y:Number(el.shadowOffsetY) || 0 });
    node.shadowOpacity(Number.isFinite(el.shadowOpacity) ? el.shadowOpacity : 0);
  }
  node.draggable(el.type === 'line');
  if(el.type === 'line'){
    node.on('dragmove', event => {
      const position = event.target.position();
      el.x = round1(position.x / getPxPerMm() - el.width / 2);
      el.y = round1(position.y / getPxPerMm() - heightOf(el) / 2);
      updateSchemaView();
    });
    node.on('dragend', () => render());
  }
  const dragStartNode = el.type === 'line' ? node.children[0] : node;
  dragStartNode.on('mousedown', event => {
    const native = event.evt;
    native.stopPropagation();
    event.cancelBubble = true;
    const pointer = getStagePointer(native) || node.position();
    if(native.shiftKey){
      const next = new Set(state.selectedIds);
      if(next.has(el.id)) next.delete(el.id); else next.add(el.id);
      state.selectedIds = next;
    } else if(!state.selectedIds.has(el.id)) state.selectedIds = new Set([el.id]);
    if(el.type === 'line') return;
    render();
    if(!state.selectedIds.has(el.id)) return;
    konvaDragState = { id:el.id, startX:pointer.x, startY:pointer.y, positions:Object.fromEntries([...state.selectedIds].map(id => { const selected = getEl(id); return [id, { x:selected.x, y:selected.y }]; })) };
    pushUndo();
  });
  node.on('dblclick', () => { if(el.type === 'image' && !resolveImageSrc(el)) triggerImageUpload(el.id); });
  return node;
}
function renderKonva(){
  if(!window.Konva) return;
  const page = document.getElementById('page');
  if(!konvaStage){
    const container = document.createElement('div');
    container.className = 'konva-editor-layer no-print';
    page.appendChild(container);
    konvaStage = new Konva.Stage({ container, width:page.clientWidth, height:page.clientHeight });
    konvaLayer = new Konva.Layer();
    konvaGuideLayer = new Konva.Layer({ listening:false });
    konvaStage.add(konvaLayer);
    konvaStage.add(konvaGuideLayer);
    konvaStage.on('mousedown', event => {
      if(event.target !== konvaStage){
        let target = event.target;
        while(target && target !== konvaStage && !target.id()) target = target.getParent();
        const id = target && target !== konvaStage ? target.id() : null;
        const el = id && getEl(id);
        if(!el) return;
        event.evt.stopPropagation();
        event.cancelBubble = true;
        const pointer = getStagePointer(event.evt) || target.position();
        if(event.evt.shiftKey){
          const next = new Set(state.selectedIds);
          if(next.has(id)) next.delete(id); else next.add(id);
          state.selectedIds = next;
        } else if(!state.selectedIds.has(id)) state.selectedIds = new Set([id]);
        render();
        if(!state.selectedIds.has(id)) return;
        konvaDragState = { id, startX:pointer.x, startY:pointer.y, positions:Object.fromEntries([...state.selectedIds].map(selectedId => { const selected = getEl(selectedId); return [selectedId, { x:selected.x, y:selected.y }]; })) };
        pushUndo();
        return;
      }
      event.evt.stopPropagation();
      const pointer = getStagePointer(event.evt);
      if(!pointer) return;
      const page = document.getElementById('page');
      const box = document.createElement('div');
      box.className = 'marquee-box no-print';
      page.appendChild(box);
      konvaMarqueeState = { startX:pointer.x, startY:pointer.y, baseSelection:event.evt.shiftKey ? new Set(state.selectedIds) : new Set(), box };
      if(!event.evt.shiftKey) state.selectedIds = new Set();
    });
    konvaStage.on('mousemove', event => {
      if(konvaMarqueeState){
        const pointer = getStagePointer(event.evt);
        if(!pointer) return;
        const left = Math.min(konvaMarqueeState.startX, pointer.x);
        const top = Math.min(konvaMarqueeState.startY, pointer.y);
        const width = Math.abs(pointer.x - konvaMarqueeState.startX);
        const height = Math.abs(pointer.y - konvaMarqueeState.startY);
        const pxPerMm = getPxPerMm();
        konvaMarqueeState.box.style.left = left / pxPerMm + 'mm';
        konvaMarqueeState.box.style.top = top / pxPerMm + 'mm';
        konvaMarqueeState.box.style.width = width / pxPerMm + 'mm';
        konvaMarqueeState.box.style.height = height / pxPerMm + 'mm';
        return;
      }
      if(!konvaDragState) return;
      const pointer = getStagePointer(event.evt);
      if(!pointer) return;
      const dx = (pointer.x - konvaDragState.startX) / getPxPerMm();
      const dy = (pointer.y - konvaDragState.startY) / getPxPerMm();
      Object.entries(konvaDragState.positions).forEach(([id, start]) => {
        const el = getEl(id);
        if(!el) return;
        el.x = round1(start.x + dx);
        el.y = round1(start.y + dy);
        const node = konvaLayer.findOne('#' + id);
        if(node){ node.x(mmToPx(el.x + el.width / 2)); node.y(mmToPx(el.y + heightOf(el) / 2)); }
      });
      konvaLayer.batchDraw();
      updateSchemaView();
    });
    konvaStage.on('mouseup', () => {
      if(konvaMarqueeState){
        const pointer = getStagePointer(event.evt);
        if(!pointer) return;
        const pxPerMm = getPxPerMm();
        const rect = {
          left:Math.min(konvaMarqueeState.startX, pointer.x) / pxPerMm,
          top:Math.min(konvaMarqueeState.startY, pointer.y) / pxPerMm,
          right:Math.max(konvaMarqueeState.startX, pointer.x) / pxPerMm,
          bottom:Math.max(konvaMarqueeState.startY, pointer.y) / pxPerMm
        };
        state.elements.forEach(el => {
          const hit = !(el.x + el.width < rect.left || el.x > rect.right || el.y + heightOf(el) < rect.top || el.y > rect.bottom);
          if(hit) konvaMarqueeState.baseSelection.add(el.id);
        });
        state.selectedIds = konvaMarqueeState.baseSelection;
        konvaMarqueeState.box.remove();
        konvaMarqueeState = null;
        render();
      } else if(konvaDragState){ konvaDragState = null; render(); }
    });
  }
  konvaStage.size({ width:page.clientWidth, height:page.clientHeight });
  konvaLayer.destroyChildren();
  state.elements.forEach(el => konvaLayer.add(makeKonvaNode(el)));
  konvaTransformer = new Konva.Transformer({
    rotateEnabled:true,
    keepRatio:false,
    ignoreStroke:true,
    anchorSize:8,
    borderStroke:'#171614',
    anchorStroke:'#171614',
    anchorFill:'#171614',
    enabledAnchors:['top-left','top-right','bottom-left','bottom-right'],
    boundBoxFunc:(oldBox, newBox) => resizeSnapBox(oldBox, newBox, getEl([...state.selectedIds][0]))
  });
  const selected = [...state.selectedIds].map(id => konvaLayer.findOne('#' + id)).filter(Boolean);
  if(selected.length === 1){
    const selectedElement = getEl(selected[0].id());
    konvaTransformer.keepRatio(selectedElement.type === 'image' ? selectedElement.keepRatio !== false : selectedElement.keepRatio === true);
    konvaTransformer.nodes(selected);
    konvaTransformer.on('transformstart', pushUndo);
    konvaTransformer.on('transformend', () => {
      const node = selected[0], el = getEl(node.id());
      if(!el) return;
      const scaleX = node.scaleX(), scaleY = node.scaleY();
      const absScaleX = Math.abs(scaleX), absScaleY = Math.abs(scaleY);
      el.width = round1(clamp(el.width * absScaleX, 5, state.page.width));
      if(el.type !== 'line') el.height = round1(clamp(el.height * absScaleY, 5, state.page.height));
      el.x = round1(clamp(node.x() / getPxPerMm() - el.width / 2, 0, state.page.width - el.width));
      el.y = round1(clamp(node.y() / getPxPerMm() - heightOf(el) / 2, 0, state.page.height - heightOf(el)));
      el.rotation = round1(node.rotation());
      el.flipX = scaleX < 0;
      el.flipY = scaleY < 0;
      node.scale({ x:1, y:1 });
      render();
    });
    konvaLayer.add(konvaTransformer);
  }
  konvaLayer.batchDraw();
  konvaGuideLayer.batchDraw();
}

function renderInspector(){
  const box = document.getElementById('inspector');
  const ids = [...state.selectedIds].filter(id => getEl(id));

  if(ids.length === 0){
    box.innerHTML = `<p class="hint">Click to select — shift-click to add more, drag empty space to marquee-select. Arrow keys nudge 1mm (10mm with shift), ⌘D duplicates, ⌘Z undoes, ⌘A selects all.</p>`;
    return;
  }

  if(ids.length === 1){
    const el = getEl(ids[0]);
    let html = `
      <div class="row-btns" style="margin-bottom:16px">
        <button class="btn small" onclick="centerSelectionH()">Center H</button>
        <button class="btn small" onclick="centerSelectionV()">Center V</button>
      </div>
      <div class="insp-row"><label>X</label><input type="number" id="insp-x" value="${el.x}" step="1" oninput="updateNum('${el.id}','x',this.value)"></div>
      <div class="insp-row"><label>Y</label><input type="number" id="insp-y" value="${el.y}" step="1" oninput="updateNum('${el.id}','y',this.value)"></div>
      <div class="insp-row"><label>W</label><input type="number" id="insp-w" value="${el.width}" step="1" oninput="updateNum('${el.id}','width',this.value)"></div>`;
    if(el.type !== 'line'){
      html += `<div class="insp-row"><label>H</label><input type="number" id="insp-h" value="${el.height}" step="1" oninput="updateNum('${el.id}','height',this.value)"></div>`;
    }
    if(el.type === 'text'){
      html += `
        <div class="field"><label>Style</label>
          <select onchange="updateProp('${el.id}','variant',this.value)">
            ${['display','body','label'].map(v => `<option value="${v}" ${v===(el.variant||'body')?'selected':''}>${v.charAt(0).toUpperCase()+v.slice(1)}</option>`).join('')}
          </select>
        </div>
        <div class="field"><label>Font size (px)</label><input type="number" value="${el.fontSize}" oninput="updateProp('${el.id}','fontSize',parseFloat(this.value))"></div>
        <div class="field"><label>Weight</label>
          <select onchange="updateProp('${el.id}','weight',parseInt(this.value))">
            ${[400,500,600].map(w => `<option value="${w}" ${w===el.weight?'selected':''}>${w}</option>`).join('')}
          </select>
        </div>
        <div class="field"><label>Align</label>
          <select onchange="updateProp('${el.id}','align',this.value)">
            ${['left','center','right'].map(a => `<option value="${a}" ${a===el.align?'selected':''}>${a}</option>`).join('')}
          </select>
        </div>`;
      if(el.field){
        html += `<div class="bound-note">Bound to data field <strong>${el.field}</strong> — edit its value in the Project data panel.</div>`;
      } else {
        html += `<div class="field"><label>Content</label><textarea oninput="updateProp('${el.id}','content',this.value)">${escapeHtml(el.content||'')}</textarea></div>`;
      }
    }
    if(el.type === 'image'){
      html += `<div class="field"><label>Aspect ratio</label>
        <label class="check-row"><input type="checkbox" ${el.keepRatio !== false ? 'checked' : ''} onchange="updateProp('${el.id}','keepRatio',this.checked)"> Lock image ratio</label>
      </div>`;
      if(el.role === 'logo'){
        html += `<div class="field"><label>Logo</label>
          <select onchange="updateProp('${el.id}','logoRef',this.value)">
            ${brandImages.length
              ? brandImages.map(b => `<option value="${b.id}" ${b.id===el.logoRef?'selected':''}>${escapeHtml(b.name)}</option>`).join('')
              : '<option value="">Upload a logo in Brand assets first</option>'}
          </select>
        </div>`;
      } else {
        html += `<button class="btn small" onclick="triggerImageUpload('${el.id}')">${el.src ? 'Replace' : 'Add'} editor preview image</button>`;
        if(el.field) html += `<div class="bound-note">Bound to data field <strong>${el.field}</strong> — the photo uploaded on Create Project fills this slot.</div>`;
        if(el.src) html += `<button class="btn small" style="margin-top:6px" onclick="updateProp('${el.id}','src',null)">Remove editor preview image</button>`;
      }
    }
    if(el.type === 'rect'){
      html += `
        <div class="field color-field"><label>Fill</label><input type="color" value="${rectFill(el)}" onchange="updateProp('${el.id}','fill',this.value)"></div>
        <div class="field color-field"><label>Border</label><input type="color" value="${rectStroke(el)}" onchange="updateProp('${el.id}','stroke',this.value)"></div>
        <div class="field"><label>Border width (px)</label><input type="number" min="0" max="20" step="1" value="${el.strokeWidth || 1}" oninput="updateProp('${el.id}','strokeWidth',parseFloat(this.value))"></div>
        <div class="field"><label>Line join</label><select onchange="updateProp('${el.id}','lineJoin',this.value)">${['miter','round','bevel'].map(v => `<option value="${v}" ${v===(el.lineJoin||'miter')?'selected':''}>${v}</option>`).join('')}</select></div>`;
    }
    if(el.type === 'line'){
      html += `
        <div class="field color-field"><label>Color</label><input type="color" value="${lineStroke(el)}" onchange="updateProp('${el.id}','stroke',this.value)"></div>
        <div class="field"><label>Thickness (px)</label><input type="number" min="1" max="20" step="1" value="${lineWidth(el)}" oninput="updateProp('${el.id}','strokeWidth',parseFloat(this.value))"></div>
        <div class="field"><label>Line join</label><select onchange="updateProp('${el.id}','lineJoin',this.value)">${['miter','round','bevel'].map(v => `<option value="${v}" ${v===(el.lineJoin||'miter')?'selected':''}>${v}</option>`).join('')}</select></div>`;
    }
    html += `<div class="field"><label>Opacity</label><input type="range" min="0" max="1" step="0.05" value="${Number.isFinite(el.opacity) ? el.opacity : 1}" oninput="updateProp('${el.id}','opacity',parseFloat(this.value))"></div>`;
      html += `<div class="field"><label>Shadow blur</label><input type="number" min="0" max="50" step="1" value="${Number(el.shadowBlur) || 0}" oninput="updateProp('${el.id}','shadowBlur',parseFloat(this.value))"></div>`;
    html += `
      <div class="row-btns" style="margin-top:14px">
        <button class="btn small" onclick="flipSelection('x')">Flip H</button>
        <button class="btn small" onclick="flipSelection('y')">Flip V</button>
        <button class="btn small" onclick="rotateSelection(-90)">Rotate</button>
        <button class="btn small" onclick="bringSelectionForward()">Forward</button>
        <button class="btn small" onclick="sendSelectionBackward()">Backward</button>
        <button class="btn small" onclick="bringSelectionToFront()">Front</button>
        <button class="btn small" onclick="sendSelectionToBack()">Back</button>
        <button class="btn small" onclick="duplicateSelection()">Duplicate</button>
        <button class="btn small danger" onclick="deleteSelection()">Delete</button>
      </div>`;
    box.innerHTML = html;
    return;
  }

  let html = `<div class="multi-count">${ids.length} elements selected</div>`;
  html += `
    <div class="field"><label>Align</label>
      <div class="align-grid">
        <button class="btn small" onclick="alignSelection('left')">Left</button>
        <button class="btn small" onclick="alignSelection('hcenter')">Center</button>
        <button class="btn small" onclick="alignSelection('right')">Right</button>
        <button class="btn small" onclick="alignSelection('top')">Top</button>
        <button class="btn small" onclick="alignSelection('vcenter')">Middle</button>
        <button class="btn small" onclick="alignSelection('bottom')">Bottom</button>
      </div>
    </div>
    <div class="field">
      <div class="row-btns">
        <button class="btn small" ${ids.length<3?'disabled':''} onclick="distributeSelection('h')">Distribute H</button>
        <button class="btn small" ${ids.length<3?'disabled':''} onclick="distributeSelection('v')">Distribute V</button>
      </div>
    </div>
    <div class="row-btns" style="margin-top:14px">
      <button class="btn small" onclick="bringSelectionToFront()">Front</button>
      <button class="btn small" onclick="sendSelectionToBack()">Back</button>
      <button class="btn small" onclick="duplicateSelection()">Duplicate</button>
      <button class="btn small danger" onclick="deleteSelection()">Delete</button>
    </div>`;
  box.innerHTML = html;
}

function updateSchemaView(){
  document.getElementById('schemaOutput').textContent = JSON.stringify({ page: state.page, elements: state.elements }, null, 2);
}

function render(){
  renderPage();
  renderInspector();
  updateSchemaView();
}

// ---------- lightweight in-place updates ----------
function applyElementStyle(id){
  const el = getEl(id);
  const node = document.querySelector(`#page .element[data-id="${id}"]`);
  if(!el || !node) return;
  node.style.left = el.x + 'mm';
  node.style.top = el.y + 'mm';
  node.style.width = el.width + 'mm';
  if(el.type !== 'line') node.style.height = el.height + 'mm';
  node.style.opacity = Number.isFinite(el.opacity) ? el.opacity : 1;
  node.style.transform = `rotate(${Number(el.rotation) || 0}deg) scale(${el.flipX ? -1 : 1},${el.flipY ? -1 : 1})`;
  node.style.transformOrigin = 'center';
  if(el.type === 'rect'){
    node.style.backgroundColor = rectFill(el);
    node.style.borderColor = rectStroke(el);
    node.style.borderWidth = (Number(el.strokeWidth) || 1) + 'px';
  }
  if(el.type === 'line'){
    node.style.borderTopColor = lineStroke(el);
    node.style.borderTopWidth = lineWidth(el) + 'px';
  }
  if(el.type === 'text'){
    node.style.fontSize = el.fontSize + 'px';
    node.style.fontWeight = el.weight;
    node.style.textAlign = el.align;
    if(document.activeElement !== node){
      const value = el.field ? (state.data[el.field] || '') : (el.content || '');
      node.textContent = (el.prefix || '') + value;
    }
  }
  if(state.selectedIds.has(id)){
    const overlay = document.querySelector(`.selection-overlay[data-id="${id}"]`);
    if(overlay){
      overlay.style.left = el.x + 'mm';
      overlay.style.top = el.y + 'mm';
      overlay.style.width = el.width + 'mm';
      overlay.style.height = (el.type === 'line' ? 2 : el.height) + 'mm';
    }
    if(state.selectedIds.size === 1) syncInspectorNumbers(id);
    if(state.selectedIds.size > 1) updateSelectionBBox();
  }
  if(el.type === 'line'){
    updateKonvaNodePosition(id);
    if(konvaLayer) konvaLayer.batchDraw();
  } else {
    renderKonva();
  }
}

function updateSelectionBBox(){
  const ids = [...state.selectedIds].filter(id => getEl(id));
  if(ids.length < 2) return;
  const elsArr = ids.map(getEl);
  const minX = Math.min(...elsArr.map(e => e.x)), maxX = Math.max(...elsArr.map(e => e.x + e.width));
  const minY = Math.min(...elsArr.map(e => e.y)), maxY = Math.max(...elsArr.map(e => e.y + heightOf(e)));
  const bbox = document.querySelector('.selection-bbox');
  if(bbox){
    bbox.style.left = minX + 'mm'; bbox.style.top = minY + 'mm';
    bbox.style.width = (maxX-minX) + 'mm'; bbox.style.height = (maxY-minY) + 'mm';
  }
}

function syncInspectorNumbers(id){
  if(state.selectedIds.size !== 1 || !state.selectedIds.has(id)) return;
  const el = getEl(id);
  const map = { x:'insp-x', y:'insp-y', width:'insp-w', height:'insp-h' };
  for(const [prop, domId] of Object.entries(map)){
    const input = document.getElementById(domId);
    if(input && document.activeElement !== input) input.value = round1(el[prop]);
  }
}

function updateBoundElementsContent(field){
  state.elements.filter(e => e.type === 'text' && e.field === field).forEach(e => {
    const node = document.querySelector(`#page .element[data-id="${e.id}"]`);
    if(node && document.activeElement !== node) node.textContent = (e.prefix || '') + (state.data[field] || '');
  });
}

// ---------- property mutators ----------
function updateNum(id, prop, value){
  const el = getEl(id);
  const num = parseFloat(value);
  if(!el || isNaN(num)) return;
  pushUndoDebounced('num:' + id + ':' + prop);
  el[prop] = num;
  applyElementStyle(id);
  updateSchemaView();
}
function updateProp(id, prop, value){
  const el = getEl(id);
  if(!el) return;
  pushUndoDebounced('prop:' + id + ':' + prop);
  el[prop] = value;
  if(prop === 'src' || prop === 'variant' || prop === 'logoRef' || prop === 'fill' || prop === 'stroke' || prop === 'strokeWidth'){ renderPage(); renderInspector(); }
  else applyElementStyle(id);
  updateSchemaView();
}

function flipSelection(axis){
  const ids = [...state.selectedIds]; if(!ids.length) return;
  pushUndo();
  ids.forEach(id => {
    const el = getEl(id); if(!el) return;
    const prop = axis === 'x' ? 'flipX' : 'flipY';
    el[prop] = !el[prop];
  });
  render();
}
function rotateSelection(delta){
  const ids = [...state.selectedIds]; if(!ids.length) return;
  pushUndo();
  ids.forEach(id => { const el = getEl(id); if(el) el.rotation = ((Number(el.rotation) || 0) + delta) % 360; });
  render();
}
function onDataInput(field, value){
  state.data[field] = value;
  updateBoundElementsContent(field);
  renderKonva();
  updateSchemaView();
}

// ---------- selection ----------
function selectOnly(id){ state.selectedIds = new Set([id]); render(); }
function toggleSelect(id){
  const s = new Set(state.selectedIds);
  if(s.has(id)) s.delete(id); else s.add(id);
  state.selectedIds = s;
  render();
}
function clearSelection(){ if(state.selectedIds.size){ state.selectedIds = new Set(); render(); } }
function selectAll(){ state.selectedIds = new Set(state.elements.map(e => e.id)); render(); }

// ---------- structural mutators ----------
function addElement(type){
  pushUndo();
  let el;
  if(type === 'text') el = { id:newId('el'), type:'text', field:null, content:'New text', x:20, y:20, width:60, height:10, fontSize:12, weight:400, align:'left', variant:'body' };
  if(type === 'image') el = { id:newId('el'), type:'image', role:'photo', field:null, x:20, y:20, width:60, height:60, src:null };
  if(type === 'logo') el = { id:newId('el'), type:'image', role:'logo', logoRef: brandImages.length ? brandImages[0].id : null, x:20, y:20, width:40, height:40 };
  if(type === 'line') el = { id:newId('el'), type:'line', x:20, y:Math.min(260, state.page.height - 20), width:100, height:0, stroke:'#171614', strokeWidth:1 };
  if(type === 'rect') el = { id:newId('el'), type:'rect', x:20, y:20, width:60, height:40, fill:'#ffffff', stroke:'#171614' };
  state.elements.push(el);
  state.selectedIds = new Set([el.id]);
  render();
}
function deleteSelection(){
  const ids = [...state.selectedIds]; if(!ids.length) return;
  pushUndo();
  state.elements = state.elements.filter(e => !ids.includes(e.id));
  state.selectedIds = new Set();
  render();
}
function duplicateSelection(){
  const ids = [...state.selectedIds]; if(!ids.length) return;
  pushUndo();
  const offset = 6;
  const newIds = [];
  ids.forEach(id => {
    const el = getEl(id); if(!el) return;
    const clone = JSON.parse(JSON.stringify(el));
    clone.id = newId('el');
    clone.x = round1(clamp(clone.x + offset, 0, state.page.width - clone.width));
    clone.y = round1(clamp(clone.y + offset, 0, state.page.height - heightOf(clone)));
    state.elements.push(clone);
    newIds.push(clone.id);
  });
  state.selectedIds = new Set(newIds);
  render();
}
function bringSelectionToFront(){
  const ids = [...state.selectedIds]; if(!ids.length) return;
  pushUndo();
  const picked = state.elements.filter(e => ids.includes(e.id));
  state.elements = state.elements.filter(e => !ids.includes(e.id));
  state.elements.push(...picked);
  render();
}
function sendSelectionToBack(){
  const ids = [...state.selectedIds]; if(!ids.length) return;
  pushUndo();
  const picked = state.elements.filter(e => ids.includes(e.id));
  state.elements = state.elements.filter(e => !ids.includes(e.id));
  state.elements.unshift(...picked);
  render();
}
function bringSelectionForward(){
  const ids = [...state.selectedIds]; if(!ids.length) return;
  pushUndo();
  ids.forEach(id => {
    const index = state.elements.findIndex(e => e.id === id);
    if(index >= 0 && index < state.elements.length - 1) [state.elements[index], state.elements[index + 1]] = [state.elements[index + 1], state.elements[index]];
  });
  render();
}
function sendSelectionBackward(){
  const ids = [...state.selectedIds]; if(!ids.length) return;
  pushUndo();
  [...ids].reverse().forEach(id => {
    const index = state.elements.findIndex(e => e.id === id);
    if(index > 0) [state.elements[index], state.elements[index - 1]] = [state.elements[index - 1], state.elements[index]];
  });
  render();
}
function centerSelectionH(){
  const ids = [...state.selectedIds]; if(!ids.length) return;
  pushUndo();
  const elsArr = ids.map(getEl);
  const minX = Math.min(...elsArr.map(e => e.x)), maxX = Math.max(...elsArr.map(e => e.x + e.width));
  const shift = (state.page.width - (maxX - minX)) / 2 - minX;
  elsArr.forEach(el => { el.x = round1(el.x + shift); });
  render();
}
function centerSelectionV(){
  const ids = [...state.selectedIds]; if(!ids.length) return;
  pushUndo();
  const elsArr = ids.map(getEl);
  const minY = Math.min(...elsArr.map(e => e.y)), maxY = Math.max(...elsArr.map(e => e.y + heightOf(e)));
  const shift = (state.page.height - (maxY - minY)) / 2 - minY;
  elsArr.forEach(el => { el.y = round1(el.y + shift); });
  render();
}
function alignSelection(mode){
  const ids = [...state.selectedIds]; if(ids.length < 2) return;
  pushUndo();
  const elsArr = ids.map(getEl);
  const minX = Math.min(...elsArr.map(e => e.x)), maxX = Math.max(...elsArr.map(e => e.x + e.width));
  const minY = Math.min(...elsArr.map(e => e.y)), maxY = Math.max(...elsArr.map(e => e.y + heightOf(e)));
  elsArr.forEach(el => {
    const h = heightOf(el);
    if(mode === 'left') el.x = minX;
    if(mode === 'right') el.x = maxX - el.width;
    if(mode === 'hcenter') el.x = (minX + maxX) / 2 - el.width / 2;
    if(mode === 'top') el.y = minY;
    if(mode === 'bottom') el.y = maxY - h;
    if(mode === 'vcenter') el.y = (minY + maxY) / 2 - h / 2;
    el.x = round1(el.x); el.y = round1(el.y);
  });
  render();
}
function distributeSelection(axis){
  const ids = [...state.selectedIds]; if(ids.length < 3) return;
  pushUndo();
  const elsArr = ids.map(getEl);
  if(axis === 'h'){
    elsArr.sort((a,b) => a.x - b.x);
    const first = elsArr[0], last = elsArr[elsArr.length-1];
    const totalSpan = (last.x + last.width) - first.x;
    const totalWidth = elsArr.reduce((s,e) => s + e.width, 0);
    const gap = (totalSpan - totalWidth) / (elsArr.length - 1);
    let cursor = first.x + first.width + gap;
    for(let i = 1; i < elsArr.length - 1; i++){
      elsArr[i].x = round1(cursor);
      cursor += elsArr[i].width + gap;
    }
  } else {
    elsArr.sort((a,b) => a.y - b.y);
    const first = elsArr[0], last = elsArr[elsArr.length-1];
    const totalSpan = (last.y + heightOf(last)) - first.y;
    const totalHeight = elsArr.reduce((s,e) => s + heightOf(e), 0);
    const gap = (totalSpan - totalHeight) / (elsArr.length - 1);
    let cursor = first.y + heightOf(first) + gap;
    for(let i = 1; i < elsArr.length - 1; i++){
      elsArr[i].y = round1(cursor);
      cursor += heightOf(elsArr[i]) + gap;
    }
  }
  render();
}

// ---------- snapping ----------
function computeSnap(el, proposedX, proposedY, excludeIds){
  const threshold = 5;
  const exclude = new Set(excludeIds || [el.id]);
  const pxPerMm = getPxPerMm();
  const stageWidth = state.page.width * pxPerMm;
  const stageHeight = state.page.height * pxPerMm;
  const node = konvaLayer && konvaLayer.findOne('#' + el.id);
  const nodeBox = node ? node.getClientRect({ skipTransform:false }) : { x:el.x * pxPerMm, y:el.y * pxPerMm, width:el.width * pxPerMm, height:heightOf(el) * pxPerMm };
  const proposedBox = { ...nodeBox, x:nodeBox.x + (proposedX - el.x) * pxPerMm, y:nodeBox.y + (proposedY - el.y) * pxPerMm };
  const vertical = [0, stageWidth / 2, stageWidth];
  const horizontal = [0, stageHeight / 2, stageHeight];
  state.elements.forEach(other => {
    if(exclude.has(other.id)) return;
    const otherNode = konvaLayer && konvaLayer.findOne('#' + other.id);
    const box = otherNode ? otherNode.getClientRect({ skipTransform:false }) : { x:other.x * pxPerMm, y:other.y * pxPerMm, width:other.width * pxPerMm, height:heightOf(other) * pxPerMm };
    vertical.push(box.x, box.x + box.width / 2, box.x + box.width);
    horizontal.push(box.y, box.y + box.height / 2, box.y + box.height);
  });
  const candidates = (values, points) => values.flatMap(line => points.map(point => ({ line, point, diff:Math.abs(line - point.guide) })))
    .filter(candidate => candidate.diff <= threshold)
    .sort((a,b) => a.diff - b.diff);
  const xPoints = [
    { guide:proposedBox.x, offset:proposedBox.x - nodeBox.x },
    { guide:proposedBox.x + proposedBox.width / 2, offset:proposedBox.x + proposedBox.width / 2 - nodeBox.x },
    { guide:proposedBox.x + proposedBox.width, offset:proposedBox.x + proposedBox.width - nodeBox.x }
  ];
  const yPoints = [
    { guide:proposedBox.y, offset:proposedBox.y - nodeBox.y },
    { guide:proposedBox.y + proposedBox.height / 2, offset:proposedBox.y + proposedBox.height / 2 - nodeBox.y },
    { guide:proposedBox.y + proposedBox.height, offset:proposedBox.y + proposedBox.height - nodeBox.y }
  ];
  const xMatch = candidates(vertical, xPoints)[0];
  const yMatch = candidates(horizontal, yPoints)[0];
  return {
    x:xMatch ? proposedX + (xMatch.line - xMatch.point.guide) / pxPerMm : null,
    y:yMatch ? proposedY + (yMatch.line - yMatch.point.guide) / pxPerMm : null,
    guideX:xMatch ? xMatch.line / pxPerMm : null,
    guideY:yMatch ? yMatch.line / pxPerMm : null
  };
}
function showGuideV(xmm){
  if(!konvaGuideLayer) return;
  konvaGuideLayer.find('.snap-guide-v').forEach(line => line.destroy());
  guideVEl = new Konva.Line({ points:[mmToPx(xmm),0,mmToPx(xmm),mmToPx(state.page.height)], stroke:'rgb(0, 161, 255)', strokeWidth:1, dash:[4,6], name:'snap-guide-v', listening:false });
  konvaGuideLayer.add(guideVEl);
  konvaGuideLayer.batchDraw();
}
function hideGuideV(){ if(guideVEl){ guideVEl.destroy(); guideVEl = null; if(konvaGuideLayer) konvaGuideLayer.batchDraw(); } }
function showGuideH(ymm){
  if(!konvaGuideLayer) return;
  konvaGuideLayer.find('.snap-guide-h').forEach(line => line.destroy());
  guideHEl = new Konva.Line({ points:[0,mmToPx(ymm),mmToPx(state.page.width),mmToPx(ymm)], stroke:'rgb(0, 161, 255)', strokeWidth:1, dash:[4,6], name:'snap-guide-h', listening:false });
  konvaGuideLayer.add(guideHEl);
  konvaGuideLayer.batchDraw();
}
function hideGuideH(){ if(guideHEl){ guideHEl.destroy(); guideHEl = null; if(konvaGuideLayer) konvaGuideLayer.batchDraw(); } }

// ---------- drag / resize / marquee ----------
function onPageMouseDown(e){
  if(e.target.closest('.konva-editor-layer')) return;
  const handle = e.target.closest('.resize-handle');
  if(handle){
    const el = getEl(handle.dataset.id);
    if(!el) return;
    pushUndo();
    interaction = { mode:'resize', id: handle.dataset.id, startClientX:e.clientX, startClientY:e.clientY, startW: el.width, startH: el.height };
    e.stopPropagation(); e.preventDefault();
    return;
  }
  const elDiv = e.target.closest('.element');
  if(elDiv){
    if(e.target.isContentEditable) return;
    const id = elDiv.dataset.id;
    if(e.shiftKey){
      toggleSelect(id);
      if(!state.selectedIds.has(id)) return;
    } else if(!state.selectedIds.has(id)){
      selectOnly(id);
    }
    const ids = [...state.selectedIds];
    const startPositions = {};
    ids.forEach(i => { const e2 = getEl(i); if(e2) startPositions[i] = { x:e2.x, y:e2.y }; });
    interaction = { mode:'pending', id, ids, startPositions, startClientX:e.clientX, startClientY:e.clientY };
  } else {
    const pxPerMm = getPxPerMm();
    const pageRect = document.getElementById('page').getBoundingClientRect();
    const startXmm = (e.clientX - pageRect.left) / (pxPerMm * state.zoom);
    const startYmm = (e.clientY - pageRect.top) / (pxPerMm * state.zoom);
    if(!e.shiftKey && state.selectedIds.size){ state.selectedIds = new Set(); render(); }
    const box = document.createElement('div');
    box.className = 'marquee-box no-print';
    document.getElementById('page').appendChild(box);
    interaction = { mode:'marquee', startXmm, startYmm, curXmm:startXmm, curYmm:startYmm, baseSelection:new Set(state.selectedIds), boxEl: box };
  }
}

document.addEventListener('mousemove', e => {
  if(!interaction) return;

  if(interaction.mode === 'marquee'){
    const pxPerMm = getPxPerMm();
    const pageRect = document.getElementById('page').getBoundingClientRect();
    interaction.curXmm = (e.clientX - pageRect.left) / (pxPerMm * state.zoom);
    interaction.curYmm = (e.clientY - pageRect.top) / (pxPerMm * state.zoom);
    const left = Math.min(interaction.startXmm, interaction.curXmm);
    const top = Math.min(interaction.startYmm, interaction.curYmm);
    const w = Math.abs(interaction.curXmm - interaction.startXmm);
    const h = Math.abs(interaction.curYmm - interaction.startYmm);
    interaction.boxEl.style.left = left + 'mm';
    interaction.boxEl.style.top = top + 'mm';
    interaction.boxEl.style.width = w + 'mm';
    interaction.boxEl.style.height = h + 'mm';
    const rect = { left, top, right:left+w, bottom:top+h };
    state.elements.forEach(el => {
      const node = document.querySelector(`#page .element[data-id="${el.id}"]`);
      if(!node) return;
      const eh = heightOf(el);
      const hit = !(el.x + el.width < rect.left || el.x > rect.right || el.y + eh < rect.top || el.y > rect.bottom);
      node.classList.toggle('marquee-hit', hit);
    });
    return;
  }

  if(interaction.mode === 'pending'){
    if(Math.abs(e.clientX - interaction.startClientX) > 3 || Math.abs(e.clientY - interaction.startClientY) > 3){
      interaction.mode = 'drag';
      pushUndo();
    } else return;
  }

  const pxPerMm = getPxPerMm();

  if(interaction.mode === 'drag'){
    const dxRaw = (e.clientX - interaction.startClientX) / (pxPerMm * state.zoom);
    const dyRaw = (e.clientY - interaction.startClientY) / (pxPerMm * state.zoom);
    const primary = getEl(interaction.id);
    const primaryStart = interaction.startPositions[interaction.id];
    let snap = { x:null, y:null, guideX:null, guideY:null };
    if(primary && primaryStart){
      snap = computeSnap(primary, primaryStart.x + dxRaw, primaryStart.y + dyRaw, interaction.ids);
    }
    const snapDX = snap.x != null ? snap.x - (primaryStart.x + dxRaw) : 0;
    const snapDY = snap.y != null ? snap.y - (primaryStart.y + dyRaw) : 0;

    interaction.ids.forEach(id => {
      const el = getEl(id);
      const start = interaction.startPositions[id];
      if(!el || !start) return;
      el.x = round1(start.x + dxRaw + snapDX);
      el.y = round1(start.y + dyRaw + snapDY);
      updateKonvaNodePosition(id);
      updateSelectionOverlayPosition(id);
    });
    if(snap.guideX != null) showGuideV(snap.guideX); else hideGuideV();
    if(snap.guideY != null) showGuideH(snap.guideY); else hideGuideH();

  } else if(interaction.mode === 'resize'){
    const el = getEl(interaction.id);
    if(!el) return;
    const dx = (e.clientX - interaction.startClientX) / (pxPerMm * state.zoom);
    const dy = (e.clientY - interaction.startClientY) / (pxPerMm * state.zoom);
    el.width = round1(clamp(interaction.startW + dx, 5, state.page.width - el.x));
    if(el.type !== 'line') el.height = round1(clamp(interaction.startH + dy, 5, state.page.height - el.y));
    applyElementStyle(el.id);
  }
});

document.addEventListener('mouseup', () => {
  if(!interaction) return;
  if(interaction.mode === 'marquee'){
    const rect = {
      left: Math.min(interaction.startXmm, interaction.curXmm),
      top: Math.min(interaction.startYmm, interaction.curYmm),
      right: Math.max(interaction.startXmm, interaction.curXmm),
      bottom: Math.max(interaction.startYmm, interaction.curYmm)
    };
    const hits = state.elements.filter(el => {
      const eh = heightOf(el);
      return !(el.x + el.width < rect.left || el.x > rect.right || el.y + eh < rect.top || el.y > rect.bottom);
    }).map(el => el.id);
    const combined = new Set(interaction.baseSelection);
    hits.forEach(id => combined.add(id));
    state.selectedIds = combined;
    interaction.boxEl.remove();
    render();
  } else if(interaction.mode === 'drag' || interaction.mode === 'resize'){
    suppressClick = true;
    hideGuideV(); hideGuideH();
    renderInspector();
  }
  interaction = null;
});

document.addEventListener('pointercancel', cancelInteraction);
document.addEventListener('contextmenu', event => {
  if(event.target.closest('#page')){
    event.preventDefault();
    cancelInteraction();
    render();
  }
});
window.addEventListener('blur', cancelInteraction);

document.getElementById('page').addEventListener('mousedown', onPageMouseDown);

document.getElementById('page').addEventListener('click', e => {
  if(suppressClick){ suppressClick = false; return; }
  const imgEl = e.target.closest('.el-image-empty');
  if(!imgEl) return;
  const el = getEl(imgEl.dataset.id);
  if(el && el.role === 'logo') return; // logos are picked from the Brand assets dropdown, not a raw upload
  triggerImageUpload(imgEl.dataset.id);
});

document.getElementById('page').addEventListener('dblclick', e => {
  const textDiv = e.target.closest('.el-text');
  if(!textDiv) return;
  const el = getEl(textDiv.dataset.id);
  if(el.field){
    const input = document.getElementById('data-' + el.field);
    if(input){ input.focus(); input.select(); }
    return;
  }
  pushUndo();
  textDiv.contentEditable = 'true';
  textDiv.focus();
  const range = document.createRange();
  range.selectNodeContents(textDiv);
  range.collapse(false);
  const sel = window.getSelection();
  sel.removeAllRanges();
  sel.addRange(range);
  const onBlur = () => {
    el.content = textDiv.textContent;
    textDiv.contentEditable = 'false';
    textDiv.removeEventListener('blur', onBlur);
    updateSchemaView();
  };
  textDiv.addEventListener('blur', onBlur);
});

// ---------- keyboard ----------
document.addEventListener('keydown', e => {
  if(getActiveTab() !== 'editor') return;
  const active = document.activeElement;
  const tag = active && active.tagName;
  const typing = active && (active.isContentEditable || tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT');
  const mod = e.metaKey || e.ctrlKey;

  if(mod && !typing && (e.key === 'z' || e.key === 'Z')){ e.preventDefault(); e.shiftKey ? redo() : undo(); return; }
  if(mod && !typing && (e.key === 'y' || e.key === 'Y')){ e.preventDefault(); redo(); return; }
  if(mod && !typing && (e.key === 'd' || e.key === 'D')){ e.preventDefault(); duplicateSelection(); return; }
  if(mod && !typing && (e.key === 'a' || e.key === 'A')){ e.preventDefault(); selectAll(); return; }
  if(e.key === 'Escape' && !typing){
    if(interaction || konvaDragState || konvaMarqueeState){ cancelInteraction(); render(); }
    else clearSelection();
    return;
  }
  if((e.key === 'Delete' || e.key === 'Backspace') && state.selectedIds.size && !typing){
    e.preventDefault(); deleteSelection(); return;
  }
  if(['ArrowLeft','ArrowRight','ArrowUp','ArrowDown'].includes(e.key) && state.selectedIds.size && !typing){
    e.preventDefault();
    pushUndoDebounced('nudge');
    const step = e.shiftKey ? 10 : 1;
    let dx = 0, dy = 0;
    if(e.key === 'ArrowLeft') dx = -step;
    if(e.key === 'ArrowRight') dx = step;
    if(e.key === 'ArrowUp') dy = -step;
    if(e.key === 'ArrowDown') dy = step;
    state.selectedIds.forEach(id => {
      const el = getEl(id); if(!el) return;
      el.x = round1(el.x + dx);
      el.y = round1(el.y + dy);
    });
    renderPage();
    updateSchemaView();
  }
});

// ---------- image upload (editor per-element preview, client-side only) ----------
let hiddenImageInput = null;
function triggerImageUpload(id){
  if(!hiddenImageInput){
    hiddenImageInput = document.createElement('input');
    hiddenImageInput.type = 'file';
    hiddenImageInput.accept = 'image/*';
    hiddenImageInput.style.display = 'none';
    document.body.appendChild(hiddenImageInput);
  }
  hiddenImageInput.onchange = () => {
    const file = hiddenImageInput.files[0];
    if(!file) return;
    const reader = new FileReader();
    reader.onload = () => { updateProp(id, 'src', reader.result); };
    reader.readAsDataURL(file);
    hiddenImageInput.value = '';
  };
  hiddenImageInput.click();
}

// ---------- brand asset library (logos, separate from project photos) ----------
function triggerBrandUpload(){ document.getElementById('brandPhotoInput').click(); }
function onBrandFileSelected(file){
  if(!file) return;
  const name = prompt('Name this logo / brand image:', file.name.replace(/\.[^.]+$/, ''));
  const input = document.getElementById('brandPhotoInput');
  if(!name){ input.value = ''; return; }
  uploadBrandImage(name, file);
  input.value = '';
}
async function uploadBrandImage(name, file){
  // readAsDataURL preserves the source file's bytes as-is, so PNG alpha
  // transparency survives untouched — no canvas re-encode that could flatten it.
  const localPreview = await new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
  const img = { id: newId('brand/logo'), dbId: null, name, dataUrl: localPreview };
  brandImages.push(img);
  renderBrandList();
  renderPage();
  renderInspector();
  if(db){
    try{
      const storagePath = await uploadCoverImage(file, 'logos');
      const { data, error } = await db.from('brand_images').insert({ name, image_url: storagePath, owner_id: currentUserId() }).select().single();
      if(error) throw error;
      img.dbId = data.id;
      img.storagePath = storagePath;
      img.dataUrl = await signedCoverImageUrl(storagePath);
      renderBrandList();
      renderPage();
    }catch(err){
      alert('Logo added for this session, but could not be saved to the database: ' + err.message);
    }
  }
  saveToStorage(LS_KEYS.brandImages, brandImages);
  return img;
}
async function deleteBrandImage(id){
  const img = brandImages.find(b => b.id === id);
  brandImages = brandImages.filter(b => b.id !== id);
  saveToStorage(LS_KEYS.brandImages, brandImages);
  renderBrandList();
  renderPage();
  renderInspector();
  if(db && img && img.dbId){
    const { error } = await db.from('brand_images').delete().eq('id', img.dbId);
    if(error) console.warn('Could not delete brand image from the database', error);
    await deleteCoverImage(img.storagePath);
  }
}
function renderBrandList(){
  const box = document.getElementById('brandList');
  if(!box) return;
  box.innerHTML = brandImages.map(b => `
    <div class="brand-row">
      ${sanitizeImageSrc(b.dataUrl) ? `<img class="brand-thumb" src="${escapeHtml(sanitizeImageSrc(b.dataUrl))}">` : ''}
      <span class="brand-name">${escapeHtml(b.name)}</span>
      <button class="btn tiny danger" onclick="deleteBrandImage('${b.id}')">Remove</button>
    </div>`).join('');
}

// ---------- template import / export ----------
function exportTemplate(){
  const blob = new Blob([JSON.stringify({ page: state.page, elements: state.elements }, null, 2)], { type:'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = 'template.json';
  document.body.appendChild(a); a.click(); a.remove();
  URL.revokeObjectURL(url);
}
function importTemplateFile(file){
  const reader = new FileReader();
  reader.onload = () => {
    try{
      const obj = JSON.parse(reader.result);
      pushUndo();
      if(obj.page){
        state.page = Object.assign({ size:'A4', orientation:'portrait' }, obj.page);
        let matched = false;
        for(const [size, base] of Object.entries(PAGE_SIZES)){
          if(state.page.width === base.w && state.page.height === base.h){ state.page.size = size; state.page.orientation = 'portrait'; matched = true; break; }
          if(state.page.width === base.h && state.page.height === base.w){ state.page.size = size; state.page.orientation = 'landscape'; matched = true; break; }
        }
        if(!matched){ state.page.size = 'A4'; state.page.orientation = 'portrait'; }
        applyPageCSSVars();
        updatePrintStyle();
        updatePageSub();
        syncPageSizeSelect();
        buildRulerLabels();
      }
      if(Array.isArray(obj.elements)) state.elements = obj.elements.map(normalizeImportedElement).filter(Boolean);
      state.selectedIds = new Set();
      render();
    }catch(err){ alert('Could not read that template file: ' + err.message); }
  };
  reader.readAsText(file);
}

function normalizeImportedPage(page){
  const size = page.size === 'A3' ? 'A3' : 'A4';
  const orientation = page.orientation === 'landscape' ? 'landscape' : 'portrait';
  const base = PAGE_SIZES[size];
  return { size, orientation, width:orientation === 'landscape' ? base.h : base.w, height:orientation === 'landscape' ? base.w : base.h };
}
function normalizeImportedElement(raw){
  if(!raw || !['text','image','line','rect'].includes(raw.type)) return null;
  const element = { ...raw, id:newId('el'), type:raw.type };
  element.x = clamp(Number(raw.x) || 0, 0, state.page.width);
  element.y = clamp(Number(raw.y) || 0, 0, state.page.height);
  element.width = clamp(Number(raw.width) || 5, 5, state.page.width - element.x);
  element.height = raw.type === 'line' ? 0 : clamp(Number(raw.height) || 5, 5, state.page.height - element.y);
  if(raw.type === 'text'){
    element.content = String(raw.content || '').slice(0, 2000);
    element.prefix = String(raw.prefix || '').slice(0, 200);
    element.fontSize = clamp(Number(raw.fontSize) || 12, 1, 200);
    element.weight = [400,500,600].includes(Number(raw.weight)) ? Number(raw.weight) : 400;
    element.align = ['left','center','right'].includes(raw.align) ? raw.align : 'left';
  }
  if(raw.type === 'image') element.src = sanitizeImageSrc(raw.src);
  return element;
}

// ---------- preset library (persisted) ----------
function seedDefaultPreset(){
  presets.push({ id:newId('preset'), name:'A4 Architecture Cover', clientName: state.data.clientName, page: JSON.parse(JSON.stringify(state.page)), elements: JSON.parse(JSON.stringify(state.elements)) });
}
async function saveCurrentAsPreset(){
  const name = prompt('Name this preset:', 'Untitled preset');
  if(!name) return;
  const preset = { id:newId('preset'), name, clientName: state.data.clientName, page: JSON.parse(JSON.stringify(state.page)), elements: JSON.parse(JSON.stringify(state.elements)) };
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
  saveToStorage(LS_KEYS.presets, presets);
  renderSavedPresetsList();
  refreshPresetSelect();
  const sel = document.getElementById('cpPresetSelect');
  if(sel) sel.value = String(presets.length - 1);
  renderCreatePreview();
  alert(`Saved "${name}" — it's now selectable on the Create project tab.`);
}
function loadPresetForEditing(id){
  const preset = presets.find(item => item.id === id);
  if(!preset) return;
  editingPresetId = preset.id;
  state.page = JSON.parse(JSON.stringify(preset.page));
  state.elements = JSON.parse(JSON.stringify(preset.elements));
  state.data.clientName = preset.clientName || state.data.clientName;
  state.selectedIds = new Set();
  undoStack.length = 0;
  redoStack.length = 0;
  applyPageCSSVars();
  updatePrintStyle();
  updatePageSub();
  syncPageSizeSelect();
  buildRulerLabels();
  render();
  switchTab('editor');
  renderSavedPresetsList();
}
async function updateLoadedPreset(){
  const preset = presets.find(item => item.id === editingPresetId);
  if(!preset) return;
  const updated = { ...preset, clientName:state.data.clientName, page:JSON.parse(JSON.stringify(state.page)), elements:JSON.parse(JSON.stringify(state.elements)) };
  if(db){
    const { error } = await db.from('presets').update(presetToRow(updated)).eq('id', preset.id);
    if(error){ alert('Could not update this preset: ' + error.message); return; }
  }
  const index = presets.findIndex(item => item.id === preset.id);
  if(index >= 0) presets[index] = updated;
  saveToStorage(LS_KEYS.presets, presets);
  renderSavedPresetsList();
  refreshPresetSelect();
  renderCreatePreview();
  alert(`Updated "${updated.name}".`);
}
async function deletePreset(id){
  presets = presets.filter(p => p.id !== id);
  saveToStorage(LS_KEYS.presets, presets);
  renderSavedPresetsList();
  refreshPresetSelect();
  renderCreatePreview();
  if(db){
    const { error } = await db.from('presets').delete().eq('id', id);
    if(error) console.warn('Could not delete preset from the database', error);
  }
}
function renderSavedPresetsList(){
  const box = document.getElementById('savedPresetsList');
  if(!box) return;
  box.innerHTML = presets.map(p => `
    <div class="brand-row">
      <span class="brand-name">${escapeHtml(p.name)}${p.clientName ? ` · ${escapeHtml(p.clientName)}` : ''}</span>
      <button class="btn tiny" onclick="loadPresetForEditing('${p.id}')">Edit</button>
      <button class="btn tiny danger" onclick="deletePreset('${p.id}')">Remove</button>
    </div>`).join('');
}
function refreshPresetSelect(){
  const sel = document.getElementById('cpPresetSelect');
  if(!sel) return;
  const prev = sel.value;
  sel.innerHTML = presets.map((p,i) => `<option value="${i}">${escapeHtml(p.name)}</option>`).join('');
  if(presets.length){ sel.value = prev && Number(prev) < presets.length ? prev : '0'; }
}
function getSelectedPreset(){
  const sel = document.getElementById('cpPresetSelect');
  const i = sel ? parseInt(sel.value, 10) : 0;
  return presets[i] || presets[0] || null;
}

// ---------- create project ----------
function onCreateFieldInput(field, value){
  createData[field] = value;
  renderCreatePreview();
}
function triggerCreatePhotoUpload(){ document.getElementById('cpPhotoInput').click(); }
function onCreatePhotoSelected(file){
  if(!file) return;
  createData.projectImageFile = file;
  const reader = new FileReader();
  reader.onload = () => {
    createData.projectImage = reader.result;
    updateDropzonePreview();
    renderCreatePreview();
  };
  reader.readAsDataURL(file);
}
function updateDropzonePreview(){
  const zone = document.getElementById('cpDropzone');
  if(!zone) return;
  const src = sanitizeImageSrc(createData.projectImage);
  zone.innerHTML = src
    ? `<img src="${escapeHtml(src)}"><div class="replace-hint">Click to replace</div>`
    : `<span>Drag a photo here, or click to browse</span>`;
}
function onCreatePresetChange(){
  const preset = getSelectedPreset();
  if(preset && preset.clientName){
    createData.clientName = preset.clientName;
    const input = document.getElementById('cp-clientName');
    if(input) input.value = createData.clientName;
  }
  renderCreatePreview();
}
function scalePreviewTo(pageEl, pageWidthMm, pageHeightMm){
  const shell = document.getElementById('previewShell');
  const mmToPx = 96 / 25.4;
  const pagePxWidth = pageWidthMm * mmToPx;
  const scale = shell.clientWidth / pagePxWidth;
  pageEl.style.width = pageWidthMm + 'mm';
  pageEl.style.height = pageHeightMm + 'mm';
  pageEl.style.transform = `scale(${scale})`;
  shell.style.height = Math.round(pagePxWidth * (pageHeightMm / pageWidthMm) * scale) + 'px';
}
function renderCreatePreview(){
  const preset = getSelectedPreset();
  const pageEl = document.getElementById('projectPage');
  if(!preset || !pageEl) return;
  pageEl.innerHTML = preset.elements.map(el => elementHTML(el, createData)).join('');
  scalePreviewTo(pageEl, preset.page.width, preset.page.height);
}

// ---------- projects (connected to the preset that generated them) ----------
async function recordProject(preset){
  const project = {
    id: newId('project'),
    dbId: null,
    projectName: createData.projectName,
    location: createData.location,
    clientName: createData.clientName,
    projectImage: createData.projectImage,
    presetId: preset.id,
    presetName: preset.name,
    presetSnapshot: { page: JSON.parse(JSON.stringify(preset.page)), elements: JSON.parse(JSON.stringify(preset.elements)) },
    createdAt: new Date().toISOString()
  };
  projects.unshift(project);
  saveToStorage(LS_KEYS.projects, projects);
  renderProjectsList();
  if(db){
    try{
      let hostedUrl = null;
      if(createData.projectImageFile) hostedUrl = await uploadCoverImage(createData.projectImageFile, 'projects');
      const row = {
        project_name: project.projectName,
        location: project.location,
        client_name: project.clientName,
        preset_id: preset.id,
        preset_name: project.presetName,
        preset_snapshot: project.presetSnapshot,
        project_image_url: hostedUrl,
        owner_id: currentUserId()
      };
      const { data, error } = await db.from('projects').insert(row).select().single();
      if(error) throw error;
      project.dbId = data.id;
      if(hostedUrl){ project.projectImagePath = hostedUrl; project.projectImage = await signedCoverImageUrl(hostedUrl); }
      saveToStorage(LS_KEYS.projects, projects);
    }catch(err){
      console.warn('Could not save this project to the database; it will only exist on this device.', err);
    }
  }
  return project;
}
function renderProjectsList(){
  const box = document.getElementById('projectsList');
  if(!box) return;
  if(!projects.length){
    box.innerHTML = `<p class="hint">Generated projects appear here, linked to the preset that produced them.</p>`;
    return;
  }
  box.innerHTML = projects.map(p => `
    <div class="project-row">
      <div class="project-row-name">${escapeHtml(p.projectName || 'Untitled')}</div>
      <div class="project-row-meta">${escapeHtml(p.presetName)} · ${new Date(p.createdAt).toLocaleDateString()}</div>
      <div class="row-btns">
        <button class="btn small" onclick="reprintProject('${p.id}')">Reprint</button>
        <button class="btn small danger" onclick="deleteProject('${p.id}')">Delete</button>
      </div>
    </div>`).join('');
}
function reprintProject(id){
  const p = projects.find(pr => pr.id === id);
  if(!p) return;
  const pageEl = document.getElementById('projectPage');
  const data = { projectName:p.projectName, location:p.location, clientName:p.clientName, projectImage:p.projectImage };
  // uses the frozen snapshot, not the live preset — a later edit to the
  // preset shouldn't silently change how an already-generated cover reprints
  pageEl.innerHTML = p.presetSnapshot.elements.map(el => elementHTML(el, data)).join('');
  scalePreviewTo(pageEl, p.presetSnapshot.page.width, p.presetSnapshot.page.height);
  updatePrintStyle(p.presetSnapshot.page.width, p.presetSnapshot.page.height);
  window.print();
}
async function deleteProject(id){
  const project = projects.find(p => p.id === id);
  projects = projects.filter(p => p.id !== id);
  saveToStorage(LS_KEYS.projects, projects);
  renderProjectsList();
  if(db && project){
    if(project.dbId){
      const { error } = await db.from('projects').delete().eq('id', project.dbId);
      if(error) console.warn('Could not delete project from the database', error);
    }
    await deleteCoverImage(project.projectImagePath);
  }
}
function generateCover(){
  const preset = getSelectedPreset();
  if(!preset) return;
  recordProject(preset);
  updatePrintStyle(preset.page.width, preset.page.height);
  window.print();
}

// ---------- tabs ----------
function getActiveTab(){
  return document.getElementById('viewCreate').style.display === 'none' ? 'editor' : 'create';
}
function switchTab(tab){
  document.getElementById('viewEditor').style.display = tab === 'editor' ? 'flex' : 'none';
  document.getElementById('viewCreate').style.display = tab === 'create' ? 'flex' : 'none';
  document.getElementById('tabBtnEditor').classList.toggle('active', tab === 'editor');
  document.getElementById('tabBtnCreate').classList.toggle('active', tab === 'create');
  document.getElementById('editorTopbarActions').style.display = tab === 'editor' ? 'flex' : 'none';
  if(tab === 'editor'){
    render();
    updatePrintStyle();
  } else {
    refreshPresetSelect();
    renderCreatePreview();
    renderProjectsList();
    const preset = getSelectedPreset();
    if(preset) updatePrintStyle(preset.page.width, preset.page.height);
  }
}

// ---------- rulers ----------
function buildRulerLabels(){
  const top = document.getElementById('rulerTop');
  const left = document.getElementById('rulerLeft');
  top.innerHTML = '';
  left.innerHTML = '';
  for(let mm = 0; mm <= state.page.width; mm += 50){
    const s = document.createElement('span');
    s.className = 'ruler-label'; s.style.left = mm + 'mm'; s.style.top = '2px'; s.textContent = mm;
    top.appendChild(s);
  }
  for(let mm = 0; mm <= state.page.height; mm += 50){
    const s = document.createElement('span');
    s.className = 'ruler-label'; s.style.top = mm + 'mm'; s.style.left = '2px'; s.textContent = mm;
    left.appendChild(s);
  }
}

// ---------- init ----------
document.getElementById('data-projectName').value = state.data.projectName;
document.getElementById('data-location').value = state.data.location;
document.getElementById('data-clientName').value = state.data.clientName;
document.getElementById('cp-projectName').value = createData.projectName;
document.getElementById('cp-location').value = createData.location;
document.getElementById('cp-clientName').value = createData.clientName;

const cpDropzoneEl = document.getElementById('cpDropzone');
cpDropzoneEl.addEventListener('dragover', e => { e.preventDefault(); cpDropzoneEl.classList.add('dragover'); });
cpDropzoneEl.addEventListener('dragleave', () => cpDropzoneEl.classList.remove('dragover'));
cpDropzoneEl.addEventListener('drop', e => {
  e.preventDefault();
  cpDropzoneEl.classList.remove('dragover');
  const f = e.dataTransfer.files[0];
  if(f) onCreatePhotoSelected(f);
});

document.querySelector('.canvas-wrapper').addEventListener('wheel', onCanvasWheel, { passive:false });

applyPageCSSVars();
updatePrintStyle();
updatePageSub();
syncPageSizeSelect();
buildRulerLabels();
refreshUndoRedoButtons();
render();
syncZoomLayout();

async function initFromDatabase(runId){
  if(db && (!currentSession || (runId && runId !== databaseInitRun))) return;
  if(!db){
    console.warn('Supabase is not configured (check supabase-config.js); staying on local-only storage.');
    if(!presets.length) seedDefaultPreset();
    finishDataInit();
    return;
  }
  try{
    const [presetRes, brandRes, projectRes] = await Promise.all([
      db.from('presets').select('*').order('created_at', { ascending:false }),
      db.from('brand_images').select('*').order('created_at', { ascending:false }),
      db.from('projects').select('*').order('created_at', { ascending:false })
    ]);
    if(runId && runId !== databaseInitRun) return;
    if(presetRes.error) throw presetRes.error;
    if(brandRes.error) throw brandRes.error;
    if(projectRes.error) throw projectRes.error;

    presets = presetRes.data.map(presetFromRow);
    brandImages = await Promise.all(brandRes.data.map(async row => {
      const image = brandImageFromRow(row);
      image.dataUrl = await signedCoverImageUrl(image.storagePath);
      return image;
    }));
    projects = await Promise.all(projectRes.data.map(async row => {
      const project = projectFromRow(row);
      project.projectImage = await signedCoverImageUrl(project.projectImagePath);
      return project;
    }));

    if(!presets.length){
      seedDefaultPreset();
      const { data, error } = await db.from('presets').insert(presetToRow(presets[0])).select().single();
      if(!error) presets[0] = presetFromRow(data);
    }

    saveToStorage(LS_KEYS.presets, presets);
    saveToStorage(LS_KEYS.brandImages, brandImages);
    saveToStorage(LS_KEYS.projects, projects);
  }catch(err){
    console.warn('Could not reach the database; falling back to the last locally cached data.', err);
    if(!presets.length) seedDefaultPreset();
  }
  finishDataInit();
}
function finishDataInit(){
  renderSavedPresetsList();
  renderBrandList();
  renderProjectsList();
  refreshPresetSelect();
  renderCreatePreview();
  render();
  switchTab('create');
}

function showAuthGate(){
  document.getElementById('authGate').style.display = 'flex';
  document.getElementById('appShell').style.display = 'none';
}
function showAppShell(session){
  document.getElementById('authGate').style.display = 'none';
  document.getElementById('appShell').style.display = '';
  const emailLabel = document.getElementById('authUserEmail');
  if(emailLabel) emailLabel.textContent = session && session.user && session.user.email || '';
}
async function handleSignIn(){
  const errorEl = document.getElementById('authError');
  const button = document.getElementById('authSubmitBtn');
  errorEl.textContent = '';
  const email = document.getElementById('authEmail').value.trim();
  const password = document.getElementById('authPassword').value;
  if(!email || !password){ errorEl.textContent = 'Enter your email and password.'; return; }
  button.disabled = true;
  button.textContent = 'Signing in...';
  const { error } = await db.auth.signInWithPassword({ email, password });
  button.disabled = false;
  button.textContent = 'Sign in';
  if(error) errorEl.textContent = error.message;
}
async function handleSignOut(){
  if(db) await db.auth.signOut();
}

if(db){
  showAuthGate();
  db.auth.onAuthStateChange((event, session) => {
    currentSession = session;
    databaseInitRun++;
    if(session){
      showAppShell(session);
      if(event === 'INITIAL_SESSION' || event === 'SIGNED_IN') initFromDatabase(databaseInitRun);
    } else {
      showAuthGate();
    }
  });
} else {
  showAppShell(null);
  initFromDatabase();
}