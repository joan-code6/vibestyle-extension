# VibeStyle

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users and Purpose

Browser users describe how a website should look or behave. VibeStyle reads relevant page structure, applies CSS or JavaScript, and remembers the result on future visits.

## Confirmed Scope

- Firefox first, with Chrome support from the same codebase.
- Quick setup: OpenRouter or Hack Club, API key, model selection.
- A minimal sidebar chat, one saved customization per hostname.
- Whole-site Enable/Disable and Delete controls only.
- No element picker, undo, manual code editor, or per-change management.
- Further prompts update the site's combined customization.
- Codex subscription support is deferred pending extension-specific authentication validation.

## Brand Commitments

The repository name is vibestyle-extension. The pink square icon lives at assets/icon.svg. The interface keeps setup, chat, and site controls compact.

## Implementation Assumptions

- Use a compact browser-native layout with system typography and the existing pink accent.
- Store configuration and customizations locally; no extension-operated backend.
- Ask for site permissions as needed. Generated JavaScript has an explicit installation action to satisfy user-script policies.
- AI requests transmit a bounded, sanitized page snapshot to the selected provider only when the user submits a prompt.
