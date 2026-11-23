import test from 'node:test';
import assert from 'node:assert/strict';
import { handleTraderNews, parseVerdict, MODELS } from '../src/trader-news.js';

const req = (body, keys = { 'APCA-API-KEY-ID': 'k1', 'APCA-API-SECRET-KEY': 's1' }) =>
  new Request('https://x.test/trader/news', { method: 'POST', headers: { 'Content-Type': 'application/json', ...keys }, body: JSON.stringify(body) });
const alpaca = (accountNumber) => async () => new Response(JSON.stringify({ account_number: accountNumber }), { status: 200 });
const BODY = { headlines: [{ headline: 'UNH beats estimates', symbols: ['UNH'] }], candidates: ['UNH'] };

test('parseVerdict reads chatty JSON and fills missing symbols as neutral', () => {
  const v = parseVerdict('Here you go: {"market_mood":"bearish","why":"war","symbols":{"UNH":{"verdict":"bullish","why":"beat"}}}', ['UNH', 'AMD']);
  assert.equal(v.market_mood, 'bearish');
  assert.equal(v.symbols.UNH.verdict, 'bullish');
  assert.equal(v.symbols.AMD.verdict, 'neutral');
  assert.equal(parseVerdict('nope', ['UNH']), null);
  assert.equal(parseVerdict('{"market_mood":"great"}', []), null);
});

test('/trader/news refuses keys from another Alpaca account', async () => {
  const env = { TRADER_ACCOUNT: 'PA123', AI: { run: async () => ({ response: '{}' }) } };
  const r = await handleTraderNews(req(BODY, { 'APCA-API-KEY-ID': 'other', 'APCA-API-SECRET-KEY': 'x' }), env, alpaca('PA999'));
  assert.equal(r.status, 401);
  const r2 = await handleTraderNews(req(BODY, {}), env, alpaca('PA123'));
  assert.equal(r2.status, 401);
});

test('/trader/news falls back to the next model and returns the verdict', async () => {
  const calls = [];
  const env = { TRADER_ACCOUNT: 'PA123', AI: { run: async (model, input) => {
    calls.push(model);
    assert.match(input.messages[0].content, /UNH beats estimates/);
    if (model === MODELS[0]) throw new Error('busy');
    return { response: '{"market_mood":"neutral","why":"quiet","symbols":{"UNH":{"verdict":"bullish","why":"beat"}}}' };
  } } };
  const r = await handleTraderNews(req(BODY), env, alpaca('PA123'));
  assert.equal(r.status, 200);
  const j = await r.json();
  assert.equal(j.market_mood, 'neutral');
  assert.equal(j.symbols.UNH.verdict, 'bullish');
  assert.equal(j.model, MODELS[1]);
  assert.deepEqual(calls, MODELS.slice(0, 2));
});

test('/trader/status stores the scorecard for the brief app', async () => {
  const { handleTraderStatus, readTraderStatus } = await import('../src/trader-news.js');
  const kv = new Map();
  const env = { TRADER_ACCOUNT: 'PA123', BRIEFS: { put: async (k, v) => kv.set(k, v), get: async (k) => kv.get(k) ?? null } };
  const post = (body, keys) => new Request('https://x.test/trader/status', { method: 'POST', headers: keys, body: JSON.stringify(body) });
  const bad = await handleTraderStatus(post({ a: 1 }, { 'APCA-API-KEY-ID': 'zz', 'APCA-API-SECRET-KEY': 'x' }), env, alpaca('PA999'));
  assert.equal(bad.status, 401);
  const r = await handleTraderStatus(post({ trades: 2, start: { date: '2026-11-24' } }, { 'APCA-API-KEY-ID': 'k2', 'APCA-API-SECRET-KEY': 's2' }), env, alpaca('PA123'));
  assert.equal(r.status, 200);
  assert.equal((await readTraderStatus(env)).trades, 2);
});
