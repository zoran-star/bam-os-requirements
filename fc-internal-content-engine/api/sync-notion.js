// Vercel Serverless Function — api/sync-notion.js
// POST: { action, type, data }
// Syncs content engine data to Notion database
// Requires NOTION_TOKEN env var in Vercel

const NOTION_DB_ID = "bb0cfafd738041c9a3dff705e0d22055";
const NOTION_API = "https://api.notion.com/v1";

const PHASE_MAP = { 0: "Pre-Launch", 1: "Launch", 2: "Post-Launch" };
const MODE_MAP = { paid: "Paid", organic: "Organic", both: "Both" };
const STATUS_MAP = { draft: "Draft", approved: "Approved", recorded: "Recorded", published: "Published" };

const STYLE_MAP = {
  talking_head: "Talking Head", ugc: "UGC", screen_record: "Screen Recording",
  quick_graphics: "Quick Graphics", funny_jarvis: "Funny Vibes",
};

async function notionFetch(path, method, body) {
  const res = await fetch(`${NOTION_API}${path}`, {
    method,
    headers: {
      "Authorization": `Bearer ${process.env.NOTION_TOKEN}`,
      "Notion-Version": "2022-06-28",
      "Content-Type": "application/json",
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  return res.json();
}

// Find a Notion page by Supabase ID
async function findBySupabaseId(supabaseId) {
  const res = await notionFetch(`/databases/${NOTION_DB_ID}/query`, "POST", {
    filter: { property: "Supabase ID", rich_text: { equals: supabaseId } },
    page_size: 1,
  });
  return res.results?.[0] || null;
}

// Build Notion properties from theme data
function themeToProperties(theme) {
  const props = {
    "Name": { title: [{ text: { content: theme.title || "" } }] },
    "Type": { select: { name: "Theme" } },
    "Description": { rich_text: [{ text: { content: (theme.description || "").slice(0, 2000) } }] },
    "Creator": { select: { name: theme.creator || "Coleman" } },
    "Mode": { select: { name: MODE_MAP[theme.mode] || "Paid" } },
    "Phase": { select: { name: PHASE_MAP[theme.phase] || "Pre-Launch" } },
    "Supabase ID": { rich_text: [{ text: { content: theme.id || "" } }] },
    "Last Synced": { date: { start: new Date().toISOString() } },
  };
  if (theme.category) props["Category"] = { select: { name: theme.category } };
  if (theme.tags) props["Tags"] = { rich_text: [{ text: { content: theme.tags } }] };
  if (theme.notes) props["Description"] = { rich_text: [{ text: { content: `${theme.description || ""}\n\nNotes: ${theme.notes}`.trim().slice(0, 2000) } }] };
  return props;
}

// Build Notion properties from creative data
function creativeToProperties(creative, parentThemeName) {
  const props = {
    "Name": { title: [{ text: { content: creative.title || "" } }] },
    "Type": { select: { name: "Creative" } },
    "Description": { rich_text: [{ text: { content: (creative.notes || "").slice(0, 2000) } }] },
    "Creator": { select: { name: creative.creator || "Coleman" } },
    "Mode": { select: { name: MODE_MAP[creative.mode] || "Paid" } },
    "Phase": { select: { name: PHASE_MAP[creative.phase] || "Pre-Launch" } },
    "Supabase ID": { rich_text: [{ text: { content: creative.id || "" } }] },
    "Last Synced": { date: { start: new Date().toISOString() } },
  };
  if (creative.hook) props["Hook"] = { rich_text: [{ text: { content: creative.hook } }] };
  if (creative.cta) props["CTA"] = { rich_text: [{ text: { content: creative.cta } }] };
  if (creative.video_style) props["Video Style"] = { select: { name: STYLE_MAP[creative.video_style] || creative.video_style } };
  if (creative.psych_lever) props["Psych Lever"] = { select: { name: creative.psych_lever } };
  if (creative.status) props["Status"] = { select: { name: STATUS_MAP[creative.status] || "Draft" } };
  if (parentThemeName) props["Parent Theme"] = { rich_text: [{ text: { content: parentThemeName } }] };
  return props;
}

export default async function handler(req, res) {
  // CORS
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  if (!process.env.NOTION_TOKEN) {
    return res.status(500).json({ error: "NOTION_TOKEN not configured" });
  }

  try {
    const { action, type, data, parentThemeName } = req.body;

    // action: "upsert" | "delete"
    // type: "theme" | "creative"
    // data: the theme or creative object (must include `id` as Supabase ID)

    if (action === "delete" && data?.id) {
      const existing = await findBySupabaseId(data.id);
      if (existing) {
        await notionFetch(`/pages/${existing.id}`, "PATCH", { archived: true });
      }
      return res.status(200).json({ ok: true, action: "deleted" });
    }

    if (action === "upsert" && data?.id) {
      const existing = await findBySupabaseId(data.id);
      const props = type === "theme" ? themeToProperties(data) : creativeToProperties(data, parentThemeName);

      if (existing) {
        // Update
        await notionFetch(`/pages/${existing.id}`, "PATCH", { properties: props });
        return res.status(200).json({ ok: true, action: "updated", notionId: existing.id });
      } else {
        // Create
        const created = await notionFetch("/pages", "POST", {
          parent: { database_id: NOTION_DB_ID },
          properties: props,
        });
        return res.status(200).json({ ok: true, action: "created", notionId: created.id });
      }
    }

    // Bulk sync — sync all themes and creatives at once
    if (action === "bulk_sync" && Array.isArray(data)) {
      const results = [];
      for (const item of data) {
        const existing = await findBySupabaseId(item.id);
        const props = item._type === "theme" ? themeToProperties(item) : creativeToProperties(item, item._parentThemeName);
        if (existing) {
          await notionFetch(`/pages/${existing.id}`, "PATCH", { properties: props });
          results.push({ id: item.id, action: "updated" });
        } else {
          const created = await notionFetch("/pages", "POST", {
            parent: { database_id: NOTION_DB_ID },
            properties: props,
          });
          results.push({ id: item.id, action: "created", notionId: created.id });
        }
      }
      return res.status(200).json({ ok: true, results });
    }

    return res.status(400).json({ error: "Invalid action. Use 'upsert', 'delete', or 'bulk_sync'" });
  } catch (err) {
    console.error("Notion sync error:", err);
    return res.status(500).json({ error: err.message });
  }
}
