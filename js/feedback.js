import { CONFIG } from './config.js';
import { esc } from './ui-rail.js';

/**
 * Client feedback form. Mirrors the printed feedback sheet in the drawing set
 * so the two match one-for-one.
 *
 * Every path out of here works with no network: autosave to localStorage,
 * Download .json, Copy as text, and a pre-filled mailto: as the last resort.
 */

const TOP_N = 3;
const DROP_N = 3;

let host = null;
let items = [];
let state = null;
let saveTimer = 0;

export function renderFeedback(container, data) {
  host = container;
  items = data.meetings.find((m) => m.status === 'ready')?.items ?? [];
  state = restore() ?? blank();

  host.innerHTML = template();
  bind();
  hydrate();
  refreshOptionLists();
  showSavedStamp(state.savedAt);
}

/* ── shape ───────────────────────────────────────────────────────────────── */

/** Today in the *client's* timezone. toISOString() is UTC, which hands a
 *  reviewer in Bangkok yesterday's date for most of the morning. */
function today() {
  const d = new Date();
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

function blank() {
  return {
    name: '',
    date: today(),
    top: Array.from({ length: TOP_N }, () => ({ option: '', like: '', dislike: '' })),
    dropped: Array.from({ length: DROP_N }, () => ({ option: '', reason: '', manual: false })),
    comments: '',
    savedAt: null,
  };
}

function template() {
  return `
  <form class="fb" id="fb-form" novalidate>
    <header class="fb__head">
      <span class="mono fb__tag">FB-01</span>
      <h2>ความเห็นลูกค้า <small>Client feedback — Meeting 1 · 6 Layouts</small></h2>
      <p class="fb__saved mono" id="fb-saved" aria-live="polite"></p>
    </header>

    <div class="fb__row">
      <label class="field">
        <span class="field__label">ผู้ให้ความเห็น <small>Name</small> <b aria-hidden="true">*</b></span>
        <input type="text" id="fb-name" name="name" required autocomplete="name">
        <span class="field__err" id="err-name" hidden>กรุณากรอกชื่อ / Name is required</span>
      </label>
      <label class="field field--sm">
        <span class="field__label">วันที่ <small>Date</small></span>
        <input type="date" id="fb-date" name="date" class="mono">
      </label>
    </div>

    <fieldset class="fb__set">
      <legend><span class="mono">A</span> 3 แบบที่ชอบที่สุด <small>Top 3 preferred</small></legend>
      ${Array.from({ length: TOP_N }, (_, i) => `
        <div class="fb__block" data-top="${i}">
          <div class="fb__rank mono">${i + 1}</div>
          <div class="fb__blockbody">
            <label class="field field--sm">
              <span class="field__label">ตัวเลือก <small>Option</small> <b aria-hidden="true">*</b></span>
              <select class="mono" data-role="top-option" data-i="${i}" required></select>
            </label>
            <label class="field">
              <span class="field__label">ชอบอะไร <small>Like</small></span>
              <textarea rows="2" data-role="top-like" data-i="${i}"></textarea>
            </label>
            <label class="field">
              <span class="field__label">ไม่ชอบอะไร <small>Dislike</small></span>
              <textarea rows="2" data-role="top-dislike" data-i="${i}"></textarea>
            </label>
          </div>
        </div>`).join('')}
      <p class="fb__err" id="err-top" hidden>เลือกให้ครบ 3 แบบ / Pick three different options</p>
    </fieldset>

    <fieldset class="fb__set">
      <legend><span class="mono">B</span> 3 แบบที่ตัดออก <small>3 dropped</small></legend>
      <p class="fb__hint">เติมให้อัตโนมัติจากแบบที่เหลือ แก้ไขได้ · Auto-filled from what is left over, still editable.</p>
      ${Array.from({ length: DROP_N }, (_, i) => `
        <div class="fb__block" data-drop="${i}">
          <div class="fb__rank mono">${i + 1}</div>
          <div class="fb__blockbody">
            <label class="field field--sm">
              <span class="field__label">ตัวเลือก <small>Option</small></span>
              <select class="mono" data-role="drop-option" data-i="${i}"></select>
            </label>
            <label class="field">
              <span class="field__label">เหตุผลที่ตัดออก <small>Reason</small></span>
              <textarea rows="2" data-role="drop-reason" data-i="${i}"></textarea>
            </label>
          </div>
        </div>`).join('')}
    </fieldset>

    <label class="field">
      <span class="field__label">ความเห็นเพิ่มเติม <small>Other comments</small></span>
      <textarea rows="4" id="fb-comments"></textarea>
    </label>

    <!-- honeypot: real people never see this, bots fill it in -->
    <div class="hp" aria-hidden="true">
      <label>Company website<input type="text" id="fb-hp" name="_gotcha" tabindex="-1" autocomplete="off"></label>
    </div>

    <div class="fb__actions">
      <button type="submit" class="btn btn--primary" id="fb-submit">ส่งความเห็น · Send</button>
      <button type="button" class="btn" data-act="copy">Copy as text</button>
      <button type="button" class="btn" data-act="json">Download .json</button>
      <a class="btn" id="fb-mailto" href="#">ส่งทางอีเมล · Email</a>
      <button type="button" class="btn btn--quiet" data-act="clear">ล้างฟอร์ม · Clear</button>
    </div>

    <p class="fb__status" id="fb-status" role="status" aria-live="polite"></p>
    <div class="fb__receipt" id="fb-receipt" hidden></div>
  </form>`;
}

/* ── wiring ──────────────────────────────────────────────────────────────── */

function bind() {
  const form = host.querySelector('#fb-form');

  form.addEventListener('input', onInput);
  form.addEventListener('change', onInput);
  form.addEventListener('submit', onSubmit);

  form.addEventListener('click', (e) => {
    const act = e.target.closest('[data-act]')?.dataset.act;
    if (act === 'copy') copyText();
    if (act === 'json') downloadJson();
    if (act === 'clear') clearForm();
  });
}

function onInput(e) {
  const t = e.target;
  const role = t.dataset.role;

  if (t.id === 'fb-name') state.name = t.value;
  else if (t.id === 'fb-date') state.date = t.value;
  else if (t.id === 'fb-comments') state.comments = t.value;
  else if (role === 'top-option') { state.top[+t.dataset.i].option = t.value; autoFillDropped(); }
  else if (role === 'top-like') state.top[+t.dataset.i].like = t.value;
  else if (role === 'top-dislike') state.top[+t.dataset.i].dislike = t.value;
  else if (role === 'drop-option') {
    const d = state.dropped[+t.dataset.i];
    d.option = t.value;
    d.manual = true;              // stop auto-fill from overwriting this slot
  }
  else if (role === 'drop-reason') state.dropped[+t.dataset.i].reason = t.value;
  else return;

  if (role === 'top-option') refreshOptionLists();
  updateMailto();
  scheduleSave();
}

function hydrate() {
  host.querySelector('#fb-name').value = state.name;
  host.querySelector('#fb-date').value = state.date;
  host.querySelector('#fb-comments').value = state.comments;

  state.top.forEach((b, i) => {
    q(`[data-role="top-like"][data-i="${i}"]`).value = b.like;
    q(`[data-role="top-dislike"][data-i="${i}"]`).value = b.dislike;
  });
  state.dropped.forEach((b, i) => {
    q(`[data-role="drop-reason"][data-i="${i}"]`).value = b.reason;
  });
  updateMailto();
}

/**
 * Rebuilds every option <select>. The three "preferred" selects are mutually
 * exclusive — an option chosen in one disappears from the other two.
 */
function refreshOptionLists() {
  const chosen = state.top.map((b) => b.option);

  state.top.forEach((block, i) => {
    const sel = q(`[data-role="top-option"][data-i="${i}"]`);
    const taken = new Set(chosen.filter((v, j) => v && j !== i));
    fill(sel, items.filter((it) => !taken.has(it.id)), block.option);
  });

  state.dropped.forEach((block, i) => {
    const sel = q(`[data-role="drop-option"][data-i="${i}"]`);
    fill(sel, items, block.option);
  });
}

function fill(sel, list, value) {
  sel.replaceChildren();
  sel.append(new Option('— เลือก / select —', ''));
  for (const it of list) {
    sel.append(new Option(`${it.sheet} · ${it.label}`, it.id));
  }
  sel.value = value && list.some((it) => it.id === value) ? value : '';
}

function autoFillDropped() {
  const picked = new Set(state.top.map((b) => b.option).filter(Boolean));
  const leftover = items.filter((it) => !picked.has(it.id)).map((it) => it.id);

  // Slots the client edited by hand are theirs to keep; everything else is
  // ours to (re)fill, in manifest order, from whatever is left over.
  const keep = new Set(
    state.dropped.filter((d) => d.manual && d.option && !picked.has(d.option))
      .map((d) => d.option)
  );
  const pool = leftover.filter((id) => !keep.has(id));

  let k = 0;
  for (const d of state.dropped) {
    if (keep.has(d.option)) continue;
    d.option = pool[k++] ?? '';
  }
}

/* ── autosave ────────────────────────────────────────────────────────────── */

function scheduleSave() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    state.savedAt = new Date().toISOString();
    try { localStorage.setItem(CONFIG.LS_FEEDBACK, JSON.stringify(state)); }
    catch { /* private mode — the download/copy fallbacks still work */ }
    showSavedStamp(state.savedAt);
  }, 250);
}

function restore() {
  try {
    const raw = localStorage.getItem(CONFIG.LS_FEEDBACK);
    if (!raw) return null;
    const s = JSON.parse(raw);
    const base = blank();
    return {
      ...base, ...s,
      top: base.top.map((b, i) => ({ ...b, ...(s.top?.[i] || {}) })),
      dropped: base.dropped.map((b, i) => ({ ...b, ...(s.dropped?.[i] || {}) })),
    };
  } catch { return null; }
}

function showSavedStamp(iso) {
  const el = host.querySelector('#fb-saved');
  if (!iso) { el.textContent = ''; return; }
  const t = new Date(iso);
  el.textContent = `บันทึกร่างอัตโนมัติ · ${t.toLocaleTimeString('th-TH', { hour: '2-digit', minute: '2-digit' })}`;
}

/* ── output formats ──────────────────────────────────────────────────────── */

function labelFor(id) {
  const it = items.find((x) => x.id === id);
  return it ? `${it.sheet} ${it.label}` : '—';
}

function asText() {
  const L = [];
  L.push('ARCHE AQUATICS — CLIENT FEEDBACK');
  L.push('Meeting 1 · 6 Layouts');
  L.push('');
  L.push(`ผู้ให้ความเห็น / Name : ${state.name || '—'}`);
  L.push(`วันที่ / Date        : ${state.date || '—'}`);
  L.push('');
  L.push('— 3 แบบที่ชอบที่สุด / TOP 3 PREFERRED —');
  state.top.forEach((b, i) => {
    L.push(`${i + 1}. ${labelFor(b.option)}`);
    L.push(`   ชอบ / Like    : ${b.like || '—'}`);
    L.push(`   ไม่ชอบ / Dislike: ${b.dislike || '—'}`);
  });
  L.push('');
  L.push('— 3 แบบที่ตัดออก / DROPPED —');
  state.dropped.forEach((b, i) => {
    L.push(`${i + 1}. ${labelFor(b.option)}`);
    L.push(`   เหตุผล / Reason: ${b.reason || '—'}`);
  });
  L.push('');
  L.push('— ความเห็นเพิ่มเติม / OTHER COMMENTS —');
  L.push(state.comments || '—');
  return L.join('\n');
}

function payload() {
  return {
    _subject: CONFIG.FORM_SUBJECT,
    project: 'Arche Aquatics',
    meeting: 'Meeting 1 — 6 Layouts',
    name: state.name,
    date: state.date,
    top: state.top.map((b) => ({ ...b, optionLabel: labelFor(b.option) })),
    dropped: state.dropped.map((b) => ({ ...b, optionLabel: labelFor(b.option) })),
    comments: state.comments,
    submittedAt: new Date().toISOString(),
    text: asText(),
  };
}

function updateMailto() {
  const a = host.querySelector('#fb-mailto');
  a.href = `mailto:${encodeURIComponent(CONFIG.FALLBACK_EMAIL)}`
    + `?subject=${encodeURIComponent(CONFIG.FORM_SUBJECT)}`
    + `&body=${encodeURIComponent(asText())}`;
}

async function copyText() {
  const text = asText();
  try {
    await navigator.clipboard.writeText(text);
    status('คัดลอกแล้ว · Copied to clipboard', 'ok');
  } catch {
    const ta = document.createElement('textarea');
    ta.value = text;
    host.append(ta);
    ta.select();
    document.execCommand?.('copy');
    ta.remove();
    status('คัดลอกแล้ว · Copied', 'ok');
  }
}

function downloadJson() {
  const blob = new Blob([JSON.stringify(payload(), null, 2)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `arche-feedback-${state.date || 'draft'}.json`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  status('ดาวน์โหลดไฟล์แล้ว · Saved .json', 'ok');
}

/* ── submit ──────────────────────────────────────────────────────────────── */

function validate() {
  let ok = true;

  const nameErr = host.querySelector('#err-name');
  nameErr.hidden = !!state.name.trim();
  if (!state.name.trim()) { ok = false; host.querySelector('#fb-name').focus(); }

  const picks = state.top.map((b) => b.option).filter(Boolean);
  const topErr = host.querySelector('#err-top');
  const topOk = picks.length === TOP_N && new Set(picks).size === TOP_N;
  topErr.hidden = topOk;
  if (!topOk) ok = false;

  return ok;
}

async function onSubmit(e) {
  e.preventDefault();
  if (host.querySelector('#fb-hp').value) return;   // bot
  if (!validate()) { status('กรอกข้อมูลให้ครบก่อนส่ง · Please complete the required fields', 'err'); return; }

  const btn = host.querySelector('#fb-submit');

  if (!CONFIG.FORM_ENDPOINT) {
    status('ยังไม่ได้ตั้งค่าปลายทางของฟอร์ม — ใช้ Copy / Download / Email แทน · '
      + 'No form endpoint configured yet; use Copy, Download, or Email.', 'err');
    receipt();
    return;
  }

  btn.disabled = true;
  status('กำลังส่ง… · Sending…', 'busy');

  try {
    const res = await fetch(CONFIG.FORM_ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      // Pass the honeypot through so Formspree's own filter sees it too,
      // rather than trusting the client-side check alone. It stays out of
      // payload() so the Download .json copy is not littered with it.
      body: JSON.stringify({ ...payload(), _gotcha: host.querySelector('#fb-hp').value }),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);

    status('ส่งเรียบร้อยแล้ว ขอบคุณครับ · Sent, thank you', 'ok');
    receipt();
    // Kill any autosave still sitting on its debounce, or it lands after this
    // and puts the draft straight back — the client reloads and thinks the
    // send never happened.
    clearTimeout(saveTimer);
    try { localStorage.removeItem(CONFIG.LS_FEEDBACK); } catch { /* no-op */ }
  } catch (err) {
    // Nothing is cleared on failure — every field stays exactly as typed.
    status(`ส่งไม่สำเร็จ (${err.message}) — ข้อมูลยังอยู่ครบ ใช้ Copy / Download / Email ได้ · `
      + 'Send failed; your answers are intact, use the fallbacks below.', 'err');
    receipt();
  } finally {
    btn.disabled = false;
  }
}

function receipt() {
  const box = host.querySelector('#fb-receipt');
  box.hidden = false;
  box.innerHTML = `
    <h3 class="mono">SENT / สรุปสิ่งที่กรอก</h3>
    <pre>${esc(asText())}</pre>`;
}

function status(msg, kind) {
  const el = host.querySelector('#fb-status');
  el.textContent = msg;
  el.dataset.kind = kind;
}

function clearForm() {
  if (!confirm('ล้างข้อมูลทั้งหมด? / Clear the whole form?')) return;
  state = blank();
  try { localStorage.removeItem(CONFIG.LS_FEEDBACK); } catch { /* no-op */ }
  host.querySelector('#fb-receipt').hidden = true;
  hydrate();
  refreshOptionLists();
  showSavedStamp(null);
  status('', '');
}

function q(sel) {
  return host.querySelector(sel);
}
