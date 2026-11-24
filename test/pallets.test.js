import test from 'node:test';
import assert from 'node:assert/strict';
import { norm, findStop, findExact, loadInfo } from '../public/pallets/match.js';

const drivers = [
  { id: 'a', name: 'Leo', stops: [{ pro: '006365941' }, { pro: '006347436' }, { pro: '943113724' }] },
  { id: 'b', name: 'Maria', stops: [{ pro: '00509298350' }, { pro: '005229142' }] },
];

test('norm drops leading zeros, spaces and dashes', () => {
  assert.equal(norm('006365941'), '6365941');
  assert.equal(norm(' 006-365 941 '), '6365941');
  assert.equal(norm('*006365941*'), '6365941');
  assert.equal(norm('0000'), '0000');
});

test('a sticker matches its sheet with or without leading zeros', () => {
  assert.deepEqual(findStop(drivers, '6365941'), { driver: drivers[0], index: 0 });
  assert.deepEqual(findStop(drivers, '005229142'), { driver: drivers[1], index: 1 });
});

test('a sticker with a piece suffix still matches', () => {
  assert.equal(findStop(drivers, '00634743601').index, 1);
  assert.equal(findStop(drivers, '006347436-2').driver.name, 'Leo');
});

test('an unknown pallet finds nothing', () => {
  assert.equal(findStop(drivers, '999999999'), null);
  assert.equal(findStop(drivers, '12'), null);
});

test('stack building only merges exact pros', () => {
  assert.equal(findExact(drivers, '00634743601'), null);
  assert.equal(findExact(drivers, '6347436').index, 1);
});

test('stop 1 loads last, the last stop loads first', () => {
  assert.equal(loadInfo(0, 8).where, 'Load LAST · at the doors');
  assert.equal(loadInfo(7, 8).where, 'Load FIRST · at the nose');
  assert.equal(loadInfo(2, 8).where, 'Load 6th of 8');
  assert.equal(loadInfo(0, 1).where, 'Only stop');
});

test('stack photo sheets pair with scanned stops, allowing one misread digit', async () => {
  const { pairSheets, nearlySame } = await import('../public/pallets/match.js');
  assert.ok(nearlySame('006341874', '006541874'));
  assert.ok(nearlySame('006371046', '0063701046'));
  assert.ok(!nearlySame('006341874', '006541883'));
  const stops = [{ pro: '006341874' }, { pro: '006341883' }, { pro: '006371046' }];
  const pairs = pairSheets(stops, [
    { pro: '006541874', name: 'GALLEHERDUFFY' }, // one digit off, unique
    { pro: '0063701046', name: 'ONE MONROE' }, // extra digit
    { pro: '999999999', name: 'nobody' },
  ]);
  assert.deepEqual(pairs.map((p) => [p.index, p.sheet.name]), [[0, 'GALLEHERDUFFY'], [2, 'ONE MONROE']]);
});

test('manifest pool matches a stop by pro, interline pro, or one digit off', async () => {
  const { poolMatch } = await import('../public/pallets/match.js');
  const pool = [{ pro: '5252550', alt: '', name: 'VIP TRANSPORT' }, { pro: '980005646', alt: '00277715130', name: 'ACUDOR' }];
  assert.equal(poolMatch(pool, '005252550').name, 'VIP TRANSPORT');
  assert.equal(poolMatch(pool, '00277715130').name, 'ACUDOR');
  assert.equal(poolMatch(pool, '005252551').name, 'VIP TRANSPORT');
  assert.equal(poolMatch(pool, '111111111'), null);
});

test('Stops lookup finds manifest addresses, route stops and partial pro#s', async () => {
  const { lookupAddress } = await import('../public/pallets/match.js');
  const pool = [
    { pro: '980005646', alt: '00277715130', name: 'ACUDOR', street: '4216 N PECOS RD', city: 'LAS VEGAS', at: 2 },
    { pro: '006365941', name: 'HASA', street: '1 A ST', city: 'HENDERSON', at: 1 },
  ];
  const drv = [{ id: 'r', name: 'Rudy', stops: [{ pro: '6365941' }, { pro: '7777777', addr: { name: 'TOTAL', street: '5 B', city: 'LV' } }] }];
  assert.equal(lookupAddress(drv, pool, '6365941')[0].name, 'HASA');
  assert.equal(lookupAddress(drv, pool, '6365941')[0].driver.name, 'Rudy');
  assert.equal(lookupAddress(drv, pool, '277715130')[0].name, 'ACUDOR');
  assert.equal(lookupAddress(drv, pool, '980005647')[0].name, 'ACUDOR'); // one digit off
  assert.equal(lookupAddress(drv, pool, '7777777')[0].name, 'TOTAL');
  assert.equal(lookupAddress(drv, pool, '5646')[0].name, 'ACUDOR'); // part of the number
  assert.equal(lookupAddress(drv, pool, '12').length, 0);
});

test('the address book lists every stop once, newest first', async () => {
  const { addressBook } = await import('../public/pallets/match.js');
  const pool = [{ pro: '111111', name: 'A', at: 1 }, { pro: '222222', name: 'B', at: 3 }];
  const drv = [{ id: 'r', name: 'Rudy', stops: [{ pro: '0111111', at: 5 }, { pro: '333333', at: 2 }] }];
  const book = addressBook(drv, pool);
  assert.deepEqual(book.map((r) => norm(r.pro)), ['222222', '333333', '111111']);
  assert.equal(book.find((r) => r.name === 'A').driver.name, 'Rudy');
});

test('a DR suffix on a pro# still matches the manifest', async () => {
  const { poolMatch } = await import('../public/pallets/match.js');
  assert.equal(norm('00279297590DR'), '279297590');
  const pool = [{ pro: '980011111', alt: '00279297590', name: 'X' }, { pro: '279297590', name: 'Y' }];
  assert.equal(poolMatch([pool[0]], '00279297590DR').name, 'X');
  assert.equal(poolMatch([pool[1]], '00279297590DR').name, 'Y');
  assert.equal(norm('SHEET1'), 'SHEET1');
  assert.equal(norm('ABC'), 'ABC');
});
