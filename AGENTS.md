# Foldthink Project Map

Start with a question, follow the shortest path to the owner, read its contract,
and run the named proof. The map describes the repository as it exists today.

```text
Foldthink/
|-- AGENTS.md                 # Entry map for ownership and verification.
|-- README.md                 # Public product introduction.
|-- PHILOSOPHY.md             # Product principle for reducing distance to intent.
|-- ARCHITECTURE.md           # System boundaries and dependency direction.
|-- CONTRACTS.md              # Index of observable domain contracts.
|-- package.json              # Repository commands only.
|-- pnpm-workspace.yaml       # Workspace discovery for apps and domains.
|-- tsconfig.base.json        # Shared TypeScript rigor.
|-- eslint.config.mjs         # Source-level language rules.
|-- dependency-cruiser.cjs    # Machine-enforced ownership boundaries.
|-- apps/
|   |-- web/                  # Executable PWA composition root.
|   `-- server/AGENTS.md      # Server composition root.
|-- domains/
|   |-- surface/              # Durable scene content and CRDT meaning.
|   |-- workspace/            # Semantic commands, invariants, and receipts.
|   |-- interaction/          # Input sessions, viewport, and pixels.
|   |-- local-persistence/    # Browser replica and outgoing queue.
|   |-- identity/             # Anonymous sessions and workspace authority.
|   |-- synchronization/      # Cross-device delivery and durable revisions.
|   |-- asset/                # Immutable large bytes and verified metadata.
|   |-- document/             # Editable source and rich derived readouts.
|   `-- agent-integration/    # WebMCP inspection and mutation adapter.
|-- database/AGENTS.md        # Global order and ownership of SQL migrations.
|-- operations/               # Release, health, backup, and restore proof.
|-- tests/AGENTS.md           # Cross-domain user journeys only.
|-- scripts/                  # Executable project-map verification.
`-- .github/workflows/        # Repository verification on every change.
```

## Route a question to its owner

| Question | First owner map |
|---|---|
| What may change workspace meaning? | [Workspace](domains/workspace/AGENTS.md) |
| Why did scene content converge, disappear, or return? | [Surface](domains/surface/AGENTS.md) |
| Why does Pencil, erasing, a gesture, or a frame behave this way? | [Interaction](domains/interaction/AGENTS.md) |
| What survives a local reload or waits offline? | [Local persistence](domains/local-persistence/AGENTS.md) |
| Who may open, link, revoke, or delete a workspace? | [Identity](domains/identity/AGENTS.md) |
| What was delivered, acknowledged, retried, or recovered? | [Synchronization](domains/synchronization/AGENTS.md) |
| Who accepts, verifies, and retrieves large bytes? | [Asset](domains/asset/AGENTS.md) |
| Who owns Markdown, LaTeX, rendering, or an interactive widget? | [Document](domains/document/AGENTS.md) |
| How does an agent inspect or mutate the live page? | [Agent integration](domains/agent-integration/AGENTS.md) |
| Where does browser or server startup wiring belong? | [Web app](apps/web/AGENTS.md) or [server app](apps/server/AGENTS.md) |
| Where does a schema change belong? | [Database](database/AGENTS.md) |
| How is a release proved recoverable? | [Operations](operations/AGENTS.md) |
| Where does an end-to-end user journey belong? | [Cross-domain tests](tests/AGENTS.md) |

## Working rule

A domain owns meaning. An app only composes domains. A mechanism adapter only
translates between a mechanism and its owner. Cross-domain calls use exported
package entry points and follow [dependency-cruiser.cjs](dependency-cruiser.cjs).

A behavior contract lives beside its domain. New executable source appears only
with an identified owner, a contract it fulfills, and a proof in the same change.
The repository has no generic `core`, `shared`, `common`, `utils`, `helpers`,
`models`, or `services` holding areas.

The local thought loop, anonymous identity, durable synchronization, WebMCP, and
both composition roots are executable. Rich spatial items, professional erasing,
documents, assets, and production recovery remain contract-led future slices. Run
every active proof with:

```sh
pnpm verify
```
