# De-Koi

**Local-first AI chat, roleplay, and fanfic.** Run it on your desktop, on a Raspberry Pi, or on a server you own, and
open it from your phone. Bring your own model: a hosted API, your Claude or ChatGPT subscription, or a local model
De-Koi downloads and runs for you.

![A roleplay scene in De-Koi: Captain Elias Marr in the chart room of the Halcyon, over a stormy sea painting](docs/screenshots/readme/roleplay.jpg)

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

## Three ways to write with AI

### Conversation

Text characters the way you text friends. One-on-one or group chats, characters with statuses and schedules who can
message you first, per-character bubble styles, and slash commands.

![A conversation with Wren Hollis, a lighthouse keeper, about tide tables and the weather](docs/screenshots/readme/conversation.png)

### Roleplay

Scene-based roleplay with personas, character portraits and sprites, backgrounds, choices, and lorebooks. For long
campaigns, the Continuity Director plans arcs and beats you approve, and memory recall keeps earlier events in view.

### Fanfic

Request a fic like an AO3 prompt: fandom, ships, rating, tropes, point of view, length. De-Koi can look up the canon
online first, shows you an outline to edit or skip, then writes it chapter by chapter.

| Request it                                                                                                       | Read it                                                                                                            |
| ---------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------ |
| ![The fanfic request form, filled in for a Sherlock Holmes case fic](docs/screenshots/readme/fanfic-request.png) | ![The chapter reader showing "Before the Lamps Are Lit" with its tools](docs/screenshots/readme/fanfic-reader.png) |

Then make it better without starting over: check a chapter for continuity slips and fix them in one tap, keep a story
ledger of who knows what, check that characters sound like themselves, run an editor pass that rewrites only weak
scenes, let the outline re-plan itself after each chapter, rewrite any passage you select, listen to it read aloud,
and save it as HTML or Markdown.

### And around all three

- **Any model.** OpenAI, Anthropic, Google Gemini and Vertex AI, Mistral, Cohere, OpenRouter, NanoGPT, xAI, any
  OpenAI-compatible endpoint, your Claude or ChatGPT subscription, or the built-in local model.
- **Your library.** Characters (imports SillyTavern cards), personas, lorebooks, prompt presets, regex scripts, and a
  gallery, all stored on your machine.
- **Deki-senpai.** A built-in assistant that answers questions about the app and can draft or tidy your library, with
  a preview before anything changes.
- **Voice and images.** Text-to-speech (ElevenLabs, OpenAI, or a local voice) and image generation.
- **Phone-ready.** Host it on a Pi or server and the same chats open on your phone and your PC.

![The same conversation, roleplay, and fic open on a phone-sized screen](docs/screenshots/readme/phone.jpg)

## Get De-Koi

De-Koi is in **pre-alpha**. Builds are unsigned, things break, and you should test with data you don't mind losing.

| Platform     | Download                                                                                              |
| ------------ | ----------------------------------------------------------------------------------------------------- |
| Windows      | `.exe` or `.msi` from the newest [pre-alpha release](https://github.com/The-Koi-Pond/De-Koi/releases) |
| Linux        | `.AppImage`, `.deb`, or `.rpm` from the same release                                                  |
| Android      | the debug `.apk` from the same release                                                                |
| Raspberry Pi | prebuilt images: [Pi guide](docs/pi.md), or [without Docker](docs/pi-bare-metal.md)                   |
| VPS / server | the [VDS / VPS guide](docs/vds.md) (web app for your phone and PC, behind HTTPS or a private network) |
| macOS        | no build yet; [run from source](#run-from-source)                                                     |

Updates are manual for now: download the newer build from the releases page and install it over the old one.

## Every feature

This list is generated from the app's in-app Discover guide, so it matches what the app ships. Open a section to see
it.

<!-- features:start (generated from the Discover registry by `pnpm docs:readme-features`; do not edit) -->

<details>
<summary><b>Chat modes</b> (7)</summary>

- **Conversation Mode**: Casual character messaging with group chats, per-character bubble styling, schedules, statuses, autonomous replies, commands, cancellable message and draft translation, freshness guardrails, and familiar chat controls.
- **Roleplay Mode**: Long-form story writing with configurable narration style, local repetition guidance, conservative strict-agency correction, cancellable message and draft translation, character narration, scene lifecycle controls, sprites, backgrounds, lorebooks, trackers, and optional agents.
- **Fanfic Mode**: Request a fanfic like an AO3 prompt: fandom, ships, rating, warnings, tropes, point of view, and length. It can look up the canon and any real-world topics online first, then plan from what it finds. Review or skip the outline, then read it chapter by chapter, steer the next chapter with notes, rewrite a chapter with notes, listen to it read aloud with your Text-to-Speech voice, score it with a quality check (AI-sounding habits, repeats, continuity slips with quotes, and a critic's rubric) that keeps every run so you can compare before and after rewrites, check a chapter for continuity slips against the ones before it and fix them in one tap, keep a story ledger of who knows what so long fics stay consistent, keep a voice sheet per character with real canon lines (edit it in outline review) and check a chapter for lines a character would never say, run an editor pass that scores each chapter on stakes, side plots, hard choices, theme, and exposition and rewrites only the scenes that need it, keep the outline living (after each chapter it re-plans the chapters still to come from what was written, or suggests the next one past the end, and you can steer it), select any passage and say what is wrong to get rewrites of just that passage (keep asking for versions, then pick one), ban phrases on local models (they back up and rewrite the spot instead of writing them), and save the fic as HTML or Markdown.
- **Roleplay workflow profiles**: Choose Simple Roleplay for a short or casual chat, Long-Running Story for a campaign across scenes or sessions, Cinematic Roleplay when visual presentation matters, or Local Helpers when your local sidecar is ready. Preview what each setup adds and its model use before applying it without replacing your writer connection.
- **Roleplay Context Panels**: Use roleplay helper panels for author notes, context injections, active world info, sprites, and HUD state.
- **Roleplay Continuity Director**: Applying and confirming Long-Running Story makes one immediate background Director planning call only when it newly enables Director and no saved plan exists. Director cadence then makes one non-blocking planning call every 10 assistant replies. Keep arcs and open threads visible while new beats remain proposed and reviewable until you approve them for future prompts; a pending-review badge points you back to Director. The director proposes structure while the writer model owns prose and player agency.
- **Character Web Research**: Let characters decide when current facts need public-web research. Keep the process in the background or allow in-character narration, with permission prompts and collapsed final sources.

</details>

<details>
<summary><b>Getting started</b> (3)</summary>

- **Connections**: Configure and organize model providers, API keys, local endpoints, managed Local Model setup, subscription image generation, voice providers, separate chat, agent, and Illustrator defaults, and per-chat vision connections for image input.
- **Imports**: Bring in characters, personas, lorebooks, presets, SillyTavern data, and Marinara profile exports.
- **Backups And Profile Export**: Create managed backups, download backup files, export a native profile JSON, and restore data through profile import.

</details>

<details>
<summary><b>Library</b> (9)</summary>

- **Characters**: Create, import, organize into groups, edit character cards, manage version history and character-level memories, optionally include sanitized character memories in De-Koi Native exports, export Character Card V3 JSON or CHARX packages with avatar, banner, and sprites, choose cross-chat continuity, inspect automatic evidence-backed behavior for sparse cards, generate concrete card fields, tune Public Profile details, and save Music Taste for visible Listening To flavor, play cues, and shuffled profile music.
- **Improved Opening Alternatives**: Generate one reviewable opening alternative that preserves the original first message, user agency, card premise, formatting, and macros until you explicitly save it as an alternate greeting.
- **Conversation Avatar**: Override a character's avatar in Conversation mode — show an emoji, one of its sprites, a gallery image, or hide it entirely.
- **Personas**: Manage who you play as, including persona descriptions, avatars, and groups that chats can use for context.
- **Lorebooks**: Store, organize, test, and inspect world info, setting details, rules, backstory, and keyword-triggered context assigned to chats, characters, or personas.
- **Prompt Presets**: Control and organize prompt structure, sections, variables, context attribution, and generation behavior for different chat styles.
- **Bot Browser**: Browse downloadable character cards and related community resources from inside De-Koi.
- **Character Gallery**: Store and review character-specific images separately from chat gallery images and generated scene attachments.
- **Gallery**: Keep a profile-wide image library organized into folders, reusable across the whole app and independent of any chat.

</details>

<details>
<summary><b>Agents</b> (2)</summary>

- **Agents**: Optional helpers and custom functions that can be named, credited with editable author metadata, enabled or disabled globally, imported, exported, track world state, review or write lorebooks, create images, run custom behavior, and enrich generation.
- **Trackers**: World, persona, character, quest, and custom trackers summarize structured state that can appear in Roleplay surfaces.

</details>

<details>
<summary><b>Media</b> (3)</summary>

- **Text-to-Speech**: Configure voice providers and let chats, narration, or characters speak with assigned voices.
- **Image Generation**: Set up and test image connections, Codex Subscription imagegen, and style profiles for selfies, sprites, backgrounds, tracker portraits, and scene illustrations.
- **Music Player**: Enable the Music Player module for automatic scene-aware roleplay picks and visible Fresh Pick controls, while Character Music Taste supplies profile and manual character cues.

</details>

<details>
<summary><b>Settings</b> (9)</summary>

- **Settings**: Global controls for appearance, chat behavior, sound preferences, imports, themes, extensions, backups, updates, and advanced runtime options.
- **Privacy And Data Controls**: Review how De-Koi stores and sends data, export or back up your library, erase selected categories, or perform a typed-confirmation complete wipe of De-Koi-managed data.
- **Health And Diagnostics**: Review setup readiness, runtime health, Local Model status, provider probes, storage reachability, recent client diagnostics, and a redacted troubleshooting packet.
- **Notification Sounds**: Choose the Frog default, the Legacy ding, or a small custom audio file for local chat alerts.
- **Modules**: Enable or disable bundled modules like ME Notes and Music Player without importing custom extension files.
- **Extensions**: Install CSS, JavaScript, or package manifest extensions, then enable, disable, and manage local behavior without editing core source.
- **Extension Device Access**: Review compatibility and requested helpers, then activate CSS or trusted page-level JavaScript only on this runtime and device.
- **Themes, Fonts, And Backgrounds**: Customize visual themes, custom CSS themes, fonts, chat backgrounds, gradient styling, and mode-specific appearance.
- **Custom Font Upload**: Install validated TTF, OTF, WOFF, or WOFF2 fonts from Settings; remote runtimes upload while embedded apps can open the managed folder.

</details>

<details>
<summary><b>Advanced</b> (12)</summary>

- **Regex Scripts**: Manage SillyTavern-style find/replace scripts that change what you see, what the AI reads, or both.
- **Slash Commands**: Type / in the chat input to see command autocomplete for actions such as help, dice rolls, reminders, guided replies, response amendments, private scene illustration guidance, and impersonation.
- **Discord Mirror**: Mirror chat messages into a Discord channel through a webhook while keeping character names and narration labels readable.
- **Inline Model Reasoning**: Optionally show reasoning returned by the model in a separate collapsible panel beneath character replies while keeping final answers primary.
- **Recommended Generation Profiles**: Let De-Koi choose stable generation and prompt-budget settings for each chat mode and model, or switch to explicit Custom values.
- **Prompt Overrides**: Customize selected prompt templates for specialized generation behavior without editing core source.
- **Quick Replies**: Optional input actions for posting without generation, guiding a reply, impersonating a character, or saving custom slash-command buttons from mode input toolbars.
- **Chat Settings Presets**: Save, apply, import, export, rename, and delete reusable chat settings bundles for repeated chat setups.
- **Prompt Inspector**: Inspect advanced prompt details including budget estimates, context attribution, section token counts, warnings, assembled prompt sections, roles, variables, generation parameters, and replay details before or after generation.
- **Swipes And Rerolls**: Move between alternate generations, regenerate replies, amend the latest response with a targeted instruction, and optionally use your draft as guidance for the next retry.
- **Message Moment Actions**: Start from a chat message and route it to continuity actions, including remembering the beat in chat summaries, or drafting lorebook entries. Use the brain action for Remember this, the adjacent branch action for branching, and the paintbrush to illustrate that exact message.
- **Chat Continuity Overview**: See what can carry forward and manually add chat-local memories in the Memory Console or character-wide memories in Character Editor. Memory scope controls where a memory persists; Who knows this? assignments control which characters, personas, or groups may use a canonical memory in Roleplay, while world truth never grants character knowledge. In Roleplay, Story Continuity also builds source-linked episodes and four-episode arcs in the background, with an explicit existing-story build, exact source inspection, and edit, regenerate, pin, supersede, and retry controls. De-Koi automatically rejects low-value captures and quietly combines or removes stored memories in the background. Manual, pinned, edited, imported, corrected, and tool-created memories use the same hygiene policy. Open Memory Console or Character Editor > Memories to inspect active memories, manage knowledge assignments, or undo the latest automatic maintenance batch. The advanced Repair from chat history action recreates automatic transcript memories without AI; it is separate from automatic memory hygiene and is not a summary. When deleting chats, choose whether De-Koi also removes memories learned only from those chats; shared memories supported elsewhere stay intact. Review speaker-labeled exchanges, typed consequences, automatic capture status and partial-capture warnings, and embeddings that rank matches alongside summaries, world info, tracker agents, and non-authoritative story projections.

</details>

<details>
<summary><b>Help</b> (5)</summary>

- **Help Hub**: A central Help surface for diagnostics, bug reports, onboarding replay, shortcut reference, and app version details.
- **Show Me Around**: Replay the short five-step orientation tour for Chats, workspace navigation, and the main workspace. Use the readiness checklist to resume setup without changing your library or settings.
- **Report A Bug**: Copy a short support report and open the configured GitHub issue form.
- **Deki-senpai**: A dedicated Deki-senpai surface for app questions, codebase help, creative-library drafts, library edits and cleanups you approve with a preview that lists everything a delete also removes or changes, live step-by-step work you can stop, scoped memory review, and durable retryable sessions separate from active chats.
- **Customization Safe Mode**: Recover from a broken theme or extension without loading customizations by opening De-Koi with ?safe-mode=customizations.

</details>

<!-- features:end -->

## Run from source

You need Node.js, pnpm, the Rust stable toolchain, and the
[Tauri prerequisites](https://v2.tauri.app/start/prerequisites/) for your operating system. Then:

```sh
pnpm install
pnpm tauri dev
```

That opens the desktop app. `pnpm dev` runs only the web interface (some desktop-only features are unavailable there),
and `pnpm tauri build` builds an installer.

<details>
<summary><b>Arch-family Linux setup and WebKit troubleshooting</b></summary>

On CachyOS, Arch, Manjaro, EndeavourOS, and other Arch-family systems:

```sh
sudo pacman -Syu
sudo pacman -S --needed git nodejs pnpm rustup webkit2gtk-4.1 base-devel curl wget file openssl appmenu-gtk-module libappindicator-gtk3 librsvg xdotool
rustup default stable
```

If the Linux window opens blank, crashes, or has WebKit/GPU rendering trouble, disable WebKit's DMA-BUF renderer:

```sh
WEBKIT_DISABLE_DMABUF_RENDERER=1 pnpm tauri dev
```

On Wayland, also try forcing the GTK backend to X11 for that run:

```sh
GDK_BACKEND=x11 WEBKIT_DISABLE_DMABUF_RENDERER=1 pnpm tauri dev
```

As a browser-only fallback, run the web interface and the Rust runtime in two terminals, then open the Vite URL in
Firefox:

```sh
pnpm dev
cargo run --manifest-path src-tauri/Cargo.toml --bin de-koi-server
```

The web interface opens at `http://127.0.0.1:1420/`. Set Settings > Advanced > Remote Runtime URL to
`http://127.0.0.1:8787`.

</details>

<details>
<summary><b>Track <code>main</code> on Windows</b></summary>

```powershell
.\start-main.cmd
```

This launcher fetches `origin/main`, rebuilds when the checkout changed, and starts the desktop app. See
[Source Main-Channel Launcher](docs/source-main-launcher.md) for shortcut setup, options, and risk notes.

</details>

## Self-hosting

<details>
<summary><b>Optional remote runtime</b></summary>

De-Koi includes an optional Rust API runtime for advanced local or self-hosted setups. It does not serve the
interface on its own.

```sh
cargo run --manifest-path src-tauri/Cargo.toml --bin de-koi-server
```

It listens on `http://127.0.0.1:8787` by default and refuses non-loopback clients unless you configure access control
(basic auth, an IP allowlist, or another trusted private-network opt-in). See the
[run and build guide](./docs/developer/run-build.html) for Docker, CORS, CSRF, proxy, and data-directory details.

</details>

<details>
<summary><b>VDS / VPS Pre-Alpha Web Shell</b></summary>

VDS/VPS users can run the same web-app plus Rust-runtime container pair on a normal self-hosted server: one trusted
personal instance you open from your phone and PC against the same data. Start with the
[VDS fast install and update guide](docs/vds.md). It covers multi-arch pre-alpha images, reverse-proxy HTTPS,
Tailscale/VPN use, auth, and why port `8787` should stay private behind the web container.

</details>

<details>
<summary><b>Raspberry Pi</b></summary>

Use the prebuilt Pi container images instead of building on the Pi. The shortest path is the
[Pi fast install and update guide](docs/pi.md). For Raspberry Pi OS Lite without Docker, use the
[bare-metal Pi guide](docs/pi-bare-metal.md).

Start or update a trusted home LAN or Tailscale Pi from the repository root:

```sh
sh scripts/pi-update.sh --trusted-lan
```

Or start the hardened default web app and update it later:

```sh
docker compose -f docker-compose.pi.yml up -d
docker compose -f docker-compose.pi.yml pull
docker compose -f docker-compose.pi.yml up -d
curl -I http://127.0.0.1:7860/
```

Only the web container is exposed, on port `7860`; the Rust runtime stays private on the Docker network behind nginx.

</details>

<details>
<summary><b>Local network prompts</b></summary>

Some operating systems ask whether De-Koi can reach devices on your local network. De-Koi uses that only for opt-in
local workflows: local model servers, image tools, OAuth callbacks, Home Assistant, or a self-hosted runtime. If you
use none of those, you can deny the prompt and still use ordinary hosted providers.

</details>

## For contributors

Developer docs are static HTML under [`docs/developer`](./docs/developer/index.html); `pnpm docs:dev` serves them at
`http://127.0.0.1:4174/`. Good starting points: [architecture](./docs/developer/architecture.html),
[module ownership](./docs/developer/modules.html), [extensions](./docs/developer/extensions.html), and the
[storage schema](./docs/database-schema.md).

Before a pull request, run `pnpm check` (types, lint, tests, architecture and docs checks). Rust changes also need
`cargo fmt` and `cargo clippy`. When you add or change a feature, update the Discover registry in
`src/features/shell/discovery/discovery-entries.json` and run `pnpm docs:readme-features` so this page stays current.
The screenshots above come from `pnpm docs:readme-screenshots`; see [screenshot guidance](docs/screenshot-guidance.md).
