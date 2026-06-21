/* ============================================================
   Step 2 — CHOOSE YOUR PLAN
   Plan cards: 3 monthly + 2 one-time. Popular badge on Competitive Edge.
   ============================================================ */

function PlanCard(props) {
  var CH3 = window.CH3;
  var p = props.plan;
  var selected = props.selected;
  var c = CH3.charge(p);

  return (
    <button
      className={'plan' + (selected ? ' is-selected' : '') + (p.popular ? ' is-popular' : '') + (p.sold_out ? ' is-disabled' : '')}
      aria-pressed={selected}
      disabled={p.sold_out}
      onClick={function () { if (!p.sold_out) props.onSelect(p.id); }}
      style={{ textAlign: 'left', cursor: p.sold_out ? 'not-allowed' : 'pointer' }}>

      {p.popular && !p.sold_out && <span className="plan__badge">Most Popular</span>}

      <div className="plan__top">
        <div>
          <div className="plan__name">{p.name}</div>
          <div className="plan__freq">{p.frequency}</div>
        </div>
        <span className="plan__radio" aria-hidden="true" />
      </div>

      <div className="plan__price">
        <span className="plan__price-main">
          {CH3.dollars(p.price_usd)}
          {p.billing === 'monthly' && <span style={{ fontFamily: 'var(--font-body)', fontSize: 13, color: 'var(--fg-subtle)', marginLeft: 4 }}>/mo</span>}
        </span>
      </div>
      {p.billing === 'one-time' && (
        <div className="plan__price" style={{ marginTop: 2 }}>
          <span className="plan__price-unit">One-time &middot; no subscription</span>
        </div>
      )}

      <ul className="plan__includes">
        {p.includes.map(function (item, i) {
          return (
            <li key={i}><IcCheck size={14} /><span>{item}</span></li>
          );
        })}
      </ul>
    </button>
  );
}

function Step2(props) {
  var CH3 = window.CH3;
  var monthly = CH3.PLANS.filter(function (p) { return p.billing === 'monthly'; });
  var oneTime  = CH3.PLANS.filter(function (p) { return p.billing === 'one-time'; });

  return (
    <div className="fbody" key="s2">
      <h1 className="fstep-title">Choose your <em>plan.</em></h1>
      <p className="fstep-sub">Pick the level of commitment that fits your goals. Cancel monthly plans anytime.</p>

      <div className="fgroup-label">Monthly membership</div>
      <div className="plans">
        {monthly.map(function (p) {
          return (
            <PlanCard
              key={p.id}
              plan={p}
              selected={props.selectedPlan === p.id}
              onSelect={props.onSelectPlan}
            />
          );
        })}
      </div>

      <div className="fgroup-label" style={{ marginTop: 24 }}>One-time &amp; drop-in</div>
      <div className="plans">
        {oneTime.map(function (p) {
          return (
            <PlanCard
              key={p.id}
              plan={p}
              selected={props.selectedPlan === p.id}
              onSelect={props.onSelectPlan}
            />
          );
        })}
      </div>

      <div className="reassure" style={{ marginTop: 20, justifyContent: 'center' }}>
        <IcLock size={15} />
        <span><b>No commitment on one-time plans.</b> Monthly memberships can be cancelled at any time.</span>
      </div>
    </div>
  );
}

Object.assign(window, { Step2, PlanCard });
