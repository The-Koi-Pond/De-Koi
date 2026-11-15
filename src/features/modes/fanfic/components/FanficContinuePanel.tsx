import { useMemo, useState } from "react";
import { Loader2, MessagesSquare, Square } from "lucide-react";

import type { FanficState } from "../../../../engine/contracts/types/fanfic";
import { fanficCastNames, type FanficChatMode } from "../../../../engine/modes/fanfic/to-chat";
import { cn } from "../../../../shared/lib/utils";
import { useCharacterSummaries } from "../../../catalog/characters/index";
import { useChat } from "../../../catalog/chats/index";
import { useActivePersonaSummary, usePersonaSummary } from "../../../catalog/personas/index";
import { useFanficToChat } from "../hooks/use-fanfic-to-chat";
import { FanficButton, FanficField, FanficSection, FanficSegmented } from "./fanfic-ui";

const YOURSELF = "\u0000yourself";

function cardName(row: { data?: { name?: string } }): string {
  return row.data?.name?.trim() || "";
}

function sameName(a: string, b: string): boolean {
  return a.trim().toLowerCase() === b.trim().toLowerCase();
}

function list(names: readonly string[]): string {
  return names.length <= 1 ? (names[0] ?? "") : `${names.slice(0, -1).join(", ")} and ${names.at(-1)}`;
}

/**
 * Continues the fic as a roleplay or a texting chat that picks up after the last chapter, or branches off after an
 * earlier one: who the requester plays (their persona or a fic character) and who the AI plays. Characters with no
 * card get one written from the fic.
 */
export function FanficContinuePanel({
  chatId,
  state,
  chapters,
  busy,
}: {
  chatId: string;
  state: FanficState;
  /** The labels of the chapters the story builds on, in reading order ("1", "2", "2.5", …). */
  chapters: readonly string[];
  /** While the fic is writing. */
  busy: boolean;
}) {
  const { data: chat } = useChat(chatId);
  const { data: characterRows } = useCharacterSummaries(true);
  const personaId = chat?.personaId ?? null;
  const { data: pinnedPersona } = usePersonaSummary(personaId);
  const { data: activePersona } = useActivePersonaSummary(!personaId);
  const ownName =
    ((pinnedPersona ?? activePersona) as { name?: string } | null | undefined)?.name?.trim() || "your persona";
  const linkedIds = useMemo(() => (Array.isArray(chat?.characterIds) ? chat.characterIds : []), [chat?.characterIds]);
  const cardNames = useMemo(
    () =>
      (characterRows ?? [])
        .filter((row) => linkedIds.includes(row.id))
        .map((row) => cardName(row as { data?: { name?: string } }))
        .filter(Boolean),
    [characterRows, linkedIds],
  );
  const cast = useMemo(() => fanficCastNames(state, cardNames), [state, cardNames]);
  const hasCard = (name: string) => cardNames.some((entry) => sameName(entry, name));

  const [mode, setMode] = useState<FanficChatMode>("roleplay");
  const last = chapters.at(-1) ?? "";
  const [afterPick, setAfterPick] = useState<string | null>(null);
  // A pick that is no longer a chapter (rewritten or deleted) falls back to the last one.
  const after = afterPick && chapters.includes(afterPick) ? afterPick : last;
  const branching = after !== last;
  const [playAs, setPlayAs] = useState<string>(YOURSELF);
  const [picked, setPicked] = useState<string[] | null>(null);
  const others = cast.filter((name) => playAs === YOURSELF || !sameName(name, playAs));
  // Roleplay starts with everyone else; a chat is with one character.
  const aiPlays = (picked ?? others).filter((name) => others.some((entry) => sameName(entry, name)));
  const chosen = mode === "conversation" ? aiPlays.slice(0, 1) : aiPlays;
  const toChat = useFanficToChat(chatId);

  const newCards = chosen.filter((name) => !hasCard(name));
  const newPersona = playAs !== YOURSELF && !hasCard(playAs);
  const toggle = (name: string) => {
    if (mode === "conversation") return setPicked([name]);
    const current = picked ?? others;
    setPicked(
      current.some((entry) => sameName(entry, name))
        ? current.filter((entry) => !sameName(entry, name))
        : [...current, name],
    );
  };
  const what = mode === "roleplay" ? "roleplay" : "chat";

  return (
    <FanficSection
      title="Continue as a roleplay or chat"
      hint="Picks up after the chapter you choose, with the story so far in the new chat's summary. After the last chapter, the chat is linked to this fic so each knows what happens in the other; after an earlier one, it branches off and goes its own way. The fic stays as it is."
    >
      {chapters.length > 1 && (
        <FanficField
          label="Picks up after"
          htmlFor={`fanfic-continue-after-${chatId}`}
          hint={
            branching
              ? `Branches off: the chat only knows the story up to chapter ${after}, and isn't linked to the fic.`
              : undefined
          }
        >
          <select
            id={`fanfic-continue-after-${chatId}`}
            value={after}
            onChange={(event) => setAfterPick(event.target.value)}
            className="w-full rounded-lg border border-[var(--border)] bg-[var(--secondary)] px-2.5 py-2 text-[0.8125rem] text-[var(--foreground)]"
          >
            {chapters.map((label) => (
              <option key={label} value={label}>
                {`Chapter ${label}${label === last ? " (the last one)" : ""}`}
              </option>
            ))}
          </select>
        </FanficField>
      )}
      <FanficField label="Continue as">
        <FanficSegmented<FanficChatMode>
          label="Continue as"
          value={mode}
          onChange={setMode}
          options={[
            { value: "roleplay", label: "Roleplay", detail: "Scenes with narration" },
            { value: "conversation", label: "Chat", detail: "Texting one character" },
          ]}
        />
      </FanficField>

      <fieldset className="flex flex-col gap-1.5">
        <legend className="mb-1 text-[0.8125rem] font-semibold text-[var(--foreground)]">You play</legend>
        {[YOURSELF, ...cast].map((name) => (
          <label key={name} className="flex items-center gap-2 text-[0.8125rem] text-[var(--foreground)]">
            <input
              type="radio"
              name={`fanfic-play-as-${chatId}`}
              checked={playAs === name}
              onChange={() => {
                setPlayAs(name);
                setPicked(null);
              }}
            />
            {name === YOURSELF ? `Yourself (${ownName})` : name}
          </label>
        ))}
      </fieldset>

      <fieldset className="flex flex-col gap-1.5">
        <legend className="mb-1 text-[0.8125rem] font-semibold text-[var(--foreground)]">
          {mode === "conversation" ? "Who you text" : "The AI plays"}
        </legend>
        {others.length === 0 && (
          <p className="text-xs text-[var(--muted-foreground)]">
            The fic has no other characters. Add one to the request first.
          </p>
        )}
        {others.map((name) => (
          <label key={name} className="flex items-center gap-2 text-[0.8125rem] text-[var(--foreground)]">
            <input
              type={mode === "conversation" ? "radio" : "checkbox"}
              name={`fanfic-ai-plays-${chatId}`}
              checked={chosen.some((entry) => sameName(entry, name))}
              onChange={() => toggle(name)}
            />
            {name}
            {!hasCard(name) && (
              <span className="text-[0.6875rem] text-[var(--muted-foreground)]">(no card yet: one is written)</span>
            )}
          </label>
        ))}
      </fieldset>

      {(newCards.length > 0 || newPersona) && (
        <p className="text-xs leading-snug text-[var(--muted-foreground)]">
          Adds to your library:{" "}
          {[
            newCards.length > 0
              ? `${newCards.length === 1 ? "a character card" : "character cards"} for ${list(newCards)}`
              : "",
            newPersona ? `a persona for ${playAs}` : "",
          ]
            .filter(Boolean)
            .join(", and ")}
          , written from the fic.
        </p>
      )}

      <div className={cn("flex flex-wrap items-center gap-2")}>
        {toChat.running ? (
          <>
            <p className="text-[0.8125rem] text-[var(--foreground)]" role="status">
              <Loader2 size="0.85rem" className="mr-1 inline animate-spin" aria-hidden="true" />
              Reading the fic and setting up the {what}…
            </p>
            <FanficButton onClick={toChat.stop}>
              <Square size="0.8rem" aria-hidden="true" />
              Stop
            </FanficButton>
          </>
        ) : (
          <FanficButton
            tone="primary"
            disabled={busy || chosen.length === 0}
            onClick={() =>
              void toChat.start({
                mode,
                cast: chosen,
                playAs: playAs === YOURSELF ? { kind: "persona" } : { kind: "character", name: playAs },
                afterChapter: after || null,
              })
            }
          >
            <MessagesSquare size="0.85rem" aria-hidden="true" />
            Start the {what}
          </FanficButton>
        )}
      </div>
    </FanficSection>
  );
}
