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
