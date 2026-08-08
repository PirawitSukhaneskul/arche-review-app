# Arche Aquatics — Review App

Static review app for the Arche Aquatics design meetings. The client opens a
link, compares each plan sheet against its 3D model side by side, and sends
feedback back.

- **No backend.** Plain HTML + CSS + ES modules. `three` and `pdfjs` come from a
  pinned CDN via an import map. There is no build step.
- **Deployed from `main`, Pages source `/ (root)`.**

---

## Running it locally

Because the app uses ES modules and `fetch`, opening `index.html` from the file
system will not work — it needs a server. Any static server does:

```bash
python -m http.server 8489
```

Then open <http://localhost:8489/>.

---

## Where to paste the form endpoint

Open `js/config.js` and fill in these two values:

```js
FORM_ENDPOINT: 'https://formspree.io/f/xxxxxxxx',   // from your Formspree dashboard
FALLBACK_EMAIL: 'you@example.com',                  // used by the mailto: fallback
```

Until `FORM_ENDPOINT` is set, the form still validates, autosaves, and offers
**Copy as text**, **Download .json**, and **Email** — it just cannot POST.

To get an endpoint: create a free form at [formspree.io](https://formspree.io),
copy the `https://formspree.io/f/…` URL, paste it above. Submissions arrive in
whichever inbox the Formspree form is pointed at.

---

## File naming rules

Asset names are fixed. Drop files in with exactly these names and edit nothing
but `data/manifest.json`.

```
assets/meeting-<N>/
├── plans/   opt-1.pdf   … opt-6.pdf     required
├── models/  opt-1.dae   … opt-6.dae     required (.glb also works)
│            opt-1-tex/  … opt-6-tex/    texture folders, if the .dae has any
└── thumbs/  opt-1.png   … opt-6.png     optional, 480×310, transparent PNG
```

Thumbnails are optional. Any option without one falls back to a generated
hatched placeholder showing the sheet number, so the grid never breaks.

### Where the Meeting 1 plan sheets came from

`opt-1.pdf` … `opt-6.pdf` are pages **4–9** of the client presentation
`PDF/Arche_Aquatics_Meeting1_6Layouts.pdf` — one A3 landscape sheet per option.
They are used instead of the raw CAD exports in `PDF/6 Plan_PDF/` because the
presentation sheets are in colour and carry the GFA figures and the
ข้อดี/ข้อเสีย notes.

When the deck is revised, re-split it rather than re-plotting from CAD:

```python
import pypdf
deck = pypdf.PdfReader('Arche_Aquatics_Meeting1_6Layouts.pdf')
for opt, page in {1: 4, 2: 5, 3: 6, 4: 7, 5: 8, 6: 9}.items():
    w = pypdf.PdfWriter()
    w.add_page(deck.pages[page - 1])
    w.write(f'assets/meeting-1/plans/opt-{opt}.pdf')
```

Deck page 10 is the all-six comparison sheet and page 11 the feedback sheet;
neither is used by the app today.

Each sheet is ~1.6 MB because it carries the presentation's photography. They
load one at a time, only when an option is opened, so this is a per-option cost,
not an up-front one.

### Collada textures

SketchUp writes texture paths like `OPTION%201/Formica_Beige.jpg` — a folder
name with a space in it, sitting next to the `.dae`. When you re-export, either
keep that folder next to the `.dae` and leave the paths alone, or rename it to
`opt-N-tex/` and update the `<init_from>` lines to match (that is what the files
currently in this repo do). Both work; the second avoids percent-encoded URLs.

---

## How to add an option

Add a block to the meeting's `items` array in `data/manifest.json`:

```json
{
  "id": "opt-7",
  "label": "Option 7",
  "sheet": "M1-07",
  "plan": "assets/meeting-1/plans/opt-7.pdf",
  "model": "assets/meeting-1/models/opt-7.dae",
  "thumb": "assets/meeting-1/thumbs/opt-7.png",
  "modelUp": "Z",
  "modelScale": 1
}
```

Drop the matching files in. No code changes.

## How to add a meeting

Meetings 2–4 already exist as `"status": "pending"` — they show in the rail,
dimmed and unclickable, with a **ยังไม่เปิดรอบนี้ / Not open yet** panel.

To open one:

1. Create `assets/meeting-2/plans|models|thumbs/` and drop the files in.
2. In `data/manifest.json`, change that meeting's `"status"` to `"ready"` and
   fill its `items` array using the block above (paths pointing at
   `assets/meeting-2/…`, sheet numbers `M2-01`, `M2-02`, …).

No code changes. A meeting marked `ready` with an empty `items` array is a
validation error and will say so on screen.

---

## The `modelUp` fix

If a model comes in lying on its side, **change `modelUp` and reload — do not
re-export.**

| Value | Meaning |
| --- | --- |
| `"Z"` | The file is Z-up (SketchUp and Rhino usually are). Rotates −90° about X. |
| `"Y"` | The file is already Y-up (glTF/`.glb` always is). No rotation. |

All six Meeting 1 models are SketchUp Collada exports with `<up_axis>Z_UP` and
are set to `"Z"`.

The manifest is the single source of truth here: the app clears ColladaLoader's
own up-axis correction on load so that flipping this one value is always the
whole fix. If a model still looks wrong after trying both values, the export
itself is rotated — fix it in SketchUp.

`modelScale` is a separate multiplier, normally `1`. The app already scales
every model so its largest horizontal dimension is 40 world units, which is why
lighting and shadows look the same no matter what units were exported.

---

## Big models

The six Meeting 1 `.dae` files are 0.7–3.4 MB and parse fine. If a future export
goes over ~25 MB or feels slow, convert it:

```bash
gltf-transform copy in.dae out.glb
```

…or export `.glb` straight from Rhino/SketchUp. The loader sniffs the extension,
so pointing `"model"` at a `.glb` is all that is needed — and remember `.glb` is
always Y-up, so set `"modelUp": "Y"`.

---

## Deployment

**GitHub Pages, branch `main`, source `/ (root)`.**

- `.nojekyll` sits at the repo root so paths with underscores are served.
- Every asset path in the manifest is relative, so the app works from
  `https://<user>.github.io/<repo>/` with no base-path configuration.

> **Note on privacy:** GitHub Pages from a *private* repo needs a paid plan, and
> a *public* repo means the client PDFs are publicly reachable. If it has to stay
> private and free, deploy the same folder to Cloudflare Pages instead — the
> output is identical and no code changes.

---

## Keyboard

| Key | Action |
| --- | --- |
| `1` – `5` | Model view presets: NE, NW, SE, SW, Top |
| `←` `→` on the divider | Nudge the split (hold `Shift` for bigger steps) |
| `Home` on the divider | Reset the split to 50/50 |
| `Esc` | Close the navigation drawer |

Double-clicking the divider also resets it to 50/50, and its position is
remembered in `localStorage`.

---

## Routes

```
#/                    Meeting 1, option grid
#/m1                  same
#/m1/opt-3            Option 3, default view mode
#/m1/opt-3/split      explicit mode: plan | model | split
#/feedback            feedback form
```

Every route is shareable and survives a reload.
