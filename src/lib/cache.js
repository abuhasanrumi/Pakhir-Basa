

export const CACHE_PREFIX = "pakhir-basa";

export function cacheKey(name) {
  return `${CACHE_PREFIX}:${name}`;
}

export function readLocalCache(name, fallback = null) {
  try {
    const item = window.localStorage.getItem(cacheKey(name));
    if (!item) return fallback;
    const parsed = JSON.parse(item);
    return parsed?.value ?? fallback;
  } catch {
    return fallback;
  }
}

export function writeLocalCache(name, value) {
  try {
    window.localStorage.setItem(cacheKey(name), JSON.stringify({ cachedAt: new Date().toISOString(), value }));
  } catch {
    // Local cache is a convenience only; the server remains the source of truth.
  }
}
