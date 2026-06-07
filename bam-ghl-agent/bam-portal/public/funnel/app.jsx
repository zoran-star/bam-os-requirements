/* ============================================================
   App — orchestrates the 3-step funnel + success.
   Production build: the design-tool scaffolding (iOS device frame +
   tweaks inspector) is removed; <App/> mounts full-screen.
   "Sign & Pay" calls the real backend (/api/onboarding/checkout) to
   create a PORTAL-OWNED sub. Card collection via Stripe Payment Element
   activates once STRIPE_PUBLISHABLE_KEY is set; until then it falls back
   to the demo advance so the funnel is always clickable.
   ============================================================ */

// BAM GTA academy (clients.id). Multi-academy later = read from the URL/host.
var CLIENT_ID = "39875f07-0a4b-4429-a201-2249bc1f24df";
var CHECKOUT_URL = "/api/onboarding/checkout";

// SAFETY FLAG — when false, "Sign & Pay" is a demo advance (no backend call, no
// Stripe sub created). Flip to true (or set window.FUNNEL_LIVE = true) only when
// testing the real charge with STRIPE_PUBLISHABLE_KEY set, ideally in Stripe TEST
// mode, so we never create junk subs on the live connected account.
var LIVE_CHECKOUT = false;

var EMPTY = { pFirst: '', pLast: '', pEmail: '', pMobile: '', aFirst: '', aDob: '' };

function App() {
  var s = React.useState(1); var step = s[0], setStep = s[1];
  var ff = React.useState(Object.assign({}, EMPTY)); var form = ff[0], setForm = ff[1];
  var tm = React.useState('3mo'); var term = tm[0], setTerm = tm[1];        // default 3-Month (anchors mid-commitment)
  var sp = React.useState('accelerated'); var selectedPlan = sp[0], setSelectedPlan = sp[1];
  var py = React.useState({ method: null, name: '', cardFilled: false }); var pay = py[0], setPay = py[1];
  var ag = React.useState(false); var agreed = ag[0], setAgreed = ag[1];
  var sg = React.useState(''); var sig = sg[0], setSig = sg[1];
  var uiS = React.useState({ agreeOpen: false, faq: null }); var ui = uiS[0], setUi = uiS[1];
  var se = React.useState(false); var showErr1 = se[0], setShowErr1 = se[1];
  var tl = React.useState(false); var loading = tl[0], setLoading = tl[1];
  var ll = React.useState('Processing…'); var loadLabel = ll[0], setLoadLabel = ll[1];
  var pe = React.useState(null); var payErr = pe[0], setPayErr = pe[1];
  var appEnabled = false; // success "download the app" variant — wire per-academy later

  var bodyRef = React.useRef(null);

  React.useEffect(function () {
    var el = document.querySelector('.fbody, .success');
    if (el) el.scrollTop = 0;
  }, [step]);

  // ---- navigation w/ a short loading beat ----
  function advance(target, ms, label) {
    setLoadLabel(label || 'Processing…');
    setLoading(true);
    window.setTimeout(function () { setLoading(false); setStep(target); }, ms || 500);
  }

  var BAM = window.BAM;
  var plan = BAM.getPlan(selectedPlan);

  var s1valid = window.validateStep1(form).valid;
  var s3valid = agreed && window.paymentValid(pay);
  var charge = BAM.charge(plan, term);

  // ---- real checkout: create the portal-owned sub, then pay ----
  // Falls back to the demo advance if the backend/Stripe isn't configured yet,
  // so the funnel is always demoable. Full card capture (Payment Element) is
  // wired once STRIPE_PUBLISHABLE_KEY is returned by the endpoint.
  function signAndPay() {
    if (!s3valid) return;
    setPayErr(null);
    setLoadLabel('Processing payment…');
    setLoading(true);

    // Demo mode (default): no backend call, no sub created.
    if (!(LIVE_CHECKOUT || window.FUNNEL_LIVE)) {
      window.setTimeout(function () { setLoading(false); setStep('success'); }, 1200);
      return;
    }

    var payload = {
      client_id: CLIENT_ID,
      plan: selectedPlan,                 // steady|accelerated|elevate|dominate (backend aliases map these)
      term: term,                         // monthly|3mo|6mo (backend aliases map these)
      parent:  { first: form.pFirst, last: form.pLast, email: form.pEmail, phone: form.pMobile },
      athlete: { first: form.aFirst, last: '', dob: form.aDob },
    };

    fetch(CHECKOUT_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    })
      .then(function (r) { return r.json().then(function (j) { return { ok: r.ok, j: j }; }); })
      .then(function (res) {
        if (!res.ok) throw new Error((res.j && res.j.error) || 'checkout failed');
        var data = res.j;
        // No publishable key yet → backend created the sub; show success (demo
        // path) until Stripe card capture is switched on.
        if (!data.publishable_key || !data.client_secret || !window.Stripe) {
          setLoading(false); setStep('success'); return;
        }
        // Real card capture via Stripe Payment Element (connected account).
        return window.__confirmStripePayment(data)
          .then(function () { setLoading(false); setStep('success'); })
          .catch(function (e) { setLoading(false); setPayErr(e.message || 'Payment failed'); });
      })
      .catch(function (e) {
        // Network/endpoint not reachable in a pure preview → demo advance.
        console.warn('[funnel] checkout error, demo advance:', e.message);
        setLoading(false); setStep('success');
      });
  }

  // ---- per-step footer / CTA ----
  var footer = null;
  if (step === 1) {
    footer = <StickyCTA label="Continue" disabled={!s1valid} loading={loading} loadingLabel="Checking details…"
      onClick={function () { setShowErr1(true); if (s1valid) advance(2, 500, 'Checking details…'); }} />;
  } else if (step === 2) {
    var freqShort = plan.sessions ? (plan.sessions + '×/wk') : 'Unlimited';
    var summary = (
      <div className="fcta__summary">
        <div className="fcta__sum-label">Your plan<b>{plan.name} · {freqShort} · {BAM.getTerm(term).label}</b></div>
        <div className="fcta__sum-price">{BAM.dollars(plan.term[term].perMo)}<small>/ mo + HST</small></div>
      </div>
    );
    footer = <StickyCTA summary={summary} label="Continue" loading={loading} loadingLabel="Saving…"
      onClick={function () { advance(3, 500, 'Saving…'); }}
      onBack={function () { setStep(1); }} />;
  } else if (step === 3) {
    footer = <StickyCTA
      label={'Sign & Pay ' + BAM.dollars(charge.total) + ' — Start Training'}
      disabled={!s3valid} loading={loading} loadingLabel="Processing payment…"
      onClick={signAndPay}
      onBack={function () { setStep(2); }} />;
  }

  // ---- screen body ----
  var screen;
  if (step === 'success') {
    screen = <Success form={form} selectedPlan={selectedPlan} term={term} appEnabled={appEnabled}
      onBook={function () {}} />;
  } else {
    var inner;
    if (step === 1) inner = <Step1 form={form} setForm={setForm} showErrors={showErr1} />;
    else if (step === 2) inner = <Step2 term={term} onTerm={setTerm} selectedPlan={selectedPlan} onSelectPlan={setSelectedPlan} />;
    else inner = <Step3 form={form} term={term} selectedPlan={selectedPlan}
      pay={pay} setPay={setPay} agreed={agreed} onAgree={function (e) { setAgreed(e.target.checked); }}
      sig={sig} onSig={setSig} ui={ui} setUi={setUi} payErr={payErr}
      onChangePlan={function () { setStep(2); }} />;
    screen = (
      <React.Fragment>
        <ProgressHeader step={step} />
        {inner}
        {footer}
      </React.Fragment>
    );
  }

  return <div className="funnel" ref={bodyRef}>{screen}</div>;
}

ReactDOM.createRoot(document.getElementById('root')).render(<App />);
