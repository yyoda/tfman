import * as _fs from 'fs';

/**
 * Resolves the roles granted to a GitHub actor.
 * Reads from the given config file path.
 * If the file does not exist, returns ["planner"] unconditionally.
 *
 * @param {string} actor - GitHub username to check
 * @param {string} configPath - Path to the operators JSON file
 * @param {object} deps - Injectable dependencies for testing (e.g. { fs })
 * @returns {string[]} Array of roles granted to the actor
 */
export function resolveRoles(actor, configPath, deps = {}) {
  const { fs = _fs } = deps;
  let data;
  try {
    data = JSON.parse(fs.readFileSync(configPath, 'utf8'));
  } catch (err) {
    if (err.code === 'ENOENT') return ['planner'];
    throw err;
  }

  const roles = Object.entries(data)
    .filter(([, users]) => Array.isArray(users) && users.includes(actor))
    .map(([role]) => role);

  return roles.length > 0 ? roles : ['planner'];
}
