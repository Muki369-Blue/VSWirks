const fs = require("fs/promises");
const os = require("os");
const path = require("path");

const { clampText, makeId } = require("../../shared/core");
const { execFileText, which } = require("./workspace-tools.cjs");

const IMAGE_EXTENSIONS = new Set([
  ".png",
  ".jpg",
  ".jpeg",
  ".webp",
  ".gif",
  ".bmp",
  ".heic",
  ".heif",
  ".tif",
  ".tiff"
]);
const IMAGE_OCR_CHAR_LIMIT = 4000;

function isImagePath(filePath) {
  return IMAGE_EXTENSIONS.has(path.extname(String(filePath || "")).toLowerCase());
}

async function createImageAttachment(filePath, workspaceRoot) {
  const analyzed = await analyzeImageForPrompt(filePath);
  const label =
    workspaceRoot && filePath.startsWith(workspaceRoot)
      ? path.relative(workspaceRoot, filePath)
      : filePath;

  return {
    id: makeId("attachment"),
    kind: "image",
    label,
    sourcePath: filePath,
    mimeType: imageMimeTypeFromPath(filePath),
    content: `Attached image: ${label}\n${analyzed.block}`
  };
}

async function analyzeImageForPrompt(filePath) {
  const metadata = await readImageMetadata(filePath).catch(() => ({
    format: imageFormatFromPath(filePath),
    pixelWidth: 0,
    pixelHeight: 0
  }));
  const ocrText = await runTesseractOcr(filePath).catch(() => "");
  const lines = [summarizeImageMetadata(filePath, metadata)];

  if (ocrText) {
    lines.push(`Visible text extracted locally:\n\`\`\`\n${clampText(ocrText, IMAGE_OCR_CHAR_LIMIT)}\n\`\`\``);
  } else {
    lines.push("Visible text extracted locally: none");
  }

  lines.push(
    "Use this image analysis as a design reference. If some layout details are ambiguous, state the assumption briefly and continue with a clean, production-ready implementation."
  );

  return {
    mimeType: imageMimeTypeFromPath(filePath),
    metadata,
    ocrText,
    block: lines.join("\n")
  };
}

async function readImageMetadata(filePath) {
  const output = await execFileText("sips", [
    "-g",
    "format",
    "-g",
    "pixelWidth",
    "-g",
    "pixelHeight",
    filePath
  ]);
  const format = matchSipsValue(output, "format") || imageFormatFromPath(filePath);
  const pixelWidth = Number(matchSipsValue(output, "pixelWidth")) || 0;
  const pixelHeight = Number(matchSipsValue(output, "pixelHeight")) || 0;
  return { format, pixelWidth, pixelHeight };
}

function matchSipsValue(output, key) {
  const match = String(output || "").match(new RegExp(`${key}:\\s*(.+)$`, "m"));
  return match ? match[1].trim() : "";
}

async function runTesseractOcr(filePath) {
  const tesseractPath = await which("tesseract");
  if (!tesseractPath) {
    return "";
  }

  let output = await execFileText(tesseractPath, [filePath, "stdout", "--psm", "11"]).catch(
    () => ""
  );
  if (!normalizeOcrText(output)) {
    output = await runTesseractOcrOnStableCopy(tesseractPath, filePath);
  }
  return normalizeOcrText(output);
}

async function runTesseractOcrOnStableCopy(tesseractPath, filePath) {
  const fallbackDir = path.join(os.homedir(), "Library", "Caches", "vswirks-app");
  const fallbackPath = path.join(
    fallbackDir,
    `ocr-${Date.now()}-${Math.random().toString(16).slice(2, 8)}${path.extname(filePath) || ".png"}`
  );
  try {
    await fs.mkdir(fallbackDir, { recursive: true });
    await fs.copyFile(filePath, fallbackPath);
    return await execFileText(tesseractPath, [fallbackPath, "stdout", "--psm", "11"]).catch(
      () => ""
    );
  } finally {
    await fs.unlink(fallbackPath).catch(() => {});
  }
}

function normalizeOcrText(text) {
  return String(text || "")
    .replace(/\r/g, "")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function summarizeImageMetadata(filePath, metadata) {
  const parts = [`Image metadata: ${path.basename(filePath)}`];
  const format = metadata && metadata.format ? String(metadata.format).toUpperCase() : "unknown";
  parts.push(format);
  if (metadata && metadata.pixelWidth && metadata.pixelHeight) {
    parts.push(`${metadata.pixelWidth}x${metadata.pixelHeight}`);
  }
  return parts.join(" | ");
}

function imageFormatFromPath(filePath) {
  return path.extname(String(filePath || "")).replace(/^\./, "") || "unknown";
}

function imageMimeTypeFromPath(filePath) {
  const extension = path.extname(String(filePath || "")).toLowerCase();
  const byExtension = {
    ".png": "image/png",
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".webp": "image/webp",
    ".gif": "image/gif",
    ".bmp": "image/bmp",
    ".heic": "image/heic",
    ".heif": "image/heif",
    ".tif": "image/tiff",
    ".tiff": "image/tiff"
  };
  return byExtension[extension] || "application/octet-stream";
}

module.exports = {
  IMAGE_EXTENSIONS,
  isImagePath,
  createImageAttachment,
  analyzeImageForPrompt
};
