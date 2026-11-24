// Quick Node check for the engines & boosters feature: run `node public/apogee2/engines-check.cjs`.
// 1) Old designs (no side boosters, old engines) give exactly the capacity and cost they had before.
// 2) Side boosters add payload, cost money, lower launch odds a little, and don't change old designs.
'use strict';
const assert = require('assert');
require('./sim.js');
const S = globalThis.APOGEE_SIM;
const D = [
  { stages: [{ engine: 'ember', count: 1, prop: 45 }, { engine: 'emberv', count: 1, prop: 9 }] }, // the starting Pathfinder
  { stages: [{ engine: 'ember', count: 9, prop: 400 }, { engine: 'emberv', count: 1, prop: 90 }] },
  { stages: [{ engine: 'comet', count: 7, prop: 550 }, { engine: 'cometv', count: 1, prop: 120 }, { engine: 'emberv', count: 1, prop: 10 }] },
  { stages: [{ engine: 'nova', count: 33, prop: 3400 }, { engine: 'novav', count: 6, prop: 1200 }] },
];
const T = [{}, { lighttanks: 1, legs: 1 }, { steel: 1, comet: 1, nova: 1, refill: 1, lighttanks: 1 }];
// [design, techs, recovery, target, capacity t, cost $M] recorded with sim.js before this feature.
const EXPECTED = [[0,0,"expend","LEO",0.760307,4.762],[0,0,"expend","GTO",0,4.762],[0,0,"expend","MTO",0,4.762],[0,0,"rtls","LEO",0.053872,4.762],[0,0,"rtls","GTO",0,4.762],[0,0,"rtls","MTO",0,4.762],[0,0,"catch","LEO",0.080281,4.762],[0,0,"catch","GTO",0,4.762],[0,0,"catch","MTO",0,4.762],[0,1,"expend","LEO",0.933148,4.762],[0,1,"expend","GTO",0,4.762],[0,1,"expend","MTO",0,4.762],[0,1,"rtls","LEO",0.190766,4.762],[0,1,"rtls","GTO",0,4.762],[0,1,"rtls","MTO",0,4.762],[0,1,"catch","LEO",0.218856,4.762],[0,1,"catch","GTO",0,4.762],[0,1,"catch","MTO",0,4.762],[0,2,"expend","LEO",1.027045,4.6648],[0,2,"expend","GTO",0,4.6648],[0,2,"expend","MTO",0,4.6648],[0,2,"rtls","LEO",0.264372,4.6648],[0,2,"rtls","GTO",0,4.6648],[0,2,"rtls","MTO",0,4.6648],[0,2,"catch","LEO",0.293413,4.6648],[0,2,"catch","GTO",0,4.6648],[0,2,"catch","MTO",0,4.6648],[1,0,"expend","LEO",16.965835,13.27],[1,0,"expend","GTO",4.101279,13.27],[1,0,"expend","MTO",0.821743,13.27],[1,0,"rtls","LEO",10.925736,13.27],[1,0,"rtls","GTO",1.330997,13.27],[1,0,"rtls","MTO",0,13.27],[1,0,"catch","LEO",10.71972,13.27],[1,0,"catch","GTO",1.240042,13.27],[1,0,"catch","MTO",0,13.27],[1,1,"expend","LEO",18.623226,13.27],[1,1,"expend","GTO",5.461553,13.27],[1,1,"expend","MTO",2.099179,13.27],[1,1,"rtls","LEO",12.294551,13.27],[1,1,"rtls","GTO",2.5428,13.27],[1,1,"rtls","MTO",0.070936,13.27],[1,1,"catch","LEO",12.081426,13.27],[1,1,"catch","GTO",2.448504,13.27],[1,1,"catch","MTO",0.006121,13.27],[1,2,"expend","LEO",19.521517,12.388],[1,2,"expend","GTO",6.195167,12.388],[1,2,"expend","MTO",2.786449,12.388],[1,2,"rtls","LEO",13.030474,12.388],[1,2,"rtls","GTO",3.191965,12.388],[1,2,"rtls","MTO",0.697663,12.388],[1,2,"catch","LEO",12.813384,12.388],[1,2,"catch","GTO",3.095795,12.388],[1,2,"catch","MTO",0.63154,12.388],[2,0,"expend","LEO",33.568163,25.14],[2,0,"expend","GTO",12.582857,25.14],[2,0,"expend","MTO",7.60414,25.14],[2,0,"rtls","LEO",23.302162,25.14],[2,0,"rtls","GTO",8.23714,25.14],[2,0,"rtls","MTO",4.781924,25.14],[2,0,"catch","LEO",22.916584,25.14],[2,0,"catch","GTO",8.083416,25.14],[2,0,"catch","MTO",4.683476,25.14],[2,1,"expend","LEO",35.701228,25.14],[2,1,"expend","GTO",13.88729,25.14],[2,1,"expend","MTO",8.593152,25.14],[2,1,"rtls","LEO",24.838854,25.14],[2,1,"rtls","GTO",9.141699,25.14],[2,1,"rtls","MTO",5.462249,25.14],[2,1,"catch","LEO",24.433641,25.14],[2,1,"catch","GTO",8.975336,25.14],[2,1,"catch","MTO",5.35428,25.14],[2,2,"expend","LEO",36.875211,23.916],[2,2,"expend","GTO",14.62201,23.916],[2,2,"expend","MTO",9.158047,23.916],[2,2,"rtls","LEO",25.684347,23.916],[2,2,"rtls","GTO",9.652487,23.916],[2,2,"rtls","MTO",5.850871,23.916],[2,2,"catch","LEO",25.268445,23.916],[2,2,"catch","GTO",9.47911,23.916],[2,2,"catch","MTO",5.737499,23.916],[3,0,"expend","LEO",253.307475,83.3],[3,0,"expend","GTO",78.016215,83.3],[3,0,"expend","MTO",30.967694,83.3],[3,0,"rtls","LEO",186.019205,83.3],[3,0,"rtls","GTO",44.64629,83.3],[3,0,"rtls","MTO",6.997186,83.3],[3,0,"catch","LEO",182.708462,83.3],[3,0,"catch","GTO",43.058032,83.3],[3,0,"catch","MTO",5.867056,83.3],[3,1,"expend","LEO",272.985479,83.3],[3,1,"expend","GTO",95.200902,83.3],[3,1,"expend","MTO",47.403744,83.3],[3,1,"rtls","LEO",203.57699,83.3],[3,1,"rtls","GTO",60.622348,83.3],[3,1,"rtls","MTO",22.530828,83.3],[3,1,"catch","LEO",200.179969,83.3],[3,1,"catch","GTO",58.988448,83.3],[3,1,"catch","MTO",21.367364,83.3],[3,2,"expend","LEO",283.567779,75.02],[3,2,"expend","GTO",104.420526,75.02],[3,2,"expend","MTO",56.211391,75.02],[3,2,"rtls","LEO",212.987919,75.02],[3,2,"rtls","GTO",69.168594,75.02],[3,2,"rtls","MTO",30.834388,75.02],[3,2,"catch","LEO",209.54338,75.02],[3,2,"catch","GTO",67.509418,75.02],[3,2,"catch","MTO",29.652435,75.02]];
for (const [i, j, rec, tg, cap, cost] of EXPECTED) {
  assert.strictEqual(+S.capacity(D[i], tg, rec, T[j]).toFixed(6), cap, `capacity changed: design ${i} techs ${j} ${rec} ${tg}`);
  assert.strictEqual(+S.designCost(D[i], T[j]).toFixed(6), cost, `cost changed: design ${i}`);
}
// An empty srb field behaves like none.
assert.strictEqual(S.capacity({ ...D[0], srb: { type: 'small', count: 0 } }, 'LEO', 'expend', {}), S.capacity(D[0], 'LEO', 'expend', {}));
const all = { srb: 1, srbheavy: 1, legs: 1 };
const withSrb = { ...D[1], srb: { type: 'small', count: 4 } };
assert.ok(S.capacity(withSrb, 'LEO', 'expend', all) > S.capacity(D[1], 'LEO', 'expend', all), 'side boosters add payload');
assert.ok(S.capacity(withSrb, 'LEO', 'rtls', all) > S.capacity(D[1], 'LEO', 'rtls', all), 'side boosters help reusable flights too');
assert.ok(S.designCost(withSrb, all) > S.designCost(D[1], all), 'side boosters cost money');
assert.ok(S.launchOdds(withSrb, {}, 3) < S.launchOdds(D[1], {}, 3), 'side boosters lower launch odds a little');
assert.deepStrictEqual(S.validate({ ...D[1], srb: { type: 'large', count: 2 } }, { srb: 1 }), ['Basalt side boosters need research.']);
assert.deepStrictEqual(S.validate({ ...D[1], srb: { type: 'small', count: 3 } }, all), ['Side boosters: pick a size and 2, 4 or 6.']);
for (const id of Object.keys(S.ENGINES)) assert.ok(!S.ENGINES[id].tech || S.TECHS[S.ENGINES[id].tech], `${id} has a research item`);
console.log(`engines-check: ${EXPECTED.length} old capacities unchanged, side booster checks passed.`);
