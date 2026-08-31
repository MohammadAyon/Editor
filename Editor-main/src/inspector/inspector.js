// src/inspector/inspector.js — Property inspector, layers panel, live schema output, and property mutators
import { state, getEl, round1, clamp, escapeHtml, brandImages, pushUndo, pushUndoDebounced } from '../state/state.js';
import { rectFill, rectStroke, lineStroke, lineWidth, applyElementStyle, clampElementPosition, renderPage, updateBoundElementsContent } from '../canvas/dom-render.js';
import { renderKonva } from '../canvas/konva-render.js';

export function updateNum(id, prop, value){
  const el = getEl(id);
  const num = parseFloat(value);
  if(!el || isNaN(num)) return;
  pushUndoDebounced('num:' + id + ':' + prop);
  el[prop] = num;
  if(prop === 'x' || prop === 'y') clampElementPosition(el);
  applyElementStyle(id);
  updateSchemaView();
  if(window.renderPresetSaveState) window.renderPresetSaveState();
}

export function applyImageAspectRatio(id, ratioWidth, ratioHeight){
  const el = getEl(id);
  const ratio = Number(ratioWidth) / Number(ratioHeight);
  if(!el || el.type !== 'image' || !Number.isFinite(ratio) || ratio <= 0) return;
  pushUndo();
  const availableWidth = Math.max(5, state.page.width - el.x);
  const availableHeight = Math.max(5, state.page.height - el.y);
  let width = clamp(el.width, 5, availableWidth);
  let height = width / ratio;
  if(height > availableHeight){
    height = availableHeight;
    width = height * ratio;
  }
  el.width = round1(width);
  el.height = round1(height);
  el.keepRatio = true;
  if(window.render) window.render();
}

export function setImageRatioPreset(id, value){
  if(!value) return;
  const [width, height] = value.split(':').map(Number);
  applyImageAspectRatio(id, width, height);
}

export function applyCustomImageRatio(id){
  const width = parseFloat(document.getElementById('image-ratio-w')?.value);
  const height = parseFloat(document.getElementById('image-ratio-h')?.value);
  applyImageAspectRatio(id, width, height);
}

export function updateProp(id, prop, value){
  const el = getEl(id);
  if(!el) return;
  pushUndoDebounced('prop:' + id + ':' + prop);
  el[prop] = value;
  if(prop === 'src' || prop === 'variant' || prop === 'logoRef' || prop === 'fill' || prop === 'stroke' || prop === 'strokeWidth' || prop === 'field'){
    renderPage();
    renderInspector();
  } else {
    applyElementStyle(id);
  }
  updateSchemaView();
  if(window.renderPresetSaveState) window.renderPresetSaveState();
}

export function onDataInput(field, value){
  state.data[field] = value;
  updateBoundElementsContent(field);
  renderKonva();
  updateSchemaView();
  if(window.renderPresetSaveState) window.renderPresetSaveState();
}

export function renderInspector(){
  const box = document.getElementById('inspector');
  if(!box) return;
  const ids = [...state.selectedIds].filter(id => getEl(id));

  if(ids.length === 0){
    box.innerHTML = `<p class="hint">Click to select — shift-click to add more, drag empty space to marquee-select. Arrow keys nudge 1mm (10mm with shift), ⌘D duplicates, ⌘Z undoes, ⌘A selects all.</p>`;
    return;
  }

  if(ids.length === 1){
    const el = getEl(ids[0]);
    let html = `
      <div class="row-btns" style="margin-bottom:16px">
        <button class="btn small" data-selection-command="center-h">Center H</button>
        <button class="btn small" data-selection-command="center-v">Center V</button>
      </div>
      <div class="field"><label>Position on canvas</label>
        <div class="position-edges">
          <button class="btn tiny" data-action="position-selection" data-position="top">Top</button>
          <button class="btn tiny" data-action="position-selection" data-position="middle">Middle</button>
          <button class="btn tiny" data-action="position-selection" data-position="bottom">Bottom</button>
        </div>
        <div class="position-grid" style="margin-top:6px">
          <button class="btn tiny" data-action="position-selection" data-position="top-left">Top left</button>
          <button class="btn tiny" data-action="position-selection" data-position="top-center">Top center</button>
          <button class="btn tiny" data-action="position-selection" data-position="top-right">Top right</button>
          <button class="btn tiny" data-action="position-selection" data-position="middle-left">Middle left</button>
          <button class="btn tiny" data-action="position-selection" data-position="center">Center</button>
          <button class="btn tiny" data-action="position-selection" data-position="middle-right">Middle right</button>
          <button class="btn tiny" data-action="position-selection" data-position="bottom-left">Bottom left</button>
          <button class="btn tiny" data-action="position-selection" data-position="bottom-center">Bottom center</button>
          <button class="btn tiny" data-action="position-selection" data-position="bottom-right">Bottom right</button>
        </div>
      </div>
      <div class="insp-row"><label>X</label><input type="number" id="insp-x" value="${el.x}" step="1" data-editor-number="x" data-id="${escapeHtml(el.id)}"></div>
      <div class="insp-row"><label>Y</label><input type="number" id="insp-y" value="${el.y}" step="1" data-editor-number="y" data-id="${escapeHtml(el.id)}"></div>
      <div class="insp-row"><label>W</label><input type="number" id="insp-w" value="${el.width}" step="1" data-editor-number="width" data-id="${escapeHtml(el.id)}"></div>`;
    if(el.type !== 'line'){
      html += `<div class="insp-row"><label>H</label><input type="number" id="insp-h" value="${el.height}" step="1" data-editor-number="height" data-id="${escapeHtml(el.id)}"></div>`;
    }
    if(el.type === 'text'){
      html += `
        <div class="field"><label>Style</label>
          <select data-editor-prop="variant" data-id="${escapeHtml(el.id)}">
            ${['display','body','label'].map(v => `<option value="${v}" ${v===(el.variant||'body')?'selected':''}>${v.charAt(0).toUpperCase()+v.slice(1)}</option>`).join('')}
          </select>
        </div>
        <div class="field"><label>Font size (px)</label><input type="number" value="${el.fontSize}" data-editor-prop="fontSize" data-value-type="number" data-id="${escapeHtml(el.id)}"></div>
        <div class="field"><label>Weight</label>
          <select data-editor-prop="weight" data-value-type="integer" data-id="${escapeHtml(el.id)}">
            ${[400,500,600].map(w => `<option value="${w}" ${w===el.weight?'selected':''}>${w}</option>`).join('')}
          </select>
        </div>
        <div class="field"><label>Align</label>
          <select data-editor-prop="align" data-id="${escapeHtml(el.id)}">
            ${['left','center','right'].map(a => `<option value="${a}" ${a===el.align?'selected':''}>${a}</option>`).join('')}
          </select>
        </div>
        <div class="field"><label>Font family</label>
          <select data-editor-prop="fontFamily" data-value-type="nullable" data-id="${escapeHtml(el.id)}">
            <option value="" ${!el.fontFamily ? 'selected' : ''}>Match style default</option>
            <option value="sans" ${el.fontFamily==='sans' ? 'selected' : ''}>Sans (Inter)</option>
            <option value="display" ${el.fontFamily==='display' ? 'selected' : ''}>Serif (Fraunces)</option>
            <option value="mono" ${el.fontFamily==='mono' ? 'selected' : ''}>Mono (IBM Plex Mono)</option>
          </select>
        </div>
        <div class="field"><label>Letter spacing (em)</label><input type="number" step="0.01" min="-0.1" max="0.5" value="${Number.isFinite(el.letterSpacing) ? el.letterSpacing : 0}" data-editor-prop="letterSpacing" data-value-type="number" data-id="${escapeHtml(el.id)}"></div>
        <div class="field"><label>Line height</label><input type="number" step="0.05" min="0.8" max="3" value="${Number.isFinite(el.lineHeight) ? el.lineHeight : 1.2}" data-editor-prop="lineHeight" data-value-type="number" data-id="${escapeHtml(el.id)}"></div>
        <div class="field"><label>Case</label>
          <select data-editor-prop="textTransform" data-id="${escapeHtml(el.id)}">
            ${['none','uppercase','lowercase','capitalize'].map(t => `<option value="${t}" ${(el.textTransform||'none')===t ? 'selected' : ''}>${t.charAt(0).toUpperCase()+t.slice(1)}</option>`).join('')}
          </select>
        </div>
        <div class="field color-field"><label>Text color</label><input type="color" value="${el.color || (el.variant==='label' ? '#7A776E' : '#171614')}" data-editor-prop="color" data-id="${escapeHtml(el.id)}"></div>
        <div class="field">
          <label class="check-row"><input type="checkbox" ${el.italic ? 'checked' : ''} data-editor-prop="italic" data-value-type="checked" data-id="${escapeHtml(el.id)}"> Italic</label>
          <label class="check-row" style="margin-top:6px"><input type="checkbox" ${el.underline ? 'checked' : ''} data-editor-prop="underline" data-value-type="checked" data-id="${escapeHtml(el.id)}"> Underline</label>
        </div>`;
      html += `
        <div class="field"><label>Data field</label>
          <select data-editor-prop="field" data-value-type="nullable" data-id="${escapeHtml(el.id)}">
            <option value="" ${!el.field ? 'selected' : ''}>Custom text</option>
            <option value="projectName" ${el.field==='projectName' ? 'selected' : ''}>Project name</option>
            <option value="location" ${el.field==='location' ? 'selected' : ''}>Location</option>
            <option value="clientName" ${el.field==='clientName' ? 'selected' : ''}>Client name</option>
          </select>
        </div>`;
      if(el.field){
        html += `<div class="field"><label>Prefix</label><input type="text" value="${escapeHtml(el.prefix||'')}" data-editor-prop="prefix" data-id="${escapeHtml(el.id)}"></div>`;
        html += `<div class="bound-note">Bound to data field <strong>${el.field}</strong> — edit its value in the Project data panel.</div>`;
      } else {
        html += `<div class="field"><label>Content</label><textarea data-editor-prop="content" data-id="${escapeHtml(el.id)}">${escapeHtml(el.content||'')}</textarea></div>`;
      }
    }
    if(el.type === 'image'){
      const imageRatio = el.width / Math.max(el.height, 0.1);
      html += `<div class="field"><label>Aspect ratio</label>
        <label class="check-row"><input type="checkbox" ${el.keepRatio !== false ? 'checked' : ''} data-editor-prop="keepRatio" data-value-type="checked" data-id="${escapeHtml(el.id)}"> Lock image ratio</label>
        <select style="margin-top:8px" data-action="set-image-ratio-preset" data-id="${escapeHtml(el.id)}">
          <option value="">Choose container ratio</option>
          <option value="1:1">Square (1:1)</option>
          <option value="4:3">Standard (4:3)</option>
          <option value="3:2">Photo (3:2)</option>
          <option value="16:9">Widescreen (16:9)</option>
          <option value="9:16">Portrait (9:16)</option>
        </select>
        <div class="image-ratio-inputs" style="margin-top:8px">
          <input type="number" id="image-ratio-w" min="0.1" step="0.1" value="${round1(imageRatio)}" aria-label="Custom ratio width">
          <span>:</span>
          <input type="number" id="image-ratio-h" min="0.1" step="0.1" value="1" aria-label="Custom ratio height">
          <button class="btn tiny" type="button" data-action="apply-custom-image-ratio" data-id="${escapeHtml(el.id)}">Apply</button>
        </div>
        <p class="hint" style="margin:8px 0 0">Container size is in mm above. A ratio preserves the current width and adjusts its height.</p>
      </div>`;
      if(el.role === 'logo'){
        html += `<div class="field"><label>Logo</label>
          <select data-editor-prop="logoRef" data-id="${escapeHtml(el.id)}">
            ${brandImages.length
              ? brandImages.map(b => `<option value="${b.id}" ${b.id===el.logoRef?'selected':''}>${escapeHtml(b.name)}</option>`).join('')
              : '<option value="">Upload a logo in Brand assets first</option>'}
          </select>
        </div>`;
      } else {
        html += `<button class="btn small" data-action="upload-editor-image" data-id="${escapeHtml(el.id)}">${el.src ? 'Replace' : 'Add'} editor preview image</button>`;
        if(el.field) html += `<div class="bound-note">Bound to data field <strong>${el.field}</strong> — the photo uploaded on Create Project fills this slot.</div>`;
        if(el.src) html += `<button class="btn small" style="margin-top:6px" data-action="remove-editor-image" data-id="${escapeHtml(el.id)}">Remove editor preview image</button>`;
      }
    }
    if(el.type === 'rect'){
      html += `
        <div class="field color-field"><label>Fill</label><input type="color" value="${rectFill(el)}" data-editor-prop="fill" data-id="${escapeHtml(el.id)}"></div>
        <div class="field color-field"><label>Border</label><input type="color" value="${rectStroke(el)}" data-editor-prop="stroke" data-id="${escapeHtml(el.id)}"></div>
        <div class="field"><label>Border width (px)</label><input type="number" min="0" max="20" step="1" value="${el.strokeWidth || 1}" data-editor-prop="strokeWidth" data-value-type="number" data-id="${escapeHtml(el.id)}"></div>
        <div class="field"><label>Line join</label><select data-editor-prop="lineJoin" data-id="${escapeHtml(el.id)}">${['miter','round','bevel'].map(v => `<option value="${v}" ${v===(el.lineJoin||'miter')?'selected':''}>${v}</option>`).join('')}</select></div>`;
    }
    if(el.type === 'line'){
      html += `
        <div class="field color-field"><label>Color</label><input type="color" value="${lineStroke(el)}" data-editor-prop="stroke" data-id="${escapeHtml(el.id)}"></div>
        <div class="field"><label>Thickness (px)</label><input type="number" min="1" max="20" step="1" value="${lineWidth(el)}" data-editor-prop="strokeWidth" data-value-type="number" data-id="${escapeHtml(el.id)}"></div>
        <div class="field"><label>Line join</label><select data-editor-prop="lineJoin" data-id="${escapeHtml(el.id)}">${['miter','round','bevel'].map(v => `<option value="${v}" ${v===(el.lineJoin||'miter')?'selected':''}>${v}</option>`).join('')}</select></div>`;
    }
    html += `<div class="field"><label>Opacity</label><input type="range" min="0" max="1" step="0.05" value="${Number.isFinite(el.opacity) ? el.opacity : 1}" data-editor-prop="opacity" data-value-type="number" data-id="${escapeHtml(el.id)}"></div>`;
    html += `<div class="field"><label>Shadow blur</label><input type="number" min="0" max="50" step="1" value="${Number(el.shadowBlur) || 0}" data-editor-prop="shadowBlur" data-value-type="number" data-id="${escapeHtml(el.id)}"></div>`;
    html += `
      <div class="row-btns" style="margin-top:14px">
        <button class="btn small" data-selection-command="flip-x">Flip H</button>
        <button class="btn small" data-selection-command="flip-y">Flip V</button>
        <button class="btn small" data-selection-command="rotate-left">Rotate</button>
        <button class="btn small" data-selection-command="bring-forward">Forward</button>
        <button class="btn small" data-selection-command="send-backward">Backward</button>
        <button class="btn small" data-selection-command="bring-front">Front</button>
        <button class="btn small" data-selection-command="send-back">Back</button>
        <button class="btn small" data-selection-command="duplicate">Duplicate</button>
        <button class="btn small danger" data-selection-command="delete">Delete</button>
      </div>`;
    box.innerHTML = html;
    return;
  }

  let html = `<div class="multi-count">${ids.length} elements selected</div>`;
  html += `
    <div class="field"><label>Align</label>
      <div class="align-grid">
        <button class="btn small" data-selection-command="align" data-mode="left">Left</button>
        <button class="btn small" data-selection-command="align" data-mode="hcenter">Center</button>
        <button class="btn small" data-selection-command="align" data-mode="right">Right</button>
        <button class="btn small" data-selection-command="align" data-mode="top">Top</button>
        <button class="btn small" data-selection-command="align" data-mode="vcenter">Middle</button>
        <button class="btn small" data-selection-command="align" data-mode="bottom">Bottom</button>
      </div>
    </div>
    <div class="field">
      <div class="row-btns">
        <button class="btn small" ${ids.length<3?'disabled':''} data-selection-command="distribute" data-axis="h">Distribute H</button>
        <button class="btn small" ${ids.length<3?'disabled':''} data-selection-command="distribute" data-axis="v">Distribute V</button>
      </div>
    </div>
    <div class="row-btns" style="margin-top:14px">
      <button class="btn small" data-selection-command="bring-front">Front</button>
      <button class="btn small" data-selection-command="send-back">Back</button>
      <button class="btn small" data-selection-command="duplicate">Duplicate</button>
      <button class="btn small danger" data-selection-command="delete">Delete</button>
    </div>`;
  box.innerHTML = html;
}

export function updateSchemaView(){
  const out = document.getElementById('schemaOutput');
  if(out) out.textContent = JSON.stringify({ page: state.page, elements: state.elements }, null, 2);
}

export function layerLabel(el){
  if(el.type === 'text') return el.field ? `Text: ${el.field}` : `Text: ${el.content || 'Untitled'}`;
  if(el.type === 'image') return el.role === 'logo' ? 'Image: logo' : 'Image: photo';
  return el.type === 'line' ? 'Line' : 'Rectangle';
}

export function selectLayer(id, additive){
  const selected = additive ? new Set(state.selectedIds) : new Set();
  if(additive && selected.has(id)) selected.delete(id); else selected.add(id);
  state.selectedIds = selected;
  if(window.render) window.render();
}

export function renderLayers(){
  const box = document.getElementById('layersList');
  if(!box) return;
  box.className = 'layers-list';
  box.innerHTML = state.elements.slice().reverse().map((el, reverseIndex) => {
    const order = state.elements.length - reverseIndex;
    return `<button class="layer-row ${state.selectedIds.has(el.id) ? 'selected' : ''}" data-action="select-layer" data-id="${escapeHtml(el.id)}" title="Select ${escapeHtml(layerLabel(el))}">
      <span class="layer-index">${order}</span><span class="layer-name">${escapeHtml(layerLabel(el))}</span>
    </button>`;
  }).join('');
}
