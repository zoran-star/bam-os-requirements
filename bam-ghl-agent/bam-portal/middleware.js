// Vercel Edge middleware: when a request hits portal.byanymeansbusiness.com
// at the root, transparently serve the client portal HTML without changing
// the URL bar. Lets users share / bookmark the clean
// https://portal.byanymeansbusiness.com URL.
//
// Vercel's `rewrites` block in vercel.json doesn't fire for `/` because
// filesystem-first routing serves index.html (the staff React app) before
// rewrites are evaluated. Edge middleware runs BEFORE filesystem, so we
// can rewrite the served file without touching the URL the user sees.
//
// Matcher is scoped to root + index.html only — every other path
// (assets, /api/*, /client-portal.html itself, ticket detail pages, etc.)
// falls straight through to normal Vercel handling.

export const config = {
  matcher: ["/", "/index.html"],
};

export default function middleware(request) {
  const host = (request.headers.get("host") || "").toLowerCase();
  if (host !== "portal.byanymeansbusiness.com") return;
  const url = new URL(request.url);
  url.pathname = "/client-portal.html";
  return Response.rewrite ? Response.rewrite(url) : new Response(null, {
    status: 200,
    headers: { "x-middleware-rewrite": url.toString() },
  });
}
