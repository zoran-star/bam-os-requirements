import { useState, useEffect, useRef, useMemo } from "react";
import { fetchChannels, fetchMessages, sendMessage } from "../services/slackService";
import { useIsMobile } from '../hooks/useMediaQuery';

/* ─── Skeleton ─── */
function SkeletonBlock({ width, height, tokens, style }) {
  return (
    <div style={{
      width: width || "100%", height: height || 16, borderRadius: 6,
      background: tokens.borderMed,
      animation: "cardIn 1.5s ease-in-out infinite alternate",
      ...style,
    }} />
  );
}

function SkeletonChannel({ tokens, delay = 0 }) {
  return (
    <div style={{ display: "flex", gap: 10, padding: "12px 16px", alignItems: "center" }}>
      <SkeletonBlock width={36} height={36} tokens={tokens} style={{ borderRadius: "50%", flexShrink: 0, animationDelay: `${delay}ms` }} />
      <div style={{ flex: 1 }}>
        <SkeletonBlock width="70%" height={13} tokens={tokens} style={{ marginBottom: 6, animationDelay: `${delay + 80}ms` }} />
        <SkeletonBlock width="90%" height={11} tokens={tokens} style={{ animationDelay: `${delay + 160}ms` }} />
      </div>
    </div>
  );
}

function SkeletonMessage({ tokens, delay = 0, align = "left" }) {
  return (
    <div style={{ display: "flex", gap: 12, padding: "8px 0", alignItems: "flex-start" }}>
      <SkeletonBlock width={32} height={32} tokens={tokens} style={{ borderRadius: "50%", flexShrink: 0, animationDelay: `${delay}ms` }} />
      <div style={{ flex: 1 }}>
        <SkeletonBlock width={100} height={12} tokens={tokens} style={{ marginBottom: 6, animationDelay: `${delay + 80}ms` }} />
        <SkeletonBlock width={align === "left" ? "75%" : "50%"} height={14} tokens={tokens} style={{ animationDelay: `${delay + 160}ms` }} />
      </div>
    </div>
  );
}

/* ─── Avatar ─── */
const AVATAR_COLORS = {
  Coleman: "#D4CF8A",
  Mike: "#60A5FA",
  Silva: "#34D399",
  Zoran: "#C084FC",
  Graham: "#34D399",
  Ximena: "#F472B6",
  Aneka: "#FB923C",
  Brandon: "#38BDF8",
};

function MessageAvatar({ name, tokens, size = 32, collapsed = false }) {
  if (collapsed) return <div style={{ width: size, height: size, flexShrink: 0 }} />;
  const firstName = (name || "?").split(" ")[0];
  const color = AVATAR_COLORS[firstName] || tokens.accent;
  const initial = (name || "?")[0].toUpperCase();
  return (
    <div style={{
      width: size, height: size, borderRadius: "50%", flexShrink: 0,
      background: color + "18",
      border: `1.5px solid ${color}40`,
      display: "flex", alignItems: "center", justifyContent: "center",
      fontSize: size === 32 ? 13 : 11, fontWeight: 700, color,
      transition: "all 0.2s cubic-bezier(0.22, 1, 0.36, 1)",
    }}>
      {initial}
    </div>
  );
}

/* ─── Emoji Map (common Slack shortcodes) ─── */
const EMOJI_MAP = {
  smile: "😊", grinning: "😀", joy: "😂", heart: "❤️", thumbsup: "👍", "+1": "👍",
  thumbsdown: "👎", "-1": "👎", wave: "👋", clap: "👏", fire: "🔥", rocket: "🚀",
  eyes: "👀", pray: "🙏", raised_hands: "🙌", muscle: "💪", tada: "🎉", party_popper: "🎉",
  sparkles: "✨", star: "⭐", check: "✅", white_check_mark: "✅", x: "❌", warning: "⚠️",
  bulb: "💡", memo: "📝", chart_with_upwards_trend: "📈", money_with_wings: "💸",
  dollar: "💵", moneybag: "💰", gem: "💎", trophy: "🏆", medal: "🏅", crown: "👑",
  ok_hand: "👌", point_up: "☝️", point_down: "👇", point_left: "👈", point_right: "👉",
  thinking_face: "🤔", thinking: "🤔", facepalm: "🤦", shrug: "🤷",
  laughing: "😆", sweat_smile: "😅", wink: "😉", blush: "😊", heart_eyes: "😍",
  sunglasses: "😎", sob: "😭", angry: "😠", scream: "😱", sleeping: "😴",
  rolling_on_the_floor_laughing: "🤣", slightly_smiling_face: "🙂",
  disappointed: "😞", confused: "😕", neutral_face: "😐", expressionless: "😑",
  coffee: "☕", beer: "🍺", pizza: "🍕", cake: "🎂", hamburger: "🍔",
  dog: "🐕", cat: "🐱", unicorn: "🦄", snake: "🐍", eagle: "🦅",
  sun: "☀️", cloud: "☁️", rain: "🌧️", snow: "❄️", lightning: "⚡",
  phone: "📱", laptop: "💻", email: "📧", calendar: "📅", clock: "🕐",
  link: "🔗", lock: "🔒", key: "🔑", bell: "🔔", speaker: "🔊",
  pin: "📌", paperclip: "📎", scissors: "✂️", pencil: "✏️", pen: "🖊️",
  hundred: "💯", boom: "💥", collision: "💥", zap: "⚡", dizzy: "💫",
  sweat_drops: "💦", dash: "💨", hole: "🕳️", bomb: "💣",
  speech_balloon: "💬", thought_balloon: "💭", zzz: "💤",
  red_circle: "🔴", blue_circle: "🔵", green_circle: "🟢", yellow_circle: "🟡",
  heavy_check_mark: "✔️", heavy_plus_sign: "➕", heavy_minus_sign: "➖",
  arrow_right: "➡️", arrow_left: "⬅️", arrow_up: "⬆️", arrow_down: "⬇️",
  new: "🆕", free: "🆓", sos: "🆘", no_entry: "⛔", stop_sign: "🛑",
  construction: "🚧", rotating_light: "🚨",
};

/* ─── Message Formatting ─── */
function formatMessageText(text) {
  if (!text) return "";

  // Split into segments for rendering
  const parts = [];
  let remaining = text;
  let key = 0;

  while (remaining.length > 0) {
    // Code block (```)
    let match = remaining.match(/^```([\s\S]*?)```/);
    if (match) {
      parts.push(<pre key={key++} style={{
        background: "rgba(128,128,128,0.1)", borderRadius: 6,
        padding: "8px 12px", margin: "4px 0", fontSize: 13,
        fontFamily: "'SF Mono', 'Fira Code', monospace",
        overflowX: "auto", whiteSpace: "pre-wrap", lineHeight: 1.5,
      }}>{match[1]}</pre>);
      remaining = remaining.slice(match[0].length);
      continue;
    }

    // Inline code (`)
    match = remaining.match(/^`([^`]+)`/);
    if (match) {
      parts.push(<code key={key++} style={{
        background: "rgba(128,128,128,0.15)", borderRadius: 4,
        padding: "1px 5px", fontSize: "0.9em",
        fontFamily: "'SF Mono', 'Fira Code', monospace",
      }}>{match[1]}</code>);
      remaining = remaining.slice(match[0].length);
      continue;
    }

    // Bold (*text*)
    match = remaining.match(/^\*([^*]+)\*/);
    if (match) {
      parts.push(<strong key={key++}>{match[1]}</strong>);
      remaining = remaining.slice(match[0].length);
      continue;
    }

    // Italic (_text_)
    match = remaining.match(/^_([^_]+)_/);
    if (match) {
      parts.push(<em key={key++}>{match[1]}</em>);
      remaining = remaining.slice(match[0].length);
      continue;
    }

    // Strikethrough (~text~)
    match = remaining.match(/^~([^~]+)~/);
    if (match) {
      parts.push(<s key={key++}>{match[1]}</s>);
      remaining = remaining.slice(match[0].length);
      continue;
    }

    // Emoji shortcodes (:emoji:)
    match = remaining.match(/^:([a-z0-9_+-]+):/);
    if (match) {
      const emoji = EMOJI_MAP[match[1]];
      if (emoji) {
        parts.push(<span key={key++}>{emoji}</span>);
      } else {
        parts.push(<span key={key++} style={{ opacity: 0.6 }}>{match[0]}</span>);
      }
      remaining = remaining.slice(match[0].length);
      continue;
    }

    // URLs — Slack format <url|label> or <url>
    match = remaining.match(/^<(https?:\/\/[^|>]+)\|([^>]+)>/);
    if (match) {
      parts.push(<a key={key++} href={match[1]} target="_blank" rel="noopener noreferrer" style={{
        color: "inherit", opacity: 0.85, textDecoration: "underline",
        textDecorationColor: "rgba(128,128,128,0.4)", textUnderlineOffset: 2,
      }}>{match[2]}</a>);
      remaining = remaining.slice(match[0].length);
      continue;
    }
    match = remaining.match(/^<(https?:\/\/[^>]+)>/);
    if (match) {
      parts.push(<a key={key++} href={match[1]} target="_blank" rel="noopener noreferrer" style={{
        color: "inherit", opacity: 0.85, textDecoration: "underline",
        textDecorationColor: "rgba(128,128,128,0.4)", textUnderlineOffset: 2,
        wordBreak: "break-all",
      }}>{match[1]}</a>);
      remaining = remaining.slice(match[0].length);
      continue;
    }

    // Plain URL
    match = remaining.match(/^(https?:\/\/[^\s<]+)/);
    if (match) {
      parts.push(<a key={key++} href={match[1]} target="_blank" rel="noopener noreferrer" style={{
        color: "inherit", opacity: 0.85, textDecoration: "underline",
        textDecorationColor: "rgba(128,128,128,0.4)", textUnderlineOffset: 2,
        wordBreak: "break-all",
      }}>{match[1]}</a>);
      remaining = remaining.slice(match[0].length);
      continue;
    }

    // Newline
    if (remaining[0] === "\n") {
      parts.push(<br key={key++} />);
      remaining = remaining.slice(1);
      continue;
    }

    // Plain text chunk (up to next special character)
    match = remaining.match(/^[^`*_~:<\nhttps]+/);
    if (match) {
      parts.push(<span key={key++}>{match[0]}</span>);
      remaining = remaining.slice(match[0].length);
      continue;
    }

    // Single character fallback
    parts.push(<span key={key++}>{remaining[0]}</span>);
    remaining = remaining.slice(1);
  }

  return parts;
}

/* ─── Helpers ─── */
function formatTimestamp(ts) {
  if (!ts) return "";
  const sec = parseFloat(ts);
  if (isNaN(sec)) return ts;
  const d = new Date(sec * 1000);
  return d.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
}

function formatFullTimestamp(ts) {
  if (!ts) return "";
  const sec = parseFloat(ts);
  if (isNaN(sec)) return "";
  const d = new Date(sec * 1000);
  return d.toLocaleDateString("en-US", {
    weekday: "long", year: "numeric", month: "long", day: "numeric",
    hour: "numeric", minute: "2-digit",
  });
}

function dateLabel(ts) {
  if (!ts) return "";
  const sec = parseFloat(ts);
  if (isNaN(sec)) return "";
  const d = new Date(sec * 1000);
  const today = new Date();
  const yesterday = new Date(today);
  yesterday.setDate(yesterday.getDate() - 1);
  if (d.toDateString() === today.toDateString()) return "Today";
  if (d.toDateString() === yesterday.toDateString()) return "Yesterday";
  return d.toLocaleDateString("en-US", { weekday: "long", month: "short", day: "numeric" });
}

function groupMessagesByDate(messages) {
  const groups = [];
  let currentLabel = null;
  for (const msg of messages) {
    const label = dateLabel(msg.timestamp);
    if (label !== currentLabel) {
      currentLabel = label;
      groups.push({ label, messages: [] });
    }
    groups[groups.length - 1].messages.push(msg);
  }
  return groups;
}

function timeAgo(ts) {
  if (!ts) return "";
  const sec = parseFloat(ts);
  if (isNaN(sec)) return "";
  const diff = (Date.now() / 1000) - sec;
  if (diff < 60) return "now";
  if (diff < 3600) return `${Math.floor(diff / 60)}m`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h`;
  if (diff < 604800) return `${Math.floor(diff / 86400)}d`;
  return `${Math.floor(diff / 604800)}w`;
}

/* ─── Icons ─── */
function IconHash({ size = 16, color }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <line x1="4" y1="9" x2="20" y2="9" /><line x1="4" y1="15" x2="20" y2="15" />
      <line x1="10" y1="3" x2="8" y2="21" /><line x1="16" y1="3" x2="14" y2="21" />
    </svg>
  );
}

function IconSend({ size = 18, color }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <line x1="22" y1="2" x2="11" y2="13" /><polygon points="22 2 15 22 11 13 2 9 22 2" />
    </svg>
  );
}

function IconSearch({ size = 15, color }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="11" cy="11" r="8" /><line x1="21" y1="21" x2="16.65" y2="16.65" />
    </svg>
  );
}

function IconThread({ size = 14, color }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
    </svg>
  );
}

function IconLock({ size = 12, color }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <rect x="3" y="11" width="18" height="11" rx="2" ry="2" /><path d="M7 11V7a5 5 0 0 1 10 0v4" />
    </svg>
  );
}

function IconFile({ size = 14, color }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" /><polyline points="14 2 14 8 20 8" />
    </svg>
  );
}

/* ─── Main Component ─── */
export default function CommunicationView({ tokens, dark }) {
  const isMobile = useIsMobile();
  const [channels, setChannels] = useState([]);
  const [activeChannel, setActiveChannel] = useState(null);
  const [showChannelList, setShowChannelList] = useState(true);
  const [messages, setMessages] = useState([]);
  const [search, setSearch] = useState("");
  const [draft, setDraft] = useState("");
  const [sidebarTab, setSidebarTab] = useState("channels"); // "channels" | "dms"
  const [sortMode, setSortMode] = useState("recent"); // "recent" | "favorites"
  const [favorites, setFavorites] = useState(() => {
    try { return JSON.parse(localStorage.getItem("slack_favorites") || "[]"); } catch { return []; }
  });
  const [loadingChannels, setLoadingChannels] = useState(true);
  const [loadingMessages, setLoadingMessages] = useState(false);
  const [sendingMessage, setSendingMessage] = useState(false);

  const messagesEndRef = useRef(null);
  const messagesContainerRef = useRef(null);
  const textareaRef = useRef(null);

  // Load channels
  useEffect(() => {
    let cancelled = false;
    fetchChannels().then(({ data }) => {
      if (!cancelled && data) {
        setChannels(data);
        setLoadingChannels(false);
      }
    });
    return () => { cancelled = true; };
  }, []);

  // Load messages when channel changes + poll every 10s for new messages
  useEffect(() => {
    if (!activeChannel) return;
    let cancelled = false;
    setLoadingMessages(true);
    setDraft("");
    fetchMessages(activeChannel.id).then(({ data }) => {
      if (!cancelled) {
        setMessages(data || []);
        setLoadingMessages(false);
      }
    });
    // Poll for new messages every 10 seconds
    const poll = setInterval(() => {
      if (cancelled) return;
      fetchMessages(activeChannel.id).then(({ data }) => {
        if (!cancelled && data) {
          setMessages(prev => {
            // Only update if message count changed (avoids unnecessary re-renders / scroll jumps)
            if (data.length !== prev.length) return data;
            // Or if newest message ID differs
            if (data.length > 0 && prev.length > 0 && data[0].id !== prev[0].id) return data;
            return prev;
          });
        }
      });
    }, 10000);
    return () => { cancelled = true; clearInterval(poll); };
  }, [activeChannel?.id]);

  // Scroll to bottom when messages change
  useEffect(() => {
    const el = messagesContainerRef.current;
    if (el) {
      requestAnimationFrame(() => {
        el.scrollTop = el.scrollHeight;
      });
    }
  }, [messages]);

  // Filter channels by search
  const filteredChannels = useMemo(() => {
    if (!search.trim()) return channels;
    const q = search.toLowerCase();
    return channels.filter(c =>
      c.name.toLowerCase().includes(q) ||
      (c.topic || "").toLowerCase().includes(q) ||
      (c.purpose || "").toLowerCase().includes(q)
    );
  }, [channels, search]);

  // Toggle favorite
  const toggleFavorite = (channelId) => {
    setFavorites(prev => {
      const next = prev.includes(channelId) ? prev.filter(id => id !== channelId) : [...prev, channelId];
      localStorage.setItem("slack_favorites", JSON.stringify(next));
      return next;
    });
  };

  // Sort helper: favorites-first then alpha, or by recency
  const sortChannels = (list) => {
    if (sortMode === "favorites") {
      return [...list].sort((a, b) => {
        const aFav = favorites.includes(a.id) ? 0 : 1;
        const bFav = favorites.includes(b.id) ? 0 : 1;
        if (aFav !== bFav) return aFav - bFav;
        return (b.updated || 0) - (a.updated || 0);
      });
    }
    // "recent" — already sorted by API, but ensure it
    return [...list].sort((a, b) => (b.updated || 0) - (a.updated || 0));
  };

  // Group channels by type
  const dmChannels = sortChannels(filteredChannels.filter(c => c.isDM));
  const groupDMChannels = sortChannels(filteredChannels.filter(c => c.isGroupDM));
  const regularChannels = filteredChannels.filter(c => !c.isDM && !c.isGroupDM);
  const clientChannels = sortChannels(regularChannels.filter(c => c.name.includes("client") || c.name.match(/^(bam-(?!general|marketing|operations)|btg|pro-?bound|prime|da-hoops|hoopgen|straight|supreme|ice-|danny|johnson|performance|geneius)/i)));
  const internalChannels = sortChannels(regularChannels.filter(c => !clientChannels.includes(c)));

  // Group messages by date (reversed for chronological chat order)
  const messageGroups = useMemo(() => groupMessagesByDate([...messages].reverse()), [messages]);

  // Check if consecutive message from same user (for compact display)
  function isSameUser(group, mi) {
    if (mi === 0) return false;
    const prev = group.messages[mi - 1];
    const curr = group.messages[mi];
    if (!prev || !curr) return false;
    if (prev.userName !== curr.userName) return false;
    // Also collapse if within 5 minutes
    const timeDiff = Math.abs(parseFloat(curr.timestamp) - parseFloat(prev.timestamp));
    return timeDiff < 300;
  }

  // Send handler
  const handleSend = async () => {
    if (!draft.trim() || !activeChannel || sendingMessage) return;
    const text = draft.trim();
    setDraft("");
    setSendingMessage(true);
    if (textareaRef.current) {
      textareaRef.current.style.height = "40px";
    }
    const { data } = await sendMessage(activeChannel.id, text);
    if (data) {
      // Optimistic update so message appears instantly
      setMessages(prev => [...prev, {
        id: data.id || `local-${Date.now()}`,
        text,
        user: "U_COLEMAN",
        userName: data.userName || "Coleman",
        timestamp: data.timestamp || String(Date.now() / 1000),
        threadTs: null,
        replyCount: 0,
      }]);
      // Re-fetch after short delay to get server-confirmed state
      setTimeout(() => {
        fetchMessages(activeChannel.id).then(({ data: fresh }) => {
          if (fresh) setMessages(fresh);
        });
      }, 1500);
    }
    setSendingMessage(false);
  };

  // Key handler for textarea
  const handleKeyDown = (e) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  // Auto-resize textarea
  const handleInput = (e) => {
    setDraft(e.target.value);
    const el = e.target;
    el.style.height = "40px";
    el.style.height = Math.min(el.scrollHeight, 120) + "px";
  };

  const spring = "cubic-bezier(0.22, 1, 0.36, 1)";

  return (
    <div style={{
      display: "flex", height: isMobile ? "calc(100vh - 160px)" : "calc(100vh - 220px)", borderRadius: 16,
      border: `1px solid ${tokens.border}`, overflow: "hidden",
      background: tokens.surface,
      boxShadow: tokens.cardShadow,
      animation: "cardIn 0.4s cubic-bezier(0.22, 1, 0.36, 1) both",
    }}>

      {/* ─── Left Panel: Channel List ─── */}
      <div style={{
        width: isMobile ? "100%" : 300, minWidth: isMobile ? 0 : 300, borderRight: `1px solid ${tokens.border}`,
        display: isMobile && activeChannel ? "none" : "flex", flexDirection: "column", background: tokens.surface,
        flexShrink: 0,
      }}>

        {/* Toggle Tabs + Search */}
        <div style={{ padding: "12px 12px 0" }}>
          {/* Channels / DMs toggle */}
          <div style={{
            display: "flex", borderRadius: 10, overflow: "hidden",
            background: tokens.surfaceEl,
            border: `1px solid ${tokens.border}`,
            padding: 3,
          }}>
            {[
              { key: "channels", label: "Channels", count: clientChannels.length + internalChannels.length },
              { key: "dms", label: "DMs", count: dmChannels.length + groupDMChannels.length },
            ].map(tab => (
              <button
                key={tab.key}
                onClick={() => setSidebarTab(tab.key)}
                style={{
                  flex: 1, padding: "7px 0", border: "none", cursor: "pointer",
                  borderRadius: 8, fontSize: 12, fontWeight: 600, fontFamily: "inherit",
                  transition: `all 0.2s ${spring}`,
                  background: sidebarTab === tab.key ? tokens.accent : "transparent",
                  color: sidebarTab === tab.key ? (dark ? "#08080A" : "#FFFFFF") : tokens.textMute,
                  display: "flex", alignItems: "center", justifyContent: "center", gap: 5,
                }}
              >
                {tab.label}
                {tab.count > 0 && (
                  <span style={{
                    fontSize: 10, fontWeight: 700,
                    background: sidebarTab === tab.key ? "rgba(255,255,255,0.25)" : tokens.border,
                    padding: "1px 5px", borderRadius: 6, minWidth: 18, textAlign: "center",
                  }}>
                    {tab.count}
                  </span>
                )}
              </button>
            ))}
          </div>

          {/* Search */}
          <div style={{
            display: "flex", alignItems: "center", gap: 8,
            padding: "8px 12px", borderRadius: 10, marginTop: 8,
            background: tokens.surfaceEl,
            border: `1px solid ${tokens.border}`,
            transition: `all 0.25s ${spring}`,
          }}>
            <IconSearch color={tokens.textMute} />
            <input
              type="text"
              placeholder={sidebarTab === "channels" ? "Search channels..." : "Search conversations..."}
              value={search}
              onChange={e => setSearch(e.target.value)}
              aria-label="Search conversations"
              style={{
                flex: 1, border: "none", outline: "none", background: "transparent",
                color: tokens.text, fontSize: 13, fontFamily: "inherit",
              }}
            />
            {search && (
              <button
                onClick={() => setSearch("")}
                aria-label="Clear search"
                style={{
                  background: "none", border: "none", cursor: "pointer",
                  color: tokens.textMute, fontSize: 14, padding: 0, lineHeight: 1,
                }}
              >
                x
              </button>
            )}
          </div>

          {/* Sort toggle: Recent / Favorites */}
          <div style={{
            display: "flex", alignItems: "center", gap: 4, marginTop: 8,
            padding: "0 2px",
          }}>
            {[
              { key: "recent", label: "Recent", icon: "\u{1F552}" },
              { key: "favorites", label: "Starred", icon: "\u2B50" },
            ].map(s => (
              <button
                key={s.key}
                onClick={() => setSortMode(s.key)}
                style={{
                  flex: 1, padding: "5px 0", border: "none", cursor: "pointer",
                  borderRadius: 6, fontSize: 11, fontWeight: 600, fontFamily: "inherit",
                  transition: `all 0.2s ${spring}`,
                  background: sortMode === s.key ? tokens.surfaceEl : "transparent",
                  color: sortMode === s.key ? tokens.text : tokens.textMute,
                  display: "flex", alignItems: "center", justifyContent: "center", gap: 4,
                  border: `1px solid ${sortMode === s.key ? tokens.border : "transparent"}`,
                }}
              >
                <span style={{ fontSize: 11 }}>{s.icon}</span>
                {s.label}
              </button>
            ))}
          </div>
        </div>

        {/* Channel / DM list */}
        <div style={{ flex: 1, overflowY: "auto", padding: "4px 8px 16px" }}>

          {loadingChannels ? (
            <>
              {[0, 1, 2, 3, 4, 5].map(i => (
                <SkeletonChannel key={i} tokens={tokens} delay={i * 80} />
              ))}
            </>
          ) : sidebarTab === "channels" ? (
            <>
              {/* Client Channels */}
              {clientChannels.length > 0 && (
                <>
                  <SectionHeader tokens={tokens}>Client Channels</SectionHeader>
                  {clientChannels.map((ch, i) => (
                    <ChannelRow
                      key={ch.id}
                      channel={ch}
                      active={activeChannel?.id === ch.id}
                      tokens={tokens}
                      delay={i * 40}
                      onClick={() => { setActiveChannel(ch); if (isMobile) setShowChannelList(false); }}
                      isFavorite={favorites.includes(ch.id)}
                      onToggleFavorite={toggleFavorite}
                    />
                  ))}
                </>
              )}

              {/* Internal Channels */}
              {internalChannels.length > 0 && (
                <>
                  <SectionHeader tokens={tokens}>Internal Channels</SectionHeader>
                  {internalChannels.map((ch, i) => (
                    <ChannelRow
                      key={ch.id}
                      channel={ch}
                      active={activeChannel?.id === ch.id}
                      tokens={tokens}
                      delay={i * 40}
                      onClick={() => { setActiveChannel(ch); if (isMobile) setShowChannelList(false); }}
                    />
                  ))}
                </>
              )}

              {clientChannels.length === 0 && internalChannels.length === 0 && (
                <div style={{ padding: "40px 20px", textAlign: "center", color: tokens.textMute, fontSize: 13 }}>
                  {search ? `No channels match "${search}"` : "No channels found"}
                </div>
              )}
            </>
          ) : (
            <>
              {/* Direct Messages */}
              {dmChannels.length > 0 && (
                <>
                  <SectionHeader tokens={tokens}>Direct Messages</SectionHeader>
                  {dmChannels.map((ch, i) => (
                    <ChannelRow
                      key={ch.id}
                      channel={ch}
                      active={activeChannel?.id === ch.id}
                      tokens={tokens}
                      delay={i * 40}
                      onClick={() => { setActiveChannel(ch); if (isMobile) setShowChannelList(false); }}
                      isFavorite={favorites.includes(ch.id)}
                      onToggleFavorite={toggleFavorite}
                    />
                  ))}
                </>
              )}

              {/* Group DMs */}
              {groupDMChannels.length > 0 && (
                <>
                  <SectionHeader tokens={tokens}>Group Messages</SectionHeader>
                  {groupDMChannels.map((ch, i) => (
                    <ChannelRow
                      key={ch.id}
                      channel={ch}
                      active={activeChannel?.id === ch.id}
                      tokens={tokens}
                      delay={i * 40}
                      onClick={() => { setActiveChannel(ch); if (isMobile) setShowChannelList(false); }}
                    />
                  ))}
                </>
              )}

              {dmChannels.length === 0 && groupDMChannels.length === 0 && (
                <div style={{ padding: "40px 20px", textAlign: "center", color: tokens.textMute, fontSize: 13 }}>
                  {search ? `No conversations match "${search}"` : "No direct messages found"}
                </div>
              )}
            </>
          )}
        </div>
      </div>

      {/* ─── Right Panel: Messages ─── */}
      <div style={{
        flex: 1, display: isMobile && !activeChannel ? "none" : "flex", flexDirection: "column",
        background: tokens.bg, minWidth: 0,
      }}>

        {!activeChannel ? (
          /* Empty State */
          <div style={{
            flex: 1, display: "flex", flexDirection: "column",
            alignItems: "center", justifyContent: "center", gap: 16,
            animation: "cardIn 0.5s cubic-bezier(0.22, 1, 0.36, 1) both",
          }}>
            <div style={{
              width: 64, height: 64, borderRadius: 20,
              background: tokens.accentGhost,
              border: `1.5px solid ${tokens.accentBorder}`,
              display: "flex", alignItems: "center", justifyContent: "center",
            }}>
              <IconHash size={28} color={tokens.accent} />
            </div>
            <div style={{ textAlign: "center" }}>
              <div style={{ fontSize: 18, fontWeight: 600, color: tokens.text, letterSpacing: "-0.01em" }}>
                Select a channel
              </div>
              <div style={{ fontSize: 13, color: tokens.textMute, marginTop: 6, maxWidth: 260, lineHeight: 1.5 }}>
                Choose a conversation from the sidebar to view messages and collaborate with your team.
              </div>
            </div>
          </div>
        ) : (
          <>
            {/* Channel Header */}
            <div style={{
              padding: "14px 24px", borderBottom: `1px solid ${tokens.border}`,
              display: "flex", alignItems: "center", gap: 10,
              background: tokens.surface,
              flexShrink: 0,
            }}>
              {isMobile && (
                <button
                  onClick={() => setActiveChannel(null)}
                  aria-label="Back to channels"
                  style={{
                    width: 32, height: 32, borderRadius: 8, display: "flex",
                    alignItems: "center", justifyContent: "center", cursor: "pointer",
                    color: tokens.textMute, marginRight: 4,
                    background: "none", border: "none",
                  }}
                >
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <polyline points="15 18 9 12 15 6"/>
                  </svg>
                </button>
              )}
              {activeChannel.isDM ? (
                <MessageAvatar name={activeChannel.name} tokens={tokens} size={28} />
              ) : (
                <div style={{
                  width: 28, height: 28, borderRadius: 8,
                  background: tokens.accentGhost,
                  display: "flex", alignItems: "center", justifyContent: "center",
                }}>
                  {activeChannel.isPrivate ? (
                    <IconLock size={13} color={tokens.accent} />
                  ) : (
                    <IconHash size={14} color={tokens.accent} />
                  )}
                </div>
              )}
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{
                  fontSize: 15, fontWeight: 600, color: tokens.text,
                  letterSpacing: "-0.01em",
                  overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
                }}>
                  {activeChannel.name}
                </div>
                {activeChannel.topic && (
                  <div style={{
                    fontSize: 12, color: tokens.textMute, marginTop: 1,
                    overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
                  }}>
                    {activeChannel.topic}
                  </div>
                )}
              </div>
              {!activeChannel.isDM && (
                <div style={{
                  display: "flex", alignItems: "center", gap: 6,
                  padding: "4px 10px", borderRadius: 8,
                  background: tokens.surfaceEl,
                  border: `1px solid ${tokens.border}`,
                  fontSize: 12, color: tokens.textSub, fontWeight: 500,
                }}>
                  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke={tokens.textMute} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" /><circle cx="9" cy="7" r="4" />
                    <path d="M23 21v-2a4 4 0 0 0-3-3.87" /><path d="M16 3.13a4 4 0 0 1 0 7.75" />
                  </svg>
                  {activeChannel.numMembers || 0}
                </div>
              )}
            </div>

            {/* Messages Area */}
            <div ref={messagesContainerRef} style={{
              flex: 1, overflowY: "auto", padding: "8px 24px 16px",
              display: "flex", flexDirection: "column",
            }}>
              {loadingMessages ? (
                <div style={{ padding: "20px 0" }}>
                  {[0, 1, 2, 3, 4].map(i => (
                    <SkeletonMessage key={i} tokens={tokens} delay={i * 100} align={i % 2 === 0 ? "left" : "right"} />
                  ))}
                </div>
              ) : messages.length === 0 ? (
                <div style={{
                  flex: 1, display: "flex", flexDirection: "column",
                  alignItems: "center", justifyContent: "center", gap: 8,
                  color: tokens.textMute, fontSize: 13,
                }}>
                  <div style={{ fontSize: 32, marginBottom: 4 }}>💬</div>
                  No messages yet. Start the conversation!
                </div>
              ) : (
                <>
                  {messageGroups.map((group, gi) => (
                    <div key={gi}>
                      {/* Date divider */}
                      {group.label && (
                        <div style={{
                          display: "flex", alignItems: "center", gap: 12,
                          margin: "16px 0 8px",
                          animation: `cardIn 0.3s ${spring} both`,
                          animationDelay: `${gi * 60}ms`,
                        }}>
                          <div style={{ flex: 1, height: 1, background: tokens.border }} />
                          <span style={{
                            fontSize: 11, fontWeight: 600, color: tokens.textMute,
                            letterSpacing: "0.04em", textTransform: "uppercase",
                            padding: "3px 10px", borderRadius: 6,
                            background: tokens.surfaceEl,
                            border: `1px solid ${tokens.border}`,
                          }}>
                            {group.label}
                          </span>
                          <div style={{ flex: 1, height: 1, background: tokens.border }} />
                        </div>
                      )}

                      {group.messages.map((msg, mi) => {
                        // Skip thread replies (shown inline as reply count)
                        if (msg.threadTs && msg.threadTs !== msg.timestamp) return null;
                        const collapsed = isSameUser(group, mi);

                        return (
                          <div
                            key={msg.id}
                            style={{
                              display: "flex", gap: 12,
                              padding: collapsed ? "1px 12px" : "8px 12px",
                              marginTop: collapsed ? 0 : 2,
                              borderRadius: 10, marginBottom: 0,
                              transition: `background 0.15s ${spring}`,
                              animation: `cardIn 0.35s ${spring} both`,
                              animationDelay: `${Math.min((gi * 3 + mi) * 40, 600)}ms`,
                            }}
                            onMouseEnter={e => {
                              e.currentTarget.style.background = tokens.surfaceHov;
                            }}
                            onMouseLeave={e => {
                              e.currentTarget.style.background = "transparent";
                            }}
                          >
                            <MessageAvatar name={msg.userName} tokens={tokens} collapsed={collapsed} />
                            <div style={{ flex: 1, minWidth: 0 }}>
                              {!collapsed && (
                                <div style={{ display: "flex", alignItems: "baseline", gap: 8 }}>
                                  <span style={{
                                    fontSize: 13, fontWeight: 600, color: tokens.text,
                                  }}>
                                    {msg.userName}
                                  </span>
                                  <span
                                    title={formatFullTimestamp(msg.timestamp)}
                                    style={{
                                      fontSize: 11, color: tokens.textMute, fontWeight: 400,
                                      cursor: "default",
                                    }}
                                  >
                                    {formatTimestamp(msg.timestamp)}
                                  </span>
                                  {msg.isBot && (
                                    <span style={{
                                      fontSize: 10, fontWeight: 600, color: tokens.textMute,
                                      background: tokens.surfaceEl, padding: "1px 5px",
                                      borderRadius: 4, border: `1px solid ${tokens.border}`,
                                      textTransform: "uppercase", letterSpacing: "0.04em",
                                    }}>
                                      Bot
                                    </span>
                                  )}
                                </div>
                              )}
                              <div style={{
                                fontSize: 14, color: tokens.textSub, lineHeight: 1.6,
                                marginTop: collapsed ? 0 : 2, wordBreak: "break-word",
                              }}>
                                {formatMessageText(msg.text)}
                              </div>
                              {/* File attachments */}
                              {msg.files && msg.files.length > 0 && (
                                <div style={{ marginTop: 6, display: "flex", flexDirection: "column", gap: 4 }}>
                                  {msg.files.map((f, fi) => (
                                    <div key={fi} style={{
                                      display: "inline-flex", alignItems: "center", gap: 6,
                                      padding: "5px 10px", borderRadius: 8,
                                      background: tokens.surfaceEl,
                                      border: `1px solid ${tokens.border}`,
                                      fontSize: 12, color: tokens.textSub,
                                      maxWidth: "fit-content",
                                    }}>
                                      <IconFile color={tokens.textMute} />
                                      <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                                        {f.name || "File"}
                                      </span>
                                    </div>
                                  ))}
                                </div>
                              )}
                              {/* Attachment count */}
                              {msg.attachments > 0 && (!msg.files || msg.files.length === 0) && (
                                <div style={{
                                  display: "inline-flex", alignItems: "center", gap: 5,
                                  marginTop: 6, padding: "3px 8px", borderRadius: 6,
                                  background: tokens.surfaceEl,
                                  border: `1px solid ${tokens.border}`,
                                  fontSize: 12, color: tokens.textMute,
                                }}>
                                  <IconFile color={tokens.textMute} />
                                  {msg.attachments} {msg.attachments === 1 ? "attachment" : "attachments"}
                                </div>
                              )}
                              {/* Thread reply count */}
                              {msg.replyCount > 0 && (
                                <div style={{
                                  display: "inline-flex", alignItems: "center", gap: 5,
                                  marginTop: 6, padding: "3px 8px", borderRadius: 6,
                                  background: tokens.accentGhost,
                                  border: `1px solid ${tokens.accentBorder}`,
                                  cursor: "pointer",
                                  transition: `all 0.2s ${spring}`,
                                  fontSize: 12, color: tokens.accent, fontWeight: 500,
                                }}
                                  onMouseEnter={e => {
                                    e.currentTarget.style.background = tokens.accentBorder;
                                  }}
                                  onMouseLeave={e => {
                                    e.currentTarget.style.background = tokens.accentGhost;
                                  }}
                                >
                                  <IconThread color={tokens.accent} />
                                  {msg.replyCount} {msg.replyCount === 1 ? "reply" : "replies"}
                                </div>
                              )}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  ))}
                  <div ref={messagesEndRef} />
                </>
              )}
            </div>

            {/* Message Input */}
            <div style={{
              padding: "12px 24px 16px", borderTop: `1px solid ${tokens.border}`,
              background: tokens.surface, flexShrink: 0,
            }}>
              <div style={{
                display: "flex", alignItems: "flex-end", gap: 10,
                padding: "8px 12px", borderRadius: 12,
                background: tokens.surfaceEl,
                border: `1px solid ${tokens.border}`,
                transition: `border-color 0.25s ${spring}`,
              }}
                onFocusCapture={e => {
                  e.currentTarget.style.borderColor = tokens.accent + "60";
                }}
                onBlurCapture={e => {
                  e.currentTarget.style.borderColor = tokens.border;
                }}
              >
                <textarea
                  ref={textareaRef}
                  value={draft}
                  onChange={handleInput}
                  onKeyDown={handleKeyDown}
                  aria-label={`Message ${activeChannel.name}`}
                  placeholder={isMobile ? "Message..." : `Message ${activeChannel.isDM ? "" : "#"}${activeChannel.name}...`}
                  rows={1}
                  style={{
                    flex: 1, border: "none", outline: "none",
                    background: "transparent", color: tokens.text,
                    fontSize: 14, fontFamily: "inherit", lineHeight: 1.5,
                    resize: "none", height: 40, maxHeight: 120,
                    padding: "6px 0",
                  }}
                />
                <button
                  onClick={handleSend}
                  disabled={!draft.trim() || sendingMessage}
                  aria-label="Send message"
                  style={{
                    width: 36, height: 36, borderRadius: 10,
                    border: "none", cursor: draft.trim() ? "pointer" : "default",
                    background: draft.trim() ? tokens.accent : tokens.borderMed,
                    display: "flex", alignItems: "center", justifyContent: "center",
                    transition: `all 0.25s ${spring}`,
                    opacity: draft.trim() ? 1 : 0.4,
                    boxShadow: "none",
                    flexShrink: 0,
                  }}
                  onMouseEnter={e => {
                    if (draft.trim()) {
                      e.currentTarget.style.boxShadow = tokens.accentGlow;
                      e.currentTarget.style.transform = "scale(1.05)";
                    }
                  }}
                  onMouseLeave={e => {
                    e.currentTarget.style.boxShadow = "none";
                    e.currentTarget.style.transform = "scale(1)";
                  }}
                >
                  <IconSend size={16} color={draft.trim() ? (dark ? "#08080A" : "#FFFFFF") : tokens.textMute} />
                </button>
              </div>
              <div style={{
                fontSize: 11, color: tokens.textMute, marginTop: 6, paddingLeft: 4,
                opacity: 0.6,
              }}>
                <kbd style={{
                  background: tokens.surfaceEl, padding: "1px 5px", borderRadius: 3,
                  border: `1px solid ${tokens.border}`, fontSize: 10,
                }}>Enter</kbd> to send
                {!isMobile && (
                  <span style={{ marginLeft: 8 }}>
                    <kbd style={{
                      background: tokens.surfaceEl, padding: "1px 5px", borderRadius: 3,
                      border: `1px solid ${tokens.border}`, fontSize: 10,
                    }}>Shift + Enter</kbd> for new line
                  </span>
                )}
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

/* ─── Section Header ─── */
function SectionHeader({ tokens, children }) {
  return (
    <div style={{
      fontSize: 11, fontWeight: 700, color: tokens.textMute,
      letterSpacing: "0.06em", textTransform: "uppercase",
      padding: "20px 16px 8px",
    }}>
      {children}
    </div>
  );
}

/* ─── Channel Row ─── */
function ChannelRow({ channel, active, tokens, delay, onClick, isFavorite, onToggleFavorite }) {
  const spring = "cubic-bezier(0.22, 1, 0.36, 1)";

  // Show purpose/topic as subtitle
  const subtitle = channel.purpose || channel.topic || "";

  return (
    <button
      onClick={onClick}
      style={{
        display: "flex", alignItems: "center", gap: 10, width: "100%",
        padding: "10px 12px", borderRadius: 10, cursor: "pointer",
        background: active ? tokens.accentGhost : "transparent",
        border: `1px solid ${active ? tokens.accentBorder : "transparent"}`,
        transition: `all 0.25s ${spring}`,
        animation: `cardIn 0.35s ${spring} both`,
        animationDelay: `${delay}ms`,
        position: "relative",
        fontFamily: "inherit", textAlign: "left",
        color: "inherit",
      }}
      onMouseEnter={e => {
        if (!active) {
          e.currentTarget.style.background = tokens.surfaceHov;
          e.currentTarget.style.transform = "translateX(2px)";
          e.currentTarget.style.boxShadow = tokens.cardShadow;
        }
        const star = e.currentTarget.querySelector(".channel-star");
        if (star) star.style.opacity = "1";
      }}
      onMouseLeave={e => {
        if (!active) {
          e.currentTarget.style.background = "transparent";
          e.currentTarget.style.transform = "translateX(0)";
          e.currentTarget.style.boxShadow = "none";
        }
        const star = e.currentTarget.querySelector(".channel-star");
        if (star && !star.textContent.includes("\u2B50")) star.style.opacity = "0";
      }}
    >
      {/* Channel icon */}
      <div style={{
        width: 34, height: 34, borderRadius: channel.isDM ? "50%" : 9, flexShrink: 0,
        background: active ? tokens.accentGhost : tokens.surfaceEl,
        border: `1px solid ${active ? tokens.accentBorder : tokens.border}`,
        display: "flex", alignItems: "center", justifyContent: "center",
        transition: `all 0.2s ${spring}`,
      }}>
        {channel.isDM ? (
          <span style={{ fontSize: 14, fontWeight: 700, color: active ? tokens.accent : tokens.textMute }}>{(channel.name || "?")[0].toUpperCase()}</span>
        ) : channel.isGroupDM ? (
          <span style={{ fontSize: 11, fontWeight: 700, color: active ? tokens.accent : tokens.textMute }}>{channel.numMembers || "G"}</span>
        ) : channel.isPrivate ? (
          <IconLock size={13} color={active ? tokens.accent : tokens.textMute} />
        ) : (
          <IconHash size={14} color={active ? tokens.accent : tokens.textMute} />
        )}
      </div>

      {/* Channel info */}
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
          <span style={{
            fontSize: 13, fontWeight: active ? 600 : 500,
            color: active ? tokens.accent : tokens.text,
            overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
            transition: `color 0.2s ${spring}`,
          }}>
            {channel.name}
          </span>
          <span style={{ flex: 1 }} />
          {channel.numMembers > 0 && !channel.isDM && (
            <span style={{
              fontSize: 11, color: tokens.textMute, flexShrink: 0,
              fontWeight: 400, display: "flex", alignItems: "center", gap: 3,
            }}>
              <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke={tokens.textMute} strokeWidth="2.5">
                <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" /><circle cx="9" cy="7" r="4" />
              </svg>
              {channel.numMembers}
            </span>
          )}
          {channel.updated > 0 && (
            <span style={{ fontSize: 11, color: tokens.textMute, flexShrink: 0 }}>
              {timeAgo(channel.updated)}
            </span>
          )}
        </div>
        {subtitle && (
          <div style={{
            fontSize: 12, color: tokens.textMute, marginTop: 2,
            overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
            lineHeight: 1.4,
          }}>
            {subtitle}
          </div>
        )}
      </div>

      {/* Favorite star */}
      {onToggleFavorite && (
        <span
          role="button"
          tabIndex={0}
          onClick={(e) => { e.stopPropagation(); onToggleFavorite(channel.id); }}
          onKeyDown={(e) => { if (e.key === "Enter") { e.stopPropagation(); onToggleFavorite(channel.id); } }}
          aria-label={isFavorite ? "Remove from favorites" : "Add to favorites"}
          style={{
            fontSize: 14, cursor: "pointer", flexShrink: 0,
            opacity: isFavorite ? 1 : 0,
            transition: `opacity 0.2s ${spring}`,
            lineHeight: 1,
          }}
          className="channel-star"
        >
          {isFavorite ? "\u2B50" : "\u2606"}
        </span>
      )}
    </button>
  );
}
