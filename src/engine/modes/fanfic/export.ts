import type { FanficState } from "../../contracts/types/fanfic";
import { readString, type JsonRecord } from "../../generation/runtime-records";
import { fanficChapterLayout, type FanficChapterRef } from "./chapter-refs";
import { fanficChapterTitle } from "./chapters";
import { stripFanficChapterHeading } from "./prompts";
import { FANFIC_POV_LABELS, FANFIC_RATING_LABELS, FANFIC_SETTING_LABELS, FANFIC_WARNING_LABELS } from "./request";

export type FanficExportFormat = "html" | "markdown";

export interface FanficExportChapter {
  /** The chapter as stored; a heading the model added is dropped. */
  prose: string;
  ref: Pick<FanficChapterRef, "label" | "mainNumber" | "extra">;
}

export interface FanficExportInput {
  state: FanficState;
  /** Chapters in reading order (see fanficExportChapters). */
  chapters: readonly FanficExportChapter[];
  fallbackTitle?: string;
}

/**
 * The fic's chapters in reading order with their layout refs: each main chapter, then its extras. Extras whose main
 * chapter is gone are left out.
 */
export function fanficExportChapters(messages: readonly JsonRecord[]): FanficExportChapter[] {
  const layout = fanficChapterLayout(messages);
  const prose = new Map(messages.map((message) => [readString(message.id), readString(message.content)]));
  return layout.chapters
    .filter((ref) => !layout.orphans.includes(ref))
    .map((ref) => ({ prose: prose.get(ref.messageId) ?? "", ref }));
}

export interface FanficExportFile {
  filename: string;
  mimeType: string;
  content: string;
}

interface FanficWorkHeader {
  title: string;
  summary: string;
  tags: Array<[string, string]>;
}

function workHeader(input: FanficExportInput): FanficWorkHeader {
  const { request, outline } = input.state;
  const warnings =
    request.warnings.length > 0
      ? request.warnings.map((warning) => FANFIC_WARNING_LABELS[warning]).join(", ")
      : "No Archive Warnings Apply";
  const planned = outline?.chapters.length ?? request.chapterCount;
  const tags: Array<[string, string]> = [
    ["Rating", FANFIC_RATING_LABELS[request.rating]],
    ["Archive Warning", warnings],
    ["Fandom", request.fandom],
    ["Relationships", request.relationships.join(", ")],
    ["Characters", request.characters.join(", ")],
    [
      "Additional Tags",
      [
        ...request.tags,
        request.setting === "canon" ? "" : FANFIC_SETTING_LABELS[request.setting],
        FANFIC_POV_LABELS[request.pov],
      ]
        .filter(Boolean)
        .join(", "),
    ],
    // Main chapters, as the outline counts them; extras don't add to the count.
    ["Chapters", `${input.chapters.filter((chapter) => !chapter.ref.extra).length}/${planned}`],
  ];
  return {
    title: outline?.title || input.fallbackTitle?.trim() || "Untitled",
    summary: outline?.summary ?? "",
    tags: tags.filter(([, value]) => value.trim().length > 0),
  };
}

/** A main chapter with its outline title; an extra by its number, marked when it's a side story. */
function chapterHeading(state: FanficState, ref: FanficExportChapter["ref"]): string {
  if (ref.extra) return `Chapter ${ref.label}${ref.extra.canon ? "" : " (side story)"}`;
  const title = fanficChapterTitle(state, ref.mainNumber);
  return `Chapter ${ref.mainNumber}${title ? `: ${title}` : ""}`;
}

function safeFilename(title: string): string {
  const slug = title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
  return slug || "fanfic";
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function inlineHtml(value: string): string {
  return escapeHtml(value)
    .replace(/\*\*([^*\n]+)\*\*/g, "<strong>$1</strong>")
    .replace(/\*([^*\n]+)\*/g, "<em>$1</em>")
    .replace(/(^|[\s(])_([^_\n]+)_(?=[\s).,!?;:]|$)/g, "$1<em>$2</em>");
}

function proseHtml(prose: string): string {
  return stripFanficChapterHeading(prose)
    .split(/\n\s*\n/)
    .map((paragraph) => paragraph.trim())
    .filter(Boolean)
    .map((paragraph) =>
      /^(\*\s*){3}$|^-{3,}$|^#{1,6}$/.test(paragraph)
        ? "<hr />"
        : `<p>${paragraph.split("\n").map(inlineHtml).join("<br />")}</p>`,
    )
    .join("\n");
}

export function buildFanficHtml(input: FanficExportInput): FanficExportFile {
  const header = workHeader(input);
  const tagRows = header.tags
    .map(([label, value]) => `<dt>${escapeHtml(label)}:</dt><dd>${escapeHtml(value)}</dd>`)
    .join("\n");
  const chapters = input.chapters
    .map(
      ({ prose, ref }) =>
        `<section class="chapter">\n<h2>${escapeHtml(chapterHeading(input.state, ref))}</h2>\n${proseHtml(prose)}\n</section>`,
    )
    .join("\n");
  const content = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>${escapeHtml(header.title)}</title>
<style>
body { max-width: 42rem; margin: 2rem auto; padding: 0 1rem; font: 1.05rem/1.7 Georgia, serif; color: #222; background: #fff; }
dl.tags { display: grid; grid-template-columns: max-content 1fr; gap: 0.25rem 0.75rem; font: 0.9rem/1.4 system-ui, sans-serif; border: 1px solid #ddd; padding: 0.75rem 1rem; }
dt { font-weight: 600; }
dd { margin: 0; }
h1 { text-align: center; }
h2 { margin-top: 3rem; text-align: center; }
.summary { font-style: italic; }
hr { border: 0; text-align: center; }
hr::after { content: "* * *"; }
</style>
</head>
<body>
<dl class="tags">
${tagRows}
</dl>
<h1>${escapeHtml(header.title)}</h1>
${header.summary ? `<p class="summary">${escapeHtml(header.summary)}</p>` : ""}
${chapters}
</body>
</html>
`;
  return { filename: `${safeFilename(header.title)}.html`, mimeType: "text/html", content };
}

export function buildFanficMarkdown(input: FanficExportInput): FanficExportFile {
  const header = workHeader(input);
  const lines = [
    `# ${header.title}`,
    "",
    ...header.tags.map(([label, value]) => `**${label}:** ${value}  `),
    "",
    header.summary ? `> ${header.summary}` : "",
    "",
    ...input.chapters.flatMap(({ prose, ref }) => [
      `## ${chapterHeading(input.state, ref)}`,
      "",
      stripFanficChapterHeading(prose).trim(),
      "",
    ]),
  ];
  return {
    filename: `${safeFilename(header.title)}.md`,
    mimeType: "text/markdown",
    content: `${lines
      .join("\n")
      .replace(/\n{3,}/g, "\n\n")
      .trim()}\n`,
  };
}

export function buildFanficExport(input: FanficExportInput, format: FanficExportFormat): FanficExportFile {
  return format === "html" ? buildFanficHtml(input) : buildFanficMarkdown(input);
}
