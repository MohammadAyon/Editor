// src/canvas/zoom.js — Canvas zoom, pan, readout, and pixel-to-mm conversions
import { state, clamp } from '../state/state.js';

export function getPxPerMm(){
  const page = document.getElementById('page');
  if(!page) return 96 / 25.4;
  return page.getBoundingClientRect().width / (state.page.width * state.zoom);
}

export function updateZoomReadout(){
  const readout = document.getElementById('zoomReadout');
  if(readout) readout.textContent = Math.round(state.zoom * 100) + '%';
}

export function syncZoomLayout(){
  const page = document.getElementById('page');
  const frame = page && page.parentElement;
  if(!page || !frame) return;
  frame.style.width = `${16 + page.offsetWidth * state.zoom}px`;
  frame.style.height = `${16 + page.offsetHeight * state.zoom}px`;
}

export function centerZoomedPage(){
  const wrapper = document.querySelector('.canvas-wrapper');
  const frame = document.querySelector('.page-frame');
  if(!wrapper || !frame) return;
  const innerWidth = wrapper.clientWidth - 64;
  wrapper.scrollLeft = Math.max(0, (frame.offsetWidth - innerWidth) / 2);
  wrapper.scrollTop = Math.max(0, (frame.offsetHeight - (wrapper.clientHeight - 112)) / 2);
}

export function setZoom(value, clientX, clientY){
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

export function changeZoom(delta){ setZoom(state.zoom + delta); }
export function resetZoom(){ setZoom(1); }

export function onCanvasWheel(event){
  const activeTab = window.getActiveTab ? window.getActiveTab() : 'editor';
  if(activeTab !== 'editor') return;
  event.preventDefault();
  setZoom(state.zoom * (event.deltaY < 0 ? 1.1 : 0.9), event.clientX, event.clientY);
}
