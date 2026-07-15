---
name: design-before-implementation
description: Enforce a design-confirmation workflow before critical implementation work. Use when Codex is asked to change or implement authorization, packaging, security, keys, login, send-integrity protection, translation cache, enterprise chat assets, multi-profile behavior, WhatsApp/Telegram/Signal core behavior, installer delivery, GitHub release flow, or any high-impact product workflow where unclear assumptions could cause rework or risk.
---

# Design Before Implementation

Use this skill to prevent coding from starting before the critical design is explicit.

## Core Rule

Before editing code or creating build artifacts for critical work, first state the concrete design and wait for the user to confirm, correct, or continue. Do not silently infer fragile requirements.

## Critical Work That Requires This Workflow

Apply this workflow for changes involving:

- Offline authorization, license files, license codes, suite IDs, issuer tools, and activation.
- Packaging, installers, full-suite delivery, customer acceptance builds, and white-label releases.
- Security boundaries, keys, secrets, logging, source protection, anti-tamper, and send-integrity protection.
- Login, username, password, machine code, remembered login, and auto-login behavior.
- Translation cache, DeepSeek/API usage, token-saving rules, enterprise chat asset archive, and data retention/deletion.
- WhatsApp, Telegram, or Signal multi-profile behavior, notifications, unread preview, input translation, bubble rendering, or Signal window control.
- Git/GitHub release workflows that could expose source, secrets, customer data, runtime cache, screenshots, installers, or enterprise assets.

## Required Pre-Code Response

Before implementation, provide a concise design with these items when relevant:

1. Scope: what will be done now and what will not be done now.
2. Files: exact files/directories to add or edit.
3. Data model: fields, IDs, file formats, encryption/signing structure, and storage paths.
4. State flow: state names and transitions, including failure/interruption handling.
5. Parameters: exact numbers, timeouts, limits, retry counts, concurrency, cache limits, and UI text.
6. Isolation rules: how profiles, suites, customers, keys, caches, and archives avoid cross-contamination.
7. Security rules: what must never enter Git, logs, renderer pages, screenshots, packages, or customer-visible text.
8. Validation: build checks, script checks, UI/manual test paths, and what remains unverified.
9. Git plan: whether to make a local checkpoint, and what safety checks run before it.

If the user corrects any design detail, update the design first. Treat the corrected design as authoritative.

## When to Proceed Without Waiting

Proceed without an extra confirmation only when the user has already explicitly said to implement after the concrete design is stated, or when the task is a small documentation-only correction that directly records the user's latest wording.

## Reporting Rules

- Do not claim UI behavior is verified unless the app was actually opened and that path was manually tested.
- Say "build passed, real UI not tested" when only build/type/script checks ran.
- Keep Git safety checks distinct from Git checkpoints: safety check means checking staged paths/content; checkpoint means committing to local Git.
- For package or GitHub work, explicitly say whether packaging or pushing was performed.

## Project-Specific Defaults

For the Maoyi translator project, keep these defaults unless the user changes them:

- Do not build a new installer unless the user explicitly says to package.
- Do not push GitHub unless the user explicitly requests it.
- Keep customer data, login state, translation cache, enterprise assets, screenshots, generated installers, and `.package-secrets` out of Git.
- For full-suite packaging, every packaging attempt consumes one unique 9-digit suite ID and never recycles it, whether packaging succeeds or fails.
- Suite-specific keys must be generated using the consumed suite ID and permanently bound to suite ID, key ID, public-key fingerprint, encrypted-private-key fingerprint, and output directory.
