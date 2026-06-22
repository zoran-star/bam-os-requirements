/* CH3 Training — Free Trial Onboarding Funnel
   2 steps: contact info → schedule preview → success
   Posts to /api/website/ch3-lead to create GHL contact + Supabase row.
   GHL automation fires from "CH3 Lead" tag → SMS with calendar link. */

var API_URL = '/api/website/ch3-lead';

var EMPTY = {
  firstName: '', lastName: '', email: '', phone: '',
  grade: '', experienceLevel: '', proximity: '',
  smsConsent: false, termsAgreed: false,
};

function App() {
  var ss = React.useState(1); var step = ss[0], setStep = ss[1];
  var ff = React.useState(Object.assign({}, EMPTY)); var form = ff[0], setForm = ff[1];
  var ll = React.useState(false); var loading = ll[0], setLoading = ll[1];
  var ee = React.useState(null); var apiErr = ee[0], setApiErr = ee[1];
  var se = React.useState(false); var showErr1 = se[0], setShowErr1 = se[1];

  React.useEffect(function () {
    window.scrollTo(0, 0);
  }, [step]);

  var s1valid = window.validateStep1(form).valid;

  function submitLead() {
    setShowErr1(true);
    if (!s1valid) return;
    setLoading(true);
    setApiErr(null);
    var payload = {
      firstName: form.firstName.trim(),
      lastName:  form.lastName.trim(),
      email:     form.email.trim(),
      phone:     window.ch3Iti ? window.ch3Iti.getNumber() : form.phone.trim(),
      grade:     form.grade,
      experienceLevel: form.experienceLevel,
      proximity: form.proximity || '',
      smsConsent: !!form.smsConsent,
      consentTimestamp: new Date().toISOString(),
    };
    fetch(API_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    })
      .then(function (r) { return r.json(); })
      .then(function (data) {
        setLoading(false);
        if (data.ok) {
          var group = data.group || window.CH3.getGroup(form.grade) || 'hs';
          var params = 'group=' + encodeURIComponent(group)
            + '&name=' + encodeURIComponent(form.firstName.trim())
            + '&email=' + encodeURIComponent(form.email.trim());
          if (data.contactId) params += '&cid=' + encodeURIComponent(data.contactId);
          window.location.href = '/ch3-funnel/calendar.html?' + params;
        } else {
          setApiErr(data.error || 'Something went wrong. Please try again.');
        }
      })
      .catch(function () {
        setLoading(false);
        setApiErr('Network error. Please check your connection and try again.');
      });
  }

  if (step === 'success') {
    return (
      <div className="funnel">
        <header className="fheader" style={{ position: 'relative' }}>
          <div className="fheader__brand">CH3 <em>TRAINING</em></div>
          <div className="fheader__step">Free Trial</div>
          <div className="fprogress" style={{ position: 'absolute', bottom: 0, left: 0, right: 0 }}>
            <div className="fprogress__fill" style={{ width: '100%' }} />
          </div>
        </header>
        <Success grade={form.grade} />
      </div>
    );
  }

  return (
    <div className="funnel is-step1">
      <header className="fheader" style={{ position: 'relative' }}>
        <div className="fheader__brand">CH3 <em>TRAINING</em></div>
        <div className="fheader__step">Free Trial</div>
        <div className="fprogress" style={{ position: 'absolute', bottom: 0, left: 0, right: 0 }}>
          <div className="fprogress__fill" style={{ width: '50%' }} />
        </div>
      </header>

      <Step1 form={form} setForm={setForm} showErrors={showErr1} onNext={submitLead} />

      <footer className="fcta">
        {apiErr && (
          <div style={{ fontSize: 13, color: 'var(--red)', textAlign: 'center', marginBottom: 4 }}>
            {apiErr}
          </div>
        )}
        <button
          className={'btn-primary' + (loading ? ' is-loading' : '')}
          disabled={loading}
          onClick={submitLead}>
          {loading
            ? <React.Fragment><span className="spinner" /> Saving&hellip;</React.Fragment>
            : 'Book my free trial →'}
        </button>
      </footer>
    </div>
  );
}

ReactDOM.createRoot(document.getElementById('root')).render(<App />);
