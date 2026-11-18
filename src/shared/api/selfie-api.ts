import { regenerateSelfieAttachment } from "../../engine/generation/connected-commands";
import { integrationGateway } from "./integration-gateway";
import { storageApi } from "./storage-api";
import { visualAssetsApi } from "./visual-assets-api";

export const selfieApi = {
  /** A new picture for a selfie on a message; the old one is replaced only once the new one is saved. */
  regenerate: (input: {
    chatId: string;
    messageId: string;
    attachment: { galleryId?: string | null; url?: string | null };
  }) =>
    regenerateSelfieAttachment({
      storage: storageApi,
      integrations: integrationGateway,
      visuals: visualAssetsApi,
      ...input,
    }),
};
