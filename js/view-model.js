import * as THREE from 'three';
import { ColladaLoader } from 'three/addons/loaders/ColladaLoader.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { mergeVertices } from 'three/addons/utils/BufferGeometryUtils.js';
import { CONFIG } from './config.js';
import { esc } from './ui-rail.js';

/**
 * Model pane — a Rhino "Arctic"/studio look: neutral ground, soft contact
 * shadow, gentle ambient, crisp overlaid edges. Orthographic by default so it
 * sits with the axonometric drawings rather than fighting them.
 *
 * There is exactly ONE renderer and ONE canvas for the whole app; the pane is
 * a stable DOM node, so switching view modes never creates a second WebGL
 * context.
 */

const PAD = CONFIG.CAM_PADDING;
const host = document.getElementById('pane-model');

const PRESETS = {
  iso: { az: 45, el: 35.264 },   // true isometric — matches the printed sheets
  NE: { az: 45, el: 30 },
  NW: { az: 135, el: 30 },
  SE: { az: -45, el: 30 },
  SW: { az: -135, el: 30 },
  Top: { az: 45, el: 89.9 },
};

let ready = false;
let renderer, scene, ortho, persp, camera, controls, ground, keyLight, pmrem;
let els = null;

let root = null;               // group holding the visible model
let cache = new Map();         // item.id → { root, edges[], bytes }
let currentId = null;
let token = 0;

let edgesOn = load(CONFIG.LS_EDGES, true);
let useOrtho = load(CONFIG.LS_PROJECTION, 'ortho') === 'ortho';
let renderPending = false;

/* ── public API ──────────────────────────────────────────────────────────── */

export async function showModel(item) {
  init();
  if (currentId === item.id) return;
  const mine = ++token;

  detachRoot();
  currentId = item.id;

  if (!item.model) {
    message('ไม่มีไฟล์โมเดลสำหรับตัวเลือกนี้', 'No model file is listed for this option.');
    return;
  }

  const cached = cache.get(item.id);
  if (cached) {
    touch(item.id, cached);
    attachRoot(cached, item);
    return;
  }

  progress(0);
  try {
    const entry = await loadModel(item, (p) => { if (mine === token) progress(p); });
    if (mine !== token) { disposeEntry(entry); return; }
    remember(item.id, entry);
    attachRoot(entry, item);
  } catch (err) {
    if (mine !== token) return;
    message(`ไม่พบไฟล์: ${item.model}`,
      `The 3D model could not be loaded. ${err?.message || ''}`);
  }
}

/** Called when the pane changes size — in split-drag and on window resize. */
export function resizeModel() {
  if (!ready) return;
  const w = host.clientWidth, h = host.clientHeight;
  if (!w || !h) return;
  renderer.setSize(w, h, false);
  applyFrustum();
  requestRender();
}

export function disposeAll() {
  for (const [, e] of cache) disposeEntry(e);
  cache.clear();
}

/* ── setup ───────────────────────────────────────────────────────────────── */

function init() {
  if (ready) return;
  ready = true;

  host.innerHTML = `
    <div class="model__stage" id="model-stage"></div>
    <div class="model__overlay" id="model-overlay" hidden></div>
    <div class="model__bar" role="group" aria-label="เครื่องมือโมเดล / Model tools">
      <button type="button" data-act="reset">Reset view</button>
      <span class="model__sep" aria-hidden="true"></span>
      <button type="button" data-preset="NE" class="mono" title="กด 1">NE</button>
      <button type="button" data-preset="NW" class="mono" title="กด 2">NW</button>
      <button type="button" data-preset="SE" class="mono" title="กด 3">SE</button>
      <button type="button" data-preset="SW" class="mono" title="กด 4">SW</button>
      <button type="button" data-preset="Top" class="mono" title="กด 5">Top</button>
      <span class="model__sep" aria-hidden="true"></span>
      <button type="button" data-act="proj" aria-pressed="true">Ortho</button>
      <button type="button" data-act="edges" aria-pressed="true">Edges</button>
      <button type="button" data-act="display" aria-expanded="false"
              aria-controls="model-display" title="ภาพ / Contrast + saturation">◐</button>
      <button type="button" data-act="full" aria-label="เต็มจอ / Fullscreen">⤢</button>
    </div>

    <div class="model__display" id="model-display" hidden>
      <label>
        <span>Contrast <output id="out-contrast"></output></span>
        <input type="range" id="in-contrast" min="0.6" max="2" step="0.01">
      </label>
      <label>
        <span>Saturation <output id="out-saturate"></output></span>
        <input type="range" id="in-saturate" min="0" max="2.5" step="0.01">
      </label>
      <label>
        <span>Shadow <output id="out-shadow"></output></span>
        <input type="range" id="in-shadow" min="0" max="0.7" step="0.01">
      </label>
      <button type="button" data-act="display-reset">Reset</button>
    </div>

    <div class="model__keys" id="model-keys" aria-hidden="true">
      <span class="mono">WASD</span> เดิน ·
      <span class="mono">QE</span> ขึ้นลง ·
      <span class="mono">SHIFT</span> เร็วขึ้น
    </div>`;

  els = {
    stage: host.querySelector('#model-stage'),
    overlay: host.querySelector('#model-overlay'),
    bar: host.querySelector('.model__bar'),
    display: host.querySelector('#model-display'),
    keys: host.querySelector('#model-keys'),
  };

  renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  // ACES filmic desaturates hard — it is a cinema look, and it turned the
  // programme colours milky. Neutral keeps the flat, saturated SketchUp faces.
  renderer.toneMapping = THREE.NeutralToneMapping;
  renderer.toneMappingExposure = CONFIG.EXPOSURE;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.setPixelRatio(Math.min(devicePixelRatio || 1, 2));
  renderer.domElement.className = 'model__canvas';
  renderer.domElement.setAttribute('role', 'img');
  els.stage.append(renderer.domElement);

  scene = new THREE.Scene();
  scene.background = new THREE.Color(0xFCFAF6);

  pmrem = new THREE.PMREMGenerator(renderer);
  // The soft studio falloff on the white roof planes comes from here.
  scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;

  keyLight = new THREE.DirectionalLight(0xFFF6EA, 2.1);
  keyLight.castShadow = true;
  keyLight.shadow.mapSize.set(2048, 2048);
  keyLight.shadow.bias = -0.0004;
  keyLight.shadow.normalBias = 0.02;
  placeLight(keyLight, 135, 48, 120);
  scene.add(keyLight, keyLight.target);

  const fill = new THREE.DirectionalLight(0xE8EEF4, 0.45);
  placeLight(fill, 315, 48, 120);
  scene.add(fill, fill.target);

  scene.add(new THREE.HemisphereLight(0xFFFFFF, 0xD8D2C6, 0.35));

  ground = new THREE.Mesh(
    new THREE.PlaneGeometry(CONFIG.GROUND_SIZE, CONFIG.GROUND_SIZE),
    new THREE.ShadowMaterial({ opacity: CONFIG.SHADOW_OPACITY })
  );
  ground.rotation.x = -Math.PI / 2;
  // The model is normalised to sit exactly on y=0, so a ground plane at y=0
  // is coplanar with its base slab and the two z-fight — which is what breaks
  // up into flickering wedges as you zoom. Drop it by a hair.
  ground.position.y = -CONFIG.GROUND_DROP;
  ground.receiveShadow = true;
  scene.add(ground);

  ortho = new THREE.OrthographicCamera(-20, 20, 20, -20, 0.1, 1000);
  persp = new THREE.PerspectiveCamera(35, 1, 0.1, 1000);
  camera = useOrtho ? ortho : persp;

  controls = new OrbitControls(camera, renderer.domElement);
  controls.enableDamping = true;
  controls.dampingFactor = 0.08;
  controls.maxPolarAngle = THREE.MathUtils.degToRad(85);
  controls.minPolarAngle = THREE.MathUtils.degToRad(5);
  controls.enablePan = true;
  controls.addEventListener('change', requestRender);

  els.bar.addEventListener('click', onBar);
  els.display.addEventListener('input', onGrade);
  els.display.addEventListener('click', (e) => {
    if (e.target.dataset.act === 'display-reset') {
      grade = {
        contrast: CONFIG.CONTRAST,
        saturate: CONFIG.SATURATION,
        shadow: CONFIG.SHADOW_OPACITY,
      };
      applyGrade();
    }
  });
  syncToggles();
  applyGrade();

  new ResizeObserver(resizeModel).observe(host);

  // The pane has to be focusable for WASD to reach it, and clicking into the
  // model is the natural way to say "I am driving this now".
  host.tabIndex = 0;
  host.addEventListener('keydown', onKey);
  host.addEventListener('keyup', onKeyUp);
  host.addEventListener('pointerdown', () => host.focus({ preventScroll: true }));
  host.addEventListener('blur', stopFlying);

  resizeModel();
}

function onGrade(e) {
  const id = e.target.id;
  if (id === 'in-contrast') grade.contrast = +e.target.value;
  else if (id === 'in-saturate') grade.saturate = +e.target.value;
  else if (id === 'in-shadow') grade.shadow = +e.target.value;
  else return;
  applyGrade();
}

function placeLight(light, azDeg, elDeg, dist) {
  light.position.copy(dirVector(azDeg, elDeg).multiplyScalar(dist));
  light.target.position.set(0, 0, 0);
}

function dirVector(azDeg, elDeg) {
  const a = THREE.MathUtils.degToRad(azDeg);
  const e = THREE.MathUtils.degToRad(elDeg);
  return new THREE.Vector3(
    Math.cos(e) * Math.sin(a),
    Math.sin(e),
    Math.cos(e) * Math.cos(a)
  );
}

/* ── loading and normalisation ───────────────────────────────────────────── */

function loadModel(item, onProgress) {
  const url = item.model;
  const isGlb = /\.gl(b|tf)$/i.test(url);
  const loader = isGlb ? new GLTFLoader() : new ColladaLoader();

  return new Promise((resolve, reject) => {
    loader.load(
      url,
      (asset) => {
        try { resolve(normalise(asset.scene, item, isGlb)); }
        catch (err) { reject(err); }
      },
      (ev) => {
        if (ev.lengthComputable && ev.total) onProgress(ev.loaded / ev.total);
        if (ev.total > CONFIG.LARGE_MODEL_WARN_MB * 1024 * 1024) {
          console.warn(
            `[model] ${url} is ${(ev.total / 1048576).toFixed(1)} MB. ` +
            'Consider exporting .glb from SketchUp/Rhino — see README.'
          );
        }
      },
      (err) => reject(err instanceof Error ? err : new Error('load failed'))
    );
  });
}

function normalise(inner, item, isGlb) {
  // ColladaLoader applies its own Z_UP → Y_UP rotation to the scene root. We
  // clear it so `modelUp` in the manifest is the single source of truth and
  // Win can fix an on-its-side model by editing one value. SketchUp writes an
  // identity root node, so nothing authored is lost here.
  if (!isGlb) inner.rotation.set(0, 0, 0);
  if (item.modelUp === 'Z') inner.rotateX(-Math.PI / 2);
  inner.updateMatrixWorld(true);

  // Scale so the largest horizontal dimension is a fixed size — that keeps
  // camera, light, and shadow distances valid whatever units Rhino exported.
  const box = new THREE.Box3().setFromObject(inner);
  const size = box.getSize(new THREE.Vector3());
  const widest = Math.max(size.x, size.z) || 1;
  inner.scale.multiplyScalar((CONFIG.MODEL_TARGET_SIZE / widest) * (item.modelScale ?? 1));
  inner.updateMatrixWorld(true);

  // Footprint centre at the origin, and sitting on the ground plane.
  const box2 = new THREE.Box3().setFromObject(inner);
  const c = box2.getCenter(new THREE.Vector3());
  inner.position.x -= c.x;
  inner.position.z -= c.z;
  inner.position.y -= box2.min.y;
  inner.updateMatrixWorld(true);

  const edges = [];
  inner.traverse((o) => {
    if (!o.isMesh) return;
    o.castShadow = true;
    o.receiveShadow = true;
    o.material = Array.isArray(o.material)
      ? o.material.map(toStandard)
      : toStandard(o.material);

    const tris = o.geometry.index
      ? o.geometry.index.count / 3
      : o.geometry.attributes.position.count / 3;

    if (tris > CONFIG.EDGE_TRI_LIMIT) {
      console.info(`[model] skipping edges for "${o.name || o.uuid}" ` +
        `(${Math.round(tris)} triangles > ${CONFIG.EDGE_TRI_LIMIT})`);
      return;
    }
    const line = new THREE.LineSegments(
      outlineOf(o.geometry),
      new THREE.LineBasicMaterial({
        color: CONFIG.EDGE_COLOR,
        transparent: CONFIG.EDGE_OPACITY < 1,
        opacity: CONFIG.EDGE_OPACITY,
      })
    );
    line.visible = edgesOn;
    o.add(line);          // child of the mesh, so it inherits every transform
    edges.push(line);
  });

  const group = new THREE.Group();
  group.add(inner);
  return { root: group, edges };
}

/**
 * Real silhouette and crease edges only — no triangulation lines.
 *
 * ColladaLoader hands back non-indexed geometry, so EdgesGeometry sees every
 * triangle as an island with no neighbours and dutifully draws all three of its
 * sides, which is what covers the model in polygon lines. Welding first gives
 * it the face adjacency it needs for the crease-angle test to mean anything.
 *
 * The weld runs on position ONLY. SketchUp writes per-face normals and per-face
 * UVs, so vertices along a shared edge differ in those attributes and a normal
 * mergeVertices() would refuse to join them — leaving the lines exactly as they
 * were.
 */
function outlineOf(geometry) {
  const pos = geometry.getAttribute('position');
  if (!pos) return new THREE.BufferGeometry();

  let welded = null;
  try {
    // Weld on position ONLY. SketchUp writes per-face normals and UVs, so
    // vertices along a shared edge differ in those and a full mergeVertices()
    // would refuse to join them.
    const bare = new THREE.BufferGeometry();
    bare.setAttribute('position', pos.clone());
    welded = mergeVertices(bare, CONFIG.WELD_TOLERANCE);

    const idx = welded.getIndex();
    const wp = welded.getAttribute('position');
    if (!idx) return new THREE.EdgesGeometry(geometry, CONFIG.EDGE_ANGLE_DEG);

    // Drop degenerate and duplicate triangles. SketchUp exports coincident
    // faces (front/back pairs, nested groups); they leave every interior edge
    // looking unpaired, so EdgesGeometry treats it as an open border and draws
    // it unconditionally — which is what covers the model in polygon lines.
    // Sorting each triple also collapses reversed-winding duplicates.
    const seen = new Set();
    const faces = [];
    for (let i = 0; i < idx.count; i += 3) {
      const a = idx.getX(i), b = idx.getX(i + 1), c = idx.getX(i + 2);
      if (a === b || b === c || a === c) continue;
      const key = a < b
        ? (b < c ? `${a},${b},${c}` : a < c ? `${a},${c},${b}` : `${c},${a},${b}`)
        : (a < c ? `${b},${a},${c}` : b < c ? `${b},${c},${a}` : `${c},${b},${a}`);
      if (seen.has(key)) continue;
      seen.add(key);
      faces.push(a, b, c);
    }

    const vA = new THREE.Vector3(), vB = new THREE.Vector3(), vC = new THREE.Vector3();
    const ab = new THREE.Vector3(), cb = new THREE.Vector3();
    const normals = [];
    for (let f = 0; f < faces.length; f += 3) {
      vA.fromBufferAttribute(wp, faces[f]);
      vB.fromBufferAttribute(wp, faces[f + 1]);
      vC.fromBufferAttribute(wp, faces[f + 2]);
      normals.push(new THREE.Vector3()
        .crossVectors(cb.subVectors(vC, vB), ab.subVectors(vA, vB)).normalize());
    }

    const edges = new Map();
    for (let f = 0; f < faces.length; f += 3) {
      const tri = [faces[f], faces[f + 1], faces[f + 2]];
      for (let e = 0; e < 3; e++) {
        const u = tri[e], v = tri[(e + 1) % 3];
        const key = u < v ? `${u}_${v}` : `${v}_${u}`;
        const rec = edges.get(key);
        if (rec) rec.push(f / 3);
        else edges.set(key, [f / 3]);
      }
    }

    const cosLimit = Math.cos(THREE.MathUtils.degToRad(CONFIG.EDGE_ANGLE_DEG));
    const out = [];
    const p = new THREE.Vector3(), q = new THREE.Vector3();
    for (const [key, adj] of edges) {
      let keep = adj.length === 1;          // a genuine open border / silhouette
      for (let i = 0; i < adj.length && !keep; i++) {
        for (let j = i + 1; j < adj.length && !keep; j++) {
          if (normals[adj[i]].dot(normals[adj[j]]) < cosLimit) keep = true;
        }
      }
      if (!keep) continue;
      const [u, v] = key.split('_');
      p.fromBufferAttribute(wp, +u);
      q.fromBufferAttribute(wp, +v);
      out.push(p.x, p.y, p.z, q.x, q.y, q.z);
    }

    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(out, 3));
    return g;
  } catch {
    return new THREE.EdgesGeometry(geometry, CONFIG.EDGE_ANGLE_DEG);
  } finally {
    welded?.dispose();
  }
}

function toStandard(src) {
  if (!src || src.isMeshStandardMaterial) return src;

  // The lawn keeps its texture so it still reads as grass rather than a flat
  // card, but the SketchUp image is a strong mid-green. A colour tint only
  // multiplies, which can never desaturate, so the texture itself is muted and
  // lightened before the olive tint goes on top.
  if (/grass|lawn/i.test(src.name || '')) {
    const g = new THREE.MeshStandardMaterial({
      color: new THREE.Color(CONFIG.GRASS_COLOR),
      map: src.map || null,
      roughness: CONFIG.GRASS_ROUGHNESS,
      metalness: 0.0,
      side: src.side === THREE.DoubleSide ? THREE.DoubleSide : THREE.FrontSide,
    });
    g.envMapIntensity = 0.7;
    g.name = src.name;
    if (g.map) {
      g.map.colorSpace = THREE.SRGBColorSpace;
      muteTexture(g, src.map);
    }
    src.dispose?.();
    return g;
  }

  // Collada gives Phong, which does not react to the environment map.
  const m = new THREE.MeshStandardMaterial({
    color: src.color ? src.color.clone() : new THREE.Color(0xFFFFFF),
    map: src.map || null,
    opacity: src.opacity ?? 1,
    transparent: !!src.transparent,
    side: src.side === THREE.DoubleSide ? THREE.DoubleSide : THREE.FrontSide,
    roughness: 0.62,
    metalness: 0.0,
  });
  m.envMapIntensity = 0.85;
  m.name = src.name || '';
  if (m.map) m.map.colorSpace = THREE.SRGBColorSpace;
  else snapToLegend(m.color);
  src.dispose?.();
  return m;
}

/**
 * Repaints a texture through a canvas with reduced saturation and raised
 * brightness, keeping the grain but dropping the colour so the material's own
 * tint decides the hue. Textures load asynchronously, so this waits for the
 * image when it is not decoded yet.
 */
function muteTexture(material, tex) {
  const run = () => {
    const img = tex.image;
    if (!img?.width) return;
    try {
      const c = document.createElement('canvas');
      c.width = img.width;
      c.height = img.height;
      const ctx = c.getContext('2d');
      ctx.filter = `saturate(${CONFIG.GRASS_TEX_SATURATE}) `
                 + `brightness(${CONFIG.GRASS_TEX_BRIGHTNESS})`;
      ctx.drawImage(img, 0, 0);

      const out = new THREE.CanvasTexture(c);
      out.colorSpace = THREE.SRGBColorSpace;
      out.wrapS = tex.wrapS;
      out.wrapT = tex.wrapT;
      out.repeat.copy(tex.repeat);
      out.offset.copy(tex.offset);
      out.anisotropy = renderer?.capabilities.getMaxAnisotropy?.() ?? 1;
      out.needsUpdate = true;

      material.map = out;
      material.needsUpdate = true;
      requestRender();
    } catch {
      /* leave the original texture in place */
    }
  };

  // TextureLoader leaves `image` undefined until the fetch resolves, so there
  // is nothing to attach a load listener to yet. Poll for it instead.
  let tries = 60;
  const wait = () => {
    if (tex.image?.width) { run(); return; }
    if (--tries > 0) setTimeout(wait, 100);
  };
  wait();
}

const LEGEND_HUES = Object.values(CONFIG.LEGEND).map((hex) => {
  const c = new THREE.Color(hex);
  const hsl = { h: 0, s: 0, l: 0 };
  c.getHSL(hsl);
  return { color: c, h: hsl.h };
});

/**
 * Pulls a flat programme colour onto the nearest plan-legend tone, so a room
 * that is olive on the sheet is the same olive on the model.
 *
 * Only untextured, genuinely saturated faces are touched — concrete, glass,
 * white roofs and every grey stay exactly as the model author left them.
 */
function snapToLegend(color) {
  const hsl = { h: 0, s: 0, l: 0 };
  color.getHSL(hsl);
  if (hsl.s < CONFIG.LEGEND_MIN_SATURATION) return;

  let best = null;
  let bestDist = Infinity;
  for (const entry of LEGEND_HUES) {
    // hue is circular, so 350° and 10° are 20° apart, not 340°
    const d = Math.abs(hsl.h - entry.h);
    const dist = Math.min(d, 1 - d);
    if (dist < bestDist) { bestDist = dist; best = entry; }
  }
  if (best) color.copy(best.color);
}

/* ── attach / cache ──────────────────────────────────────────────────────── */

function attachRoot(entry, item) {
  root = entry.root;
  scene.add(root);
  renderer.domElement.setAttribute('aria-label',
    `แบบจำลอง 3 มิติ ${item.label} ${item.sheet} — 3D model`);
  hideOverlay();
  frameTo('iso');
}

function detachRoot() {
  if (root) scene.remove(root);
  root = null;
}

function remember(id, entry) {
  cache.set(id, entry);
  while (cache.size > CONFIG.MODEL_CACHE_MAX) {
    const oldest = cache.keys().next().value;
    if (oldest === currentId) break;
    disposeEntry(cache.get(oldest));
    cache.delete(oldest);
  }
}

function touch(id, entry) {          // keep the Map ordered least-recent-first
  cache.delete(id);
  cache.set(id, entry);
}

function disposeEntry(entry) {
  if (!entry) return;
  entry.root.traverse((o) => {
    o.geometry?.dispose();
    for (const m of [].concat(o.material || [])) {
      for (const k of ['map', 'normalMap', 'roughnessMap', 'metalnessMap', 'aoMap', 'emissiveMap']) {
        m[k]?.dispose?.();
      }
      m.dispose?.();
    }
  });
}

/* ── camera ──────────────────────────────────────────────────────────────── */

/** Distance at which the perspective camera frames the whole model. */
function perspDistance(radius) {
  const aspect = (host.clientWidth || 1) / (host.clientHeight || 1);
  const vFov = THREE.MathUtils.degToRad(persp.fov);
  const hFov = 2 * Math.atan(Math.tan(vFov / 2) * aspect);
  return Math.max(radius / Math.sin(vFov / 2), radius / Math.sin(hFov / 2)) * PAD;
}

function frameTo(presetName) {
  if (!root) return;
  const { az, el } = PRESETS[presetName] || PRESETS.iso;
  const box = new THREE.Box3().setFromObject(root);
  const sphere = box.getBoundingSphere(new THREE.Sphere());
  const target = box.getCenter(new THREE.Vector3());
  const dir = dirVector(az, el);
  const radius = Math.max(sphere.radius, 0.001);
  modelRadius = radius;                      // walk speed scales with the model

  // Orthographic framing comes from the frustum extents, so the camera only
  // has to stand far enough back to clear the scene. Perspective framing IS
  // the distance, so it gets its own fov-derived one.
  ortho.position.copy(target).addScaledVector(dir, Math.max(radius * 4, 1));
  persp.position.copy(target).addScaledVector(dir, perspDistance(radius));
  for (const cam of [ortho, persp]) {
    cam.zoom = 1;
    cam.lookAt(target);
  }
  controls.target.copy(target);

  // Let the user dolly in close without falling through the model, and stop
  // them flying off into the empty ground plane.
  controls.minDistance = radius * 0.15;
  controls.maxDistance = radius * 20;
  controls.minZoom = 0.2;
  controls.maxZoom = 60;

  fitShadow(sphere);
  applyFrustum();
  controls.update();
  requestRender();
}

function fitShadow(sphere) {
  const r = Math.max(sphere.radius * 1.2, 1);
  const dist = r * 3;
  const c = keyLight.shadow.camera;
  c.left = -r; c.right = r; c.top = r; c.bottom = -r;
  // Wrap the depth range tightly around the model. A 1..400 range spends most
  // of its precision on empty space and shows up as shadow acne on the roofs.
  c.near = Math.max(0.5, dist - r * 2);
  c.far = dist + r * 2;
  c.updateProjectionMatrix();
  keyLight.position.copy(dirVector(135, 48).multiplyScalar(dist));
  keyLight.target.position.set(0, 0, 0);
  keyLight.target.updateMatrixWorld();
}

/**
 * Fits the frustum to the model with 8% padding. Preserves the user's current
 * zoom so a window resize does not throw away where they were looking.
 */
function applyFrustum() {
  if (!root || !ready) return;
  const w = host.clientWidth || 1;
  const h = host.clientHeight || 1;
  const aspect = w / h;

  const box = new THREE.Box3().setFromObject(root);
  const sphere = box.getBoundingSphere(new THREE.Sphere());

  camera.updateMatrixWorld(true);
  const inv = new THREE.Matrix4().copy(camera.matrixWorld).invert();

  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
  const v = new THREE.Vector3();
  for (let i = 0; i < 8; i++) {
    v.set(
      i & 1 ? box.max.x : box.min.x,
      i & 2 ? box.max.y : box.min.y,
      i & 4 ? box.max.z : box.min.z
    ).applyMatrix4(inv);
    minX = Math.min(minX, v.x); maxX = Math.max(maxX, v.x);
    minY = Math.min(minY, v.y); maxY = Math.max(maxY, v.y);
  }

  // The frustum must enclose the whole scene, not just the model — the ground
  // plane is an order of magnitude bigger, and fitting near/far to the model
  // alone slices it open as soon as you orbit or zoom.
  const sceneR = Math.max(sphere.radius, CONFIG.GROUND_SIZE * Math.SQRT1_2);

  if (camera === ortho) {
    let halfW = ((maxX - minX) / 2) * PAD;
    let halfH = ((maxY - minY) / 2) * PAD;
    if (halfW / halfH < aspect) halfW = halfH * aspect;
    else halfH = halfW / aspect;
    ortho.left = -halfW; ortho.right = halfW;
    ortho.top = halfH; ortho.bottom = -halfH;
    // An orthographic near plane may sit behind the camera, and depth is
    // linear, so a generous symmetric range costs no precision and can never
    // clip whatever the orbit does.
    ortho.near = -sceneR * 4;
    ortho.far = sceneR * 4;
    ortho.updateProjectionMatrix();
  } else {
    // Never move the camera here — this runs on every resize, and dollying it
    // back to a "fitted" distance would throw away the user's zoom. Framing is
    // frameTo()'s job; this only keeps the projection honest.
    persp.aspect = aspect;
    // near must stay well inside the closest the user can dolly to, or zooming
    // in simply pushes the model through the near plane and it vanishes.
    persp.near = Math.max(0.01, sphere.radius * 0.02);
    // Reach past the furthest the user can dolly out to, so far never clips.
    persp.far = sphere.radius * 20 + sceneR * 2.5;
    persp.updateProjectionMatrix();
  }
}

function setProjection(toOrtho) {
  if (toOrtho === (camera === ortho)) return;

  const target = controls.target.clone();
  // Carry the direction you are currently looking from over to the other
  // camera, otherwise it wakes up wherever it was last left.
  const dir = camera.position.clone().sub(target).normalize();
  const radius = root
    ? Math.max(new THREE.Box3().setFromObject(root)
        .getBoundingSphere(new THREE.Sphere()).radius, 0.001)
    : 1;

  camera = toOrtho ? ortho : persp;
  useOrtho = toOrtho;
  save(CONFIG.LS_PROJECTION, toOrtho ? 'ortho' : 'persp');

  camera.position.copy(target)
    .addScaledVector(dir, toOrtho ? Math.max(radius * 4, 1) : perspDistance(radius));
  camera.lookAt(target);

  controls.object = camera;
  controls.target.copy(target);
  applyFrustum();
  controls.update();
  syncToggles();
  requestRender();
}

/* ── render loop ─────────────────────────────────────────────────────────── */

function requestRender() {
  if (renderPending || !ready) return;
  renderPending = true;
  requestAnimationFrame(tick);
}

function tick(now) {
  renderPending = false;
  const flew = flying ? step(now ?? performance.now()) : false;
  // update() returns true while damping is still settling — that, and only
  // that, keeps the loop alive. A static model costs zero frames.
  const moving = controls.update();
  renderer.render(scene, camera);

  if (!held.size && flying) stopFlying();
  if (moving || flew || flying) requestRender();
}

/* ── toolbar ─────────────────────────────────────────────────────────────── */

function onBar(e) {
  const btn = e.target.closest('button');
  if (!btn) return;

  if (btn.dataset.preset) return frameTo(btn.dataset.preset);

  switch (btn.dataset.act) {
    case 'reset': return frameTo('iso');
    case 'proj': return setProjection(camera !== ortho);
    case 'display': {
      const open = els.display.hidden;
      els.display.hidden = !open;
      btn.setAttribute('aria-expanded', String(open));
      return;
    }
    case 'edges': {
      edgesOn = !edgesOn;
      save(CONFIG.LS_EDGES, edgesOn);
      for (const [, entry] of cache) for (const l of entry.edges) l.visible = edgesOn;
      syncToggles();
      return requestRender();
    }
    case 'full': {
      if (document.fullscreenElement) document.exitFullscreen();
      else host.requestFullscreen?.();
      return;
    }
  }
}

/* ── WASD / QE fly navigation ────────────────────────────────────────────── */

const MOVE_KEYS = {
  KeyW: 'fwd', KeyS: 'back', KeyA: 'left', KeyD: 'right',
  KeyQ: 'down', KeyE: 'up',
};
const held = new Set();
let flying = false;
let lastMove = 0;
let modelRadius = 20;

function onKey(e) {
  const presets = { 1: 'NE', 2: 'NW', 3: 'SE', 4: 'SW', 5: 'Top' };
  if (presets[e.key]) { e.preventDefault(); frameTo(presets[e.key]); return; }

  if (MOVE_KEYS[e.code] && !e.ctrlKey && !e.metaKey && !e.altKey) {
    e.preventDefault();
    if (!held.has(e.code)) {
      held.add(e.code);
      startFlying();
    }
  }
}

function onKeyUp(e) {
  if (MOVE_KEYS[e.code]) {
    held.delete(e.code);
    if (!held.size) stopFlying();
  }
}

function startFlying() {
  if (flying) return;
  flying = true;
  lastMove = performance.now();
  els.keys.classList.add('is-live');
  requestRender();
}

function stopFlying() {
  flying = false;
  held.clear();
  els.keys.classList.remove('is-live');
}

/**
 * Moves the camera and its orbit target together, so releasing the keys hands
 * a coherent pivot back to OrbitControls instead of spinning around wherever
 * the target was left behind.
 */
function step(now) {
  const dt = Math.min((now - lastMove) / 1000, 0.1);
  lastMove = now;
  if (!held.size) return false;

  const speed = modelRadius * CONFIG.MOVE_SPEED * dt * (shiftDown ? 3 : 1);

  const forward = new THREE.Vector3();
  camera.getWorldDirection(forward);
  const flat = new THREE.Vector3(forward.x, 0, forward.z);
  // Looking straight down leaves no horizontal heading to walk along.
  if (flat.lengthSq() < 1e-6) flat.set(0, 0, -1); else flat.normalize();
  const strafe = new THREE.Vector3().crossVectors(flat, new THREE.Vector3(0, 1, 0));

  const move = new THREE.Vector3();
  for (const code of held) {
    switch (MOVE_KEYS[code]) {
      case 'fwd': move.add(flat); break;
      case 'back': move.sub(flat); break;
      case 'left': move.sub(strafe); break;
      case 'right': move.add(strafe); break;
      case 'up': move.y += 1; break;
      case 'down': move.y -= 1; break;
    }
  }
  if (move.lengthSq() === 0) return false;
  move.normalize().multiplyScalar(speed);

  if (camera === ortho) {
    // Translating an orthographic camera along its view axis changes nothing
    // on screen, so forward/back becomes zoom instead.
    const fwdAmount = (held.has('KeyW') ? 1 : 0) - (held.has('KeyS') ? 1 : 0);
    if (fwdAmount) {
      ortho.zoom = THREE.MathUtils.clamp(
        ortho.zoom * (1 + fwdAmount * dt * 1.6), controls.minZoom, controls.maxZoom
      );
      ortho.updateProjectionMatrix();
    }
    // Strafing and rising still read fine in ortho, so keep only the part of
    // the movement that lies across the view axis.
    const planar = move.clone().projectOnPlane(forward.clone().normalize());
    camera.position.add(planar);
    controls.target.add(planar);
  } else {
    camera.position.add(move);
    controls.target.add(move);
  }
  return true;
}

let shiftDown = false;
addEventListener('keydown', (e) => { if (e.key === 'Shift') shiftDown = true; });
addEventListener('keyup', (e) => { if (e.key === 'Shift') shiftDown = false; });

/* ── display grading ─────────────────────────────────────────────────────── */

let grade = {
  contrast: load(CONFIG.LS_CONTRAST, CONFIG.CONTRAST),
  saturate: load(CONFIG.LS_SATURATE, CONFIG.SATURATION),
  shadow: load(CONFIG.LS_SHADOW, CONFIG.SHADOW_OPACITY),
};

/**
 * Contrast and saturation ride on a CSS filter over the canvas — it is GPU
 * composited, needs no re-render, and so tracks the slider live. Shadow
 * strength is a real material property, so that one does re-render.
 */
function applyGrade() {
  renderer.domElement.style.filter =
    `contrast(${grade.contrast.toFixed(2)}) saturate(${grade.saturate.toFixed(2)})`;
  ground.material.opacity = grade.shadow;

  host.querySelector('#in-contrast').value = grade.contrast;
  host.querySelector('#in-saturate').value = grade.saturate;
  host.querySelector('#in-shadow').value = grade.shadow;
  host.querySelector('#out-contrast').value = `${Math.round(grade.contrast * 100)}%`;
  host.querySelector('#out-saturate').value = `${Math.round(grade.saturate * 100)}%`;
  host.querySelector('#out-shadow').value = `${Math.round(grade.shadow * 100)}%`;

  save(CONFIG.LS_CONTRAST, grade.contrast);
  save(CONFIG.LS_SATURATE, grade.saturate);
  save(CONFIG.LS_SHADOW, grade.shadow);
  requestRender();
}

function syncToggles() {
  const proj = els.bar.querySelector('[data-act="proj"]');
  proj.textContent = camera === ortho ? 'Ortho' : 'Persp';
  proj.setAttribute('aria-pressed', String(camera === ortho));

  const edges = els.bar.querySelector('[data-act="edges"]');
  edges.setAttribute('aria-pressed', String(edgesOn));
  edges.classList.toggle('is-off', !edgesOn);
}

/* ── overlays ────────────────────────────────────────────────────────────── */

function progress(p) {
  els.overlay.hidden = false;
  els.overlay.className = 'model__overlay is-loading';
  els.overlay.innerHTML = `
    <div class="skeleton" aria-live="polite">
      <span class="mono skeleton__sheet">3D</span>
      <span class="skeleton__bar"><i style="width:${Math.round(p * 100)}%"></i></span>
      <span class="skeleton__note">กำลังโหลดโมเดล ${Math.round(p * 100)}% · Loading model</span>
    </div>`;
}

function hideOverlay() {
  els.overlay.hidden = true;
  els.overlay.replaceChildren();
}

function message(th, en) {
  els.overlay.hidden = false;
  els.overlay.className = 'model__overlay is-message';
  els.overlay.innerHTML = `
    <div class="pane-msg" role="alert">
      <span class="mono pane-msg__tag">MODEL</span>
      <p class="pane-msg__th">${esc(th)}</p>
      <p class="pane-msg__en">${esc(en)}</p>
    </div>`;
}

/* ── tiny persisted-state helpers ────────────────────────────────────────── */

function load(key, fallback) {
  try {
    const v = localStorage.getItem(key);
    return v === null ? fallback : JSON.parse(v);
  } catch { return fallback; }
}

function save(key, value) {
  try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* private mode */ }
}
