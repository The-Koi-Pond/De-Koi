import { Check, UserRound } from "lucide-react";
import { PersonaAvatarImage, usePersonaSummaries, type PersonaSummary } from "../../../../../catalog/personas/index";
import { cn } from "../../../../../../shared/lib/utils";
import { flagIsSet } from "./setup-chat";
import { SETUP_ROW_CLASS } from "./setup-styles";

function personaName(persona: PersonaSummary): string {
  return persona.name?.trim() || "Unnamed persona";
}

/**
 * Who the user speaks as. A chat without a persona speaks as the active one, so that one shows as picked; staying
 * anonymous is only possible when no persona is active.
 */
export function SetupPersonaPicker({
  personaId,
  labelledBy,
  onPick,
}: {
  personaId: string | null;
  labelledBy?: string;
  onPick: (personaId: string | null) => void;
}) {
  const { data, isLoading } = usePersonaSummaries();
  const personas = data ?? [];
  const activePersona = personas.find((persona) => flagIsSet(persona.isActive, persona.active)) ?? null;
  const shownId = personaId ?? activePersona?.id ?? null;

  if (isLoading) return <p className="text-xs text-[var(--muted-foreground)]">Loading personas…</p>;
  if (personas.length === 0) return <p className="text-xs text-[var(--muted-foreground)]">No personas created yet.</p>;

  return (
    <ul aria-labelledby={labelledBy} className="flex max-h-56 flex-col gap-0.5 overflow-y-auto">
      {!activePersona && (
        <li>
          <PersonaChoice name="None" detail="Stay anonymous" picked={shownId === null} onPick={() => onPick(null)} />
        </li>
      )}
      {personas.map((persona) => {
        const isActive = persona.id === activePersona?.id;
        const detail = [persona.comment?.trim(), isActive ? "Your default persona" : null].filter(Boolean).join(" · ");
        return (
          <li key={persona.id}>
            <PersonaChoice
              name={personaName(persona)}
              detail={detail}
              picked={shownId === persona.id}
              persona={persona}
              onPick={() => onPick(persona.id)}
            />
          </li>
        );
      })}
    </ul>
  );
}

function PersonaChoice({
  name,
  detail,
  picked,
  persona,
  onPick,
}: {
  name: string;
  detail: string;
  picked: boolean;
  persona?: PersonaSummary;
  onPick: () => void;
}) {
  return (
    <button
      type="button"
      aria-pressed={picked}
      onClick={onPick}
      className={cn(SETUP_ROW_CLASS, picked && "bg-[var(--accent)] ring-1 ring-[var(--primary)]")}
    >
      <span className="flex h-8 w-8 shrink-0 items-center justify-center overflow-hidden rounded-full bg-[var(--secondary)] text-xs font-semibold text-[var(--muted-foreground)]">
        {persona?.avatarPath || persona?.avatarFilePath || persona?.avatarFilename ? (
          <PersonaAvatarImage persona={persona} alt="" className="h-full w-full object-cover" thumbnailSize={64} />
        ) : persona ? (
          name.charAt(0).toUpperCase()
        ) : (
          <UserRound size="0.9rem" aria-hidden="true" />
        )}
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-xs font-medium text-[var(--foreground)]">{name}</span>
        {detail && <span className="block truncate text-[0.6875rem] text-[var(--muted-foreground)]">{detail}</span>}
      </span>
      {picked && <Check size="0.85rem" className="shrink-0 text-[var(--primary)]" aria-hidden="true" />}
    </button>
  );
}
