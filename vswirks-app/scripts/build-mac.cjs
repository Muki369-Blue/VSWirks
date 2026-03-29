const path = require("path");
const fs = require("fs/promises");
const { execFileSync } = require("child_process");
const { packager } = require("@electron/packager");

const pkg = require(path.join(__dirname, "..", "package.json"));

const appDir = path.resolve(__dirname, "..");
const workspaceRoot = path.resolve(appDir, "..");
const outDir = path.join(appDir, "dist");
const iconPath = path.join(appDir, "electron", "assets", "vswirks.icns");
const sharedSourcePath = path.join(workspaceRoot, "shared");

async function main() {
  const builtPaths = await packager({
    dir: appDir,
    name: "VSWirks",
    executableName: "VSWirks",
    platform: "darwin",
    arch: process.arch === "arm64" ? "arm64" : "x64",
    out: outDir,
    overwrite: true,
    icon: iconPath,
    appBundleId: "com.bluewirks.vswirks",
    appVersion: pkg.version,
    buildVersion: pkg.version,
    prune: false,
    quiet: true,
    ignore: [
      /^\/dist($|\/)/,
      /^\/\.git($|\/)/,
      /^\/\.DS_Store$/
    ]
  });

  for (const builtPath of builtPaths) {
    await finalizeMacBundle(builtPath);
    console.log(builtPath);
  }
}

async function finalizeMacBundle(builtPath) {
  const appPath = path.join(builtPath, "VSWirks.app");
  const contentsPath = path.join(appPath, "Contents");
  const infoPlistPath = path.join(contentsPath, "Info.plist");
  const resourcesPath = path.join(contentsPath, "Resources");
  const sourceIconPath = path.join(resourcesPath, "electron.icns");
  const targetIconPath = path.join(resourcesPath, "VSWirks.icns");
  const sharedTargetPath = path.join(resourcesPath, "shared");

  try {
    await fs.rm(targetIconPath, { force: true });
    await fs.rename(sourceIconPath, targetIconPath);
  } catch (error) {
    if (error && error.code !== "ENOENT") {
      throw error;
    }
  }

  await fs.rm(sharedTargetPath, { recursive: true, force: true });
  await fs.cp(sharedSourcePath, sharedTargetPath, {
    recursive: true,
    filter(sourcePath) {
      const name = path.basename(sourcePath);
      return name !== ".DS_Store" && !name.includes(".bak.");
    }
  });

  execFileSync("plutil", ["-replace", "CFBundleIconFile", "-string", "VSWirks", infoPlistPath]);
  execFileSync("plutil", ["-replace", "CFBundleIconName", "-string", "VSWirks", infoPlistPath]);
  execFileSync("plutil", ["-replace", "LSMinimumSystemVersion", "-string", "12.0", infoPlistPath]);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
