import type { ReactNode } from "react";

/**
 * A scene action button whose tooltip says why it is disabled. The tooltip sits on a wrapper too, since browsers
 * don't show one for a disabled button itself.
 */
export function SceneActionButton({
  children,
  className,
  disabledReason,
  onClick,
}: {
  children: ReactNode;
  className: string;
  /** Set while the action can't run; shown as its tooltip and description. */
  disabledReason?: string | null;
  onClick: () => void;
}) {
  const disabled = Boolean(disabledReason);
  return (
    <span className="inline-flex" title={disabledReason ?? undefined}>
      <button
        type="button"
        className={className}
        disabled={disabled}
        title={disabledReason ?? undefined}
        onClick={disabled ? undefined : onClick}
      >
        {children}
      </button>
    </span>
  );
}
