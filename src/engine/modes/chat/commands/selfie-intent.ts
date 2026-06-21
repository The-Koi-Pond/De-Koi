import { hiddenFromAi, isRecord, readString, type JsonRecord } from "../../../generation/runtime-records";

type SelfieRequestMessage = {
  role?: unknown;
  content?: unknown;
  extra?: unknown;
};

type SelfieRequestIntentInput = {
  latestUserInput?: unknown;
  recentMessages?: readonly SelfieRequestMessage[];
};

const SELFIE_TARGETS = new Set(["selfie", "selfies"]);
const IMAGE_TARGETS = new Set(["photo", "photos", "pic", "pics", "picture", "pictures", "image", "images"]);
const REQUEST_ACTIONS = new Set(["attach", "dm", "give", "post", "send", "share", "show", "snap", "take"]);
const DESIRE_WORDS = new Set(["love", "see", "want", "wanna", "wanted", "like"]);
const NEGATORS = new Set(["dont", "don't", "not", "never", "without"]);
const SELF_REFERENCES = new Set(["you", "your", "yours", "yourself", "ur"]);
const FOLLOW_UP_REFERENCES = new Set(["one", "it", "that", "this"]);

function tokenized(value: unknown): string[] {
  const text = readString(value)
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}']+/gu, " ")
    .replace(/\b(can|don|won)'t\b/g, "$1t")
    .replace(/\s+/g, " ")
    .trim();
  return text ? text.split(" ") : [];
}

function hasNearby(tokens: string[], index: number, candidates: Set<string>, before: number, after: number): boolean {
  const start = Math.max(0, index - before);
  const end = Math.min(tokens.length - 1, index + after);
  for (let i = start; i <= end; i += 1) {
    if (i !== index && candidates.has(tokens[i]!)) return true;
  }
  return false;
}

function hasTarget(tokens: string[], targets: Set<string>): boolean {
  return tokens.some((token) => targets.has(token));
}

function hasRequestNegator(tokens: string[], targetIndex: number): boolean {
  const start = Math.max(0, targetIndex - 6);
  const end = Math.min(tokens.length - 1, targetIndex + 2);
  for (let i = start; i <= end; i += 1) {
    const token = tokens[i]!;
    if (token === "no" && (tokens[i + 1] === "need" || tokens[i + 1] === "selfie")) return true;
    if (token === "rather" && tokens[i + 1] === "not") return true;
    if (token === "prefer" && tokens[i + 1] === "not") return true;
    if (NEGATORS.has(token)) return true;
  }
  return false;
}

function hasCharacterImageObject(tokens: string[], targetIndex: number): boolean {
  if (
    tokens[targetIndex + 1] === "of" &&
    (tokens[targetIndex + 2] === "you" || tokens[targetIndex + 2] === "yourself")
  ) {
    return true;
  }
  return tokens[targetIndex - 1] === "your" || tokens[targetIndex - 2] === "your";
}

function hasExplicitNonCharacterImageObject(tokens: string[], targetIndex: number): boolean {
  if (tokens[targetIndex + 1] !== "of") return false;
  const object = tokens[targetIndex + 2];
  return !!object && !SELF_REFERENCES.has(object);
}

function hasSecondPersonActionBeforeTarget(tokens: string[], targetIndex: number): boolean {
  let sawSecondPerson = false;
  const start = Math.max(0, targetIndex - 7);
  for (let i = start; i < targetIndex; i += 1) {
    const token = tokens[i]!;
    if (token === "you") sawSecondPerson = true;
    if (sawSecondPerson && REQUEST_ACTIONS.has(token)) return true;
  }
  return false;
}

function hasDirectRequestCue(tokens: string[], targetIndex: number): boolean {
  if (hasNearby(tokens, targetIndex, REQUEST_ACTIONS, 7, 3)) return true;
  if (tokens[targetIndex - 1] === "please" || tokens[targetIndex + 1] === "please") return true;
  if (tokens[targetIndex - 1] === "a" && tokens[targetIndex + 1] === "please") return true;
  if (hasNearby(tokens, targetIndex, DESIRE_WORDS, 8, 4)) return true;
  const start = Math.max(0, targetIndex - 7);
  for (let i = start; i < targetIndex; i += 1) {
    const token = tokens[i]!;
    if (token !== "can" && token !== "could" && token !== "would" && token !== "will" && token !== "may") continue;
    if (tokens[i + 1] === "you") return true;
    if (
      tokens[i + 1] === "i" &&
      (tokens[i + 2] === "see" || tokens[i + 2] === "have" || tokens[i + 2] === "get")
    ) {
      return true;
    }
  }
  return false;
}

function hasImplicitCharacterPhotoRequest(tokens: string[], targetIndex: number): boolean {
  if (hasCharacterImageObject(tokens, targetIndex)) return true;
  if (hasExplicitNonCharacterImageObject(tokens, targetIndex)) return false;
  return hasSecondPersonActionBeforeTarget(tokens, targetIndex);
}

function latestUserRequestsSelfie(latestUserInput: unknown): boolean {
  const tokens = tokenized(latestUserInput);
  if (tokens.length === 0) return false;

  for (const [index, token] of tokens.entries()) {
    const isSelfieTarget = SELFIE_TARGETS.has(token);
    const isImageTarget = IMAGE_TARGETS.has(token);
    if (!isSelfieTarget && !isImageTarget) continue;
    if (hasRequestNegator(tokens, index) || !hasDirectRequestCue(tokens, index)) continue;
    if (isSelfieTarget) return true;
    if (hasImplicitCharacterPhotoRequest(tokens, index)) return true;
  }

  return false;
}

function previousAssistantOffersSelfie(messages: readonly SelfieRequestMessage[] | undefined): boolean {
  if (!messages?.length) return false;
  const visible = messages.filter((message): message is JsonRecord => isRecord(message) && !hiddenFromAi(message));
  let latestUserIndex = -1;
  for (let i = visible.length - 1; i >= 0; i -= 1) {
    if (readString(visible[i]?.role).trim() === "user") {
      latestUserIndex = i;
      break;
    }
  }
  const assistant = latestUserIndex > 0 ? visible[latestUserIndex - 1] : visible[visible.length - 1];
  if (readString(assistant?.role).trim() !== "assistant") return false;

  const tokens = tokenized(assistant.content);
  if (!hasTarget(tokens, SELFIE_TARGETS)) return false;
  return tokens.includes("want") || tokens.includes("like") || hasTarget(tokens, REQUEST_ACTIONS);
}

function latestUserAcceptsOfferedSelfie(latestUserInput: unknown): boolean {
  const tokens = tokenized(latestUserInput);
  if (tokens.length === 0 || tokens.length > 8) return false;
  if (tokens.some((token) => NEGATORS.has(token) || token === "no")) return false;
  if (tokens.includes("yes") && (tokens.includes("please") || hasTarget(tokens, REQUEST_ACTIONS))) return true;
  if (hasTarget(tokens, FOLLOW_UP_REFERENCES) && hasTarget(tokens, REQUEST_ACTIONS)) return true;
  return false;
}

export function detectConversationSelfieRequestIntent(input: unknown | SelfieRequestIntentInput): boolean {
  const structured = isRecord(input) && ("latestUserInput" in input || "recentMessages" in input);
  const latestUserInput = structured ? (input as SelfieRequestIntentInput).latestUserInput : input;
  if (latestUserRequestsSelfie(latestUserInput)) return true;
  if (!structured) return false;
  return (
    latestUserAcceptsOfferedSelfie(latestUserInput) &&
    previousAssistantOffersSelfie((input as SelfieRequestIntentInput).recentMessages)
  );
}
