// Local API dev server for the mobile/local verification lane.
//
// `vercel dev` can no longer run this project (it caps at 128 functions and
// api/ has ~350), so this server mimics the parts of Vercel's runtime the
// local lane needs: it loads `.env`, applies the `rewrites` from vercel.json,
// file-routes `/api/*` to the real handler modules, and shims the (req, res)
// surface the handlers use. Run with:
//
//   npx tsx scripts/local-api-dev.mjs        # port 3000, override with PORT
//
// TypeScript handlers load through tsx's loader; JS handlers load as-is.
// NOTE: handler modules are cached by the ESM loader for the life of the
// process - RESTART this server after editing anything under api/ or it will
// keep serving the old code.

import http from "node:http";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { pathToFileURL, fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const port = Number(process.env.PORT || 3000);

loadDotEnv(path.join(root, ".env"));

const vercelConfig = JSON.parse(readFileSync(path.join(root, "vercel.json"), "utf8"));
const rewrites = (vercelConfig.rewrites || []).map((r) => ({
  source: new RegExp(`^${r.source}$`),
  destination: r.destination,
}));

const handlerCache = new Map();

const server = http.createServer(async (req, res) => {
  const started = Date.now();
  try {
    const url = new URL(req.url, `http://127.0.0.1:${port}`);
    let pathname = url.pathname;
    const query = Object.fromEntries(url.searchParams.entries());

    // Vercel semantics: the filesystem wins over rewrites. Only rewrite when
    // no handler file matches the raw path.
    let handler = await resolveHandler(pathname);
    if (!handler) {
      for (const rewrite of rewrites) {
        const match = rewrite.source.exec(pathname);
        if (!match) continue;
        const dest = rewrite.destination.replace(/\$(\d+)/g, (_, i) => match[Number(i)] ?? "");
        const destUrl = new URL(dest, `http://127.0.0.1:${port}`);
        pathname = destUrl.pathname;
        for (const [k, v] of destUrl.searchParams.entries()) query[k] = v;
        break;
      }
      handler = await resolveHandler(pathname);
    }
    if (!handler) {
      res.writeHead(404, { "content-type": "application/json" });
      res.end(JSON.stringify({ error: `no handler for ${pathname}` }));
      return;
    }

    const vreq = await buildRequest(req, query);
    const vres = buildResponse(res);
    await handler(vreq, vres);
  } catch (error) {
    console.error(`[local-api] ${req.method} ${req.url} failed:`, error);
    if (!res.headersSent) res.writeHead(500, { "content-type": "application/json" });
    res.end(JSON.stringify({ error: "local dev server error", detail: String(error?.message || error) }));
  } finally {
    console.log(`[local-api] ${req.method} ${req.url} -> ${res.statusCode} (${Date.now() - started}ms)`);
  }
});

server.listen(port, () => {
  console.log(`[local-api] serving api/ on http://127.0.0.1:${port} (rewrites: ${rewrites.length})`);
});

async function resolveHandler(pathname) {
  if (!pathname.startsWith("/api/")) return null;
  const rel = pathname.slice("/api/".length).replace(/\/+$/, "");
  if (rel.includes("..")) return null;
  if (handlerCache.has(rel)) return handlerCache.get(rel);

  const candidates = [
    path.join(root, "api", `${rel}.ts`),
    path.join(root, "api", `${rel}.js`),
    path.join(root, "api", rel, "index.ts"),
    path.join(root, "api", rel, "index.js"),
  ];
  const file = candidates.find((c) => existsSync(c));
  if (!file) {
    handlerCache.set(rel, null);
    return null;
  }
  const mod = await import(pathToFileURL(file).href);
  const handler = mod.default;
  handlerCache.set(rel, typeof handler === "function" ? handler : null);
  return handlerCache.get(rel);
}

async function buildRequest(req, query) {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  const raw = Buffer.concat(chunks);
  let body;
  const contentType = String(req.headers["content-type"] || "");
  if (raw.length) {
    if (contentType.includes("application/json")) {
      try { body = JSON.parse(raw.toString("utf8")); } catch { body = undefined; }
    } else {
      body = raw.toString("utf8");
    }
  }
  req.query = query;
  req.body = body;
  req.cookies = {};
  return req;
}

function buildResponse(res) {
  res.status = (code) => { res.statusCode = code; return res; };
  res.json = (payload) => {
    if (!res.headersSent) res.setHeader("content-type", "application/json; charset=utf-8");
    res.end(JSON.stringify(payload));
    return res;
  };
  res.send = (payload) => {
    if (typeof payload === "object" && payload !== null && !Buffer.isBuffer(payload)) return res.json(payload);
    res.end(payload);
    return res;
  };
  return res;
}

function loadDotEnv(file) {
  if (!existsSync(file)) return;
  for (const line of readFileSync(file, "utf8").split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq === -1) continue;
    const key = trimmed.slice(0, eq).trim();
    let value = trimmed.slice(eq + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    if (!(key in process.env)) process.env[key] = value;
  }
}
