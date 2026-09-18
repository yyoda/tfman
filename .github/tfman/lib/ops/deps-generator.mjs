import { join, relative, resolve, isAbsolute, sep } from 'node:path';
import { readdir, readFile } from 'node:fs/promises';
import { exists, runCommand } from '../utils.mjs';
import { getRepoIdentity, normalizeRepoIdentity } from '../git.mjs';
import { logger } from '../logger.mjs';

/**
 * Loads ignore patterns from a file.
 * @param {string} ignoreFilePath - Path to the ignore file (optional).
 * @param {string} root - The root directory of the repository.
 * @returns {Promise<Set<string>>} - A set of ignore patterns.
 */
export async function loadIgnorePatterns(ignoreFilePath, root) {
  const path = ignoreFilePath || join(root, '.tfdepsignore');
  if (!(await exists(path))) {
    return new Set();
  }
  const content = await readFile(path, 'utf-8');
  const patterns = new Set();
  for (const rawLine of content.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;

    // Support both "one pattern per line" and "space-separated" formats.
    for (const token of line.split(/\s+/)) {
      patterns.add(token);
    }
  }
  return patterns;
}

/**
 * Finds all Terraform root modules in a directory.
 * @param {string} root - The root directory to search.
 * @param {Set<string>} ignorePatterns - A set of ignore patterns.
 * @returns {Promise<string[]>} - A list of relative paths to Terraform root modules.
 */
export async function findTerraformRoots(root, ignorePatterns) {
  const roots = [];
  const patterns = [...ignorePatterns];

  async function walk(dir) {
    const relDir = relative(root, dir);
    const entries = await readdir(dir, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.isDirectory()) {
        const entryPath = join(dir, entry.name);
        const relEntry = relative(root, entryPath);
        const isIgnored = patterns.some(pattern =>
          relEntry === pattern || relEntry.startsWith(pattern + '/') || entry.name === pattern
        );
        if (isIgnored) {
          logger.info(`[skip] ${relEntry}`);
          continue;
        }
        await walk(entryPath);
      } else if (entry.name === '.terraform-version') {
        if (relDir === '') {
          logger.info('[skip] .terraform-version at workspace root (tool version pin, not a Terraform root)');
        } else {
          roots.push(relDir);
        }
      }
    }
  }

  await walk(root);
  return roots.sort();
}

/**
 * Resolves a local module path relative to the workspace root.
 * Git sources are local only when the host, owner and repository match origin exactly and no ref pins them.
 * Modules installed under .terraform/ are not treated as local dependencies.
 * @param {string} rootAbs - The absolute path of the root module.
 * @param {string} source - The source string from the module definition.
 * @param {string} dirPath - The directory path of the module (from terraform modules json).
 * @param {string} workspaceRoot - The workspace root directory.
 * @param {string} repoIdentity - The origin repository identity.
 * @returns {Promise<string|null>} - The resolved relative path or null.
 */
export async function resolveLocalModule(rootAbs, source, dirPath, workspaceRoot, repoIdentity) {
  let candidatePath = null;

  // 1. Git source pointing to the current repository
  if (source.startsWith('git::') || source.startsWith('github.com/')) {
    const parts = source.replace(/^git::/, '').replace(/^[a-z]+:\/\//i, '').split('//');
    if (parts.length < 2) return null;
    const [pathPart, ...queryParts] = parts[parts.length - 1].split('?');
    if (queryParts.join('?').includes('ref=')) return null;
    if (!repoIdentity || normalizeRepoIdentity(source) !== repoIdentity) return null;
    candidatePath = resolve(workspaceRoot, pathPart);
  }

  // 2. Local paths
  if (!candidatePath) {
    if (dirPath && isAbsolute(dirPath)) {
      candidatePath = dirPath;
    } else if (dirPath) {
      candidatePath = resolve(rootAbs, dirPath);
    } else if (source.startsWith('.')) {
      // Clean source of potential double slashes for local paths just in case
      const cleanSource = source.split('//').join('/');
      candidatePath = resolve(rootAbs, cleanSource);
    }
    if (candidatePath && resolve(candidatePath).split(/[\\/]/).includes('.terraform')) return null;
  }

  if (candidatePath && (await exists(candidatePath))) {
    const rel = relative(workspaceRoot, candidatePath);
    const isOutsideWorkspace = rel === '..' || rel.startsWith(`..${sep}`) || isAbsolute(rel);
    if (rel !== '' && !isOutsideWorkspace) {
      return rel;
    }
  }
  return null;
}

/**
 * Extract modules used in a Terraform root directory.
 * @param {string} rootAbs - Absolute path to the Terraform root.
 * @param {string} workspaceRoot - Absolute path to the workspace root.
 * @param {string} repoIdentity - Origin repository identity.
 * @param {string[]} logs - Array to accumulate logs/errors.
 * @returns {Promise<string[]|null>} - List of local module paths used, or null on failure.
 */
async function extractModules(rootAbs, workspaceRoot, repoIdentity, logs, runCommand) {
  try {
    let stdout;
    try {
      ({ stdout } = await runCommand('terraform', ['modules', '-json'], { cwd: rootAbs }));
    } catch (error) {
      if (!/^.*no command named "modules"\.?\s*$/im.test(error.message)) throw error;
      const manifest = join(rootAbs, '.terraform', 'modules', 'modules.json');
      if (!(await exists(manifest))) throw error;
      stdout = await readFile(manifest, 'utf-8');
      logs.push(`ℹ️ 'terraform modules' unavailable in ${rootAbs}; used .terraform/modules/modules.json`);
    }

    let data;
    try {
      data = JSON.parse(stdout);
    } catch (e) {
      logs.push(`❌ JSON decode error (modules) in ${rootAbs}: ${e.message}`);
      return null;
    }

    const modulesRaw = Array.isArray(data?.Modules) ? data.Modules : data?.modules;
    if (!Array.isArray(modulesRaw)) {
      logs.push(`❌ Unexpected 'terraform modules' output in ${rootAbs}: missing modules array`);
      return null;
    }
    const modulesSet = new Set();

    for (const m of modulesRaw) {
      // Support the initialized manifest and the modules command's JSON fields.
      const source = m.Source || m.source;
      if (!source) continue;

      const dir = m.Dir || m.dir || '';
      const modPath = await resolveLocalModule(rootAbs, source, dir, workspaceRoot, repoIdentity);
      if (modPath) {
        modulesSet.add(modPath);
      }
    }
    return Array.from(modulesSet).sort();
  } catch (error) {
    logs.push(`❌ 'terraform modules' failed in ${rootAbs}: ${error.message}`);
    return null;
  }
}

/**
 * Extract providers used in a Terraform root directory.
 * @param {string} rootAbs - Absolute path to the Terraform root.
 * @param {string[]} logs - Array to accumulate logs/errors.
 * @returns {Promise<string[]|null>} - List of provider names, or null on failure.
 */
async function extractProviders(rootAbs, logs, runCommand) {
  const lockFile = join(rootAbs, '.terraform.lock.hcl');
  if (await exists(lockFile)) {
    const content = await readFile(lockFile, 'utf-8');
    const providers = [];
    const regex = /^\s*provider\s+"([^"]+)"/gm;
    let match;
    while ((match = regex.exec(content)) !== null) {
      providers.push(match[1]);
    }
    return providers.sort();
  }

  // Query installed provider schemas when no lockfile is available.
  try {
    const { stdout } = await runCommand('terraform', ['providers', 'schema', '-json'], { cwd: rootAbs });
    const data = JSON.parse(stdout);
    const schemas = data.provider_schemas || {};
    return Object.keys(schemas).sort();
  } catch (error) {
    logs.push(`❌ Failed to get providers schema in ${rootAbs}: ${error.message}`);
    return null;
  }
}

/**
 * Analyze a single Terraform root directory.
 * @param {string} rootRelPath - Path relative to workspace root.
 * @param {string} workspaceRoot - Absolute workspace root path.
 * @param {string} repoIdentity - Origin repository identity.
 * @returns {Promise<object>} - Analysis result.
 */
async function analyzeRoot(rootRelPath, workspaceRoot, repoIdentity, runCommand) {
  const rootAbs = resolve(workspaceRoot, rootRelPath);
  const result = {
    root: rootRelPath,
    status: 'success',
    logs: [],
    modules: [],
    providers: []
  };

  logger.info(`[${rootRelPath}] Analyzing...`);

  const dotTerraform = join(rootAbs, '.terraform');
  // Ensure .terraform exists (initialized)
  if (!(await exists(dotTerraform))) {
    try {
      logger.info(`[${rootRelPath}] Running terraform init...`);
      await runCommand('terraform', ['init', '-backend=false', '-input=false'], { cwd: rootAbs });
    } catch (error) {
      result.logs.push(`❌ Initialization failed: ${error.message}`);
      result.status = 'failure';
      return result;
    }
  }

  logger.info(`[${rootRelPath}] Extracting modules...`);
  const modules = await extractModules(rootAbs, workspaceRoot, repoIdentity, result.logs, runCommand);
  logger.info(`[${rootRelPath}] Extracting providers...`);
  const providers = await extractProviders(rootAbs, result.logs, runCommand);

  if (modules === null || providers === null) result.status = 'failure';
  result.modules = modules ?? [];
  result.providers = providers ?? [];

  return result;
}

/**
 * Generate dependency graph for all Terraform roots in the workspace.
 * @param {string} workspaceRoot - Absolute path to workspace root.
 * @param {Set<string>} ignorePatterns - Directory names or relative path prefixes to ignore (not globs).
 * @returns {Promise<object>} - { results: Array<AnalysisResult>, roots: string[] }
 */
export async function generateDependencyGraph(workspaceRoot, ignorePatterns, dependencies = {}) {
  const { runCommand: executeCommand = runCommand, getRepoIdentity: resolveRepoIdentity = getRepoIdentity } = dependencies;
  const repoIdentity = await resolveRepoIdentity(workspaceRoot);
  if (repoIdentity) logger.info(`Detected repository identity: ${repoIdentity}`);
  const roots = await findTerraformRoots(workspaceRoot, ignorePatterns);

  logger.info(`Found ${roots.length} Terraform roots. Starting analysis...`);

  const promises = roots.map(r => analyzeRoot(r, workspaceRoot, repoIdentity, executeCommand));
  const results = await Promise.all(promises);

  return { results, roots };
}
