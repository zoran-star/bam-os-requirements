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
// Stripe sub created). LIVE as of 2026-07-12: the billing model was verified end to
// end with Stripe Test Clocks (charge today + trial_end anchor + recurring). Requires
// STRIPE_PUBLISHABLE_KEY (live pk) + a live ONBOARDING_STRIPE_SECRET_KEY in Vercel;
// if either is missing the funnel safely demo-falls-back (never junk-charges).
var LIVE_CHECKOUT = true;

var EMPTY = { pFirst: '', pLast: '', pEmail: '', pMobile: '', aFirst: '', aDob: '' };

function App() {
  var s = React.useState(1); var step = s[0], setStep = s[1];
  var ff = React.useState(Object.assign({}, EMPTY)); var form = ff[0], setForm = ff[1];
  var tm = React.useState('3mo'); var term = tm[0], setTerm = tm[1];        // default 3-Month (anchors mid-commitment)
  var sd = React.useState(''); var startDate = sd[0], setStartDate = sd[1]; // '' = start today; 'YYYY-MM-DD' = future start (billed today, membership starts then)
  var sp = React.useState('accelerated'); var selectedPlan = sp[0], setSelectedPlan = sp[1];
  var py = React.useState({ method: null, name: '', cardFilled: false }); var pay = py[0], setPay = py[1];
  var ag = React.useState(false); var agreed = ag[0], setAgreed = ag[1];
  var sg = React.useState(''); var sig = sg[0], setSig = sg[1];
  var uiS = React.useState({ agreeOpen: false, faq: null }); var ui = uiS[0], setUi = uiS[1];
  var se = React.useState(false); var showErr1 = se[0], setShowErr1 = se[1];
  var tl = React.useState(false); var loading = tl[0], setLoading = tl[1];
  var ll = React.useState('Processing…'); var loadLabel = ll[0], setLoadLabel = ll[1];
  var pe = React.useState(null); var payErr = pe[0], setPayErr = pe[1];
  var sr = React.useState(false); var stripeReady = sr[0], setStripeReady = sr[1];
  var df = React.useState(false); var demoFallback = df[0], setDemoFallback = df[1];
  var appEnabled = false; // success "download the app" variant — wire per-academy later

  var bodyRef = React.useRef(null);
  var stripeRef = React.useRef(null);
  var elementsRef = React.useRef(null);
  var attemptedRef = React.useRef(false);

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
  var charge = BAM.charge(plan, term);

  // Live intent: ?live=1 in the URL, window.FUNNEL_LIVE, or the LIVE_CHECKOUT flag.
  // `liveMode` is the actual mode after any fallback (e.g. publishable key missing).
  var wantLive = LIVE_CHECKOUT || window.FUNNEL_LIVE ||
    (typeof location !== 'undefined' && new URLSearchParams(location.search).has('live'));
  var liveMode = wantLive && !demoFallback;

  var s1valid = window.validateStep1(form).valid;
  var s3valid = agreed && (liveMode ? stripeReady : window.paymentValid(pay));

  function checkoutPayload() {
    return {
      client_id: CLIENT_ID,
      plan: selectedPlan,                 // steady|accelerated|elevate|dominate (backend aliases map these)
      term: term,                         // monthly|3mo|6mo (backend aliases map these)
      parent:  { first: form.pFirst, last: form.pLast, email: form.pEmail, phone: form.pMobile },
      athlete: { first: form.aFirst, last: '', dob: form.aDob },
      charge_mode: startDate ? 'on_date' : 'now',  // future start → billed today, recurring anchors to start_date
      start_date: startDate || undefined,          // 'YYYY-MM-DD' when a future start is picked
    };
  }

  // On entering step 3 in LIVE mode: create the portal-owned sub, then mount the
  // Stripe Payment Element with the returned client_secret. Any failure (no backend,
  // no publishable key, Stripe.js absent) flips to demoFallback so the funnel still
  // works as a click-through. NOTE (v1): don't go back and change plan after reaching
  // payment — the sub is created on first step-3 entry.
  React.useEffect(function () {
    if (step !== 3 || !wantLive || stripeReady || demoFallback || attemptedRef.current) return;
    attemptedRef.current = true;
    setPayErr(null);
    fetch(CHECKOUT_URL, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(checkoutPayload()) })
      .then(function (r) { return r.json().then(function (j) { return { ok: r.ok, j: j }; }); })
      .then(function (res) {
        if (!res.ok) throw new Error((res.j && res.j.error) || 'checkout failed');
        var data = res.j;
        if (!data.client_secret || !data.publishable_key || !window.Stripe) { setDemoFallback(true); return; }
        var stripe = window.Stripe(data.publishable_key, data.stripe_account ? { stripeAccount: data.stripe_account } : undefined);
        var elements = stripe.elements({ clientSecret: data.client_secret });
        var paymentEl = elements.create('payment');
        window.setTimeout(function () {
          if (!document.getElementById('payment-element')) { setDemoFallback(true); return; }
          paymentEl.mount('#payment-element');
          stripeRef.current = stripe; elementsRef.current = elements;
          setStripeReady(true);
        }, 0);
      })
      .catch(function (e) { console.warn('[funnel] live checkout failed → demo:', e.message); setDemoFallback(true); });
  }, [step, wantLive, stripeReady, demoFallback]);

  // ---- pay ----
  function signAndPay() {
    if (!s3valid) return;
    setPayErr(null);

    // Demo: no backend call, no charge.
    if (!liveMode || !stripeReady) {
      setLoadLabel('Processing payment…'); setLoading(true);
      window.setTimeout(function () { setLoading(false); setStep('success'); }, 1200);
      return;
    }

    // Real charge via the mounted Payment Element. The first period is billed today
    // whether they start now or pick a future date, so this is always a PaymentIntent.
    setLoadLabel('Processing payment…'); setLoading(true);
    stripeRef.current.confirmPayment({
      elements: elementsRef.current,
      confirmParams: { return_url: location.href },
      redirect: 'if_required',
    }).then(function (result) {
      setLoading(false);
      if (result && result.error) { setPayErr(result.error.message || 'Payment failed'); return; }
      setStep('success');
    }).catch(function (e) { setLoading(false); setPayErr(e.message || 'Payment failed'); });
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
    var payLabel = startDate
      ? 'Sign & Pay ' + BAM.dollars(charge.total) + ' · Starts ' + BAM.fmtShort(BAM.fromISO(startDate))
      : 'Sign & Pay ' + BAM.dollars(charge.total) + ' - Start Training';
    footer = <StickyCTA
      label={payLabel}
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
    else if (step === 2) inner = <Step2 term={term} onTerm={setTerm} selectedPlan={selectedPlan} onSelectPlan={setSelectedPlan}
      startDate={startDate} onStartDate={setStartDate} />;
    else inner = <Step3 form={form} term={term} selectedPlan={selectedPlan} startDate={startDate}
      pay={pay} setPay={setPay} agreed={agreed} onAgree={function (e) { setAgreed(e.target.checked); }}
      sig={sig} onSig={setSig} ui={ui} setUi={setUi} payErr={payErr}
      live={liveMode} stripeReady={stripeReady}
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
