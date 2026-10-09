// The shape of one day's brief, and the storage behind it.
//
// The morning run sends whatever it wrote; this keeps only the fields the app
// knows how to show, trims them to sane sizes, and fills in what is missing, so
// a sloppy or partial brief still renders instead of breaking the page.

const MAX_LINES = 12;
const MAX_TEXT = 300;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
export const KEEP_DAYS = 14;

const text = (value, max = MAX_TEXT) => String(value ?? '').replace(/\s+/g, ' ').trim().slice(0, max);
const list = (value) => (Array.isArray(value) ? value.slice(0, MAX_LINES) : []);

function emailLine(item) {
  if (typeof item === 'string') return { from: '', subject: '', why: text(item) };
  if (!item || typeof item !== 'object') return null;
  return { from: text(item.from, 80), subject: text(item.subject, 160), why: text(item.why) };
}

function cleanupLine(item) {
  if (typeof item === 'string') return { sender: text(item, 80), count: null };
  if (!item || typeof item !== 'object') return null;
  const count = Number.parseInt(item.count, 10);
  return { sender: text(item.sender ?? item.from, 80), count: Number.isFinite(count) ? count : null };
}

/** Only http(s) links; anything else (javascript:, data:) is dropped. */
function webAddress(value) {
  const address = text(value, 1000);
  return /^https?:\/\//i.test(address) ? address : '';
}

function dinner(item) {
  if (typeof item === 'string') item = { name: item };
  if (!item || typeof item !== 'object') return null;
  const name = text(item.name ?? item.title, 100);
  if (!name) return null;
  const minutes = Number.parseInt(item.minutes, 10);
  const url = webAddress(item.url);
  return {
    name,
    minutes: Number.isFinite(minutes) ? minutes : null,
    why: text(item.why),
    rating: text(item.rating, 40),
    url,
    image: webAddress(item.image ?? item.imageUrl),
    photo: '',
    ingredients: list(item.ingredients).map((line) => text(line, 120)).filter(Boolean).slice(0, 40),
  };
}

/** Today's date where LyFe lives, as YYYY-MM-DD. */
export function localDate(now = new Date(), timeZone = 'America/Los_Angeles') {
  return new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(now);
}

/** Returns { brief } or { error }. */
export function normalizeBrief(input, now = new Date()) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return { error: 'Send the brief as a JSON object.' };
  const date = DATE_RE.test(input.date) ? input.date : localDate(now);
  const email = input.email && typeof input.email === 'object' ? input.email : {};
  const brief = {
    date,
    receivedAt: now.toISOString(),
    greeting: text(input.greeting, 200),
    email: {
      needsYou: list(email.needsYou).map(emailLine).filter((line) => line && (line.why || line.subject)),
      cleanup: list(email.cleanup).map(cleanupLine).filter((line) => line && line.sender),
      note: text(email.note, 200),
    },
    dinners: list(input.dinners).map(dinner).filter(Boolean).slice(0, 5),
    notes: list(input.notes).map((line) => text(line)).filter(Boolean),
  };
  const empty = !brief.email.needsYou.length && !brief.email.cleanup.length && !brief.email.note
    && !brief.dinners.length && !brief.notes.length && !brief.greeting;
  if (empty) return { error: 'That brief has nothing in it.' };
  return { brief };
}

/** Storage on any get/put/delete key-value store (Cloudflare KV in production). */
export function briefStore(kv) {
  const readJson = async (key, fallback) => {
    const raw = await kv.get(key);
    if (!raw) return fallback;
    try {
      return JSON.parse(raw);
    } catch {
      return fallback;
    }
  };

  return {
    async dates() {
      return readJson('dates', []);
    },
    async get(date) {
      if (!date) {
        const dates = await this.dates();
        if (!dates.length) return null;
        date = dates[0];
      }
      if (!DATE_RE.test(date)) return null;
      const brief = await readJson(`brief:${date}`, null);
      if (!brief) return null;
      return { ...brief, added: await readJson(`added:${date}`, []) };
    },
    async put(brief) {
      await kv.put(`brief:${brief.date}`, JSON.stringify(brief));
      const dates = [brief.date, ...(await this.dates()).filter((d) => d !== brief.date)].sort().reverse();
      for (const old of dates.slice(KEEP_DAYS)) {
        const gone = await readJson(`brief:${old}`, null);
        for (const meal of gone?.dinners || []) {
          if (meal.photo) await kv.delete(meal.photo.replace(/^\/photo\//, 'photo:'));
        }
        await kv.delete(`brief:${old}`);
        await kv.delete(`added:${old}`);
      }
      await kv.put('dates', JSON.stringify(dates.slice(0, KEEP_DAYS)));
    },
    async markAdded(date, name) {
      const added = await readJson(`added:${date}`, []);
      if (!added.includes(name)) added.push(name);
      await kv.put(`added:${date}`, JSON.stringify(added));
    },
  };
}
