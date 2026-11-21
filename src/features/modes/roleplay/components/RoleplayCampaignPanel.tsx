import { useMemo, useState } from "react";
import { CircleCheck, CircleDot, Circle, EyeOff, Loader2 } from "lucide-react";
import { toast } from "sonner";

import type { CampaignProgress, RoleplayCampaignState } from "../../../../engine/contracts/types/roleplay-campaign";
import {
  campaignWithStatus,
  CAMPAIGN_METADATA_KEY,
  currentProgress,
  readCampaign,
} from "../../../../engine/modes/roleplay/campaign/campaign-state";
import type { JsonRecord } from "../../../../engine/generation/runtime-records";
import { Modal } from "../../../../shared/components/ui/Modal";
import { toUserMessage } from "../../../../shared/lib/error-message";
import { cn } from "../../../../shared/lib/utils";
import { useUpdateChatMetadata } from "../../../catalog/chats/index";

const STATUS_TEXT: Record<RoleplayCampaignState["status"], string> = {
  playing: "Playing. The game master's notes update after each reply.",
  ended: "This campaign has ended. You can keep playing on as an ordinary roleplay.",
  off: "Switched off. The chat plays on as an ordinary roleplay; switch it back on any time.",
};

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="flex flex-col gap-1.5">
      <h3 className="text-xs font-semibold uppercase tracking-wide text-[var(--muted-foreground)]">{title}</h3>
      {children}
    </section>
  );
}

/** The whole plan, spoilers and all, with where the story stands. */
function BehindTheScreen({ state, progress }: { state: RoleplayCampaignState; progress: CampaignProgress }) {
  const { plan } = state;
  const played = new Map(progress.outcomes.map((outcome) => [outcome.situationId, outcome.text]));
  const revealed = new Set(progress.revealedClueIds);
  const ending = plan.endings.find((candidate) => candidate.id === progress.endingId);
  return (
    <div className="flex flex-col gap-4 text-xs leading-5 text-[var(--foreground)]">
      <Section title="What's really going on">
        <p>{plan.truth}</p>
        <ul className="flex flex-col gap-1">
          {plan.keyTruths.map((truth) => {
            const found = plan.clues.filter((clue) => clue.truthId === truth.id && revealed.has(clue.id)).length;
            const total = plan.clues.filter((clue) => clue.truthId === truth.id).length;
            return (
              <li key={truth.id}>
                {truth.text}{" "}
                <span className="text-[var(--muted-foreground)]">
                  ({found} of {total} clues found)
                </span>
              </li>
            );
          })}
        </ul>
      </Section>
      <Section title="Cast">
        <ul className="flex flex-col gap-2">
          {plan.cast.map((member) => (
            <li key={member.id}>
              <span className="font-semibold">{member.name}</span>, {member.role}
              <span className="block">Wants: {member.want}</span>
              <span className="block">Fears: {member.fear}</span>
              <span className="block">Secret: {member.secret}</span>
              {progress.stances[member.id] && (
                <span className="block text-[var(--muted-foreground)]">Now: {progress.stances[member.id]}</span>
              )}
            </li>
          ))}
        </ul>
      </Section>
      <Section title="The road">
        <ol className="flex flex-col gap-1.5">
          {plan.situations.map((situation) => {
            const outcome = played.get(situation.id);
            const now = situation.id === progress.situationId && !progress.endingId;
            const Icon = outcome ? CircleCheck : now ? CircleDot : Circle;
            return (
              <li key={situation.id} className="flex gap-2">
                <Icon
                  size="0.9rem"
                  aria-hidden="true"
                  className={cn(
                    "mt-0.5 shrink-0",
                    now || outcome ? "text-[var(--primary)]" : "text-[var(--muted-foreground)]",
                  )}
                />
                <span>
                  <span className="font-semibold">{situation.title}</span>
                  {now && <span className="text-[var(--primary)]"> (now)</span>}
                  {outcome ? (
                    <span className="block text-[var(--muted-foreground)]">{outcome}</span>
                  ) : (
                    <span className="block text-[var(--muted-foreground)]">{situation.question}</span>
                  )}
                </span>
              </li>
            );
          })}
        </ol>
      </Section>
      {(progress.facts.length > 0 || progress.debts.length > 0) && (
        <Section title="What's changed, and what's owed">
          <ul className="flex list-disc flex-col gap-1 pl-4">
            {progress.facts.map((fact) => (
              <li key={fact}>{fact}</li>
            ))}
            {progress.debts.map((debt) => (
              <li key={debt.id}>Owed: {debt.text}</li>
            ))}
          </ul>
        </Section>
      )}
      <Section title="Possible endings">
        <ul className="flex list-disc flex-col gap-1 pl-4">
          {plan.endings.map((candidate) => (
            <li key={candidate.id} className={cn(candidate.id === ending?.id && "font-semibold")}>
              {candidate.condition} ({candidate.tone}){candidate.id === ending?.id && " ← reached"}
            </li>
          ))}
        </ul>
      </Section>
      <Section title="Table rules">
        <p>{plan.tableRules}</p>
      </Section>
    </div>
  );
}

/**
 * A campaign chat's panel: its name, the teaser unless the player went in blind, whether it's running, and the whole
 * plan behind a spoiler warning, so the player is never locked out of their own campaign.
 */
export function RoleplayCampaignPanel({
  chatId,
  metadata,
  messages,
  open,
  onClose,
}: {
  chatId: string;
  metadata: Record<string, unknown>;
  messages: readonly JsonRecord[];
  open: boolean;
  onClose: () => void;
}) {
  const state = useMemo(() => readCampaign(metadata), [metadata]);
  const progress = useMemo(() => (state ? currentProgress(state, messages) : null), [state, messages]);
  const [showTeaser, setShowTeaser] = useState(false);
  const [confirmSpoilers, setConfirmSpoilers] = useState(false);
  const [spoilersShown, setSpoilersShown] = useState(false);
  const updateMetadata = useUpdateChatMetadata();

  if (!state || !progress) {
    return (
      <Modal open={open} onClose={onClose} title="Campaign">
        <p className="text-xs text-[var(--muted-foreground)]">
          This chat's campaign couldn't be read, so it plays as an ordinary roleplay.
        </p>
      </Modal>
    );
  }

  const switchTo = (status: "playing" | "off") => {
    updateMetadata.mutate(
      { id: chatId, [CAMPAIGN_METADATA_KEY]: campaignWithStatus(state, status, new Date().toISOString()) },
      {
        onError: (error) => toast.error(toUserMessage(error, { fallback: "Couldn't change the campaign. Try again." })),
      },
    );
  };

  const teaserVisible = !state.request.blind || showTeaser;
  const ending = state.plan.endings.find((candidate) => candidate.id === progress.endingId);

  return (
    <Modal open={open} onClose={onClose} title={state.plan.title} width="max-w-lg">
      <div className="flex flex-col gap-4">
        {teaserVisible ? (
          <p className="text-sm leading-6 text-[var(--foreground)]">{state.plan.pitch}</p>
        ) : (
          <button
            type="button"
            onClick={() => setShowTeaser(true)}
            className="flex items-center gap-1.5 self-start rounded-lg px-2 py-1 text-xs text-[var(--muted-foreground)] hover:bg-[var(--accent)]"
          >
            <EyeOff size="0.85rem" aria-hidden="true" />
            You went in blind. Show the teaser
          </button>
        )}
        <p className="text-xs text-[var(--muted-foreground)]">{STATUS_TEXT[state.status]}</p>
        {state.status === "ended" && ending && (
          <p className="text-xs text-[var(--foreground)]">Your ending: {ending.tone}.</p>
        )}

        <div className="flex flex-wrap gap-2">
          {state.status !== "ended" && (
            <button
              type="button"
              disabled={updateMetadata.isPending}
              onClick={() => switchTo(state.status === "playing" ? "off" : "playing")}
              className="flex items-center gap-1.5 rounded-lg px-3 py-2 text-xs font-medium ring-1 ring-[var(--border)] hover:bg-[var(--accent)] disabled:opacity-50"
            >
              {updateMetadata.isPending && <Loader2 size="0.8rem" aria-hidden="true" className="animate-spin" />}
              {state.status === "playing" ? "Switch the campaign off" : "Switch the campaign back on"}
            </button>
          )}
          {!spoilersShown && (
            <button
              type="button"
              onClick={() => setConfirmSpoilers(true)}
              className="rounded-lg px-3 py-2 text-xs font-medium ring-1 ring-[var(--border)] hover:bg-[var(--accent)]"
            >
              Behind the screen
            </button>
          )}
        </div>

        {confirmSpoilers && !spoilersShown && (
          <div role="alert" className="flex flex-col gap-2 rounded-lg bg-amber-500/10 p-3 ring-1 ring-amber-500/30">
            <p className="text-xs text-[var(--foreground)]">
              This shows the whole plan: the secrets, what's coming and how it can end. It can't be unseen.
            </p>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => setSpoilersShown(true)}
                className="rounded-lg bg-amber-500/20 px-3 py-1.5 text-xs font-semibold hover:bg-amber-500/30"
              >
                Show me everything
              </button>
              <button
                type="button"
                onClick={() => setConfirmSpoilers(false)}
                className="rounded-lg px-3 py-1.5 text-xs hover:bg-[var(--accent)]"
              >
                Keep it a mystery
              </button>
            </div>
          </div>
        )}

        {spoilersShown && <BehindTheScreen state={state} progress={progress} />}
      </div>
    </Modal>
  );
}
