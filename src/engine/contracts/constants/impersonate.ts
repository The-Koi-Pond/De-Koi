/**
 * Default impersonate prompt template.
 *
 * When no custom template is provided (empty string), the server falls back to
 * this built-in instruction. The constant lives in the shared package so the
 * client can display a read-only preview in the Impersonate Settings drawer
 * without duplicating the string.
 */
export const DEFAULT_IMPERSONATE_PROMPT = [
  `<instruction>`,
  `You are writing {{user}}'s next message in this conversation.`,
  `Write only {{user}}'s next message. Do not answer as the assistant, narrator, system, or any character other than {{user}}.`,
  `Use {{user}}'s prior messages as style evidence: cadence, vocabulary, punctuation, confidence, emotional range, humor, and how much they usually say.`,
  `Do not copy exact phrasing from earlier messages. Do not overfit into parody. Continue the conversation naturally from {{user}}'s point of view.`,
  `Persona notes: {{persona_description}}`,
  `Private steering for this reply: {{impersonate_direction}}`,
  `Treat the steering as intent, not text to quote or explain.`,
  `Do not write for any other character. Do not include analysis, alternatives, labels, or meta-commentary.`,
  `No speaker labels, prefixes, quotation marks, markdown, or metadata. Output only the message text {{user}} would send.`,
  `</instruction>`,
]
  .filter(Boolean)
  .join("\n");
