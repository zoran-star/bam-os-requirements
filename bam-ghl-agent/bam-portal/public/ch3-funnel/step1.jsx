/* ============================================================
   Step 1 — YOUR INFO
   Name, email, phone. One contact = the athlete (or parent signing up on behalf).
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

  return (
    <div className="fbody" key="s1">
      <h1 className="fstep-title">Let{'’'}s get <em>started.</em></h1>
      <p className="fstep-sub">Quick details so Coach Haynes can reach out and lock in your first session.</p>

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

      <div className="reassure">
        <IcLock size={15} />
        <span><b>We never share your info.</b> Your details are used only to set up your training and get in touch.</span>
      </div>
    </div>
  );
}

Object.assign(window, { Step1, validateStep1, fmtPhone, digits });
