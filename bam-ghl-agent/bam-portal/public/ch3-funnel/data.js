/* ============================================================
   CH3 Training — funnel data
   All prices USD. No sales tax.
   Plain JS (no JSX) — loaded before the babel scripts.
   ============================================================ */
(function () {

  // edit per client — flip sold_out to true once spots fill
  var PLANS = [
    {
      id: 'min',
      name: 'Min Package',
      price_usd: 165,
      billing: 'monthly',
      frequency: '1x / week',
      sessions_per_month: 4,
      popular: false,
      sold_out: false,
      description: 'One focused session per week. Build the habit and the fundamentals.',
      includes: ['4 group sessions / month', 'Skills & fundamentals', 'Coach feedback each session'],
    },
    {
      id: 'competitive',
      name: 'Competitive Edge',
      price_usd: 225,
      billing: 'monthly',
      frequency: '2x / week',
      sessions_per_month: 8,
      popular: true,
      sold_out: false,
      description: 'Double the reps, double the development. For athletes chasing a starting spot.',
      includes: ['8 group sessions / month', 'Advanced skill progressions', 'Priority scheduling'],
    },
    {
      id: 'allaccess',
      name: 'All-Access',
      price_usd: 349,
      billing: 'monthly',
      frequency: 'Unlimited',
      sessions_per_month: null,
      popular: false,
      sold_out: false,
      description: 'Maximum reps. For athletes serious about a college or pro pathway.',
      includes: ['Unlimited sessions', 'All group programs', 'Video review sessions'],
    },
    {
      id: '1on1',
      name: '1-on-1 Pack',
      price_usd: 320,
      billing: 'one-time',
      frequency: '4 private sessions',
      sessions_per_month: null,
      popular: false,
      sold_out: false,
      description: 'Four private sessions dedicated to your exact skill gaps.',
      includes: ['4 private 1-on-1 sessions', 'Personalized game plan', 'Video breakdown'],
    },
    {
      id: 'speedagility',
      name: 'Speed & Agility',
      price_usd: 35,
      billing: 'one-time',
      frequency: 'Drop-in class',
      sessions_per_month: null,
      popular: false,
      sold_out: false,
      description: 'One class dedicated to quickness, lateral speed, and explosiveness.',
      includes: ['1 class', 'Athletic performance drills', 'Open to all levels'],
    },
  ];

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

  // Returns { base, total } — no tax for US
  function charge(plan) {
    var base = plan.price_usd;
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
    getPlan: getPlan,
    money: money,
    dollars: dollars,
    charge: charge,
    ageFrom: ageFrom,
    TODAY: new Date(),
  };
})();
