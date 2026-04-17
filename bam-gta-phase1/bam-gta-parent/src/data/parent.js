// Parent app mock data
// Logged in as Carlos Martinez (parent of Carlos Jr. + Ana Martinez)

export const PARENT = {
  id: 'p1',
  name: 'Carlos Martinez',
  phone: '416-555-0101',
  email: 'carlos.m@email.com',
  emergencyContactName: 'Maria Martinez',
  emergencyContactNumber: '416-555-0199',
  notificationsEnabled: true,
};

export const CHILDREN = [
  {
    id: 'c1', name: 'Carlos Jr.', age: 10, plan: 'Elevate', planPrice: 199,
    billingCycle: 'monthly', creditsRemaining: 8, creditsTotal: 12,
    nextBilling: '2026-04-27', joinDate: '2025-09-15', group: 1,
    status: 'active',
    upcomingBookings: [
      { id: 'b1', sessionName: 'Monday Older', date: 'Mon, Apr 14', time: '8:00 PM' },
      { id: 'b2', sessionName: 'Thursday Older', date: 'Thu, Apr 17', time: '8:00 PM' },
      { id: 'b3', sessionName: 'Sunday Shooting', date: 'Sun, Apr 20', time: '8:30 AM' },
    ],
    pastSessions: [
      { date: 'Sat, Apr 12', sessionName: 'Saturday All Levels', status: 'attended' },
      { date: 'Thu, Apr 10', sessionName: 'Thursday Advanced', status: 'attended' },
      { date: 'Mon, Apr 7', sessionName: 'Monday Intermediate', status: 'attended' },
      { date: 'Sat, Apr 5', sessionName: 'Saturday All Levels', status: 'attended' },
      { date: 'Thu, Apr 3', sessionName: 'Thursday Advanced', status: 'no_show' },
    ],
  },
  {
    id: 'c2', name: 'Ana Martinez', age: 7, plan: 'Steady', planPrice: 99,
    billingCycle: 'monthly', creditsRemaining: 3, creditsTotal: 4,
    nextBilling: '2026-04-27', joinDate: '2026-01-15', group: 0,
    status: 'active', siblingDiscount: true,
    upcomingBookings: [
      { id: 'b4', sessionName: 'Wednesday Younger', date: 'Wed, Apr 16', time: '7:00 PM' },
    ],
    pastSessions: [
      { date: 'Sat, Apr 12', sessionName: 'Saturday All Levels', status: 'attended' },
      { date: 'Wed, Apr 9', sessionName: 'Wednesday All Levels', status: 'attended' },
    ],
  },
];

export const AVAILABLE_SESSIONS = [
  { id: 'as1', name: 'Monday Younger', day: 'Monday', date: 'Mon, Apr 14', time: '7:00 PM - 8:00 PM', archetype: 'Younger Group', spotsLeft: 4, capacity: 15, creditsCost: 1, location: '1079 Linbrook Rd, ON L6J 2L2', description: 'Skills training for younger athletes.' },
  { id: 'as2', name: 'Monday Older', day: 'Monday', date: 'Mon, Apr 14', time: '8:00 PM - 9:00 PM', archetype: 'Older Group', spotsLeft: 2, capacity: 15, creditsCost: 1, location: '1079 Linbrook Rd, ON L6J 2L2', description: 'Skills training for older athletes.' },
  { id: 'as3', name: 'Tuesday Younger', day: 'Tuesday', date: 'Tue, Apr 15', time: '7:00 PM - 8:00 PM', archetype: 'Younger Group', spotsLeft: 5, capacity: 15, creditsCost: 1, location: '1079 Linbrook Rd, ON L6J 2L2', description: 'Skills training for younger athletes.' },
  { id: 'as4', name: 'Tuesday Older', day: 'Tuesday', date: 'Tue, Apr 15', time: '8:00 PM - 9:00 PM', archetype: 'Older Group', spotsLeft: 3, capacity: 15, creditsCost: 1, location: '1079 Linbrook Rd, ON L6J 2L2', description: 'Skills training for older athletes.' },
  { id: 'as5', name: 'Wednesday Younger', day: 'Wednesday', date: 'Wed, Apr 16', time: '7:00 PM - 8:00 PM', archetype: 'Younger Group', spotsLeft: 6, capacity: 15, creditsCost: 1, location: '1079 Linbrook Rd, ON L6J 2L2', description: 'Skills training for younger athletes.' },
  { id: 'as6', name: 'Wednesday Older', day: 'Wednesday', date: 'Wed, Apr 16', time: '8:00 PM - 9:00 PM', archetype: 'Older Group', spotsLeft: 1, capacity: 15, creditsCost: 1, location: '1079 Linbrook Rd, ON L6J 2L2', description: 'Skills training for older athletes.' },
  { id: 'as7', name: 'Thursday Younger', day: 'Thursday', date: 'Thu, Apr 17', time: '7:00 PM - 8:00 PM', archetype: 'Younger Group', spotsLeft: 5, capacity: 15, creditsCost: 1, location: '1079 Linbrook Rd, ON L6J 2L2', description: 'Skills training for younger athletes.' },
  { id: 'as8', name: 'Thursday Older', day: 'Thursday', date: 'Thu, Apr 17', time: '8:00 PM - 9:00 PM', archetype: 'Older Group', spotsLeft: 4, capacity: 15, creditsCost: 1, location: '1079 Linbrook Rd, ON L6J 2L2', description: 'Skills training for older athletes.' },
  { id: 'as9', name: 'Saturday Younger', day: 'Saturday', date: 'Sat, Apr 19', time: '11:30 AM - 12:30 PM', archetype: 'Younger Group', spotsLeft: 2, capacity: 15, creditsCost: 1, location: '1079 Linbrook Rd, ON L6J 2L2', description: 'Weekend skills training for younger athletes.' },
  { id: 'as10', name: 'Saturday Older', day: 'Saturday', date: 'Sat, Apr 19', time: '12:30 PM - 1:30 PM', archetype: 'Older Group', spotsLeft: 3, capacity: 15, creditsCost: 1, location: '1079 Linbrook Rd, ON L6J 2L2', description: 'Weekend skills training for older athletes.' },
  { id: 'as11', name: 'Sunday Shooting', day: 'Sunday', date: 'Sun, Apr 20', time: '8:30 AM - 10:00 AM', archetype: 'Shooting', spotsLeft: 4, capacity: 20, creditsCost: 1, location: '1080 Linbrook Rd, ON L6J 2L2', description: 'Shooting session - open to all ages.' },
];

export const PAYMENT_METHOD = {
  brand: 'Visa',
  last4: '4242',
  expiry: '08/27',
};

export const BILLING_HISTORY = [
  { id: 'bh1', date: '2026-04-13', description: 'Elevate - Carlos Jr.', amount: 199, status: 'paid' },
  { id: 'bh2', date: '2026-04-13', description: 'Steady - Ana Martinez (50% sibling discount)', amount: 49.50, status: 'paid' },
  { id: 'bh3', date: '2026-03-16', description: 'Elevate - Carlos Jr.', amount: 199, status: 'paid' },
  { id: 'bh4', date: '2026-03-16', description: 'Steady - Ana Martinez (50% sibling discount)', amount: 49.50, status: 'paid' },
  { id: 'bh5', date: '2026-02-16', description: 'Elevate - Carlos Jr.', amount: 199, status: 'paid' },
  { id: 'bh6', date: '2026-02-16', description: 'Steady - Ana Martinez (50% sibling discount)', amount: 49.50, status: 'paid' },
];

export const MESSAGES = [
  { id: 'msg1', from: 'BAM GTA', text: 'Saturday sessions are moved to 11am this week only (April 19). Normal schedule resumes April 26.', time: '1d ago', type: 'announcement' },
  { id: 'msg2', from: 'BAM GTA', text: 'Spring break camp April 21-25! Full day 9am-3pm. $50/day or $200/week. Reply to register.', time: '3d ago', type: 'announcement' },
  { id: 'msg3', from: 'BAM GTA', text: 'Carlos Jr. had a great session today! He\'s really improving his ball handling.', time: '1d ago', type: 'message' },
  { id: 'msg4', from: 'You', text: 'Thanks for the update about Saturday!', time: '10m ago', type: 'message' },
];

export const PLANS = [
  { id: 'steady', name: 'Steady', sessionsPerWeek: 1, price: 99, credits: 4 },
  { id: 'accelerate', name: 'Accelerate', sessionsPerWeek: 2, price: 149, credits: 8 },
  { id: 'elevate', name: 'Elevate', sessionsPerWeek: 3, price: 199, credits: 12 },
  { id: 'dominate', name: 'Dominate', sessionsPerWeek: 'unlimited', price: 249, credits: 'unlimited' },
];
