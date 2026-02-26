import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { run } from '../../../scripts/cli/commands/authorize.mjs';

describe('cli/commands/authorize', () => {
  it('should throw error if actor is missing', () => {
    assert.throws(() => run({}), /Missing required argument: actor/);
  });

  it('should return roles for a valid actor', () => {
    const mockResolveRoles = () => ['applier'];
    const result = run({ actor: 'alice' }, { resolveRoles: mockResolveRoles });
    assert.deepEqual(result, ['applier']);
  });

  it('should use default permission-file path when not specified', () => {
    let capturedPath;
    const mockResolveRoles = (_actor, path) => {
      capturedPath = path;
      return ['planner'];
    };
    run({ actor: 'alice' }, { resolveRoles: mockResolveRoles });
    assert.ok(capturedPath.endsWith('.terraform-permissions.json'));
  });

  it('should use custom permission-file path when specified', () => {
    let capturedPath;
    const mockResolveRoles = (_actor, path) => {
      capturedPath = path;
      return ['applier'];
    };
    run({ actor: 'alice', 'permission-file': '.github/.terraform-permissions.json' }, { resolveRoles: mockResolveRoles });
    assert.ok(capturedPath.endsWith('.github/.terraform-permissions.json'));
  });
});
