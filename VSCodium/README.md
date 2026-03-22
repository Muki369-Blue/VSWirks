# VSWirks Editor Bridge

Local-first VSCodium extension that adds a Copilot-style threaded chat and agent sidebar, plus a native VSCodium chat participant, both backed by `ai-runtime`. It now also acts as the editor-side bridge for the standalone `VSWirks App`.

## What It Does

- Activity Bar chat surface inside VSCodium with persistent local threads
- Native chat participant in the built-in Chat UI as `@local`
- Shared bridge state for `VSWirks App`:
  - active workspace root
  - active file path
  - current selection text
  - configured workspace target
- Model picker backed by `http://127.0.0.1:7471/v1/models`
- `chat` mode for analysis, reviews, planning, and scaffolding
- `agent` mode with local workspace tools:
  - `list_workspace`
  - `read_file`
  - `search_workspace`
  - `write_file`
  - `open_file`
- Starter actions for review, explanation, scaffolding, refactor, and test generation
- Image attachment flow for mockups, screenshots, and photo-driven scaffolding
- `Plan` vs `Act` execution slider in the sidebar
- default editor-side model tuned for local edit/scaffold work: `devstral-small-2`
- Rich assistant rendering with code blocks and actions:
  - `Copy`
  - `Insert`
  - `Scratch`
- Tool activity cards so agent reads and writes are visible in the thread
- Existing files get timestamped backups before agent overwrites them
- Native chat slash commands:
  - `/ask`
  - `/review`
  - `/explain`
  - `/scaffold`
  - `/refactor`
  - `/test`

## Local Settings

- `bluewirksLocalAgent.baseUrl`
- `bluewirksLocalAgent.defaultModel`
- `bluewirksLocalAgent.workspaceTarget`
- `bluewirksLocalAgent.runtimeCwd`
- `bluewirksLocalAgent.runtimePython`
- `bluewirksLocalAgent.companionAppPath`
- `bluewirksLocalAgent.chatTemperature`
- `bluewirksLocalAgent.chatTopP`
- `bluewirksLocalAgent.chatMaxTokens`
- `bluewirksLocalAgent.agentTemperature`
- `bluewirksLocalAgent.agentTopP`
- `bluewirksLocalAgent.agentMaxTokens`
- `bluewirksLocalAgent.agentMaxSteps`
- `bluewirksLocalAgent.writeRequiresApproval`

## Local Layout

Source:

- `/Users/bluewirks.max/Documents/VSWirks/VSCodium`

Installed extension registration:

- `/Users/bluewirks.max/.vscode-oss/extensions/bluewirks.bluewirks-local-agent-0.0.1-universal`
- `/Users/bluewirks.max/.vscode-oss/extensions/extensions.json`

The installed extension path is a symlink to the source folder, so editing the source updates the live extension after a VSCodium reload.

## Usage

1. Reload VSCodium.
2. Use either:
   - the `VSWirks Editor` Activity Bar icon for the custom sidebar, or
   - the built-in Chat view with `@local`
3. In native chat, use slash commands like `/review` or `/scaffold`.
4. In the sidebar, pick a model and mode, then use quick actions, attachments, or direct prompts.
   - `Open App` tries to launch the standalone `VSWirks App`. If Electron or `npm` is not installed on `PATH` yet, it opens the app source folder instead.
   - `Attach Image` now analyzes the selected image locally and injects an image-derived brief into the request.
   - `Focus Chat` hides the thread, context, attachment, and settings rails so the response area can stay visible while the agent is working.
   - Right-click a folder in Explorer and use `VSWirks Editor: Set Agent Target Here` if you want repo scaffolds to land in that specific folder instead of the default workspace root.
5. Use the `Plan` / `Act` slider:
   - `Plan` inspects the workspace and returns a concrete implementation plan without modifying files.
   - `Act` lets `agent` mode scaffold or edit the workspace with tools.
6. Use `Start Service` if `ai-runtime` is not already running.
7. Tune the chat and agent defaults in the `Runtime Defaults` section and save them to workspace settings.

## Empty Folder Scaffolding

In an empty workspace folder, switch the sidebar to:

- `Mode: Agent`
- `Execution: Act`

Then use a direct request such as:

`create a local song/instrumental stem splitter best built for my system only`

The agent now treats an empty workspace as a production scaffold target and is instructed to create a full local-first repository rather than stopping at a demo or placeholder plan.

If the model replies with scaffold code in chat instead of proper tool calls, the extension now does a second materialization pass for empty-folder repo creation requests and writes the generated files into the workspace through the same local write path.

If the prompt clearly asks to create a repository and the open workspace is empty or metadata-only, the sidebar now auto-promotes that request into the workspace write path instead of leaving it in chat-only mode.

In multi-root workspaces, or when you want to build into a subfolder shown in Explorer, set the agent target explicitly. The workspace pill in the sidebar reflects the current target as `root -> subfolder`.

Long-running repo scaffolds now get a larger effective agent step budget than the base `agentMaxSteps` setting, and the write approval modal now offers `Approve Chat` so the rest of the thread can continue without one-file-at-a-time confirmations.

## Photo To Repo Scaffolding

In the custom sidebar, you can now attach a screenshot, mockup, or photo and scaffold from it locally:

1. Open an empty workspace folder.
2. Switch to `Mode: Agent`.
3. Move the execution slider to `Act`.
4. Click `Attach Image`.
5. Prompt the agent with a request such as:

`Create a complete React project structure from this image, including Tailwind CSS styling for the layout and components.`

The extension preprocesses the image locally with metadata and OCR, then passes that design brief to the coding model. In an empty folder, the same repo-materialization path is used so the result can be written into the workspace instead of staying as chat-only output.

## Workspace Prompt Files

This workspace now includes reusable native chat prompt files under `/Users/bluewirks.max/Documents/VSWirks/VSCodium/.github/prompts`:

- `local-review.prompt.md`
- `local-scaffold.prompt.md`
- `local-refactor.prompt.md`
- `local-tests.prompt.md`

Use them from the built-in Chat UI by selecting `@local` first, then running a prompt such as `/local-review` or `/local-scaffold`. The prompt file shapes the request, and `@local` remains the execution backend.

## Workspace Instructions

Repo-specific local-first instructions live in `/Users/bluewirks.max/Documents/VSWirks/VSCodium/.github/copilot-instructions.md`.

The extension also reads that file directly and prepends it to both:

- native `@local` chat requests
- the custom `VSWirks Editor` sidebar requests

That keeps the sidebar and the native chat surface aligned on the same local-first rules for this workspace.

## VSWirks App

The standalone app source now lives in [/Users/bluewirks.max/Documents/VSWirks/vswirks-app](/Users/bluewirks.max/Documents/VSWirks/vswirks-app). It is the primary desktop chat and agent surface and reuses the same `ai-runtime` backend on `127.0.0.1`.

The app now defaults to a split local model strategy:

- planner/spec/review flows use the MLX role
- editor/scaffold `Act` flows use the smaller local coder role

Canonical shared modules now live at:

- `/Users/bluewirks.max/Documents/VSWirks/shared`

The editor bridge now consumes that root-owned shared layer instead of owning the canonical runtime/state/core code itself.

The extension publishes bridge state into:

- `/Users/bluewirks.max/Library/Application Support/VSWirks/state/bridge-state.json`

`VSWirks App` reads that bridge state to stay aligned with:

- the open workspace root
- the current editor file
- the current selection
- the editor-side workspace target

## Notes

- The extension assumes `ai-runtime` is already running on `127.0.0.1:7471`.
- The sidebar can now start `ai-runtime` locally using:
  - `/Users/bluewirks.max/dev/ai-runtime`
  - `/Users/bluewirks.max/dev/ai-app/.venv/bin/python`
- Agent writes are restricted to the opened workspace folder.
- Existing files get `*.bak.YYYYMMDD-HHMMSS` backups before overwrite.

Workspace verification now runs from the repo root:

```bash
cd /Users/bluewirks.max/Documents/VSWirks
npm run verify
```
