/* ============================================================
   Step 1 — YOUR INFO
   Name, email, phone + qualifying fields (grade, experience,
   start date, proximity).
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
  if (!f.cFirst || !f.cFirst.trim()) e.cFirst = 'Enter your first name';
  if (!f.cLast  || !f.cLast.trim())  e.cLast  = 'Enter your last name';
  if (!f.cEmail || !f.cEmail.trim()) e.cEmail = 'Enter your email';
  else if (!EMAIL_RE.test(f.cEmail.trim())) e.cEmail = 'Enter a valid email address';
  if (!f.cPhone || !f.cPhone.trim()) e.cPhone = 'Enter your phone number';
  else if (digits(f.cPhone).length !== 10)  e.cPhone = 'Enter a 10-digit phone number';
  if (!f.grade || !f.grade.trim()) e.grade = 'Select a grade';
  if (!f.experienceLevel || !f.experienceLevel.trim()) e.experienceLevel = 'Select an experience level';
  return { errors: e, valid: Object.keys(e).length === 0 };
}

function Step1(props) {
  var f = props.form, setF = props.setForm;
  var showErrors = props.showErrors;
  var v = validateStep1(f);
  var errors = v.errors;
  var ref = React.useState({}); var touched = ref[0], setTouched = ref[1];
  function touch(k) { setTouched(function (t) { var n = Object.assign({}, t); n[k] = true; return n; }); }
  function set(k, val) { var n = Object.assign({}, f); n[k] = val; setF(n); }
  function err(k) { return (showErrors || touched[k]) ? errors[k] : null; }
  function ok(k) { return !errors[k] && (f[k] && String(f[k]).trim().length > 0); }

  var gradeOptions = [
    '5th Grade', '6th Grade', '7th Grade', '8th Grade',
    '9th Grade', '10th Grade', '11th Grade', '12th Grade', 'College',
  ];
  var experienceOptions = ['Beginner', 'Intermediate', 'Advanced'];
  var proximityOptions = [
    'Yes, I can travel there',
    "I'm within 15 min",
    "I'm farther but willing",
    'Not sure yet',
  ];

  return (
    <div className="fbody" key="s1">
      <h1 className="fstep-title">Let{'''}s get <em>started.</em></h1>
      <p className="fstep-sub">Quick details so Coach Haynes can reach out and set up your free session.</p>

      <div className="field__row">
        <Field name="cFirst" label="First name" placeholder="Jordan" autoComplete="given-name"
          value={f.cFirst} onChange={function (x) { set('cFirst', x); }} onBlur={function () { touch('cFirst'); }}
          error={err('cFirst')} valid={ok('cFirst')} />
        <Field name="cLast" label="Last name" placeholder="Williams" autoComplete="family-name"
          value={f.cLast} onChange={function (x) { set('cLast', x); }} onBlur={function () { touch('cLast'); }}
          error={err('cLast')} valid={ok('cLast')} />
      </div>
      <Field name="cEmail" label="Email" type="email" inputMode="email" placeholder="you@email.com" autoComplete="email"
        value={f.cEmail} onChange={function (x) { set('cEmail', x); }} onBlur={function () { touch('cEmail'); }}
        error={err('cEmail')} valid={ok('cEmail')} />
      <Field name="cPhone" label="Phone" type="tel" inputMode="tel" placeholder="(267) 555-0140" autoComplete="tel"
        value={f.cPhone} onChange={function (x) { set('cPhone', fmtPhone(x)); }} onBlur={function () { touch('cPhone'); }}
        error={err('cPhone')} valid={ok('cPhone')} />

      <div className="field__row">
        <SelectField name="grade" label="Grade" placeholder="Select grade"
          value={f.grade} options={gradeOptions}
          onChange={function (x) { set('grade', x); }} onBlur={function () { touch('grade'); }}
          error={err('grade')} valid={ok('grade')} />
        <SelectField name="experienceLevel" label="Experience level" placeholder="Select level"
          value={f.experienceLevel} options={experienceOptions}
          onChange={function (x) { set('experienceLevel', x); }} onBlur={function () { touch('experienceLevel'); }}
          error={err('experienceLevel')} valid={ok('experienceLevel')} />
      </div>

      <Field name="desiredStartDate" label="When do you want to start?" type="date"
        value={f.desiredStartDate}
        onChange={function (x) { set('desiredStartDate', x); }}
        error={null} valid={ok('desiredStartDate')} />

      <SelectField name="proximity" label="Can you get to 625 N Spring St, Middletown PA?" placeholder="Select one"
        value={f.proximity} options={proximityOptions}
        onChange={function (x) { set('proximity', x); }}
        error={null} valid={ok('proximity')} />

      <div className="reassure">
        <IcLock size={15} />
        <span><b>We never share your info.</b> Your details are used only to set up your training and get in touch.</span>
      </div>
    </div>
  );
}

Object.assign(window, { Step1, validateStep1, fmtPhone, digits });
