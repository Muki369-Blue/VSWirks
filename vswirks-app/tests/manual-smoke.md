# Manual Smoke Checklist

## Startup

- Start `ai-runtime` from the app.
- Confirm service status changes from `offline` to `ready`.
- Confirm model list populates.

## Bridge Sync

- Open a folder in `VSWirks Editor`.
- Select code in an open file.
- Click `Sync Editor` in `VSWirks App`.
- Confirm the workspace, file, and selection pills update.
- Use `Attach Editor Selection` and confirm the selection appears in attachments.

## Repo Scaffolding

- Open an empty folder as the active project.
- Switch to `Agent` and `Act`.
- Prompt for a full repository scaffold.
- Approve writes once, then as `Approve Chat`, then as `Approve Run` in separate tests.
- Confirm files are created in the selected target folder.

## Editor Handoff

- Click `Open` on a tool write or run drawer item.
- Confirm VSCodium opens the file.

## Image Workflow

- Attach an image.
- Ask for a React/Tailwind scaffold from the image.
- Confirm the generated repo lands in the target folder rather than only in chat.
