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
  assert.deepEqual(r, { name: 'A-1 VAC & SEWING', street: '4069 W Charleston Blvd', city: 'Las Vegas, NV 89102', pro: '006365941', handwritten: '' });
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

test('stack mode returns every sheet with a pro#', async () => {
  const { parseStack } = await import('../src/pallet-read.js');
  const env = { AI: { run: async (model, input) => {
    assert.match(input.messages[0].content[0].text, /fanned out/);
    return { response: '{"sheets":[{"pro":"006365941","name":"A-1 VAC","street":"4069 W Charleston","city":"Las Vegas"},{"pro":"??","name":"x"}]}' };
  } } };
  const res = await worker.fetch(post({ image: IMG, mode: 'stack' }), env);
  const out = await res.json();
  assert.equal(out.sheets.length, 1);
  assert.equal(out.sheets[0].pro, '006365941');
  assert.equal(parseStack('nothing'), null);
});

test('the Las Vegas box wins when the model swaps consignee and shipper', async () => {
  const { parseStack, parseAddress } = await import('../src/pallet-read.js');
  const sheets = parseStack(JSON.stringify({ sheets: [
    { pro: '900602915', left: { name: 'ECOLAB SAN BERNARDINO DC', street: '531 E CENTRAL AVE', city: 'SAN BERNARDINO, CA 92408' },
      right: { name: 'BRADY LINEN SERVICES', street: '2501 LOSEE RD', city: 'NORTH LAS VEGAS, NV 89030' } },
    { pro: '006365941', left: { name: 'A-1 VAC & SEWING', street: '4069 W CHARLESTON BLVD', city: 'LAS VEGAS, NV 89102' },
      right: { name: 'CHINA FEIYUE USA', street: '5556 EDISON AVE', city: 'CHINO, CA 91710' } },
  ] }));
  assert.deepEqual(sheets.map((x) => x.name), ['BRADY LINEN SERVICES', 'A-1 VAC & SEWING']);
  const one = parseAddress('{"consignee":{"name":"SML MEDICAL","street":"1 Main","city":"Ontario, CA 91761"},"shipper":{"name":"Desert Clinic","street":"9 Rd","city":"Henderson, NV 89011"},"pro":"6"}');
  assert.equal(one.name, 'Desert Clinic');
});

test('manifest mode returns every row with its consignee', async () => {
  const env = { AI: { run: async (model, input) => {
    assert.match(input.messages[0].content[0].text, /LINE MANIFEST/);
    return { response: '{"rows":[{"pro":"5252550","alt":"","name":"VIP TRANSPORT","street":"6425 S JONES BLVD #1","city":"LAS VEGAS"},{"pro":"980005646","alt":"00277715130","name":"ACUDOR","street":"4216 NORTH PECOS RD","city":"LAS VEGAS"},{"pro":"x","name":"junk"}]}' };
  } } };
  const out = await (await worker.fetch(post({ image: IMG, mode: 'manifest' }), env)).json();
  assert.deepEqual(out.rows.map((r) => [r.pro, r.alt, r.name]), [['5252550', '', 'VIP TRANSPORT'], ['980005646', '00277715130', 'ACUDOR']]);
});

test('manifest header: number, page, origin and last page', async () => {
  const { parseManifestHeader } = await import('../src/pallet-read.js');
  const h = parseManifestHeader('```json\n{"manifest": "00475682", "page": "1", "origin": "PHOENIX", "total": true, "rows": [{"pro":"1"},{"pro":"2"}]}\n```');
  assert.deepEqual(h, { manifest: '475682', page: '1', origin: 'PHOENIX', last: true, listed: 2 });
  assert.deepEqual(parseManifestHeader('{"rows": []}'), { manifest: '', page: '', origin: '', last: false, listed: 0 });
});
