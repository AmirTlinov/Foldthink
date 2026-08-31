# Asset Contract

> Domain: large immutable bytes and derived artifacts.
>
> Owners: `AssetRegistry` and S3/R2-compatible object storage.

## Responsibility split

| Owner | Responsibility |
|---|---|
| `AssetRegistry` | Authorization, lifecycle, metadata, validation, and scoped access |
| Object storage | Durable bytes addressed by an opaque object key |
| PostgreSQL `assets` table | Workspace ownership, state, checksum, MIME, size, and object key |

`SceneDocument` stores an `assetId` reference. It does not store large bytes or a
storage credential.

## Asset lifecycle

```text
reserved -> uploaded -> ready -> deleted
                |
              rejected
```

1. An authorized command reserves a random `assetId` with expected MIME type and
   maximum size.
2. `AssetRegistry` issues a short-lived, single-purpose upload capability scoped to
   one object key.
3. Finalization verifies object presence, actual size, MIME policy, and checksum.
4. Only a `ready` asset can become visible document or scene content.
5. Deletion revokes future scoped access and schedules byte removal according to
   the retention policy.

## Guarantees

1. Asset metadata has one workspace owner and one immutable checksum after `ready`.
2. Download authorization checks current session membership and asset state.
3. A scoped URL expires and grants access only to its intended object and action.
4. Object keys and provider credentials never appear in scene content or WebMCP
   output.
5. A derived artifact key includes source checksum, producer version, and relevant
   parameters.
6. Reusing a derived artifact requires matching its recorded checksum.
7. Database metadata can enumerate orphaned objects for bounded cleanup.

## Result

A ready asset returns `assetId`, verified checksum, MIME type, size, and a bounded
method for authorized retrieval. Derived artifacts additionally report the source
identity and producer version from which they can be rebuilt.

## Failure

Oversize, MIME mismatch, checksum mismatch, missing object, expired capability, or
denied role moves the reservation to `rejected` or leaves it `reserved` for bounded
retry. No failed upload becomes visible content. Object-storage failure never marks
an asset `ready`.

## Executable proof

- A user from another workspace cannot upload to or read the asset.
- Size, MIME, and checksum mismatch each prevent the `ready` transition.
- An expired scoped URL cannot read or overwrite the object.
- Deleting derived bytes allows them to be rebuilt from canonical source.
- An orphan scan distinguishes referenced, pending, and removable objects.
