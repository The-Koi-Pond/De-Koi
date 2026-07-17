// ──────────────────────────────────────────────
// Character Editor — Full-page detail view
// Replaces the chat area when editing a character.
// Sections: Metadata, Description, Personality, Backstory,
//           Appearance, Scenario, Dialogue, Advanced, Lorebook
// ──────────────────────────────────────────────
import { useState, useEffect, useRef, useCallback, useMemo } from "react";
import { toast } from "sonner";
import { useCharacter, useUpdateCharacter, useDeleteCharacter, useDuplicateCharacter } from "../hooks/use-characters";
import { useUIStore } from "../../../../shared/stores/ui.store";
import { useStartChatFromCharacter } from "../hooks/use-start-chat-from-character";
import { useConnections } from "../../connections/index";
import { showConfirmDialog } from "../../../../shared/lib/app-dialogs";
import { getErrorMessage } from "../../../../shared/lib/error-message";
import type {
  CharacterData,
  CharacterMemoryPersistence,
} from "../../../../engine/contracts/types/character";
import {
  isDefaultImageGenerationConnection,
  type ImageGenerationConnectionOption,
} from "../../../../shared/types/image-generation";
import { useCharacterEditorAvatar } from "../hooks/use-character-editor-avatar";
import { useCharacterEditorImportPersona } from "../hooks/use-character-editor-import-persona";
import {
  formatCharacterEditorExtension,
  formatCharacterEditorField,
  normalizeCharacterEditorData,
} from "../lib/character-editor-model";
import { estimateCharacterCardTokens } from "../lib/character-token-count";
import { getCardLengthToastActions } from "../../lib/card-token-recommendation";

import { CharacterEditorDialogs } from "./CharacterEditorDialogs";
import { CharacterEditorHeader } from "./CharacterEditorHeader";
import { CharacterEditorTabContent } from "./CharacterEditorTabContent";
import { CharacterEditorTabRail, type CharacterEditorTabId } from "./CharacterEditorTabRail";
import { CharacterEditorUnsavedWarning } from "./CharacterEditorUnsavedWarning";

interface ParsedCharacter {
  id: string;
  data: CharacterData;
  comment: string;
  memoryPersistence?: CharacterMemoryPersistence;
  avatarPath: string | null;
  spriteFolderPath: string | null;
}

export function CharacterEditor() {
  const characterId = useUIStore((s) => s.characterDetailId);
  const characterDetailDestination = useUIStore((s) => s.characterDetailDestination);
  const clearCharacterDetailDestination = useUIStore((s) => s.clearCharacterDetailDestination);
  const closeDetail = useUIStore((s) => s.closeCharacterDetail);
  const quoteFormat = useUIStore((s) => s.quoteFormat);
  const { data: rawCharacter, isLoading } = useCharacter(characterId);
  const updateCharacter = useUpdateCharacter();
  const deleteCharacter = useDeleteCharacter();
  const duplicateCharacter = useDuplicateCharacter();
  const { startChatFromCharacter, isStartingChat } = useStartChatFromCharacter();
  const { data: connectionsList } = useConnections();
  const imageConnections = useMemo<ImageGenerationConnectionOption[]>(
    () =>
      Array.isArray(connectionsList)
        ? (connectionsList as ImageGenerationConnectionOption[])
            .filter((connection) => connection.provider === "image_generation")
            .sort(
              (left, right) =>
                Number(isDefaultImageGenerationConnection(right)) - Number(isDefaultImageGenerationConnection(left)),
            )
        : [],
    [connectionsList],
  );

  const [activeTab, setActiveTab] = useState<CharacterEditorTabId>("metadata");
  const [formData, setFormData] = useState<CharacterData | null>(null);
  const [characterComment, setCharacterComment] = useState("");
  const [memoryPersistence, setMemoryPersistence] = useState<CharacterMemoryPersistence>("character");
  const [dirty, setDirty] = useState(false);
  const loadedCharacterIdRef = useRef<string | null>(null);
  const cardLengthWarningCharacterIdRef = useRef<string | null>(null);

  useEffect(() => {
    if (!characterId || characterDetailDestination !== "memories") return;
    setActiveTab("memories");
    clearCharacterDetailDestination();
  }, [characterDetailDestination, characterId, clearCharacterDetailDestination]);
  const dirtyRef = useRef(false);
  const editRevisionRef = useRef(0);
  const setEditorDirty = useUIStore((s) => s.setEditorDirty);
  const setDirtyState = useCallback((nextDirty: boolean) => {
    dirtyRef.current = nextDirty;
    setDirty(nextDirty);
  }, []);
  const markDirty = useCallback(() => {
    editRevisionRef.current += 1;
    setDirtyState(true);
  }, [setDirtyState]);
  useEffect(() => {
    dirtyRef.current = dirty;
    setEditorDirty(dirty);
  }, [dirty, setEditorDirty]);
  const [saving, setSaving] = useState(false);
  const [exportDialogOpen, setExportDialogOpen] = useState(false);
  const [avatarGeneratorOpen, setAvatarGeneratorOpen] = useState(false);
  const [newTag, setNewTag] = useState("");
  const [showUnsavedWarning, setShowUnsavedWarning] = useState(false);
  const imageGenerationAvailable = imageConnections.length > 0;

  const updateField = useCallback(
    <K extends keyof CharacterData>(key: K, value: CharacterData[K]) => {
      const nextValue = formatCharacterEditorField(key, value, quoteFormat);
      setFormData((prev) => (prev ? { ...prev, [key]: nextValue } : prev));
      markDirty();
    },
    [markDirty, quoteFormat],
  );

  const setExtensionValue = useCallback(
    (key: string, value: unknown) => {
      const nextValue = formatCharacterEditorExtension(key, value, quoteFormat);
      setFormData((prev) => {
        if (!prev) return prev;
        return { ...prev, extensions: { ...(prev.extensions ?? {}), [key]: nextValue } };
      });
    },
    [quoteFormat],
  );

  const updateExtension = useCallback(
    (key: string, value: unknown) => {
      setExtensionValue(key, value);
      markDirty();
    },
    [markDirty, setExtensionValue],
  );

  const {
    avatarPreview,
    avatarUploading,
    handleAvatarUpload,
    handleGeneratedAvatar,
    handleRemoveAvatar: removeAvatar,
    isAvatarUploadInFlight,
    setAvatarPreview,
  } = useCharacterEditorAvatar({
    characterId,
    currentAvatarCrop: formData?.extensions.avatarCrop,
    dirtyRef,
    editRevisionRef,
    saving,
    setDirtyState,
    setExtensionValue,
  });
  const { handleImportAsPersona, isImportingPersona } = useCharacterEditorImportPersona({
    avatarPreview,
    formData,
  });

  // Parse the character when it first loads, or when switching characters.
  // Avoid overwriting unsaved local edits when a refetch follows avatar upload.
  useEffect(() => {
    if (!rawCharacter) return;
    const char = rawCharacter as ParsedCharacter;
    const isSwitchingCharacter = loadedCharacterIdRef.current !== char.id;
    if (!isSwitchingCharacter && dirtyRef.current) return;

    loadedCharacterIdRef.current = char.id;

    setFormData(normalizeCharacterEditorData(char.data));
    setCharacterComment(char.comment ?? "");
    setMemoryPersistence(char.memoryPersistence === "chat" ? "chat" : "character");
    setAvatarPreview(char.avatarPath);
    setDirtyState(false);
  }, [rawCharacter, setAvatarPreview, setDirtyState]);

  useEffect(() => {
    const actions = getCardLengthToastActions({
      cardKind: "character",
      cardId: characterId,
      tokenEstimate: formData ? estimateCharacterCardTokens(formData) : null,
      previousToastId: cardLengthWarningCharacterIdRef.current,
    });

    for (const action of actions) {
      if (action.action === "dismiss") {
        toast.dismiss(action.toastId);
        if (cardLengthWarningCharacterIdRef.current === action.toastId) {
          cardLengthWarningCharacterIdRef.current = null;
        }
        continue;
      }

      toast.warning(action.title, {
        id: action.toastId,
        description: action.description,
        duration: action.duration,
        closeButton: action.closeButton,
      });
      cardLengthWarningCharacterIdRef.current = action.toastId;
    }
  }, [characterId, formData]);

  useEffect(() => {
    return () => {
      if (cardLengthWarningCharacterIdRef.current) {
        toast.dismiss(cardLengthWarningCharacterIdRef.current);
        cardLengthWarningCharacterIdRef.current = null;
      }
    };
  }, []);

  const handleSave = async () => {
    if (!characterId || !formData) return false;
    if (isAvatarUploadInFlight()) {
      toast.error("Wait for the current avatar change to finish before saving.");
      return false;
    }
    setSaving(true);
    const editRevisionAtSaveStart = editRevisionRef.current;
    try {
      await updateCharacter.mutateAsync({
        id: characterId,
        data: formData as unknown as Record<string, unknown>,
        comment: characterComment,
        memoryPersistence,
      });
      if (editRevisionRef.current === editRevisionAtSaveStart) {
        setDirtyState(false);
      }
      return true;
    } catch (err) {
      console.error("[CharacterEditor] Save failed:", err);
      toast.error(getErrorMessage(err, "Failed to save character. Check the console for details."));
      return false;
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async () => {
    if (!characterId) return;
    if (
      !(await showConfirmDialog({
        title: "Delete Character",
        message: "Are you sure you want to delete this character?",
        confirmLabel: "Delete",
        tone: "destructive",
      }))
    ) {
      return;
    }
    await deleteCharacter.mutateAsync(characterId);
    closeDetail();
  };

  const handleRemoveAvatar = async () => {
    if (
      !(await showConfirmDialog({
        title: "Remove Avatar",
        message: "Remove this character's avatar?",
        confirmLabel: "Remove",
        tone: "destructive",
      }))
    ) {
      return;
    }
    await removeAvatar();
  };

  const handleClose = useCallback(() => {
    if (avatarUploading) {
      toast.error("Wait for the current avatar change to finish.");
      return;
    }
    if (dirty) {
      setShowUnsavedWarning(true);
      return;
    }
    closeDetail();
  }, [avatarUploading, dirty, closeDetail]);

  const forceClose = useCallback(() => {
    if (avatarUploading) {
      toast.error("Wait for the current avatar change to finish.");
      return;
    }
    setShowUnsavedWarning(false);
    setDirtyState(false);
    closeDetail();
  }, [avatarUploading, closeDetail, setDirtyState]);

  const handleStartChat = () => {
    if (!characterId || !formData) return;
    startChatFromCharacter({
      characterId,
      characterName: formData.name,
      mode: "conversation",
    });
  };

  const handleDuplicate = () => {
    if (!characterId) return;
    duplicateCharacter.mutate(characterId, {
      onSuccess: () => {
        toast.success("Character duplicated");
      },
    });
  };

  if (isLoading || !formData) {
    return (
      <div className="flex flex-1 items-center justify-center">
        <div className="flex flex-col items-center gap-3">
          <div className="shimmer h-16 w-16 rounded-2xl" />
          <div className="shimmer h-3 w-32 rounded-full" />
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-1 flex-col overflow-hidden bg-[var(--background)]">
      <CharacterEditorDialogs
        characterId={characterId}
        formData={formData}
        avatarPreview={avatarPreview}
        imageConnections={imageConnections}
        exportDialogOpen={exportDialogOpen}
        avatarGeneratorOpen={avatarGeneratorOpen}
        onCloseExportDialog={() => setExportDialogOpen(false)}
        onCloseAvatarGenerator={() => setAvatarGeneratorOpen(false)}
        onUseGeneratedAvatar={handleGeneratedAvatar}
      />

      <CharacterEditorHeader
        characterId={characterId}
        formData={formData}
        characterComment={characterComment}
        avatarPreview={avatarPreview}
        avatarUploading={avatarUploading}
        dirty={dirty}
        imageGenerationAvailable={imageGenerationAvailable}
        isImportingPersona={isImportingPersona}
        isStartingChat={isStartingChat}
        saving={saving}
        onAvatarUpload={handleAvatarUpload}
        onBack={handleClose}
        onCommentChange={(comment) => {
          setCharacterComment(comment);
          markDirty();
        }}
        onDelete={handleDelete}
        onDuplicate={handleDuplicate}
        onExport={() => setExportDialogOpen(true)}
        onGenerateAvatar={() => setAvatarGeneratorOpen(true)}
        onImportAsPersona={handleImportAsPersona}
        onNameChange={(name) => updateField("name", name)}
        onRemoveAvatar={handleRemoveAvatar}
        onSave={handleSave}
        onStartChat={handleStartChat}
        onToggleFavorite={() => updateExtension("fav", !formData.extensions.fav)}
      />

      {showUnsavedWarning && (
        <CharacterEditorUnsavedWarning
          avatarUploading={avatarUploading}
          saving={saving}
          onDiscard={forceClose}
          onKeepEditing={() => setShowUnsavedWarning(false)}
          onSaveAndClose={async () => {
            if (await handleSave()) {
              closeDetail();
            }
          }}
        />
      )}

      {/* ── Body: Tabs + Content ── */}
      <div className="flex flex-1 overflow-hidden @max-5xl:flex-col">
        <CharacterEditorTabRail activeTab={activeTab} onTabChange={setActiveTab} />
        <CharacterEditorTabContent
          activeTab={activeTab}
          characterId={characterId}
          formData={formData}
          characterComment={characterComment}
          memoryPersistence={memoryPersistence}
          onMemoryPersistenceChange={(value) => {
            setMemoryPersistence(value);
            markDirty();
          }}
          updateField={updateField}
          updateExtension={updateExtension}
          newTag={newTag}
          setNewTag={setNewTag}
          avatarPreview={avatarPreview}
          imageConnections={imageConnections}
        />
      </div>
    </div>
  );
}
