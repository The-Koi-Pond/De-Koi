// ──────────────────────────────────────────────
// Mobile shell actions shared between app shell and mode surfaces
// ──────────────────────────────────────────────
import { createContext, useContext, useState, type ReactNode } from "react";
import { SHELL_PANEL_ITEMS } from "./shell-navigation";
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

export const TOOLS_PANELS = SHELL_PANEL_ITEMS.map(({ destination, ...item }) => ({ ...item, panel: destination }));

export type MobileToolsPanel = typeof TOOLS_PANELS[number]["panel"];
