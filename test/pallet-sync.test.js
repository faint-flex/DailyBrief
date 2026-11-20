import test from 'node:test';
import assert from 'node:assert/strict';
import { mergeDocs, canon } from '../public/pallets/merge.js';
import { syncRoom } from '../src/pallet-sync.js';

const T = Date.UTC(2026, 10, 20, 9);
const stop = (pro) => ({ pro, at: T });
const day = (over = {}) => ({ startedAt: T, drivers: [], pallets: [], pool: [], gone: {}, ...over });

test('two phones scanning different stacks both keep their stacks', () => {
  const a = day({ drivers: [{ id: 'd1', name: 'Rudy', run: 1, stops: [stop('111111')], rev: T + 5 }] });
  const b = day({ drivers: [{ id: 'd2', name: 'Leo', run: 1, stops: [stop('222222')], rev: T + 6 }] });
  const m = mergeDocs(a, b);
  assert.deepEqual(m.drivers.map((d) => d.name), ['Rudy', 'Leo']);
  assert.equal(canon(mergeDocs(a, b)), canon(mergeDocs(b, a)));
});

test('the latest edit to a stack wins', () => {
  const a = day({ drivers: [{ id: 'd1', name: 'Rudy', stops: [stop('1')], rev: T + 5 }] });
  const b = day({ drivers: [{ id: 'd1', name: 'Rudy', stops: [stop('1'), stop('2')], rev: T + 9 }] });
  assert.equal(mergeDocs(a, b).drivers[0].stops.length, 2);
  assert.equal(mergeDocs(b, a).drivers[0].stops.length, 2);
});

test('pallet scans from both phones add up, and cleared ones stay cleared', () => {
  const a = day({ pallets: [{ code: '111', at: T + 1, driverId: 'x' }], gone: { [`p:${T + 3}-999`]: T + 4 } });
  const b = day({ pallets: [{ code: '222', at: T + 2 }, { code: '999', at: T + 3 }] });
  assert.deepEqual(mergeDocs(a, b).pallets, [{ code: '111', at: T + 1 }, { code: '222', at: T + 2 }]);
});

test('a deleted stack stays deleted unless it was changed after', () => {
  const d = { id: 'd1', name: 'Rudy', stops: [], rev: T + 1 };
  assert.equal(mergeDocs(day({ drivers: [d] }), day({ gone: { 'd:d1': T + 2 } })).drivers.length, 0);
  assert.equal(mergeDocs(day({ drivers: [{ ...d, rev: T + 3 }] }), day({ gone: { 'd:d1': T + 2 } })).drivers.length, 1);
});

test('yesterday\'s copy gives way to today, but addresses carry over', () => {
  const old = day({ startedAt: T - 86400000, drivers: [{ id: 'd0', name: 'Old', stops: [] }], pool: [{ pro: '5', name: 'HASA', at: T - 86400000 }] });
  const today = day({ startedAt: T + 1000, drivers: [{ id: 'd1', name: 'Rudy', stops: [] }] });
  const m = mergeDocs(old, today);
  assert.deepEqual(m.drivers.map((d) => d.name), ['Rudy']);
  assert.equal(m.pool[0].name, 'HASA');
  assert.equal(m.startedAt, T + 1000);
});

test('the same shift started a few minutes apart on each phone merges', () => {
  const a = day({ drivers: [{ id: 'd1', name: 'Rudy', stops: [] }] });
  const b = day({ startedAt: T + 300000, drivers: [{ id: 'd2', name: 'Leo', stops: [] }] });
  assert.equal(mergeDocs(a, b).drivers.length, 2);
});

test('newest manifest row wins for the same pro#', () => {
  const a = day({ pool: [{ pro: '00123456', name: 'OLD', at: T - 1 }] });
  const b = day({ pool: [{ pro: '123456', name: 'NEW', at: T }] });
  assert.deepEqual(mergeDocs(a, b).pool.map((r) => r.name), ['NEW']);
});

function memory() {
  const m = new Map();
  return {
    async get(k) { return m.get(k); },
    async put(k, v) { if (typeof k === 'object') for (const [x, y] of Object.entries(k)) m.set(x, y); else m.set(k, v); },
  };
}

test('a room: create, join, poll, push', async () => {
  const s = memory();
  const a = day({ drivers: [{ id: 'd1', name: 'Rudy', stops: [stop('1')], rev: T }] });
  let r = await syncRoom(s, { create: true, doc: a });
  assert.equal(r.body.ver, 1);
  assert.equal((await syncRoom(s, { create: true, doc: a })).status, 409);
  r = await syncRoom(s, { ver: -1 });
  assert.equal(r.body.doc.drivers[0].name, 'Rudy');
  assert.deepEqual((await syncRoom(s, { ver: 1 })).body, { ver: 1 });
  r = await syncRoom(s, { ver: 1, doc: day({ pallets: [{ code: '1', at: T + 5 }] }) });
  assert.equal(r.body.ver, 2);
  assert.equal(r.body.doc.drivers.length, 1);
  assert.equal(r.body.doc.pallets.length, 1);
  assert.equal((await syncRoom(memory(), { ver: -1 })).status, 404);
});
