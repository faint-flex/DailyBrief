// App progress reports (BabyLog's end-of-day numbers, later Kitchen List too).
// Kept apart from the morning brief so an evening report never replaces it.
//
// A report: { app, date, headline, stats: [{ label, value, change, sub, trend: [numbers], tone }],
//             lines: [{ label, text }], suggestion, link }

import { localDate } from './brief.js';

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const APP_RE = /^[a-z0-9-]{1,30}$/;
export const KEEP_REPORT_DAYS = 30;

const text = (value, max = 300) => String(value ?? '').replace(/\s+/g, ' ').trim().slice(0, max);
const list = (value, max) => (Array.isArray(value) ? value.slice(0, max) : []);
const webAddress = (value) => {
  const address = text(value, 1000);
  return /^https?:\/\//i.test(address) ? address : '';
};

function stat(item) {
  if (!item || typeof item !== 'object') return null;
  const label = text(item.label, 30);
  const value = text(item.value, 20);
  if (!label || !value) return null;
  const trend = list(item.trend, 14).map(Number).filter(Number.isFinite);
  const tone = ['pink', 'teal', 'blue', 'lavender', 'gold'].includes(item.tone) ? item.tone : '';
  return { label, value, change: text(item.change, 30), sub: text(item.sub, 40), trend, tone };
}

function line(item) {
  if (typeof item === 'string') item = { text: item };
  if (!item || typeof item !== 'object') return null;
  const body = text(item.text, 400);
  return body ? { label: text(item.label, 30), text: body } : null;
}

/** Returns { report } or { error }. */
export function normalizeReport(input, now = new Date()) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return { error: 'Send the report as a JSON object.' };
  const app = typeof input.app === 'string' && APP_RE.test(input.app) ? input.app : 'babylog';
  const report = {
    app,
    date: DATE_RE.test(input.date) ? input.date : localDate(now),
    receivedAt: now.toISOString(),
    title: text(input.title, 60) || (app === 'babylog' ? 'BabyLog' : app),
    headline: text(input.headline, 200),
    stats: list(input.stats, 6).map(stat).filter(Boolean),
    lines: list(input.lines, 8).map(line).filter(Boolean),
    suggestion: text(input.suggestion, 300),
    link: webAddress(input.link),
  };
  if (!report.headline && !report.stats.length && !report.lines.length) return { error: 'That report has nothing in it.' };
  return { report };
}

export function reportStore(kv) {
  const readJson = async (key, fallback) => {
    const raw = await kv.get(key);
    if (!raw) return fallback;
    try { return JSON.parse(raw); } catch { return fallback; }
  };
  return {
    async dates(app) {
      return readJson(`report-dates:${app}`, []);
    },
    async get(app, date) {
      if (!date) [date] = await this.dates(app);
      if (!date || !DATE_RE.test(date)) return null;
      return readJson(`report:${app}:${date}`, null);
    },
    async put(report) {
      await kv.put(`report:${report.app}:${report.date}`, JSON.stringify(report));
      const dates = [report.date, ...(await this.dates(report.app)).filter((d) => d !== report.date)].sort().reverse();
      for (const old of dates.slice(KEEP_REPORT_DAYS)) await kv.delete(`report:${report.app}:${old}`);
      await kv.put(`report-dates:${report.app}`, JSON.stringify(dates.slice(0, KEEP_REPORT_DAYS)));
    },
  };
}
