import { CONFIG } from './config.js';
import { esc } from './ui-rail.js';
import * as pdfjs from 'pdfjs-dist';

const PDFJS_CDN = 'https://cdn.jsdelivr.net/npm/pdfjs-dist@6.2.108';

pdfjs.GlobalWorkerOptions.workerSrc = `${PDFJS_CDN}/build/pdf.worker.min.mjs`;

/**
 * pdf.js v6 decodes JBIG2 / JPEG2000 images and applies ICC colour through
 * WebAssembly modules it fetches at runtime. Without `wasmUrl` those decoders
 * fail with "JBig2 failed to initialize" and the affected images are silently
 * dropped — which is what blanked the colour fills on sheet M1-01.
 */
const PDF_RESOURCES = {
  wasmUrl: `${PDFJS_CDN}/wasm/`,
  cMapUrl: `${PDFJS_CDN}/cmaps/`,
  cMapPacked: true,
  standardFontDataUrl: `${PDFJS_CDN}/standard_fonts/`,
};

/**
 * Plan pane. Renders the A3 sheet with PDF.js into a canvas — an <iframe>
 * gives no control over fit and renders differently in every browser.
 */

const host = document.getElementById('pane-plan');

let els = null;          // cached DOM once built
let loadingTask = null;  // PDFDocumentLoadingTask — the thing that owns teardown
let doc = null;          // PDFDocumentProxy
let page = null;         // current PDFPageProxy
let pageNo = 1;
let task = null;         // in-flight RenderTask
let token = 0;           // guards against a stale load resolving late
let fitMode = 'page';    // 'page' | 'width' | 'custom'
let scale = 1;
let current = null;      // the manifest item being shown
let dragging = false;    // divider drag in progress
let dragBase = null;
let resizeTimer = 0;

build();

function build() {
  host.innerHTML = `
    <div class="plan">
      <div class="plan__viewport" id="plan-viewport">
        <canvas class="plan__canvas" id="plan-canvas"></canvas>
        <div class="plan__overlay" id="plan-overlay"></div>
      </div>
      <div class="plan__strip" id="plan-strip" hidden></div>
      <div class="plan__bar" role="group" aria-label="ซูม / Zoom">
        <button type="button" data-act="fit-page"  title="พอดีหน้า / Fit page">Fit page</button>
        <button type="button" data-act="fit-width" title="พอดีความกว้าง / Fit width">Fit width</button>
        <span class="plan__sep" aria-hidden="true"></span>
        <button type="button" data-act="out" aria-label="ซูมออก / Zoom out">−</button>
        <output class="mono plan__pct" id="plan-pct">100%</output>
        <button type="button" data-act="in" aria-label="ซูมเข้า / Zoom in">+</button>
      </div>
    </div>`;

  els = {
    viewport: host.querySelector('#plan-viewport'),
    canvas: host.querySelector('#plan-canvas'),
    overlay: host.querySelector('#plan-overlay'),
    strip: host.querySelector('#plan-strip'),
    pct: host.querySelector('#plan-pct'),
    bar: host.querySelector('.plan__bar'),
  };

  els.bar.addEventListener('click', onBarClick);
  els.viewport.addEventListener('wheel', onWheel, { passive: false });
  initPan();

  new ResizeObserver(() => {
    if (dragging) return;
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(() => { if (page) render(); }, CONFIG.RESIZE_DEBOUNCE_MS);
  }).observe(els.viewport);
}

/* ── loading ─────────────────────────────────────────────────────────────── */

export async function showPlan(item) {
  if (current?.id === item.id && doc) return;
  current = item;
  const mine = ++token;

  await teardown();
  skeleton(item);

  try {
    loadingTask = pdfjs.getDocument({
      url: item.plan,
      isEvalSupported: false,
      ...PDF_RESOURCES,
    });
    doc = await loadingTask.promise;
    if (mine !== token) return;

    pageNo = 1;
    page = await doc.getPage(pageNo);
    if (mine !== token) return;

    els.overlay.replaceChildren();
    els.overlay.hidden = true;
    fitMode = 'page';
    buildStrip();
    await render();
  } catch (err) {
    if (mine !== token) return;
    message(
      `ไม่พบไฟล์: ${item.plan}`,
      `The plan sheet could not be loaded. ${err?.message || ''}`
    );
  }
}

async function teardown() {
  try { task?.cancel(); } catch { /* already settled */ }
  task = null;
  page = null;
  doc = null;
  // Tearing down goes through the loading task — PDFDocumentProxy has no
  // destroy() in pdf.js v6. This is what releases the worker's page data.
  if (loadingTask) {
    const lt = loadingTask;
    loadingTask = null;
    try { await lt.destroy(); } catch { /* already gone */ }
  }
}

/* ── rendering ───────────────────────────────────────────────────────────── */

function fitScale(mode) {
  const base = page.getViewport({ scale: 1 });
  const cw = els.viewport.clientWidth - 24;
  const ch = els.viewport.clientHeight - 24;
  if (cw <= 0 || ch <= 0) return 1;
  return mode === 'width'
    ? cw / base.width
    : Math.min(cw / base.width, ch / base.height);
}

async function render() {
  if (!page) return;
  if (fitMode !== 'custom') scale = fitScale(fitMode);

  const vp = page.getViewport({ scale });
  const dpr = Math.min(devicePixelRatio || 1, 2);

  try { task?.cancel(); } catch { /* no-op */ }

  const c = els.canvas;
  c.width = Math.max(1, Math.floor(vp.width * dpr));
  c.height = Math.max(1, Math.floor(vp.height * dpr));
  c.style.width = `${Math.floor(vp.width)}px`;
  c.style.height = `${Math.floor(vp.height)}px`;
  c.style.transform = '';
  c.setAttribute('role', 'img');
  c.setAttribute('aria-label',
    `${current?.label ?? 'Plan'} ${current?.sheet ?? ''} — ผังพื้น หน้า ${pageNo}`);

  els.pct.value = `${Math.round(scale * 100)}%`;
  els.viewport.classList.toggle('is-pannable', vp.width > els.viewport.clientWidth
                                            || vp.height > els.viewport.clientHeight);

  const ctx = c.getContext('2d', { alpha: false });
  task = page.render({
    canvasContext: ctx,
    viewport: vp,
    transform: dpr !== 1 ? [dpr, 0, 0, dpr, 0, 0] : null,
  });

  try {
    await task.promise;
    els.overlay.hidden = true;
  } catch (err) {
    if (err?.name !== 'RenderingCancelledException') {
      message('เกิดข้อผิดพลาดในการแสดงผล', `Render failed. ${err?.message || ''}`);
    }
  }
}

function setZoom(next) {
  fitMode = 'custom';
  scale = Math.min(8, Math.max(0.1, next));
  render();
}

function onBarClick(e) {
  const act = e.target.closest('button')?.dataset.act;
  if (!act || !page) return;

  if (act === 'fit-page' || act === 'fit-width') {
    fitMode = act === 'fit-page' ? 'page' : 'width';
    render();
    return;
  }

  const steps = CONFIG.ZOOM_STEPS;
  if (act === 'in') {
    setZoom(steps.find((s) => s > scale + 1e-3) ?? scale * 1.25);
  } else {
    setZoom([...steps].reverse().find((s) => s < scale - 1e-3) ?? scale / 1.25);
  }
}

function onWheel(e) {
  if (!page) return;
  if (!(e.ctrlKey || e.metaKey)) return;   // plain wheel scrolls, as spec'd
  e.preventDefault();
  setZoom(scale * (e.deltaY < 0 ? 1.1 : 1 / 1.1));
}

/* ── pan by drag ─────────────────────────────────────────────────────────── */

function initPan() {
  let from = null;
  const vpEl = els.viewport;

  vpEl.addEventListener('pointerdown', (e) => {
    if (e.button !== 0 || !vpEl.classList.contains('is-pannable')) return;
    from = { x: e.clientX, y: e.clientY, l: vpEl.scrollLeft, t: vpEl.scrollTop };
    vpEl.setPointerCapture(e.pointerId);
    vpEl.classList.add('is-panning');
  });

  vpEl.addEventListener('pointermove', (e) => {
    if (!from) return;
    vpEl.scrollLeft = from.l - (e.clientX - from.x);
    vpEl.scrollTop = from.t - (e.clientY - from.y);
  });

  for (const ev of ['pointerup', 'pointercancel']) {
    vpEl.addEventListener(ev, (e) => {
      if (!from) return;
      from = null;
      vpEl.releasePointerCapture?.(e.pointerId);
      vpEl.classList.remove('is-panning');
    });
  }
}

/* ── multi-page strip ────────────────────────────────────────────────────── */

function buildStrip() {
  const n = doc?.numPages ?? 1;
  els.strip.hidden = n <= 1;
  if (n <= 1) { els.strip.replaceChildren(); return; }

  els.strip.replaceChildren(...Array.from({ length: n }, (_, i) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'mono';
    b.textContent = String(i + 1);
    b.setAttribute('aria-label', `หน้า ${i + 1} / Page ${i + 1}`);
    if (i + 1 === pageNo) b.setAttribute('aria-current', 'true');
    b.addEventListener('click', () => gotoPage(i + 1));
    return b;
  }));
}

async function gotoPage(n) {
  if (!doc || n === pageNo) return;
  const mine = token;
  pageNo = n;
  page = await doc.getPage(n);
  if (mine !== token) return;
  buildStrip();
  render();
}

/* ── divider-drag preview ────────────────────────────────────────────────── */

/**
 * Re-rendering a PDF on every drag frame is far too slow, so scale the already
 * painted canvas with CSS during the drag and repaint once on release.
 */
export function beginResizePreview() {
  if (!page) return;
  dragging = true;
  dragBase = { w: els.viewport.clientWidth, h: els.viewport.clientHeight };
}

export function updateResizePreview() {
  if (!dragging || !dragBase) return;
  const k = Math.min(
    els.viewport.clientWidth / dragBase.w,
    els.viewport.clientHeight / dragBase.h
  );
  els.canvas.style.transformOrigin = 'top left';
  els.canvas.style.transform = `scale(${k.toFixed(4)})`;
}

export function endResizePreview() {
  if (!dragging) return;
  dragging = false;
  dragBase = null;
  els.canvas.style.transform = '';
  if (page) render();
}

/* ── states ──────────────────────────────────────────────────────────────── */

function skeleton(item) {
  els.overlay.hidden = false;
  els.overlay.className = 'plan__overlay is-skeleton';
  els.overlay.innerHTML = `
    <div class="skeleton" aria-live="polite">
      <span class="mono skeleton__sheet">${esc(item.sheet || '—')}</span>
      <span class="skeleton__label">${esc(item.label)}</span>
      <span class="skeleton__bar"><i></i></span>
      <span class="skeleton__note">กำลังโหลดผัง · Loading sheet…</span>
    </div>`;
}

function message(th, en) {
  els.overlay.hidden = false;
  els.overlay.className = 'plan__overlay is-message';
  els.overlay.innerHTML = `
    <div class="pane-msg" role="alert">
      <span class="mono pane-msg__tag">PLAN</span>
      <p class="pane-msg__th">${esc(th)}</p>
      <p class="pane-msg__en">${esc(en)}</p>
    </div>`;
}

export function planLinks() {
  return current ? { url: current.plan, name: `${current.sheet || current.id}.pdf` } : null;
}
