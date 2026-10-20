import { useId, useState, type ReactNode } from "react";
import { cn } from "../../../../shared/lib/utils";
import { FanficButton, fanficInputClass } from "./fanfic-ui";

export interface FanficComboOption {
  id: string;
  label: string;
  detail?: string;
}

/**
 * A text box with a list of picks under it. Arrow keys move through the list and Enter takes the highlighted
 * pick; with nothing highlighted, Enter (or the Add button) hands the typed text to `onAddText` when the box
 * takes free text. The caller filters `options` against `value`.
 */
export function FanficCombobox({
  inputId,
  value,
  onValueChange,
  options,
  onPick,
  onAddText,
  placeholder,
  inputAriaLabel,
  listLabel,
  emptyText,
  icon,
}: {
  inputId: string;
  value: string;
  onValueChange: (value: string) => void;
  options: FanficComboOption[];
  onPick: (option: FanficComboOption) => void;
  /** Free text the requester typed; omit for a box that only picks from the list. */
  onAddText?: (text: string) => void;
  placeholder: string;
  inputAriaLabel?: string;
  listLabel: string;
  /** Shown in the open list when nothing matches. */
  emptyText?: string;
  icon?: ReactNode;
}) {
  const listId = useId();
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(-1);
  const highlighted = active >= 0 && active < options.length ? active : -1;
  const showList = open && (options.length > 0 || (!!emptyText && !onAddText));
  const typed = value.trim();

  const close = () => {
    setOpen(false);
    setActive(-1);
  };
  const pick = (option: FanficComboOption) => {
    onPick(option);
    onValueChange("");
    close();
  };
  const addText = () => {
    if (!onAddText || !typed) return;
    onAddText(typed);
    onValueChange("");
    close();
  };

  return (
    <div className="relative flex gap-1.5">
      <input
        id={inputId}
        role="combobox"
        aria-label={inputAriaLabel}
        aria-autocomplete="list"
        aria-expanded={showList}
        aria-controls={listId}
        aria-activedescendant={showList && highlighted >= 0 ? `${listId}-${highlighted}` : undefined}
        className={cn(fanficInputClass, "min-w-0 flex-1")}
        value={value}
        placeholder={placeholder}
        autoComplete="off"
        onChange={(event) => {
          onValueChange(event.target.value);
          setActive(-1);
          setOpen(true);
        }}
        onFocus={() => setOpen(true)}
        onClick={() => setOpen(true)}
        onBlur={close}
        onKeyDown={(event) => {
          if (event.key === "ArrowDown") {
            event.preventDefault();
            setOpen(true);
            setActive(Math.min(highlighted + 1, options.length - 1));
          } else if (event.key === "ArrowUp") {
            event.preventDefault();
            setActive(Math.max(highlighted - 1, -1));
          } else if (event.key === "Enter") {
            event.preventDefault();
            if (showList && highlighted >= 0) pick(options[highlighted]!);
            else addText();
          } else if (event.key === "Escape" && showList) {
            event.preventDefault();
            event.stopPropagation();
            close();
          }
        }}
      />
      {onAddText && (
        <FanficButton onClick={addText} disabled={!typed} className="min-h-10 shrink-0 px-3.5">
          Add
        </FanficButton>
      )}
      <div
        id={listId}
        role="listbox"
        aria-label={listLabel}
        hidden={!showList}
        className="absolute left-0 right-0 top-full z-30 mt-1 max-h-64 overflow-y-auto rounded-xl border border-[var(--border)] bg-[var(--popover)] p-1 shadow-xl backdrop-blur-md"
      >
        {options.map((option, index) => (
          <div
            key={option.id}
            id={`${listId}-${index}`}
            role="option"
            aria-selected={index === highlighted}
            // Keep focus in the box so the list doesn't close before the click lands.
            onMouseDown={(event) => event.preventDefault()}
            onClick={() => pick(option)}
            onMouseEnter={() => setActive(index)}
            className={cn(
              "flex min-h-10 cursor-pointer items-center gap-2 rounded-lg px-2.5 py-1.5 text-sm text-[var(--foreground)]",
              index === highlighted && "bg-[var(--primary)]/12",
            )}
          >
            {icon && (
              <span className="shrink-0 text-[var(--muted-foreground)]" aria-hidden="true">
                {icon}
              </span>
            )}
            <span className="min-w-0 flex-1">
              <span className="block truncate font-medium">{option.label}</span>
              {option.detail && (
                <span className="block truncate text-xs text-[var(--muted-foreground)]">{option.detail}</span>
              )}
            </span>
          </div>
        ))}
        {options.length === 0 && emptyText && (
          <p className="px-2.5 py-1.5 text-xs text-[var(--muted-foreground)]">{emptyText}</p>
        )}
      </div>
    </div>
  );
}
