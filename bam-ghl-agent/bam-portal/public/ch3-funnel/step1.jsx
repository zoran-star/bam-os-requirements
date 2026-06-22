function PhoneInput(props) {
  var ref = React.useRef(null);
  React.useEffect(function() {
    var el = ref.current;
    if (!el || !window.intlTelInput) return;
    window.ch3Iti = window.intlTelInput(el, {
      initialCountry: 'us',
      separateDialCode: true,
      preferredCountries: ['us', 'ca', 'gb', 'jm', 'ng', 'gh', 'tt'],
      countrySearch: true,
      nationalMode: false,
    });
    return function() {
      if (window.ch3Iti) { window.ch3Iti.destroy(); window.ch3Iti = null; }
    };
  }, []);
  return (
    <input ref={ref} id="ch3-phone" type="tel"
      className="field__input" placeholder="Phone number (optional)"
      autoComplete="tel" />
  );
}

var EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

function validateStep1(f) {
  var e = {};
  if (!f.firstName || !f.firstName.trim()) e.firstName = 'Enter first name';
  if (!f.lastName  || !f.lastName.trim())  e.lastName  = 'Enter last name';
  if (!f.email     || !f.email.trim())     e.email     = 'Enter your email';
  else if (!EMAIL_RE.test(f.email.trim())) e.email     = 'Enter a valid email';
  if (!f.grade     || !f.grade.trim())     e.grade     = 'Select a grade';
  if (!f.experienceLevel || !f.experienceLevel.trim()) e.experienceLevel = 'Select experience level';
  return { errors: e, valid: Object.keys(e).length === 0 };
}

function Step1(props) {
  var f = props.form;
  var setF = props.setForm;
  var showErrors = props.showErrors;
  var v = validateStep1(f);
  var errs = v.errors;

  var ref = React.useState({}); var tch = ref[0], setTch = ref[1];
  function touch(k) { setTch(function(t) { var n = Object.assign({}, t); n[k] = true; return n; }); }
  function set(k, val) { setF(function(prev) { var n = Object.assign({}, prev); n[k] = val; return n; }); }
  function err(k) { return (showErrors || tch[k]) ? errs[k] : null; }
  function ok(k)  { return !errs[k] && f[k] && String(f[k]).trim().length > 0; }

  return (
    <div className="fbody s1-split">

      <div className="s1-hero">
        <div className="s1-hero__content">
          <div className="s1-hero__eyebrow">CH3 Training · Harrisburg, PA</div>
          <h1 className="s1-hero__title">YOUR FREE SESSION.</h1>
          <p className="s1-hero__sub">No commitment. No credit card. Just show up.</p>
          <div className="s1-hero__stats">
            <div className="s1-hero__stat">120+ Athletes</div>
            <div className="s1-hero__stat">5 Yrs</div>
            <div className="s1-hero__stat">Cap 9</div>
          </div>
          <blockquote className="s1-hero__quote">
            "Improved my offensive mechanics and translated directly to in-game success." — Gavin M., Northern HS
          </blockquote>
        </div>
      </div>

      <div className="s1-form">
        <div className="s1-form__label">Step 1 of 2</div>
        <h2 className="s1-form__title">Tell us about <em>yourself.</em></h2>
        <p className="s1-form__sub">Coach Haynes will reach out within 24 hours.</p>

        <div className="field__row">
          <div className="field">
            <label className="field__label" htmlFor="s1-fname">First Name *</label>
            <input
              id="s1-fname"
              className={'field__input' + (err('firstName') ? ' is-error' : ok('firstName') ? ' is-valid' : '')}
              type="text" autoComplete="given-name" placeholder="First name"
              value={f.firstName}
              onChange={function(e) { set('firstName', e.target.value); }}
              onBlur={function() { touch('firstName'); }} />
            {err('firstName') && <div className="field__error">{err('firstName')}</div>}
          </div>
          <div className="field">
            <label className="field__label" htmlFor="s1-lname">Last Name *</label>
            <input
              id="s1-lname"
              className={'field__input' + (err('lastName') ? ' is-error' : ok('lastName') ? ' is-valid' : '')}
              type="text" autoComplete="family-name" placeholder="Last name"
              value={f.lastName}
              onChange={function(e) { set('lastName', e.target.value); }}
              onBlur={function() { touch('lastName'); }} />
            {err('lastName') && <div className="field__error">{err('lastName')}</div>}
          </div>
        </div>

        <div className="field">
          <label className="field__label" htmlFor="s1-email">Email *</label>
          <input
            id="s1-email"
            className={'field__input' + (err('email') ? ' is-error' : ok('email') ? ' is-valid' : '')}
            type="email" autoComplete="email" placeholder="you@email.com"
            value={f.email}
            onChange={function(e) { set('email', e.target.value); }}
            onBlur={function() { touch('email'); }} />
          {err('email') && <div className="field__error">{err('email')}</div>}
        </div>

        <div className="field">
          <label className="field__label" htmlFor="ch3-phone">Phone (optional)</label>
          <PhoneInput />
        </div>

        <div className="field">
          <label className="field__label" htmlFor="s1-grade">Grade *</label>
          <select
            id="s1-grade"
            className={'field__input select__input' + (err('grade') ? ' is-error' : ok('grade') ? ' is-valid' : '')}
            value={f.grade}
            onChange={function(e) { set('grade', e.target.value); }}
            onBlur={function() { touch('grade'); }}>
            <option value="">Select grade…</option>
            <option value="5">5th Grade</option>
            <option value="6">6th Grade</option>
            <option value="7">7th Grade</option>
            <option value="8">8th Grade</option>
            <option value="9">9th Grade (Freshman)</option>
            <option value="10">10th Grade (Sophomore)</option>
            <option value="11">11th Grade (Junior)</option>
            <option value="12">12th Grade (Senior)</option>
            <option value="college">College</option>
          </select>
          {err('grade') && <div className="field__error">{err('grade')}</div>}
        </div>

        <div className="field">
          <label className="field__label" htmlFor="s1-exp">Experience Level *</label>
          <select
            id="s1-exp"
            className={'field__input select__input' + (err('experienceLevel') ? ' is-error' : ok('experienceLevel') ? ' is-valid' : '')}
            value={f.experienceLevel}
            onChange={function(e) { set('experienceLevel', e.target.value); }}
            onBlur={function() { touch('experienceLevel'); }}>
            <option value="">Select level…</option>
            <option value="beginner">Beginner — just starting out</option>
            <option value="recreational">Recreational — play for fun</option>
            <option value="school">School team / JV</option>
            <option value="varsity">Varsity</option>
            <option value="aau">AAU / Travel ball</option>
            <option value="college">College athlete</option>
          </select>
          {err('experienceLevel') && <div className="field__error">{err('experienceLevel')}</div>}
        </div>

        <div className="field">
          <label className="field__label" htmlFor="s1-proximity">How far from Middletown, PA? (optional)</label>
          <select
            id="s1-proximity"
            className="field__input select__input"
            value={f.proximity}
            onChange={function(e) { set('proximity', e.target.value); }}>
            <option value="">Select distance…</option>
            <option value="under15">Under 15 min</option>
            <option value="15to30">15–30 min</option>
            <option value="30to60">30–60 min</option>
            <option value="over60">Over 60 min</option>
          </select>
        </div>

        <div className="consent-row">
          <label className="consent-item">
            <input
              type="checkbox"
              checked={!!f.smsConsent}
              onChange={function(e) { set('smsConsent', e.target.checked); }} />
            <span className="consent-item__text">
              Text me about sessions &amp; updates. By checking this box, I consent to receive SMS messages from CH3 Training. Msg &amp; data rates may apply. Up to 8 msgs/month. Reply STOP to opt out, HELP for help. Consent is not a condition of purchase.
            </span>
          </label>

          <label className="consent-item">
            <input
              type="checkbox"
              checked={!!f.termsAgreed}
              onChange={function(e) { set('termsAgreed', e.target.checked); }} />
            <span className="consent-item__text">
              I agree to CH3 Training's <a href="/privacy.html" target="_blank" rel="noopener">Terms of Service</a> and <a href="/privacy.html" target="_blank" rel="noopener">Privacy Policy</a>.
            </span>
          </label>
        </div>

        <div className="reassure" style={{ marginTop: 16 }}>
          <svg width="13" height="13" viewBox="0 0 13 13" fill="none" style={{ flexShrink: 0, marginTop: 1 }}>
            <rect x="2" y="5.5" width="9" height="6.5" rx="1.5" stroke="rgba(255,255,255,0.36)" strokeWidth="1.2" fill="none"/>
            <path d="M4.5 5.5V3.5a2 2 0 014 0v2" stroke="rgba(255,255,255,0.36)" strokeWidth="1.2" strokeLinecap="round" fill="none"/>
          </svg>
          <span>We never share your info.</span>
        </div>

        <button className="btn-primary s1-desktop-cta" style={{ marginTop: 20 }}
          onClick={function() { props.onNext && props.onNext(); }}>
          Book my free trial &rarr;
        </button>
      </div>

    </div>
  );
}

Object.assign(window, { Step1, validateStep1, PhoneInput });
