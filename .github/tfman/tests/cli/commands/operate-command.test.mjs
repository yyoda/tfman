import { access, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { runCommand } from '../../../lib/utils.mjs';
import { baseBranchLagMessage, baseBranchUnverifiedMessage } from '../../../lib/git.mjs';
import { describe, it } from 'node:test';
import assert from 'node:assert';
import { run } from '../../../cli/commands/operate-command.mjs';
import { calculateExecutionPaths } from '../../../lib/ops/change-detector.mjs';

describe('cli/commands/operate-command', () => {

  describe('run (Orchestration Logic)', () => {
    const baseArgs = {
      'comment-body': 'MOCK_BODY', // Value doesn't matter because we mock the parser
      'base-ref': 'base',
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
        { _detectChanges, _selectTargets, _parseCommand, _checkBaseBranch: async () => ({ status: 'current' }) }
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
        { _selectTargets, _detectChanges, _parseCommand, _checkBaseBranch: async () => ({ status: 'current' }) }
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
        { _detectChanges, _selectTargets, _parseCommand, _checkBaseBranch: async () => ({ status: 'current' }) }
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
        { _detectChanges, _parseCommand, _checkBaseBranch: async () => ({ status: 'current' }) }
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
        { _detectChanges, _parseCommand, _checkBaseBranch: async () => ({ status: 'current' }) }
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
        { _detectChanges, _parseCommand, _checkBaseBranch: async () => ({ status: 'current' }) }
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

      const result = await run({ ...baseArgs }, { _detectChanges, _parseCommand, _checkBaseBranch: async () => ({ status: 'current' }) });

      assert.deepStrictEqual(result, {
        command: 'error', targetDirs: [], tfTargets: [],
        message: 'Invalid file dependency pattern: "../x"', done: true
      });
    });
  });
});

describe('operate-command roles', () => {
  const baseArgs = { 'comment-body': '$terraform apply', 'base-sha': 'base', 'head-sha': 'head', 'base-ref': 'base', actor: 'someone' };

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
        _checkBaseBranch: async () => ({ status: 'current' }),
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
        _checkBaseBranch: async (...actual) => {
          assert.deepStrictEqual(actual, ['release/1.x', 'head', '/workspace']);
          return { status: 'stale', behindBy: 2 };
        },
        _detectChanges: resolve, _selectTargets: resolve,
      });
      assert.strictEqual(result.done, true);
      assert.strictEqual(result.command, 'apply');
      assert.deepStrictEqual(result.targetDirs, []);
      assert.deepStrictEqual(result.tfTargets, []);
      assert.strictEqual(result.message, baseBranchLagMessage('release/1.x', 2));
      assert.match(result.message, /Update branch/);
      assert.match(result.message, /\$terraform apply/);
      assert.strictEqual(targetCalls, 0);
    });
  }
  for (const command of ['plan', 'help', 'error']) {
    it(`skips the check for ${command} without base-ref`, async () => {
      let calls = 0;
      const input = { ...args };
      delete input['base-ref'];
      const result = await run(input, {
        _parseCommand: () => ({ command, message: 'Command message' }),
        _checkBaseBranch: async () => { calls++; return { status: 'stale', behindBy: 2 }; },
        _detectChanges: async () => targets,
      });
      assert.strictEqual(calls, 0);
      assert.strictEqual(result.done, command !== 'plan');
      assert.strictEqual(result.command, command);
    });
  }
  it('fails closed on lookup errors', async () => {
    const original = console.error;
    const errors = [];
    console.error = message => errors.push(message);
    try {
      const result = await run(args, { _checkBaseBranch: async () => ({ status: 'unverified', detail: 'Lookup failed' }) });
      assert.deepStrictEqual(result, { command: 'apply', done: true, targetDirs: [], tfTargets: [], message: baseBranchUnverifiedMessage('release/1.x') });
      assert.ok(!result.message.includes('Lookup failed'));
      assert.deepStrictEqual(errors, ['Lookup failed']);
    } finally {
      console.error = original;
    }
  });
  for (const base of [undefined, '', '   ']) {
    it(`requires a non-blank base-ref for apply: ${JSON.stringify(base)}`, async () => {
      let calls = 0;
      const logged = [];
      const original = console.error;
      console.error = message => logged.push(message);
      try {
        const input = { ...args, 'base-ref': base };
        if (base === undefined) delete input['base-ref'];
        const result = await run(input, {
          _checkBaseBranch: async () => { calls++; },
          _detectChanges: async () => { calls++; },
          _selectTargets: async () => { calls++; },
        });
        assert.deepStrictEqual(result, {
          command: 'apply', done: true, targetDirs: [], tfTargets: [],
          message: baseBranchUnverifiedMessage(base),
        });
        assert.strictEqual(calls, 0);
        assert.deepStrictEqual(logged, ['--base-ref is required for apply']);
      } finally {
        console.error = original;
      }
    });
  }
});


it('runs the real operate-command CLI against stale and current heads', async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'tfman-operate-ancestry-'));
  t.after(async () => {
    await rm(root, { recursive: true, force: true });
    await assert.rejects(access(root), { code: 'ENOENT' });
  });
  const git = (...args) => runCommand('git', args, { cwd: root });
  await git('init', '-q', '-b', 'release/1.x');
  await git('config', 'user.name', 'Test User');
  await git('config', 'user.email', 'test@example.com');
  await git('commit', '--allow-empty', '-qm', 'Initial');
  const head = (await git('rev-parse', 'HEAD')).stdout;
  await git('commit', '--allow-empty', '-qm', 'Advance base');
  const tip = (await git('rev-parse', 'HEAD')).stdout;
  const remote = join(root, 'remote.git');
  await git('clone', '--bare', root, remote);
  await git('remote', 'add', 'origin', remote);
  // An explicit target resolves through .tfdeps.json alone, so the current head reaches target selection.
  await writeFile(join(root, '.tfdeps.json'), JSON.stringify({ dirs: [{ path: 'env/x', providers: [] }] }));
  const cli = fileURLToPath(new URL('../../../cli/index.mjs', import.meta.url));
  const invoke = async sha => {
    const { stdout } = await runCommand(process.execPath, [cli, 'operate-command', '--comment-body', '$terraform apply env/x', '--base-sha', 'x', '--head-sha', sha, '--base-ref', 'release/1.x', '--root', root], { cwd: root });
    return JSON.parse(stdout);
  };
  const stale = await invoke(head);
  assert.strictEqual(stale.done, true);
  assert.strictEqual(stale.command, 'apply');
  assert.deepStrictEqual(stale.targetDirs, []);
  assert.strictEqual(stale.message, baseBranchLagMessage('release/1.x', 1));
  const current = await invoke(tip);
  assert.deepStrictEqual(current, { command: 'apply', targetDirs: [{ path: 'env/x', providers: [] }], tfTargets: [], message: '', done: false });
});
