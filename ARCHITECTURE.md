# Foldthink Architecture

> Status: accepted decision for the first public implementation.
>
> Date: August 31, 2026.
>
> This is a target contract, not a readiness report. Code, tests, the deployed
> revision, and a restore drill prove the actual state.

## 1. The decision in one sentence

Foldthink is a browser-based, locally responsive surface for shared thinking: a
person can draw on an infinite board immediately, an agent can inspect and change
the same model through WebMCP, the browser keeps a working copy and an outgoing
queue in IndexedDB, and Foldthink's own server synchronizes devices and stores
acknowledged state in PostgreSQL.

The main architectural idea is simple. Every thought on the canvas has one semantic
owner: the workspace model. Apple Pencil, gestures, the interface, and the agent
only bring commands to that owner, and those commands converge into one drawing.

## 2. Product contract

The first visible Foldthink screen is the board. A person does not need to register,
choose a plan, create a profile, or complete an introduction. On the first visit,
the server silently gives the browser an anonymous session and creates a workspace.
If the network responds slowly, the board still accepts drawing locally and sends
it later.

The workspace must keep these promises:

1. Drawing feels local: the hot path from Pointer Event to pixel does not wait for
   React, the network, or the database.
2. A server-acknowledged action returns after reload and appears on a linked
   device.
3. The person and the agent change one model through the same commands. An agent
   command returns a verifiable receipt.
4. A second device joins through a one-time link or QR code rather than an account.
5. Board ink, cover ink, and page ink belong to their respective surfaces and move
   with them.
6. Deletion, erasure, and editing are as durable as creation. A stale device cannot
   restore deleted content when it reconnects.

## 3. System outline

```text
 Apple Pencil ----\
 Finger gestures --+--> WorkspaceRuntime.dispatch(command)
 React UI ---------+                 |
 WebMCP -----------/                 v
                              Scene documents
                              /      |       \
                             /       |        \
                      Canvas 2D   IndexedDB   Sync client
                                              |
                                      HTTPS / WebSocket
                                              |
                                      Foldthink server
                                      /              \
                              PostgreSQL         Object storage
```

The browser is the place where work happens. The server owns delivery, anonymous
session authorization, and durable recovery. PostgreSQL owns durable structured
data. Object storage owns large immutable files and offsite backups.

This is a **cloud-backed local-first** model. The local copy provides immediate
action and offline work. The server copy lets a person return tomorrow, open the
same work on another device, and recover after browser storage is lost.

## 4. Ownership map

The names below describe responsibilities. Concrete types may use the same names
when doing so keeps the code clear.

| Meaning | Owner | What it stores or does | Verifiable consequence |
|---|---|---|---|
| Semantic mutation | `WorkspaceRuntime` | Accepts commands, checks invariants, and creates a CRDT change | Every adapter receives the same result from the same command |
| Surface content | `SceneDocument` | Scene elements and their CRDT representation | Two clients converge on one scene regardless of delivery order |
| Active stroke | `InkSession` | One active point buffer with one `strokeId` | The screen does not contain separate draft and final lines from different owners |
| Board camera | `ViewportController` | Pan, scale, and pinch focus | The camera follows the fingers continuously without changing content |
| Spatial interaction | `SpatialWorkspaceController` | Selection, lifted movement, and board/item transitions | Every gesture settles on the board or inside one item |
| Rendering | `CanvasSceneRenderer` | Turns a scene snapshot and active stroke into pixels | React does not rerender for every Pencil point |
| Local durability | `LocalWorkspaceStore` | IndexedDB copy, local updates, and outbox | Unacknowledged work survives a local reload |
| Delivery | `SyncClient` and `SyncGateway` | WebSocket, retries, acknowledgements, and live messages | Retrying one operation does not create a second action |
| Access | `SessionAuthority` | Anonymous sessions, membership, and one-time linking | A valid capability grants only its assigned role |
| Server durability | PostgreSQL | Operations, updates, snapshots, sessions, and asset metadata | An acknowledged revision can be restored into a clean database |
| Large bytes | S3/R2-compatible storage | Attachments, derived files, and backups | Large bytes stay outside the database, and an offsite copy survives VPS loss |
| Agent entry point | `WebMCPAdapter` | Turns a typed tool call into a domain command | The agent passes the same model validation and receives a receipt |
| Document readout | `DocumentRenderer` | Derived Markdown, math, and document layout | Deleting a readout leaves source intact and allows a complete rebuild |
| LaTeX artifacts | `LatexCompiler` | Restricted Tectonic jobs and reproducible output | One source/version key yields one verified derived artifact |
| Interactive execution | `WidgetHost` | Sandboxed widget lifecycle and typed messages | A widget can fail without gaining page authority or breaking the document |
| Asset lifecycle | `AssetRegistry` | Upload authorization, verification, metadata, and scoped retrieval | Only verified ready bytes become scene content |
| Operational proof | Release process and pgBackRest | Exact revision, migration result, offsite backup, and clean restore | A release can identify and restore the state it claims to protect |

Yjs is an internal mechanism of `SceneDocument`. A domain command remains the only
public editing API available to adapters.

The corresponding observable boundaries are indexed in
[CONTRACTS.md](CONTRACTS.md). Each binding contract lives beside its domain owner.

## 5. Repository ownership shape

The repository is organized by the fact that changes, not by the process that
happens to execute it. `apps/web` and `apps/server` are thin composition roots.
Product meaning lives under an explicitly named domain.

```text
Foldthink/
|-- AGENTS.md                   # question -> domain -> owner -> proof
|-- apps/
|   |-- web/                    # browser composition only
|   `-- server/                 # server composition only
|-- domains/
|   |-- surface/                # durable scene meaning
|   |-- workspace/              # semantic mutation
|   |-- interaction/            # input, viewport, and pixels
|   |-- local-persistence/      # browser replica and outbox
|   |-- identity/               # sessions and access decisions
|   |-- synchronization/        # delivery and recovery
|   |-- asset/                  # verified immutable bytes
|   |-- document/               # source and rich readouts
|   `-- agent-integration/      # WebMCP adapter
|-- database/                   # one total PostgreSQL migration order
|-- operations/                 # deployment and recovery proof
|-- tests/                      # cross-domain journeys only
`-- scripts/                    # executable structure checks
```

`CONTRACTS.md` remains the public index. Each domain's binding contract lives
beside its owner as `domains/<domain>/CONTRACT.md`; the operations contract lives
at `operations/CONTRACT.md`. There is no parallel contract tree.

### 5.1 Domain activation

A domain directory may initially contain only its factual map and accepted
contract. Executable source activates the package only when its owner and proof
exist in the same change. A synchronization package then has this shape:

```text
domains/synchronization/
|-- AGENTS.md
|-- CONTRACT.md
|-- package.json
|-- tsconfig.json
|-- src/
|   |-- public-protocol.ts
|   |-- public-browser.ts
|   |-- public-server.ts
|   |-- operation-envelope.ts
|   |-- committed-receipt.ts
|   |-- sync-client.ts
|   |-- websocket-sync-transport.ts
|   |-- sync-gateway.ts
|   |-- surface-room.ts
|   `-- postgres-operation-journal.ts
`-- tests/
    |-- sync-client.test.ts
    |-- sync-gateway.test.ts
    |-- operation-idempotency.test.ts
    `-- stale-client-reconnect.test.ts
```

An empty future class is not architecture. A source directory, package manifest,
and test directory appear together with working behavior.

### 5.2 Owners and named files

| Domain | Owner files | Other explicitly named responsibilities |
|---|---|---|
| Surface | `scene-document.ts` | `scene-element.ts`, `surface-snapshot.ts`, `erase-mask.ts`, `yjs-scene-codec.ts` |
| Workspace | `workspace-runtime.ts` | `workspace-command.ts`, `command-receipt.ts`, `workspace-invariants.ts` |
| Interaction | `ink-session.ts`, `viewport-controller.ts`, `canvas-scene-renderer.ts` | `pointer-intent-adapter.ts`, `surface-coordinate-map.ts` |
| Local persistence | `local-workspace-store.ts` | `indexeddb-schema.ts`, `outbox-record.ts` |
| Identity | `session-authority.ts` | `device-session.ts`, `workspace-membership.ts`, `join-capability.ts`, `postgres-session-store.ts` |
| Synchronization | `sync-client.ts`, `sync-gateway.ts` | `operation-envelope.ts`, `committed-receipt.ts`, `postgres-operation-journal.ts` |
| Asset | `asset-registry.ts` | `asset-record.ts`, `s3-object-store.ts`, `postgres-asset-store.ts` |
| Document | `document-renderer.ts`, `latex-compiler.ts`, `widget-host.ts` | `block-editor.tsx`, `markdown-pipeline.ts`, `widget-message.ts` |
| Agent integration | `webmcp-adapter.ts` | `inspect-current-surface-tool.ts`, `apply-surface-patch-tool.ts`, `site-tool-schema.ts` |

`SessionAuthority` names the component that decides access. `AssetRegistry` names
the component that owns the verified asset lifecycle. The word `Service` is not
used as a substitute for a responsibility.

### 5.3 Dependency direction

| Domain | May import public APIs from |
|---|---|
| Surface | No other Foldthink domain |
| Workspace | Surface |
| Interaction | Workspace, surface |
| Local persistence | Workspace, surface |
| Identity | No other Foldthink domain |
| Synchronization | Workspace, surface, local persistence, identity |
| Asset | Identity |
| Document | Workspace, surface, asset |
| Agent integration | Workspace, surface, interaction |
| `apps/*` | Public entry points of the domains they compose |

```text
surface
   ^
   |
workspace <---- local-persistence
   ^                    ^
   |                    |
interaction      synchronization <---- identity
   ^
   |
agent-integration

document ----> asset ----> identity
    |
    `--------> workspace ----> surface
```

`dependency-cruiser.cjs` rejects cycles, undeclared domain edges, cross-domain
internal imports, app dependencies from domains, browser access to server
entrypoints or Node.js, server access to browser entrypoints, and Yjs imports
outside the surface domain. ESLint adds source-level browser and server guards.

### 5.4 Mechanism ownership

| Mechanism | Sole owner |
|---|---|
| Yjs mutation and decoding | `domains/surface` |
| Pointer Events and Canvas | `domains/interaction` |
| IndexedDB | `domains/local-persistence` |
| WebSocket synchronization protocol | `domains/synchronization` |
| Cookies, membership, and join capabilities | `domains/identity` |
| WebMCP browser API | `domains/agent-integration` |
| CodeMirror, remark, KaTeX, Tectonic, and widget iframe | `domains/document` |
| S3/R2 application access | `domains/asset` |
| Caddy and pgBackRest | `operations` |

Synchronization transports a surface update as opaque bytes. It can ask the
surface public API to validate a candidate state, but it cannot import Yjs or
interpret scene content itself.

### 5.5 Public package APIs

A domain package exports only explicit entry points:

```json
{
  "name": "@foldthink/synchronization",
  "exports": {
    "./protocol": "./src/public-protocol.ts",
    "./browser": "./src/public-browser.ts",
    "./server": "./src/public-server.ts"
  }
}
```

Imports therefore state their intent:

```ts
import { SyncClient } from "@foldthink/synchronization/browser";
import { SyncGateway } from "@foldthink/synchronization/server";
import type { OperationEnvelope } from "@foldthink/synchronization/protocol";
```

`package.json#exports` closes deep imports into `src/`. Domain code never imports
an app.

### 5.6 File-name grammar

| Meaning | Name form | Example |
|---|---|---|
| State owner | `<owned-noun>.ts` | `scene-document.ts` |
| Intent coordinator | `<domain>-runtime.ts` | `workspace-runtime.ts` |
| External mechanism | `<mechanism>-<responsibility>.ts` | `postgres-operation-journal.ts` |
| Durable record | `<meaning>-record.ts` | `outbox-record.ts` |
| Derived readout | `<meaning>-renderer.ts` | `document-renderer.ts` |
| Input adapter | `<source>-<intent>-adapter.ts` | `pointer-intent-adapter.ts` |
| Proof | Same stem plus `.test.ts` | `workspace-runtime.test.ts` |
| Migration | `<time>_<domain>__<action>.sql` | `202608310002_sync__create_surface_streams.sql` |

The tree contains no `core`, `shared`, `common`, `utils`, `helpers`, `models`, or
general `services` holding area. A reusable fact still has a subject owner. If an
owner cannot be named, the boundary is not understood well enough to add the file.

The exact navigation chain is:

```text
What fact changes?
        |
        v
Which domain owns it?
        |
        v
Which owner file decides?
        |
        v
Which test proves its contract?
```

## 6. Domain model

A workspace consists of a lightweight manifest and independent surfaces. Opening
one notebook therefore does not require loading every page of every notebook.

```text
Workspace
|-- Workspace manifest surface
|   |-- item identity and kind
|   |-- world transform and z-order
|   `-- stack membership and order
|-- Board drawing surface
`-- Items
    |-- Notebook
    |   |-- Notebook manifest: cover and ordered page references
    |   |-- Cover surface
    |   `-- Page surfaces
    `-- Document
        |-- Document manifest
        `-- Document surface
```

The workspace manifest owns the visual placement of items. PostgreSQL knows which
workspace owns a surface stream, but it does not keep a second copy of a notebook's
coordinates. Item creation uses client-generated opaque IDs and one idempotent
operation that registers the new surfaces and updates the manifest in one server
transaction.

Every surface uses the same primitive elements:

| Element | Canonical content | Derived representation |
|---|---|---|
| `InkStroke` | Points in local coordinates, pressure, tool, and color | Canvas path and spatial index |
| `EraseMask` | Eraser path and IDs of affected strokes | Ink-layer transparency mask |
| `MarkdownBlock` | Markdown source | HTML and KaTeX |
| `LatexBlock` | LaTeX source and compilation parameters | SVG/PDF/HTML preview |
| `Shape` | Geometry and style | Canvas/SVG representation |
| `Widget` | Versioned HTML/CSS/JS bundle and input data | Isolated interactive iframe |

All geometry is stored in the local coordinates of its surface. A cover moves its
drawing through its own transform, so ink cannot detach while the notebook moves.
Screen coordinates, camera state, and window size never enter the durable model.

The board and a notebook page have different visual materials. A page may render a
5 mm grid in its local coordinate system; the grid is a background rather than
thousands of scene elements.

## 7. The single mutation path

Local intent becomes a typed command:

```text
Intent adapter
    |
    v
WorkspaceRuntime.dispatch(Command)
    |
    +-- validate domain invariants
    +-- apply one local SceneDocument transaction
    +-- persist update + outbox in one IndexedDB transaction
    `-- publish one render snapshot
```

Example commands include `CreateItem`, `MoveItem`, `CommitStroke`, `EraseInk`,
`EditMarkdown`, `ApplyElementPatch`, `DeleteItem`, and `UndoOwnAction`. Apple
Pencil, React, and WebMCP create these commands rather than their own mutation
formats.

A network update enters through `WorkspaceRuntime.acceptRemoteUpdate(update)`. It
is applied to the same `SceneDocument` and invariants, but it is not reinterpreted
as a new local command or sent a second time.

Every result has one shape:

```text
CommandReceipt
|-- operationId
|-- changedIds[]
|-- surfaces[]
|   |-- surfaceId
|   `-- revision?       # appears after the server commit
`-- syncState           # local | queued | committed | rejected
```

The interface may continue after a local receipt. A rejected receipt names the
reason and the committed revisions from which synchronization rebuilt the local
replica; rejection never attempts to subtract a Yjs update from a live document.
By default, a mutating WebMCP
tool waits for a server acknowledgement within a bounded timeout. While offline,
it honestly returns `queued`, and the agent does not describe the change as visible
on another device until a later inspection verifies it.

## 8. Ink, erasing, and coordinates

The client uses TypeScript, React 19, and Vite as the PWA shell. Drawing itself runs
inside a Canvas 2D runtime. Pointer Events provide coordinates, pointer type, and
pressure. Real coalesced samples improve geometry; predicted samples provide only a
brief visual hint and are never persisted.

A stroke follows this path:

```text
pointerdown -> InkSession(strokeId)
pointermove -> active point buffer -> next animation frame -> Canvas
pointerup   -> CommitStroke(same strokeId) -> scene + IndexedDB outbox
```

At completion, the frame first sees the durable element with the same `strokeId`
and then removes the active overlay. The line is therefore not replaced by a
second line and does not flash. The tool setting owns minimum opacity. Pressure
interpolates opacity and, for tools that support it, width toward their maximum.
A simulator without pressure supplies a defined neutral value.

The eraser creates a geometric `EraseMask` through the local spatial index. The
mask stores its path and affected strokes, so it removes parts of lines, stays
deterministic during synchronization, and can be undone as one operation. The
renderer first builds a transparent ink layer, applies masks, and then composites
that layer over the paper. The page grid remains intact.

Coordinates have three explicit spaces:

| Space | Owner | Purpose |
|---|---|---|
| CSS pixels | Browser viewport | Pointer Event input and UI placement |
| World | `ViewportController` | Infinite board and camera |
| Surface local | `SceneDocument` | Durable element geometry |

The conversion happens once at input. The Canvas backing store follows
`devicePixelRatio` and `ResizeObserver`; a window change reallocates the buffer and
rerenders the complete scene instead of stretching old pixels.

One `GestureArena` classifies every pointer sequence and grants it to one owner
until every participating pointer ends. Pointer capture, cancellation,
`touch-action`, selection, and context-menu suppression follow that decision.
Fingers control the camera and objects. Pencil controls ink. The pinch focus is
fixed in world space when the gesture begins. Opening a notebook is an explicit
`board -> entering(item, progress) -> item` transition: progress follows the
gesture, uses hysteresis, and always settles into one of two stable states. A
double-tap issues an explicit open command. These rules let a person inspect the
board more closely without being pulled prematurely into a notebook.

## 9. Synchronization

Yjs resolves concurrent content changes. Foldthink adds durable delivery,
idempotency, and an understandable receipt.

```text
Browser A             Foldthink server             Browser B
    |                        |                          |
    |-- ephemeral chunk --->|------------------------->|  live preview
    |                        |                          |
    |-- durable operation ->|                          |
    |                   PostgreSQL transaction         |
    |                 operation + update + revision    |
    |<-- committed receipt --|-- durable update ------>|
    |                        |                          |
```

| Stream | Content | Storage | Consequence of a lost message |
|---|---|---|---|
| Live | Chunks of an unfinished stroke | Memory and WebSocket only | The remote preview disappears; the final stroke corrects it |
| Durable | Finished stroke, erasure, text, patch, creation, movement, deletion | IndexedDB outbox and PostgreSQL | The client retries the same `operationId` |

One durable operation may touch several surfaces. In one transaction, the server
checks membership, records the unique `operationId`, registers declared surfaces,
appends Yjs updates, increments each surface's monotonic revision, and broadcasts
the acknowledgement only after commit.

An operation carries the complete typed intent and a CRDT payload scoped to its
surfaces. The server computes `changedIds`; the client never declares its own
semantic result as trusted input.
`SyncGateway` applies that payload to a validation copy of the materialized state
and invokes the public schemas and invariants of the owning domains before commit.
Client validation improves UX; the server repeats it as a security boundary. Only
an accepted typed
operation enters the journal.

The client removes an outbox record only after acknowledgement. HTTP response and
WebSocket broadcast can arrive in either order and converge through the same
`operationId`. If the operation is
retried, the server returns the stored receipt. During recovery, the client fetches
the latest compact snapshot and the updates after its revision, applies them, and
then flushes the outbox. A snapshot contains the CRDT fact of deletion, so a stale
client cannot resurrect erased content merely by reconnecting.

On typed rejection, the client builds fresh documents from committed server state,
replays only surviving independent outbox operations, stores the repaired replica
atomically, and publishes one repaired scene. Camera, selection, hovered tool, and unfinished gesture are transient local state.
They join synchronization only as live presence if the product later needs a shared
pointer.

## 10. Anonymous sessions and device linking

The absence of registration means invisible capability-based identity, not the
absence of access control.

Before the network responds, the browser generates random `bootstrapId` and
`workspaceId` values, opens a local workspace, and can already place operations in
the outbox. The first idempotent bootstrap request asks the server to create that
specific, still-unclaimed workspace. An ID collision returns `409 Conflict` and
triggers a local ID remap before the first send; the normal path preserves every
reference in the drawing as it was created.

The server then creates a cryptographically random device secret, stores only its
hash, and gives the browser a protected cookie with `HttpOnly`, `Secure`, and
`SameSite` attributes. The session becomes a member of the workspace, and the
outbox begins its normal synchronization path. The same browser continues
automatically on the next visit.

Linking an iPad and a Mac follows this sequence:

```text
Existing device        Server             New device
      |                  |                     |
      |-- create join -->|                     |
      |<-- QR/link token-|                     |
      |                  |<-- consume once ----|
      |                  |-- add membership -->|
      |<====== both sessions share workspace ==|
```

A join token has one role, one use, and an expiration, and the server stores only
its hash. The browser removes the token from the URL after exchange. A device can
be revoked, and an authorized session can delete the workspace.

The recovery boundary is honest: if a person loses every linked session and the
separate recovery secret, the server can no longer prove ownership. An optional
recovery QR code or key may improve this case, but it never blocks the first visit.

## 11. Server and PostgreSQL

The first server is one TypeScript application on the current Node.js LTS release.
It serves the HTTP API, WebSocket synchronization, anonymous sessions, uploads,
and WebMCP-related server actions. One process keeps transaction boundaries
visible. It should split into services only after a measured reason appears.

Only the Foldthink server connects to PostgreSQL through a private network. The
browser talks to the Foldthink API. The conceptual schema assigns responsibility
as follows:

| Table | Owns |
|---|---|
| `device_sessions` | Device secret hash, expiration, and revocation |
| `workspaces` | Workspace identity and lifecycle |
| `workspace_members` | The anonymous session's role in a workspace |
| `workspace_operations` | Operation idempotency and the resulting receipt |
| `surfaces` | A stream's workspace ownership and current revision |
| `surface_updates` | Ordered Yjs updates produced by operations |
| `surface_snapshots` | Compact state through a particular revision |
| `join_tokens` | Invitation hashes, roles, expirations, and consumption |
| `assets` | Metadata, checksum, MIME type, size, and object key |

Coordinates, a handwritten cover title, and page content live in the scene. The
tables do not keep a competing copy of user meaning. Search indexes, when they
appear, are explicitly derived and rebuildable.

`AssetRegistry` uploads large attachments to S3/R2-compatible object storage through
a server-scoped capability. PostgreSQL stores their verifiable metadata.
Compilation outputs and previews are addressed by a hash of source, renderer
version, and parameters, making them a reproducible cache.

## 12. Documents, Markdown, LaTeX, and interactivity

For an editable block, source is always the owner of meaning. A double-tap on text
opens CodeMirror 6 over that same block. Saving dispatches `EditMarkdown` or
`EditLatex`; the preview is a purely derived result.

`DocumentRenderer` sends Markdown through unified/remark. KaTeX renders
mathematical fragments for an immediate preview. `LatexCompiler` runs Tectonic for
a complete `.tex` document in a separate, restricted process or container with no
network and with limits on time, memory, output size, and permitted files. Compiler
output never replaces the source.

An interactive element lives as a `Widget` beside the document flow and visually
matches the typography of the page. `WidgetHost` runs its HTML/CSS/JS in a sandboxed
iframe on a separate origin without `allow-same-origin`; the iframe therefore has
an opaque origin. One bootstrap `postMessage` verifies `event.source`, transfers a
dedicated `MessageChannel`, and all later communication uses that capability with
a nonce, versioned schemas, and size limits. Widget code receives only explicitly
granted messages and network capabilities; cookies, the parent DOM, and the WebMCP
API remain with the top-level page.

LaTeX therefore owns the document, while JavaScript owns an interactive window
inside it. They form one page visually while keeping separate, safe ownership.

## 13. WebMCP

`WebMCPAdapter` registers tools in the top-level page through
`document.modelContext.registerTool`, because an embedded iframe should not become
a hidden owner of the workspace. WebMCP is a progressive enhancement: the board
continues to work in a browser without this API.

The initial stable tool set remains narrow:

| Tool | Action | Result verification |
|---|---|---|
| `inspect_surface` | Returns visible elements, IDs, and current revisions | The agent understands exactly what the person sees |
| `patch_surface` | Creates one typed domain operation | Returns `operationId`, `changedIds`, and server revisions |
| `create_item` | Creates a notebook or document through one discriminated command | The new item and its surfaces appear atomically |
| `focus_item` | Changes the current browser's local camera | Returns the item that actually received focus |

Tool JSON Schemas come from the same domain schemas that `WorkspaceRuntime` uses
to validate application commands. A tool returns no cookie, join token, or
object-store key. After a
mutation, the agent can inspect again and compare revisions rather than treating
the tool call itself as proof of success.

The tools are registered once in the top-level page, while each handler reads the
fresh runtime and selection at execution. Production sends
`Origin-Agent-Cluster: ?1` and `Permissions-Policy: tools=(self)`. Agent-authored or
workspace-authored text is treated as untrusted tool content, and an executable
agent-eval court verifies selection, cancellation, bounded output, and that the
interface visibly changes before a mutating tool reports success.

## 14. Deployment

The initial production topology fits in Docker Compose on one server, while its
backup leaves that server:

```text
Internet
   |
 Caddy
   |-- static PWA
   |-- /api  ----\
   `-- /sync -----+--> foldthink app
                            |
                      private network
                            |
                        PostgreSQL
                            |
                       pgBackRest
                            |
                  external S3/R2 backup bucket

foldthink app ----------------> external asset bucket
```

Caddy terminates TLS, serves the static PWA, and proxies the same-origin API and
WebSocket. The PostgreSQL container is available only on the private network.
Migrations are ordered, tested against a clean database, and run as a separate
release step.

pgBackRest archives WAL and full/incremental backups to external object storage to
provide point-in-time recovery. The presence of a backup file does not prove
recoverability: release readiness includes restoring into a clean PostgreSQL
instance, running compatibility migrations, and opening a real workspace. Measured
RPO and RTO then become the published operational targets.

Foldthink owns PostgreSQL because its server already has to own anonymous
capability sessions, idempotent multi-surface operations, and the product-specific
live/durable protocol. Supabase Auth, Realtime, and a direct database client would
create parallel owners that the product does not use. The schema remains standard
PostgreSQL with portable SQL, so the database can move to a managed PostgreSQL
provider without changing the browser or domain model when operational load grows.

## 15. Security

Security follows the same owners:

1. Caddy provides TLS and one origin for the PWA, API, and WebSocket.
2. `SessionAuthority` uses a protected cookie, rotation, revocation, and only secret
   hashes in the database.
3. HTTP mutations and the WebSocket upgrade validate `Origin`, session, membership,
   and role.
4. Every command passes the shared JSON Schema, domain invariants, size limits, and
   rate limits before it is stored.
5. CSP restricts sources for code, frames, connections, and assets.
6. Agent-generated JavaScript runs in a dedicated iframe document whose sandbox
   gives it an opaque origin; a widget-only Content Security Policy and a narrow
   message protocol define its capabilities.
7. Attachments pass size, MIME, and checksum validation; the user receives a scoped
   URL rather than a storage key.
8. Logs contain a generated request ID, route template, revision, duration, and
   error class. Workspace, operation, asset, content, and secret identifiers remain
   inside their respective stores.
9. A workspace is private by default. Sharing always creates an explicit capability
   with a role and expiration.

## 16. Observability and recovery

| Signal | What it reveals | Response when it fails |
|---|---|---|
| Input-to-frame latency | Whether React, the network, or heavy geometry entered the hot path | Profile the Canvas runtime and spatial index |
| Commit acknowledgement p50/p95/p99 | How long durable acknowledgement takes | Separate network, event-loop queue, and PostgreSQL transaction time |
| Oldest outbox age | Whether user actions lack a server copy | Show status and repair delivery before scaling |
| Active/reconnecting WebSockets | Stability of the realtime channel | Check proxy timeouts, heartbeat, and backoff |
| Update/snapshot size | Whether a surface needs compaction | Run bounded snapshot compaction |
| PostgreSQL errors and saturation | Health of the durability owner | Pause unsafe writes and restore capacity |
| Last WAL archive and backup | Freshness of the offsite copy | Block release when overdue |
| Last clean restore drill | Whether the backup is actually recoverable | Repair the procedure before making a user promise |

The health endpoint proves that the process is alive. The readiness endpoint proves
that it can verify migrations and issue a short PostgreSQL query. A separate
synthetic scenario creates a temporary surface, writes an operation, reads it over
WebSocket, verifies a referenced asset, and deletes the workspace. The production
court runs that scenario through Caddy, destroys the PostgreSQL volume, restores a
clean volume from pgBackRest, and writes the measured result only after the same
HTTP state, WebSocket history, CRDT stroke, and object checksum return.

## 17. Verification of architectural contracts

The architecture is fulfilled only through observable scenarios.

### Model and storage

- Property tests reorder and repeat CRDT updates and obtain the same scene.
- Repeating one `operationId` returns the original receipt and one mutation.
- A snapshot plus updates after its revision reconstructs the exact state.
- Deletion and erasure persist after exit, reload, and connection of a stale client.
- Notebook creation either registers every surface and the manifest update, or the
  operation receives no acknowledgement.

### Browser

- Playwright sees the canvas in the first frame without blocking registration.
- A drawing made before the bootstrap API responds survives reload and later
  receives a server revision.
- Two browser contexts synchronize a stroke live and read the durable version after
  reload.
- An offline change is delivered once after reconnect.
- Cover ink remains inside the notebook transform during movement and scaling.
- Resize and a `devicePixelRatio` change preserve geometry and proportions.
- The board and notebook page retain different visual materials.
- A pinch transition always settles on the board or inside an open item.

### Agent and documents

- A WebMCP patch returns a revision that both devices then observe.
- Inspection after a patch confirms the specific `changedIds`.
- A double-tap changes Markdown/LaTeX source, and the preview rebuilds from it.
- A widget iframe cannot read cookies, the parent DOM, or session APIs.
- A Tectonic job obeys time, memory, network, and output-size limits.

### Production

- The contract passes on a physical iPad in Safari with Apple Pencil and on a Mac,
  not only in a simulator.
- A clean PostgreSQL instance restores from an offsite backup to a verifiable
  revision.
- The deployed exact commit answers readiness and passes the synthetic sync path.

## 18. Implementation order

Every stage ends with a working vertical slice:

1. **Local surface.** The PWA opens directly to the board, Canvas 2D draws one
   stroke, and `WorkspaceRuntime` stores it in one IndexedDB. This slice passes in
   a real browser and on a physical iPad before server work can hide input defects.
2. **WebMCP on the real runtime.** Stable inspection and patch tools call the
   executable `WorkspaceRuntime`; unsupported browsers keep the full human path.
3. **Durable sync.** Anonymous session, PostgreSQL, idempotent operation,
   WebSocket, acknowledgement, reload, offline outbox, and two browsers pass
   end-to-end.
4. **Human-agent proof.** Pencil input on iPad reaches the Mac page; a WebMCP patch
   returns through the same durable path and appears on both devices.
5. **Spatial workspace.** Manifest, notebook, document, surfaces, movement, stacks,
   and the pinch-controlled transition use one coordinate system.
6. **Ink completeness.** Pressure, eraser, undo, resize, and Pencil pass physical
   device testing.
7. **Rich document.** Markdown, KaTeX, restricted Tectonic, and sandboxed widgets
   extend the same block model.
8. **Public readiness.** CSP, limits, monitoring, WAL archiving, a clean restore,
   and data deletion pass the release gate.

This order keeps the primary risk in the center: the person and the agent must first
see one reliably stored surface. Document richness is added on top of a proven loop
rather than hiding an unreliable one.

## 19. Evolution rules

The architecture changes in response to a measured consequence:

| Observation | Next admissible decision |
|---|---|
| Canvas 2D misses the measured frame budget on target devices | Move rendering to WebGL/WebGPU while preserving `SceneDocument` and commands |
| One realtime process exhausts measured network or CPU capacity | Partition rooms across processes and add the smallest delivery bus that works |
| Database operations become the primary risk | Move the same schema and backup contract to managed PostgreSQL |
| Snapshot compaction interferes with user commits | Move compaction to a worker while PostgreSQL remains the result owner |
| Search across many workspaces becomes a product scenario | Add a rebuildable projection index while the scene remains the source of meaning |

The initial system consists of one application, a direct WebSocket path, and
PostgreSQL. Redis, Kafka, Kubernetes, a separate authentication service, or a new
binary protocol earn a place only when a measurement requires a new owner. This
boundary keeps the first system small and gives it a clear growth path.

A change is architectural when it moves the owner of state, adds a durable source,
or changes an action receipt. Such a change updates this document and its
verifiable contract before it changes the code.

## 20. Normative references

- [OpenAI WebMCP](https://learn.chatgpt.com/docs/webmcp)
- [Yjs documentation](https://docs.yjs.dev/)
- [Pointer Events Level 3](https://www.w3.org/TR/pointerevents3/)
- [PostgreSQL continuous archiving and PITR](https://www.postgresql.org/docs/current/continuous-archiving.html)
- [pgBackRest user guide](https://pgbackrest.org/user-guide.html)
- [Tectonic](https://github.com/tectonic-typesetting/tectonic)
