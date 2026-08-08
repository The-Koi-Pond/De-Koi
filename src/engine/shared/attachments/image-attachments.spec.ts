import { describe, expect, it, vi } from "vitest";
import type { StorageGateway } from "../../capabilities/storage";
import { resolveImageAttachmentDeliveries, resolveImageAttachmentDelivery } from "./image-attachments";

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

  it("resolves independent references concurrently with a hard limit and stable output order", async () => {
    const releases: Array<() => void> = [];
    let active = 0;
    let maxActive = 0;
    let calls = 0;
    const controlledStorage = {
      async resolveImageAttachmentDataUrl(attachment: { galleryId?: string | null }) {
        calls += 1;
        active += 1;
        maxActive = Math.max(maxActive, active);
        await new Promise<void>((resolve) => releases.push(resolve));
        active -= 1;
        return `data:image/png;base64,${attachment.galleryId}`;
      },
    } as unknown as StorageGateway;
    const attachments = Array.from({ length: 6 }, (_, index) => ({
      type: "image/png",
      galleryId: `gallery-${index}`,
      filename: `${index}.png`,
    }));

    const pending = resolveImageAttachmentDeliveries(controlledStorage, [attachments]);
    await vi.waitFor(() => expect(calls).toBe(4));
    expect(maxActive).toBe(4);
    releases.splice(0).forEach((release) => release());
    await vi.waitFor(() => expect(calls).toBe(6));
    releases.splice(0).forEach((release) => release());

    await expect(pending).resolves.toEqual([
      {
        images: attachments.map((attachment) => `data:image/png;base64,${attachment.galleryId}`),
        warnings: [],
      },
    ]);
    expect(maxActive).toBe(4);
  });

  it("deduplicates references across groups while preserving each position and warning", async () => {
    const resolveImageAttachmentDataUrl = vi.fn(async (attachment: { galleryId?: string | null }) =>
      attachment.galleryId === "gallery-a" ? "data:image/png;base64,YQ==" : null,
    );
    const dedupeStorage = { resolveImageAttachmentDataUrl } as unknown as StorageGateway;
    const repeated = { type: "image/png", galleryId: "gallery-a", filename: "a.png" };

    const deliveries = await resolveImageAttachmentDeliveries(dedupeStorage, [
      [repeated, { type: "image/png", galleryId: "gallery-missing", filename: "missing.png" }],
      [repeated],
    ]);

    expect(resolveImageAttachmentDataUrl).toHaveBeenCalledTimes(2);
    expect(deliveries[0]?.images).toEqual(["data:image/png;base64,YQ=="]);
    expect(deliveries[0]?.warnings).toEqual([
      expect.objectContaining({ message: expect.stringContaining("missing.png") }),
    ]);
    expect(deliveries[1]?.images).toEqual(["data:image/png;base64,YQ=="]);
  });

  it("surfaces the earliest input failure rather than the fastest rejection", async () => {
    let releaseFirst!: () => void;
    const firstGate = new Promise<void>((resolve) => {
      releaseFirst = resolve;
    });
    const failingStorage = {
      async resolveImageAttachmentDataUrl(attachment: { galleryId?: string | null }) {
        if (attachment.galleryId === "first") {
          await firstGate;
          throw new Error("first failure");
        }
        throw new Error("second failure");
      },
    } as unknown as StorageGateway;

    const pending = resolveImageAttachmentDeliveries(failingStorage, [
      [
        { type: "image/png", galleryId: "first", filename: "first.png" },
        { type: "image/png", galleryId: "second", filename: "second.png" },
      ],
    ]);
    await Promise.resolve();
    releaseFirst();

    await expect(pending).rejects.toThrow("first failure");
  });
});
