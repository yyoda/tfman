import { describe, it } from 'node:test';
import assert from 'node:assert';
import { run } from '../../../scripts/cli/commands/operate-command.mjs';

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
  });
});
