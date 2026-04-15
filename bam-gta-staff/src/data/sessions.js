// BAM GTA actual schedule
// Skills Training: Mon-Thu 7-9pm, Sat 11:30am-1:30pm
// Sunday Shooting Session: 8:30-10am (different location)

export const SESSION_ARCHETYPES = ['Younger Group', 'Older Group', 'Shooting'];

export const SESSION_TEMPLATES = [
  { id: 'st1', name: 'Monday Younger', day: 'Monday', startTime: '7:00 PM', endTime: '8:00 PM', archetype: 'Younger Group', capacity: 15, location: '1079 Linbrook Rd, ON L6J 2L2', description: 'Skills training for younger athletes.' },
  { id: 'st2', name: 'Monday Older', day: 'Monday', startTime: '8:00 PM', endTime: '9:00 PM', archetype: 'Older Group', capacity: 15, location: '1079 Linbrook Rd, ON L6J 2L2', description: 'Skills training for older athletes.' },
  { id: 'st3', name: 'Tuesday Younger', day: 'Tuesday', startTime: '7:00 PM', endTime: '8:00 PM', archetype: 'Younger Group', capacity: 15, location: '1079 Linbrook Rd, ON L6J 2L2', description: 'Skills training for younger athletes.' },
  { id: 'st4', name: 'Tuesday Older', day: 'Tuesday', startTime: '8:00 PM', endTime: '9:00 PM', archetype: 'Older Group', capacity: 15, location: '1079 Linbrook Rd, ON L6J 2L2', description: 'Skills training for older athletes.' },
  { id: 'st5', name: 'Wednesday Younger', day: 'Wednesday', startTime: '7:00 PM', endTime: '8:00 PM', archetype: 'Younger Group', capacity: 15, location: '1079 Linbrook Rd, ON L6J 2L2', description: 'Skills training for younger athletes.' },
  { id: 'st6', name: 'Wednesday Older', day: 'Wednesday', startTime: '8:00 PM', endTime: '9:00 PM', archetype: 'Older Group', capacity: 15, location: '1079 Linbrook Rd, ON L6J 2L2', description: 'Skills training for older athletes.' },
  { id: 'st7', name: 'Thursday Younger', day: 'Thursday', startTime: '7:00 PM', endTime: '8:00 PM', archetype: 'Younger Group', capacity: 15, location: '1079 Linbrook Rd, ON L6J 2L2', description: 'Skills training for younger athletes.' },
  { id: 'st8', name: 'Thursday Older', day: 'Thursday', startTime: '8:00 PM', endTime: '9:00 PM', archetype: 'Older Group', capacity: 15, location: '1079 Linbrook Rd, ON L6J 2L2', description: 'Skills training for older athletes.' },
  { id: 'st9', name: 'Saturday Younger', day: 'Saturday', startTime: '11:30 AM', endTime: '12:30 PM', archetype: 'Younger Group', capacity: 15, location: '1079 Linbrook Rd, ON L6J 2L2', description: 'Weekend skills training for younger athletes.' },
  { id: 'st10', name: 'Saturday Older', day: 'Saturday', startTime: '12:30 PM', endTime: '1:30 PM', archetype: 'Older Group', capacity: 15, location: '1079 Linbrook Rd, ON L6J 2L2', description: 'Weekend skills training for older athletes.' },
  { id: 'st11', name: 'Sunday Shooting', day: 'Sunday', startTime: '8:30 AM', endTime: '10:00 AM', archetype: 'Shooting', capacity: 20, location: '1080 Linbrook Rd, ON L6J 2L2', description: 'Shooting session - open to all ages.' },
];

// This week's session instances (week of April 13, 2026)
export const SESSION_INSTANCES = [
  { id: 'si1', templateId: 'st1', date: '2026-04-14', booked: 11, attended: null, status: 'upcoming' },
  { id: 'si2', templateId: 'st2', date: '2026-04-14', booked: 13, attended: null, status: 'upcoming' },
  { id: 'si3', templateId: 'st3', date: '2026-04-15', booked: 10, attended: null, status: 'upcoming' },
  { id: 'si4', templateId: 'st4', date: '2026-04-15', booked: 12, attended: null, status: 'upcoming' },
  { id: 'si5', templateId: 'st5', date: '2026-04-16', booked: 9, attended: null, status: 'upcoming' },
  { id: 'si6', templateId: 'st6', date: '2026-04-16', booked: 14, attended: null, status: 'upcoming' },
  { id: 'si7', templateId: 'st7', date: '2026-04-17', booked: 10, attended: null, status: 'upcoming' },
  { id: 'si8', templateId: 'st8', date: '2026-04-17', booked: 11, attended: null, status: 'upcoming' },
  { id: 'si9', templateId: 'st9', date: '2026-04-19', booked: 13, attended: null, status: 'upcoming' },
  { id: 'si10', templateId: 'st10', date: '2026-04-19', booked: 12, attended: null, status: 'upcoming' },
  { id: 'si11', templateId: 'st11', date: '2026-04-20', booked: 16, attended: null, status: 'upcoming' },
];

// Attendance records for past sessions
export const ATTENDANCE_RECORDS = [
  { sessionInstanceId: 'past1', templateId: 'st9', date: '2026-04-12', roster: [
    { memberId: 'm1', status: 'attended' },
    { memberId: 'm2', status: 'attended' },
    { memberId: 'm3', status: 'no_show' },
    { memberId: 'm6', status: 'attended' },
    { memberId: 'm9', status: 'attended' },
    { memberId: 'm10', status: 'attended' },
    { memberId: 'm11', status: 'attended' },
  ]},
];

// Waitlist entries
export const WAITLIST = [];
