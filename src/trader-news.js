// Day trader news check: scores the morning's headlines with Workers AI (free daily allowance).
//
//   POST /trader/news   headers: APCA-API-KEY-ID, APCA-API-SECRET-KEY (LyFe's Alpaca keys)
//                       body: { headlines: [{ headline, symbols }], candidates: ["UNH", ...] }
//   -> { market_mood, why, symbols: { SYM: { verdict, why } }, model }
//
// Only LyFe's Alpaca account may use it: the keys are checked with Alpaca and the account
// number must match TRADER_ACCOUNT in wrangler.toml. Keys are never stored.
import { MODELS as VISION_MODELS, answerText } from './pallet-read.js';

export const MODELS = ['@cf/meta/llama-3.3-70b-instruct-fp8-fast', ...VISION_MODELS];
const ALPACA = ['https://paper-api.alpaca.markets/v2/account', 'https://api.alpaca.markets/v2/account'];
const ok = new Map(); // key id -> expiry, so Alpaca is asked at most once an hour per isolate

const json = (body, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

async function allowed(request, env, fetcher = fetch) {
  const id = request.headers.get('APCA-API-KEY-ID') || '';
  const secret = request.headers.get('APCA-API-SECRET-KEY') || '';
  if (!id || !secret || !env.TRADER_ACCOUNT) return false;
  if ((ok.get(id) || 0) > Date.now()) return true;
  for (const url of ALPACA) {
    const r = await fetcher(url, { headers: { 'APCA-API-KEY-ID': id, 'APCA-API-SECRET-KEY': secret } });
    if (!r.ok) continue;
    const a = await r.json();
    if (String(a.account_number) === String(env.TRADER_ACCOUNT)) {
      ok.set(id, Date.now() + 3600_000);
      return true;
    }
  }
  return false;
}

export function buildPrompt(headlines, candidates) {
  return [
    'You screen day trades. Below are market headlines from the last 18 hours.',
    `Candidate stocks (bought only if they break out higher today): ${candidates.join(', ') || 'none'}.`,
    'Reply with JSON only, no other text: {"market_mood": "bullish|neutral|bearish", "why": "one sentence",',
    '"symbols": {"SYM": {"verdict": "bullish|neutral|bearish", "why": "one short sentence"}}}.',
    'Bearish means real bad news (lawsuit, downgrade, earnings miss, guidance cut, fraud, recall, war, crash).',
    'Unclear or no news is neutral.',
    '',
    'Headlines:',
    ...headlines.map((h) => `- [${(h.symbols || []).join(',')}] ${h.headline}`),
  ].join('\n');
}

const MOODS = ['bullish', 'neutral', 'bearish'];
const short = (v) => String(v ?? '').replace(/\s+/g, ' ').trim().slice(0, 200);

export function parseVerdict(text, candidates) {
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start < 0 || end <= start) return null;
  let raw;
  try { raw = JSON.parse(text.slice(start, end + 1)); } catch { return null; }
  if (!MOODS.includes(raw.market_mood)) return null;
  const symbols = {};
  for (const s of candidates) {
    const v = raw.symbols?.[s];
    symbols[s] = { verdict: MOODS.includes(v?.verdict) ? v.verdict : 'neutral', why: short(v?.why) };
  }
  return { market_mood: raw.market_mood, why: short(raw.why), symbols };
}

export async function handleTraderNews(request, env, fetcher = fetch) {
  if (request.method !== 'POST') return json({ error: 'POST headlines.' }, 405);
  if (!env.AI) return json({ error: 'Workers AI is not set up on this deployment.' }, 501);
  if (!(await allowed(request, env, fetcher))) return json({ error: 'Not allowed.' }, 401);
  let body;
  try {
    const raw = await request.text();
    if (raw.length > 60_000) return json({ error: 'Too many headlines.' }, 413);
    body = JSON.parse(raw);
  } catch {
    return json({ error: 'Send JSON.' }, 400);
  }
  const headlines = (Array.isArray(body.headlines) ? body.headlines : []).slice(0, 80)
    .map((h) => ({ headline: short(h?.headline), symbols: (h?.symbols || []).slice(0, 5).map(short) }))
    .filter((h) => h.headline);
  const candidates = (Array.isArray(body.candidates) ? body.candidates : []).slice(0, 5)
    .map((s) => String(s).toUpperCase().replace(/[^A-Z.]/g, '')).filter(Boolean);
  if (!headlines.length) return json({ error: 'No headlines.' }, 400);
  const prompt = buildPrompt(headlines, candidates);
  const tried = [];
  for (const model of MODELS) {
    try {
      const out = await env.AI.run(model, { messages: [{ role: 'user', content: prompt }], max_tokens: 700, temperature: 0 });
      const verdict = parseVerdict(answerText(out), candidates);
      if (verdict) return json({ ...verdict, model });
      tried.push(`${model}: no usable JSON`);
    } catch (e) {
      tried.push(`${model}: ${String(e?.message || e).slice(0, 120)}`);
    }
  }
  return json({ error: 'No model gave a usable answer.', tried }, 502);
}

// The day trader's scorecard (daytrader/status.json in faint-flex/Ops), posted after each close.
//   POST /trader/status  (same Alpaca-key check)  body: status JSON
//   GET  /api/trader     (brief key)              -> { status }
const STATUS_KEY = 'trader:status';

export async function handleTraderStatus(request, env, fetcher = fetch) {
  if (request.method !== 'POST') return json({ error: 'POST the status.' }, 405);
  if (!env.BRIEFS) return json({ error: 'Storage is not set up on this deployment.' }, 501);
  if (!(await allowed(request, env, fetcher))) return json({ error: 'Not allowed.' }, 401);
  const raw = await request.text();
  if (raw.length > 50_000) return json({ error: 'Too big.' }, 413);
  let status;
  try { status = JSON.parse(raw); } catch { return json({ error: 'Send JSON.' }, 400); }
  if (!status || typeof status !== 'object' || Array.isArray(status)) return json({ error: 'Send an object.' }, 400);
  await env.BRIEFS.put(STATUS_KEY, JSON.stringify({ ...status, received: new Date().toISOString() }));
  return json({ ok: true });
}

export async function readTraderStatus(env) {
  const raw = await env.BRIEFS.get(STATUS_KEY);
  return raw ? JSON.parse(raw) : null;
}
