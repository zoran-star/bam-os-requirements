// BAM GTA member data based on real MEMBERS tab structure
// Plans: Steady (1/wk, $99), Accelerate (2/wk, $149), Elevate (3/wk, $199), Dominate (unlimited, $249)
// Credits per cycle: Steady=4, Accelerate=8, Elevate=12, Dominate=unlimited
// Billing cycles: monthly=4wk, 3-month prepay=12wk, 6-month prepay=24wk

export const PLANS = [
  { id: 'steady', name: 'Steady', sessionsPerWeek: 1, price: 99, credits: 4 },
  { id: 'accelerate', name: 'Accelerate', sessionsPerWeek: 2, price: 149, credits: 8 },
  { id: 'elevate', name: 'Elevate', sessionsPerWeek: 3, price: 199, credits: 12 },
  { id: 'dominate', name: 'Dominate', sessionsPerWeek: 'unlimited', price: 249, credits: 'unlimited' },
];

export const STAFF = [
  { id: 's1', name: 'Zoran Savic', role: 'Owner', initials: 'ZS', connections: 15 },
  { id: 's2', name: 'Adrian', role: 'Staff Member', initials: 'AD', connections: 12 },
  { id: 's3', name: 'Filip', role: 'Staff Member', initials: 'FI', connections: 25 },
  { id: 's4', name: 'Sergio', role: 'Staff Member', initials: 'SE', connections: 2 },
];

export const MEMBERS = [
  { id: 'm1', parentName: 'Carlos Martinez', childName: 'Carlos Jr.', phone: '416-555-0101', email: 'carlos.m@email.com', status: 'active', plan: 'elevate', billingCycle: 'monthly', joinDate: '2025-09-15', nextBilling: '2026-04-27', creditsRemaining: 8, creditsTotal: 12, trainerConnection: 's3', group: 1, health: 'consistent', engagement: 'Highly engaged', sessionsAttended: 38, streak: 4 },
  { id: 'm2', parentName: 'Rachel Thompson', childName: 'Mia Thompson', phone: '416-555-0102', email: 'rachel.t@email.com', status: 'active', plan: 'accelerate', billingCycle: 'monthly', joinDate: '2025-11-03', nextBilling: '2026-04-20', creditsRemaining: 5, creditsTotal: 8, trainerConnection: 's2', group: 1, health: 'consistent', engagement: 'Consistent', sessionsAttended: 24, streak: 3 },
  { id: 'm3', parentName: 'Tom Brooks', childName: 'Jaylen Brooks', phone: '416-555-0103', email: 'tom.b@email.com', status: 'active', plan: 'elevate', billingCycle: '3-month', joinDate: '2025-06-22', nextBilling: '2026-05-10', creditsRemaining: 3, creditsTotal: 12, trainerConnection: 's3', group: 2, health: 'at-risk', engagement: 'Declining - check in', sessionsAttended: 52, streak: 1 },
  { id: 'm4', parentName: 'Maria Reyes', childName: 'Sofia Reyes', phone: '416-555-0104', email: 'maria.r@email.com', status: 'trial', plan: null, billingCycle: null, joinDate: '2026-04-10', nextBilling: null, creditsRemaining: 1, creditsTotal: 1, trainerConnection: 's1', group: null, health: 'consistent', engagement: 'New - trial', sessionsAttended: 1, streak: 1 },
  { id: 'm5', parentName: 'Lisa Nguyen', childName: 'Ethan Nguyen', phone: '416-555-0105', email: 'lisa.n@email.com', status: 'paused', plan: 'steady', billingCycle: 'monthly', joinDate: '2025-08-10', nextBilling: '2026-05-04', creditsRemaining: 0, creditsTotal: 4, trainerConnection: 's2', group: 1, health: 'at-risk', engagement: 'Paused - vacation', sessionsAttended: 18, streak: 0, pauseStart: '2026-03-23', pauseEnd: '2026-04-20', pauseReason: 'Family vacation' },
  { id: 'm6', parentName: 'Wei Chen', childName: 'Ava Chen', phone: '416-555-0106', email: 'wei.c@email.com', status: 'active', plan: 'steady', billingCycle: 'monthly', joinDate: '2026-01-08', nextBilling: '2026-04-22', creditsRemaining: 2, creditsTotal: 4, trainerConnection: 's3', group: 0, health: 'consistent', engagement: 'On track', sessionsAttended: 12, streak: 3 },
  { id: 'm7', parentName: 'Marcus Davis Sr.', childName: 'Marcus Davis Jr.', phone: '416-555-0107', email: 'marcus.d@email.com', status: 'active', plan: 'accelerate', billingCycle: 'monthly', joinDate: '2025-04-14', nextBilling: '2026-04-18', creditsRemaining: 6, creditsTotal: 8, trainerConnection: 's4', group: 2, health: 'at-risk', engagement: 'At risk - payment failed', sessionsAttended: 44, streak: 0, paymentStatus: 'failed', failureDate: '2026-04-04', failureReason: 'Expired card' },
  { id: 'm8', parentName: 'James Park', childName: 'Lily Park', phone: '416-555-0108', email: 'james.p@email.com', status: 'cancelled', plan: null, billingCycle: null, joinDate: '2025-10-01', nextBilling: null, creditsRemaining: 0, creditsTotal: 0, trainerConnection: null, group: null, health: 'at-risk', engagement: 'Cancelled', sessionsAttended: 16, streak: 0, cancelDate: '2026-02-10', cancelReason: 'Moving away' },
  { id: 'm9', parentName: 'Sarah Mitchell', childName: 'Jake Mitchell', phone: '416-555-0109', email: 'sarah.m@email.com', status: 'active', plan: 'dominate', billingCycle: 'monthly', joinDate: '2025-07-20', nextBilling: '2026-04-25', creditsRemaining: 'unlimited', creditsTotal: 'unlimited', trainerConnection: 's1', group: 2, health: 'consistent', engagement: 'Power user', sessionsAttended: 68, streak: 8 },
  { id: 'm10', parentName: 'Amanda Wilson', childName: 'Tyler Wilson', phone: '416-555-0110', email: 'amanda.w@email.com', status: 'active', plan: 'accelerate', billingCycle: '3-month', joinDate: '2025-12-01', nextBilling: '2026-05-15', creditsRemaining: 4, creditsTotal: 8, trainerConnection: 's2', group: 1, health: 'consistent', engagement: 'Steady', sessionsAttended: 28, streak: 2 },
  // Sibling example - same parent, two kids
  { id: 'm11', parentName: 'Carlos Martinez', childName: 'Ana Martinez', phone: '416-555-0101', email: 'carlos.m@email.com', status: 'active', plan: 'steady', billingCycle: 'monthly', joinDate: '2026-01-15', nextBilling: '2026-04-27', creditsRemaining: 3, creditsTotal: 4, trainerConnection: 's2', group: 0, health: 'consistent', engagement: 'New but engaged', sessionsAttended: 10, streak: 2, isSibling: true, siblingDiscount: true },
];

export const FAILED_PAYMENTS = [
  { memberId: 'm7', parentName: 'Marcus Davis Sr.', childName: 'Marcus Davis Jr.', plan: 'Accelerate', amount: 149, failureDate: '2026-04-04', failureReason: 'Expired card', daysSinceFailure: 9, gracePeriodEnds: '2026-04-18', smsSent: true, status: 'failing' },
];
