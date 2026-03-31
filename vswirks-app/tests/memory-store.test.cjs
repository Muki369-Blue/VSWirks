const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs/promises");
const os = require("os");
const path = require("path");
const { MemoryStore } = require("../electron/memory/memory-store.cjs");

describe("MemoryStore", () => {
  it("logDecision requires projectId and summary", async () => {
    const store = new MemoryStore();
    const r1 = await store.logDecision({});
    assert.equal(r1.ok, false);
    const r2 = await store.logDecision({ projectId: "p1" });
    assert.equal(r2.ok, false);
  });

  it("logDecision and queryDecisions round-trip in memory", async () => {
    const store = new MemoryStore();
    // Pre-seed cache to avoid disk writes
    store._cache.set("test-proj", { projectId: "test-proj", decisions: [], learnings: [], updatedAt: Date.now() });

    const result = await store.logDecision({
      projectId: "test-proj",
      summary: "Chose React over Vue",
      type: "architecture",
      rationale: "Team preference"
    });
    assert.equal(result.ok, true);
    assert.ok(result.id.startsWith("decision-"));

    const decisions = await store.queryDecisions({ projectId: "test-proj", type: "architecture" });
    assert.equal(decisions.length, 1);
    assert.equal(decisions[0].summary, "Chose React over Vue");
  });

  it("addLearning requires projectId and content", async () => {
    const store = new MemoryStore();
    const r1 = await store.addLearning({});
    assert.equal(r1.ok, false);
  });

  it("addLearning and getLearnings round-trip in memory", async () => {
    const store = new MemoryStore();
    store._cache.set("test-proj", { projectId: "test-proj", decisions: [], learnings: [], updatedAt: Date.now() });

    const result = await store.addLearning({
      projectId: "test-proj",
      category: "pattern",
      content: "Always use async/await over callbacks"
    });
    assert.equal(result.ok, true);

    const learnings = await store.getLearnings({ projectId: "test-proj", category: "pattern" });
    assert.equal(learnings.length, 1);
    assert.equal(learnings[0].content, "Always use async/await over callbacks");
  });

  it("touchLearning increments usedCount", async () => {
    const store = new MemoryStore();
    store._cache.set("test-proj", { projectId: "test-proj", decisions: [], learnings: [], updatedAt: Date.now() });

    await store.addLearning({ projectId: "test-proj", content: "Use strict mode" });
    const learnings = await store.getLearnings({ projectId: "test-proj" });
    assert.equal(learnings[0].usedCount, 0);

    await store.touchLearning({ projectId: "test-proj", learningId: learnings[0].id });
    const updated = await store.getLearnings({ projectId: "test-proj" });
    assert.equal(updated[0].usedCount, 1);
  });

  it("getContextSummary returns empty string for empty project", async () => {
    const store = new MemoryStore();
    store._cache.set("empty-proj", { projectId: "empty-proj", decisions: [], learnings: [], updatedAt: Date.now() });
    const summary = await store.getContextSummary({ projectId: "empty-proj" });
    assert.equal(summary, "");
  });

  it("getContextSummary returns markdown with learnings and decisions", async () => {
    const store = new MemoryStore();
    store._cache.set("rich-proj", { projectId: "rich-proj", decisions: [], learnings: [], updatedAt: Date.now() });

    await store.addLearning({ projectId: "rich-proj", category: "gotcha", content: "Avoid circular imports" });
    await store.logDecision({ projectId: "rich-proj", summary: "Used ESM modules", type: "architecture" });

    const summary = await store.getContextSummary({ projectId: "rich-proj" });
    assert.ok(summary.includes("## Project Learnings"));
    assert.ok(summary.includes("Avoid circular imports"));
    assert.ok(summary.includes("## Recent Decisions"));
    assert.ok(summary.includes("Used ESM modules"));
  });

  it("clearProject removes cached data", async () => {
    const store = new MemoryStore();
    store._cache.set("clear-proj", { projectId: "clear-proj", decisions: [{ id: "d1" }], learnings: [], updatedAt: Date.now() });

    await store.clearProject({ projectId: "clear-proj" });
    assert.equal(store._cache.has("clear-proj"), false);
  });
});
