# Foldthink

**Think with your agent.**

Foldthink is the public home for a notebook that people and agents can see,
draw on, and change together.

The executable surface opens without registration. A person can draw on the
infinite board, create notebooks or documents, write on their covers, move and
stack them, open one continuously, and turn or add pages. Pointer and Pencil input
stay outside React's render path, while every completed action is committed
atomically to IndexedDB. When a Foldthink server is available, the same outbox is
acknowledged by PostgreSQL and delivered to linked browsers. Page-local WebMCP
tools inspect and patch that exact runtime rather than a second agent-only model.

## Run locally

Foldthink requires Node.js 24 and pnpm 11.

```sh
pnpm install
pnpm dev
```

Open `http://localhost:5173`. Draw with a mouse or Apple Pencil, reload, and the
same locally durable surface returns. This path deliberately remains useful while
the server is unavailable.

To run the shared path, create a PostgreSQL database and start both composition
roots:

```sh
export DATABASE_URL=postgresql://localhost/foldthink
export SESSION_HMAC_KEY='replace-with-at-least-32-random-bytes'
export PUBLIC_ORIGIN=http://localhost:5173
export COOKIE_SECURE=false
pnpm migrate
pnpm dev:shared
```

`COOKIE_SECURE=false` exists only for local HTTP. A public deployment uses HTTPS
and the secure `__Host-` session cookie. A production PWA build is created with:

```sh
pnpm build
pnpm --filter @foldthink/web preview
```

## Philosophy

The product principle is documented in [PHILOSOPHY.md](PHILOSOPHY.md).

## Architecture

The system design and ownership model are documented in
[ARCHITECTURE.md](ARCHITECTURE.md).

## Implementation contracts

Observable implementation boundaries are divided by domain, owner, and
responsibility in [CONTRACTS.md](CONTRACTS.md).

## Project map

[AGENTS.md](AGENTS.md) routes a behavior question to its ownership domain,
adjacent contract, and executable proof. Source boundaries are checked by the
repository verification command:

```sh
pnpm verify
```

Set `TEST_DATABASE_URL` to a migrated disposable database to run the real
PostgreSQL idempotency and restore court locally. CI always runs that court.

## License

Foldthink uses the [0BSD license](LICENSE). You may use, copy, change, and
distribute the software for any purpose, with or without attribution.
