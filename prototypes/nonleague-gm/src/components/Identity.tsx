import clsx from "clsx";

import { appearanceOf } from "@/engine/identity";

interface FaceProps {
  playerId: string;
  age?: number;
  name: string;
  /** Portrait from a licensed provider. When present it replaces the drawing. */
  photoUrl?: string;
  colors: { primary: string; secondary: string };
  /** Shirt number, printed on the collar. */
  number?: number;
  className?: string;
  /** `bust` crops at the shoulders; `head` is a circle for inline use. */
  crop?: "bust" | "head";
}

/**
 * A player's face.
 *
 * Two sources, one component. If the dataset came from a licensed provider the
 * portrait is that provider's official cut-out; otherwise the face is drawn from
 * the player id — same id, same person, in the squad grid, on the pitch and in
 * the goal celebration. The drawing is deliberately a *portrait*, not a cartoon:
 * a shaded head, a hairline, a jaw, a shirt, at the scale a card actually uses.
 *
 * The alternative — no face at all — is what makes a management game read as a
 * spreadsheet. This is the single highest-leverage piece of the "act like a
 * game" direction.
 */
export function PlayerFace({
  playerId,
  age,
  name,
  photoUrl,
  colors,
  number,
  className,
  crop = "bust",
}: FaceProps) {
  if (photoUrl) {
    return (
      <span className={clsx("relative block overflow-hidden", className)} data-testid="player-face">
        <img
          src={photoUrl}
          alt={name}
          loading="lazy"
          className="h-full w-full object-cover object-top"
          style={{ filter: "drop-shadow(0 6px 12px rgba(0,0,0,.45))" }}
        />
      </span>
    );
  }

  const look = appearanceOf(playerId, age ?? 26);
  const uid = `f${playerId.replace(/[^a-zA-Z0-9]/g, "")}`;

  return (
    <span
      className={clsx("relative block overflow-hidden", className)}
      data-testid="player-face"
      data-player={playerId}
      data-hair={look.hairStyle}
      aria-hidden
    >
      <svg
        viewBox={crop === "head" ? "26 18 68 80" : "10 2 100 142"}
        className="h-full w-full"
        preserveAspectRatio="xMidYMid slice"
        role="presentation"
      >
        <defs>
          <linearGradient id={`${uid}-shirt`} x1="0" y1="0" x2="0.4" y2="1">
            <stop offset="0%" stopColor={colors.primary} />
            <stop offset="100%" stopColor={colors.secondary} />
          </linearGradient>
          <radialGradient id={`${uid}-skin`} cx="38%" cy="28%" r="78%">
            <stop offset="0%" stopColor={look.skin} />
            <stop offset="72%" stopColor={look.skin} />
            <stop offset="100%" stopColor={look.shade} />
          </radialGradient>
          <linearGradient id={`${uid}-hair`} x1="0" y1="0" x2="0.2" y2="1">
            <stop offset="0%" stopColor={look.hair} stopOpacity="0.95" />
            <stop offset="100%" stopColor={look.hair} stopOpacity="0.72" />
          </linearGradient>
          <clipPath id={`${uid}-crop`}>
            <rect x="0" y="0" width="120" height="150" />
          </clipPath>
        </defs>

        <g clipPath={`url(#${uid}-crop)`}>
          {/* Studio backdrop: a soft floodlight falloff behind the head. */}
          <rect width="120" height="150" fill="#0b1a13" />
          <linearGradient id={`${uid}-fade`} x1="0" y1="0.55" x2="0" y2="1">
            <stop offset="0%" stopColor="#06120d" stopOpacity="0" />
            <stop offset="100%" stopColor="#06120d" stopOpacity="0.75" />
          </linearGradient>
          <ellipse cx="60" cy="52" rx="62" ry="58" fill={colors.primary} opacity="0.22" />
          <ellipse cx="60" cy="40" rx="40" ry="38" fill={look.skin} opacity="0.1" />

          {/* Shoulders and shirt. */}
          <path
            d="M12 150c0-24 16-41 34-46l14-4 14 4c18 5 34 22 34 46Z"
            fill={`url(#${uid}-shirt)`}
          />
          {/* Shirt highlight, so the kit reads as fabric and not a flat shape. */}
          <path
            d="M28 150c2-18 12-30 26-36l6 2-8 34Z"
            fill="#ffffff"
            opacity="0.12"
          />
          {/* Collar. */}
          <path
            d="M46 101 60 115 74 101l8 3-10 18H48l-10-18Z"
            fill={colors.secondary}
            opacity="0.95"
          />
          {number !== undefined && (
            <text
              x="60"
              y="143"
              textAnchor="middle"
              fontFamily="ui-monospace, monospace"
              fontSize="15"
              fontWeight="700"
              fill="#06120d"
              opacity="0.85"
            >
              {number}
            </text>
          )}

          {/* Neck. */}
          <path d="M50 84h20v22c0 5-20 5-20 0Z" fill={look.shade} />
          <path d="M50 84h20v9c-6 5-14 5-20 0Z" fill="#000000" opacity="0.18" />

          {/* Head. */}
          <g transform={`translate(60 52) scale(${look.build} 1) translate(-60 -52)`}>
            {/* Ears. */}
            <ellipse cx="30" cy="56" rx="5.5" ry="8" fill={look.shade} />
            <ellipse cx="90" cy="56" rx="5.5" ry="8" fill={look.shade} />
            {/* Skull and jaw. */}
            <path
              d="M32 46c0-19 12-30 28-30s28 11 28 30v14c0 18-10 31-28 31S32 78 32 60Z"
              fill={`url(#${uid}-skin)`}
            />
            {/* Cheekbone shading. */}
            <path
              d="M36 57c4 9 10 15 18 18-9 2-16-1-19-7Z"
              fill={look.shade}
              opacity="0.32"
            />
            <path
              d="M84 57c-4 9-10 15-18 18 9 2 16-1 19-7Z"
              fill={look.shade}
              opacity="0.24"
            />

            {/* Brows. */}
            <Brows style={look.brow} colour={look.hair} />
            {/* Eyes. */}
            <ellipse cx="48" cy="53" rx="4.4" ry="3.1" fill="#f7f4ef" />
            <ellipse cx="72" cy="53" rx="4.4" ry="3.1" fill="#f7f4ef" />
            <circle cx="48.6" cy="53.2" r="2.1" fill={look.eyes} />
            <circle cx="72.6" cy="53.2" r="2.1" fill={look.eyes} />
            <circle cx="48" cy="52.4" r="0.7" fill="#fff" opacity="0.9" />
            <circle cx="72" cy="52.4" r="0.7" fill="#fff" opacity="0.9" />
            {/* Nose. */}
            <path
              d="M60 54v9l-3.5 3.5h7Z"
              fill={look.shade}
              opacity="0.55"
            />
            {/* Mouth. */}
            <path
              d={look.quirk % 2 === 0 ? "M52 74c4 3 12 3 16 0" : "M52 74c5 4 11 3 16-1"}
              stroke="#7a3b34"
              strokeWidth="1.9"
              strokeLinecap="round"
              fill="none"
              opacity="0.8"
            />
            <path d="M52 73c4 1.6 12 1.6 16 0" stroke="#000" strokeWidth="0.7" opacity="0.25" fill="none" />

            {/* Hair. Drawn last so it sits over the brow line. */}
            <Hair style={look.hairStyle} colour={`url(#${uid}-hair)`} solid={look.hair} />
            <Beard style={look.beard} colour={look.hair} />
          </g>

          {/* The shirt fades into the card, so the portrait sits *in* the design
              instead of floating on top of it. */}
          <rect x="0" y="104" width="120" height="46" fill={`url(#${uid}-fade)`} />
        </g>
      </svg>
    </span>
  );
}

function Brows({ style, colour }: { style: "flat" | "arched" | "heavy"; colour: string }) {
  const width = style === "heavy" ? 3.4 : 2.4;
  const lift = style === "arched" ? 2 : 0;
  return (
    <g stroke={colour} strokeWidth={width} strokeLinecap="round" fill="none" opacity="0.9">
      <path d={`M42 ${45 - lift}q6 ${-2.4 - lift} 12 0.6`} />
      <path d={`M66 ${45.6 - lift}q6 ${-3 - lift} 12 0`} />
    </g>
  );
}

function Hair({
  style,
  colour,
  solid,
}: {
  style: "crop" | "buzz" | "curtains" | "fade" | "afro" | "knot" | "bald";
  colour: string;
  solid: string;
}) {
  switch (style) {
    case "bald":
      // A bald head still needs a shadow where the hairline would be, or it
      // reads as a mannequin.
      return <path d="M33 44c1-16 12-26 27-26s26 10 27 26c-6-11-15-15-27-15s-21 4-27 15Z" fill={solid} opacity="0.35" />;
    case "buzz":
      return <path d="M31 46c0-18 12-30 29-30s29 12 29 30c-4-8-13-13-29-13S35 38 31 46Z" fill={colour} opacity="0.75" />;
    case "fade":
      return (
        <>
          <path d="M31 48c0-20 12-32 29-32s29 12 29 32c-3-9-8-14-14-16-6 5-24 6-30 1-8 2-11 7-14 15Z" fill={colour} />
          <path d="M33 26c6-7 15-10 27-10s21 3 27 10c-7-4-16-5-27-5s-20 1-27 5Z" fill="#000" opacity="0.2" />
        </>
      );
    case "curtains":
      return (
        <>
          <path d="M30 50c0-22 13-34 30-34s30 12 30 34c-2-9-5-15-10-19-6 7-14 9-20 9s-14-2-20-9c-5 4-8 10-10 19Z" fill={colour} />
          <path d="M36 20c7 9 14 12 24 12s17-3 24-12c-6-4-14-6-24-6s-18 2-24 6Z" fill={solid} opacity="0.5" />
        </>
      );
    case "afro":
      return (
        <>
          <ellipse cx="60" cy="34" rx="33" ry="25" fill={colour} />
          <ellipse cx="33" cy="42" rx="9" ry="12" fill={colour} />
          <ellipse cx="87" cy="42" rx="9" ry="12" fill={colour} />
          <path d="M38 44c2-8 11-12 22-12s20 4 22 12c-6-5-13-7-22-7s-16 2-22 7Z" fill="#000" opacity="0.18" />
        </>
      );
    case "knot":
      return (
        <>
          <circle cx="60" cy="13" r="8.5" fill={colour} />
          <path d="M31 47c0-19 12-31 29-31s29 12 29 31c-4-9-13-14-29-14S35 38 31 47Z" fill={colour} />
        </>
      );
    case "crop":
    default:
      return (
        <>
          <path d="M31 47c0-19 12-31 29-31s29 12 29 31c-3-10-9-15-15-17-7 4-21 5-28 0-7 2-12 7-15 17Z" fill={colour} />
          <path d="M35 33c6-6 14-9 25-9s19 3 25 9c-7-4-15-5-25-5s-18 1-25 5Z" fill={solid} opacity="0.55" />
        </>
      );
  }
}

function Beard({ style, colour }: { style: "none" | "stubble" | "moustache" | "chin" | "full"; colour: string }) {
  switch (style) {
    case "moustache":
      return <path d="M52 69c2-2 6-2 8 0 2-2 6-2 8 0-2 3-5 3-8 1-3 2-6 2-8-1Z" fill={colour} opacity="0.85" />;
    case "chin":
      return <path d="M49 81c3 6 8 9 11 9s8-3 11-9c-3 2-7 3-11 3s-8-1-11-3Z" fill={colour} opacity="0.8" />;
    case "full":
      return (
        <path
          d="M36 62c1 16 10 29 24 29s23-13 24-29c-2 10-6 16-12 18-3-4-7-6-12-6s-9 2-12 6c-6-2-10-8-12-18Z"
          fill={colour}
          opacity="0.85"
        />
      );
    case "stubble":
      return (
        <path
          d="M38 64c2 14 10 25 22 25s20-11 22-25c-3 9-8 14-13 16-3-3-6-4-9-4s-6 1-9 4c-5-2-10-7-13-16Z"
          fill={colour}
          opacity="0.32"
        />
      );
    case "none":
    default:
      return null;
  }
}

/**
 * A club badge.
 *
 * Licensed datasets bring real crests; the fictional world gets a generated
 * shield from the club's own colours. Both render at the same size, so a screen
 * never has to know which world it is in.
 */
export function ClubCrest({
  clubId,
  name,
  colors,
  short,
  crestUrl,
  className,
}: {
  clubId: string;
  name: string;
  colors: { primary: string; secondary: string };
  short: string;
  crestUrl?: string;
  className?: string;
}) {
  if (crestUrl) {
    return (
      <img
        src={crestUrl}
        alt={name}
        loading="lazy"
        className={clsx("object-contain", className)}
        data-testid="club-crest"
        data-club={clubId}
      />
    );
  }

  const h = hashOf(clubId);
  const pattern = ["band", "stripes", "halves", "chevron", "hoops"][h % 5];
  const uid = `c${clubId.replace(/[^a-zA-Z0-9]/g, "")}`;

  return (
    <svg
      viewBox="0 0 100 110"
      className={clsx("object-contain", className)}
      data-testid="club-crest"
      data-club={clubId}
      data-pattern={pattern}
      role="img"
      aria-label={`${name} crest`}
    >
      <defs>
        <clipPath id={`${uid}-shield`}>
          <path d="M50 3 93 15v44c0 25-19 41-43 48C26 100 7 84 7 59V15Z" />
        </clipPath>
        <linearGradient id={`${uid}-gloss`} x1="0" y1="0" x2="0.6" y2="1">
          <stop offset="0%" stopColor="#fff" stopOpacity="0.28" />
          <stop offset="55%" stopColor="#fff" stopOpacity="0.04" />
          <stop offset="100%" stopColor="#000" stopOpacity="0.22" />
        </linearGradient>
      </defs>

      <g clipPath={`url(#${uid}-shield)`}>
        <rect width="100" height="110" fill={colors.primary} />
        {pattern === "stripes" &&
          [0, 1, 2, 3].map((i) => (
            <rect key={i} x={12 + i * 22} y="0" width="11" height="110" fill={colors.secondary} />
          ))}
        {pattern === "halves" && <rect x="50" width="50" height="110" fill={colors.secondary} />}
        {pattern === "band" && <rect y="42" width="100" height="20" fill={colors.secondary} />}
        {pattern === "chevron" && (
          <path d="M0 58 50 22 100 58v20L50 42 0 78Z" fill={colors.secondary} />
        )}
        {pattern === "hoops" &&
          [0, 1, 2].map((i) => (
            <rect key={i} y={16 + i * 26} width="100" height="11" fill={colors.secondary} opacity="0.9" />
          ))}
        <rect width="100" height="110" fill={`url(#${uid}-gloss)`} />
      </g>

      <path
        d="M50 6 90 17v42c0 23-17 38-40 45C27 97 10 82 10 59V17Z"
        fill="none"
        stroke="#06120d"
        strokeOpacity="0.5"
        strokeWidth="2.5"
      />
      <path
        d="M50 9.5 87 20v39c0 21-15 35-37 41V9.5Z"
        fill="#fff"
        opacity="0.07"
      />
      <text
        x="50"
        y="62"
        textAnchor="middle"
        fontFamily="ui-monospace, monospace"
        fontSize="23"
        fontWeight="800"
        letterSpacing="1"
        fill={readableOn(colors.primary)}
        opacity="0.95"
      >
        {short.slice(0, 3).toUpperCase()}
      </text>
    </svg>
  );
}

function hashOf(value: string): number {
  let h = 2166136261;
  for (let i = 0; i < value.length; i++) {
    h ^= value.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

/** Black on light shirts, paper on dark ones — decided, not guessed. */
function readableOn(hex: string): string {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return "#e8f2ea";
  const n = parseInt(m[1], 16);
  const r = (n >> 16) & 255;
  const g = (n >> 8) & 255;
  const b = n & 255;
  const luminance = (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
  return luminance > 0.55 ? "#06120d" : "#e8f2ea";
}
