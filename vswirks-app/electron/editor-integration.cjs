const path = require("path");

const {
  readBridgeState,
  updateBridgeState,
  resolveBridgeStatePath
} = require("../../shared/vswirks-state");
const {
  isPathWithin,
  canOpenVSWirksEditor,
  openInVSWirksEditor,
  openPathsInVSWirksEditor,
  openDiffInVSWirksEditor
} = require("./workspace-tools.cjs");

const EDITOR_INTEGRATION_UNAVAILABLE = "Editor integration unavailable";

function buildUnavailableResult() {
  return {
    ok: false,
    error: EDITOR_INTEGRATION_UNAVAILABLE
  };
}

function isBridgeConnected(bridgeState = {}) {
  return Number(bridgeState.updatedAt) > Date.now() - 120000 && Boolean(bridgeState.editorName);
}

function resolveBridgeWorkspaceRoot(bridgeState = {}) {
  if (
    typeof bridgeState.activeWorkspaceRoot === "string" &&
    bridgeState.activeWorkspaceRoot
  ) {
    return bridgeState.activeWorkspaceRoot;
  }

  const workspaceRoots = Array.isArray(bridgeState.workspaceRoots)
    ? bridgeState.workspaceRoots.filter((item) => typeof item === "string" && item)
    : [];

  if (
    typeof bridgeState.workspaceTarget === "string" &&
    bridgeState.workspaceTarget
  ) {
    const matchingRoot = workspaceRoots.find((rootPath) =>
      isPathWithin(rootPath, bridgeState.workspaceTarget)
    );
    if (matchingRoot) {
      return matchingRoot;
    }
  }

  if (workspaceRoots.length) {
    return workspaceRoots[0];
  }

  if (
    typeof bridgeState.workspaceTarget === "string" &&
    bridgeState.workspaceTarget
  ) {
    return bridgeState.workspaceTarget;
  }

  return "";
}

function resolveBridgeTargetPath(bridgeState = {}, bridgeRoot = resolveBridgeWorkspaceRoot(bridgeState)) {
  if (
    bridgeRoot &&
    typeof bridgeState.workspaceTarget === "string" &&
    bridgeState.workspaceTarget &&
    isPathWithin(bridgeRoot, bridgeState.workspaceTarget)
  ) {
    return bridgeState.workspaceTarget;
  }
  return bridgeRoot;
}

function buildEditorIntegrationState(bridgeState = {}, canOpenEditor = false) {
  const activeWorkspaceRoot = resolveBridgeWorkspaceRoot(bridgeState);
  const connected = isBridgeConnected(bridgeState);
  const selectionText =
    typeof bridgeState.selectionText === "string" ? bridgeState.selectionText.trim() : "";
  const hasBridgeContext = Boolean(
    activeWorkspaceRoot ||
    selectionText ||
    bridgeState.activeFileLabel ||
    bridgeState.selectionLabel ||
    bridgeState.editorName
  );

  return {
    available: Boolean(canOpenEditor || connected || hasBridgeContext),
    connected,
    selectionAvailable: Boolean(selectionText),
    mode: "manual",
    canOpen: Boolean(canOpenEditor),
    statePath: resolveBridgeStatePath(),
    activeWorkspaceRoot,
    activeWorkspaceLabel: activeWorkspaceRoot ? path.basename(activeWorkspaceRoot) : "",
    activeFileLabel: bridgeState.activeFileLabel || "",
    selectionLabel: bridgeState.selectionLabel || "",
    targetLabel:
      typeof bridgeState.workspaceTarget === "string" && bridgeState.workspaceTarget
        ? path.basename(bridgeState.workspaceTarget)
        : "",
    selectedExplorerPath:
      typeof bridgeState.selectedExplorerPath === "string"
        ? bridgeState.selectedExplorerPath
        : "",
    activeSelection:
      bridgeState.activeSelection && typeof bridgeState.activeSelection === "object"
        ? bridgeState.activeSelection
        : null
  };
}

class EditorIntegration {
  constructor(dependencies = {}) {
    this.dependencies = {
      readBridgeState: dependencies.readBridgeState || readBridgeState,
      updateBridgeState: dependencies.updateBridgeState || updateBridgeState,
      canOpenVSWirksEditor: dependencies.canOpenVSWirksEditor || canOpenVSWirksEditor,
      openInVSWirksEditor: dependencies.openInVSWirksEditor || openInVSWirksEditor,
      openPathsInVSWirksEditor:
        dependencies.openPathsInVSWirksEditor || openPathsInVSWirksEditor,
      openDiffInVSWirksEditor:
        dependencies.openDiffInVSWirksEditor || openDiffInVSWirksEditor
    };
    this.bridgeState = {};
    this.canOpenEditor = false;
  }

  async refreshState() {
    this.bridgeState = await this.dependencies.readBridgeState();
    this.canOpenEditor = await this.dependencies.canOpenVSWirksEditor();
    return this.bridgeState;
  }

  getBridgeState() {
    return this.bridgeState || {};
  }

  describe() {
    return buildEditorIntegrationState(this.bridgeState, this.canOpenEditor);
  }

  resolveWorkspaceRoot(bridgeState = this.bridgeState) {
    return resolveBridgeWorkspaceRoot(bridgeState);
  }

  resolveTargetPath(bridgeState = this.bridgeState, bridgeRoot = this.resolveWorkspaceRoot(bridgeState)) {
    return resolveBridgeTargetPath(bridgeState, bridgeRoot);
  }

  async updateBridgeState(patch) {
    this.bridgeState = await this.dependencies.updateBridgeState(patch);
    return this.bridgeState;
  }

  async acknowledgeHandoff(appHandoffRequest) {
    await this.updateBridgeState({ appHandoffRequest });
    return { ok: true };
  }

  async publishSelection(project) {
    if (!project || !project.workspaceRoot) {
      return {
        ok: false,
        error: "No project workspace available"
      };
    }

    const workspaceRoot = project.workspaceRoot;
    const targetPath =
      project.targetPath && isPathWithin(workspaceRoot, project.targetPath)
        ? project.targetPath
        : workspaceRoot;
    const requestedAt = Date.now();
    await this.updateBridgeState({
      appSelectedProjectId: project.id,
      appSelectedWorkspaceRoot: workspaceRoot,
      appSelectedTargetPath: targetPath,
      appSelectionRequestedAt: requestedAt,
      appSelectionRequestedBy: "VSWirks App"
    });
    return { ok: true };
  }

  async ensureCanOpenEditor() {
    if (!this.canOpenEditor) {
      this.canOpenEditor = await this.dependencies.canOpenVSWirksEditor();
    }
    return this.canOpenEditor;
  }

  async openPath(filePath, line, column) {
    if (!(await this.ensureCanOpenEditor())) {
      return buildUnavailableResult();
    }
    await this.dependencies.openInVSWirksEditor(filePath, line, column);
    return { ok: true };
  }

  async openPaths(paths) {
    if (!(await this.ensureCanOpenEditor())) {
      return buildUnavailableResult();
    }
    await this.dependencies.openPathsInVSWirksEditor(paths);
    return { ok: true };
  }

  async openDiff(leftPath, rightPath, label) {
    if (!(await this.ensureCanOpenEditor())) {
      return buildUnavailableResult();
    }
    await this.dependencies.openDiffInVSWirksEditor(leftPath, rightPath, label);
    return { ok: true };
  }

  async publishAction(action) {
    if (!action || typeof action !== "object") {
      return {
        ok: false,
        error: "No editor action provided"
      };
    }

    const nextAction = {
      ...action,
      requestedAt: Date.now(),
      requestedBy: "VSWirks App"
    };
    await this.updateBridgeState({
      editorActionRequest: nextAction
    });
    return this.applyLocalAction(action);
  }

  async applyLocalAction(action) {
    if (!action || typeof action !== "object") {
      return {
        ok: false,
        error: "No editor action provided"
      };
    }

    if (action.type === "openChangedFiles") {
      const paths = Array.isArray(action.paths)
        ? action.paths.filter((item) => typeof item === "string" && item.trim())
        : [];
      if (!paths.length) {
        return {
          ok: false,
          error: "No files to reveal"
        };
      }
      return this.openPaths(paths);
    }

    if (action.type === "openDiff" && action.leftPath && action.rightPath) {
      return this.openDiff(action.leftPath, action.rightPath, action.label || "VSWirks Diff");
    }

    if (action.type === "revealPath" && typeof action.path === "string" && action.path) {
      return this.openPath(action.path);
    }

    return {
      ok: false,
      error: "Unknown editor action"
    };
  }

  async buildSelectionAttachment(workspaceRoot = "") {
    const bridgeState = this.bridgeState || {};
    const selectionText =
      typeof bridgeState.selectionText === "string" ? bridgeState.selectionText.trim() : "";

    if (!selectionText) {
      return {
        ok: false,
        error: "No editor selection is currently published from the optional editor integration."
      };
    }

    const activeFileLabel =
      typeof bridgeState.activeFileLabel === "string" ? bridgeState.activeFileLabel : "";
    const label =
      bridgeState.selectionLabel ||
      activeFileLabel ||
      (workspaceRoot ? path.basename(workspaceRoot) : "Editor selection");

    return {
      ok: true,
      attachment: {
        kind: "selection",
        label,
        languageId: bridgeState.activeLanguageId || "",
        content: selectionText
      }
    };
  }

  async getWorkspaceImport() {
    const workspaceRoot = this.resolveWorkspaceRoot(this.bridgeState);
    if (!workspaceRoot) {
      return {
        ok: false,
        error: "No editor workspace is currently available to import."
      };
    }

    return {
      ok: true,
      workspaceRoot,
      targetPath: this.resolveTargetPath(this.bridgeState, workspaceRoot)
    };
  }
}

module.exports = {
  EditorIntegration,
  EDITOR_INTEGRATION_UNAVAILABLE,
  buildUnavailableResult,
  buildEditorIntegrationState,
  isBridgeConnected,
  resolveBridgeWorkspaceRoot,
  resolveBridgeTargetPath
};
