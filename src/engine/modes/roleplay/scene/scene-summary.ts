// The summary a concluded scene writes back: each transcript section summarized, then the whole scene once, with
// one second try when that answer is too long or too brief. Behavior spec: docs/provenance/roleplay-scenes.md
// ("The summary").
import { isRecord, readString, type JsonRecord } from "../../../generation/runtime-records";
import { userFacingError } from "../../../shared/user-facing-error";
import { requestSceneText, type SceneConnection } from "./scene-calls";
import { sceneStepError } from "./scene-errors";
import {
  buildSectionSummaryMessages,
  buildWholeSummaryMessages,
  buildWholeSummaryRetryMessages,
  type SceneSummaryDetails,
  type WholeSummaryRetryReason,
} from "./scene-prompts";
import {
  capAtSentenceOrWord,
  collapseWhitespace,
  countSentences,
  countWords,
  stripLeadingLabels,
  withFinalPeriod,
} from "./scene-text";
import type { SceneCapabilities } from "./scene-types";

const SECTION_CHARACTER_LIMIT = 12_000;
const SECTION_SUMMARY_LIMIT = 2_400;
const WHOLE_SUMMARY_CHARACTER_LIMIT = 8_000;
const SECTION_ENTRY_LIMIT = 600;
const SUMMARY_WORD_LIMIT = 220;
const KEPT_HEAD_WORDS = 146;
const KEPT_TAIL_WORDS = 73;
const SUBSTANTIAL_LINE_COUNT = 8;
const SUBSTANTIAL_CHARACTER_COUNT = 1_800;
const MINIMUM_SENTENCES = 3;
const EMPTY_TRANSCRIPT = "(No visible scene transcript.)";

const EMPTY_SUMMARY_MESSAGE = "The model returned an empty scene summary";
const MALFORMED_SUMMARY_MESSAGE = "The model returned malformed structured scene summary JSON";
const INCOMPLETE_SUMMARY_MESSAGE =
  "The model returned an incomplete scene summary. Try again, or switch to a stronger model.";

const SCENE_SUMMARY_SECTION_KEYS = [
  "events",
  "choices",
  "relationshipShifts",
  "promises",
  "reveals",
  "unresolvedHooks",
  "currentState",
] as const;

type SceneSummarySectionKey = (typeof SCENE_SUMMARY_SECTION_KEYS)[number];
type SceneSummarySections = Record<SceneSummarySectionKey, string[]>;

export interface SceneSummary {
  summary: string;
  sections: SceneSummarySections;
}

function emptySections(): SceneSummarySections {
  return {
    events: [],
    choices: [],
    relationshipShifts: [],
    promises: [],
    reveals: [],
    unresolvedHooks: [],
    currentState: [],
  };
}

/** `Message <n> - <role> (<character id>): <text>` for every scene message with text. */
function sceneTranscriptLines(messages: readonly JsonRecord[]): string[] {
  const lines: string[] = [];
  for (const message of messages) {
    const text = collapseWhitespace(stripLeadingLabels(readString(message.content)));
    if (!text) continue;
    const role = readString(message.role).trim() || "user";
    const characterId = readString(message.characterId).trim();
    lines.push(`Message ${lines.length + 1} - ${role}${characterId ? ` (${characterId})` : ""}: ${text}`);
  }
  return lines;
}

function splitLongLine(line: string): string[] {
  const pieces: string[] = [];
  let rest = line;
  while (rest.length > SECTION_CHARACTER_LIMIT) {
    const window = rest.slice(0, SECTION_CHARACTER_LIMIT);
    const lastSpace = window.lastIndexOf(" ");
    const cut = lastSpace > SECTION_CHARACTER_LIMIT / 2 ? lastSpace : SECTION_CHARACTER_LIMIT;
    pieces.push(rest.slice(0, cut).trimEnd());
    rest = rest.slice(cut).trimStart();
  }
  if (rest) pieces.push(rest);
  return pieces;
}

/** Sections of at most 12,000 characters, split between messages (a message longer than that is split itself). */
function splitSceneTranscript(lines: readonly string[]): string[] {
  if (lines.length === 0) return [EMPTY_TRANSCRIPT];
  const sections: string[] = [];
  let current = "";
  for (const line of lines.flatMap(splitLongLine)) {
    const joined = current ? `${current}\n${line}` : line;
    if (joined.length > SECTION_CHARACTER_LIMIT && current) {
      sections.push(current);
      current = line;
    } else {
      current = joined;
    }
  }
  if (current) sections.push(current);
  return sections;
}

function cleanSummaryText(raw: string, limit: number): string {
  const text = collapseWhitespace(stripLeadingLabels(raw.trim()));
  if (!text) throw userFacingError(EMPTY_SUMMARY_MESSAGE);
  return withFinalPeriod(capAtSentenceOrWord(text, limit));
}

function withoutCodeFences(raw: string): string {
  return raw
    .trim()
    .replace(/^```[a-z]*\s*/i, "")
    .replace(/\s*```$/, "")
    .trim();
}

function sectionEntries(value: unknown): string[] {
  if (!Array.isArray(value)) throw userFacingError(MALFORMED_SUMMARY_MESSAGE);
  return value.flatMap((entry) => {
    const text = typeof entry === "string" ? entry : isRecord(entry) ? entry.text : undefined;
    if (typeof text !== "string") throw userFacingError(MALFORMED_SUMMARY_MESSAGE);
    const cleaned = collapseWhitespace(text);
    return cleaned ? [capAtSentenceOrWord(cleaned, SECTION_ENTRY_LIMIT)] : [];
  });
}

/**
 * Reads the whole-scene answer: a JSON object with `summary` and all seven `sections` lists, or plain prose (older
 * providers) with empty sections. Anything else that looks like JSON is refused rather than shown as the summary.
 */
function readWholeSceneSummary(raw: string): SceneSummary {
  const unfenced = withoutCodeFences(raw);
  if (!/^[{[]/.test(unfenced)) {
    return { summary: cleanSummaryText(unfenced, WHOLE_SUMMARY_CHARACTER_LIMIT), sections: emptySections() };
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(unfenced);
  } catch {
    throw userFacingError(MALFORMED_SUMMARY_MESSAGE);
  }
  if (!isRecord(parsed) || typeof parsed.summary !== "string" || !isRecord(parsed.sections)) {
    throw userFacingError(MALFORMED_SUMMARY_MESSAGE);
  }
  const rawSections = parsed.sections;
  const sections = emptySections();
  for (const key of SCENE_SUMMARY_SECTION_KEYS) sections[key] = sectionEntries(rawSections[key]);
  return { summary: cleanSummaryText(parsed.summary, WHOLE_SUMMARY_CHARACTER_LIMIT), sections };
}

/** Over 220 words: the first 146 words, "…", and the last 73, so late outcomes survive. */
function hardCapSummaryWords(summary: string): string {
  const words = summary.trim().split(/\s+/).filter(Boolean);
  if (words.length <= SUMMARY_WORD_LIMIT) return summary.trim();
  return withFinalPeriod([...words.slice(0, KEPT_HEAD_WORDS), "…", ...words.slice(-KEPT_TAIL_WORDS)].join(" "));
}

function retryReason(summary: string, substantial: boolean): WholeSummaryRetryReason | null {
  if (countWords(summary) > SUMMARY_WORD_LIMIT) return "too_long";
  if (substantial && countSentences(summary) < MINIMUM_SENTENCES) return "too_brief";
  return null;
}

/** Summarizes a scene's messages. Every failure is raised as "Scene summary generation failed: <reason>". */
export async function summarizeScene(
  capabilities: SceneCapabilities,
  input: { connection: SceneConnection; details: SceneSummaryDetails; messages: readonly JsonRecord[] },
): Promise<SceneSummary> {
  try {
    const lines = sceneTranscriptLines(input.messages);
    const sections = splitSceneTranscript(lines);
    const sectionSummaries: string[] = [];
    for (const [index, transcript] of sections.entries()) {
      const raw = await requestSceneText(capabilities, {
        kind: "section_summary",
        connection: input.connection,
        messages: buildSectionSummaryMessages({
          details: input.details,
          sectionNumber: index + 1,
          sectionCount: sections.length,
          transcript,
        }),
      });
      sectionSummaries.push(cleanSummaryText(raw, SECTION_SUMMARY_LIMIT));
    }

    const transcriptLength = lines.reduce((total, line) => total + line.length, 0);
    const substantial =
      sections.length > 1 || lines.length >= SUBSTANTIAL_LINE_COUNT || transcriptLength >= SUBSTANTIAL_CHARACTER_COUNT;
    let result = readWholeSceneSummary(
      await requestSceneText(capabilities, {
        kind: "whole_summary",
        connection: input.connection,
        messages: buildWholeSummaryMessages({ details: input.details, sectionSummaries }),
      }),
    );
    const reason = retryReason(result.summary, substantial);
    if (reason) {
      result = readWholeSceneSummary(
        await requestSceneText(capabilities, {
          kind: "whole_summary_retry",
          connection: input.connection,
          messages: buildWholeSummaryRetryMessages({
            details: input.details,
            sectionSummaries,
            previousAnswer: result.summary,
            reason,
          }),
        }),
      );
      if (substantial && countSentences(result.summary) < MINIMUM_SENTENCES) {
        throw userFacingError(INCOMPLETE_SUMMARY_MESSAGE);
      }
    }
    return { summary: hardCapSummaryWords(result.summary), sections: result.sections };
  } catch (error) {
    throw sceneStepError("Scene summary generation failed", error);
  }
}
