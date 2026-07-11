# Security Hardening Without UX Regressions

## Goal

Reduce credential exposure and strengthen De-Koi's desktop and hostable-runtime defenses without changing normal user workflows, invalidating existing connections, or breaking Pi/trusted-LAN installations.

## Compatibility Contract

- Existing remote-runtime URLs continue to connect, including current trusted-LAN HTTP URLs.
- Existing credential storage and login state remain untouched; users are not asked to sign in again.
- Existing provider keys, Spotify credentials, characters, chats, themes, images, fonts, and integrations remain readable.
- Security enforcement that could break a valid deployment is deferred until a compatible migration exists.

## Design

Preserve all current credential, login, URL, and transport behavior in this compatibility tranche. Preserve AES-256-GCM and the current key location while enforcing owner-only Unix permissions. Add machine-checkable policy guidance for CSP and asset scope without enforcing an unproven policy that could break existing content. Browser credential relocation, HTTPS enforcement, and visible warnings remain deferred until De-Koi has a secure durable-session design that does not make users sign in again.

## Verification

Use focused Vitest and Rust regression tests, architecture/type/Rust checks, the full shipping gate, and Bunny review. No test may log or fixture a real credential.

## Out of Scope

Changing browser credential persistence, strict HTTPS enforcement, new warnings, a new server session protocol, relocating existing master keys, and enforcing CSP or narrower asset paths before compatibility evidence.
