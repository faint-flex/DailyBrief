// Address photos for stops, kept on the phone in IndexedDB (too big for localStorage).
// Keyed by the normalized pro#, so a photo follows its sheet if it moves to another stack.
const DB = 'pallet-router-photos';
const STORE = 'photos';
let dbp;
function db() {
  dbp = dbp || new Promise((resolve, reject) => {
    const req = indexedDB.open(DB, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return dbp;
}
async function tx(mode, fn) {
  const d = await db();
  return new Promise((resolve, reject) => {
    const t = d.transaction(STORE, mode);
    const r = fn(t.objectStore(STORE));
    t.oncomplete = () => resolve(r?.result);
    t.onerror = () => reject(t.error);
  });
}

const urls = new Map();
export async function putPhoto(key, blob) {
  await tx('readwrite', (s) => s.put(blob, key));
  if (urls.has(key)) URL.revokeObjectURL(urls.get(key));
  urls.set(key, URL.createObjectURL(blob));
}
export async function photoUrl(key) {
  if (urls.has(key)) return urls.get(key);
  const blob = await tx('readonly', (s) => s.get(key));
  if (!blob) return null;
  const url = URL.createObjectURL(blob);
  urls.set(key, url);
  return url;
}
export async function deletePhoto(key) {
  await tx('readwrite', (s) => s.delete(key));
  if (urls.has(key)) { URL.revokeObjectURL(urls.get(key)); urls.delete(key); }
}
export async function clearPhotos() {
  await tx('readwrite', (s) => s.clear());
  for (const u of urls.values()) URL.revokeObjectURL(u);
  urls.clear();
}

/** Shrinks a camera photo to about 1000px wide JPEG so a day of stops stays small. */
export async function shrink(file, max = 1000) {
  const img = await new Promise((resolve, reject) => {
    const i = new Image();
    i.onload = () => resolve(i);
    i.onerror = reject;
    i.src = URL.createObjectURL(file);
  });
  const scale = Math.min(1, max / Math.max(img.naturalWidth, img.naturalHeight));
  const c = document.createElement('canvas');
  c.width = Math.round(img.naturalWidth * scale);
  c.height = Math.round(img.naturalHeight * scale);
  c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
  URL.revokeObjectURL(img.src);
  return new Promise((resolve) => c.toBlob((b) => resolve(b || file), 'image/jpeg', 0.75));
}
