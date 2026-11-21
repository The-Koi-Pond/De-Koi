import type { CSSProperties, ReactNode } from "react";
import { cn } from "../../../lib/utils";
import { isGradient } from "./color-value";

const CHECKERBOARD =
  "bg-[repeating-conic-gradient(var(--border)_0_25%,var(--secondary)_0_50%)] bg-[length:0.5rem_0.5rem]";

function swatchStyle(value: string): CSSProperties | undefined {
  if (!value) return undefined;
  return isGradient(value) ? { background: value } : { backgroundColor: value };
}

/** A color sample: gradients as a background, other values as a background color, no value as a checkerboard. */
export function ColorSwatch({ value, className }: { value: string; className?: string }) {
  return (
    <span
      aria-hidden="true"
      data-swatch={value ? "color" : "empty"}
      className={cn("block shrink-0 border border-[var(--border)]", !value && CHECKERBOARD, className)}
      style={swatchStyle(value)}
    />
  );
}

export function SectionLabel({ children }: { children: ReactNode }) {
  return <span className="text-[0.625rem] text-[var(--muted-foreground)]">{children}</span>;
}

/** Ring and lift for the preset that equals the current value. */
export function presetClass(selected: boolean) {
  return cn(
    "transition-transform disabled:cursor-not-allowed disabled:opacity-50",
    selected
      ? "scale-110 ring-2 ring-[var(--primary)] ring-offset-1 ring-offset-[var(--card)]"
      : "enabled:hover:scale-105",
  );
}

export const FIELD_CLASS =
  "w-full min-w-0 rounded-lg border border-[var(--border)] bg-[var(--secondary)] font-mono text-[var(--foreground)] outline-none transition-colors placeholder:text-[var(--muted-foreground)]/60 focus:border-[var(--primary)]/60 disabled:cursor-not-allowed disabled:opacity-50";
