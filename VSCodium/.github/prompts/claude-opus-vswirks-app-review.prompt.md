---
description: Enhanced Claude Opus 4.6 review prompt focused on VSWirks App as the primary product surface.
---

Review `VSWirks App` as the primary product surface inside this workspace:

- `/Users/bluewirks.max/Documents/VSWirks`

Primary review target:

- `/Users/bluewirks.max/Documents/VSWirks/vswirks-app`

Secondary context only:

- `/Users/bluewirks.max/Documents/VSWirks/shared`
- `/Users/bluewirks.max/Documents/VSWirks/VSCodium`

Your job is not to review the repo generically. Your job is to review whether `vswirks-app` is architected, implemented, and tested as the true owner of the system.

App-first architectural contract:

- `vswirks-app` must own the main user experience.
- `vswirks-app` must own workflow orchestration for plan, act, scaffold, review, resume, approvals, checkpoints, and validation.
- `shared` may own reusable runtime/state/core modules used by both surfaces.
- `VSCodium` should stay thin.
- `VSCodium` is only justified owning:
  - bridge state publication and synchronization
  - file reveal/open/diff handoff
  - native editor chat entrypoints
  - app launch and editor-side convenience actions
- If the editor owns logic that should belong to the app, treat that as an architectural finding.

Hard runtime context:

- local-only by default
- localhost-only runtime assumptions
- app runtime base URL: `http://127.0.0.1:7471/v1`
- bridge state file: `/Users/bluewirks.max/Library/Application Support/VSWirks/state/bridge-state.json`
- current model-role split:
  - planner/spec/reviewer: `mlx/Qwen3.5-27B-Claude-4.6-Opus-Distilled-MLX-6bit`
  - edit/refactor/scaffold Act: `devstral-small-2`

Current app engineering snapshot:

- backend/runtime entrypoints:
  - `vswirks-app/electron/main.cjs`
  - `vswirks-app/electron/controller.cjs`
  - `vswirks-app/electron/runner.cjs`
  - `vswirks-app/electron/workspace-tools.cjs`
  - `vswirks-app/electron/image-tools.cjs`
- frontend:
  - `vswirks-app/src/index.html`
  - `vswirks-app/src/app.js`
  - `vswirks-app/src/app.css`
- canonical shared modules:
  - `/Users/bluewirks.max/Documents/VSWirks/shared/core.js`
  - `/Users/bluewirks.max/Documents/VSWirks/shared/runtime-client.js`
  - `/Users/bluewirks.max/Documents/VSWirks/shared/vswirks-state.js`
- root verification command:
  - `npm run verify`

Current workflow expectations for the app:

- project sessions and target-folder ownership
- workflow presets such as scaffold, review, and UI-from-image
- prompt refining and structured spec building
- Vibe flow: hold-to-talk draft -> spec -> confirm into Act
- plan vs act control with pause-after-spec
- diff-first approvals with scoped approval behavior
- run timeline, checkpoints, replay, and resume
- project intelligence and validation gates
- handoff back to the editor when file reveal/open/diff is needed

Review questions you must answer:

1. Is `vswirks-app` truly the owner of orchestration, or is the editor still controlling too much?
2. Is responsibility split cleanly across `controller.cjs`, `runner.cjs`, `workspace-tools.cjs`, shared modules, and renderer code?
3. Are there weak contracts, duplicated logic, stale ownership boundaries, or hidden coupling between app and editor?
4. Are the scaffold/review/resume flows robust enough for full offline repo work?
5. Are approvals, diffs, validation, and replay shaped around the app first, with the editor only as a reveal/open target?
6. Is Vibe mode integrated coherently into spec generation and Act, or is it still partial/fragile?
7. Is model-role routing correct and defensible for local use?
8. Are tests concentrated on the right failure-prone paths, especially controller, runner, IPC contracts, workspace tooling, and renderer contracts?
9. Are there missing backend service boundaries, IPC boundaries, or frontend state boundaries that should be tightened?
10. Are there places where the app is still behaving like a companion instead of the primary product?

Specific areas to inspect:

- app bootstrap and IPC registration
- project/session lifecycle
- target path enforcement
- runtime startup, health checks, and degraded behavior
- prompt/spec pipeline
- scaffold phase contracts and recovery behavior
- review workflows and diff handoff
- checkpoint, replay, and resume state handling
- renderer state model and DOM event flow
- Vibe-mode capture, transcript handling, spec generation, and confirm-to-Act flow
- shared-module import direction and ownership
- editor extension drift beyond thin-bridge responsibilities
- test coverage gaps and manual-only paths

What to deprioritize:

- do not spend most of the review on the generated `stem-splitterV3.2` repo
- only mention generated target repos when they reveal a defect in `vswirks-app`
- do not treat editor UX polish as primary unless it blocks the app-first contract

Output requirements:

1. Findings first, ordered by severity.
2. Use concrete file references.
3. Prioritize bugs, architectural drift, ownership violations, workflow gaps, regressions, and missing tests.
4. Explicitly call out any logic that should move from `VSCodium` to `vswirks-app` or `shared`.
5. Explicitly call out what is already solid so effort stays focused.
6. After findings, provide a concise improvement plan grouped in this order:
   - app backend/runtime
   - app/frontend
   - shared ownership
   - editor thinning
   - tests/verification
   - docs/handoff

Review bar:

- Do not give a generic code-quality summary.
- Do not stop at surface-level style feedback.
- Review it like the app is supposed to become the long-term primary product and local orchestrator.
- If the app is still secondary in any meaningful way, say exactly where and why.
