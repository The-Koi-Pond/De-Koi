import { useCallback, useEffect, useRef, useState } from "react";
import { useChatStore } from "../../../../../shared/stores/chat.store";
import {
  DISCOVERY_APP_EVENT,
  type DiscoveryAppEventDetail,
} from "../../../../../shared/lib/discovery-navigation";

type IdleWindow = Window & {
  requestIdleCallback?: (callback: () => void, options?: { timeout?: number }) => number;
  cancelIdleCallback?: (handle: number) => void;
};

type PendingSetupOverlayOpen = {
  key: string;
  cancel: () => void;
};

function scheduleSetupOverlayOpen(run: () => void): () => void {
  if (typeof window === "undefined") {
    run();
    return () => {};
  }

  let canceled = false;
  let idleHandle: number | null = null;
  const idleWindow = window as IdleWindow;
  const frameHandle = window.requestAnimationFrame(() => {
    if (canceled) return;
    if (typeof idleWindow.requestIdleCallback === "function") {
      idleHandle = idleWindow.requestIdleCallback(
        () => {
          if (!canceled) run();
        },
        { timeout: 350 },
      );
      return;
    }
    idleHandle = window.setTimeout(() => {
      if (!canceled) run();
    }, 48);
  });

  return () => {
    canceled = true;
    window.cancelAnimationFrame(frameHandle);
    if (idleHandle != null) {
      if (typeof idleWindow.cancelIdleCallback === "function") idleWindow.cancelIdleCallback(idleHandle);
      else window.clearTimeout(idleHandle);
    }
  };
}

export function useChatOverlays(activeChatId: string) {
  const [settingsOpen, setSettingsOpenState] = useState(false);
  const [filesOpen, setFilesOpen] = useState(false);
  const [galleryOpen, setGalleryOpen] = useState(false);
  const [wizardOpen, setWizardOpen] = useState(false);
  const [spriteArrangeMode, setSpriteArrangeMode] = useState(false);
  const [newChatSetupChatId, setNewChatSetupChatId] = useState<string | null>(null);
  const [pendingDiscoverySection, setPendingDiscoverySection] = useState<string | null>(null);
  const pendingSetupOverlayOpenRef = useRef<PendingSetupOverlayOpen | null>(null);
  const pendingDiscoverySectionRef = useRef<string | null>(null);
  const pendingDiscoveryRevealRef = useRef<(() => void) | null>(null);

  const cancelPendingDiscoveryReveal = useCallback(() => {
    pendingDiscoveryRevealRef.current?.();
    pendingDiscoveryRevealRef.current = null;
  }, []);

  const setSettingsOpen = useCallback(
    (open: boolean) => {
      if (!open) {
        cancelPendingDiscoveryReveal();
        pendingDiscoverySectionRef.current = null;
        setPendingDiscoverySection(null);
      }
      setSettingsOpenState(open);
    },
    [cancelPendingDiscoveryReveal],
  );

  const newChatSetupIntent = useChatStore((state) => state.newChatSetupIntent);
  const shouldOpenSettings = useChatStore((state) => state.shouldOpenSettings);
  const shouldOpenWizard = useChatStore((state) => state.shouldOpenWizard);

  useEffect(() => {
    const handleDiscoveryAction = (event: Event) => {
      const detail = (event as CustomEvent<DiscoveryAppEventDetail>).detail;
      if (detail?.type !== "open-chat-destination") return;
      if (
        detail.destination !== "chat-settings" &&
        detail.destination !== "chat-settings-continuity" &&
        detail.destination !== "roleplay-context"
      ) {
        return;
      }
      const nextSection = detail.destination === "chat-settings-continuity" ? "chat-settings-continuity" : null;
      if (pendingDiscoverySectionRef.current !== nextSection) cancelPendingDiscoveryReveal();
      pendingDiscoverySectionRef.current = nextSection;
      setPendingDiscoverySection(nextSection);
      setSettingsOpen(true);
    };

    window.addEventListener(DISCOVERY_APP_EVENT, handleDiscoveryAction);
    return () => window.removeEventListener(DISCOVERY_APP_EVENT, handleDiscoveryAction);
  }, [cancelPendingDiscoveryReveal, setSettingsOpen]);

  useEffect(() => {
    if (!settingsOpen || !pendingDiscoverySection) return;
    const sectionId = pendingDiscoverySection;
    let canceled = false;
    let observer: MutationObserver | null = null;
    let timeout: number | null = null;

    const cancelReveal = () => {
      if (canceled) return;
      canceled = true;
      observer?.disconnect();
      if (timeout != null) window.clearTimeout(timeout);
      if (pendingDiscoveryRevealRef.current === cancelReveal) {
        pendingDiscoveryRevealRef.current = null;
      }
    };

    const revealSection = (): boolean => {
      if (canceled) return false;
      const element = document.getElementById(sectionId);
      if (!element) return false;
      element.scrollIntoView({ block: "start", behavior: "smooth" });
      cancelReveal();
      pendingDiscoverySectionRef.current = null;
      setPendingDiscoverySection(null);
      return true;
    };

    if (revealSection()) return;

    observer = new MutationObserver(() => {
      revealSection();
    });
    observer.observe(document.body, { childList: true, subtree: true });
    timeout = window.setTimeout(() => {
      cancelReveal();
      pendingDiscoverySectionRef.current = null;
      setPendingDiscoverySection(null);
    }, 1_000);
    pendingDiscoveryRevealRef.current = cancelReveal;

    return cancelReveal;
  }, [pendingDiscoverySection, settingsOpen]);

  const queueSetupOverlayOpen = useCallback((key: string, run: () => void, onCancel?: () => void): boolean => {
    if (pendingSetupOverlayOpenRef.current?.key === key) return false;
    pendingSetupOverlayOpenRef.current?.cancel();

    let settled = false;
    const cancelScheduledOpen = scheduleSetupOverlayOpen(() => {
      settled = true;
      pendingSetupOverlayOpenRef.current = null;
      run();
    });
    pendingSetupOverlayOpenRef.current = {
      key,
      cancel: () => {
        if (settled) return;
        settled = true;
        cancelScheduledOpen();
        if (pendingSetupOverlayOpenRef.current?.key === key) pendingSetupOverlayOpenRef.current = null;
        onCancel?.();
      },
    };
    return true;
  }, []);

  useEffect(() => {
    setSpriteArrangeMode(false);
    setNewChatSetupChatId(null);
  }, [activeChatId]);

  useEffect(
    () => () => {
      pendingSetupOverlayOpenRef.current?.cancel();
      pendingSetupOverlayOpenRef.current = null;
    },
    [activeChatId],
  );

  useEffect(() => {
    if (!activeChatId) return;

    const intent = newChatSetupIntent?.chatId === activeChatId ? newChatSetupIntent : null;
    if (intent) {
      setNewChatSetupChatId(intent.chatId);
      queueSetupOverlayOpen(`intent:${intent.chatId}`, () => {
        const consumed = useChatStore.getState().consumeNewChatSetupIntent(activeChatId);
        if (!consumed) {
          setNewChatSetupChatId(null);
          return;
        }

        setNewChatSetupChatId(consumed.chatId);
        if (consumed.openWizard) {
          if (consumed.shortcutMode) useChatStore.getState().setShouldOpenWizardInShortcutMode(true);
          setWizardOpen(true);
        } else if (consumed.openSettings) {
          setSettingsOpen(true);
        }
      }, () => {
        setNewChatSetupChatId((current) => (current === intent.chatId ? null : current));
      });
      return;
    }

    if (shouldOpenSettings && !newChatSetupIntent) {
      const clearLegacyFlags = () => {
        useChatStore.getState().setShouldOpenWizard(false);
        useChatStore.getState().setShouldOpenSettings(false);
      };
      const cancelLegacyOpen = () => {
        clearLegacyFlags();
        setNewChatSetupChatId(null);
      };
      queueSetupOverlayOpen(
        `legacy:${activeChatId}:${shouldOpenWizard ? "wizard" : "settings"}`,
        () => {
          if (shouldOpenWizard) setNewChatSetupChatId(activeChatId);
          if (shouldOpenWizard) setWizardOpen(true);
          else setSettingsOpen(true);
          clearLegacyFlags();
        },
        cancelLegacyOpen,
      );
    }
  }, [newChatSetupIntent, queueSetupOverlayOpen, setSettingsOpen, shouldOpenSettings, shouldOpenWizard, activeChatId]);

  return {
    settingsOpen,
    filesOpen,
    galleryOpen,
    wizardOpen,
    spriteArrangeMode,
    newChatSetupChatId,
    setSettingsOpen,
    setFilesOpen,
    setGalleryOpen,
    setWizardOpen,
    setSpriteArrangeMode,
    clearNewChatSetup: () => setNewChatSetupChatId(null),
    openSettings: () => setSettingsOpen(true),
    openFiles: () => setFilesOpen(true),
    openGallery: () => setGalleryOpen(true),
    closeSettings: () => setSettingsOpen(false),
    closeFiles: () => setFilesOpen(false),
    closeGallery: () => setGalleryOpen(false),
    finishWizard: () => {
      setWizardOpen(false);
      setSettingsOpen(true);
      setNewChatSetupChatId(null);
    },
    toggleSpriteArrange: () => setSpriteArrangeMode((current) => !current),
  };
}
