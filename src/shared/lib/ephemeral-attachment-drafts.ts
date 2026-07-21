export type AttachmentDraftMode = "conversation" | "roleplay" | "game";

export type EphemeralAttachmentDraft = {
  type: string;
  data: string;
  name: string;
};

type ChatDraft = {
  attachments: EphemeralAttachmentDraft[];
  pendingReads: number;
};

function cloneAttachment(attachment: EphemeralAttachmentDraft): EphemeralAttachmentDraft {
  return { ...attachment };
}

export function createEphemeralAttachmentDraftOwner() {
  const drafts = new Map<AttachmentDraftMode, Map<string, ChatDraft>>();
  const listeners = new Set<(mode: AttachmentDraftMode, chatId: string) => void>();

  const notify = (mode: AttachmentDraftMode, chatId: string) => {
    for (const listener of listeners) listener(mode, chatId);
  };

  const modeDrafts = (mode: AttachmentDraftMode, create: boolean) => {
    const existing = drafts.get(mode);
    if (existing || !create) return existing;
    const next = new Map<string, ChatDraft>();
    drafts.set(mode, next);
    return next;
  };

  const chatDraft = (mode: AttachmentDraftMode, chatId: string, create: boolean) => {
    const byChat = modeDrafts(mode, create);
    const existing = byChat?.get(chatId);
    if (existing || !create || !byChat) return existing;
    const next = { attachments: [], pendingReads: 0 };
    byChat.set(chatId, next);
    return next;
  };

  const prune = (mode: AttachmentDraftMode, chatId: string) => {
    const byChat = modeDrafts(mode, false);
    const draft = byChat?.get(chatId);
    if (!byChat || !draft || draft.attachments.length > 0 || draft.pendingReads > 0) return;
    byChat.delete(chatId);
    if (byChat.size === 0) drafts.delete(mode);
  };

  return {
    read(mode: AttachmentDraftMode, chatId: string): EphemeralAttachmentDraft[] {
      return (chatDraft(mode, chatId, false)?.attachments ?? []).map(cloneAttachment);
    },

    replace(mode: AttachmentDraftMode, chatId: string, attachments: readonly EphemeralAttachmentDraft[]): void {
      if (attachments.length === 0) {
        const draft = chatDraft(mode, chatId, false);
        const changed = !!draft?.attachments.length;
        if (draft) draft.attachments = [];
        prune(mode, chatId);
        if (changed) notify(mode, chatId);
        return;
      }
      chatDraft(mode, chatId, true)!.attachments = attachments.map(cloneAttachment);
      notify(mode, chatId);
    },

    append(mode: AttachmentDraftMode, chatId: string, attachment: EphemeralAttachmentDraft): void {
      chatDraft(mode, chatId, true)!.attachments.push(cloneAttachment(attachment));
      notify(mode, chatId);
    },

    clear(mode: AttachmentDraftMode, chatId: string): void {
      const draft = chatDraft(mode, chatId, false);
      const changed = !!draft?.attachments.length;
      if (draft) draft.attachments = [];
      prune(mode, chatId);
      if (changed) notify(mode, chatId);
    },

    adjustPendingReads(mode: AttachmentDraftMode, chatId: string, delta: number): number {
      const existing = chatDraft(mode, chatId, false)?.pendingReads ?? 0;
      const next = Math.max(0, existing + delta);
      if (next > 0) chatDraft(mode, chatId, true)!.pendingReads = next;
      else {
        const draft = chatDraft(mode, chatId, false);
        if (draft) draft.pendingReads = 0;
        prune(mode, chatId);
      }
      if (next !== existing) notify(mode, chatId);
      return next;
    },

    pendingReads(mode: AttachmentDraftMode, chatId: string): number {
      return chatDraft(mode, chatId, false)?.pendingReads ?? 0;
    },

    hasPendingWork(mode?: AttachmentDraftMode): boolean {
      const candidates = mode ? [modeDrafts(mode, false)] : [...drafts.values()];
      return candidates.some((byChat) =>
        [...(byChat?.values() ?? [])].some((draft) => draft.attachments.length > 0 || draft.pendingReads > 0),
      );
    },

    subscribe(listener: (mode: AttachmentDraftMode, chatId: string) => void): () => void {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}

export const ephemeralAttachmentDrafts = createEphemeralAttachmentDraftOwner();
