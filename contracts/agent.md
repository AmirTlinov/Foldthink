# Agent Integration Contract

> Domain: agent inspection and mutation of the live Foldthink page.
>
> Owner: `WebMCPAdapter`.

## Responsibility

`WebMCPAdapter` exposes a narrow, typed view of capabilities the Foldthink page
already provides. It translates tool calls into read-only projections or
`WorkspaceRuntime` commands and translates their results into verifiable tool
responses.

## Registration contract

1. The top-level page feature-detects
   `document.modelContext?.registerTool` before registration.
2. Tool registration reuses the page's current anonymous session, workspace, and
   role.
3. Tool names, descriptions, annotations, and JSON Schemas are generated from
   versioned definitions in `core`.
4. Browsers without WebMCP retain the complete human interface.
5. Widgets in iframes communicate with the top-level adapter rather than
   registering hidden workspace tools.

## Initial tools

| Tool | Permission | Domain action | Verifiable result |
|---|---|---|---|
| `inspect_current_surface` | read | Read the current visible surface projection | Surface ID, visible element IDs, and revisions |
| `apply_surface_patch` | edit | Dispatch one typed element patch | Operation ID, changed IDs, sync state, and revisions when committed |
| `create_notebook` | edit | Dispatch one notebook-creation command | New item and surface IDs plus receipt |
| `create_document` | edit | Dispatch one document-creation command | New item and surface IDs plus receipt |
| `focus_item` | local page control | Ask `ViewportController` to focus an item | The item ID actually focused by the page |

## Inspection guarantees

1. Inspection identifies the exact workspace, item, surface, and known revisions.
2. It returns semantic elements relevant to the current visible surface rather than
   raw Yjs internals.
3. Large binary content is represented by scoped asset metadata or a bounded
   preview.
4. A follow-up inspection can determine whether returned revisions or changed IDs
   actually changed.

## Mutation guarantees

1. Every mutating tool validates input and authorization before dispatch.
2. The adapter creates no mutation path beside `WorkspaceRuntime`.
3. By default, the tool waits for a committed receipt within a bounded timeout.
4. Offline or timed-out delivery returns `queued` with its `operationId`; it does
   not claim cross-device visibility.
5. The result includes enough identity to inspect and verify the changed state.
6. Tool responses contain no cookie, join capability, raw device secret, object
   storage credential, or unrestricted internal state.

## Failure

Unsupported API, schema failure, denied role, stale target, timeout, and domain
rejection return distinct typed results. A failure before dispatch changes nothing.
A queued operation retains its honest queued receipt and can be inspected later.

## Executable proof

- The page works fully when `document.modelContext` is absent.
- Every tool input passes its published JSON Schema.
- A WebMCP patch and the equivalent human action produce the same domain command
  shape.
- A committed tool result is visible after reload and on a linked device.
- A queued result never includes a fabricated server revision.
- A viewer session can inspect but cannot invoke a durable mutation.
- Tool output and logs contain no session or storage secret.
