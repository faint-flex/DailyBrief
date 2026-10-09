// Meal photos. Recipe sites often refuse images loaded from another site, so
// when a brief arrives the Worker fetches each dinner's photo once and keeps a
// copy next to the brief. The app shows that copy, and falls back to the
// original address if there isn't one.

export const MAX_PHOTO_BYTES = 2 * 1024 * 1024;
const TIMEOUT_MS = 8000;

export const photoKey = (date, index) => `photo:${date}:${index}`;
export const photoPath = (date, index) => `/photo/${date}:${index}`;

/** Fetch one image; returns { body, type } or null if it is not a usable image. */
export async function fetchPhoto(fetcher, url) {
  try {
    const response = await fetcher(url, {
      redirect: 'follow',
      signal: AbortSignal.timeout(TIMEOUT_MS),
      headers: { Accept: 'image/avif,image/webp,image/jpeg,image/png,image/*;q=0.8', 'User-Agent': 'Mozilla/5.0 (DailyBrief)' },
    });
    const type = (response.headers.get('Content-Type') || '').split(';')[0].trim().toLowerCase();
    if (!response.ok || !type.startsWith('image/') || type === 'image/svg+xml') return null;
    const declared = Number(response.headers.get('Content-Length'));
    if (declared > MAX_PHOTO_BYTES) return null;
    const body = await response.arrayBuffer();
    if (!body.byteLength || body.byteLength > MAX_PHOTO_BYTES) return null;
    return { body, type };
  } catch {
    return null;
  }
}

/** Copies each dinner's photo into storage and records where the app finds it. */
export async function savePhotos(kv, brief, fetcher = fetch) {
  await Promise.all(brief.dinners.map(async (dinner, index) => {
    if (!dinner.image) return;
    const photo = await fetchPhoto(fetcher, dinner.image);
    if (!photo) return;
    await kv.put(photoKey(brief.date, index), photo.body, { metadata: { type: photo.type } });
    dinner.photo = photoPath(brief.date, index);
  }));
  return brief;
}

/** GET /photo/<date>:<index> */
export async function servePhoto(kv, pathname) {
  const match = pathname.match(/^\/photo\/(\d{4}-\d{2}-\d{2}):(\d{1,2})$/);
  if (!match) return new Response('Not found', { status: 404 });
  const { value, metadata } = await kv.getWithMetadata(photoKey(match[1], match[2]), { type: 'arrayBuffer' });
  if (!value) return new Response('Not found', { status: 404 });
  return new Response(value, {
    headers: {
      'Content-Type': metadata?.type || 'image/jpeg',
      'Cache-Control': 'public, max-age=604800',
      'X-Content-Type-Options': 'nosniff',
    },
  });
}
