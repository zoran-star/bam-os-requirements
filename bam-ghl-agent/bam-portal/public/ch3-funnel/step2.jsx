/* Step 2 — Schedule preview + what to expect */

function Step2(props) {
  var CH3 = window.CH3;
  var grade = props.grade || '';
  var groupKey = CH3.getGroup(grade);
  var group = groupKey ? CH3.SCHEDULE[groupKey] : null;
  var lift = CH3.SCHEDULE.lift;

  return (
    <div className="fbody">
      <h1 className="fstep-title">Your <em>schedule.</em></h1>
      <p className="fstep-sub">
        {group
          ? 'Here are the sessions available for your group. Pick the days that work for you once you book.'
          : 'Here are all the available training sessions at CH3 Training.'}
      </p>

      <div className="sched-block">
        <div className="sched-block__header">
          <span className="sched-block__title">Training Schedule</span>
          {grade && <span className="sched-block__grade">&middot; {grade}</span>}
        </div>
        <div className="sched-block__body">
          {group ? (
            <SchedRow group={group} highlight={true} />
          ) : (
            <div>
              <SchedRow group={CH3.SCHEDULE.youth} highlight={false} />
              <div style={{ height: 14 }} />
              <SchedRow group={CH3.SCHEDULE.hs} highlight={false} />
            </div>
          )}
          <SchedRow group={lift} highlight={false} />
        </div>
        <div className="sched-block__footer">
          625 N Spring St &middot; Middletown, PA 17057 &middot; Groups capped at 9
        </div>
      </div>

      <div className="fgroup-label" style={{ marginTop: 24 }}>What to expect</div>
      <ul className="expect-list">
        {[
          'Coach Haynes will text you within 24 hours to confirm your free session time.',
          'Your first session is 100% free — no payment, no commitment.',
          'Wear sneakers and athletic clothes. Just show up ready to work.',
          'After the session, Coach will give you an honest assessment and show you the right plan.',
        ].map(function (item, i) {
          return (
            <li key={i}>
              <span className="expect-list__dot" />
              <span>{item}</span>
            </li>
          );
        })}
      </ul>

      <div className="reassure" style={{ marginTop: 24 }}>
        <IcLock size={13} />
        <span>No payment info required. This is just to claim your free session.</span>
      </div>
    </div>
  );
}

Object.assign(window, { Step2 });
