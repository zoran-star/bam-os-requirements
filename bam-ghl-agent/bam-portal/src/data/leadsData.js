// Mock GHL CRM data — conversations, pipeline, contacts

export const PIPELINE_STAGES = ["New", "Contacted", "Qualified", "Trial Booked", "Trial Complete", "Won", "Lost"];

export const LEADS = [
  { id: "lead-1", name: "Marcus Thompson", phone: "+1 (408) 555-0142", email: "marcus.t@gmail.com", source: "Facebook Ad", stage: "Trial Booked", assignedSM: "Mike", client: "BAM San Jose", lastActivity: "2h ago", createdAt: "2026-03-20", notes: "Parent of 14yo. Interested in summer program." },
  { id: "lead-2", name: "Jessica Ramirez", phone: "+1 (408) 555-0198", email: "jess.ramirez@yahoo.com", source: "Instagram Ad", stage: "New", assignedSM: "Mike", client: "BAM San Jose", lastActivity: "4h ago", createdAt: "2026-03-25", notes: "Clicked trial booking ad. No response to follow-up yet." },
  { id: "lead-3", name: "Kevin Okafor", phone: "+1 (718) 555-0234", email: "kokafor@outlook.com", source: "Google Search", stage: "Qualified", assignedSM: "Zoran", client: "BAM NY", lastActivity: "1d ago", createdAt: "2026-03-18", notes: "Coach looking for academy for his AAU team. High intent." },
  { id: "lead-4", name: "Sarah Kim", phone: "+1 (718) 555-0301", email: "sarahk.hoops@gmail.com", source: "Referral", stage: "Trial Complete", assignedSM: "Zoran", client: "BAM NY", lastActivity: "Today", createdAt: "2026-03-10", notes: "Completed trial. Very positive feedback. Follow-up scheduled." },
  { id: "lead-5", name: "Andre Wilson", phone: "+1 (304) 555-0156", email: "andre.w@hotmail.com", source: "Facebook Ad", stage: "Contacted", assignedSM: "Silva", client: "BAM WV", lastActivity: "3d ago", createdAt: "2026-03-22", notes: "Left voicemail. Texted back 'interested'. Follow up needed." },
  { id: "lead-6", name: "Patricia Morgan", phone: "+1 (713) 555-0189", email: "pmorgan@gmail.com", source: "Instagram Ad", stage: "Trial Booked", assignedSM: "Mike", client: "Prime By Design", lastActivity: "Yesterday", createdAt: "2026-03-21", notes: "Booked trial for Saturday. Son plays JV basketball." },
  { id: "lead-7", name: "Derek Johnson", phone: "+1 (404) 555-0277", email: "djohnson404@gmail.com", source: "Facebook Ad", stage: "Lost", assignedSM: "Zoran", client: "Elite-Smart Athletes", lastActivity: "5d ago", createdAt: "2026-03-15", notes: "Price objection. Said he'd think about it. Went cold." },
  { id: "lead-8", name: "Lisa Chen", phone: "+1 (916) 555-0345", email: "lisachen.coach@gmail.com", source: "Google Search", stage: "New", assignedSM: "Mike", client: "BAM Business", lastActivity: "1h ago", createdAt: "2026-03-26", notes: "Interested in coaching certification. Downloaded free guide." },
  { id: "lead-9", name: "James Rodriguez", phone: "+1 (512) 555-0412", email: "jrod.training@yahoo.com", source: "Facebook Ad", stage: "Contacted", assignedSM: "Graham", client: "Pro Bound Training", lastActivity: "2d ago", createdAt: "2026-03-23", notes: "Responded to ad. Wants info about group training packages." },
  { id: "lead-10", name: "Michelle Brown", phone: "+1 (718) 555-0498", email: "mbrown.nyc@gmail.com", source: "Instagram Ad", stage: "Qualified", assignedSM: "Zoran", client: "BAM NY", lastActivity: "Today", createdAt: "2026-03-24", notes: "Daughter plays travel ball. Looking for off-season skills training." },
  { id: "lead-11", name: "Robert Davis", phone: "+1 (408) 555-0521", email: "rdavis.bball@gmail.com", source: "Facebook Ad", stage: "Won", assignedSM: "Mike", client: "BAM San Jose", lastActivity: "3d ago", createdAt: "2026-03-05", notes: "Signed up for monthly membership. Started last week." },
  { id: "lead-12", name: "Tanya Williams", phone: "+1 (304) 555-0633", email: "twilliams@outlook.com", source: "Referral", stage: "Trial Booked", assignedSM: "Silva", client: "BAM WV", lastActivity: "Yesterday", createdAt: "2026-03-24", notes: "Referred by existing member. Trial this Thursday." },
];

export const CONVERSATIONS = [
  {
    id: "conv-1", contactId: "lead-1", clientName: "Marcus Thompson", client: "BAM San Jose", lastMessage: "Great, see you Saturday at 10am!", lastTimestamp: "2026-03-26T14:30:00Z", unreadCount: 0,
    messages: [
      { id: "m1", direction: "inbound", body: "Hi, I saw your ad about basketball training for my son. He's 14 and plays for his school team.", timestamp: "2026-03-25T09:15:00Z", status: "read", type: "whatsapp" },
      { id: "m2", direction: "outbound", body: "Hey Marcus! Thanks for reaching out. We'd love to have him come in for a trial session. We have openings this Saturday at 10am or 2pm. Which works better?", timestamp: "2026-03-25T09:22:00Z", status: "read", type: "whatsapp" },
      { id: "m3", direction: "inbound", body: "10am works. What should he bring?", timestamp: "2026-03-25T09:45:00Z", status: "read", type: "whatsapp" },
      { id: "m4", direction: "outbound", body: "Just basketball shoes, water bottle, and a positive attitude! We'll provide everything else. I'll send a confirmation with the address.", timestamp: "2026-03-25T09:50:00Z", status: "read", type: "whatsapp" },
      { id: "m5", direction: "inbound", body: "Great, see you Saturday at 10am!", timestamp: "2026-03-26T14:30:00Z", status: "read", type: "whatsapp" },
    ]
  },
  {
    id: "conv-2", contactId: "lead-2", clientName: "Jessica Ramirez", client: "BAM San Jose", lastMessage: "Just sent you a text — let me know if you have any questions!", lastTimestamp: "2026-03-26T10:15:00Z", unreadCount: 1,
    messages: [
      { id: "m6", direction: "outbound", body: "Hi Jessica! I noticed you checked out our trial booking page. Would you like to schedule a free session for your child?", timestamp: "2026-03-25T16:00:00Z", status: "delivered", type: "sms" },
      { id: "m7", direction: "outbound", body: "Just sent you a text — let me know if you have any questions!", timestamp: "2026-03-26T10:15:00Z", status: "delivered", type: "whatsapp" },
    ]
  },
  {
    id: "conv-3", contactId: "lead-3", clientName: "Kevin Okafor", client: "BAM NY", lastMessage: "Can we set up a call to discuss group rates for my AAU team?", lastTimestamp: "2026-03-25T11:20:00Z", unreadCount: 1,
    messages: [
      { id: "m8", direction: "inbound", body: "Hi, I found your academy through Google. I coach an AAU team and I'm looking for a training facility.", timestamp: "2026-03-18T14:00:00Z", status: "read", type: "whatsapp" },
      { id: "m9", direction: "outbound", body: "Hey Kevin! Great to hear from you. We work with several AAU programs here in Brooklyn. How many players are on your roster?", timestamp: "2026-03-18T14:15:00Z", status: "read", type: "whatsapp" },
      { id: "m10", direction: "inbound", body: "We have 12 players, ages 13-15. Looking for 2x/week training.", timestamp: "2026-03-18T15:30:00Z", status: "read", type: "whatsapp" },
      { id: "m11", direction: "outbound", body: "Perfect, we can definitely accommodate that. Let me put together a custom package for you. Are you available for a quick call this week?", timestamp: "2026-03-19T09:00:00Z", status: "read", type: "whatsapp" },
      { id: "m12", direction: "inbound", body: "Can we set up a call to discuss group rates for my AAU team?", timestamp: "2026-03-25T11:20:00Z", status: "read", type: "whatsapp" },
    ]
  },
  {
    id: "conv-4", contactId: "lead-8", clientName: "Lisa Chen", client: "BAM Business", lastMessage: "Hi! I just downloaded your coaching guide. How do I get certified?", lastTimestamp: "2026-03-26T15:45:00Z", unreadCount: 1,
    messages: [
      { id: "m13", direction: "inbound", body: "Hi! I just downloaded your coaching guide. How do I get certified?", timestamp: "2026-03-26T15:45:00Z", status: "read", type: "whatsapp" },
    ]
  },
  {
    id: "conv-5", contactId: "lead-9", clientName: "James Rodriguez", client: "Pro Bound Training", lastMessage: "Thanks for the info! I'll discuss with my wife and get back to you.", lastTimestamp: "2026-03-24T16:00:00Z", unreadCount: 0,
    messages: [
      { id: "m14", direction: "inbound", body: "Hey, saw your Facebook ad about group training. What are the rates?", timestamp: "2026-03-23T10:00:00Z", status: "read", type: "sms" },
      { id: "m15", direction: "outbound", body: "Hi James! Our group sessions are $120/month for 2x/week. We also have a trial offer — first week free! Want me to book you in?", timestamp: "2026-03-23T10:30:00Z", status: "read", type: "sms" },
      { id: "m16", direction: "inbound", body: "Thanks for the info! I'll discuss with my wife and get back to you.", timestamp: "2026-03-24T16:00:00Z", status: "read", type: "sms" },
    ]
  },
  {
    id: "conv-6", contactId: "lead-5", clientName: "Andre Wilson", client: "BAM WV", lastMessage: "Interested", lastTimestamp: "2026-03-23T12:00:00Z", unreadCount: 0,
    messages: [
      { id: "m17", direction: "outbound", body: "Hi Andre! Thanks for your interest in BAM WV basketball training. Would you like to schedule a trial session?", timestamp: "2026-03-22T14:00:00Z", status: "read", type: "sms" },
      { id: "m18", direction: "inbound", body: "Interested", timestamp: "2026-03-23T12:00:00Z", status: "read", type: "sms" },
    ]
  },
];
