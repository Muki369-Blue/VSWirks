---
description: Claude Opus 4.6 handoff to finish the VSWirks workspace end to end after review.
---

You are taking over the `VSWirks` workspace after an overall review.

Workspace root:

- `/Users/bluewirks.max/Documents/VSWirks`

Primary goals:

- Keep `vswirks-app` as the main product surface.
- Keep `VSCodium` secondary as a bridge/editor surface.
- Keep `shared` authoritative for cross-surface core/runtime/state logic.
- Finish the repo end to end so the local offline build/scaffold/review workflow is coherent and production-oriented.

Mandatory operating rules:

- Local-first only unless explicitly told otherwise.
- Use localhost-only runtime assumptions.
- Make reversible changes.
- Before changing an existing file, create a timestamped backup.
- If you change files, show diffs and verification commands.
- Remove any pasted patch text if found in files.

Current engineering snapshot to build against:

- Workspace surfaces:
  - primary app: `/Users/bluewirks.max/Documents/VSWirks/vswirks-app`
  - secondary editor bridge: `/Users/bluewirks.max/Documents/VSWirks/VSCodium`
  - canonical shared layer: `/Users/bluewirks.max/Documents/VSWirks/shared`
- Runtime and host URLs:
  - local runtime: `http://127.0.0.1:7471/v1`
  - bridge state: `/Users/bluewirks.max/Library/Application Support/VSWirks/state/bridge-state.json`
- App runtime ownership:
  - `vswirks-app/electron/controller.cjs`: routing, approvals, sessions, project targeting, runtime startup
  - `vswirks-app/electron/runner.cjs`: scaffold execution, phase contracts, staged recovery, and validation
  - `vswirks-app/electron/workspace-tools.cjs`: bounded file edits, diffs, repo intelligence, and editor actions
  - `vswirks-app/src/index.html`, `vswirks-app/src/app.js`, `vswirks-app/src/app.css`: desktop UI, including Vibe mode
- Current role routing:
  - planner/spec/reviewer: `mlx/Qwen3.5-27B-Claude-4.6-Opus-Distilled-MLX-6bit`
  - edit/refactor/scaffold Act: `devstral-small-2`
- Verification baseline: `npm run verify` from `/Users/bluewirks.max/Documents/VSWirks`

Current generated build state for `stem-splitterV3.2`:

- Treat the newest eval run as the freshest structural evidence:
  - `/Users/bluewirks.max/ai/eval/vswirks-stem-splitterV3.2-devstral-20260321-031644/summary.json`
  - `/Users/bluewirks.max/ai/eval/vswirks-stem-splitterV3.2-devstral-20260321-031644/run.log`
  - it reached service/orchestration work and then failed on transient Ollama upstream availability
  - files evidenced there: `src/stem_splitter/core/separator.py`, `src/stem_splitter/backends/demucs.py`, `src/stem_splitter/server/main.py`, `src/stem_splitter/server/app.py`, `src/stem_splitter/service/app.py`, `src/stem_splitter/service/models.py`, `tests/backends/test_demucs.py`, `tests/server/test_app.py`, `tests/service/test_app.py`
- Treat the latest surviving repo on disk as the concrete repair base:
  - repo: `/Users/bluewirks.max/Documents/stem-splitterV3.2-devstral-20260321-024628`
  - status: `paused_recoverable`
  - FastAPI backend in `src/stem_splitter/main.py`
  - service host URL: `http://127.0.0.1:8000`
  - current API routes: `GET /`, `POST /jobs/`, `GET /jobs/{job_id}`, `GET /jobs/`
  - current services/modules: `services/job_queue.py`, `services/separator.py`, `core/separator.py`, `engines/demucs.py`, `models.py`, `config.py`
  - current web/frontend: `web/__init__.py` with `GET /ui` and `GET /ui/jobs`, Jinja templates in `web/templates/index.html`
  - current architecture gaps: no explicit middleware stack, no background queue worker, no persistence, no static asset mount even though the template references `/static/style.css` and `/static/script.js`
  - concrete known defect: `tests/test_separator.py` is syntactically broken by a literal `\\n`
- Expected generated-repo validation plan:
  - `uv run --extra dev pytest`
  - `uv run ruff check .`
  - `uv run python -m compileall .`

Execution order:

1. Restate the top review findings you are acting on.
2. Convert them into a concrete execution plan.
3. Implement backend/runtime fixes first.
4. Then fix app/editor integration issues.
5. Then fix UI/UX or workflow clarity gaps.
6. Then add or repair tests.
7. Then update README or handoff docs.

Priority completion targets:

- Full offline scaffold flow should keep progressing instead of stalling on weak phase contracts.
- Runtime failures should degrade or recover cleanly when Ollama or the local model returns transient upstream errors.
- Generated repos should be materially closer to runnable, not just structurally present.
- Review, diff, approval, and resume flows should stay app-first and coherent.
- Validation should fail closed with useful signals.

Definition of done:

- `npm run verify` passes at the workspace root.
- The repo remains app-first.
- The most important local scaffold blockers are fixed or sharply reduced.
- Remaining blockers, if any, are explicit, narrow, and reproducible.

Final response requirements:

- Findings addressed
- Files changed
- Commands run
- Verification results
- Remaining blockers
- Rollback steps
