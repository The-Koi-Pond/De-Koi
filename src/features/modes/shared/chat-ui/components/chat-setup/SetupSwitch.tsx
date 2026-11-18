import { useId } from "react";
import { cn } from "../../../../../../shared/lib/utils";

/** An on/off setting that announces itself as a switch named by its label (decision 2). */
export function SetupSwitch({
  label,
  description,
  checked,
  disabled = false,
  onChange,
}: {
  label: string;
  description?: string;
  checked: boolean;
  disabled?: boolean;
  onChange: (checked: boolean) => void;
}) {
  const labelId = useId();
  const descriptionId = useId();

  return (
    <div className="flex items-start justify-between gap-3">
      <div className="min-w-0">
        <p id={labelId} className="text-xs font-medium text-[var(--foreground)]">
          {label}
        </p>
        {description && (
          <p id={descriptionId} className="mt-0.5 text-[0.6875rem] text-[var(--muted-foreground)]">
            {description}
          </p>
        )}
      </div>
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        aria-labelledby={labelId}
        aria-describedby={description ? descriptionId : undefined}
        disabled={disabled}
        onClick={() => onChange(!checked)}
        className={cn(
          "relative mt-0.5 inline-flex h-5 w-9 shrink-0 items-center rounded-full transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--primary)] disabled:opacity-50",
          checked ? "bg-[var(--primary)]" : "bg-[var(--border)]",
        )}
      >
        <span
          aria-hidden="true"
          className={cn(
            "inline-block h-4 w-4 rounded-full bg-white shadow transition-transform",
            checked ? "translate-x-[1.125rem]" : "translate-x-0.5",
          )}
        />
      </button>
    </div>
  );
}
