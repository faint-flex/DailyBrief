import { test } from 'node:test';
import assert from 'node:assert/strict';
import worker from '../worker.js';
import { normalizeReport, reportStore, KEEP_REPORT_DAYS } from '../src/report.js';
import { memoryKv } from './helpers.js';

const KEY = 'test-key-123';
const env = () => ({ BRIEF_KEY: KEY, BRIEFS: memoryKv() });
const call = (e, path, { method = 'GET', body, key = KEY } = {}) => worker.fetch(new Request(`https://brief.test${path}`, {
  method, headers: { ...(key ? { Authorization: `Bearer ${key}` } : {}) }, body,
}), e);

const sample = {
  date: '2026-11-15', headline: 'First full day live',
  stats: [{ label: 'Site visitors', value: '335', change: '+12%', trend: [1, 2, 3], tone: 'teal' }, { label: '', value: '1' }],
  lines: ['Website: 423 page views', { label: 'Social', text: '2 posts out' }],
  suggestion: 'Post the freezer image', link: 'javascript:alert(1)',
};

test('a report keeps known fields and drops bad ones', () => {
  const { report } = normalizeReport(sample, new Date('2026-11-16T04:40:00Z'));
  assert.equal(report.app, 'babylog');
  assert.equal(report.title, 'BabyLog');
  assert.equal(report.stats.length, 1);
  assert.deepEqual(report.stats[0].trend, [1, 2, 3]);
  assert.equal(report.stats[0].tone, 'teal');
  assert.equal(report.lines[0].text, 'Website: 423 page views');
  assert.equal(report.link, '');
  assert.ok(normalizeReport({}).error);
  assert.ok(normalizeReport([]).error);
});

test('reports are locked, stored apart from briefs, and read back', async () => {
  const e = env();
  assert.equal((await call(e, '/api/report', { key: 'wrong' })).status, 401);
  assert.deepEqual(await (await call(e, '/api/report')).json(), { report: null, dates: [] });
  const sent = await call(e, '/api/report', { method: 'POST', body: JSON.stringify(sample) });
  assert.equal(sent.status, 200);
  const got = await (await call(e, '/api/report?app=babylog')).json();
  assert.equal(got.report.headline, 'First full day live');
  assert.deepEqual(got.dates, ['2026-11-15']);
  assert.deepEqual(await (await call(e, '/api/brief')).json(), { brief: null, dates: [] });
  assert.equal((await call(e, '/api/report', { method: 'POST', body: '{}' })).status, 400);
});

test('old reports are trimmed', async () => {
  const kv = memoryKv();
  const store = reportStore(kv);
  for (let d = 1; d <= KEEP_REPORT_DAYS + 3; d += 1) {
    const date = new Date(Date.UTC(2026, 0, d)).toISOString().slice(0, 10);
    await store.put(normalizeReport({ ...sample, date }).report);
  }
  assert.equal((await store.dates('babylog')).length, KEEP_REPORT_DAYS);
  assert.equal(await store.get('babylog', '2026-01-01'), null);
});
