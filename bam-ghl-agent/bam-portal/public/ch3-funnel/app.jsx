/* ============================================================
   CH3 Training — Signup Funnel
   3-step: contact info → plan pick → confirm + pay.
   Live mode: ?live=1 in URL or window.FUNNEL_LIVE = true.
   ============================================================ */

var CHECKOUT_URL = "/api/website/ch3-checkout";

var LIVE_CHECKOUT = false;

var EMPTY = { cFirst: '', cLast: '', cEmail: '', cPhone: '' };

function App() {
  var s = React.useState(1); var step = s[0], setStep = s[1];
  var ff = React.useState(Object.assign({}, EMPTY)); var form = ff[0], setForm = ff[1];

  var defaultPlan = (function () {
    var popular = window.CH3.PLANS.filter(function (p) { return p.popular && !p.sold_out; })[0];
    var first   = window.CH3.PLANS.filter(function (p) { return !p.sold_out; })[0];
    return popular ? popular.id : (first ? first.id : null);
  })();
  var pp = React.useState(defaultPlan); var selectedPlan = pp[0], setSelectedPlan = pp[1];

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

  var stripeRef = React.useRef(null);
  var elementsRef = React.useRef(null);
  var attemptedRef = React.useRef(false);

  React.useEffect(function () {
    var el = document.querySelector('.fbody, .success');
    if (el) el.scrollTop = 0;
  }, [step]);

  var wantLive = LIVE_CHECKOUT || window.FUNNEL_LIVE ||
    (typeof location !== 'undefined' && new URLSearchParams(location.search).has('live'));
  var liveMode = wantLive && !demoFallback;

  var s1valid = window.validateStep1(form).valid;
  var plan = selectedPlan ? window.CH3.getPlan(selectedPlan) : null;
  var s3valid = agreed && (liveMode ? stripeReady : window.paymentValid(pay));

  function checkoutPayload() {
    return {
      contact: { first: form.cFirst, last: form.cLast, email: form.cEmail, phone: form.cPhone },
      plan:    { id: selectedPlan },
      agreement: { signature: sig || '', signed_at: new Date().toISOString() }
    };
  }

  function advance(target, ms, label) {
    setLoadLabel(label || 'Processing…');
    setLoading(true);
    window.setTimeout(function () { setLoading(false); setStep(target); }, ms || 400);
  }

  React.useEffect(function () {
    if (!liveMode || step !== 3 || !plan) return;
    if (attemptedRef.current) return;
    attemptedRef.current = true;
    setLoadLabel('Setting up payment…');
    setLoading(true);

    fetch(CHECKOUT_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(checkoutPayload())
    })
      .then(function (r) { return r.json(); })
      .then(function (data) {
        if (!data.ok) throw new Error(data.error || 'Checkout failed');
        var stripe = window.Stripe(data.publishable_key);
        stripeRef.current = stripe;
        var elements = stripe.elements({ clientSecret: data.client_secret, appearance: { theme: 'night', variables: { colorPrimary: '#00B8C8' } } });
        elementsRef.current = elements;
        var pe = elements.create('payment');
        pe.mount('#payment-element');
        pe.on('ready', function () { setStripeReady(true); });
        setLoading(false);
      })
      .catch(function (err) {
        console.error('Checkout setup error', err);
        setDemoFallback(true);
        setLoading(false);
      });
  }, [step, liveMode]);

  async function handlePay() {
    if (liveMode && stripeRef.current && elementsRef.current) {
      setLoadLabel('Confirming payment…');
      setLoading(true);
      setPayErr(null);
      var result = await stripeRef.current.confirmPayment({
        elements: elementsRef.current,
        redirect: 'if_required'
      });
      if (result.error) {
        setPayErr(result.error.message || 'Payment failed. Please try again.');
        setLoading(false);
      } else {
        advance(4, 100, 'Confirming…');
      }
    } else {
      advance(4, 800, 'Confirming your spot…');
    }
  }

  var ctaLabel, ctaAction, ctaDisabled;
  if (step === 1) {
    ctaLabel = 'Choose my plan →';
    ctaAction = function () {
      if (!s1valid) { setShowErr1(true); return; }
      advance(2, 300);
    };
    ctaDisabled = false;
  } else if (step === 2) {
    ctaLabel = 'Review &amp; pay →';
    ctaAction = function () {
      if (!selectedPlan) return;
      attemptedRef.current = false;
      advance(3, 300);
    };
    ctaDisabled = !selectedPlan;
  } else if (step === 3) {
    ctaLabel = loading ? loadLabel : 'Confirm my spot →';
    ctaAction = function () {
      if (!agreed) { setUi(Object.assign({}, ui, { agreeOpen: true })); return; }
      if (!s3valid) return;
      handlePay();
    };
    ctaDisabled = loading || !agreed || (!liveMode && !window.paymentValid(pay));
  }

  if (step === 4) {
    return <Success form={form} plan={plan} />;
  }

  return (
    <div className="funnel">
      <ProgressHeader step={step} />

      {step === 1 && <Step1 form={form} setForm={setForm} showErrors={showErr1} />}
      {step === 2 && <Step2 selectedPlan={selectedPlan} onSelectPlan={setSelectedPlan} />}
      {step === 3 && plan && (
        <Step3
          form={form} plan={plan}
          pay={pay} setPay={setPay}
          agreed={agreed} onAgree={function (e) { setAgreed(e.target.checked); }}
          agreeError={false} sig={sig} onSig={setSig}
          ui={ui} setUi={setUi}
          live={liveMode} stripeReady={stripeReady} payErr={payErr}
          onChangePlan={function () { setStep(2); }}
        />
      )}

      {step <= 3 && (
        <footer className="fcta">
          <button
            className={'btn-primary' + (loading ? ' is-loading' : '')}
            disabled={ctaDisabled}
            onClick={ctaAction}
            dangerouslySetInnerHTML={{ __html: loading ? '<span class="spinner"></span>' + loadLabel : ctaLabel }}
          />
          {step > 1 && (
            <button className="fcta__back" onClick={function () { setStep(step - 1); }}>
              &larr; Back
            </button>
          )}
        </footer>
      )}
    </div>
  );
}

ReactDOM.createRoot(document.getElementById('root')).render(<App />);
