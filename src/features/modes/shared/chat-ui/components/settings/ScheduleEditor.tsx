import { ChevronRight, Plus, SlidersHorizontal, Trash2 } from "lucide-react";
import { useCallback, useEffect, useState, type ReactNode } from "react";
import { cn } from "../../../../../../shared/lib/utils";
import { normalizeScheduleBlocks, type ScheduleBlock } from "../../lib/chat-settings-metadata";
import {
  availabilityKeyForStatus,
  availabilityLabelForKey,
  summarizeCharacterAvailability,
  type AvailabilityKey,
} from "../../lib/schedule-availability-summary";

const SCHEDULE_DAYS = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"] as const;
const STATUS_OPTIONS = ["online", "idle", "dnd", "offline"] as const;


export function SelfiePromptControls({
  promptTemplate,
  positivePrompt,
  negativePrompt,
  onCommitPromptTemplate,
  onCommitPositivePrompt,
  onCommitNegativePrompt,
}: {
  promptTemplate: string | null | undefined;
  positivePrompt: string | undefined;
  negativePrompt: string;
  onCommitPromptTemplate: (value: string | null) => void;
  onCommitPositivePrompt: (value: string) => void;
  onCommitNegativePrompt: (value: string) => void;
}) {
  const displayPositivePrompt = positivePrompt ?? "";
  const displayPromptTemplate = promptTemplate ?? "";
  const [promptDraft, setPromptDraft] = useState(displayPromptTemplate);
  const [positiveDraft, setPositiveDraft] = useState(displayPositivePrompt);
  const [negativeDraft, setNegativeDraft] = useState(negativePrompt);

  useEffect(() => {
    setPromptDraft(displayPromptTemplate);
  }, [displayPromptTemplate]);

  useEffect(() => {
    setPositiveDraft(displayPositivePrompt);
  }, [displayPositivePrompt]);

  useEffect(() => {
    setNegativeDraft(negativePrompt);
  }, [negativePrompt]);

  const commitPromptTemplate = useCallback(() => {
    const nextValue = promptDraft.trim().length > 0 ? promptDraft : null;
    if ((nextValue ?? "") !== displayPromptTemplate) onCommitPromptTemplate(nextValue);
  }, [displayPromptTemplate, onCommitPromptTemplate, promptDraft]);

  const commitPositivePrompt = useCallback(() => {
    if (positiveDraft !== displayPositivePrompt) onCommitPositivePrompt(positiveDraft);
  }, [displayPositivePrompt, onCommitPositivePrompt, positiveDraft]);

  const commitNegativePrompt = useCallback(() => {
    if (negativeDraft !== negativePrompt) onCommitNegativePrompt(negativeDraft);
  }, [negativeDraft, negativePrompt, onCommitNegativePrompt]);

  return (
    <div className="mt-2 space-y-2">
      <label className="flex flex-col gap-1">
        <span className="text-[0.6875rem] font-medium text-[var(--muted-foreground)]">Selfie prompt</span>
        <textarea
          value={promptDraft}
          onChange={(e) => setPromptDraft(e.target.value)}
          onBlur={commitPromptTemplate}
          placeholder={`You are an image prompt generator. Create a concise selfie prompt for ${"${charName}"} using this appearance: ${"${appearance}"}.\nOutput ONLY the prompt text, nothing else.`}
          className="min-h-[7rem] resize-y rounded-lg border border-[var(--border)] bg-[var(--secondary)] p-2 text-[0.6875rem] text-[var(--foreground)] outline-none transition-colors placeholder:text-[var(--muted-foreground)]/45 focus:border-[var(--primary)]/50"
        />
      </label>
      <label className="flex flex-col gap-1">
        <span className="text-[0.6875rem] font-medium text-[var(--muted-foreground)]">Positive tags</span>
        <textarea
          value={positiveDraft}
          onChange={(e) => setPositiveDraft(e.target.value)}
          onBlur={commitPositivePrompt}
          placeholder="masterpiece, best quality, detailed eyes"
          className="min-h-[4rem] resize-y rounded-lg border border-[var(--border)] bg-[var(--secondary)] p-2 text-[0.6875rem] text-[var(--foreground)] outline-none transition-colors placeholder:text-[var(--muted-foreground)]/45 focus:border-[var(--primary)]/50"
        />
      </label>
      <label className="flex flex-col gap-1">
        <span className="text-[0.6875rem] font-medium text-[var(--muted-foreground)]">Negative prompt</span>
        <textarea
          value={negativeDraft}
          onChange={(e) => setNegativeDraft(e.target.value)}
          onBlur={commitNegativePrompt}
          placeholder="lowres, bad anatomy, extra fingers"
          className="min-h-[4rem] resize-y rounded-lg border border-[var(--border)] bg-[var(--secondary)] p-2 text-[0.6875rem] text-[var(--foreground)] outline-none transition-colors placeholder:text-[var(--muted-foreground)]/45 focus:border-[var(--primary)]/50"
        />
      </label>
      <p className="text-[0.55rem] text-[var(--muted-foreground)]">
        Saved for this chat. Leave the selfie prompt blank to use the default prompt. The template can use{" "}
        {"${charName}"} and {"${appearance}"}. Positive tags are appended to the generated selfie prompt; negative tags
        are sent directly to the image generator.
      </p>
    </div>
  );
}
export function ScheduleEditor({
  characterSchedules,
  chatCharIds,
  charNameMap,
  onSave,
}: {
  characterSchedules: Record<
    string,
    {
      weekStart: string;
      days: Record<string, ScheduleBlock[]>;
      inactivityThresholdMinutes: number;
      idleResponseDelayMinutes?: number;
      dndResponseDelayMinutes?: number;
      talkativeness: number;
    }
  >;
  chatCharIds: string[];
  charNameMap: Map<string, string>;
  onSave: (updated: typeof characterSchedules) => void;
}) {
  const [expandedCharId, setExpandedCharId] = useState<string | null>(null);
  const [expandedDay, setExpandedDay] = useState<string | null>(null);
  const [editDraft, setEditDraft] = useState<{
    days: Record<string, ScheduleBlock[]>;
    inactivityThresholdMinutes: string;
    idleResponseDelayMinutes: string;
    dndResponseDelayMinutes: string;
  } | null>(null);

  const parseRequiredMinutes = (value: string, fallback: number, min: number, max: number) => {
    const parsed = Number(value);
    if (!Number.isFinite(parsed)) return fallback;
    return Math.max(min, Math.min(max, parsed));
  };

  const parseOptionalMinutes = (value: string, min: number, max: number) => {
    if (!value.trim()) return undefined;
    const parsed = Number(value);
    if (!Number.isFinite(parsed)) return undefined;
    return Math.max(min, Math.min(max, parsed));
  };

  const handleExpandChar = (charId: string) => {
    if (expandedCharId === charId) {
      setExpandedCharId(null);
      setExpandedDay(null);
      setEditDraft(null);
      return;
    }
    const schedule = characterSchedules[charId];
    if (schedule) {
      setEditDraft({
        days: JSON.parse(JSON.stringify(schedule.days)),
        inactivityThresholdMinutes: String(schedule.inactivityThresholdMinutes),
        idleResponseDelayMinutes:
          typeof schedule.idleResponseDelayMinutes === "number" ? String(schedule.idleResponseDelayMinutes) : "",
        dndResponseDelayMinutes:
          typeof schedule.dndResponseDelayMinutes === "number" ? String(schedule.dndResponseDelayMinutes) : "",
      });
    }
    setExpandedCharId(charId);
    setExpandedDay(null);
  };

  const handleSave = () => {
    if (!expandedCharId || !editDraft) return;
    const updated = { ...characterSchedules };
    const existingSchedule = updated[expandedCharId]!;
    const days = Object.fromEntries(
      Object.entries(editDraft.days).map(([day, blocks]) => [day, normalizeScheduleBlocks(blocks)]),
    );
    const nextSchedule = {
      ...existingSchedule,
      days,
      inactivityThresholdMinutes: parseRequiredMinutes(
        editDraft.inactivityThresholdMinutes,
        existingSchedule.inactivityThresholdMinutes,
        15,
        360,
      ),
    };
    const idleDelay = parseOptionalMinutes(editDraft.idleResponseDelayMinutes, 0, 120);
    const dndDelay = parseOptionalMinutes(editDraft.dndResponseDelayMinutes, 0, 120);
    if (idleDelay === undefined) {
      delete nextSchedule.idleResponseDelayMinutes;
    } else {
      nextSchedule.idleResponseDelayMinutes = idleDelay;
    }
    if (dndDelay === undefined) {
      delete nextSchedule.dndResponseDelayMinutes;
    } else {
      nextSchedule.dndResponseDelayMinutes = dndDelay;
    }
    updated[expandedCharId] = nextSchedule;
    onSave(updated);
    setExpandedCharId(null);
    setEditDraft(null);
  };

  const updateBlock = (day: string, idx: number, field: keyof ScheduleBlock, value: string) => {
    if (!editDraft) return;
    const newDraft = { ...editDraft, days: { ...editDraft.days } };
    const dayBlocks = [...(newDraft.days[day] ?? [])];
    dayBlocks[idx] = { ...dayBlocks[idx]!, [field]: value };
    newDraft.days[day] = dayBlocks;
    setEditDraft(newDraft);
  };

  const updateDraftSetting = (
    field: "inactivityThresholdMinutes" | "idleResponseDelayMinutes" | "dndResponseDelayMinutes",
    value: string,
  ) => {
    if (!editDraft) return;
    setEditDraft({ ...editDraft, [field]: value });
  };

  const addBlock = (day: string) => {
    if (!editDraft) return;
    const newDraft = { ...editDraft, days: { ...editDraft.days } };
    const dayBlocks = [...(newDraft.days[day] ?? [])];
    dayBlocks.push({ time: "12:00-13:00", activity: "Free time", status: "online" });
    newDraft.days[day] = dayBlocks;
    setEditDraft(newDraft);
  };

  const removeBlock = (day: string, idx: number) => {
    if (!editDraft) return;
    const newDraft = { ...editDraft, days: { ...editDraft.days } };
    const dayBlocks = [...(newDraft.days[day] ?? [])];
    dayBlocks.splice(idx, 1);
    newDraft.days[day] = dayBlocks;
    setEditDraft(newDraft);
  };

  const charsWithSchedules = chatCharIds.filter((cid) => characterSchedules[cid]);
  if (charsWithSchedules.length === 0) return null;

  return (
    <div className="mt-2 space-y-2">
      <div>
        <span className="text-[0.625rem] font-medium text-[var(--muted-foreground)]">Availability Patterns</span>
        <p className="mt-0.5 text-[0.5625rem] leading-relaxed text-[var(--muted-foreground)]/70">
          De-Koi uses these patterns to decide whether someone is around, delayed, busy, or unavailable. Exact time
          blocks are tucked into Advanced.
        </p>
      </div>
      {charsWithSchedules.map((charId) => {
        const name = charNameMap.get(charId) ?? "Unknown";
        const isExpanded = expandedCharId === charId;
        const schedule = characterSchedules[charId]!;
        const summary = summarizeCharacterAvailability(schedule);

        return (
          <div key={charId} className="overflow-hidden rounded-lg bg-[var(--secondary)]">
            <button
              onClick={() => handleExpandChar(charId)}
              className="flex w-full items-center gap-2 px-3 py-2 text-left transition-colors hover:bg-[var(--accent)]/50"
            >
              <ChevronRight
                size="0.6875rem"
                className={cn("text-[var(--muted-foreground)] transition-transform", isExpanded && "rotate-90")}
              />
              <div className="min-w-0 flex-1">
                <span className="block truncate text-[0.6875rem] font-medium">{name}</span>
                <span className="block truncate text-[0.5625rem] text-[var(--muted-foreground)]">
                  {summary.current.activity}
                </span>
              </div>
              <AvailabilityBadge availabilityKey={summary.current.key}>{summary.current.label}</AvailabilityBadge>
            </button>

            {isExpanded && editDraft && (
              <div className="space-y-2 border-t border-[var(--border)] px-3 py-2">
                <div className="rounded-md bg-[var(--background)] p-2">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0 flex-1">
                      <span className="block text-[0.625rem] font-semibold text-[var(--foreground)]">
                        {summary.current.message}
                      </span>
                      <span className="mt-0.5 block text-[0.5625rem] text-[var(--muted-foreground)]">
                        {summary.activeDays} active {summary.activeDays === 1 ? "day" : "days"} - {summary.totalBlocks}{" "}
                        availability {summary.totalBlocks === 1 ? "block" : "blocks"}
                      </span>
                    </div>
                    <div className="flex shrink-0 flex-wrap justify-end gap-1">
                      {AVAILABILITY_KEYS.map((key) => (
                        <span
                          key={key}
                          className="rounded-full bg-[var(--secondary)] px-1.5 py-0.5 text-[0.5rem] text-[var(--muted-foreground)]"
                          title={availabilityLabelForKey(key)}
                        >
                          {summary.counts[key]}
                        </span>
                      ))}
                    </div>
                  </div>
                  <div className="mt-2 grid gap-1.5 sm:grid-cols-2">
                    {summary.days.map((day) => (
                      <div key={day.day} className="rounded-md bg-[var(--secondary)] px-2 py-1.5">
                        <div className="flex items-center justify-between gap-2">
                          <span className="text-[0.5625rem] font-medium text-[var(--foreground)]">{day.day}</span>
                          <span className="text-[0.5rem] text-[var(--muted-foreground)]">
                            {day.blocks.length > 0 ? `${day.blocks.length} pattern${day.blocks.length === 1 ? "" : "s"}` : "Open"}
                          </span>
                        </div>
                        <div className="mt-1 flex flex-wrap gap-1">
                          {day.blocks.length === 0 ? (
                            <AvailabilityBadge availabilityKey="available">Available</AvailabilityBadge>
                          ) : (
                            day.blocks.slice(0, 4).map((block, idx) => (
                              <AvailabilityBadge key={`${block.activity}-${idx}`} availabilityKey={block.key}>
                                {block.label}
                              </AvailabilityBadge>
                            ))
                          )}
                          {day.blocks.length > 4 && (
                            <span className="rounded-full bg-[var(--accent)] px-1.5 py-0.5 text-[0.5rem] text-[var(--muted-foreground)]">
                              +{day.blocks.length - 4}
                            </span>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>

                <details className="rounded-md border border-[var(--border)] bg-[var(--background)]">
                  <summary className="flex cursor-pointer list-none items-center gap-2 px-2 py-1.5 text-[0.625rem] font-medium text-[var(--muted-foreground)] transition-colors hover:text-[var(--foreground)]">
                    <SlidersHorizontal size="0.6875rem" />
                    Advanced time blocks
                  </summary>
                  <div className="space-y-1.5 border-t border-[var(--border)] p-2">
                    <div className="rounded-md bg-[var(--secondary)] p-2 space-y-1.5">
                      <div className="grid gap-2 sm:grid-cols-3">
                        <label className="space-y-1">
                          <span className="block text-[0.55rem] font-medium uppercase tracking-wide text-[var(--muted-foreground)]">
                            Inactivity
                          </span>
                          <input
                            type="number"
                            min={15}
                            max={360}
                            step={5}
                            value={editDraft.inactivityThresholdMinutes}
                            onChange={(e) => updateDraftSetting("inactivityThresholdMinutes", e.target.value)}
                            className="w-full rounded bg-[var(--background)] px-1.5 py-1 text-[0.625rem] outline-none ring-1 ring-transparent focus:ring-[var(--primary)]/40"
                            placeholder="120"
                          />
                          <span className="block text-[0.5rem] text-[var(--muted-foreground)]">
                            Minutes before they follow up.
                          </span>
                        </label>
                        <label className="space-y-1">
                          <span className="block text-[0.55rem] font-medium uppercase tracking-wide text-[var(--muted-foreground)]">
                            Delayed Reply
                          </span>
                          <input
                            type="number"
                            min={0}
                            max={120}
                            step={0.5}
                            value={editDraft.idleResponseDelayMinutes}
                            onChange={(e) => updateDraftSetting("idleResponseDelayMinutes", e.target.value)}
                            className="w-full rounded bg-[var(--background)] px-1.5 py-1 text-[0.625rem] outline-none ring-1 ring-transparent focus:ring-[var(--primary)]/40"
                            placeholder="Default"
                          />
                          <span className="block text-[0.5rem] text-[var(--muted-foreground)]">
                            Blank keeps the built-in 1-3 minute range.
                          </span>
                        </label>
                        <label className="space-y-1">
                          <span className="block text-[0.55rem] font-medium uppercase tracking-wide text-[var(--muted-foreground)]">
                            Busy Reply
                          </span>
                          <input
                            type="number"
                            min={0}
                            max={120}
                            step={0.5}
                            value={editDraft.dndResponseDelayMinutes}
                            onChange={(e) => updateDraftSetting("dndResponseDelayMinutes", e.target.value)}
                            className="w-full rounded bg-[var(--background)] px-1.5 py-1 text-[0.625rem] outline-none ring-1 ring-transparent focus:ring-[var(--primary)]/40"
                            placeholder="Default"
                          />
                          <span className="block text-[0.5rem] text-[var(--muted-foreground)]">
                            Blank keeps the built-in 2-5 minute range.
                          </span>
                        </label>
                      </div>
                    </div>
                    {SCHEDULE_DAYS.map((day) => {
                      const blocks = editDraft.days[day] ?? [];
                      const isDayExpanded = expandedDay === day;

                      return (
                        <div key={day}>
                          <button
                            onClick={() => setExpandedDay(isDayExpanded ? null : day)}
                            className="flex w-full items-center gap-1.5 rounded-md px-2 py-1 text-left transition-colors hover:bg-[var(--accent)]/40"
                          >
                            <ChevronRight
                              size="0.5625rem"
                              className={cn(
                                "text-[var(--muted-foreground)] transition-transform",
                                isDayExpanded && "rotate-90",
                              )}
                            />
                            <span className="flex-1 text-[0.625rem] font-medium">{day}</span>
                            <span className="flex gap-0.5">
                              {blocks.slice(0, 8).map((block, i) => (
                                <span
                                  key={i}
                                  className={cn(
                                    "inline-block h-1.5 w-1.5 rounded-full",
                                    availabilityDotClass(availabilityKeyForStatus(block.status)),
                                  )}
                                  title={`${availabilityLabelForKey(availabilityKeyForStatus(block.status))}: ${block.activity}`}
                                />
                              ))}
                              {blocks.length > 8 && (
                                <span className="text-[0.5rem] text-[var(--muted-foreground)]">
                                  +{blocks.length - 8}
                                </span>
                              )}
                            </span>
                            <span className="text-[0.5rem] text-[var(--muted-foreground)]">{blocks.length}</span>
                          </button>

                          {isDayExpanded && (
                            <div className="ml-4 mt-1 space-y-1.5">
                              {blocks.map((block, idx) => {
                                const availabilityKey = availabilityKeyForStatus(block.status);
                                return (
                                  <div
                                    key={idx}
                                    className="flex items-start gap-1.5 rounded-md bg-[var(--secondary)] p-1.5"
                                  >
                                    <span
                                      className={cn(
                                        "mt-1.5 h-2 w-2 shrink-0 rounded-full",
                                        availabilityDotClass(availabilityKey),
                                      )}
                                    />
                                    <div className="min-w-0 flex-1 space-y-1">
                                      <input
                                        value={block.time}
                                        onChange={(e) => updateBlock(day, idx, "time", e.target.value)}
                                        className="w-full rounded bg-[var(--background)] px-1.5 py-0.5 font-mono text-[0.625rem] outline-none ring-1 ring-transparent focus:ring-[var(--primary)]/40"
                                        placeholder="06:00-08:00"
                                      />
                                      <input
                                        value={block.activity}
                                        onChange={(e) => updateBlock(day, idx, "activity", e.target.value)}
                                        className="w-full rounded bg-[var(--background)] px-1.5 py-0.5 text-[0.625rem] outline-none ring-1 ring-transparent focus:ring-[var(--primary)]/40"
                                        placeholder="What are they doing?"
                                      />
                                      <div className="flex flex-wrap gap-1">
                                        {STATUS_OPTIONS.map((status) => {
                                          const key = availabilityKeyForStatus(status);
                                          return (
                                            <button
                                              key={status}
                                              onClick={() => updateBlock(day, idx, "status", status)}
                                              className={cn(
                                                "rounded px-1.5 py-0.5 text-[0.5625rem] font-medium transition-colors",
                                                block.status === status
                                                  ? availabilityActiveButtonClass(key)
                                                  : "bg-[var(--background)] text-[var(--muted-foreground)] hover:bg-[var(--accent)]",
                                              )}
                                            >
                                              {availabilityLabelForKey(key)}
                                            </button>
                                          );
                                        })}
                                      </div>
                                    </div>
                                    <button
                                      onClick={() => removeBlock(day, idx)}
                                      className="mt-1 rounded p-0.5 text-[var(--muted-foreground)] transition-colors hover:bg-red-500/15 hover:text-red-400"
                                      title="Remove availability block"
                                    >
                                      <Trash2 size="0.625rem" />
                                    </button>
                                  </div>
                                );
                              })}
                              <button
                                onClick={() => addBlock(day)}
                                className="flex w-full items-center justify-center gap-1 rounded-md border border-dashed border-[var(--border)] px-2 py-1 text-[0.5625rem] text-[var(--muted-foreground)] transition-colors hover:bg-[var(--accent)]/40 hover:text-[var(--foreground)]"
                              >
                                <Plus size="0.5625rem" />
                                Add availability block
                              </button>
                            </div>
                          )}
                        </div>
                      );
                    })}

                    <div className="flex justify-end gap-2 border-t border-[var(--border)] pt-1.5">
                      <button
                        onClick={() => {
                          setExpandedCharId(null);
                          setEditDraft(null);
                        }}
                        className="rounded-md px-2.5 py-1 text-[0.625rem] font-medium text-[var(--muted-foreground)] transition-colors hover:bg-[var(--accent)]"
                      >
                        Cancel
                      </button>
                      <button
                        onClick={handleSave}
                        className="rounded-md bg-[var(--primary)] px-2.5 py-1 text-[0.625rem] font-medium text-white transition-colors hover:bg-[var(--primary)]/80"
                      >
                        Save Changes
                      </button>
                    </div>
                  </div>
                </details>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

const AVAILABILITY_KEYS = ["available", "delayed", "busy", "unavailable"] as const satisfies readonly AvailabilityKey[];

function availabilityDotClass(availabilityKey: AvailabilityKey): string {
  switch (availabilityKey) {
    case "available":
      return "bg-emerald-500";
    case "delayed":
      return "bg-amber-500";
    case "busy":
      return "bg-rose-500";
    case "unavailable":
      return "bg-zinc-400";
  }
}

function availabilityActiveButtonClass(availabilityKey: AvailabilityKey): string {
  switch (availabilityKey) {
    case "available":
      return "bg-emerald-500 text-white";
    case "delayed":
      return "bg-amber-500 text-white";
    case "busy":
      return "bg-rose-500 text-white";
    case "unavailable":
      return "bg-zinc-500 text-white";
  }
}

function availabilityBadgeClass(availabilityKey: AvailabilityKey): string {
  switch (availabilityKey) {
    case "available":
      return "bg-emerald-500/15 text-emerald-600 dark:text-emerald-300";
    case "delayed":
      return "bg-amber-500/15 text-amber-600 dark:text-amber-300";
    case "busy":
      return "bg-rose-500/15 text-rose-600 dark:text-rose-300";
    case "unavailable":
      return "bg-zinc-500/15 text-zinc-500 dark:text-zinc-300";
  }
}

function AvailabilityBadge({
  availabilityKey,
  children,
}: {
  availabilityKey: AvailabilityKey;
  children: ReactNode;
}) {
  return (
    <span
      className={cn(
        "inline-flex shrink-0 items-center rounded-full px-1.5 py-0.5 text-[0.5rem] font-medium leading-none",
        availabilityBadgeClass(availabilityKey),
      )}
    >
      {children}
    </span>
  );
}