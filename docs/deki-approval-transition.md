# Deki Approval Transition Note

## Current Intent

Deki chat access grants are a durable product boundary, even though the first implementation is intentionally narrow. Deki must not read private chat context unless the user grants explicit scoped access. A grant should remain visible, bounded by scope and message window, and limited to the current Deki session unless a later design deliberately changes that expiry rule.

The current `request_chat_access` flow should therefore be treated as the correct immediate behavior for issue #671, not as fake success or a UI-only placeholder.

## Transitional Implementation

The current approval plumbing is transitional in these ways:

- The grant approval card is owned by the Deki surface rather than a general workspace approval runtime.
- Task resume after approval is synthetic because the current Deki prompt path returns a final response instead of a streamed tool/status timeline.
- Approved chat context is resolved by Rust into a bounded server-side snapshot and injected into the next prompt, rather than relying on an observable command event stream.
- Debug visibility is limited because hidden tool/provider activity is not persisted as readable trace history.

These choices are acceptable for the scoped chat-access feature because they enforce the privacy boundary and avoid fabricated chat-derived answers. They should not become the final architecture for all Deki approvals.

## Planned Rework

Future Deki workspace slices should absorb this feature into the broader CLI-style assistant architecture:

- Slice 3 / issue #676 should provide the general dry-run, pending approval, approve/reject, and history model for Deki workspace operations.
- Slice 4 / issue #677 should provide streamed status/tool/approval events and bounded persisted trace history.

When those slices are implemented, preserve the chat-access policy and migrate the implementation shape. The replacement should keep explicit scoped grants, bounded context windows, and no-chat-access behavior that asks for permission instead of inventing chat evidence.
