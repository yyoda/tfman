import { describe, it, mock } from 'node:test';
import assert from 'node:assert/strict';
import rootGate from '../../gh-scripts/root-gate.mjs';

const file = value => ({ type: 'file', encoding: 'base64', content: Buffer.from(value).toString('base64') });

describe('root-gate.mjs', () => {
  const cases = [
    { name: 'multiple enabled roots', roots: ['env/a', 'env/b'], config: { enabledRoots: ['env/a', 'env/b'] }, pass: true },
    { name: 'partial rejection lists all rejected roots', roots: ['env/a', 'env/b', 'env/c'], config: { enabledRoots: ['env/a'] }, rejected: ['env/b', 'env/c'] },
    { name: 'empty root matrix', roots: [], noApi: true },
    { name: 'invalid root matrix', roots: ['env/a', 1], noApi: true },
    { name: 'enabled root', config: { enabledRoots: ['env/a'] }, pass: true },
    { name: 'unlisted root', config: { enabledRoots: [] } },
    { name: 'similar-prefix root', config: { enabledRoots: ['env/ab'] } },
    { name: 'missing config', error: Object.assign(new Error('Not Found'), { status: 404 }) },
    { name: 'invalid JSON', data: file('{') },
    { name: 'non-array', config: { enabledRoots: 'env/a' } },
    { name: 'non-string element', config: { enabledRoots: ['env/a', 1] } },
    { name: 'null config', config: null },
    { name: 'non-file content', data: [] },
    { name: 'wrong encoding', data: { type: 'file', encoding: 'none', content: '' } },
    { name: 'missing content', data: { type: 'file', encoding: 'base64' } },
    { name: 'API error', error: new Error('Unavailable') },
    { name: 'ref API error', refError: true },
    { name: 'invalid ref SHA', invalidRef: true },
    { name: 'missing default_branch', missingBranch: true },
  ];
  for (const entry of cases) {
    it(entry.name, async () => {
      const getContent = mock.fn(async () => {
        if (entry.error) throw entry.error;
        return { data: entry.data ?? file(JSON.stringify(entry.config)) };
      });
      const sha = 'a'.repeat(40);
      const getRef = mock.fn(async () => {
        if (entry.refError) throw new Error('Ref unavailable');
        return { data: { object: { sha: entry.invalidRef ? '' : sha } } };
      });
      const setFailed = mock.fn();
      await rootGate({
        github: { rest: { git: { getRef }, repos: { getContent } } },
        context: { repo: { owner: 'owner', repo: 'repo' }, payload: { repository: { default_branch: entry.missingBranch ? undefined : 'main' } } },
        core: { setFailed },
      }, { roots: entry.roots ?? ['env/a'], configPath: '.github/copilot-autofix-config.json' });
      assert.equal(setFailed.mock.callCount(), entry.pass ? 0 : 1);
      if (!entry.pass && !entry.noApi) assert.match(setFailed.mock.calls[0].arguments[0], /env\/a/);
      if (entry.rejected) assert.ok(setFailed.mock.calls[0].arguments[0].endsWith(`Roots are not enabled: ${entry.rejected.join(', ')}`));
      if (entry.missingBranch || entry.noApi) assert.equal(getRef.mock.callCount(), 0);
      else assert.deepEqual(getRef.mock.calls[0].arguments[0], { owner: 'owner', repo: 'repo', ref: 'heads/main' });
      if (entry.missingBranch || entry.noApi || entry.refError || entry.invalidRef) assert.equal(getContent.mock.callCount(), 0);
      else assert.deepEqual(getContent.mock.calls[0].arguments[0], {
        owner: 'owner', repo: 'repo', path: '.github/copilot-autofix-config.json', ref: sha,
      });
    });
  }
});
