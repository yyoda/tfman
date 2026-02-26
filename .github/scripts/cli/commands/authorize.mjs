import { resolveRoles as defaultResolveRoles } from '../../lib/ops/authorizer.mjs';
import { resolve } from 'node:path';

const DEFAULT_PERMISSION_FILE = '.terraform-permissions.json';

export function run(args, deps = {}) {
  const { resolveRoles = defaultResolveRoles } = deps;
  const { actor, 'permission-file': permissionFile } = args;

  if (!actor) throw new Error('Missing required argument: actor');

  const configPath = resolve(process.cwd(), permissionFile ?? DEFAULT_PERMISSION_FILE);
  return resolveRoles(actor, configPath);
}
