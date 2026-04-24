// Mock SOP data — structured to match Notion page content

export const SOP_CATEGORIES = [
  { id: "sales", label: "Sales" },
  { id: "cultural", label: "Cultural Standards" },
  { id: "communication", label: "General Communication" },
  { id: "decisions", label: "Decision Making" },
  { id: "internal", label: "Internal SOPs" },
  { id: "sm", label: "SM SOPs" },
  { id: "general", label: "General SOPs" },
  { id: "coachiq", label: "CoachIQ SOPs" },
  { id: "access", label: "Access SOPs" },
  { id: "products", label: "Products" },
];

export const SOPS = [
  {
    id: "sop-1", title: "New Client Onboarding Checklist", category: "general",
    notionPageId: "2f65aca8ac0f80ea87abcd3f170999ee",
    lastUpdated: "2026-03-15",
    content: `## New Client Onboarding Checklist

### Phase 1: Sales Handover (Day 1)
- Confirm contract is signed and filed
- Create client project in Asana
- Set up GHL sub-account and pipeline
- Send welcome email with SM introduction

### Phase 2: SM Intro (Day 2-3)
- Schedule and complete SM intro call
- Review client goals and expectations
- Set communication preferences (WhatsApp/email frequency)
- Share onboarding timeline with client

### Phase 3: Systems Setup (Week 1-2)
- Purchase phone number in GHL
- Add client domain and configure DNS
- Build initial systems draft
- Review systems draft with client
- Finalize systems and go live
- Set up additional automations as needed

### Phase 4: Content (Week 2-3)
- Create content plan based on client brand
- Review content calendar with client
- Begin content production pipeline

### Phase 5: Paid Ads (Week 3-4)
- Create ad account and set budgets
- Build initial ad creative draft
- Review ads with client
- Launch ads and monitor first 48 hours`
  },
  {
    id: "sop-2", title: "Weekly SM Check-in Call Guide", category: "general",
    notionPageId: "2f65aca8ac0f80ea87abcd3f170999ee",
    lastUpdated: "2026-03-10",
    content: `## Weekly SM Check-in Call Guide

### Before the Call
1. Review client KPIs in GHL dashboard
2. Check ad performance for the week
3. Review open action items in Notion
4. Prepare 2-3 talking points

### Call Structure (30 min)
1. **Wins review** (5 min) — start positive, highlight metrics
2. **KPI walkthrough** (10 min) — leads, trials, conversions, revenue
3. **Action item review** (10 min) — update statuses, assign new items
4. **Next steps** (5 min) — confirm tasks and deadlines

### After the Call
1. Update action items in Notion
2. Send summary message via WhatsApp
3. Update client health score if needed
4. Log call in GHL contact notes`
  },
  {
    id: "sop-3", title: "Client Health Score Assessment", category: "general",
    notionPageId: "2f65aca8ac0f80ea87abcd3f170999ee",
    lastUpdated: "2026-03-20",
    content: `## Client Health Score Assessment

### Scoring Criteria (0-100)

**Ad Performance (30 points)**
- Leads above benchmark: +15
- CPL below $25: +10
- ROAS above 5x: +5

**Communication (25 points)**
- Responds within 24h: +10
- Attends weekly calls: +10
- Proactively reaches out: +5

**Systems Usage (20 points)**
- All automations active: +10
- Pipeline up to date: +5
- Content calendar followed: +5

**Growth Trajectory (25 points)**
- Revenue growing MoM: +10
- Lead count increasing: +10
- Positive sentiment in calls: +5

### Health Statuses
- **Healthy** (70-100): On track, no intervention needed
- **At Risk** (40-69): Needs proactive check-in and strategy adjustment
- **Critical** (0-39): Immediate intervention required — escalate to admin`
  },
  {
    id: "sop-4", title: "Red Alert Escalation Process", category: "general",
    notionPageId: "2f65aca8ac0f80ea87abcd3f170999ee",
    lastUpdated: "2026-03-12",
    content: `## Red Alert Escalation Process

### What Triggers a Red Alert
- Client explicitly unhappy or threatening to cancel
- Ads not running for 5+ days with no explanation
- No contact for 7+ days despite outreach
- Critical system failure affecting client operations

### Escalation Steps
1. **Immediately** — Flag in portal + notify SM Manager via Slack
2. **Within 2 hours** — SM Manager reviews and assigns priority
3. **Within 24 hours** — Resolution call scheduled with client
4. **Within 48 hours** — Resolution implemented and verified
5. **Within 1 week** — Follow-up to confirm issue resolved`
  },
  {
    id: "sop-5", title: "CoachIQ Platform Setup", category: "coachiq",
    notionPageId: "2f65aca8ac0f80ea87abcd3f170999ee",
    lastUpdated: "2026-02-28",
    content: `## CoachIQ Platform Setup

### Prerequisites
- Client has active GHL sub-account
- Client brand assets uploaded (logo, colors, fonts)
- Content plan approved by client

### Setup Steps
1. Create CoachIQ workspace for client
2. Configure branding and color scheme
3. Set up athlete profiles template
4. Connect workout builder
5. Enable progress tracking
6. Configure parent/athlete portal access
7. Test all features with dummy data
8. Walk client through platform
9. Go live and monitor first week`
  },
  {
    id: "sop-6", title: "CoachIQ Content Integration", category: "coachiq",
    notionPageId: "2f65aca8ac0f80ea87abcd3f170999ee",
    lastUpdated: "2026-03-05",
    content: `## CoachIQ Content Integration

### Content Types Supported
- Workout programs (video + text)
- Drill libraries
- Film study assignments
- Progress check-ins

### Integration Steps
1. Map client's existing content to CoachIQ format
2. Upload video content to CDN
3. Create program templates
4. Set up automated content delivery schedule
5. Enable athlete completion tracking`
  },
  {
    id: "sop-7", title: "GHL Access & Permissions", category: "access",
    notionPageId: "2f65aca8ac0f8083a97bdc3938ed5f32",
    lastUpdated: "2026-03-01",
    content: `## GHL Access & Permissions

### User Roles
- **Agency Admin**: Full access to all sub-accounts (Coleman, Admin only)
- **SM**: Access to assigned client sub-accounts only
- **Client**: Limited access to their own dashboard (optional)

### Setting Up SM Access
1. Navigate to Agency Settings > Team
2. Add SM email and assign role
3. Grant access to specific sub-accounts only
4. Enable relevant permissions (contacts, conversations, marketing)
5. Disable sensitive permissions (billing, agency settings)

### Revoking Access
- Remove user from team immediately upon role change
- Document access changes in Notion`
  },
  {
    id: "sop-8", title: "Stripe & Billing Access", category: "access",
    notionPageId: "2f65aca8ac0f8083a97bdc3938ed5f32",
    lastUpdated: "2026-02-15",
    content: `## Stripe & Billing Access

### Who Has Access
- Coleman: Full admin
- Admin Manager: Read-only dashboard access

### SMs Do NOT Get Stripe Access
- Financial data is viewed through the portal Financials tab
- Any billing issues should be escalated to admin

### Client Payment Setup
1. Create Stripe customer record
2. Set up subscription (Accelerator or Foundations tier)
3. Enable automatic billing
4. Send payment confirmation to client
5. Monitor for failed payments weekly`
  },
];
