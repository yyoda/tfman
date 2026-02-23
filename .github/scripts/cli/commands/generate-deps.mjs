import { join, resolve, relative } from 'node:path';
import { readdir, access, readFile, writeFile } from 'node:fs/promises';
import { runCommand, getWorkspaceRoot } from '../../lib/utils.mjs';
import { logger } from '../../lib/logger.mjs';
import { constants } from 'node:fs';

async function exists(path) {
  try {
    await access(path, constants.F_OK);
    return true;
  } catch {
    return false;
  }
}

async function loadIgnorePatterns(ignoreFilePath, root) {
  const path = ignoreFilePath || join(root, '.tfdepsignore');
  if (!(await exists(path))) {
    return new Set();
  }
  const content = await readFile(path, 'utf-8');
  return new Set(content.split('\n').map(l => l.trim()).filter(l => l && !l.startsWith('#')));
}

export async function findTerraformRoots(root, ignorePatterns) {
  const roots = [];

  async function walk(dir) {
    const relDir = relative(root, dir);
    if (relDir && ignorePatterns.has(relDir)) return;

    // Check if current directory path components match any ignore pattern if needed
    const entries = await readdir(dir, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.isDirectory()) {
         const entryPath = join(dir, entry.name);
         const relEntry = relative(root, entryPath);

         // Recursively check ignore patterns
         let isIgnored = false;
         for (const pattern of ignorePatterns) {
           if (relEntry === pattern || relEntry.startsWith(pattern + '/') || entry.name === pattern) {
             isIgnored = true;
             break;
           }
         }

         if (!isIgnored) {
           await walk(entryPath);
         }
      } else if (entry.name === '.terraform-version') {
        const relRoot = relative(root, dir);
        roots.push(relRoot);
      }
    }
  }

  await walk(root);
  return roots.sort();
}

async function getRepoName(root) {
  try {
    const { stdout } = await runCommand('git remote get-url origin', { cwd: root });
    const url = stdout.trim();
    // Match the repo name from various git URL formats:
    // https://github.com/org/repo.git
    // git@github.com:org/repo.git
    const match = url.match(/\/([^/.]+)(\.git)?$/);
    return match ? match[1] : null;
  } catch (error) {
    logger.warning(`⚠️  Could not determine repository name from git remote: ${error.message}`);
    return null;
  }
}

async function resolveLocalModule(rootAbs, source, dirPath, workspaceRoot, repoName) {
  let candidatePath = null;

  // 1. git:: source pointing to the current repository
  if (source.startsWith('git::') && source.includes('//') && repoName && source.includes(repoName)) {
    const parts = source.split('//');
    const pathPart = parts[parts.length - 1].split('?')[0];
    candidatePath = resolve(workspaceRoot, pathPart);
  }

  // 2. Local paths
  if (!candidatePath) {
    if (dirPath) {
      candidatePath = resolve(rootAbs, dirPath);
    } else if (source.startsWith('.') || source.startsWith('..')) {
      candidatePath = resolve(rootAbs, source);
    }
  }

  if (candidatePath && (await exists(candidatePath))) {
    try {
      const rel = relative(workspaceRoot, candidatePath);
      if (rel !== '' && !rel.startsWith('..')) {
         return rel;
      }
    } catch {
      // failed
    }
  }
  return null;
}

async function extractModules(rootAbs, workspaceRoot, logs, repoName) {
  try {
    const { stdout } = await runCommand('terraform modules -json', { cwd: rootAbs });

    let data;
    try {
        data = JSON.parse(stdout);
    } catch (e) {
        logs.push(`❌ JSON decode error (modules): ${e.message}\nStdout: ${stdout.slice(0, 100)}...`);
        return [];
    }

    const modulesRaw = data.Modules || data.modules || [];
    const modulesSet = new Set();

    for (const m of modulesRaw) {
      const source = m.Source || m.source;
      if (!source) continue;

      const dir = m.Dir || m.dir || '';
      const modPath = await resolveLocalModule(rootAbs, source, dir, workspaceRoot, repoName);
      if (modPath) {
        modulesSet.add(modPath);
      }
    }
    return Array.from(modulesSet).sort();
  } catch (error) {
    logs.push(`❌ 'terraform modules' failed: ${error.message}`);
    return [];
  }
}

async function extractProviders(rootAbs, logs) {
  try {
    const { stdout } = await runCommand('terraform providers schema -json', { cwd: rootAbs });
    const data = JSON.parse(stdout);
    const schemas = data.provider_schemas || {};
    return Object.keys(schemas).sort();
  } catch (error) {
    logs.push(`❌ Failed to get providers schema: ${error.message}`);
    return [];
  }
}

async function analyzeRoot(rootRelPath, workspaceRoot, repoName) {
  const rootAbs = resolve(workspaceRoot, rootRelPath);
  const result = {
    root: rootRelPath,
    status: 'success',
    logs: [],
    modules: [],
    providers: []
  };

  const dotTerraform = join(rootAbs, '.terraform');
  if (!(await exists(dotTerraform))) {
    try {
      await runCommand('terraform init -backend=false -input=false', { cwd: rootAbs });
    } catch (error) {
      result.logs.push(`❌ Initialization failed: ${error.message}`);
      result.status = 'error';
      return result;
    }
  }

  const [modules, providers] = await Promise.all([
    extractModules(rootAbs, workspaceRoot, result.logs, repoName),
    extractProviders(rootAbs, result.logs)
  ]);

  result.modules = modules;
  result.providers = providers;

  return result;
}

export async function run(options) {
  const { root: rootArg, output, 'ignore-file': ignoreFile } = options;
  const root = rootArg ? resolve(rootArg) : await getWorkspaceRoot();

  try {
    await runCommand('terraform -version');
  } catch (err) {
    logger.error("❌️ Error: 'terraform' command not found or failed to run.", err.message);
    process.exit(1);
  }

  logger.info(`🔍 Discovery: Scanning ${root} for Terraform roots...`);
  const ignorePatterns = await loadIgnorePatterns(ignoreFile, root);
  const roots = await findTerraformRoots(root, ignorePatterns);

  const repoName = await getRepoName(root);
  if (repoName) {
    logger.info(`📦 Detected repository name: ${repoName}`);
  }

  logger.info(`Found ${roots.length} Terraform roots.`);
  logger.info(`🚀 Analysis: Analyzing ${roots.length} roots in parallel...`);
  const results = await Promise.all(roots.map(r => analyzeRoot(r, root, repoName)));
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
