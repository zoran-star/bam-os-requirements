import { useEffect, useState } from "react";

// Activation tab - the STAFF half of onboarding an academy to the GTA V2 state
// (accepted design 2026-07-14). The owner's half lives in the client portal's
// "Finish your onboarding" flow; this is everything BAM does: tier, Slack,
// invite, phone spine, website/ads, and the GHL migration ladder (run with
// Claude via the /ghl-pipeline-import runbook).
export default function ActivationTab({ client, tokens: t, session }) {
  const [data, setData] = useState(null);
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState("");

  const load = async () => {
    try {
      setErr("");
      const r = await fetch(`/api/admin/activation-status?client_id=${client.id}`, {
        headers: { Authorization: `Bearer ${session?.access_token}` },
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(j.error || `HTTP ${r.status}`);
      setData(j);
    } catch (e) { setErr(e.message); }
  };
  useEffect(() => { setData(null); load(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [client.id]);

  // Website build state machine controls (build-state.js).
  const buildApi = async (method, params) => {
    setBusy("build");
    try {
      const qs = method === "GET" ? `?client_id=${client.id}&action=${params.action}` : "";
      const r = await fetch(`/api/website/build-state${qs}`, {
        method,
        headers: { Authorization: `Bearer ${session?.access_token}`, "Content-Type": "application/json" },
        ...(method === "POST" ? { body: JSON.stringify({ client_id: client.id, ...params }) } : {}),
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) window.alert(j.error || `HTTP ${r.status}`);
      await load();
    } catch (e) { window.alert(e.message); }
    setBusy("");
  };
  const setBuildState = () => {
    const next = window.prompt("build_status (queued | building | staging_ready | verified):", (data?.items?.website_build?.build_status) || "building");
    if (!next) return;
    const staging = window.prompt("staging_url (blank = keep):", data?.items?.website_build?.staging_url || "");
    buildApi("POST", { action: "set", build_status: next.trim(), ...(staging ? { staging_url: staging.trim() } : {}) });
  };

  const S = {
    card: { background: t.surface, border: `1px solid ${t.border}`, borderRadius: 8, padding: 18, maxWidth: 680, marginBottom: 14 },
    label: { fontSize: 11, fontWeight: 700, letterSpacing: 0.8, textTransform: "uppercase", color: t.textMute },
    row: { display: "flex", alignItems: "flex-start", gap: 12, padding: "9px 0", borderBottom: `1px solid ${t.border}` },
  };
  const dot = (ok, warn) => (
    <span style={{ flex: "none", width: 9, height: 9, borderRadius: 999, marginTop: 5, background: ok ? "#7BC47F" : warn ? "#c79a4a" : t.border, border: ok || warn ? "none" : `1.5px solid ${t.textMute}` }} />
  );
  const row = (ok, title, sub, warn) => (
    <div style={S.row} key={title}>
      {dot(ok, warn)}
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 13, fontWeight: 700 }}>{title}</div>
        {sub ? <div style={{ fontSize: 11.5, color: t.textMute, marginTop: 1 }}>{sub}</div> : null}
      </div>
    </div>
  );

  if (err) return <div style={{ color: "#e0654f", fontSize: 13 }}>Couldn't load activation status - {err} <button onClick={load} style={{ marginLeft: 8, background: "transparent", border: `1px solid ${t.border}`, borderRadius: 6, color: t.text, padding: "5px 10px", cursor: "pointer", font: "inherit", fontSize: 12 }}>Retry</button></div>;
  if (!data) return <div style={{ color: t.textMute, fontSize: 13 }}>Loading activation status…</div>;

  const it = data.items || {};
  const mg = data.ghl_migration || {};
  const ph = it.phone || {};
  const phoneOk = ph.messaging_provider === "twilio";
  const phoneWarn = ph.status === "pending" || ph.status === "active";
  const phoneSub = phoneOk
    ? `Live on BAM Twilio (${ph.from_number || "number set"})`
    : ph.status === "none"
      ? "Not on the phone spine - start a port or buy a number in the Phone tab"
      : `Migration ${ph.status}: port ${ph.port_status || "-"} · A2P ${ph.a2p_required === false ? "not needed" : (ph.a2p_status || "pending")} - switch flips texting + calls when green`;

  return (
    <div>
      <div style={S.card}>
        <div style={{ ...S.label, marginBottom: 8 }}>Academy activation</div>
        {row(it.tier === "v2", `Tier: ${String(it.tier).toUpperCase()}`, it.tier === "v2" ? "V2 nav + agent eligibility unlocked" : "Flip to V2 in Overview when ready - it is the access gate, not a migration")}
        {row(it.slack_wired, "Slack channel wired", it.slack_wired ? "Owner notifications flow" : "Set it in Overview - notifications silently no-op without it")}
        {row(it.invites_active > 0, `Owner login (${it.invites_active} active user${it.invites_active === 1 ? "" : "s"})`, it.invites_active ? "Auto-resend cron chases unaccepted invites" : "Send the invite from the Team tab")}
        {row(it.stripe_connected, "Stripe connected", it.stripe_connected ? "Their own account takes every payment" : "Owner step - nudge them via the onboarding flow")}
        {row(it.website_live, "Website live", it.website_live ? "Domain flipped to the rebuilt site" : "Hand-built by us, then the owner flips DNS via the wizard")}
        {row(it.meta_connected, "Meta ads connected", it.meta_connected ? "Ad account wired" : "Wire in Client Setup when they run ads")}
        {row(phoneOk, "Phone: texting and calling", phoneSub, phoneWarn)}
        {row(it.booking_provider === "portal", "Free-trial booking on the portal", it.booking_provider === "portal" ? "Leads book portal slots" : "Flips via the offer's Schedule go-live once pricing lands")}
      </div>

      {it.website_build && it.website_build.build_status ? (
        <div style={{ ...S.card, borderColor: "rgba(212,182,92,.4)" }}>
          <div style={{ display: "flex", alignItems: "baseline", gap: 10, marginBottom: 4 }}>
            <div style={S.label}>Website build</div>
            <span style={{ fontSize: 10.5, color: t.textMute }}>build → staging → readiness → flip</span>
            <button onClick={setBuildState} disabled={!!busy} style={{ marginLeft: "auto", background: "transparent", border: `1px solid ${t.border}`, borderRadius: 6, color: t.text, padding: "4px 10px", cursor: "pointer", font: "inherit", fontSize: 11 }}>Set state</button>
          </div>
          {row(it.website_build.build_status === "verified", `Build: ${it.website_build.build_status}`, it.website_build.staging_url ? `Staging: ${it.website_build.staging_url}` : "Set the staging URL via Set state", ["building", "staging_ready"].includes(it.website_build.build_status))}
          {row(it.website_build.auto_ok, "Automated readiness", it.website_build.auto_ok ? "Last run passed (pages + offer endpoint)" : "Run it - checks staging pages + the offer endpoint")}
          {[
            { key: "brand_ok", title: "Brand approved", sub: "Owner approves the brand board in Blueprint - Record only if they approved it with you directly" },
            { key: "site_accepted", title: "Owner accepted the site", sub: "Owner opens the staging link in their onboarding flow and clicks Accept - Record only as their proxy" },
            { key: "copy_ok", title: "Copy proofed", sub: "Staff read every staging page's copy" },
          ].map(({ key: k, title, sub }) => {
            const m = it.website_build.manual || {};
            const on = m[k] === true;
            const stamp = on
              ? `${m[`${k}_by`] === "owner" ? "Accepted by the owner" : "Recorded by staff"}${m[`${k}_at`] ? ` - ${new Date(m[`${k}_at`]).toLocaleDateString(undefined, { month: "short", day: "numeric" })}` : ""}`
              : sub;
            return (
              <div style={S.row} key={k}>
                {dot(on)}
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 13, fontWeight: 700 }}>{title}</div>
                  <div style={{ fontSize: 11.5, color: t.textMute, marginTop: 1 }}>{stamp}</div>
                </div>
                <button onClick={() => buildApi("POST", { action: "sign", key: k, ok: !on })} disabled={!!busy}
                  style={{ background: "transparent", border: `1px solid ${t.border}`, borderRadius: 6, color: t.text, padding: "3px 9px", cursor: "pointer", font: "inherit", fontSize: 11 }}>
                  {on ? "Unsign" : k === "copy_ok" ? "Sign off" : "Record"}
                </button>
              </div>
            );
          })}
          <div style={{ display: "flex", gap: 10, marginTop: 10 }}>
            <button onClick={() => buildApi("GET", { action: "readiness" })} disabled={!!busy}
              style={{ background: "rgba(212,182,92,.12)", border: "1px solid rgba(212,182,92,.4)", borderRadius: 6, color: t.text, padding: "7px 13px", cursor: "pointer", font: "inherit", fontSize: 12, fontWeight: 700 }}>
              {busy === "build" ? "Working…" : "Run readiness checks"}
            </button>
            <div style={{ fontSize: 11, color: t.textMute, alignSelf: "center" }}>The domain wizard refuses to flip until build_status = verified.</div>
          </div>
        </div>
      ) : null}

      {mg.has_ghl ? (
        <div style={{ ...S.card, borderColor: "rgba(212,182,92,.4)" }}>
          <div style={{ display: "flex", alignItems: "baseline", gap: 10, marginBottom: 4 }}>
            <div style={S.label}>Bring their GHL over</div>
            <span style={{ fontSize: 10.5, color: t.textMute }}>run with Claude: /ghl-pipeline-import</span>
          </div>
          <div style={{ fontSize: 11.5, color: t.textMute, marginBottom: 6 }}>
            No pipeline mapping - apply the same Free Trial preset every academy runs, then Claude sorts their open cards into it.
          </div>
          {row(mg.ghl_connected, "GHL sub-account connected", "Unlocks the pull - contact sync starts automatically")}
          {row(mg.contacts_landed > 0, `Contacts imported (${mg.contacts_landed}${mg.contacts_landed >= 1000 ? "+" : ""})`, "The base every lead and cancelled record ties back to")}
          {row(mg.preset_applied, "Free Trial preset applied", mg.preset ? `${mg.preset.key} v${mg.preset.version} stamped on the offer` : "Owner applies it in the onboarding flow (or staff via the wizard)")}
          {row(mg.opportunities_in_store > 0, `Cards sorted into the pipeline (${mg.opportunities_in_store}${mg.opportunities_in_store >= 1000 ? "+" : ""})`, "The /ghl-pipeline-import runbook reads each open card and files it into a preset stage")}
          {row(mg.flipped, "Flipped to the portal board", mg.flipped ? "pipeline_provider=portal - agents work the imported leads" : "After reconcile is clean: the runbook flips pipeline_provider")}
        </div>
      ) : (
        <div style={S.card}>
          <div style={S.label}>GHL migration</div>
          <div style={{ fontSize: 12.5, color: t.textMute, marginTop: 8 }}>This academy has no GHL - born on V2, nothing to migrate.</div>
        </div>
      )}
    </div>
  );
}
