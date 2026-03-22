const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");

const {
  listWorkspace,
  searchWorkspace,
  computeUnifiedDiff,
  scanProjectIntelligence,
  pickValidationPlan,
  runValidationPlan,
  which
} = require("../electron/workspace-tools.cjs");

test("computeUnifiedDiff returns a unified diff with the workspace path", async () => {
  const diff = await computeUnifiedDiff({
    relativePath: "src/app.js",
    previousContent: "const value = 1;\n",
    nextContent: "const value = 2;\n"
  });

  assert.match(diff, /diff --git a\/src\/app\.js b\/src\/app\.js/);
  assert.match(diff, /\+\+\+ b\/src\/app\.js/);
});

test("listWorkspace ignores backup artifacts and dependency trees", async () => {
  const tmpRoot = await fs.mkdtemp(path.join(os.tmpdir(), "vswirks-list-"));
  try {
    await fs.mkdir(path.join(tmpRoot, "src"), { recursive: true });
    await fs.mkdir(path.join(tmpRoot, "node_modules", "demo"), { recursive: true });
    await fs.mkdir(path.join(tmpRoot, ".venv"), { recursive: true });
    await fs.writeFile(path.join(tmpRoot, "src", "app.js"), "console.log('ok');\n", "utf8");
    await fs.writeFile(
      path.join(tmpRoot, "src", "app.js.bak.20260320-000000"),
      "console.log('stale');\n",
      "utf8"
    );
    await fs.writeFile(path.join(tmpRoot, "node_modules", "demo", "index.js"), "needle\n", "utf8");
    await fs.writeFile(path.join(tmpRoot, ".venv", "pyvenv.cfg"), "home = /tmp\n", "utf8");
    await fs.writeFile(path.join(tmpRoot, ".DS_Store"), "noise", "utf8");

    const entries = await listWorkspace({
      workspaceRoot: tmpRoot,
      relativePath: ".",
      maxEntries: 50
    });

    assert.ok(entries.includes("src"));
    assert.ok(entries.includes(path.join("src", "app.js")));
    assert.ok(!entries.some((entry) => entry.includes(".bak.")));
    assert.ok(!entries.some((entry) => entry.includes("node_modules")));
    assert.ok(!entries.some((entry) => entry.includes(".venv")));
    assert.ok(!entries.some((entry) => entry.includes(".DS_Store")));
  } finally {
    await fs.rm(tmpRoot, { recursive: true, force: true });
  }
});

test("searchWorkspace ignores backup artifacts when ripgrep is available", async () => {
  const rgPath = await which("rg");
  if (!rgPath) {
    return;
  }

  const tmpRoot = await fs.mkdtemp(path.join(os.tmpdir(), "vswirks-search-rg-"));
  try {
    await fs.mkdir(path.join(tmpRoot, "src"), { recursive: true });
    await fs.mkdir(path.join(tmpRoot, "node_modules", "demo"), { recursive: true });
    await fs.writeFile(path.join(tmpRoot, "src", "app.js"), "const needle = true;\n", "utf8");
    await fs.writeFile(
      path.join(tmpRoot, "src", "app.js.bak.20260320-000000"),
      "const needle = 'stale';\n",
      "utf8"
    );
    await fs.writeFile(
      path.join(tmpRoot, "node_modules", "demo", "index.js"),
      "const needle = 'dependency';\n",
      "utf8"
    );

    const matches = await searchWorkspace({
      workspaceRoot: tmpRoot,
      pattern: "needle",
      maxResults: 20
    });

    assert.ok(matches.some((entry) => entry.includes(path.join("src", "app.js"))));
    assert.ok(!matches.some((entry) => entry.includes(".bak.")));
    assert.ok(!matches.some((entry) => entry.includes("node_modules")));
  } finally {
    await fs.rm(tmpRoot, { recursive: true, force: true });
  }
});

test("searchWorkspace ignores backup artifacts in fallback mode", async () => {
  const originalPath = process.env.PATH;
  process.env.PATH = "/usr/bin:/bin";

  const tmpRoot = await fs.mkdtemp(path.join(os.tmpdir(), "vswirks-search-fallback-"));
  try {
    if (await which("rg")) {
      return;
    }

    await fs.mkdir(path.join(tmpRoot, "src"), { recursive: true });
    await fs.mkdir(path.join(tmpRoot, "dist"), { recursive: true });
    await fs.writeFile(path.join(tmpRoot, "src", "app.js"), "const needle = true;\n", "utf8");
    await fs.writeFile(
      path.join(tmpRoot, "src", "app.js.bak.20260320-000000"),
      "const needle = 'stale';\n",
      "utf8"
    );
    await fs.writeFile(path.join(tmpRoot, "dist", "bundle.js"), "const needle = 'build';\n", "utf8");

    const matches = await searchWorkspace({
      workspaceRoot: tmpRoot,
      pattern: "needle",
      maxResults: 20
    });

    assert.deepEqual(matches, ["src/app.js:1:const needle = true;"]);
  } finally {
    process.env.PATH = originalPath;
    await fs.rm(tmpRoot, { recursive: true, force: true });
  }
});

test("scanProjectIntelligence detects node frameworks and validation steps", async () => {
  const tmpRoot = await fs.mkdtemp(path.join(os.tmpdir(), "vswirks-intel-"));
  try {
    await fs.writeFile(
      path.join(tmpRoot, "package.json"),
      JSON.stringify(
        {
          name: "demo",
          scripts: {
            test: "vitest",
            build: "vite build"
          },
          dependencies: {
            react: "^19.0.0"
          },
          devDependencies: {
            vite: "^5.0.0",
            tailwindcss: "^4.0.0"
          }
        },
        null,
        2
      ),
      "utf8"
    );
    await fs.mkdir(path.join(tmpRoot, "src"), { recursive: true });
    await fs.writeFile(path.join(tmpRoot, "src", "main.tsx"), "export {};\n", "utf8");
    await fs.mkdir(path.join(tmpRoot, "tests"), { recursive: true });

    const intelligence = await scanProjectIntelligence({
      workspaceRoot: tmpRoot,
      targetPath: tmpRoot
    });

    assert.ok(intelligence.frameworks.includes("React"));
    assert.ok(intelligence.frameworks.includes("Vite"));
    assert.ok(intelligence.frameworks.includes("Tailwind CSS"));
    assert.ok(intelligence.entrypoints.includes("src/main.tsx"));
    assert.ok(intelligence.testPaths.includes("tests"));
    assert.ok(pickValidationPlan(intelligence, "auto").length >= 2);
  } finally {
    await fs.rm(tmpRoot, { recursive: true, force: true });
  }
});

test("scanProjectIntelligence derives Python validation from requirements and tests", async () => {
  const tmpRoot = await fs.mkdtemp(path.join(os.tmpdir(), "vswirks-python-intel-"));
  try {
    await fs.writeFile(path.join(tmpRoot, "requirements.txt"), "PyQt5==5.15.6\n", "utf8");
    await fs.writeFile(path.join(tmpRoot, "main.py"), "print('ok')\n", "utf8");
    await fs.mkdir(path.join(tmpRoot, "tests"), { recursive: true });
    await fs.writeFile(
      path.join(tmpRoot, "tests", "test_smoke.py"),
      "import unittest\n\nclass Smoke(unittest.TestCase):\n    def test_ok(self):\n        self.assertTrue(True)\n",
      "utf8"
    );

    const intelligence = await scanProjectIntelligence({
      workspaceRoot: tmpRoot,
      targetPath: tmpRoot
    });

    assert.ok(intelligence.manifests.includes("requirements.txt"));
    assert.ok(intelligence.entrypoints.includes("main.py"));
    assert.ok(intelligence.testPaths.includes("tests"));
    assert.ok(
      pickValidationPlan(intelligence, "auto").some((step) => step.label === "python3 -m compileall .")
    );
    assert.ok(
      pickValidationPlan(intelligence, "auto").some(
        (step) => step.label === "python3 -m unittest discover tests"
      )
    );
  } finally {
    await fs.rm(tmpRoot, { recursive: true, force: true });
  }
});

test("scanProjectIntelligence uses uv extras for pytest when pyproject defines test extras", async () => {
  const tmpRoot = await fs.mkdtemp(path.join(os.tmpdir(), "vswirks-python-extra-intel-"));
  try {
    await fs.writeFile(
      path.join(tmpRoot, "pyproject.toml"),
      [
        "[project]",
        'name = "demo"',
        'version = "0.1.0"',
        'dependencies = []',
        "",
        "[project.optional-dependencies]",
        'test = ["pytest>=8"]',
        'dev = ["ruff>=0.5"]',
        ""
      ].join("\n"),
      "utf8"
    );

    const intelligence = await scanProjectIntelligence({
      workspaceRoot: tmpRoot,
      targetPath: tmpRoot
    });
    const plan = pickValidationPlan(intelligence, "auto");

    assert.ok(
      plan.some((step) => step.label === "uv run --extra test pytest"),
      "expected pytest validation to install the test extra"
    );
  } finally {
    await fs.rm(tmpRoot, { recursive: true, force: true });
  }
});

test("runValidationPlan fails closed when a scaffold requires validation but no plan exists", async () => {
  const result = await runValidationPlan({
    intelligence: {
      validationPlan: []
    },
    validationPack: "auto",
    failOnMissingPlan: true
  });

  assert.equal(result.status, "failed");
  assert.match(result.summary, /Validation plan required/);
});
