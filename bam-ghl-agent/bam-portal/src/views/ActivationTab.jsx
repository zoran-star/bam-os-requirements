import { useEffect, useState } from "react";
import { SkelRows } from "../components/Skeleton.jsx";

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
      if (!r.ok) setErr(j.error || `HTTP ${r.status}`);
      await load();
    } catch (e) { setErr(e.message); }
    setBusy("");
  };
  // Styled replacement for the old window.prompt pair - small inline modal
  // with a proper status select + staging URL field.
  const [buildForm, setBuildForm] = useState(null); // { build_status, staging_url } | null
  const setBuildState = () => {
    setBuildForm({
      build_status: (data?.items?.website_build?.build_status) || "building",
      staging_url: data?.items?.website_build?.staging_url || "",
    });
  };
  const submitBuildState = () => {
    const f = buildForm;
    setBuildForm(null);
    buildApi("POST", { action: "set", build_status: f.build_status, ...(f.staging_url.trim() ? { staging_url: f.staging_url.trim() } : {}) });
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

  if (err) return <div style={{ color: "#e0654f", fontSize: 13 }}>Couldn't load activation status - {err} <button onClick={load} style={{ marginLeft: 8, background: "transparent", border: `1px solid ${t.border}`, borderRadius: 8, color: t.text, padding: "5px 10px", cursor: "pointer", font: "inherit", fontSize: 12 }}>Retry</button></div>;
  if (!data) return <div style={{ maxWidth: 680 }}><SkelRows n={7} avatar={false} t={t} pad="10px 4px" /></div>;

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
            <button onClick={setBuildState} disabled={!!busy} style={{ marginLeft: "auto", background: "transparent", border: `1px solid ${t.border}`, borderRadius: 8, color: t.text, padding: "4px 10px", cursor: "pointer", font: "inherit", fontSize: 11 }}>Set state</button>
          </div>
          {row(it.website_build.build_status === "verified", `Build: ${it.website_build.build_status}`, it.website_build.staging_url ? `Staging: ${it.website_build.staging_url}` : "Set the staging URL via Set state", ["building", "staging_ready"].includes(it.website_build.build_status))}
          {row(it.website_build.auto_ok, "Automated readiness", it.website_build.auto_ok ? "Last run passed (pages + offer endpoint)" : "Run it - checks staging pages + the offer endpoint")}
          {/* Build chunks (WS3): triggers fire server-side (setup-status evaluates
              on every owner visit + pings the client Slack channel); staff mark
              building/published here. Publishing the deck unlocks core; templates/sales/onboarding also need their inputs (setup-status.js chunk table)
              on the next evaluation. */}
          {Object.keys(it.website_build.chunks || {}).length > 0 || it.website_build.build_status ? (
            <div style={{ margin: "8px 0 2px" }}>
              <div style={{ fontSize: 10.5, fontWeight: 700, letterSpacing: 0.8, textTransform: "uppercase", color: t.textMute, margin: "6px 0" }}>Build chunks</div>
              {[["deck", "Branding deck"], ["core", "Core site pages"], ["templates", "Email templates"], ["sales", "Sales funnel + emails"], ["onboarding", "Onboarding funnel + emails"], ["agreement", "Branded agreement"]].map(([ck, label]) => {
                const c = (it.website_build.chunks || {})[ck] || {};
                const stt = c.status || "waiting";
                const color = stt === "published" ? "#7BC47F" : stt === "waiting" ? t.textMute : "#c79a4a";
                return (
                  <div style={{ ...S.row, padding: "7px 0" }} key={ck}>
                    <span style={{ flex: "none", width: 8, height: 8, borderRadius: 999, marginTop: 5, background: stt === "waiting" ? t.border : color }} />
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: 12.5, fontWeight: 700 }}>{label}</div>
                      <div style={{ fontSize: 11, color }}>{stt}</div>
                    </div>
                    {stt === "ready" || stt === "building" ? (
                      <div style={{ display: "flex", gap: 6 }}>
                        {stt === "ready" ? <button onClick={() => buildApi("POST", { action: "chunk", chunk: ck, status: "building" })} disabled={!!busy}
                          style={{ background: "transparent", border: `1px solid ${t.border}`, borderRadius: 8, color: t.text, padding: "3px 9px", cursor: "pointer", font: "inherit", fontSize: 11 }}>Building</button> : null}
                        <button onClick={() => buildApi("POST", { action: "chunk", chunk: ck, status: "published" })} disabled={!!busy}
                          style={{ background: "rgba(212,182,92,.12)", border: "1px solid rgba(212,182,92,.4)", borderRadius: 8, color: t.text, padding: "3px 9px", cursor: "pointer", font: "inherit", fontSize: 11, fontWeight: 700 }}>Published</button>
                      </div>
                    ) : null}
                  </div>
                );
              })}
            </div>
          ) : null}
          {[
            { key: "brand_ok", title: "Brand approved", sub: "Owner approves the brand board in Blueprint - Record only if they approved it with you directly" },
            { key: "site_accepted", title: "Owner accepted the site", sub: "Owner opens the staging link in their onboarding flow and clicks Accept - Record only as their proxy" },
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
                  style={{ background: "transparent", border: `1px solid ${t.border}`, borderRadius: 8, color: t.text, padding: "3px 9px", cursor: "pointer", font: "inherit", fontSize: 11 }}>
                  {on ? "Unsign" : k === "copy_ok" ? "Sign off" : "Record"}
                </button>
              </div>
            );
          })}
          <div style={{ display: "flex", gap: 10, marginTop: 10 }}>
            <button onClick={() => buildApi("GET", { action: "readiness" })} disabled={!!busy}
              style={{ background: "rgba(212,182,92,.12)", border: "1px solid rgba(212,182,92,.4)", borderRadius: 8, color: t.text, padding: "7px 13px", cursor: "pointer", font: "inherit", fontSize: 12, fontWeight: 700 }}>
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

      {/* Set-build-state modal (replaces the old window.prompt pair) */}
      {buildForm && (
        <div onClick={() => setBuildForm(null)} style={{ position: "fixed", inset: 0, zIndex: 9998, background: "rgba(0,0,0,0.55)", display: "flex", alignItems: "center", justifyContent: "center", padding: 20 }}>
          <div onClick={e => e.stopPropagation()} style={{ background: t.surface, border: `1px solid ${t.border}`, borderRadius: 16, padding: "22px 24px", maxWidth: 400, width: "100%", boxShadow: "0 16px 48px rgba(0,0,0,0.5)" }}>
            <div style={{ fontSize: 15, fontWeight: 700, color: t.text, marginBottom: 14 }}>Set website build state</div>
            <div style={{ ...S.label, marginBottom: 4 }}>Build status</div>
            <select value={buildForm.build_status} onChange={e => setBuildForm({ ...buildForm, build_status: e.target.value })}
              style={{ width: "100%", padding: "9px 11px", background: t.surfaceEl || t.surface, border: `1px solid ${t.border}`, borderRadius: 8, color: t.text, fontSize: 13, marginBottom: 12 }}>
              {["queued", "building", "staging_ready", "verified"].map(o => <option key={o} value={o}>{o}</option>)}
            </select>
            <div style={{ ...S.label, marginBottom: 4 }}>Staging URL (blank = keep current)</div>
            <input value={buildForm.staging_url} onChange={e => setBuildForm({ ...buildForm, staging_url: e.target.value })} placeholder="https://..."
              style={{ width: "100%", padding: "9px 11px", background: t.surfaceEl || t.surface, border: `1px solid ${t.border}`, borderRadius: 8, color: t.text, fontSize: 13, boxSizing: "border-box" }} />
            <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, marginTop: 18 }}>
              <button onClick={() => setBuildForm(null)} style={{ padding: "8px 16px", background: "transparent", color: t.textMute, border: `1px solid ${t.border}`, borderRadius: 8, fontSize: 13, cursor: "pointer" }}>Cancel</button>
              <button onClick={submitBuildState} style={{ padding: "8px 16px", background: "#D4B65C", color: "#0B0B0D", border: "none", borderRadius: 8, fontSize: 13, fontWeight: 700, cursor: "pointer" }}>Save</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
