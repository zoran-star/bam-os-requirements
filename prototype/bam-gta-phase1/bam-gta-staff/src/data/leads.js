// BAM GTA lead pipeline data
// Stages: Interested -> Booked Trial -> Done Trial -> Won / Lost
// Per PRD #1: Kanban only, duplicate detection, circuit breaker on inbound

export const PIPELINE_STAGES = [
  { id: 'interested', label: 'Interested', color: 'var(--blue)' },
  { id: 'responded', label: 'Responded', color: 'var(--gold)' },
  { id: 'booked_trial', label: 'Booked Trial', color: 'var(--warn)' },
  { id: 'done_trial', label: 'Done Trial', color: 'var(--green)' },
];

export const LEADS = [
  {
    id: 'l1', stage: 'interested', parentName: 'Marcus Johnson Sr.', childName: 'Marcus Jr.', childAge: 9,
    phone: '416-555-0201', email: 'marcus.j@email.com', source: 'Instagram',
    goal: 'Build confidence and discipline', budget: '$150/mo',
    skillLevel: 'Beginner', daysAvailable: 'Weekends', nearOakville: true, startTimeline: 'Immediately',
    notes: 'Dad coaches little league, very motivated',
    lastActivity: '4h ago', needsAttention: false, leadSalesPerson: 's3',
    messages: [
      { from: 'parent', text: 'Hi! I saw your ad on Instagram.', time: '2d ago' },
      { from: 'staff', text: "Hey Marcus! We'd love to have your son try a class. We have spots this Saturday at 10am - would that work?", time: '2d ago', sender: 'Filip' },
      { from: 'parent', text: 'That works! What age groups do you have?', time: '1d ago' },
      { from: 'staff', text: 'We run sessions for different skill levels. Your son would fit right in with our beginner-intermediate group.', time: '4h ago', sender: 'Filip' },
    ],
  },
  {
    id: 'l2', stage: 'responded', parentName: 'Wei Chen', childName: 'Sarah Chen', childAge: 7,
    phone: '416-555-0202', email: 'wei.chen@email.com', source: 'Referral',
    goal: 'Social skills and teamwork', budget: '$130/mo',
    skillLevel: 'Beginner', daysAvailable: 'Sat & Sun', nearOakville: true, startTimeline: 'Immediately',
    notes: 'Friend of existing member Ava Chen',
    lastActivity: '1d ago', needsAttention: false, leadSalesPerson: 's2',
    messages: [
      { from: 'parent', text: 'Ava Chen\'s mom recommended your program. Do you have openings for 7-year-olds?', time: '2d ago' },
      { from: 'staff', text: 'Absolutely! We have a few spots in our younger group. Would you like to schedule a free trial?', time: '2d ago', sender: 'Adrian' },
      { from: 'parent', text: 'Yes please! Weekends work best for us.', time: '1d ago' },
    ],
  },
  {
    id: 'l3', stage: 'responded', parentName: 'Carmen Ortiz', childName: 'David Ortiz Jr.', childAge: 11,
    phone: '416-555-0203', email: 'carmen.o@email.com', source: 'Facebook',
    goal: 'Compete at regional level', budget: '$200/mo',
    skillLevel: 'Intermediate', daysAvailable: 'Weekdays after 4pm', nearOakville: false, startTimeline: 'Immediately',
    notes: 'Has prior soccer experience, transitioning to basketball',
    lastActivity: '3d ago', needsAttention: true, leadSalesPerson: 's1',
    messages: [
      { from: 'parent', text: 'My son wants to get serious about basketball. Do you do competitive training?', time: '5d ago' },
      { from: 'staff', text: 'Yes! We have sessions focused on competitive development. Would you like to book a trial?', time: '5d ago', sender: 'Zoran' },
      { from: 'parent', text: 'Sounds great, what are the rates?', time: '4d ago' },
      { from: 'staff', text: 'Our Elevate plan (3x/week) is $199/mo. Want to book a trial this week?', time: '3d ago', sender: 'Zoran' },
    ],
  },
  {
    id: 'l4', stage: 'booked_trial', parentName: 'Emily Watson', childName: 'Lily Watson', childAge: 8,
    phone: '416-555-0204', email: 'emily.w@email.com', source: 'Google',
    goal: 'After-school activity', budget: '$140/mo',
    skillLevel: 'Beginner', daysAvailable: 'Weekdays 3:30-5pm', nearOakville: true, startTimeline: 'Immediately',
    notes: 'Looking for something close to school',
    lastActivity: '6h ago', needsAttention: false, leadSalesPerson: 's2',
    trialDate: '2026-04-14', trialTime: '4:30 PM', trialSession: 'Monday Beginner',
    messages: [
      { from: 'parent', text: 'Can we reschedule the trial to Saturday morning instead?', time: '6h ago' },
      { from: 'staff', text: 'Of course! I have 9am or 10:30am available this Saturday. Which works better?', time: '6h ago', sender: 'Adrian' },
      { from: 'parent', text: '10:30 would be perfect, thank you!', time: '6h ago' },
    ],
  },
  {
    id: 'l5', stage: 'booked_trial', parentName: 'Rachel Thompson', childName: 'Mia Thompson', childAge: 8,
    phone: '416-555-0205', email: 'rachel.th@email.com', source: 'Instagram',
    goal: 'Fun and fitness', budget: '$120/mo',
    skillLevel: 'Beginner', daysAvailable: 'Saturday mornings', nearOakville: true, startTimeline: 'Immediately',
    notes: 'Trial booked for today 10am',
    lastActivity: '1h ago', needsAttention: false, leadSalesPerson: 's3',
    trialDate: '2026-04-13', trialTime: '10:00 AM', trialSession: 'Saturday All Levels',
    messages: [
      { from: 'parent', text: "We're so excited for today! What should Mia bring?", time: '3h ago' },
      { from: 'staff', text: 'Just comfortable athletic clothes and sneakers! Water bottles provided. See you at 10am!', time: '2h ago', sender: 'Filip' },
      { from: 'parent', text: 'Perfect, see you soon!', time: '1h ago' },
    ],
  },
  {
    id: 'l6', stage: 'booked_trial', parentName: 'James Park', childName: 'Liam Park', childAge: 10,
    phone: '416-555-0206', email: 'james.p2@email.com', source: 'Website',
    goal: 'Build skills and have fun', budget: '$160/mo',
    skillLevel: 'Intermediate', daysAvailable: 'Weekday evenings', nearOakville: true, startTimeline: '2 weeks',
    notes: 'Plays rec league, wants more structured training',
    lastActivity: '4h ago', needsAttention: false, leadSalesPerson: 's1',
    trialDate: '2026-04-18', trialTime: '5:30 PM', trialSession: 'Friday Intermediate',
    messages: [
      { from: 'parent', text: 'Confirming Liam for Friday at 5:30. Is parking available?', time: '1d ago' },
      { from: 'staff', text: 'Confirmed! Yes, free parking in the lot behind the building.', time: '1d ago', sender: 'Zoran' },
      { from: 'parent', text: 'Great, thanks!', time: '4h ago' },
    ],
  },
  {
    id: 'l7', stage: 'done_trial', parentName: 'Carlos Martinez', childName: 'Ava Martinez', childAge: 10,
    phone: '416-555-0207', email: 'carlos.ma@email.com', source: 'Instagram',
    goal: 'Competitive development', budget: '$175/mo',
    skillLevel: 'Intermediate', daysAvailable: 'Tue/Thu/Sat', nearOakville: true, startTimeline: 'Immediately',
    notes: 'Loved the trial, asking about membership options',
    lastActivity: '1d ago', needsAttention: true, leadSalesPerson: 's3',
    trialDate: '2026-04-12', trialCompleted: true,
    postTrialForm: { attended: true, goodFit: true, leadSalesPerson: 's3', notes: 'Very athletic, picked up drills quickly. Parent enthusiastic about membership.' },
    messages: [
      { from: 'parent', text: 'Ava loved the trial! What are the membership options?', time: '1d ago' },
      { from: 'staff', text: "So glad! Our Accelerate plan (2x/week) is $149/mo or Elevate (3x/week) is $199/mo. Both include access to open sessions.", time: '1d ago', sender: 'Filip' },
      { from: 'parent', text: 'The Elevate sounds good. Can we start next week?', time: '1d ago' },
    ],
  },
  {
    id: 'l8', stage: 'done_trial', parentName: 'Susan Kim', childName: 'Noah Kim', childAge: 12,
    phone: '416-555-0208', email: 'susan.k@email.com', source: 'Google',
    goal: 'Pre-season conditioning', budget: '$200/mo',
    skillLevel: 'Advanced', daysAvailable: 'Mon/Wed/Fri after school', nearOakville: true, startTimeline: 'Immediately',
    notes: 'Just finished trial today, very enthusiastic',
    lastActivity: '2h ago', needsAttention: false, leadSalesPerson: 's1',
    trialDate: '2026-04-13', trialCompleted: true,
    postTrialForm: { attended: true, goodFit: true, leadSalesPerson: 's1', notes: 'Strong fundamentals. Wants to prep for school tryouts in 6 weeks.' },
    messages: [
      { from: 'parent', text: 'Noah had a blast! When can he start regular sessions?', time: '2h ago' },
      { from: 'staff', text: "Welcome! I'll send over the onboarding link right now so you can pick a plan and get started.", time: '1h ago', sender: 'Zoran' },
    ],
  },
  {
    id: 'l9', stage: 'booked_trial', parentName: 'Tom Davis', childName: 'Chloe Davis', childAge: 11,
    phone: '416-555-0209', email: 'tom.d@email.com', source: 'Facebook',
    goal: 'Stay active year-round', budget: '$140/mo',
    skillLevel: 'Beginner', daysAvailable: 'Weekends only', nearOakville: true, startTimeline: 'Immediately',
    notes: 'Also does swimming, looking for weekend-only option',
    lastActivity: '2d ago', needsAttention: false, leadSalesPerson: 's2',
    trialDate: '2026-04-11', trialCompleted: true, // trial happened but form not yet filled
    postTrialForm: null,
    messages: [
      { from: 'parent', text: 'Chloe had a great time. Do you have a weekend-only plan?', time: '2d ago' },
      { from: 'staff', text: 'Our Steady plan is $99/mo for 1x/week - perfect for weekends. Want me to send the signup link?', time: '2d ago', sender: 'Adrian' },
      { from: 'parent', text: "Let me talk to my wife and get back to you.", time: '2d ago' },
    ],
  },
];

// Ghosted leads (PRD #4 - nurture automations)
export const GHOSTED_LEADS = [
  { id: 'g1', parentName: 'Mike Rivera', childName: 'Jake Rivera', phone: '416-555-0210', lastContact: '5d ago', sequenceStep: 2, sequenceName: 'Ghosted SMS', nextMessage: 'in 2 days' },
  { id: 'g2', parentName: 'Diana Foster', childName: 'Ryan Foster', phone: '416-555-0211', lastContact: '8d ago', sequenceStep: 3, sequenceName: 'Ghosted SMS', nextMessage: 'Final message in 1 day' },
];

// Lost trials (PRD #3)
export const LOST_TRIALS = [
  { id: 'lt1', parentName: 'Kevin Brown', childName: 'Aiden Brown', reason: 'Too expensive', trialDate: '2026-03-28', notes: 'Wanted unlimited for under $150' },
  { id: 'lt2', parentName: 'Amy Lee', childName: 'Grace Lee', reason: 'Schedule conflict', trialDate: '2026-03-15', notes: 'Only available Sundays, no Sunday sessions' },
];
