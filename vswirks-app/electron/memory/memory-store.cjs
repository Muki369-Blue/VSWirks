// Phase 3: Memory Store — persistent project memory and decision log
// Stores agent decisions, learnings, and context across sessions.

const fs = require("fs/promises");
const os = require("os");
const path = require("path");

const MEMORY_DIR = path.join(os.homedir(), "Library", "Application Support", "VSWirks", "memory");
const MAX_DECISIONS_PER_PROJECT = 500;
const MAX_LEARNINGS_PER_PROJECT = 200;

class MemoryStore {
  constructor() {
    this._cache = new Map(); // projectId -> memory object
  }

  // ── Decision Log ────────────────────────────────────

  /** Record an agent decision with rationale */
  async logDecision({ projectId, runId, threadId, type, summary, rationale, files = [], outcome = "" } = {}) {
    if (!projectId || !summary) return { ok: false, error: "Missing projectId or summary" };
    const memory = await this._load(projectId);
    const entry = {
      id: `decision-${Date.now()}-${Math.random().toString(16).slice(2, 6)}`,
      runId: runId || "",
      threadId: threadId || "",
      type: type || "general", // types: tool-call, file-write, architecture, refactor, bugfix, test
      summary,
      rationale: rationale || "",
      files,
      outcome,
      createdAt: Date.now()
    };
    memory.decisions.unshift(entry);
    if (memory.decisions.length > MAX_DECISIONS_PER_PROJECT) {
      memory.decisions = memory.decisions.slice(0, MAX_DECISIONS_PER_PROJECT);
    }
    await this._save(projectId, memory);
    return { ok: true, id: entry.id };
  }

  /** Query decisions by type, file, or recency */
  async queryDecisions({ projectId, type, file, limit = 20 } = {}) {
    const memory = await this._load(projectId);
    let results = memory.decisions;
    if (type) results = results.filter((d) => d.type === type);
    if (file) results = results.filter((d) => d.files.some((f) => f.includes(file)));
    return results.slice(0, limit);
  }

  // ── Learnings ───────────────────────────────────────

  /** Store a project-level learning (patterns, preferences, gotchas) */
  async addLearning({ projectId, category, content, source = "" } = {}) {
    if (!projectId || !content) return { ok: false, error: "Missing projectId or content" };
    const memory = await this._load(projectId);
    const entry = {
      id: `learning-${Date.now()}-${Math.random().toString(16).slice(2, 6)}`,
      category: category || "general", // categories: pattern, preference, gotcha, dependency, architecture
      content,
      source,
      usedCount: 0,
      createdAt: Date.now(),
      updatedAt: Date.now()
    };
    memory.learnings.unshift(entry);
    if (memory.learnings.length > MAX_LEARNINGS_PER_PROJECT) {
      memory.learnings = memory.learnings.slice(0, MAX_LEARNINGS_PER_PROJECT);
    }
    await this._save(projectId, memory);
    return { ok: true, id: entry.id };
  }

  /** Get learnings relevant to a prompt or file context */
  async getLearnings({ projectId, category, limit = 10 } = {}) {
    const memory = await this._load(projectId);
    let results = memory.learnings;
    if (category) results = results.filter((l) => l.category === category);
    return results.slice(0, limit);
  }

  /** Mark a learning as used (boosts relevance) */
  async touchLearning({ projectId, learningId } = {}) {
    const memory = await this._load(projectId);
    const entry = memory.learnings.find((l) => l.id === learningId);
    if (entry) {
      entry.usedCount += 1;
      entry.updatedAt = Date.now();
      await this._save(projectId, memory);
    }
    return { ok: true };
  }

  // ── Project Context Summary ─────────────────────────

  /** Get a compact context summary for system prompt injection */
  async getContextSummary({ projectId, maxDecisions = 5, maxLearnings = 5 } = {}) {
    const memory = await this._load(projectId);
    const recentDecisions = memory.decisions.slice(0, maxDecisions);
    const topLearnings = memory.learnings
      .sort((a, b) => b.usedCount - a.usedCount || b.updatedAt - a.updatedAt)
      .slice(0, maxLearnings);

    if (!recentDecisions.length && !topLearnings.length) return "";

    const parts = [];
    if (topLearnings.length) {
      parts.push("## Project Learnings");
      for (const l of topLearnings) {
        parts.push(`- [${l.category}] ${l.content}`);
      }
    }
    if (recentDecisions.length) {
      parts.push("## Recent Decisions");
      for (const d of recentDecisions) {
        parts.push(`- [${d.type}] ${d.summary}${d.outcome ? ` → ${d.outcome}` : ""}`);
      }
    }
    return parts.join("\n");
  }

  // ── Cleanup ─────────────────────────────────────────

  async clearProject({ projectId } = {}) {
    this._cache.delete(projectId);
    const filePath = this._filePath(projectId);
    await fs.unlink(filePath).catch(() => {});
    return { ok: true };
  }

  // ── Persistence ─────────────────────────────────────

  _filePath(projectId) {
    const safe = String(projectId).replace(/[^a-zA-Z0-9_-]/g, "_");
    return path.join(MEMORY_DIR, `${safe}.json`);
  }

  async _load(projectId) {
    if (this._cache.has(projectId)) return this._cache.get(projectId);
    try {
      await fs.mkdir(MEMORY_DIR, { recursive: true });
      const raw = await fs.readFile(this._filePath(projectId), "utf-8");
      const data = JSON.parse(raw);
      const memory = {
        projectId,
        decisions: Array.isArray(data.decisions) ? data.decisions : [],
        learnings: Array.isArray(data.learnings) ? data.learnings : [],
        updatedAt: data.updatedAt || Date.now()
      };
      this._cache.set(projectId, memory);
      return memory;
    } catch {
      const empty = { projectId, decisions: [], learnings: [], updatedAt: Date.now() };
      this._cache.set(projectId, empty);
      return empty;
    }
  }

  async _save(projectId, memory) {
    memory.updatedAt = Date.now();
    this._cache.set(projectId, memory);
    await fs.mkdir(MEMORY_DIR, { recursive: true });
    const tmpPath = this._filePath(projectId) + `.tmp.${Date.now()}`;
    await fs.writeFile(tmpPath, JSON.stringify(memory, null, 2), "utf-8");
    await fs.rename(tmpPath, this._filePath(projectId));
  }
}

module.exports = { MemoryStore };
