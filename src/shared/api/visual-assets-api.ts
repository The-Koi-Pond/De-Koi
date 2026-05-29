import type { VisualAssetGateway } from "../../engine/capabilities/visual-assets";
import { gameAssetsApi } from "./assets-api";
import { spriteApi } from "./image-generation-api";
import { backgroundsApi } from "./settings-assets-api";

export const visualAssetsApi: VisualAssetGateway = {
  listSprites: (characterId) => spriteApi.list(characterId),
  listBackgrounds: () => backgroundsApi.list(),
  gameAssetsManifest: () => gameAssetsApi.manifest(),
};
