// src/template-io.js — Template JSON import and export, normalization, and sanitization
import { state, PAGE_SIZES, newId, advanceIdCounter, clamp, sanitizeImageSrc, pushUndo } from './state/state.js';
import { syncPageConfig } from './page-config.js';

export function exportTemplate(){
  const blob = new Blob([JSON.stringify({ page: state.page, elements: state.elements }, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = 'template.json';
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

export function normalizeImportedPage(page){
  const size = page.size === 'A3' ? 'A3' : 'A4';
  const orientation = page.orientation === 'landscape' ? 'landscape' : 'portrait';
  const base = PAGE_SIZES[size];
  return {
    size,
    orientation,
    width: orientation === 'landscape' ? base.h : base.w,
    height: orientation === 'landscape' ? base.w : base.h
  };
}

export function normalizeImportedElement(raw){
  if(!raw || !['text','image','line','rect'].includes(raw.type)) return null;
  const element = { ...raw, id: newId('el'), type: raw.type };
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

export function importTemplateFile(file){
  const reader = new FileReader();
  reader.onload = () => {
    try{
      const obj = JSON.parse(reader.result);
      pushUndo();
      if(obj.page){
        state.page = Object.assign({ size: 'A4', orientation: 'portrait' }, obj.page);
        let matched = false;
        for(const [size, base] of Object.entries(PAGE_SIZES)){
          if(state.page.width === base.w && state.page.height === base.h){
            state.page.size = size; state.page.orientation = 'portrait'; matched = true; break;
          }
          if(state.page.width === base.h && state.page.height === base.w){
            state.page.size = size; state.page.orientation = 'landscape'; matched = true; break;
          }
        }
        if(!matched){ state.page.size = 'A4'; state.page.orientation = 'portrait'; }
        syncPageConfig();
      }
      if(Array.isArray(obj.elements)){
        state.elements = obj.elements.map(normalizeImportedElement).filter(Boolean);
      }
      advanceIdCounter(state.elements);
      state.selectedIds = new Set();
      if(window.render) window.render();
    }catch(err){
      alert('Could not read that template file: ' + err.message);
    }
  };
  reader.readAsText(file);
}
