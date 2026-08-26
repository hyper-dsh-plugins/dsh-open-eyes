# Contributing

Thank you for improving `dsh-open-eyes`. Keep changes small, typed, and tied to a wire or security contract.

## Local development

Use a supported Node release and the repository-selected package manager:

```sh
corepack enable
corepack pnpm@11.7.0 install --frozen-lockfile
pnpm run typecheck
pnpm run lint
pnpm run test
pnpm run build
```

Unit and adapter tests use Node's native local HTTP server and never call a paid API. Do not add real keys, provider responses containing secrets, or snapshots of authentication headers.

## Contract changes

Each adapter owns its request URL, headers, JSON body, image representations, parser, usage mapping, request id, finish reason, and protocol errors. A wire change must update the relevant exact request/response contract test. Do not replace the three adapters with a generic compatibility function or add provider SDKs.

Business images must continue to flow through `ctx.fs` and `ctx.attachments`; credentials must continue to flow through `ctx.credentials`. Test fixtures may use Node filesystem APIs, but runtime business-image admission may not.

The browser bridge must make a fresh pre-submit capability decision for every image send. Read the exact current session model through the official connection RPC, resolve its declared input modalities through the server LLM service, bridge only an explicit text-only declaration, and send image-capable or unknown declarations through DSH's native path. Never probe capability with a deliberately rejected prompt and never cache modality. Browser drafts may use same-origin internal transport, but durable context must contain only the original user text plus concise Markdown attachment links—not routing instructions, base64, blob URLs, paths, or headers. A change to the rc.2 conversation/connection wrapper or `dsh.client` build requires client, lifecycle, pack, real Web boot, and both-order `dsh-open-file` co-install tests performed by the release tester.

## Pack/install smoke

Run the real tarball test before proposing a release:

```sh
pnpm run test:e2e
npm pack --dry-run
```

The E2E suite builds the package, creates a real tgz, checks its allowlisted files, installs it into an isolated temporary DSH web profile, verifies both Cordis rows through `--dump-config`, removes it, and verifies both rows are gone.

## Pull requests

- Explain behavior, security implications, and tests.
- Add a changelog entry for user-visible changes.
- Keep README.md and README.zh-CN.md operationally equivalent.
- Do not weaken limits or remote URL policy silently.
- Do not commit generated tgz files, credentials, or local DSH homes.
