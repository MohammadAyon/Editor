// src/canvas/snapping.js — Element alignment snapping and visual guidelines
import { state, heightOf, guideVEl, setGuideVEl, guideHEl, setGuideHEl, konvaLayer, konvaGuideLayer } from '../state/state.js';
import { getPxPerMm } from './zoom.js';

export function mmToPx(mm){ return mm * getPxPerMm(); }

export function computeSnap(el, proposedX, proposedY, excludeIds){
  const threshold = 5;
  const exclude = new Set(excludeIds || [el.id]);
  const pxPerMm = getPxPerMm();
  const stageWidth = state.page.width * pxPerMm;
  const stageHeight = state.page.height * pxPerMm;
  const node = konvaLayer && konvaLayer.findOne('#' + el.id);
  const nodeBox = node ? node.getClientRect({ skipTransform:false }) : { x:el.x * pxPerMm, y:el.y * pxPerMm, width:el.width * pxPerMm, height:heightOf(el) * pxPerMm };
  const proposedBox = { ...nodeBox, x:nodeBox.x + (proposedX - el.x) * pxPerMm, y:nodeBox.y + (proposedY - el.y) * pxPerMm };
  const vertical = [0, stageWidth / 2, stageWidth];
  const horizontal = [0, stageHeight / 2, stageHeight];
  state.elements.forEach(other => {
    if(exclude.has(other.id)) return;
    const otherNode = konvaLayer && konvaLayer.findOne('#' + other.id);
    const box = otherNode ? otherNode.getClientRect({ skipTransform:false }) : { x:other.x * pxPerMm, y:other.y * pxPerMm, width:other.width * pxPerMm, height:heightOf(other) * pxPerMm };
    vertical.push(box.x, box.x + box.width / 2, box.x + box.width);
    horizontal.push(box.y, box.y + box.height / 2, box.y + box.height);
  });
  const candidates = (values, points) => values.flatMap(line => points.map(point => ({ line, point, diff:Math.abs(line - point.guide) })))
    .filter(candidate => candidate.diff <= threshold)
    .sort((a,b) => a.diff - b.diff);
  const xPoints = [
    { guide:proposedBox.x, offset:proposedBox.x - nodeBox.x },
    { guide:proposedBox.x + proposedBox.width / 2, offset:proposedBox.x + proposedBox.width / 2 - nodeBox.x },
    { guide:proposedBox.x + proposedBox.width, offset:proposedBox.x + proposedBox.width - nodeBox.x }
  ];
  const yPoints = [
    { guide:proposedBox.y, offset:proposedBox.y - nodeBox.y },
    { guide:proposedBox.y + proposedBox.height / 2, offset:proposedBox.y + proposedBox.height / 2 - nodeBox.y },
    { guide:proposedBox.y + proposedBox.height, offset:proposedBox.y + proposedBox.height - nodeBox.y }
  ];
  const xMatch = candidates(vertical, xPoints)[0];
  const yMatch = candidates(horizontal, yPoints)[0];
  return {
    x:xMatch ? proposedX + (xMatch.line - xMatch.point.guide) / pxPerMm : null,
    y:yMatch ? proposedY + (yMatch.line - yMatch.point.guide) / pxPerMm : null,
    guideX:xMatch ? xMatch.line / pxPerMm : null,
    guideY:yMatch ? yMatch.line / pxPerMm : null
  };
}

export function showGuideV(xmm){
  if(!konvaGuideLayer || !window.Konva) return;
  konvaGuideLayer.find('.snap-guide-v').forEach(line => line.destroy());
  const guide = new Konva.Line({ points:[mmToPx(xmm),0,mmToPx(xmm),mmToPx(state.page.height)], stroke:'rgb(0, 161, 255)', strokeWidth:1, dash:[4,6], name:'snap-guide-v', listening:false });
  setGuideVEl(guide);
  konvaGuideLayer.add(guide);
  konvaGuideLayer.batchDraw();
}

export function hideGuideV(){
  if(guideVEl){
    guideVEl.destroy();
    setGuideVEl(null);
    if(konvaGuideLayer) konvaGuideLayer.batchDraw();
  }
}

export function showGuideH(ymm){
  if(!konvaGuideLayer || !window.Konva) return;
  konvaGuideLayer.find('.snap-guide-h').forEach(line => line.destroy());
  const guide = new Konva.Line({ points:[0,mmToPx(ymm),mmToPx(state.page.width),mmToPx(ymm)], stroke:'rgb(0, 161, 255)', strokeWidth:1, dash:[4,6], name:'snap-guide-h', listening:false });
  setGuideHEl(guide);
  konvaGuideLayer.add(guide);
  konvaGuideLayer.batchDraw();
}

export function hideGuideH(){
  if(guideHEl){
    guideHEl.destroy();
    setGuideHEl(null);
    if(konvaGuideLayer) konvaGuideLayer.batchDraw();
  }
}
