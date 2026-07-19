// ──────────────────────────────────────────────
// Mobile shell actions shared between app shell and mode surfaces
// ──────────────────────────────────────────────
import { createContext, useContext, useState, type ReactNode } from "react";
import {
  isShellPanelDestination,
  SHELL_PANEL_ITEMS,
  type ShellNavItem,
} from "./shell-navigation";
export { SHELL_ACCENT_STYLES } from "./shell-navigation";

interface TopBarActionsContextValue {
  rightSlot: ReactNode;
  setRightSlot: (slot: ReactNode) => void;
}

const TopBarActionsContext = createContext<TopBarActionsContextValue>({
  rightSlot: null,
  setRightSlot: () => {},
});

export function TopBarActionsProvider({ children }: { children: ReactNode }) {
  const [rightSlot, setRightSlot] = useState<ReactNode>(null);
  return (
    <TopBarActionsContext.Provider value={{ rightSlot, setRightSlot }}>
      {children}
    </TopBarActionsContext.Provider>
  );
}

export function useTopBarActions() {
  return useContext(TopBarActionsContext);
}

export function createMobileToolsPanels(items: readonly ShellNavItem[]) {
  return items.map(({ destination, ...item }) => {
    if (!isShellPanelDestination(destination)) {
      throw new Error(`Invalid mobile tools panel destination: ${destination}`);
    }

    return { ...item, panel: destination };
  });
}

export const TOOLS_PANELS = createMobileToolsPanels(SHELL_PANEL_ITEMS);

export type MobileToolsPanel = typeof TOOLS_PANELS[number]["panel"];
