/* ============================================================
   Step 2 — CHOOSE THE PLAN
   Term toggle (Monthly / 3-Month / 6-Month) reprices all cards live.
   4 plan cards; Accelerated pre-selected + "Most Popular".
   Dominate last to anchor. Selection state lives in App.
   ============================================================ */

function TermToggle(props) {
  var TERMS = window.BAM.TERMS;
  return (
    <div className="termtoggle" role="tablist" aria-label="Commitment term">
      {TERMS.map(function (t) {
        var active = t.id === props.term;
        return (
          <button key={t.id} role="tab" aria-selected={active}
            className={'termtoggle__seg' + (active ? ' is-active' : '')}
            onClick={function () { props.onTerm(t.id); }}>
            <span className="termtoggle__seg-main">{t.label}</span>
            <span className="termtoggle__seg-sub">
              {t.id === 'monthly' ? 'Rolling' : 'Prepaid'}
              {t.save > 0 && <span className="savebadge">Save {t.save}%</span>}
            </span>
          </button>
        );
      })}
    </div>
  );
}

function PlanCard(props) {
  var BAM = window.BAM;
  var p = props.plan, termId = props.term, selected = props.selected;
  var t = p.term[termId];

  return (
    <button className={'plan' + (selected ? ' is-selected' : '') + (p.popular ? ' is-popular' : '')}
      aria-pressed={selected} onClick={function () { props.onSelect(p.id); }}>
      {p.popular && <span className="plan__badge">Most Popular</span>}
      <div className="plan__top">
        <div>
          <div className="plan__name">{p.name}</div>
          <div className="plan__freq">{p.freq}</div>
        </div>
        <span className="plan__radio" aria-hidden="true" />
      </div>

      <div className="plan__price">
        <span className="plan__price-main">{BAM.dollars(t.perMo)}<span className="hst"> + HST / mo</span></span>
      </div>
      {!p.sessions && (
        <div className="plan__price" style={{ marginTop: 4 }}>
          <span className="plan__price-unit">Train as often as you want</span>
        </div>
      )}

      {t.total != null && (
        <div className="plan__total">
          {BAM.getTerm(termId).short} prepaid · <b>{BAM.priceHST(t.total)}</b> total
        </div>
      )}

      <ul className="plan__includes">
        {p.includes.map(function (inc, i) {
          return <li key={i}><IcCheck size={14} /><span>{inc}</span></li>;
        })}
      </ul>
    </button>
  );
}

/* --- Start date: charge today, or reserve a future start (deferred first charge) --- */
function StartDate(props) {
  var BAM = window.BAM;
  var today = new Date();
  var min = BAM.localISO(new Date(today.getTime() + 86400000));       // tomorrow
  var max = BAM.localISO(new Date(today.getTime() + 90 * 86400000));  // +90 days
  var picked = !!props.startDate;
  return (
    <div className="startdate">
      <div className="fgroup-label">When do they start?</div>
      <div className="startpick">
        <button className={'startpick__opt' + (!picked ? ' is-active' : '')}
          aria-pressed={!picked} onClick={function () { props.onStartDate(''); }}>
          <span className="startpick__t">Start today</span>
          <span className="startpick__s">Bill + start today</span>
        </button>
        <button className={'startpick__opt' + (picked ? ' is-active' : '')}
          aria-pressed={picked} onClick={function () { if (!props.startDate) props.onStartDate(min); }}>
          <span className="startpick__t">Pick a start date</span>
          <span className="startpick__s">Pay today · start later</span>
        </button>
      </div>
      {picked && (
        <label className="startdate__field">
          <IcCal size={15} />
          <input type="date" className="startdate__input"
            value={props.startDate} min={min} max={max}
            onChange={function (e) { props.onStartDate(e.target.value); }} />
        </label>
      )}
      <p className="termhint" style={{ marginTop: 12, marginBottom: 0 }}>
        {picked
          ? <>You're <b>billed today</b> for the first period. Training starts {BAM.fmtDate(BAM.fromISO(props.startDate))}, and billing renews {BAM.fmtDate(BAM.renewalFrom(props.startDate, props.term))}.</>
          : <>Training and billing begin today.</>}
      </p>
    </div>
  );
}

function Step2(props) {
  var BAM = window.BAM;
  return (
    <div className="fbody" key="s2">
      <h1 className="fstep-title">Choose how <em>often</em> they train.</h1>
      <p className="fstep-sub">Pick a plan by training frequency. Switch the term to see how committing longer lowers the monthly rate.</p>

      <TermToggle term={props.term} onTerm={props.onTerm} />
      <p className="termhint">
        {props.term === 'monthly'
          ? <><b>Rolling membership</b>, billed every 4 weeks, cancel anytime.</>
          : <>Prepaid for the term, then continues month-to-month. <b>Cancel anytime after.</b></>}
      </p>

      <div className="plans">
        {BAM.PLANS.map(function (p) {
          return <PlanCard key={p.id} plan={p} term={props.term}
            selected={props.selectedPlan === p.id} onSelect={props.onSelectPlan} />;
        })}
      </div>

      <StartDate startDate={props.startDate} onStartDate={props.onStartDate} term={props.term} />

      <div className="reassure" style={{ marginTop: 20, justifyContent: 'center' }}>
        <IcPause size={15} />
        <span><b>Monthly = cancel anytime.</b> Pause when you travel, get injured, or hit exams, and paused time is added onto your next billing date.</span>
      </div>
    </div>
  );
}

Object.assign(window, { Step2: Step2, TermToggle: TermToggle, PlanCard: PlanCard, StartDate: StartDate });
