const fs = require("fs/promises");
const os = require("os");
const path = require("path");
const cp = require("child_process");

const { timestamp, clampText, safeJsonParse } = require("../../shared/core");
const {
  isIgnoredWorkspaceEntry,
  isSkippableWorkspaceRootEntry,
  appendRipgrepIgnoreGlobs
} = require("../../shared/workspace-filters");

const CODE_EDITOR_BIN = "/Applications/VSCodium.app/Contents/Resources/app/bin/codium";

function isPathWithin(rootPath, targetPath) {
  const relative = path.relative(rootPath, targetPath);
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

function resolveWorkspacePath(rootPath, inputPath) {
  if (typeof inputPath !== "string" || !inputPath.trim()) {
    throw new Error("A relative workspace path is required.");
  }
  const resolved = path.resolve(rootPath, inputPath);
  if (!isPathWithin(rootPath, resolved)) {
    throw new Error(`Path escapes workspace: ${inputPath}`);
  }
  return resolved;
}

function formatWorkspaceLabel(workspaceRoot, targetPath) {
  const rootName = path.basename(workspaceRoot || "");
  const effectiveTarget = targetPath || workspaceRoot;
  const relative = workspaceRoot ? path.relative(workspaceRoot, effectiveTarget) : "";
  return relative ? `${rootName} -> ${relative}` : rootName || "No workspace";
}

async function describeWorkspaceRoot(workspaceRoot) {
  if (!workspaceRoot) {
    return null;
  }

  const entries = await fs.readdir(workspaceRoot, { withFileTypes: true }).catch(() => null);
  if (!entries) {
    return null;
  }

  const visible = entries.filter((entry) => !isSkippableWorkspaceRootEntry(entry.name));
  if (!visible.length) {
    return {
      empty: true,
      rootEntries: [],
      description: "Workspace state: empty or metadata-only project root."
    };
  }

  const listed = visible.slice(0, 16).map((entry) =>
    `${entry.isDirectory() ? "dir" : "file"} ${entry.name}`
  );
  const extra =
    visible.length > listed.length ? `\n- ... ${visible.length - listed.length} more` : "";

  return {
    empty: false,
    rootEntries: visible.map((entry) => entry.name),
    description: `Workspace state: ${visible.length} root entries.\nRoot entries:\n- ${listed.join("\n- ")}${extra}`
  };
}

async function listWorkspace({ workspaceRoot, relativePath = ".", maxEntries = 120 }) {
  const folder = resolveWorkspacePath(workspaceRoot, relativePath);
  const results = [];
  await walk(folder, workspaceRoot, results, Math.max(1, maxEntries));
  return results.sort();
}

async function walk(currentPath, workspaceRoot, results, maxEntries) {
  if (results.length >= maxEntries) {
    return;
  }

  const entries = await fs.readdir(currentPath, { withFileTypes: true }).catch(() => []);
  for (const entry of entries) {
    if (results.length >= maxEntries) {
      return;
    }
    if (isIgnoredWorkspaceEntry(entry.name)) {
      continue;
    }
    const entryPath = path.join(currentPath, entry.name);
    results.push(path.relative(workspaceRoot, entryPath));
    if (entry.isDirectory()) {
      await walk(entryPath, workspaceRoot, results, maxEntries);
    }
  }
}

async function readWorkspaceFile({ workspaceRoot, relativePath }) {
  const target = resolveWorkspacePath(workspaceRoot, relativePath);
  return fs.readFile(target, "utf8");
}

async function readWorkspaceFileIfExists({ workspaceRoot, relativePath }) {
  const target = resolveWorkspacePath(workspaceRoot, relativePath);
  try {
    return await fs.readFile(target, "utf8");
  } catch {
    return null;
  }
}

async function searchWorkspace({ workspaceRoot, pattern, glob, maxResults = 30 }) {
  const rgPath = await which("rg");
  if (rgPath) {
    const args = ["--line-number", "--no-heading", "--color", "never", pattern, workspaceRoot];
    if (glob) {
      args.push("-g", glob);
    }
    appendRipgrepIgnoreGlobs(args);
    const output = await execFileText(rgPath, args);
    return output
      .split(/\r?\n/)
      .filter(Boolean)
      .slice(0, maxResults);
  }

  const include = typeof glob === "string" && glob.trim() ? glob.trim() : "**/*";
  const files = await listWorkspace({ workspaceRoot, relativePath: ".", maxEntries: 300 });
  const matches = [];

  for (const relative of files) {
    if (matches.length >= maxResults) {
      break;
    }
    if (!matchesGlob(relative, include)) {
      continue;
    }
    const text = await readWorkspaceFile({ workspaceRoot, relativePath: relative }).catch(() => "");
    const lines = text.split(/\r?\n/);
    lines.forEach((line, index) => {
      if (matches.length < maxResults && line.includes(pattern)) {
        matches.push(`${relative}:${index + 1}:${line}`);
      }
    });
  }

  return matches;
}

function matchesGlob(filePath, glob) {
  if (!glob || glob === "**/*") {
    return true;
  }
  const normalizedGlob = glob.replace(/\*\*/g, "");
  return filePath.includes(normalizedGlob.replace(/\*/g, ""));
}

async function writeWorkspaceFile({ workspaceRoot, relativePath, content }) {
  const target = resolveWorkspacePath(workspaceRoot, relativePath);
  await fs.mkdir(path.dirname(target), { recursive: true });
  let backupPath = null;
  let previousContent = "";
  if (await exists(target)) {
    backupPath = `${target}.bak.${timestamp()}`;
    previousContent = await fs.readFile(target, "utf8").catch(() => "");
    await fs.copyFile(target, backupPath);
  }
  await fs.writeFile(target, content, "utf8");
  return {
    path: relativePath,
    backupPath: backupPath ? path.relative(workspaceRoot, backupPath) : null,
    previousContent
  };
}

async function computeWorkspaceDiff({ workspaceRoot, relativePath, nextContent }) {
  const target = resolveWorkspacePath(workspaceRoot, relativePath);
  const previousContent = (await fs.readFile(target, "utf8").catch(() => "")) || "";
  const diff = await computeUnifiedDiff({
    relativePath,
    previousContent,
    nextContent
  });
  return {
    previousContent,
    diff
  };
}

async function computeUnifiedDiff({ relativePath, previousContent, nextContent }) {
  const leftDir = await fs.mkdtemp(path.join(os.tmpdir(), "vswirks-left-"));
  const rightDir = await fs.mkdtemp(path.join(os.tmpdir(), "vswirks-right-"));
  const leftPath = path.join(leftDir, path.basename(relativePath || "before.txt"));
  const rightPath = path.join(rightDir, path.basename(relativePath || "after.txt"));

  try {
    await fs.writeFile(leftPath, previousContent || "", "utf8");
    await fs.writeFile(rightPath, nextContent || "", "utf8");

    const gitPath = await which("git");
    if (gitPath) {
      const diff = await execFileTextAllowExitCode(
        gitPath,
        ["diff", "--no-index", "--text", "--", leftPath, rightPath],
        [0, 1]
      );
      if (diff.trim()) {
        return rewriteDiffPaths(diff, relativePath);
      }
    }
  } catch {}
  finally {
    await Promise.allSettled([
      fs.rm(leftDir, { recursive: true, force: true }),
      fs.rm(rightDir, { recursive: true, force: true })
    ]);
  }

  return buildSimpleUnifiedDiff(relativePath, previousContent, nextContent);
}

function rewriteDiffPaths(diff, relativePath) {
  const rel = relativePath || "workspace-file";
  return diff
    .replace(/^diff --git.*$/m, `diff --git a/${rel} b/${rel}`)
    .replace(/^--- .+$/m, `--- a/${rel}`)
    .replace(/^\+\+\+ .+$/m, `+++ b/${rel}`);
}

function buildSimpleUnifiedDiff(relativePath, previousContent, nextContent) {
  const rel = relativePath || "workspace-file";
  const beforeLines = String(previousContent || "").split("\n");
  const afterLines = String(nextContent || "").split("\n");
  const lines = [`diff --git a/${rel} b/${rel}`, `--- a/${rel}`, `+++ b/${rel}`, "@@ -1 +1 @@"];
  for (const line of beforeLines) {
    lines.push(`-${line}`);
  }
  for (const line of afterLines) {
    lines.push(`+${line}`);
  }
  return lines.join("\n");
}

async function scanProjectIntelligence({ workspaceRoot, targetPath }) {
  const summaryBits = [];
  const frameworks = new Set();
  const manifests = [];
  const scripts = {};
  const entrypoints = [];
  const testPaths = [];
  const validationPlan = [];

  if (!workspaceRoot || !(await exists(workspaceRoot))) {
    return {
      workspaceRoot: workspaceRoot || "",
      targetPath: targetPath || workspaceRoot || "",
      summary: "Project root is missing.",
      frameworks: [],
      manifests: [],
      scripts: {},
      entrypoints: [],
      testPaths: [],
      validationPlan: [],
      generatedAt: Date.now()
    };
  }

  const packageJsonPath = path.join(workspaceRoot, "package.json");
  if (await exists(packageJsonPath)) {
    manifests.push("package.json");
    const pkg = safeJsonParse(await fs.readFile(packageJsonPath, "utf8").catch(() => "{}"), {});
    const dependencies = {
      ...(pkg.dependencies || {}),
      ...(pkg.devDependencies || {})
    };
    Object.assign(scripts, pkg.scripts || {});
    detectNodeFrameworks(dependencies, frameworks);
    if (pkg.main && typeof pkg.main === "string") {
      entrypoints.push(pkg.main);
    }
    validationPlan.push(...buildNodeValidationPlan(pkg, workspaceRoot));
    summaryBits.push(`Node scripts: ${Object.keys(pkg.scripts || {}).join(", ") || "none"}`);
  }

  const pyprojectPath = path.join(workspaceRoot, "pyproject.toml");
  if (await exists(pyprojectPath)) {
    manifests.push("pyproject.toml");
    const text = await fs.readFile(pyprojectPath, "utf8").catch(() => "");
    detectPythonFrameworks(text, frameworks);
    validationPlan.push(...buildPythonValidationPlan(text, workspaceRoot));
    summaryBits.push("Python project detected via pyproject.toml");
  }

  const requirementsPath = path.join(workspaceRoot, "requirements.txt");
  if (await exists(requirementsPath)) {
    manifests.push("requirements.txt");
    const text = await fs.readFile(requirementsPath, "utf8").catch(() => "");
    detectPythonFrameworks(text, frameworks);
    summaryBits.push("Python dependencies detected via requirements.txt");
  }

  for (const candidate of ["Package.swift", "Cargo.toml", "go.mod"]) {
    if (await exists(path.join(workspaceRoot, candidate))) {
      manifests.push(candidate);
      summaryBits.push(`${candidate} detected`);
    }
  }

  const testsDirCandidates = ["tests", "__tests__", "test"];
  for (const candidate of testsDirCandidates) {
    if (await exists(path.join(workspaceRoot, candidate))) {
      testPaths.push(candidate);
    }
  }

  const commonEntrypoints = [
    "README.md",
    "src/main.tsx",
    "src/main.ts",
    "src/index.tsx",
    "src/index.ts",
    "src/main.js",
    "src/index.js",
    "main.py",
    "app/main.py",
    "Sources/App/main.swift",
    "main.swift"
  ];
  for (const candidate of commonEntrypoints) {
    if (await exists(path.join(workspaceRoot, candidate))) {
      entrypoints.push(candidate);
    }
  }

  const workspaceSnapshot = await describeWorkspaceRoot(targetPath || workspaceRoot);
  if (workspaceSnapshot && workspaceSnapshot.rootEntries.length) {
    summaryBits.push(`Root entries: ${workspaceSnapshot.rootEntries.slice(0, 8).join(", ")}`);
  }

  const uniqueEntrypoints = Array.from(new Set(entrypoints));
  const uniqueTests = Array.from(new Set(testPaths));
  if (
    !manifests.includes("pyproject.toml") &&
    (manifests.includes("requirements.txt") || uniqueEntrypoints.some(isPythonEntrypoint))
  ) {
    validationPlan.push(
      ...buildPythonFallbackValidationPlan({
        workspaceRoot,
        hasTests: uniqueTests.length > 0
      })
    );
  }
  const uniqueValidationPlan = dedupeValidationPlan(validationPlan);
  const summary = [
    frameworks.size ? `Frameworks: ${Array.from(frameworks).join(", ")}` : "",
    manifests.length ? `Manifests: ${manifests.join(", ")}` : "",
    uniqueEntrypoints.length ? `Entrypoints: ${uniqueEntrypoints.join(", ")}` : "",
    uniqueTests.length ? `Tests: ${uniqueTests.join(", ")}` : "",
    uniqueValidationPlan.length
      ? `Validation: ${uniqueValidationPlan.map((step) => step.label).join(", ")}`
      : "Validation: none detected",
    ...summaryBits
  ]
    .filter(Boolean)
    .join("\n");

  return {
    workspaceRoot,
    targetPath: targetPath || workspaceRoot,
    summary,
    frameworks: Array.from(frameworks),
    manifests,
    scripts,
    entrypoints: uniqueEntrypoints,
    testPaths: uniqueTests,
    validationPlan: uniqueValidationPlan,
    generatedAt: Date.now()
  };
}

function detectNodeFrameworks(dependencies, frameworks) {
  const deps = Object.keys(dependencies || {});
  if (deps.some((name) => name === "react")) {
    frameworks.add("React");
  }
  if (deps.some((name) => name === "next")) {
    frameworks.add("Next.js");
  }
  if (deps.some((name) => name === "vite")) {
    frameworks.add("Vite");
  }
  if (deps.some((name) => name === "tailwindcss")) {
    frameworks.add("Tailwind CSS");
  }
  if (deps.some((name) => name === "electron")) {
    frameworks.add("Electron");
  }
}

function detectPythonFrameworks(text, frameworks) {
  const source = String(text || "").toLowerCase();
  if (source.includes("fastapi")) {
    frameworks.add("FastAPI");
  }
  if (source.includes("pytest")) {
    frameworks.add("pytest");
  }
  if (source.includes("ruff")) {
    frameworks.add("ruff");
  }
  if (source.includes("pyinstaller")) {
    frameworks.add("PyInstaller");
  }
}

function buildNodeValidationPlan(pkg, workspaceRoot) {
  const scripts = pkg && pkg.scripts ? pkg.scripts : {};
  const plan = [];
  for (const name of ["test", "lint", "build", "typecheck"]) {
    if (!scripts[name]) {
      continue;
    }
    plan.push({
      id: `node-${name}`,
      label: `npm run ${name}`,
      command: "npm",
      args: ["run", "-s", name],
      cwd: workspaceRoot,
      kind: name
    });
  }
  return plan;
}

function buildPythonValidationPlan(pyprojectText, workspaceRoot) {
  const source = String(pyprojectText || "");
  const normalizedSource = source.toLowerCase();
  const plan = [];
  if (normalizedSource.includes("pytest")) {
    const pytestStep = buildPytestValidationStep(source, workspaceRoot);
    plan.push({
      id: "python-test",
      cwd: workspaceRoot,
      kind: "test",
      ...pytestStep
    });
  }
  if (normalizedSource.includes("ruff")) {
    plan.push({
      id: "python-lint",
      label: "uv run ruff check .",
      command: "uv",
      args: ["run", "ruff", "check", "."],
      cwd: workspaceRoot,
      kind: "lint"
    });
  }
  plan.push({
    id: "python-compileall",
    label: "uv run python -m compileall .",
    command: "uv",
    args: ["run", "python", "-m", "compileall", "."],
    cwd: workspaceRoot,
    kind: "build"
  });
  return plan;
}

function buildPytestValidationStep(pyprojectText, workspaceRoot) {
  const source = String(pyprojectText || "");

  if (hasPyprojectDependencyGroup(source, "test")) {
    return {
      label: "uv run --group test pytest",
      command: "uv",
      args: ["run", "--group", "test", "pytest"],
      cwd: workspaceRoot
    };
  }

  if (hasPyprojectOptionalExtra(source, "test")) {
    return {
      label: "uv run --extra test pytest",
      command: "uv",
      args: ["run", "--extra", "test", "pytest"],
      cwd: workspaceRoot
    };
  }

  if (hasPyprojectDependencyGroup(source, "dev")) {
    return {
      label: "uv run --group dev pytest",
      command: "uv",
      args: ["run", "--group", "dev", "pytest"],
      cwd: workspaceRoot
    };
  }

  if (hasPyprojectOptionalExtra(source, "dev")) {
    return {
      label: "uv run --extra dev pytest",
      command: "uv",
      args: ["run", "--extra", "dev", "pytest"],
      cwd: workspaceRoot
    };
  }

  return {
    label: "uv run pytest",
    command: "uv",
    args: ["run", "pytest"],
    cwd: workspaceRoot
  };
}

function hasPyprojectOptionalExtra(pyprojectText, extraName) {
  const source = String(pyprojectText || "");
  const extra = String(extraName || "").trim().toLowerCase();
  if (!extra || !/\[project\.optional-dependencies\]/i.test(source)) {
    return false;
  }
  const pattern = new RegExp(`^\\s*${escapeRegex(extra)}\\s*=\\s*\\[`, "im");
  return pattern.test(source);
}

function hasPyprojectDependencyGroup(pyprojectText, groupName) {
  const source = String(pyprojectText || "");
  const group = String(groupName || "").trim().toLowerCase();
  if (!group || !/\[dependency-groups\]/i.test(source)) {
    return false;
  }
  const pattern = new RegExp(`^\\s*${escapeRegex(group)}\\s*=\\s*\\[`, "im");
  return pattern.test(source);
}

function escapeRegex(value) {
  return String(value || "").replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function buildPythonFallbackValidationPlan({ workspaceRoot, hasTests }) {
  const plan = [];
  if (hasTests) {
    plan.push({
      id: "python-unittest",
      label: "python3 -m unittest discover tests",
      command: "python3",
      args: ["-m", "unittest", "discover", "tests"],
      cwd: workspaceRoot,
      kind: "test"
    });
  }
  plan.push({
    id: "python-compileall",
    label: "python3 -m compileall .",
    command: "python3",
    args: ["-m", "compileall", "."],
    cwd: workspaceRoot,
    kind: "build"
  });
  return plan;
}

function isPythonEntrypoint(entryPath) {
  return typeof entryPath === "string" && /\.py$/i.test(entryPath);
}

function dedupeValidationPlan(plan) {
  const seen = new Set();
  return (Array.isArray(plan) ? plan : []).filter((step) => {
    if (!step || !step.id || seen.has(step.id)) {
      return false;
    }
    seen.add(step.id);
    return true;
  });
}

function pickValidationPlan(intelligence, validationPack) {
  const plan = Array.isArray(intelligence && intelligence.validationPlan)
    ? intelligence.validationPlan
    : [];
  if (validationPack === "none") {
    return [];
  }
  if (!validationPack || validationPack === "auto") {
    return plan;
  }
  return plan.filter((step) => step.kind === validationPack);
}

async function runValidationPlan({
  intelligence,
  validationPack = "auto",
  fallbackCwd = "",
  failOnMissingPlan = false
}) {
  const plan = pickValidationPlan(intelligence, validationPack);
  if (!plan.length) {
    return {
      status: failOnMissingPlan ? "failed" : "skipped",
      steps: [],
      summary: failOnMissingPlan
        ? "Validation plan required for this scaffold but none was detected."
        : "No safe validation plan detected."
    };
  }

  const results = [];
  let failed = false;
  for (const step of plan) {
    const result = await runSafeCommand({
      label: step.label,
      command: step.command,
      args: Array.isArray(step.args) ? step.args : [],
      cwd: step.cwd || fallbackCwd
    });
    results.push({
      id: step.id,
      label: step.label,
      status: result.status,
      output: result.output,
      command: [step.command, ...(step.args || [])].join(" ")
    });
    if (result.status === "failed") {
      failed = true;
      break;
    }
  }

  return {
    status: failed ? "failed" : "passed",
    steps: results,
    summary: failed
      ? `Validation failed at ${results[results.length - 1].label}`
      : `Validation passed for ${results.length} step${results.length === 1 ? "" : "s"}`
  };
}

async function runSafeCommand({ label, command, args, cwd }) {
  const resolved = await which(command);
  if (!resolved) {
    return {
      status: "skipped",
      output: `${label}: command not available (${command})`
    };
  }
  try {
    const output = await execFileText(resolved, args, { cwd });
    return {
      status: "passed",
      output: clampText(output.trim(), 10000)
    };
  } catch (error) {
    return {
      status: "failed",
      output: clampText(error instanceof Error ? error.message : String(error), 10000)
    };
  }
}

async function openInVSWirksEditor(filePath, line, column) {
  const targetPath = path.resolve(filePath);
  const stat = await fs.stat(targetPath).catch(() => null);
  const isDirectory = Boolean(stat && stat.isDirectory());

  if (await exists(CODE_EDITOR_BIN)) {
    if (isDirectory) {
      await execFileText(CODE_EDITOR_BIN, ["--reuse-window", targetPath]).catch(() => "");
      return true;
    }
    const goto = line ? `${targetPath}:${line}:${column || 1}` : targetPath;
    await execFileText(CODE_EDITOR_BIN, ["--reuse-window", "--goto", goto]).catch(() => "");
    return true;
  }

  await execFileText("open", ["-a", "/Applications/VSCodium.app", targetPath]).catch(() => "");
  return true;
}

async function openPathsInVSWirksEditor(paths) {
  const list = Array.isArray(paths)
    ? paths.filter((item) => typeof item === "string" && item.trim())
    : [];
  for (const item of list) {
    await openInVSWirksEditor(item);
  }
  return true;
}

async function openDiffInVSWirksEditor(leftPath, rightPath, label = "VSWirks Diff") {
  const left = path.resolve(leftPath);
  const right = path.resolve(rightPath);
  if (await exists(CODE_EDITOR_BIN)) {
    await execFileText(CODE_EDITOR_BIN, ["--reuse-window", "--diff", left, right]).catch(() => "");
    return true;
  }
  await execFileText("open", ["-a", "/Applications/VSCodium.app", left]).catch(() => "");
  await execFileText("open", ["-a", "/Applications/VSCodium.app", right]).catch(() => "");
  return true;
}

async function exists(targetPath) {
  try {
    await fs.access(targetPath);
    return true;
  } catch {
    return false;
  }
}

async function which(program) {
  try {
    const output = await execFileText("which", [program]);
    return output.trim() || null;
  } catch {
    return null;
  }
}

function execFileText(command, args, options = {}) {
  return new Promise((resolve, reject) => {
    cp.execFile(
      command,
      args,
      {
        maxBuffer: 10 * 1024 * 1024,
        ...options
      },
      (error, stdout, stderr) => {
        if (error) {
          reject(new Error(stderr || error.message));
          return;
        }
        resolve(stdout);
      }
    );
  });
}

function execFileTextAllowExitCode(command, args, allowedExitCodes, options = {}) {
  return new Promise((resolve, reject) => {
    cp.execFile(
      command,
      args,
      {
        maxBuffer: 10 * 1024 * 1024,
        ...options
      },
      (error, stdout, stderr) => {
        if (!error) {
          resolve(stdout);
          return;
        }
        const code = typeof error.code === "number" ? error.code : null;
        if (code !== null && allowedExitCodes.includes(code)) {
          resolve(stdout || stderr || "");
          return;
        }
        reject(new Error(stderr || error.message));
      }
    );
  });
}

module.exports = {
  CODE_EDITOR_BIN,
  isPathWithin,
  resolveWorkspacePath,
  formatWorkspaceLabel,
  describeWorkspaceRoot,
  isSkippableWorkspaceRootEntry,
  listWorkspace,
  readWorkspaceFile,
  readWorkspaceFileIfExists,
  searchWorkspace,
  writeWorkspaceFile,
  computeWorkspaceDiff,
  computeUnifiedDiff,
  scanProjectIntelligence,
  pickValidationPlan,
  runValidationPlan,
  openInVSWirksEditor,
  openPathsInVSWirksEditor,
  openDiffInVSWirksEditor,
  exists,
  which,
  execFileText
};
