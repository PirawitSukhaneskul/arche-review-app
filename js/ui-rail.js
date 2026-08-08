import { CONFIG } from './config.js';
import { hashFor } from './router.js';

/**
 * Left rail: meetings at the top level, the active meeting expanded to show
 * its options. Pending meetings render dimmed and are not focusable.
 */

const railNav = document.getElementById('rail-nav');
const rail = document.getElementById('rail');
const scrim = document.getElementById('rail-scrim');
const toggle = document.getElementById('rail-toggle');

export function renderRail(data, route) {
  const activeMeeting = route.meetingId;
  const activeItem = route.view === 'item' ? route.itemId : null;

  railNav.replaceChildren(...data.meetings.map((m) => {
    const group = document.createElement('div');
    group.className = 'meeting';
    group.dataset.status = m.status;

    const isOpen = m.id === activeMeeting && m.status === 'ready';
    if (isOpen) group.classList.add('is-open');

    const head = document.createElement(m.status === 'ready' ? 'a' : 'div');
    head.className = 'meeting__head';
    if (m.status === 'ready') {
      head.href = hashFor({ view: 'meeting', meetingId: m.id });
      if (m.id === activeMeeting) head.setAttribute('aria-current', 'true');
    } else {
      head.setAttribute('aria-disabled', 'true');
    }

    head.innerHTML = `
      <span class="mono meeting__no">M${m.no}</span>
      <span class="meeting__text">
        <span class="meeting__title">${esc(m.title)}</span>
        ${m.titleTh ? `<small>${esc(m.titleTh)}</small>` : ''}
      </span>
      ${m.status === 'pending' ? '<span class="tag mono">SOON</span>' : ''}
    `;
    group.append(head);

    if (isOpen && m.items.length) {
      const ul = document.createElement('ul');
      ul.className = 'options';
      for (const it of m.items) {
        const li = document.createElement('li');
        const a = document.createElement('a');
        a.className = 'option';
        a.href = hashFor({ view: 'item', meetingId: m.id, itemId: it.id, mode: route.mode });
        if (it.id === activeItem) {
          a.classList.add('is-active');
          a.setAttribute('aria-current', 'true');
        }
        a.innerHTML = `<span class="mono option__sheet">${esc(it.sheet)}</span>
                       <span class="option__label">${esc(it.label)}</span>`;
        li.append(a);
        ul.append(li);
      }
      group.append(ul);
    }

    return group;
  }));

  document.getElementById('rail-feedback')
    .classList.toggle('is-active', route.view === 'feedback');
}

/* ── drawer behaviour under the drawer breakpoint ────────────────────────── */

export function initRail() {
  toggle.addEventListener('click', () => setDrawer(!isOpen()));
  scrim.addEventListener('click', () => setDrawer(false));

  addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && isOpen()) {
      setDrawer(false);
      toggle.focus();
    }
  });

  // Following a rail link on a phone should close the drawer behind you.
  rail.addEventListener('click', (e) => {
    if (e.target.closest('a') && innerWidth < CONFIG.BP_DRAWER) setDrawer(false);
  });

  addEventListener('resize', () => {
    if (innerWidth >= CONFIG.BP_DRAWER && isOpen()) setDrawer(false);
  });
}

function isOpen() {
  return document.body.classList.contains('rail-open');
}

function setDrawer(open) {
  document.body.classList.toggle('rail-open', open);
  toggle.setAttribute('aria-expanded', String(open));
  scrim.hidden = !open;
}

function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
  ));
}

export { esc };
