import { useState } from "react";
import { cn } from "../../../lib/utils";
import {
  CUSTOM_PARAMETERS_ERRORS,
  formatCustomParameters,
  readCustomParametersText,
  type CustomParametersRejection,
} from "./custom-parameters-text";
import { FieldLabel, TEXT_AREA_CLASS } from "./field-parts";

const LABEL = "Custom Parameters";
const HELP =
  "Optional raw JSON object merged into the provider request body. This can break requests if the provider does not support a key.";
const HINT = "Must be a JSON object. Use lowercase true, false, and null.";
const PLACEHOLDER = '{ "thinking": true }';

interface CustomParametersFieldProps {
  value: Record<string, unknown>;
  onCommit: (next: Record<string, unknown>) => void;
}

/**
 * A JSON draft committed on leaving the field (Ctrl/Cmd+Enter leaves it). While the field isn't focused the text
 * follows the stored value, except after a rejected draft: that text and its error stay until the next edit, or
 * until the stored value changes from outside.
 */
export function CustomParametersField({ value, onCommit }: CustomParametersFieldProps) {
  const stored = formatCustomParameters(value);
  const [draft, setDraft] = useState(stored);
  const [focused, setFocused] = useState(false);
  const [rejection, setRejection] = useState<CustomParametersRejection | null>(null);
  // Compared as text: callers rebuild an equal object on every render, which isn't a change.
  const [seenStored, setSeenStored] = useState(stored);
  if (!focused && stored !== seenStored) {
    setSeenStored(stored);
    setDraft(stored);
    setRejection(null);
  }

  const commit = () => {
    setFocused(false);
    setSeenStored(stored);
    const result = readCustomParametersText(draft);
    if (result.ok) {
      setDraft(stored);
      setRejection(null);
      onCommit(result.value);
    } else {
      setRejection(result.reason);
    }
  };

  return (
    <div>
      <FieldLabel label={LABEL} help={HELP} />
      <textarea
        aria-label={LABEL}
        rows={3}
        spellCheck={false}
        value={draft}
        placeholder={focused ? "" : PLACEHOLDER}
        onFocus={() => setFocused(true)}
        onChange={(event) => {
          setDraft(event.target.value);
          setRejection(null);
        }}
        onBlur={commit}
        onKeyDown={(event) => {
          if (event.key === "Enter" && (event.ctrlKey || event.metaKey)) event.currentTarget.blur();
        }}
        className={cn(TEXT_AREA_CLASS, "resize-y font-mono")}
      />
      <p className={cn("mt-1 text-[0.5625rem]", rejection ? "text-amber-500" : "text-[var(--muted-foreground)]/70")}>
        {rejection ? CUSTOM_PARAMETERS_ERRORS[rejection] : HINT}
      </p>
    </div>
  );
}
