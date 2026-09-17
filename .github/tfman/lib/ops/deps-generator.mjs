import { join, relative, resolve, isAbsolute } from 'node:path';
import { readdir, readFile } from 'node:fs/promises';
import { exists, runCommand, getWorkspaceRoot, loadJson } from '../utils.mjs';
import { getRepoName } from '../git.mjs';
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
    for (const token of line.split(/\s+/).map(t => t.trim()).filter(Boolean)) {
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
         } else {
           logger.info(`[skip] ${relEntry}`);
         }
      } else if (entry.name === '.terraform-version') {
        const relRoot = relative(root, dir);
        if (relRoot === '') {
          logger.info('[skip] .terraform-version at workspace root (tool version pin, not a Terraform root)');
        } else {
          roots.push(relRoot);
        }
      }
    }
  }

  await walk(root);
  return roots.sort();
}

/**
 * Resolves a local module path relative to the workspace root.
 * Git sources are local only when the repository name matches exactly and no ref pins them.
 * Modules installed under .terraform/ are not treated as local dependencies.
 * @param {string} rootAbs - The absolute path of the root module.
 * @param {string} source - The source string from the module definition.
 * @param {string} dirPath - The directory path of the module (from terraform modules json).
 * @param {string} workspaceRoot - The workspace root directory.
 * @param {string} repoName - The repository name.
 * @returns {Promise<string|null>} - The resolved relative path or null.
 */
export async function resolveLocalModule(rootAbs, source, dirPath, workspaceRoot, repoName) {
  let candidatePath = null;

  // 1. Git source pointing to the current repository
  if (source.startsWith('git::') || source.startsWith('github.com/')) {
    const parts = source.replace(/^git::/, '').split('//');
    if (parts.length < 2) return null;
    const [pathPart, ...queryParts] = parts[parts.length - 1].split('?');
    if (queryParts.join('?').includes('ref=')) return null;
    const sourceRepoName = parts[parts.length - 2].replace(/\.git$/, '').split(/[/:]/).pop();
    if (!repoName || sourceRepoName !== repoName) return null;
    candidatePath = resolve(workspaceRoot, pathPart);
  }

  // 2. Local paths
  if (!candidatePath) {
    if (dirPath && isAbsolute(dirPath)) {
        // If dirPath is absolute, use it directly (sometimes Terraform provides this)
        candidatePath = dirPath;
    } else if (dirPath) {
      candidatePath = resolve(rootAbs, dirPath);
    } else if (source.startsWith('.') || source.startsWith('..')) {
      // Clean source of potential double slashes for local paths just in case
      const cleanSource = source.split('//').join('/');
      candidatePath = resolve(rootAbs, cleanSource);
    }
    if (candidatePath && resolve(candidatePath).split(/[\\/]/).includes('.terraform')) return null;
  }

  if (candidatePath && (await exists(candidatePath))) {
    try {
      const rel = relative(workspaceRoot, candidatePath);
      // Ensure it's not outside the workspace
      if (rel !== '' && !rel.startsWith('..') && !isAbsolute(rel)) {
         return rel;
      }
    } catch {
      // failed
    }
  }
  return null;
}

/**
 * Extract modules used in a Terraform root directory.
 * @param {string} rootAbs - Absolute path to the Terraform root.
 * @param {string} workspaceRoot - Absolute path to the workspace root.
 * @param {string} repoName - Name of the repository.
 * @param {string[]} logs - Array to accumulate logs/errors.
 * @returns {Promise<string[]|null>} - List of local module paths used, or null on failure.
 */
async function extractModules(rootAbs, workspaceRoot, repoName, logs, runCommand) {
  try {
    let stdout;
    try {
      ({ stdout } = await runCommand('terraform', ['modules', '-json'], { cwd: rootAbs }));
    } catch (error) {
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

    const modulesRaw = data.Modules || data.modules || [];
    const modulesSet = new Set();

    for (const m of modulesRaw) {
      // "Source" is the key in older Terraform versions, "source" in newer?
      // Checking both to cover bases, or just strictly based on what `terraform modules -json` outputs.
      // Usually the output keys are uppercased in Go but json output might vary by version.
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

  // If Fallback: .terraform.lock.hcl does not exist
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
 * @param {string} repoName - Repository name.
 * @returns {Promise<object>} - Analysis result.
 */
async function analyzeRoot(rootRelPath, workspaceRoot, repoName, runCommand) {
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
      // Ideally we should use 'terraform init -backend=false', but simplistic init might be enough for modules/providers
      logger.info(`[${rootRelPath}] Running terraform init...`);
      await runCommand('terraform', ['init', '-backend=false', '-input=false'], { cwd: rootAbs });
    } catch (error) {
      result.logs.push(`❌ Initialization failed: ${error.message}`);
      result.status = 'error';
      return result;
    }
  }

  logger.info(`[${rootRelPath}] Extracting modules...`);
  const modules = await extractModules(rootAbs, workspaceRoot, repoName, result.logs, runCommand);
  logger.info(`[${rootRelPath}] Extracting providers...`);
  const providers = await extractProviders(rootAbs, result.logs, runCommand);

  if (modules === null || providers === null) result.status = 'error';
  result.modules = modules ?? [];
  result.providers = providers ?? [];

  return result;
}

/**
 * Generate dependency graph for all Terraform roots in the workspace.
 * @param {string} workspaceRoot - Absolute path to workspace root.
 * @param {string[]} ignorePatterns - List of glob patterns to ignore.
 * @returns {Promise<object>} - { results: Array<AnalysisResult>, roots: string[] }
 */
export async function generateDependencyGraph(workspaceRoot, ignorePatterns, dependencies = {}) {
  const { runCommand: executeCommand = runCommand, getRepoName: resolveRepoName = getRepoName } = dependencies;
  const repoName = await resolveRepoName(workspaceRoot);
  const roots = await findTerraformRoots(workspaceRoot, ignorePatterns);

  logger.info(`Found ${roots.length} Terraform roots. Starting analysis...`);

  // Running in parallel might be heavy if there are many roots (init runs concurrent)
  // But for now, let's keep it parallel as per original implementation logic (implied).
  const promises = roots.map(r => analyzeRoot(r, workspaceRoot, repoName, executeCommand));
  const results = await Promise.all(promises);

  return { results, roots };
}
