// Auto-captured context for the staff-portal feedback widget (mirrors the
// client-portal.html recorder). Ring buffers of clicks/errors/nav changes so
// a "Bug" report never needs the staff member to explain where they were.
// Typed input values are NEVER recorded (only placeholders/ids).

const started = Date.now();
const state = { clicks: [], views: [], errors: [] };

function nowSec() {
  return Math.round((Date.now() - started) / 1000);
}

function currentPage() {
  try {
    const sp = new URLSearchParams(window.location.search);
    return sp.get("p") || sp.get("nav") || "inbox";
  } catch {
    return null;
  }
}

function elLabel(target) {
  const el =
    target.closest?.('button, a, [onclick], [role="button"], input, select, textarea, label') ||
    target;
  const tag = (el.tagName || "").toLowerCase();
  let label = "";
  if (tag === "input" || tag === "select" || tag === "textarea") {
    label = el.placeholder || el.name || el.id || tag; // never the typed value
  } else {
    label = (el.getAttribute?.("aria-label") || el.textContent || "").trim().replace(/\s+/g, " ").slice(0, 60);
  }
  const id = el.id ? ` #${el.id}` : "";
  return `${label || tag}${id}`.trim().slice(0, 80);
}

function recordNav() {
  const page = currentPage();
  const last = state.views[state.views.length - 1];
  if (page && (!last || last.page !== page)) {
    state.views.push({ t: nowSec(), page });
    if (state.views.length > 15) state.views.shift();
  }
}

// Idempotent setup — guard against duplicate listeners across HMR/remounts.
export function initFeedbackContext() {
  if (typeof window === "undefined" || window.__fbCtxInit) return;
  window.__fbCtxInit = true;

  document.addEventListener(
    "click",
    (e) => {
      try {
        if (!e.target || e.target.closest?.('[data-feedback-widget]')) return;
        state.clicks.push({ t: nowSec(), page: currentPage(), el: elLabel(e.target) });
        if (state.clicks.length > 30) state.clicks.shift();
      } catch {
        /* never let recording break the click */
      }
    },
    true
  );

  window.addEventListener("error", (e) => {
    try {
      state.errors.push({ t: nowSec(), msg: String(e.message || e.error || "error").slice(0, 200) });
      if (state.errors.length > 10) state.errors.shift();
    } catch {
      /* ignore */
    }
  });
  window.addEventListener("unhandledrejection", (e) => {
    try {
      state.errors.push({ t: nowSec(), msg: ("promise: " + String(e.reason?.message || e.reason || "")).slice(0, 200) });
      if (state.errors.length > 10) state.errors.shift();
    } catch {
      /* ignore */
    }
  });

  // App.jsx drives nav via history.pushState/replaceState (no react-router),
  // so wrap both once to catch every page change, not just Back/Forward.
  ["pushState", "replaceState"].forEach((fn) => {
    const orig = window.history[fn];
    window.history[fn] = function (...args) {
      const ret = orig.apply(this, args);
      try {
        recordNav();
      } catch {
        /* ignore */
      }
      return ret;
    };
  });
  window.addEventListener("popstate", recordNav);
  recordNav();
}

export function buildFeedbackContext(session) {
  return {
    v: 1,
    view: currentPage(),
    view_trail: state.views.slice(-15),
    clicks: state.clicks.slice(-30),
    errors: state.errors.slice(-10),
    url: window.location.href,
    viewport: { w: window.innerWidth, h: window.innerHeight },
    ua: (navigator.userAgent || "").slice(0, 200),
    online: navigator.onLine,
    staff_email: session?.user?.email || null,
    seconds_on_page: nowSec(),
    submitted_at: new Date().toISOString(),
  };
}
