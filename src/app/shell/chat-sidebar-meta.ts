/*
 * The small second line under a chat's name in the chat list: when it was last
 * active ("2h ago") and who's in it, unless the chat's name already says so.
 */

const MINUTE_MS = 60_000;
const HOUR_MS = 60 * MINUTE_MS;
const DAY_MS = 24 * HOUR_MS;

/** "just now", "5m ago", "2h ago", "3d ago", then the date ("Mar 4", or "Mar 4, 2025" in another year). */
export function formatChatLastActive(value: string | number | Date, now: number): string {
  const date = new Date(value);
  const time = date.getTime();
  if (Number.isNaN(time)) return "";
  // A clock a little ahead of this one still reads as "just now".
  const elapsed = Math.max(0, now - time);
  if (elapsed < MINUTE_MS) return "just now";
  if (elapsed < HOUR_MS) return `${Math.floor(elapsed / MINUTE_MS)}m ago`;
  if (elapsed < DAY_MS) return `${Math.floor(elapsed / HOUR_MS)}h ago`;
  if (elapsed < 7 * DAY_MS) return `${Math.floor(elapsed / DAY_MS)}d ago`;
  return date.toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    ...(date.getFullYear() === new Date(now).getFullYear() ? {} : { year: "numeric" }),
  });
}

/** The chat's characters the name doesn't already mention: "Mira, Jun +2" (at most two named). */
export function chatRowCharacterNames(chatName: string, characterNames: readonly string[]): string {
  const unnamed = characterNames.filter((characterName) => {
    const trimmed = characterName.trim();
    return trimmed.length > 0 && !mentionsWholeName(chatName, trimmed);
  });
  if (unnamed.length === 0) return "";
  const shown = unnamed.slice(0, 2).join(", ");
  return unnamed.length > 2 ? `${shown} +${unnamed.length - 2}` : shown;
}

/** Whole words only, any case and script: "Ann" is in "Ann's party" but not in "Annual party". */
function mentionsWholeName(chatName: string, characterName: string): boolean {
  const escaped = characterName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`(?<![\\p{L}\\p{M}\\p{N}])${escaped}(?![\\p{L}\\p{M}\\p{N}])`, "iu").test(chatName);
}
