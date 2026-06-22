/* CH3 Onboarding Funnel — shared components */

function IcLock({ size = 14 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <rect x="3" y="7" width="10" height="7" stroke="currentColor" strokeWidth="1.4" />
      <path d="M5 7V5a3 3 0 0 1 6 0v2" stroke="currentColor" strokeWidth="1.4" />
    </svg>
  );
}

function FHeader({ step }) {
  var pct = step === 1 ? '50%' : '100%';
  var label = step === 1 ? 'Your info' : 'Your schedule';
  return (
    <header className="fheader">
      <div>
        <div className="fheader__brand">CH3 <em>TRAINING</em></div>
      </div>
      <div className="fheader__step">Step {step} of 2 &middot; {label}</div>
      <div className="fprogress" style={{ position: 'absolute', bottom: 0, left: 0, right: 0 }}>
        <div className="fprogress__fill" style={{ width: pct }} />
      </div>
    </header>
  );
}

function Field(props) {
  var hasError = !!props.error;
  var cls = 'field__input' + (hasError ? ' is-error' : (props.valid ? ' is-valid' : ''));
  return (
    <div className="field" style={props.style}>
      {props.label && <label className="field__label" htmlFor={props.name}>{props.label}</label>}
      <input
        id={props.name} name={props.name} className={cls}
        type={props.type || 'text'} inputMode={props.inputMode}
        autoComplete={props.autoComplete} placeholder={props.placeholder}
        value={props.value || ''}
        maxLength={props.maxLength}
        onChange={function (e) { props.onChange(e.target.value); }}
        onBlur={props.onBlur}
      />
      {hasError && <div className="field__error">{props.error}</div>}
    </div>
  );
}

function SelectField(props) {
  var hasError = !!props.error;
  var cls = 'field__input' + (hasError ? ' is-error' : (props.valid ? ' is-valid' : ''));
  return (
    <div className="field" style={props.style}>
      {props.label && <label className="field__label" htmlFor={props.name}>{props.label}</label>}
      <select
        id={props.name} name={props.name} className={cls}
        value={props.value || ''}
        onChange={function (e) { props.onChange(e.target.value); }}
        onBlur={props.onBlur}
        style={{ appearance: 'auto', WebkitAppearance: 'auto' }}>
        {props.placeholder && <option value="" disabled>{props.placeholder}</option>}
        {(props.options || []).map(function (opt, i) {
          return <option key={i} value={opt}>{opt}</option>;
        })}
      </select>
      {hasError && <div className="field__error">{props.error}</div>}
    </div>
  );
}

function SchedRow({ group, highlight }) {
  return (
    <div className="sched-row">
      <div className={'sched-row__bar ' + (highlight ? 'sched-row__bar--teal' : 'sched-row__bar--dim')} />
      <div>
        <div className="sched-row__name">{group.label}</div>
        <div className="sched-row__ages">{group.ages}</div>
        <div className="sched-row__times">
          {group.times.map(function (t, i) {
            return (
              <span key={i} className="sched-row__time" style={{ color: highlight ? 'var(--fg-sub)' : 'var(--fg-muted)' }}>
                {t}
              </span>
            );
          })}
        </div>
      </div>
    </div>
  );
}

Object.assign(window, { IcLock, FHeader, Field, SelectField, SchedRow });
