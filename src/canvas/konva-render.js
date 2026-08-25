// src/canvas/konva-render.js — Konva stage, nodes, transformer, and canvas interaction
import {
  state, getEl, round1, clamp, heightOf, pushUndo,
  konvaStage, setKonvaStage, konvaLayer, setKonvaLayer,
  konvaGuideLayer, setKonvaGuideLayer, konvaTransformer, setKonvaTransformer,
  konvaDragState, setKonvaDragState, konvaMarqueeState, setKonvaMarqueeState,
  interaction, setInteraction
} from '../state/state.js';
import { getPxPerMm } from './zoom.js';
import { mmToPx, computeSnap, showGuideV, hideGuideV, showGuideH, hideGuideH } from './snapping.js';
import { resolveImageSrc, rectFill, rectStroke, lineStroke, lineWidth, clampElementPosition } from './dom-render.js';

export function cancelInteraction(){
  if(interaction && interaction.boxEl) interaction.boxEl.remove();
  if(konvaMarqueeState && konvaMarqueeState.box) konvaMarqueeState.box.remove();
  setInteraction(null);
  setKonvaDragState(null);
  setKonvaMarqueeState(null);
  hideGuideV();
  hideGuideH();
}

export function updateKonvaNodePosition(id){
  if(!konvaLayer) return;
  const el = getEl(id);
  const node = el && konvaLayer.findOne('#' + id);
  if(!el || !node) return;
  const width = mmToPx(el.width);
  node.x(mmToPx(el.x + el.width / 2));
  node.y(mmToPx(el.y + heightOf(el) / 2));
  if(el.type === 'line'){
    node.offsetX(width / 2);
    node.points([0, 0, width, 0]);
  }
}

export function updateSelectionOverlayPosition(id){
  const el = getEl(id);
  const overlay = el && document.querySelector(`.selection-overlay[data-id="${id}"]`);
  if(!el || !overlay) return;
  overlay.style.left = el.x + 'mm';
  overlay.style.top = el.y + 'mm';
}

export function getStagePointer(nativeEvent){
  if(konvaStage && nativeEvent) konvaStage.setPointersPositions(nativeEvent);
  const pointer = konvaStage && konvaStage.getPointerPosition();
  if(pointer) return pointer;
  const canvas = document.querySelector('.konva-editor-layer canvas');
  const rect = canvas && canvas.getBoundingClientRect();
  if(!rect || !konvaStage) return null;
  return {
    x: (nativeEvent.clientX - rect.left) * konvaStage.width() / rect.width,
    y: (nativeEvent.clientY - rect.top) * konvaStage.height() / rect.height
  };
}

export function resizeSnapBox(oldBox, newBox, selectedElement){
  const minWidth = mmToPx(5);
  if(selectedElement && selectedElement.type === 'line'){
    if(newBox.width < minWidth) return oldBox;
    return newBox;
  }
  const minHeight = mmToPx(5);
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

export function konvaTextValue(el){
  return (el.prefix || '') + (el.field ? (state.data[el.field] || '') : (el.content || ''));
}

export function makeKonvaNode(el){
  const x = mmToPx(el.x), y = mmToPx(el.y), width = mmToPx(el.width), height = mmToPx(el.type === 'line' ? 2 : el.height);
  const visualHeight = height;
  let node;
  if(el.type === 'text'){
    node = new Konva.Group({
      x: x + width / 2,
      y: y + visualHeight / 2,
      offsetX: width / 2,
      offsetY: visualHeight / 2,
      width,
      height,
      clipX: 0, clipY: 0, clipWidth: width, clipHeight: height,
      listening: true
    });
    node.add(new Konva.Rect({
      x: 0,
      y: 0,
      width,
      height,
      fill: 'rgba(0,0,0,0.001)',
      listening: true
    }));
    node.add(new Konva.Text({
      text: konvaTextValue(el),
      x: 0,
      y: 0,
      width,
      height,
      fontSize: el.fontSize,
      fontFamily: el.variant === 'display' ? 'Fraunces' : 'Inter',
      fontStyle: el.weight >= 600 ? 'bold' : 'normal',
      fill: '#171614',
      align: el.align,
      listening: true
    }));
  } else if(el.type === 'line'){
    node = new Konva.Line({
      points: [0, 0, width, 0],
      x: x + width / 2,
      y,
      offsetX: width / 2,
      offsetY: 0,
      width,
      height: lineWidth(el),
      stroke: lineStroke(el),
      strokeWidth: lineWidth(el),
      hitStrokeWidth: Math.max(16, lineWidth(el) + 12),
      lineCap: 'round',
      lineJoin: el.lineJoin || 'miter',
      strokeScaleEnabled: false,
      listening: true
    });
  } else if(el.type === 'rect'){
    node = new Konva.Rect({
      x: x + width / 2,
      y: y + visualHeight / 2,
      offsetX: width / 2,
      offsetY: visualHeight / 2,
      width,
      height,
      fill: rectFill(el),
      stroke: rectStroke(el),
      strokeWidth: Number(el.strokeWidth) || 1,
      lineJoin: el.lineJoin || 'miter',
      listening: true
    });
  } else {
    node = new Konva.Group({
      x: x + width / 2,
      y: y + visualHeight / 2,
      offsetX: width / 2,
      offsetY: visualHeight / 2,
      width,
      height,
      clipX: 0, clipY: 0, clipWidth: width, clipHeight: height,
      listening: true
    });
    node.add(new Konva.Rect({ x:0, y:0, width, height, fill:'#EEEBE3', stroke:'#B4B0A4', dash:[4,3], listening:true }));
    const src = resolveImageSrc(el);
    if(src){
      const image = new Image();
      image.onload = () => {
        const imgW = image.width, imgH = image.height;
        if(imgW && imgH){
          const isPhoto = el.role === 'photo';
          const imgRatio = imgW / imgH;
          const boxRatio = width / height;
          let dw = width, dh = height, dx = 0, dy = 0;
          if (isPhoto) {
            if (imgRatio > boxRatio) {
              dh = height; dw = height * imgRatio;
              dx = (width - dw) / 2;
            } else {
              dw = width; dh = width / imgRatio;
              dy = (height - dh) / 2;
            }
          } else {
            if (imgRatio > boxRatio) {
              dw = width; dh = width / imgRatio;
              dy = (height - dh) / 2;
            } else {
              dh = height; dw = height * imgRatio;
              dx = (width - dw) / 2;
            }
          }
          node.add(new Konva.Image({ image, x: dx, y: dy, width: dw, height: dh, listening:false }));
        }
        if(node.getLayer()) node.getLayer().batchDraw();
      };
      image.src = src;
    } else {
      node.add(new Konva.Text({
        text: el.role === 'logo' ? 'Pick a logo in the inspector' : 'Click to add image',
        x: 0,
        y: height / 2 - 7,
        width,
        fontSize: 10,
        fill: '#7A776E',
        align: 'center',
        listening: false
      }));
    }
  }
  node.id(el.id);
  node.rotation(Number(el.rotation) || 0);
  node.scale({ x: el.flipX ? -1 : 1, y: el.flipY ? -1 : 1 });
  node.opacity(Number.isFinite(el.opacity) ? el.opacity : 1);
  if(typeof node.shadowColor === 'function'){
    node.shadowColor(el.shadowColor || '#171614');
    node.shadowBlur(Number(el.shadowBlur) || 0);
    node.shadowOffset({ x: Number(el.shadowOffsetX) || 0, y: Number(el.shadowOffsetY) || 0 });
    node.shadowOpacity(Number.isFinite(el.shadowOpacity) ? el.shadowOpacity : 0);
  }
  node.draggable(false);
  const dragStartNode = node;
  dragStartNode.on('mousedown', event => {
    const native = event.evt;
    native.stopPropagation();
    event.cancelBubble = true;
    const pointer = getStagePointer(native) || node.position();
    if(native.shiftKey){
      const next = new Set(state.selectedIds);
      if(next.has(el.id)) next.delete(el.id); else next.add(el.id);
      state.selectedIds = next;
    } else if(!state.selectedIds.has(el.id)) {
      state.selectedIds = new Set([el.id]);
    }
    if(!state.selectedIds.has(el.id)) return;
    setKonvaDragState({
      id: el.id,
      startX: pointer.x,
      startY: pointer.y,
      positions: Object.fromEntries([...state.selectedIds].map(id => {
        const selected = getEl(id);
        return [id, { x: selected.x, y: selected.y }];
      }))
    });
    pushUndo();
  });
  node.on('dblclick', () => {
    if(el.type === 'image' && !resolveImageSrc(el)) triggerImageUpload(el.id);
  });
  return node;
}

export function renderKonva(){
  if(!window.Konva) return;
  const page = document.getElementById('page');
  if(!page) return;
  if(!konvaStage){
    const container = document.createElement('div');
    container.className = 'konva-editor-layer no-print';
    page.appendChild(container);
    const stage = new Konva.Stage({ container, width: page.clientWidth, height: page.clientHeight });
    const layer = new Konva.Layer();
    const guideLayer = new Konva.Layer({ listening: false });
    setKonvaStage(stage);
    setKonvaLayer(layer);
    setKonvaGuideLayer(guideLayer);
    stage.add(layer);
    stage.add(guideLayer);

    stage.on('mousedown', event => {
      if(event.target !== stage){
        let ancestor = event.target;
        let isTransformerTarget = false;
        while(ancestor && ancestor !== stage){
          if(ancestor === konvaTransformer){ isTransformerTarget = true; break; }
          ancestor = ancestor.getParent();
        }
        if(isTransformerTarget){
          const targetName = typeof event.target.name === 'function' ? event.target.name() : '';
          if(String(targetName).includes('anchor') || String(targetName).includes('rotater')) return;
          const id = [...state.selectedIds][0];
          const selected = id && getEl(id);
          const pointer = getStagePointer(event.evt);
          if(!selected || !pointer) return;
          event.evt.stopPropagation();
          event.cancelBubble = true;
          setKonvaDragState({ id, startX: pointer.x, startY: pointer.y, positions: { [id]: { x: selected.x, y: selected.y } } });
          pushUndo();
          return;
        }
        let target = event.target;
        while(target && target !== stage && !target.id()) target = target.getParent();
        const id = target && target !== stage ? target.id() : null;
        const el = id && getEl(id);
        if(!el) return;
        event.evt.stopPropagation();
        event.cancelBubble = true;
        const pointer = getStagePointer(event.evt) || target.position();
        if(event.evt.shiftKey){
          const next = new Set(state.selectedIds);
          if(next.has(id)) next.delete(id); else next.add(id);
          state.selectedIds = next;
        } else if(!state.selectedIds.has(id)) {
          state.selectedIds = new Set([id]);
        }
        if(!state.selectedIds.has(id)) return;
        setKonvaDragState({
          id,
          startX: pointer.x,
          startY: pointer.y,
          positions: Object.fromEntries([...state.selectedIds].map(selectedId => {
            const selected = getEl(selectedId);
            return [selectedId, { x: selected.x, y: selected.y }];
          }))
        });
        pushUndo();
        return;
      }
      event.evt.stopPropagation();
      const pointer = getStagePointer(event.evt);
      if(!pointer) return;
      const box = document.createElement('div');
      box.className = 'marquee-box no-print';
      page.appendChild(box);
      setKonvaMarqueeState({
        startX: pointer.x,
        startY: pointer.y,
        baseSelection: event.evt.shiftKey ? new Set(state.selectedIds) : new Set(),
        box
      });
      if(!event.evt.shiftKey) state.selectedIds = new Set();
    });

    stage.on('mousemove', event => {
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
      const primary = getEl(konvaDragState.id);
      const primaryStart = konvaDragState.positions[konvaDragState.id];
      const proposedX = primaryStart ? primaryStart.x + dx : 0;
      const proposedY = primaryStart ? primaryStart.y + dy : 0;
      const snap = primary && primaryStart
        ? computeSnap(primary, proposedX, proposedY, Object.keys(konvaDragState.positions))
        : { x:null, y:null, guideX:null, guideY:null };
      const snapDX = snap.x != null ? snap.x - proposedX : 0;
      const snapDY = snap.y != null ? snap.y - proposedY : 0;
      Object.entries(konvaDragState.positions).forEach(([id, start]) => {
        const el = getEl(id);
        if(!el) return;
        el.x = round1(start.x + dx + snapDX);
        el.y = round1(start.y + dy + snapDY);
        clampElementPosition(el);
        const node = konvaLayer.findOne('#' + id);
        if(node){ node.x(mmToPx(el.x + el.width / 2)); node.y(mmToPx(el.y + heightOf(el) / 2)); }
      });
      if(snap.guideX != null) showGuideV(snap.guideX); else hideGuideV();
      if(snap.guideY != null) showGuideH(snap.guideY); else hideGuideH();
      konvaLayer.batchDraw();
      if(window.updateSchemaView) window.updateSchemaView();
    });

    stage.on('mouseup', event => {
      if(konvaMarqueeState){
        const pointer = getStagePointer(event.evt);
        if(!pointer) return;
        const pxPerMm = getPxPerMm();
        const rect = {
          left: Math.min(konvaMarqueeState.startX, pointer.x) / pxPerMm,
          top: Math.min(konvaMarqueeState.startY, pointer.y) / pxPerMm,
          right: Math.max(konvaMarqueeState.startX, pointer.x) / pxPerMm,
          bottom: Math.max(konvaMarqueeState.startY, pointer.y) / pxPerMm
        };
        state.elements.forEach(el => {
          const hit = !(el.x + el.width < rect.left || el.x > rect.right || el.y + heightOf(el) < rect.top || el.y > rect.bottom);
          if(hit) konvaMarqueeState.baseSelection.add(el.id);
        });
        state.selectedIds = konvaMarqueeState.baseSelection;
        konvaMarqueeState.box.remove();
        setKonvaMarqueeState(null);
        if(window.render) window.render();
      } else if(konvaDragState){
        setKonvaDragState(null);
        hideGuideV(); hideGuideH();
        if(window.render) window.render();
      }
    });
  }

  konvaStage.size({ width: page.clientWidth, height: page.clientHeight });
  konvaLayer.destroyChildren();
  state.elements.forEach(el => konvaLayer.add(makeKonvaNode(el)));

  const transformer = new Konva.Transformer({
    rotateEnabled: true,
    keepRatio: false,
    ignoreStroke: true,
    anchorSize: 8,
    borderStroke: '#171614',
    anchorStroke: '#171614',
    anchorFill: '#171614',
    enabledAnchors: ['top-left','top-right','bottom-left','bottom-right','middle-left','middle-right'],
    boundBoxFunc: (oldBox, newBox) => resizeSnapBox(oldBox, newBox, getEl([...state.selectedIds][0]))
  });
  setKonvaTransformer(transformer);

  const selected = [...state.selectedIds].map(id => konvaLayer.findOne('#' + id)).filter(Boolean);
  if(selected.length === 1){
    const selectedElement = getEl(selected[0].id());
    const isLine = selectedElement.type === 'line';
    transformer.enabledAnchors(isLine
      ? ['middle-left', 'middle-right']
      : ['top-left', 'top-right', 'bottom-left', 'bottom-right']
    );
    transformer.ignoreStroke(!isLine);
    transformer.keepRatio(selectedElement.type === 'image' ? selectedElement.keepRatio !== false : selectedElement.keepRatio === true);
    transformer.nodes(selected);
    transformer.on('transformstart', pushUndo);
    transformer.on('transform', () => {
      const node = selected[0], el = getEl(node.id());
      if(!el) return;
      const scaleX = node.scaleX();
      const absScaleX = Math.abs(scaleX);
      const currentW = round1(clamp(el.width * absScaleX, 5, state.page.width));
      const inspW = document.getElementById('insp-w');
      if(inspW && document.activeElement !== inspW) inspW.value = currentW;
    });
    transformer.on('transformend', () => {
      const node = selected[0], el = getEl(node.id());
      if(!el) return;
      const scaleX = node.scaleX(), scaleY = node.scaleY();
      const absScaleX = Math.abs(scaleX), absScaleY = Math.abs(scaleY);
      el.width = round1(clamp(el.width * absScaleX, 5, state.page.width));
      if(el.type !== 'line') el.height = round1(clamp(el.height * absScaleY, 5, state.page.height));
      el.rotation = round1(node.rotation());
      if(el.type === 'line'){
        const wpx = mmToPx(el.width);
        node.offsetX(wpx / 2);
        node.points([0, 0, wpx, 0]);
        node.scale({ x: 1, y: 1 });
        el.x = round1(clamp(node.x() / getPxPerMm() - el.width / 2, 0, state.page.width - el.width));
        el.y = round1(clamp(node.y() / getPxPerMm(), 0, state.page.height));
        clampElementPosition(el);
      } else {
        node.scale({ x: 1, y: 1 });
        el.x = round1(clamp(node.x() / getPxPerMm() - el.width / 2, 0, state.page.width - el.width));
        el.y = round1(clamp(node.y() / getPxPerMm() - heightOf(el) / 2, 0, state.page.height - heightOf(el)));
      }
      el.flipX = scaleX < 0;
      el.flipY = scaleY < 0;
      if(window.render) window.render();
    });
    konvaLayer.add(transformer);
  }
  konvaLayer.batchDraw();
  if(konvaGuideLayer) konvaGuideLayer.batchDraw();
}

let hiddenImageInput = null;
export function triggerImageUpload(id){
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
    reader.onload = () => {
      if(window.updateProp) window.updateProp(id, 'src', reader.result);
    };
    reader.readAsDataURL(file);
    hiddenImageInput.value = '';
  };
  hiddenImageInput.click();
}

if(typeof location !== 'undefined' && (location.hostname === 'localhost' || location.hostname === '127.0.0.1')){
  window.getEditorDiagnostics = () => ({
    stageNodes: konvaStage ? Array.from(konvaStage.getChildren()).reduce((count, layer) => count + 1 + layer.getChildren().length, 0) : 0,
    layerCount: konvaStage ? konvaStage.getLayers().length : 0,
    designObjectCount: state.elements.length,
    guideHelperCount: (konvaGuideLayer ? konvaGuideLayer.getChildren().length : 0) + document.querySelectorAll('.marquee-box, .selection-overlay, .selection-bbox').length,
    transformerCount: konvaStage ? konvaStage.find('Transformer').length : 0,
    activeInteraction: interaction ? interaction.mode : null
  });
}
