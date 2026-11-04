import { describe, it } from 'node:test';
import assert from 'node:assert';
import { run } from '../../../cli/commands/operate-command.mjs';
import { calculateExecutionPaths } from '../../../lib/ops/change-detector.mjs';

describe('cli/commands/operate-command', () => {

  describe('run (Orchestration Logic)', () => {
    const baseArgs = {
      'comment-body': 'MOCK_BODY', // Value doesn't matter because we mock the parser
      'base-sha': 'base',
      'head-sha': 'head',
    };

    it('should call detectChanges when parser returns no explicit targetDirs', async () => {
      // Mock Parser: returns a valid command but NO targetDirs
      const _parseCommand = () => ({ command: 'apply', targetDirs: [], tfTargets: [] });

      let detectedDetails = null;
      // Mock Detector
      const _detectChanges = async (base, head) => {
        detectedDetails = { base, head };
        return [{ path: 'auto/detected' }];
      };
      // Mock Selector (should NOT be called)
      const _selectTargets = async () => { throw new Error('Should not be called'); };

      const result = await run(
        { ...baseArgs },
        { _detectChanges, _selectTargets, _parseCommand }
      );

      // Verify correct execution path
      assert.deepStrictEqual(detectedDetails, { base: 'base', head: 'head' });
      assert.strictEqual(result.command, 'apply');
      assert.deepStrictEqual(result.targetDirs, [{ path: 'auto/detected' }]);
      assert.deepStrictEqual(result.tfTargets, []);
    });

    it('should call selectTargets when parser returns explicit targetDirs', async () => {
      // Mock Parser: returns explicit targetDirs
      const _parseCommand = () => ({ command: 'apply', targetDirs: ['dev/app'], tfTargets: [] });

      let selectedTargetsArgs = null;
      // Mock Selector
      const _selectTargets = async (targets) => {
        selectedTargetsArgs = targets;
        return [{ path: 'manual/target' }];
      };
      // Mock Detector (should NOT be called)
      const _detectChanges = async () => { throw new Error('Should not be called'); };

      const result = await run(
        { ...baseArgs },
        { _selectTargets, _detectChanges, _parseCommand }
      );

      assert.strictEqual(selectedTargetsArgs, 'dev/app');
      assert.strictEqual(result.command, 'apply');
      assert.deepStrictEqual(result.targetDirs, [{ path: 'manual/target' }]);
      assert.deepStrictEqual(result.tfTargets, []);
    });

    it('should pass tfTargets through to the result', async () => {
      const _parseCommand = () => ({ command: 'apply', targetDirs: [], tfTargets: ['aws_instance.web', 'module.vpc'] });
      const _detectChanges = async () => [{ path: 'auto/detected' }];
      const _selectTargets = async () => { throw new Error('Should not be called'); };

      const result = await run(
        { ...baseArgs },
        { _detectChanges, _selectTargets, _parseCommand }
      );

      assert.strictEqual(result.command, 'apply');
      assert.deepStrictEqual(result.tfTargets, ['aws_instance.web', 'module.vpc']);
    });

    it('should return error when command parsing fails (invalid syntax)', async () => {
      // Mock Parser: returns null (invalid)
      const _parseCommand = () => null;

      const result = await run(
        { ...baseArgs },
        { _parseCommand }
      );

      assert.strictEqual(result.command, 'error');
      assert.ok(result.message.includes('Not a valid command'));
    });

    it('should return error immediately when parser returns an explicit error', async () => {
      let detectCalled = false;
      const _detectChanges = async () => {
        detectCalled = true;
        return [{ path: 'auto/detected' }];
      };

      const _parseCommand = () => ({
        command: 'error',
        targetDirs: [],
        tfTargets: [],
        message: 'Invalid target path provided: "../etc".'
      });

      const result = await run(
        { ...baseArgs },
        { _detectChanges, _parseCommand }
      );

      assert.strictEqual(detectCalled, false);
      assert.strictEqual(result.command, 'error');
      assert.strictEqual(result.done, true);
      assert.ok(result.message.includes('Invalid target path'));
    });

    it('should return error when no directories are found (after detection)', async () => {
      const _parseCommand = () => ({ command: 'plan', targetDirs: [], tfTargets: [] });
      const _detectChanges = async () => []; // Returns empty list

      const result = await run(
        { ...baseArgs },
        { _detectChanges, _parseCommand }
      );

      assert.strictEqual(result.command, 'error');
      assert.ok(result.message.includes('No Terraform directories matched'));
    });

    it('should return help message immediately if command is help', async () => {
      const msg = 'Usage: ...';
      const _parseCommand = () => ({ command: 'help', targetDirs: [], tfTargets: [], message: msg });

      // Detect/Select should not be called
      const result = await run(
        { ...baseArgs },
        { _parseCommand }
      );

      assert.strictEqual(result.command, 'help');
      assert.strictEqual(result.message, msg);
    });

    it('should return error when dependencies fail', async () => {
      const _parseCommand = () => ({ command: 'apply', targetDirs: [], tfTargets: [] });
      const _detectChanges = async () => { throw new Error('Git Error'); };

      const result = await run(
        { ...baseArgs },
        { _detectChanges, _parseCommand }
      );

      assert.strictEqual(result.command, 'error');
      assert.strictEqual(result.message, 'Git Error');
    });

    it('should return a completed error when the graph has malformed file declarations', async () => {
      const _parseCommand = () => ({ command: 'plan', targetDirs: [], tfTargets: [] });
      // Real graph validation, so the message is the one detect-changes would raise.
      const _detectChanges = async () => calculateExecutionPaths([], {
        dirs: [{ path: 'env/x', providers: [] }],
        files: [{ path: '../x', usedIn: ['*'] }]
      });

      const result = await run({ ...baseArgs }, { _detectChanges, _parseCommand });

      assert.deepStrictEqual(result, {
        command: 'error', targetDirs: [], tfTargets: [],
        message: 'Invalid file dependency pattern: "../x"', done: true
      });
    });
  });
});

describe('operate-command roles', () => {
  const baseArgs = { 'comment-body': '$terraform apply', 'base-sha': 'base', 'head-sha': 'head', actor: 'someone' };

  for (const roles of ['["planner"]', 'invalid json', '[]', '"applier"', 'null']) {
    it(`denies apply before target resolution with roles ${roles}`, async () => {
      let calls = 0;
      const resolve = async () => { calls++; return [{ path: 'env/x' }]; };
      for (const comment of ['$terraform apply', '$terraform apply env/x']) {
        const result = await run({ ...baseArgs, 'comment-body': comment, roles }, { _detectChanges: resolve, _selectTargets: resolve });
        assert.deepStrictEqual(result, {
          command: 'apply', targetDirs: [], tfTargets: [],
          message: 'User someone does not have permission to apply. Required role: applier.', done: true,
        });
      }
      assert.strictEqual(calls, 0);
    });
  }

  for (const [command, roles] of [['apply', '["applier"]'], ['plan', '["planner"]'], ['plan', 'invalid json']]) {
    it(`allows ${command} with roles ${roles}`, async () => {
      const result = await run({ ...baseArgs, 'comment-body': `$terraform ${command}`, roles }, {
        _detectChanges: async () => [{ path: 'env/x' }],
      });
      assert.strictEqual(result.done, false);
      assert.strictEqual(result.command, command);
      assert.deepStrictEqual(result.targetDirs, [{ path: 'env/x' }]);
    });
  }
});

describe('operate-command base ancestry', () => {
  const args = { 'comment-body': '$terraform apply', 'base-sha': 'base', 'head-sha': 'head', 'base-ref': 'release/1.x', root: '/workspace' };
  const targets = [{ path: 'env/x' }];

  for (const explicit of [false, true]) {
    it(`rejects stale apply before target resolution (explicit: ${explicit})`, async () => {
      let targetCalls = 0;
      const resolve = async () => { targetCalls++; return targets; };
      const result = await run(args, {
        _parseCommand: () => ({ command: 'apply', targetDirs: explicit ? ['env/x'] : [], tfTargets: explicit ? ['module.x'] : [] }),
        _getBaseBranchLag: async (...actual) => {
          assert.deepStrictEqual(actual, ['release/1.x', 'head', '/workspace']);
          return { upToDate: false, behindBy: 2 };
        },
        _detectChanges: resolve, _selectTargets: resolve,
      });
      assert.strictEqual(result.done, true);
      assert.strictEqual(result.command, 'apply');
      assert.deepStrictEqual(result.targetDirs, []);
      assert.deepStrictEqual(result.tfTargets, []);
      assert.match(result.message, /2 commits behind `release\/1.x`/);
      assert.match(result.message, /Update branch/);
      assert.match(result.message, /\$terraform apply/);
      assert.strictEqual(targetCalls, 0);
    });
  }
  it('continues apply when up to date', async () => {
    const result = await run(args, { _getBaseBranchLag: async () => ({ upToDate: true, behindBy: 0 }), _detectChanges: async () => targets });
    assert.strictEqual(result.done, false);
    assert.deepStrictEqual(result.targetDirs, targets);
  });
  for (const command of ['plan', 'apply']) {
    it(`skips the check for ${command === 'plan' ? 'plan' : 'apply without base-ref'}`, async () => {
      let calls = 0;
      const input = { ...args, 'comment-body': `$terraform ${command}` };
      if (command === 'apply') delete input['base-ref'];
      const result = await run(input, {
        _getBaseBranchLag: async () => { calls++; return { upToDate: false, behindBy: 2 }; },
        _detectChanges: async () => targets,
      });
      assert.strictEqual(calls, 0);
      assert.strictEqual(result.done, false);
      assert.strictEqual(result.command, command);
    });
  }
  it('fails closed on lookup errors', async () => {
    const result = await run(args, { _getBaseBranchLag: async () => { throw new Error('Lookup failed'); } });
    assert.deepStrictEqual(result, { command: 'apply', done: true, targetDirs: [], tfTargets: [], message: 'Lookup failed' });
  });
  it('fails closed on an empty base-ref', async () => {
    const result = await run({ ...args, 'base-ref': '' });
    assert.strictEqual(result.done, true);
    assert.strictEqual(result.command, 'apply');
    assert.match(result.message, /non-empty string/);
  });
  it('keeps role denial ahead of ancestry lookup', async () => {
    let calls = 0;
    const result = await run({ ...args, roles: '["planner"]', actor: 'someone' }, {
      _getBaseBranchLag: async () => { calls++; },
    });
    assert.strictEqual(calls, 0);
    assert.deepStrictEqual(result, { command: 'apply', done: true, targetDirs: [], tfTargets: [], message: 'User someone does not have permission to apply. Required role: applier.' });
  });
});
