/* ============================================================
   Step 3 — CONFIRM & PAY
   Order summary, Stripe Payment Element, agreement.
   ============================================================ */

function paymentValid(pay) {
  if (!pay || !pay.method) return false;
  if (pay.method === 'apple' || pay.method === 'google') return true;
  return pay.method === 'card' && pay.cardFilled && pay.name && pay.name.trim().length > 1;
}

function OrderSummary(props) {
  var CH3 = window.CH3;
  var plan = props.plan;
  var c = CH3.charge(plan);
  var isMonthly = plan.billing === 'monthly';

  return (
    <div className="summary">
      <div className="summary__head">
        <div className="summary__plan">
          {plan.name}
          <span>{plan.frequency}</span>
        </div>
        <button className="summary__change" onClick={props.onChange}>Change</button>
      </div>
      <div className="summary__lines">
        <div className="sumline">
          <span>{isMonthly ? 'First month' : plan.name}</span>
          <span>{CH3.dollars(c.base)}</span>
        </div>
        <div className="sumline is-total">
          <span>Total today</span>
          <span>{CH3.dollars(c.total)}</span>
        </div>
      </div>
      <div className="summary__when">
        {isMonthly
          ? <span>Monthly membership. <b>Cancel anytime.</b> First payment today, then same day each month.</span>
          : <span>One-time payment. <b>No recurring charges.</b> A receipt goes to your inbox immediately.</span>
        }
      </div>
    </div>
  );
}

function Payment(props) {
  var pay = props.pay, setPay = props.setPay;
  function choose(m) { setPay(Object.assign({}, pay, { method: m })); }
  function fillCard() { setPay(Object.assign({}, pay, { method: 'card', cardFilled: true })); }

  if (props.live) {
    return (
      <div className="paysect">
        <div className="fgroup-label">Payment</div>
        {!props.stripeReady && <div className="express__or" style={{ textAlign: 'left', margin: '4px 0 12px' }}>Loading secure payment&hellip;</div>}
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
        <button className="express__btn" style={{ outline: pay.method === 'apple' ? '2px solid var(--teal)' : 'none', outlineOffset: 2 }}
          onClick={function () { choose('apple'); }}>
          <IcApple size={18} /> <span style={{ fontWeight: 600 }}>Pay</span>
        </button>
        <button className="express__btn" style={{ outline: pay.method === 'google' ? '2px solid var(--teal)' : 'none', outlineOffset: 2 }}
          onClick={function () { choose('google'); }}>
          <IcGoogleG size={17} /> <span style={{ fontWeight: 600 }}>Pay</span>
        </button>
      </div>
      <div className="express__or">or pay with card</div>
      <Field name="cardName" label="Name on card" placeholder="Jordan Williams"
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

function Agreement(props) {
  var open = props.open;
  return (
    <div className={'disclosure' + (open ? ' is-open' : '')}>
      <button className="disclosure__head" onClick={props.onToggle}>
        <span className="disclosure__title">Training agreement</span>
        <span className="disclosure__toggle" aria-hidden="true" />
      </button>
      <div className="disclosure__panel">
        <div className="agreement__scroll">
          <h5>1 · Membership &amp; billing</h5>
          <p>This agreement is between CH3 Training and the person named at signup. Monthly memberships are billed to your card on the same day each month. One-time payments are charged in full at time of purchase. All prices are in USD.</p>
          <h5>2 · Cancellation</h5>
          <p>Monthly memberships can be cancelled at any time with at least 7 days notice before your next billing date. Cancellations received within 7 days of billing will take effect the following month. One-time payments are non-refundable once the session has been scheduled.</p>
          <h5>3 · Conduct &amp; liability</h5>
          <p>Athletes agree to follow coach direction and facility rules at all times. CH3 Training is not liable for injury sustained during normal training activity. Pre-existing medical conditions should be disclosed before the first session.</p>
          <h5>4 · Photography &amp; media</h5>
          <p>CH3 Training may photograph or film sessions for promotional purposes. By registering, you grant permission for your likeness to appear in CH3 Training promotional content. Opt-out requests may be made in writing.</p>
        </div>
      </div>
      <label className={'agree' + (props.checked ? ' is-checked' : '') + (props.error ? ' is-error' : '')}>
        <input type="checkbox" checked={props.checked} onChange={props.onCheck} style={{ position: 'absolute', opacity: 0, width: 0, height: 0 }} />
        <span className="agree__box"><IcCheck size={14} /></span>
        <span className="agree__text"><b>I agree</b> to the training agreement and understand the cancellation policy above.</span>
      </label>
      <div className="sig">
        <label className="sig__lab" htmlFor="sig">Signature <span style={{ textTransform: 'none', letterSpacing: 0 }}>(optional)</span></label>
        <input id="sig" className="sig__input" placeholder="Type your full name" value={props.sig}
          onChange={function (e) { props.onSig(e.target.value); }} />
      </div>
    </div>
  );
}

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
  var plan = props.plan;
  var ui = props.ui, setUi = props.setUi;

  return (
    <div className="fbody" key="s3">
      <h1 className="fstep-title">Confirm &amp; <em>pay.</em></h1>
      <p className="fstep-sub">Review your plan, sign the agreement, and pay securely.</p>

      <OrderSummary plan={plan} onChange={props.onChangePlan} />

      <Payment pay={props.pay} setPay={props.setPay} live={props.live} stripeReady={props.stripeReady} payErr={props.payErr} />

      <div className="fgroup-label" style={{ marginTop: 26 }}>Agreement &amp; signature</div>
      <Agreement
        open={ui.agreeOpen}
        onToggle={function () { setUi(Object.assign({}, ui, { agreeOpen: !ui.agreeOpen })); }}
        checked={props.agreed} onCheck={props.onAgree} error={props.agreeError}
        sig={props.sig} onSig={props.onSig} />

      <div className="fgroup-label" style={{ marginTop: 26 }}>Common questions</div>
      <FaqRow q="Can I cancel my membership?" open={ui.faq === 0}
        onToggle={function () { setUi(Object.assign({}, ui, { faq: ui.faq === 0 ? null : 0 })); }}
        a={<>Monthly memberships can be cancelled anytime with at least 7 days notice before your next billing date. There are no cancellation fees.</>} />
      <FaqRow q="Can I upgrade or downgrade my plan?" open={ui.faq === 1}
        onToggle={function () { setUi(Object.assign({}, ui, { faq: ui.faq === 1 ? null : 1 })); }}
        a={<>Yes. Reach out to Coach Haynes at ch3training@gmail.com to change your plan. Changes take effect at the next billing cycle.</>} />
      <FaqRow q="What should I bring to training?" open={ui.faq === 2}
        onToggle={function () { setUi(Object.assign({}, ui, { faq: ui.faq === 2 ? null : 2 })); }}
        a={<>Basketball shoes, athletic clothes, and a water bottle. Coach will handle the rest.</>} />

      <div className="trust">
        <span className="trust__item"><IcLock size={13} /> Secure payment</span>
        <span className="trust__item"><IcCheck size={13} /> Spot confirmed instantly</span>
        <span className="trust__item"><IcMail size={13} /> Receipt emailed</span>
      </div>
    </div>
  );
}

Object.assign(window, { Step3, paymentValid });
