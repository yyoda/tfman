import { join, resolve } from 'node:path';
import { runCommand as defaultRunCommand, getWorkspaceRoot as defaultGetWorkspaceRoot } from '../../lib/utils.mjs';
import { logger as defaultLogger } from '../../lib/logger.mjs';
import {
  generateDependencyGraph as defaultGenerateDependencyGraph,
  loadIgnorePatterns as defaultLoadIgnorePatterns
} from '../../lib/ops/deps-generator.mjs';
import { writeFile as defaultWriteFile } from 'node:fs/promises';

export async function run(args, dependencies = {}) {
  const {
    generateDependencyGraph = defaultGenerateDependencyGraph,
    loadIgnorePatterns = defaultLoadIgnorePatterns,
    runCommand = defaultRunCommand,
    getWorkspaceRoot = defaultGetWorkspaceRoot,
    logger = defaultLogger,
    writeFile = defaultWriteFile
  } = dependencies;

  const { root: rootArg, output, 'ignore-file': ignoreFile } = args;
  const root = rootArg ? resolve(rootArg) : await getWorkspaceRoot();

  try {
    await runCommand('terraform', ['-version']);
  } catch (err) {
    throw new Error(`'terraform' command not found or failed to run: ${err.message}`, { cause: err });
  }

  logger.info(`🔍 Discovery: Scanning ${root} for Terraform roots...`);

  const ignorePatterns = await loadIgnorePatterns(ignoreFile, root);

  logger.info(`🚀 Analysis: Generating dependency graph...`);

  const { results } = await generateDependencyGraph(root, ignorePatterns);

  // Keep generated output deterministic across filesystem traversal orders.
  results.sort((a, b) => a.root.localeCompare(b.root));

  const moduleUsage = new Map();
  const failedRoots = [];
  const rootObjects = [];

  for (const res of results) {
    if (res.status === 'success') {
      if (res.logs.length > 0) {
        logger.warning(`⚠️  Warnings for ${res.root}:`);
        res.logs.forEach(l => logger.warning(`    ${l}`));
      }
      logger.info(`✅ ${res.root}`);

      rootObjects.push({
        path: res.root,
        providers: res.providers
      });

      for (const mod of res.modules) {
        if (!moduleUsage.has(mod)) moduleUsage.set(mod, []);
        moduleUsage.get(mod).push(res.root);
      }
    } else {
      logger.error(`❌ ${res.root}`);
      res.logs.forEach(l => logger.error(`    ${l}`));
      failedRoots.push(res.root);
    }
  }

  if (failedRoots.length > 0) {
    throw new Error(`Analysis failed for ${failedRoots.length} roots.`);
  }

  const outputObject = {
    dirs: rootObjects,
    modules: Array.from(moduleUsage.keys()).sort().map(mod => ({
      source: mod,
      usedIn: moduleUsage.get(mod).sort()
    }))
  };

  const outputPath = output || join(root, '.tfdeps.json');
  await writeFile(outputPath, JSON.stringify(outputObject, null, 2) + '\n');
  logger.info(`✨ Success! Dependency graph written to ${outputPath}`);
}
