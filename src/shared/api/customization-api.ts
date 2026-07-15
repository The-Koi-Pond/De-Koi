import type { Theme } from "../../engine/contracts/types/theme";
import { invokeTauri } from "./tauri-client";

export const themesApi = {
  setActive: (themeId: string | null) => invokeTauri<Theme | null>("theme_set_active", { themeId }),
};
