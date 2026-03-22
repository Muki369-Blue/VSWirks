"use strict";

const BACKUP_ARTIFACT_PATTERN = /\.bak\.\d{8}-\d{6}$/;
const IGNORED_WORKSPACE_ENTRY_NAMES = new Set([
  ".DS_Store",
  ".git",
  "node_modules",
  ".venv",
  ".pytest_cache",
  "__pycache__",
  "dist",
  "build",
  ".next",
  ".turbo"
]);
const SKIPPABLE_WORKSPACE_ROOT_ENTRY_NAMES = new Set([
  ".git",
  ".DS_Store",
  ".vscode",
  ".idea",
  ".gitignore",
  ".gitattributes",
  ".editorconfig"
]);
const RIPGREP_IGNORE_GLOBS = Object.freeze([
  "!**/.git/**",
  "!**/.DS_Store",
  "!**/*.bak.*",
  "!**/node_modules/**",
  "!**/.venv/**",
  "!**/.pytest_cache/**",
  "!**/__pycache__/**",
  "!**/dist/**",
  "!**/build/**",
  "!**/.next/**",
  "!**/.turbo/**"
]);

function isBackupArtifact(name) {
  return BACKUP_ARTIFACT_PATTERN.test(String(name || ""));
}

function isIgnoredWorkspaceEntry(name) {
  if (!name) {
    return false;
  }
  return IGNORED_WORKSPACE_ENTRY_NAMES.has(name) || isBackupArtifact(name);
}

function isIgnoredWorkspacePath(filePath) {
  const parts = String(filePath || "")
    .split(/[\\/]+/)
    .filter(Boolean);
  return parts.some((part) => isIgnoredWorkspaceEntry(part));
}

function isSkippableWorkspaceRootEntry(name) {
  if (!name) {
    return false;
  }
  return SKIPPABLE_WORKSPACE_ROOT_ENTRY_NAMES.has(name) || isBackupArtifact(name);
}

function filterIgnoredWorkspacePaths(paths) {
  return (Array.isArray(paths) ? paths : []).filter((entry) => !isIgnoredWorkspacePath(entry));
}

function appendRipgrepIgnoreGlobs(args) {
  const next = Array.isArray(args) ? args : [];
  for (const glob of RIPGREP_IGNORE_GLOBS) {
    next.push("-g", glob);
  }
  return next;
}

module.exports = {
  BACKUP_ARTIFACT_PATTERN,
  IGNORED_WORKSPACE_ENTRY_NAMES,
  SKIPPABLE_WORKSPACE_ROOT_ENTRY_NAMES,
  RIPGREP_IGNORE_GLOBS,
  isBackupArtifact,
  isIgnoredWorkspaceEntry,
  isIgnoredWorkspacePath,
  isSkippableWorkspaceRootEntry,
  filterIgnoredWorkspacePaths,
  appendRipgrepIgnoreGlobs
};
