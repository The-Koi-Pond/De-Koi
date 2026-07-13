// ──────────────────────────────────────────────
// Onboarding Tutorial — first-time guided tour
// ──────────────────────────────────────────────
import { useState, useEffect, useCallback, useRef } from "react";
import { useUIStore } from "../../../../shared/stores/ui.store";
import { useChatStore } from "../../../../shared/stores/chat.store";
import { ChevronRight, ArrowRightLeft, X } from "lucide-react";

// ─── Step definitions ─────────────────────────

interface TourStep {
  /** data-tour attribute value of the element to highlight, or null for centered modal */
  target: string | null;
  title: string;
  body: string;
  /** Preferred side for the tooltip relative to the highlighted element */
  side?: "top" | "bottom" | "left" | "right";
  /** If set, show a special action button with this label */
  actionLabel?: string;
  /** Key used internally to trigger special step actions */
  actionKey?: string;
}

interface OnboardingTutorialProps {
  onShellInertResync: () => void;
}

export const ONBOARDING_TUTORIAL_STEPS: TourStep[] = [
  {
    target: null,
    title: "Welcome to De-Koi!",
    body: "This quick tour only points things out, and you can exit at any time. You can start it again later from Discover.",
  },
  {
    target: "sidebar-toggle",
    title: "Chats Sidebar",
    body: "This is where your conversations live. Create a chat, search your history, or return to something recent.",
    side: "right",
  },
  {
    target: "panel-buttons",
    title: "Workspace Navigation",
    body: "Use these labeled menus to open your Library, tools, Connections, Settings, and Discover. You do not need to learn everything now—open a section when your current task calls for it.",
    side: "bottom",
  },
  {
    target: "chat-area",
    title: "Main Workspace",
    body: "This is where your current Conversation, Roleplay, Game, or setup task appears. Home will guide you to the next useful action.",
    side: "left",
  },
  {
    target: null,
    title: "Ready to Explore",
    body: "Choose an experience on Home and follow the readiness checklist's Finish setup action if De-Koi needs anything first. Open Discover when you want to find another feature.\n\nFor diagnostics, support details, or bug reporting, open Help.",
  },
];

const STEPS = ONBOARDING_TUTORIAL_STEPS;

// ─── Spotlight overlay helpers ────────────────

interface Rect {
  top: number;
  left: number;
  width: number;
  height: number;
}

const PAD = 8; // px padding around the spotlight cutout
const FOCUSABLE_SELECTOR = [
  "a[href]",
  "button:not([disabled])",
  "textarea:not([disabled])",
  "input:not([disabled])",
  "select:not([disabled])",
  "[tabindex]:not([tabindex='-1'])",
].join(",");

function getFocusableElements(root: HTMLElement) {
  return Array.from(root.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR)).filter((element) => {
    if (element.closest("[inert]")) return false;
    const style = window.getComputedStyle(element);
    return style.display !== "none" && style.visibility !== "hidden";
  });
}

function setInert(element: Element, inert: boolean) {
  element.toggleAttribute("inert", inert);
  (element as HTMLElement & { inert?: boolean }).inert = inert;
}

interface InertSnapshot {
  element: Element;
  hadInertAttribute: boolean;
  inertProperty: boolean;
}

function applyShellInertExceptTutorial(root: HTMLElement): () => void {
  const shell = root.closest('[data-component="AppShell"]');
  if (!shell) return () => {};

  const snapshots: InertSnapshot[] = [];
  const inertedElements = new Set<Element>();

  const apply = (element: Element) => {
    if (inertedElements.has(element)) return;
    inertedElements.add(element);
    snapshots.push({
      element,
      hadInertAttribute: element.hasAttribute("inert"),
      inertProperty: Boolean((element as HTMLElement & { inert?: boolean }).inert),
    });
    setInert(element, true);
  };

  const applyOutsideRoot = (element: Element) => {
    if (element === root || root.contains(element)) return;

    if (element.contains(root)) {
      for (const child of Array.from(element.children)) {
        applyOutsideRoot(child);
      }
      return;
    }

    apply(element);
  };

  for (const child of Array.from(shell.children)) {
    applyOutsideRoot(child);
  }

  const observer = new MutationObserver((mutations) => {
    for (const mutation of mutations) {
      for (const node of Array.from(mutation.addedNodes)) {
        if (node instanceof Element) applyOutsideRoot(node);
      }
    }
  });
  observer.observe(shell, { childList: true, subtree: true });

  return () => {
    observer.disconnect();
    for (const { element, hadInertAttribute, inertProperty } of snapshots) {
      if (hadInertAttribute) {
        element.setAttribute("inert", "");
      } else {
        element.removeAttribute("inert");
      }
      (element as HTMLElement & { inert?: boolean }).inert = inertProperty;
    }
  };
}

function isVisibleTourTarget(element: Element) {
  const rect = element.getBoundingClientRect();
  if (rect.width <= 0 || rect.height <= 0) return false;
  const style = window.getComputedStyle(element);
  return style.display !== "none" && style.visibility !== "hidden";
}

function getTargetRect(target: string): Rect | null {
  const matches = Array.from(document.querySelectorAll(`[data-tour="${target}"]`));
  const el = matches.find(isVisibleTourTarget) ?? matches[0];
  if (!el) return null;
  const r = el.getBoundingClientRect();
  return { top: r.top, left: r.left, width: r.width, height: r.height };
}

// ─── Tooltip position ─────────────────────────

function computeTooltipStyle(rect: Rect, side: "top" | "bottom" | "left" | "right" = "right"): React.CSSProperties {
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  const isMobile = vw < 640;
  const VIEWPORT_MARGIN = isMobile ? 12 : 16;
  const TOOLTIP_W = isMobile ? Math.min(vw - VIEWPORT_MARGIN * 2, 320) : Math.min(320, vw - VIEWPORT_MARGIN * 2);
  const GAP = isMobile ? 8 : 16;
  const available = {
    right: vw - (rect.left + rect.width + GAP + PAD) - VIEWPORT_MARGIN,
    left: rect.left - GAP - PAD - VIEWPORT_MARGIN,
    bottom: vh - (rect.top + rect.height + GAP + PAD) - VIEWPORT_MARGIN,
    top: rect.top - GAP - PAD - VIEWPORT_MARGIN,
  };

  // On small screens, always center horizontally and position below target
  if (isMobile) {
    const top = Math.min(rect.top + rect.height + GAP + PAD, vh * 0.55);
    return {
      position: "fixed",
      top,
      left: (vw - TOOLTIP_W) / 2,
      width: TOOLTIP_W,
      maxHeight: `${Math.max(200, vh - top - VIEWPORT_MARGIN)}px`,
      overflowY: "auto" as const,
      overflowX: "hidden" as const,
      overscrollBehavior: "contain" as const,
    };
  }

  const minScrollableHeight = isMobile ? 220 : 340;
  const preferredVerticalSide = available.bottom >= available.top ? "bottom" : "top";
  let placement = side;

  if (side === "right" && available.right < TOOLTIP_W && available.left >= TOOLTIP_W) {
    placement = "left";
  } else if (side === "left" && available.left < TOOLTIP_W && available.right >= TOOLTIP_W) {
    placement = "right";
  } else if (side === "bottom" && available.bottom < minScrollableHeight && available.top >= minScrollableHeight) {
    placement = "top";
  } else if (side === "top" && available.top < minScrollableHeight && available.bottom >= minScrollableHeight) {
    placement = "bottom";
  } else if ((side === "right" || side === "left") && available.right < TOOLTIP_W && available.left < TOOLTIP_W) {
    placement = preferredVerticalSide;
  } else if (
    (side === "top" || side === "bottom") &&
    available.top < minScrollableHeight &&
    available.bottom < minScrollableHeight
  ) {
    placement = available.right >= available.left ? "right" : "left";
  }

  let maxHeight = vh - VIEWPORT_MARGIN * 2;

  let top = 0;
  let left = 0;

  if (placement === "right") {
    maxHeight = Math.max(minScrollableHeight, vh - VIEWPORT_MARGIN * 2);
    top = rect.top + rect.height / 2 - maxHeight / 2;
    left = rect.left + rect.width + GAP + PAD;
    if (left + TOOLTIP_W > vw - VIEWPORT_MARGIN) {
      left = rect.left - TOOLTIP_W - GAP - PAD;
    }
  } else if (placement === "left") {
    maxHeight = Math.max(minScrollableHeight, vh - VIEWPORT_MARGIN * 2);
    top = rect.top + rect.height / 2 - maxHeight / 2;
    left = rect.left - TOOLTIP_W - GAP - PAD;
    if (left < VIEWPORT_MARGIN) {
      left = rect.left + rect.width + GAP + PAD;
    }
  } else if (placement === "bottom") {
    maxHeight = Math.max(minScrollableHeight, Math.min(vh - VIEWPORT_MARGIN * 2, available.bottom));
    top = rect.top + rect.height + GAP + PAD;
    left = rect.left + rect.width / 2 - TOOLTIP_W / 2;
  } else {
    maxHeight = Math.max(minScrollableHeight, Math.min(vh - VIEWPORT_MARGIN * 2, available.top));
    top = rect.top - GAP - PAD - maxHeight;
    left = rect.left + rect.width / 2 - TOOLTIP_W / 2;
  }

  // Clamp within viewport
  left = Math.max(VIEWPORT_MARGIN, Math.min(left, vw - TOOLTIP_W - VIEWPORT_MARGIN));
  top = Math.max(VIEWPORT_MARGIN, Math.min(top, vh - maxHeight - VIEWPORT_MARGIN));

  return {
    position: "fixed",
    top,
    left,
    width: TOOLTIP_W,
    maxHeight: `${maxHeight}px`,
    overflowY: "auto",
    overflowX: "hidden",
    overscrollBehavior: "contain",
  };
}

// ─── Card content (shared between centered & positioned variants) ──

function TourCardContent({
  step,
  currentStep,
  isLast,
  onNext,
  onSkip,
  onAction,
}: {
  step: number;
  currentStep: TourStep;
  isLast: boolean;
  onNext: () => void;
  onSkip: () => void;
  onAction?: (key: string) => void;
}) {
  return (
    <>
      {/* Header */}
      <div className="mb-3 flex items-start justify-between gap-3">
        <h3 className="text-sm font-semibold text-[var(--foreground)]">{currentStep.title}</h3>
        <button
          type="button"
          onClick={onSkip}
          aria-label="Close tutorial"
          title="Close tutorial"
          className="-mr-1 -mt-1 flex h-10 w-10 shrink-0 items-center justify-center rounded-lg text-[var(--muted-foreground)] transition-colors hover:bg-[var(--secondary)] hover:text-[var(--foreground)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--primary)]"
        >
          <X size="1rem" />
        </button>
      </div>

      {/* Body */}
      <p className="mb-4 break-words text-xs leading-relaxed text-[var(--muted-foreground)]">
        {currentStep.body.split("\n").map((line, i, arr) => (
          <span key={i}>
            {line.split(/(\*\*[^*]+\*\*)/).map((part, j) =>
              part.startsWith("**") && part.endsWith("**") ? (
                <strong key={j} className="font-semibold text-[var(--foreground)]">
                  {part.slice(2, -2)}
                </strong>
              ) : (
                <span key={j}>{part}</span>
              ),
            )}
            {i < arr.length - 1 && <br />}
          </span>
        ))}
      </p>

      {step > 0 && (
        <p className="mb-3 text-xs font-medium leading-relaxed text-[var(--foreground)]">
          Use Next to move through this tour. You don't need to click the highlighted controls.
        </p>
      )}

      {/* Progress dots */}
      {step > 0 && (
        <div className="mb-3 flex items-center justify-center gap-1.5">
          {STEPS.slice(1).map((_, index) => {
            const stepIndex = index + 1;
            return (
              <div
                key={stepIndex}
                className={`h-1.5 rounded-full transition-all duration-300 ${
                  stepIndex === step
                    ? "w-4 bg-[var(--primary)]"
                    : stepIndex < step
                      ? "w-1.5 bg-[var(--primary)]/40"
                      : "w-1.5 bg-[var(--muted-foreground)]/20"
                }`}
              />
            );
          })}
        </div>
      )}

      {/* Action button */}
      {currentStep.actionLabel && currentStep.actionKey && onAction && (
        <button
          onClick={() => onAction(currentStep.actionKey!)}
          className="mb-3 flex w-full items-center justify-center gap-2 rounded-lg border border-[var(--primary)]/30 bg-[var(--primary)]/10 px-4 py-2 text-xs font-medium text-[var(--primary)] transition-all hover:bg-[var(--primary)]/20 active:scale-[0.98]"
        >
          <ArrowRightLeft size="0.8125rem" />
          {currentStep.actionLabel}
        </button>
      )}

      {/* Buttons */}
      <div className="flex items-center justify-between">
        <button
          onClick={onSkip}
          className="min-h-10 rounded-lg px-3 py-2 text-xs text-[var(--muted-foreground)] transition-colors hover:bg-[var(--secondary)] hover:text-[var(--foreground)]"
        >
          Exit tutorial
        </button>
        <button
          onClick={onNext}
          className="flex min-h-10 items-center gap-1.5 rounded-lg bg-[var(--primary)] px-4 py-2 text-xs font-medium text-[var(--primary-foreground)] shadow-sm transition-all hover:opacity-90 active:scale-95"
        >
          {step === 0 ? "Start tour" : isLast ? "Get Started" : "Next"}
          {!isLast && <ChevronRight size="0.75rem" />}
        </button>
      </div>
    </>
  );
}

// ─── Main component ───────────────────────────

export function OnboardingTutorial({ onShellInertResync }: OnboardingTutorialProps) {
  const open = useUIStore((s) => s.onboardingTourOpen);
  if (!open) return null;
  return <OnboardingTutorialInner onShellInertResync={onShellInertResync} />;
}

function OnboardingTutorialInner({ onShellInertResync }: OnboardingTutorialProps) {
  const setTourOpen = useUIStore((s) => s.setOnboardingTourOpen);
  const openRightPanel = useUIStore((s) => s.openRightPanel);
  const setSettingsTab = useUIStore((s) => s.setSettingsTab);
  const setSidebarOpen = useUIStore((s) => s.setSidebarOpen);

  const [step, setStep] = useState(0);
  const [targetRect, setTargetRect] = useState<Rect | null>(null);
  const rafRef = useRef<number>(0);
  const prevStepRef = useRef(0);
  const rootRef = useRef<HTMLDivElement>(null);
  const previousFocusRef = useRef<HTMLElement | null>(null);
  const onShellInertResyncRef = useRef(onShellInertResync);
  onShellInertResyncRef.current = onShellInertResync;

  const currentStep = STEPS[step];
  const isLast = step === STEPS.length - 1;

  // Set activeChatId without persisting to localStorage (demo-only)
  const setDemoChatActive = useCallback((id: string | null) => {
    useChatStore.setState({
      activeChatId: id,
      swipeIndex: new Map(),
      ...(!id && { activeChat: null }),
    });
  }, []);

  // ── Side-effects when step changes ──
  useEffect(() => {
    const prev = prevStepRef.current;
    prevStepRef.current = step;

    // Step 1 (sidebar): open sidebar on enter
    if (step === 1) {
      setSidebarOpen(true);
    }
    // Leaving step 1: close sidebar
    if (prev === 1 && step !== 1) {
      setSidebarOpen(false);
    }

    // Leaving step 3: deselect any demo chat.
    if (prev === 3 && step !== 3) {
      setDemoChatActive(null);
    }
  }, [step, setSidebarOpen, setDemoChatActive]);

  // Cleanup on unmount: deselect any demo chat.
  useEffect(() => {
    return () => {
      useChatStore.setState({ activeChatId: null, activeChat: null, swipeIndex: new Map() });
    };
  }, []);

  // Track the target element position (handles resize/scroll)
  const lastRectRef = useRef<Rect | null>(null);
  const updateRect = useCallback(() => {
    if (!currentStep?.target) {
      if (lastRectRef.current !== null) {
        lastRectRef.current = null;
        setTargetRect(null);
      }
      return;
    }
    const r = getTargetRect(currentStep.target);
    // Only update state if the rect actually changed
    const prev = lastRectRef.current;
    if (!r && prev) {
      lastRectRef.current = null;
      setTargetRect(null);
    } else if (
      r &&
      (!prev || r.top !== prev.top || r.left !== prev.left || r.width !== prev.width || r.height !== prev.height)
    ) {
      lastRectRef.current = r;
      setTargetRect(r);
    }
    rafRef.current = requestAnimationFrame(updateRect);
  }, [currentStep?.target]);

  useEffect(() => {
    updateRect();
    return () => cancelAnimationFrame(rafRef.current);
  }, [updateRect]);

  const finish = useCallback(() => setTourOpen(false), [setTourOpen]);

  useEffect(() => {
    const root = rootRef.current;
    if (!root) return;

    previousFocusRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const restoreShellInert = applyShellInertExceptTutorial(root);

    const focusFirstControl = () => {
      if (!root.contains(document.activeElement)) {
        const [firstFocusable] = getFocusableElements(root);
        (firstFocusable ?? root).focus();
      }
    };

    const frame = window.requestAnimationFrame(focusFirstControl);

    const handleKeyDown = (event: globalThis.KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        finish();
        return;
      }
      if (event.key !== "Tab") return;

      const focusable = getFocusableElements(root);
      if (focusable.length === 0) {
        event.preventDefault();
        root.focus();
        return;
      }

      const first = focusable[0]!;
      const last = focusable[focusable.length - 1]!;
      const active = document.activeElement;

      if (!root.contains(active)) {
        event.preventDefault();
        first.focus();
        return;
      }

      if (event.shiftKey && active === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && active === last) {
        event.preventDefault();
        first.focus();
      }
    };

    const handleFocusIn = (event: FocusEvent) => {
      if (event.target instanceof Node && root.contains(event.target)) return;
      const [firstFocusable] = getFocusableElements(root);
      (firstFocusable ?? root).focus();
    };

    document.addEventListener("keydown", handleKeyDown, true);
    document.addEventListener("focusin", handleFocusIn, true);
    return () => {
      window.cancelAnimationFrame(frame);
      document.removeEventListener("keydown", handleKeyDown, true);
      document.removeEventListener("focusin", handleFocusIn, true);
      restoreShellInert();
      onShellInertResyncRef.current();
      const previousFocus = previousFocusRef.current;
      if (previousFocus?.isConnected) previousFocus.focus();
    };
  }, [finish]);

  const handleAction = useCallback(
    (key: string) => {
      if (key === "import") {
        openRightPanel("settings");
        setSettingsTab("import");
        // Jump to last step instead of finishing
        setStep(STEPS.length - 1);
        return;
      }
    },
    [openRightPanel, setSettingsTab],
  );

  const next = useCallback(() => {
    if (isLast) {
      finish();
    } else {
      setStep((s) => s + 1);
    }
  }, [isLast, finish]);

  const isCentered = !currentStep.target || !targetRect;

  return (
    <div
      ref={rootRef}
      role="dialog"
      aria-label="Onboarding tutorial"
      aria-modal="true"
      tabIndex={-1}
      className="pointer-events-none fixed inset-0 z-[9999]"
    >
      {/* Pulsing highlight ring around the target element */}
      {targetRect && (
        <div
          className="pointer-events-none fixed rounded-xl ring-2 ring-[var(--primary)] animate-pulse"
          style={{
            top: targetRect.top - PAD,
            left: targetRect.left - PAD,
            width: targetRect.width + PAD * 2,
            height: targetRect.height + PAD * 2,
            boxShadow: "0 0 16px 4px color-mix(in srgb, var(--primary) 40%, transparent)",
          }}
        />
      )}

      {isCentered && <div className="pointer-events-none fixed inset-0 bg-[rgba(1,7,13,0.72)] backdrop-blur-[2px]" />}

      {/* Centered steps use a flex wrapper so transforms do not override CSS centering. */}
      {isCentered ? (
        <div className="pointer-events-none fixed inset-0 flex items-center justify-center">
          <div
            key={step}
            className="pointer-events-auto max-h-[90vh] overflow-x-hidden overflow-y-auto rounded-2xl border border-[color-mix(in_srgb,var(--primary)_36%,var(--border))] bg-[color-mix(in_srgb,var(--popover)_94%,black)] p-5 shadow-[0_24px_80px_rgba(0,0,0,0.62),0_0_0_1px_rgba(255,255,255,0.04)_inset] ring-1 ring-[var(--primary)]/30 animate-message-in"
            style={{ width: Math.min(380, window.innerWidth - 32) }}
          >
            <TourCardContent
              step={step}
              currentStep={currentStep}
              isLast={isLast}
              onNext={next}
              onSkip={finish}
              onAction={handleAction}
            />
          </div>
        </div>
      ) : (
        <div
          key={step}
          className="pointer-events-auto rounded-2xl border border-[var(--border)] bg-[var(--popover)] p-5 shadow-2xl ring-1 ring-[var(--primary)]/20 animate-message-in"
          style={computeTooltipStyle(targetRect!, currentStep.side)}
        >
          <TourCardContent
            step={step}
            currentStep={currentStep}
            isLast={isLast}
            onNext={next}
            onSkip={finish}
            onAction={handleAction}
          />
        </div>
      )}
    </div>
  );
}
