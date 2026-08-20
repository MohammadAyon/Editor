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

const state = {
  page: { size:'A4', orientation:'portrait', width: 210, height: 297 },
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
const createData = { projectName:'Riverside Residence', location:'Chattogram, Bangladesh', clientName:'John Smith', projectImage:null };

let interaction = null;
let suppressClick = false;
let guideVEl = null, guideHEl = null;
let undoStack = [], redoStack = [];
let lastEditKey = null, lastEditTime = 0;

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
}
function syncPageSizeSelect(){
  const sel = document.getElementById('pageSizeSelect');
  if(sel) sel.value = state.page.size + '-' + state.page.orientation;
}

// ---------- helpers ----------
function getEl(id){ return state.elements.find(e => e.id === id); }
function clamp(v,min,max){ return Math.max(min, Math.min(max, v)); }
function round1(v){ return Math.round(v*10)/10; }
function escapeHtml(s){ return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;'); }
function getPxPerMm(){ return document.getElementById('page').getBoundingClientRect().width / state.page.width; }

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
    return brand ? brand.dataUrl : null;
  }
  return el.field ? ((dataSource || state.data)[el.field] || el.src) : el.src;
}
function elementHTML(el, dataSource){
  dataSource = dataSource || state.data;
  const style = `left:${el.x}mm;top:${el.y}mm;width:${el.width}mm;` + (el.type !== 'line' ? `height:${el.height}mm;` : '');
  if(el.type === 'text'){
    const value = el.field ? (dataSource[el.field] || '') : (el.content || '');
    const text = (el.prefix || '') + value;
    const variantClass = el.variant === 'display' ? 'el-text--display' : el.variant === 'label' ? 'el-text--label' : '';
    return `<div class="element el-text ${variantClass}" data-id="${el.id}" style="${style}font-size:${el.fontSize}px;font-weight:${el.weight};text-align:${el.align};">${escapeHtml(text)}</div>`;
  }
  if(el.type === 'image'){
    const src = resolveImageSrc(el, dataSource);
    if(src) return `<div class="element el-image" data-id="${el.id}" data-role="${el.role||'photo'}" style="${style}"><img src="${src}" draggable="false"></div>`;
    const label = el.role === 'logo' ? 'Pick a logo in the inspector' : 'Click to add image';
    return `<div class="element el-image el-image-empty" data-id="${el.id}" data-role="${el.role||'photo'}" style="${style}"><span class="no-print">${label}</span></div>`;
  }
  if(el.type === 'line') return `<div class="element el-line" data-id="${el.id}" style="${style}"></div>`;
  if(el.type === 'rect') return `<div class="element el-rect" data-id="${el.id}" style="${style}"></div>`;
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
  guideVEl = null; guideHEl = null;
  document.getElementById('page').innerHTML = state.elements.map(el => elementHTML(el)).join('') + overlayHTML();
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
      if(el.role === 'logo'){
        html += `<div class="field"><label>Logo</label>
          <select onchange="updateProp('${el.id}','logoRef',this.value)">
            ${brandImages.length
              ? brandImages.map(b => `<option value="${b.id}" ${b.id===el.logoRef?'selected':''}>${escapeHtml(b.name)}</option>`).join('')
              : '<option value="">Upload a logo in Brand assets first</option>'}
          </select>
        </div>`;
      } else {
        if(el.field) html += `<div class="bound-note">Bound to data field <strong>${el.field}</strong> — the photo uploaded on Create Project fills this slot.</div>`;
        if(el.src) html += `<button class="btn small" style="margin-top:6px" onclick="updateProp('${el.id}','src',null)">Remove editor preview image</button>`;
      }
    }
    html += `
      <div class="row-btns" style="margin-top:14px">
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
  if(prop === 'src' || prop === 'variant' || prop === 'logoRef'){ renderPage(); renderInspector(); }
  else applyElementStyle(id);
  updateSchemaView();
}
function onDataInput(field, value){
  state.data[field] = value;
  updateBoundElementsContent(field);
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
  if(type === 'line') el = { id:newId('el'), type:'line', x:20, y:20, width:100, height:0 };
  if(type === 'rect') el = { id:newId('el'), type:'rect', x:20, y:20, width:60, height:40 };
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
  const threshold = 1.5;
  const w = el.width, h = heightOf(el);
  const exclude = new Set(excludeIds || [el.id]);
  const candX = [0, state.page.width / 2, state.page.width];
  const candY = [0, state.page.height / 2, state.page.height];
  state.elements.forEach(o => {
    if(exclude.has(o.id)) return;
    candX.push(o.x, o.x + o.width / 2, o.x + o.width);
    candY.push(o.y, o.y + heightOf(o) / 2, o.y + heightOf(o));
  });
  let snapX = null, guideX = null;
  outerX:
  for(const c of candX){
    const checks = [ {edge:'left', val:proposedX}, {edge:'center', val:proposedX + w/2}, {edge:'right', val:proposedX + w} ];
    for(const chk of checks){
      if(Math.abs(chk.val - c) < threshold){
        snapX = chk.edge === 'left' ? c : chk.edge === 'center' ? c - w/2 : c - w;
        guideX = c;
        break outerX;
      }
    }
  }
  let snapY = null, guideY = null;
  outerY:
  for(const c of candY){
    const checks = [ {edge:'top', val:proposedY}, {edge:'center', val:proposedY + h/2}, {edge:'bottom', val:proposedY + h} ];
    for(const chk of checks){
      if(Math.abs(chk.val - c) < threshold){
        snapY = chk.edge === 'top' ? c : chk.edge === 'center' ? c - h/2 : c - h;
        guideY = c;
        break outerY;
      }
    }
  }
  return { x:snapX, y:snapY, guideX, guideY };
}
function showGuideV(xmm){
  if(!guideVEl){ guideVEl = document.createElement('div'); guideVEl.className = 'snap-guide snap-guide-v no-print'; document.getElementById('page').appendChild(guideVEl); }
  guideVEl.style.left = xmm + 'mm';
  guideVEl.style.height = state.page.height + 'mm';
  guideVEl.style.display = 'block';
}
function hideGuideV(){ if(guideVEl) guideVEl.style.display = 'none'; }
function showGuideH(ymm){
  if(!guideHEl){ guideHEl = document.createElement('div'); guideHEl.className = 'snap-guide snap-guide-h no-print'; document.getElementById('page').appendChild(guideHEl); }
  guideHEl.style.top = ymm + 'mm';
  guideHEl.style.width = state.page.width + 'mm';
  guideHEl.style.display = 'block';
}
function hideGuideH(){ if(guideHEl) guideHEl.style.display = 'none'; }

// ---------- drag / resize / marquee ----------
function onPageMouseDown(e){
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
    const startXmm = (e.clientX - pageRect.left) / pxPerMm;
    const startYmm = (e.clientY - pageRect.top) / pxPerMm;
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
    interaction.curXmm = (e.clientX - pageRect.left) / pxPerMm;
    interaction.curYmm = (e.clientY - pageRect.top) / pxPerMm;
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
    const dxRaw = (e.clientX - interaction.startClientX) / pxPerMm;
    const dyRaw = (e.clientY - interaction.startClientY) / pxPerMm;
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
      const nx = clamp(start.x + dxRaw + snapDX, 0, state.page.width - el.width);
      const ny = clamp(start.y + dyRaw + snapDY, 0, state.page.height - heightOf(el));
      el.x = round1(nx); el.y = round1(ny);
      applyElementStyle(id);
    });
    updateSchemaView();
    if(snap.guideX != null) showGuideV(snap.guideX); else hideGuideV();
    if(snap.guideY != null) showGuideH(snap.guideY); else hideGuideH();

  } else if(interaction.mode === 'resize'){
    const el = getEl(interaction.id);
    if(!el) return;
    const dx = (e.clientX - interaction.startClientX) / pxPerMm;
    const dy = (e.clientY - interaction.startClientY) / pxPerMm;
    el.width = round1(clamp(interaction.startW + dx, 5, state.page.width - el.x));
    if(el.type !== 'line') el.height = round1(clamp(interaction.startH + dy, 5, state.page.height - el.y));
    applyElementStyle(el.id);
    updateSchemaView();
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
  if(e.key === 'Escape' && !typing){ clearSelection(); return; }
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
      el.x = round1(clamp(el.x + dx, 0, state.page.width - el.width));
      el.y = round1(clamp(el.y + dy, 0, state.page.height - heightOf(el)));
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
  const reader = new FileReader();
  reader.onload = () => {
    // readAsDataURL preserves the source file's bytes as-is, so PNG alpha
    // transparency survives untouched — no canvas re-encode that could flatten it.
    uploadBrandImage(name, reader.result);
    input.value = '';
  };
  reader.readAsDataURL(file);
}
function uploadBrandImage(name, dataUrl){
  const img = { id: newId('brand/logo'), name, dataUrl };
  brandImages.push(img);
  if(!saveToStorage(LS_KEYS.brandImages, brandImages)){
    alert('Logo added for this session, but local storage is full so it may not persist after reload.');
  }
  renderBrandList();
  renderPage();
  renderInspector();
  return img;
}
function deleteBrandImage(id){
  brandImages = brandImages.filter(b => b.id !== id);
  saveToStorage(LS_KEYS.brandImages, brandImages);
  renderBrandList();
  renderPage();
  renderInspector();
}
function renderBrandList(){
  const box = document.getElementById('brandList');
  if(!box) return;
  box.innerHTML = brandImages.map(b => `
    <div class="brand-row">
      <img class="brand-thumb" src="${b.dataUrl}">
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
      if(Array.isArray(obj.elements)) state.elements = obj.elements;
      state.selectedIds = new Set();
      render();
    }catch(err){ alert('Could not read that template file: ' + err.message); }
  };
  reader.readAsText(file);
}

// ---------- preset library (persisted) ----------
function seedDefaultPreset(){
  presets.push({ id:newId('preset'), name:'A4 Architecture Cover', clientName: state.data.clientName, page: JSON.parse(JSON.stringify(state.page)), elements: JSON.parse(JSON.stringify(state.elements)) });
}
function saveCurrentAsPreset(){
  const name = prompt('Name this preset:', 'Untitled preset');
  if(!name) return;
  presets.push({ id:newId('preset'), name, clientName: state.data.clientName, page: JSON.parse(JSON.stringify(state.page)), elements: JSON.parse(JSON.stringify(state.elements)) });
  if(!saveToStorage(LS_KEYS.presets, presets)){
    alert('Preset added for this session, but local storage is full so it may not persist after reload.');
  }
  renderSavedPresetsList();
  refreshPresetSelect();
  const sel = document.getElementById('cpPresetSelect');
  if(sel) sel.value = String(presets.length - 1);
  renderCreatePreview();
  alert(`Saved "${name}" — it's now selectable on the Create project tab.`);
}
function deletePreset(id){
  presets = presets.filter(p => p.id !== id);
  saveToStorage(LS_KEYS.presets, presets);
  renderSavedPresetsList();
  refreshPresetSelect();
  renderCreatePreview();
}
function renderSavedPresetsList(){
  const box = document.getElementById('savedPresetsList');
  if(!box) return;
  box.innerHTML = presets.map(p => `
    <div class="brand-row">
      <span class="brand-name">${escapeHtml(p.name)}${p.clientName ? ` · ${escapeHtml(p.clientName)}` : ''}</span>
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
  zone.innerHTML = createData.projectImage
    ? `<img src="${createData.projectImage}"><div class="replace-hint">Click to replace</div>`
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
function recordProject(preset){
  const project = {
    id: newId('project'),
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
  if(!saveToStorage(LS_KEYS.projects, projects)){
    alert('Project generated, but local storage is full so it may not persist after reload.');
  }
  renderProjectsList();
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
function deleteProject(id){
  projects = projects.filter(p => p.id !== id);
  saveToStorage(LS_KEYS.projects, projects);
  renderProjectsList();
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

if(!presets.length) seedDefaultPreset();
saveToStorage(LS_KEYS.presets, presets);
renderSavedPresetsList();
renderBrandList();
renderProjectsList();
refreshPresetSelect();
applyPageCSSVars();
updatePrintStyle();
updatePageSub();
syncPageSizeSelect();
buildRulerLabels();
refreshUndoRedoButtons();
render();
