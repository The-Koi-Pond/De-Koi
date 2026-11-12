import type { CSSProperties, ReactNode } from "react";
import { KITSUNE_FACE, KITSUNE_MARKINGS } from "./pond-kitsune-paths";

/*
 * De-Koi's own navigation icons, drawn for the Pond look (DESIGN.md section 7,
 * "Icons"): a 24 grid, 1.5 ink lines with round ends, and one touch of
 * vermilion or jade each. The ink follows the text colour (`currentColor`);
 * the accents use Pond's koi and jade, falling back to the theme's primary
 * and accent colours elsewhere. Drawn to read at 18px and up. Lucide stays
 * for small utility icons.
 */

export type PondIconProps = {
  size?: number | string;
  className?: string;
  "aria-hidden"?: boolean;
};

export type PondIcon = (props: PondIconProps) => ReactNode;

const KOI = "var(--pond-koi, var(--primary))";
const JADE = "var(--pond-jade, var(--accent-foreground))";
const koiLine: CSSProperties = { stroke: KOI };
const jadeLine: CSSProperties = { stroke: JADE };
const koiFill: CSSProperties = { fill: KOI, stroke: "none" };
const jadeFill: CSSProperties = { fill: JADE, stroke: "none" };

function IconFrame({ size = 24, className, children, ...rest }: PondIconProps & { children: ReactNode }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.5}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden={rest["aria-hidden"] ?? true}
    >
      {children}
    </svg>
  );
}

/** Chats: two bubbles, the one behind in jade. */
export const PondChatsIcon: PondIcon = (props) => (
  <IconFrame {...props}>
    <path style={jadeLine} d="M9 6.5V5a2 2 0 0 1 2-2h8a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-1" />
    <path d="M5 8h9a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2H9.5L6 20v-3H5a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2Z" />
  </IconFrame>
);

/** Home: a house with upturned eaves and a vermilion door. */
export const PondHomeIcon: PondIcon = (props) => (
  <IconFrame {...props}>
    <path d="M2 10.4c1.4.2 2.4-.2 3.2-.9L12 4l6.8 5.5c.8.7 1.8 1.1 3.2.9" />
    <path d="M5.5 10.2v9.3h13v-9.3" />
    <path style={koiLine} d="M10.3 19.5v-4.7h3.4v4.7" />
  </IconFrame>
);

/** Characters: two people, the one behind in jade. */
export const PondCharactersIcon: PondIcon = (props) => (
  <IconFrame {...props}>
    <circle style={jadeLine} cx="16.2" cy="7.4" r="2.6" />
    <path style={jadeLine} d="M14.4 12.4c.6-.4 1.2-.6 1.8-.6 2.5 0 4.6 2.1 5 5.2" />
    <circle cx="9" cy="8.6" r="3.2" />
    <path d="M3 19.8c.4-3.6 3-5.9 6-5.9s5.6 2.3 6 5.9" />
  </IconFrame>
);

/** Lorebooks: an open book, jade lines of text on the left page and a vermilion ribbon bookmark on the right. */
export const PondLorebooksIcon: PondIcon = (props) => (
  <IconFrame {...props}>
    <path d="M12 6.8C10.2 5.5 7.6 4.8 4.5 4.8a1 1 0 0 0-1 1V17a1 1 0 0 0 1 1c3 0 5.6.7 7.5 2" />
    <path d="M12 6.8c1.8-1.3 4.4-2 7.5-2a1 1 0 0 1 1 1V17a1 1 0 0 1-1 1c-3 0-5.6.7-7.5 2" />
    <path d="M12 6.8V20" />
    <path style={jadeLine} strokeWidth={1.3} d="M6 9.4c1.4 0 2.7.3 3.8.8M6 12.4c1.4 0 2.7.3 3.8.8" />
    <path style={koiFill} d="M15 5.3h2.4v5.6l-1.2-1-1.2 1Z" />
  </IconFrame>
);

/** Presets: an unrolled scroll with a vermilion cord. */
export const PondPresetsIcon: PondIcon = (props) => (
  <IconFrame {...props}>
    <path d="M4 5.5a1.5 1.5 0 0 1 3 0v13a1.5 1.5 0 0 1-3 0Z" />
    <path d="M5.5 4H19a1 1 0 0 1 1 1v12.5a1 1 0 0 1-1 1H7" />
    <path style={jadeLine} d="M10 8.5h7M10 11.5h7M10 14.5h4.5" />
    <path style={koiLine} d="M3 12h5" />
  </IconFrame>
);

/** Gallery: a framed bonsai in a vermilion pot. */
export const PondGalleryIcon: PondIcon = (props) => (
  <IconFrame {...props}>
    <path d="M4 3.5h16a1 1 0 0 1 1 1v15a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1v-15a1 1 0 0 1 1-1Z" />
    <path d="M11.8 16.6c-.4-1.6.4-2.7 1.5-3.5 1-.7 1.2-1.7.3-2.6M12.8 13.3c-1.2-.4-2.4-.2-3.4.6" />
    <ellipse style={jadeFill} cx="14.4" cy="8.8" rx="3.1" ry="1.5" />
    <ellipse style={jadeFill} cx="8.8" cy="12.4" rx="2.4" ry="1.2" />
    <ellipse style={jadeFill} cx="16.9" cy="12" rx="1.9" ry="1" />
    <path style={koiFill} d="M8.6 16.6h6.8l-.9 2.2H9.5Z" />
  </IconFrame>
);

/** Connections: a vermilion drum bridge, its railing posts with gaps between them, over water. */
export const PondConnectionsIcon: PondIcon = (props) => (
  <IconFrame {...props}>
    <path
      style={koiLine}
      strokeWidth={2.1}
      d="M2.5 16.2L3 15.59L3.5 15L4 14.45L4.5 13.94L5 13.46L5.5 13.01L6 12.59L6.5 12.21L7 11.86L7.5 11.55L8 11.26L8.5 11.01L9 10.8L9.5 10.62L10 10.47L10.5 10.35L11 10.27L11.5 10.22L12 10.2L12.5 10.22L13 10.27L13.5 10.35L14 10.47L14.5 10.62L15 10.8L15.5 11.01L16 11.26L16.5 11.55L17 11.86L17.5 12.21L18 12.59L18.5 13.01L19 13.46L19.5 13.94L20 14.45L20.5 15L21 15.59L21.5 16.2"
    />
    <path
      style={koiLine}
      strokeWidth={1.4}
      d="M3.4 12L3.9 11.37L4.4 10.77L4.9 10.22L5.4 9.7L5.9 9.22L6.4 8.77L6.9 8.37L7.4 8L7.9 7.67L8.4 7.38L8.9 7.13L9.4 6.91L9.9 6.73L10.4 6.59L10.9 6.49L11.4 6.43L11.9 6.4L12.4 6.41L12.9 6.46L13.4 6.55L13.9 6.67L14.4 6.84L14.9 7.04L15.4 7.28L15.9 7.55L16.4 7.87L16.9 8.22L17.4 8.61L17.9 9.04L18.4 9.5L18.9 10L19.4 10.55L19.9 11.13L20.4 11.74"
    />
    <path
      style={koiLine}
      strokeWidth={1.1}
      d="M5.6 9.5V12.92M7.7 7.8V11.43M9.9 6.73V10.49M12 6.4V10.2M14.1 6.73V10.49M16.3 7.8V11.43M18.4 9.5V12.92"
    />
    <path style={koiLine} strokeWidth={1.6} d="M3.4 10.4V15.12M20.6 10.4V15.12" />
    <path
      style={jadeLine}
      d="M2 19.4c1.6-.7 3.2-.7 4.8 0M9.6 19.4c1.6-.7 3.2-.7 4.8 0M17.2 19.4c1.6-.7 3.2-.7 4.8 0M6 21.6h3.6M14.4 21.6H18"
    />
  </IconFrame>
);

/** Agents: a paper crane, vermilion on one side of the paper and white on the other. */
export const PondAgentsIcon: PondIcon = (props) => (
  <IconFrame {...props}>
    <g style={{ stroke: "color-mix(in srgb, currentColor 30%, transparent)" }} strokeWidth={0.7} strokeLinejoin="round">
      <path style={{ fill: KOI }} d="M10.5 13 19.6 3.4l-5 10.2Z" />
      <path style={{ fill: "#fff" }} d="M17.6 14.6 22 10.4l-7.4 6Z" />
      <path style={{ fill: "#fff" }} d="M6.6 15.2 2.6 8.6l7.6 7.6Z" />
      <path style={{ fill: "#fff" }} d="M6.6 15.2 12 13l5.6 2.2Z" />
      <path style={{ fill: KOI }} d="M6.6 15.2h11L12 18.8Z" />
      <path style={{ fill: "#fff" }} d="M8.8 13.8 15.8 2.6l-4 10.8Z" />
      <path style={{ fill: "#d9e2df" }} d="M11.8 13.4 15.8 2.6l-2 11.4Z" />
      <path style={{ fill: KOI }} d="M2.6 8.6 1.3 10.7l2.4-.8Z" />
    </g>
  </IconFrame>
);

/** Settings: De-Koi's own eight-tooth gear with a jade centre. */
export const PondSettingsIcon: PondIcon = (props) => (
  <IconFrame {...props}>
    <path d="M10.39 5.29L10.42 2.94L13.58 2.94L13.61 5.29A6.9 6.9 0 0 1 15.61 6.12L17.29 4.47L19.53 6.71L17.88 8.39A6.9 6.9 0 0 1 18.71 10.39L21.06 10.42L21.06 13.58L18.71 13.61A6.9 6.9 0 0 1 17.88 15.61L19.53 17.29L17.29 19.53L15.61 17.88A6.9 6.9 0 0 1 13.61 18.71L13.58 21.06L10.42 21.06L10.39 18.71A6.9 6.9 0 0 1 8.39 17.88L6.71 19.53L4.47 17.29L6.12 15.61A6.9 6.9 0 0 1 5.29 13.61L2.94 13.58L2.94 10.42L5.29 10.39A6.9 6.9 0 0 1 6.12 8.39L4.47 6.71L6.71 4.47L8.39 6.12A6.9 6.9 0 0 1 10.39 5.29Z" />
    <circle style={jadeLine} cx="12" cy="12" r="2.8" />
  </IconFrame>
);

/** Discover: a looking glass over the water, with a little koi in its lens. */
export const PondDiscoverIcon: PondIcon = (props) => (
  <IconFrame {...props}>
    <circle cx="10.5" cy="10.5" r="6.6" />
    <path d="m15.4 15.4 5.1 5.1" />
    <path style={jadeLine} d="M6.8 11.6c1.2-.9 2.4-.9 3.6 0s2.4.9 3.6 0" />
    <circle style={koiFill} cx="9" cy="8.4" r=".95" />
  </IconFrame>
);

/** Help: a question in a round window. */
export const PondHelpIcon: PondIcon = (props) => (
  <IconFrame {...props}>
    <circle cx="12" cy="12" r="9" />
    <path d="M9.6 9.5a2.5 2.5 0 0 1 4.8.9c0 1.6-2.4 2.2-2.4 3.7" />
    <circle style={koiFill} cx="12" cy="17" r="1.05" />
  </IconFrame>
);

/* ── The three modes ── */

/** Conversation: a tea cup whose steam curls up into a speech bubble. */
export const PondConversationIcon: PondIcon = (props) => (
  <IconFrame {...props}>
    <path d="M4 13.6h9l-.8 6.2a1.6 1.6 0 0 1-1.6 1.4H6.4a1.6 1.6 0 0 1-1.6-1.4Z" />
    <path style={koiLine} d="M4.5 16.2h8" />
    <path style={jadeLine} d="M8.4 12c-.9-.9-.9-1.9 0-2.7.7-.6 1.9-.9 3.4-.7" />
    <path
      style={jadeLine}
      d="M12.5 2.6h7a2 2 0 0 1 2 2v2.6a2 2 0 0 1-2 2h-4.3l-2.6 1.8V9.2h-.1a2 2 0 0 1-2-2V4.6a2 2 0 0 1 2-2Z"
    />
    <circle style={koiFill} cx="14" cy="5.9" r=".75" />
    <circle style={koiFill} cx="16" cy="5.9" r=".75" />
    <circle style={koiFill} cx="18" cy="5.9" r=".75" />
  </IconFrame>
);

/** Roleplay: a kitsune mask, for wearing a character. White face, vermilion markings, in every theme mode. */
export const PondRoleplayIcon: PondIcon = (props) => (
  <IconFrame {...props}>
    <path style={{ fill: "#ffffff", stroke: "none" }} d={KITSUNE_FACE} />
    <path style={koiFill} d={KITSUNE_MARKINGS} />
  </IconFrame>
);

/** Fanfic: an ink brush over a looping jade stroke. */
export const PondFanficIcon: PondIcon = (props) => (
  <IconFrame {...props}>
    <path
      style={jadeFill}
      d="M2.6 19.4c2.8-1.9 7.2-2.6 11-1.6 2 .5 2.6 1.6 1 2.5-2.4 1.2-7 1.5-10.6 1 3.1-.2 6.6-.7 8.6-1.4 1-.4.7-1-.7-1.2-3-.5-6.4 0-9.3.7Z"
    />
    <path d="M21 3 13.7 10.3" />
    <path strokeWidth={2.6} d="m12.7 9.4 1.9 1.9" />
    <path
      style={koiFill}
      d="M12.6 9.6c-3 .3-5.2 1.9-6 4.4-.4 1.3-1 2.3-2.1 3.1 2.5.4 4.9-.2 6.6-1.9 1.4-1.4 2-2.9 2-4.4Z"
    />
  </IconFrame>
);

/** Trance: an ink spiral around a jade centre. */
export const PondTranceIcon: PondIcon = (props) => (
  <IconFrame {...props}>
    <path d="M12 12A1 1 0 0 1 14 12A2 2 0 0 1 10 12A3 3 0 0 1 16 12A4 4 0 0 1 8 12A5 5 0 0 1 18 12A6 6 0 0 1 6 12" />
    <circle style={jadeFill} cx="12" cy="12" r="1.1" />
    <circle style={koiFill} cx="6" cy="12" r="1" />
  </IconFrame>
);

/** The Pond icon for each mode, keyed like the chat's `mode` field. */
export const POND_MODE_ICONS = {
  conversation: PondConversationIcon,
  roleplay: PondRoleplayIcon,
  fanfic: PondFanficIcon,
  trance: PondTranceIcon,
} as const satisfies Record<string, PondIcon>;
