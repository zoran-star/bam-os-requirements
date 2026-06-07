/* ============================================================
   BAM GTA Signup Funnel — shared components + icons
   Thin, single-weight, square-cornered SVG glyphs only (brand rule).
   Exports to window for cross-file use.
   ============================================================ */

/* ---------- ICONS ---------- */
function IcCheck({ size = 12, w = 2 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <path d="M3 8.5L6.5 12L13 4" stroke="currentColor" strokeWidth={w} strokeLinecap="square" strokeLinejoin="miter" />
    </svg>
  );
}
function IcLock({ size = 14 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <rect x="3" y="7" width="10" height="7" stroke="currentColor" strokeWidth="1.4" />
      <path d="M5 7V5a3 3 0 0 1 6 0v2" stroke="currentColor" strokeWidth="1.4" />
    </svg>
  );
}
function IcCal({ size = 14 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <rect x="2.5" y="3.5" width="11" height="10" stroke="currentColor" strokeWidth="1.4" />
      <path d="M2.5 6.5h11M5.5 2v3M10.5 2v3" stroke="currentColor" strokeWidth="1.4" />
    </svg>
  );
}
function IcPause({ size = 14 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <rect x="4" y="3" width="3" height="10" stroke="currentColor" strokeWidth="1.4" />
      <rect x="9" y="3" width="3" height="10" stroke="currentColor" strokeWidth="1.4" />
    </svg>
  );
}
function IcMail({ size = 14 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <rect x="2" y="3.5" width="12" height="9" stroke="currentColor" strokeWidth="1.4" />
      <path d="M2.5 4.5L8 8.5l5.5-4" stroke="currentColor" strokeWidth="1.4" />
    </svg>
  );
}
function IcWarn({ size = 13 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <circle cx="8" cy="8" r="6.5" stroke="currentColor" strokeWidth="1.4" />
      <path d="M8 4.5v4.5M8 11.2v.1" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
    </svg>
  );
}
function IcShield({ size = 14 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <path d="M8 1.5l5 2v4c0 3-2.2 4.8-5 6-2.8-1.2-5-3-5-6v-4l5-2z" stroke="currentColor" strokeWidth="1.3" />
      <path d="M5.6 8l1.7 1.7L10.6 6" stroke="currentColor" strokeWidth="1.3" strokeLinecap="square" />
    </svg>
  );
}
function IcApple({ size = 18 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <path d="M17.05 12.6c-.03-2.6 2.12-3.85 2.22-3.91-1.21-1.77-3.1-2.01-3.77-2.04-1.6-.16-3.13.94-3.94.94-.81 0-2.07-.92-3.4-.9-1.75.03-3.36 1.02-4.26 2.58-1.82 3.16-.46 7.83 1.3 10.4.86 1.26 1.88 2.66 3.22 2.61 1.29-.05 1.78-.83 3.34-.83 1.56 0 2 .83 3.37.81 1.39-.03 2.27-1.28 3.12-2.54.98-1.46 1.39-2.87 1.41-2.94-.03-.01-2.7-1.04-2.73-4.13zM14.6 4.97c.71-.86 1.19-2.06 1.06-3.25-1.02.04-2.26.68-2.99 1.54-.66.76-1.23 1.98-1.08 3.15 1.14.09 2.3-.58 3.01-1.44z" />
    </svg>
  );
}
function IcGoogleG({ size = 17 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden="true">
      <path fill="#EA4335" d="M12 10.2v3.9h5.5c-.24 1.4-1.7 4.1-5.5 4.1-3.3 0-6-2.7-6-6.1s2.7-6.1 6-6.1c1.9 0 3.1.8 3.8 1.5l2.6-2.5C16.7 1.9 14.6 1 12 1 6.9 1 2.8 5.1 2.8 11.9S6.9 22.8 12 22.8c6 0 9.4-4.2 9.4-8.5 0-.6-.1-1-.1-1.5H12z" />
    </svg>
  );
}
function IcStore({ size = 22 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <path d="M17.05 12.6c-.03-2.6 2.12-3.85 2.22-3.91-1.21-1.77-3.1-2.01-3.77-2.04-1.6-.16-3.13.94-3.94.94-.81 0-2.07-.92-3.4-.9-1.75.03-3.36 1.02-4.26 2.58-1.82 3.16-.46 7.83 1.3 10.4.86 1.26 1.88 2.66 3.22 2.61 1.29-.05 1.78-.83 3.34-.83 1.56 0 2 .83 3.37.81 1.39-.03 2.27-1.28 3.12-2.54.98-1.46 1.39-2.87 1.41-2.94-.03-.01-2.7-1.04-2.73-4.13zM14.6 4.97c.71-.86 1.19-2.06 1.06-3.25-1.02.04-2.26.68-2.99 1.54-.66.76-1.23 1.98-1.08 3.15 1.14.09 2.3-.58 3.01-1.44z" />
    </svg>
  );
}
function IcPlay({ size = 20 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden="true">
      <path fill="#fff" d="M3.6 2.3c-.3.3-.5.7-.5 1.3v16.8c0 .6.2 1 .5 1.3l.1.1L13 12.1v-.2L3.7 2.2l-.1.1z" />
      <path fill="#fff" d="M16.3 15.3L13 12.1v-.2l3.3-3.2.1.1 3.9 2.2c1.1.6 1.1 1.7 0 2.3l-3.9 2.2-.1-.2z" opacity=".85" />
    </svg>
  );
}

/* ---------- PROGRESS HEADER ---------- */
function ProgressHeader({ step }) {
  // step: 1,2,3 (success uses no header)
  var labels = ['Who\u2019s signing up', 'Choose the plan', 'Confirm, sign & pay'];
  return (
    <header className="fhead">
      <div className="fhead__bar">
        <div className="fhead__brand">
          <div className="fhead__mark" />
          <div className="fhead__word">BAM&nbsp;GTA</div>
        </div>
        <div className="fhead__meta">
          <span>Secure signup</span>
          {step === 1 && <span className="dot" />}
          {step === 1 && <span>~2 min</span>}
        </div>
      </div>
      <div className="fprog">
        <div className="fprog__pips">
          {[1, 2, 3].map(function (n) {
            var cls = 'pip' + (n < step ? ' is-done' : '') + (n === step ? ' is-active' : '');
            return <span key={n} className={cls} />;
          })}
        </div>
        <div className="fprog__label">Step <b>{step}</b> of 3 · {labels[step - 1]}</div>
      </div>
    </header>
  );
}

/* ---------- FIELD ---------- */
function Field(props) {
  // label, value, onChange, placeholder, type, error, valid, inputMode, autoComplete, name, maxLength
  var hasError = !!props.error;
  var cls = 'field__input' + (hasError ? ' is-error' : (props.valid ? ' is-valid' : ''));
  return (
    <div className="field" style={props.style}>
      {props.label && <label className="field__lab" htmlFor={props.name}>{props.label}</label>}
      <input
        id={props.name}
        name={props.name}
        className={cls}
        type={props.type || 'text'}
        inputMode={props.inputMode}
        autoComplete={props.autoComplete}
        placeholder={props.placeholder}
        value={props.value}
        maxLength={props.maxLength}
        onChange={function (e) { props.onChange(e.target.value); }}
        onBlur={props.onBlur}
      />
      {(hasError || props.okMsg) && (
        <div className={'field__msg ' + (hasError ? 'is-error' : 'is-ok')}>
          {hasError ? <IcWarn /> : <IcCheck size={12} />}
          <span>{hasError ? props.error : props.okMsg}</span>
        </div>
      )}
      {props.children}
    </div>
  );
}

/* ---------- STICKY CTA ---------- */
function StickyCTA(props) {
  // summary (node, optional), label, onClick, disabled, loading, onBack
  return (
    <footer className="fcta">
      {props.summary}
      <button className="btn-primary" disabled={props.disabled || props.loading} onClick={props.onClick}>
        {props.loading
          ? (<><span className="spinner" /> {props.loadingLabel || 'Processing\u2026'}</>)
          : (<>{props.label} <span className="arrow">{'\u2192'}</span></>)}
      </button>
      {props.onBack && <button className="fcta__back" onClick={props.onBack}>{'\u2190'} Back</button>}
    </footer>
  );
}

Object.assign(window, {
  IcCheck: IcCheck, IcLock: IcLock, IcCal: IcCal, IcPause: IcPause, IcMail: IcMail,
  IcWarn: IcWarn, IcShield: IcShield, IcApple: IcApple, IcGoogleG: IcGoogleG,
  IcStore: IcStore, IcPlay: IcPlay,
  ProgressHeader: ProgressHeader, Field: Field, StickyCTA: StickyCTA
});
