# Cross-Domain Test Map

A domain behavior test lives beside its owner under `domains/<domain>/tests/`.
This root test area is reserved for journeys that cross real ownership
boundaries, such as browser-to-server synchronization and clean restore.

```text
tests/
|-- AGENTS.md    # Current cross-domain proof map.
```

A test name describes the observed scenario rather than an implementation layer.
The first cross-domain journey creates its test directory and harness in the same
change; placeholder suites do not live here.
