import { withSentryApiRoute } from "../_sentry.js";
// ─────────────────────────────────────────────────────────────────────────
// api/resources/convert.js — turn a legacy PDF resource into content blocks
// ─────────────────────────────────────────────────────────────────────────
// Reads a resource's PDF attachment, has Claude structure it into the same
// content-block shape the client renderer + staff editor use, and saves it to
// resources.content_blocks. PDFs then render as a branded interactive page
// (the PDF stays as a downloadable attachment).
//
//   GET  ?action=eligible          → { count } of legacy resources convertible
//   POST ?action=convert           → { resourceId }  convert one (returns blocks)
//   POST ?action=convert-all       → convert every eligible resource (capped per
//                                     call; returns { converted, remaining })
//
// Admin-gated (service-role bypasses RLS → gate in code). See engineering guide §3.
// ─────────────────────────────────────────────────────────────────────────

import { ADMIN_LIKE_ROLES, hasRole } from "../_roles.js";

export const maxDuration = 300; // PDFs + Claude can take a while; allow headroom

const SUPABASE_URL = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL;
const SUPABASE_SERVICE_KEY =
  process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY;
const ANTHROPIC_KEY = process.env.ANTHROPIC_API_KEY;
const ANTHROPIC_MODEL = "claude-sonnet-4-6";
const STORAGE_BUCKET = "resources";
const MAX_PDF_BYTES = 24 * 1024 * 1024; // Claude PDF ceiling is ~32MB; stay under
const BATCH_CAP = 6;                     // convert-all: max resources per invocation

async function sb(path, init = {}) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    ...init,
    headers: {
      apikey: SUPABASE_SERVICE_KEY,
      Authorization: `Bearer ${SUPABASE_SERVICE_KEY}`,
      "Content-Type": "application/json",
      ...(init.headers || {}),
    },
  });
  if (!res.ok) throw new Error(`Supabase ${res.status}: ${await res.text()}`);
  const txt = await res.text();
  return txt ? JSON.parse(txt) : null;
}

async function resolveStaff(req) {
  const auth = req.headers.authorization || "";
  const token = auth.startsWith("Bearer ") ? auth.slice(7) : null;
  if (!token) return { error: { status: 401, message: "auth required" } };
  const userRes = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
    headers: { apikey: SUPABASE_SERVICE_KEY, Authorization: `Bearer ${token}` },
  });
  if (!userRes.ok) return { error: { status: 401, message: "invalid token" } };
  const user = await userRes.json();
  if (!user?.id) return { error: { status: 401, message: "invalid token" } };
  let rows = await sb(`staff?user_id=eq.${user.id}&select=role`);
  if ((!rows || !rows[0]) && user.email) {
    rows = await sb(`staff?email=eq.${encodeURIComponent(user.email)}&select=role`);
  }
  return { role: rows?.[0]?.role || null };
}

function publicUrl(storagePath) {
  return `${SUPABASE_URL}/storage/v1/object/public/${STORAGE_BUCKET}/${storagePath}`;
}

// ── Claude: PDF → content blocks (forced tool use for clean JSON) ──────────
const EMIT_TOOL = {
  name: "emit_blocks",
  description: "Emit the resource as an ordered array of content blocks.",
  input_schema: {
    type: "object",
    properties: {
      blocks: {
        type: "array",
        description: "Ordered content blocks faithfully representing the document.",
        items: {
          type: "object",
          properties: {
            type: { type: "string", enum: ["heading", "text", "callout", "checklist", "accordion", "divider"] },
            text: { type: "string", description: "For heading/text/callout/accordion. Markdown-lite: **bold**, *italic*, [label](url), lines starting with '- ' become bullets." },
            variant: { type: "string", enum: ["tip", "warn", "info"], description: "callout only" },
            title: { type: "string", description: "checklist or accordion title" },
            items: { type: "array", items: { type: "string" }, description: "checklist items" },
          },
          required: ["type"],
        },
      },
    },
    required: ["blocks"],
  },
};

const SYSTEM_PROMPT =
  "You convert a PDF resource for sports-academy owners into an interactive, on-brand page. " +
  "Read the document and emit an ordered array of content blocks that faithfully represents it — " +
  "do NOT invent content. Guidelines: use `heading` for section titles; `text` for prose " +
  "(markdown-lite: **bold**, *italic*, [label](url), and lines starting with '- ' become bullets); " +
  "`callout` (variant tip/warn/info) for important notes/warnings; `checklist` (title + items) for any " +
  "step-by-step lists, requirements, or 'before you start' lists; `accordion` (title + text) for long " +
  "optional detail that's better collapsed; `divider` between major sections. Prefer checklists for " +
  "procedural steps. Keep it tight and scannable. Emit via the emit_blocks tool.";

// Clean + clamp the model output to valid blocks our renderer understands.
function sanitizeBlocks(raw) {
  if (!Array.isArray(raw)) return [];
  const ok = new Set(["heading", "text", "callout", "checklist", "accordion", "divider"]);
  return raw
    .filter((b) => b && ok.has(b.type))
    .map((b) => {
      if (b.type === "divider") return { type: "divider" };
      if (b.type === "callout") {
        const v = ["tip", "warn", "info"].includes(b.variant) ? b.variant : "info";
        return { type: "callout", variant: v, text: String(b.text || "") };
      }
      if (b.type === "checklist") {
        const items = Array.isArray(b.items) ? b.items.map((s) => String(s)).filter(Boolean) : [];
        return { type: "checklist", title: String(b.title || ""), items };
      }
      if (b.type === "accordion") {
        return { type: "accordion", title: String(b.title || "Details"), text: String(b.text || "") };
      }
      return { type: b.type, text: String(b.text || "") }; // heading, text
    })
    .filter((b) => b.type === "divider" || b.text || (b.items && b.items.length) || b.title);
}

async function pdfToBlocks(pdfBase64) {
  const body = {
    model: ANTHROPIC_MODEL,
    max_tokens: 4096,
    system: SYSTEM_PROMPT,
    tools: [EMIT_TOOL],
    tool_choice: { type: "tool", name: "emit_blocks" },
    messages: [
      {
        role: "user",
        content: [
          { type: "document", source: { type: "base64", media_type: "application/pdf", data: pdfBase64 } },
          { type: "text", text: "Convert this resource into content blocks via emit_blocks." },
        ],
      },
    ],
  };
  const r = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "x-api-key": ANTHROPIC_KEY,
      "anthropic-version": "2023-06-01",
      "content-type": "application/json",
    },
    body: JSON.stringify(body),
  });
  if (!r.ok) throw new Error(`Claude ${r.status}: ${(await r.text()).slice(0, 500)}`);
  const data = await r.json();
  const tool = (data.content || []).find((b) => b.type === "tool_use" && b.name === "emit_blocks");
  return sanitizeBlocks(tool?.input?.blocks);
}

// Convert one resource row (must include resource_files). Returns blocks or throws.
async function convertResource(resource) {
  const files = resource.resource_files || [];
  const pdf = files.find((f) => (f.mime_type || "").includes("pdf"));
  if (!pdf) throw new Error("no PDF attachment");
  const res = await fetch(publicUrl(pdf.storage_path));
  if (!res.ok) throw new Error(`fetch PDF ${res.status}`);
  const buf = Buffer.from(await res.arrayBuffer());
  if (buf.length > MAX_PDF_BYTES) throw new Error("PDF too large to convert");
  const blocks = await pdfToBlocks(buf.toString("base64"));
  if (!blocks.length) throw new Error("Claude returned no blocks");
  await sb(`resources?id=eq.${resource.id}`, {
    method: "PATCH",
    headers: { Prefer: "return=minimal" },
    body: JSON.stringify({ content_blocks: blocks }),
  });
  return blocks;
}

// Resources that are still legacy: empty content_blocks AND a PDF attachment.
async function eligibleResources() {
  const rows = await sb(
    `resources?select=id,title,content_blocks,resource_files(mime_type,storage_path)`
  );
  return (rows || []).filter(
    (r) =>
      (!Array.isArray(r.content_blocks) || r.content_blocks.length === 0) &&
      (r.resource_files || []).some((f) => (f.mime_type || "").includes("pdf"))
  );
}

async function handler(req, res) {
  const action = req.query?.action;
  try {
    const { role, error } = await resolveStaff(req);
    if (error) return res.status(error.status).json({ error: error.message });
    if (!hasRole(role, ADMIN_LIKE_ROLES)) return res.status(403).json({ error: "admin only" });
    if (!ANTHROPIC_KEY) return res.status(503).json({ error: "ANTHROPIC_API_KEY not configured" });

    if (req.method === "GET" && action === "eligible") {
      const list = await eligibleResources();
      return res.status(200).json({ count: list.length });
    }

    if (req.method === "POST" && action === "convert") {
      const { resourceId } = req.body || {};
      if (!resourceId) return res.status(400).json({ error: "resourceId required" });
      const rows = await sb(
        `resources?id=eq.${resourceId}&select=id,title,content_blocks,resource_files(mime_type,storage_path)`
      );
      if (!rows?.[0]) return res.status(404).json({ error: "resource not found" });
      const blocks = await convertResource(rows[0]);
      return res.status(200).json({ ok: true, blocks });
    }

    if (req.method === "POST" && action === "convert-all") {
      const list = await eligibleResources();
      const batch = list.slice(0, BATCH_CAP);
      const results = [];
      for (const r of batch) {
        try {
          const blocks = await convertResource(r);
          results.push({ id: r.id, title: r.title, ok: true, blocks: blocks.length });
        } catch (e) {
          results.push({ id: r.id, title: r.title, ok: false, error: e.message });
        }
      }
      return res.status(200).json({
        converted: results.filter((x) => x.ok).length,
        failed: results.filter((x) => !x.ok),
        remaining: Math.max(0, list.length - batch.length),
        results,
      });
    }

    return res.status(400).json({ error: "unknown action" });
  } catch (e) {
    console.error("resources/convert error:", e?.message || e);
    return res.status(500).json({ error: e.message });
  }
}

export default withSentryApiRoute(handler);
