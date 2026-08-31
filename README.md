# Foldthink

**Think with your agent.**

Foldthink is the public home for a notebook that people and agents can see,
draw on, and change together.

The first executable slice opens directly to a full-screen canvas, keeps Pencil
input outside React's render path, and commits each completed stroke atomically to
IndexedDB. It is intentionally a working local surface before it is a feature
catalog.

## Run locally

Foldthink requires Node.js 24 and pnpm 11.

```sh
pnpm install
pnpm dev
```

Open `http://localhost:5173`. Draw with a mouse or Apple Pencil, reload, and the
same locally durable surface returns. A production PWA build is created with:

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

## License

Foldthink uses the [0BSD license](LICENSE). You may use, copy, change, and
distribute the software for any purpose, with or without attribution.
