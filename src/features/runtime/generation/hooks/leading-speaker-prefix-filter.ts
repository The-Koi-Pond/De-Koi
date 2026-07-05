export interface LeadingSpeakerPrefixFilter {
  filter(chunk: string): string;
  flush(): string;
  reset(): void;
}

type SpeakerPrefixCandidate = {
  prefix: string;
  lowerPrefix: string;
};

interface SpeakerTagPreviewFilter {
  filter(chunk: string): string;
  flush(): string;
  reset(): void;
}

const MAX_BUFFERED_SPEAKER_TAG_FRAGMENT_LENGTH = 160;

function speakerPrefixCandidates(speakerNames: Iterable<string>): SpeakerPrefixCandidate[] {
  return [...speakerNames]
    .map((name) => name.trim())
    .filter(Boolean)
    .flatMap((name) =>
      [": ", "\uFF1A", ":"].map((separator) => {
        const prefix = `${name}${separator}`;
        return { prefix, lowerPrefix: prefix.toLowerCase() };
      }),
    );
}

function createSpeakerTagPreviewFilter(): SpeakerTagPreviewFilter {
  let bufferedTagFragment = "";

  return {
    filter(chunk: string): string {
      if (!chunk && !bufferedTagFragment) return "";
      const result = stripCompleteSpeakerTagsFromPreview(`${bufferedTagFragment}${chunk}`);
      bufferedTagFragment = result.pendingFragment;
      return result.text;
    },
    flush(): string {
      const remaining = bufferedTagFragment;
      bufferedTagFragment = "";
      return remaining;
    },
    reset(): void {
      bufferedTagFragment = "";
    },
  };
}

function stripCompleteSpeakerTagsFromPreview(text: string): { text: string; pendingFragment: string } {
  let output = "";
  let cursor = 0;

  while (cursor < text.length) {
    const char = text[cursor];
    if (char !== "<") {
      output += char;
      cursor += 1;
      continue;
    }

    const rest = text.slice(cursor);
    const completeTag = speakerTagMatch(rest);
    if (completeTag) {
      cursor += completeTag.length;
      continue;
    }

    if (isPotentialSpeakerTagFragment(rest)) {
      if (!rest.includes(">") && rest.length <= MAX_BUFFERED_SPEAKER_TAG_FRAGMENT_LENGTH) {
        return { text: output, pendingFragment: rest };
      }
      if (!rest.includes(">")) {
        output += rest;
        return { text: output, pendingFragment: "" };
      }
    }

    output += char;
    cursor += 1;
  }

  return { text: output, pendingFragment: "" };
}

function speakerTagMatch(text: string): string | null {
  return text.match(/^<speaker\b[^>]*>/i)?.[0] ?? text.match(/^<\/speaker\s*>/i)?.[0] ?? null;
}

function isPotentialSpeakerTagFragment(text: string): boolean {
  const lower = text.toLowerCase();
  return (
    "<speaker".startsWith(lower) ||
    "</speaker".startsWith(lower) ||
    lower.startsWith("<speaker") ||
    lower.startsWith("</speaker")
  );
}

export function createLeadingSpeakerPrefixFilter(speakerNames: Iterable<string>): LeadingSpeakerPrefixFilter {
  const candidates = speakerPrefixCandidates(speakerNames);
  const speakerTagFilter = createSpeakerTagPreviewFilter();
  let buffer = "";

  const filterSpeakerPrefix = (chunk: string): string => {
    if (candidates.length === 0) return chunk;
    buffer += chunk;
    const lowerBuffer = buffer.toLowerCase();

    for (const candidate of candidates) {
      if (lowerBuffer === candidate.lowerPrefix) {
        return "";
      }
      if (lowerBuffer.startsWith(candidate.lowerPrefix)) {
        const remaining = buffer.slice(candidate.prefix.length);
        buffer = "";
        return remaining;
      }
    }

    for (const candidate of candidates) {
      if (candidate.lowerPrefix.startsWith(lowerBuffer)) {
        return "";
      }
    }

    const result = buffer;
    buffer = "";
    return result;
  };

  const flushSpeakerPrefix = (): string => {
    if (!buffer) return "";
    const remaining = buffer;
    buffer = "";
    const confirmedPrefix = candidates.some((candidate) => candidate.lowerPrefix === remaining.toLowerCase());
    return confirmedPrefix ? "" : remaining;
  };

  return {
    filter(chunk: string): string {
      return filterSpeakerPrefix(speakerTagFilter.filter(chunk));
    },
    flush(): string {
      const tagRemainder = speakerTagFilter.flush();
      return (tagRemainder ? filterSpeakerPrefix(tagRemainder) : "") + flushSpeakerPrefix();
    },
    reset(): void {
      buffer = "";
      speakerTagFilter.reset();
    },
  };
}

export function filterLeadingSpeakerPrefix(text: string, speakerNames: Iterable<string>): string {
  const filter = createLeadingSpeakerPrefixFilter(speakerNames);
  return filter.filter(text) + filter.flush();
}
