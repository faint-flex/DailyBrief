/** An in-memory stand-in for Cloudflare KV. */
export function memoryKv() {
  const map = new Map();
  const meta = new Map();
  return {
    map,
    get: async (key) => (map.has(key) ? map.get(key) : null),
    getWithMetadata: async (key) => ({ value: map.has(key) ? map.get(key) : null, metadata: meta.get(key) || null }),
    put: async (key, value, options = {}) => {
      map.set(key, value);
      meta.set(key, options.metadata || null);
    },
    delete: async (key) => {
      map.delete(key);
      meta.delete(key);
    },
  };
}
