import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import worker from '../worker.js';
import { normalizeBrief, briefStore, KEEP_DAYS } from '../src/brief.js';
import { savePhotos, MAX_PHOTO_BYTES } from '../src/photos.js';
import { memoryKv } from './helpers.js';

const realFetch = globalThis.fetch;
afterEach(() => { globalThis.fetch = realFetch; });

const JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3]);

/** A recipe site: /good.jpg is a photo, /page.html is not, /huge.jpg is too big, /down fails. */
function fakeSite(url) {
  const { pathname } = new URL(url);
  if (pathname === '/good.jpg') return new Response(JPEG, { headers: { 'Content-Type': 'image/jpeg' } });
  if (pathname === '/huge.jpg') return new Response(new Uint8Array(MAX_PHOTO_BYTES + 1), { headers: { 'Content-Type': 'image/jpeg' } });
  if (pathname === '/page.html') return new Response('<html>', { headers: { 'Content-Type': 'text/html' } });
  if (pathname === '/logo.svg') return new Response('<svg/>', { headers: { 'Content-Type': 'image/svg+xml' } });
  throw new TypeError('network down');
}

const briefWith = (images, date = '2026-10-10') => normalizeBrief({
  date,
  dinners: images.map((image, i) => ({ name: `Dinner ${i}`, image })),
}).brief;

test('only real, reasonably sized images are kept', async () => {
  const kv = memoryKv();
  const brief = await savePhotos(kv, briefWith([
    'https://site.test/good.jpg', 'https://site.test/page.html', 'https://site.test/huge.jpg',
    'https://site.test/down', 'https://site.test/logo.svg',
  ]), async (url) => fakeSite(url));
  assert.deepEqual(brief.dinners.map((d) => d.photo), ['/photo/2026-10-10:0', '', '', '', '']);
  assert.deepEqual(brief.dinners.map((d) => d.image)[1], 'https://site.test/page.html');
  assert.deepEqual([...kv.map.keys()], ['photo:2026-10-10:0']);
});

test('image links that are not web addresses are dropped', () => {
  const brief = briefWith(['data:image/png;base64,AAAA', 'javascript:alert(1)']);
  assert.deepEqual(brief.dinners.map((d) => d.image), ['', '']);
});

test('a sent brief carries its photos, served without the key', async () => {
  globalThis.fetch = async (url) => fakeSite(url);
  const env = { BRIEF_KEY: 'k', BRIEFS: memoryKv() };
  const body = JSON.stringify({ date: '2026-10-10', dinners: [{ name: 'Tacos', image: 'https://site.test/good.jpg' }, { name: 'Soup' }] });
  const sent = await worker.fetch(new Request('https://b.test/api/brief', { method: 'POST', headers: { Authorization: 'Bearer k' }, body }), env);
  assert.deepEqual(await sent.json(), { ok: true, date: '2026-10-10', dinners: 2, photos: 1 });

  const photo = await worker.fetch(new Request('https://b.test/photo/2026-10-10:0'), env);
  assert.equal(photo.status, 200);
  assert.equal(photo.headers.get('Content-Type'), 'image/jpeg');
  assert.deepEqual(new Uint8Array(await photo.arrayBuffer()), JPEG);

  assert.equal((await worker.fetch(new Request('https://b.test/photo/2026-10-10:1'), env)).status, 404);
  assert.equal((await worker.fetch(new Request('https://b.test/photo/../brief:2026-10-10'), env)).status, 404);
});

test('photos go when their brief expires', async () => {
  const kv = memoryKv();
  const store = briefStore(kv);
  for (let day = 1; day <= KEEP_DAYS + 1; day += 1) {
    const date = `2026-10-${String(day).padStart(2, '0')}`;
    await store.put(await savePhotos(kv, briefWith(['https://site.test/good.jpg'], date), async (url) => fakeSite(url)));
  }
  assert.ok(!kv.map.has('photo:2026-10-01:0'));
  assert.ok(kv.map.has('photo:2026-10-02:0'));
});
