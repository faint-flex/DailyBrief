import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import worker, { keyMatches } from '../worker.js';
import { memoryKv } from './helpers.js';

const KEY = 'test-key-123';
const example = fs.readFileSync(new URL('../docs/example-brief.json', import.meta.url), 'utf8');

function env(extra = {}) {
  return { BRIEF_KEY: KEY, BRIEFS: memoryKv(), ...extra };
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
