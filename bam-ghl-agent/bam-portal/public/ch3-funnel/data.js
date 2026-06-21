/* CH3 Training — onboarding funnel data. Plain JS, loads before JSX. */
(function () {

  var SCHEDULE = {
    youth: {
      label: 'Youth Group',
      ages: 'Grades 5–8',
      times: ['Mon  6:00–7:00 PM', 'Fri  5:45–6:45 PM', 'Sun  5:00–6:00 PM'],
    },
    hs: {
      label: 'HS / College Group',
      ages: 'Grades 9–12 & College',
      times: ['Mon & Wed  7:00–8:00 PM', 'Tue & Thu  6:30–7:30 PM'],
    },
    lift: {
      label: 'Strength & Conditioning',
      ages: 'All members · included',
      times: ['Mon & Wed  4:30–5:30 PM', 'Tue & Thu  5:00–6:00 PM'],
    },
  };

  var YOUTH_GRADES = ['5th Grade', '6th Grade', '7th Grade', '8th Grade'];
  var HS_GRADES    = ['9th Grade', '10th Grade', '11th Grade', '12th Grade', 'College'];

  function getGroup(grade) {
    if (YOUTH_GRADES.indexOf(grade) !== -1) return 'youth';
    if (HS_GRADES.indexOf(grade) !== -1)    return 'hs';
    return null;
  }

  window.CH3 = {
    SCHEDULE: SCHEDULE,
    YOUTH_GRADES: YOUTH_GRADES,
    HS_GRADES: HS_GRADES,
    getGroup: getGroup,
  };

})();
