/* ============================================================
   Step 2 — CHOOSE YOUR PLAN
   3 monthly membership plans + commitment selector.
   ============================================================ */

function PlanCard(props) {
  var CH3 = window.CH3;
  var p = props.plan;
  var selected = props.selected;

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
          <span style={{ fontFamily: 'var(--font-body)', fontSize: 13, color: 'var(--fg-subtle)', marginLeft: 4 }}>/mo</span>
        </span>
      </div>

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

function CommitmentSelector(props) {
  var CH3 = window.CH3;
  var planId = props.planId;
  var selected = props.selected || 'monthly';
  var onSelect = props.onSelect;
  var plan = CH3.getPlan(planId);
  if (!plan) return null;

  var mo = plan.price_usd;
  var c3 = CH3.COMMITMENTS[planId]['3m'];
  var c6 = CH3.COMMITMENTS[planId]['6m'];
  var mo3 = Math.round(c3 / 3);
  var mo6 = Math.round(c6 / 6);
  var save3 = (mo * 3) - c3;
  var save6 = (mo * 6) - c6;

  var options = [
    {
      key: 'monthly',
      label: 'Monthly',
      price: CH3.dollars(mo) + '/mo',
      detail: 'Billed each month · 6-month minimum',
      badge: null,
    },
    {
      key: '3m',
      label: '3 Months',
      price: CH3.dollars(c3),
      detail: CH3.dollars(mo3) + '/mo · save ' + CH3.dollars(save3),
      badge: null,
    },
    {
      key: '6m',
      label: '6 Months',
      price: CH3.dollars(c6),
      detail: CH3.dollars(mo6) + '/mo · best value (save ' + CH3.dollars(save6) + ')',
      badge: 'Best Value',
    },
  ];

  return (
    <div className="commitment-selector" style={{ marginTop: 20 }}>
      <div className="fgroup-label">Commitment &amp; pricing</div>
      <div className="commitment-options" style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        {options.map(function (opt) {
          var isActive = selected === opt.key;
          return (
            <button
              key={opt.key}
              className={'commit-opt' + (isActive ? ' is-selected' : '')}
              onClick={function () { onSelect(opt.key); }}
              style={{
                display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                padding: '12px 14px', border: isActive ? '2px solid var(--teal)' : '1px solid var(--border)',
                borderRadius: 8, background: isActive ? 'rgba(0,184,200,0.06)' : 'var(--surface)',
                cursor: 'pointer', textAlign: 'left', position: 'relative',
              }}>
              {opt.badge && (
                <span style={{
                  position: 'absolute', top: -1, right: 10, fontSize: 10, fontWeight: 700,
                  background: 'var(--teal)', color: '#000', padding: '2px 7px', borderRadius: '0 0 5px 5px',
                  letterSpacing: '0.04em', textTransform: 'uppercase',
                }}>{opt.badge}</span>
              )}
              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <span style={{
                  width: 16, height: 16, borderRadius: '50%', flexShrink: 0,
                  border: isActive ? '5px solid var(--teal)' : '2px solid var(--border)',
                  background: 'transparent', display: 'inline-block',
                }} aria-hidden="true" />
                <div>
                  <div style={{ fontWeight: 600, fontSize: 14, color: 'var(--fg)' }}>{opt.label}</div>
                  <div style={{ fontSize: 12, color: 'var(--fg-subtle)', marginTop: 2 }}>{opt.detail}</div>
                </div>
              </div>
              <div style={{ fontWeight: 700, fontSize: 15, color: isActive ? 'var(--teal)' : 'var(--fg)', whiteSpace: 'nowrap', marginLeft: 8 }}>
                {opt.price}
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );
}

var YOUTH_GRADES = ['5th Grade', '6th Grade', '7th Grade', '8th Grade'];
var HS_GRADES    = ['9th Grade', '10th Grade', '11th Grade', '12th Grade', 'College'];

function SchedulePreview(props) {
  var grade = props.grade || '';
  var isYouth = YOUTH_GRADES.indexOf(grade) !== -1;
  var isHS    = HS_GRADES.indexOf(grade) !== -1;

  var group = isYouth
    ? { label: 'Youth Group', ages: 'Grades 5–8', times: ['Mon  6:00–7:00 PM', 'Fri  5:45–6:45 PM', 'Sun  5:00–6:00 PM'] }
    : isHS
    ? { label: 'HS / College Group', ages: 'Grades 9–12 & College', times: ['Mon & Wed  7:00–8:00 PM', 'Tue & Thu  6:30–7:30 PM'] }
    : null;

  var lift = { label: 'Strength & Conditioning', ages: 'All members · included', times: ['Mon & Wed  4:30–5:30 PM', 'Tue & Thu  5:00–6:00 PM'] };

  return (
    <div style={{
      margin: '20px 0 4px', borderRadius: 10,
      border: '1px solid var(--border)', overflow: 'hidden',
    }}>
      <div style={{
        background: 'rgba(0,184,200,0.08)', borderBottom: '1px solid var(--border)',
        padding: '10px 14px', display: 'flex', alignItems: 'center', gap: 8,
      }}>
        <span style={{ fontSize: 14, fontWeight: 700, color: 'var(--teal)', letterSpacing: '0.03em' }}>
          TRAINING SCHEDULE
        </span>
        {group && (
          <span style={{ fontSize: 12, color: 'var(--fg-subtle)', marginLeft: 4 }}>
            · {grade}
          </span>
        )}
      </div>

      <div style={{ padding: '12px 14px', display: 'flex', flexDirection: 'column', gap: 12 }}>
        {group ? (
          <ScheduleRow group={group} highlight />
        ) : (
          <div style={{ fontSize: 13, color: 'var(--fg-subtle)', fontStyle: 'italic' }}>
            Schedule depends on your grade. Both groups train 2–4× per week.
          </div>
        )}
        <ScheduleRow group={lift} />
      </div>

      <div style={{
        borderTop: '1px solid var(--border)', padding: '8px 14px',
        fontSize: 11, color: 'var(--fg-subtle)',
      }}>
        625 N Spring St · Middletown, PA 17057 · Groups capped at 9
      </div>
    </div>
  );
}

function ScheduleRow(props) {
  var g = props.group;
  return (
    <div style={{ display: 'flex', gap: 10 }}>
      <div style={{ flexShrink: 0, width: 3, borderRadius: 2, background: props.highlight ? 'var(--teal)' : 'var(--border)', alignSelf: 'stretch' }} />
      <div style={{ flex: 1 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 8 }}>
          <span style={{ fontWeight: 700, fontSize: 13, color: 'var(--fg)' }}>{g.label}</span>
          <span style={{ fontSize: 11, color: 'var(--fg-subtle)', whiteSpace: 'nowrap' }}>{g.ages}</span>
        </div>
        <div style={{ marginTop: 4, display: 'flex', flexDirection: 'column', gap: 2 }}>
          {g.times.map(function (t, i) {
            return (
              <span key={i} style={{ fontSize: 12, color: props.highlight ? 'var(--fg)' : 'var(--fg-subtle)', fontVariantNumeric: 'tabular-nums' }}>
                {t}
              </span>
            );
          })}
        </div>
      </div>
    </div>
  );
}

function Step2(props) {
  var CH3 = window.CH3;
  var grade = props.form ? props.form.grade : '';

  return (
    <div className="fbody" key="s2">
      <h1 className="fstep-title">Choose your <em>plan.</em></h1>
      <p className="fstep-sub">Pick the level of commitment that fits your goals. All memberships include a free first session.</p>

      <SchedulePreview grade={grade} />

      <div className="fgroup-label" style={{ marginTop: 20 }}>Membership</div>
      <div className="plans">
        {CH3.PLANS.map(function (p) {
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

      {props.selectedPlan && (
        <CommitmentSelector
          planId={props.selectedPlan}
          selected={props.selectedCommitment}
          onSelect={props.onSelectCommitment}
        />
      )}

      <div className="reassure" style={{ marginTop: 20, justifyContent: 'center' }}>
        <IcLock size={15} />
        <span><b>6-month commitment.</b> First session is free. Payment begins when you commit to a plan.</span>
      </div>
    </div>
  );
}

Object.assign(window, { Step2, PlanCard, CommitmentSelector, SchedulePreview, ScheduleRow });
