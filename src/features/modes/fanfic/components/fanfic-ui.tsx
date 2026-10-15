import type { ButtonHTMLAttributes, ReactNode } from "react";
import { cn } from "../../../../shared/lib/utils";

export const fanficInputClass =
  "w-full rounded-lg border border-[var(--border)] bg-[var(--secondary)]/45 px-3 py-2 text-sm text-[var(--foreground)] placeholder:text-[var(--muted-foreground)]/70 transition-colors focus:border-[var(--primary)]/60 focus:outline-none focus:ring-2 focus:ring-[var(--primary)]/25";

export function FanficSection({
  title,
  hint,
  children,
  className,
}: {
  title: string;
  hint?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section
      className={cn("rounded-xl border border-[var(--border)] bg-[var(--card)] p-3 shadow-sm sm:p-4", className)}
    >
      <div className="mb-3">
        <h3 className="text-sm font-bold text-[var(--foreground)]">{title}</h3>
        {hint && <p className="mt-0.5 text-xs leading-snug text-[var(--muted-foreground)]">{hint}</p>}
      </div>
      <div className="flex flex-col gap-3">{children}</div>
    </section>
  );
}

export function FanficField({
  label,
  htmlFor,
  hint,
  children,
}: {
  label: string;
  htmlFor?: string;
  hint?: ReactNode;
  children: ReactNode;
}) {
  return (
    <div className="flex min-w-0 flex-col gap-1">
      <label htmlFor={htmlFor} className="text-[0.8125rem] font-semibold text-[var(--foreground)]">
        {label}
      </label>
      {children}
      {hint && <p className="text-xs leading-snug text-[var(--muted-foreground)]">{hint}</p>}
    </div>
  );
}

export function FanficSegmented<T extends string>({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: T;
  options: Array<{ value: T; label: string; detail?: string }>;
  onChange: (value: T) => void;
}) {
  return (
    <div role="radiogroup" aria-label={label} className="grid grid-cols-2 gap-1.5 sm:grid-cols-4">
      {options.map((option) => {
        const selected = option.value === value;
        return (
          <button
            key={option.value}
            type="button"
            role="radio"
            aria-checked={selected}
            onClick={() => onChange(option.value)}
            className={cn(
              "flex min-h-11 flex-col items-start justify-center rounded-lg border px-2.5 py-1.5 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--primary)]/40",
              selected
                ? "border-[var(--primary)]/70 bg-[var(--primary)]/12 text-[var(--foreground)]"
                : "border-[var(--border)] bg-[var(--secondary)]/35 text-[var(--muted-foreground)] hover:text-[var(--foreground)]",
            )}
          >
            <span className="flex items-center gap-1 text-[0.8125rem] font-semibold">
              {selected && <span aria-hidden="true">✓</span>}
              {option.label}
            </span>
            {option.detail && <span className="text-[0.6875rem] leading-tight opacity-80">{option.detail}</span>}
          </button>
        );
      })}
    </div>
  );
}

type ButtonTone = "primary" | "ghost" | "danger";

const toneClass: Record<ButtonTone, string> = {
  primary:
    "bg-[var(--primary)] text-[var(--primary-foreground)] shadow-[0_2px_6px_rgba(0,0,0,0.2)] hover:-translate-y-px hover:shadow-[0_3px_8px_rgba(0,0,0,0.3)]",
  ghost: "border border-[var(--border)] bg-[var(--secondary)]/50 text-[var(--foreground)] hover:bg-[var(--accent)]/60",
  danger: "border border-red-400/35 bg-red-500/10 text-red-300 hover:bg-red-500/20",
};

export function FanficButton({
  tone = "ghost",
  className,
  children,
  type = "button",
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { tone?: ButtonTone }) {
  return (
    <button
      type={type}
      {...props}
      className={cn(
        "inline-flex min-h-9 items-center justify-center gap-1.5 rounded-lg px-3 py-1.5 text-[0.8125rem] font-semibold transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--primary)]/45 disabled:pointer-events-none disabled:opacity-50",
        toneClass[tone],
        className,
      )}
    >
      {children}
    </button>
  );
}

export function FanficChip({ children, tone = "default" }: { children: ReactNode; tone?: "default" | "rating" }) {
  return (
    <span
      className={cn(
        "inline-flex max-w-full items-center rounded-full border px-2 py-0.5 text-[0.6875rem] font-medium",
        tone === "rating"
          ? "border-[var(--primary)]/45 bg-[var(--primary)]/10 text-[var(--foreground)]"
          : "border-[var(--border)] bg-[var(--secondary)]/40 text-[var(--muted-foreground)]",
      )}
    >
      <span className="truncate">{children}</span>
    </span>
  );
}
