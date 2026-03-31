// @domain: git — Git operations mixin for VSWirksController
// Applied to the controller prototype in controller.cjs

const cp = require("child_process");
const { promisify } = require("util");
const execFile = promisify(cp.execFile);

module.exports = {
  _gitProjectCwd(projectId) {
    const project = projectId
      ? this.projects.find((p) => p.id === projectId)
      : this.getActiveProject();
    if (!project || !project.workspaceRoot) return null;
    return project.workspaceRoot;
  },

  async getGitStatus({ projectId } = {}) {
    const project = projectId
      ? this.projects.find((p) => p.id === projectId)
      : this.getActiveProject();
    if (!project || !project.workspaceRoot) {
      return { ok: false, error: "No project workspace" };
    }
    try {
      const opts = { cwd: project.workspaceRoot, encoding: "utf-8", timeout: 5000 };
      const [branchResult, statusResult, logResult] = await Promise.all([
        execFile("git", ["rev-parse", "--abbrev-ref", "HEAD"], opts),
        execFile("git", ["status", "--porcelain"], opts),
        execFile("git", ["log", "--oneline", "-10"], opts)
      ]);
      const branch = branchResult.stdout.trim();
      const status = statusResult.stdout.trim();
      const logRaw = logResult.stdout.trim();
      return {
        ok: true,
        branch,
        changes: status ? status.split("\n").length : 0,
        statusLines: status ? status.split("\n") : [],
        recentCommits: logRaw ? logRaw.split("\n") : []
      };
    } catch (error) {
      return { ok: false, error: error.message };
    }
  },

  async gitStage({ files } = {}) {
    const cwd = this._gitProjectCwd();
    if (!cwd) return { ok: false, error: "No project workspace" };
    if (!Array.isArray(files) || !files.length) return { ok: false, error: "No files specified" };
    try {
      await execFile("git", ["add", "--"].concat(files), { cwd, encoding: "utf-8", timeout: 10000 });
      return { ok: true };
    } catch (error) {
      return { ok: false, error: error.message };
    }
  },

  async gitUnstage({ files } = {}) {
    const cwd = this._gitProjectCwd();
    if (!cwd) return { ok: false, error: "No project workspace" };
    if (!Array.isArray(files) || !files.length) return { ok: false, error: "No files specified" };
    try {
      await execFile("git", ["restore", "--staged", "--"].concat(files), { cwd, encoding: "utf-8", timeout: 10000 });
      return { ok: true };
    } catch (error) {
      return { ok: false, error: error.message };
    }
  },

  async gitCommit({ message } = {}) {
    const cwd = this._gitProjectCwd();
    if (!cwd) return { ok: false, error: "No project workspace" };
    if (!message || !message.trim()) return { ok: false, error: "No commit message" };
    try {
      const { stdout } = await execFile("git", ["commit", "-m", message.trim()], { cwd, encoding: "utf-8", timeout: 30000 });
      return { ok: true, output: stdout.slice(0, 5000) };
    } catch (error) {
      return { ok: false, error: (error.stderr || error.message).slice(0, 2000) };
    }
  },

  async gitDiff({ file } = {}) {
    const cwd = this._gitProjectCwd();
    if (!cwd) return { ok: false, error: "No project workspace" };
    try {
      const baseArgs = ["diff"];
      const fileArgs = file ? ["--", file] : [];
      const opts = { cwd, encoding: "utf-8", timeout: 10000 };
      const [stagedResult, unstagedResult] = await Promise.all([
        execFile("git", ["diff", "--cached", ...fileArgs], opts),
        execFile("git", [...baseArgs, ...fileArgs], opts)
      ]);
      return {
        ok: true,
        staged: stagedResult.stdout.slice(0, 20000),
        unstaged: unstagedResult.stdout.slice(0, 20000)
      };
    } catch (error) {
      return { ok: false, error: error.message };
    }
  },

  async gitBranches() {
    const cwd = this._gitProjectCwd();
    if (!cwd) return { ok: false, error: "No project workspace" };
    try {
      const { stdout } = await execFile("git", ["branch", "--no-color"], { cwd, encoding: "utf-8", timeout: 5000 });
      const branches = stdout.trim().split("\n").map((b) => {
        const current = b.startsWith("* ");
        return { name: b.replace(/^\*?\s+/, ""), current };
      });
      return { ok: true, branches };
    } catch (error) {
      return { ok: false, error: error.message };
    }
  },

  async gitCheckout({ branch } = {}) {
    const cwd = this._gitProjectCwd();
    if (!cwd) return { ok: false, error: "No project workspace" };
    if (!branch) return { ok: false, error: "No branch specified" };
    try {
      await execFile("git", ["checkout", branch], { cwd, encoding: "utf-8", timeout: 15000 });
      return { ok: true };
    } catch (error) {
      return { ok: false, error: error.message };
    }
  }
};
