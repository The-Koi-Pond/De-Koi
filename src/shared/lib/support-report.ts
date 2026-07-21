import { APP_VERSION } from "../../engine/contracts/constants/defaults";
import { SUPPORT_LINKS } from "../config/support-links";
import { openExternalUrl } from "../api/external-link-api";

export type SupportReportSource = "crash-screen" | "health-diagnostics" | "help-hub" | "query-error" | "discover";

export type SupportPlatformInfo = {
  os: string;
  userAgent: string;
  language: string;
};

export type SupportReportInput = {
  source: SupportReportSource;
  reportText: string;
  appVersion?: string;
  platform?: SupportPlatformInfo;
};

export type BugReportUrlInput = SupportReportInput & {
  bugReportUrl?: string | null;
  includeReportText?: boolean;
};

function inferOs(platform: string, userAgent: string): string {
  const value = `${platform} ${userAgent}`.toLowerCase();
  if (value.includes("win")) return "Windows";
  if (value.includes("mac")) return "macOS";
  if (value.includes("linux") || value.includes("x11")) return "Linux";
  if (value.includes("android")) return "Android";
  if (value.includes("iphone") || value.includes("ipad") || value.includes("ios")) return "iOS";
  return "Unknown";
}

export function getBrowserPlatformInfo(): SupportPlatformInfo {
  if (typeof navigator === "undefined") {
    return { os: "Unknown", userAgent: "Unavailable", language: "Unknown" };
  }
  return {
    os: inferOs(navigator.platform || "", navigator.userAgent || ""),
    userAgent: navigator.userAgent || "Unavailable",
    language: navigator.language || "Unknown",
  };
}

export function buildSupportReportText({
  source,
  reportText,
  appVersion = APP_VERSION,
  platform = getBrowserPlatformInfo(),
}: SupportReportInput): string {
  return [
    "De-Koi support report",
    `Source: ${source}`,
    `App version: ${appVersion}`,
    `OS: ${platform.os}`,
    `Language: ${platform.language}`,
    `User agent: ${platform.userAgent}`,
    "",
    reportText,
  ].join("\n");
}

export function buildBugReportUrl({
  bugReportUrl = SUPPORT_LINKS.bugReportUrl,
  source,
  reportText,
  appVersion = APP_VERSION,
  platform = getBrowserPlatformInfo(),
  includeReportText = false,
}: BugReportUrlInput): string {
  if (!bugReportUrl) {
    throw new Error("Bug report URL is not configured.");
  }

  const url = new URL(bugReportUrl);
  url.searchParams.set("title", "[Bug]: ");
  const body = [
    "## What happened?",
    "",
    includeReportText
      ? "The support report could not be copied automatically, so De-Koi added it below. Add what you were trying to do."
      : "Paste the copied report below, then add what you were trying to do.",
    "",
    "## Environment",
    "",
    `- App version: ${appVersion}`,
    `- Source: ${source}`,
    `- OS: ${platform.os}`,
  ];
  if (includeReportText) {
    const maxInlineReportLength = 3500;
    const inlineReport = reportText.slice(0, maxInlineReportLength);
    body.push(
      "",
      "## Support report",
      "",
      "```text",
      inlineReport,
      reportText.length > maxInlineReportLength
        ? "[Report truncated by De-Koi because automatic copy was unavailable.]"
        : "",
      "```",
    );
  }
  url.searchParams.set("body", body.join("\n"));
  return url.toString();
}

function promptForManualReportCopy(reportText: string): boolean {
  const prompt = globalThis.window?.prompt;
  if (typeof prompt !== "function") return false;
  prompt.call(window, "Clipboard is unavailable. Copy this De-Koi support report before submitting:", reportText);
  return true;
}

export async function openBugReport(input: SupportReportInput): Promise<string> {
  const platform = input.platform ?? getBrowserPlatformInfo();
  const appVersion = input.appVersion ?? APP_VERSION;
  const reportText = buildSupportReportText({ ...input, appVersion, platform });
  let reportCopiedOrShown = false;
  const writeText = navigator.clipboard?.writeText;
  if (typeof writeText === "function") {
    try {
      await writeText.call(navigator.clipboard, reportText);
      reportCopiedOrShown = true;
    } catch {
      reportCopiedOrShown = promptForManualReportCopy(reportText);
    }
  } else {
    reportCopiedOrShown = promptForManualReportCopy(reportText);
  }
  const url = buildBugReportUrl({ ...input, appVersion, platform, includeReportText: !reportCopiedOrShown });
  await openExternalUrl(url);
  return url;
}
