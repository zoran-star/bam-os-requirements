import { useState, useEffect, useCallback } from "react";

// ── URL-backed view state ─────────────────────────────────────────────────
// Keeps a single query-string param in sync with React state so the current
// view (page, open client, sub-tab) survives a reload and the browser Back/
// Forward buttons. Reads the LIVE URL on every change, so multiple hooks for
// different keys never clobber each other's params.
//
// push=false (the default for sub-tabs) uses replaceState: the URL reflects
// the current sub-tab for reload, but flipping tabs does NOT pile up history
// entries — so Back still walks between *pages*, not every tab click.
// push=true is for page-level navigation where Back SHOULD step back.

function readParam(key, fallback) {
  if (typeof window === "undefined") return fallback;
  const v = new URLSearchParams(window.location.search).get(key);
  return v == null || v === "" ? fallback : v;
}

export function useUrlState(key, fallback, { push = false } = {}) {
  const [value, setValue] = useState(() => readParam(key, fallback));

  // Stay in sync with Back/Forward (and any sibling hook's navigation).
  useEffect(() => {
    const onPop = () => setValue(readParam(key, fallback));
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, [key, fallback]);

  const set = useCallback((next) => {
    setValue(next);
    if (typeof window === "undefined") return;
    const params = new URLSearchParams(window.location.search);
    // Default value → drop the param so default views keep a clean URL.
    if (next == null || next === fallback) params.delete(key);
    else params.set(key, next);
    const qs = params.toString();
    const url = window.location.pathname + (qs ? "?" + qs : "") + window.location.hash;
    if (push) window.history.pushState(null, "", url);
    else window.history.replaceState(null, "", url);
  }, [key, fallback, push]);

  return [value, set];
}
