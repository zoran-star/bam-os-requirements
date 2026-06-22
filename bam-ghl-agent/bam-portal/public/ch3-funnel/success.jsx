/* Success screen */

function Success(props) {
  var CH3 = window.CH3;
  var grade = props.grade || '';
  var groupKey = CH3.getGroup(grade);
  var group = groupKey ? CH3.SCHEDULE[groupKey] : null;

  return (
    <div className="success">
      <div className="success__check">&#10003;</div>

      <h1 className="success__title">
        You&rsquo;re <em>in!</em>
      </h1>

      <p className="success__sub">
        Coach Haynes will text you within 24 hours to set up your free session.
        {grade ? ' Your group is below.' : ''}
      </p>

      {group && (
        <div className="success__sched">
          <div className="success__sched-label">Your training group</div>
          <div className="sched-block">
            <div className="sched-block__body">
              <SchedRow group={group} highlight={true} />
              <SchedRow group={CH3.SCHEDULE.lift} highlight={false} />
            </div>
            <div className="sched-block__footer">
              625 N Spring St &middot; Middletown, PA 17057
            </div>
          </div>
        </div>
      )}

      <p className="success__note">
        Questions? Text or call Coach Haynes directly. Check your phone for a message shortly.
      </p>
    </div>
  );
}

Object.assign(window, { Success });
