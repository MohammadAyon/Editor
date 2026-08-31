// src/canvas/drag-resize.js — Mouse/drag/resize/marquee interactions and keyboard shortcuts
import {
  state, getEl, round1, clamp, heightOf, pushUndo, pushUndoDebounced,
  interaction, setInteraction, suppressClick, setSuppressClick,
  konvaDragState, konvaMarqueeState, undo, redo
} from '../state/state.js';
import { getPxPerMm } from './zoom.js';
import { computeSnap, showGuideV, hideGuideV, showGuideH, hideGuideH } from './snapping.js';
import { selectOnly, toggleSelect, clearSelection, selectAll, duplicateSelection, deleteSelection } from './selection.js';
import { cancelInteraction, updateKonvaNodePosition, updateSelectionOverlayPosition, triggerImageUpload } from './konva-render.js';
import { applyElementStyle, clampElementPosition, renderPage } from './dom-render.js';

export function onPageMouseDown(e){
  if(e.target.closest('.konva-editor-layer')) return;
  const handle = e.target.closest('.resize-handle');
  if(handle){
    const el = getEl(handle.dataset.id);
    if(!el) return;
    pushUndo();
    setInteraction({
      mode: 'resize',
      id: handle.dataset.id,
      startClientX: e.clientX,
      startClientY: e.clientY,
      startW: el.width,
      startH: el.height
    });
    e.stopPropagation();
    e.preventDefault();
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
    ids.forEach(i => {
      const e2 = getEl(i);
      if(e2) startPositions[i] = { x: e2.x, y: e2.y };
    });
    setInteraction({ mode: 'pending', id, ids, startPositions, startClientX: e.clientX, startClientY: e.clientY });
  } else {
    const pxPerMm = getPxPerMm();
    const page = document.getElementById('page');
    if(!page) return;
    const pageRect = page.getBoundingClientRect();
    const startXmm = (e.clientX - pageRect.left) / (pxPerMm * state.zoom);
    const startYmm = (e.clientY - pageRect.top) / (pxPerMm * state.zoom);
    if(!e.shiftKey && state.selectedIds.size){
      state.selectedIds = new Set();
      if(window.render) window.render();
    }
    const box = document.createElement('div');
    box.className = 'marquee-box no-print';
    page.appendChild(box);
    setInteraction({
      mode: 'marquee',
      startXmm,
      startYmm,
      curXmm: startXmm,
      curYmm: startYmm,
      baseSelection: new Set(state.selectedIds),
      boxEl: box
    });
  }
}

export function initCanvasEvents(){
  document.addEventListener('mousemove', e => {
    if(!interaction) return;

    if(interaction.mode === 'marquee'){
      const pxPerMm = getPxPerMm();
      const page = document.getElementById('page');
      if(!page) return;
      const pageRect = page.getBoundingClientRect();
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
      const rect = { left, top, right: left + w, bottom: top + h };
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
        clampElementPosition(el);
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
      if(window.render) window.render();
    } else if(interaction.mode === 'drag' || interaction.mode === 'resize'){
      setSuppressClick(true);
      hideGuideV();
      hideGuideH();
      if(window.renderInspector) window.renderInspector();
    }
    setInteraction(null);
  });

  document.addEventListener('pointercancel', cancelInteraction);
  document.addEventListener('contextmenu', event => {
    if(event.target.closest('#page')){
      event.preventDefault();
      cancelInteraction();
      if(window.render) window.render();
    }
  });
  window.addEventListener('blur', cancelInteraction);

  const page = document.getElementById('page');
  if(page){
    page.addEventListener('mousedown', onPageMouseDown);

    page.addEventListener('click', e => {
      if(suppressClick){
        setSuppressClick(false);
        return;
      }
      const imgEl = e.target.closest('.el-image-empty');
      if(!imgEl) return;
      const el = getEl(imgEl.dataset.id);
      if(el && el.role === 'logo') return;
      triggerImageUpload(imgEl.dataset.id);
    });

    page.addEventListener('dblclick', e => {
      const textDiv = e.target.closest('.el-text');
      if(!textDiv) return;
      const el = getEl(textDiv.dataset.id);
      if(!el) return;
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
        if(window.updateSchemaView) window.updateSchemaView();
      };
      textDiv.addEventListener('blur', onBlur);
    });
  }

  document.addEventListener('keydown', e => {
    const activeTab = window.getActiveTab ? window.getActiveTab() : 'editor';
    if(activeTab !== 'editor') return;
    const active = document.activeElement;
    const tag = active && active.tagName;
    const typing = active && (active.isContentEditable || tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT');
    const mod = e.metaKey || e.ctrlKey;

    if(mod && !typing && (e.key === 'z' || e.key === 'Z')){
      e.preventDefault();
      e.shiftKey ? redo() : undo();
      return;
    }
    if(mod && !typing && (e.key === 'y' || e.key === 'Y')){
      e.preventDefault();
      redo();
      return;
    }
    if(mod && !typing && (e.key === 'd' || e.key === 'D')){
      e.preventDefault();
      duplicateSelection();
      return;
    }
    if(mod && !typing && (e.key === 'a' || e.key === 'A')){
      e.preventDefault();
      selectAll();
      return;
    }
    if(e.key === 'Escape' && !typing){
      if(interaction || konvaDragState || konvaMarqueeState){
        cancelInteraction();
        if(window.render) window.render();
      } else {
        clearSelection();
      }
      return;
    }
    if((e.key === 'Delete' || e.key === 'Backspace') && state.selectedIds.size && !typing){
      e.preventDefault();
      deleteSelection();
      return;
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
        const el = getEl(id);
        if(!el) return;
        el.x = round1(el.x + dx);
        el.y = round1(el.y + dy);
        clampElementPosition(el);
      });
      renderPage();
      if(window.updateSchemaView) window.updateSchemaView();
    }
  });
}
