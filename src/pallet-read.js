// Pallet Router: reads the consignee (who the freight goes to) off a photo of a
// delivery receipt, using a vision model on Workers AI in this Cloudflare account.
//
//   POST /pallets/read   { image: "data:image/jpeg;base64,..." }
//   -> { name, street, city, pro, model }

const MAX_IMAGE = 2_500_000; // characters of data URI (~1.8 MB photo)

// Tried in order; the first one that answers with usable JSON wins.
export const MODELS = [
  '@cf/meta/llama-4-scout-17b-16e-instruct',
  '@cf/google/gemma-3-12b-it',
  '@cf/mistralai/mistral-small-3.1-24b-instruct',
];

export const PROMPT = `This is a photo of a freight delivery receipt from DDP Delivery Services (or another carrier).
Read the CONSIGNEE box: the company the freight is delivered to. On DDP sheets it is on the left, under "CUSTOMER NUMBER", with the word CONSIGNEE printed sideways.
Do NOT use the SHIPPER box on the right, the BILL TO box, or the DDP terminal address in the header (2711 E Craig Rd).
Also read the PRO LABEL NUMBER (top right, usually 9 digits such as 006365941).
Answer with JSON only, no other text:
{"name": "consignee company", "street": "street address and suite", "city": "city, state zip", "pro": "pro number"}
Use "" for anything you cannot read.`;

export const STACK_PROMPT = `This photo shows a stack of freight delivery receipts fanned out, each sheet overlapping the next so the top strip of every sheet shows.
Each DDP sheet strip has two company boxes side by side:
- LEFT box = CONSIGNEE (who receives the freight). It is almost always in LAS VEGAS or NORTH LAS VEGAS, NV.
- RIGHT box = SHIPPER (who sent it). It is usually in California, Arizona or another state. IGNORE the shipper.
Never use the terminal address in the header (2711 E Craig Rd).
For EVERY sheet, read the PRO LABEL NUMBER (the 9 digits under the barcode at the top right, like 006365941) and the LEFT consignee company and street.
List each sheet once, from the TOP of the photo to the BOTTOM. Do not repeat sheets and do not invent sheets.
Answer with JSON only:
{"sheets": [{"pro": "006365941", "name": "consignee company", "street": "street", "city": "city, NV zip"}]}
Use "" for anything you cannot read.`;

function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' },
  });
}

/** Pulls the text out of the different shapes Workers AI models answer with. */
export function answerText(out) {
  if (!out) return '';
  if (typeof out === 'string') return out;
  if (typeof out.response === 'string') return out.response;
  if (out.response && typeof out.response === 'object') return JSON.stringify(out.response);
  const c = out.choices?.[0]?.message?.content;
  if (typeof c === 'string') return c;
  return '';
}

const clean = (v) => String(v ?? '').replace(/\s+/g, ' ').trim().slice(0, 120);

/** Every sheet listed in a stack answer, with a usable pro#. */
export function parseStack(text) {
  const m = String(text).match(/\{[\s\S]*\}/);
  if (!m) return null;
  let o;
  try { o = JSON.parse(m[0]); } catch { return null; }
  const list = Array.isArray(o) ? o : o.sheets;
  if (!Array.isArray(list)) return null;
  const sheets = list.slice(0, 60).map((x) => ({ name: clean(x?.name), street: clean(x?.street), city: clean(x?.city), pro: clean(x?.pro).replace(/[^0-9A-Za-z]/g, '') }))
    .filter((x) => x.pro.length >= 6);
  // Some models list the sheets twice (second time without names): keep the first good copy of each pro.
  const seen = new Map();
  for (const x of sheets) {
    const prev = seen.get(x.pro);
    if (!prev || (!prev.name && x.name)) seen.set(x.pro, x);
  }
  sheets.length = 0;
  sheets.push(...seen.values());
  return sheets.length ? sheets : null;
}

/** Finds the JSON object in a model's answer and keeps only the fields we use. */
export function parseAddress(text) {
  const m = String(text).match(/\{[\s\S]*\}/);
  if (!m) return null;
  let o;
  try { o = JSON.parse(m[0]); } catch { return null; }
  return pickAddress(o);
}

function pickAddress(o) {
  const r = { name: clean(o.name), street: clean(o.street), city: clean(o.city), pro: clean(o.pro).replace(/[^0-9A-Za-z]/g, '') };
  return r.name || r.street ? r : null;
}

// A small per-instance limit so a stranger can't burn the free AI allowance.
const hits = new Map();
function limited(ip) {
  const now = Date.now();
  const list = (hits.get(ip) || []).filter((t) => now - t < 60_000);
  list.push(now);
  hits.set(ip, list);
  return list.length > 30;
}

export async function handlePalletRead(request, env) {
  if (request.method !== 'POST') return json({ error: 'POST a photo.' }, 405);
  if (!env.AI) return json({ error: 'Workers AI is not set up on this deployment.' }, 501);
  const origin = request.headers.get('Origin');
  if (origin && origin !== new URL(request.url).origin) return json({ error: 'Not allowed.' }, 403);
  if (limited(request.headers.get('CF-Connecting-IP') || 'local')) return json({ error: 'Too many photos at once. Wait a minute.' }, 429);

  let image;
  let stack = false;
  try {
    const raw = await request.text();
    if (raw.length > MAX_IMAGE + 200) return json({ error: 'That photo is too big.' }, 413);
    const body = JSON.parse(raw);
    image = body.image;
    stack = body.mode === 'stack';
  } catch {
    return json({ error: 'Send JSON with an image.' }, 400);
  }
  if (typeof image !== 'string' || !/^data:image\/(jpeg|png|webp);base64,/.test(image)) return json({ error: 'Send the photo as a data URL.' }, 400);

  const tried = [];
  for (const model of MODELS) {
    try {
      const out = await env.AI.run(model, {
        messages: [{
          role: 'user',
          content: [
            { type: 'text', text: stack ? STACK_PROMPT : PROMPT },
            { type: 'image_url', image_url: { url: image } },
          ],
        }],
        max_tokens: stack ? 2000 : 200,
        temperature: 0,
      });
      const text = answerText(out);
      if (stack) {
        const sheets = parseStack(text);
        if (sheets) return json({ sheets, model });
      } else {
        const found = parseAddress(text);
        if (found) return json({ ...found, model });
      }
      tried.push(`${model}: no address in answer`);
    } catch (err) {
      tried.push(`${model}: ${String(err?.message || err).slice(0, 160)}`);
    }
  }
  return json({ error: 'Could not read an address from that photo.', tried }, 422);
}
