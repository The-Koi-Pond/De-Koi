# Task 015 report: Pause inactive decorative motion

## Result

- The shell now exposes `data-de-koi-page-activity="active|inactive"` on the document root via the existing `usePageActivity` hook.
- Inactive pages pause only decorative shell stars and home splash letters. Existing Pi/slow-display `data-de-koi-shell-performance="low"` behavior remains intact.
- Home splash letter bounce runs for two iterations and retains the reduced-motion `animation: none` override.
- Roleplay HUD cycling previews and the GamePartyBar mobile preview do not schedule or advance their intervals while inactive. They resume with one interval and clear it on unmount.
- Gameplay-semantic timers, generation, combat, QTEs, weather, and transcript clocks were not touched.

## RED / GREEN evidence

1. Shell/CSS RED: root synchronizer export and inactive decorative policy were absent. GREEN: `shell-performance.spec.ts` verifies active/inactive plus low-power coexistence and the narrow CSS selector.
2. Splash RED: source still used `infinite`. GREEN: two iterations and the existing reduced-motion override are asserted in `ModeHomeSurface.spec.tsx`.
3. Roleplay RED: the cycling index advanced after 1000 ms while inactive. GREEN: it stays at zero inactive, advances once after resume, has one timer, and has zero timers after unmount.
4. GamePartyBar RED: the mobile preview advanced after 2500 ms while inactive. GREEN: it stays on the first member inactive, resumes in order with one timer, and cleans up on unmount.

## Checks

- Focused specs: PASS, 13 tests.
- `pnpm typecheck`: PASS.
- `pnpm check:architecture`: PASS.
- `pnpm test`: PASS (exit 0, 128.4s); existing jsdom `HTMLMediaElement.play()` notice remains.
- `pnpm lint:design`: NON-CLEAN baseline, exit 2 with 289 repository-wide findings. No layout redesign was made; the task intentionally retains the existing splash bounce visual while making it finite.
- `git diff --check`: PASS.

## Concerns

- Design lint is not a clean gate because of the existing repository-wide findings noted above.
- CSS behavior is covered by narrow source assertions rather than a browser animation-state test; timer lifecycle behavior is exercised with fake timers through rendered React components.

Vault: No vault capture.
