# VSWirks App

Standalone local-first desktop companion with optional editor integration.

## Purpose

`VSWirks App` is the primary chat and agent surface for this workstation:

- project sessions and workspace targeting
- workflow presets and model-role routing
- prompt refining and spec building
- local Vibe flow: push-to-talk draft -> spec -> confirm into Act
- plan vs act control with pause-after-spec
- repo scaffolding into empty folders with dedicated repo-build flow
- image-to-repo workflows
- diff-first approvals with approve-once/chat/run scopes
- run timeline, checkpoints, replay, and resume
- project intelligence and validation gates
- optional editor handoff compatibility

The app talks to `ai-runtime` on `http://127.0.0.1:7471/v1`. Optional editor compatibility reads bridge state from:

- `/Users/bluewirks.max/Library/Application Support/VSWirks/state/bridge-state.json`

## Layout

- `electron/main.cjs`: Electron process and IPC registration
- `electron/controller.cjs`: app state, approvals, project/session management, and model-role routing
- `electron/editor-integration.cjs`: optional editor bridge state and editor-launch integration
- `electron/runner.cjs`: chat/agent execution against `ai-runtime`
- `electron/workspace-tools.cjs`: local workspace file tools, diffs, project intelligence, validation, and editor launch helpers
- `electron/image-tools.cjs`: local image metadata and OCR for scaffold prompts
- `/Users/bluewirks.max/Documents/VSWirks/shared`: canonical shared core/runtime/state modules owned at the workspace root
- `src/index.html`: desktop shell
- `src/app.css`: desktop-first UI styling
- `src/app.js`: renderer UI and interaction logic
- `tests/*.test.cjs`: state migration, diff, and intelligence smoke tests

Default role routing now splits models by task:

- planning, spec generation, and review use the MLX role
- edit, refactor, and scaffold `Act` runs use `devstral-small-2`

## Current Workflow

1. Start in Studio chat or pick/create a project, then optionally set a target folder.
2. Choose a workflow preset such as `Scaffold App`, `Review Repo`, or `UI From Image`.
3. Refine the prompt or build a structured spec.
4. Run in `Plan` to stop at the spec, or `Act` to continue into writes.
5. For Vibe mode, hold `Hold To Talk`, generate the spec, review it, then use `Confirm Spec -> Act`.
6. Review diff-first approvals, validation results, and run checkpoints.
7. Optionally reveal generated files in your editor when the compatibility integration is available.

Project work is fully usable without an editor bridge. Manual editor sync and reveal actions are best-effort compatibility features.

## Running Later

This source tree expects an Electron runtime. Once `electron` or a Node toolchain is available:

```bash
cd /Users/bluewirks.max/Documents/VSWirks/vswirks-app
npm install
npm start
```

Optional editor integrations can still publish bridge state and open this source folder when available.

To produce a macOS app bundle that reuses the original `VSWirks` icon and bundle id:

```bash
cd /Users/bluewirks.max/Documents/VSWirks/vswirks-app
npm run build:mac
```

The packaged app is written to:

```text
/Users/bluewirks.max/Documents/VSWirks/vswirks-app/dist/VSWirks-darwin-arm64/VSWirks.app
```

From the workspace root you can run:

```bash
cd /Users/bluewirks.max/Documents/VSWirks
npm run verify
```

Optional editor compatibility checks:

```bash
cd /Users/bluewirks.max/Documents/VSWirks
npm run verify:editor
```
