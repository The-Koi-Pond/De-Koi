export interface LeadingSpeakerPrefixFilter {
  filter(chunk: string): string;
  flush(): string;
  reset(): void;
}

type SpeakerPrefixCandidate = {
  prefix: string;
  lowerPrefix: string;
};

function speakerPrefixCandidates(speakerNames: Iterable<string>): SpeakerPrefixCandidate[] {
  return [...speakerNames]
    .map((name) => name.trim())
    .filter(Boolean)
    .flatMap((name) =>
      [": ", "：", ":"].map((separator) => {
        const prefix = `${name}${separator}`;
        return { prefix, lowerPrefix: prefix.toLowerCase() };
      }),
    );
}

export function createLeadingSpeakerPrefixFilter(speakerNames: Iterable<string>): LeadingSpeakerPrefixFilter {
  const candidates = speakerPrefixCandidates(speakerNames);
  let buffer = "";

  return {
    filter(chunk: string): string {
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
    },
    flush(): string {
      if (!buffer) return "";
      const remaining = buffer;
      buffer = "";
      const confirmedPrefix = candidates.some((candidate) => candidate.lowerPrefix === remaining.toLowerCase());
      return confirmedPrefix ? "" : remaining;
    },
    reset(): void {
      buffer = "";
    },
  };
}

export function filterLeadingSpeakerPrefix(text: string, speakerNames: Iterable<string>): string {
  const filter = createLeadingSpeakerPrefixFilter(speakerNames);
  return filter.filter(text) + filter.flush();
}
