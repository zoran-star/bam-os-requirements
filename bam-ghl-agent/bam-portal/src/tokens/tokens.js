export const T = {
  dark: {
    bg:         "#08080A",
    surface:    "#0F0F12",
    surfaceEl:  "#16161A",
    surfaceHov: "#1C1C21",
    surfaceAlt: "#1A1A1F",
    border:     "rgba(255,255,255,0.05)",
    borderMed:  "rgba(255,255,255,0.08)",
    borderStr:  "rgba(255,255,255,0.14)",
    text:       "#EDEDEC",
    textSub:    "#8E8E93",
    textMute:   "#48484A",
    accent:     "#D4CF8A",
    accentGhost:"rgba(212,207,138,0.06)",
    accentBorder:"rgba(212,207,138,0.15)",
    accentGlow: "0 0 20px rgba(212,207,138,0.15), 0 0 40px rgba(212,207,138,0.05)",
    green:      "#34D399",
    greenSoft:  "rgba(52,211,153,0.10)",
    greenGlow:  "0 0 16px rgba(52,211,153,0.20)",
    amber:      "#FBBF24",
    amberSoft:  "rgba(251,191,36,0.10)",
    amberGlow:  "0 0 16px rgba(251,191,36,0.15)",
    red:        "#FB7185",
    redSoft:    "rgba(251,113,133,0.08)",
    redGlow:    "0 0 16px rgba(251,113,133,0.20)",
    blue:       "#60A5FA",
    blueGlow:   "0 0 16px rgba(96,165,250,0.20)",
    cardShadow: "0 2px 8px rgba(0,0,0,0.12)",
    cardHover:  "0 8px 32px rgba(0,0,0,0.24), 0 0 0 1px rgba(255,255,255,0.06)",
    inputGlow:  "0 0 0 3px rgba(212,207,138,0.12)",
  },
  light: {
    bg:         "#F5F5F4",
    surface:    "#FFFFFF",
    surfaceEl:  "#FFFFFF",
    surfaceHov: "#F8F8F6",
    surfaceAlt: "#F0F0EE",
    border:     "rgba(0,0,0,0.05)",
    borderMed:  "rgba(0,0,0,0.08)",
    borderStr:  "rgba(0,0,0,0.14)",
    text:       "#1C1C1E",
    textSub:    "#636366",
    textMute:   "#AEAEB2",
    accent:     "#6B6220",
    accentGhost:"rgba(107,98,32,0.05)",
    accentBorder:"rgba(107,98,32,0.12)",
    accentGlow: "0 0 20px rgba(107,98,32,0.10), 0 0 40px rgba(107,98,32,0.03)",
    green:      "#059669",
    greenSoft:  "rgba(5,150,105,0.07)",
    greenGlow:  "0 0 16px rgba(5,150,105,0.12)",
    amber:      "#B45309",
    amberSoft:  "rgba(180,83,9,0.07)",
    amberGlow:  "0 0 16px rgba(180,83,9,0.10)",
    red:        "#DC2626",
    redSoft:    "rgba(220,38,38,0.05)",
    redGlow:    "0 0 16px rgba(220,38,38,0.12)",
    blue:       "#2563EB",
    blueGlow:   "0 0 16px rgba(37,99,235,0.12)",
    cardShadow: "0 1px 4px rgba(0,0,0,0.04)",
    cardHover:  "0 8px 24px rgba(0,0,0,0.08), 0 0 0 1px rgba(0,0,0,0.04)",
    inputGlow:  "0 0 0 3px rgba(107,98,32,0.08)",
  },
};

export function calcProgress(checks) {
  return Math.round(checks.filter(Boolean).length / checks.length * 100);
}

export const MANAGER_PALETTE = {
  dark: {
    Coleman: ["#1E1B0E","#D4CF8A"],
    Silva:   ["#0B1F17","#34D399"],
    Mike:    ["#0C1422","#60A5FA"],
    Zoran:   ["#180C24","#C084FC"],
    Graham:  ["#0B1B0B","#34D399"],
  },
  light: {
    Coleman: ["#F5F0D8","#6B6220"],
    Silva:   ["#D1FAE5","#059669"],
    Mike:    ["#DBEAFE","#2563EB"],
    Zoran:   ["#EDE9FE","#7C3AED"],
    Graham:  ["#D1FAE5","#059669"],
  },
};

export function managerColor(name, dark = true) {
  const palette = dark ? MANAGER_PALETTE.dark : MANAGER_PALETTE.light;
  const fallback = dark ? ["#1A1A1A","#8E8E93"] : ["#F0F0EE","#636366"];
  return palette[name] || fallback;
}

export function statusColor(status, tk) {
  return status === "critical" ? tk.red : status === "at-risk" ? tk.amber : tk.green;
}
