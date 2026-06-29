#!/usr/bin/env python3
"""Generate the BAM GHL Agent state-of-the-project PDF report."""
from reportlab.lib.pagesizes import LETTER
from reportlab.lib.styles import getSampleStyleSheet, ParagraphStyle
from reportlab.lib.units import inch
from reportlab.lib import colors
from reportlab.platypus import (
    SimpleDocTemplate, Paragraph, Spacer, PageBreak, Table, TableStyle,
)
from reportlab.lib.enums import TA_LEFT
from datetime import date

OUT = "/Users/zoransavic/bam-ghl-agent/docs/bam-ghl-agent-state-of-project.pdf"

GOLD = colors.HexColor("#E8C547")
INK = colors.HexColor("#0C0C0E")
DIM = colors.HexColor("#5A5A60")
LINE = colors.HexColor("#2A2A2E")
LIGHT = colors.HexColor("#F2F2EE")

styles = getSampleStyleSheet()

H1 = ParagraphStyle("H1", parent=styles["Heading1"], fontName="Helvetica-Bold",
                    fontSize=22, leading=26, textColor=INK, spaceBefore=0, spaceAfter=8)
H2 = ParagraphStyle("H2", parent=styles["Heading2"], fontName="Helvetica-Bold",
                    fontSize=15, leading=19, textColor=INK, spaceBefore=14, spaceAfter=6)
H3 = ParagraphStyle("H3", parent=styles["Heading3"], fontName="Helvetica-Bold",
                    fontSize=11.5, leading=15, textColor=INK, spaceBefore=10, spaceAfter=4)
BODY = ParagraphStyle("Body", parent=styles["BodyText"], fontName="Helvetica",
                      fontSize=10, leading=14, textColor=INK, spaceAfter=6, alignment=TA_LEFT)
SMALL = ParagraphStyle("Small", parent=BODY, fontSize=8.5, leading=11, textColor=DIM)
BULLET = ParagraphStyle("Bullet", parent=BODY, leftIndent=14, bulletIndent=2, spaceAfter=2)
COVER_TITLE = ParagraphStyle("CT", parent=H1, fontSize=30, leading=34, spaceAfter=6)
COVER_SUB = ParagraphStyle("CS", parent=BODY, fontSize=12, leading=16, textColor=DIM)
TAG = ParagraphStyle("Tag", parent=BODY, fontSize=8, leading=10, textColor=DIM,
                     fontName="Helvetica-Oblique")

def b(text):  # bullet
    return Paragraph(f"\u2022 {text}", BULLET)

def section_table(rows, col_widths, header=True):
    t = Table(rows, colWidths=col_widths, repeatRows=1 if header else 0)
    style = [
        ("FONT", (0, 0), (-1, -1), "Helvetica", 9),
        ("TEXTCOLOR", (0, 0), (-1, -1), INK),
        ("VALIGN", (0, 0), (-1, -1), "TOP"),
        ("LINEBELOW", (0, 0), (-1, -1), 0.4, LINE),
        ("LEFTPADDING", (0, 0), (-1, -1), 6),
        ("RIGHTPADDING", (0, 0), (-1, -1), 6),
        ("TOPPADDING", (0, 0), (-1, -1), 6),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 6),
    ]
    if header:
        style += [
            ("FONT", (0, 0), (-1, 0), "Helvetica-Bold", 9),
            ("BACKGROUND", (0, 0), (-1, 0), LIGHT),
            ("LINEBELOW", (0, 0), (-1, 0), 1, INK),
        ]
    t.setStyle(TableStyle(style))
    return t

def header_footer(canvas, doc):
    canvas.saveState()
    canvas.setFillColor(DIM)
    canvas.setFont("Helvetica", 7.5)
    canvas.drawString(0.6 * inch, 0.4 * inch,
                      "BAM GHL Agent  ·  State of the Project  ·  2026-04-24")
    canvas.drawRightString(LETTER[0] - 0.6 * inch, 0.4 * inch, f"Page {doc.page}")
    canvas.setStrokeColor(LINE)
    canvas.setLineWidth(0.4)
    canvas.line(0.6 * inch, 0.55 * inch, LETTER[0] - 0.6 * inch, 0.55 * inch)
    canvas.restoreState()

def cover_page(canvas, doc):
    canvas.saveState()
    canvas.setFillColor(INK)
    canvas.rect(0, LETTER[1] - 1.2 * inch, LETTER[0], 1.2 * inch, fill=1, stroke=0)
    canvas.setFillColor(GOLD)
    canvas.rect(0.6 * inch, LETTER[1] - 1.2 * inch + 0.2 * inch, 0.4 * inch, 0.05 * inch, fill=1, stroke=0)
    canvas.setFillColor(colors.white)
    canvas.setFont("Helvetica-Bold", 10)
    canvas.drawString(0.6 * inch, LETTER[1] - 0.5 * inch, "BAM BUSINESS")
    canvas.setFillColor(GOLD)
    canvas.setFont("Helvetica", 9)
    canvas.drawString(0.6 * inch, LETTER[1] - 0.7 * inch, "Internal report")
    canvas.restoreState()
    header_footer(canvas, doc)

doc = SimpleDocTemplate(
    OUT, pagesize=LETTER,
    leftMargin=0.6 * inch, rightMargin=0.6 * inch,
    topMargin=0.7 * inch, bottomMargin=0.7 * inch,
    title="BAM GHL Agent — State of the Project",
    author="Zoran Savic",
)

story = []

# ---- COVER ----
story.append(Spacer(1, 1.4 * inch))
story.append(Paragraph("BAM GHL Agent", COVER_TITLE))
story.append(Paragraph("State of the Project", H2))
story.append(Spacer(1, 0.2 * inch))
story.append(Paragraph(
    "Where we are with the white-labeled GoHighLevel agency stack: what we're "
    "building, the front ends and back ends in flight, the integrations that "
    "are wired, and the work in front of us.", COVER_SUB))
story.append(Spacer(1, 0.5 * inch))
story.append(section_table(
    [
        ["Author", "Zoran Savic"],
        ["Date", date.today().isoformat()],
        ["Repo", "bam-os-requirements / bam-ghl-agent"],
        ["Supabase project", "jnojmfmpnsfmtqmwhopz (By Any Means Basketball Pro)"],
        ["Active clients seeded", "20 in clients table"],
        ["Integrations", "10 (Supabase, Anthropic, Asana, Google OAuth, GCal, GSheets, GHL, Notion, Slack, Stripe)"],
    ],
    col_widths=[1.6 * inch, 5.2 * inch], header=False))
story.append(PageBreak())

# ---- 1. EXECUTIVE SUMMARY ----
story.append(Paragraph("1. Executive summary", H1))
story.append(Paragraph(
    "BAM Business is a white-labeled GoHighLevel agency that runs CRM, "
    "automations, websites, funnels, pipelines, and communications for sports "
    "academies (and eventually home services companies). Each client lives in "
    "their own GHL sub-account; BAM staff operate them centrally.", BODY))
story.append(Paragraph(
    "This project is the operating system around that service. It does three "
    "things, and it is on a path toward a fourth.", BODY))
story.append(b("<b>Onboard</b> new academies through self-serve forms (class setup, offer setup, parent onboarding)."))
story.append(b("<b>Triage</b> ongoing support tickets from active clients (Error / Change / Build) through a customer support portal."))
story.append(b("<b>Operate</b> all of it from one staff dashboard (bam-portal) that pulls from the 10 integrations."))
story.append(Spacer(1, 0.05 * inch))
story.append(Paragraph("North star", H3))
story.append(Paragraph(
    "<b>One portal serving both clients and staff.</b> Not just an internal "
    "tool, and not just a support form — a real two-sided product.", BODY))
story.append(b("<b>Clients can</b>: chat with staff in dedicated per-topic chat windows; see every ad campaign they're running and adjust their own ad spend; submit support tickets and check the status of their systems."))
story.append(b("<b>Staff can</b>: operate every client account from one dashboard (the existing bam-portal), with an autonomous GHL agent that eventually drafts fixes and builds for staff to review before shipping."))
story.append(Paragraph(
    "The autonomous agent is a <i>capability</i> inside the staff side of "
    "the portal. The portal itself is the destination.", SMALL))
story.append(Spacer(1, 0.1 * inch))
story.append(Paragraph(
    "<b>Where we are right now.</b> The customer-facing HTML is the most "
    "mature surface — onboarding and the support portal are functional and "
    "Supabase-backed. The staff portal (bam-portal) was built by Cole and is "
    "in the middle of being reconnected to Zoran's own backend keys: Supabase "
    "and Slack are live; GHL, Stripe, Asana, Google, Notion are wired but the "
    "data joins are not yet bound to a stable client roster. We just created "
    "and seeded the <b>clients</b> table (20 rows) so every integration ID "
    "has one place to hang from.", BODY))
story.append(PageBreak())

# ---- 2. ARCHITECTURE ----
story.append(Paragraph("2. Architecture at a glance", H1))
story.append(Paragraph(
    "Two portals, one shared backend. Customer-facing HTML files write into "
    "Supabase; the staff React app reads from Supabase plus the 10 integrations.",
    BODY))

story.append(Paragraph("Two portals", H3))
story.append(b("<b>Customer-facing</b> — plain HTML, no build step. Onboarding flow (class-setup → offer-setup → parent-onboarding) and support portal (client-portal.html). Lives at /Users/zoransavic/bam-ghl-agent/ (local working copy) and ships into GHL embeds."))
story.append(b("<b>Staff-facing</b> — bam-portal/, React 19 + Vite 8 + React Router 7 with Vercel serverless functions in /api/. Deployed to Vercel; SSO-protected. Built by Cole; Zoran is reconnecting backend with his own keys."))

story.append(Paragraph("Shared backend", H3))
story.append(b("<b>Supabase</b> (jnojmfmpnsfmtqmwhopz) — Questions DB (202 rows, source of truth for all form questions), user_slack_tokens (per-user OAuth), clients (20 rows, integration ID join table)."))
story.append(b("<b>Vercel serverless functions</b> — one route per integration in bam-portal/api/."))
story.append(b("<b>Notion</b> — knowledge base for SOPs, build guides, template sections (will migrate to Supabase later)."))

story.append(Paragraph("Data flow (target)", H3))
story.append(Paragraph(
    "Client submits form → write to Supabase → create Asana ticket → "
    "staff sees it in bam-portal → staff (eventually agent + staff) builds "
    "the asset → push into client's GHL sub-account.", BODY))

story.append(Paragraph("The two-path setup (important)", H3))
story.append(b("<code>/Users/zoransavic/bam-ghl-agent/</code> — LOCAL, not in monorepo git. Holds the working customer HTML files, .claude/commands skills, and worktrees."))
story.append(b("<code>/Users/zoransavic/bam-os-requirements/bam-ghl-agent/</code> — GIT inside the monorepo. Holds CLAUDE.md, bam-portal React app, docs, sections."))
story.append(Paragraph(
    "Both folders point Supabase MCP at the same project. Open Claude Code on "
    "the local path for customer HTML work, on the monorepo path for portal work.",
    SMALL))
story.append(PageBreak())

# ---- 3. CUSTOMER FRONT END ----
story.append(Paragraph("3. Customer-facing front end", H1))
story.append(Paragraph(
    "HTML files at the local project root. All form questions are pulled from "
    "the Supabase Questions DB so a single edit propagates to every page that "
    "uses that question.", BODY))

story.append(Paragraph("Onboarding flow (one-time, new academy)", H3))
rows = [
    ["File", "Role", "Lines", "Backend"],
    ["class-setup.html", "Step 1 — class structure, schedule, capacity", "776", "Supabase"],
    ["offer-setup.html", "Step 2 — pricing, free trial, packages", "456", "Supabase"],
    ["parent-onboarding.html", "Step 3 — parent / athlete intake", "228", "Supabase"],
]
story.append(section_table(rows, [1.9*inch, 3.2*inch, 0.6*inch, 1.1*inch]))

story.append(Paragraph("Support portal (ongoing, existing clients)", H3))
story.append(Paragraph(
    "client-portal.html is the single entry point for active clients. Three "
    "ticket types (Error / Change / Build) and 10 build menu items: Gym "
    "Rental, Player Intake, New Hire, Youth Academy, Internal Tournament, "
    "Sponsor Inquiry, Camps/Clinics, Upsells, Staff Member, Promo (plus a "
    "\"Build something else\" overflow).", BODY))

story.append(Paragraph("Internal HTML files (status: legacy, confirm before editing)", H3))
rows = [
    ["File", "Purpose", "Lines"],
    ["dashboard.html", "Internal ops dashboard (pre-bam-portal)", "1010"],
    ["error-ticket-internal.html", "Error ticket triage with Claude analysis", "1285"],
    ["change-ticket-internal.html", "Change request management", "1387"],
    ["build-mode.html", "Dual-panel build workspace with timer", "1323"],
    ["analysis.html", "Support ticket intake analytics", "836"],
]
story.append(section_table(rows, [2.4*inch, 3.7*inch, 0.7*inch]))
story.append(Paragraph(
    "These files predate the React portal. Likely to be deprecated as bam-portal "
    "absorbs their function — but confirm with Zoran before deleting; some are "
    "still referenced in workflows.", SMALL))
story.append(PageBreak())

# ---- 4. STAFF FRONT END ----
story.append(Paragraph("4. Staff front end (bam-portal)", H1))
story.append(Paragraph(
    "React 19 + Vite 8 + React Router 7. Deployed to Vercel with SSO "
    "protection. The portal is the single pane of glass for staff to "
    "operate every client account.", BODY))

story.append(Paragraph("Main views", H3))
rows = [
    ["View", "Purpose", "Backend dependency"],
    ["Dashboard", "Cross-client overview, alerts, recent activity", "clients + Stripe + Asana"],
    ["ClientsView", "Roster of every academy with integration drill-downs", "clients (NEW)"],
    ["LeadsCRMView", "Lead pipeline across all GHL sub-accounts", "GHL"],
    ["CommunicationView", "Slack + GHL conversations consolidated", "Slack + GHL"],
    ["KnowledgeBaseView", "SOPs, build guides, template sections", "Notion (broken — needs perms)"],
    ["FinancialsView", "MRR, churn, invoices, dunning", "Stripe"],
    ["UnifiedTasksView", "Cross-system task list", "Asana + Supabase"],
    ["CalendarView", "Multi-account scheduling", "Google Calendar"],
    ["SettingsView", "Per-user integration auth + prefs", "Supabase + OAuth providers"],
    ["SOPView", "Standard operating procedures", "Notion"],
    ["ProblemWarehouseView", "Pattern library of past tickets + fixes", "Supabase"],
    ["SystemsView", "Integration health + key status", "All 10"],
    ["MarketingView", "Per-client campaign performance", "GHL + Meta (future)"],
    ["ActionItemsView", "Triaged action queue", "Supabase + Asana"],
]
story.append(section_table(rows, [1.65*inch, 3.4*inch, 1.75*inch]))

story.append(Paragraph("Training module", H3))
story.append(Paragraph(
    "Separate React module inside bam-portal for staff training. Views: "
    "TrainingHome, AdminHub, QuickFireMode, CalibrationMode, ReviewFeed, "
    "AddScenario, TeamDashboard, ScenarioFeedbackView. Used to drill new "
    "staff on common ticket scenarios — not on the critical path for the "
    "current backend reconnection work.", BODY))
story.append(PageBreak())

# ---- 5. BACK END ----
story.append(Paragraph("5. Back end — integrations and state", H1))
story.append(Paragraph(
    "Each integration has a key configured in Vercel and (mostly) a "
    "serverless function in bam-portal/api/. Status reflects what is actually "
    "returning live data right now, not just what is wired.", BODY))

rows = [
    ["Integration", "Route", "Purpose", "Status"],
    ["Supabase", "lib/supabase.js", "Main DB + auth, Questions DB, clients", "LIVE"],
    ["Slack", "/api/slack/channels.js", "Per-user OAuth + comms", "LIVE (BAM Portal app, OAuth end-to-end)"],
    ["Stripe", "/api/stripe/overview.js", "Payments, MRR, customers, invoices", "LIVE ($17.7k MRR, 56 subs confirmed)"],
    ["GHL", "/api/ghl.js", "Sub-account ops via V1 + V2 APIs", "LIVE (53 sub-accounts enumerable; 20 mapped)"],
    ["Asana", "/api/asana/tasks.js", "Tickets + tasks", "Wired (workspace 1201652590043795 confirmed)"],
    ["Google OAuth", "/api/auth/google/*", "Staff login + Google service auth", "Wired"],
    ["Google Calendar", "/api/calendar/events.js", "Multi-account scheduling", "Wired (per-user OAuth pending)"],
    ["Google Sheets", "/api/sheets/onboarding.js", "Onboarding tracker (legacy)", "LIVE — to be replaced by /api/clients.js"],
    ["Anthropic", "/api/ai/search.js", "Claude calls for portal AI features", "Wired"],
    ["Notion", "/api/notion/query.js", "SOPs + KB", "Partial (10 SOP pages return metadata, 0 children — perms blocked, waiting on Cole)"],
]
story.append(section_table(rows, [1.0*inch, 1.5*inch, 2.4*inch, 2.0*inch]))

story.append(Paragraph("Supabase tables", H3))
story.append(b("<b>Questions Database</b> — 202 rows. Single source of truth for every form question across class-setup, offer-setup, parent-onboarding, and the support portal."))
story.append(b("<b>user_slack_tokens</b> — per-user Slack OAuth tokens. RLS enabled; users only see their own row."))
story.append(b("<b>clients</b> — 20 rows. The new join table that gives every integration ID one home per client."))

story.append(Paragraph("clients table (just seeded)", H3))
story.append(Paragraph(
    "Columns: id, name, status (onboarding/active/paused/churned), "
    "ghl_location_id (unique), slack_channel_id, stripe_customer_id, "
    "notion_page_id, asana_project_id, created_at, updated_at. RLS "
    "enabled with staff read/insert/update policies; updated_at trigger "
    "in place.", BODY))
story.append(PageBreak())

# ---- 6. CLIENT ROSTER ----
story.append(Paragraph("6. Client roster (current state of the join table)", H1))
story.append(Paragraph(
    "20 active clients seeded into the clients table. GHL location IDs and "
    "Notion page IDs are filled where known. Stripe customer IDs filled for "
    "4 confirmed matches; the rest need owner-name → academy mapping. Slack "
    "channel IDs and Asana project IDs are not yet populated for any row.",
    BODY))

rows = [
    ["#", "Name", "GHL", "Notion", "Stripe"],
    ["1", "BAM San Jose", "✓", "✓", "—"],
    ["2", "BAM WV (Mountain State)", "✓", "✓", "—"],
    ["3", "BAM NY", "✓", "✓", "—"],
    ["4", "BTG", "✓", "—", "—"],
    ["5", "The Basketball Lab", "✓", "—", "✓ (Jake Russell)"],
    ["6", "Prime By Design", "✓", "✓", "—"],
    ["7", "Pro Bound Training", "✓", "—", "—"],
    ["8", "Danny Cooper Basketball", "✓", "✓", "—"],
    ["9", "Johnson Bball", "✓", "✓", "—"],
    ["10", "D.A. Hoops Academy", "✓", "✓", "—"],
    ["11", "Performance Space Hoops", "✓", "✓", "—"],
    ["12", "Straight Buckets Performance", "✓", "✓", "—"],
    ["13", "Basketball+", "✓", "✓", "—"],
    ["14", "Elite Smart Athletes", "✓", "✓", "—"],
    ["15", "Major Hoops", "✓", "✓", "✓ (Andrew Major)"],
    ["16", "Total Hoops Training (G. Fowler)", "✓", "✓", "✓ (George Fowler)"],
    ["17", "Supreme Hoops Training", "✓", "✓", "—"],
    ["18", "Sage Hoops", "✓", "✓", "—"],
    ["19", "Wyatt Garren", "—", "✓", "✓"],
    ["20", "ACTIV8", "—", "✓", "—"],
]
story.append(section_table(rows, [0.3*inch, 2.7*inch, 0.5*inch, 0.6*inch, 1.6*inch]))
story.append(Paragraph(
    "Gaps to close on the roster: 3 clients still need Notion profiles "
    "(BTG, Pro Bound Training, The Basketball Lab); 2 don't have GHL "
    "sub-accounts wired (Wyatt Garren, ACTIV8); 16 still need Stripe "
    "customer IDs matched.", SMALL))
story.append(PageBreak())

# ---- 7. WHERE WE ARE ----
story.append(Paragraph("7. Where we are right now", H1))

story.append(Paragraph("Done in this work cycle", H3))
story.append(b("Verified Supabase MCP points at <code>jnojmfmpnsfmtqmwhopz</code> and listed all tables."))
story.append(b("Pulled and absorbed the new CLAUDE.md from main."))
story.append(b("Created the clients table from scratch with full RLS + audit trigger (the previous \"created empty\" note was incorrect; table didn't actually exist)."))
story.append(b("Reconciled 3 different client lists (CLAUDE.md original 13, Notion profiles, screenshot) into one canonical roster of 20."))
story.append(b("Resolved name aliases: BAM Mountain State = DETAIL Mountain State = BAM WV; George Fowler = Total Hoops Training."))
story.append(b("Seeded all 20 clients with names, GHL location IDs (where known), and Notion page IDs (where known)."))
story.append(b("Bypassed Vercel SSO protection via <code>vercel curl</code> to call deployed Stripe API endpoint."))
story.append(b("Confirmed 4 Stripe customer matches: Total Hoops Training, The Basketball Lab, Major Hoops, Wyatt Garren."))

story.append(Paragraph("Live and trustworthy", H3))
story.append(b("Customer onboarding flow (3 HTML pages, Supabase-backed)."))
story.append(b("Customer support portal (client-portal.html, 10 build menu items)."))
story.append(b("Supabase Questions DB (202 rows) as single source of truth for all form questions."))
story.append(b("Slack OAuth (per-user tokens via user_slack_tokens)."))
story.append(b("Stripe overview API ($17.7k MRR confirmed live)."))
story.append(b("GHL agency-key access to 53 sub-accounts."))

story.append(Paragraph("Wired but not yet fully usable", H3))
story.append(b("bam-portal staff app — deployed but most views still read from the legacy Google Sheets onboarding endpoint instead of the new clients table."))
story.append(b("Notion KB — integration is connected but lacks page-level access on most pages (waiting on Cole to make Zoran workspace owner so workspace-wide integration can be enabled)."))
story.append(b("Asana — workspace confirmed but per-client project IDs not seeded."))
story.append(b("Google Calendar — server token works; per-user OAuth flow not built."))
story.append(PageBreak())

# ---- 8. WHAT'S NEXT ----
story.append(Paragraph("8. What's next", H1))
story.append(Paragraph("In order, smallest unblock first.", BODY))

rows = [
    ["#", "Step", "Owner", "Unblocks"],
    ["1", "Build /api/clients.js endpoint backed by clients table", "Zoran", "Replaces Google Sheets dependency in bam-portal"],
    ["2", "Update App.jsx to load clients from the new endpoint", "Zoran", "Every staff view gets a stable client roster"],
    ["3", "Owner-name → academy mapping from Zoran for remaining 16 Stripe matches", "Zoran (input)", "Stripe customer IDs in clients"],
    ["4", "Backfill stripe_customer_id for the remaining 16 rows", "Zoran", "Financials view per-client"],
    ["5", "Add Notion profiles for BTG, Pro Bound Training, The Basketball Lab", "Zoran", "Notion KB completeness"],
    ["6", "Wait on Cole — workspace-wide Notion integration access", "Cole", "KB / SOP views become usable"],
    ["7", "Fix client name parsing in /api/notion/all_clients (names returning as \"?\")", "Zoran", "Notion view accuracy"],
    ["8", "Seed slack_channel_id per client (manual map, then automate)", "Zoran", "CommunicationView per-client"],
    ["9", "Seed asana_project_id per client", "Zoran", "Per-client task view"],
    ["10", "Per-user Google Calendar OAuth flow", "Zoran", "Multi-account scheduling"],
    ["11", "Customer portal → Slack mirroring (Option B for client comms)", "Zoran", "Inbound from clients into Slack"],
    ["12", "Lock client-portal.html scope; revisit checkpoints/alerts schema in clients", "Zoran", "Lifecycle alerting"],
]
story.append(section_table(rows, [0.3*inch, 3.4*inch, 1.0*inch, 2.3*inch]))

story.append(Paragraph("Held off intentionally", H3))
story.append(b("<b>Lifecycle / alerts columns on clients</b> — deferred until client-portal.html scope is final, because the portal may handle some onboarding tasks itself, which would change what staff has to track."))
story.append(b("<b>Asana ticket schema</b> — same record for onboarding + support, or separate tables? Decision pending."))
story.append(b("<b>Onboarding entry URL</b> — how a new academy lands on class-setup.html in the first place. Will be wired up when the sales handoff is defined."))
story.append(b("<b>Notion → Supabase migration</b> for SOPs, build guides, template sections. Coming after the staff portal stabilizes."))

story.append(Paragraph("North star (not yet started)", H3))
story.append(Paragraph(
    "<b>One portal, two sides.</b> Clients log in to chat with staff, see "
    "and control their ad campaigns, and check ticket / system status. Staff "
    "log in to operate every client account, with an autonomous GHL agent "
    "drafting Support Ticket fixes and Onboarding Build outputs for them to "
    "review and approve. The agent lives <i>inside</i> the staff side; the "
    "portal itself is the destination.", BODY))
story.append(PageBreak())

# ---- 9. RISKS & OPEN QUESTIONS ----
story.append(Paragraph("9. Risks and open questions", H1))
story.append(b("<b>Two-path setup confusion</b> — local working folder vs monorepo path is the single biggest source of \"wait, where's that file\" friction. Mitigated by the CLAUDE.md callout but worth a sticky reminder."))
story.append(b("<b>Cole dependency on Notion access</b> — KB views are dead until Cole flips workspace-wide integration on. No workaround on our side."))
story.append(b("<b>Stripe customer matching</b> — billing is under owner names, not academy names. Need Zoran's mapping to finish; can't infer."))
story.append(b("<b>Legacy HTML files</b> (dashboard, error-ticket-internal, change-ticket-internal, build-mode, analysis) overlap with bam-portal views. Unclear if still in use; need a deprecation pass."))
story.append(b("<b>Vercel SSO protection</b> — needed for security but adds friction to API calls during dev. Workflow established (<code>vercel curl</code>) but worth documenting."))
story.append(b("<b>Backend reconnection mid-flight</b> — bam-portal currently has a mix of Cole's keys and Zoran's keys. Until the swap is complete, some endpoints may read from one account and write to another."))

story.append(Paragraph("Quick reference", H3))
rows = [
    ["Item", "Value"],
    ["Supabase project ref", "jnojmfmpnsfmtqmwhopz"],
    ["GHL agency key", "Configured in Vercel (GHL_LOCATIONS_JSON enumerates 13)"],
    ["Stripe account", "mike@byanymeansbball.com — $17.7k MRR, 56 subs"],
    ["Slack app", "BAM Portal — Client ID 9371199551328.10970298548951"],
    ["Asana workspace", "GID 1201652590043795"],
    ["Notion KB root", "https://www.notion.so/33a5aca8ac0f81f38881d3f7003294ec"],
    ["bam-portal repo path", "/Users/zoransavic/bam-os-requirements/bam-ghl-agent/bam-portal/"],
    ["Customer HTML path", "/Users/zoransavic/bam-ghl-agent/"],
]
story.append(section_table(rows, [2.0*inch, 4.8*inch]))

doc.build(story, onFirstPage=cover_page, onLaterPages=header_footer)
print(f"Wrote {OUT}")
