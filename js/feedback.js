import { CONFIG } from './config.js';
import { esc } from './ui-rail.js';

/**
 * Client feedback form. Mirrors the printed feedback sheet in the drawing set
 * so the two match one-for-one — and each meeting prints its own sheet:
 *
 *   "rank"   M1 · six layouts   → top three, three dropped, why
 *   "choose" M2 · three options → pick one to develop, what to keep, what to fix
 *
 * Every path out of here works with no network: autosave to localStorage,
 * print to PDF, Copy as text, and a pre-filled mailto: as the last resort.
 */

const TOP_N = 3;
const DROP_N = 3;

let host = null;
let meeting = null;
let shape = 'rank';
let items = [];
let state = null;
let saveTimer = 0;

export function renderFeedback(container, data, forMeeting = null) {
  host = container;
  meeting = forMeeting
    ?? [...data.meetings].reverse().find((m) => m.status === 'ready')
    ?? data.meetings[0];
  shape = meeting.feedbackForm === 'choose' ? 'choose' : 'rank';
  items = meeting.items ?? [];
  state = restore() ?? blank();

  host.innerHTML = shape === 'choose' ? templateChoose() : template();
  bind();
  hydrate();
  if (shape === 'rank') refreshOptionLists();
  showSavedStamp(state.savedAt);
}

/** M1's draft keeps the original key so an in-progress sheet is not orphaned. */
function storageKey() {
  return meeting.id === 'm1' ? CONFIG.LS_FEEDBACK : `${CONFIG.LS_FEEDBACK}.${meeting.id}`;
}

function meetingName() {
  return `Meeting ${meeting.no} · ${meeting.title}`;
}

function subject() {
  return `${CONFIG.FORM_SUBJECT} Meeting ${meeting.no}`;
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
  if (shape === 'choose') {
    return {
      name: '',
      date: today(),
      choice: '',
      keep: '',
      fix: '',
      comments: '',
      savedAt: null,
    };
  }
  return {
    name: '',
    date: today(),
    top: Array.from({ length: TOP_N }, () => ({ option: '', like: '', dislike: '' })),
    dropped: Array.from({ length: DROP_N }, () => ({ option: '', reason: '', manual: false })),
    comments: '',
    savedAt: null,
  };
}

/**
 * M2's sheet: one choice, and the two questions that actually move the design
 * on — what to keep, and what still worries them. Options are radio cards so
 * the pick is one tap on a phone at the meeting table.
 */
function templateChoose() {
  return `
  <form class="fb" id="fb-form" novalidate>
    <header class="fb__head">
      <span class="mono fb__tag">FB-0${esc(meeting.no)}</span>
      <h2>เลือกทางเลือก และเขียนความเห็น
        <small>${esc(meetingName())}</small></h2>
      <p class="fb__saved mono" id="fb-saved" aria-live="polite"></p>
    </header>

    <p class="fb__hint">เลือก 1 ทางเลือกเพื่อพัฒนาต่อในขั้น Design Development
      ไม่จำเป็นต้องเลือกแบบใดแบบหนึ่งทั้งหมด หยิบข้อดีของแต่ละแบบมารวมกันในรอบถัดไปได้</p>

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
      <legend><span class="mono">A</span> ทางเลือกที่เลือก <small>Option to develop</small> <b aria-hidden="true">*</b></legend>
      <ul class="picks">
        ${items.map((it) => `
          <li>
            <label class="pick">
              <input type="radio" name="choice" value="${esc(it.id)}" data-role="choice">
              <span class="pick__body">
                <span class="mono pick__sheet">${esc(it.sheet)}</span>
                <span class="pick__label">${esc(it.label)}</span>
              </span>
            </label>
          </li>`).join('')}
      </ul>
      <p class="fb__err" id="err-choice" hidden>เลือก 1 ทางเลือก / Pick one option</p>
    </fieldset>

    <label class="field">
      <span class="field__label"><span class="mono">B</span> สิ่งที่ชอบ และอยากให้คงไว้
        <small>What to keep</small></span>
      <textarea rows="5" id="fb-keep"></textarea>
    </label>

    <label class="field">
      <span class="field__label"><span class="mono">C</span> สิ่งที่อยากให้แก้ หรือยังไม่มั่นใจ
        <small>What to fix, or still unsure about</small></span>
      <textarea rows="5" id="fb-fix"></textarea>
    </label>

    <label class="field">
      <span class="field__label">ความเห็นเพิ่มเติม <small>Other comments</small></span>
      <textarea rows="4" id="fb-comments"></textarea>
    </label>

    <!-- honeypot: real people never see this, bots fill it in -->
    <div class="hp" aria-hidden="true">
      <label>Company website<input type="text" id="fb-hp" name="_gotcha" tabindex="-1" autocomplete="off"></label>
    </div>

    <div class="fb__actions">
      <button type="button" class="btn" data-act="pdf">ดาวน์โหลด PDF · Download PDF</button>
      <button type="submit" class="btn btn--primary" id="fb-submit">ส่งเมล์ · Send</button>
    </div>

    <p class="fb__status" id="fb-status" role="status" aria-live="polite"></p>

    <div class="fb__fallback" id="fb-fallback" hidden>
      <p>ส่งไม่สำเร็จ แต่ข้อมูลยังอยู่ครบ · The send failed, nothing was lost.</p>
      <div class="fb__actions">
        <a class="btn" id="fb-mailto" href="#">เปิดอีเมล · Open email</a>
        <button type="button" class="btn" data-act="copy">คัดลอกข้อความ · Copy as text</button>
      </div>
    </div>

    <div class="fb__receipt" id="fb-receipt" hidden></div>
  </form>`;
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
              <textarea rows="3" data-role="top-like" data-i="${i}"></textarea>
            </label>
            <label class="field">
              <span class="field__label">ไม่ชอบอะไร <small>Dislike</small></span>
              <textarea rows="3" data-role="top-dislike" data-i="${i}"></textarea>
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
              <textarea rows="3" data-role="drop-reason" data-i="${i}"></textarea>
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
      <button type="button" class="btn" data-act="pdf">ดาวน์โหลด PDF · Download PDF</button>
      <button type="submit" class="btn btn--primary" id="fb-submit">ส่งเมล์ · Send</button>
    </div>

    <p class="fb__status" id="fb-status" role="status" aria-live="polite"></p>

    <!-- Only surfaces if a send fails, so nothing typed is ever stranded. -->
    <div class="fb__fallback" id="fb-fallback" hidden>
      <p>ส่งไม่สำเร็จ แต่ข้อมูลยังอยู่ครบ · The send failed, nothing was lost.</p>
      <div class="fb__actions">
        <a class="btn" id="fb-mailto" href="#">เปิดอีเมล · Open email</a>
        <button type="button" class="btn" data-act="copy">คัดลอกข้อความ · Copy as text</button>
      </div>
    </div>

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
    if (act === 'pdf') downloadPdf();
  });
}

function onInput(e) {
  const t = e.target;
  const role = t.dataset.role;

  if (t.id === 'fb-name') state.name = t.value;
  else if (t.id === 'fb-date') state.date = t.value;
  else if (t.id === 'fb-comments') state.comments = t.value;
  else if (t.id === 'fb-keep') state.keep = t.value;
  else if (t.id === 'fb-fix') state.fix = t.value;
  else if (role === 'choice') state.choice = t.value;
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

  if (shape === 'choose') {
    host.querySelector('#fb-keep').value = state.keep;
    host.querySelector('#fb-fix').value = state.fix;
    const picked = q(`[data-role="choice"][value="${CSS.escape(state.choice || ' ')}"]`);
    if (picked) picked.checked = true;
    updateMailto();
    return;
  }

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
    try { localStorage.setItem(storageKey(), JSON.stringify(state)); }
    catch { /* private mode — the download/copy fallbacks still work */ }
    showSavedStamp(state.savedAt);
  }, 250);
}

function restore() {
  try {
    const raw = localStorage.getItem(storageKey());
    if (!raw) return null;
    const s = JSON.parse(raw);
    const base = blank();
    if (shape === 'choose') return { ...base, ...s };
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
  L.push(meetingName());
  L.push('');
  L.push(`ผู้ให้ความเห็น / Name : ${state.name || '—'}`);
  L.push(`วันที่ / Date        : ${state.date || '—'}`);
  L.push('');

  if (shape === 'choose') {
    L.push('— ทางเลือกที่เลือก / OPTION TO DEVELOP —');
    L.push(labelFor(state.choice));
    L.push('');
    L.push('— สิ่งที่ชอบ และอยากให้คงไว้ / WHAT TO KEEP —');
    L.push(state.keep || '—');
    L.push('');
    L.push('— สิ่งที่อยากให้แก้ หรือยังไม่มั่นใจ / WHAT TO FIX —');
    L.push(state.fix || '—');
    L.push('');
    L.push('— ความเห็นเพิ่มเติม / OTHER COMMENTS —');
    L.push(state.comments || '—');
    return L.join('\n');
  }

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
  const common = {
    _subject: subject(),
    project: 'Arche Aquatics',
    meeting: meetingName(),
    name: state.name,
    date: state.date,
    comments: state.comments,
    submittedAt: new Date().toISOString(),
    text: asText(),
  };

  if (shape === 'choose') {
    return {
      ...common,
      choice: state.choice,
      choiceLabel: labelFor(state.choice),
      keep: state.keep,
      fix: state.fix,
    };
  }

  return {
    ...common,
    top: state.top.map((b) => ({ ...b, optionLabel: labelFor(b.option) })),
    dropped: state.dropped.map((b) => ({ ...b, optionLabel: labelFor(b.option) })),
  };
}

function updateMailto() {
  const a = host.querySelector('#fb-mailto');
  a.href = `mailto:${encodeURIComponent(CONFIG.FALLBACK_EMAIL)}`
    + `?subject=${encodeURIComponent(subject())}`
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

/**
 * Builds a clean A4 sheet and hands it to the browser's print dialog, where
 * "Save as PDF" produces the file.
 *
 * A JS PDF library was the obvious alternative, but every one of them needs a
 * font embedded to draw Thai, and the client types arbitrary Thai so no subset
 * can be prepared ahead of time — it would mean shipping a whole Thai face for
 * one button. The browser already has the font loaded and shapes Thai
 * correctly, so printing gets perfect text for no payload at all.
 */
function downloadPdf() {
  const row = (label, value) => `
    <tr><th>${esc(label)}</th><td>${esc(value || '—')}</td></tr>`;

  let sheet = document.getElementById('print-sheet');
  if (!sheet) {
    sheet = document.createElement('div');
    sheet.id = 'print-sheet';
    document.body.append(sheet);
  }

  const head = `
    <header class="ps__head">
      <div>
        <h1>ความเห็นลูกค้า <small>Client feedback</small></h1>
        <p class="ps__meta">Arche Aquatics · โรงเรียนว่ายน้ำ · ${esc(meetingName())}</p>
      </div>
      <span class="mono ps__code">FB-0${esc(meeting.no)}</span>
    </header>

    <table class="ps__id">
      ${row('ผู้ให้ความเห็น / Name', state.name)}
      ${row('วันที่ / Date', state.date)}
    </table>`;

  const foot = `
    <footer class="ps__foot mono">
      WIN ARCHITECT · พีรวิชญ์ สุขเณศกุล · ${esc(state.date || '')}
    </footer>`;

  if (shape === 'choose') {
    sheet.innerHTML = `
      ${head}

      <h2><span class="mono">A</span> ทางเลือกที่เลือก <small>Option to develop</small></h2>
      <p class="ps__choice mono">${esc(labelFor(state.choice))}</p>

      <h2><span class="mono">B</span> สิ่งที่ชอบ และอยากให้คงไว้ <small>What to keep</small></h2>
      <p class="ps__comments">${esc(state.keep || '—')}</p>

      <h2><span class="mono">C</span> สิ่งที่อยากให้แก้ หรือยังไม่มั่นใจ <small>What to fix</small></h2>
      <p class="ps__comments">${esc(state.fix || '—')}</p>

      <h2><span class="mono">D</span> ความเห็นเพิ่มเติม <small>Other comments</small></h2>
      <p class="ps__comments">${esc(state.comments || '—')}</p>

      ${foot}`;

    status('เลือก “Save as PDF” ในหน้าต่างพิมพ์ · Choose “Save as PDF” in the print dialog', 'ok');
    window.print();
    return;
  }

  sheet.innerHTML = `
    ${head}

    <h2><span class="mono">A</span> 3 แบบที่ชอบที่สุด <small>Top 3 preferred</small></h2>
    <table class="ps__grid">
      <thead>
        <tr><th class="ps__rank">#</th><th class="ps__opt">ตัวเลือก / Option</th>
            <th>ชอบอะไร / Like</th><th>ไม่ชอบอะไร / Dislike</th></tr>
      </thead>
      <tbody>
        ${state.top.map((b, i) => `
          <tr>
            <td class="mono ps__rank">${i + 1}</td>
            <td class="mono">${esc(labelFor(b.option))}</td>
            <td>${esc(b.like || '—')}</td>
            <td>${esc(b.dislike || '—')}</td>
          </tr>`).join('')}
      </tbody>
    </table>

    <h2><span class="mono">B</span> 3 แบบที่ตัดออก <small>3 dropped</small></h2>
    <table class="ps__grid">
      <thead>
        <tr><th class="ps__rank">#</th><th class="ps__opt">ตัวเลือก / Option</th>
            <th colspan="2">เหตุผลที่ตัดออก / Reason</th></tr>
      </thead>
      <tbody>
        ${state.dropped.map((b, i) => `
          <tr>
            <td class="mono ps__rank">${i + 1}</td>
            <td class="mono">${esc(labelFor(b.option))}</td>
            <td colspan="2">${esc(b.reason || '—')}</td>
          </tr>`).join('')}
      </tbody>
    </table>

    <h2><span class="mono">C</span> ความเห็นเพิ่มเติม <small>Other comments</small></h2>
    <p class="ps__comments">${esc(state.comments || '—')}</p>

    ${foot}`;

  // Set the hint first, because print() blocks until the dialog closes. Called
  // straight out rather than from requestAnimationFrame — rAF does not fire in
  // a backgrounded tab, and the print engine lays the sheet out itself anyway.
  status('เลือก “Save as PDF” ในหน้าต่างพิมพ์ · Choose “Save as PDF” in the print dialog', 'ok');
  window.print();
}

/* ── submit ──────────────────────────────────────────────────────────────── */

function validate() {
  let ok = true;

  const nameErr = host.querySelector('#err-name');
  nameErr.hidden = !!state.name.trim();
  if (!state.name.trim()) { ok = false; host.querySelector('#fb-name').focus(); }

  if (shape === 'choose') {
    const choiceErr = host.querySelector('#err-choice');
    choiceErr.hidden = !!state.choice;
    if (!state.choice) ok = false;
    return ok;
  }

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
    status('ยังไม่ได้ตั้งค่าปลายทางของฟอร์ม · No form endpoint configured yet.', 'err');
    showFallback();
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
    host.querySelector('#fb-fallback').hidden = true;
    receipt();
    // Kill any autosave still sitting on its debounce, or it lands after this
    // and puts the draft straight back — the client reloads and thinks the
    // send never happened.
    clearTimeout(saveTimer);
    try { localStorage.removeItem(storageKey()); } catch { /* no-op */ }
  } catch (err) {
    // Nothing is cleared on failure — every field stays exactly as typed.
    status(`ส่งไม่สำเร็จ (${err.message}) · Send failed.`, 'err');
    showFallback();
    receipt();
  } finally {
    btn.disabled = false;
  }
}

function showFallback() {
  updateMailto();
  host.querySelector('#fb-fallback').hidden = false;
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

function q(sel) {
  return host.querySelector(sel);
}
