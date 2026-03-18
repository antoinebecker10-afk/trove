import ora from "ora";
import chalk from "chalk";
import { TroveEngine } from "@trove/core";
import { log } from "../utils/logger.js";

/**
 * `trove index [source]` — index content from configured sources.
 */
export async function indexCommand(
  source?: string,
  options?: { verbose?: boolean },
): Promise<void> {
  // Prevent tesseract.js Worker errors from crashing the process
  process.on("uncaughtException", (err) => {
    const msg = err?.message ?? String(err);
    if (msg.includes("attempting to read image") || msg.includes("pix returned")) {
      // Corrupt image — skip silently
      return;
    }
    // Re-throw anything else
    console.error("Fatal:", msg);
    process.exit(1);
  });

  log.brand("Indexing content...\n");

  const spinner = ora({
    text: "Loading engine...",
    color: "yellow",
  }).start();

  try {
    const engine = await TroveEngine.create();

    spinner.text = source
      ? `Indexing "${source}"...`
      : "Indexing all sources...";

    const count = await engine.index(source, {
      onProgress: (indexed) => {
        spinner.text = `Indexed ${indexed} items...`;
      },
    });

    spinner.succeed(chalk.green(`Indexed ${count} items`));

    // Show stats
    const stats = await engine.getStats();
    console.log();
    log.dim(`  Total: ${stats.totalItems} items`);
    for (const [type, count] of Object.entries(stats.byType)) {
      log.dim(`  ${type}: ${count}`);
    }
    console.log();
    log.info(`Search with: ${chalk.hex("#f97316")("trove search <query>")}`);
  } catch (err) {
    spinner.fail("Indexing failed");
    log.error(err instanceof Error ? err.message : String(err));
    process.exitCode = 1;
  }
}
