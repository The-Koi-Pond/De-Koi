type SubmittedInputAttachment = {
  type: string;
  data: string;
  name: string;
};

type SubmittedInputDraft = {
  text: string;
  attachments: readonly SubmittedInputAttachment[];
};

type SubmittedInputSnapshot = SubmittedInputDraft & {
  chatId: string;
};

type SubmittedInputRecoveryOwners<TSnapshot extends SubmittedInputSnapshot = SubmittedInputSnapshot> = {
  readCurrent: (chatId: string) => { visible: boolean; draft: SubmittedInputDraft };
  restoreVisible: (
    chatId: string,
    restored: SubmittedInputDraft,
    submitted: TSnapshot,
    current: SubmittedInputDraft,
  ) => void;
  restoreInactive: (
    chatId: string,
    restored: SubmittedInputDraft,
    submitted: TSnapshot,
    current: SubmittedInputDraft,
  ) => void;
  persistText: (chatId: string, text: string) => void;
};

function isAbortError(error: unknown): boolean {
  return error instanceof Error && error.name === "AbortError";
}

function mergeSubmittedInput(submitted: SubmittedInputDraft, current: SubmittedInputDraft): SubmittedInputDraft {
  const text = submitted.text && current.text ? `${submitted.text}\n\n${current.text}` : submitted.text || current.text;
  const attachments = [...submitted.attachments];
  for (const attachment of current.attachments) {
    const duplicate = attachments.some(
      (candidate) =>
        candidate.type === attachment.type && candidate.data === attachment.data && candidate.name === attachment.name,
    );
    if (!duplicate) attachments.push(attachment);
  }
  return { text, attachments };
}

export function createSubmittedInputRecoveryHarness<TSnapshot extends SubmittedInputSnapshot = SubmittedInputSnapshot>(
  owners: SubmittedInputRecoveryOwners<TSnapshot>,
) {
  const recover = ({
    error,
    userMessageAccepted,
    savedDataMayRemain,
    submitted,
  }: {
    error?: unknown;
    userMessageAccepted: boolean;
    savedDataMayRemain: boolean;
    submitted: TSnapshot;
  }) => {
    const restore = !userMessageAccepted && !savedDataMayRemain;
    const report = savedDataMayRemain || (error !== undefined && !isAbortError(error));
    if (!restore) return { restore, report };

    const current = owners.readCurrent(submitted.chatId);
    const restored = mergeSubmittedInput(submitted, current.draft);
    if (current.visible) owners.restoreVisible(submitted.chatId, restored, submitted, current.draft);
    else owners.restoreInactive(submitted.chatId, restored, submitted, current.draft);
    owners.persistText(submitted.chatId, restored.text);
    return { restore, report };
  };

  return {
    generation(submitted: TSnapshot) {
      let userMessageAccepted = false;
      return {
        markUserMessageAccepted() {
          userMessageAccepted = true;
        },
        unsuccessful() {
          return recover({ userMessageAccepted, savedDataMayRemain: false, submitted });
        },
        failure(error: unknown) {
          return recover({ error, userMessageAccepted, savedDataMayRemain: false, submitted });
        },
      };
    },
    postOnly(submitted: TSnapshot) {
      let rollbackFailed = false;
      return {
        markRollbackFailed() {
          rollbackFailed = true;
        },
        get savedDataMayRemain() {
          return rollbackFailed;
        },
        failure(error: unknown) {
          return recover({ error, userMessageAccepted: false, savedDataMayRemain: rollbackFailed, submitted });
        },
      };
    },
  };
}
