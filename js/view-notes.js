import { esc } from './ui-rail.js';

/**
 * Notes panel — the ข้อดี / ข้อเสีย column of the printed sheet, lifted out as
 * live text so it stays readable at any zoom and can be scrolled on a phone.
 * It slides over the plan pane inside the workspace, which keeps the WebGL
 * context and the PDF canvas untouched while it is open.
 */

const workspace = document.getElementById('view-workspace');

let panel = null;
let onClose = null;

export function initNotes(closeHandler) {
  onClose = closeHandler;

  panel = document.createElement('aside');
  panel.className = 'notes';
  panel.id = 'notes';
  panel.hidden = true;
  panel.setAttribute('aria-label', 'ข้อดี ข้อเสีย ของทางเลือกนี้');
  workspace.append(panel);

  panel.addEventListener('click', (e) => {
    if (e.target.closest('[data-act="close-notes"]')) onClose?.();
  });

  addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && !panel.hidden) onClose?.();
  });
}

export function setNotes(item, meeting) {
  if (!panel) return;
  panel.innerHTML = body(item, meeting);
}

export function showNotes(open) {
  if (!panel) return;
  panel.hidden = !open;
  workspace.classList.toggle('has-notes', open);
}

export function notesAvailable(item) {
  return Boolean(item?.axes?.length || item?.areas?.length || item?.verdict);
}

/* ── markup ──────────────────────────────────────────────────────────────── */

function body(item, meeting) {
  return `
    <header class="notes__head">
      <div class="notes__id">
        <span class="mono notes__sheet">${esc(item.sheet)}</span>
        <span class="notes__label">${esc(item.label)}</span>
        ${item.tagline ? `<span class="notes__tagline">${esc(item.tagline)}</span>` : ''}
      </div>
      <button type="button" class="notes__close" data-act="close-notes"
              aria-label="ปิด / Close">×</button>
    </header>
    <div class="notes__body">
      ${item.origin ? `<p class="notes__origin">${esc(item.origin)}</p>` : ''}
      ${areasBlock(item)}
      ${axesBlocks(item, meeting)}
      ${verdictBlock(item)}
    </div>`;
}

export function areasBlock(item) {
  if (!item.areas?.length) return '';
  return `
    <section class="notes__section">
      <h3 class="notes__h">ตัวเลขพื้นที่โดยประมาณ <small>Approximate areas</small></h3>
      <table class="areas">
        <tbody>
          ${item.areas.map((a) => `
            <tr>
              <th scope="row">${esc(a.label)}</th>
              <td class="mono areas__v">${esc(a.value)}</td>
              <td class="areas__u">${esc(a.unit || '')}</td>
            </tr>`).join('')}
        </tbody>
      </table>
      <p class="notes__caveat">ตัวเลขจากการวัดแบบ ยังไม่ได้ยืนยันใน AutoCAD ใช้เปรียบเทียบระหว่างทางเลือกเท่านั้น</p>
    </section>`;
}

export function axesBlocks(item, meeting) {
  if (!item.axes?.length) return '';
  const meta = meeting?.axes ?? [];

  return `
    <section class="notes__section">
      <h3 class="notes__h">ข้อดี / ข้อเสีย <small>เทียบด้วย 4 แกนเดียวกันทุกทางเลือก</small></h3>
      ${item.axes.map((ax) => {
        const m = meta.find((x) => x.n === ax.n) ?? {};
        return `
        <article class="axis">
          <h4 class="axis__h">
            <span class="mono axis__n">${esc(ax.n)}</span>
            <span>${esc(m.title || `แกนที่ ${ax.n}`)}
              ${m.sub ? `<small>${esc(m.sub)}</small>` : ''}</span>
          </h4>
          <ul class="axis__list">
            ${ax.pros.map((t) => `<li class="is-pro"><span aria-hidden="true">+</span>
                <span class="sr-only">ข้อดี</span>${esc(t)}</li>`).join('')}
            ${ax.cons.map((t) => `<li class="is-con"><span aria-hidden="true">−</span>
                <span class="sr-only">ข้อเสีย</span>${esc(t)}</li>`).join('')}
          </ul>
        </article>`;
      }).join('')}
    </section>`;
}

export function verdictBlock(item) {
  if (!item.verdict) return '';
  return `
    <section class="notes__section notes__verdict">
      <h3 class="notes__h">สรุปในมุมของสถาปนิก <small>Architect's read</small></h3>
      <p>${esc(item.verdict)}</p>
    </section>`;
}
