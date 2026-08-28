import { esc } from './ui-rail.js';

/**
 * Compare view — the printed comparison sheet rebuilt as live text: four axes
 * down the side, one column per option, read across a row to compare like for
 * like. Falls back to a stacked card per option on narrow screens, which the
 * CSS handles; the markup is one table either way so the reading order holds.
 */

export function hasCompare(meeting) {
  return meeting.items.some((it) => it.axes?.length);
}

export function renderCompare(container, meeting) {
  const items = meeting.items;
  const axes = meeting.axes?.length
    ? meeting.axes
    : (items[0]?.axes ?? []).map((a) => ({ n: a.n, title: `แกนที่ ${a.n}`, sub: '' }));

  container.innerHTML = `
    <div class="cmp">
      <header class="cmp__head">
        <h2>เทียบ ${items.length} ทางเลือก ด้วย ${axes.length} แกนเดียวกัน
          <small>Same four questions, asked of every option</small></h2>
        ${meeting.brief ? `<p class="cmp__brief">${esc(meeting.brief)}</p>` : ''}
        <p class="cmp__key mono">+ ข้อดี &nbsp; − ข้อเสียหรือสิ่งที่ต้องแก้ต่อ</p>
      </header>

      <div class="cmp__scroll">
        <table class="cmp__table">
          <thead>
            <tr>
              <th scope="col" class="cmp__axis-col"><span class="sr-only">แกนเปรียบเทียบ</span></th>
              ${items.map((it) => `
                <th scope="col" data-opt="${esc(it.id)}">
                  <a class="cmp__opt" href="#/${esc(meeting.id)}/${esc(it.id)}">
                    <span class="mono cmp__sheet">${esc(it.sheet)}</span>
                    <span class="cmp__label">${esc(it.label)}</span>
                    ${it.tagline ? `<span class="cmp__tagline">${esc(it.tagline)}</span>` : ''}
                    ${it.origin ? `<span class="cmp__origin">${esc(it.origin)}</span>` : ''}
                  </a>
                </th>`).join('')}
            </tr>
          </thead>
          <tbody>
            ${axes.map((ax) => `
              <tr>
                <th scope="row" class="cmp__axis-col">
                  <span class="mono cmp__n">${esc(ax.n)}</span>
                  <span class="cmp__axis-title">${esc(ax.title)}
                    ${ax.sub ? `<small>${esc(ax.sub)}</small>` : ''}</span>
                </th>
                ${items.map((it) => {
                  const a = it.axes?.find((x) => x.n === ax.n);
                  return `<td>${a ? list(a) : '<span class="cmp__none">—</span>'}</td>`;
                }).join('')}
              </tr>`).join('')}
            ${areaRow(items)}
          </tbody>
        </table>
      </div>

      ${verdicts(items, meeting)}
      ${docs(meeting)}
    </div>`;
}

function list(axis) {
  if (!axis.pros.length && !axis.cons.length) return '<span class="cmp__none">—</span>';
  return `
    <ul class="axis__list">
      ${axis.pros.map((t) => `<li class="is-pro"><span aria-hidden="true">+</span>
          <span class="sr-only">ข้อดี</span>${esc(t)}</li>`).join('')}
      ${axis.cons.map((t) => `<li class="is-con"><span aria-hidden="true">−</span>
          <span class="sr-only">ข้อเสีย</span>${esc(t)}</li>`).join('')}
    </ul>`;
}

/**
 * One row of headline figures. Only the numbers that actually differ between
 * options are worth a row here — the pool, its systems and the roof are
 * identical in all three, and the sheet says so in words instead.
 */
function areaRow(items) {
  const labels = items[0]?.areas?.map((a) => a.label) ?? [];
  const varying = labels.filter((label) => {
    const values = items.map((it) => it.areas?.find((a) => a.label === label)?.value);
    return new Set(values).size > 1;
  });
  if (!varying.length) return '';

  return `
    <tr class="cmp__areas">
      <th scope="row" class="cmp__axis-col">
        <span class="mono cmp__n">฿</span>
        <span class="cmp__axis-title">ตัวเลขที่ต่างกัน<small>ส่วนที่เหลือเท่ากันทุกทางเลือก</small></span>
      </th>
      ${items.map((it) => `
        <td>
          <table class="areas">
            <tbody>
              ${varying.map((label) => {
                const a = it.areas.find((x) => x.label === label);
                return `<tr><th scope="row">${esc(label)}</th>
                  <td class="mono areas__v">${esc(a?.value ?? '—')}</td>
                  <td class="areas__u">${esc(a?.unit ?? '')}</td></tr>`;
              }).join('')}
            </tbody>
          </table>
        </td>`).join('')}
    </tr>`;
}

function verdicts(items, meeting) {
  const withVerdict = items.filter((it) => it.verdict);
  if (!withVerdict.length) return '';

  return `
    <section class="cmp__verdicts">
      <h3>สรุปในมุมของสถาปนิก <small>Architect's read</small></h3>
      <dl>
        ${withVerdict.map((it) => `
          <div>
            <dt><a href="#/${esc(meeting.id)}/${esc(it.id)}">${esc(it.label)}</a>
              ${it.tagline ? `<small>${esc(it.tagline)}</small>` : ''}</dt>
            <dd>${esc(it.verdict)}</dd>
          </div>`).join('')}
      </dl>
    </section>`;
}

function docs(meeting) {
  if (!meeting.docs?.length) return '';
  return `
    <section class="cmp__docs">
      <h3>เอกสารประกอบ <small>Sheets from the printed set</small></h3>
      <ul class="docs">
        ${meeting.docs.map((d) => `
          <li>
            <a href="${esc(d.file)}" target="_blank" rel="noopener">
              <span class="docs__label">${esc(d.label)}</span>
              ${d.sub ? `<span class="docs__sub mono">${esc(d.sub)}</span>` : ''}
              <span class="docs__go" aria-hidden="true">↗</span>
            </a>
          </li>`).join('')}
      </ul>
    </section>`;
}
