// src/brands/brands.js — Brand assets / logos management (isolated from project photos)
import { brandImages, setBrandImages, newId, escapeHtml, sanitizeImageSrc } from '../state/state.js';
import { db, currentUserId, uploadCoverImage, signedCoverImageUrl, deleteCoverImage, validateImageFile } from '../data/supabase-client.js';
import { saveToStorage, LS_KEYS, toCacheSafeBrandImages } from '../data/storage.js';
import { renderPage } from '../canvas/dom-render.js';
import { renderInspector } from '../inspector/inspector.js';

function saveBrandImagesCache(){
  saveToStorage(LS_KEYS.brandImages, toCacheSafeBrandImages(brandImages));
}

export function triggerBrandUpload(){
  const input = document.getElementById('brandPhotoInput');
  if(input) input.click();
}

export function onBrandFileSelected(file){
  if(!file) return;
  const validation = validateImageFile(file);
  if(!validation.ok){ alert(validation.error); return; }
  const name = prompt('Name this logo / brand image:', file.name.replace(/\.[^.]+$/, ''));
  const input = document.getElementById('brandPhotoInput');
  if(!name){
    if(input) input.value = '';
    return;
  }
  uploadBrandImage(name, file);
  if(input) input.value = '';
}

export async function uploadBrandImage(name, file){
  const localPreview = await new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
  const img = { id: newId('brand/logo'), dbId: null, name, dataUrl: localPreview };
  brandImages.push(img);
  renderBrandList();
  renderPage();
  renderInspector();
  if(db){
    try{
      const storagePath = await uploadCoverImage(file, 'logos');
      const { data, error } = await db.from('brand_images').insert({ name, image_url: storagePath, owner_id: currentUserId() }).select().single();
      if(error) throw error;
      img.dbId = data.id;
      img.storagePath = storagePath;
      img.dataUrl = await signedCoverImageUrl(storagePath);
      renderBrandList();
      renderPage();
    }catch(err){
      alert('Logo added for this session, but could not be saved to the database: ' + err.message);
    }
  }
  saveBrandImagesCache();
  return img;
}

export async function deleteBrandImage(id){
  const img = brandImages.find(b => b.id === id);
  if(img && !confirm(`Remove "${img.name}"? Presets using this logo will show an empty logo slot.`)) return;
  if(db && img && img.dbId){
    const { error } = await db.from('brand_images').delete().eq('id', img.dbId);
    if(error){ alert('Could not delete the logo from the database: ' + error.message); return; }
    await deleteCoverImage(img.storagePath);
  }
  setBrandImages(brandImages.filter(b => b.id !== id));
  saveBrandImagesCache();
  renderBrandList();
  renderPage();
  renderInspector();
}

export function renderBrandList(){
  const box = document.getElementById('brandList');
  if(!box) return;
  box.innerHTML = brandImages.map(b => `
    <div class="brand-row">
      ${sanitizeImageSrc(b.dataUrl) ? `<img class="brand-thumb" src="${escapeHtml(sanitizeImageSrc(b.dataUrl))}">` : ''}
      <span class="brand-name">${escapeHtml(b.name)}</span>
      <button class="btn tiny danger" data-action="delete-brand-image" data-id="${escapeHtml(b.id)}">Remove</button>
    </div>`).join('');
}
