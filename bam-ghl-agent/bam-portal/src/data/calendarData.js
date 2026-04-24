// Mock Google Calendar events for the current week

const today = new Date();
const dayOfWeek = today.getDay();
const monday = new Date(today);
monday.setDate(today.getDate() - (dayOfWeek === 0 ? 6 : dayOfWeek - 1));

function dateAt(dayOffset, hour, minute = 0) {
  const d = new Date(monday);
  d.setDate(monday.getDate() + dayOffset);
  d.setHours(hour, minute, 0, 0);
  return d.toISOString();
}

export const CALENDAR_EVENTS = [
  { id: "cal-1", title: "Weekly Check-in — BAM San Jose", client: "BAM San Jose", startTime: dateAt(0, 9, 0), endTime: dateAt(0, 9, 30), type: "call", location: "Zoom" },
  { id: "cal-2", title: "SM Team Standup", client: null, startTime: dateAt(0, 10, 0), endTime: dateAt(0, 10, 30), type: "internal", location: "Google Meet" },
  { id: "cal-3", title: "Onboarding Kickoff — ADAPT SF", client: "ADAPT SF", startTime: dateAt(0, 14, 0), endTime: dateAt(0, 15, 0), type: "call", location: "Zoom" },
  { id: "cal-4", title: "Ad Review — ADAPT SF", client: "ADAPT SF", startTime: dateAt(1, 9, 30), endTime: dateAt(1, 10, 0), type: "review", location: "Zoom" },
  { id: "cal-5", title: "Strategy Call — Johnson Bball", client: "Johnson Bball", startTime: dateAt(1, 11, 0), endTime: dateAt(1, 11, 45), type: "call", location: "Zoom" },
  { id: "cal-6", title: "Systems Intro — BasketballPlus", client: "BasketballPlus", startTime: dateAt(1, 14, 0), endTime: dateAt(1, 15, 0), type: "call", location: "Zoom" },
  { id: "cal-7", title: "Content Calendar Review — Performance Space", client: "Performance Space", startTime: dateAt(2, 9, 0), endTime: dateAt(2, 9, 30), type: "review", location: "Google Meet" },
  { id: "cal-8", title: "Weekly Check-in — BAM WV", client: "BAM WV", startTime: dateAt(2, 10, 0), endTime: dateAt(2, 10, 30), type: "call", location: "Zoom" },
  { id: "cal-9", title: "Monthly KPI Review — BTG", client: "BTG", startTime: dateAt(2, 13, 0), endTime: dateAt(2, 13, 45), type: "review", location: "Zoom" },
  { id: "cal-10", title: "Intervention Call — Elite-Smart Athletes", client: "Elite-Smart Athletes", startTime: dateAt(2, 15, 0), endTime: dateAt(2, 16, 0), type: "call", location: "Zoom" },
  { id: "cal-11", title: "SM Team Planning", client: null, startTime: dateAt(3, 9, 0), endTime: dateAt(3, 10, 0), type: "internal", location: "Google Meet" },
  { id: "cal-12", title: "Weekly Check-in — BAM NY", client: "BAM NY", startTime: dateAt(3, 11, 0), endTime: dateAt(3, 11, 30), type: "call", location: "Zoom" },
  { id: "cal-13", title: "Ad Creative Brief — Straight Buckets", client: "Straight Buckets", startTime: dateAt(3, 14, 0), endTime: dateAt(3, 14, 30), type: "review", location: "Zoom" },
  { id: "cal-14", title: "Renewal Discussion — Danny Cooper Basketball", client: "Danny Cooper Basketball", startTime: dateAt(4, 9, 0), endTime: dateAt(4, 9, 45), type: "call", location: "Zoom" },
  { id: "cal-15", title: "Weekly Check-in — Prime By Design", client: "Prime By Design", startTime: dateAt(4, 10, 30), endTime: dateAt(4, 11, 0), type: "call", location: "Zoom" },
  { id: "cal-16", title: "Ad Performance Review — D.A. Hoops Academy", client: "D.A. Hoops Academy", startTime: dateAt(4, 13, 0), endTime: dateAt(4, 13, 30), type: "review", location: "Zoom" },
  { id: "cal-17", title: "Deadline: Elite Smart Athletes domain setup", client: "Elite Smart Athletes", startTime: dateAt(4, 17, 0), endTime: dateAt(4, 17, 0), type: "deadline", location: null },
  { id: "cal-18", title: "Deadline: Supreme Hoops ads must be live", client: "Supreme Hoops Training", startTime: dateAt(2, 17, 0), endTime: dateAt(2, 17, 0), type: "deadline", location: null },
];
