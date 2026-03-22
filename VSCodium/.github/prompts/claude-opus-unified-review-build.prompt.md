---
description: Claude Opus 4.6 unified handoff to review the full VSWirks repo, then continue through full completion with the current engineering snapshot.
---

Take over the entire `VSWirks` workspace at:

- `/Users/bluewirks.max/Documents/VSWirks`

Run this as one continuous pass:

1. Review the full workspace with a strict engineering and code-review mindset.
2. Turn the findings into a concrete execution plan.
3. Keep working through implementation until the repo is materially closer to full local offline completion.

Primary mission:

- Keep `vswirks-app` as the main product surface.
- Keep `VSCodium` secondary as a thinner bridge/editor surface.
- Keep `shared` authoritative for cross-surface core/runtime/state logic.
- Improve full offline scaffold, review, resume, and completion behavior without breaking the app-first architecture.

Hard workspace invariants:

- `vswirks-app` is the primary surface.
- `VSCodium` is secondary and should stay a thinner bridge.
- `shared` is canonical.
- Local-first only unless explicitly expanded.
- Use localhost-only runtime assumptions.
- The app expects `ai-runtime` at `http://127.0.0.1:7471/v1`.

Current engineering snapshot to review and build against:

- Workspace surfaces:
  - primary app: `/Users/bluewirks.max/Documents/VSWirks/vswirks-app`
  - secondary editor bridge: `/Users/bluewirks.max/Documents/VSWirks/VSCodium`
  - canonical shared layer: `/Users/bluewirks.max/Documents/VSWirks/shared`
- Runtime, API, and host URLs:
  - local OpenAI-compatible runtime: `http://127.0.0.1:7471/v1`
  - bridge state file: `/Users/bluewirks.max/Library/Application Support/VSWirks/state/bridge-state.json`
  - surviving generated app currently binds `uvicorn` on `127.0.0.1:8000`
- VSWirks backend/runtime ownership:
  - `vswirks-app/electron/main.cjs`: Electron process and IPC registration
  - `vswirks-app/electron/controller.cjs`: runtime start/health, role routing, approvals, sessions, project targeting, editor handoff
  - `vswirks-app/electron/runner.cjs`: scaffold/review execution, staged recovery, phase contracts, resume, validation
  - `vswirks-app/electron/workspace-tools.cjs`: local file reads/writes, diffs, repo intelligence, validation, editor actions
  - `vswirks-app/electron/image-tools.cjs`: local image metadata and OCR
- VSWirks frontend:
  - `vswirks-app/src/index.html`
  - `vswirks-app/src/app.js`
  - `vswirks-app/src/app.css`
  - includes a local Vibe path: hold-to-talk -> spec generation -> confirm into Act
- Current model-role routing:
  - planner/spec/reviewer: `mlx/Qwen3.5-27B-Claude-4.6-Opus-Distilled-MLX-6bit`
  - edit/refactor/scaffold Act: `devstral-small-2`
- Workspace-level verification baseline:
  - `npm run verify` from `/Users/bluewirks.max/Documents/VSWirks`

Current `stem-splitterV3.2` build state to include in the review and completion work:

- Freshest run evidence is log-only:
  - summary: `/Users/bluewirks.max/ai/eval/vswirks-stem-splitterV3.2-devstral-20260321-031644/summary.json`
  - log: `/Users/bluewirks.max/ai/eval/vswirks-stem-splitterV3.2-devstral-20260321-031644/run.log`
  - it advanced through backend/core and into service/orchestration before failing on `{"detail":"ollama upstream unavailable: "}`
  - files evidenced there: `README.md`, `pyproject.toml`, `src/stem_splitter/core/separator.py`, `src/stem_splitter/backends/demucs.py`, `src/stem_splitter/server/main.py`, `src/stem_splitter/server/app.py`, `src/stem_splitter/service/app.py`, `src/stem_splitter/service/models.py`, `tests/backends/test_demucs.py`, `tests/server/test_app.py`, `tests/service/test_app.py`, `tests/conftest.py`
- Latest surviving repo on disk:
  - repo: `/Users/bluewirks.max/Documents/stem-splitterV3.2-devstral-20260321-024628`
  - summary: `/Users/bluewirks.max/ai/eval/vswirks-stem-splitterV3.2-devstral-20260321-024628/summary.json`
  - status: `paused_recoverable`
- Surviving repo backend/API details:
  - FastAPI app in `src/stem_splitter/main.py`
  - host URL: `http://127.0.0.1:8000`
  - routes present: `GET /`, `POST /jobs/`, `GET /jobs/{job_id}`, `GET /jobs/`
  - services/modules present: `src/stem_splitter/services/job_queue.py`, `src/stem_splitter/services/separator.py`, `src/stem_splitter/core/separator.py`, `src/stem_splitter/engines/demucs.py`, `src/stem_splitter/models.py`, `src/stem_splitter/config.py`
  - job queue is in-memory
  - uploads are handled synchronously in-process
  - Demucs path is local CPU-based
- Surviving repo frontend/web details:
  - `src/stem_splitter/web/__init__.py` defines `GET /ui` and `GET /ui/jobs`
  - Jinja templates are under `src/stem_splitter/web/templates`
  - current UI is a minimal upload form and recent-jobs view
- Middleware and infrastructure gaps:
  - no explicit middleware stack
  - no router modularization
  - no persistence or durable job store
  - no background worker
  - no static mount or generated static assets, despite template references to `/static/style.css` and `/static/script.js`
- Concrete defects already known:
  - `tests/test_separator.py` is invalid Python because of a literal `\\n`
  - duplicated/inconsistent separator layering exists between `services/separator.py` and `core/separator.py`
  - the freshest `031644` repo directory is gone, so rely on its eval artifacts for intent and the `024628` repo for live edits
- Expected generated-repo validation plan from the latest intelligence:
  - `uv run --extra dev pytest`
  - `uv run ruff check .`
  - `uv run python -m compileall .`

Review scope:

- Root workspace structure and app-first monorepo layout
- Shared-module ownership and imports
- App execution flow in `vswirks-app/electron/*`
- Renderer/UI flow in `vswirks-app/src/*`
- Editor bridge flow in `VSCodium/extension.js` and `VSCodium/media/*`
- Prompt files, test coverage, verification path, and scaffold/review workflows
- End-to-end offline repo-scaffold behavior with local models
- The current `stem-splitterV3.2` scaffolded backend, API shape, services, frontend, and missing infrastructure

Priority completion targets:

- Full offline scaffold flow should keep progressing instead of stalling on weak phase contracts.
- Runtime failures should degrade or recover cleanly when Ollama or the local model returns transient upstream errors.
- Generated repos should be materially closer to runnable, not just structurally present.
- Review, diff, approval, and resume flows should stay app-first and coherent.
- Validation should fail closed with useful signals.

Execution order:

1. Findings first, ordered by severity.
2. Focus on bugs, regressions, missing tests, weak contracts, workflow gaps, and anything blocking full offline completion.
3. Restate the top findings you are acting on.
4. Convert them into a concrete execution plan.
5. Implement backend/runtime fixes first.
6. Then fix app/editor integration issues.
7. Then fix UI/UX or workflow clarity gaps.
8. Then add or repair tests.
9. Then update README or handoff docs.

Operating rules:

- Inspect before editing.
- Create timestamped backups before editing existing files.
- Remove pasted patch text if found.
- Prefer precise, reversible changes over broad rewrites.
- Run real verification, not just static reasoning.
- Do not stop at a generic overview.
- Do not stop after review or after partial fixes.
- If you touch scaffold/runtime logic, run at least one live or replayable scaffold validation pass.

Definition of done:

- `npm run verify` passes at the workspace root.
- The repo remains app-first.
- The most important local scaffold blockers are fixed or sharply reduced.
- Remaining blockers, if any, are explicit, narrow, and reproducible.

Final response requirements:

1. Findings found and fixed
2. Remaining findings not fixed yet
3. Files changed
4. Commands run
5. Verification commands and outcomes
6. Remaining blockers to a fully complete local build
7. Rollback steps
