# BlueWirks VSCodium Workspace Instructions

- Work local-first. Do not introduce cloud services, hosted APIs, or outbound network dependencies unless explicitly requested.
- Treat `/Users/bluewirks.max/Documents/VSWirks/VSCodium` as the extension source. Do not patch `/Applications/VSCodium.app` directly.
- Keep the local backend pointed at `http://127.0.0.1:7471/v1` unless a change is explicitly requested.
- Preserve both chat surfaces:
  - the `BlueWirks AI` sidebar
  - the native `@local` chat participant
- Before changing an existing file, create a timestamped `*.bak.YYYYMMDD-HHMMSS` backup.
- Prefer safe, reversible edits and include rollback guidance when summarizing changes.
- Keep implementation work ordered as backend behavior, then UI, then verification, then README/docs.
- Preserve workspace write protections and explicit approval for agent-driven file writes.
- Keep extension code in CommonJS style and keep webview assets under `media/`.
- If a file contains pasted patch text such as `diff --git`, `---`, or `+++`, back it up, remove the pasted diff text, and report it.
