// src/canvas/dom-render.js — DOM element rendering, HTML generation, and style sync
import { state, getEl, round1, clamp, heightOf, escapeHtml, sanitizeImageSrc, brandImages, konvaLayer, konvaStage, setKonvaStage, setKonvaLayer, setKonvaGuideLayer, setKonvaTransformer } from '../state/state.js';
import { getPxPerMm, syncZoomLayout } from './zoom.js';
import { mmToPx } from './snapping.js';
import { renderKonva, cancelInteraction, updateKonvaNodePosition } from './konva-render.js';

export function rectFill(el){ return el.fill || '#ffffff'; }
export function rectStroke(el){ return el.stroke || '#171614'; }
export function lineStroke(el){ return el.stroke || '#171614'; }
export function lineWidth(el){ return Number.isFinite(el.strokeWidth) ? el.strokeWidth : 1; }

export function resolveImageSrc(el, dataSource){
  if(el.role === 'logo'){
    const brand = brandImages.find(b => b.id === el.logoRef);
    return brand ? sanitizeImageSrc(brand.dataUrl) : null;
  }
  return sanitizeImageSrc(el.field ? ((dataSource || state.data)[el.field] || el.src) : el.src);
}

export function elementHTML(el, dataSource){
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

export function overlayHTML(){
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

export function clampElementPosition(el){
  const node = konvaLayer && konvaLayer.findOne('#' + el.id);
  if(!node){
    el.x = round1(clamp(el.x, 0, Math.max(0, state.page.width - el.width)));
    el.y = round1(clamp(el.y, 0, Math.max(0, state.page.height - heightOf(el))));
    return;
  }

  const pxPerMm = getPxPerMm();
  const box = node.getClientRect({ skipStroke: false });
  const offsetXpx = box.x - node.x();
  const offsetYpx = box.y - node.y();

  const proposedCenterXpx = mmToPx(el.x + el.width / 2);
  const proposedCenterYpx = mmToPx(el.y + heightOf(el) / 2);
  const proposedBoxXpx = proposedCenterXpx + offsetXpx;
  const proposedBoxYpx = proposedCenterYpx + offsetYpx;

  const canvasWpx = mmToPx(state.page.width);
  const canvasHpx = mmToPx(state.page.height);
  const clampedBoxXpx = clamp(proposedBoxXpx, 0, Math.max(0, canvasWpx - box.width));
  const clampedBoxYpx = clamp(proposedBoxYpx, 0, Math.max(0, canvasHpx - box.height));

  const clampedCenterXpx = clampedBoxXpx - offsetXpx;
  const clampedCenterYpx = clampedBoxYpx - offsetYpx;

  el.x = round1(clampedCenterXpx / pxPerMm - el.width / 2);
  el.y = round1(clampedCenterYpx / pxPerMm - heightOf(el) / 2);
}

export function renderPage(){
  cancelInteraction();
  const page = document.getElementById('page');
  if(!page) return;
  if(konvaStage){
    konvaStage.destroy();
    setKonvaStage(null);
    setKonvaLayer(null);
    setKonvaGuideLayer(null);
    setKonvaTransformer(null);
  }
  page.innerHTML = state.elements.map(el => elementHTML(el)).join('') + overlayHTML();
  page.classList.add('konva-editor-active');
  renderKonva();
  syncZoomLayout();
}

export function applyElementStyle(id){
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
  }
  renderKonva();
}

export function updateSelectionBBox(){
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

export function syncInspectorNumbers(id){
  if(state.selectedIds.size !== 1 || !state.selectedIds.has(id)) return;
  const el = getEl(id);
  if(!el) return;
  const map = { x:'insp-x', y:'insp-y', width:'insp-w', height:'insp-h' };
  for(const [prop, domId] of Object.entries(map)){
    const input = document.getElementById(domId);
    if(input && document.activeElement !== input) input.value = round1(el[prop]);
  }
}

export function updateBoundElementsContent(field){
  state.elements.filter(e => e.type === 'text' && e.field === field).forEach(e => {
    const node = document.querySelector(`#page .element[data-id="${e.id}"]`);
    if(node && document.activeElement !== node) node.textContent = (e.prefix || '') + (state.data[field] || '');
  });
}
