import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";

export function shellQuote(value) {
  const text = String(value);
  if (/^[A-Za-z0-9_./:@=-]+$/.test(text)) return text;
  return `'${text.replace(/'/g, "'\\''")}'`;
}

export function ghCommand(args) {
  return `gh ${args.map(shellQuote).join(" ")}`;
}

export function friendlyGhError(error) {
  const stderr = error.stderr ? String(error.stderr).trim() : "";
  const message = stderr || error.message || String(error);

  if (/EPERM|EACCES/i.test(message)) {
    return `${message}. GitHub CLI access was blocked by the current shell/sandbox; rerun with GitHub access approved or use the offline JSON fallback.`;
  }
  if (/ENOENT/i.test(message)) {
    return `${message}. GitHub CLI was not found on PATH.`;
  }
  return message;
}

export function readGhJson(args, { warnings, failures, context, required = false, fallbackCommands } = {}) {
  try {
    const output = execFileSync("gh", args, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
    return JSON.parse(output);
  } catch (error) {
    const command = ghCommand(args);
    const message = `${context}: ${friendlyGhError(error)}`;
    warnings?.push(`${message} Equivalent direct command: ${command}`);
    fallbackCommands?.push(command);
    if (required) failures?.push(message);
    return null;
  }
}

export function readJsonFile(path, { warnings, failures, context, required = false } = {}) {
  try {
    const buffer = readFileSync(path);
    const text =
      buffer[0] === 0xff && buffer[1] === 0xfe
        ? buffer.toString("utf16le").replace(/^\uFEFF/, "")
        : buffer.toString("utf8").replace(/^\uFEFF/, "");
    return JSON.parse(text);
  } catch (error) {
    const message = `${context}: could not read JSON file ${path} (${error.message})`;
    warnings?.push(message);
    if (required) failures?.push(message);
    return null;
  }
}

export function repoParts(repo) {
  const [owner, name] = String(repo).split("/");
  return { owner, name };
}
