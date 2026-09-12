// src/canvas/dom-render.js — DOM element rendering, HTML generation, and style sync
import { state, getEl, round1, clamp, heightOf, escapeHtml, sanitizeImageSrc, brandImages, konvaLayer, konvaTransformer, konvaStage, setKonvaStage, setKonvaLayer, setKonvaGuideLayer, setKonvaTransformer } from '../state/state.js';
import { getPxPerMm, syncZoomLayout } from './zoom.js';
import { mmToPx } from './snapping.js';
import { renderKonva, cancelInteraction, updateKonvaNodePosition } from './konva-render.js';
import { getIconPath } from '../icons/icons.js';

export function rectFill(el){ return el.fill || '#ffffff'; }
export function rectStroke(el){ return el.stroke || '#171614'; }
export function lineStroke(el){ return el.stroke || '#171614'; }
export function lineWidth(el){ return Number.isFinite(el.strokeWidth) ? el.strokeWidth : 1; }

// Builds the CSS text for optional typography overrides on a text element.
// Anything left unset here falls back to the variant's CSS class default.
function textTypographyCSS(el){
  const familyMap = {
    sans: 'var(--font-sans)',
    display: 'var(--font-display)',
    'serif-alt': 'var(--font-serif-alt)',
    mono: 'var(--font-mono)',
    gothic: 'var(--font-gothic)',
    'century-gothic': 'var(--font-gothic)',
    script: 'var(--font-script)'
  };
  const familyVar = familyMap[el.fontFamily] || '';
  let css = '';
  if(familyVar) css += `font-family:${familyVar};`;
  if(el.italic) css += `font-style:italic;`;
  if(el.underline) css += `text-decoration:underline;`;
  if(Number.isFinite(el.letterSpacing)) css += `letter-spacing:${el.letterSpacing}em;`;
  if(Number.isFinite(el.lineHeight)) css += `line-height:${el.lineHeight};`;
  if(el.textTransform && el.textTransform !== 'none') css += `text-transform:${el.textTransform};`;
  if(el.color) css += `color:${el.color};`;
  return css;
}

export function resolveImageFade(el){
  if(!el || !el.fade) return null;
  return {
    angle: Number.isFinite(el.fadeAngle) ? el.fadeAngle : 180,
    from: Number.isFinite(el.fadeFrom) ? el.fadeFrom : 1,
    to: Number.isFinite(el.fadeTo) ? el.fadeTo : 0
  };
}

export function imageFadeGradient(el){
  const fade = resolveImageFade(el);
  if(!fade) return '';
  return `linear-gradient(${fade.angle}deg, rgba(0,0,0,${fade.from}) 0%, rgba(0,0,0,${fade.to}) 100%)`;
}

export function resolveImageSrc(el, dataSource, options){
  const forPrint = options && options.forPrint;
  if(el.role === 'logo'){
    const brand = brandImages.find(b => b.id === el.logoRef);
    return brand ? sanitizeImageSrc(brand.dataUrl) : null;
  }
  const src = el.field ? ((dataSource || state.data)[el.field] || el.src) : el.src;
  if(forPrint && el.printSrc) return sanitizeImageSrc(el.printSrc);
  return sanitizeImageSrc(src);
}

export async function resolvePrintImages(elements){
  const toResolve = elements.filter(el => el.type === 'image' && el.originalPath);
  if(!toResolve.length) return;                         // nothing to do — skip network call
  const { signedCoverImageUrl } = await import('../data/supabase-client.js');
  await Promise.all(
    toResolve.map(async el => {
      try{ el.printSrc = await signedCoverImageUrl(el.originalPath); }
      catch(err){ console.warn('Could not resolve print image for', el.id, err); }
    })
  );
}

export function elementHTML(el, dataSource, options){
  dataSource = dataSource || state.data;
  const flip = `scale(${el.flipX ? -1 : 1},${el.flipY ? -1 : 1})`;
  const style = `left:${el.x}mm;top:${el.y}mm;width:${el.width}mm;` + (el.type !== 'line' ? `height:${el.height}mm;` : '') + `opacity:${Number.isFinite(el.opacity) ? el.opacity : 1};transform:rotate(${Number(el.rotation) || 0}deg) ${flip};transform-origin:center;`;
  if(el.type === 'text'){
    const value = el.field ? (dataSource[el.field] || '') : (el.content || '');
    const text = (el.prefix || '') + value;
    const variantClass = el.variant === 'display' ? 'el-text--display' : el.variant === 'label' ? 'el-text--label' : '';
    return `<div class="element el-text ${variantClass}" data-id="${el.id}" style="${style}font-size:${el.fontSize}px;font-weight:${el.weight};text-align:${el.align};${textTypographyCSS(el)}">${escapeHtml(text)}</div>`;
  }
  if(el.type === 'image'){
    const src = resolveImageSrc(el, dataSource, options);
    const gradient = imageFadeGradient(el);
    const fadeStyle = gradient ? `mask-image:${gradient};-webkit-mask-image:${gradient};mask-mode:alpha;-webkit-mask-mode:alpha;` : '';
    if(src){
      const alt = el.role === 'logo' ? 'Company logo' : 'Project photo';
      return `<div class="element el-image" data-id="${escapeHtml(el.id)}" data-role="${escapeHtml(el.role||'photo')}" style="${style}${fadeStyle}"><img src="${escapeHtml(src)}" alt="${escapeHtml(alt)}" draggable="false"></div>`;
    }
    const label = el.role === 'logo' ? 'Pick a logo in the inspector' : 'Click to add image';
    return `<div class="element el-image el-image-empty" data-id="${el.id}" data-role="${el.role||'photo'}" style="${style}"><span class="no-print">${label}</span></div>`;
  }
  if(el.type === 'line') return `<div class="element el-line" data-id="${el.id}" style="${style}border-top-color:${lineStroke(el)};border-top-width:${lineWidth(el)}px;"></div>`;
  if(el.type === 'rect') return `<div class="element el-rect" data-id="${el.id}" style="${style}"><svg aria-hidden="true" width="100%" height="100%" viewBox="0 0 100 100" preserveAspectRatio="none"><rect x="0" y="0" width="100" height="100" fill="${escapeHtml(rectFill(el))}" stroke="${escapeHtml(rectStroke(el))}" stroke-width="${Number(el.strokeWidth) || 1}" vector-effect="non-scaling-stroke" stroke-linejoin="${el.lineJoin || 'miter'}"></rect></svg></div>`;
  if(el.type === 'circle') return `<div class="element el-circle" data-id="${el.id}" style="${style}"><svg aria-hidden="true" width="100%" height="100%" viewBox="0 0 100 100" preserveAspectRatio="none"><ellipse cx="50" cy="50" rx="50" ry="50" fill="${escapeHtml(rectFill(el))}" stroke="${escapeHtml(rectStroke(el))}" stroke-width="${Number(el.strokeWidth) || 1}" vector-effect="non-scaling-stroke"></ellipse></svg></div>`;
  if(el.type === 'icon'){
    const pathD = getIconPath(el.icon);
    const fill = el.filled ? (el.color || '#171614') : 'none';
    const stroke = el.color || '#171614';
    const strokeWidth = Number.isFinite(el.strokeWidth) ? el.strokeWidth : 2;
    return `<div class="element el-icon" data-id="${escapeHtml(el.id)}" style="${style}"><svg aria-hidden="true" width="100%" height="100%" viewBox="0 0 24 24" preserveAspectRatio="none" fill="${escapeHtml(fill)}" stroke="${escapeHtml(stroke)}" stroke-width="${strokeWidth}" stroke-linecap="round" stroke-linejoin="round"><path d="${escapeHtml(pathD)}"></path></svg></div>`;
  }
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
  page.style.backgroundColor = state.page.fill || '#ffffff';
  page.classList.add('konva-editor-active');
  renderKonva();
  syncZoomLayout();
}

export function fitTextHeightToContent(el, node){
  const measuredMm = fitTextNodeHeight(node, getPxPerMm());
  if(measuredMm == null) return;
  el.height = measuredMm;
}

export function fitTextNodeHeight(node, pxPerMm){
  if(!node || !Number.isFinite(pxPerMm) || pxPerMm <= 0) return null;
  const prevInlineHeight = node.style.height;
  node.style.height = 'auto';
  const measuredMm = round1(Math.max(5, node.scrollHeight / pxPerMm));
  node.style.height = prevInlineHeight;
  node.style.height = measuredMm + 'mm';
  return measuredMm;
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
  if(el.type === 'image'){
    const gradient = imageFadeGradient(el);
    node.style.maskImage = gradient;
    node.style.webkitMaskImage = gradient;
  }
  if(el.type === 'icon'){
    const svg = node.querySelector('svg');
    const path = node.querySelector('path');
    if(svg && path){
      path.setAttribute('d', getIconPath(el.icon));
      svg.setAttribute('fill', el.filled ? (el.color || '#171614') : 'none');
      svg.setAttribute('stroke', el.color || '#171614');
      svg.setAttribute('stroke-width', Number.isFinite(el.strokeWidth) ? el.strokeWidth : 2);
    }
  }
  if(el.type === 'line'){
    node.style.borderTopColor = lineStroke(el);
    node.style.borderTopWidth = lineWidth(el) + 'px';
  }
  if(el.type === 'text'){
    node.style.fontSize = el.fontSize + 'px';
    node.style.fontWeight = el.weight;
    node.style.textAlign = el.align;
    const familyMap = {
      sans: 'var(--font-sans)',
      display: 'var(--font-display)',
      'serif-alt': 'var(--font-serif-alt)',
      mono: 'var(--font-mono)',
      gothic: 'var(--font-gothic)',
      'century-gothic': 'var(--font-gothic)',
      script: 'var(--font-script)'
    };
    node.style.fontFamily = familyMap[el.fontFamily] || '';
    node.style.fontStyle = el.italic ? 'italic' : '';
    node.style.textDecoration = el.underline ? 'underline' : '';
    node.style.letterSpacing = Number.isFinite(el.letterSpacing) ? el.letterSpacing + 'em' : '';
    node.style.lineHeight = Number.isFinite(el.lineHeight) ? el.lineHeight : '';
    node.style.textTransform = (el.textTransform && el.textTransform !== 'none') ? el.textTransform : '';
    node.style.color = el.color || '';
    if(document.activeElement !== node){
      const value = el.field ? (state.data[el.field] || '') : (el.content || '');
      node.textContent = (el.prefix || '') + value;
    }
    if(el.autoHeight) fitTextHeightToContent(el, node);
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
    if(konvaLayer){
      konvaLayer.find('Transformer').forEach(tr => tr.update());
      konvaLayer.batchDraw();
    }
  } else {
    renderKonva();
  }
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
    if(!node || document.activeElement === node) return;
    node.textContent = (e.prefix || '') + (state.data[field] || '');
    if(e.autoHeight) fitTextHeightToContent(e, node);
  });
}