import { describe, it } from 'node:test';
import assert from 'node:assert';
import { run } from '../../../cli/commands/write-result.mjs';

describe('cli/commands/write-result', () => {
  const args = { path: 'env/x', command: 'plan', outcome: 'cancelled' };
  it('rejects unsupported commands', async () => {
    await assert.rejects(run({ ...args, command: 'foo' }), /--command must be plan or apply/);
  });
  for (const required of ['path', 'command', 'outcome']) {
    it(`requires ${required}`, async () => {
      await assert.rejects(run({ ...args, [required]: undefined }), new RegExp(`Missing required arguments: ${required}`));
    });
  }
  it('passes explicit options and logs one info line', async () => {
    const logs = [];
    await run({ ...args, cwd: '/tmp/example', 'summary-file': 'summary', 'github-output': 'output' }, {
      writeResult: async (options) => {
        assert.deepStrictEqual(options, { cwd: '/tmp/example', ...args, summaryFile: 'summary', githubOutput: 'output' });
        return { artifactName: 'plan-example' };
      },
      logger: { info: (message) => logs.push(message) },
    });
    assert.strictEqual(logs.length, 1);
  });
  it('defaults working directory and output paths from the environment', async () => {
    await run(args, {
      writeResult: async (options) => {
        assert.strictEqual(options.cwd, process.cwd());
        assert.strictEqual(options.summaryFile, process.env.GITHUB_STEP_SUMMARY);
        assert.strictEqual(options.githubOutput, process.env.GITHUB_OUTPUT);
        return { artifactName: 'plan-example' };
      },
      logger: { info: () => {} },
    });
  });
});
