# Foldthink Implementation Contracts

> Status: target contracts for the first public implementation.
>
> These documents define observable boundaries. Code, schemas, migrations, and
> tests become their executable proof as each vertical slice is implemented.

## Purpose

[PHILOSOPHY.md](PHILOSOPHY.md) explains what Foldthink values.
[ARCHITECTURE.md](ARCHITECTURE.md) explains which mechanism owns each kind of
state. These contracts explain exactly what each owner accepts, changes, returns,
and proves.

The distinction is deliberate:

```text
philosophy -> desired relationship
architecture -> owner and boundary
contract -> input, transition, result, failure, proof
implementation -> code that fulfills the contract
```

A contract exists where responsibility crosses a boundary. It gives two parts of
the system one shared fact without giving either of them a second copy of the
other's state.

## Ownership rules

1. Every durable fact has one semantic owner.
2. Adapters express intent through domain commands. They do not edit another
   owner's state directly.
3. Derived views can be rebuilt from their source and never become a competing
   source of meaning.
4. Success has an observable result: a snapshot, receipt, revision, rendered frame,
   or restore result.
5. Failure has an explicit state. A component never reports a stronger guarantee
   than it has proved.
6. A new owner appears only when an existing owner cannot fulfill a measured
   responsibility.

## Responsibility flow

```text
Pencil / fingers / React / WebMCP
                |
                v
         WorkspaceRuntime
                |
                v
          SceneDocument --------> CanvasSceneRenderer
                |
                v
      LocalWorkspaceStore
                |
                v
            SyncClient
                |
                v
           SyncGateway
          /           \
   PostgreSQL      Object storage
```

The arrows carry commands, updates, or read-only snapshots. They do not transfer
ownership of the underlying state.

## Domain map

| Domain | Primary owner or owners | Owned responsibility | Contract |
|---|---|---|---|
| Workspace | `WorkspaceRuntime` | Semantic commands, invariant checks, and receipts | [Workspace](domains/workspace/CONTRACT.md) |
| Surface model | `SceneDocument` | Durable scene elements, local coordinates, and CRDT state | [Surface model](domains/surface/CONTRACT.md) |
| Interaction | `InkSession`, `ViewportController`, `CanvasSceneRenderer` | Active input, camera state, and pixels | [Interaction](domains/interaction/CONTRACT.md) |
| Local persistence | `LocalWorkspaceStore` | IndexedDB replica and durable outgoing queue | [Local persistence](domains/local-persistence/CONTRACT.md) |
| Synchronization | `SyncClient`, `SyncGateway`, PostgreSQL | Delivery, idempotency, revisions, and recovery stream | [Synchronization](domains/synchronization/CONTRACT.md) |
| Identity and access | `SessionAuthority` | Anonymous device identity, membership, and linking | [Identity and access](domains/identity/CONTRACT.md) |
| Documents | `SceneDocument`, `DocumentRenderer`, `LatexCompiler`, `WidgetHost` | Editable source and safe derived representations | [Documents](domains/document/CONTRACT.md) |
| Agent integration | `WebMCPAdapter` | Typed agent tools and verified command results | [Agent integration](domains/agent-integration/CONTRACT.md) |
| Assets | `AssetRegistry`, object storage | Large immutable bytes and their verifiable metadata | [Assets](domains/asset/CONTRACT.md) |
| Operations | release process, PostgreSQL, pgBackRest | Deployment identity, migrations, backup, restore, and health | [Operations](operations/CONTRACT.md) |

## Shape of a domain contract

Every domain file answers the same questions:

| Section | Question |
|---|---|
| Owner | Which component has the authority to decide? |
| Owned state | Which facts exist only here? |
| Accepted input | What can cross into the owner? |
| Transition | What state change can the owner perform? |
| Result | What observable evidence leaves the owner? |
| Failure | Which stable state follows an unsuccessful attempt? |
| Proof | Which executable scenario demonstrates the promise? |

Numbered statements under **Contract** or **Guarantees**, together with each
**Result** and **Failure** section, are binding. TypeScript types, JSON Schemas,
database constraints, and tests should link back to the relevant domain contract
rather than restating it in a second prose specification.

## Change discipline

A domain contract lives beside its executable owner rather than in a parallel
contract tree. A contract and its executable proof change in the same commit.
Moving a state owner
also updates [ARCHITECTURE.md](ARCHITECTURE.md). Changing a public or persisted data
shape adds an explicit migration or protocol version. Rewording that preserves the
same observable behavior needs no compatibility layer.

The first implementation slice activates only the workspace, surface, interaction,
local-persistence, and web composition owners needed for a complete offline stroke.
The next slice adds identity and synchronization without replacing that mutation
path. Agent integration then binds WebMCP to the already executable runtime;
documents, assets, and recovery expand the same product loop in later slices.
