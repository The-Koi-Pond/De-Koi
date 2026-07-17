# Default chat connection design

## Claim

Users need an explicit normal chat default that is independent from agent and Illustrator defaults.

## Existing contract

Connections already persist `isDefault` for normal generation and `defaultForAgents` for agent selection. Embedded and remote storage updates share the Rust normalization path, which clears the previous `isDefault` connection. Normal fallback services and new-chat connection selection already prefer `isDefault`.

## Change

- Show the selected normal default in a dedicated Connections overview card.
- Let language connection editors read and save `isDefault`.
- Do not send `isDefault` while editing image-generation connections.
- Keep the agent/Illustrator toggle and `defaultForAgents` unchanged.
- Explain the separate controls in discovery metadata.

## Proof

UI tests distinguish chat and agent defaults. Catalog tests prove normal selection precedence. Type checking covers the editor update payload, and the full repository/Rust gate covers shared embedded and remote normalization.
