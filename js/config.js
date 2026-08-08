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

  // ── Model look ─────────────────────────────────────────────────────────
  // Starting point for the display sliders. The client can push these around
  // live and the choice is remembered per browser.
  EXPOSURE: 1.05,
  CONTRAST: 1.12,
  SATURATION: 1.35,        // flat SketchUp faces, not a washed-out film look
  SHADOW_OPACITY: 0.30,

  // ── Fly navigation ─────────────────────────────────────────────────────
  // Fraction of the model radius travelled per second; Shift triples it.
  MOVE_SPEED: 0.9,
  // Crease angle for the overlaid edges. Geometry is welded on position first,
  // so this only keeps genuine silhouette and crease lines, not triangulation.
  EDGE_ANGLE_DEG: 30,
  WELD_TOLERANCE: 1e-4,
  EDGE_TRI_LIMIT: 60000,   // skip edge generation above this per-mesh count
  EDGE_COLOR: 0x2C2A27,
  EDGE_OPACITY: 1.0,       // was 0.35 — the drawn linework reads far stronger

  // Lawn: keep the texture for grain, muted and lightened so the olive tint
  // decides the colour. A tint alone only multiplies and cannot desaturate,
  // which is what left the lawn a vivid lime.
  GRASS_COLOR: 0xC3CE9B,
  GRASS_TEX_SATURATE: 0.4,
  GRASS_TEX_BRIGHTNESS: 1.3,
  GRASS_ROUGHNESS: 0.95,

  /**
   * Programme colours on the model are snapped to the plan legend so the two
   * drawings read as one set. Matching is by hue, so it survives whatever the
   * SketchUp author actually picked. Greys, whites and anything textured are
   * left alone — only flat saturated faces are remapped.
   */
  LEGEND: {
    athlete: 0x7D9B63,
    public: 0xD98E4F,
    cafe: 0xE3B94F,
    staff: 0xA3BDD1,
    phase2: 0xA87BA0,
    water: 0x58AEB5,
  },
  LEGEND_MIN_SATURATION: 0.18,
  CAM_PADDING: 1.08,       // 8% around the fitted bounding box
  LARGE_MODEL_WARN_MB: 25,

  // ── Storage keys ───────────────────────────────────────────────────────
  LS_SPLIT: 'arche.split',
  LS_FEEDBACK: 'arche.feedback',
  LS_EDGES: 'arche.edges',
  LS_PROJECTION: 'arche.projection',
  LS_CONTRAST: 'arche.contrast',
  LS_SATURATE: 'arche.saturate',
  LS_SHADOW: 'arche.shadow',
};
