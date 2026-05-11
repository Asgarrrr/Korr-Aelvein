# Korr Aelvein

A turn-based roguelike with a server-authoritative architecture. Set on an island built around an inexplicable abyss whose presence shapes the world without anyone knowing why; descend, die, descend again.

## Stack

- **Runtime / package manager**: Bun
- **Monorepo**: Turborepo
- **Server** (`apps/server`): Bun + [Elysia](https://elysiajs.com), exposing a WebSocket `/game` endpoint as the single source of truth.
- **Client** (`apps/client`): Vite + React 19, connects to the server over WebSocket.
- **Shared configs**: `@korr-aelvein/typescript-config`.
- **Lint + format + import sort**: [Biome](https://biomejs.dev) (single root `biome.json`).

## Getting started

```sh
bun install
bun run dev
```

This runs Vite (`http://localhost:5173`) and the Elysia server (`http://localhost:3001`) in parallel.

## Useful commands

```sh
bun run build        # Build all apps and packages
bun run lint         # biome check (lint + format + imports)
bun run lint:fix     # biome check --write (apply safe fixes)
bun run format       # biome format --write
bun run check-types  # Typecheck all workspaces
```
