import chalk from "chalk";
import { TroveEngine, TroveWatcher } from "@trove/core";

export async function watchCommand(
  options: { verbose?: boolean } = {},
): Promise<void> {
  const engine = await TroveEngine.create();
  const config = engine.getConfig();

  const watcher = new TroveWatcher(engine, config, {
    debounceMs: 1000,
    onChange(paths) {
      if (options.verbose) {
        for (const p of paths) {
          console.log(chalk.dim(`  changed: ${p}`));
        }
      }
    },
    onIndexStart() {
      console.log(chalk.cyan("  re-indexing..."));
    },
    onIndexEnd(count) {
      console.log(
        chalk.green(`  indexed ${count} item(s)`),
      );
    },
    onError(err) {
      console.error(chalk.red(`  error: ${err.message}`));
    },
  });

  console.log(chalk.bold("Trove Watch Mode"));
  console.log(chalk.dim("Watching local sources for changes. Press Ctrl+C to stop.\n"));

  await watcher.start();

  // Handle graceful shutdown
  const cleanup = async () => {
    console.log(chalk.dim("\nStopping watcher..."));
    await watcher.stop();
    process.exit(0);
  };

  process.on("SIGINT", cleanup);
  process.on("SIGTERM", cleanup);

  // Keep process alive
  await new Promise(() => {});
}
