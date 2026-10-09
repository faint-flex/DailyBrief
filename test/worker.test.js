import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import worker, { keyMatches } from '../worker.js';
import { memoryKv } from './helpers.js';

const KEY = 'test-key-123';
const CODE = 'bcdfghjkmnpqrstvwxz2';
const example = fs.readFileSync(new URL('../docs/example-brief.json', import.meta.url), 'utf8');

/** A stand-in for Grocerylist's /api/list/<code>, with its revision check. */
function fakeGrocerylist({ conflictOnce = false } = {}) {
  let saved = { rev: 1, doc: { version: 3, recipes: [], cookbook: [], hidden: {} } };
  let conflict = conflictOnce;
  const service = {
    puts: 0,
    get doc() { return saved.doc; },
    async fetch(request) {
      const { pathname } = new URL(request.url);
      if (pathname !== `/api/list/${CODE}`) return Response.json({ error: 'nope' }, { status: 404 });
      if (request.method === 'GET') return Response.json(saved);
      const body = await request.json();
      if (conflict) {
        conflict = false;
        saved = { rev: saved.rev + 1, doc: saved.doc };
        return Response.json({ error: 'changed', ...saved }, { status: 409 });
      }
      if (body.rev !== saved.rev) return Response.json({ error: 'changed', ...saved }, { status: 409 });
      service.puts += 1;
      saved = { rev: saved.rev + 1, doc: body.doc };
      return Response.json({ rev: saved.rev });
    },
  };
  return service;
}

function env(extra = {}) {
  return { BRIEF_KEY: KEY, BRIEFS: memoryKv(), GROCERY_CODE: CODE, GROCERY: fakeGrocerylist(), ...extra };
}

const call = (e, path, { method = 'GET', body, key = KEY } = {}) => worker.fetch(new Request(`https://brief.test${path}`, {
  method,
  headers: { ...(key ? { Authorization: `Bearer ${key}` } : {}), ...(body ? { 'Content-Type': 'application/json' } : {}) },
  body,
}), e);

test('keys compare exactly', async () => {
  assert.equal(await keyMatches(KEY, KEY), true);
  assert.equal(await keyMatches('test-key-124', KEY), false);
  assert.equal(await keyMatches('', KEY), false);
  assert.equal(await keyMatches(KEY, undefined), false);
});

test('the API is locked without the right key', async () => {
  const e = env();
  assert.equal((await call(e, '/api/brief', { key: null })).status, 401);
  assert.equal((await call(e, '/api/brief', { key: 'wrong' })).status, 401);
  assert.equal((await call(e, '/api/brief', { method: 'POST', body: example, key: 'wrong' })).status, 401);
  assert.equal((await call({ ...e, BRIEF_KEY: '' }, '/api/brief')).status, 501);
});

test('a sent brief can be read back', async () => {
  const e = env();
  const empty = await (await call(e, '/api/brief')).json();
  assert.deepEqual(empty, { brief: null, dates: [] });

  const sent = await call(e, '/api/brief', { method: 'POST', body: example });
  assert.equal(sent.status, 200);
  assert.deepEqual(await sent.json(), { ok: true, date: '2026-10-10', dinners: 3 });

  const { brief, dates } = await (await call(e, '/api/brief')).json();
  assert.equal(brief.dinners[0].name, 'Sheet-pan chicken fajitas');
  assert.deepEqual(dates, ['2026-10-10']);
  assert.equal((await call(e, '/api/brief', { method: 'POST', body: '{not json' })).status, 400);
});

test('Add to list puts the dinner on Grocerylist once', async () => {
  const e = env();
  await call(e, '/api/brief', { method: 'POST', body: example });
  const body = JSON.stringify({ date: '2026-10-10', index: 0 });

  const first = await call(e, '/api/dinner', { method: 'POST', body });
  assert.equal(first.status, 200);
  assert.deepEqual(await first.json(), { added: true, title: 'Sheet-pan chicken fajitas', count: 6 });
  assert.equal(e.GROCERY.doc.recipes.length, 1);
  assert.equal(e.GROCERY.doc.cookbook[0].title, 'Sheet-pan chicken fajitas');
  assert.equal(e.GROCERY.doc.cookbook[0].ingredients[0].qty, 1.5);

  const again = await (await call(e, '/api/dinner', { method: 'POST', body })).json();
  assert.equal(again.added, false);
  assert.equal(e.GROCERY.puts, 1);

  const { brief } = await (await call(e, '/api/brief')).json();
  assert.deepEqual(brief.added, ['Sheet-pan chicken fajitas']);
});

test('Add to list retries when the list changed underneath it', async () => {
  const e = env({ GROCERY: fakeGrocerylist({ conflictOnce: true }) });
  await call(e, '/api/brief', { method: 'POST', body: example });
  const response = await call(e, '/api/dinner', { method: 'POST', body: JSON.stringify({ date: '2026-10-10', index: 2 }) });
  assert.equal(response.status, 200);
  assert.equal(e.GROCERY.doc.recipes.length, 1);
});

test('Add to list explains what is missing', async () => {
  const e = env({ GROCERY_CODE: '' });
  await call(e, '/api/brief', { method: 'POST', body: example });
  const noCode = await call(e, '/api/dinner', { method: 'POST', body: JSON.stringify({ date: '2026-10-10', index: 0 }) });
  assert.equal(noCode.status, 501);
  assert.match((await noCode.json()).error, /share code/);

  const missing = await call(e, '/api/dinner', { method: 'POST', body: JSON.stringify({ date: '2026-10-10', index: 9 }) });
  assert.equal(missing.status, 404);
});
