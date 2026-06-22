# De-Koi

> [!IMPORTANT]
> De-Koi is an unofficial modified fork of
> [Marinara Engine](https://github.com/Pasta-Devs/Marinara-Engine).
> It is a separate project and is not an official Marinara Engine release,
> support channel, or distribution.
>
> De-Koi is not sponsored by, endorsed by, or released on behalf of Marinara
> Engine, Spicy Marinara, Pasta Devs, or the Marinara Engine project.
>
> De-Koi is licensed under the GNU Affero General Public License version 3.
> See [`LICENSE.txt`](./LICENSE.txt) for the full license and
> [`NOTICE.md`](./NOTICE.md) for fork, attribution, source, and other notices.
>
> If you receive or use a De-Koi binary, installer, Docker image, APK,
> pre-release build, or hosted network service, you should also have access to
> the exact corresponding source code for that version.

De-Koi is a local-first AI chat, roleplay, and game engine. It runs as a Tauri
desktop app with a React interface, a TypeScript product engine, and Rust
capabilities for storage, files, providers, integrations, and optional remote
runtime support.

This repository is the active De-Koi development line. The app is usable from
source, and public release packaging is being rebuilt around the Tauri desktop
plus optional Rust runtime architecture.

## Trying De-Koi For The First Time

Start with the smallest path that matches your setup:

- **Use a published desktop release when one is available.** Download it from
  the matching GitHub Release page, read that release's notes, and keep access
  to the corresponding source code. Pre-alpha builds may be unsigned or
  debug-signed, so test them with throwaway data first.
- **Run from source when you deliberately want the current development line.**
  Install the prerequisites, then run `pnpm install` and `pnpm tauri dev`.
- **Use the Pi guide only for Raspberry Pi installs.** Pi users should prefer
  prebuilt ARM64 images instead of local Rust/frontend builds. See
  [Raspberry Pi Pre-Alpha Web Shell](#raspberry-pi-pre-alpha-web-shell).

Most first-time desktop users do not need the Remote Runtime, Docker Compose,
Raspberry Pi setup, or validation commands. Those are for self-hosting, Pi
installs, contributor workflows, and development checks.

## Screenshots

Current release-build screenshots are checked in under
[`docs/screenshots/release`](docs/screenshots/release). These captures show the
web-shell setup path before a remote runtime and provider connection are
configured.

| Conversation | Roleplay | Game mode |
| --- | --- | --- |
| ![Conversation setup in the De-Koi release build](docs/screenshots/release/conversation.png) | ![Roleplay setup in the De-Koi release build](docs/screenshots/release/roleplay.png) | ![Game setup in the De-Koi release build](docs/screenshots/release/game-mode.png) |

| Settings | Connections |
| --- | --- |
| ![Settings panel in the De-Koi release build](docs/screenshots/release/settings.png) | ![Connections panel in the De-Koi release build](docs/screenshots/release/connections.png) |

## What You Can Do

- Chat with characters and direct-message style conversations.
- Run scene-based roleplay with characters, personas, sprites, backgrounds,
  choices, and scene state.
- Play AI game-master sessions with party state, turns, mechanics, assets, and
  world tracking.
- Manage creative libraries for chats, characters, personas, lorebooks, prompt
  presets, provider connections, agents, gallery items, and knowledge sources.
- Build prompts with presets, lorebooks, regex processing, context budgeting,
  streaming generation, retries, branches, and summaries.
- Connect to model providers including OpenAI, Anthropic, Google, Google
  Vertex, Mistral, Cohere, OpenRouter, NanoGPT, xAI, Claude subscription mode,
  OpenAI-compatible endpoints, and image-generation backends.
- Use Deki-Senpai as a standalone assistant surface with selected app context
  and read-only creative-library tools.

## Run From Source

You need:

- Node.js
- pnpm
- Rust stable toolchain
- Tauri platform prerequisites for your operating system

Install dependencies:

```sh
pnpm install
```

Run the desktop app:

```sh
pnpm tauri dev
```

Run only the web shell:

```sh
pnpm dev
```

Build the frontend:

```sh
pnpm build
```

Build the Tauri desktop bundle:

```sh
pnpm tauri build
```

The desktop development path is the normal way to try De-Koi locally. The web
shell is useful for UI work, but Tauri-only capabilities may be unavailable
without the desktop host.

Track `main` from a source checkout on Windows:

```powershell
.\start-main.cmd
```

This launcher fetches `origin/main`, rebuilds the release executable when the
checkout changed, and starts the desktop app. See
[Source Main-Channel Launcher](docs/source-main-launcher.md) for shortcut setup,
options, and risk notes.

## Install Or Update A Release

When maintainers publish De-Koi release assets, use the GitHub Release page for
that version as the source of truth. Download the artifact for your operating
system, read the release notes, and keep access to the matching source commit
listed by the release.

Updates are manual in the current De-Koi architecture. The in-app update check
in Settings > Advanced may open the matching GitHub Release page, but De-Koi
does not silently download or install desktop release updates yet. Replace the
app through the platform installer or bundle you downloaded from GitHub
Releases.

Pre-alpha release assets may be unsigned or debug-signed and should be tested
with throwaway data. The optional Rust runtime is an API server for supported
desktop workflows; it is not a replacement for the desktop app installer and
does not serve the React UI.

## Optional Remote Runtime

De-Koi includes an optional hostable Rust API runtime for advanced local or
self-hosted setups. It does not serve the React UI.

Start it with:

```sh
cargo run --manifest-path src-tauri/Cargo.toml --bin de-koi-server
```

By default it listens on:

```text
http://127.0.0.1:8787
```

The runtime fails closed for non-loopback clients unless you intentionally
configure access control such as basic auth, an IP allowlist, or another trusted
private-network opt-in. See the
[run and build guide](./docs/developer/run-build.html) for remote runtime,
Docker, CORS, CSRF, proxy, and data-directory details.

## Raspberry Pi Pre-Alpha Web Shell

Raspberry Pi users should use the prebuilt Pi container images instead of
building De-Koi from source on the Pi. For the shortest copy-paste path, see the
[Pi fast install and update guide](docs/pi.md).

Start or update a trusted home LAN/Tailscale Pi from the repository root:

```sh
sh scripts/pi-update.sh --trusted-lan
```

Start the hardened default Pi web shell:

```sh
docker compose -f docker-compose.pi.yml up -d
```

Update it:

```sh
docker compose -f docker-compose.pi.yml pull
docker compose -f docker-compose.pi.yml up -d
curl -I http://127.0.0.1:7860/
```

The Pi compose file exposes only the web container on port `7860`. The Rust
runtime stays private on the Docker network, and nginx proxies same-origin
requests for `/health` and `/api/` to `de-koi-server:8787`. See
[`docs/pi.md`](docs/pi.md) for auth, LAN-trust, Tailscale, and update details.

## Developer Docs

The deeper docs are static HTML. Open them directly from the repo:

```text
docs/developer/index.html
```

Or serve them locally:

```sh
pnpm docs:dev
```

Then open:

```text
http://127.0.0.1:4174/
```

Useful starting points:

- [Developer docs overview](./docs/developer/index.html)
- [Run and build guide](./docs/developer/run-build.html)
- [Architecture guide](./docs/developer/architecture.html)
- [Module ownership guide](./docs/developer/modules.html)
- [Impact areas guide](./docs/developer/impact-areas.html)
- [De-Koi storage schema](./docs/database-schema.md)
- [Release update strategy](./docs/release-update-strategy.md)
- [Token budget estimates](./docs/token-budget-estimates.md)

## Validation

Use the checks that match your change:

```sh
pnpm typecheck
pnpm test
pnpm build
pnpm check:architecture
pnpm check:docs
cargo check --manifest-path src-tauri/Cargo.toml --workspace
```

The combined local check is:

```sh
pnpm check
```

It includes a warning-only unused-code report, so dead files or exports can
still appear without failing the command.

## Current Status

Use the `main` branch copy of this documentation for current development and
integration work. Historical branch docs may describe legacy architecture and
should not be treated as authoritative unless a maintainer explicitly asks for
that branch context.

Current development is focused on the De-Koi desktop/runtime architecture.
Release docs describe the current manual install/update model, and release-build
screenshots are checked in for the current web-shell setup, settings, and
connections surfaces.