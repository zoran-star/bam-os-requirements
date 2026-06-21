/* Step 1 — Contact info + qualifying fields + SMS consent */

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
  if (!f.firstName || !f.firstName.trim()) e.firstName = 'Enter first name';
  if (!f.lastName  || !f.lastName.trim())  e.lastName  = 'Enter last name';
  if (!f.email     || !f.email.trim())     e.email     = 'Enter your email';
  else if (!EMAIL_RE.test(f.email.trim())) e.email     = 'Enter a valid email';
  if (!f.phone     || !f.phone.trim())     e.phone     = 'Enter your phone number';
  else if (digits(f.phone).length !== 10)  e.phone     = 'Must be 10 digits';
  if (!f.grade     || !f.grade.trim())     e.grade     = 'Select a grade';
  if (!f.experienceLevel || !f.experienceLevel.trim()) e.experienceLevel = 'Select experience level';
  if (!f.smsConsent) e.smsConsent = 'SMS consent is required to receive your trial session info';
  return { errors: e, valid: Object.keys(e).length === 0 };
}

var GRADE_OPTIONS = [
  '5th Grade','6th Grade','7th Grade','8th Grade',
  '9th Grade','10th Grade','11th Grade','12th Grade','College',
];
var EXP_OPTIONS = ['Beginner','Intermediate','Advanced'];
var PROX_OPTIONS = [
  "I'm within 15 minutes",
  'Yes, I can travel there',
  "I'm farther but willing",
  'Not sure yet',
];

function Step1(props) {
  var f = props.form;
  var setF = props.setForm;
  var showErrors = props.showErrors;
  var v = validateStep1(f);
  var errs = v.errors;

  var touched = React.useState({})[0];
  var setTouched = React.useState({})[1];

  var ref = React.useState({}); var tch = ref[0], setTch = ref[1];
  function touch(k) { setTch(function (t) { var n = Object.assign({}, t); n[k] = true; return n; }); }
  function set(k, val) { setF(function (prev) { var n = Object.assign({}, prev); n[k] = val; return n; }); }
  function err(k) { return (showErrors || tch[k]) ? errs[k] : null; }
  function ok(k)  { return !errs[k] && f[k] && String(f[k]).trim().length > 0; }

  return (
    <div className="fbody">
      <h1 className="fstep-title">Let&rsquo;s get <em>started.</em></h1>
      <p className="fstep-sub">
        Fill in your details and Coach Haynes will reach out within 24 hours to set up your free session.
      </p>

      <div className="field__row">
        <Field name="firstName" label="First name" placeholder="Jordan"
          autoComplete="given-name" value={f.firstName}
          onChange={function (x) { set('firstName', x); }} onBlur={function () { touch('firstName'); }}
          error={err('firstName')} valid={ok('firstName')} />
        <Field name="lastName" label="Last name" placeholder="Williams"
          autoComplete="family-name" value={f.lastName}
          onChange={function (x) { set('lastName', x); }} onBlur={function () { touch('lastName'); }}
          error={err('lastName')} valid={ok('lastName')} />
      </div>

      <Field name="email" label="Email" type="email" inputMode="email"
        placeholder="you@email.com" autoComplete="email" value={f.email}
        onChange={function (x) { set('email', x); }} onBlur={function () { touch('email'); }}
        error={err('email')} valid={ok('email')} />

      <Field name="phone" label="Phone" type="tel" inputMode="tel"
        placeholder="(267) 555-0140" autoComplete="tel" value={f.phone}
        onChange={function (x) { set('phone', fmtPhone(x)); }} onBlur={function () { touch('phone'); }}
        error={err('phone')} valid={ok('phone')} />

      <div className="field__row">
        <SelectField name="grade" label="Grade" placeholder="Select grade"
          value={f.grade} options={GRADE_OPTIONS}
          onChange={function (x) { set('grade', x); }} onBlur={function () { touch('grade'); }}
          error={err('grade')} valid={ok('grade')} />
        <SelectField name="experienceLevel" label="Experience" placeholder="Select level"
          value={f.experienceLevel} options={EXP_OPTIONS}
          onChange={function (x) { set('experienceLevel', x); }} onBlur={function () { touch('experienceLevel'); }}
          error={err('experienceLevel')} valid={ok('experienceLevel')} />
      </div>

      <Field name="desiredStartDate" label="When do you want to start?" type="date"
        value={f.desiredStartDate}
        onChange={function (x) { set('desiredStartDate', x); }}
        error={null} valid={ok('desiredStartDate')} />

      <SelectField name="proximity" label="Can you get to 625 N Spring St, Middletown PA?"
        placeholder="Select one" value={f.proximity} options={PROX_OPTIONS}
        onChange={function (x) { set('proximity', x); }}
        error={null} valid={ok('proximity')} />

      <div className={'consent-box' + ((showErrors && errs.smsConsent) ? ' is-error' : '')} style={{ marginTop: 24 }}>
        <label>
          <input type="checkbox" checked={!!f.smsConsent}
            onChange={function (e) { set('smsConsent', e.target.checked); }} />
          <div className="consent-box__text">
            I agree to receive SMS messages from CH3 Training LLC about my free trial session and training updates.
            Reply <b>STOP</b> to opt out, <b>HELP</b> for help. Msg &amp; data rates may apply. Up to 8 messages/month.{' '}
            <a href="/privacy.html" target="_blank" rel="noopener">Privacy Policy</a>
          </div>
        </label>
        <div className="consent-tcpa">
          By checking this box you consent to receive automated text messages. Consent is not a condition of purchase.
        </div>
      </div>
      {showErrors && errs.smsConsent && (
        <div className="field__error" style={{ marginTop: 4 }}>{errs.smsConsent}</div>
      )}

      <div className="reassure">
        <IcLock size={13} />
        <span><b>We never share your info.</b> Used only to set up your free session.</span>
      </div>
    </div>
  );
}

Object.assign(window, { Step1, validateStep1, fmtPhone, digits });
