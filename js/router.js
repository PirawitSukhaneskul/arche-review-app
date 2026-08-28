/**
 * Hash routing — survives GitHub Pages, and every view is a shareable URL.
 *
 *   #/                  → default meeting, option grid
 *   #/m1                → meeting m1, option grid
 *   #/m1/opt-3          → option 3, default view mode
 *   #/m1/opt-3/split    → option 3, explicit mode (plan | model | split)
 *   #/feedback          → feedback form
 */

export const MODES = ['plan', 'model', 'split'];

let listener = null;
let suppress = false;

export function parseHash(hash = location.hash) {
  const parts = hash.replace(/^#\/?/, '').split('/').filter(Boolean);

  if (parts[0] === 'feedback') return { view: 'feedback', meetingId: null };
  if (!parts.length) return { view: 'meeting', meetingId: null };

  const [meetingId, itemId, mode] = parts;
  // Every meeting keeps its own sheet, so an earlier round stays readable.
  if (itemId === 'feedback') return { view: 'feedback', meetingId };
  if (!itemId) return { view: 'meeting', meetingId };

  return {
    view: 'item',
    meetingId,
    itemId,
    mode: MODES.includes(mode) ? mode : null,
  };
}

export function hashFor(route) {
  if (route.view === 'feedback') {
    return route.meetingId ? `#/${route.meetingId}/feedback` : '#/feedback';
  }
  if (route.view === 'item') {
    const tail = route.mode ? `/${route.mode}` : '';
    return `#/${route.meetingId}/${route.itemId}${tail}`;
  }
  return route.meetingId ? `#/${route.meetingId}` : '#/';
}

/**
 * Navigate. `replace` swaps the current history entry instead of pushing —
 * used for view-mode changes so the back button is not flooded with them.
 */
export function go(route, { replace = false } = {}) {
  const next = hashFor(route);
  if (next === location.hash) return;

  if (replace) {
    history.replaceState(null, '', next);
    // replaceState fires no hashchange; drive the app ourselves.
    listener?.(parseHash(next));
  } else {
    location.hash = next;
  }
}

/**
 * Rewrite the URL without telling the app — for canonicalising a bare
 * `#/m1/opt-3` into `#/m1/opt-3/split` once the default mode is resolved.
 */
export function silentReplace(route) {
  const next = hashFor(route);
  if (next === location.hash) return;
  suppress = true;
  history.replaceState(null, '', next);
  suppress = false;
}

export function initRouter(onRoute) {
  listener = onRoute;
  addEventListener('hashchange', () => {
    if (suppress) return;
    listener(parseHash());
  });
  listener(parseHash());
}
