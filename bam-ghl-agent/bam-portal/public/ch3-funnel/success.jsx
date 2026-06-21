/* ============================================================
   SUCCESS — "You're in."
   Recap: name, plan, billing type, amount charged.
   ============================================================ */

function Success(props) {
  var CH3 = window.CH3;
  var plan = props.plan;
  var commitment = props.commitment || 'monthly';
  var c = plan ? CH3.charge(plan, commitment) : { total: 0 };
  var firstName = props.form.cFirst || '';

  var billingLine;
  if (commitment === '3m') {
    billingLine = '3-month prepay · no recurring charges';
  } else if (commitment === '6m') {
    billingLine = '6-month prepay · no recurring charges';
  } else {
    billingLine = 'Monthly · first month charged, renews monthly';
  }

  var commitmentLabel;
  if (commitment === '3m') {
    commitmentLabel = '3-Month Prepay';
  } else if (commitment === '6m') {
    commitmentLabel = '6-Month Prepay';
  } else {
    commitmentLabel = 'Monthly';
  }

  return (
    <div className="success" key="success">
      <div className="success__hero">
        <div className="success__hero-overlay" />
        <div className="success__hero-inner">
          <div className="success__check"><IcCheck size={26} w={2.4} /></div>
          <div className="success__eyebrow">CH3 Training{firstName ? ' · ' + firstName : ''}</div>
          <h1 className="success__title">You{'''}re <em>in.</em></h1>
          <p className="success__sub">
            {plan ? plan.name : 'Your plan'} is confirmed.
            Coach Haynes will be in touch within 24 hours to schedule your free first session.
          </p>
        </div>
      </div>

      <div className="success__body">
        <div className="recap">
          <div className="recap__row"><span>Plan</span><b>{plan ? plan.name : ''}</b></div>
          {plan && <div className="recap__row"><span>Frequency</span><b>{plan.frequency}</b></div>}
          <div className="recap__row"><span>Commitment</span><b>{commitmentLabel}</b></div>
          <div className="recap__row">
            <span>Charged today</span>
            <b className="teal">{CH3.dollars(c.total)}</b>
          </div>
          <div className="recap__row">
            <span>Billing</span>
            <b>{billingLine}</b>
          </div>
        </div>

        <div className="trust" style={{ marginTop: 4 }}>
          <span className="trust__item"><IcMail size={13} /> Confirmation emailed</span>
          <span className="trust__item"><IcCheck size={13} /> Coach will reach out within 24 hrs</span>
        </div>
      </div>
    </div>
  );
}

Object.assign(window, { Success });
