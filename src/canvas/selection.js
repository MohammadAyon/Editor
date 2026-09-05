// src/canvas/selection.js — Selection manipulation, adding/deleting elements, aligning, and z-ordering
import { state, getEl, newId, round1, clamp, heightOf, pushUndo, brandImages } from '../state/state.js';
import { clampElementPosition } from './dom-render.js';

export function selectOnly(id){
  state.selectedIds = new Set([id]);
  if(window.render) window.render();
}

export function toggleSelect(id){
  const s = new Set(state.selectedIds);
  if(s.has(id)) s.delete(id); else s.add(id);
  state.selectedIds = s;
  if(window.render) window.render();
}

export function clearSelection(){
  if(state.selectedIds.size){
    state.selectedIds = new Set();
    if(window.render) window.render();
  }
}

export function selectAll(){
  state.selectedIds = new Set(state.elements.map(e => e.id));
  if(window.render) window.render();
}

export function addElement(type){
  pushUndo();
  let el;
  if(type === 'text') el = { id: newId('el'), type: 'text', field: null, content: 'New text', x: 20, y: 20, width: 60, height: 10, fontSize: 12, weight: 400, align: 'left', variant: 'body' };
  if(type === 'image') el = { id: newId('el'), type: 'image', role: 'photo', field: null, x: 20, y: 20, width: 60, height: 60, src: null, originalPath: null };
  if(type === 'logo') el = { id: newId('el'), type: 'image', role: 'logo', logoRef: brandImages.length ? brandImages[0].id : null, x: 20, y: 20, width: 40, height: 40 };
  if(type === 'line') el = { id: newId('el'), type: 'line', x: 20, y: Math.min(260, state.page.height - 20), width: 100, height: 0, stroke: '#171614', strokeWidth: 1 };
  if(type === 'rect') el = { id: newId('el'), type: 'rect', x: 20, y: 20, width: 60, height: 40, fill: '#ffffff', stroke: '#171614' };
  if(el){
    state.elements.push(el);
    state.selectedIds = new Set([el.id]);
    if(window.render) window.render();
  }
}

export function deleteSelection(){
  const ids = [...state.selectedIds];
  if(!ids.length) return;
  pushUndo();
  state.elements = state.elements.filter(e => !ids.includes(e.id));
  state.selectedIds = new Set();
  if(window.render) window.render();
}

export function duplicateSelection(){
  const ids = [...state.selectedIds];
  if(!ids.length) return;
  pushUndo();
  const offset = 6;
  const newIds = [];
  ids.forEach(id => {
    const el = getEl(id);
    if(!el) return;
    const clone = JSON.parse(JSON.stringify(el));
    clone.id = newId('el');
    clone.x = round1(clamp(clone.x + offset, 0, state.page.width - clone.width));
    clone.y = round1(clamp(clone.y + offset, 0, state.page.height - heightOf(clone)));
    state.elements.push(clone);
    newIds.push(clone.id);
  });
  state.selectedIds = new Set(newIds);
  if(window.render) window.render();
}

export function bringSelectionToFront(){
  const ids = [...state.selectedIds];
  if(!ids.length) return;
  pushUndo();
  const picked = state.elements.filter(e => ids.includes(e.id));
  state.elements = state.elements.filter(e => !ids.includes(e.id));
  state.elements.push(...picked);
  if(window.render) window.render();
}

export function sendSelectionToBack(){
  const ids = [...state.selectedIds];
  if(!ids.length) return;
  pushUndo();
  const picked = state.elements.filter(e => ids.includes(e.id));
  state.elements = state.elements.filter(e => !ids.includes(e.id));
  state.elements.unshift(...picked);
  if(window.render) window.render();
}

export function bringSelectionForward(){
  const ids = [...state.selectedIds];
  if(!ids.length) return;
  pushUndo();
  ids.forEach(id => {
    const index = state.elements.findIndex(e => e.id === id);
    if(index >= 0 && index < state.elements.length - 1){
      [state.elements[index], state.elements[index + 1]] = [state.elements[index + 1], state.elements[index]];
    }
  });
  if(window.render) window.render();
}

export function sendSelectionBackward(){
  const ids = [...state.selectedIds];
  if(!ids.length) return;
  pushUndo();
  [...ids].reverse().forEach(id => {
    const index = state.elements.findIndex(e => e.id === id);
    if(index > 0){
      [state.elements[index], state.elements[index - 1]] = [state.elements[index - 1], state.elements[index]];
    }
  });
  if(window.render) window.render();
}

export function centerSelectionH(){
  const ids = [...state.selectedIds];
  if(!ids.length) return;
  pushUndo();
  const elsArr = ids.map(getEl);
  const minX = Math.min(...elsArr.map(e => e.x)), maxX = Math.max(...elsArr.map(e => e.x + e.width));
  const shift = (state.page.width - (maxX - minX)) / 2 - minX;
  elsArr.forEach(el => { el.x = round1(el.x + shift); });
  if(window.render) window.render();
}

export function centerSelectionV(){
  const ids = [...state.selectedIds];
  if(!ids.length) return;
  pushUndo();
  const elsArr = ids.map(getEl);
  const minY = Math.min(...elsArr.map(e => e.y)), maxY = Math.max(...elsArr.map(e => e.y + heightOf(e)));
  const shift = (state.page.height - (maxY - minY)) / 2 - minY;
  elsArr.forEach(el => { el.y = round1(el.y + shift); });
  if(window.render) window.render();
}

export function alignSelection(mode){
  const ids = [...state.selectedIds];
  if(ids.length < 2) return;
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
  if(window.render) window.render();
}

export function distributeSelection(axis){
  const ids = [...state.selectedIds];
  if(ids.length < 3) return;
  pushUndo();
  const elsArr = ids.map(getEl);
  if(axis === 'h'){
    elsArr.sort((a,b) => a.x - b.x);
    const first = elsArr[0], last = elsArr[elsArr.length - 1];
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
    const first = elsArr[0], last = elsArr[elsArr.length - 1];
    const totalSpan = (last.y + heightOf(last)) - first.y;
    const totalHeight = elsArr.reduce((s,e) => s + heightOf(e), 0);
    const gap = (totalSpan - totalHeight) / (elsArr.length - 1);
    let cursor = first.y + heightOf(first) + gap;
    for(let i = 1; i < elsArr.length - 1; i++){
      elsArr[i].y = round1(cursor);
      cursor += heightOf(elsArr[i]) + gap;
    }
  }
  if(window.render) window.render();
}

export function flipSelection(axis){
  const ids = [...state.selectedIds];
  if(!ids.length) return;
  pushUndo();
  ids.forEach(id => {
    const el = getEl(id);
    if(!el) return;
    const prop = axis === 'x' ? 'flipX' : 'flipY';
    el[prop] = !el[prop];
  });
  if(window.render) window.render();
}

export function rotateSelection(delta){
  const ids = [...state.selectedIds];
  if(!ids.length) return;
  pushUndo();
  ids.forEach(id => {
    const el = getEl(id);
    if(el) el.rotation = ((Number(el.rotation) || 0) + delta) % 360;
  });
  if(window.render) window.render();
}

export function positionSelection(position){
  const ids = [...state.selectedIds].filter(id => getEl(id));
  if(ids.length !== 1) return;
  const el = getEl(ids[0]);
  const positions = {
    top:{ y:0 }, middle:{ y:(state.page.height - heightOf(el)) / 2 }, bottom:{ y:state.page.height - heightOf(el) },
    'top-left':{ x:0, y:0 }, 'top-center':{ x:(state.page.width - el.width) / 2, y:0 }, 'top-right':{ x:state.page.width - el.width, y:0 },
    'middle-left':{ x:0, y:(state.page.height - heightOf(el)) / 2 }, center:{ x:(state.page.width - el.width) / 2, y:(state.page.height - heightOf(el)) / 2 }, 'middle-right':{ x:state.page.width - el.width, y:(state.page.height - heightOf(el)) / 2 },
    'bottom-left':{ x:0, y:state.page.height - heightOf(el) }, 'bottom-center':{ x:(state.page.width - el.width) / 2, y:state.page.height - heightOf(el) }, 'bottom-right':{ x:state.page.width - el.width, y:state.page.height - heightOf(el) }
  };
  const target = positions[position];
  if(!target) return;
  pushUndo();
  if(target.x != null) el.x = round1(target.x);
  if(target.y != null) el.y = round1(target.y);
  clampElementPosition(el);
  if(window.render) window.render();
}
