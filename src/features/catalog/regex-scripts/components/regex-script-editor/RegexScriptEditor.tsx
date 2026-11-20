import { SaveErrorBanner, UnsavedChangesBar } from "../../../../../shared/components/ui/ExplicitSaveChrome";
import { AboutCard } from "./AboutCard";
import { AdvancedOptionsGroup } from "./AdvancedOptionsGroup";
import { EditorHeader } from "./EditorHeader";
import { LiveTestGroup } from "./LiveTestGroup";
import { FindPatternGroup, RegexFlagsGroup, ReplaceWithGroup } from "./PatternFields";
import { ApplyToGroup, CharacterScopeGroup, TrimStringsGroup } from "./TargetFields";
import { useRegexScriptEditor } from "./use-regex-script-editor";

/** The full-page editor for the regex script in the UI store's `regexDetailId` (`__new__` for a new one). */
export function RegexScriptEditor() {
  const editor = useRegexScriptEditor();

  if (!editor.found) {
    return (
      <div className="flex flex-1 items-center justify-center text-sm text-[var(--muted-foreground)]">
        Regex script not found.
      </div>
    );
  }

  return (
    <div className="flex min-w-0 flex-1 flex-col overflow-hidden bg-[var(--background)]">
      <EditorHeader editor={editor} />
      {editor.leaving && (
        <UnsavedChangesBar
          saving={editor.saving}
          onKeepEditing={editor.keepEditing}
          onDiscard={editor.discard}
          onSaveAndClose={editor.saveAndClose}
        />
      )}
      <SaveErrorBanner error={editor.bannerError} onDismiss={editor.dismissError} />
      <div className="flex-1 overflow-y-auto p-6">
        <div className="mx-auto max-w-3xl space-y-6">
          <FindPatternGroup editor={editor} />
          <ReplaceWithGroup editor={editor} />
          <RegexFlagsGroup editor={editor} />
          <ApplyToGroup editor={editor} />
          <CharacterScopeGroup editor={editor} />
          <TrimStringsGroup editor={editor} />
          <AdvancedOptionsGroup editor={editor} />
          <LiveTestGroup editor={editor} />
          <AboutCard scriptId={editor.scriptId} />
        </div>
      </div>
    </div>
  );
}
