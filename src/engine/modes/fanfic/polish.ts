// ──────────────────────────────────────────────
// Fanfic auto-polish: the clean-up and checks a finished chapter gets without the requester tapping anything
// ──────────────────────────────────────────────
import type { StorageGateway } from "../../capabilities/storage";
import type {
  FanficModelRecord,
  FanficPolishReport,
  FanficPolishStep,
  FanficPolishStepId,
  FanficState,
} from "../../contracts/types/fanfic";
import type { GenerationEvent } from "../../generation/generation-events";
import type { GenerationEngineDeps } from "../../generation/start-generation";
import { isRecord, parseRecord, readString, type JsonRecord } from "../../generation/runtime-records";
import { userFacingError } from "../../shared/user-facing-error";
import { buildFanficAiIsmCleanupNotes, detectFanficAiIsms, fanficAiIsmNeedsCleanup } from "./ai-isms";
import { fanficChapterLayout, fanficChaptersBefore, type FanficChapterRef } from "./chapter-refs";
import { applyFanficContinuityFixes, checkFanficChapterContinuity, type FanficContinuityFix } from "./continuity";
import { fanficChapterTextKey } from "./ledger";
import { stripFanficChapterHeading } from "./prompts";
import { detectFanficRepetition, fanficRepetitionNames } from "./repetition";
import { readFanficState } from "./request";
import { checkFanficChapterVoice } from "./voice-check";
import { fanficModelsWith, fanficRewrittenVersion, readFanficVersion } from "./versions";

/** What the reader shows while each step runs. */
const FANFIC_POLISH_PHASES: Record<FanficPolishStepId, string> = {
  prose: "Polishing: cleaning up the prose…",
  continuity: "Polishing: checking continuity…",
  voice: "Polishing: checking the voices…",
};

/** Whether the fic polishes its chapters by itself (the request's switch, on unless turned off). */
export function fanficAutoPolishOn(state: FanficState | null): boolean {
  return state?.request.autoPolish !== false;
}

/** The chapter's polish note, when the version shown has one and its text hasn't been edited since. */
export function readFanficPolishReport(extra: unknown, content: string): FanficPolishReport | null {
  const raw = parseRecord(parseRecord(extra).fanficPolish);
  const textKey = readString(raw.textKey);
  if (!textKey || !Array.isArray(raw.steps)) return null;
  if (fanficChapterTextKey(stripFanficChapterHeading(content)) !== textKey) return null;
  const steps: FanficPolishStep[] = [];
  for (const entry of raw.steps) {
    const step = parseRecord(entry);
    const id = readString(step.step);
    const status = readString(step.status);
    if (!["prose", "continuity", "voice"].includes(id) || !["clean", "fixed", "failed"].includes(status)) continue;
    steps.push({
      step: id as FanficPolishStepId,
      status: status as FanficPolishStep["status"],
      fixed: typeof step.fixed === "number" ? step.fixed : 0,
      left: typeof step.left === "number" ? step.left : 0,
      error: readString(step.error) || null,
    });
  }
  return { textKey, steps };
}

/**
 * The chapters a chapter's repeats are counted against, as the reader counts them: the canon line, plus its own chain
 * for an extra. Returns the texts and the chapter's place among them.
 */
function repetitionPool(layout: ReturnType<typeof fanficChapterLayout>, target: FanficChapterRef) {
  const pool = layout.chapters
    .filter((chapter) => !layout.orphans.includes(chapter))
    .filter(
      (other) => !other.extra || other.extra.canon || (target.extra !== null && other.mainNumber === target.mainNumber),
    );
  return { texts: pool.map((chapter) => chapter.content), index: pool.indexOf(target) };
}

function isAbort(error: unknown, signal: AbortSignal | undefined): boolean {
  return signal?.aborted === true || (error instanceof Error && error.name === "AbortError");
}

function errorMessage(error: unknown): string {
  return error instanceof Error && error.message ? error.message : String(error);
}

// Gemini's safety filter refuses some explicit chapters outright (HTTP 400 "blocked by safety filters"). Retrying on
// the same model fails the same way, so say where the check can go instead.
const SAFETY_BLOCK = /safety filter|blocked by safety|content[ _]filter|prohibited content/i;

function checkErrorMessage(error: unknown): string {
  const message = errorMessage(error);
  return SAFETY_BLOCK.test(message)
    ? "the checking model's safety filter refused this chapter. Send Fanfic checks to another model in Connections → Helper Models"
    : message;
}

async function readChapter(storage: StorageGateway, chatId: string, messageId: string) {
  const messages = (await storage.listChatMessages<JsonRecord>(chatId)).filter(isRecord);
  const layout = fanficChapterLayout(messages);
  const target = layout.chapters.find((chapter) => chapter.messageId === messageId);
  const message = messages.find((entry) => readString(entry.id) === messageId);
  if (!target || !message || layout.orphans.includes(target)) {
    throw userFacingError("That chapter is no longer in this fic.");
  }
  return { messages, layout, target, message };
}

export interface PolishFanficChapterInput {
  chatId: string;
  messageId: string;
}

/**
 * Polishes one finished chapter. When the prose reads AI-written or repeats itself it is rewritten (as Clean up prose
 * does), then the chapter is checked for continuity slips and out-of-voice lines and the fixes are applied. Every
 * change lands in one new version, so the chapter as written stays one tap back. A step that fails is noted on the
 * chapter and the next one still runs; a Stop discards the half-made version. Yields phases while it works and, at the
 * end, the chapter as it now reads. `rewrite` runs the clean-up as an ordinary rewrite on the fic's own connection.
 */
export async function* polishFanficChapter(
  deps: GenerationEngineDeps,
  input: PolishFanficChapterInput,
  rewrite: (notes: string, signal: AbortSignal | undefined) => AsyncGenerator<GenerationEvent>,
  signal?: AbortSignal,
): AsyncGenerator<GenerationEvent> {
  const { storage } = deps;
  const { chatId, messageId } = input;
  const chat = await storage.get("chats", chatId);
  const state = isRecord(chat) ? readFanficState(parseRecord(chat.metadata)) : null;
  if (!state) throw userFacingError("Fill in the fanfic request first.");
  const first = await readChapter(storage, chatId, messageId);
  if (readFanficVersion(first.message.extra)?.unfinished) {
    throw userFacingError("This chapter is unfinished. Continue it or keep it as is before it's polished.");
  }
  const steps: FanficPolishStep[] = [];
  // The version this polish made, once it made one; later fixes edit it in place.
  let polishedIndex: number | null = null;
  const startCount = Math.max(1, Number(first.message.swipeCount ?? 1));

  /** Removes the version a cut-off or stopped clean-up left behind, so the chapter shows as it was written. */
  const discardNewVersion = async () => {
    const current = await storage.getChatMessage<JsonRecord>(messageId);
    const count = Math.max(1, Number(current?.swipeCount ?? 1));
    if (count <= startCount) return;
    if (!storage.deleteChatMessageSwipe) {
      throw userFacingError("The clean-up was cut off and this storage can't remove the half-written version.");
    }
    await storage.deleteChatMessageSwipe(chatId, messageId, count - 1);
  };

  // ── 1. Prose: rewrite when it reads AI-written or keeps repeating itself ──
  {
    const pool = repetitionPool(first.layout, first.target);
    const report = detectFanficAiIsms(first.target.content);
    const repetition = detectFanficRepetition(pool.texts, {
      names: fanficRepetitionNames(state.request),
      focus: pool.index,
    });
    const aiIsms = fanficAiIsmNeedsCleanup(report);
    if (aiIsms || repetition.repeats.length > 0) {
      yield { type: "phase", data: FANFIC_POLISH_PHASES.prose };
      const notes = buildFanficAiIsmCleanupNotes(aiIsms ? report : { ...report, findings: [] }, repetition);
      try {
        for await (const event of rewrite(notes, signal)) {
          // The reader keeps showing the chapter as written until the polished one is ready, and the write's own
          // saved message would end the reader's wait before the checks below run.
          if (
            ["token", "delta", "content_replace", "thinking", "phase", "assistant_message", "message"].includes(
              event.type,
            )
          )
            continue;
          yield event;
        }
        const after = await storage.getChatMessage<JsonRecord>(messageId);
        const unfinished = readFanficVersion(after?.extra)?.unfinished;
        if (unfinished) {
          await discardNewVersion();
          steps.push({
            step: "prose",
            status: "failed",
            fixed: 0,
            left: 0,
            error: unfinished.message ?? "The clean-up was cut off, so the chapter stays as written.",
          });
        } else {
          polishedIndex = Math.max(0, Number(after?.swipeCount ?? startCount + 1) - 1);
          steps.push({ step: "prose", status: "fixed", fixed: 1, left: 0, error: null });
        }
      } catch (error) {
        await discardNewVersion();
        if (isAbort(error, signal)) throw error;
        steps.push({ step: "prose", status: "failed", fixed: 0, left: 0, error: errorMessage(error) });
      }
    } else {
      steps.push({ step: "prose", status: "clean", fixed: 0, left: 0, error: null });
    }
  }

  /** Saves fixed text: as this polish's new version the first time, then into that version. */
  const saveFixed = async (text: string, model: FanficModelRecord) => {
    const current = await storage.getChatMessage<JsonRecord>(messageId);
    if (!isRecord(current)) throw userFacingError("That chapter is no longer in this fic.");
    if (polishedIndex === null) {
      await storage.addChatMessageSwipe(chatId, messageId, text, {
        activate: true,
        extra: { fanficVersion: fanficRewrittenVersion(current, model, "") },
      });
      polishedIndex = Math.max(0, Number(current.swipeCount ?? startCount));
      return;
    }
    const version = readFanficVersion(current.extra);
    await storage.updateChatMessage(messageId, { content: text });
    if (version) {
      await storage.patchChatMessageExtra(messageId, {
        fanficVersion: { ...version, models: fanficModelsWith(version.models, model) },
      });
    }
  };

  /** Runs one check and applies its fixes; a failure is noted and the polish goes on. */
  const checkAndFix = async (
    step: "continuity" | "voice",
    check: () => Promise<{
      textKey: string;
      issues: Array<{ fix: FanficContinuityFix | null }>;
      model: FanficModelRecord;
    }>,
  ) => {
    try {
      const result = await check();
      const fixes = result.issues.map((issue) => issue.fix).filter((fix): fix is FanficContinuityFix => fix !== null);
      const unfixable = result.issues.length - fixes.length;
      if (result.issues.length === 0) {
        steps.push({ step, status: "clean", fixed: 0, left: 0, error: null });
        return;
      }
      const { target, message } = await readChapter(storage, chatId, messageId);
      if (fanficChapterTextKey(target.content) !== result.textKey) {
        throw userFacingError("The chapter changed during the check, so its fixes weren't applied.");
      }
      const applied = fixes.length > 0 ? applyFanficContinuityFixes(readString(message.content), fixes) : null;
      if (applied && applied.applied > 0) await saveFixed(applied.text, result.model);
      const fixed = applied?.applied ?? 0;
      steps.push({
        step,
        status: fixed > 0 ? "fixed" : "clean",
        fixed,
        left: unfixable + (applied?.skipped ?? 0),
        error: null,
      });
    } catch (error) {
      if (isAbort(error, signal)) throw error;
      steps.push({ step, status: "failed", fixed: 0, left: 0, error: checkErrorMessage(error) });
    }
  };

  // ── 2. Continuity: only a chapter with something before it can contradict it ──
  {
    const { messages, layout, target } = await readChapter(storage, chatId, messageId);
    if (fanficChaptersBefore(messages, layout, target).length > 0) {
      yield { type: "phase", data: FANFIC_POLISH_PHASES.continuity };
      await checkAndFix("continuity", () =>
        checkFanficChapterContinuity({ storage, llm: deps.llm }, { chatId, messageId }, { signal }),
      );
    }
  }

  // ── 3. Voices: only once the fic has voice sheets ──
  if ((state.voices ?? []).length > 0) {
    yield { type: "phase", data: FANFIC_POLISH_PHASES.voice };
    await checkAndFix("voice", () =>
      checkFanficChapterVoice({ storage, llm: deps.llm }, { chatId, messageId }, { signal }),
    );
  }

  // The note goes on the version the reader now shows, keyed to its text.
  const final = await readChapter(storage, chatId, messageId);
  const report: FanficPolishReport = { textKey: fanficChapterTextKey(final.target.content), steps };
  await storage.patchChatMessageExtra(messageId, { fanficPolish: report });
  const shown = await storage.getChatMessage<JsonRecord>(messageId);
  if (!isRecord(shown)) throw userFacingError("That chapter is no longer in this fic.");
  const { swipes: _swipes, ...row } = shown;
  // The polished text is this write's reply: without it the reader would count a polish as a write that produced
  // nothing, and nothing would follow it.
  yield { type: "content_replace", data: readString(shown.content) };
  yield { type: "assistant_message", data: row };
}
