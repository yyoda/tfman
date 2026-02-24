import { join, relative, resolve } from 'node:path';
import { readdir, readFile } from 'node:fs/promises';
import { exists, runCommand, getWorkspaceRoot, loadJson } from '../utils.mjs';
import { getRepoName } from '../git.mjs';

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
  return new Set(content.split('\n').map(l => l.trim()).filter(l => l && !l.startsWith('#')));
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

/**
 * Resolves a local module path relative to the workspace root.
 * @param {string} rootAbs - The absolute path of the root module.
 * @param {string} source - The source string from the module definition.
 * @param {string} dirPath - The directory path of the module (from terraform modules json).
 * @param {string} workspaceRoot - The workspace root directory.
 * @param {string} repoName - The repository name.
 * @returns {Promise<string|null>} - The resolved relative path or null.
 */
export async function resolveLocalModule(rootAbs, source, dirPath, workspaceRoot, repoName) {
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

/**
 * Extract modules used in a Terraform root directory.
 * @param {string} rootAbs - Absolute path to the Terraform root.
 * @param {string} workspaceRoot - Absolute path to the workspace root.
 * @param {string} repoName - Name of the repository.
 * @param {string[]} logs - Array to accumulate logs/errors.
 * @returns {Promise<string[]>} - List of local module paths used.
 */
async function extractModules(rootAbs, workspaceRoot, repoName, logs) {
  try {
    const { stdout } = await runCommand('terraform modules -json', { cwd: rootAbs });

    let data;
    try {
        data = JSON.parse(stdout);
    } catch (e) {
        logs.push(`❌ JSON decode error (modules) in ${rootAbs}: ${e.message}`);
        return [];
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
    return [];
  }
}

/**
 * Extract providers used in a Terraform root directory.
 * @param {string} rootAbs - Absolute path to the Terraform root.
 * @param {string[]} logs - Array to accumulate logs/errors.
 * @returns {Promise<string[]>} - List of provider names.
 */
async function extractProviders(rootAbs, logs) {
  try {
    const { stdout } = await runCommand('terraform providers schema -json', { cwd: rootAbs });
    const data = JSON.parse(stdout);
    const schemas = data.provider_schemas || {};
    // provider_schemas keys are like "registry.terraform.io/hashicorp/aws"
    // We might want just the name or the full source. existing code took keys.
    return Object.keys(schemas).sort();
  } catch (error) {
    logs.push(`❌ Failed to get providers schema in ${rootAbs}: ${error.message}`);
    return [];
  }
}

/**
 * Analyze a single Terraform root directory.
 * @param {string} rootRelPath - Path relative to workspace root.
 * @param {string} workspaceRoot - Absolute workspace root path.
 * @param {string} repoName - Repository name.
 * @returns {Promise<object>} - Analysis result.
 */
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
  // Ensure .terraform exists (initialized)
  if (!(await exists(dotTerraform))) {
    try {
      // Ideally we should use 'terraform init -backend=false', but simplistic init might be enough for modules/providers
      await runCommand('terraform init -backend=false -input=false', { cwd: rootAbs });
    } catch (error) {
      result.logs.push(`❌ Initialization failed: ${error.message}`);
      result.status = 'error';
      return result;
    }
  }

  const [modules, providers] = await Promise.all([
    extractModules(rootAbs, workspaceRoot, repoName, result.logs),
    extractProviders(rootAbs, result.logs)
  ]);

  result.modules = modules;
  result.providers = providers;

  return result;
}

/**
 * Generate dependency graph for all Terraform roots in the workspace.
 * @param {string} workspaceRoot - Absolute path to workspace root.
 * @param {string[]} ignorePatterns - List of glob patterns to ignore.
 * @returns {Promise<object>} - { results: Array<AnalysisResult>, roots: string[] }
 */
export async function generateDependencyGraph(workspaceRoot, ignorePatterns) {
  const repoName = await getRepoName(workspaceRoot);
  const roots = await findTerraformRoots(workspaceRoot, ignorePatterns);
  
  // Running in parallel might be heavy if there are many roots (init runs concurrent)
  // But for now, let's keep it parallel as per original implementation logic (implied).
  const promises = roots.map(r => analyzeRoot(r, workspaceRoot, repoName));
  const results = await Promise.all(promises);

  return { results, roots };
}
