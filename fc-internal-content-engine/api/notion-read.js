// Vercel Serverless Function — api/notion-read.js
// POST: { source: "open_loops" | "sessions" | "content_summary" }
// Reads from Notion databases and returns structured JSON
// Requires NOTION_TOKEN env var in Vercel

const NOTION_API = "https://api.notion.com/v1";

const DATABASES = {
  open_loops: "1eb460ed0646424d8ca7a4c33ceca9fc",
  sessions: "4e5492be5027427cbbc8994bcd73905c",
  content_engine: "bb0cfafd738041c9a3dff705e0d22055",
};

const DOMAIN_PAGES = [
  { name: "Marketing", icon: "📣", id: "31b5aca8ac0f81d3bffdc79932d118c9", prefix: "MKT" },
  { name: "Content", icon: "🎨", id: "31f5aca8ac0f81229933dab1be576bf1", prefix: "CNT" },
  { name: "Sales", icon: "📊", id: "31b5aca8ac0f81638750d27bc0598d19", prefix: "SAL" },
  { name: "Member Mgmt", icon: "📂", id: "31b5aca8ac0f816c9b8ee4e4768270da", prefix: "MEM" },
  { name: "Scheduling", icon: "📱", id: "31c5aca8ac0f81bebc61e9e76deb6a02", prefix: "APP" },
  { name: "Strategy", icon: "📐", id: "31c5aca8ac0f81da85dcc72bf057e3d6", prefix: "STR" },
  { name: "Profiles", icon: "👤", id: "3245aca8ac0f819e8166d52f994a5f7a", prefix: "PRF" },
  { name: "AI Advisor", icon: "🧭", id: "3245aca8ac0f81978b4ef0972967611c", prefix: "AI" },
  { name: "Settings", icon: "⚙️", id: "3315aca8ac0f81749b78f52144f369ba", prefix: "SET" },
  { name: "Staff", icon: "👥", id: "3245aca8ac0f813285bdf0ac55dc6c10", prefix: "STF" },
  { name: "Classes", icon: "🏀", id: "3245aca8ac0f8137a65fd8d24b6c0455", prefix: "CLS" },
  { name: "Infrastructure", icon: "🔧", id: "3245aca8ac0f81b58417d3e0aa56b10d", prefix: "INF" },
];

async function notionFetch(path, method, body) {
  const res = await fetch(`${NOTION_API}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${process.env.NOTION_TOKEN}`,
      "Notion-Version": "2022-06-28",
      "Content-Type": "application/json",
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  return res.json();
}

function extractTitle(page) {
  const titleProp = Object.values(page.properties).find(p => p.type === "title");
  return titleProp?.title?.[0]?.plain_text || "Untitled";
}

function extractSelect(page, name) {
  return page.properties[name]?.select?.name || null;
}

function extractRichText(page, name) {
  return page.properties[name]?.rich_text?.[0]?.plain_text || "";
}

function extractDate(page, name) {
  return page.properties[name]?.date?.start || null;
}

function extractNumber(page, name) {
  return page.properties[name]?.number ?? null;
}

async function fetchOpenLoops() {
  const res = await notionFetch(`/databases/${DATABASES.open_loops}/query`, "POST", {
    filter: { or: [
      { property: "Status", select: { equals: "Open" } },
      { property: "Status", select: { equals: "CRLF" } },
    ]},
    sorts: [{ property: "Priority", direction: "ascending" }],
    page_size: 50,
  });
  return (res.results || []).map(page => ({
    id: page.id,
    title: extractTitle(page),
    status: extractSelect(page, "Status"),
    priority: extractSelect(page, "Priority"),
    description: extractRichText(page, "Description") || extractRichText(page, "Notes"),
    url: page.url,
    created: page.created_time,
  }));
}

async function fetchSessions() {
  const res = await notionFetch(`/databases/${DATABASES.sessions}/query`, "POST", {
    sorts: [{ property: "Created time", direction: "descending" }],
    page_size: 15,
  });
  return (res.results || []).map(page => ({
    id: page.id,
    title: extractTitle(page),
    status: extractSelect(page, "Status"),
    assignedTo: extractSelect(page, "Assigned To"),
    sessionType: extractSelect(page, "Session Type"),
    completedDate: extractDate(page, "Completed Date"),
    url: page.url,
    created: page.created_time,
  }));
}

async function fetchContentSummary() {
  const res = await notionFetch(`/databases/${DATABASES.content_engine}/query`, "POST", {
    page_size: 100,
  });
  const items = res.results || [];
  const themes = items.filter(p => extractSelect(p, "Type") === "Theme").length;
  const creatives = items.filter(p => extractSelect(p, "Type") === "Creative").length;
  const published = items.filter(p => extractSelect(p, "Status") === "Published").length;
  const draft = items.filter(p => extractSelect(p, "Status") === "Draft").length;
  return { themes, creatives, published, draft, total: items.length };
}

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  if (!process.env.NOTION_TOKEN) {
    return res.status(500).json({ error: "NOTION_TOKEN not configured" });
  }

  try {
    const { source } = req.body;

    if (source === "open_loops") {
      return res.status(200).json({ data: await fetchOpenLoops() });
    }
    if (source === "sessions") {
      return res.status(200).json({ data: await fetchSessions() });
    }
    if (source === "content_summary") {
      return res.status(200).json({ data: await fetchContentSummary() });
    }
    if (source === "domains") {
      return res.status(200).json({ data: DOMAIN_PAGES });
    }
    if (source === "all") {
      const [openLoops, sessions, content, domains] = await Promise.all([
        fetchOpenLoops(),
        fetchSessions(),
        fetchContentSummary(),
        Promise.resolve(DOMAIN_PAGES),
      ]);
      return res.status(200).json({ data: { openLoops, sessions, content, domains } });
    }

    return res.status(400).json({ error: "Invalid source. Use: open_loops, sessions, content_summary, domains, all" });
  } catch (err) {
    console.error("Notion read error:", err);
    return res.status(500).json({ error: err.message });
  }
}
