// src/page-config.js — Page size, orientation, CSS vars, rulers, and print styles
import { state, PAGE_SIZES, pushUndo, clamp, round1, heightOf } from './state/state.js';
import { centerZoomedPage } from './canvas/zoom.js';

export function applyPageCSSVars(){
  document.documentElement.style.setProperty('--page-w', state.page.width + 'mm');
  document.documentElement.style.setProperty('--page-h', state.page.height + 'mm');
}

export function applyPageFill(){
  const page = document.getElementById('page');
  if(page) page.style.backgroundColor = state.page.fill || '#ffffff';
  const input = document.getElementById('pageFillInput');
  if(input) input.value = state.page.fill || '#ffffff';
  const value = document.getElementById('pageFillValue');
  if(value) value.textContent = state.page.fill || '#ffffff';
}

export function setPageFill(value){
  if(!/^#[0-9a-f]{6}$/i.test(value)) return;
  pushUndo();
  state.page.fill = value;
  applyPageFill();
  if(window.renderCreatePreview) window.renderCreatePreview();
  if(window.updateSchemaView) window.updateSchemaView();
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
  const corner = document.querySelector('.ruler-corner');
  if(!top || !left) return;
  top.innerHTML = '';
  left.innerHTML = '';
  if(corner) corner.textContent = 'mm | cm | in';

  const addMajorTick = (container, position, axis) => {
    const tick = document.createElement('span');
    tick.className = 'ruler-tick major';
    if(axis === 'x') tick.style.left = position + 'mm';
    else tick.style.top = position + 'mm';
    container.appendChild(tick);

    const label = document.createElement('span');
    label.className = 'ruler-label';
    if(axis === 'x'){
      label.style.left = position + 'mm';
      label.style.top = '2px';
      const cm = position / 10;
      const inch = position / 25.4;
      const text = position % 50 === 0 ? `${position} mm` : (position % 10 === 0 ? `${cm} cm` : '');
      label.textContent = text || (position % 25.4 < 0.5 ? `${inch.toFixed(1)} in` : '');
    } else {
      label.style.top = position + 'mm';
      label.style.left = '2px';
      const cm = position / 10;
      const inch = position / 25.4;
      const text = position % 50 === 0 ? `${position} mm` : (position % 10 === 0 ? `${cm} cm` : '');
      label.textContent = text || (position % 25.4 < 0.5 ? `${inch.toFixed(1)} in` : '');
    }
    if(label.textContent) container.appendChild(label);
  };

  for(let mm = 0; mm <= state.page.width; mm += 1){
    const tick = document.createElement('span');
    tick.className = 'ruler-tick';
    tick.style.left = mm + 'mm';
    if(mm % 10 === 0) tick.classList.add('major');
    else if(mm % 5 === 0) tick.classList.add('mid');
    top.appendChild(tick);
    if(mm % 10 === 0) addMajorTick(top, mm, 'x');
  }
  for(let mm = 0; mm <= state.page.height; mm += 1){
    const tick = document.createElement('span');
    tick.className = 'ruler-tick';
    tick.style.top = mm + 'mm';
    if(mm % 10 === 0) tick.classList.add('major');
    else if(mm % 5 === 0) tick.classList.add('mid');
    left.appendChild(tick);
    if(mm % 10 === 0) addMajorTick(left, mm, 'y');
  }
}

export function syncPageConfig(){
  applyPageCSSVars();
  applyPageFill();
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
