import { describe, expect, it } from "vitest";
import type { StorageGateway } from "../../capabilities/storage";
import { resolveImageAttachmentDelivery } from "./image-attachments";

const storage = {
  resolveImageAttachmentDataUrl: async () => null,
} as unknown as StorageGateway;

function oversizedImageDataUrl(): string {
  return `data:image/png;base64,${"a".repeat(9 * 1024 * 1024)}`;
}

describe("resolveImageAttachmentDelivery", () => {
  it("warns when an image is too large for provider delivery", async () => {
    const result = await resolveImageAttachmentDelivery(storage, [
      {
        type: "image/png",
        data: oversizedImageDataUrl(),
        filename: "large.png",
        name: "large.png",
      },
    ]);

    expect(result.images).toEqual([]);
    expect(result.warnings).toEqual([
      expect.objectContaining({
        code: "image_attachment_delivery",
        message: expect.stringContaining("large.png"),
      }),
    ]);
  });
});
