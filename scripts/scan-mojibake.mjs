import { readdirSync, readFileSync } from "node:fs";
import { extname, join, normalize, sep } from "node:path";

const TEXT_EXTENSIONS = new Set([
  ".css",
  ".html",
  ".js",
  ".json",
  ".jsx",
  ".md",
  ".mjs",
  ".sql",
  ".ts",
  ".tsx",
  ".txt",
  ".yml",
]);

const SKIP_PATH_PARTS = new Set([
  ".ccpanes",
  ".git",
  ".next",
  "data",
  "dist",
  "logs",
  "node_modules",
  "public/generated-images",
  "release-dir",
]);

const SKIP_FILES = new Set([
  "package-lock.json",
  normalize("scripts/scan-mojibake.mjs"),
]);

const MOJIBAKE_PATTERNS = [
  { label: "replacement character", pattern: /\uFFFD/ },
  { label: "UTF-8 read as Latin-1", pattern: /(?:Ã|Â|â€™|â€œ|â€|å|ä|æ|ç|è|é|ï¼|ã€)/ },
  { label: "UTF-8 Chinese read as GBK", pattern: /(?:浼佷笟|蹇呭～|淇℃伅|宸蹭|鏈|闇€|鍙戝竷|璁″垝|鏂囩珷|褰撳墠|浠诲姟|鍐呭|鎰忚|鍙嶉|鎻愪氦|闂|绫诲瀷|鑱旂郴|璇峰～|绋嶅悗|澶辫触|妗岄潰鐗)/ },
  { label: "full-width punctuation mojibake", pattern: /(?:銆|锛|紝|鈥|鈴|€\?|€\u009D|\u20AC)/ },
];

function listFiles() {
  const files = [];

  function walk(directory) {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const filePath = directory === "." ? entry.name : join(directory, entry.name);
      const normalized = normalize(filePath);
      const parts = normalized.split(sep);

      if (parts.some((part) => SKIP_PATH_PARTS.has(part))) {
        continue;
      }

      if (entry.isDirectory()) {
        walk(filePath);
      } else if (entry.isFile()) {
        files.push(filePath);
      }
    }
  }

  walk(".");
  return files;
}

function shouldScan(file) {
  const normalized = normalize(file);
  if (SKIP_FILES.has(normalized)) return false;
  if (!TEXT_EXTENSIONS.has(extname(normalized))) return false;

  const parts = normalized.split(sep);
  return !parts.some((part, index) => {
    if (SKIP_PATH_PARTS.has(part)) return true;
    const twoPartPath = parts.slice(index, index + 2).join("/");
    return SKIP_PATH_PARTS.has(twoPartPath);
  });
}

const findings = [];

for (const file of listFiles().filter(shouldScan)) {
  const content = readFileSync(file, "utf8");
  const lines = content.split(/\r?\n/);

  lines.forEach((line, index) => {
    for (const { label, pattern } of MOJIBAKE_PATTERNS) {
      if (pattern.test(line)) {
        findings.push({
          file,
          line: index + 1,
          label,
          text: line.trim().slice(0, 180),
        });
        break;
      }
    }
  });
}

if (findings.length > 0) {
  console.error(`Found ${findings.length} possible mojibake issue(s):`);
  for (const finding of findings) {
    console.error(`${finding.file}:${finding.line} [${finding.label}] ${finding.text}`);
  }
  process.exitCode = 1;
} else {
  console.log("No mojibake patterns found.");
}
