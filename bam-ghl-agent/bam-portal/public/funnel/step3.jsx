/* ============================================================
   Step 3 — CONFIRM, SIGN & PAY
   Order summary (HST broken out + total today), express pay,
   Stripe card placeholder, membership agreement (pause+cancel),
   FAQ accordion, trust row. Primary CTA lives in App footer.
   ============================================================ */

function paymentValid(pay) {
  if (!pay || !pay.method) return false;
  if (pay.method === 'apple' || pay.method === 'google') return true;
  return pay.method === 'card' && pay.cardFilled && pay.name && pay.name.trim().length > 1;
}

/* --- Order summary --- */
function OrderSummary(props) {
  var BAM = window.BAM, plan = props.plan, termId = props.term;
  var t = BAM.getTerm(termId);
  var c = BAM.charge(plan, termId);
  var today = BAM.TODAY;
  var when;
  if (termId === 'monthly') {
    when = <span>Billed today, then <b>{BAM.priceHST(plan.monthly)}</b> every 4 weeks starting {BAM.fmtDate(BAM.addWeeks(today, 4))}.</span>;
  } else {
    when = <span>One payment today. Continues month-to-month from <b>{BAM.fmtDate(BAM.addMonths(today, t.months))}</b> — cancel anytime after.</span>;
  }
  return (
    <div className="summary">
      <div className="summary__head">
        <div className="summary__plan">{plan.name}<span>{plan.freq} · {t.label}</span></div>
        <button className="summary__change" onClick={props.onChange}>Change</button>
      </div>
      <div className="summary__lines">
        <div className="sumline">
          <span>{termId === 'monthly' ? 'Membership (per 4 weeks)' : t.label + ' prepaid'}</span>
          <span>{BAM.dollars(c.base)}</span>
        </div>
        <div className="sumline">
          <span className="sumline__note">HST (13%)</span>
          <span>{BAM.dollars(c.hst)}</span>
        </div>
        <div className="sumline is-total">
          <span>Total today</span>
          <span>{BAM.dollars(c.total)}</span>
        </div>
      </div>
      <div className="summary__when">{when}</div>
    </div>
  );
}

/* --- Payment --- */
function Payment(props) {
  var pay = props.pay, setPay = props.setPay;
  function choose(m) { setPay(Object.assign({}, pay, { method: m })); }
  function fillCard() { setPay(Object.assign({}, pay, { method: 'card', cardFilled: true })); }

  // LIVE: real Stripe Payment Element (card + Apple/Google Pay) mounts into
  // #payment-element from app.jsx. This node has NO React children so Stripe
  // owns its DOM. The mock card below is the demo fallback.
  if (props.live) {
    return (
      <div className="paysect">
        <div className="fgroup-label">Payment</div>
        {!props.stripeReady && <div className="express__or" style={{ textAlign: 'left', margin: '4px 0 12px' }}>Loading secure payment…</div>}
        <div id="payment-element" style={{ minHeight: props.stripeReady ? 'auto' : 0 }} />
        {props.payErr && <div className="field__msg is-error" style={{ marginTop: 10 }}><span>{props.payErr}</span></div>}
        <div className="poweredby" style={{ marginTop: 12 }}><IcLock size={12} /> Secured by Stripe</div>
      </div>
    );
  }

  return (
    <div className="paysect">
      <div className="fgroup-label">Express checkout</div>
      <div className="express">
        <button className="express__btn" style={{ background: pay.method === 'apple' ? '#fff' : '#fff', outline: pay.method === 'apple' ? '2px solid var(--gold)' : 'none', outlineOffset: 2 }}
          onClick={function () { choose('apple'); }}>
          <IcApple size={18} /> <span style={{ fontWeight: 600 }}>Pay</span>
        </button>
        <button className="express__btn" style={{ outline: pay.method === 'google' ? '2px solid var(--gold)' : 'none', outlineOffset: 2 }}
          onClick={function () { choose('google'); }}>
          <IcGoogleG size={17} /> <span style={{ fontWeight: 600 }}>Pay</span>
        </button>
      </div>

      <div className="express__or">or pay with card</div>

      <Field name="cardName" label="Name on card" placeholder="Jordan Okafor"
        value={pay.name} valid={pay.name && pay.name.trim().length > 1}
        onChange={function (x) { setPay(Object.assign({}, pay, { name: x })); }} />

      <div className="stripe" onClick={fillCard} role="button" tabIndex={0} style={{ cursor: 'pointer' }}>
        <div className="stripe__row">
          <span className="stripe__num">{pay.cardFilled ? '4242 4242 4242 4242' : 'Card number'}</span>
          <span className="stripe__brand"><i /><i /><i /></span>
        </div>
        <div className="stripe__split">
          <div className="stripe__cell">{pay.cardFilled ? '12 / 28' : 'MM / YY'}</div>
          <div className="stripe__cell" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <span>{pay.cardFilled ? '•••' : 'CVC'}</span>
            {pay.cardFilled && <IcCheck size={13} />}
          </div>
        </div>
      </div>
      <div className="poweredby"><IcLock size={12} /> Secured by Stripe</div>
    </div>
  );
}

/* --- Membership agreement --- */
function Agreement(props) {
  var open = props.open, athlete = props.athlete;
  return (
    <div className={'disclosure' + (open ? ' is-open' : '')}>
      <button className="disclosure__head" onClick={props.onToggle}>
        <span className="disclosure__title">Membership agreement</span>
        <span className="disclosure__toggle" aria-hidden="true" />
      </button>
      <div className="disclosure__panel">
        <div className="agreement__scroll">
          <h5>1 · Membership & billing</h5>
          <p>This agreement is between BAM GTA and the parent/guardian named at signup, for the athlete{athlete ? ' (' + athlete + ')' : ''}. Membership grants the selected number of training sessions per week. All prices are in Canadian dollars and shown before HST; HST of 13% is added to every charge. Monthly memberships are billed every 4 weeks; prepaid terms are charged once at signup.</p>
          <h5>2 · Commitment & cancellation</h5>
          <p>Monthly memberships are rolling and may be cancelled at any time with no penalty; cancellation takes effect at the end of the current 4-week cycle. 3-Month and 6-Month memberships are a prepaid commitment for the full term and are non-refundable once the term begins. After a prepaid term ends, membership continues month-to-month and may be cancelled at any time.</p>
          <h5>3 · Pause policy</h5>
          <p>Members may pause their membership for travel, injury, or exams. Paused time is added onto the next billing date, so you are never charged for weeks you are paused. Pauses may be taken for up to 30 days at a time, approximately twice per year. (Exact limits confirmed at activation.)</p>
          <h5>4 · Conduct & liability</h5>
          <p>The athlete agrees to follow facility rules and coach direction. BAM GTA is not liable for injury sustained during normal training activity beyond the limits of applicable law. Medical conditions must be disclosed before the first session.</p>
        </div>
      </div>
      <label className={'agree' + (props.checked ? ' is-checked' : '') + (props.error ? ' is-error' : '')}>
        <input type="checkbox" checked={props.checked} onChange={props.onCheck} style={{ position: 'absolute', opacity: 0, width: 0, height: 0 }} />
        <span className="agree__box"><IcCheck size={14} /></span>
        <span className="agree__text"><b>I agree</b> to the membership agreement, including the cancellation and pause policy above.</span>
      </label>
      <div className="sig">
        <label className="sig__lab" htmlFor="sig">Signature <span style={{ textTransform: 'none', letterSpacing: 0 }}>(optional — type your full name)</span></label>
        <input id="sig" className="sig__input" placeholder="Type your full name" value={props.sig}
          onChange={function (e) { props.onSig(e.target.value); }} />
      </div>
    </div>
  );
}

/* --- FAQ --- */
function FaqRow(props) {
  return (
    <div className={'disclosure' + (props.open ? ' is-open' : '')}>
      <button className="disclosure__head" onClick={props.onToggle}>
        <span className="disclosure__title faq__q">{props.q}</span>
        <span className="disclosure__toggle" aria-hidden="true" />
      </button>
      <div className="disclosure__panel"><div className="faq__a">{props.a}</div></div>
    </div>
  );
}

function Step3(props) {
  var BAM = window.BAM;
  var plan = BAM.getPlan(props.selectedPlan);
  var ui = props.ui, setUi = props.setUi; // {agreeOpen, faqOpen}
  function toggle(key, val) {
    var n = Object.assign({}, ui);
    n[key] = (ui[key] === val ? null : val);
    if (key === 'agreeOpen') n.agreeOpen = !ui.agreeOpen;
    setUi(n);
  }
  var athleteName = (props.form.aFirst || '');

  return (
    <div className="fbody" key="s3">
      <h1 className="fstep-title">Confirm &amp; <em>pay.</em></h1>
      <p className="fstep-sub">Review the plan, sign the agreement, and pay securely. You can change your plan any time before paying.</p>

      <OrderSummary plan={plan} term={props.term} onChange={props.onChangePlan} />

      <Payment pay={props.pay} setPay={props.setPay} live={props.live} stripeReady={props.stripeReady} payErr={props.payErr} />

      <div className="fgroup-label" style={{ marginTop: 26 }}>Agreement &amp; signature</div>
      <Agreement
        open={ui.agreeOpen} athlete={athleteName.trim()}
        onToggle={function () { setUi(Object.assign({}, ui, { agreeOpen: !ui.agreeOpen })); }}
        checked={props.agreed} onCheck={props.onAgree} error={props.agreeError}
        sig={props.sig} onSig={props.onSig} />

      <div className="fgroup-label" style={{ marginTop: 26 }}>Common questions</div>
      <FaqRow q="Can I cancel?" open={ui.faq === 0}
        onToggle={function () { setUi(Object.assign({}, ui, { faq: ui.faq === 0 ? null : 0 })); }}
        a={<>Monthly memberships cancel anytime with no penalty, effective at the end of the current 4-week cycle. Prepaid 3- and 6-month terms run to the end of the term, then continue month-to-month and can be cancelled after.</>} />
      <FaqRow q="Can I pause?" open={ui.faq === 1}
        onToggle={function () { setUi(Object.assign({}, ui, { faq: ui.faq === 1 ? null : 1 })); }}
        a={<>Yes. Pause for travel, injury, or exams — up to 30 days at a time, about twice a year. Paused weeks are added onto your next billing date, so you{'\u2019'}re never charged for time you{'\u2019'}re paused.</>} />
      <FaqRow q="When am I charged?" open={ui.faq === 2}
        onToggle={function () { setUi(Object.assign({}, ui, { faq: ui.faq === 2 ? null : 2 })); }}
        a={<>Your first payment is today. Monthly renews every 4 weeks; prepaid terms are a single charge today and renew at the end of the term. A receipt is emailed every time.</>} />

      <div className="trust">
        <span className="trust__item"><IcLock size={13} /> Secure payment</span>
        <span className="trust__item"><IcPause size={13} /> Cancel anytime</span>
        <span className="trust__item"><IcMail size={13} /> Receipt emailed</span>
      </div>
    </div>
  );
}

Object.assign(window, { Step3: Step3, paymentValid: paymentValid });
