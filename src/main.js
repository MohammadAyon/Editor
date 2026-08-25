// src/main.js — Main application orchestrator and window exports
import {
  db, currentSession, setCurrentSession, databaseInitRun, incrementDatabaseInitRun,
  signedCoverImageUrl, presetFromRow, presetToRow, brandImageFromRow, projectFromRow
} from './data/supabase-client.js';
import { saveToStorage, LS_KEYS } from './data/storage.js';
import {
  state, presets, setPresets, brandImages, setBrandImages, projects, setProjects,
  createData, undo, redo, refreshUndoRedoButtons
} from './state/state.js';
import { renderPage, applyElementStyle, updateBoundElementsContent } from './canvas/dom-render.js';
import { triggerImageUpload } from './canvas/konva-render.js';
import {
  setZoom, changeZoom, resetZoom, onCanvasWheel, syncZoomLayout
} from './canvas/zoom.js';
import {
  selectOnly, toggleSelect, clearSelection, selectAll, addElement,
  deleteSelection, duplicateSelection, bringSelectionToFront, sendSelectionToBack,
  bringSelectionForward, sendSelectionBackward, centerSelectionH, centerSelectionV,
  alignSelection, distributeSelection, flipSelection, rotateSelection, positionSelection
} from './canvas/selection.js';
import { initCanvasEvents, onPageMouseDown } from './canvas/drag-resize.js';
import {
  renderInspector, renderLayers, updateSchemaView, updateNum, updateProp,
  onDataInput, applyImageAspectRatio, setImageRatioPreset, applyCustomImageRatio, selectLayer
} from './inspector/inspector.js';
import {
  saveCurrentAsPreset, loadPresetForEditing, updateLoadedPreset, deletePreset,
  renderSavedPresetsList, refreshPresetSelect, getSelectedPreset, renderPresetSaveState, seedDefaultPreset
} from './presets/presets.js';
import {
  recordProject, renderProjectsList, reprintProject, deleteProject, generateCover,
  onCreateFieldInput, triggerCreatePhotoUpload, onCreatePhotoSelected, updateDropzonePreview,
  onCreatePresetChange, renderCreatePreview, scalePreviewTo, setCreateZoom, changeCreateZoom,
  resetCreateZoom, onCreateCanvasWheel, updateCreateZoomReadout, centerCreatePage
} from './projects/projects.js';
import {
  triggerBrandUpload, onBrandFileSelected, uploadBrandImage, deleteBrandImage, renderBrandList
} from './brands/brands.js';
import { exportTemplate, importTemplateFile } from './template-io.js';
import { showAuthGate, showAppShell, handleSignIn, handleSignOut } from './auth-ui.js';
import {
  applyPageCSSVars, updatePrintStyle, updatePageSub, onPageSizeChange,
  syncPageSizeSelect, buildRulerLabels, syncPageConfig
} from './page-config.js';

export function getActiveTab(){
  const createView = document.getElementById('viewCreate');
  return (!createView || createView.style.display === 'none') ? 'editor' : 'create';
}

export function switchTab(tab){
  const viewEditor = document.getElementById('viewEditor');
  const viewCreate = document.getElementById('viewCreate');
  const tabBtnEditor = document.getElementById('tabBtnEditor');
  const tabBtnCreate = document.getElementById('tabBtnCreate');
  const editorTopbarActions = document.getElementById('editorTopbarActions');
  if(viewEditor) viewEditor.style.display = tab === 'editor' ? 'flex' : 'none';
  if(viewCreate) viewCreate.style.display = tab === 'create' ? 'flex' : 'none';
  if(tabBtnEditor) tabBtnEditor.classList.toggle('active', tab === 'editor');
  if(tabBtnCreate) tabBtnCreate.classList.toggle('active', tab === 'create');
  if(editorTopbarActions) editorTopbarActions.style.display = tab === 'editor' ? 'flex' : 'none';
  if(tab === 'editor'){
    render();
    updatePrintStyle();
  } else {
    refreshPresetSelect();
    renderCreatePreview();
    renderProjectsList();
    const preset = getSelectedPreset();
    if(preset) updatePrintStyle(preset.page.width, preset.page.height);
  }
}

export function render(){
  renderPage();
  renderInspector();
  renderLayers();
  renderPresetSaveState();
  updateSchemaView();
}

export async function refreshSignedCoverImageUrls(){
  if(!db || !currentSession) return;
  await Promise.all(brandImages.map(async image => {
    if(image.storagePath) image.dataUrl = await signedCoverImageUrl(image.storagePath);
  }));
  await Promise.all(projects.map(async project => {
    if(project.projectImagePath) project.projectImage = await signedCoverImageUrl(project.projectImagePath);
  }));
  renderBrandList();
  renderProjectsList();
  renderPage();
  renderCreatePreview();
}

export async function initFromDatabase(runId){
  if(db && (!currentSession || (runId && runId !== databaseInitRun))) return;
  if(!db){
    console.warn('Supabase is not configured (check supabase-config.js); staying on local-only storage.');
    if(!presets.length) seedDefaultPreset();
    finishDataInit();
    return;
  }
  try{
    const [presetRes, brandRes, projectRes] = await Promise.all([
      db.from('presets').select('*').order('created_at', { ascending: false }),
      db.from('brand_images').select('*').order('created_at', { ascending: false }),
      db.from('projects').select('*').order('created_at', { ascending: false })
    ]);
    if(runId && runId !== databaseInitRun) return;
    if(presetRes.error) throw presetRes.error;
    if(brandRes.error) throw brandRes.error;
    if(projectRes.error) throw projectRes.error;

    setPresets(presetRes.data.map(presetFromRow));
    const loadedBrandImages = await Promise.all(brandRes.data.map(async row => {
      const image = brandImageFromRow(row);
      image.dataUrl = await signedCoverImageUrl(image.storagePath);
      return image;
    }));
    setBrandImages(loadedBrandImages);

    const loadedProjects = await Promise.all(projectRes.data.map(async row => {
      const project = projectFromRow(row);
      project.projectImage = await signedCoverImageUrl(project.projectImagePath);
      return project;
    }));
    setProjects(loadedProjects);

    if(!presets.length){
      seedDefaultPreset();
      const { data, error } = await db.from('presets').insert(presetToRow(presets[0])).select().single();
      if(!error) presets[0] = presetFromRow(data);
    }

    saveToStorage(LS_KEYS.presets, presets);
    saveToStorage(LS_KEYS.brandImages, brandImages);
    saveToStorage(LS_KEYS.projects, projects);
  }catch(err){
    console.warn('Could not reach the database; falling back to the last locally cached data.', err);
    if(!presets.length) seedDefaultPreset();
  }
  finishDataInit();
}

export function finishDataInit(){
  renderSavedPresetsList();
  renderBrandList();
  renderProjectsList();
  refreshPresetSelect();
  renderCreatePreview();
  render();
  switchTab('create');
}

// Attach all functions to window for index.html inline attributes & templates
Object.assign(window, {
  // Auth
  handleSignIn, handleSignOut, showAuthGate, showAppShell,
  // Navigation & tabs
  switchTab, getActiveTab,
  // Undo/redo
  undo, redo,
  // Zoom
  changeZoom, resetZoom, setZoom,
  changeCreateZoom, resetCreateZoom, setCreateZoom,
  // Page size & config
  onPageSizeChange, syncPageConfig,
  // Elements & selection
  addElement, selectOnly, toggleSelect, clearSelection, selectAll,
  deleteSelection, duplicateSelection, bringSelectionToFront, sendSelectionToBack,
  bringSelectionForward, sendSelectionBackward, centerSelectionH, centerSelectionV,
  alignSelection, distributeSelection, flipSelection, rotateSelection, positionSelection,
  // Data input & inspector
  onDataInput, updateNum, updateProp, setImageRatioPreset, applyCustomImageRatio,
  selectLayer, triggerImageUpload,
  // Brand assets
  triggerBrandUpload, onBrandFileSelected, deleteBrandImage, uploadBrandImage,
  // Presets
  saveCurrentAsPreset, loadPresetForEditing, updateLoadedPreset, deletePreset,
  renderSavedPresetsList, refreshPresetSelect,
  // Projects
  onCreateFieldInput, triggerCreatePhotoUpload, onCreatePhotoSelected,
  onCreatePresetChange, generateCover, reprintProject, deleteProject,
  // Template IO
  exportTemplate, importTemplateFile,
  // Rendering
  render, renderPage, renderInspector, renderLayers, renderPresetSaveState,
  updateSchemaView, renderCreatePreview, renderProjectsList, renderBrandList
});

function init(){
  const dataProjectName = document.getElementById('data-projectName');
  const dataLocation = document.getElementById('data-location');
  const dataClientName = document.getElementById('data-clientName');
  const cpProjectName = document.getElementById('cp-projectName');
  const cpLocation = document.getElementById('cp-location');
  const cpClientName = document.getElementById('cp-clientName');

  if(dataProjectName) dataProjectName.value = state.data.projectName;
  if(dataLocation) dataLocation.value = state.data.location;
  if(dataClientName) dataClientName.value = state.data.clientName;
  if(cpProjectName) cpProjectName.value = createData.projectName;
  if(cpLocation) cpLocation.value = createData.location;
  if(cpClientName) cpClientName.value = createData.clientName;

  const cpDropzoneEl = document.getElementById('cpDropzone');
  if(cpDropzoneEl){
    cpDropzoneEl.addEventListener('dragover', e => { e.preventDefault(); cpDropzoneEl.classList.add('dragover'); });
    cpDropzoneEl.addEventListener('dragleave', () => cpDropzoneEl.classList.remove('dragover'));
    cpDropzoneEl.addEventListener('drop', e => {
      e.preventDefault();
      cpDropzoneEl.classList.remove('dragover');
      const f = e.dataTransfer.files[0];
      if(f) onCreatePhotoSelected(f);
    });
  }

  const editorCanvasWrapper = document.querySelector('#viewEditor .canvas-wrapper');
  if(editorCanvasWrapper) editorCanvasWrapper.addEventListener('wheel', onCanvasWheel, { passive: false });
  const createCanvas = document.getElementById('createCanvas');
  if(createCanvas) createCanvas.addEventListener('wheel', onCreateCanvasWheel, { passive: false });

  initCanvasEvents();
  syncPageConfig();
  refreshUndoRedoButtons();
  render();
  syncZoomLayout();
  updateCreateZoomReadout();

  window.setInterval(() => { refreshSignedCoverImageUrls(); }, 45 * 60 * 1000);
  window.addEventListener('focus', () => { refreshSignedCoverImageUrls(); });

  if(db){
    showAuthGate();
    db.auth.onAuthStateChange((event, session) => {
      setCurrentSession(session);
      const runId = incrementDatabaseInitRun();
      if(session){
        showAppShell(session);
        if(event === 'INITIAL_SESSION' || event === 'SIGNED_IN') initFromDatabase(runId);
      } else {
        showAuthGate();
      }
    });
  } else {
    showAppShell(null);
    initFromDatabase();
  }
}

if(document.readyState === 'loading'){
  document.addEventListener('DOMContentLoaded', init);
} else {
  init();
}
