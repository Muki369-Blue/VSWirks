---
description: Claude Opus 4.6 handoff for a full-repo overall review of the VSWirks workspace.
---

You are taking over the full `VSWirks` workspace at:

- `/Users/bluewirks.max/Documents/VSWirks`

Review the entire repository with an app-first, local-first mindset before any build-completion work.

Repository invariants:

- `vswirks-app` is the primary product surface.
- `VSCodium` is secondary and should stay a thinner bridge/editor surface.
- `shared` is the canonical shared layer used by both.
- Local-first by default. Cloud is off unless explicitly authorized.
- Keep runtime traffic on localhost. The app expects `ai-runtime` at `http://127.0.0.1:7471/v1`.
- Prefer safe, reversible edits and concrete technical reasoning.

Current engineering snapshot to verify:

- Workspace surfaces:
  - primary app: `/Users/bluewirks.max/Documents/VSWirks/vswirks-app`
  - secondary editor bridge: `/Users/bluewirks.max/Documents/VSWirks/VSCodium`
  - canonical shared layer: `/Users/bluewirks.max/Documents/VSWirks/shared`
- Runtime and host URLs:
  - local OpenAI-compatible runtime: `http://127.0.0.1:7471/v1`
  - bridge state file: `/Users/bluewirks.max/Library/Application Support/VSWirks/state/bridge-state.json`
- App backend/runtime ownership:
  - `vswirks-app/electron/main.cjs`: Electron process and IPC registration
  - `vswirks-app/electron/controller.cjs`: project/session state, approvals, model-role routing, editor handoff, and local service startup
  - `vswirks-app/electron/runner.cjs`: scaffold/review execution, staged recovery, resume, and validation gates
  - `vswirks-app/electron/workspace-tools.cjs`: local file tools, search/list filters, diffs, repo intelligence, and editor actions
  - `vswirks-app/electron/image-tools.cjs`: local image metadata and OCR for scaffold prompts
- App frontend:
  - `vswirks-app/src/index.html`
  - `vswirks-app/src/app.js`
  - `vswirks-app/src/app.css`
  - includes a local Vibe flow: hold-to-talk draft -> `Generate Vibe Spec` -> `Confirm Spec -> Act`
- Current role routing:
  - planner/spec/reviewer: `mlx/Qwen3.5-27B-Claude-4.6-Opus-Distilled-MLX-6bit`
  - edit/refactor/scaffold Act: `devstral-small-2`
- Root verification path: `npm run verify`

Current `stem-splitterV3.2` build snapshot to review in detail:

- Newest eval evidence is log-only, not a live repo tree:
  - summary: `/Users/bluewirks.max/ai/eval/vswirks-stem-splitterV3.2-devstral-20260321-031644/summary.json`
  - log: `/Users/bluewirks.max/ai/eval/vswirks-stem-splitterV3.2-devstral-20260321-031644/run.log`
  - it advanced past backend/core into service/orchestration before failing with `{"detail":"ollama upstream unavailable: "}`
  - files evidenced there: `README.md`, `pyproject.toml`, `src/stem_splitter/core/separator.py`, `src/stem_splitter/backends/demucs.py`, `src/stem_splitter/server/main.py`, `src/stem_splitter/server/app.py`, `src/stem_splitter/service/app.py`, `src/stem_splitter/service/models.py`, `tests/backends/test_demucs.py`, `tests/server/test_app.py`, `tests/service/test_app.py`, `tests/conftest.py`
- Latest surviving scaffold artifact on disk:
  - repo: `/Users/bluewirks.max/Documents/stem-splitterV3.2-devstral-20260321-024628`
  - summary: `/Users/bluewirks.max/ai/eval/vswirks-stem-splitterV3.2-devstral-20260321-024628/summary.json`
  - status: `paused_recoverable`
- Backend/API shape in the surviving repo:
  - FastAPI entrypoint in `src/stem_splitter/main.py`
  - `uvicorn` host: `127.0.0.1`
  - `uvicorn` port: `8000`
  - API routes currently present: `GET /`, `POST /jobs/`, `GET /jobs/{job_id}`, `GET /jobs/`
  - services/modules currently present: `src/stem_splitter/services/job_queue.py`, `src/stem_splitter/services/separator.py`, `src/stem_splitter/core/separator.py`, `src/stem_splitter/engines/demucs.py`, `src/stem_splitter/models.py`, `src/stem_splitter/config.py`
  - queue is in-memory, upload handling is synchronous, and Demucs separation is CPU-bound/local-first
- Frontend/web shape in the surviving repo:
  - `src/stem_splitter/web/__init__.py` adds `GET /ui` and `GET /ui/jobs`
  - Jinja templates live under `src/stem_splitter/web/templates`
  - current UI is a lightweight upload form plus a recent-jobs panel
- Middleware/static gaps in the surviving repo:
  - no explicit middleware stack is present yet
  - no router modularization
  - no background worker or persistence layer
  - template references `/static/style.css` and `/static/script.js`, but no static mount or static assets were generated
- Known concrete defects in the surviving repo:
  - `tests/test_separator.py` has a syntax error caused by a literal `\\n`
  - duplicate/inconsistent separation logic exists across `services/separator.py` and `core/separator.py`
  - the newest `031644` repo directory is missing on disk, so its log/summary must be treated as evidence, not as a live tree
- Expected validation plan for the generated repo, based on the latest eval intelligence:
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

Known recent state to verify, not blindly trust:

- The monorepo root is authoritative.
- Shared logic is owned at the workspace root.
- Scaffold phase 2 was recently hardened and should now complete instead of pausing.
- Later scaffold phases may still fail because of transient Ollama upstream failures.

Output requirements:

1. Findings first, ordered by severity.
2. Focus on bugs, regressions, missing tests, weak contracts, workflow gaps, and anything blocking full offline completion.
3. Use concrete file references.
4. Call out what is already solid so effort stays focused.
5. End with a build-completion plan grouped in this order:
   - backend/runtime
   - app/editor integration
   - UI/UX
   - tests/verification
   - docs/handoff

Do not stop at a generic overview. Produce a review that can directly drive a full completion pass.
