# VSWirks Workspace

App-first local-first workspace for:

- `vswirks-app`: primary desktop chat/agent surface
- `VSCodium`: optional editor compatibility integration
- `shared`: canonical runtime/state/core modules used by both

## Verify

```bash
cd /Users/bluewirks.max/Documents/VSWirks
npm run verify
```

Optional editor compatibility checks:

```bash
cd /Users/bluewirks.max/Documents/VSWirks
npm run verify:editor
```

## Layout

- `/Users/bluewirks.max/Documents/VSWirks/shared`: canonical shared modules
- `/Users/bluewirks.max/Documents/VSWirks/vswirks-app`: primary app
- `/Users/bluewirks.max/Documents/VSWirks/VSCodium`: optional editor bridge

The prior embedded `VSCodium/.git` repository was moved to a timestamped backup at the workspace root so this folder can act as the authoritative repo root going forward.
