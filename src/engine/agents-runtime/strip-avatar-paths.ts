/**
 * JSON.stringify replacer that drops `avatarPath` from any object in the tree.
 *
 * `presentCharacters[].avatarPath` is a UI display field (image path or inline
 * data URL) the model never reads. Imported pre-refactor chats can ship full
 * base64 data URLs in this field (the legacy backup format inlines avatars
 * rather than referencing asset paths), and a single inlined avatar can be
 * megabytes of base64. Serialized verbatim into agent prompts that already
 * carry the bulk of chat context, this pushes turns past 1M-token provider
 * ceilings and every tracker agent returns HTTP 400 "prompt is too long"
 * (issue #1188).
 *
 * Use this replacer at every site that serializes `gameState` or anything
 * containing `presentCharacters` into a prompt:
 *
 *   JSON.stringify(value, stripAvatarPathsReplacer)
 */
export function stripAvatarPathsReplacer(key: string, value: unknown): unknown {
  return key === "avatarPath" ? undefined : value;
}
