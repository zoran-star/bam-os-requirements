// Vercel Serverless Function — Unified Notion Query Endpoint
// POST: accepts { type, clientName?, pageId?, category? }

const NOTION_API = "https://api.notion.com/v1";
const ACTION_ITEMS_DB = "e2db093d65f645aa9b6810c4720a7524";
const CLIENT_PROFILES_PAGE = "3295aca8ac0f81f09b88c60e84173738";

const SOP_PAGES = {
  sales: { id: "2fc5aca8ac0f8088a91cd3a0f70a3676", label: "Sales" },
  cultural: { id: "2f35aca8ac0f80a7aec2d0984e978b62", label: "Cultural Standards" },
  communication: { id: "2f35aca8ac0f80fca792e70cdebd3f49", label: "General Communication" },
  decisions: { id: "2f35aca8ac0f80d882cbed08d7490b0b", label: "Decision Making" },
  internal: { id: "2f65aca8ac0f8083a97bdc3938ed5f32", label: "Internal SOPs" },
  sm: { id: "2f65aca8ac0f80ea87abcd3f170999ee", label: "SM SOPs" },
  general: { id: "30f5aca8ac0f805c983dcfc3d6072ce5", label: "General SOPs" },
  coachiq: { id: "2f65aca8ac0f80598f80cb7feea7e5b8", label: "CoachIQ SOPs" },
  access: { id: "2fe5aca8ac0f80ca9cfbe8a40285a897", label: "Access SOPs" },
  products: { id: "3105aca8ac0f8095934bc7429db67d19", label: "Products" },
};

const WAREHOUSE_DBS = {
  content: "2f35aca8ac0f80439bc7e4afe436338c",
  internal: "2f35aca8ac0f806db4e6fdcfc1ecb0ff",
  academy_strategy: "2f35aca8ac0f80938912d92ce8d36e93",
  digital_marketing: "2f35aca8ac0f80ed8160d36931028178",
  systems: "2f35aca8ac0f80aba224ddb102c96ba2",
};

const WAREHOUSE_PAGES = {
  legal: "2f95aca8ac0f80e1a7b8ef32b47644f0",
  team: "30b5aca8ac0f808b918ac767d3ec748d",
};

async function notionFetch(path, options = {}) {
  const res = await fetch(`${NOTION_API}${path}`, {
    ...options,
    headers: {
      "Authorization": `Bearer ${process.env.NOTION_API_KEY}`,
      "Notion-Version": "2022-06-28",
      "Content-Type": "application/json",
      ...options.headers,
    },
  });
  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Notion API ${res.status}: ${err}`);
  }
  return res.json();
}

// ─── Helpers ────────────────────────────────────────────────────────────────

function richTextToPlain(richTexts) {
  return richTexts?.map(t => t.plain_text || "").join("") || "";
}

function blocksToMarkdown(blocks) {
  return blocks.map(block => {
    const text = (richTexts) => richTexts?.map(t => {
      let s = t.plain_text || "";
      if (t.annotations?.bold) s = `**${s}**`;
      if (t.annotations?.code) s = `\`${s}\``;
      return s;
    }).join("") || "";

    switch (block.type) {
      case "heading_1": return `## ${text(block.heading_1.rich_text)}`;
      case "heading_2": return `## ${text(block.heading_2.rich_text)}`;
      case "heading_3": return `### ${text(block.heading_3.rich_text)}`;
      case "paragraph": return text(block.paragraph.rich_text);
      case "bulleted_list_item": return `- ${text(block.bulleted_list_item.rich_text)}`;
      case "numbered_list_item": return `1. ${text(block.numbered_list_item.rich_text)}`;
      case "toggle": return `**${text(block.toggle.rich_text)}**`;
      case "divider": return "---";
      case "callout": return `> ${text(block.callout.rich_text)}`;
      case "quote": return `> ${text(block.quote.rich_text)}`;
      default: return "";
    }
  }).filter(Boolean).join("\n");
}

function mapNotionToActionItem(page) {
  const p = page.properties;
  return {
    id: page.id,
    action: p["Action"]?.title?.[0]?.plain_text || "",
    client: p["Client"]?.select?.name || "",
    status: p["Status"]?.select?.name || "Open",
    urgency: p["Urgency"]?.select?.name || "Standard",
    owner: p["Owner"]?.select?.name || "SM",
    category: p["Category"]?.select?.name || "General",
    callDate: p["Call Date"]?.date?.start || null,
    reminderDate: p["Reminder Date"]?.date?.start || null,
    sourceCall: p["Source Call"]?.rich_text?.[0]?.plain_text || "",
    notes: p["Notes"]?.rich_text?.[0]?.plain_text || "",
  };
}

// ─── Query: SOPs (tree + content) ───────────────────────────────────────────

async function querySOPTree() {
  const tree = [];

  // Fetch children of all SOP pages in parallel
  const entries = Object.entries(SOP_PAGES);
  const results = await Promise.all(
    entries.map(([key, { id }]) =>
      notionFetch(`/blocks/${id}/children?page_size=100`)
        .then(res => ({ key, res }))
        .catch(() => ({ key, res: { results: [] } }))
    )
  );

  for (const { key, res } of results) {
    const { id, label } = SOP_PAGES[key];
    const childPages = res.results.filter(b => b.type === "child_page");

    tree.push({
      id: key,
      label,
      pageId: id,
      children: childPages.map(cp => ({
        id: cp.id,
        title: cp.child_page?.title || "Untitled",
        pageId: cp.id,
        lastUpdated: cp.last_edited_time?.slice(0, 10) || "",
      })),
    });
  }

  return tree;
}

async function querySOPContent(pageId) {
  const [page, contentBlocks] = await Promise.all([
    notionFetch(`/pages/${pageId}`),
    notionFetch(`/blocks/${pageId}/children?page_size=100`),
  ]);

  // Also fetch children of any toggle/table blocks
  const expandable = contentBlocks.results.filter(b => b.has_children && b.type !== "child_page" && b.type !== "child_database");
  let expandedContent = "";
  if (expandable.length > 0) {
    const expanded = await Promise.all(
      expandable.map(b => notionFetch(`/blocks/${b.id}/children?page_size=100`).catch(() => ({ results: [] })))
    );
    expandedContent = expanded.map(e => blocksToMarkdown(e.results)).join("\n");
  }

  const title = page.properties?.title?.title?.[0]?.plain_text || "Untitled";
  const mainContent = blocksToMarkdown(contentBlocks.results);

  return {
    id: pageId,
    title,
    pageId,
    content: mainContent + (expandedContent ? "\n" + expandedContent : ""),
    lastEdited: page.last_edited_time,
    lastUpdated: page.last_edited_time?.slice(0, 10) || "",
  };
}

// Legacy: flat SOP list (backwards compat)
async function querySOPs() {
  const allSops = [];
  for (const [category, { id }] of Object.entries(SOP_PAGES)) {
    const blocks = await notionFetch(`/blocks/${id}/children?page_size=100`).catch(() => ({ results: [] }));
    const childPages = blocks.results.filter(b => b.type === "child_page");
    for (const cp of childPages) {
      const contentBlocks = await notionFetch(`/blocks/${cp.id}/children?page_size=100`).catch(() => ({ results: [] }));
      allSops.push({
        id: cp.id,
        title: cp.child_page?.title || "Untitled",
        category,
        notionPageId: cp.id,
        lastUpdated: cp.last_edited_time?.slice(0, 10) || "",
        content: blocksToMarkdown(contentBlocks.results),
      });
    }
  }
  return allSops;
}

// ─── Query: Action Items ────────────────────────────────────────────────────

async function queryActionItems() {
  const result = await notionFetch(`/databases/${ACTION_ITEMS_DB}/query`, {
    method: "POST",
    body: JSON.stringify({
      page_size: 100,
      sorts: [{ property: "Reminder Date", direction: "ascending" }],
    }),
  });
  return result.results.map(mapNotionToActionItem);
}

// ─── Query: All Clients ─────────────────────────────────────────────────────

async function parseClientInfoTable(pageId) {
  const blocks = await notionFetch(`/blocks/${pageId}/children?page_size=100`);

  // Find table blocks and extract Client Info
  const info = {};
  let latestUpdate = "";
  let callLog = [];
  let currentSection = "";

  for (const block of blocks.results) {
    // Track section headings
    if (block.type === "heading_2") {
      currentSection = richTextToPlain(block.heading_2.rich_text);
    }

    // Parse table blocks (Client Info table)
    if (block.type === "table" && block.has_children) {
      const rows = await notionFetch(`/blocks/${block.id}/children?page_size=100`);
      for (const row of rows.results) {
        if (row.type !== "table_row") continue;
        const cells = row.table_row.cells || [];
        if (cells.length >= 2) {
          const field = richTextToPlain(cells[0]).replace(/\*\*/g, "").trim();
          const value = richTextToPlain(cells[1]).trim();
          if (field && field !== "Field") {
            info[field] = value;
          }
        }
      }
    }

    // Collect call log entries
    if (block.type === "child_page" && currentSection.toLowerCase().includes("call")) {
      callLog.push({
        id: block.id,
        title: block.child_page?.title || "Untitled",
      });
    }

    // Collect latest update paragraphs
    if (currentSection.toLowerCase().includes("latest update") && block.type === "paragraph") {
      const text = richTextToPlain(block.paragraph.rich_text);
      if (text) latestUpdate += (latestUpdate ? "\n" : "") + text;
    }
  }

  return { info, latestUpdate, callLog };
}

async function queryAllClients() {
  const blocks = await notionFetch(`/blocks/${CLIENT_PROFILES_PAGE}/children?page_size=100`);
  const childPages = blocks.results.filter(b =>
    b.type === "child_page" &&
    !(b.child_page?.title || "").includes("BAM Locations") &&
    !(b.child_page?.title || "").includes("Fathom")
  );

  // Fetch all client pages in parallel
  const clients = await Promise.all(
    childPages.map(async (cp) => {
      try {
        const { info, latestUpdate, callLog } = await parseClientInfoTable(cp.id);
        const statusRaw = info["Profile Status"] || "";
        const isOnboarding = statusRaw.includes("Onboarding");
        const isActive = statusRaw.includes("Active");

        return {
          id: cp.id,
          pageId: cp.id,
          title: cp.child_page?.title || "Untitled",
          clientName: info["Client Name"] || "",
          businessName: info["Business Name"] || "",
          manager: info["Scaling Manager"] || "",
          program: info["Program"] || "",
          email: info["Email"] || "",
          instagram: info["Instagram"] || "",
          recurringMeeting: info["Recurring Meeting"] || "",
          profileStatus: isOnboarding ? "onboarding" : isActive ? "active" : "unknown",
          activeClients: info["Active Clients"] || "",
          monthlyRevenue: info["Monthly Revenue"] || "",
          startDate: info["Start Date"] || "",
          renewalDate: info["Renewal Date"] || "",
          latestUpdate,
          callLog,
          lastEdited: cp.last_edited_time || "",
        };
      } catch {
        return {
          id: cp.id,
          pageId: cp.id,
          title: cp.child_page?.title || "Untitled",
          clientName: "",
          businessName: "",
          manager: "",
          program: "",
          email: "",
          instagram: "",
          recurringMeeting: "",
          profileStatus: "unknown",
          activeClients: "",
          monthlyRevenue: "",
          startDate: "",
          renewalDate: "",
          latestUpdate: "",
          callLog: [],
          lastEdited: "",
        };
      }
    })
  );

  return clients;
}

async function queryClientProfile(clientName) {
  if (!clientName) throw new Error("clientName is required for client_profile queries");

  const blocks = await notionFetch(`/blocks/${CLIENT_PROFILES_PAGE}/children?page_size=100`);
  const childPages = blocks.results.filter(b => b.type === "child_page");
  const needle = clientName.toLowerCase();
  // Prefer exact-ish matches, fall back to includes
  const match =
    childPages.find(cp => (cp.child_page?.title || "").toLowerCase().startsWith(needle)) ||
    childPages.find(cp => (cp.child_page?.title || "").toLowerCase().includes(needle));

  if (!match) return null;

  const [page, contentBlocks] = await Promise.all([
    notionFetch(`/pages/${match.id}`),
    notionFetch(`/blocks/${match.id}/children?page_size=100`),
  ]);

  const title = page.properties?.title?.title?.[0]?.plain_text || match.child_page?.title || "Untitled";
  const content = blocksToMarkdown(contentBlocks.results);

  // Build structured fields for the portal's meeting-prep modal
  const topLevelBlocks = contentBlocks.results;
  const callLog = [];
  const info = {};
  let latestUpdate = "";

  // Find indices of top-level H1/H2 headings to segment the page
  const sections = [];
  topLevelBlocks.forEach((b, idx) => {
    if (b.type === "heading_1" || b.type === "heading_2") {
      const heading = richTextToPlain(b[b.type].rich_text).trim();
      sections.push({ heading, idx });
    }
  });
  const sectionRange = (label) => {
    const i = sections.findIndex(s => s.heading.toLowerCase().includes(label));
    if (i < 0) return null;
    const startIdx = sections[i].idx + 1;
    const endIdx = i + 1 < sections.length ? sections[i + 1].idx : topLevelBlocks.length;
    return { startIdx, endIdx };
  };

  // Extract Call Log entries — each child_page/bulleted_list_item/paragraph under the Call Log heading becomes a call
  const callLogRange = sectionRange("call log");
  const callPageRefs = []; // child_page blocks we need to fetch content from
  if (callLogRange) {
    for (let i = callLogRange.startIdx; i < callLogRange.endIdx; i++) {
      const b = topLevelBlocks[i];
      let entryText = "";
      let pageId = null;
      if (b.type === "child_page") {
        entryText = b.child_page?.title || "";
        pageId = b.id;
      } else if (b.type === "paragraph") {
        entryText = richTextToPlain(b.paragraph.rich_text).trim();
      } else if (b.type === "bulleted_list_item") {
        entryText = richTextToPlain(b.bulleted_list_item.rich_text).trim();
      } else if (b.type === "toggle") {
        entryText = richTextToPlain(b.toggle.rich_text).trim();
      }
      if (!entryText) continue;
      // Try to pull a date out of the line (YYYY-MM-DD or "Month DD, YYYY")
      const dateMatch = entryText.match(/\d{4}-\d{2}-\d{2}|[A-Z][a-z]+ \d{1,2},? \d{4}/);
      const entry = {
        date: dateMatch ? dateMatch[0] : "",
        title: entryText.replace(/^[📞☎️\s—–-]+/, "").trim(),
        notes: entryText,
        pageId,
        fullNotes: "",
      };
      callLog.push(entry);
      if (pageId) callPageRefs.push({ pageId, entry });
    }

    // Fetch full content for each child_page call entry in parallel (limit to 5 most recent)
    const toFetch = callPageRefs.slice(0, 5);
    if (toFetch.length > 0) {
      const fetched = await Promise.all(
        toFetch.map(({ pageId }) =>
          notionFetch(`/blocks/${pageId}/children?page_size=100`)
            .then(r => blocksToMarkdown(r.results))
            .catch(() => "")
        )
      );
      toFetch.forEach(({ entry }, idx) => { entry.fullNotes = fetched[idx]; });
    }
    // Narrative paragraph right after the call list (first long paragraph in section) → latestUpdate
    for (let i = callLogRange.startIdx; i < callLogRange.endIdx; i++) {
      const b = topLevelBlocks[i];
      if (b.type === "paragraph") {
        const t = richTextToPlain(b.paragraph.rich_text).trim();
        if (t.length > 80) { latestUpdate = t; break; }
      }
    }
  }

  // Extract Client Info key-value pairs from a table block
  const infoRange = sectionRange("client info") || sectionRange("info");
  if (infoRange) {
    for (let i = infoRange.startIdx; i < infoRange.endIdx; i++) {
      const b = topLevelBlocks[i];
      if (b.type === "table" && b.has_children) {
        try {
          const rows = await notionFetch(`/blocks/${b.id}/children?page_size=100`);
          rows.results.forEach((row, rIdx) => {
            if (row.type !== "table_row") return;
            if (rIdx === 0 && b.table?.has_column_header) return;
            const cells = row.table_row.cells || [];
            const key = richTextToPlain(cells[0] || []).trim();
            const val = richTextToPlain(cells[1] || []).trim();
            if (key) info[key] = val;
          });
        } catch { /* ignore */ }
      } else if (b.type === "paragraph") {
        const t = richTextToPlain(b.paragraph.rich_text).trim();
        const m = t.match(/^([^:]+):\s*(.+)$/);
        if (m) info[m[1].trim()] = m[2].trim();
      }
    }
  }

  return {
    id: match.id,
    title,
    notionPageId: match.id,
    content,
    callLog,
    info,
    latestUpdate,
    lastEdited: page.last_edited_time,
  };
}

// ─── Query: Solution Warehouses ─────────────────────────────────────────────

async function querySolutionWarehouses(category) {
  const results = [];

  // Query databases
  const dbEntries = category
    ? Object.entries(WAREHOUSE_DBS).filter(([k]) => k === category)
    : Object.entries(WAREHOUSE_DBS);

  const dbResults = await Promise.all(
    dbEntries.map(async ([cat, dbId]) => {
      try {
        const res = await notionFetch(`/databases/${dbId}/query`, {
          method: "POST",
          body: JSON.stringify({ page_size: 100 }),
        });
        return res.results.map(page => {
          const p = page.properties;
          return {
            id: page.id,
            problem: p["Problem"]?.title?.[0]?.plain_text || "",
            solution: p["Solution & Notes"]?.phone_number || p["Solution & Notes"]?.rich_text?.[0]?.plain_text || "",
            severity: p["Severity"]?.select?.name || "",
            problemType: (p["Problem Type"]?.multi_select || []).map(s => s.name),
            frequency: (p["Frequency"]?.multi_select || []).map(s => s.name),
            category: cat.replace(/_/g, " ").replace(/\b\w/g, c => c.toUpperCase()),
            createdAt: page.created_time || "",
          };
        });
      } catch {
        return [];
      }
    })
  );

  results.push(...dbResults.flat());

  // Query pages (Legal, Team) — return as single entries with page content
  if (!category || category === "legal" || category === "team") {
    const pageEntries = category
      ? Object.entries(WAREHOUSE_PAGES).filter(([k]) => k === category)
      : Object.entries(WAREHOUSE_PAGES);

    const pageResults = await Promise.all(
      pageEntries.map(async ([cat, pageId]) => {
        try {
          const contentBlocks = await notionFetch(`/blocks/${pageId}/children?page_size=100`);
          const content = blocksToMarkdown(contentBlocks.results);
          // Parse page content into problem/solution pairs if possible
          const entries = [];
          const sections = content.split(/\n(?=##\s)/);
          for (const section of sections) {
            const lines = section.split("\n").filter(Boolean);
            if (lines.length > 0) {
              entries.push({
                id: `${pageId}-${entries.length}`,
                problem: lines[0].replace(/^#+\s*/, ""),
                solution: lines.slice(1).join("\n"),
                severity: "",
                problemType: [],
                frequency: [],
                category: cat.charAt(0).toUpperCase() + cat.slice(1),
                createdAt: "",
              });
            }
          }
          return entries.length > 0 ? entries : [{
            id: pageId,
            problem: cat.charAt(0).toUpperCase() + cat.slice(1) + " — Overview",
            solution: content,
            severity: "",
            problemType: [],
            frequency: [],
            category: cat.charAt(0).toUpperCase() + cat.slice(1),
            createdAt: "",
          }];
        } catch {
          return [];
        }
      })
    );
    results.push(...pageResults.flat());
  }

  return results;
}

// ─── Create: Solution in Warehouse DB ───────────────────────────────────────

async function createSolution(problem, solution, category) {
  if (!problem || !solution || !category) {
    throw new Error("problem, solution, and category are required for create_solution");
  }

  const dbId = WAREHOUSE_DBS[category];
  if (!dbId) {
    throw new Error(`Invalid category "${category}". Expected one of: ${Object.keys(WAREHOUSE_DBS).join(", ")}`);
  }

  const page = await notionFetch("/pages", {
    method: "POST",
    body: JSON.stringify({
      parent: { database_id: dbId },
      properties: {
        "Problem": {
          title: [{ text: { content: problem } }],
        },
        "Solution & Notes": {
          rich_text: [{ text: { content: solution } }],
        },
      },
    }),
  });

  return {
    id: page.id,
    problem,
    solution,
    category: category.replace(/_/g, " ").replace(/\b\w/g, c => c.toUpperCase()),
    createdAt: page.created_time || "",
  };
}

// ─── Handler ────────────────────────────────────────────────────────────────

export default async function handler(req, res) {
  if (!process.env.NOTION_API_KEY) {
    return res.status(500).json({ error: "NOTION_API_KEY not configured" });
  }

  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed. Use POST." });
  }

  const { type, clientName, pageId, category, problem, solution } = req.body || {};

  if (!type) {
    return res.status(400).json({ error: "Missing required field: type" });
  }

  try {
    switch (type) {
      case "sops": {
        const data = await querySOPs();
        return res.status(200).json({ data });
      }

      case "sop_tree": {
        const data = await querySOPTree();
        return res.status(200).json({ data });
      }

      case "sop_content": {
        if (!pageId) return res.status(400).json({ error: "pageId required for sop_content" });
        const data = await querySOPContent(pageId);
        return res.status(200).json({ data });
      }

      case "action_items": {
        const data = await queryActionItems();
        return res.status(200).json({ data });
      }

      case "all_clients": {
        const data = await queryAllClients();
        return res.status(200).json({ data });
      }

      case "client_profile": {
        const data = await queryClientProfile(clientName);
        if (!data) return res.status(404).json({ error: `Client "${clientName}" not found` });
        return res.status(200).json({ data });
      }

      case "solution_warehouses": {
        const data = await querySolutionWarehouses(category);
        return res.status(200).json({ data });
      }

      case "create_solution": {
        const data = await createSolution(problem, solution, category);
        return res.status(201).json({ data });
      }

      default:
        return res.status(400).json({
          error: `Invalid type "${type}". Expected: sops, sop_tree, sop_content, action_items, all_clients, client_profile, solution_warehouses, create_solution`,
        });
    }
  } catch (err) {
    console.error("Notion query error:", err.message);
    return res.status(500).json({ error: err.message });
  }
}
