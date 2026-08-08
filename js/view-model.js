import * as THREE from 'three';
import { ColladaLoader } from 'three/addons/loaders/ColladaLoader.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
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
      <button type="button" data-act="full" aria-label="เต็มจอ / Fullscreen">⤢</button>
    </div>`;

  els = {
    stage: host.querySelector('#model-stage'),
    overlay: host.querySelector('#model-overlay'),
    bar: host.querySelector('.model__bar'),
  };

  renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.0;
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
    new THREE.ShadowMaterial({ opacity: 0.20 })
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
  syncToggles();

  new ResizeObserver(resizeModel).observe(host);
  host.addEventListener('keydown', onKey);
  host.tabIndex = -1;

  resizeModel();
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
      new THREE.EdgesGeometry(o.geometry, CONFIG.EDGE_ANGLE_DEG),
      new THREE.LineBasicMaterial({ color: 0x2C2A27, transparent: true, opacity: 0.35 })
    );
    line.visible = edgesOn;
    o.add(line);          // child of the mesh, so it inherits every transform
    edges.push(line);
  });

  const group = new THREE.Group();
  group.add(inner);
  return { root: group, edges };
}

function toStandard(src) {
  if (!src || src.isMeshStandardMaterial) return src;
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
  if (m.map) m.map.colorSpace = THREE.SRGBColorSpace;
  src.dispose?.();
  return m;
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

function frameTo(presetName) {
  if (!root) return;
  const { az, el } = PRESETS[presetName] || PRESETS.iso;
  const box = new THREE.Box3().setFromObject(root);
  const sphere = box.getBoundingSphere(new THREE.Sphere());
  const target = box.getCenter(new THREE.Vector3());
  const dist = Math.max(sphere.radius * 4, 1);

  for (const cam of [ortho, persp]) {
    cam.position.copy(target).addScaledVector(dirVector(az, el), dist);
    cam.zoom = 1;
    cam.lookAt(target);
  }
  controls.target.copy(target);

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
    const vFov = THREE.MathUtils.degToRad(persp.fov);
    const hFov = 2 * Math.atan(Math.tan(vFov / 2) * aspect);
    const r = sphere.radius;
    const dist = Math.max(r / Math.sin(vFov / 2), r / Math.sin(hFov / 2)) * PAD;
    const dir = persp.position.clone().sub(controls.target).normalize();
    persp.position.copy(controls.target).addScaledVector(dir, dist);
    persp.updateMatrixWorld(true);

    persp.aspect = aspect;
    // Keep near tied to the model so depth precision stays usable, but push
    // far out past the ground plane.
    persp.near = Math.max(dist * 0.01, dist - r * 2);
    persp.far = dist + sceneR * 2.5;
    persp.updateProjectionMatrix();
  }
}

function setProjection(toOrtho) {
  if (toOrtho === (camera === ortho)) return;
  const target = controls.target.clone();
  camera = toOrtho ? ortho : persp;
  useOrtho = toOrtho;
  save(CONFIG.LS_PROJECTION, toOrtho ? 'ortho' : 'persp');

  controls.object = camera;
  controls.target.copy(target);
  camera.lookAt(target);
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

function tick() {
  renderPending = false;
  // update() returns true while damping is still settling — that, and only
  // that, keeps the loop alive. A static model costs zero frames.
  const moving = controls.update();
  renderer.render(scene, camera);
  if (moving) requestRender();
}

/* ── toolbar ─────────────────────────────────────────────────────────────── */

function onBar(e) {
  const btn = e.target.closest('button');
  if (!btn) return;

  if (btn.dataset.preset) return frameTo(btn.dataset.preset);

  switch (btn.dataset.act) {
    case 'reset': return frameTo('iso');
    case 'proj': return setProjection(camera !== ortho);
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

function onKey(e) {
  const keys = { 1: 'NE', 2: 'NW', 3: 'SE', 4: 'SW', 5: 'Top' };
  if (keys[e.key]) { e.preventDefault(); frameTo(keys[e.key]); }
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
