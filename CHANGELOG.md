# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [0.1.2-rc.1] - 2026-09-06

### Fixed

- Updated compatibility with DeepSeek Harness `0.1.2-rc.1`, including plugin startup and image submission.

## [0.1.2-alpha.1] - 2026-08-28

### Changed

- Upgraded the package and audited DeepSeek Harness compatibility line to `0.1.2-alpha.1`.
- Replaced the removed browser `connection.api` transport with generated `remote.settings` and `remote.credentials` calls and their direct result envelopes.
- Moved bridge history-image loading from the removed `conversation.resolveImage()` seam to the public `conversation.message.images` renderer slot, while delegating ordinary DSH images to the shipped gallery and loader.
- Updated keyed chat-node rendering to the alpha.1 `chat` locale namespace.
- Expanded the bundled Skill discovery description to cover Open Eyes attachment links, pasted images, screenshots, local image paths, image URLs, and visual-evidence tasks.
- Clarified that an already open blank conversation keeps the Open Eyes enablement state captured when that conversation was created.

### Fixed

- Preserved alpha.1's immediate local submission echo without exposing durable internal attachment Markdown: the echo contains the user's original text and draft previews, while the Host admission receives only the original text plus session-bound attachment links.
- Retained draft images on preparation, prompt, or retirement failure and released them only after the durable submission was observed.
- Updated the official attachment-validation contract fixture for alpha.1's normalized-image pixel budget.
- Verified the packed, authenticated Web boot on Node.js `26.7.0`.

### Security

- Kept settings writes on DSH Remote and credential values on `remote.credentials`; no secret is returned, rendered, or added to durable conversation state.
- The submission bridge remains an explicitly version-pinned alpha.1 seam because DSH does not yet expose a public atomic pre-submit transform. Future DSH upgrades must re-audit it and pass the packed Web boot before compatibility is claimed.

## [0.1.1-rc.2] - 2026-08-26

### Changed

- Upgraded the audited DSH compatibility line and public client declarations to `0.1.1-rc.2`.
- Added a bilingual Settings → Plugins → Plugin configuration card for creating multiple provider schemes, entering API endpoint/model/API key, and selecting the default scheme; advanced fields remain preserved and outside the dynamic form.
- Made every scheme source-neutral in the Settings card: all schemes can be edited, selected, or removed without an origin badge.
- Moved the essential compatibility, uninstall, and rollback guidance into the bilingual README files and removed the standalone `docs/` tree from the public repository and npm package.
- Clarified that installation can be delegated to any harness with local Shell access, recommends using a harness other than the DSH instance being modified to avoid task interruption, and added concise configuration, data-boundary, troubleshooting, development, license, and security guidance to both README files.
- Simplified the Node.js compatibility range to `>=22.19.0` across package metadata and documentation.
- Increased the advanced default provider deadline from 90 seconds to five minutes and made the existing retry limit effective with two retries by default; the Settings UI and all exposed configuration interactions are unchanged.

### Fixed

- Preserved the exact `sendSession` outcome, `AbortSignal`, `this`, and thrown exception through every Web wrapper branch, and release draft images only after a successful bridge submission.
- Added composition coverage with the contract-preserving `dsh-open-file` wrapper in both load orders so co-installation cannot strand Composer in the submitting state.
- Resolved the current default vision scheme at each tool call so an existing session uses a newly selected scheme without re-registration or context changes.
- Accepted complete protocol endpoint URLs without appending `/responses`, `/chat/completions`, or `/v1/messages` a second time.
- Reported safe, actionable provider-validation diagnostics including upstream HTTP status, network reachability, JSON parsing, protocol-response, and response-size failures without rendering upstream bodies.
- Added protocol-specific API endpoint examples through the native DSH tooltip and question icon while retaining base-URL and complete-endpoint input compatibility.
- Added independent model-list discovery for OpenAI Responses, OpenAI Chat Completions, and Anthropic Messages, including secure discovery before a scheme is saved.
- Refined the Settings editor with model-before-API-key ordering, manual model fallback, save-and-validate, validation quota help, and an active Edit button that toggles the inline editor closed.
- Added a new-session-only Enable switch with static Tool/Skill registration: enabled sessions bridge every Web image, while disabled sessions pass untouched to DSH before plugin-side image or credential work.
- Simplified collapsed scheme rows to display name (or scheme ID fallback) plus model, made the outer radio the sole default selector, and retained the last valid card content read-only during a transient Settings outage.
- Normalized an empty optional `provider` tool argument to the live default scheme, matching omission while preserving explicit unknown-provider errors.
- Unified row and save-and-validate feedback through the native DSH Toast, added a token-based inset editor surface, and added an explicit multimodal-capability reminder to discovered models.
- Added live visual preferences with a no-op Default, Visual analysis presets, checkable Focus areas, and a 50-unit Custom supplement; settings are semicolon-composed only into delegated provider prompts and never into durable conversation or model-visible system/tool state.
- Added bounded recovery for transient connection failures, response-body disconnects, per-attempt timeouts, and retryable edge statuses during model discovery, validation, and inference while keeping authentication, request, protocol, and caller-cancellation failures terminal.
- Increased the protocol-specific validation response allowance so reasoning-capable providers do not falsely fail merely because a 16-token probe returned no visible text.

### Security

- Settings exposes only browser-safe provider metadata. API key literals use the official credential write seam and are never stored in Settings, rendered, logged, or included in errors.

## [0.1.0] - 2026-08-15

### Added

- `vision_analyze` visual-delegation tool with a canonical structured result and an untrusted-evidence render boundary.
- Independent OpenAI Responses, OpenAI Chat Completions, and Anthropic Messages adapters using native `fetch`.
- Per-call Credential Reference resolution, bounded response streaming, controlled retries, stable error codes, and secret-redacted failures.
- Workspace containment, final-symlink rejection, magic-byte MIME detection, attachment decoding validation, and bounded local-image admission.
- Opt-in pass-through remote image URLs without a plugin-side downloader.
- Bundled model- and user-invocable `vision-bridge` Skill with progressive security and usage references.
- Per-send DSH Web capability routing that keeps image-capable or unknown routes native and bridges explicitly text-only routes without caching modality.
- Same-origin browser-draft admission with session-bound opaque attachment references and user-visible turns limited to the user's original text plus attachment links.
- Chat-history presentation that renders bridged image links through DSH's stock thumbnail gallery without changing durable model-facing text.
- Zero-tool-call readiness signaling through Tool and Skill context without inserting status or tool-call instructions into user messages.
- Bilingual README files, project artwork, GitHub community files, CI, release automation, contract tests, and packed-profile install/remove smoke tests.

### Fixed

- Never synthesize a default visual question; image-only sends contain only attachment links.
- Mount the stock DSH user-message renderer as a React element instead of calling its `React.memo` component as a function.
- Load bridge-history thumbnails through a bounded same-origin endpoint that authorizes the exact token against a direct user session event.

### Security

- Browser context stores no image bytes, base64, local absolute path, credential, or arbitrary request header.
- Provider credentials, configured header values, image encodings, URLs, upstream errors, and provider-controlled metadata are bounded and redacted at public error/render boundaries.
- Publication fails unless the built canonical package name and manifest identity agree.

[Unreleased]: https://github.com/Hyp6666/dsh-open-eyes/compare/v0.1.2-alpha.1...HEAD
[0.1.2-alpha.1]: https://github.com/Hyp6666/dsh-open-eyes/compare/v0.1.1-rc.2...v0.1.2-alpha.1
[0.1.1-rc.2]: https://github.com/Hyp6666/dsh-open-eyes/compare/v0.1.0...v0.1.1-rc.2
[0.1.0]: https://github.com/Hyp6666/dsh-open-eyes/releases/tag/v0.1.0
