import { readdir, stat, readFile, realpath } from "node:fs/promises";
import { join, extname, basename, resolve } from "node:path";
import { homedir } from "node:os";
import { z } from "zod";
import { createWorker, type Worker as TesseractWorker } from "tesseract.js";
import type { Connector, ContentItem, ContentType, IndexOptions } from "@trove/shared";

const LocalConfigSchema = z.object({
  paths: z.array(z.string()).min(1),
  extensions: z
    .array(z.string())
    .default([".md", ".ts", ".js", ".py", ".rs", ".go", ".png", ".jpg", ".jpeg", ".gif", ".mp4", ".webm", ".pdf", ".bpmn"]),
  ignore: z
    .array(z.string())
    .default(["node_modules", ".git", "dist", "target", "__pycache__", ".next", "build"]),
  max_depth: z.number().min(1).max(20).default(5),
  /** Enable OCR text extraction for image files (default: true) */
  ocr: z.boolean().default(false),
});

const IMAGE_EXTS = new Set([".png", ".jpg", ".jpeg", ".gif", ".webp", ".svg", ".bmp"]);
const VIDEO_EXTS = new Set([".mp4", ".webm", ".mov", ".avi", ".mkv"]);
const DOC_EXTS = new Set([".pdf", ".docx", ".xlsx", ".pptx"]);

/**
 * Files that MUST NEVER be indexed — contain credentials, keys, or sensitive data.
 * Matched against both filename and extension.
 */
const SENSITIVE_EXTS = new Set([
  ".pem", ".key", ".p12", ".pfx", ".jks", ".keystore",
  ".kdbx", ".kdb",         // password managers
  ".wallet", ".dat",       // crypto wallets (wallet.dat)
  ".gpg", ".pgp", ".asc",  // encrypted / signed files
  ".ovpn",                  // VPN configs with embedded keys
]);

const SENSITIVE_FILENAMES = new Set([
  ".env", ".env.local", ".env.production", ".env.development", ".env.staging",
  ".env.test", ".env.prod", ".env.dev",
  "credentials", "credentials.json", "credentials.yml",
  "secrets.json", "secrets.yml", "secrets.yaml",
  ".netrc", ".npmrc", ".pypirc",
  "id_rsa", "id_ed25519", "id_ecdsa", "id_dsa",
  "known_hosts", "authorized_keys",
  "htpasswd", ".htpasswd",
  "shadow", "passwd",
  "master.key", "production.key",
  "token.json", "tokens.json",
  "service-account.json", "service_account.json",
  "keyfile.json",
]);

const SENSITIVE_PATTERNS = [
  /^\.env(\..+)?$/,           // .env, .env.anything
  /^id_(rsa|ed25519|ecdsa|dsa)(\.pub)?$/,
  /secret/i,
  /password/i,
  /private[_-]?key/i,
  /wallet\.dat$/i,
  /seed\.txt$/i,
  /mnemonic/i,
  /recovery[_-]?phrase/i,
];

function isSensitiveFile(filename: string): boolean {
  const lower = filename.toLowerCase();
  const ext = extname(lower);
  if (SENSITIVE_EXTS.has(ext)) return true;
  if (SENSITIVE_FILENAMES.has(lower)) return true;
  return SENSITIVE_PATTERNS.some((p) => p.test(lower));
}

/** Image extensions supported by tesseract.js for OCR */
const OCR_EXTS = new Set([".png", ".jpg", ".jpeg", ".webp", ".bmp"]);

/**
 * Extract text from an image file via OCR using tesseract.js.
 * Returns the extracted text, or undefined if OCR fails or yields no text.
 */
async function extractTextOCR(
  filePath: string,
  worker: TesseractWorker,
): Promise<string | undefined> {
  try {
    // Race against a timeout to prevent hangs on corrupt images
    const timeout = new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error("OCR timeout")), 30_000),
    );
    const { data } = await Promise.race([worker.recognize(filePath), timeout]);
    const text = data.text.trim();
    return text.length > 0 ? text : undefined;
  } catch {
    // OCR failure (corrupt image, timeout, unsupported format) — skip silently
    return undefined;
  }
}

function inferType(ext: string): ContentType {
  if (IMAGE_EXTS.has(ext)) return "image";
  if (VIDEO_EXTS.has(ext)) return "video";
  if (DOC_EXTS.has(ext)) return "document";
  return "file";
}

function expandHome(filepath: string): string {
  if (filepath.startsWith("~/") || filepath === "~") {
    return resolve(homedir(), filepath.slice(2));
  }
  return resolve(filepath);
}

/**
 * Validate that a resolved path is under one of the allowed roots.
 * Prevents path traversal attacks.
 */
async function isPathSafe(filepath: string, allowedRoots: string[]): Promise<boolean> {
  try {
    const real = await realpath(filepath);
    return allowedRoots.some((root) => real.startsWith(root));
  } catch {
    return false;
  }
}

const connector: Connector = {
  manifest: {
    name: "local",
    version: "0.1.0",
    description: "Index local filesystem files (code, images, videos, documents)",
    configSchema: LocalConfigSchema,
  },

  async validate(config) {
    const result = LocalConfigSchema.safeParse(config);
    if (!result.success) {
      return {
        valid: false,
        errors: result.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`),
      };
    }
    return { valid: true };
  },

  async *index(config: Record<string, unknown>, options: IndexOptions) {
    const parsed = LocalConfigSchema.parse(config);
    const allowedRoots: string[] = [];

    for (const p of parsed.paths) {
      const expanded = expandHome(p);
      try {
        allowedRoots.push(await realpath(expanded));
      } catch {
        // Path doesn't exist, skip
        continue;
      }
    }

    const ignoreSet = new Set(parsed.ignore);
    const extSet = new Set(parsed.extensions);
    const ocrEnabled = parsed.ocr;

    // Initialize tesseract worker once if OCR is enabled
    let ocrWorker: TesseractWorker | undefined;
    if (ocrEnabled) {
      try {
        ocrWorker = await createWorker("eng");
      } catch {
        // Tesseract init failed — continue without OCR
      }
    }

    async function* walk(
      dir: string,
      depth: number,
    ): AsyncGenerator<ContentItem> {
      if (depth > parsed.max_depth) return;
      if (options.signal?.aborted) return;

      let entries;
      try {
        entries = await readdir(dir, { withFileTypes: true });
      } catch {
        return; // Permission denied or inaccessible
      }

      for (const entry of entries) {
        if (options.signal?.aborted) return;
        if (ignoreSet.has(entry.name)) continue;
        if (entry.name.startsWith(".")) continue;

        const fullPath = join(dir, entry.name);

        if (entry.isDirectory()) {
          yield* walk(fullPath, depth + 1);
          continue;
        }

        if (!entry.isFile()) continue;

        const ext = extname(entry.name).toLowerCase();
        if (!extSet.has(ext)) continue;

        // Security: never index sensitive files (keys, wallets, credentials, .env)
        if (isSensitiveFile(entry.name)) continue;

        // Security: validate the resolved path is under an allowed root
        if (!(await isPathSafe(fullPath, allowedRoots))) continue;

        let fileStat;
        try {
          fileStat = await stat(fullPath);
        } catch {
          continue;
        }

        const type = inferType(ext);
        let content: string | undefined;

        // Read text content for searchability (skip binary/large files)
        if (type === "file" && fileStat.size < 512_000) {
          try {
            content = await readFile(fullPath, "utf-8");
          } catch {
            // Binary file or encoding issue
          }
        }

        // OCR: extract text from supported image files
        if (type === "image" && ocrWorker && OCR_EXTS.has(ext)) {
          content = await extractTextOCR(fullPath, ocrWorker);
        }

        const item: ContentItem = {
          id: `local:${fullPath}`,
          source: "local",
          type,
          title: basename(fullPath),
          description: `${type} in ${dir}`,
          tags: [
            ext.slice(1),
            ...basename(fullPath, ext).toLowerCase().split(/[\s_\-\.]+/).filter((t) => t.length > 1),
            ...dir.split(/[/\\]/).slice(-4).filter((t) => t.length > 0),
          ],
          uri: fullPath,
          metadata: {
            size: fileStat.size,
            modified: fileStat.mtime.toISOString(),
            extension: ext,
            ...(type === "image" && content ? { ocrText: true } : {}),
          },
          indexedAt: new Date().toISOString(),
          content,
        };

        yield item;
      }
    }

    try {
      for (const root of allowedRoots) {
        yield* walk(root, 0);
      }
    } finally {
      // Always terminate the worker to free resources
      if (ocrWorker) {
        try {
          await ocrWorker.terminate();
        } catch {
          // Ignore termination errors
        }
      }
    }
  },
};

export default connector;
