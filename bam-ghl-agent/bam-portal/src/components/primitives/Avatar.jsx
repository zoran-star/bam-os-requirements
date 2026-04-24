import { managerColor } from '../../tokens/tokens';

// Light-mode adapted palette: brighten bg, darken fg for readability on light surfaces
const LIGHT_PALETTE = {
  Coleman: ["#F0EED8","#5A5620"],
  Silva:   ["#D6F5E8","#0F7B4F"],
  Mike:    ["#D9E8FA","#1E4A8A"],
  Zoran:   ["#EBD9FC","#6B2FA0"],
  Graham:  ["#D6F5E8","#0F7B4F"],
};

export default function Avatar({ name, size = 32, dark = true }) {
  const [darkBg, darkFg] = managerColor(name);
  const light = LIGHT_PALETTE[name];
  const bg = dark ? darkBg : (light ? light[0] : "#E8E8E6");
  const fg = dark ? darkFg : (light ? light[1] : "#636366");
  return (
    <div style={{
      width: size, height: size, borderRadius: size * 0.3, flexShrink: 0,
      background: bg, color: fg,
      fontSize: Math.round(size * 0.32), fontWeight: 600,
      display: "flex", alignItems: "center", justifyContent: "center",
      letterSpacing: "0.01em", fontFamily: "inherit",
    }}>
      {name.slice(0,2).toUpperCase()}
    </div>
  );
}
