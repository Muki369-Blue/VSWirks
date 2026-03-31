// @domain: git — Git operations mixin for VSWirksController
// Applied to the controller prototype in controller.cjs

const cp = require("child_process");

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
      const branch = cp.execSync("git rev-parse --abbrev-ref HEAD", {
        cwd: project.workspaceRoot,
        encoding: "utf-8",
        timeout: 5000
      }).trim();
      const status = cp.execSync("git status --porcelain", {
        cwd: project.workspaceRoot,
        encoding: "utf-8",
        timeout: 5000
      }).trim();
      const logRaw = cp.execSync("git log --oneline -10", {
        cwd: project.workspaceRoot,
        encoding: "utf-8",
        timeout: 5000
      }).trim();
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
      cp.execFileSync("git", ["add", "--"].concat(files), { cwd, encoding: "utf-8", timeout: 10000 });
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
      cp.execFileSync("git", ["restore", "--staged", "--"].concat(files), { cwd, encoding: "utf-8", timeout: 10000 });
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
      const output = cp.execFileSync("git", ["commit", "-m", message.trim()], { cwd, encoding: "utf-8", timeout: 30000 });
      return { ok: true, output: output.slice(0, 5000) };
    } catch (error) {
      return { ok: false, error: (error.stderr || error.message).slice(0, 2000) };
    }
  },

  async gitDiff({ file } = {}) {
    const cwd = this._gitProjectCwd();
    if (!cwd) return { ok: false, error: "No project workspace" };
    try {
      const args = file ? `-- ${JSON.stringify(file)}` : "";
      const staged = cp.execSync(`git diff --cached ${args}`, { cwd, encoding: "utf-8", timeout: 10000 }).slice(0, 20000);
      const unstaged = cp.execSync(`git diff ${args}`, { cwd, encoding: "utf-8", timeout: 10000 }).slice(0, 20000);
      return { ok: true, staged, unstaged };
    } catch (error) {
      return { ok: false, error: error.message };
    }
  },

  async gitBranches() {
    const cwd = this._gitProjectCwd();
    if (!cwd) return { ok: false, error: "No project workspace" };
    try {
      const raw = cp.execSync("git branch --no-color", { cwd, encoding: "utf-8", timeout: 5000 }).trim();
      const branches = raw.split("\n").map((b) => {
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
      cp.execFileSync("git", ["checkout", branch], { cwd, encoding: "utf-8", timeout: 15000 });
      return { ok: true };
    } catch (error) {
      return { ok: false, error: error.message };
    }
  }
};
