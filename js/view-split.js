import { CONFIG } from './config.js';
import { beginResizePreview, updateResizePreview, endResizePreview } from './view-plan.js';

/**
 * Split container. The divider is styled as a drafting break line: a hairline
 * with a small centred grip. Side-by-side on wide screens, stacked below
 * BP_SPLIT, as §11 requires.
 */

const workspace = document.getElementById('view-workspace');
const divider = document.getElementById('divider');

let ratio = clamp(loadRatio());
let dragging = false;

export function initSplit() {
  apply();

  divider.addEventListener('pointerdown', onDown);
  divider.addEventListener('dblclick', () => setRatio(CONFIG.SPLIT_DEFAULT));
  divider.addEventListener('keydown', onKey);

  addEventListener('resize', () => {
    divider.setAttribute('aria-orientation', isStacked() ? 'horizontal' : 'vertical');
    apply();
  });
  divider.setAttribute('aria-orientation', isStacked() ? 'horizontal' : 'vertical');
}

function isStacked() {
  return innerWidth < CONFIG.BP_SPLIT;
}

function onDown(e) {
  if (e.button !== 0) return;
  dragging = true;
  divider.setPointerCapture(e.pointerId);
  document.body.classList.add('is-dragging', isStacked() ? 'is-dragging-v' : 'is-dragging-h');
  beginResizePreview();

  const move = (ev) => {
    if (!dragging) return;
    const r = workspace.getBoundingClientRect();
    const next = isStacked()
      ? (ev.clientY - r.top) / r.height
      : (ev.clientX - r.left) / r.width;
    ratio = clamp(next);
    apply();
    updateResizePreview();
  };

  const up = () => {
    if (!dragging) return;
    dragging = false;
    // Release near the centre snaps back to a clean 50/50.
    if (Math.abs(ratio - 0.5) < CONFIG.SPLIT_SNAP) ratio = 0.5;
    apply();
    saveRatio(ratio);
    document.body.classList.remove('is-dragging', 'is-dragging-v', 'is-dragging-h');
    endResizePreview();
    removeEventListener('pointermove', move);
    removeEventListener('pointerup', up);
    removeEventListener('pointercancel', up);
  };

  addEventListener('pointermove', move);
  addEventListener('pointerup', up);
  addEventListener('pointercancel', up);
}

function onKey(e) {
  const step = e.shiftKey ? 0.1 : 0.02;
  const back = isStacked() ? 'ArrowUp' : 'ArrowLeft';
  const fwd = isStacked() ? 'ArrowDown' : 'ArrowRight';

  if (e.key === back) setRatio(ratio - step);
  else if (e.key === fwd) setRatio(ratio + step);
  else if (e.key === 'Home' || e.key === 'Enter') setRatio(CONFIG.SPLIT_DEFAULT);
  else return;

  e.preventDefault();
}

function setRatio(next) {
  ratio = clamp(next);
  apply();
  saveRatio(ratio);
}

function apply() {
  workspace.style.setProperty('--split', `${(ratio * 100).toFixed(2)}%`);
  divider.setAttribute('aria-valuenow', String(Math.round(ratio * 100)));
}

function clamp(v) {
  if (!Number.isFinite(v)) return CONFIG.SPLIT_DEFAULT;
  return Math.min(CONFIG.SPLIT_MAX, Math.max(CONFIG.SPLIT_MIN, v));
}

function loadRatio() {
  try { return JSON.parse(localStorage.getItem(CONFIG.LS_SPLIT)) ?? CONFIG.SPLIT_DEFAULT; }
  catch { return CONFIG.SPLIT_DEFAULT; }
}

function saveRatio(v) {
  try { localStorage.setItem(CONFIG.LS_SPLIT, JSON.stringify(v)); } catch { /* private mode */ }
}
