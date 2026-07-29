import { useState } from "react";

// Client avatar: brand logo when set (clients.brand_data.logo), initials
// fallback. Shared by the Clients roster/detail and the staff Inbox.
export default function ClientAvatar({ client, tokens: t, size = 28 }) {
  const [broken, setBroken] = useState(false);
  const bd = client.brand_data || {};
  const logo = typeof bd.logo === "string" ? bd.logo : (bd.logo && bd.logo.url) || null;
  const initials = (client.business_name || "?")
    .split(/\s+/).map(w => w[0]).filter(Boolean).slice(0, 2).join("").toUpperCase();
  if (logo && !broken) {
    return <img src={logo} alt="" onError={() => setBroken(true)}
      style={{ width: size, height: size, borderRadius: 8, objectFit: "cover", flexShrink: 0, background: t.surface, border: `1px solid ${t.border}` }} />;
  }
  return (
    <div style={{ width: size, height: size, borderRadius: 8, flexShrink: 0, background: t.surface, border: `1px solid ${t.border}`, color: t.textSub, display: "flex", alignItems: "center", justifyContent: "center", fontSize: Math.round(size * 0.36), fontWeight: 700 }}>
      {initials}
    </div>
  );
}
