import type { CSSProperties } from "react";
type Category = string;

const INK = "#182825";
const SPARKLE = "M12 0C12.7 7.2 16.8 11.3 24 12C16.8 12.7 12.7 16.8 12 24C11.3 16.8 7.2 12.7 0 12C7.2 11.3 11.3 7.2 12 0Z";
const HEART = "M12 20.5C5.5 16 2.5 12.2 2.5 8.6 2.5 5.8 4.7 3.6 7.4 3.6c1.9 0 3.6 1.1 4.6 2.9 1-1.8 2.7-2.9 4.6-2.9 2.7 0 4.9 2.2 4.9 5 0 3.6-3 7.4-9.5 11.9z";

interface P { size?: number; color?: string; className?: string; style?: CSSProperties }

export const Sparkle = ({ size = 16, color = INK, className, style }: P) => (
  <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden="true" className={className} style={style}><path d={SPARKLE} fill={color} /></svg>
);

export const HeartIcon = ({ size = 24, filled, color = INK }: P & { filled?: boolean }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden="true">
    <path d={HEART} fill={filled ? color : "none"} stroke={filled ? "none" : color} strokeWidth="1.9" strokeLinejoin="round" />
  </svg>
);

export const BackIcon = ({ size = 22 }: P) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={INK} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M19 12H5" /><path d="M11 6l-6 6 6 6" /></svg>
);

export const ChevronDown = ({ size = 14 }: P) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={INK} strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M6 9l6 6 6-6" /></svg>
);

export const PlusIcon = ({ size = 22 }: P) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={INK} strokeWidth="2.2" strokeLinecap="round" aria-hidden="true"><path d="M12 5v14M5 12h14" /></svg>
);

export const MinusIcon = ({ size = 18 }: P) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={INK} strokeWidth="2" strokeLinecap="round" aria-hidden="true"><path d="M5 12h14" /></svg>
);

export const MicIcon = ({ size = 15, color = "#FFFCF7" }: P) => (
  <svg width={size} height={(size * 32) / 26} viewBox="0 0 26 32" aria-hidden="true">
    <rect x="7" y="1" width="12" height="19" rx="6" fill={color} />
    <path d="M3 15a10 10 0 0 0 20 0" stroke={color} strokeWidth="2.6" fill="none" strokeLinecap="round" />
    <path d="M13 25v5" stroke={color} strokeWidth="2.6" strokeLinecap="round" />
  </svg>
);

export const MuteIcon = ({ size = 24, muted }: P & { muted?: boolean }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round">
    <rect x="8.5" y="2.5" width="7" height="12" rx="3.5" />
    <path d="M5 11a7 7 0 0 0 14 0M12 18v3" />
    {muted && <path d="M4 3l16 18" />}
  </svg>
);

export const KeyboardIcon = ({ size = 24 }: P) => (
  <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke={INK} strokeWidth="1.8" strokeLinejoin="round">
    <rect x="2" y="5" width="20" height="14" rx="3" />
    <path d="M6 9.5h1.5M10 9.5h1.5M14 9.5h1.5M8 14h8" strokeLinecap="round" />
  </svg>
);

export const QrIcon = ({ size = 20 }: P) => (
  <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke={INK} strokeWidth="1.8">
    <rect x="3" y="3" width="7" height="7" rx="1.5" /><rect x="14" y="3" width="7" height="7" rx="1.5" /><rect x="3" y="14" width="7" height="7" rx="1.5" />
    <path d="M14 14h3M20 14v3M14 18v3M17.5 20.5H21" strokeLinecap="round" />
  </svg>
);

export const BagIcon = ({ size = 24 }: P) => (
  <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden="true">
    <path d="M5 8h14l-1 12a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2z" fill={INK} />
    <path d="M9 8V6a3 3 0 0 1 6 0v2" stroke={INK} strokeWidth="1.8" fill="none" />
  </svg>
);

export const ArrowOut = ({ size = 22 }: P) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={INK} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M7 17L17 7" /><path d="M9 7h8v8" /></svg>
);

export const LockIcon = ({ size = 15 }: P) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={INK} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><rect x="4" y="10" width="16" height="11" rx="3" /><path d="M8 10V7a4 4 0 0 1 8 0v3" /></svg>
);

export const SpinIcon = ({ size = 24 }: P) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={INK} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M3 12h18" /><path d="M7 8l-4 4 4 4" /><path d="M17 8l4 4-4 4" /></svg>
);

/** A small product drawing per category, tinted with the wish's color (bubble thumbnails, empty cards). */
export function CategoryIcon({ category, color, size = 44 }: { category: Category | string; color?: string; size?: number }) {
  const c = color ?? "#C5D8CF";
  switch (category) {
    case "dress":
      return (
        <svg width={size * 0.72} height={size * 1.1} viewBox="0 0 120 190" aria-hidden="true">
          <path d="M47 5 L49 30 M73 5 L71 30" stroke={c} strokeWidth="4" strokeLinecap="round" />
          <path d="M47 29 Q60 38 73 29 L76 60 Q60 64 44 60 Z" fill={c} />
          <path d="M43 62 Q60 66 77 62 Q92 118 101 160 Q60 172 19 160 Q28 118 43 62 Z" fill={c} />
          <path d="M52 72 Q47 120 38 160" stroke="#fff" strokeOpacity=".3" strokeWidth="4" fill="none" />
          <rect x="78" y="74" width="10" height="16" rx="2.5" fill={INK} transform="rotate(-12 83 82)" />
        </svg>
      );
    case "skirt":
      return (
        <svg width={size} height={size} viewBox="0 0 100 130" aria-hidden="true">
          <path d="M32 22 Q50 26 68 22 L69 32 Q50 36 31 32 Z" fill={c} />
          <path d="M31 32 Q50 36 69 32 Q82 80 88 114 Q50 124 12 114 Q18 80 31 32 Z" fill={c} />
          <path d="M31 32 Q50 36 50 36 L44 120 Q24 118 12 114 Q18 80 31 32 Z" fill="#fff" opacity=".2" />
        </svg>
      );
    case "top":
      return (
        <svg width={size} height={size} viewBox="0 0 48 48" aria-hidden="true">
          <path d="M16 9l8 3 8-3 9 7-4 7-4-2v18H15V21l-4 2-4-7z" fill={c} />
          <path d="M20 10q4 4 8 0" stroke="#fff" strokeOpacity=".6" strokeWidth="1.6" fill="none" />
        </svg>
      );
    case "backpack":
      return (
        <svg width={size} height={size} viewBox="0 0 48 48" aria-hidden="true">
          <path d="M19 10V7a5 5 0 0 1 10 0v3" stroke={INK} strokeOpacity=".5" strokeWidth="2.4" fill="none" />
          <rect x="12" y="10" width="24" height="32" rx="7" fill={c} />
          <rect x="15" y="26" width="18" height="12" rx="3" fill={INK} fillOpacity=".18" />
          <path d="M34 16 L43 11 L43 24 L34 22 Z" fill="#F2D88A" />
          <path d="M15 14c1-2 3-3 5-3" stroke="#fff" strokeOpacity=".6" strokeWidth="1.6" fill="none" strokeLinecap="round" />
        </svg>
      );
    case "helmet":
      return (
        <svg width={size} height={size} viewBox="0 0 48 48" aria-hidden="true">
          <path d="M7 30C7 17 15 9 25 9s17 8 17 20v3H7z" fill={c} />
          <path d="M18 12c-3 4-4 9-4 14M25 10v16M32 12c3 4 4 9 4 14" stroke="#fff" strokeOpacity=".55" strokeWidth="1.6" fill="none" />
          <rect x="5" y="30" width="38" height="4" rx="2" fill={INK} fillOpacity=".25" />
          <circle cx="14" cy="36" r="6" fill={INK} />
          <circle cx="14" cy="36" r="2.5" fill="#F2D88A" />
        </svg>
      );
    default:
      return <Sparkle size={size * 0.6} color={color ?? "#E9C46A"} />;
  }
}
