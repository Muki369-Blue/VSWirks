# VSWirks Workspace

App-first local-first workspace for:

- `vswirks-app`: primary desktop chat/agent surface
- `VSCodium`: secondary editor bridge and native chat surface
- `shared`: canonical runtime/state/core modules used by both

## Verify

```bash
cd /Users/bluewirks.max/Documents/VSWirks
npm run verify
```

## Layout

- `/Users/bluewirks.max/Documents/VSWirks/shared`: canonical shared modules
- `/Users/bluewirks.max/Documents/VSWirks/vswirks-app`: primary app
- `/Users/bluewirks.max/Documents/VSWirks/VSCodium`: editor bridge

The prior embedded `VSCodium/.git` repository was moved to a timestamped backup at the workspace root so this folder can act as the authoritative repo root going forward.
