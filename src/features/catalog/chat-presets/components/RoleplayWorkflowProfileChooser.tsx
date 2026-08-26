import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AlertTriangle, Check, ChevronDown, ExternalLink, Loader2, RotateCcw } from "lucide-react";

import type { Chat } from "../../../../engine/contracts/types/chat";
import {
  resolveRoleplayWorkflowProfile,
  type RoleplayWorkflowChangeRow,
  type RoleplayWorkflowProfileId,
  type RoleplayWorkflowProfileResolution,
} from "../../../../engine/modes/roleplay/workflow-profiles";
import { DISCOVERY_APP_EVENT, type DiscoveryChatDestination } from "../../../../shared/lib/discovery-navigation";
import { cn } from "../../../../shared/lib/utils";
import { useUIStore } from "../../../../shared/stores/ui.store";
import { useApplyRoleplayWorkflowProfile, useRevertRoleplayWorkflowProfile } from "../hooks/use-chat-presets";
import { isLocalSidecarAssignmentReady, resolveRoleplayWorkflowCapabilities } from "../roleplay-workflow-capabilities";

const PROFILES: ReadonlyArray<{
  id: RoleplayWorkflowProfileId;
  label: string;
  description: string;
}> = [
  {
    id: "minimal-clean",
    label: "Minimal / Clean",
    description: "Universal roleplay prompting and memory recall, with automatic agents kept out unless you opt in.",
  },
  {
    id: "longform-continuity",
    label: "Longform Continuity",
    description: "Adds continuity, world-state, and periodic summary support for longer-running stories.",
  },
  {
    id: "cinematic",
    label: "Cinematic",
    description: "Adds expression and background support. Illustrator and Music Player stay optional.",
  },
  {
    id: "local-assist",
    label: "Local Assist",
    description: "Routes selected helper agents to the local sidecar. Your writer connection remains unchanged.",
  },
] as const;

const ITEM_LABELS: Record<string, string> = {
  "prompt-preset": "Universal V2 prompt preset",
  "memory-recall": "Memory Recall",
  "disable-automatic-agents": "Keep automatic agents off",
  "enable-automatic-agents": "Enable automatic agents",
  "agent:continuity": "Continuity",
  "agent:world-state": "World State",
  "agent:chat-summary": "Chat Summary",
  "agent:expression": "Expression Engine",
  "agent:background": "Background",
  "agent:illustrator": "Illustrator",
  "agent:music-dj": "Music Player",
  "agent:character-tracker": "Character Tracker",
  "cadence:chat-summary": "Chat Summary cadence",
  "connection:world-state": "World State local route",
  "connection:expression": "Expression Engine local route",
  "connection:character-tracker": "Character Tracker local route",
  "prerequisite:music-module": "Music Player readiness",
  "information:tts-readiness": "Text-to-speech readiness",
};

type EntryPoint = "wizard" | "drawer";

export interface RoleplayWorkflowProfileChooserProps {
  chat: Chat;
  entryPoint: EntryPoint;
  onNavigateAway?: () => void;
}

function itemLabel(id: string): string {
  return ITEM_LABELS[id] ?? id.replace(/^(?:agent|cadence|connection):/, "").replaceAll("-", " ");
}

function displayValue(value: unknown, rowId: string): string {
  if (rowId === "prompt-preset" && value === "preset_universal_v2") return "Universal V2";
  if (value === undefined) return "Not set";
  if (value === null) return "None";
  if (typeof value === "boolean") return value ? "On" : "Off";
  if (typeof value === "string") return value === "sidecar:local" ? "Local sidecar" : value;
  if (Array.isArray(value)) return value.length > 0 ? value.map(String).map(itemLabel).join(", ") : "None";
  if (typeof value === "object") {
    const record = value as Record<string, unknown>;
    if ("enableAgents" in record || "activeAgentIds" in record) {
      const enabled = record.enableAgents === false ? "Off" : record.enableAgents === true ? "On" : "Not set";
      const agents = Array.isArray(record.activeAgentIds) ? record.activeAgentIds.map(String).map(itemLabel) : [];
      return agents.length > 0 ? `${enabled}; ${agents.join(", ")}` : enabled;
    }
    const entries = Object.entries(record);
    return entries.length > 0 ? entries.map(([key, next]) => `${itemLabel(key)}: ${String(next)}`).join(", ") : "None";
  }
  return String(value);
}

function defaultSelections(resolution: RoleplayWorkflowProfileResolution): Set<string> {
  return new Set(
    resolution.rows
      .filter((row) => row.kind === "change" && row.selectable && row.selectedByDefault)
      .map((row) => row.id),
  );
}

function emitChatDestination(destination: DiscoveryChatDestination): void {
  window.dispatchEvent(
    new CustomEvent(DISCOVERY_APP_EVENT, { detail: { type: "open-chat-destination", destination } }),
  );
}

function rowLinks(row: RoleplayWorkflowChangeRow): Array<{
  label: string;
  action: "chat" | "connections" | "settings";
  destination?: DiscoveryChatDestination | "image-settings" | "modules";
  tab?: "general" | "plugins";
}> {
  if (row.id === "prompt-preset") {
    return [{ label: "Prompt Preset", action: "chat", destination: "chat-settings-prompt-preset" }];
  }
  if (row.id === "memory-recall") {
    return [{ label: "Continuity", action: "chat", destination: "chat-settings-continuity" }];
  }
  if (row.id === "prerequisite:music-module" || row.id === "agent:music-dj") {
    return [{ label: "Modules", action: "settings", destination: "modules", tab: "plugins" }];
  }
  if (row.id === "information:tts-readiness") {
    return [{ label: "TTS settings", action: "connections" }];
  }
  if (row.id === "agent:illustrator" || row.id === "agent:background") {
    return [
      { label: "Connections", action: "connections" },
      { label: "Image settings", action: "settings", destination: "image-settings", tab: "general" },
    ];
  }
  if (/^(?:agent|cadence|connection):/.test(row.id) || row.id.includes("automatic-agents")) {
    return [{ label: "Agents", action: "chat", destination: "chat-settings-agents" }];
  }
  return [];
}

function completeError(error: unknown): string {
  if (error instanceof Error) return error.message;
  return typeof error === "string" ? error : JSON.stringify(error);
}

function stableWorkflowValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stableWorkflowValue);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, next]) => [key, stableWorkflowValue(next)]),
  );
}

function workflowRelevantChatValue(chat: Chat): unknown {
  const metadata = chat.metadata ?? {};
  return stableWorkflowValue({
    id: chat.id,
    mode: chat.mode,
    connectionId: chat.connectionId,
    promptPresetId: chat.promptPresetId,
    enableMemoryRecall: metadata.enableMemoryRecall,
    enableAgents: metadata.enableAgents,
    activeAgentIds: metadata.activeAgentIds ?? [],
    agentConnectionOverrides: metadata.agentConnectionOverrides ?? {},
    agentRunIntervalOverrides: metadata.agentRunIntervalOverrides ?? {},
    illustrationImageConnectionId: metadata.illustrationImageConnectionId,
    roleplayWorkflowApplication: metadata.roleplayWorkflowApplication,
  });
}

function sameWorkflowRelevantChat(left: Chat, right: Chat): boolean {
  return JSON.stringify(workflowRelevantChatValue(left)) === JSON.stringify(workflowRelevantChatValue(right));
}

export function RoleplayWorkflowProfileChooser({
  chat,
  entryPoint,
  onNavigateAway,
}: RoleplayWorkflowProfileChooserProps) {
  const [profileId, setProfileId] = useState<RoleplayWorkflowProfileId>("minimal-clean");
  const [preview, setPreview] = useState<RoleplayWorkflowProfileResolution | null>(null);
  const [selectedItemIds, setSelectedItemIds] = useState<Set<string>>(new Set());
  const [displayedChat, setDisplayedChat] = useState(chat);
  const [capabilityError, setCapabilityError] = useState<string | null>(null);
  const [loadingCapabilities, setLoadingCapabilities] = useState(true);
  const [confirming, setConfirming] = useState(false);
  const [status, setStatus] = useState<{ tone: "info" | "success" | "error"; message: string } | null>(null);
  const [reloadKey, setReloadKey] = useState(0);
  const displayedChatRef = useRef(chat);

  const applyMutation = useApplyRoleplayWorkflowProfile({
    resolveCapabilities: resolveRoleplayWorkflowCapabilities,
    isLocalSidecarAssignmentReady,
  });
  const revertMutation = useRevertRoleplayWorkflowProfile();

  useEffect(() => {
    if (sameWorkflowRelevantChat(displayedChatRef.current, chat)) return;
    displayedChatRef.current = chat;
    setConfirming(false);
    setStatus({
      tone: "info",
      message: "Chat settings changed. Review the refreshed ledger before applying.",
    });
    setDisplayedChat(chat);
  }, [chat]);

  useEffect(() => {
    let cancelled = false;
    setLoadingCapabilities(true);
    setCapabilityError(null);
    resolveRoleplayWorkflowCapabilities(displayedChat)
      .then((capabilities) => {
        if (cancelled) return;
        const next = resolveRoleplayWorkflowProfile(profileId, { chat: displayedChat, capabilities });
        setPreview(next);
        setSelectedItemIds(defaultSelections(next));
      })
      .catch((error) => {
        if (!cancelled) setCapabilityError(completeError(error));
      })
      .finally(() => {
        if (!cancelled) setLoadingCapabilities(false);
      });
    return () => {
      cancelled = true;
    };
    // Profile changes are resolved deliberately in selectProfile so user toggles survive ordinary renders.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [displayedChat, reloadKey]);

  const selectProfile = useCallback(
    async (nextProfileId: RoleplayWorkflowProfileId) => {
      setProfileId(nextProfileId);
      setConfirming(false);
      setStatus(null);
      setLoadingCapabilities(true);
      try {
        const capabilities = await resolveRoleplayWorkflowCapabilities(displayedChat);
        const next = resolveRoleplayWorkflowProfile(nextProfileId, { chat: displayedChat, capabilities });
        setPreview(next);
        setSelectedItemIds(defaultSelections(next));
        setCapabilityError(null);
      } catch (error) {
        setCapabilityError(completeError(error));
      } finally {
        setLoadingCapabilities(false);
      }
    },
    [displayedChat],
  );

  const toggleItem = useCallback(
    (row: RoleplayWorkflowChangeRow) => {
      if (row.kind !== "change" || !row.selectable) return;
      setConfirming(false);
      setStatus(null);
      setSelectedItemIds((current) => {
        const next = new Set(current);
        const removing = next.has(row.id);
        if (removing) next.delete(row.id);
        else next.add(row.id);

        if (profileId === "local-assist" && preview) {
          const rowMatch = /^(agent|connection):(.+)$/.exec(row.id);
          if (rowMatch) {
            const [, kind, agentId] = rowMatch;
            const agentItemId = `agent:${agentId}`;
            const connectionItemId = `connection:${agentId}`;
            const alreadyActive = preview.baseline.metadata.activeAgentIds?.includes(agentId) === true;
            const alreadyRouted = preview.baseline.metadata.agentConnectionOverrides?.[agentId] === "sidecar:local";
            if (kind === "agent") {
              if (removing && !alreadyActive) next.delete(connectionItemId);
              if (!removing && !alreadyRouted) next.add(connectionItemId);
            } else {
              if (removing && !alreadyRouted) next.delete(agentItemId);
              if (!removing && !alreadyActive) next.add(agentItemId);
            }
          }
        }
        return next;
      });
    },
    [preview, profileId],
  );

  const navigate = useCallback(
    (link: ReturnType<typeof rowLinks>[number]) => {
      if (link.action === "chat" && link.destination) {
        emitChatDestination(link.destination as DiscoveryChatDestination);
      } else {
        const ui = useUIStore.getState();
        if (link.action === "connections") ui.openRightPanel("connections");
        else {
          ui.openRightPanel("settings");
          ui.setSettingsTab(link.tab ?? "general");
          ui.setPendingSettingsDestination((link.destination as string | undefined) ?? null);
        }
      }
      onNavigateAway?.();
    },
    [onNavigateAway],
  );

  const apply = useCallback(async () => {
    if (!preview) return;
    setStatus(null);
    try {
      const result = await applyMutation.mutateAsync({
        chatId: displayedChat.id,
        profileId,
        preview,
        selectedItemIds: [...selectedItemIds],
      });
      if (result.outcome === "stale") {
        setPreview(result.resolution);
        setSelectedItemIds(defaultSelections(result.resolution));
        setConfirming(false);
        setStatus({
          tone: "info",
          message: "Settings changed since this preview. Review the refreshed ledger and confirm again.",
        });
        return;
      }
      displayedChatRef.current = result.chat;
      setDisplayedChat(result.chat);
      setConfirming(false);
      const skippedRoutingMessage =
        result.skippedLocalRoutingAgentIds.length > 0
          ? `Local routing was skipped for ${result.skippedLocalRoutingAgentIds.map((id) => itemLabel(`agent:${id}`)).join(", ")}. ${result.skippedLocalRoutingAgentIds.length === 1 ? "It remains" : "They remain"} active on ${result.skippedLocalRoutingAgentIds.length === 1 ? "its" : "their"} existing connection; this profile chose no substitute or fallback.`
          : "";
      const omittedAgentMessage =
        result.omittedLocalAgentIds.length > 0
          ? `Applied without ${result.omittedLocalAgentIds.map((id) => itemLabel(`agent:${id}`)).join(", ")}. Their local sidecar assignments were not ready, and no external fallback was used.`
          : "";
      if (skippedRoutingMessage || omittedAgentMessage) {
        setStatus({
          tone: "info",
          message: [skippedRoutingMessage, omittedAgentMessage].filter(Boolean).join(" "),
        });
      } else {
        setStatus({
          tone: "success",
          message: `${PROFILES.find((profile) => profile.id === profileId)?.label} applied.`,
        });
      }
    } catch (error) {
      setConfirming(false);
      setStatus({ tone: "error", message: completeError(error) });
    }
  }, [applyMutation, displayedChat.id, preview, profileId, selectedItemIds]);

  const revert = useCallback(async () => {
    setStatus(null);
    try {
      const result = await revertMutation.mutateAsync(displayedChat.id);
      if (result.outcome === "not_applied") {
        displayedChatRef.current = result.chat;
        setDisplayedChat(result.chat);
        setStatus({
          tone: "info",
          message: "No workflow profile is currently applied. Current chat state was refreshed.",
        });
        setReloadKey((key) => key + 1);
        return;
      }
      displayedChatRef.current = result.chat;
      setDisplayedChat(result.chat);
      setReloadKey((key) => key + 1);
      setStatus({
        tone: result.skippedConflicts.length > 0 ? "info" : "success",
        message:
          result.skippedConflicts.length > 0
            ? `Reverted the unchanged parts. Kept your later edits to ${result.skippedConflicts.map(itemLabel).join(", ")}.`
            : "Workflow profile reverted.",
      });
    } catch (error) {
      setStatus({ tone: "error", message: completeError(error) });
    }
  }, [displayedChat.id, revertMutation]);

  const selectedRows = useMemo(
    () => preview?.rows.filter((row) => row.kind === "change" && selectedItemIds.has(row.id)) ?? [],
    [preview, selectedItemIds],
  );
  const receipt = displayedChat.metadata?.roleplayWorkflowApplication;
  const pending = applyMutation.isPending || revertMutation.isPending;

  return (
    <section
      className="@container flex min-h-0 flex-col gap-3"
      aria-label="Roleplay workflow profile chooser"
      data-entry-point={entryPoint}
    >
      {loadingCapabilities && !preview ? (
        <div className="flex min-h-24 items-center justify-center gap-2 text-xs text-[var(--muted-foreground)]">
          <Loader2 size="0.875rem" className="animate-spin" />
          Checking workflow readiness
        </div>
      ) : capabilityError ? (
        <div
          role="alert"
          className="rounded-lg bg-[var(--destructive)]/10 p-3 text-xs text-[var(--destructive)] ring-1 ring-[var(--destructive)]/25"
        >
          <p className="break-words">{capabilityError}</p>
          <button
            type="button"
            onClick={() => setReloadKey((key) => key + 1)}
            className="mt-2 font-semibold underline underline-offset-2"
          >
            Try again
          </button>
        </div>
      ) : (
        <>
          <div
            className="grid min-h-0 gap-3 @[36rem]:grid-cols-[minmax(9.5rem,0.72fr)_minmax(0,1.28fr)]"
            data-layout="workflow-profile-grid"
          >
            <div
              className="order-1 space-y-1.5"
              data-region="profile-list"
              role="radiogroup"
              aria-label="Workflow profiles"
            >
              {PROFILES.map((profile) => {
                const selected = profile.id === profileId;
                return (
                  <button
                    key={profile.id}
                    type="button"
                    role="radio"
                    aria-checked={selected}
                    aria-label={`Choose ${profile.label}`}
                    onClick={() => void selectProfile(profile.id)}
                    className={cn(
                      "w-full rounded-lg px-3 py-2.5 text-left ring-1 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--primary)]",
                      selected
                        ? "bg-[var(--primary)]/12 text-[var(--foreground)] ring-[var(--primary)]/45"
                        : "bg-[var(--secondary)]/55 text-[var(--muted-foreground)] ring-[var(--border)] hover:bg-[var(--accent)]",
                    )}
                  >
                    <span className="flex items-center gap-2 text-xs font-semibold">
                      <span
                        className={cn(
                          "flex h-4 w-4 items-center justify-center rounded-full border",
                          selected && "border-[var(--primary)] bg-[var(--primary)] text-[var(--primary-foreground)]",
                        )}
                      >
                        {selected && <Check size="0.625rem" />}
                      </span>
                      {profile.label}
                    </span>
                    <span className="mt-1 block text-[0.625rem] leading-relaxed">{profile.description}</span>
                  </button>
                );
              })}
            </div>

            <div className="order-2 min-w-0 space-y-2" data-region="change-ledger">
              <div className="flex items-center justify-between gap-2">
                <h4 className="text-xs font-semibold text-[var(--foreground)]">Change ledger</h4>
                <span className="text-[0.625rem] text-[var(--muted-foreground)]">
                  {selectedRows.reduce((sum, row) => sum + row.expectedExtraCalls, 0)} expected extra calls
                </span>
              </div>
              <div
                className="max-h-[min(52dvh,30rem)] space-y-1.5 overflow-y-auto overscroll-contain pr-0.5"
                data-mobile-order="profiles-then-ledger"
              >
                {preview?.rows.map((row) => {
                  const selected = selectedItemIds.has(row.id);
                  const links = rowLinks(row);
                  return (
                    <div key={row.id} className="rounded-lg bg-[var(--secondary)]/45 p-2.5 ring-1 ring-[var(--border)]">
                      <div className="flex items-start gap-2">
                        {row.kind === "change" ? (
                          <input
                            type="checkbox"
                            aria-label={itemLabel(row.id)}
                            checked={selected}
                            disabled={!row.selectable || pending}
                            onChange={() => toggleItem(row)}
                            className="mt-0.5 h-4 w-4 shrink-0 accent-[var(--primary)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--primary)]"
                          />
                        ) : (
                          <AlertTriangle
                            size="0.875rem"
                            className="mt-0.5 shrink-0 text-[var(--muted-foreground)]"
                            aria-hidden="true"
                          />
                        )}
                        <div className="min-w-0 flex-1">
                          <div className="flex flex-wrap items-center justify-between gap-1">
                            <span className="text-[0.6875rem] font-semibold text-[var(--foreground)]">
                              {itemLabel(row.id)}
                            </span>
                            {row.kind === "change" && !row.selectable && (
                              <span className="rounded-full bg-[var(--muted)] px-1.5 py-0.5 text-[0.5625rem] font-semibold text-[var(--muted-foreground)]">
                                Unavailable
                              </span>
                            )}
                          </div>
                          {row.kind === "change" && (
                            <dl className="mt-1 grid grid-cols-[auto_minmax(0,1fr)] gap-x-2 gap-y-0.5 text-[0.625rem] leading-relaxed">
                              <dt className="text-[var(--muted-foreground)]">Before</dt>
                              <dd className="break-words text-[var(--foreground)]">
                                {displayValue(row.before, row.id)}
                              </dd>
                              <dt className="text-[var(--muted-foreground)]">After</dt>
                              <dd className="break-words text-[var(--foreground)]">
                                {displayValue(row.after, row.id)}
                              </dd>
                              <dt className="text-[var(--muted-foreground)]">Calls</dt>
                              <dd>
                                {row.expectedExtraCalls === 0
                                  ? "No extra model call"
                                  : `+${row.expectedExtraCalls} model call per run`}
                              </dd>
                              <dt className="text-[var(--muted-foreground)]">Latency</dt>
                              <dd>
                                {row.expectedExtraCalls === 0
                                  ? "No added model latency"
                                  : "May add response latency when it runs"}
                              </dd>
                              <dt className="text-[var(--muted-foreground)]">Destination</dt>
                              <dd className="break-words">{row.destination ?? "No external data destination"}</dd>
                            </dl>
                          )}
                          {[...row.prerequisites, ...row.warnings].map((message) => (
                            <p
                              key={message}
                              className="mt-1 break-words text-[0.625rem] leading-relaxed text-amber-500 dark:text-amber-300"
                            >
                              {message}
                            </p>
                          ))}
                          {links.length > 0 && (
                            <div className="mt-1.5 flex flex-wrap gap-x-3 gap-y-1">
                              {links.map((link) => (
                                <button
                                  key={link.label}
                                  type="button"
                                  onClick={() => navigate(link)}
                                  className="inline-flex min-h-7 items-center gap-1 text-[0.625rem] font-semibold text-[var(--primary)] underline-offset-2 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--primary)]"
                                >
                                  {link.label}
                                  <ExternalLink size="0.625rem" />
                                </button>
                              ))}
                            </div>
                          )}
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>

          {receipt && (
            <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg bg-[var(--primary)]/8 px-3 py-2 ring-1 ring-[var(--primary)]/25">
              <p className="text-[0.625rem] leading-relaxed text-[var(--foreground)]">
                Applied {PROFILES.find((profile) => profile.id === receipt.profileId)?.label ?? receipt.profileId},
                version {receipt.profileVersion}, {new Date(receipt.appliedAt).toLocaleString()}.
              </p>
              <button
                type="button"
                onClick={() => void revert()}
                disabled={pending}
                className="inline-flex min-h-8 items-center gap-1.5 rounded-md bg-[var(--secondary)] px-2.5 py-1 text-[0.6875rem] font-semibold text-[var(--foreground)] ring-1 ring-[var(--border)] hover:bg-[var(--accent)] disabled:opacity-50"
              >
                <RotateCcw size="0.75rem" />
                Revert
              </button>
            </div>
          )}

          {status && (
            <div
              role={status.tone === "error" ? "alert" : "status"}
              className={cn(
                "break-words rounded-lg px-3 py-2 text-[0.6875rem] ring-1",
                status.tone === "error"
                  ? "bg-[var(--destructive)]/10 text-[var(--destructive)] ring-[var(--destructive)]/25"
                  : status.tone === "success"
                    ? "bg-emerald-500/10 text-emerald-700 ring-emerald-500/25 dark:text-emerald-300"
                    : "bg-[var(--accent)]/60 text-[var(--foreground)] ring-[var(--border)]",
              )}
            >
              {status.message}
            </div>
          )}

          <div className="flex flex-wrap items-center justify-end gap-2 border-t border-[var(--border)] pt-3">
            {confirming ? (
              <>
                <p className="mr-auto max-w-[42ch] text-[0.625rem] leading-relaxed text-[var(--muted-foreground)]">
                  Confirm the {selectedItemIds.size} checked changes in the ledger above. Unchecked and informational
                  rows will not be written.
                </p>
                <button
                  type="button"
                  onClick={() => setConfirming(false)}
                  disabled={pending}
                  className="min-h-9 rounded-md px-3 text-xs text-[var(--muted-foreground)] hover:bg-[var(--accent)] disabled:opacity-50"
                >
                  Review again
                </button>
                <button
                  type="button"
                  onClick={() => void apply()}
                  disabled={pending}
                  className="inline-flex min-h-9 items-center gap-1.5 rounded-md bg-[var(--primary)] px-3 text-xs font-semibold text-[var(--primary-foreground)] disabled:opacity-50"
                >
                  {pending && <Loader2 size="0.75rem" className="animate-spin" />}
                  Confirm and apply
                </button>
              </>
            ) : (
              <button
                type="button"
                onClick={() => setConfirming(true)}
                disabled={!preview || selectedItemIds.size === 0 || pending}
                className="inline-flex min-h-9 items-center gap-1.5 rounded-md bg-[var(--primary)] px-3 text-xs font-semibold text-[var(--primary-foreground)] shadow-sm hover:opacity-90 disabled:opacity-50"
              >
                Review and apply
                <ChevronDown size="0.75rem" />
              </button>
            )}
          </div>
        </>
      )}
    </section>
  );
}
