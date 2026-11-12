import { useChatStore } from "../../shared/stores/chat.store";
import { useUIStore } from "../../shared/stores/ui.store";

/**
 * True while Home is what's on screen: no chat, no Deki-senpai, no library
 * detail, browser or right panel open. Shared by the title bar's Home button
 * and the Pond theme's navigation rail. With `panelsBesidePage`, open panels
 * don't count: in the rail layout they open in a column beside the page
 * (or as a drawer over it), so Home is still what the page shows.
 */
export function useIsHomeSurface(dekiOpen: boolean, { panelsBesidePage = false } = {}): boolean {
  const activeChatId = useChatStore((s) => s.activeChatId);
  const hasOpenSurface = useUIStore((s) =>
    Boolean(
      s.characterDetailId ||
      s.lorebookDetailId ||
      s.presetDetailId ||
      s.connectionDetailId ||
      s.agentDetailId ||
      s.toolDetailId ||
      s.personaDetailId ||
      s.regexDetailId ||
      s.characterLibraryOpen ||
      s.botBrowserOpen ||
      (s.rightPanelOpen && !panelsBesidePage),
    ),
  );
  return !dekiOpen && !activeChatId && !hasOpenSurface;
}
