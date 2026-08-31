# Web Application Map

The web application is the browser composition root. It starts the PWA and wires
public browser entry points from domains. It owns no workspace meaning, scene
state, synchronization rule, or document format.

```text
apps/web/
|-- AGENTS.md    # Current browser composition-root map.
```

Allowed imports are enforced by
[dependency-cruiser.cjs](../../dependency-cruiser.cjs). Browser source and its
startup proof are added here together when the first vertical slice activates
this app.
