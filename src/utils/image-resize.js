// src/utils/image-resize.js — Native hardware-accelerated image downsizing for canvas proxies
export async function resizeImageFile(file, maxDim = 2000, quality = 0.85){
  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, maxDim / Math.max(bitmap.width, bitmap.height));
  const w = Math.round(bitmap.width * scale);
  const h = Math.round(bitmap.height * scale);
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d');
  ctx.drawImage(bitmap, 0, 0, w, h);
  bitmap.close();
  const mime = file.type === 'image/png' ? 'image/png' : 'image/jpeg';
  return canvas.toDataURL(mime, quality);
}
