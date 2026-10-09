import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { memoryKv } from './helpers.js';
import { normalizeBrief, briefStore, localDate, KEEP_DAYS } from '../src/brief.js';

const example = JSON.parse(fs.readFileSync(new URL('../docs/example-brief.json', import.meta.url)));

test('the example brief comes through whole', () => {
  const { brief, error } = normalizeBrief(example, new Date('2026-10-10T14:50:00Z'));
  assert.equal(error, undefined);
  assert.equal(brief.date, '2026-10-10');
  assert.equal(brief.email.needsYou.length, 2);
  assert.deepEqual(brief.email.cleanup[0], { sender: 'Kate Spade', count: 41 });
  assert.equal(brief.dinners.length, 3);
  assert.equal(brief.dinners[1].url, 'https://www.example.com/garlic-butter-salmon');
  assert.equal(brief.dinners[1].rating, '4.9 from 1,240');
  assert.equal(brief.receivedAt, '2026-10-10T14:50:00.000Z');
});

test('plain strings are accepted for lines and dinners', () => {
  const { brief } = normalizeBrief({ email: { needsYou: ['Rent due Friday'] }, dinners: ['Tacos'] });
  assert.equal(brief.email.needsYou[0].why, 'Rent due Friday');
  assert.equal(brief.dinners[0].name, 'Tacos');
  assert.deepEqual(brief.dinners[0].ingredients, []);
});

test('a missing date becomes today in Pacific time', () => {
  // 03:00 UTC on the 11th is still the evening of the 10th in Los Angeles.
  const now = new Date('2026-10-11T03:00:00Z');
  assert.equal(localDate(now), '2026-10-10');
  assert.equal(normalizeBrief({ notes: ['hi'] }, now).brief.date, '2026-10-10');
});

test('links that are not web addresses are dropped', () => {
  const { brief } = normalizeBrief({ dinners: [{ name: 'x', url: 'javascript:alert(1)' }] });
  assert.equal(brief.dinners[0].url, '');
});

test('empty or malformed briefs are refused', () => {
  assert.ok(normalizeBrief(null).error);
  assert.ok(normalizeBrief([]).error);
  assert.ok(normalizeBrief({ email: {}, dinners: [] }).error);
});

test('the store returns the newest brief and keeps two weeks', async () => {
  const kv = memoryKv();
  const store = briefStore(kv);
  assert.equal(await store.get(), null);
  for (let day = 1; day <= KEEP_DAYS + 2; day += 1) {
    const date = `2026-10-${String(day).padStart(2, '0')}`;
    await store.put(normalizeBrief({ date, notes: [`day ${day}`] }).brief);
  }
  const latest = await store.get();
  assert.equal(latest.date, '2026-10-16');
  assert.deepEqual(latest.added, []);
  const dates = await store.dates();
  assert.equal(dates.length, KEEP_DAYS);
  assert.equal(await store.get('2026-10-01'), null);
  assert.ok(!kv.map.has('brief:2026-10-02'));
});

test('a resent brief replaces that day, and added dinners are remembered', async () => {
  const store = briefStore(memoryKv());
  await store.put(normalizeBrief({ date: '2026-10-10', notes: ['first'] }).brief);
  await store.put(normalizeBrief({ date: '2026-10-10', notes: ['second'] }).brief);
  await store.markAdded('2026-10-10', 'Tacos');
  await store.markAdded('2026-10-10', 'Tacos');
  const brief = await store.get('2026-10-10');
  assert.deepEqual(brief.notes, ['second']);
  assert.deepEqual(brief.added, ['Tacos']);
  assert.deepEqual(await store.dates(), ['2026-10-10']);
});

test('a pool of up to 15 dinners is kept', () => {
  const dinners = Array.from({ length: 20 }, (_, i) => ({ name: `Dinner ${i}` }));
  assert.equal(normalizeBrief({ dinners }).brief.dinners.length, 15);
});
