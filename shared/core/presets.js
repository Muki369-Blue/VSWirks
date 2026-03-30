const { createWorkflowPreset, createAgentProfile, normalizeAgentProfile } = require("./factories");

function getDefaultWorkflowPresets() {
  return [
    createWorkflowPreset({
      id: "scaffold-app",
      label: "Scaffold App",
      description: "Turn a rough idea into a staged full repository build.",
      defaultMode: "agent",
      defaultExecutionMode: "act",
      preferredRole: "builder",
      validationPack: "auto",
      completionContract:
        "Create a working repository through staged architecture, backend, middleware, frontend, and integration passes as needed. The final repo must implement the requested core capability with real source, project metadata, tests, local run instructions, and at least one executable validation path. Do not leave placeholder or demo-only artifacts.",
      promptPrefix:
        "Scaffold a production-ready local-first application in staged build phases. First establish architecture and repository contracts, then implement backend/core logic, middleware or orchestration, frontend or user interaction, and finish with integration review. Use concrete tooling, write executable source and tests, and avoid demo skeletons, TODO-only files, or placeholder logic."
    }),
    createWorkflowPreset({
      id: "review-repo",
      label: "Review Repo",
      description: "Review an existing repository for bugs, risks, and missing tests.",
      defaultMode: "chat",
      defaultExecutionMode: "plan",
      preferredRole: "reviewer",
      validationPack: "none",
      completionContract:
        "Report prioritized findings with concrete evidence, likely regressions, and missing test coverage."
    }),
    createWorkflowPreset({
      id: "fix-build",
      label: "Fix Build",
      description: "Diagnose a broken project and move from report to repair.",
      defaultMode: "agent",
      defaultExecutionMode: "plan",
      preferredRole: "editor",
      validationPack: "auto",
      completionContract:
        "Identify the failing path, explain root cause, propose edits, and verify with safe local validation."
    }),
    createWorkflowPreset({
      id: "add-tests",
      label: "Add Tests",
      description: "Expand focused tests around important behaviors.",
      defaultMode: "agent",
      defaultExecutionMode: "act",
      preferredRole: "editor",
      validationPack: "test",
      completionContract:
        "Add or update targeted tests that cover key behavior, edges, and regressions."
    }),
    createWorkflowPreset({
      id: "refactor-module",
      label: "Refactor Module",
      description: "Restructure code while preserving behavior.",
      defaultMode: "agent",
      defaultExecutionMode: "act",
      preferredRole: "editor",
      validationPack: "auto",
      completionContract:
        "Improve clarity and maintainability, preserve behavior unless explicitly requested, and validate the result."
    }),
    createWorkflowPreset({
      id: "ui-from-image",
      label: "UI From Image",
      description: "Generate a full project from an attached visual reference.",
      defaultMode: "agent",
      defaultExecutionMode: "act",
      preferredRole: "builder",
      validationPack: "build",
      completionContract:
        "Convert the visual reference into a real project structure, components, styling, assets, and local run instructions.",
      promptPrefix:
        "Use the attached image as a product and UI reference. Build the actual project, not a snippet."
    }),
    createWorkflowPreset({
      id: "freeform",
      label: "Freeform",
      description: "General local coding chat and agent work.",
      defaultMode: "chat",
      defaultExecutionMode: "plan",
      preferredRole: "chat",
      validationPack: "auto",
      completionContract: "Respond concisely and keep the work local-first."
    })
  ];
}

function getDefaultAgentProfiles() {
  return [
    createAgentProfile({
      id: "app-default",
      label: "App Default",
      description: "Balanced local-first behavior for day-to-day VSWirks work.",
      preferredRole: "chat",
      defaultMode: "chat",
      defaultExecutionMode: "plan",
      systemPrompt:
        "Keep responses concise, practical, and app-first. Route heavy repo work into staged VSWirks App runs instead of loose snippets."
    }),
    createAgentProfile({
      id: "build-operator",
      label: "Build Operator",
      description: "Use for staged implementation and scaffold work owned by VSWirks App.",
      preferredRole: "editor",
      defaultMode: "agent",
      defaultExecutionMode: "act",
      linkedWorkflowPresetId: "scaffold-app",
      promptPrefix:
        "Treat VSWirks App as the orchestration owner. Finish real repository structure, validation, and resumable staged execution.",
      systemPrompt:
        "You are executing app-owned local builds. Prefer coherent repo completion, validation, and resumable staged progress over ad hoc edits."
    }),
    createAgentProfile({
      id: "review-analyst",
      label: "Review Analyst",
      description: "Findings-first reviewer for repo and code audits.",
      preferredRole: "reviewer",
      defaultMode: "chat",
      defaultExecutionMode: "plan",
      linkedWorkflowPresetId: "review-repo",
      systemPrompt:
        "Review like a senior engineer. Findings first. Prioritize bugs, regressions, risky assumptions, and missing tests."
    })
  ];
}

function normalizeAgentProfileList(profiles) {
  const defaults = getDefaultAgentProfiles();
  const incoming = Array.isArray(profiles)
    ? profiles.map((profile) => normalizeAgentProfile(profile)).filter(Boolean)
    : [];
  const merged = new Map(defaults.map((profile) => [profile.id, profile]));
  for (const profile of incoming) {
    merged.set(profile.id, profile);
  }
  return Array.from(merged.values());
}

module.exports = {
  getDefaultWorkflowPresets,
  getDefaultAgentProfiles,
  normalizeAgentProfileList
};
