# Identity and Access Contract

> Domain: anonymous identity, workspace authorization, and device linking.
>
> Owner: `SessionAuthority`.

## Responsibility

`SessionAuthority` turns an anonymous browser into a revocable workspace member. It
owns device-session credentials, membership roles, join capabilities, and the
authorization decision used by HTTP, WebSocket, assets, and WebMCP.

## Owned state

| Record | Owned fact |
|---|---|
| `device_sessions` | Session ID, secret hash, creation, expiration, and revocation |
| `workspace_members` | Session-to-workspace role |
| `join_tokens` | Token hash, workspace, granted role, expiration, and consumption |
| `workspaces` | Workspace lifecycle and deletion state |

The browser stores the session secret only in a protected cookie. PostgreSQL stores
only its cryptographic hash.

## Roles

| Role | Capability |
|---|---|
| `owner` | Read, mutate, link or revoke devices, and delete the workspace |
| `editor` | Read and mutate workspace content |
| `viewer` | Read workspace content |

WebMCP inherits the role of the current page session.

## Bootstrap contract

1. The browser can create local `bootstrapId` and `workspaceId` values before the
   network responds.
2. `bootstrapId` is a high-entropy, short-lived bootstrap capability. The server
   stores its hash and uses it to make `bootstrap` idempotent.
3. An unclaimed `workspaceId` becomes a workspace with the new session as `owner`.
4. An occupied unrelated ID returns `409 Conflict` without disclosing workspace
   data.
5. Success sets a cookie with `HttpOnly`, `Secure`, `SameSite`, a bounded lifetime,
   and an explicit path.
6. Once the browser has acknowledged its session, the bootstrap capability is
   consumed or expires after a bounded retry window.
7. The bootstrap response contains workspace identity and role, never the stored
   secret hash.

## Device-link contract

1. An authorized owner creates a random one-time join capability for one role and
   expiration.
2. The displayed QR code or link contains the raw token; the database contains its
   hash.
3. Consumption is atomic: exactly one valid new session receives membership.
4. The new browser removes the token from its visible URL after exchange.
5. Revocation invalidates future HTTP, WebSocket, asset, and WebMCP authorization
   for that session.

## Authorization guarantees

Every protected request validates the cookie, expiration, revocation, membership,
role, and requested workspace before entering its domain owner. State-changing HTTP
requests and WebSocket upgrades also validate `Origin`. The authorization result
contains only session ID, workspace ID, and role; downstream code receives no raw
credential.

## Failure and recovery

Invalid, expired, consumed, or revoked capabilities reveal no workspace content and
change no membership. Losing every linked session ends ordinary proof of ownership.
An optional separately held recovery secret may create a new owner session; its
absence remains an honest recovery boundary.

## Executable proof

The authority-level guarantees are proved by
[session-authority.test.ts](tests/session-authority.test.ts).

- First visit produces a workspace without a registration screen.
- Repeating bootstrap returns the same session/workspace relationship.
- Two concurrent join-token consumptions create one membership.
- A revoked session immediately loses HTTP and WebSocket access.
- `viewer` cannot produce a durable operation.
- Tool results and logs contain no cookie, raw join token, or device secret.
