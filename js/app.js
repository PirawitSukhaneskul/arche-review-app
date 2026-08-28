import { CONFIG } from './config.js';
import { loadManifest, findMeeting, findItem } from './manifest.js';
import { initRouter, go, silentReplace, MODES } from './router.js';
import { renderRail, initRail, esc } from './ui-rail.js';
import { initSplit } from './view-split.js';
import { showPlan, planLinks } from './view-plan.js';
import { showModel, resizeModel } from './view-model.js';
import { renderFeedback } from './feedback.js';

const app = document.getElementById('app');
const views = {
  grid: document.getElementById('view-grid'),
  empty: document.getElementById('view-empty'),
  feedback: document.getElementById('view-feedback'),
  workspace: document.getElementById('view-workspace'),
};
const header = {
  sheet: document.getElementById('header-sheet'),
  title: document.getElementById('header-title'),
  switcher: document.getElementById('switcher'),
  links: document.getElementById('header-links'),
  raw: document.getElementById('link-raw'),
  dl: document.getElementById('link-dl'),
};

let data = null;
let route = null;

boot();

async function boot() {
  try {
    data = await loadManifest();
  } catch (err) {
    fatal(err.message);
    return;
  }

  initRail();
  initSplit();

  header.switcher.addEventListener('click', (e) => {
    const mode = e.target.closest('button')?.dataset.mode;
    // Mode changes replace the history entry so back/forward is not flooded.
    if (mode && route?.view === 'item') go({ ...route, mode }, { replace: true });
  });

  addEventListener('resize', onResize);
  initRouter(onRoute);
}

/* ── routing ─────────────────────────────────────────────────────────────── */

function defaultMode() {
  return innerWidth >= CONFIG.BP_SPLIT ? 'split' : 'plan';
}

function allowedModes() {
  return innerWidth < CONFIG.BP_DRAWER ? ['plan', 'model'] : MODES;
}

function onRoute(next) {
  route = next;

  if (route.view === 'feedback') {
    const m = findMeeting(data, route.meetingId) ?? latestReady() ?? data.meetings[0];
    route.meetingId = m.id;
    renderRail(data, route);
    show('feedback');
    setHeader({ sheet: `FB-0${m.no}`, title: `ความเห็นลูกค้า · ${m.title}` });
    renderFeedback(views.feedback, data, m);
    return;
  }

  // Fall back to the newest ready meeting when the hash names none (or a bad
  // one) — the client opening the bare link wants the round now in review.
  const meeting = findMeeting(data, route.meetingId)
    ?? latestReady()
    ?? data.meetings[0];
  route.meetingId = meeting.id;
  renderRail(data, route);

  if (meeting.status !== 'ready') {
    show('empty');
    setHeader({ sheet: `M${meeting.no}`, title: meeting.title });
    // A dead end needs a way out: send them to the round that is open.
    const open = latestReady();
    views.empty.innerHTML = `
      <div class="empty">
        <span class="mono empty__tag">M${meeting.no}</span>
        <h2>ยังไม่เปิดรอบนี้ <small>Not open yet</small></h2>
        <p class="empty__title">${esc(meeting.title)}${meeting.titleTh ? ` · ${esc(meeting.titleTh)}` : ''}</p>
        ${open ? `<a class="btn" href="#/${esc(open.id)}">ไปที่รอบล่าสุด · Go to M${open.no}</a>` : ''}
      </div>`;
    return;
  }

  if (route.view === 'meeting') {
    show('grid');
    setHeader({ sheet: `M${meeting.no}`, title: `${meeting.title} · ${meeting.titleTh || ''}` });
    renderGrid(meeting);
    return;
  }

  const item = findItem(meeting, route.itemId);
  if (!item) {
    // Unknown option in the URL — drop back to the grid rather than blank out.
    go({ view: 'meeting', meetingId: meeting.id }, { replace: true });
    return;
  }

  const modes = allowedModes();
  let mode = route.mode && modes.includes(route.mode) ? route.mode : defaultMode();
  if (!modes.includes(mode)) mode = 'plan';

  if (route.mode !== mode) {
    route.mode = mode;
    silentReplace(route);       // canonicalise the URL, do not re-enter routing
  }

  show('workspace');
  app.dataset.mode = mode;
  setHeader({
    sheet: item.sheet,
    title: item.label,
    item,
    mode,
    modes,
  });

  // Only touch a pane that is actually on screen — a hidden model must not
  // download or build.
  if (mode !== 'model') showPlan(item);
  if (mode !== 'plan') showModel(item);
  if (mode !== 'plan') requestAnimationFrame(resizeModel);
}

/* ── views ───────────────────────────────────────────────────────────────── */

function show(name) {
  for (const [key, el] of Object.entries(views)) el.hidden = key !== name;
}

function latestReady() {
  return [...data.meetings].reverse().find((m) => m.status === 'ready') ?? null;
}

function setHeader({ sheet, title, item = null, mode = null, modes = MODES }) {
  header.sheet.textContent = sheet || '';
  header.title.textContent = title || '';

  header.switcher.hidden = !item;
  header.links.hidden = !item;

  for (const btn of header.switcher.querySelectorAll('button')) {
    const m = btn.dataset.mode;
    btn.hidden = !modes.includes(m);
    btn.setAttribute('aria-pressed', String(m === mode));
  }

  if (item) {
    const link = planLinks() ?? { url: item.plan, name: `${item.sheet || item.id}.pdf` };
    header.raw.href = item.plan;
    header.dl.href = item.plan;
    header.dl.download = link.name;
  }
}

function renderGrid(meeting) {
  // Sheets with more than one page say so, so the client knows to expect the
  // floor switcher rather than hunting for the upper floor.
  const floors = (it) => (it.pages?.length > 1
    ? `<span class="card__floors">${it.pages.map((p) => esc(p.label)).join(' · ')}</span>`
    : '');

  views.grid.innerHTML = `
    <ul class="grid">
      ${meeting.items.map((it) => `
        <li>
          <a class="card" href="#/${meeting.id}/${it.id}"
             aria-label="${esc(it.label)} ${esc(it.sheet)}">
            <span class="card__thumb">
              <img src="${esc(it.thumb)}" alt="" loading="lazy"
                   onerror="this.closest('.card__thumb').classList.add('is-blank');this.remove()">
              <span class="card__placeholder mono" aria-hidden="true">${esc(it.sheet)}</span>
            </span>
            <span class="card__meta">
              <span class="mono card__sheet">${esc(it.sheet)}</span>
              <span class="card__label">${esc(it.label)}</span>
              ${floors(it)}
            </span>
          </a>
        </li>`).join('')}
    </ul>`;
}

function fatal(msg) {
  document.body.innerHTML = `
    <div class="fatal" role="alert">
      <span class="mono">ERROR</span>
      <p>${esc(msg)}</p>
    </div>`;
}

/* ── responsive ──────────────────────────────────────────────────────────── */

let resizeTimer = 0;
function onResize() {
  clearTimeout(resizeTimer);
  resizeTimer = setTimeout(() => {
    if (route?.view !== 'item') return;
    // Dropping below the phone breakpoint retires split; re-run the route so
    // the switcher, layout, and URL all agree again.
    if (!allowedModes().includes(route.mode)) onRoute({ ...route, mode: null });
    else if (app.dataset.mode !== 'plan') resizeModel();
  }, 150);
}
