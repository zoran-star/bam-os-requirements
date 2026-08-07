// Stand-in for src/lib/supabase.js, used ONLY by the local backlog mockup.
// Aliased in vite.mock.config.js so BacklogV2View and its drawer load unchanged
// and what you click is the real component, not a copy of it.

const NOW = Date.parse("2026-08-06T21:00:00Z");
const ago = (mins) => new Date(NOW - mins * 60000).toISOString();

// Realistic shapes: one long multi-line ask with an image, one terse bug, one
// idea, one already assigned, plus two closed so the Done tab is not empty.
export const MOCK_TICKETS = [
  {
    id: "t1", client_id: "c1", type: "fix", status: "new", assignee_role: "backlog",
    assigned_to: null, title: "Please change the photo to the graphic attached & the locati",
    created_at: ago(240), updated_at: ago(240),
    intake: {
      page: "/client-portal.html",
      description: "Please change the photo to the graphic attached & the location of this clinic should be \n\nNorthern Burlington Middle School\n180 E Mansfield Rd\nColumbus, NJ 08022",
      file_name: "clinic-flyer.png",
      file_url: "https://jnojmfmpnsfmtqmwhopz.supabase.co/storage/v1/object/public/ticket-files/feedback/bf31baa0-e7bd-452f-860e-d80c511f58e6-CE4829F8-1A6C-48DB-9EA6-A5AFB81A039D.png",
      context: {
        view: "systems", viewport: { w: 440, h: 796 }, seconds_on_page: 140, errors: [],
        clicks: [
          { t: 3, el: "Approved" },
          { t: 5, el: "Camps / Clinics Approved" },
          { t: 26, el: "Report a problemSomething is broken" },
          { t: 85, el: "Choose file" },
          { t: 136, el: "Send it #fcfb-send" },
        ],
      },
    },
    context: {},
  },
  {
    id: "t2", client_id: "c2", type: "fix", status: "new", assignee_role: "backlog",
    assigned_to: null, title: "the calendar shows last week when i open it on my phone",
    created_at: ago(1500), updated_at: ago(1500),
    intake: {
      page: "/client-portal.html",
      description: "the calendar shows last week when i open it on my phone. on the laptop its fine. happens every time",
      context: {
        view: "calendar", viewport: { w: 390, h: 844 }, seconds_on_page: 62,
        errors: ["TypeError: t.slots is undefined"],
        clicks: [{ t: 8, el: "Calendar" }, { t: 41, el: "Report a problem" }],
      },
    },
    context: {},
  },
  {
    id: "t3", client_id: "c3", type: "feature_idea", status: "new", assignee_role: "backlog",
    assigned_to: null, title: "Would love to text a whole class at once",
    created_at: ago(4300), updated_at: ago(4300),
    intake: {
      page: "/client-portal.html",
      description: "Would love to text a whole class at once instead of one parent at a time. Rain cancellations take me 20 minutes every time.",
      context: { view: "messages", viewport: { w: 1512, h: 856 }, seconds_on_page: 310, errors: [], clicks: [] },
    },
    context: {},
  },
  {
    id: "t4", client_id: "c4", type: "fix", status: "in_progress", assignee_role: "backlog",
    assigned_to: "s2", title: "Payment link in the welcome text is dead",
    created_at: ago(2900), updated_at: ago(90),
    intake: {
      page: "/client-portal.html",
      description: "Two parents told me the payment link in the welcome text goes to a 404. I tested it myself and it does.",
      context: { view: "home", viewport: { w: 430, h: 932 }, seconds_on_page: 95, errors: [], clicks: [{ t: 12, el: "Messages" }] },
    },
    context: {},
  },
  {
    id: "t5", client_id: "c2", type: "feature_idea", status: "closed", assignee_role: "backlog",
    assigned_to: "s1", title: "Dark mode on the parent app",
    created_at: ago(21000), updated_at: ago(19000),
    intake: { page: "/client-portal.html", description: "Dark mode on the parent app would be nice.", context: {} },
    context: {},
  },
  {
    id: "t6", client_id: "c1", type: "fix", status: "closed", assignee_role: "backlog",
    assigned_to: null, title: "Logo is stretched on the invoice",
    created_at: ago(22000), updated_at: ago(20500),
    intake: { page: "/client-portal.html", description: "Logo is stretched on the invoice pdf.", context: {} },
    context: {},
  },
];

const CLIENTS = [
  { id: "c1", business_name: "We BUILD" },
  { id: "c2", business_name: "BAM GTA" },
  { id: "c3", business_name: "Lij Basketball San Jose" },
  { id: "c4", business_name: "DETAIL Miami" },
];

const STAFF = [
  { id: "s1", name: "Rosano Arandila", role: "admin" },
  { id: "s2", name: "Jenny Babe", role: "systems_executor" },
  { id: "s3", name: "Chris Delos Trinos", role: "systems_executor" },
  { id: "s4", name: "Cam Wells", role: "admin" },
  { id: "s5", name: "Ximena Aguado", role: "marketing_executor" },
];

// Mutable, so a triage in the mock actually removes the row from the lane and
// you can see the queue react the way it will in production.
export const store = { tickets: [...MOCK_TICKETS] };

function result(rows) {
  const chain = {
    select: () => chain,
    eq: () => chain,
    in: () => chain,
    order: () => chain,
    limit: () => Promise.resolve({ data: rows, error: null }),
    then: (fn) => Promise.resolve({ data: rows, error: null }).then(fn),
  };
  return chain;
}

// The four real files on BAM GTA ticket bf1bb1fa, the ones marketing could not
// reach. Shapes copied from the live client_assets rows.
export const CLIENT_ASSETS = [
  { id: "a1", label: "Mentor handshake", category: "photo", mime_type: "image/jpeg", size_bytes: 1452153, storage_path: "gta/mentor-handshake.jpg", link_url: null },
  { id: "a2", label: "Youth drive", category: "photo", mime_type: "image/jpeg", size_bytes: 1106191, storage_path: "gta/youth-drive.jpg", link_url: null },
  { id: "a3", label: "Coach Zoran", category: "photo", mime_type: "image/jpeg", size_bytes: 994385, storage_path: "gta/coach-zoran.jpg", link_url: null },
  { id: "a4", label: "Logo no Background", category: "photo", mime_type: "image/png", size_bytes: 21538, storage_path: "gta/logo.png", link_url: null },
];

// A 3:2 placeholder carrying the file's own name, so each preview is visually
// distinct and it is obvious which asset rendered where.
function svgDataUri(path) {
  const name = path.split("/").pop().replace(/\.[a-z0-9]+$/i, "").replace(/[-_]/g, " ");
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="900" height="600">`
    + `<rect width="900" height="600" fill="#2B2E32"/>`
    + `<text x="450" y="310" font-family="system-ui,sans-serif" font-size="44" fill="#D4B65C"`
    + ` text-anchor="middle">${name}</text></svg>`;
  return `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`;
}

export const supabase = {
  from(table) {
    if (table === "v2_tickets") return result(store.tickets.filter((t) => t.assignee_role === "backlog"));
    if (table === "clients") return result(CLIENTS);
    if (table === "staff") return result(STAFF);
    if (table === "client_assets") return result(CLIENT_ASSETS);
    if (table === "v2_ticket_messages") return result([]);
    return result([]);
  },
  // Mirrors assetPublicUrl's storage_path branch. Inline SVG rather than a
  // remote placeholder service, because the page CSP blocks external images and
  // a broken <img> hides the exact layout this mock exists to check.
  storage: {
    from: () => ({
      getPublicUrl: (p) => ({ data: { publicUrl: svgDataUri(String(p)) } }),
    }),
  },
  channel: () => ({ on() { return this; }, subscribe() { return this; } }),
  removeChannel: () => {},
  auth: { getSession: async () => ({ data: { session: { access_token: "mock" } } }) },
};

export default supabase;
