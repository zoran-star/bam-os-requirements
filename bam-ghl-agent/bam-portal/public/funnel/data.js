/* ============================================================
   BAM GTA Signup Funnel — data model
   All prices CAD. Displayed as "$X + HST" everywhere. HST = 13%.
   Plain JS (no JSX) — loaded before the babel scripts.
   ============================================================ */
(function () {
  var HST_RATE = 0.13;

  // ---- TERMS (commitment ladder) ----
  // months = billed length; default = 3-Month (anchors mid-commitment)
  var TERMS = [
    { id: 'monthly', label: 'Monthly',  short: 'Monthly',  months: 1, save: 0  },
    { id: '3mo',     label: '3-Month',  short: '3-Month',  months: 3, save: 10 },
    { id: '6mo',     label: '6-Month',  short: '6-Month',  months: 6, save: 17 }
  ];

  // ---- PLANS ----
  // monthly      = base $/mo (billed every 4 weeks)
  // perMo        = effective $/mo for each term (prepaid totals / months)
  // total        = prepaid total for the term (monthly term has none)
  // sessions     = sessions per week (null = unlimited)
  var PLANS = [
    {
      id: 'steady', name: 'Steady', freq: '1× per week', sessions: 1,
      monthly: 200,
      term: {
        monthly: { perMo: 200,    total: null },
        '3mo':   { perMo: 180,    total: 540 },
        '6mo':   { perMo: 166.67, total: 1000 }
      },
      includes: ['1 training session / week', 'Skill-development tracking', 'Pause anytime, no penalty']
    },
    {
      id: 'accelerated', name: 'Accelerate', freq: '2× per week', sessions: 2,
      monthly: 280, popular: true,
      term: {
        monthly: { perMo: 280,    total: null },
        '3mo':   { perMo: 252,    total: 756 },
        '6mo':   { perMo: 233.33, total: 1400 }
      },
      includes: ['2 training sessions / week', 'Skill + strength focus', 'Monthly progress report', 'Pause anytime, no penalty']
    },
    {
      id: 'elevate', name: 'Elevate', freq: '3× per week', sessions: 3,
      monthly: 335,
      term: {
        monthly: { perMo: 335,    total: null },
        '3mo':   { perMo: 301.50, total: 904.50 },
        '6mo':   { perMo: 279.17, total: 1675 }
      },
      includes: ['3 training sessions / week', 'Personalized development plan', 'Priority scheduling', 'Pause anytime, no penalty']
    },
    {
      id: 'dominate', name: 'Dominate', freq: 'Unlimited', sessions: null,
      monthly: 565,
      term: {
        monthly: { perMo: 565,    total: null },
        '3mo':   { perMo: 508.50, total: 1525.50 },
        '6mo':   { perMo: 470.83, total: 2825 }
      },
      includes: ['Train as often as you want', 'All sessions + open-gym access', '1:1 coach check-ins', 'Pause anytime, no penalty']
    }
  ];

  // ---- helpers ----
  function getPlan(id) { return PLANS.filter(function (p) { return p.id === id; })[0]; }
  function getTerm(id) { return TERMS.filter(function (t) { return t.id === id; })[0]; }

  // money: 166.666 -> "166.67"; 200 -> "200"; 1000 -> "1,000"
  function money(n) {
    var rounded = Math.round(n * 100) / 100;
    var hasCents = Math.abs(rounded - Math.round(rounded)) > 0.005;
    var s = rounded.toFixed(hasCents ? 2 : 0);
    var parts = s.split('.');
    parts[0] = parts[0].replace(/\B(?=(\d{3})+(?!\d))/g, ',');
    return parts.join('.');
  }
  function dollars(n) { return '$' + money(n); }
  function priceHST(n) { return '$' + money(n) + ' + HST'; }

  // per-session estimate from an effective monthly rate (4 weeks/mo)
  function perSession(plan, perMo) {
    if (!plan.sessions) return null;
    return perMo / (plan.sessions * 4);
  }

  // what is charged today for a (plan, term)
  function charge(plan, termId) {
    var t = plan.term[termId];
    var base = (termId === 'monthly') ? plan.monthly : t.total;
    var hst = base * HST_RATE;
    return { base: base, hst: hst, total: base + hst };
  }

  // date helpers (today is the signup date)
  function fmtDate(d) {
    return d.toLocaleDateString('en-CA', { month: 'long', day: 'numeric', year: 'numeric' });
  }
  function fmtShort(d) {
    return d.toLocaleDateString('en-CA', { month: 'short', day: 'numeric' });
  }
  // local YYYY-MM-DD (avoids the UTC shift toISOString() would introduce)
  function localISO(d) {
    var y = d.getFullYear();
    var m = ('0' + (d.getMonth() + 1)).slice(-2);
    var day = ('0' + d.getDate()).slice(-2);
    return y + '-' + m + '-' + day;
  }
  // parse a 'YYYY-MM-DD' as a LOCAL date (not UTC midnight)
  function fromISO(s) { return new Date(s + 'T00:00:00'); }
  function addWeeks(d, w) { var x = new Date(d); x.setDate(x.getDate() + w * 7); return x; }
  function addMonths(d, m) { var x = new Date(d); x.setMonth(x.getMonth() + m); return x; }

  // age + age-group from a YYYY-MM-DD string
  function ageFrom(dob) {
    if (!dob) return null;
    var b = new Date(dob + 'T00:00:00');
    if (isNaN(b)) return null;
    var now = new Date(2026, 5, 6); // June 6 2026
    var a = now.getFullYear() - b.getFullYear();
    var m = now.getMonth() - b.getMonth();
    if (m < 0 || (m === 0 && now.getDate() < b.getDate())) a--;
    return a;
  }
  function ageGroup(age) {
    if (age == null) return null;
    if (age < 5) return null;
    if (age <= 8) return 'U8 · Foundations';
    if (age <= 11) return 'U11 · Development';
    if (age <= 14) return 'U14 · Advanced';
    if (age <= 18) return 'U18 · Elite';
    return 'Adult · Pro Track';
  }

  window.BAM = {
    HST_RATE: HST_RATE,
    TERMS: TERMS, PLANS: PLANS,
    getPlan: getPlan, getTerm: getTerm,
    money: money, dollars: dollars, priceHST: priceHST,
    perSession: perSession, charge: charge,
    fmtDate: fmtDate, fmtShort: fmtShort, localISO: localISO, fromISO: fromISO,
    addWeeks: addWeeks, addMonths: addMonths,
    ageFrom: ageFrom, ageGroup: ageGroup,
    TODAY: new Date(2026, 5, 6)
  };
})();
