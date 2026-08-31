# Server Application Map

The server application is the Node.js composition root. It wires HTTP,
WebSocket, PostgreSQL, object storage, and document compilation adapters to
public server entry points from domains. It owns no domain meaning of its own.

```text
apps/server/
|-- AGENTS.md    # Current server composition-root map.
```

Allowed imports are enforced by
[dependency-cruiser.cjs](../../dependency-cruiser.cjs). Server source and its
startup proof are added here together when the durable-sync slice activates
this app.
