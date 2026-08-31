// src/projects/projects.js — Create project panel, preview, zoom, project storage, and reprint
import {
  state, projects, setProjects, createData, createZoom, setCreateZoom as setStateCreateZoom,
  newId, clamp, escapeHtml, sanitizeImageSrc, advanceIdCounter, undoStack, redoStack
} from '../state/state.js';
import { db, uploadCoverImage, signedCoverImageUrl, deleteCoverImage, currentUserId, validateImageFile } from '../data/supabase-client.js';
import { saveToStorage, LS_KEYS, toCacheSafeProjects } from '../data/storage.js';
import { getSelectedPreset } from '../presets/presets.js';
import { elementHTML } from '../canvas/dom-render.js';
import { syncPageConfig, updatePrintStyle } from '../page-config.js';

function saveProjectsCache(){
  saveToStorage(LS_KEYS.projects, toCacheSafeProjects(projects));
}

export function onCreateFieldInput(field, value){
  createData[field] = value;
  renderCreatePreview();
}

export function triggerCreatePhotoUpload(){
  const input = document.getElementById('cpPhotoInput');
  if(input) input.click();
}

export function onCreatePhotoSelected(file){
  if(!file) return;
  const validation = validateImageFile(file);
  if(!validation.ok){ alert(validation.error); return; }
  createData.projectImageFile = file;
  const reader = new FileReader();
  reader.onload = () => {
    createData.projectImage = reader.result;
    updateDropzonePreview();
    renderCreatePreview();
  };
  reader.readAsDataURL(file);
}

export function updateDropzonePreview(){
  const zone = document.getElementById('cpDropzone');
  if(!zone) return;
  const src = sanitizeImageSrc(createData.projectImage);
  zone.innerHTML = src
    ? `<img src="${escapeHtml(src)}"><div class="replace-hint">Click to replace</div>`
    : `<span>Drag a photo here, or click to browse</span>`;
}

export function onCreatePresetChange(){
  const preset = getSelectedPreset();
  if(preset && preset.clientName){
    createData.clientName = preset.clientName;
    const input = document.getElementById('cp-clientName');
    if(input) input.value = createData.clientName;
  }
  renderCreatePreview();
}

export function scalePreviewTo(pageEl, pageWidthMm, pageHeightMm){
  const shell = document.getElementById('previewShell');
  if(!shell || !pageEl) return;
  const mmToPx = 96 / 25.4;
  const pagePxWidth = pageWidthMm * mmToPx;
  const baseWidth = 360;
  const scale = (baseWidth / pagePxWidth) * createZoom;
  pageEl.style.width = pageWidthMm + 'mm';
  pageEl.style.height = pageHeightMm + 'mm';
  pageEl.style.transform = `scale(${scale})`;
  shell.style.width = `${Math.round(baseWidth * createZoom)}px`;
  shell.style.height = `${Math.round(baseWidth * (pageHeightMm / pageWidthMm) * createZoom)}px`;
}

export function updateCreateZoomReadout(){
  const readout = document.getElementById('createZoomReadout');
  if(readout) readout.textContent = Math.round(createZoom * 100) + '%';
}

export function centerCreatePage(){
  const canvas = document.getElementById('createCanvas');
  const shell = document.getElementById('previewShell');
  if(!canvas || !shell) return;
  canvas.scrollLeft = Math.max(0, (shell.offsetWidth - canvas.clientWidth) / 2);
  canvas.scrollTop = Math.max(0, (shell.offsetHeight - canvas.clientHeight) / 2);
}

export function setCreateZoom(value){
  const next = clamp(Math.round(value * 20) / 20, 0.25, 3);
  if(next === createZoom) return;
  setStateCreateZoom(next);
  renderCreatePreview();
  updateCreateZoomReadout();
}

export function changeCreateZoom(delta){ setCreateZoom(createZoom + delta); }
export function resetCreateZoom(){ setCreateZoom(1); }

export function onCreateCanvasWheel(event){
  const activeTab = window.getActiveTab ? window.getActiveTab() : 'create';
  if(activeTab !== 'create') return;
  event.preventDefault();
  setCreateZoom(createZoom * (event.deltaY < 0 ? 1.1 : 0.9));
}

export function renderCreatePreview(){
  const preset = getSelectedPreset();
  const pageEl = document.getElementById('projectPage');
  if(!preset || !pageEl) return;
  pageEl.innerHTML = preset.elements.map(el => elementHTML(el, createData)).join('');
  scalePreviewTo(pageEl, preset.page.width, preset.page.height);
  requestAnimationFrame(centerCreatePage);
}

export async function recordProject(preset){
  const project = {
    id: newId('project'),
    dbId: null,
    projectName: createData.projectName,
    location: createData.location,
    clientName: createData.clientName,
    projectImage: createData.projectImage,
    presetId: preset.id,
    presetName: preset.name,
    presetSnapshot: { page: JSON.parse(JSON.stringify(preset.page)), elements: JSON.parse(JSON.stringify(preset.elements)) },
    createdAt: new Date().toISOString()
  };
  projects.unshift(project);
  saveProjectsCache();
  renderProjectsList();
  if(db){
    try{
      let hostedUrl = null;
      if(createData.projectImageFile) hostedUrl = await uploadCoverImage(createData.projectImageFile, 'projects');
      const row = {
        project_name: project.projectName,
        location: project.location,
        client_name: project.clientName,
        preset_id: preset.id,
        preset_name: project.presetName,
        preset_snapshot: project.presetSnapshot,
        project_image_url: hostedUrl,
        owner_id: currentUserId()
      };
      const { data, error } = await db.from('projects').insert(row).select().single();
      if(error) throw error;
      project.dbId = data.id;
      if(hostedUrl){
        project.projectImagePath = hostedUrl;
        project.projectImage = await signedCoverImageUrl(hostedUrl);
      }
      saveProjectsCache();
    }catch(err){
      console.warn('Could not save this project to the database; it will only exist on this device.', err);
      saveToStorage(LS_KEYS.projects, projects);
    }
  }
  return project;
}

export function renderProjectsList(){
  const box = document.getElementById('projectsList');
  if(!box) return;
  if(!projects.length){
    box.innerHTML = `<p class="hint">Generated projects appear here, linked to the preset that produced them.</p>`;
    return;
  }
  box.innerHTML = projects.map(p => `
    <div class="project-row">
      <div class="project-row-name">${escapeHtml(p.projectName || 'Untitled')}</div>
      <div class="project-row-meta">${escapeHtml(p.presetName)} · ${new Date(p.createdAt).toLocaleDateString()}</div>
      <div class="row-btns">
        <button class="btn small" data-action="open-project-editor" data-id="${escapeHtml(p.id)}">Open in editor</button>
        <button class="btn small" data-action="reprint-project" data-id="${escapeHtml(p.id)}">Reprint</button>
        <button class="btn small danger" data-action="delete-project" data-id="${escapeHtml(p.id)}">Delete</button>
      </div>
    </div>`).join('');
}

export function reprintProject(id){
  const p = projects.find(pr => pr.id === id);
  if(!p) return;
  const pageEl = document.getElementById('projectPage');
  const data = { projectName: p.projectName, location: p.location, clientName: p.clientName, projectImage: p.projectImage };
  pageEl.innerHTML = p.presetSnapshot.elements.map(el => elementHTML(el, data)).join('');
  scalePreviewTo(pageEl, p.presetSnapshot.page.width, p.presetSnapshot.page.height);
  updatePrintStyle(p.presetSnapshot.page.width, p.presetSnapshot.page.height);
  window.print();
}

export function openProjectInEditor(id){
  const p = projects.find(pr => pr.id === id);
  if(!p || !p.presetSnapshot) return;
  state.page = JSON.parse(JSON.stringify(p.presetSnapshot.page));
  state.elements = JSON.parse(JSON.stringify(p.presetSnapshot.elements));
  state.data.projectName = p.projectName || '';
  state.data.location = p.location || '';
  state.data.clientName = p.clientName || '';
  state.data.projectImage = p.projectImage || null;
  advanceIdCounter(state.elements);
  state.selectedIds = new Set();
  undoStack.length = 0;
  redoStack.length = 0;
  for(const field of ['projectName', 'location', 'clientName']){
    const input = document.getElementById('data-' + field);
    if(input) input.value = state.data[field] || '';
  }
  syncPageConfig();
  updatePrintStyle(state.page.width, state.page.height);
  if(window.switchTab) window.switchTab('editor');
  if(window.render) window.render();
}

export async function deleteProject(id){
  const project = projects.find(p => p.id === id);
  if(project && !confirm(`Delete "${project.projectName || 'Untitled'}"? This cannot be undone.`)) return;
  if(db && project){
    if(project.dbId){
      const { error } = await db.from('projects').delete().eq('id', project.dbId);
      if(error){ alert('Could not delete the project from the database: ' + error.message); return; }
    }
    await deleteCoverImage(project.projectImagePath);
  }
  setProjects(projects.filter(p => p.id !== id));
  saveProjectsCache();
  renderProjectsList();
}

export async function generateCover(){
  const preset = getSelectedPreset();
  if(!preset) return;
  const project = await recordProject(preset);
  updatePrintStyle(preset.page.width, preset.page.height);
  return project;
}

export function printCreatePreview(){
  const preset = getSelectedPreset();
  if(!preset) return;
  renderCreatePreview();
  updatePrintStyle(preset.page.width, preset.page.height);
  window.print();
}
