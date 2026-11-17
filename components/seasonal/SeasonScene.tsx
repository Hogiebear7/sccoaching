// The scene along the bottom of the page for each season: a strip of ground with a few small drawings standing on it, still (like the corner scenes on the
// seasonal workout posters). Christmas keeps its falling snow, which is the only thing that moves. Pointer-events none, so it never blocks a click.
type ItemKind = "bunny" | "flag" | "pumpkin" | "jack" | "ghost" | "egg" | "shamrock" | "heart" | "arrowHeart" | "ball" | "star" | "pot" | "rainbow" | "sun" | "leaf";
interface Item {
  kind: ItemKind;
  left: string;
  size: number;
  lift?: number;
  colour?: string;
}

const HEART = "M12 21 C4 14 2 9 2 6.5 C2 3.5 4.5 2 7 2 C9 2 11 3.3 12 5 C13 3.3 15 2 17 2 C19.5 2 22 3.5 22 6.5 C22 9 20 14 12 21 Z";

function Art({ kind, size, colour }: { kind: ItemKind; size: number; colour?: string }) {
  const box = { width: size, height: size };
  switch (kind) {
    case "pumpkin":
    case "jack":
      return (
        <svg viewBox="0 0 24 24" {...box}>
          <ellipse cx="12" cy="14.5" rx="9.5" ry="7.5" fill="#f08a24" />
          <ellipse cx="7.5" cy="14.5" rx="4.2" ry="7.3" fill="#e0731a" />
          <ellipse cx="16.5" cy="14.5" rx="4.2" ry="7.3" fill="#e0731a" />
          <ellipse cx="12" cy="14.5" rx="4" ry="7.5" fill="#f5a038" />
          <rect x="11" y="4.2" width="2.4" height="4" rx="1" fill="#4a7c2a" />
          {kind === "jack" ? (
            <g fill="#3a2410">
              <path d="M7.5 12 L10 12 L8.7 14.2 Z" />
              <path d="M14 12 L16.5 12 L15.2 14.2 Z" />
              <path d="M7.8 17 L9.3 16 L10.8 17.2 L12.2 16 L13.7 17.2 L15.2 16 L16.5 17 L16 18.5 L8.2 18.5 Z" />
            </g>
          ) : null}
        </svg>
      );
    case "bunny":
      return (
        <svg viewBox="0 0 24 24" {...box}>
          <ellipse cx="8.2" cy="7" rx="1.9" ry="5.2" fill="#ffffff" transform="rotate(-8 8.2 7)" />
          <ellipse cx="8.2" cy="7.4" rx="0.8" ry="3.4" fill="#ffb3c7" transform="rotate(-8 8.2 7.4)" />
          <ellipse cx="12.6" cy="6.6" rx="1.9" ry="5.4" fill="#ffffff" transform="rotate(8 12.6 6.6)" />
          <ellipse cx="12.6" cy="7" rx="0.8" ry="3.5" fill="#ffb3c7" transform="rotate(8 12.6 7)" />
          <ellipse cx="10.4" cy="14" rx="4.6" ry="4" fill="#ffffff" />
          <ellipse cx="9.4" cy="20" rx="6.2" ry="3.6" fill="#ffffff" />
          <circle cx="15.8" cy="21" r="2" fill="#f3f3f8" />
          <circle cx="8.6" cy="13.4" r="0.7" fill="#3a3a46" />
          <circle cx="12" cy="13.4" r="0.7" fill="#3a3a46" />
          <circle cx="10.3" cy="15" r="0.7" fill="#ffb3c7" />
        </svg>
      );
    case "flag":
      return (
        <svg viewBox="0 0 24 24" {...box}>
          <rect x="4" y="2" width="1.4" height="21" rx="0.7" fill="#8a8a96" />
          <rect x="5.4" y="3" width="5.6" height="9" fill="#169b62" />
          <rect x="11" y="3" width="5.6" height="9" fill="#ffffff" />
          <rect x="16.6" y="3" width="5.6" height="9" fill="#ff883e" />
        </svg>
      );
    case "ghost":
      return (
        <svg viewBox="0 0 24 24" {...box}>
          <path d="M4 22 L4 11 C4 5 8 2 12 2 C16 2 20 5 20 11 L20 22 L17 19.5 L14.5 22 L12 19.5 L9.5 22 L7 19.5 Z" fill="#f4f1ff" />
          <circle cx="9" cy="10" r="1.7" fill="#2b2540" />
          <circle cx="15" cy="10" r="1.7" fill="#2b2540" />
          <ellipse cx="12" cy="14.5" rx="1.6" ry="2" fill="#2b2540" />
        </svg>
      );
    case "egg":
      return (
        <svg viewBox="0 0 24 24" {...box}>
          <ellipse cx="12" cy="13" rx="7" ry="9" fill={colour ?? "#ffd1dc"} />
          <path d="M5.4 12 L8 10.5 L10.5 12 L13 10.5 L15.5 12 L18.6 10.5" stroke="#ffffff" strokeWidth="1.6" fill="none" strokeLinejoin="round" />
          <path d="M6 16 Q12 19 18 16" stroke="#ffffff" strokeWidth="1.4" fill="none" />
        </svg>
      );
    case "shamrock":
      return (
        <svg viewBox="0 0 24 24" {...box}>
          <g fill={colour ?? "#1fa84f"}>
            <circle cx="12" cy="7" r="5" />
            <circle cx="7" cy="13" r="5" />
            <circle cx="17" cy="13" r="5" />
          </g>
          <path d="M12 12 L13.4 22" stroke={colour ?? "#1fa84f"} strokeWidth="2" strokeLinecap="round" />
        </svg>
      );
    case "heart":
      return (
        <svg viewBox="0 0 24 24" {...box}>
          <path d={HEART} fill={colour ?? "#ff4d6d"} />
        </svg>
      );
    case "leaf":
      return (
        <svg viewBox="0 0 24 24" {...box}>
          <path d="M12 2 C20 6 21 15 12 22 C3 15 4 6 12 2 Z" fill={colour ?? "#e07a1f"} />
          <path d="M12 4 L12 21" stroke="#ffffff" strokeWidth="1" opacity="0.45" />
        </svg>
      );
    case "arrowHeart":
      return (
        <svg viewBox="0 0 24 24" {...box}>
          <path d={HEART} fill="#ff2e63" />
          <line x1="3" y1="20" x2="21" y2="4" stroke="#8a5a2b" strokeWidth="1.4" strokeLinecap="round" />
          <path d="M21 4 L17.6 4.8 L20.2 7.4 Z" fill="#8a5a2b" />
        </svg>
      );
    case "ball":
      return (
        <svg viewBox="0 0 24 24" {...box}>
          <circle cx="12" cy="12" r="10" fill="#ffffff" />
          <path d="M12 12 L12 2 A10 10 0 0 1 20.7 7 Z" fill="#ff5a5f" />
          <path d="M12 12 L20.7 17 A10 10 0 0 1 12 22 Z" fill="#3aa0ff" />
          <path d="M12 12 L3.3 17 A10 10 0 0 1 3.3 7 Z" fill="#ffd23f" />
          <circle cx="12" cy="12" r="1.8" fill="#ffffff" />
        </svg>
      );
    case "star":
      return (
        <svg viewBox="0 0 24 24" {...box}>
          <path d="M12 2 L14.6 9 L22 9.4 L16.2 14 L18.2 21.4 L12 17.2 L5.8 21.4 L7.8 14 L2 9.4 L9.4 9 Z" fill="#ff8a65" />
        </svg>
      );
    case "pot":
      return (
        <svg viewBox="0 0 24 24" {...box}>
          <circle cx="8" cy="8" r="2.6" fill="#ffd23f" />
          <circle cx="12.5" cy="6.4" r="2.8" fill="#f1c40f" />
          <circle cx="16.4" cy="8.4" r="2.5" fill="#ffd23f" />
          <path d="M4 11 L20 11 C21 16 19 21 12 21.5 C5 21 3 16 4 11 Z" fill="#26262e" />
          <rect x="3" y="10" width="18" height="2.2" rx="1" fill="#3a3a46" />
        </svg>
      );
    case "rainbow":
      return (
        <svg viewBox="0 0 32 20" width={size * 1.6} height={size}>
          {["#e74c3c", "#f39c12", "#f1c40f", "#2ecc71", "#3498db", "#8e44ad"].map((c, i) => (
            <path key={c} d={`M${2 + i * 1.8} 20 A${14 - i * 1.8} ${14 - i * 1.8} 0 0 1 ${30 - i * 1.8} 20`} stroke={c} strokeWidth="1.8" fill="none" />
          ))}
        </svg>
      );
    case "sun":
      return (
        <svg viewBox="-12 -12 24 24" {...box}>
          <circle r="5" fill="#ffd23f" />
          {Array.from({ length: 10 }, (_, i) => {
            const a = (i / 10) * Math.PI * 2;
            return <line key={i} x1={Math.cos(a) * 7} y1={Math.sin(a) * 7} x2={Math.cos(a) * 10.5} y2={Math.sin(a) * 10.5} stroke="#ffd23f" strokeWidth="2" strokeLinecap="round" />;
          })}
        </svg>
      );
  }
}

type Strip = "snow" | "grass" | "sand" | "leaves" | "night";

const SCENES: Record<string, { strip: Strip | null; items: Item[] }> = {
  christmas: { strip: "snow", items: [] },
  // Just a few small hearts. Not everyone wants Valentine's, so nothing more.
  valentines: {
    strip: null,
    items: [
      { kind: "heart", left: "2.5%", size: 17, lift: 2, colour: "#ff8fa3" },
      { kind: "heart", left: "4.8%", size: 13, lift: 2, colour: "#ff4d6d" },
      { kind: "heart", left: "3.6%", size: 14, lift: 16, colour: "#ffb3c1" },
    ],
  },
  // Flag on the left; pot of gold beside the rainbow on the right.
  stpatricks: {
    strip: "grass",
    items: [
      { kind: "flag", left: "4%", size: 34, lift: 10 },
      { kind: "shamrock", left: "42%", size: 18, lift: 12 },
      { kind: "pot", left: "84%", size: 30, lift: 10 },
      { kind: "rainbow", left: "92%", size: 36, lift: 10 },
    ],
  },
  easter: {
    strip: "grass",
    items: [
      { kind: "egg", left: "5%", size: 20, lift: 12, colour: "#ffd1dc" },
      { kind: "egg", left: "16%", size: 18, lift: 12, colour: "#cde7ff" },
      { kind: "bunny", left: "38%", size: 38, lift: 8 },
      { kind: "egg", left: "62%", size: 19, lift: 12, colour: "#fff1a8" },
      { kind: "egg", left: "80%", size: 20, lift: 12, colour: "#e6d3ff" },
      { kind: "egg", left: "93%", size: 18, lift: 12, colour: "#d6f5d6" },
    ],
  },
  halloween: {
    strip: "night",
    items: [
      { kind: "jack", left: "8%", size: 30, lift: 12 },
      { kind: "ghost", left: "47%", size: 30, lift: 14 },
      { kind: "jack", left: "88%", size: 26, lift: 12 },
    ],
  },
};

const PAINT: Record<Strip, [string, string]> = {
  snow: ["#f4f8ff", "#dce8f7"],
  grass: ["#5cbf5a", "#3f9b45"],
  sand: ["#f2d7a0", "#e8c070"],
  leaves: ["#a0521d", "#7a3d14"],
  night: ["#3a2a52", "#241a38"],
};

export function SeasonScene({ season }: { season: string }) {
  const scene = SCENES[season];
  if (!scene) return null;
  return (
    <div aria-hidden="true" className="pointer-events-none fixed bottom-0 left-0 z-[20] h-10 w-full sm:h-12">
      {scene.strip ? (
        <svg viewBox="0 0 400 30" preserveAspectRatio="none" className="absolute inset-0 h-full w-full">
          {scene.strip === "sand" ? <path d="M0 30 L0 6 C40 1 80 10 130 5 C180 0 230 10 280 5 C330 1 370 7 400 5 L400 30 Z" fill="#48c1ee" opacity="0.9" /> : null}
          <path
            d={scene.strip === "sand" ? "M0 30 L0 15 C50 11 90 18 140 14 C190 10 240 18 290 14 C340 10 380 16 400 14 L400 30 Z" : "M0 30 L0 15 C30 6 60 18 100 12 C140 6 170 18 210 12 C250 6 280 18 320 12 C350 8 380 14 400 16 L400 30 Z"}
            fill={PAINT[scene.strip][0]}
          />
          <path d="M0 30 L0 23 C40 19 80 26 130 22 C180 18 230 26 280 22 C330 18 370 24 400 24 L400 30 Z" fill={PAINT[scene.strip][1]} />
        </svg>
      ) : null}
      {scene.items.map((it, i) => (
        <span key={i} className="absolute" style={{ left: it.left, bottom: it.lift ?? 0, transform: "translateX(-50%)" }}>
          <Art kind={it.kind} size={it.size} colour={it.colour} />
        </span>
      ))}
    </div>
  );
}
