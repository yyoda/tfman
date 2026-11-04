import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { run } from '../../../cli/commands/check-base-ancestry.mjs';
import { baseBranchLagMessage } from '../../../lib/git.mjs';

describe('check-base-ancestry', () => {
  const args = { 'base-ref': 'release/1.x', 'head-sha': 'head', root: '/workspace' };
  it('resolves without output when up to date', async () => {
    assert.equal(await run(args, { _getBaseBranchLag: async (...actual) => {
      assert.deepEqual(actual, ['release/1.x', 'head', '/workspace']);
      return { upToDate: true, behindBy: 0 };
    } }), undefined);
  });
  for (const count of [1, 2]) {
    it(`throws shared guidance for ${count} missing commits`, async () => {
      const message = baseBranchLagMessage(args['base-ref'], count);
      assert.ok(message.includes(`${count} ${count === 1 ? 'commit' : 'commits'} behind \`release/1.x\``));
      assert.ok(!message.split('\n').includes('ghadelim'));
      await assert.rejects(run(args, { _getBaseBranchLag: async () => ({ upToDate: false, behindBy: count }) }), { message });
    });
  }
  it('requires both arguments', async () => {
    for (const input of [{}, { 'base-ref': 'base' }, { 'head-sha': 'head' }, { ...args, 'base-ref': '' }]) {
      await assert.rejects(run(input), /Missing required arguments/);
    }
  });
  it('propagates lookup failures', async () => {
    await assert.rejects(run(args, { _getBaseBranchLag: async () => { throw new Error('Lookup failed'); } }), /Lookup failed/);
  });
});
