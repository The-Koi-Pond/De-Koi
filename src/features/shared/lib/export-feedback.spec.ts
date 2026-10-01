import { describe, expect, it } from "vitest";
import { downloadPayloadFromApiValue } from "../../../shared/api/download-payload";
import { exportReportSummary } from "./export-feedback";

function payloadWith(report: unknown) {
  return downloadPayloadFromApiValue(
    { base64: "AA==", contentType: "application/zip", filename: "Sol.charx", report },
    "x",
  );
}

describe("export reports", () => {
  it("keeps the runtime report on the download payload", () => {
    const payload = payloadWith({
      included: [{ character: "Sol", asset: "Avatar" }],
      skipped: [{ character: "Sol", asset: "3 gallery image(s)", reason: "No gallery asset type." }, "junk"],
    });

    expect(payload.filename).toBe("Sol.charx");
    expect(payload.report).toEqual({
      included: [{ character: "Sol", asset: "Avatar" }],
      skipped: [{ character: "Sol", asset: "3 gallery image(s)", reason: "No gallery asset type." }],
    });
  });

  it("summarizes skipped items and names characters only for multi-character exports", () => {
    const single = payloadWith({
      included: [],
      skipped: [{ character: "Sol", asset: "Avatar", reason: "Use CHARX." }],
    });
    const many = payloadWith({
      included: [],
      skipped: [
        { character: "Sol", asset: "Avatar", reason: "Use CHARX." },
        { character: "Luna", asset: "Avatar", reason: "Use CHARX." },
        { character: "Luna", asset: "Banner", reason: "Use CHARX." },
        { character: "Mira", asset: "Avatar", reason: "Use CHARX." },
      ],
    });

    expect(exportReportSummary(single)).toBe("Avatar. Use CHARX.");
    expect(exportReportSummary(many)).toBe(
      "Sol: Avatar. Use CHARX.\nLuna: Avatar. Use CHARX.\nLuna: Banner. Use CHARX.\nand 1 more.",
    );
  });

  it("has nothing to say when everything was included", () => {
    expect(
      exportReportSummary(payloadWith({ included: [{ character: "Sol", asset: "Avatar" }], skipped: [] })),
    ).toBeNull();
    expect(exportReportSummary(downloadPayloadFromApiValue({ base64: "AA==" }, "x"))).toBeNull();
  });
});
