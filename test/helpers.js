/** An in-memory stand-in for Cloudflare KV. */
export function memoryKv() {
  const map = new Map();
  return {
    map,
    get: async (key) => (map.has(key) ? map.get(key) : null),
    put: async (key, value) => { map.set(key, value); },
    delete: async (key) => { map.delete(key); },
  };
}
