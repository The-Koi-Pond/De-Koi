# New Chat Established-Connection Design

## Problem

The sidebar New chat action always begins the first-run setup journey. The journey treats a language-model connection as usable only after its ID appears in the session-only `testedConnectionIds` list. Because that list is not persisted, every browser reload sends established users back to “Finish setting up De-Koi” and prevents immediate chat creation.

The hosted web shell also discovers its same-origin runtime asynchronously. API consumers can run before discovery finishes and briefly report “Remote Runtime URL is not configured,” even though the same-origin server is healthy.

## Intended Behavior

- New chat immediately creates and opens a chat when the runtime is ready and at least one usable language-model connection exists.
- Chat creation continues to use the recovery-safe setup launch orchestrator so retries cannot create duplicate or partially configured chats.
- The setup checklist appears only when a required server or model connection is actually missing, or when a launch failure needs user action.
- Testing a saved model connection remains available as a diagnostic action but is not a session-only prerequisite for every new chat.
- Conversation, roleplay, and game remain explicit modes; the shared launcher receives the selected mode without importing one mode owner into another.

## Design

The setup journey will distinguish **launch readiness** from **diagnostic test status**. A healthy runtime plus a saved usable language-model connection is sufficient to launch. The journey will automatically submit a ready intent through the existing `createSetupChatLaunchOrchestrator`; it will not require a second “Continue to chat” click.

If the runtime or connection is missing, the current setup UI remains the recovery surface. Existing recovery records, preset application, character greeting initialization, and single-flight protections remain owned by the launch orchestrator.

Same-origin runtime selection will be available synchronously to remote-capable API calls in the hosted web shell, while the health check continues to validate reachability and writability. An explicitly configured runtime still takes precedence. This removes the startup window where the app knows its origin but reports that no runtime URL exists.

## Ownership And Impact

- Product readiness rule: `src/engine/onboarding`.
- Setup orchestration UI: `src/features/shell/onboarding`.
- Remote runtime selection: `src/shared/api` and app startup.
- Modes affected: conversation, roleplay, and game launch entrypoints only.
- No storage schema, provider transport, prompt assembly, or Rust command changes.
- The home “Next steps” and general onboarding presentation are outside this slice except where the setup checklist is no longer shown for a ready launch.

## Error Handling

- Missing runtime or connection keeps the intent pending and presents the focused setup action.
- Creation and finalization errors continue through the orchestrator’s existing recovery record and retry behavior.
- Starred-preset failures keep the existing retry/continue-with-defaults choice.
- Same-origin health failures remain visible as runtime repair states; the synchronous candidate does not fabricate a successful health result.

## Verification

- Red/green test: a fresh setup store with a healthy runtime and existing usable connection launches without a tested-connection marker.
- Regression test: New chat closes any open detail route before launching or showing missing-prerequisite setup.
- Negative tests: missing runtime and missing usable connection still show setup and do not create a chat.
- Runtime test: hosted same-origin API selection is available before the asynchronous health effect, while explicit configured URLs retain priority.
- Targeted Vitest suites, `pnpm typecheck`, `pnpm check:architecture`, and the full `pnpm check` shipping gate.
- Live Pi browser proof after deployment is outside the PR merge itself and requires a separate Pi update.
