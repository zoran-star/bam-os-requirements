// Shared loading skeletons - replaces every "Loading…" text state so pages
// shimmer in the shape of their real content. Uses the .bp-skel pulse
// animation from src/index.css. Pass the view's `tokens` for on-theme bars;
// falls back to a neutral gray that works on both themes.
const barBg = (t) => (t && t.border) || "rgba(128,128,128,0.22)";

export function Skel({ w = "100%", h = 12, r = 999, t, style }) {
  return <div className="bp-skel" style={{ width: w, height: h, borderRadius: r, background: barBg(t), ...style }} />;
}

// List rows: optional avatar square + two text bars. The default shape for
// ticket queues, rosters, and settings lists.
export function SkelRows({ n = 5, avatar = true, t, pad = "13px 16px", divider = true }) {
  return (
    <div>
      {Array.from({ length: n }).map((_, i) => (
        <div key={i} style={{ display: "flex", alignItems: "center", gap: 12, padding: pad, borderBottom: divider ? `1px solid ${barBg(t)}` : "none" }}>
          {avatar && <Skel w={30} h={30} r={8} t={t} />}
          <div style={{ flex: 1 }}>
            <Skel w={`${45 + ((i * 17) % 30)}%`} h={11} t={t} style={{ marginBottom: 7 }} />
            <Skel w={`${65 + ((i * 23) % 25)}%`} h={9} t={t} />
          </div>
        </div>
      ))}
    </div>
  );
}

// Card grid: the shape for tile layouts (team cards, resource cards, per-academy
// performance cards).
export function SkelCards({ n = 6, h = 96, cols = "repeat(auto-fill, minmax(280px, 1fr))", t }) {
  return (
    <div style={{ display: "grid", gridTemplateColumns: cols, gap: 12 }}>
      {Array.from({ length: n }).map((_, i) => (
        <div key={i} style={{ height: h, borderRadius: 12, border: `1px solid ${barBg(t)}`, padding: 16, display: "flex", gap: 12, alignItems: "center" }}>
          <Skel w={40} h={40} r={10} t={t} />
          <div style={{ flex: 1 }}>
            <Skel w="55%" h={12} t={t} style={{ marginBottom: 8 }} />
            <Skel w="80%" h={9} t={t} />
          </div>
        </div>
      ))}
    </div>
  );
}

// Stat tile strip: big number + label placeholders.
export function SkelStats({ n = 3, t }) {
  return (
    <div style={{ display: "flex", gap: 12, marginBottom: 18, flexWrap: "wrap" }}>
      {Array.from({ length: n }).map((_, i) => (
        <div key={i} style={{ borderRadius: 12, border: `1px solid ${barBg(t)}`, padding: "14px 18px", minWidth: 150 }}>
          <Skel w={54} h={22} r={6} t={t} style={{ marginBottom: 8 }} />
          <Skel w={110} h={9} t={t} />
        </div>
      ))}
    </div>
  );
}

// Chat bubbles: alternating sides, for message threads.
export function SkelBubbles({ n = 4, t }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 10, padding: "8px 4px" }}>
      {Array.from({ length: n }).map((_, i) => {
        const mine = i % 2 === 1;
        return (
          <div key={i} style={{ display: "flex", justifyContent: mine ? "flex-end" : "flex-start" }}>
            <Skel w={`${38 + ((i * 19) % 26)}%`} h={34} r={12} t={t} />
          </div>
        );
      })}
    </div>
  );
}

// Whole-page fallback for lazy view loads (App Suspense): title + toolbar +
// content rows, so switching pages never flashes bare text.
export function SkelPage({ t }) {
  return (
    <div style={{ padding: "24px 28px" }}>
      <Skel w={180} h={20} r={8} t={t} style={{ marginBottom: 10 }} />
      <Skel w={280} h={11} t={t} style={{ marginBottom: 24 }} />
      <div style={{ display: "flex", gap: 10, marginBottom: 20 }}>
        <Skel w={240} h={34} r={8} t={t} />
        <Skel w={120} h={34} r={8} t={t} />
        <Skel w={120} h={34} r={8} t={t} />
      </div>
      <div style={{ borderRadius: 12, border: `1px solid ${barBg(t)}`, overflow: "hidden" }}>
        <SkelRows n={6} t={t} />
      </div>
    </div>
  );
}
