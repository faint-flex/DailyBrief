import test from 'node:test';
import assert from 'node:assert/strict';
import worker from '../worker.js';
import { parseAddress, answerText, MODELS } from '../src/pallet-read.js';

const IMG = 'data:image/jpeg;base64,/9j/AAAA';
const post = (body, headers = {}) => new Request('https://x.test/pallets/read', {
  method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body: JSON.stringify(body),
});

test('parseAddress pulls the JSON out of a chatty answer', () => {
  const r = parseAddress('Sure! ```json\n{"name":"A-1 VAC & SEWING","street":"4069 W Charleston Blvd","city":"Las Vegas, NV 89102","pro":"006-365-941"}\n```');
  assert.deepEqual(r, { name: 'A-1 VAC & SEWING', street: '4069 W Charleston Blvd', city: 'Las Vegas, NV 89102', pro: '006365941' });
  assert.equal(parseAddress('no idea'), null);
  assert.equal(parseAddress('{"name":"","street":""}'), null);
});

test('answerText handles the shapes models return', () => {
  assert.equal(answerText({ response: 'hi' }), 'hi');
  assert.equal(answerText({ response: { name: 'X' } }), '{"name":"X"}');
  assert.equal(answerText({ choices: [{ message: { content: 'yo' } }] }), 'yo');
});

test('/pallets/read falls back to the next model and returns the address', async () => {
  const calls = [];
  const env = { AI: { run: async (model, input) => {
    calls.push(model);
    assert.equal(input.messages[0].content[1].image_url.url, IMG);
    if (model === MODELS[0]) throw new Error('model unavailable');
    return { response: '{"name":"TJ MAXX 898","street":"4100 E Lone Mountain Rd","city":"N Las Vegas, NV 89081","pro":"005118262"}' };
  } } };
  const res = await worker.fetch(post({ image: IMG }), env);
  assert.equal(res.status, 200);
  const out = await res.json();
  assert.equal(out.name, 'TJ MAXX 898');
  assert.equal(out.model, MODELS[1]);
  assert.deepEqual(calls, MODELS.slice(0, 2));
});

test('/pallets/read refuses other sites and bad input', async () => {
  const env = { AI: { run: async () => ({}) } };
  assert.equal((await worker.fetch(post({ image: IMG }, { Origin: 'https://evil.test' }), env)).status, 403);
  assert.equal((await worker.fetch(post({ image: 'http://x/y.png' }), env)).status, 400);
  assert.equal((await worker.fetch(post({ image: IMG }), {})).status, 501);
});
