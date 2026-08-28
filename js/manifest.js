import { CONFIG } from './config.js';

/**
 * Loads data/manifest.json and validates it hard enough that a typo in the
 * data file surfaces as a readable message instead of a blank screen.
 */

const VALID_STATUS = new Set(['ready', 'pending']);
const VALID_UP = new Set(['Y', 'Z']);

class ManifestError extends Error {}

function need(cond, msg) {
  if (!cond) throw new ManifestError(msg);
}

function validateItem(item, meetingId, i) {
  const where = `${meetingId}.items[${i}]`;
  need(item && typeof item === 'object', `${where} is not an object`);
  need(typeof item.id === 'string' && item.id, `${where}.id is required`);
  need(typeof item.label === 'string' && item.label, `${where}.label is required`);
  need(typeof item.plan === 'string' && item.plan, `${where}.plan is required`);

  if (item.modelUp !== undefined) {
    need(VALID_UP.has(item.modelUp),
      `${where}.modelUp must be "Y" or "Z", got ${JSON.stringify(item.modelUp)}`);
  }
  if (item.modelScale !== undefined) {
    need(Number.isFinite(item.modelScale) && item.modelScale > 0,
      `${where}.modelScale must be a positive number`);
  }

  const pages = Array.isArray(item.pages) ? item.pages : [];
  pages.forEach((p, k) => {
    need(p && typeof p === 'object', `${where}.pages[${k}] is not an object`);
    need(Number.isInteger(p.no) && p.no > 0,
      `${where}.pages[${k}].no must be a positive page number`);
    need(typeof p.label === 'string' && p.label, `${where}.pages[${k}].label is required`);
  });

  const axes = Array.isArray(item.axes) ? item.axes : [];
  axes.forEach((a, k) => {
    need(a && typeof a === 'object', `${where}.axes[${k}] is not an object`);
    need(Array.isArray(a.pros) && Array.isArray(a.cons),
      `${where}.axes[${k}] needs both a "pros" and a "cons" array`);
  });

  return {
    id: item.id,
    label: item.label,
    sheet: item.sheet || '',
    plan: item.plan,
    model: item.model || '',
    thumb: item.thumb || '',
    modelUp: item.modelUp || 'Y',
    modelScale: item.modelScale ?? 1,

    // From M2 on. All optional, so an M1-shaped item still validates.
    tagline: item.tagline || '',
    origin: item.origin || '',
    pages: pages.map((p) => ({ no: p.no, label: p.label, sub: p.sub || '' })),
    areas: Array.isArray(item.areas) ? item.areas : [],
    axes: axes.map((a, k) => ({
      n: a.n ?? k + 1,
      pros: a.pros.map(String),
      cons: a.cons.map(String),
    })),
    verdict: item.verdict || '',
  };
}

function validateMeeting(m, i) {
  const where = `meetings[${i}]`;
  need(m && typeof m === 'object', `${where} is not an object`);
  need(typeof m.id === 'string' && m.id, `${where}.id is required`);
  need(VALID_STATUS.has(m.status), `${where}.status must be "ready" or "pending"`);

  const items = Array.isArray(m.items) ? m.items : [];
  need(m.status !== 'ready' || items.length > 0,
    `${where} is marked "ready" but has no items`);

  const docs = Array.isArray(m.docs) ? m.docs : [];
  docs.forEach((d, k) => {
    need(d && typeof d === 'object' && d.file && d.label,
      `${where}.docs[${k}] needs a "label" and a "file"`);
  });

  const meeting = {
    id: m.id,
    no: m.no ?? i + 1,
    title: m.title || `Meeting ${m.no ?? i + 1}`,
    titleTh: m.titleTh || '',
    date: m.date || '',
    status: m.status,
    // Which feedback sheet this meeting asks for: "rank" is M1's top-3 /
    // dropped-3, "choose" is M2's pick-one-and-say-why.
    feedbackForm: m.feedbackForm === 'choose' ? 'choose' : 'rank',
    brief: m.brief || '',
    axes: Array.isArray(m.axes) ? m.axes : [],
    docs: docs.map((d) => ({ id: d.id || d.file, label: d.label, sub: d.sub || '', file: d.file })),
    items: items.map((it, j) => validateItem(it, m.id, j)),
  };

  const ids = new Set();
  for (const it of meeting.items) {
    need(!ids.has(it.id), `${where} has duplicate item id "${it.id}"`);
    ids.add(it.id);
  }
  return meeting;
}

let cache = null;

export async function loadManifest() {
  if (cache) return cache;

  let raw;
  try {
    const res = await fetch(CONFIG.MANIFEST_URL, { cache: 'no-cache' });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    raw = await res.json();
  } catch (err) {
    throw new ManifestError(
      `ไม่สามารถโหลด ${CONFIG.MANIFEST_URL} · Could not load the manifest (${err.message})`
    );
  }

  need(raw && typeof raw === 'object', 'manifest.json is not an object');
  need(Array.isArray(raw.meetings) && raw.meetings.length,
    'manifest.json needs a non-empty "meetings" array');

  const data = {
    project: raw.project || {},
    meetings: raw.meetings.map(validateMeeting),
  };

  const seen = new Set();
  for (const m of data.meetings) {
    need(!seen.has(m.id), `duplicate meeting id "${m.id}"`);
    seen.add(m.id);
  }

  cache = data;
  return data;
}

export function findMeeting(data, meetingId) {
  return data.meetings.find((m) => m.id === meetingId) || null;
}

export function findItem(meeting, itemId) {
  return meeting?.items.find((it) => it.id === itemId) || null;
}

export { ManifestError };
