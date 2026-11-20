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

// The models sometimes swap the consignee and shipper boxes, so they are asked for
// both and the Worker keeps the one in the Las Vegas area (see chooseConsignee).
export const PROMPT = `This is a photo of a freight delivery receipt. It may be from DDP Delivery Services or another carrier (TOTAL Transportation, Daylight, Southwestern Motor Transport, and so on).
Read BOTH company boxes:
- "consignee": the box labeled CONSIGNEE (on DDP sheets the left box, under "CUSTOMER NUMBER").
- "shipper": the box labeled SHIPPER (on DDP sheets the right box).
Do not use BILL TO or the carrier's own address in the header (like 2711 E Craig Rd or 210 East Lambert Road).
Also read:
- "pro": the printed PRO number (DDP: "PRO LABEL NUMBER", usually 9 digits like 006365941; other carriers: "PRO NO", for example 3546485-00).
- "handwritten": any number written by hand on the sheet (often a 7 to 9 digit warehouse pro like 6356235), or "" if none.
Answer with JSON only, no other text:
{"consignee": {"name": "", "street": "", "city": "city, state zip"}, "shipper": {"name": "", "street": "", "city": ""}, "pro": "", "handwritten": ""}
Use "" for anything you cannot read.`;

export const STACK_PROMPT = `This photo shows a stack of freight delivery receipts fanned out, each sheet overlapping the next so the top strip of every sheet shows.
Each sheet strip has two company boxes side by side, a LEFT box and a RIGHT box. Read BOTH, exactly as printed, for every sheet.
Never use the terminal address in the header (2711 E Craig Rd).
For EVERY sheet also read the PRO LABEL NUMBER (the 9 digits under the barcode at the top right, like 006365941).
List each sheet once, from the TOP of the photo to the BOTTOM. Do not repeat sheets and do not invent sheets.
Answer with JSON only:
{"sheets": [{"pro": "006365941", "left": {"name": "", "street": "", "city": "city, state zip"}, "right": {"name": "", "street": "", "city": "city, state zip"}}]}
Use "" for anything you cannot read.`;

export const MANIFEST_PROMPT = `This is a photo of a printed LINE MANIFEST from a freight terminal. Each row (separated by dashed lines) is one shipment with:
PRO # (a 7 to 9 digit number at the start of the row), CONSIGNEE NAME/CITY (company, street, city: this is who receives it, in or near Las Vegas), and SHIPPER NAME/CITY (ignore the shipper).
Some rows are interline ("**I/L -"): they show a long line pro such as 00277715130 and a carrier code such as SMTL, and the DDP pro (like 980005646) under it. Put the DDP pro in "pro" and the long line pro in "alt". On those rows the consignee is still the company in the CONSIGNEE column (for example ACUDOR, 4216 NORTH PECOS RD, LAS VEGAS), not the carrier name (like SOUTHWESTERN MOTOR T) in the shipper column.
List EVERY row once, top to bottom. Do not invent rows.
Answer with JSON only:
{"rows": [{"pro": "5252550", "alt": "", "name": "VIP TRANSPORT", "street": "6425 S JONES BLVD #1", "city": "LAS VEGAS"}]}
Use "" for anything you cannot read.`;

/** Rows read off a line manifest, each with a usable pro#. */
export function parseManifest(text) {
  const m = String(text).match(/\{[\s\S]*\}/);
  if (!m) return null;
  let o;
  try { o = JSON.parse(m[0]); } catch { return null; }
  const list = Array.isArray(o) ? o : o.rows;
  if (!Array.isArray(list)) return null;
  const digits = (v) => clean(v).replace(/[^0-9A-Za-z]/g, '');
  const seen = new Map();
  for (const x of list.slice(0, 120)) {
    const row = { ...addrOf(x), pro: digits(x?.pro), alt: digits(x?.alt) };
    if (row.pro.length < 6 || (!row.name && !row.street)) continue;
    if (!isLocal(row)) continue; // every consignee here is in the Las Vegas area; anything else is a misread shipper
    if (!seen.has(row.pro)) seen.set(row.pro, row);
  }
  return seen.size ? [...seen.values()] : null;
}

/** True when an address is in the Las Vegas area, where every delivery from this terminal goes. */
export function isLocal(a) {
  const t = `${a?.street || ''} ${a?.city || ''}`.toUpperCase();
  return /\bNV\b|NEVADA|LAS VEGAS|HENDERSON|BOULDER CITY|\b89\d{3}\b/.test(t);
}

const addrOf = (x) => ({ name: clean(x?.name), street: clean(x?.street), city: clean(x?.city) });

/** Picks the consignee: the box that is local, or the first one when both or neither are. */
export function chooseConsignee(first, second) {
  const a = addrOf(first);
  const b = addrOf(second);
  if (!a.name && !a.street) return b;
  if (isLocal(b) && !isLocal(a)) return b;
  return a;
}

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
  const sheets = list.slice(0, 60).map((x) => ({
    ...(x?.left || x?.right ? chooseConsignee(x.left, x.right) : addrOf(x)),
    pro: clean(x?.pro).replace(/[^0-9A-Za-z]/g, ''),
  }))
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
  const digits = (v) => clean(v).replace(/[^0-9A-Za-z]/g, '');
  const place = o.consignee || o.shipper ? chooseConsignee(o.consignee, o.shipper) : addrOf(o);
  const r = { ...place, pro: digits(o.pro), handwritten: digits(o.handwritten) };
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
  let manifest = false;
  try {
    const raw = await request.text();
    if (raw.length > MAX_IMAGE + 200) return json({ error: 'That photo is too big.' }, 413);
    const body = JSON.parse(raw);
    image = body.image;
    stack = body.mode === 'stack';
    manifest = body.mode === 'manifest';
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
            { type: 'text', text: manifest ? MANIFEST_PROMPT : stack ? STACK_PROMPT : PROMPT },
            { type: 'image_url', image_url: { url: image } },
          ],
        }],
        max_tokens: manifest || stack ? 2500 : 200,
        temperature: 0,
      });
      const text = answerText(out);
      if (manifest) {
        const rows = parseManifest(text);
        if (rows) return json({ rows, model });
      } else if (stack) {
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
