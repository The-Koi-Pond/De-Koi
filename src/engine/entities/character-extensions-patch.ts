/**
 * Storage deep-merges character `data` patches, so background writers send only the extension keys
 * they own. Writing `{ ...data, extensions }` from an earlier read silently reverted any card edit that
 * landed in between; status refreshes wait on an LLM call between that read and the write.
 *
 * An `undefined` value clears the key. It is stored as `null`, which every reader treats as unset.
 */
export function characterExtensionsPatch(changes: Record<string, unknown>): {
  data: { extensions: Record<string, unknown> };
} {
  const extensions: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(changes)) {
    extensions[key] = value === undefined ? null : value;
  }
  return { data: { extensions } };
}
