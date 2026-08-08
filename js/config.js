/**
 * Endpoints and tunables. This is the only file Win needs to edit.
 */
export const CONFIG = {

  // ── Feedback form ──────────────────────────────────────────────────────
  // TODO — Win: paste the Formspree endpoint here, e.g.
  //   'https://formspree.io/f/xxxxxxxx'
  // While this is empty the form still works: it validates, autosaves, and
  // offers Download .json / Copy as text / mailto. It just cannot POST.
  FORM_ENDPOINT: '',

  // TODO — Win: confirm the destination address for the mailto: fallback.
  FALLBACK_EMAIL: 'pirawit.win@gmail.com',

  FORM_SUBJECT: 'Arche Aquatics — Feedback Meeting 1',

  // ── Data ───────────────────────────────────────────────────────────────
  MANIFEST_URL: 'data/manifest.json',

  // ── Layout ─────────────────────────────────────────────────────────────
  BP_SPLIT: 1100,          // at or above this, split is the default mode
  BP_DRAWER: 760,          // below this, the rail becomes a slide-over drawer
  SPLIT_DEFAULT: 0.5,
  SPLIT_MIN: 0.15,
  SPLIT_MAX: 0.85,
  SPLIT_SNAP: 0.04,        // release within 4% of centre snaps to 50/50

  // ── Plan pane ──────────────────────────────────────────────────────────
  ZOOM_STEPS: [0.75, 1, 1.5, 2, 3],
  RESIZE_DEBOUNCE_MS: 120,

  // ── Model pane ─────────────────────────────────────────────────────────
  MODEL_TARGET_SIZE: 40,   // largest horizontal dimension, in world units
  GROUND_SIZE: 400,        // the neutral ground plane the shadow falls on
  GROUND_DROP: 0.01,       // sits just under y=0 so it cannot z-fight the base
  MODEL_CACHE_MAX: 3,
  EDGE_ANGLE_DEG: 28,
  EDGE_TRI_LIMIT: 60000,   // skip edge generation above this per-mesh count
  CAM_PADDING: 1.08,       // 8% around the fitted bounding box
  LARGE_MODEL_WARN_MB: 25,

  // ── Storage keys ───────────────────────────────────────────────────────
  LS_SPLIT: 'arche.split',
  LS_FEEDBACK: 'arche.feedback',
  LS_EDGES: 'arche.edges',
  LS_PROJECTION: 'arche.projection',
};
