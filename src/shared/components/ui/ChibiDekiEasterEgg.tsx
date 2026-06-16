import { useEffect } from "react";
import { X } from "lucide-react";
import { toast } from "sonner";
import { useUIStore } from "../../stores/ui.store";

const CHIBI_DEKI_IMAGE = "/icon-192.png";
const CHIBI_DEKI_SEEN_KEY = "marinara:chibi-deki-toast-seen";
const CHIBI_DEKI_ROLL_CHANCE = 0.001;
const CHIBI_DEKI_ROLL_COOLDOWN_MS = 3_000;
const CHIBI_DEKI_TOAST_DURATION_MS = 18_000;

function hasSeenChibiDeki() {
  try {
    return window.sessionStorage.getItem(CHIBI_DEKI_SEEN_KEY) === "true";
  } catch {
    return false;
  }
}

function rememberChibiDeki() {
  try {
    window.sessionStorage.setItem(CHIBI_DEKI_SEEN_KEY, "true");
  } catch {
    // Ignore storage failures; the toast is still allowed to appear.
  }
}

function showChibiDekiToast() {
  rememberChibiDeki();
  toast.custom(
    (toastId) => (
      <div className="relative flex max-w-[360px] gap-3 rounded-xl border border-[var(--border)] bg-[var(--card)] p-3 pr-9 text-[var(--foreground)] shadow-lg">
        <button
          type="button"
          aria-label="Dismiss Chibi Deki-senpai"
          className="absolute right-2 top-2 rounded-md p-1 text-[var(--muted-foreground)] transition-colors hover:bg-[var(--secondary)] hover:text-[var(--foreground)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)]"
          onClick={() => toast.dismiss(toastId)}
        >
          <X size={14} />
        </button>
        <img
          src={CHIBI_DEKI_IMAGE}
          alt="Chibi Deki-senpai"
          className="h-24 w-20 shrink-0 object-contain"
          onError={(event) => {
            event.currentTarget.hidden = true;
          }}
        />
        <div className="space-y-2 text-sm leading-relaxed">
          <p>If you see this mark while scrolling through De-Koi, you've been visited by the rare Deki-senpai!</p>
          <p>Good luck and fortune will come to you very soon. Make sure to say "thank you, Deki-senpai!"</p>
          <p>Remember, you are loved and appreciated. Cheers!</p>
        </div>
      </div>
    ),
    { duration: CHIBI_DEKI_TOAST_DURATION_MS },
  );
}

export function ChibiDekiEasterEgg() {
  const enabled = useUIStore((state) => state.chibiDekiEnabled);

  useEffect(() => {
    if (!enabled) return;

    let seen = hasSeenChibiDeki();
    let lastRollAt = 0;

    const handleScroll = () => {
      if (seen || document.visibilityState !== "visible") return;

      const now = Date.now();
      if (now - lastRollAt < CHIBI_DEKI_ROLL_COOLDOWN_MS) return;
      lastRollAt = now;

      if (Math.random() > CHIBI_DEKI_ROLL_CHANCE) return;

      seen = true;
      showChibiDekiToast();
    };

    const scrollOptions: AddEventListenerOptions = { capture: true, passive: true };
    document.addEventListener("scroll", handleScroll, scrollOptions);

    return () => {
      document.removeEventListener("scroll", handleScroll, scrollOptions);
    };
  }, [enabled]);

  return null;
}
