import { useMemo, useState, type ReactNode } from "react";
import { Drama, Feather, Loader2, MessageCircle, MessagesSquare, Orbit, Square } from "lucide-react";

import { FANFIC_SOURCE_MODES } from "../../../../../engine/modes/fanfic/from-chat";
import { TRANCE_SOURCE_MODES } from "../../../../../engine/modes/trance/source";
import { canLinkCarriedChat, carryOnTarget } from "../../../../../engine/shared/carry-on";
import { Modal } from "../../../../../shared/components/ui/Modal";
import { useChatSurfaceCharacterSummariesByIds } from "../../../../catalog/characters/index";
import { useCarryChatOn } from "../hooks/use-carry-chat-on";
import { useStartFanficFromChat } from "../hooks/use-start-fanfic-from-chat";
import { useStartTranceFromChat } from "../hooks/use-start-trance-from-chat";

/** What the options need to know about the chat, roleplay or fic they start from. */
export interface MakeFromThisSource {
  id: string;
  mode: string;
  characterIds?: readonly string[] | null;
  /** Whether it is already linked to another chat (conversation ↔ roleplay). */
  linked?: boolean;
}

function Option({
  icon,
  title,
  detail,
  disabled,
  onClick,
  children,
}: {
  icon: ReactNode;
  title: string;
  detail: string;
  disabled?: boolean;
  onClick: () => void;
  children?: ReactNode;
}) {
  return (
    <div className="flex flex-col gap-2 rounded-xl border border-[var(--border)] bg-[var(--secondary)]/40 p-3">
      <button
        type="button"
        onClick={onClick}
        disabled={disabled}
        className="flex items-start gap-3 text-left disabled:cursor-not-allowed disabled:opacity-50"
      >
        <span className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-[var(--primary)]/15 text-[var(--primary)]">
          {icon}
        </span>
        <span className="min-w-0">
          <span className="block text-sm font-semibold text-[var(--foreground)]">{title}</span>
          <span className="block text-xs leading-snug text-[var(--muted-foreground)]">{detail}</span>
        </span>
      </button>
      {children}
    </div>
  );
}

function Working({ text, onStop }: { text: string; onStop: () => void }) {
  return (
    <div className="flex items-center gap-2 rounded-xl border border-[var(--border)] bg-[var(--secondary)]/40 p-3">
      <p className="flex-1 text-sm text-[var(--foreground)]" role="status">
        <Loader2 size="0.875rem" className="mr-1.5 inline animate-spin" aria-hidden="true" />
        {text}
        <span className="block text-xs text-[var(--muted-foreground)]">
          You can close this; it opens by itself when it&apos;s ready.
        </span>
      </p>
      <button
        type="button"
        onClick={onStop}
        className="flex items-center gap-1 rounded-lg bg-[var(--secondary)] px-3 py-2 text-xs font-medium ring-1 ring-[var(--border)] hover:bg-[var(--accent)]"
      >
        <Square size="0.75rem" aria-hidden="true" />
        Stop
      </button>
    </div>
  );
}

/**
 * Everything that can be made from a chat, roleplay or fic, in one list: a fic retelling it, a trance with one of its
 * characters, a roleplay or chat that carries it on in the other mode, and (for a fic) a roleplay or chat that carries
 * on from it. Nothing changes the source.
 */
export function MakeFromThisOptions({
  source,
  onContinueAsChat,
}: {
  source: MakeFromThisSource;
  /** A fic's own "carry on as a roleplay or chat" form; shown as an option when given. */
  onContinueAsChat?: () => void;
}) {
  const fic = useStartFanficFromChat();
  const trance = useStartTranceFromChat();
  const carry = useCarryChatOn();
  const ids = useMemo(() => (source.characterIds ?? []).filter((id) => id.trim()), [source.characterIds]);
  const { data: rows } = useChatSurfaceCharacterSummariesByIds(ids, ids.length > 0);
  const guides = useMemo(
    () =>
      ((rows ?? []) as Array<{ id: string; data?: { name?: string } }>).map((row) => ({
        id: row.id,
        name: row.data?.name?.trim() || "Unnamed",
      })),
    [rows],
  );
  const [picked, setPicked] = useState("");
  const whoId = picked && ids.includes(picked) ? picked : (ids[0] ?? "");
  const whoName = guides.find((guide) => guide.id === whoId)?.name;
  const carryTo = carryOnTarget(source.mode);
  const willLink = canLinkCarriedChat(source.mode, !!source.linked);
  const busy = !!fic.drafting || !!trance.drafting || !!carry.carrying;

  return (
    <div className="flex flex-col gap-2">
      {fic.drafting && (
        <Working
          text={fic.drafting === source.id ? "Reading this and drafting the fic's request…" : "Making a fic…"}
          onStop={fic.stop}
        />
      )}
      {trance.drafting && (
        <Working
          text={trance.drafting === source.id ? "Reading this and thinking up trance ideas…" : "Making a trance…"}
          onStop={trance.stop}
        />
      )}
      {carry.carrying && (
        <Working
          text={carry.carrying === source.id ? "Reading this and setting up where it picks up…" : "Carrying a chat on…"}
          onStop={carry.stop}
        />
      )}
      {FANFIC_SOURCE_MODES.has(source.mode) && (
        <Option
          icon={<Feather size="1.1rem" aria-hidden="true" />}
          title="A fic"
          detail="Retells this story as chapters. You check the request before anything is written, and the two stay linked."
          disabled={busy}
          onClick={() => void fic.start(source.id)}
        />
      )}
      {ids.length > 1 && guides.length > 1 && (TRANCE_SOURCE_MODES.has(source.mode) || carryTo === "conversation") && (
        <label className="flex items-center gap-2 px-1 text-xs text-[var(--muted-foreground)]">
          With
          <select
            value={whoId}
            onChange={(event) => setPicked(event.target.value)}
            className="min-w-0 flex-1 rounded-lg border border-[var(--border)] bg-[var(--secondary)] px-2 py-1.5 text-xs text-[var(--foreground)]"
          >
            {guides.map((guide) => (
              <option key={guide.id} value={guide.id}>
                {guide.name}
              </option>
            ))}
          </select>
        </label>
      )}
      {TRANCE_SOURCE_MODES.has(source.mode) && (
        <Option
          icon={<Orbit size="1.1rem" aria-hidden="true" />}
          title={whoName ? `A trance with ${whoName}` : "A trance"}
          detail={
            ids.length === 0
              ? "Add a character first: a trance needs someone to guide it."
              : "A hypnosis session built from what happened here. It opens on three ideas; nothing is written until you pick one."
          }
          disabled={busy || ids.length === 0}
          onClick={() => void trance.start(source.id, whoId)}
        />
      )}
      {carryTo && (
        <Option
          icon={
            carryTo === "roleplay" ? (
              <Drama size="1.1rem" aria-hidden="true" />
            ) : (
              <MessageCircle size="1.1rem" aria-hidden="true" />
            )
          }
          title={carryTo === "roleplay" ? "A roleplay" : whoName ? `A chat with ${whoName}` : "A chat"}
          detail={
            ids.length === 0
              ? "Add a character first: they carry it on."
              : `${carryTo === "roleplay" ? "Meet in person, in a scene that picks up from these texts" : "Texts that pick up after this roleplay"}, with the story so far in its memory.${willLink ? " The two stay linked, so each knows what happens in the other." : ""}`
          }
          disabled={busy || ids.length === 0}
          onClick={() => void carry.start(source.id, whoId)}
        />
      )}
      {onContinueAsChat && (
        <Option
          icon={<MessagesSquare size="1.1rem" aria-hidden="true" />}
          title="A roleplay or chat"
          detail="Carries the story on after the last chapter: you play your persona or one of its characters."
          disabled={busy}
          onClick={onContinueAsChat}
        />
      )}
    </div>
  );
}

/** The "Make from this" picker, opened from a chat's, roleplay's or fic's top bar. */
export function MakeFromThisDialog({
  open,
  onClose,
  source,
  onContinueAsChat,
}: {
  open: boolean;
  onClose: () => void;
  source: MakeFromThisSource;
  onContinueAsChat?: () => void;
}) {
  return (
    <Modal open={open} onClose={onClose} title="Make something from this">
      <MakeFromThisOptions
        source={source}
        onContinueAsChat={
          onContinueAsChat
            ? () => {
                onClose();
                onContinueAsChat();
              }
            : undefined
        }
      />
    </Modal>
  );
}
