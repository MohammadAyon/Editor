// src/page-config.js — Page size, orientation, CSS vars, rulers, and print styles
import { state, PAGE_SIZES, pushUndo, clamp, round1, heightOf } from './state/state.js';
import { centerZoomedPage } from './canvas/zoom.js';

export function applyPageCSSVars(){
  document.documentElement.style.setProperty('--page-w', state.page.width + 'mm');
  document.documentElement.style.setProperty('--page-h', state.page.height + 'mm');
}

export function updatePrintStyle(width, height){
  width = width || state.page.width; height = height || state.page.height;
  let tag = document.getElementById('dynamicPrintStyle');
  if(!tag){ tag = document.createElement('style'); tag.id = 'dynamicPrintStyle'; document.head.appendChild(tag); }
  tag.textContent = `@page{ size:${width}mm ${height}mm; margin:0; }`;
}

export function updatePageSub(){
  const orientLabel = state.page.orientation === 'landscape' ? 'Landscape' : 'Portrait';
  const sub = document.getElementById('pageSub');
  if(sub) sub.textContent = `${state.page.size} ${orientLabel} · ${state.page.width} × ${state.page.height}mm`;
}

export function syncPageSizeSelect(){
  const sel = document.getElementById('pageSizeSelect');
  if(sel) sel.value = state.page.size + '-' + state.page.orientation;
}

export function buildRulerLabels(){
  const top = document.getElementById('rulerTop');
  const left = document.getElementById('rulerLeft');
  if(!top || !left) return;
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

export function syncPageConfig(){
  applyPageCSSVars();
  updatePrintStyle();
  updatePageSub();
  syncPageSizeSelect();
  buildRulerLabels();
}

export function onPageSizeChange(value){
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
  syncPageConfig();
  if(window.render) window.render();
  centerZoomedPage();
  if(window.syncMobileLayout) window.syncMobileLayout({ fit: true });
}
