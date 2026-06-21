/* ============================================================
   CH3 Training — funnel data
   All prices USD. No sales tax.
   Plain JS (no JSX) — loaded before the babel scripts.
   ============================================================ */
(function () {

  // 3 active membership plans — 6-month commitment model
  var PLANS = [
    {
      id: 'train1x',
      name: 'Train 1x/Week',
      price_usd: 165,
      billing: 'monthly',
      frequency: '1x / week',
      sessions_per_month: 4,
      popular: false,
      sold_out: false,
      description: 'One focused session per week. Build the habit and the fundamentals.',
      includes: [
        '1 skills session/week · groups of max 9',
        'Strength & conditioning included',
        'Direct coaching from Coach Haynes',
        'Youth + HS/College groups available',
      ],
    },
    {
      id: 'train2x',
      name: 'Train 2x/Week',
      price_usd: 225,
      billing: 'monthly',
      frequency: '2x / week',
      sessions_per_month: 8,
      popular: true,
      sold_out: false,
      description: 'Double the reps, double the development. For athletes chasing a starting spot.',
      includes: [
        '2 skills sessions/week · groups of max 9',
        'Strength & conditioning included',
        'Double the reps, double the development',
        'Direct coaching from Coach Haynes',
      ],
    },
    {
      id: 'unlimited',
      name: 'Unlimited',
      price_usd: 349,
      billing: 'monthly',
      frequency: 'Unlimited',
      sessions_per_month: null,
      popular: false,
      sold_out: false,
      description: 'Maximum reps. For athletes serious about a college or pro pathway.',
      includes: [
        'Unlimited sessions · max 9 per group',
        'Strength & conditioning included',
        'Maximum reps for serious college-track athletes',
        'Direct coaching from Coach Haynes',
      ],
    },
  ];

  // Prepay amounts by plan ID and commitment length
  var COMMITMENTS = {
    'train1x':   { '3m': 450,  '6m': 795  },
    'train2x':   { '3m': 605,  '6m': 1080 },
    'unlimited': { '3m': 945,  '6m': 1675 },
  };

  function getPlan(id) {
    return PLANS.filter(function (p) { return p.id === id; })[0];
  }

  function money(n) {
    var rounded = Math.round(n * 100) / 100;
    var hasCents = Math.abs(rounded - Math.round(rounded)) > 0.005;
    var s = rounded.toFixed(hasCents ? 2 : 0);
    var parts = s.split('.');
    parts[0] = parts[0].replace(/\B(?=(\d{3})+(?!\d))/g, ',');
    return parts.join('.');
  }
  function dollars(n) { return '$' + money(n); }

  // Returns { base, total } based on commitment
  // commitment: null | 'monthly' | '3m' | '6m'
  function charge(plan, commitment) {
    var base;
    if (commitment === '3m') {
      base = COMMITMENTS[plan.id]['3m'];
    } else if (commitment === '6m') {
      base = COMMITMENTS[plan.id]['6m'];
    } else {
      base = plan.price_usd;
    }
    return { base: base, total: base };
  }

  function ageFrom(dob) {
    if (!dob) return null;
    var b = new Date(dob + 'T00:00:00');
    if (isNaN(b)) return null;
    var now = new Date();
    var a = now.getFullYear() - b.getFullYear();
    var m = now.getMonth() - b.getMonth();
    if (m < 0 || (m === 0 && now.getDate() < b.getDate())) a--;
    return a;
  }

  window.CH3 = {
    PLANS: PLANS,
    COMMITMENTS: COMMITMENTS,
    getPlan: getPlan,
    money: money,
    dollars: dollars,
    charge: charge,
    ageFrom: ageFrom,
    TODAY: new Date(),
  };
})();
