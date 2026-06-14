import { useState, useEffect } from "react";
import { supabase } from "../lib/supabase";
import { MarketingTab } from "./ClientsCombinedView";

// "Our Ads" — staff-only view of BAM's OWN ad campaigns (the ads we run to
// acquire academy clients). Our internal campaigns live mixed in on the same
// Meta ad account as a client, so we model "us" as a dedicated internal entry
// in the `clients` table with its OWN meta_campaign_ids filter. That filter is
// separate from any real client's, so picking our campaigns here never changes
// what a client sees in their portal.
//
// Which entry is "ours" is configured once via VITE_INTERNAL_ADS_CLIENT_ID.
// Until that's set (or if the id is wrong), we show setup instructions instead
// of a broken view.
//
// This view reuses MarketingTab (the same ad-account picker + campaign picker +
// performance dashboard used per-client) so there is no duplicated Meta code.
// Access is gated to the internal-acquisition allowlist in App.jsx by email.

const INTERNAL_CLIENT_ID = import.meta.env.VITE_INTERNAL_ADS_CLIENT_ID || "";

function Note({ tokens, children }) {
  return (
    <div style={{ padding: 20, color: tokens.textSub, fontSize: 14, lineHeight: 1.6, maxWidth: 640 }}>{children}</div>
  );
}

export default function OurAdsView({ tokens, session, me }) {
  const t = tokens;
  const [client, setClient] = useState(null);
  // Start "loaded" when there's nothing to fetch, so we never call setState
  // synchronously inside the effect just to flip the loading flag off.
  const [loading, setLoading] = useState(!!INTERNAL_CLIENT_ID);
  const [err, setErr] = useState("");

  useEffect(() => {
    if (!INTERNAL_CLIENT_ID) return;
    let cancelled = false;
    (async () => {
      const { data, error } = await supabase
        .from("clients")
        .select("*")
        .eq("id", INTERNAL_CLIENT_ID)
        .maybeSingle();
      if (cancelled) return;
      if (error) setErr(error.message);
      else setClient(data || null);
      setLoading(false);
    })();
    return () => { cancelled = true; };
  }, []);

  if (loading) return <Note tokens={t}>Loading our campaigns…</Note>;

  if (!INTERNAL_CLIENT_ID) {
    return (
      <Note tokens={t}>
        <div style={{ fontSize: 16, fontWeight: 700, color: t.text, marginBottom: 8 }}>Not set up yet</div>
        This tab shows our own ad campaigns. To turn it on:
        <ol style={{ marginTop: 12, paddingLeft: 20 }}>
          <li>Create (or pick) a dedicated internal entry in <strong>Clients</strong> for our own ads — e.g. "By Any Means — Internal Ads".</li>
          <li>Wire it to <strong>our Meta ad account</strong> on that entry's Marketing tab.</li>
          <li>Copy that entry's ID and set <code style={{ color: t.accent }}>VITE_INTERNAL_ADS_CLIENT_ID</code> in Vercel, then redeploy.</li>
        </ol>
        After that, this tab lets you pick exactly which campaigns on that account are <strong>ours</strong> — the same checklist clients' campaigns use.
      </Note>
    );
  }

  if (err) return <Note tokens={t}><span style={{ color: t.red }}>Couldn't load: {err}</span></Note>;

  if (!client) {
    return (
      <Note tokens={t}>
        <span style={{ color: t.red }}>The configured internal entry wasn't found.</span> Check that{" "}
        <code style={{ color: t.accent }}>VITE_INTERNAL_ADS_CLIENT_ID</code> points to a real Clients entry.
      </Note>
    );
  }

  return (
    <div>
      <div style={{ padding: "0 4px 16px", color: t.textSub, fontSize: 13, lineHeight: 1.5, maxWidth: 720 }}>
        Our own campaigns, pulled live from our Meta ad account. Use <strong>Pick campaigns</strong> to choose
        which campaigns count as ours — this only affects this tab, never what clients see.
      </div>
      <MarketingTab
        client={client}
        tokens={t}
        role={me?.role || ""}
        session={session}
        onChanged={() => {
          // Re-fetch the internal entry so a freshly-saved ad account / campaign
          // selection is reflected without a full reload.
          supabase.from("clients").select("*").eq("id", INTERNAL_CLIENT_ID).maybeSingle()
            .then(({ data }) => { if (data) setClient(data); });
        }}
      />
    </div>
  );
}
