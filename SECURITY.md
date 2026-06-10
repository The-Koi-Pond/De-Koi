# Security Policy

## Supported Versions

De-Koi is in pre-alpha. Only the latest state of the `main` branch and the most
recent pre-alpha build are supported. Older builds do not receive security
fixes — please update before reporting an issue.

| Version | Supported |
| ------------------------ | ------------------ |
| `main` / latest pre-alpha | :white_check_mark: |
| Older builds | :x: |

## Reporting a Vulnerability

**Please do not report security vulnerabilities through public GitHub issues,
discussions, or pull request comments.**

Instead:

1. **GitHub Security Advisories (preferred, if available to you):** Go to the
   repository's **Security** tab and use **"Report a vulnerability"** to open
   a private advisory. Note that on a private repository this option may not
   be available to all collaborators — if you don't see it, use direct
   contact below.
2. **Direct contact:** Message a maintainer privately and ask for a private
   channel before sharing any details. The security contact is
   [@Romuromylus](https://github.com/Romuromylus); as backup, any
   organization owner: [@cha1latte](https://github.com/cha1latte),
   [@Decidetto](https://github.com/Decidetto),
   [@munimunigamer](https://github.com/munimunigamer),
   [@Xelvanis](https://github.com/Xelvanis). Reports through either path get
   an acknowledgement within 7 days (see "What to Expect" below).

When reporting, please include as much of the following as you can:

- A description of the vulnerability and its impact.
- Steps to reproduce, ideally a minimal proof of concept.
- The affected component (UI, Tauri/Rust backend, LLM integration, storage,
  import/export, etc.) and the build or commit you tested against.
- Any suggested fix or mitigation, if you have one.

## What to Expect

- **Acknowledgement** of your report within **7 days**.
- An assessment of the report and, if confirmed, a fix plan within **30 days**.
- Credit in the release notes for the fix, unless you prefer to remain
  anonymous.

## Scope

De-Koi is a local-first desktop application. Reports we are especially
interested in:

- Path traversal or arbitrary file read/write outside the app's data
  directories (imports, exports, assets, character cards, archives).
- Command or code execution triggered by untrusted content (imported cards,
  lorebooks, presets, chat files, themes, extensions).
- Decompression/parsing issues in imported archives (zip bombs, malformed
  files causing crashes or memory exhaustion).
- Leakage of API keys or other secrets (logs, exports, backups, network
  requests).
- Server-side request forgery (SSRF) or unsafe URL fetching in integrations.
- Injection issues in rendered content (XSS in the webview, prompt-injection
  paths that cross a privilege boundary, e.g. untrusted content driving file
  or network actions).

Out of scope:

- Issues that require an attacker to already have full control of the user's
  machine or local user account.
- Vulnerabilities in third-party LLM providers or APIs themselves.
- Denial of service that only affects the attacker's own local instance.
- Findings from automated scanners without a demonstrated impact.

## Dependencies

Dependency updates and vulnerability alerts are handled via Dependabot
(see `.github/dependabot.yml`). If you find a vulnerable dependency with a
concrete exploit path in De-Koi, report it through the channels above rather
than only flagging the dependency version.
