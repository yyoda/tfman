import { join, resolve } from 'node:path';
import { writeFile } from 'node:fs/promises';
import { runCommand, getWorkspaceRoot } from '../../lib/utils.mjs';
import { logger } from '../../lib/logger.mjs';
import { generateDependencyGraph } from '../../lib/ops/deps-generator.mjs';
import { loadIgnorePatterns } from '../../lib/ops/deps-generator.mjs';
import { getRepoName } from '../../lib/git.mjs';

export async function run(options) {
  const { root: rootArg, output, 'ignore-file': ignoreFile } = options;
  const root = rootArg ? resolve(rootArg) : await getWorkspaceRoot();

  try {
    await runCommand('terraform', ['-version']);
  } catch (err) {
    logger.error("❌️ Error: 'terraform' command not found or failed to run.", err.message);
    process.exit(1);
  }

  logger.info(`🔍 Discovery: Scanning ${root} for Terraform roots...`);

  const ignorePatterns = await loadIgnorePatterns(ignoreFile, root);

  logger.info(`🚀 Analysis: Generating dependency graph...`);
  
  const { results, roots } = await generateDependencyGraph(root, ignorePatterns);

  if (roots) {
      logger.info(`Found ${roots.length} Terraform roots.`);
      // Async import to avoid circular dep issues in some contexts or just clean separation, though here static import works fine.
      // But getRepoName is re-exported from current file? It was.
      // Let's use the re-exported or imported one.
      const repoName = await getRepoName(root);
      if (repoName) {
        logger.info(`Detected repository name: ${repoName}`);
      }
  }
  
  // Sort and process results to match original output format
  results.sort((a, b) => a.root.localeCompare(b.root));

  const moduleUsage = {};
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
        if (!moduleUsage[mod]) moduleUsage[mod] = [];
        moduleUsage[mod].push(res.root);
      }
    } else {
      logger.error(`❌ ${res.root}`);
      res.logs.forEach(l => logger.error(`    ${l}`));
      failedRoots.push(res.root);
    }
  }

  if (failedRoots.length > 0) {
    logger.error(`❌ Analysis failed for ${failedRoots.length} roots.`);
    process.exit(1);
  }

  const outputObject = {
    dirs: rootObjects,
    modules: Object.keys(moduleUsage).sort().map(mod => ({
        source: mod,
        usedIn: moduleUsage[mod].sort()
    }))
  };

  const outputPath = output || join(root, '.tfdeps.json');
  await writeFile(outputPath, JSON.stringify(outputObject, null, 2) + '\n');
  logger.info(`✨ Success! Dependency graph written to ${outputPath}`);
}
