// Local persistence for faces, voices, videos, projects, exports, consent
// records and abuse reports. Everything lives in the browser's IndexedDB so the
// studio works without a backend; swap this module for API calls when one exists.

const DB_NAME = 'visage-studio';
const DB_VERSION = 1;
export const STORES = ['faces', 'voices', 'videos', 'projects', 'exports', 'consents', 'reports'];

let dbPromise;

function open() {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      for (const name of STORES) {
        if (!db.objectStoreNames.contains(name)) db.createObjectStore(name, { keyPath: 'id' });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return dbPromise;
}

function tx(store, mode, fn) {
  return open().then(db => new Promise((resolve, reject) => {
    const t = db.transaction(store, mode);
    const result = fn(t.objectStore(store));
    t.oncomplete = () => resolve(result && 'result' in result ? result.result : result);
    t.onerror = () => reject(t.error);
  }));
}

export const uid = (prefix) => `${prefix}_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`;

export async function put(store, record) {
  const rec = { createdAt: Date.now(), ...record, updatedAt: Date.now() };
  await tx(store, 'readwrite', s => s.put(rec));
  emit(store);
  return rec;
}

export const get = (store, id) => tx(store, 'readonly', s => s.get(id));

export async function all(store) {
  const rows = await tx(store, 'readonly', s => s.getAll());
  return rows.sort((a, b) => b.createdAt - a.createdAt);
}

export async function remove(store, id) {
  await tx(store, 'readwrite', s => s.delete(id));
  emit(store);
}

export async function clearAll() {
  for (const s of STORES) await tx(s, 'readwrite', st => st.clear());
  STORES.forEach(emit);
}

// Object URLs for stored blobs, cached so lists don't leak a new URL per render.
const urlCache = new Map();
export function blobUrl(id, blob) {
  if (!blob) return '';
  const cached = urlCache.get(id);
  if (cached && cached.blob === blob) return cached.url;
  if (cached) URL.revokeObjectURL(cached.url);
  const url = URL.createObjectURL(blob);
  urlCache.set(id, { blob, url });
  return url;
}

const listeners = new Set();
export function onChange(fn) { listeners.add(fn); return () => listeners.delete(fn); }
function emit(store) { listeners.forEach(fn => fn(store)); }

// Small key/value settings (plan, display name, provider config) in localStorage.
const SETTINGS_KEY = 'visage-settings';
const DEFAULT_SETTINGS = {
  displayName: 'Creator',
  plan: 'free',
  exportQuality: '720',
  apiBase: '',
};
export function getSettings() {
  try { return { ...DEFAULT_SETTINGS, ...JSON.parse(localStorage.getItem(SETTINGS_KEY) || '{}') }; }
  catch { return { ...DEFAULT_SETTINGS }; }
}
export function saveSettings(patch) {
  const next = { ...getSettings(), ...patch };
  try { localStorage.setItem(SETTINGS_KEY, JSON.stringify(next)); } catch { /* private mode */ }
  return next;
}
