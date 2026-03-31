// Phase 4: Deploy Manager — build, package, and publish generated apps
// Manages build pipelines, release records, and deployment targets.

const cp = require("child_process");
const fs = require("fs/promises");
const os = require("os");
const path = require("path");

const DEPLOY_STATE_DIR = path.join(os.homedir(), "Library", "Application Support", "VSWirks", "deploys");

class DeployManager {
  constructor({ emitEvent } = {}) {
    this.emitEvent = emitEvent || (() => {});
  }

  // ── Build ───────────────────────────────────────────

  /** Run the project's build command */
  async build({ projectId, workspaceRoot, command } = {}) {
    if (!workspaceRoot) return { ok: false, error: "No workspace root" };
    const buildCmd = command || await this._detectBuildCommand(workspaceRoot);
    if (!buildCmd) return { ok: false, error: "No build command detected. Add a 'build' script to package.json." };

    this.emitEvent({ type: "deploy-build-start", projectId });
    const startedAt = Date.now();

    try {
      const output = cp.execSync(buildCmd, {
        cwd: workspaceRoot,
        encoding: "utf-8",
        timeout: 300000,
        maxBuffer: 1024 * 1024
      });
      const record = await this._createRelease({
        projectId,
        workspaceRoot,
        buildCommand: buildCmd,
        status: "built",
        output: output.slice(0, 10000),
        startedAt,
        finishedAt: Date.now()
      });
      this.emitEvent({ type: "deploy-build-complete", projectId, releaseId: record.id });
      return { ok: true, releaseId: record.id, output: output.slice(0, 5000) };
    } catch (error) {
      const record = await this._createRelease({
        projectId,
        workspaceRoot,
        buildCommand: buildCmd,
        status: "failed",
        output: ((error.stdout || "") + (error.stderr || "")).slice(0, 10000),
        error: error.message,
        startedAt,
        finishedAt: Date.now()
      });
      this.emitEvent({ type: "deploy-build-failed", projectId, releaseId: record.id });
      return { ok: false, releaseId: record.id, error: error.message };
    }
  }

  // ── Package ─────────────────────────────────────────

  /** Create a distributable archive of the built project */
  async package({ projectId, workspaceRoot, format = "tar.gz" } = {}) {
    if (!workspaceRoot) return { ok: false, error: "No workspace root" };
    const outputDir = path.join(DEPLOY_STATE_DIR, "packages");
    await fs.mkdir(outputDir, { recursive: true });

    const basename = path.basename(workspaceRoot);
    const timestamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
    const archiveName = `${basename}-${timestamp}.${format}`;
    const archivePath = path.join(outputDir, archiveName);

    try {
      if (format === "tar.gz") {
        cp.execSync(
          `tar -czf ${JSON.stringify(archivePath)} --exclude=node_modules --exclude=.git --exclude=.venv --exclude=__pycache__ .`,
          { cwd: workspaceRoot, timeout: 60000 }
        );
      } else if (format === "zip") {
        cp.execSync(
          `zip -r ${JSON.stringify(archivePath)} . -x 'node_modules/*' '.git/*' '.venv/*' '__pycache__/*'`,
          { cwd: workspaceRoot, timeout: 60000 }
        );
      } else {
        return { ok: false, error: `Unsupported format: ${format}` };
      }
      const stat = await fs.stat(archivePath);
      return { ok: true, path: archivePath, size: stat.size, format };
    } catch (error) {
      return { ok: false, error: `Packaging failed: ${error.message}` };
    }
  }

  // ── Release Records ─────────────────────────────────

  /** List releases for a project */
  async listReleases({ projectId, limit = 20 } = {}) {
    const releases = await this._loadReleases(projectId);
    return releases.slice(0, limit);
  }

  /** Get a specific release record */
  async getRelease({ projectId, releaseId } = {}) {
    const releases = await this._loadReleases(projectId);
    return releases.find((r) => r.id === releaseId) || null;
  }

  // ── Deploy Targets ──────────────────────────────────

  /** Deploy to a local directory (copy build output) */
  async deployLocal({ projectId, workspaceRoot, targetDir } = {}) {
    if (!workspaceRoot || !targetDir) return { ok: false, error: "Missing workspace or target" };
    try {
      await fs.mkdir(targetDir, { recursive: true });
      // Detect build output directory
      const buildDir = await this._detectBuildOutput(workspaceRoot);
      const source = buildDir || workspaceRoot;
      cp.execSync(
        `rsync -a --exclude=node_modules --exclude=.git --exclude=.venv ${JSON.stringify(source + "/")} ${JSON.stringify(targetDir + "/")}`,
        { timeout: 60000 }
      );
      return { ok: true, target: targetDir };
    } catch (error) {
      return { ok: false, error: `Deploy failed: ${error.message}` };
    }
  }

  // ── Internals ───────────────────────────────────────

  async _detectBuildCommand(cwd) {
    try {
      const raw = await fs.readFile(path.join(cwd, "package.json"), "utf-8");
      const pkg = JSON.parse(raw);
      const scripts = pkg.scripts || {};
      if (scripts.build) return "npm run build";
    } catch {}
    try {
      await fs.access(path.join(cwd, "Makefile"));
      return "make";
    } catch {}
    try {
      await fs.access(path.join(cwd, "setup.py"));
      return "python setup.py build";
    } catch {}
    return null;
  }

  async _detectBuildOutput(cwd) {
    for (const dir of ["dist", "build", "out", ".next", "public"]) {
      try {
        const stat = await fs.stat(path.join(cwd, dir));
        if (stat.isDirectory()) return path.join(cwd, dir);
      } catch {}
    }
    return null;
  }

  async _createRelease({ projectId, workspaceRoot, buildCommand, status, output, error, startedAt, finishedAt } = {}) {
    const record = {
      id: `release-${Date.now()}-${Math.random().toString(16).slice(2, 6)}`,
      projectId,
      workspaceRoot,
      buildCommand,
      status,
      output: output || "",
      error: error || "",
      startedAt,
      finishedAt,
      createdAt: Date.now()
    };
    const releases = await this._loadReleases(projectId);
    releases.unshift(record);
    if (releases.length > 50) releases.length = 50;
    await this._saveReleases(projectId, releases);
    return record;
  }

  _releasesPath(projectId) {
    const safe = String(projectId).replace(/[^a-zA-Z0-9_-]/g, "_");
    return path.join(DEPLOY_STATE_DIR, `${safe}-releases.json`);
  }

  async _loadReleases(projectId) {
    try {
      const raw = await fs.readFile(this._releasesPath(projectId), "utf-8");
      return JSON.parse(raw);
    } catch {
      return [];
    }
  }

  async _saveReleases(projectId, releases) {
    await fs.mkdir(DEPLOY_STATE_DIR, { recursive: true });
    const tmpPath = this._releasesPath(projectId) + `.tmp.${Date.now()}`;
    await fs.writeFile(tmpPath, JSON.stringify(releases, null, 2), "utf-8");
    await fs.rename(tmpPath, this._releasesPath(projectId));
  }
}

module.exports = { DeployManager };
