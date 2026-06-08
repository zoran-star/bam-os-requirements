/* ============================================================
   SUCCESS STATE
   A) Default — "You're in" + recap + one next action.
   B) App-enabled — adds "Download your training app" block.
   ============================================================ */

function Success(props) {
  var BAM = window.BAM;
  var plan = BAM.getPlan(props.selectedPlan);
  var t = BAM.getTerm(props.term);
  var c = BAM.charge(plan, props.term);
  var athlete = (props.form.aFirst || 'your athlete');
  var firstName = props.form.pFirst || '';
  var appEnabled = props.appEnabled;

  var nextCharge;
  if (props.term === 'monthly') nextCharge = BAM.fmtDate(BAM.addWeeks(BAM.TODAY, 4));
  else nextCharge = BAM.fmtDate(BAM.addMonths(BAM.TODAY, t.months));

  return (
    <div className="success" key="success">
      <div className="success__hero">
        <div className="success__hero-media" />
        <div className="success__hero-overlay" />
        <div className="success__hero-inner">
          <div className="success__check"><IcCheck size={26} w={2.4} /></div>
          <div className="success__eyebrow">Welcome to BAM GTA{firstName ? ' · ' + firstName : ''}</div>
          <h1 className="success__title">You{'\u2019'}re <em>in.</em></h1>
          <p className="success__sub">{athlete}{'\u2019'}s spot is confirmed and your first payment went through. A receipt is on its way to your inbox.</p>
        </div>
      </div>

      <div className="success__body">
        <div className="recap">
          <div className="recap__row"><span>Athlete</span><b>{athlete}</b></div>
          <div className="recap__row"><span>Plan</span><b>{plan.name} · {plan.freq}</b></div>
          <div className="recap__row"><span>Term</span><b>{t.label}</b></div>
          <div className="recap__row"><span>Charged today</span><b className="gold">{BAM.dollars(c.total)}</b></div>
          <div className="recap__row"><span>{props.term === 'monthly' ? 'Next charge' : 'Renews'}</span><b>{nextCharge}</b></div>
        </div>

        {appEnabled && (
          <div className="appblock">
            <div className="appblock__top">
              <div className="appblock__icon" />
              <div className="appblock__head">
                <h4>Download your training app</h4>
                <p>Ultimate Development HQ</p>
              </div>
            </div>
            <ol className="appblock__steps">
              <li>Download the app and open it.</li>
              <li>Set a password using <b style={{ color: '#fff', fontWeight: 600 }}>{props.form.pEmail || 'your signup email'}</b>.</li>
              <li>Book {athlete}{'\u2019'}s first session and track progress.</li>
            </ol>
            <div className="storebadges">
              <button className="storebadge"><IcStore size={22} /><span><small>Download on the</small><b>App Store</b></span></button>
              <button className="storebadge"><IcPlay size={20} /><span><small>Get it on</small><b>Google Play</b></span></button>
            </div>
          </div>
        )}

        <button className="btn-primary" onClick={props.onBook} style={{ marginBottom: 14 }}>
          Book your first session <span className="arrow">{'\u2192'}</span>
        </button>
        <div className="trust" style={{ marginTop: 4 }}>
          <span className="trust__item"><IcMail size={13} /> Receipt emailed</span>
          <span className="trust__item"><IcPause size={13} /> Pause or cancel anytime in your account</span>
        </div>
      </div>
    </div>
  );
}

Object.assign(window, { Success: Success });
