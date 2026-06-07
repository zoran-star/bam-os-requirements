/* ============================================================
   Step 1 — WHO'S SIGNING UP
   Parent (first, last, email, mobile) + Athlete (first, last, DOB).
   Inline validation; Continue gated on validity (handled in App).
   ============================================================ */

var EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

function digits(s) { return (s || '').replace(/\D/g, ''); }
function fmtPhone(s) {
  var d = digits(s).slice(0, 10);
  if (d.length === 0) return '';
  if (d.length < 4) return '(' + d;
  if (d.length < 7) return '(' + d.slice(0, 3) + ') ' + d.slice(3);
  return '(' + d.slice(0, 3) + ') ' + d.slice(3, 6) + '-' + d.slice(6);
}

function validateStep1(f) {
  var e = {};
  if (!f.pFirst || !f.pFirst.trim()) e.pFirst = 'Enter your first name';
  if (!f.pLast || !f.pLast.trim()) e.pLast = 'Enter your last name';
  if (!f.pEmail || !f.pEmail.trim()) e.pEmail = 'Enter your email';
  else if (!EMAIL_RE.test(f.pEmail.trim())) e.pEmail = 'Enter a valid email address';
  if (!f.pMobile || !f.pMobile.trim()) e.pMobile = 'Enter your mobile number';
  else if (digits(f.pMobile).length !== 10) e.pMobile = 'Enter a 10-digit mobile number';
  if (!f.aFirst || !f.aFirst.trim()) e.aFirst = 'Enter the athlete\u2019s first name';
  if (!f.aDob || !/^\d{4}-\d{2}-\d{2}$/.test(f.aDob)) e.aDob = 'Select a date of birth';
  else {
    var age = window.BAM.ageFrom(f.aDob);
    if (age == null) e.aDob = 'Enter a valid date';
    else if (age < 5) e.aDob = 'Athletes must be at least 5 years old';
    else if (age > 18) e.aDob = 'This program is for athletes up to 18';
  }
  return { errors: e, valid: Object.keys(e).length === 0 };
}

/* --- Date of birth: Year -> Month -> Day, in that order --- */
var MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
function daysInMonth(year, month1) {
  if (!year || !month1) return 31;
  return new Date(Number(year), Number(month1), 0).getDate();
}
function DobPicker(props) {
  var parts = (props.value || '').split('-'); // [YYYY, MM, DD]
  var y = parts[0] || '', m = parts[1] || '', d = parts[2] || '';
  var hasError = !!props.error;

  // birth-year range: athletes ~4–19 today (validation enforces 5–18)
  var thisYear = window.BAM.TODAY.getFullYear();
  var years = [];
  for (var yr = thisYear - 4; yr >= thisYear - 19; yr--) years.push(String(yr));

  var maxDay = daysInMonth(y, m);
  var days = [];
  for (var dd = 1; dd <= maxDay; dd++) days.push(dd < 10 ? '0' + dd : String(dd));

  function emit(ny, nm, nd) {
    // clamp day to the new month length
    var max = daysInMonth(ny, nm);
    if (nd && Number(nd) > max) nd = max < 10 ? '0' + max : String(max);
    props.onChange([ny, nm, nd].join('-'));
  }
  // clearing an earlier field collapses the later ones (lets the user go back)
  function selYear(v) { emit(v, v ? m : '', v ? d : ''); }
  function selMonth(v) { emit(y, v, v ? d : ''); }
  function selDay(v) { emit(y, m, v); }

  function cls(v) { return 'field__select' + (hasError ? ' is-error' : (v ? ' is-valid' : '')); }

  return (
    <div className="dobstack">
      <div className="dobcell">
        <select className={cls(y)} value={y} onChange={function (e) { selYear(e.target.value); }} aria-label="Birth year">
          <option value="">Year</option>
          {years.map(function (yr) { return <option key={yr} value={yr}>{yr}</option>; })}
        </select>
      </div>
      {y && (
        <div className="dobcell">
          <select className={cls(m)} value={m} onChange={function (e) { selMonth(e.target.value); }} aria-label="Birth month">
            <option value="">Month</option>
            {MONTHS.map(function (name, i) {
              var mm = i + 1 < 10 ? '0' + (i + 1) : String(i + 1);
              return <option key={mm} value={mm}>{name}</option>;
            })}
          </select>
        </div>
      )}
      {y && m && (
        <div className="dobcell">
          <select className={cls(d)} value={d} onChange={function (e) { selDay(e.target.value); }} aria-label="Birth day">
            <option value="">Day</option>
            {days.map(function (dd) { return <option key={dd} value={dd}>{Number(dd)}</option>; })}
          </select>
        </div>
      )}
    </div>
  );
}

function Step1(props) {
  var f = props.form, setF = props.setForm;
  var showErrors = props.showErrors;
  var v = validateStep1(f);
  var errors = v.errors;
  var ref = React.useState({}); // touched
  var touched = ref[0], setTouched = ref[1];
  function touch(k) { setTouched(function (t) { var n = Object.assign({}, t); n[k] = true; return n; }); }
  function set(k, val) { var n = Object.assign({}, f); n[k] = val; setF(n); }
  function err(k) { return (showErrors || touched[k]) ? errors[k] : null; }
  function ok(k) { return !errors[k] && (f[k] && String(f[k]).trim().length > 0); }

  var age = window.BAM.ageFrom(f.aDob);
  var group = window.BAM.ageGroup(age);
  var groupValid = !errors.aDob && group;

  return (
    <div className="fbody" key="s1">
      <h1 className="fstep-title">Let{'\u2019'}s get <em>started.</em></h1>
      <p className="fstep-sub">A couple of quick details about you and your athlete. Takes about two minutes.</p>

      <div className="fgroup-label">Parent / Guardian</div>
      <div className="field__row">
        <Field name="pFirst" label="First name" placeholder="Jordan" autoComplete="given-name"
          value={f.pFirst} onChange={function (x) { set('pFirst', x); }} onBlur={function () { touch('pFirst'); }}
          error={err('pFirst')} valid={ok('pFirst')} />
        <Field name="pLast" label="Last name" placeholder="Okafor" autoComplete="family-name"
          value={f.pLast} onChange={function (x) { set('pLast', x); }} onBlur={function () { touch('pLast'); }}
          error={err('pLast')} valid={ok('pLast')} />
      </div>
      <Field name="pEmail" label="Email" type="email" inputMode="email" placeholder="jordan@email.com" autoComplete="email"
        value={f.pEmail} onChange={function (x) { set('pEmail', x); }} onBlur={function () { touch('pEmail'); }}
        error={err('pEmail')} valid={ok('pEmail')} />
      <Field name="pMobile" label="Mobile" type="tel" inputMode="tel" placeholder="(416) 555-0140" autoComplete="tel"
        value={f.pMobile} onChange={function (x) { set('pMobile', fmtPhone(x)); }} onBlur={function () { touch('pMobile'); }}
        error={err('pMobile')} valid={ok('pMobile')} />

      <div className="fgroup-label">Athlete</div>
      <Field name="aFirst" label="First name" placeholder="Maya" autoComplete="off"
        value={f.aFirst} onChange={function (x) { set('aFirst', x); }} onBlur={function () { touch('aFirst'); }}
        error={err('aFirst')} valid={ok('aFirst')} />
      <div className="field" style={{ marginBottom: 14 }}>
        <label className="field__lab">Date of birth</label>
        <DobPicker value={f.aDob} onChange={function (x) { set('aDob', x); touch('aDob'); }} error={err('aDob')} />
        {err('aDob') && (
          <div className="field__msg is-error"><IcWarn /><span>{err('aDob')}</span></div>
        )}
        {groupValid && (
          <div className="agechip"><IcCheck size={12} /> {age} yrs · {group}</div>
        )}
      </div>

      <div className="reassure">
        <IcLock size={15} />
        <span><b>We never share your info.</b> Your details are used only to set up your athlete{'\u2019'}s training and billing.</span>
      </div>
    </div>
  );
}

Object.assign(window, { Step1: Step1, validateStep1: validateStep1, fmtPhone: fmtPhone, digits: digits });
