import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { resolveRoles } from '../../../scripts/lib/ops/authorizer.mjs';

const mockFs = (content) => ({
  readFileSync: () => content,
});

const notFoundFs = {
  readFileSync: () => {
    const err = new Error('ENOENT: no such file or directory');
    err.code = 'ENOENT';
    throw err;
  },
};

describe('resolveRoles', () => {
  it('returns ["applier"] for a user listed under the applier role', () => {
    const config = JSON.stringify({ applier: ['alice', 'bob'] });
    assert.deepEqual(resolveRoles('alice', '/mock/path', { fs: mockFs(config) }), ['applier']);
  });

  it('returns ["planner"] for a user not listed in any role', () => {
    const config = JSON.stringify({ applier: ['alice'] });
    assert.deepEqual(resolveRoles('charlie', '/mock/path', { fs: mockFs(config) }), ['planner']);
  });

  it('returns ["planner"] when the config file does not exist', () => {
    assert.deepEqual(resolveRoles('anyone', '/nonexistent/path', { fs: notFoundFs }), ['planner']);
  });

  it('returns multiple roles when the user appears in multiple role lists', () => {
    const config = JSON.stringify({ applier: ['alice'], admin: ['alice'] });
    const roles = resolveRoles('alice', '/mock/path', { fs: mockFs(config) });
    assert.deepEqual(roles.sort(), ['admin', 'applier']);
  });

  it('returns ["planner"] when the config file is empty JSON object', () => {
    const config = JSON.stringify({});
    assert.deepEqual(resolveRoles('alice', '/mock/path', { fs: mockFs(config) }), ['planner']);
  });

  it('returns ["planner"] when the role array is empty', () => {
    const config = JSON.stringify({ applier: [] });
    assert.deepEqual(resolveRoles('alice', '/mock/path', { fs: mockFs(config) }), ['planner']);
  });
});
