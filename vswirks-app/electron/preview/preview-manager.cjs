// Phase 2: Preview Manager — sandbox for previewing generated apps
// Manages dev server lifecycle, iframe sandbox URLs, and hot-reload signals.

const cp = require("child_process");
const fs = require("fs/promises");
const http = require("http");
const os = require("os");
const path = require("path");
const net = require("net");

const PREVIEW_TIMEOUT_MS = 30000;
const HEALTH_POLL_MS = 500;
const MAX_HEALTH_POLLS = 60; // 30 seconds

class PreviewManager {
  constructor({ emitEvent } = {}) {
    this.emitEvent = emitEvent || (() => {});
    this._servers = new Map(); // projectId -> { process, port, url, status }
  }

  // ── Public API ──────────────────────────────────────

  /** Start a preview server for a project workspace */
  async start({ projectId, workspaceRoot, targetPath, command, port } = {}) {
    if (!workspaceRoot) return { ok: false, error: "No workspace root" };
    const cwd = targetPath || workspaceRoot;

    // Kill existing server for this project
    if (this._servers.has(projectId)) {
      await this.stop({ projectId });
    }

    // Auto-detect preview command if not provided
    const resolved = command || await this._detectPreviewCommand(cwd);
    if (!resolved) {
      return { ok: false, error: "Could not detect a preview command. Add a 'dev' or 'start' script to package.json." };
    }

    // Find free port
    const assignedPort = port || await this._findFreePort();

    try {
      const env = { ...process.env, PORT: String(assignedPort), BROWSER: "none" };
      const child = cp.spawn("/bin/sh", ["-c", resolved], {
        cwd,
        env,
        stdio: ["ignore", "pipe", "pipe"],
        detached: true
      });

      const entry = {
        process: child,
        port: assignedPort,
        url: `http://127.0.0.1:${assignedPort}`,
        status: "starting",
        cwd,
        command: resolved,
        startedAt: Date.now(),
        logs: []
      };
      this._servers.set(projectId, entry);

      // Capture logs
      const captureLogs = (stream) => {
        stream.on("data", (chunk) => {
          const line = chunk.toString().trim();
          if (line) {
            entry.logs.push({ time: Date.now(), text: line });
            if (entry.logs.length > 200) entry.logs.shift();
          }
        });
      };
      captureLogs(child.stdout);
      captureLogs(child.stderr);

      child.on("exit", (code) => {
        entry.status = code === 0 ? "stopped" : "crashed";
        this.emitEvent({ type: "preview-stopped", projectId, code });
        this._servers.delete(projectId);
      });

      // Wait for server to be healthy
      const healthy = await this._waitForHealthy(assignedPort);
      if (healthy) {
        entry.status = "running";
        this.emitEvent({ type: "preview-ready", projectId, url: entry.url, port: assignedPort });
        return { ok: true, url: entry.url, port: assignedPort };
      } else {
        entry.status = "timeout";
        this.emitEvent({ type: "preview-timeout", projectId });
        return { ok: false, error: "Preview server did not respond within timeout", url: entry.url, port: assignedPort };
      }
    } catch (error) {
      return { ok: false, error: `Failed to start preview: ${error.message}` };
    }
  }

  /** Stop a running preview server */
  async stop({ projectId } = {}) {
    const entry = this._servers.get(projectId);
    if (!entry) return { ok: false, error: "No preview running for this project" };
    try {
      if (entry.process && !entry.process.killed) {
        process.kill(-entry.process.pid, "SIGTERM");
        // Grace period then force kill
        setTimeout(() => {
          try { process.kill(-entry.process.pid, "SIGKILL"); } catch {}
        }, 3000);
      }
    } catch {}
    this._servers.delete(projectId);
    return { ok: true };
  }

  /** Get status of preview for a project */
  getStatus({ projectId } = {}) {
    const entry = this._servers.get(projectId);
    if (!entry) return { running: false };
    return {
      running: entry.status === "running",
      status: entry.status,
      url: entry.url,
      port: entry.port,
      command: entry.command,
      uptime: Date.now() - entry.startedAt
    };
  }

  /** Get recent logs from preview server */
  getLogs({ projectId, limit = 50 } = {}) {
    const entry = this._servers.get(projectId);
    if (!entry) return [];
    return entry.logs.slice(-limit);
  }

  /** Restart preview (hot-reload trigger) */
  async restart({ projectId } = {}) {
    const entry = this._servers.get(projectId);
    if (!entry) return { ok: false, error: "No preview running" };
    const { cwd, command, port } = entry;
    await this.stop({ projectId });
    return this.start({ projectId, workspaceRoot: cwd, command, port });
  }

  /** Stop all running previews (cleanup) */
  async stopAll() {
    const promises = [];
    for (const projectId of this._servers.keys()) {
      promises.push(this.stop({ projectId }));
    }
    await Promise.allSettled(promises);
  }

  // ── Internals ───────────────────────────────────────

  async _detectPreviewCommand(cwd) {
    // Check for package.json scripts
    try {
      const raw = await fs.readFile(path.join(cwd, "package.json"), "utf-8");
      const pkg = JSON.parse(raw);
      const scripts = pkg.scripts || {};
      if (scripts.dev) return "npm run dev";
      if (scripts.start) return "npm start";
      if (scripts.serve) return "npm run serve";
      if (scripts.preview) return "npm run preview";
    } catch {}

    // Check for Python apps
    try {
      await fs.access(path.join(cwd, "manage.py"));
      return "python manage.py runserver 0.0.0.0:$PORT";
    } catch {}
    try {
      await fs.access(path.join(cwd, "app.py"));
      return "python app.py";
    } catch {}

    // Check for static HTML
    try {
      await fs.access(path.join(cwd, "index.html"));
      return `python -m http.server $PORT`;
    } catch {}

    return null;
  }

  async _findFreePort() {
    return new Promise((resolve, reject) => {
      const server = net.createServer();
      server.listen(0, "127.0.0.1", () => {
        const port = server.address().port;
        server.close(() => resolve(port));
      });
      server.on("error", reject);
    });
  }

  async _waitForHealthy(port) {
    for (let i = 0; i < MAX_HEALTH_POLLS; i++) {
      try {
        await new Promise((resolve, reject) => {
          const req = http.get(`http://127.0.0.1:${port}/`, { timeout: 2000 }, (res) => {
            res.resume();
            resolve(true);
          });
          req.on("error", () => reject());
          req.on("timeout", () => { req.destroy(); reject(); });
        });
        return true;
      } catch {
        await new Promise((r) => setTimeout(r, HEALTH_POLL_MS));
      }
    }
    return false;
  }
}

module.exports = { PreviewManager };
