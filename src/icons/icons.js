// src/icons/icons.js — Curated vector icon library for cover generator
export const ICONS = [
  {
    id: 'pin',
    label: 'Location Pin',
    category: 'navigation',
    path: 'M12 2C8.13 2 5 5.13 5 9c0 5.25 7 13 7 13s7-7.75 7-13c0-3.87-3.13-7-7-7zm0 9.5a2.5 2.5 0 1 1 0-5 2.5 2.5 0 0 1 0 5z'
  },
  {
    id: 'building',
    label: 'Building',
    category: 'architecture',
    path: 'M4 22h16 M4 2v20 M20 2v20 M8 22V6h8v16 M8 10h.01 M8 14h.01 M8 18h.01 M16 10h.01 M16 14h.01 M16 18h.01 M12 10h.01 M12 14h.01 M12 18h.01'
  },
  {
    id: 'home',
    label: 'Home',
    category: 'architecture',
    path: 'M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z M9 22V12h6v10'
  },
  {
    id: 'landmark',
    label: 'Landmark',
    category: 'architecture',
    path: 'M3 22h18 M6 18v-7 M10 18v-7 M14 18v-7 M18 18v-7 M12 2L2 7h20L12 2z M4 22v-4h16v4'
  },
  {
    id: 'phone',
    label: 'Phone',
    category: 'contact',
    path: 'M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7A2 2 0 0 1 22 16.92z'
  },
  {
    id: 'mail',
    label: 'Mail',
    category: 'contact',
    path: 'M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z M22 6l-10 7L2 6'
  },
  {
    id: 'globe',
    label: 'Website',
    category: 'contact',
    path: 'M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20z M2 12h20 M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z'
  },
  {
    id: 'user',
    label: 'User',
    category: 'contact',
    path: 'M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2 M12 3a4 4 0 1 0 0 8 4 4 0 0 0 0-8z'
  },
  {
    id: 'users',
    label: 'Team / Firm',
    category: 'contact',
    path: 'M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2 M9 3a4 4 0 1 0 0 8 4 4 0 0 0 0-8z M23 21v-2a4 4 0 0 0-3-3.87 M16 3.13a4 4 0 0 1 0 7.75'
  },
  {
    id: 'calendar',
    label: 'Calendar',
    category: 'document',
    path: 'M19 4H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6a2 2 0 0 0-2-2z M16 2v4 M8 2v4 M3 10h18'
  },
  {
    id: 'clock',
    label: 'Clock',
    category: 'document',
    path: 'M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20z M12 6v6l4 2'
  },
  {
    id: 'ruler',
    label: 'Ruler / Scale',
    category: 'architecture',
    path: 'M2 18l16-16 4 4-16 16-4-4zm4-4l2 2m2-6l2 2m2-6l2 2m2-6l2 2'
  },
  {
    id: 'layers',
    label: 'Layers',
    category: 'architecture',
    path: 'M12 2L2 7l10 5 10-5-10-5z M2 17l10 5 10-5 M2 12l10 5 10-5'
  },
  {
    id: 'grid',
    label: 'Grid / Plan',
    category: 'architecture',
    path: 'M3 3h18v18H3z M3 9h18 M3 15h18 M9 3v18 M15 3v18'
  },
  {
    id: 'compass',
    label: 'Compass',
    category: 'architecture',
    path: 'M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20zm4.24-14.24l-2.12 6.36-6.36 2.12 2.12-6.36 6.36-2.12z'
  },
  {
    id: 'pen-tool',
    label: 'Drafting Tool',
    category: 'architecture',
    path: 'M12 19l7-7 3 3-7 7-3-3z M18 13l-1.5-7.5L2 2l3.5 14.5L13 18l5-5z M2 2l7.586 7.586 M11 11a2 2 0 1 1-4 0 2 2 0 0 1 4 0z'
  },
  {
    id: 'star',
    label: 'Star',
    category: 'badge',
    path: 'M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z'
  },
  {
    id: 'award',
    label: 'Award',
    category: 'badge',
    path: 'M12 15a7 7 0 1 0 0-14 7 7 0 0 0 0 14z M8.21 13.89L7 23l5-3 5 3-1.21-9.12'
  },
  {
    id: 'check',
    label: 'Checkmark',
    category: 'badge',
    path: 'M20 6L9 17l-5-5'
  },
  {
    id: 'check-circle',
    label: 'Check Circle',
    category: 'badge',
    path: 'M22 11.08V12a10 10 0 1 1-5.93-9.14 M22 4L12 14.01l-3-3'
  },
  {
    id: 'bookmark',
    label: 'Bookmark',
    category: 'badge',
    path: 'M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z'
  },
  {
    id: 'heart',
    label: 'Heart',
    category: 'badge',
    path: 'M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z'
  },
  {
    id: 'shield',
    label: 'Shield',
    category: 'badge',
    path: 'M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z'
  },
  {
    id: 'file-text',
    label: 'Document',
    category: 'document',
    path: 'M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z M14 2v6h6 M16 13H8 M16 17H8 M10 9H8'
  },
  {
    id: 'camera',
    label: 'Camera',
    category: 'media',
    path: 'M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z M12 9a4 4 0 1 0 0 8 4 4 0 0 0 0-8z'
  },
  {
    id: 'image',
    label: 'Image',
    category: 'media',
    path: 'M19 3H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V5a2 2 0 0 0-2-2z M8.5 10a1.5 1.5 0 1 0 0-3 1.5 1.5 0 0 0 0 3z M21 15l-5-5L5 21'
  },
  {
    id: 'tag',
    label: 'Tag',
    category: 'document',
    path: 'M20.59 13.41l-7.17 7.17a2 2 0 0 1-2.83 0L2 12V2h10l8.59 8.59a2 2 0 0 1 0 2.82z M7 7h.01'
  },
  {
    id: 'info',
    label: 'Info',
    category: 'document',
    path: 'M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20z M12 16v-4 M12 8h.01'
  },
  {
    id: 'arrow-right',
    label: 'Arrow Right',
    category: 'navigation',
    path: 'M5 12h14 M12 5l7 7-7 7'
  },
  {
    id: 'north-arrow',
    label: 'North Arrow',
    category: 'navigation',
    path: 'M12 2L19 21L12 17L5 21L12 2Z'
  },
  {
    id: 'tree',
    label: 'Tree / Eco',
    category: 'architecture',
    path: 'M12 2L6 9h3l-4 6h5v5h4v-5h5l-4-6h3z'
  },
  {
    id: 'link',
    label: 'Link',
    category: 'document',
    path: 'M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71 M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71'
  },
  {
    id: 'share',
    label: 'Share',
    category: 'document',
    path: 'M18 8a3 3 0 1 0 0-6 3 3 0 0 0 0 6z M6 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6z M18 22a3 3 0 1 0 0-6 3 3 0 0 0 0 6z M8.59 13.51l6.83 3.98 M15.41 6.51l-6.82 3.98'
  },
  {
    id: 'map',
    label: 'Map',
    category: 'navigation',
    path: 'M1 6v16l7-4 8 4 7-4V2l-7 4-8-4-7 4z M8 2v16 M16 6v16'
  },
  {
    id: 'search',
    label: 'Search',
    category: 'document',
    path: 'M11 19a8 8 0 1 0 0-16 8 8 0 0 0 0 16z M21 21l-4.35-4.35'
  },
  {
    id: 'box',
    label: '3D Box',
    category: 'architecture',
    path: 'M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z M3.27 6.96L12 12.01l8.73-5.05 M12 22.08V12'
  }
];

const ICONS_BY_ID = new Map(ICONS.map(i => [i.id, i]));

export const DEFAULT_ICON = 'pin';

export function getIconDef(id){
  return ICONS_BY_ID.get(id) || ICONS_BY_ID.get(DEFAULT_ICON) || ICONS[0];
}

export function getIconPath(id){
  const def = getIconDef(id);
  return def ? def.path : ICONS[0].path;
}

