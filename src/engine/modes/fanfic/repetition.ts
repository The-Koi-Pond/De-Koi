// ──────────────────────────────────────────────
// Fanfic: spot the pet names, signature details, and phrases a fic keeps reaching for
// ──────────────────────────────────────────────
import type { FanficRequest } from "../../contracts/types/fanfic";
import { stripFanficChapterHeading } from "./prompts";

export type FanficRepeatKind = "pet_name" | "detail" | "phrase";

export interface FanficRepeat {
  kind: FanficRepeatKind;
  /** How the fic writes it: `Bells`, `my dear`, `bells`, `I want to watch`. */
  term: string;
  count: number;
  /** Chapters it shows up in. */
  chapters: number;
  examples: string[];
}

export interface FanficRepetitionReport {
  /** "work" compares chapters with each other; "chapter" looks inside one chapter. */
  scope: "work" | "chapter";
  words: number;
  chapterCount: number;
  repeats: FanficRepeat[];
}

/** Direct address that is ordinary speech, not a pet name. */
const NOT_A_PET_NAME = new Set(
  (
    "yes yeah yep yup no nope nah okay ok alright please fine thanks thank sorry well oh ah ahh aw hey hi huh hm hmm mm " +
    "ugh wow right sure god gods fuck fucking shit damn hell christ jesus now then here there too again already anyway " +
    "whatever though maybe either yet so still just wait stop look listen go come good great perfect agreed done enough " +
    "exactly first later tonight today tomorrow yesterday what why how who where when this that it me him her them us you " +
    "everyone everybody anyone someone all both and but or if not also even more less much once twice sometimes always " +
    "never ever ooh oof mhm uh um er eh ha haha heh shh psst whoa nothing something everything faster harder slower " +
    // Titles are ordinary address, not a habit: "sir" from a butler is the character, not a tic.
    "sir ma'am madam miss mister master lord lady captain doctor officer"
  ).split(" "),
);

/** Ordinary body and scene words: every story repeats these, so they never count as signature details. */
const SCAFFOLD_NOUNS = new Set(
  (
    "eye eyes hair hand hands face mouth lip lips teeth tooth tongue head neck shoulder shoulders arm arms back chest " +
    "stomach belly hip hips leg legs knee knees thigh thighs foot feet finger fingers thumb thumbs wrist wrists palm palms " +
    "skin body voice breath breathing heart throat jaw chin cheek cheeks nose ear ears forehead brow brows spine waist " +
    "lap rib ribs side sides gaze smile grin laugh expression mind name grip weight attention pulse own whole way turn " +
    "cock dick ass nipple nipples hole cunt pussy clit balls name word words fault life time room door bed own " +
    // Common describing words that also sit after "his": "his open mouth", "his long fingers".
    "open long wet hot warm cold soft hard red black white little big small bare full empty slick sweet low rough " +
    "quiet free other first last best only new old good bad"
  ).split(" "),
);

const STOPWORDS = new Set(
  (
    "a an the and or but if then so of to in on at by for with from into onto over under about as is are was were be been " +
    "being am do does did doing have has had having i you he she it we they me him her us them my your his its our their " +
    "this that these those there here not no can could will would shall should may might must just very really too also " +
    "up down out off all any some each both more most such than what which who whom when where why how one now still s t " +
    "don't didn't doesn't isn't wasn't i'm it's he's she's that's you're they're can't won't i'll i've either side " +
    "sides other around"
  ).split(" "),
);

const QUOTE = /["“]([^"”\n]+)["”]/g;
/** Murmured lines set in italics outside quotes: *breathe for me, my dear*. */
const ITALIC_SPEECH = /\*([^*\n]+)\*/g;
const VOCATIVE_LEADING = /^((?:[Mm]y\s+)?[A-Za-z][A-Za-z'-]*),\s+\S/;
const VOCATIVE_AFTER_COMMA = /,\s+((?:[Mm]y\s+)?[A-Za-z][A-Za-z'-]*)(?=\s*(?:[,.!?…—-]|$))/g;
/** A one-word sentence in dialogue: "Bells. Look at them." */
const VOCATIVE_ALONE = /^((?:[Mm]y\s+)?[A-Za-z][A-Za-z'-]*)[,.!?…]*$/;
const POSSESSIVE_HEAD = /\b(?:his|her|their|my|your|its|[A-Z][a-z]+'s)\s+([a-z][a-z-]{2,})\b/g;
const NARRATION_WORD = /\b[A-Za-z][a-z'-]+\b/g;
/** Words that follow these are describing, not naming a thing: "so long", "is open". */
const ADJECTIVE_CUE = /\b(?:so|too|very|is|are|was|were|be|been|more|how|less|wide)\s+([a-z][a-z-]+)\b/gi;

const PHRASE_LENGTH = 4;
const MAX_EXAMPLES = 2;
const MAX_PHRASES = 5;

/** Character names from the request, lowercased word by word, so `Harlequin` is never read as a pet name. */
export function fanficRepetitionNames(request: Pick<FanficRequest, "characters" | "relationships" | "povCharacter">) {
  return [...request.characters, ...request.relationships, request.povCharacter]
    .flatMap((value) => value.toLowerCase().split(/[^a-z'-]+/))
    .filter((word) => word.length >= 2);
}

function wordCount(text: string): number {
  return text.split(/\s+/).filter(Boolean).length;
}

function clip(text: string): string {
  const clean = text.replace(/\s+/g, " ").trim();
  return clean.length > 110 ? `${clean.slice(0, 107).trimEnd()}…` : clean;
}

function narrationOnly(text: string): string {
  return text.replace(QUOTE, " ").replace(ITALIC_SPEECH, " ");
}

/** Dialogue lines: quoted speech, plus italic lines in the narration. */
function speechLines(text: string): string[] {
  const quoted = [...text.matchAll(QUOTE)].map((match) => match[1]);
  const italic = [...text.replace(QUOTE, " ").matchAll(ITALIC_SPEECH)].map((match) => match[1]);
  return [...quoted, ...italic].map((line) => line.trim()).filter(Boolean);
}

function sentenceAround(text: string, index: number): string {
  const start = Math.max(
    text.lastIndexOf("\n", index),
    ...[". ", "! ", "? "].map((stop) => text.lastIndexOf(stop, index)),
  );
  const after = text.slice(index).search(/[.!?\n]/);
  return text.slice(start < 0 ? 0 : start + 1, after < 0 ? text.length : index + after + 1);
}

interface Tally {
  count: number;
  chapters: Set<number>;
  forms: Map<string, number>;
  examples: string[];
}

function tally(map: Map<string, Tally>, key: string, chapter: number, form: string, example: string) {
  const entry: Tally = map.get(key) ?? { count: 0, chapters: new Set(), forms: new Map(), examples: [] };
  entry.count += 1;
  entry.chapters.add(chapter);
  entry.forms.set(form, (entry.forms.get(form) ?? 0) + 1);
  if (example && entry.examples.length < MAX_EXAMPLES && !entry.examples.includes(example))
    entry.examples.push(example);
  map.set(key, entry);
}

function commonForm(entry: Tally): string {
  return [...entry.forms.entries()].sort((left, right) => right[1] - left[1])[0]?.[0] ?? "";
}

function addressTerms(line: string): string[] {
  const terms: string[] = [];
  for (const sentence of line.replace(/[*_]/g, "").split(/(?<=[.!?…])\s+/)) {
    const trimmed = sentence.trim();
    const alone = trimmed.match(VOCATIVE_ALONE);
    if (alone) {
      terms.push(alone[1]);
      continue;
    }
    const leading = trimmed.match(VOCATIVE_LEADING);
    if (leading) terms.push(leading[1]);
    for (const match of trimmed.matchAll(VOCATIVE_AFTER_COMMA)) terms.push(match[1]);
  }
  return terms;
}

/**
 * Pet names: words used to address someone in dialogue. Proper names (from the request, or capitalized mid-sentence
 * in narration) and everyday interjections are skipped. `discover` is the whole fic; `count` is what gets tallied.
 */
function petNames(discover: string[], count: string[], names: Set<string>): Map<string, Tally> {
  // A word the narration writes capitalized more often than not is somebody's name ("Bertie said"), not a pet name.
  const capitalized = new Map<string, number>();
  const lowercase = new Map<string, number>();
  for (const chapter of discover) {
    for (const match of narrationOnly(chapter).matchAll(NARRATION_WORD)) {
      const word = match[0].toLowerCase();
      const counts = match[0] === word ? lowercase : capitalized;
      counts.set(word, (counts.get(word) ?? 0) + 1);
    }
  }
  const isName = (word: string) =>
    (capitalized.get(word) ?? 0) >= 2 && (capitalized.get(word) ?? 0) > (lowercase.get(word) ?? 0);
  const found = new Map<string, Tally>();
  count.forEach((chapter, index) => {
    for (const line of speechLines(chapter)) {
      for (const raw of addressTerms(line)) {
        const form = raw.replace(/\s+/g, " ");
        const word = form.toLowerCase().replace(/^my /, "");
        if (word.length < 3 || NOT_A_PET_NAME.has(word) || word.endsWith("ly") || names.has(word)) continue;
        if (isName(word)) continue;
        // A bare `"Bells,"` says little; show lines with some talk around the name.
        tally(found, form.toLowerCase(), index, form, wordCount(line) >= 4 ? clip(`“${line}”`) : "");
      }
    }
  });
  return found;
}

/**
 * Signature details: things the narration keeps attaching to a character ("his bells", "Pierrot's mask") that aren't
 * ordinary body or scene words. Found in the narration of the whole fic, then every mention is counted.
 */
function details(discover: string[], count: string[], names: Set<string>) {
  const candidates = new Map<string, number>();
  const describing = new Map<string, number>();
  for (const chapter of discover) {
    const narration = narrationOnly(chapter);
    for (const match of narration.matchAll(POSSESSIVE_HEAD)) {
      const stem = match[1].replace(/s$/, "");
      if (SCAFFOLD_NOUNS.has(match[1]) || SCAFFOLD_NOUNS.has(stem) || STOPWORDS.has(match[1]) || names.has(stem))
        continue;
      candidates.set(stem, (candidates.get(stem) ?? 0) + 1);
    }
    for (const match of chapter.matchAll(ADJECTIVE_CUE)) {
      const word = match[1].toLowerCase();
      describing.set(word, (describing.get(word) ?? 0) + 1);
    }
  }
  const found = new Map<string, Tally>();
  for (const [stem, possessiveUses] of candidates) {
    if (possessiveUses < 3 || (describing.get(stem) ?? 0) >= 2) continue;
    const pattern = new RegExp(`\\b${stem}s?\\b`, "gi");
    count.forEach((chapter, index) => {
      for (const match of chapter.matchAll(pattern)) tally(found, stem, index, match[0].toLowerCase(), "");
      // Examples come from the narration, where the detail is a beat rather than a pet name.
      const narration = narrationOnly(chapter);
      const entry = found.get(stem);
      for (const match of narration.matchAll(pattern)) {
        const example = clip(sentenceAround(narration, match.index));
        if (entry && entry.examples.length < MAX_EXAMPLES && !entry.examples.includes(example))
          entry.examples.push(example);
      }
    });
  }
  return found;
}

function phrases(chapters: string[]): Map<string, Tally> {
  const found = new Map<string, Tally>();
  chapters.forEach((chapter, index) => {
    for (const sentence of chapter.toLowerCase().split(/[.!?…;:"“”\n]+/)) {
      const words = sentence.match(/[a-z']+/g) ?? [];
      for (let start = 0; start + PHRASE_LENGTH <= words.length; start += 1) {
        const gram = words.slice(start, start + PHRASE_LENGTH);
        // Two real words, and no stutter ("come on, come on") which is speech rhythm, not a reused phrase.
        if (gram.filter((word) => !STOPWORDS.has(word)).length < 2 || new Set(gram).size < gram.length) continue;
        const key = gram.join(" ");
        tally(found, key, index, key.replace(/\bi\b/g, "I"), "");
      }
    }
  });
  return found;
}

function toRepeat(kind: FanficRepeatKind, entry: Tally): FanficRepeat {
  return { kind, term: commonForm(entry), count: entry.count, chapters: entry.chapters.size, examples: entry.examples };
}

/** Drops phrases that are one-word shifts of a longer repeat already listed ("want to watch you" after "I want to watch"). */
function distinctPhrases(list: FanficRepeat[]): FanficRepeat[] {
  const kept: FanficRepeat[] = [];
  for (const phrase of list) {
    const words = phrase.term.toLowerCase().split(" ");
    const overlaps = kept.some((other) => {
      const otherWords = other.term.toLowerCase().split(" ");
      return (
        words.slice(1).join(" ") === otherWords.slice(0, -1).join(" ") ||
        otherWords.slice(1).join(" ") === words.slice(0, -1).join(" ")
      );
    });
    if (!overlaps) kept.push(phrase);
  }
  return kept.slice(0, MAX_PHRASES);
}

/**
 * Finds what a fic leans on: a pet name used in nearly every exchange, a signature detail that keeps coming back as
 * the go-to reaction ("his bells shiver"), and phrases repeated chapter after chapter.
 *
 * Without `focus`, it reads every chapter and flags what is overused across the fic, for steering the next chapter.
 * With `focus` (a chapter index), it flags what that one chapter overuses by itself, for a clean-up rewrite; the rest
 * of the fic is only used to tell names and details apart.
 */
export function detectFanficRepetition(
  chapterTexts: string[],
  options: { names?: string[]; focus?: number } = {},
): FanficRepetitionReport {
  const all = chapterTexts.map((text) => stripFanficChapterHeading(text).replace(/[’‘]/g, "'"));
  const work = options.focus === undefined;
  const focus = options.focus ?? 0;
  const chapters = (work ? all : all.slice(focus, focus + 1)).filter((text) => text.trim());
  const discover = all.filter((text) => text.trim());
  const names = new Set((options.names ?? []).map((name) => name.toLowerCase()));
  const words = chapters.reduce((sum, chapter) => sum + wordCount(chapter), 0);
  const chapterCount = chapters.length;
  const perThousand = (count: number) => (words > 0 ? (count / words) * 1000 : 0);

  const repeats: FanficRepeat[] = [];
  const petNameUses = new Map<string, number>();
  for (const entry of petNames(discover, chapters, names).values()) {
    const stem = commonForm(entry).toLowerCase().replace(/^my /, "").replace(/s$/, "");
    petNameUses.set(stem, (petNameUses.get(stem) ?? 0) + entry.count);
    // About two a chapter reads as character; past that it reads as a tic.
    if (entry.count >= 5 && (!work || entry.count > chapterCount * 2)) repeats.push(toRepeat("pet_name", entry));
  }
  // With only a chapter or two to compare, hold details to the single-chapter bar.
  const [detailMin, detailRate] = work && chapterCount >= 3 ? [6, 2.5] : [7, 3];
  for (const [stem, entry] of details(discover, chapters, names)) {
    if (entry.count < detailMin || perThousand(entry.count) < detailRate) continue;
    // The threshold counts every mention; the report leaves out the times it was a pet name, listed separately.
    const asDetail = entry.count - (petNameUses.get(stem) ?? 0);
    if (asDetail >= (work ? Math.max(detailMin, chapterCount * 2 + 1) : 5))
      repeats.push({ ...toRepeat("detail", entry), count: asDetail });
  }
  const phraseList = [...phrases(chapters).values()]
    .filter((entry) => (work ? entry.chapters.size >= 3 && entry.count >= 4 : entry.count >= 4))
    .map((entry) => toRepeat("phrase", entry))
    .sort((left, right) => right.count - left.count);
  repeats.push(...distinctPhrases(phraseList));

  const order: Record<FanficRepeatKind, number> = { pet_name: 0, detail: 1, phrase: 2 };
  repeats.sort((left, right) => order[left.kind] - order[right.kind] || right.count - left.count);
  return { scope: work ? "work" : "chapter", words, chapterCount, repeats };
}

function soFar(repeat: FanficRepeat, chapterCount: number): string {
  const times = `${repeat.count} times so far`;
  return chapterCount > 1 ? `${times}, in ${repeat.chapters} of ${chapterCount} chapters` : times;
}

/** Steering for the next chapter: what earlier chapters already wore out, and how rarely to use it now. */
export function buildFanficRepetitionGuide(report: FanficRepetitionReport): string {
  if (report.repeats.length === 0) return "";
  const lines = report.repeats.map((repeat) => {
    if (repeat.kind === "pet_name") {
      return `- Calling someone "${repeat.term}" (${soFar(repeat, report.chapterCount)}): once or twice at most in this chapter. Most lines need no name or pet name at all.`;
    }
    if (repeat.kind === "detail") {
      return `- "${repeat.term}" as a detail (${soFar(repeat, report.chapterCount)}): once or twice at most, only where it matters. Show reactions and moods through other things.`;
    }
    return `- The phrase "${repeat.term}" (${soFar(repeat, report.chapterCount)}): don't use it again.`;
  });
  return [
    "Earlier chapters keep reaching for these, and readers notice. Keep them rare in this chapter:",
    ...lines,
    "Keep anything the plot depends on; just stop using these by reflex.",
  ].join("\n");
}

/** Rewrite notes for one chapter's repeats, for the clean-up pass. */
export function buildFanficRepetitionCleanupLines(report: FanficRepetitionReport): string[] {
  return report.repeats.map((repeat) => {
    if (repeat.kind === "pet_name") {
      return `- Someone is called "${repeat.term}" ${repeat.count} times. Keep it once or twice at most; drop the rest, since most lines need no name or pet name.`;
    }
    if (repeat.kind === "detail") {
      return `- "${repeat.term}" comes up ${repeat.count} times. Keep it two times at most, where it matters, and give the other moments a different detail or none.`;
    }
    return `- The phrase "${repeat.term}" appears ${repeat.count} times. Keep one.`;
  });
}
