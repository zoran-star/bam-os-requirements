// Vercel Serverless Function — Google Sheets Onboarding Tracker
// GET: read all client data from CLIENT TRACKER tab
// PATCH: update a checkbox (toggle a checkpoint)

const SHEET_ID = "1qajlcDA4yGOMWGQAQ6jjujMNfgZmiKFCKchOmVEtzyw";
const SHEETS_API = "https://sheets.googleapis.com/v4/spreadsheets";

// Tab GIDs for reference:
// CLIENT TRACKER: 407686187
// SYSTEMS IMPLEMENTATION: 815191685
// SYSTEM TEMPLATES BUILD TRACKER: 993995

// Column mapping for CLIENT TRACKER (row 4 is headers, data starts row 5)
// A: Location, B: Manager, C: Start Date, D: Renewal Date, E: Onboarding Status, F: Overall Progress
// G-T: 14 checkpoints (G=Contract, H=Asana Created, I=Software Setup, J=SM Intro Call,
//   K=Systems Intro Call, L=Phone Number, M=Domain Added, N=Initial Systems Draft,
//   O=Final Systems Draft, P=Additional Systems, Q=Content Plan Reviewed,
//   R=Initial Ads Draft, S=Final Ads Draft, T=Ads Running)

const CHECKPOINT_COLS = ["G", "H", "I", "J", "K", "L", "M", "N", "O", "P", "Q", "R", "S", "T"];

const ONBOARDING_STAGES = [
  { group: "Sales Handover", tasks: ["Contract", "Asana Created", "Software Setup"] },
  { group: "SM Intro", tasks: ["SM Intro Call"] },
  { group: "Systems", tasks: ["Systems Intro Call", "Phone Number", "Domain Added", "Initial Systems Draft", "Final Systems Draft", "Additional Systems"] },
  { group: "Content", tasks: ["Content Plan Reviewed"] },
  { group: "Paid Ads", tasks: ["Initial Ads Draft", "Final Ads Draft", "Ads Running"] },
];

async function sheetsFetch(path, options = {}) {
  const apiKey = process.env.GOOGLE_SHEETS_API_KEY;
  if (apiKey) {
    const separator = path.includes("?") ? "&" : "?";
    const res = await fetch(`${SHEETS_API}/${SHEET_ID}${path}${separator}key=${apiKey}`, {
      ...options,
      headers: { "Content-Type": "application/json", ...options.headers },
    });
    if (!res.ok) {
      const err = await res.text();
      throw new Error(`Sheets API ${res.status}: ${err}`);
    }
    return res.json();
  }

  // Fallback to OAuth token
  const res = await fetch(`${SHEETS_API}/${SHEET_ID}${path}`, {
    ...options,
    headers: {
      "Authorization": `Bearer ${process.env.GOOGLE_ACCESS_TOKEN}`,
      "Content-Type": "application/json",
      ...options.headers,
    },
  });
  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Sheets API ${res.status}: ${err}`);
  }
  return res.json();
}

function deriveAlerts(checks) {
  const alerts = [];
  // Sales Handover done but SM Intro not done
  if (checks[0] && checks[1] && checks[2] && !checks[3]) {
    alerts.push("SM intro call not booked");
  }
  // SM Intro done but no systems work started
  if (checks[3] && !checks[4] && !checks[5] && !checks[6]) {
    alerts.push("No systems work started");
  }
  // Systems initial draft done but final draft not done
  if (checks[7] && !checks[8]) {
    alerts.push("Systems final draft overdue");
  }
  // No checkpoints completed at all
  if (checks.every(c => !c)) {
    alerts.push("No checkpoints completed");
  }
  // Ads: final draft done but not running
  if (checks[12] && !checks[13]) {
    alerts.push("Ads not yet running");
  }
  return alerts;
}

function parseRow(row, rowIndex) {
  const checks = CHECKPOINT_COLS.map((_, i) => {
    const val = row[6 + i]; // columns G onwards = index 6+
    return val === "TRUE" || val === true;
  });

  const pct = checks.length > 0
    ? Math.round(checks.filter(Boolean).length / checks.length * 100)
    : 0;

  const status = row[4] || "In Progress"; // column E
  const health = pct >= 80 ? Math.min(95, 60 + pct * 0.35) : Math.max(15, pct * 0.9);

  return {
    id: rowIndex, // sheet row number (5-based)
    name: row[0] || "",
    manager: row[1] || "",
    startDate: row[2] || "",
    renewal: row[3] || "",
    onboardingStatus: status,
    progress: pct,
    checks,
    health: Math.round(health),
    healthStatus: health >= 70 ? "healthy" : health >= 40 ? "at-risk" : "critical",
    tier: "Foundations", // default, can be enhanced later
    revenue: "$1,800/mo",
    lastActivity: "Today",
    tasksDue: checks.filter(c => !c).length,
    notes: "",
    wins: pct === 100 ? ["Onboarding complete"] : [],
    alerts: deriveAlerts(checks),
    salesNotes: "",
    customTasks: [],
    aiSentiment: null,
  };
}

export default async function handler(req, res) {
  const hasAuth = process.env.GOOGLE_ACCESS_TOKEN || process.env.GOOGLE_SHEETS_API_KEY;
  if (!hasAuth) {
    return res.status(500).json({ error: "GOOGLE_ACCESS_TOKEN or GOOGLE_SHEETS_API_KEY not configured" });
  }

  try {
    if (req.method === "GET") {
      const tab = req.query.tab || "CLIENT TRACKER";

      if (tab === "CLIENT TRACKER") {
        // Read rows 5:50 (data rows, skip headers)
        const data = await sheetsFetch(`/values/'CLIENT TRACKER'!A5:T50`);
        const rows = (data.values || []).filter(r => r[0]); // filter empty rows
        const clients = rows.map((row, i) => parseRow(row, i + 5));
        return res.status(200).json({ data: clients });
      }

      if (tab === "SYSTEMS IMPLEMENTATION") {
        const data = await sheetsFetch(`/values/'SYSTEMS IMPLEMENTATION'!A4:Z50`);
        const rows = (data.values || []).filter(r => r[0]);
        const systems = rows.map((row, i) => ({
          id: i + 4,
          location: row[0] || "",
          manager: row[1] || "",
          progress: row[2] || "0%",
          targetDate: row[3] || "",
          checks: row.slice(4).map(v => v === "TRUE" || v === true),
        }));
        return res.status(200).json({ data: systems });
      }

      if (tab === "SYSTEM TEMPLATES BUILD TRACKER") {
        const data = await sheetsFetch(`/values/'SYSTEM TEMPLATES BUILD TRACKER'!A3:E50`);
        const rows = (data.values || []).filter(r => r[0]);
        const templates = rows.map((row, i) => ({
          id: i + 3,
          template: row[0] || "",
          location: row[1] || "",
          ghlLink: row[2] || "",
          built: row[3] === "TRUE" || row[3] === true,
          approved: row[4] === "TRUE" || row[4] === true,
        }));
        return res.status(200).json({ data: templates });
      }

      return res.status(400).json({ error: `Unknown tab: ${tab}` });
    }

    if (req.method === "PATCH") {
      // Update a specific cell (e.g., toggle a checkpoint)
      const { row, checkIndex, value } = req.body;
      if (!row || checkIndex === undefined) {
        return res.status(400).json({ error: "row and checkIndex are required" });
      }

      const col = CHECKPOINT_COLS[checkIndex];
      if (!col) return res.status(400).json({ error: "Invalid checkIndex" });

      const range = `'CLIENT TRACKER'!${col}${row}`;
      await sheetsFetch(`/values/${range}?valueInputOption=USER_ENTERED`, {
        method: "PUT",
        body: JSON.stringify({
          range,
          values: [[value ? "TRUE" : "FALSE"]],
        }),
      });

      return res.status(200).json({ data: { row, checkIndex, value } });
    }

    return res.status(405).json({ error: "Method not allowed" });
  } catch (err) {
    console.error("Sheets API error:", err.message);
    return res.status(500).json({ error: err.message });
  }
}
