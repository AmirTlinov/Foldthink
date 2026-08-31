# Web Application Map

The web application is the browser composition root. It starts the PWA and wires
public browser entry points from domains. It owns no workspace meaning, scene
state, synchronization rule, or document format.

```text
apps/web/
|-- AGENTS.md          # Current browser composition-root map.
|-- package.json       # PWA commands and domain dependencies.
|-- tsconfig.json      # Browser and JSX compiler boundary.
|-- vite.config.ts     # Static application build and local proxy.
|-- index.html         # Immediate browser entry document.
|-- widget-frame.html  # Sandboxed widget execution document.
|-- public/
|   |-- manifest.webmanifest # Installable application identity.
|   |-- icon.svg             # Full-bleed scalable application icon.
|   `-- sw.js                # Versioned application-shell cache.
|-- src/
|   |-- main.tsx                  # React composition entry.
|   |-- foldthink-page.tsx        # Continuous full-screen surface shell.
|   |-- compose-web-runtime.ts    # Local-first canvas, document, sync, and WebMCP wiring.
|   |-- widget-frame.ts           # Isolated widget runtime composition entry.
|   `-- app-theme.css             # Surface material and minimal status readout.
`-- tests/
    `-- web-startup.test.ts       # Direct-to-surface shell proof.
```

Allowed imports are enforced by
[dependency-cruiser.cjs](../../dependency-cruiser.cjs). Browser source and its
startup proof are added here together when the first vertical slice activates
this app.
