const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");

const {
  buildWorkspaceSystemPrompt,
  buildDeterministicBootstrapManifest,
  evaluateRepoMaterializationManifest,
  evaluatePhaseMaterializationManifest,
  extractPseudoToolCallsFromAssistantContent,
  findMissingPhaseWriteRequirements,
  parseScaffoldExecutionPlan,
  normalizeScaffoldExecutionPlan,
  scaffoldPhaseOwnsPath,
  stabilizeBootstrapManifest,
  isPhaseContractStallStep,
  isPhaseWorkspaceContractSatisfied,
  shouldAttemptBootstrapMaterializationRecovery,
  shouldAttemptBootstrapMissingRequirementsRecovery,
  shouldAttemptPhaseContractRecovery
} = require("../electron/runner.cjs");

test("extractPseudoToolCallsFromAssistantContent recovers inline tool call markup", () => {
  const toolCalls = extractPseudoToolCallsFromAssistantContent(
    [],
    [
      "I will write the CLI now.",
      "<tool_call>",
      JSON.stringify({
        name: "write_file",
        arguments: {
          path: "splitwirks21/cli.py",
          content: "print('ok')\n",
          reason: "Add CLI entrypoint"
        }
      }),
      "</tool_call>"
    ].join("\n"),
    [
      {
        function: {
          name: "write_file"
        }
      }
    ]
  );

  assert.equal(toolCalls.length, 1);
  assert.equal(toolCalls[0].function.name, "write_file");
  assert.deepEqual(JSON.parse(toolCalls[0].function.arguments), {
    path: "splitwirks21/cli.py",
    content: "print('ok')\n",
    reason: "Add CLI entrypoint"
  });
});

test("extractPseudoToolCallsFromAssistantContent ignores unknown or malformed markup", () => {
  const toolCalls = extractPseudoToolCallsFromAssistantContent(
    [],
    [
      "<tool_call>{\"name\":\"delete_everything\",\"arguments\":{}}</tool_call>",
      "<tool_call>not-json</tool_call>"
    ].join("\n"),
    [
      {
        function: {
          name: "write_file"
        }
      }
    ]
  );

  assert.deepEqual(toolCalls, []);
});

test("evaluateRepoMaterializationManifest rejects placeholder repo scaffolds", () => {
  const result = evaluateRepoMaterializationManifest({
    files: [
      {
        path: "README.md",
        content: "# Demo\n\nRun python main.py\n"
      },
      {
        path: "requirements.txt",
        content: "PyQt5==5.15.6\n"
      },
      {
        path: "main.py",
        content: "# Placeholder for stem splitting logic\nprint('demo')\n"
      },
      {
        path: "tests/test_main.py",
        content: "# Placeholder for actual file dialog test logic\n"
      }
    ]
  });

  assert.equal(result.ok, false);
  assert.match(result.issues.join("\n"), /Placeholder or stub markers detected/);
});

test("evaluateRepoMaterializationManifest accepts a minimally complete scaffold", () => {
  const result = evaluateRepoMaterializationManifest({
    files: [
      {
        path: "README.md",
        content: "# App\n\n## Run\npython3 main.py\n"
      },
      {
        path: "requirements.txt",
        content: "PyQt5==5.15.6\n"
      },
      {
        path: "main.py",
        content: "def main():\n    return 0\n\nif __name__ == '__main__':\n    raise SystemExit(main())\n"
      },
      {
        path: "tests/test_main.py",
        content: "def test_main():\n    assert True\n"
      }
    ]
  });

  assert.equal(result.ok, true);
  assert.deepEqual(result.issues, []);
});

test("evaluateRepoMaterializationManifest counts existing workspace files", () => {
  const result = evaluateRepoMaterializationManifest(
    {
      files: [
        {
          path: "README.md",
          content: "# App\n\n## Run\npython3 main.py\n"
        },
        {
          path: "main.py",
          content:
            "def main():\n    return 0\n\nif __name__ == '__main__':\n    raise SystemExit(main())\n"
        },
        {
          path: "tests/test_main.py",
          content: "def test_main():\n    assert True\n"
        }
      ]
    },
    {
      existingPaths: ["pyproject.toml"]
    }
  );

  assert.equal(result.ok, true);
  assert.deepEqual(result.issues, []);
});

test("normalizeScaffoldExecutionPlan falls back to the default staged scaffold plan", () => {
  const result = normalizeScaffoldExecutionPlan(null);

  assert.equal(result.phases.length, 5);
  assert.equal(result.phases[0].id, "bootstrap");
  assert.equal(result.phases[1].id, "backend");
  assert.equal(result.phases[2].id, "middleware");
  assert.equal(result.phases[3].id, "frontend");
});

test("normalizeScaffoldExecutionPlan falls back when a model returns too few phases", () => {
  const result = normalizeScaffoldExecutionPlan({
    summary: "Bad short plan",
    phases: [
      {
        id: "bootstrap",
        label: "Bootstrap",
        goal: "Only one phase"
      }
    ]
  });

  assert.equal(result.phases.length, 5);
  assert.equal(result.phases[0].id, "bootstrap");
  assert.equal(result.phases[1].id, "backend");
});

test("parseScaffoldExecutionPlan merges bootstrap defaults into a model-authored plan", () => {
  const result = parseScaffoldExecutionPlan(
    JSON.stringify({
      summary: "Custom staged scaffold",
      phases: [
        {
          id: "bootstrap",
          label: "Architecture & Bootstrap",
          goal: "Set up the repo",
          ownership: ["requirements.txt"],
          required_outputs: ["dependencies"],
          must_write: true,
          allow_materialization: true,
          max_steps: 3
        },
        {
          id: "backend",
          label: "Backend",
          goal: "Ship the service layer",
          ownership: ["server/**", "tests/**"],
          required_outputs: ["service", "tests"],
          must_write: true,
          allow_materialization: false,
          max_steps: 7
        },
        {
          id: "middleware",
          label: "Middleware",
          goal: "Wire backend and UI",
          ownership: ["api/**"],
          required_outputs: ["routing"],
          must_write: true,
          allow_materialization: false,
          max_steps: 4
        },
        {
          id: "frontend",
          label: "Frontend",
          goal: "Build the UI",
          ownership: ["static/**"],
          required_outputs: ["ui"],
          must_write: true,
          allow_materialization: false,
          max_steps: 4
        }
      ]
    })
  );

  assert.equal(result.summary, "Custom staged scaffold");
  assert.equal(result.phases.length, 4);
  assert.equal(result.phases[0].id, "bootstrap");
  assert.ok(result.phases[0].ownership.includes("requirements.txt"));
  assert.ok(result.phases[0].ownership.includes("README.md"));
  assert.equal(result.phases[0].maxSteps, 6);
  assert.ok(Array.isArray(result.phases[0].requiredPathGroups));
  assert.ok(result.phases[0].requiredPathGroups.length >= 3);
  assert.equal(result.phases[1].id, "backend");
  assert.ok(result.phases[1].ownership.includes("server/**"));
  assert.ok(result.phases[1].ownership.includes("main.py"));
  assert.equal(result.phases[1].maxSteps, 8);
});

test("evaluatePhaseMaterializationManifest enforces bootstrap foundations", () => {
  const bootstrap = normalizeScaffoldExecutionPlan(null).phases[0];
  const passing = evaluatePhaseMaterializationManifest(bootstrap, [
    {
      path: "README.md",
      content: "# SplitWirks2.1\n\n## Run\npython3 main.py\n"
    },
    {
      path: "requirements.txt",
      content: "fastapi==0.109.0\n"
    },
    {
      path: "main.py",
      content: "def main():\n    return 0\n\nif __name__ == '__main__':\n    raise SystemExit(main())\n"
    }
  ]);
  const failing = evaluatePhaseMaterializationManifest(bootstrap, [
    {
      path: "requirements.txt",
      content: "fastapi==0.109.0\n"
    },
    {
      path: ".gitignore",
      content: "__pycache__/\n"
    }
  ]);

  assert.equal(passing.ok, true);
  assert.deepEqual(passing.issues, []);
  assert.equal(failing.ok, false);
  assert.match(failing.issues.join("\n"), /README\.md/);
  assert.match(failing.issues.join("\n"), /src\/\*\* or app\/\*\*|main\.py/);
});

test("evaluatePhaseMaterializationManifest rejects invalid structured manifests", () => {
  const bootstrap = normalizeScaffoldExecutionPlan(null).phases[0];
  const result = evaluatePhaseMaterializationManifest(bootstrap, [
    {
      path: "README.md",
      content: "# SplitWirks2.1\n"
    },
    {
      path: "pyproject.toml",
      content: "[project]\nname = \"bad\"\ninclude = \\'\\\\.pyi?$\\'\n"
    },
    {
      path: "src/main.py",
      content:
        "def main():\n    return 0\n\nif __name__ == '__main__':\n    raise SystemExit(main())\n"
    }
  ]);

  assert.equal(result.ok, false);
  assert.match(result.issues.join("\n"), /Invalid pyproject\.toml/);
});

test("buildDeterministicBootstrapManifest creates a concrete Python bootstrap fallback", () => {
  const bootstrap = normalizeScaffoldExecutionPlan(null).phases[0];
  const manifest = buildDeterministicBootstrapManifest({
    rootUserContent:
      "Create a production-ready local-first offline repository named stem-splitterV3.2 with Python 3.11 and FastAPI.",
    assistantContent: "",
    existingPaths: [],
    invalidManifestIssues: []
  });
  const quality = evaluatePhaseMaterializationManifest(bootstrap, manifest.files);

  assert.ok(manifest.files.some((entry) => entry.path === "README.md"));
  assert.ok(manifest.files.some((entry) => entry.path === "requirements.txt"));
  assert.ok(manifest.files.some((entry) => entry.path === "main.py"));
  assert.ok(manifest.files.some((entry) => entry.path === "tests/test_main.py"));
  assert.equal(quality.ok, true);
});

test("stabilizeBootstrapManifest fills missing bootstrap source files", () => {
  const bootstrap = normalizeScaffoldExecutionPlan(null).phases[0];
  const manifest = stabilizeBootstrapManifest({
    manifest: {
      summary: "Partial bootstrap",
      files: [
        {
          path: "README.md",
          content: "# Stem Splitter\n"
        },
        {
          path: "requirements.txt",
          content: "fastapi>=0.115,<1.0\n"
        }
      ],
      open: []
    },
    rootUserContent:
      "Create a production-ready local-first offline repository named stem-splitterV3.2 with Python 3.11 and FastAPI.",
    assistantContent: "",
    existingPaths: [],
    invalidManifestIssues: []
  });
  const quality = evaluatePhaseMaterializationManifest(bootstrap, manifest.files);

  assert.ok(manifest.files.some((entry) => entry.path === "main.py"));
  assert.ok(manifest.files.some((entry) => entry.path === "tests/test_main.py"));
  assert.equal(quality.ok, true);
});

test("stabilizeBootstrapManifest rewrites invalid bootstrap pyproject files", () => {
  const bootstrap = normalizeScaffoldExecutionPlan(null).phases[0];
  const manifest = stabilizeBootstrapManifest({
    manifest: {
      summary: "",
      files: [],
      open: []
    },
    rootUserContent:
      "Create a production-ready local-first offline repository named stem-splitterV3.2 with Python 3.11 and FastAPI.",
    assistantContent: "",
    existingPaths: ["README.md", "pyproject.toml"],
    invalidManifestIssues: ["Invalid pyproject.toml: Expected '=' after a key in a key/value pair"]
  });
  const quality = evaluatePhaseMaterializationManifest(bootstrap, manifest.files, ["README.md"]);

  assert.ok(manifest.files.some((entry) => entry.path === "pyproject.toml"));
  assert.ok(manifest.files.some((entry) => entry.path === "main.py"));
  assert.equal(quality.ok, true);
});

test("stabilizeBootstrapManifest strips nested repo prefixes and replaces placeholder bootstrap files", () => {
  const bootstrap = normalizeScaffoldExecutionPlan(null).phases[0];
  const manifest = stabilizeBootstrapManifest({
    manifest: {
      summary: "",
      files: [
        {
          path: "stem_splitterV3.2/main.py",
          content: "# Placeholder for stem splitting logic\nprint('demo')\n"
        }
      ],
      open: []
    },
    rootUserContent:
      "Create a production-ready local-first offline repository named stem-splitterV3.2 with Python 3.11 and FastAPI.",
    assistantContent: "",
    existingPaths: [],
    invalidManifestIssues: []
  });
  const quality = evaluatePhaseMaterializationManifest(bootstrap, manifest.files);
  const main = manifest.files.find((entry) => entry.path === "main.py");

  assert.ok(main);
  assert.doesNotMatch(main.content, /placeholder/i);
  assert.equal(quality.ok, true);
});

test("findMissingPhaseWriteRequirements enforces backend source and test writes", () => {
  const backend = normalizeScaffoldExecutionPlan(null).phases[1];

  assert.equal(findMissingPhaseWriteRequirements(backend, []).length, 3);
  assert.deepEqual(
    findMissingPhaseWriteRequirements(backend, ["src/backend/service.py"]),
    [backend.requiredWritePathGroups[1], backend.requiredWritePathGroups[2]]
  );
  assert.deepEqual(
    findMissingPhaseWriteRequirements(backend, [
      "src/backend/service.py",
      "src/stem_splitter/main.py"
    ]),
    [backend.requiredWritePathGroups[2]]
  );
  assert.deepEqual(
    findMissingPhaseWriteRequirements(backend, [
      "src/backend/service.py",
      "src/stem_splitter/main.py",
      "tests/test_service.py"
    ]),
    []
  );
});

test("buildWorkspaceSystemPrompt layers global, agent, thread, workflow, spec, and intelligence context", async () => {
  const tmpRoot = await fs.mkdtemp(path.join(os.tmpdir(), "vswirks-runner-prompt-"));
  await fs.mkdir(path.join(tmpRoot, ".github"), { recursive: true });
  await fs.writeFile(
    path.join(tmpRoot, ".github", "copilot-instructions.md"),
    "Respect repo conventions.",
    "utf8"
  );

  try {
    const prompt = await buildWorkspaceSystemPrompt(tmpRoot, {
      globalSystemPrompt: "Global guidance",
      agentProfile: {
        id: "review-analyst",
        label: "Review Analyst",
        systemPrompt: "Agent profile guidance"
      },
      threadSystemPrompt: "Thread guidance",
      workflowPreset: {
        label: "Review Repo",
        description: "Audit the workspace",
        completionContract: "Report findings first"
      },
      specDraft: {
        raw: "# Spec\n\nAudit the repository"
      },
      intelligence: {
        summary: "Frameworks: Electron, FastAPI"
      }
    });

    assert.match(prompt, /Workspace instructions:\nRespect repo conventions\./);
    assert.match(prompt, /Global system prompt:\nGlobal guidance/);
    assert.match(prompt, /Agent profile \(Review Analyst\):\nAgent profile guidance/);
    assert.match(prompt, /Thread override prompt:\nThread guidance/);
    assert.match(prompt, /Workflow preset: Review Repo/);
    assert.match(prompt, /Active spec draft:\n# Spec/);
    assert.match(prompt, /Project intelligence:\nFrameworks: Electron, FastAPI/);
  } finally {
    await fs.rm(tmpRoot, { recursive: true, force: true });
  }
});

test("evaluatePhaseMaterializationManifest requires backend recovery manifests to write code and tests", () => {
  const backend = normalizeScaffoldExecutionPlan(null).phases[1];
  const failing = evaluatePhaseMaterializationManifest(
    backend,
    [
      {
        path: "tests/test_service.py",
        content: "def test_service():\n    assert True\n"
      }
    ],
    ["README.md", "requirements.txt", "main.py"]
  );
  const passing = evaluatePhaseMaterializationManifest(
    backend,
    [
      {
        path: "src/backend/service.py",
        content: "def split_audio(job):\n    return {'job': job}\n"
      },
      {
        path: "src/main.py",
        content:
          "def main():\n    return 0\n\nif __name__ == '__main__':\n    raise SystemExit(main())\n"
      },
      {
        path: "tests/test_service.py",
        content: "def test_service():\n    assert True\n"
      }
    ],
    ["README.md", "requirements.txt", "main.py"]
  );

  assert.equal(failing.ok, false);
  assert.match(failing.issues.join("\n"), /Missing required phase write group/);
  assert.equal(passing.ok, true);
  assert.deepEqual(passing.issues, []);
});

test("isPhaseWorkspaceContractSatisfied returns true once backend writes source, entrypoint, and tests", () => {
  const backend = normalizeScaffoldExecutionPlan(null).phases[1];
  const changedFiles = [
    "src/stem_splitter/core/separator.py",
    "src/stem_splitter/main.py",
    "tests/core/test_separator.py"
  ];
  const ownedWrites = changedFiles.filter((item) => scaffoldPhaseOwnsPath(backend, item));

  assert.equal(
    isPhaseWorkspaceContractSatisfied({
      phase: backend,
      changedFiles,
      ownedWrites,
      missingRequirements: [],
      missingWriteRequirements: [],
      invalidManifestIssues: []
    }),
    true
  );
  assert.equal(
    isPhaseWorkspaceContractSatisfied({
      phase: backend,
      changedFiles,
      ownedWrites,
      missingRequirements: [],
      missingWriteRequirements: [backend.requiredWritePathGroups[2]],
      invalidManifestIssues: []
    }),
    false
  );
});

test("isPhaseContractStallStep flags repeated rewrites when contract gaps remain", () => {
  assert.equal(
    isPhaseContractStallStep({
      stepTouchedPaths: ["src/stem_splitter/__init__.py"],
      changedFiles: ["src/stem_splitter/__init__.py"],
      previousChangedFileCount: 1,
      missingRequirements: [],
      missingWriteRequirements: [["src/**/main.*"], ["tests/**"]],
      invalidManifestIssues: []
    }),
    true
  );
  assert.equal(
    isPhaseContractStallStep({
      stepTouchedPaths: ["src/stem_splitter/main.py"],
      changedFiles: ["src/stem_splitter/__init__.py", "src/stem_splitter/main.py"],
      previousChangedFileCount: 1,
      missingRequirements: [],
      missingWriteRequirements: [["tests/**"]],
      invalidManifestIssues: []
    }),
    false
  );
  assert.equal(
    isPhaseContractStallStep({
      stepTouchedPaths: ["src/stem_splitter/main.py"],
      changedFiles: ["src/stem_splitter/main.py"],
      previousChangedFileCount: 1,
      missingRequirements: [],
      missingWriteRequirements: [],
      invalidManifestIssues: []
    }),
    false
  );
});

test("scaffoldPhaseOwnsPath matches simple owned globs", () => {
  const phase = {
    ownership: ["server/**", "tests/**", "README.md"]
  };

  assert.equal(scaffoldPhaseOwnsPath(phase, "server/app/main.py"), true);
  assert.equal(scaffoldPhaseOwnsPath(phase, "tests/test_app.py"), true);
  assert.equal(scaffoldPhaseOwnsPath(phase, "README.md"), true);
  assert.equal(scaffoldPhaseOwnsPath(phase, "src/index.js"), false);
});

test("shouldAttemptBootstrapMissingRequirementsRecovery only triggers for bootstrap gaps after writes", () => {
  const plan = normalizeScaffoldExecutionPlan(null);
  const bootstrap = plan.phases[0];
  const backend = plan.phases[1];

  assert.equal(
    shouldAttemptBootstrapMissingRequirementsRecovery({
      phase: bootstrap,
      missingRequirements: [["README.md"]],
      changedFiles: ["pyproject.toml"],
      invalidManifestIssues: []
    }),
    true
  );
  assert.equal(
    shouldAttemptBootstrapMissingRequirementsRecovery({
      phase: bootstrap,
      missingRequirements: [],
      changedFiles: ["pyproject.toml"],
      invalidManifestIssues: ["Invalid pyproject.toml"]
    }),
    true
  );
  assert.equal(
    shouldAttemptBootstrapMissingRequirementsRecovery({
      phase: bootstrap,
      missingRequirements: [],
      changedFiles: ["pyproject.toml"],
      invalidManifestIssues: []
    }),
    false
  );
  assert.equal(
    shouldAttemptBootstrapMissingRequirementsRecovery({
      phase: bootstrap,
      missingRequirements: [["README.md"]],
      changedFiles: [],
      invalidManifestIssues: []
    }),
    false
  );
  assert.equal(
    shouldAttemptBootstrapMissingRequirementsRecovery({
      phase: backend,
      missingRequirements: [["tests/**"]],
      changedFiles: ["server/main.py"],
      invalidManifestIssues: []
    }),
    false
  );
});

test("shouldAttemptBootstrapMaterializationRecovery retries bootstrap for empty or incomplete manifests", () => {
  const bootstrap = normalizeScaffoldExecutionPlan(null).phases[0];

  assert.equal(
    shouldAttemptBootstrapMaterializationRecovery({
      phase: bootstrap,
      materialized: {
        applied: false,
        code: "empty_manifest"
      }
    }),
    true
  );
  assert.equal(
    shouldAttemptBootstrapMaterializationRecovery({
      phase: bootstrap,
      materialized: {
        applied: false,
        code: "quality_reject"
      }
    }),
    true
  );
  assert.equal(
    shouldAttemptBootstrapMaterializationRecovery({
      phase: bootstrap,
      materialized: {
        applied: false,
        code: "not_applicable"
      }
    }),
    false
  );
  assert.equal(
    shouldAttemptBootstrapMaterializationRecovery({
      phase: {
        id: "backend"
      },
      materialized: {
        applied: false,
        code: "quality_reject"
      }
    }),
    false
  );
});

test("shouldAttemptPhaseContractRecovery triggers for stalled backend phases", () => {
  const plan = normalizeScaffoldExecutionPlan(null);
  const bootstrap = plan.phases[0];
  const backend = plan.phases[1];

  assert.equal(
    shouldAttemptPhaseContractRecovery({
      phase: bootstrap,
      changedFiles: [],
      ownedWrites: [],
      missingRequirements: [],
      missingWriteRequirements: [],
      invalidManifestIssues: []
    }),
    false
  );
  assert.equal(
    shouldAttemptPhaseContractRecovery({
      phase: backend,
      changedFiles: [],
      ownedWrites: [],
      missingRequirements: [],
      missingWriteRequirements: findMissingPhaseWriteRequirements(backend, []),
      invalidManifestIssues: []
    }),
    true
  );
  assert.equal(
    shouldAttemptPhaseContractRecovery({
      phase: backend,
      changedFiles: ["src/backend/service.py", "tests/test_service.py"],
      ownedWrites: ["src/backend/service.py", "tests/test_service.py"],
      missingRequirements: [],
      missingWriteRequirements: [],
      invalidManifestIssues: []
    }),
    false
  );
});
